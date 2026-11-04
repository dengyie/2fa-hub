// 垃圾箱保留期：删除的条目先进入垃圾箱，保留期内可随时恢复；超过该天数后彻底删除。
// 前后端共用同一常量，避免 UI 提示与服务端/本地清理逻辑的保留期不一致。
export const TRASH_RETENTION_DAYS = 14;

/**
 * 过滤掉已进入垃圾箱的条目（deleted_at 非空）。
 * 本地列表、本地→云端迁移等所有直接读取本地库的路径都必须经过它，
 * 否则软删除条目会被当成活跃条目重新展示或上传。
 */
export function activeEntries(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => entry && !entry.deleted_at);
}
