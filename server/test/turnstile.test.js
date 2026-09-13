import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), '2fa-hub-turnstile-test-'));
process.env.COOKIE_SECURE = '0';
process.env.PORT = '0';

const { setSetting } = await import('../src/db.js');
const { getTurnstileConfig, verifyTurnstile } = await import('../src/turnstile.js');

test('turnstile config defaults to disabled when no env/db flag set', () => {
  const cfg = getTurnstileConfig();
  assert.equal(cfg.enabled, false);
});

test('turnstile config enables with fallback keys when turnstile_enabled=1', () => {
  setSetting('turnstile_enabled', '1');
  const cfg = getTurnstileConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.siteKey, '1x00000000000000000000AA');
  assert.equal(cfg.secretKey, '1x0000000000000000000000000000000AA');
});

test('turnstile rejects empty or missing response token', async () => {
  setSetting('turnstile_enabled', '1');
  const r1 = await verifyTurnstile('');
  assert.equal(r1.success, false);
  assert.ok(r1.errorCodes.includes('missing-input-response'));

  const r2 = await verifyTurnstile(null);
  assert.equal(r2.success, false);
});

test('turnstile passes with valid token using Cloudflare test keys', async () => {
  setSetting('turnstile_enabled', '1');
  // Cloudflare test secret key 1x00...AA accepts any token against siteverify
  const res = await verifyTurnstile('XXXX.TEST.TOKEN');
  assert.equal(res.success, true);
});

test('turnstile bypasses verification when disabled', async () => {
  setSetting('turnstile_enabled', '0');
  const res = await verifyTurnstile('');
  assert.equal(res.success, true);
});
