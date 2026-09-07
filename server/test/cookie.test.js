// Cookie 属性回归：SameSite 必须来自配置（P1 修复的根因回归测试）
// node --test 每个文件独立进程，可安全覆盖 env
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.COOKIE_SAMESITE = 'None';
process.env.COOKIE_SECURE = '1';
process.env.DATA_DIR = (await import('node:fs')).mkdtempSync((await import('node:os')).tmpdir() + '/2fa-hub-cookie-');
process.env.MASTER_KEY = 'a'.repeat(64);

const { cookieHeader } = await import('../src/routes/auth.js');

test('SameSite comes from config; None implies Secure', () => {
  const cookie = cookieHeader('tok', 60);
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=60/);
  assert.match(cookie, /^otk_session=tok/);
});
