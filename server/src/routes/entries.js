// 条目路由：2FA 条目 CRUD + 排序 + 批量导入 + HOTP 计数器同步 + 垃圾箱（软删除）
// secret 落盘为 AES-256-GCM 密文；API 返回明文（TLS 保护下），出码在前端完成（游客/登录双模式同一套逻辑）。
// 删除为软删除：条目进入垃圾箱（deleted_at 非空）保留 TRASH_RETENTION_DAYS 天，期间可恢复；
// 到期由 db.js 的 cleanupTrash 彻底删除。
import { db, audit, TRASH_RETENTION_DAYS } from '../db.js';
import { encryptSecret, decryptSecret } from '../crypto.js';
import { HttpError } from '../http.js';
import { authRequired } from './auth.js';
import { normalizeBase32 } from '../../../shared/base32.js';
import { ALGORITHMS, clampDigits, clampPeriod } from '../../../shared/otp.js';

function entryRow(e) {
  // e.secret_plain 为解密后的明文；解密失败的条目以 decrypt_error 标记（见 /full 的单条隔离）
  return {
    id: e.id, label: e.label, issuer: e.issuer, secret: e.secret_plain,
    type: e.type, algorithm: e.algorithm, digits: e.digits,
    period: e.period, counter: e.counter, sort: e.sort,
    created_at: e.created_at, updated_at: e.updated_at,
    ...(e.decrypt_error ? { decrypt_error: true } : {}),
  };
}

// 垃圾箱视图：只含元数据，绝不含 secret（回收站条目不出码）
function trashView(row) {
  let daysLeft = TRASH_RETENTION_DAYS;
  let expireIso = null;
  if (row.expire_at) {
    const ts = Date.parse(String(row.expire_at).replace(' ', 'T') + 'Z');
    if (Number.isFinite(ts)) {
      daysLeft = Math.max(0, Math.ceil((ts - Date.now()) / 86400000));
      expireIso = new Date(ts).toISOString();
    }
  }
  return {
    id: row.id, label: row.label, issuer: row.issuer,
    type: row.type, algorithm: row.algorithm, digits: row.digits,
    period: row.period, counter: row.counter,
    deleted_at: row.deleted_at, expire_at: expireIso, days_left: daysLeft,
  };
}

export function validateEntry(body) {
  let secret;
  try { secret = normalizeBase32(body.secret); } catch (err) { throw new HttpError(400, `invalid secret: ${err.message}`); }
  const type = body.type === 'hotp' ? 'hotp' : 'totp';
  const algorithm = ALGORITHMS.includes(String(body.algorithm || '').toUpperCase())
    ? body.algorithm.toUpperCase() : 'SHA1';
  if (secret.length < 8) throw new HttpError(400, 'secret too short');
  return {
    label: String(body.label || '').slice(0, 120),
    issuer: String(body.issuer || '').slice(0, 120),
    secret, type, algorithm,
    digits: clampDigits(body.digits),
    period: clampPeriod(body.period),
    counter: Math.max(0, Math.floor(Number(body.counter) || 0)),
  };
}

const MACHINE_ENTRY_FIELDS = new Set([
  'label', 'issuer', 'secret', 'type', 'algorithm', 'digits', 'period', 'counter',
]);

/** Strict validation for Machine API payloads; browser form coercion stays in validateEntry. */
export function validateMachineEntry(body, { current = {} } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'entry body must be an object');
  }
  const unknownField = Object.keys(body).find((field) => !MACHINE_ENTRY_FIELDS.has(field));
  if (unknownField) throw new HttpError(400, `unknown entry field: ${unknownField}`);

  const value = (field, fallback) => Object.hasOwn(body, field)
    ? body[field]
    : current[field] ?? fallback;
  const label = value('label', '');
  const issuer = value('issuer', '');
  const type = value('type', 'totp');
  const algorithm = value('algorithm', 'SHA1');
  const digits = value('digits', 6);
  const period = value('period', 30);
  const counter = value('counter', 0);
  const rawSecret = value('secret', undefined);

  if (typeof label !== 'string' || label.length > 120) {
    throw new HttpError(400, 'label must be a string up to 120 characters');
  }
  if (typeof issuer !== 'string' || issuer.length > 120) {
    throw new HttpError(400, 'issuer must be a string up to 120 characters');
  }
  if (type !== 'totp' && type !== 'hotp') throw new HttpError(400, 'type must be totp or hotp');
  if (!ALGORITHMS.includes(algorithm)) throw new HttpError(400, 'algorithm must be SHA1, SHA256, or SHA512');
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) {
    throw new HttpError(400, 'digits must be an integer from 6 to 10');
  }
  if (!Number.isInteger(period) || period < 7 || period > 120) {
    throw new HttpError(400, 'period must be an integer from 7 to 120');
  }
  if (!Number.isSafeInteger(counter) || counter < 0 || counter >= Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, 'counter must be a non-negative integer below the HOTP safe increment limit');
  }
  if (typeof rawSecret !== 'string') throw new HttpError(400, 'secret must be a base32 string');

  let secret;
  try { secret = normalizeBase32(rawSecret); } catch (err) {
    throw new HttpError(400, `invalid secret: ${err.message}`);
  }
  if (secret.length < 8) throw new HttpError(400, 'secret too short');

  return { label, issuer, secret, type, algorithm, digits, period, counter };
}

/** 启用中的条目；垃圾箱内条目对编辑/出码/计数器一律 404，不暴露其存在 */
function getActiveEntry(ctx) {
  const e = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .get(Number(ctx.params.id), ctx.user.id);
  if (!e) throw new HttpError(404, 'entry not found');
  return e;
}

/** 垃圾箱中且仍在保留期内的条目；已过保留期的视作不存在（清理前先于查询生效） */
function getTrashedEntry(ctx) {
  const e = db.prepare(
    `SELECT * FROM entries
     WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL
       AND deleted_at >= datetime('now', ?)`,
  ).get(Number(ctx.params.id), ctx.user.id, `-${TRASH_RETENTION_DAYS} days`);
  if (!e) throw new HttpError(404, 'entry not found');
  return e;
}

const TRASH_ACTIVE_SQL = `deleted_at >= datetime('now', '-${TRASH_RETENTION_DAYS} days')`;

export function registerEntryRoutes(router) {
  // 明文列表（含 secret）：登录后加载，用于前端出码；单条解密失败不拖垮整个库
  router.get('/api/entries/full', authRequired, async (ctx) => {
    const rows = db.prepare('SELECT * FROM entries WHERE user_id = ? AND deleted_at IS NULL ORDER BY sort, id')
      .all(ctx.user.id);
    const entries = rows.map((e) => {
      try {
        return entryRow({ ...e, secret_plain: decryptEntry(e) });
      } catch {
        // 密文损坏（如从坏备份恢复/MASTER_KEY 变更）：标记该条目而不是 500 全库，用户可在 UI 删除
        audit(ctx.user.id, 'entry_decrypt_error', `id=${e.id}`, ctx.ip, ctx.ua);
        return entryRow({ ...e, secret_plain: null, decrypt_error: true });
      }
    });
    // 历史垃圾箱条目（超过保留期、尚未被定时清理）不计入
    const trashCount = db.prepare(
      'SELECT COUNT(*) AS n FROM entries WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at >= datetime(\'now\', ?)',
    ).get(ctx.user.id, `-${TRASH_RETENTION_DAYS} days`).n;
    ctx.json(200, { entries, trash_count: trashCount });
  });

  // 垃圾箱列表：仅元数据，不含 secret（回收站条目不出码）
  router.get('/api/entries/trash', authRequired, async (ctx) => {
    const rows = db.prepare(
      `SELECT id, label, issuer, type, algorithm, digits, period, counter, deleted_at,
              datetime(deleted_at, '+${TRASH_RETENTION_DAYS} days') AS expire_at
       FROM entries
       WHERE user_id = ? AND ${TRASH_ACTIVE_SQL}
       ORDER BY deleted_at DESC, id DESC`,
    ).all(ctx.user.id);
    ctx.json(200, { entries: rows.map(trashView), retention_days: TRASH_RETENTION_DAYS });
  });

  // 清空回收站：彻底删除该用户垃圾箱内全部条目
  router.delete('/api/entries/trash', authRequired, async (ctx) => {
    const result = db.prepare('DELETE FROM entries WHERE user_id = ? AND deleted_at IS NOT NULL')
      .run(ctx.user.id);
    audit(ctx.user.id, 'trash_empty', `count=${result.changes}`, ctx.ip, ctx.ua);
    ctx.json(200, { ok: true, purged: result.changes });
  });

  router.post('/api/entries', authRequired, async (ctx) => {
    const v = validateEntry(ctx.body || {});
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries WHERE user_id = ? AND deleted_at IS NULL')
      .get(ctx.user.id).m;
    const info = db.prepare(
      `INSERT INTO entries (user_id, label, issuer, secret, type, algorithm, digits, period, counter, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ctx.user.id, v.label, v.issuer, encryptSecret(v.secret), v.type, v.algorithm, v.digits, v.period, v.counter, maxSort + 1);
    audit(ctx.user.id, 'entry_create', `id=${info.lastInsertRowid} issuer=${v.issuer}`, ctx.ip, ctx.ua);
    ctx.json(201, { id: info.lastInsertRowid });
  });

  router.put('/api/entries/:id', authRequired, async (ctx) => {
    const e = getActiveEntry(ctx);
    const v = validateEntry({ ...e, ...ctx.body, secret: ctx.body?.secret ?? decryptEntry(e) });
    db.prepare(
      `UPDATE entries SET label = ?, issuer = ?, secret = ?, type = ?, algorithm = ?,
       digits = ?, period = ?, counter = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(v.label, v.issuer, encryptSecret(v.secret), v.type, v.algorithm, v.digits, v.period, v.counter, e.id);
    ctx.json(200, { ok: true });
  });

  // 删除 = 移入垃圾箱（保留 TRASH_RETENTION_DAYS 天，可恢复）；到期由 cleanupTrash 彻底删除
  router.delete('/api/entries/:id', authRequired, async (ctx) => {
    const e = getActiveEntry(ctx);
    db.prepare("UPDATE entries SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(e.id);
    audit(ctx.user.id, 'entry_delete', `id=${e.id}`, ctx.ip, ctx.ua);
    ctx.json(200, { ok: true });
  });

  // 从垃圾箱恢复：清除 deleted_at（sort 保留原值）
  router.post('/api/entries/:id/restore', authRequired, async (ctx) => {
    const e = getTrashedEntry(ctx);
    db.prepare("UPDATE entries SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .run(e.id);
    audit(ctx.user.id, 'entry_restore', `id=${e.id}`, ctx.ip, ctx.ua);
    ctx.json(200, { ok: true });
  });

  // 从垃圾箱彻底删除（不可恢复）
  router.delete('/api/entries/:id/purge', authRequired, async (ctx) => {
    const e = getTrashedEntry(ctx);
    db.prepare('DELETE FROM entries WHERE id = ?').run(e.id);
    audit(ctx.user.id, 'entry_purge', `id=${e.id}`, ctx.ip, ctx.ua);
    ctx.json(200, { ok: true });
  });

  router.post('/api/entries/bulk', authRequired, async (ctx) => {
    const list = Array.isArray(ctx.body?.entries) ? ctx.body.entries : [];
    if (!list.length) throw new HttpError(400, 'empty entries');
    if (list.length > 1000) throw new HttpError(400, 'too many entries (max 1000)');
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries WHERE user_id = ? AND deleted_at IS NULL')
      .get(ctx.user.id).m;
    const insert = db.prepare(
      `INSERT INTO entries (user_id, label, issuer, secret, type, algorithm, digits, period, counter, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    db.exec('BEGIN');
    try {
      let sort = maxSort;
      for (const raw of list) {
        const v = validateEntry(raw);
        insert.run(ctx.user.id, v.label, v.issuer, encryptSecret(v.secret), v.type, v.algorithm, v.digits, v.period, v.counter, ++sort);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, `import failed: ${err.message}`);
    }
    audit(ctx.user.id, 'entry_import', `count=${list.length}`, ctx.ip, ctx.ua);
    ctx.json(201, { imported: list.length });
  });

  router.put('/api/entries-order', authRequired, async (ctx) => {
    const ids = Array.isArray(ctx.body?.ids) ? ctx.body.ids.map(Number) : [];
    if (!ids.length || ids.some((n) => !Number.isInteger(n))) throw new HttpError(400, 'valid ids array required');
    const upd = db.prepare('UPDATE entries SET sort = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL');
    db.exec('BEGIN');
    try {
      ids.forEach((id, i) => upd.run(i + 1, id, ctx.user.id));
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new HttpError(500, `reorder failed: ${err.message}`);
    }
    ctx.json(200, { ok: true });
  });

  // HOTP 计数器前进（出码即自增，多端同步）
  router.post('/api/entries/:id/counter', authRequired, async (ctx) => {
    const e = getActiveEntry(ctx);
    const next = Math.max(Number(ctx.body?.counter) || 0, e.counter + 1);
    db.prepare('UPDATE entries SET counter = ?, updated_at = datetime(\'now\') WHERE id = ?').run(next, e.id);
    ctx.json(200, { counter: next });
  });
}

function decryptEntry(e) {
  try { return decryptSecret(e.secret); } catch {
    throw new HttpError(500, 'failed to decrypt entry (MASTER_KEY changed?)');
  }
}
