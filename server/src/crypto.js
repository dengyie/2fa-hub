// 服务端密码学：AES-256-GCM 落盘加密、scrypt 口令哈希、HMAC 签名会话令牌。
// 全部基于 node:crypto 原语，不引入第三方依赖，不自造算法。
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

const master = Buffer.from(config.masterKey, 'hex');

// 密钥分离：落盘加密与会话签名用不同子密钥（HKDF）
const encKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), '2fa-hub/enc/v1', 32));
const sessionKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), '2fa-hub/session/v1', 32));

/** AES-256-GCM 加密 → "v1.<iv>.<ct>.<tag>"（base64url） */
export function encryptSecret(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
}

export function decryptSecret(stored) {
  const [v, iv, ct, tag] = String(stored).split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** scrypt(N=2^15) 口令哈希 → "scrypt$32768$8$1$<salt>$<hash>"（hex） */
export function hashPassword(password) {
  const N = 32768, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** 签名会话令牌：<payload b64url>.<hmac b64url>（JWT 的最小子集） */
export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', sessionKey).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', sessionKey).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.uid || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionExpiry() {
  return Date.now() + config.tokenTtlDays * 86400_000;
}
