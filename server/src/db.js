import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { TRASH_RETENTION_DAYS } from '../../shared/trash.js';

export { TRASH_RETENTION_DAYS };

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT '',
  issuer     TEXT NOT NULL DEFAULT '',
  secret     TEXT NOT NULL,             -- AES-256-GCM 密文（v1.iv.ct.tag）
  type       TEXT NOT NULL DEFAULT 'totp',
  algorithm  TEXT NOT NULL DEFAULT 'SHA1',
  digits     INTEGER NOT NULL DEFAULT 6,
  period     INTEGER NOT NULL DEFAULT 30,
  counter    INTEGER NOT NULL DEFAULT 0,
  sort       INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,                      -- NULL = 启用；非空 = 在回收站（保留 14 天后彻底删除）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_entries_user ON entries(user_id, sort);
CREATE TABLE IF NOT EXISTS api_keys (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  tier       TEXT NOT NULL CHECK (tier IN ('code', 'read', 'manage')),
  entry_ids  TEXT, -- NULL = 全部当前及未来条目；JSON 数组 = 条目白名单
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

// 回收站清理间隔只是节流：保留期截止判断始终按 deleted_at 精确到时刻，不依赖本间隔——
// 即使进程长时间未运行/未触发清理，超过 14 天的条目也绝不会再被列出或恢复。
export const TRASH_PURGE_INTERVAL_MS = 3600_000; // 1h

function migrate() {
  const columns = db.prepare('PRAGMA table_info(entries)').all().map((c) => c.name);
  if (columns.includes('deleted_at')) return;
  // 旧库升级：一次性加列并回填（无历史回收站数据，存量条目均为已启用）
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE entries ADD COLUMN deleted_at TEXT');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) { err.rollbackError = rollbackError; }
    throw err;
  }
}
migrate();
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_trash ON entries(user_id, deleted_at)');

/** 彻底删除回收站中超过保留期的条目；启动时同步执行一次，之后每小时兜底。 */
export function cleanupTrash() {
  return Number(db.prepare(
    `DELETE FROM entries WHERE deleted_at IS NOT NULL
       AND deleted_at < datetime('now', ?)`,
  ).run(`-${TRASH_RETENTION_DAYS} days`).changes);
}

export function scheduleTrashCleanup() {
  cleanupTrash();
  const timer = setInterval(cleanupTrash, TRASH_PURGE_INTERVAL_MS);
  timer.unref(); // 不阻止进程退出
}

// 审计日志保留期：启动时清理 90 天前的记录，并每 24h 定时清理（长驻进程表不能无限增长）
export function cleanupAudit() {
  db.prepare(`DELETE FROM audit WHERE created_at < datetime('now', '-90 days')`).run();
}

export function scheduleAuditCleanup() {
  cleanupAudit();
  const timer = setInterval(cleanupAudit, 24 * 3600_000);
  timer.unref(); // 不阻止进程退出
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}

export function audit(userId, action, detail = '', ip = '', ua = '') {
  db.prepare('INSERT INTO audit (user_id, action, detail, ip, ua) VALUES (?, ?, ?, ?, ?)')
    .run(userId ?? null, action, String(detail).slice(0, 500), String(ip).slice(0, 64), String(ua).slice(0, 200));
}

/** Run a synchronous set of SQLite writes atomically, acquiring the write lock before reading state. */
export function transaction(callback) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch (rollbackError) { err.rollbackError = rollbackError; }
    throw err;
  }
}
