// 进程内固定窗口限流（单实例部署足够；多实例时换 Redis 再说）
const buckets = new Map();

/** 每 windowMs 最多 max 次；超出返回 false。key 建议带维度（如 `login:${ip}:${email}`） */
export function allow(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  if (buckets.size > 10_000) { // 防内存膨胀
    for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
  }
  return b.count <= max;
}

export function reset(key) {
  buckets.delete(key);
}
