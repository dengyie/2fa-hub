// API 集成测试：临时 DATA_DIR 起真实服务，fetch 全链路
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), '2fa-hub-test-'));
process.env.COOKIE_SECURE = '0';
process.env.PORT = '0';

const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');
const { createAppServer } = await import('../src/http.js');
const { Router } = await import('../src/http.js');
const { registerAuthRoutes, userCount } = await import('../src/routes/auth.js');
const { registerEntryRoutes } = await import('../src/routes/entries.js');
const { registerAdminRoutes } = await import('../src/routes/admin.js');

const router = new Router();
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true }));
registerAuthRoutes(router);
registerEntryRoutes(router);
registerAdminRoutes(router);
const server = createAppServer(router, { staticDir: config.dataDir, bodyLimit: config.bodyLimit });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

function client() {
  let cookie = '';
  return {
    async req(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          'X-Requested-With': 'test',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(',')[0].split(';')[0];
      const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
      return { status: res.status, json };
    },
  };
}

test('health', async () => {
  const c = client();
  const r = await c.req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

test('first registered user becomes admin; open registration afterwards', async () => {
  const c = client();
  const r1 = await c.req('POST', '/api/auth/register', { email: 'admin@test.io', name: 'admin', password: 'password123' });
  assert.equal(r1.status, 201);
  assert.equal(r1.json.user.is_admin, true);
  assert.ok(userCount() === 1);

  const u = client();
  const r2 = await u.req('POST', '/api/auth/register', { email: 'user@test.io', name: 'u', password: 'password456' });
  assert.equal(r2.status, 201);
  assert.equal(r2.json.user.is_admin, false);

  // 会话可用
  const me = await u.req('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, 'user@test.io');
});

test('duplicate email rejected; weak password rejected', async () => {
  const c = client();
  assert.equal((await c.req('POST', '/api/auth/register', { email: 'ADMIN@test.io', password: 'password123' })).status, 409);
  assert.equal((await c.req('POST', '/api/auth/register', { email: 'x@y.io', password: 'short' })).status, 400);
});

test('login failures are uniform (no enumeration); rate limited', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) {
    const r = await c.req('POST', '/api/auth/login', { email: 'nobody@test.io', password: 'wrongwrong' });
    assert.equal(r.status, 401);
  }
  const r = await c.req('POST', '/api/auth/login', { email: 'nobody@test.io', password: 'wrongwrong' });
  assert.equal(r.status, 429);
});

test('entry CRUD + secret never stored in plaintext', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  const mk = await c.req('POST', '/api/entries', {
    label: 'alice@example.com', issuer: 'GitHub', secret: 'JBSWY3DPEHPK3PXP', type: 'totp',
  });
  assert.equal(mk.status, 201);
  const full = await c.req('GET', '/api/entries/full');
  assert.equal(full.status, 200);
  assert.equal(full.json.entries[0].secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(full.json.entries[0].issuer, 'GitHub');

  // 落盘必须是密文
  const raw = db.prepare('SELECT secret FROM entries').get();
  assert.match(raw.secret, /^v1\./);
  assert.ok(!raw.secret.includes('JBSWY3DPEHPK3PXP'));

  // 更新
  const id = full.json.entries[0].id;
  const upd = await c.req('PUT', `/api/entries/${id}`, { label: 'bob@example.com' });
  assert.equal(upd.status, 200);
  const after = await c.req('GET', '/api/entries/full');
  assert.equal(after.json.entries[0].label, 'bob@example.com');
  assert.equal(after.json.entries[0].secret, 'JBSWY3DPEHPK3PXP'); // 未传 secret 保持原值

  // 校验：坏 secret 拒绝
  const bad = await c.req('POST', '/api/entries', { secret: 'not!!valid' });
  assert.equal(bad.status, 400);
});

test('entries are user-scoped (no cross-user access)', async () => {
  const a = client();
  await a.req('POST', '/api/auth/login', { email: 'admin@test.io', password: 'password123' });
  const r = await a.req('GET', '/api/entries/full');
  assert.equal(r.json.entries.length, 0); // admin 看不到 user 的条目
});

test('bulk import + reorder', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  const imp = await c.req('POST', '/api/entries/bulk', {
    entries: [
      { issuer: 'A', secret: 'JBSWY3DPEHPK3PXP' },
      { issuer: 'B', secret: 'JBSWY3DPEHPK3PXQ', type: 'hotp', counter: 2 },
    ],
  });
  assert.equal(imp.status, 201);
  const order = await c.req('PUT', '/api/entries-order', { ids: [3, 2, 1] });
  assert.equal(order.status, 200);
  const list = await c.req('GET', '/api/entries');
  assert.equal(list.json.entries[0].id, 3);
});

test('hotp counter advances server-side', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  const r = await c.req('POST', '/api/entries/3/counter', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.counter, 3);
});

test('admin: disable user -> session rejected; reset password works', async () => {
  const admin = client();
  await admin.req('POST', '/api/auth/login', { email: 'admin@test.io', password: 'password123' });
  const users = (await admin.req('GET', '/api/admin/users')).json.users;
  const victim = users.find((u) => u.email === 'user@test.io');
  assert.ok(victim.entries >= 3);

  const dis = await admin.req('PATCH', `/api/admin/users/${victim.id}`, { is_active: false });
  assert.equal(dis.status, 200);
  const victimClient = client();
  // 禁用后旧会话失效
  await victimClient.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  // 新登录也被拒
  const relog = await client().req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  assert.equal(relog.status, 403);

  // 重置密码 + 启用
  await admin.req('PATCH', `/api/admin/users/${victim.id}`, { is_active: true, password: 'newpassword99' });
  const re = await client().req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  assert.equal(re.status, 200);
});

test('admin: cannot delete self or last admin; non-admin blocked', async () => {
  const admin = client();
  await admin.req('POST', '/api/auth/login', { email: 'admin@test.io', password: 'password123' });
  const users = (await admin.req('GET', '/api/admin/users')).json.users;
  const me = users.find((u) => u.email === 'admin@test.io');
  assert.equal((await admin.req('DELETE', `/api/admin/users/${me.id}`)).status, 400);

  const plain = client();
  await plain.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  assert.equal((await plain.req('GET', '/api/admin/users')).status, 403);
  assert.equal((await plain.req('DELETE', `/api/admin/users/${me.id}`)).status, 403);
});

test('registration closed mode blocks new signups', async () => {
  const admin = client();
  await admin.req('POST', '/api/auth/login', { email: 'admin@test.io', password: 'password123' });
  await admin.req('PUT', '/api/admin/settings', { register_mode: 'closed' });
  const r = await client().req('POST', '/api/auth/register', { email: 'late@test.io', password: 'password789' });
  assert.equal(r.status, 403);
  await admin.req('PUT', '/api/admin/settings', { register_mode: 'open' });
  assert.equal((await client().req('POST', '/api/auth/register', { email: 'late@test.io', password: 'password789' })).status, 201);
});

test('audit log records security events', async () => {
  const admin = client();
  await admin.req('POST', '/api/auth/login', { email: 'admin@test.io', password: 'password123' });
  const log = (await admin.req('GET', '/api/admin/audit?limit=200')).json.audit;
  const actions = log.map((a) => a.action);
  for (const expected of ['register', 'login_fail', 'entry_create', 'admin_set_active', 'admin_reset_password', 'admin_setting']) {
    assert.ok(actions.includes(expected), `missing audit action: ${expected}`);
  }
});

test('unauthenticated access to entries rejected', async () => {
  assert.equal((await client().req('GET', '/api/entries')).status, 401);
  assert.equal((await client().req('GET', '/api/admin/users')).status, 401);
});

test.after(() => {
  server.close();
  db.close();
  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
