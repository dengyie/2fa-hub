// Machine API: requires a scoped API key in Authorization: Bearer; cookies and session tokens are rejected.
import { db, audit, transaction } from '../db.js';
import { apiKeyIdFromToken, decryptSecret, encryptSecret, verifyApiKey } from '../crypto.js';
import { allow } from '../limiter.js';
import { HttpError } from '../http.js';
import { validateMachineEntry } from './entries.js';
import { API_KEY_TIERS } from './api-keys.js';
import { generateOtp } from '../../../shared/otp.js';

function metadata(row) {
  return {
    id: row.id,
    label: row.label,
    issuer: row.issuer,
    type: row.type,
    algorithm: row.algorithm,
    digits: row.digits,
    period: row.period,
    counter: row.counter,
    sort: row.sort,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function requireScope(ctx, scope) {
  if (!ctx.apiKey.scopes.includes(scope)) throw new HttpError(403, 'API key scope does not allow this operation');
}

function entryAllowed(ctx, id) {
  return ctx.apiKey.entryIds === null || ctx.apiKey.entryIds.includes(Number(id));
}

function getEntry(ctx) {
  const id = Number(ctx.params.id);
  if (!Number.isSafeInteger(id) || id <= 0 || !entryAllowed(ctx, id)) throw new HttpError(404, 'entry not found');
  const row = db.prepare('SELECT * FROM entries WHERE id = ? AND user_id = ?').get(id, ctx.apiKey.userId);
  if (!row) throw new HttpError(404, 'entry not found');
  return row;
}

function decryptEntry(row) {
  try { return decryptSecret(row.secret); } catch {
    throw new HttpError(500, 'failed to decrypt entry');
  }
}

function requireApiKey(ctx) {
  // Do not accept ambient browser cookies or session Bearer tokens on the machine API.
  if (ctx.req.headers.cookie) throw new HttpError(401, 'API v1 requires an API key and does not accept cookies');
  const match = /^Bearer\s+(\S+)$/i.exec(String(ctx.req.headers.authorization || ''));
  const value = match?.[1] || '';
  const id = apiKeyIdFromToken(value);
  if (!id) rejectInvalidApiKey(ctx);

  const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL').get(id);
  if (!row || !verifyApiKey(value, row.key_hash)) rejectInvalidApiKey(ctx);
  const user = db.prepare('SELECT id, is_active FROM users WHERE id = ?').get(row.user_id);
  if (!user || !user.is_active) rejectInvalidApiKey(ctx);
  if (!allow(`api-v1-ip:${ctx.ip}`, 120, 60_000) || !allow(`api-v1-key:${id}`, 120, 60_000)) {
    throw new HttpError(429, 'rate limit exceeded');
  }

  ctx.apiKey = {
    id: row.id,
    userId: row.user_id,
    tier: row.tier,
    scopes: API_KEY_TIERS[row.tier] || [],
    entryIds: row.entry_ids === null ? null : JSON.parse(row.entry_ids),
  };
}

function rejectInvalidApiKey(ctx) {
  if (!allow(`api-v1-invalid-auth:${ctx.ip}`, 120, 60_000)) {
    throw new HttpError(429, 'invalid API key rate limit exceeded');
  }
  throw new HttpError(401, 'invalid API key');
}

function touchApiKey(ctx) {
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ? AND revoked_at IS NULL")
    .run(ctx.apiKey.id);
}

function requireTier(ctx, scope) {
  requireApiKey(ctx);
  requireScope(ctx, scope);
  touchApiKey(ctx);
}

async function respondWithTotp(ctx, row) {
  const generated = await generateOtp({ ...row, secret: decryptEntry(row) });
  audit(ctx.apiKey.userId, 'api_code', `key=${ctx.apiKey.id} entry=${row.id} type=totp`, ctx.ip, ctx.ua);
  ctx.json(200, { code: generated.code, remaining: generated.remaining, type: 'totp' });
}

async function codeHandler(ctx) {
  if (ctx.method === 'HEAD') throw new HttpError(405, 'HEAD is not supported for code endpoints');
  requireTier(ctx, 'otp:read');
  let row = getEntry(ctx);
  if (!allow(`api-v1-code:${ctx.apiKey.id}`, 60, 60_000)) throw new HttpError(429, 'code rate limit exceeded');

  if (row.type !== 'hotp') {
    await respondWithTotp(ctx, row);
    return;
  }

  // Claim only the exact code-generating snapshot that produced this candidate.
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0) row = getEntry(ctx);
    if (row.type !== 'hotp') {
      await respondWithTotp(ctx, row);
      return;
    }
    if (!Number.isSafeInteger(row.counter) || row.counter < 0 || row.counter >= Number.MAX_SAFE_INTEGER) {
      throw new HttpError(409, 'HOTP counter reached the safe integer limit');
    }
    const generated = await generateOtp({ ...row, secret: decryptEntry(row) });
    const claimed = transaction(() => {
      const activeKey = db.prepare(
        `SELECT 1 FROM api_keys k JOIN users u ON u.id = k.user_id
         WHERE k.id = ? AND k.user_id = ? AND k.revoked_at IS NULL AND u.is_active = 1`,
      ).get(ctx.apiKey.id, ctx.apiKey.userId);
      if (!activeKey) throw new HttpError(401, 'invalid API key');
      const result = db.prepare(
        `UPDATE entries SET counter = counter + 1, updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND counter = ? AND secret = ? AND type = ?
           AND algorithm = ? AND digits = ? AND period = ?`,
      ).run(row.id, ctx.apiKey.userId, row.counter, row.secret, row.type,
        row.algorithm, row.digits, row.period);
      if (!result.changes) return false;
      audit(ctx.apiKey.userId, 'api_code', `key=${ctx.apiKey.id} entry=${row.id} type=hotp`, ctx.ip, ctx.ua);
      return true;
    });
    if (claimed) {
      ctx.json(200, { code: generated.code, remaining: null, type: 'hotp', counter: row.counter });
      return;
    }
  }
  throw new HttpError(409, 'HOTP entry changed repeatedly while generating a code');
}

export function registerApiV1Routes(router) {
  router.get('/api/v1/entries', async (ctx) => {
    requireTier(ctx, 'entries:read');
    let rows;
    if (ctx.apiKey.entryIds === null) {
      rows = db.prepare('SELECT * FROM entries WHERE user_id = ? ORDER BY sort, id').all(ctx.apiKey.userId);
    } else if (ctx.apiKey.entryIds.length) {
      const placeholders = ctx.apiKey.entryIds.map(() => '?').join(',');
      rows = db.prepare(`SELECT * FROM entries WHERE user_id = ? AND id IN (${placeholders}) ORDER BY sort, id`)
        .all(ctx.apiKey.userId, ...ctx.apiKey.entryIds);
    } else {
      rows = [];
    }
    ctx.json(200, { entries: rows.map(metadata) });
  });

  router.get('/api/v1/entries/:id', async (ctx) => {
    requireTier(ctx, 'entries:read');
    ctx.json(200, { entry: metadata(getEntry(ctx)) });
  });

  router.get('/api/v1/entries/:id/code', codeHandler);
  router.post('/api/v1/entries/:id/code', codeHandler);

  router.post('/api/v1/entries', async (ctx) => {
    requireTier(ctx, 'entries:create');
    const value = validateMachineEntry(ctx.body);
    const encryptedSecret = encryptSecret(value.secret);
    const entryId = transaction(() => {
      const maxSort = db.prepare('SELECT COALESCE(MAX(sort), 0) AS m FROM entries WHERE user_id = ?')
        .get(ctx.apiKey.userId).m;
      const result = db.prepare(
        `INSERT INTO entries (user_id, label, issuer, secret, type, algorithm, digits, period, counter, sort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(ctx.apiKey.userId, value.label, value.issuer, encryptedSecret,
        value.type, value.algorithm, value.digits, value.period, value.counter, maxSort + 1);
      const createdId = Number(result.lastInsertRowid);
      const key = db.prepare(
        `SELECT k.entry_ids FROM api_keys k JOIN users u ON u.id = k.user_id
         WHERE k.id = ? AND k.user_id = ? AND k.revoked_at IS NULL AND u.is_active = 1`,
      ).get(ctx.apiKey.id, ctx.apiKey.userId);
      if (!key) throw new HttpError(401, 'invalid API key');
      if (key.entry_ids !== null) {
        const ids = [...new Set([...JSON.parse(key.entry_ids), createdId])];
        const updated = db.prepare(
          'UPDATE api_keys SET entry_ids = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
        ).run(JSON.stringify(ids), ctx.apiKey.id, ctx.apiKey.userId);
        if (!updated.changes) throw new HttpError(401, 'invalid API key');
      }
      audit(ctx.apiKey.userId, 'api_entry_create', `key=${ctx.apiKey.id} entry=${createdId}`, ctx.ip, ctx.ua);
      return createdId;
    });
    ctx.json(201, { id: entryId });
  });

  router.put('/api/v1/entries/:id', async (ctx) => {
    requireTier(ctx, 'entries:update');
    const body = ctx.body ?? null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new HttpError(400, 'entry body must be an object');
    }
    if (Object.keys(body).length === 0) throw new HttpError(400, 'at least one entry field is required');
    transaction(() => {
      const row = getEntry(ctx);
      const current = { ...row, secret: Object.hasOwn(body, 'secret') ? undefined : decryptEntry(row) };
      const value = validateMachineEntry(body, { current });
      db.prepare(
        `UPDATE entries SET label = ?, issuer = ?, secret = ?, type = ?, algorithm = ?,
         digits = ?, period = ?, counter = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      ).run(value.label, value.issuer, encryptSecret(value.secret), value.type, value.algorithm,
        value.digits, value.period, value.counter, row.id, ctx.apiKey.userId);
      audit(ctx.apiKey.userId, 'api_entry_update', `key=${ctx.apiKey.id} entry=${row.id}`, ctx.ip, ctx.ua);
    });
    ctx.json(200, { ok: true });
  });

  router.delete('/api/v1/entries/:id', async (ctx) => {
    requireTier(ctx, 'entries:delete');
    transaction(() => {
      const row = getEntry(ctx);
      db.prepare('DELETE FROM entries WHERE id = ? AND user_id = ?').run(row.id, ctx.apiKey.userId);
      audit(ctx.apiKey.userId, 'api_entry_delete', `key=${ctx.apiKey.id} entry=${row.id}`, ctx.ip, ctx.ua);
    });
    ctx.json(200, { ok: true });
  });
}
