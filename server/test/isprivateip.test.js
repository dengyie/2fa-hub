// isPrivateIp 单元测试：X-Forwarded-For 链中可信跳判定的边界回归。
// 任何一段私有网段漏判 → 该段地址被当成客户端 IP → 限流 key 碎片化 + 审计误归属（伪造 XFF 绕过限流）。
import test from 'node:test';
import assert from 'node:assert/strict';

const { isPrivateIp, normalizeIp } = await import('../src/http.js');

test('isPrivateIp: loopback / RFC1918 / link-local / CGNAT / ULA / mapped', () => {
  const priv = [
    '127.0.0.1', '127.255.0.1', '10.1.2.3', '192.168.1.1', '169.254.9.9',
    '172.16.0.1', '172.20.0.5', '172.31.255.255',
    '100.64.0.1', '100.100.1.1', '100.127.255.255',
    '::1', 'localhost', 'fc00::1', 'fd12:3456::a', 'fe80::1', 'febF::9',
    '::ffff:127.0.0.1', '::ffff:10.0.0.9',
  ];
  for (const ip of priv) assert.ok(isPrivateIp(ip), `${ip} must be private`);
});

test('isPrivateIp: public addresses just outside every private range', () => {
  const pub = [
    '8.8.8.8', '1.2.3.4',
    '172.32.0.1', '172.15.255.255', // 172.16/12 的两侧边界
    '100.0.0.1', '100.128.0.1',     // 100.64/10 的两侧边界
    '2606:4700::1', '2001:db8::1',  // 公网 IPv6
    'fec0::1', 'fed0::1',           // 已废弃 site-local，不是链路本地
    'fe00::1', 'fe70::1',           // fe80::/10 之下
    'ff02::1',                      // 组播
  ];
  for (const ip of pub) assert.equal(isPrivateIp(ip), false, `${ip} must be public`);
});

test('isPrivateIp: malformed / hostile input must fail safe (public, not private)', () => {
  // 判定原则：只有确认为已知私有段才 true。畸形跳若被判私有会被跳过，
  // 攻击者注入的更左公网跳就会被当成客户端 IP（绕过限流、伪造审计）。
  const malformed = [
    '', '   ', '1234', '10',
    '999.1.1.1', '999.abc.1.1', '1.2.3.256',
    '172.16.0.1/32', '172.20.0.5/64', '10.0.0.1/8',        // 带 CIDR 后缀的伪造跳
    'fe8::1', 'fe7f::1',                                    // 0fe8 前缀公网段（短写陷阱）
    null, undefined,
  ];
  for (const ip of malformed) assert.equal(isPrivateIp(ip), false, `${String(ip)} must not be treated private`);
});

test('isPrivateIp: full fe80::/10 span and ULA, case-insensitive', () => {
  for (const ip of ['fe80::1', 'fe90::1', 'fea0::1', 'feb0::1', 'febf::1']) {
    assert.ok(isPrivateIp(ip), `${ip} in fe80::/10`);
  }
  for (const ip of ['FC00::1', 'FD00::1', 'FE80::1']) assert.ok(isPrivateIp(ip), `${ip} case-insensitive`);
  // 短写陷阱反例：fe8f 前缀确实在 /10 内，fe8 前缀（=0fe8）不在
  assert.ok(isPrivateIp('fe8f::1'));
  assert.equal(isPrivateIp('fe8::1'), false);
});

test('normalizeIp handles brackets, ports, and mapped IPv4', () => {
  assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeIp('1.2.3.4'), '1.2.3.4');
  assert.equal(normalizeIp('10.0.0.1:8080'), '10.0.0.1');
  assert.equal(normalizeIp('203.0.113.195:44321'), '203.0.113.195');
  assert.equal(normalizeIp('[fe80::1]'), 'fe80::1');
  assert.equal(normalizeIp('[fe80::1]:8080'), 'fe80::1');
  assert.equal(normalizeIp('[::ffff:10.0.0.1]:8080'), '10.0.0.1');
  assert.equal(normalizeIp('[2001:db8::1]:443'), '2001:db8::1');
});

test('isPrivateIp recognizes private hops even with ports or brackets', () => {
  assert.ok(isPrivateIp('10.0.0.1:8080'));
  assert.ok(isPrivateIp('192.168.1.1:3000'));
  assert.ok(isPrivateIp('[fe80::1]'));
  assert.ok(isPrivateIp('[fe80::1]:80'));
  assert.ok(isPrivateIp('[::ffff:127.0.0.1]:8080'));
  assert.equal(isPrivateIp('203.0.113.195:44321'), false);
  assert.equal(isPrivateIp('[2001:db8::1]:443'), false);
});
