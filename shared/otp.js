// TOTP (RFC 6238) / HOTP (RFC 4226) 生成 —— HMAC 走平台原生 crypto.subtle，
// 不自造密码学原语；正确性由 RFC 官方测试向量保证（见 server/test/otp.test.js）。
import { base32Decode } from './base32.js';

export const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512'];
// 存储层用短名 SHA1/SHA256/SHA512，WebCrypto 需要带连字符的标准名
const WEBCRYPT_ALG = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' };
export const DEFAULTS = { type: 'totp', algorithm: 'SHA1', digits: 6, period: 30, counter: 0 };

async function hmacSha(algorithm, keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength),
    { name: 'HMAC', hash: algorithm }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, message);
  return new Uint8Array(sig);
}

/** RFC 4226/6238 核心：HMAC(secret, counter) → Dynamic Truncation → 模 10^digits */
async function otpFromSecret(secret, counter, algorithm, digits) {
  const keyBytes = base32Decode(secret);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = await hmacSha(WEBCRYPT_ALG[algorithm] || 'SHA-1', keyBytes, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * entry: { secret, type: 'totp'|'hotp', algorithm, digits, period, counter }
 * 返回 { code, remaining, nextCode? }；remaining = 该码剩余秒数（hotp 为 null）
 */
export async function generateOtp(entry, now = Date.now()) {
  const algorithm = ALGORITHMS.includes((entry.algorithm || '').toUpperCase())
    ? entry.algorithm.toUpperCase() : 'SHA1';
  const digits = clampDigits(entry.digits);
  if (entry.type === 'hotp') {
    const counter = Number(entry.counter) || 0;
    const code = await otpFromSecret(entry.secret, counter, algorithm, digits);
    const nextCode = await otpFromSecret(entry.secret, counter + 1, algorithm, digits);
    return { code, remaining: null, nextCode };
  }
  const period = clampPeriod(entry.period);
  const counter = Math.floor(now / 1000 / period);
  const code = await otpFromSecret(entry.secret, counter, algorithm, digits);
  const nextCode = await otpFromSecret(entry.secret, counter + 1, algorithm, digits);
  const remaining = period - Math.floor(now / 1000) % period;
  return { code, remaining, nextCode };
}

export function clampDigits(d) {
  const n = Number(d) || 6;
  return Math.min(10, Math.max(6, Math.round(n)));
}
export function clampPeriod(p) {
  const n = Number(p) || 30;
  return Math.min(120, Math.max(7, Math.round(n)));
}
