// 导入导出：2fa-hub JSON / 纯文本 otpauth URI / 2FAS / Aegis(明文 JSON)
import { parseOtpauthUri, buildOtpauthUri } from '@shared/otpauth.js';

export function detectAndParse(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('空文件');
  let json = null;
  try { json = JSON.parse(trimmed); } catch { /* 不是 JSON，尝试纯文本 */ }

  if (json) {
    if (Array.isArray(json.entries)) return parseOtpocket(json.entries);
    if (Array.isArray(json.services)) return parse2fas(json);
    if (json.db?.entries) return parseAegis(json);
    if (Array.isArray(json)) return parseOtpocket(json);
    throw new Error('无法识别的 JSON 格式');
  }
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const uris = lines.filter((l) => /^otpauth:\/\//i.test(l));
  if (!uris.length) throw new Error('文件中未找到 otpauth:// 链接或可识别的 JSON');
  return uris.map((u) => ({ source: 'uri', ...parseOtpauthUri(u) }));
}

function parseOtpocket(list) {
  return list.map((e) => ({
    source: '2fa-hub',
    label: e.label || '', issuer: e.issuer || '', secret: e.secret,
    type: e.type || 'totp', algorithm: e.algorithm || 'SHA1',
    digits: e.digits || 6, period: e.period || 30, counter: e.counter || 0,
  }));
}

// 2FAS 导出：{ services: [{ name, otp: { account, token, digits, period, algorithm, otpType, counter } }] }
function parse2fas(json) {
  return json.services
    .filter((s) => s.otp?.token)
    .map((s) => ({
      source: '2fas',
      issuer: s.name || '', label: s.otp.account || '', secret: s.otp.token,
      type: String(s.otp.otpType || 'TOTP').toLowerCase().startsWith('hotp') ? 'hotp' : 'totp',
      algorithm: String(s.otp.algorithm || 'SHA1').toUpperCase().replace('-', ''),
      digits: Number(s.otp.digits) || 6, period: Number(s.otp.period) || 30,
      counter: Number(s.otp.counter) || 0,
    }));
}

// Aegis 明文导出：{ db: { entries: [{ type, uuid, name, issuer, info: { secret, algo, digits, period, counter } }] } }
function parseAegis(json) {
  return json.db.entries
    .filter((e) => e.info?.secret)
    .map((e) => ({
      source: 'aegis',
      issuer: e.issuer || '', label: e.name || '', secret: e.info.secret,
      type: String(e.type || 'totp').toLowerCase(),
      algorithm: String(e.info.algo || 'SHA1').toUpperCase().replace('-', ''),
      digits: Number(e.info.digits) || 6, period: Number(e.info.period) || 30,
      counter: Number(e.info.counter) || 0,
    }));
}

export function export2FaHubJson(entries) {
  return JSON.stringify({ app: '2fa-hub', version: 1, exported_at: new Date().toISOString(), entries }, null, 2);
}

export function exportOtpauthTxt(entries) {
  return entries.map(buildOtpauthUri).join('\n');
}

export function download(filename, content, mime = 'application/json') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
