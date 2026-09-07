// RFC 4226 / RFC 6238 官方测试向量 + Base32 + otpauth URI
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp } from '../../shared/otp.js';
import { base32Decode, base32Encode, normalizeBase32 } from '../../shared/base32.js';
import { parseOtpauthUri, buildOtpauthUri } from '../../shared/otpauth.js';

// RFC 6238 Appendix B 的三个 secret（ASCII "1234567890..." 的 base32，20/32/64 字节）
const enc = (s) => base32Encode(new TextEncoder().encode(s));
const SECRETS = {
  SHA1: enc('12345678901234567890'),
  SHA256: enc('12345678901234567890123456789012'),
  SHA512: enc('1234567890123456789012345678901234567890123456789012345678901234'),
};
const TOTP_VECTORS = [
  { time: 59, alg: 'SHA1', code: '94287082' },
  { time: 1111111109, alg: 'SHA1', code: '07081804' },
  { time: 1111111111, alg: 'SHA1', code: '14050471' },
  { time: 1234567890, alg: 'SHA1', code: '89005924' },
  { time: 2000000000, alg: 'SHA1', code: '69279037' },
  { time: 20000000000, alg: 'SHA1', code: '65353130' },
  { time: 59, alg: 'SHA256', code: '46119246' },
  { time: 1111111109, alg: 'SHA256', code: '68084774' },
  { time: 1111111111, alg: 'SHA256', code: '67062674' },
  { time: 1234567890, alg: 'SHA256', code: '91819424' },
  { time: 2000000000, alg: 'SHA256', code: '90698825' },
  { time: 20000000000, alg: 'SHA256', code: '77737706' },
  { time: 59, alg: 'SHA512', code: '90693936' },
  { time: 1111111109, alg: 'SHA512', code: '25091201' },
  { time: 1111111111, alg: 'SHA512', code: '99943326' },
  { time: 1234567890, alg: 'SHA512', code: '93441116' },
  { time: 2000000000, alg: 'SHA512', code: '38618901' },
  { time: 20000000000, alg: 'SHA512', code: '47863826' },
];

test('RFC 6238 official test vectors', async () => {
  for (const v of TOTP_VECTORS) {
    const { code } = await generateOtp({
      secret: SECRETS[v.alg], type: 'totp', algorithm: v.alg, digits: 8, period: 30,
    }, v.time * 1000);
    assert.equal(code, v.code, `${v.alg} @T=${v.time}`);
  }
});

test('RFC 4226 HOTP vectors (6 digits)', async () => {
  // RFC 4226 Appendix D，secret 为 20 字节 "12345678901234567890"
  const expected = ['755224', '287082', '359152', '969429', '338314',
    '254676', '287922', '162583', '399871', '520489'];
  for (let c = 0; c < expected.length; c++) {
    const { code } = await generateOtp({
      secret: SECRETS.SHA1, type: 'hotp', counter: c, digits: 6,
    });
    assert.equal(code, expected[c], `counter=${c}`);
  }
});

test('HOTP counter sync fields', async () => {
  const r = await generateOtp({ secret: SECRETS.SHA1, type: 'hotp', counter: 3 });
  assert.equal(r.remaining, null);
  assert.ok(/^\d{6}$/.test(r.code));
  assert.ok(/^\d{6}$/.test(r.nextCode));
});

test('base32 roundtrip and normalization', () => {
  const bytes = new Uint8Array(Array.from({ length: 32 }, (_, i) => i * 7 + 3));
  const enc = base32Encode(bytes);
  assert.deepEqual(base32Decode(enc), bytes);
  assert.equal(normalizeBase32('gezd gnbv'), 'GEZDGNBV');
  assert.throws(() => normalizeBase32('abc1!'), /invalid base32/);
});

test('otpauth uri parse/build roundtrip', () => {
  const uri = 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example';
  const e = parseOtpauthUri(uri);
  assert.equal(e.type, 'totp');
  assert.equal(e.issuer, 'Example');
  assert.equal(e.label, 'alice@example.com');
  assert.equal(e.secret, 'JBSWY3DPEHPK3PXP');
  const uri2 = buildOtpauthUri(e);
  const e2 = parseOtpauthUri(uri2);
  assert.deepEqual(e, e2);
});

test('otpauth hotp + non-default params', () => {
  const e = parseOtpauthUri('otpauth://hotp/x:y?secret=JBSWY3DPEHPK3PXP&counter=5&digits=8&algorithm=SHA256&period=60');
  assert.equal(e.type, 'hotp');
  assert.equal(e.counter, 5);
  assert.equal(e.digits, 8);
  assert.equal(e.algorithm, 'SHA256');
  assert.throws(() => parseOtpauthUri('https://example.com'), /otpauth/);
});
