import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

// MASTER_KEY：数据加密与签名会话的根密钥（32 字节 hex）。
// 未提供时自动生成并落盘 DATA_DIR/.master_key —— 备份数据库必须同时备份它，否则已加密 secret 无法解密。
function loadMasterKey() {
  if (process.env.MASTER_KEY && process.env.MASTER_KEY.trim().length >= 64) {
    return process.env.MASTER_KEY.trim();
  }
  const keyFile = path.join(DATA_DIR, '.master_key');
  if (existsSync(keyFile)) return readFileSync(keyFile, 'utf8').trim();
  const key = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  writeFileSync(keyFile, key + '\n', { mode: 0o600 });
  console.warn('[2fa-hub] MASTER_KEY 未设置，已自动生成并写入 ' + keyFile);
  console.warn('[2fa-hub] !! 请立即备份该文件：丢失后将无法解密已保存的 2FA secret !!');
  return key;
}

export const config = {
  port: Number(process.env.PORT || 8000),
  dataDir: DATA_DIR,
  dbFile: path.join(DATA_DIR, '2fa-hub.db'),
  masterKey: loadMasterKey(),
  tokenTtlDays: Number(process.env.TOKEN_TTL_DAYS || 14),
  // open: 允许自由注册（首个用户固定为管理员）；closed: 仅管理员可建号；invite: 需邀请码
  registerMode: process.env.REGISTER_MODE || 'open',
  inviteCode: process.env.INVITE_CODE || '',
  cookieSecure: process.env.COOKIE_SECURE !== '0',
  staticDir: process.env.STATIC_DIR || path.resolve(process.cwd(), 'web/dist'),
  bodyLimit: 1024 * 1024,
};
