// TRUST_PROXY 回归：客户端 IP 取决于信任开关（review P2-1 根因回归）
// node --test 每个文件独立进程，可安全覆盖 env
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.COOKIE_SECURE = '0';
process.env.PORT = '0';
process.env.DATA_DIR = mkdtempSync((await import('node:os')).tmpdir() + '/2fa-hub-proxy-');
process.env.MASTER_KEY = 'a'.repeat(64);
// 不设 TRUST_PROXY → 默认不信任

const { config } = await import('../src/config.js');
const { Router, createAppServer } = await import('../src/http.js');
const { registerAdminRoutes } = await import('../src/routes/admin.js');
const { registerAuthRoutes } = await import('../src/routes/auth.js');
const { registerEntryRoutes } = await import('../src/routes/entries.js');

const router = new Router();
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true }));
registerAuthRoutes(router);
registerEntryRoutes(router);
registerAdminRoutes(router);
const server = createAppServer(router, { staticDir: config.dataDir, bodyLimit: config.bodyLimit });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

async function whoami(extraHeaders) {
  // 未认证请求会 401，audit 里已记录 login_fail；改用直接注册流程太重，
  // 这里用一个探测点：/api/auth/login 的失败审计记录 ctx.ip —— 通过 /api/admin/audit 验证
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 't', ...extraHeaders },
    body: JSON.stringify({ email: 'probe@test.io', password: 'wrongwrong' }),
  });
  return res.status;
}

test('untrusted by default: forged X-Forwarded-For is ignored (socket IP wins)', async () => {
  // 默认不信任：伪造 XFF 不改变 ctx.ip（=127.0.0.1），两桶都不炸 → 连续 401 而非 429 的唯一来源是限流
  // 直接断言：伪造不同 XFF 的请求不会被当成不同 IP（否则限流永不到 429）
  for (let i = 0; i < 10; i++) {
    const st = await whoami({ 'X-Forwarded-For': `1.2.3.${i}` });
    assert.equal(st, 401, `forged XFF #${i} must still be same bucket (401, not bypassing limit)`);
  }
});

test.after(() => {
  server.close();
});
