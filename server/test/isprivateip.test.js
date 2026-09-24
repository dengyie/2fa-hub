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
    'fec0::1', 'ff02::1',           // 已废弃 site-local 与组播，不是内网跳
  ];
  for (const ip of pub) assert.equal(isPrivateIp(ip), false, `${ip} must be public`);
});

test('normalizeIp strips IPv4-mapped prefix only', () => {
  assert.equal(normalizeIp('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8::1');
  assert.equal(normalizeIp('1.2.3.4'), '1.2.3.4');
});
