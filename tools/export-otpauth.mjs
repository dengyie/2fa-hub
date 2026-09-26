// 导出 2fa-hub 的 2FA 条目为 otpauth:// 明文（用于 Obsidian 备份等）。
// 在持有主密钥的环境（生产容器 / 统一 DATA_DIR）中执行：
//   node tools/export-otpauth.mjs [--out 文件] [--user 用户名或邮箱]
// 默认打印到 stdout；--out 写文件（otpauth 每行一条，可直接扫码/粘贴导入 2FA 应用）。
// 复用 服务端已验证的 HKDF + AES-256-GCM 解密原语，确保与线上密钥完全一致。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createDecipheriv, hkdfSync } from 'node:crypto';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const dbFile = path.join(DATA_DIR, '2fa-hub.db');

// 与 server/src/config.js 一致：优先 env MASTER_KEY，否则读 DATA_DIR/.master_key
function loadMasterKey() {
  const fromEnv = process.env.MASTER_KEY && process.env.MASTER_KEY.trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error('MASTER_KEY 必须是 64 位 hex');
    return fromEnv;
  }
  try {
    return readFileSync(path.join(DATA_DIR, '.master_key'), 'utf8').trim();
  } catch (e) {
    throw new Error(`无法读取主密钥（${DATA_DIR}/.master_key 缺失），请设置 MASTER_KEY 或提供该文件`);
  }
}

// 与 server/src/crypto.js 相同的密钥派生（HKDF-SHA256，信息串 2fa-hub/enc/v1）
const master = Buffer.from(loadMasterKey(), 'hex');
const encKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), '2fa-hub/enc/v1', 32));

function decryptSecret(stored) {
  const [v, iv, ct, tag] = String(stored).split('.');
  if (v !== 'v1' || !iv || !ct || !tag) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', encKey, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

function buildOtpauthUri(e) {
  const label = e.issuer ? `${e.issuer}:${e.label || ''}` : (e.label || '');
  const params = new URLSearchParams();
  params.set('secret', e.secret);
  if (e.issuer) params.set('issuer', e.issuer);
  if (e.algorithm && e.algorithm.toUpperCase() !== 'SHA1') params.set('algorithm', e.algorithm.toUpperCase());
  const digits = Number(e.digits);
  if (Number.isFinite(digits) && digits !== 6) params.set('digits', String(digits));
  if (e.type === 'hotp') params.set('counter', String(Number(e.counter) || 0));
  else {
    const period = Number(e.period);
    if (Number.isFinite(period) && period !== 30) params.set('period', String(period));
  }
  return `otpauth://${e.type}/${encodeURIComponent(label)}?${params.toString()}`;
}

const args = process.argv.slice(2);
let outFile = null;
let onlyUser = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outFile = args[++i];
  else if (args[i] === '--user') onlyUser = args[++i];
}

const db = new DatabaseSync(dbFile, { readOnly: true });
const rows = db.prepare(
  `SELECT e.id, e.issuer, e.label, e.secret, e.type, e.algorithm, e.digits, e.period, e.counter
     FROM entries e
     JOIN users u ON u.id = e.user_id
   ${onlyUser ? 'WHERE u.name = ? OR u.email = ?' : ''}
    ORDER BY e.user_id, e.sort, e.id`,
).all(...(onlyUser ? [onlyUser, onlyUser] : []));

const lines = [];
let decryptErrors = 0;
for (const r of rows) {
  try {
    lines.push(buildOtpauthUri({ ...r, secret: decryptSecret(r.secret) }));
  } catch (e) {
    decryptErrors++;
    console.error(`[warn] 条目 id=${r.id}（${r.issuer}/${r.label}）解密失败，可能别名不匹配：${e.message}`);
  }
}
const output = lines.join('\n') + (lines.length ? '\n' : '');
if (outFile) {
  writeFileSync(outFile, output, 'utf8');
  console.log(`已导出 ${lines.length} 条${onlyUser ? `（用户 ${onlyUser}）` : ''}到 ${outFile}`);
} else {
  process.stdout.write(output);
}
if (decryptErrors) console.error(`[warn] ${decryptErrors} 条解密失败，请核对 MASTER_KEY`);
db.close();
