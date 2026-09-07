// 条目路由：2FA 条目 CRUD + 排序 + 批量导入 + HOTP 计数器同步
// secret 落盘为 AES-256-GCM 密文；API 返回明文（TLS 保护下），出码在前端完成（游客/登录双模式同一套逻辑）。
import { db, audit } from '../db.js';
import { encryptSecret, decryptSecret } from '../crypto.js';
import { HttpError } from '../http.js';
import { authRequired } from './auth.js';
import { normalizeBase32 } from '../../../shared/base32.js';
import { ALGORITHMS, clampDigits, clampPeriod } from '../../../shared/otp.js';

function entryRow(e) {
  return {
    id: e.id, label: e.label, issuer: e.issuer, secret: e.secret_plain,
    type: e.type, algorithm: e.algorithm, digits: e.digits,
    period: e.period, counter: e.counter, sort: e.sort,
    created_at: e.created_at, updated_at: e.updated_at,
  };
}

function validateEntry(body) {
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

function getOwnedEntry(ctx) {
  const e = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(Number(ctx.params.id), ctx.user.id);
  if (!e) throw new HttpError(404, 'entry not found');
  return e;
}

export function registerEntryRoutes(router) {
  router.get('/api/entries', authRequired, async (ctx) => {
    const rows = db.prepare('SELECT * FROM entries WHERE user_id = ? ORDER BY sort, id').all(ctx.user.id);
    ctx.json(200, { entries: rows.map((e) => ({ ...entryRow(e), secret_plain: undefined })) });
  });

  // 明文列表（含 secret）：登录后首次加载时取一次，用于前端出码
  router.get('/api/entries/full', authRequired, async (ctx) => {
    const rows = db.prepare('SELECT * FROM entries WHERE user_id = ? ORDER BY sort, id').all(ctx.user.id);
    ctx.json(200, { entries: rows.map((e) => entryRow({ ...e, secret_plain: decryptEntry(e) })) });
  });

  router.post('/api/entries', authRequired, async (ctx) => {
    const v = validateEntry(ctx.body || {});
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries WHERE user_id = ?').get(ctx.user.id).m;
    const info = db.prepare(
      `INSERT INTO entries (user_id, label, issuer, secret, type, algorithm, digits, period, counter, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(ctx.user.id, v.label, v.issuer, encryptSecret(v.secret), v.type, v.algorithm, v.digits, v.period, v.counter, maxSort + 1);
    audit(ctx.user.id, 'entry_create', `id=${info.lastInsertRowid} issuer=${v.issuer}`, ctx.ip, ctx.ua);
    ctx.json(201, { id: info.lastInsertRowid });
  });

  router.put('/api/entries/:id', authRequired, async (ctx) => {
    const e = getOwnedEntry(ctx);
    const v = validateEntry({ ...e, ...ctx.body, secret: ctx.body?.secret ?? decryptEntry(e) });
    db.prepare(
      `UPDATE entries SET label = ?, issuer = ?, secret = ?, type = ?, algorithm = ?,
       digits = ?, period = ?, counter = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(v.label, v.issuer, encryptSecret(v.secret), v.type, v.algorithm, v.digits, v.period, v.counter, e.id);
    ctx.json(200, { ok: true });
  });

  router.delete('/api/entries/:id', authRequired, async (ctx) => {
    const e = getOwnedEntry(ctx);
    db.prepare('DELETE FROM entries WHERE id = ?').run(e.id);
    audit(ctx.user.id, 'entry_delete', `id=${e.id}`, ctx.ip, ctx.ua);
    ctx.json(200, { ok: true });
  });

  router.post('/api/entries/bulk', authRequired, async (ctx) => {
    const list = Array.isArray(ctx.body?.entries) ? ctx.body.entries : [];
    if (!list.length) throw new HttpError(400, 'empty entries');
    if (list.length > 1000) throw new HttpError(400, 'too many entries (max 1000)');
    const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries WHERE user_id = ?').get(ctx.user.id).m;
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
    if (!ids.length) throw new HttpError(400, 'ids required');
    const upd = db.prepare('UPDATE entries SET sort = ? WHERE id = ? AND user_id = ?');
    db.exec('BEGIN');
    ids.forEach((id, i) => upd.run(i + 1, id, ctx.user.id));
    db.exec('COMMIT');
    ctx.json(200, { ok: true });
  });

  // HOTP 计数器前进（出码即自增，多端同步）
  router.post('/api/entries/:id/counter', authRequired, async (ctx) => {
    const e = getOwnedEntry(ctx);
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
