// 登录用户管理自己的 API keys；原始 key 仅在创建时返回一次。
import { db, audit, transaction } from '../db.js';
import { authRequired } from './auth.js';
import { createApiKey } from '../crypto.js';
import { HttpError } from '../http.js';

export const API_KEY_TIERS = {
  code: ['otp:read'],
  read: ['entries:read', 'otp:read'],
  manage: ['entries:read', 'otp:read', 'entries:create', 'entries:update', 'entries:delete'],
};

function decodeEntryIds(value) {
  if (value === null) return null;
  try {
    const ids = JSON.parse(value);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function publicKey(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.key_prefix,
    tier: row.tier,
    scopes: API_KEY_TIERS[row.tier],
    entry_ids: decodeEntryIds(row.entry_ids),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

export function registerApiKeyRoutes(router) {
  router.get('/api/keys', authRequired, async (ctx) => {
    const keys = db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC, id DESC')
      .all(ctx.user.id);
    ctx.json(200, { keys: keys.map(publicKey) });
  });

  router.post('/api/keys', authRequired, async (ctx) => {
    const body = ctx.body || {};
    const tier = String(body.tier || '');
    if (!Object.hasOwn(API_KEY_TIERS, tier)) throw new HttpError(400, 'invalid API key tier');
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) throw new HttpError(400, 'name is required');

    let entryIds = null;
    if (body.entry_ids !== null && body.entry_ids !== undefined) {
      if (!Array.isArray(body.entry_ids) || body.entry_ids.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
        throw new HttpError(400, 'entry_ids must be null or an array of positive IDs');
      }
      entryIds = [...new Set(body.entry_ids.map(Number))];
      if (entryIds.length) {
        const placeholders = entryIds.map(() => '?').join(',');
        const owned = db.prepare(`SELECT id FROM entries WHERE user_id = ? AND id IN (${placeholders})`)
          .all(ctx.user.id, ...entryIds).map((row) => row.id);
        if (owned.length !== entryIds.length) throw new HttpError(400, 'entry_ids contains an unknown entry');
      }
    }
    if (tier === 'code' && (!entryIds || entryIds.length === 0)) {
      throw new HttpError(400, 'code-only keys must be limited to one or more entries');
    }
    if (tier === 'read' && entryIds?.length === 0) {
      throw new HttpError(400, 'read keys must include entries or use entry_ids: null for all entries');
    }

    const generated = createApiKey();
    const id = generated.id;
    const row = transaction(() => {
      const count = db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL')
        .get(ctx.user.id).n;
      if (count >= 20) throw new HttpError(400, 'maximum 20 active API keys per user');
      db.prepare(
        `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, tier, entry_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, ctx.user.id, name, generated.hash, generated.prefix, tier,
        entryIds === null ? null : JSON.stringify(entryIds));
      audit(ctx.user.id, 'api_key_create', `key=${id} tier=${tier} name=${name}`, ctx.ip, ctx.ua);
      return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id);
    });
    ctx.json(201, { key: publicKey(row), value: generated.value });
  });

  router.delete('/api/keys/:id', authRequired, async (ctx) => {
    transaction(() => {
      const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?')
        .get(String(ctx.params.id), ctx.user.id);
      if (!row || row.revoked_at) throw new HttpError(404, 'API key not found');
      db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ? AND user_id = ?")
        .run(row.id, ctx.user.id);
      audit(ctx.user.id, 'api_key_revoke', `key=${row.id}`, ctx.ip, ctx.ua);
    });
    ctx.json(200, { ok: true });
  });
}
