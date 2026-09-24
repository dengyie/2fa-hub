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
  assert.equal(cfg.warning, '');
});

test('enabled but unconfigured → fail-closed (no silent CF test-key downgrade)', () => {
  setSetting('turnstile_enabled', '1');
  const cfg = getTurnstileConfig();
  // 关键回归：绝不能回填「始终通过」测试钥造成假启用
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.secretKey, '');
  assert.ok(cfg.warning, 'must carry an operator-visible warning');
  // verifyTurnstile 跟随 enabled=false：不挡用户（在管理 UI 修好密钥前不误伤注册）
  // 但警告必须存在，防止管理员误以为有防护
});

test('enabled with explicit CF test keys works end-to-end (opt-in only)', async () => {
  // 管理员显式填入测试钥 = 自愿选择，行为不变；此用例依赖真实 Cloudflare 端点
  setSetting('turnstile_sitekey', '1x00000000000000000000AA');
  setSetting('turnstile_secretkey', '1x0000000000000000000000000000000AA');
  const cfg = getTurnstileConfig();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.warning, '');
  const res = await verifyTurnstile('XXXX.TEST.TOKEN');
  assert.equal(res.success, true);
});

test('turnstile rejects empty or missing response token when enabled', async () => {
  const r1 = await verifyTurnstile('');
  assert.equal(r1.success, false);
  assert.ok(r1.errorCodes.includes('missing-input-response'));

  const r2 = await verifyTurnstile(null);
  assert.equal(r2.success, false);
});

test('turnstile bypasses verification when disabled', async () => {
  setSetting('turnstile_enabled', '0');
  const res = await verifyTurnstile('');
  assert.equal(res.success, true);
});
