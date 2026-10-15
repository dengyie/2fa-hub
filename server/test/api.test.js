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
const { registerApiKeyRoutes } = await import('../src/routes/api-keys.js');
const { registerApiV1Routes } = await import('../src/routes/api-v1.js');

const router = new Router();
router.get('/api/health', async (ctx) => ctx.json(200, { ok: true }));
registerAuthRoutes(router);
registerEntryRoutes(router);
registerAdminRoutes(router);
registerApiKeyRoutes(router);
registerApiV1Routes(router);
const server = createAppServer(router, { staticDir: config.dataDir, bodyLimit: config.bodyLimit });
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

function client() {
  let cookie = '';
  return {
    async req(method, path, body, { omitCsrfHeader = false } = {}) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(omitCsrfHeader ? {} : { 'X-Requested-With': 'test' }),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(',')[0].split(';')[0];
      const json = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
      return { status: res.status, json, setCookie };
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

test('per-IP login spray limit: distinct accounts from one IP get blocked', async () => {
  // 密码喷洒闸：同一 IP 换着账号试，30 次后必须 429（不受 per-account 桶影响）
  const c = client();
  let sprayed = 429;
  for (let i = 0; i < 40; i++) {
    const r = await c.req('POST', '/api/auth/login', { email: `spray${i}@test.io`, password: 'wrongwrong' });
    if (r.status === 429) { sprayed = i; break; }
  }
  assert.ok(sprayed <= 30, `per-IP bucket should trip within 30 attempts, tripped at ${sprayed}`);
  // 测试共享 127.0.0.1，必须清掉 per-IP 桶，否则后续用例的登录全被本闸 429
  const { reset } = await import('../src/limiter.js');
  reset('login-ip:127.0.0.1');
});

test('successful login does not reset the per-IP spray bucket', async () => {
  // 根因回归：持有效凭证者借成功登录清零总闸 = 无限喷洒。29 次失败 + 1 次成功后，
  // 第 30 次失败必须仍触发 429（login-ip 桶只随 5min 窗口过期，不被成功登录重置）
  const { reset } = await import('../src/limiter.js');
  reset('login:127.0.0.1:victim@test.io');
  reset('login-ip:127.0.0.1');
  const c = client();
  for (let i = 0; i < 29; i++) {
    const r = await c.req('POST', '/api/auth/login', { email: 'victim@test.io', password: 'wrongwrong' });
    assert.ok([401, 429].includes(r.status), `fail #${i} must not 500`);
  }
  // 穿插一次成功登录（真实账号 user@test.io）
  const ok = await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  assert.equal(ok.status, 200);
  // 但成功前那次 allow 已把 login-ip 计到 30 —— 第 30 次失败会被 429 挡住
  const r30 = await c.req('POST', '/api/auth/login', { email: 'victim@test.io', password: 'wrongwrong' });
  assert.equal(r30.status, 429, 'per-IP bucket must survive a successful login');
  reset('login:127.0.0.1:victim@test.io');
  reset('login-ip:127.0.0.1');
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
  const list = await c.req('GET', '/api/entries/full');
  assert.equal(list.json.entries[0].id, 3);
  // 垃圾 id 拒绝
  assert.equal((await c.req('PUT', '/api/entries-order', { ids: ['abc'] })).status, 400);
  assert.equal((await c.req('PUT', '/api/entries-order', { ids: [] })).status, 400);
});

test('CSRF: mutating requests without X-Requested-With are rejected', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  const noHeader = await c.req('POST', '/api/entries/3/counter', {}, { omitCsrfHeader: true });
  assert.equal(noHeader.status, 403);
  const delNoHeader = await c.req('DELETE', '/api/entries/3', undefined, { omitCsrfHeader: true });
  assert.equal(delNoHeader.status, 403);
  // GET 不需要该头
  assert.equal((await c.req('GET', '/api/entries/full', undefined, { omitCsrfHeader: true })).status, 200);
});

test('hotp counter advances server-side', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  const r = await c.req('POST', '/api/entries/3/counter', {});
  assert.equal(r.status, 200);
  assert.equal(r.json.counter, 3);
});

test('corrupted ciphertext is isolated, not fatal for whole vault', async () => {
  const c = client();
  await c.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'password456' });
  // 直接把一条密文写坏（模拟坏备份恢复 / MASTER_KEY 变更）
  db.prepare('UPDATE entries SET secret = ? WHERE id = 3').run('v1.AAA.AAA.AAA');
  const r = await c.req('GET', '/api/entries/full');
  assert.equal(r.status, 200);
  const broken = r.json.entries.find((e) => e.id === 3);
  const good = r.json.entries.find((e) => e.id === 1);
  assert.equal(broken.decrypt_error, true);
  assert.equal(broken.secret, null);
  assert.equal(good.secret, 'JBSWY3DPEHPK3PXP'); // 其余条目不受影响
  // 损坏条目仍可删除（自愈路径）；补一条等价条目保持后续测试的条目数
  assert.equal((await c.req('DELETE', '/api/entries/3')).status, 200);
  await c.req('POST', '/api/entries/bulk', {
    entries: [{ issuer: 'B', secret: 'JBSWY3DPEHPK3PXQ', type: 'hotp', counter: 3 }],
  });
  const after = await c.req('GET', '/api/entries/full');
  assert.equal(after.json.entries.some((e) => e.decrypt_error), false);
});

test('change-password invalidates old sessions', async () => {
  const c = client();
  const reg = await c.req('POST', '/api/auth/register', { email: 'cp@test.io', password: 'password789' });
  assert.equal(reg.status, 201);
  // 旧密码校验失败拒绝
  assert.equal((await c.req('POST', '/api/auth/change-password', { current: 'wrongwrong', next: 'password999' })).status, 401);
  // 独立客户端持旧会话；主客户端改密后旧会话必须失效
  const victim = client();
  await victim.req('POST', '/api/auth/login', { email: 'cp@test.io', password: 'password789' });
  assert.equal((await c.req('POST', '/api/auth/change-password', { current: 'password789', next: 'password999' })).status, 200);
  assert.equal((await victim.req('GET', '/api/me')).status, 401);
  // 新密码可登录、旧密码被拒
  assert.equal((await client().req('POST', '/api/auth/login', { email: 'cp@test.io', password: 'password999' })).status, 200);
  assert.equal((await client().req('POST', '/api/auth/login', { email: 'cp@test.io', password: 'password789' })).status, 401);
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
  assert.equal((await client().req('GET', '/api/entries/full')).status, 401);
  assert.equal((await client().req('GET', '/api/admin/users')).status, 401);
});

test('scoped API keys provide code, read, and manage tiers without secret reads', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const full = await user.req('GET', '/api/entries/full');
  const entryId = full.json.entries.find((e) => e.type === 'totp').id;
  const hotpId = full.json.entries.find((e) => e.type === 'hotp').id;

  const codeKeyRes = await user.req('POST', '/api/keys', { name: 'agent code', tier: 'code', entry_ids: [entryId] });
  assert.equal(codeKeyRes.status, 201);
  assert.match(codeKeyRes.json.value, /^2fh_live_/);
  assert.equal(db.prepare('SELECT key_hash FROM api_keys WHERE id = ?').get(codeKeyRes.json.key.id).key_hash.includes(codeKeyRes.json.value), false);
  const codeHeaders = { Authorization: `Bearer ${codeKeyRes.json.value}` };
  const codeRes = await fetch(base + `/api/v1/entries/${entryId}/code`, { headers: codeHeaders });
  assert.equal(codeRes.status, 200);
  const codeJson = await codeRes.json();
  assert.match(codeJson.code, /^\d{6}$/);
  assert.equal(codeRes.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(base + '/api/v1/entries', { headers: codeHeaders })).status, 403);
  assert.equal((await fetch(base + `/api/v1/entries/${entryId}`, { headers: codeHeaders })).status, 403);

  // Browser session cookies cannot be used to cross the machine API boundary.
  assert.equal((await user.req('GET', `/api/v1/entries/${entryId}/code`)).status, 401);

  const readKeyRes = await user.req('POST', '/api/keys', { name: 'agent read', tier: 'read', entry_ids: null });
  assert.equal(readKeyRes.status, 201);
  const readHeaders = { Authorization: `Bearer ${readKeyRes.json.value}` };
  const listRes = await fetch(base + '/api/v1/entries', { headers: readHeaders });
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.ok(listJson.entries.length >= 1);
  assert.equal(Object.hasOwn(listJson.entries[0], 'secret'), false);
  const detailRes = await fetch(base + `/api/v1/entries/${entryId}`, { headers: readHeaders });
  assert.equal(detailRes.status, 200);
  assert.equal(Object.hasOwn((await detailRes.json()).entry, 'secret'), false);

  const hotpKeyRes = await user.req('POST', '/api/keys', { name: 'agent HOTP', tier: 'code', entry_ids: [hotpId] });
  const hotpBefore = db.prepare('SELECT counter FROM entries WHERE id = ?').get(hotpId).counter;
  const hotpRes = await fetch(base + `/api/v1/entries/${hotpId}/code`, {
    headers: { Authorization: `Bearer ${hotpKeyRes.json.value}` },
  });
  assert.equal(hotpRes.status, 200);
  const hotpJson = await hotpRes.json();
  assert.equal(hotpJson.type, 'hotp');
  assert.equal(hotpJson.counter, hotpBefore);
  assert.equal(db.prepare('SELECT counter FROM entries WHERE id = ?').get(hotpId).counter, hotpBefore + 1);

  const manageKeyRes = await user.req('POST', '/api/keys', { name: 'agent manage', tier: 'manage', entry_ids: null });
  assert.equal(manageKeyRes.status, 201);
  const manageHeaders = {
    Authorization: `Bearer ${manageKeyRes.json.value}`,
    'Content-Type': 'application/json',
  };
  const createRes = await fetch(base + '/api/v1/entries', {
    method: 'POST', headers: manageHeaders,
    body: JSON.stringify({ issuer: 'API', label: 'agent', secret: 'JBSWY3DPEHPK3PXP' }),
  });
  assert.equal(createRes.status, 201);
  const createdId = (await createRes.json()).id;
  const updateRes = await fetch(base + `/api/v1/entries/${createdId}`, {
    method: 'PUT', headers: manageHeaders,
    body: JSON.stringify({ label: 'agent-updated' }),
  });
  assert.equal(updateRes.status, 200);
  assert.equal((await fetch(base + `/api/v1/entries/${createdId}`, { method: 'DELETE', headers: manageHeaders })).status, 200);

  assert.equal((await user.req('DELETE', `/api/keys/${codeKeyRes.json.key.id}`)).status, 200);
  assert.equal((await fetch(base + `/api/v1/entries/${entryId}/code`, { headers: codeHeaders })).status, 401);
});

test('HOTP code claim does not mix an old secret with a concurrently updated entry', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const full = await user.req('GET', '/api/entries/full');
  const entry = full.json.entries.find((e) => e.type === 'hotp');
  const keyRes = await user.req('POST', '/api/keys', { name: 'race-test', tier: 'code', entry_ids: [entry.id] });
  const headers = { Authorization: `Bearer ${keyRes.json.value}` };
  const before = db.prepare('SELECT * FROM entries WHERE id = ?').get(entry.id);
  const newSecret = 'MFRGGZDFMZTWQ2LK';
  const originalSign = crypto.subtle.sign;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  let release;
  const releasePromise = new Promise((resolve) => { release = resolve; });
  let held = true;
  crypto.subtle.sign = async (...args) => {
    if (held) {
      held = false;
      entered();
      await releasePromise;
    }
    return originalSign.call(crypto.subtle, ...args);
  };
  try {
    const pending = fetch(base + `/api/v1/entries/${entry.id}/code`, { headers });
    await enteredPromise;
    const update = await user.req('PUT', `/api/entries/${entry.id}`, {
      secret: newSecret, type: 'hotp', counter: before.counter,
    });
    assert.equal(update.status, 200);
    release();
    const response = await pending;
    assert.equal(response.status, 200);
    const payload = await response.json();
    const expected = await (await import('../../shared/otp.js')).generateOtp({
      secret: newSecret, type: 'hotp', algorithm: before.algorithm,
      digits: before.digits, counter: before.counter,
    });
    assert.equal(payload.code, expected.code);
    assert.equal(payload.counter, before.counter);
    assert.equal(db.prepare('SELECT counter FROM entries WHERE id = ?').get(entry.id).counter, before.counter + 1);
  } finally {
    release();
    crypto.subtle.sign = originalSign;
  }
});

test('API key and entry mutations roll back when their audit write fails', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const userId = db.prepare('SELECT id FROM users WHERE email = ?').get('user@test.io').id;
  const activeKeysBefore = db.prepare(
    'SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL',
  ).get(userId).n;

  db.exec(`CREATE TRIGGER fail_api_key_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'api_key_create' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  try {
    const failedKey = await user.req('POST', '/api/keys', { name: 'audit-failure', tier: 'read', entry_ids: null });
    assert.equal(failedKey.status, 500);
    assert.equal(db.prepare(
      'SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL',
    ).get(userId).n, activeKeysBefore);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_api_key_audit');
  }

  const full = await user.req('GET', '/api/entries/full');
  const existingEntry = full.json.entries.find((entry) => entry.type === 'totp');
  const keyRes = await user.req('POST', '/api/keys', {
    name: 'entry-audit-failure', tier: 'manage', entry_ids: [existingEntry.id],
  });
  const entryCountBefore = db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id = ?').get(userId).n;
  const scopeBefore = db.prepare('SELECT entry_ids FROM api_keys WHERE id = ?').get(keyRes.json.key.id).entry_ids;
  db.exec(`CREATE TRIGGER fail_api_entry_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'api_entry_create' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  try {
    const failedEntry = await fetch(base + '/api/v1/entries', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${keyRes.json.value}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ label: 'rolled back', secret: 'JBSWY3DPEHPK3PXP' }),
    });
    assert.equal(failedEntry.status, 500);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entries WHERE user_id = ?').get(userId).n, entryCountBefore);
    assert.equal(db.prepare('SELECT entry_ids FROM api_keys WHERE id = ?').get(keyRes.json.key.id).entry_ids, scopeBefore);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_api_entry_audit');
    db.prepare('UPDATE api_keys SET revoked_at = datetime(\'now\') WHERE id = ?').run(keyRes.json.key.id);
  }
});

test('HOTP claims, entry edits, and key revocations roll back when audit writes fail', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const full = await user.req('GET', '/api/entries/full');
  const hotp = full.json.entries.find((entry) => entry.type === 'hotp');
  const totp = full.json.entries.find((entry) => entry.type === 'totp');
  const codeKey = await user.req('POST', '/api/keys', {
    name: 'code-audit-failure', tier: 'code', entry_ids: [hotp.id],
  });
  const beforeCounter = db.prepare('SELECT counter FROM entries WHERE id = ?').get(hotp.id).counter;
  db.exec(`CREATE TRIGGER fail_api_code_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'api_code' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  try {
    const response = await fetch(base + `/api/v1/entries/${hotp.id}/code`, {
      headers: { Authorization: `Bearer ${codeKey.json.value}` },
    });
    assert.equal(response.status, 500);
    assert.equal(db.prepare('SELECT counter FROM entries WHERE id = ?').get(hotp.id).counter, beforeCounter);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_api_code_audit');
  }

  const manageKey = await user.req('POST', '/api/keys', {
    name: 'edit-audit-failure', tier: 'manage', entry_ids: [totp.id],
  });
  const headers = { Authorization: `Bearer ${manageKey.json.value}`, 'Content-Type': 'application/json' };
  db.exec(`CREATE TRIGGER fail_api_entry_update_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'api_entry_update' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  try {
    const response = await fetch(base + `/api/v1/entries/${totp.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ label: 'must roll back' }),
    });
    assert.equal(response.status, 500);
    assert.equal(db.prepare('SELECT label FROM entries WHERE id = ?').get(totp.id).label, totp.label);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_api_entry_update_audit');
  }

  db.exec(`CREATE TRIGGER fail_api_entry_delete_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'api_entry_delete' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  try {
    const response = await fetch(base + `/api/v1/entries/${totp.id}`, { method: 'DELETE', headers });
    assert.equal(response.status, 500);
    assert.ok(db.prepare('SELECT id FROM entries WHERE id = ?').get(totp.id));
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_api_entry_delete_audit');
  }

  const revokeKey = await user.req('POST', '/api/keys', {
    name: 'revoke-audit-failure', tier: 'read', entry_ids: null,
  });
  db.exec(`CREATE TRIGGER fail_api_key_revoke_audit BEFORE INSERT ON audit
    WHEN NEW.action = 'api_key_revoke' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END`);
  try {
    const response = await user.req('DELETE', `/api/keys/${revokeKey.json.key.id}`);
    assert.equal(response.status, 500);
    assert.equal(db.prepare('SELECT revoked_at FROM api_keys WHERE id = ?').get(revokeKey.json.key.id).revoked_at, null);
  } finally {
    db.exec('DROP TRIGGER IF EXISTS fail_api_key_revoke_audit');
    await user.req('DELETE', `/api/keys/${revokeKey.json.key.id}`);
    await user.req('DELETE', `/api/keys/${manageKey.json.key.id}`);
    await user.req('DELETE', `/api/keys/${codeKey.json.key.id}`);
  }
});

test('HEAD and unsafe HOTP counters do not consume a code counter', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const full = await user.req('GET', '/api/entries/full');
  const entry = full.json.entries.find((e) => e.type === 'hotp');
  const keyRes = await user.req('POST', '/api/keys', { name: 'head-boundary', tier: 'code', entry_ids: [entry.id] });
  const headers = { Authorization: `Bearer ${keyRes.json.value}` };

  const initialCounter = db.prepare('SELECT counter FROM entries WHERE id = ?').get(entry.id).counter;
  const head = await fetch(base + `/api/v1/entries/${entry.id}/code`, { method: 'HEAD', headers });
  assert.equal(head.status, 405);
  assert.equal(db.prepare('SELECT counter FROM entries WHERE id = ?').get(entry.id).counter, initialCounter);

  const limit = Number.MAX_SAFE_INTEGER;
  db.prepare('UPDATE entries SET counter = ? WHERE id = ?').run(limit, entry.id);
  const exhausted = await fetch(base + `/api/v1/entries/${entry.id}/code`, { headers });
  assert.equal(exhausted.status, 409);
  assert.equal(db.prepare('SELECT counter FROM entries WHERE id = ?').get(entry.id).counter, limit);

  db.prepare('UPDATE entries SET counter = ? WHERE id = ?').run(limit - 1, entry.id);
  const finalSafe = await fetch(base + `/api/v1/entries/${entry.id}/code`, { headers });
  assert.equal(finalSafe.status, 200);
  assert.equal(db.prepare('SELECT counter FROM entries WHERE id = ?').get(entry.id).counter, limit);
  assert.equal((await fetch(base + `/api/v1/entries/${entry.id}/code`, { headers })).status, 409);
});

test('Machine API rejects invalid entry fields instead of silently coercing them', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const full = await user.req('GET', '/api/entries/full');
  const entry = full.json.entries.find((e) => e.type === 'hotp');
  const keyRes = await user.req('POST', '/api/keys', { name: 'strict-test', tier: 'manage', entry_ids: [entry.id] });
  const headers = { Authorization: `Bearer ${keyRes.json.value}`, 'Content-Type': 'application/json' };
  const cases = [
    null, {}, { type: 'HOTP' }, { algorithm: 'MD5' }, { digits: 'oops' },
    { period: 1 }, { counter: -1 }, { counter: Number.MAX_SAFE_INTEGER },
    { ignored: true },
  ];
  for (const body of cases) {
    const response = await fetch(base + `/api/v1/entries/${entry.id}`, {
      method: 'PUT', headers, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const after = db.prepare('SELECT type, algorithm, digits, period, counter FROM entries WHERE id = ?').get(entry.id);
  assert.equal(after.type, 'hotp');
  assert.equal(after.algorithm, entry.algorithm);
  assert.equal(after.digits, entry.digits);
  assert.equal(after.period, entry.period);
  assert.equal(after.counter, entry.counter);

  const createCases = [
    null, { secret: 'JBSWY3DPEHPK3PXP', type: 'HOTP' },
    { secret: 'JBSWY3DPEHPK3PXP', algorithm: 'sha1' },
    { secret: 'JBSWY3DPEHPK3PXP', digits: '6' },
    { secret: 'JBSWY3DPEHPK3PXP', period: 6 },
    { secret: 'JBSWY3DPEHPK3PXP', counter: -1 },
    { secret: 'JBSWY3DPEHPK3PXP', counter: Number.MAX_SAFE_INTEGER },
  ];
  for (const body of createCases) {
    const response = await fetch(base + '/api/v1/entries', {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test('invalid Machine API keys do not consume valid-key quota and limits return 429', async () => {
  const { reset } = await import('../src/limiter.js');
  reset('api-v1-invalid-auth:127.0.0.1');
  reset('api-v1-ip:127.0.0.1');
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  const full = await user.req('GET', '/api/entries/full');
  const entryId = full.json.entries.find((e) => e.type === 'totp').id;
  const keyRes = await user.req('POST', '/api/keys', { name: 'quota-test', tier: 'read', entry_ids: null });
  const headers = { Authorization: `Bearer ${keyRes.json.value}` };
  const invalid = `2fh_live_00000000-0000-0000-0000-000000000000_${'a'.repeat(43)}`;
  for (let i = 0; i < 120; i++) {
    const response = await fetch(base + '/api/v1/entries', { headers: { Authorization: `Bearer ${invalid}` } });
    assert.equal(response.status, 401);
  }
  assert.equal((await fetch(base + '/api/v1/entries', {
    headers: { Authorization: `Bearer ${invalid}` },
  })).status, 429);
  const valid = await fetch(base + `/api/v1/entries/${entryId}`, { headers });
  assert.equal(valid.status, 200);

  reset('api-v1-ip:127.0.0.1');
  reset(`api-v1-key:${keyRes.json.key.id}`);
  for (let i = 0; i < 120; i++) {
    const response = await fetch(base + `/api/v1/entries/${entryId}`, { headers });
    assert.equal(response.status, 200);
  }
  const limited = await fetch(base + `/api/v1/entries/${entryId}`, { headers });
  assert.equal(limited.status, 429);
  reset('api-v1-ip:127.0.0.1');
  reset(`api-v1-key:${keyRes.json.key.id}`);
  reset('api-v1-invalid-auth:127.0.0.1');
});

test('Machine API enforces owner state, CORS preflight, and active-key cap', async () => {
  const user = client();
  await user.req('POST', '/api/auth/login', { email: 'user@test.io', password: 'newpassword99' });
  db.prepare(`UPDATE api_keys SET revoked_at = datetime('now')
    WHERE user_id = (SELECT id FROM users WHERE email = ?) AND revoked_at IS NULL`).run('user@test.io');
  const full = await user.req('GET', '/api/entries/full');
  const entryId = full.json.entries.find((e) => e.type === 'totp').id;
  const first = await user.req('POST', '/api/keys', { name: 'cap-0', tier: 'code', entry_ids: [entryId] });
  const preflight = await fetch(base + '/api/v1/entries', {
    method: 'OPTIONS', headers: { Origin: 'https://agent.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  const concurrentCreates = await Promise.all(Array.from({ length: 19 }, (_, index) =>
    user.req('POST', '/api/keys', { name: `cap-${index + 1}`, tier: 'code', entry_ids: [entryId] })));
  assert.ok(concurrentCreates.every((response) => response.status === 201));
  assert.equal((await user.req('POST', '/api/keys', { name: 'cap-over', tier: 'code', entry_ids: [entryId] })).status, 400);
  const row = db.prepare('SELECT user_id FROM api_keys WHERE id = ?').get(first.json.key.id);
  try {
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(row.user_id);
    const inactive = await fetch(base + `/api/v1/entries/${entryId}/code`, { headers: { Authorization: `Bearer ${first.json.value}` } });
    assert.equal(inactive.status, 401);
  } finally {
    db.prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(row.user_id);
    db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL").run(row.user_id);
  }
});

test.after(() => {
  server.close();
  db.close();
  rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
