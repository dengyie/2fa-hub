// otpauth:// URI 解析与生成（RFC/Google Authenticator key URI format）
import { DEFAULTS, clampDigits, clampPeriod, ALGORITHMS } from './otp.js';
import { normalizeBase32 } from './base32.js';

/** 解析 otpauth:// URI → entry 字段对象；非 otpauth URI 抛错 */
export function parseOtpauthUri(uri) {
  let u;
  try { u = new URL(String(uri).trim()); } catch { throw new Error('invalid uri'); }
  if (u.protocol !== 'otpauth:') throw new Error('not an otpauth uri');
  // host 即 type（totp/hotp）
  const type = (u.host || u.pathname.replace('//', '').split('/')[0] || '').toLowerCase();
  if (!['totp', 'hotp'].includes(type)) throw new Error(`unsupported otp type: ${type}`);
  // label = /issuer:account 或 /account，可能有编码
  const label = decodeURIComponent(u.pathname.replace(/^\/+/, '')).trim();
  let issuer = u.searchParams.get('issuer') || '';
  let account = label;
  if (label.includes(':')) {
    const [maybeIssuer, ...rest] = label.split(':');
    if (!issuer || maybeIssuer.trim() === issuer) {
      issuer = maybeIssuer.trim();
      account = rest.join(':').trim();
    }
  }
  const secret = normalizeBase32(u.searchParams.get('secret') || '');
  const entry = {
    type,
    secret,
    label: account || '',
    issuer: issuer || '',
    algorithm: (u.searchParams.get('algorithm') || DEFAULTS.algorithm).toUpperCase(),
    digits: clampDigits(u.searchParams.get('digits') || DEFAULTS.digits),
    period: clampPeriod(u.searchParams.get('period') || DEFAULTS.period),
    counter: Number(u.searchParams.get('counter') || 0) || 0,
  };
  if (!ALGORITHMS.includes(entry.algorithm)) entry.algorithm = 'SHA1';
  return entry;
}

export function isOtpauthUri(s) {
  return /^otpauth:\/\//i.test(String(s || '').trim());
}

/** entry → otpauth:// URI */
export function buildOtpauthUri(entry) {
  const label = entry.issuer
    ? `${entry.issuer}:${entry.label || ''}`
    : (entry.label || '');
  const params = new URLSearchParams();
  params.set('secret', entry.secret);
  if (entry.issuer) params.set('issuer', entry.issuer);
  if (entry.algorithm && entry.algorithm.toUpperCase() !== 'SHA1') params.set('algorithm', entry.algorithm.toUpperCase());
  if (clampDigits(entry.digits) !== 6) params.set('digits', String(clampDigits(entry.digits)));
  if (entry.type === 'hotp') {
    params.set('counter', String(Number(entry.counter) || 0));
  } else if (clampPeriod(entry.period) !== 30) {
    params.set('period', String(clampPeriod(entry.period)));
  }
  return `otpauth://${entry.type}/${encodeURIComponent(label)}?${params.toString()}`;
}
