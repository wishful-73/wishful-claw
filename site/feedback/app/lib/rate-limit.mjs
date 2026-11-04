/**
 * 同 IP 提交限流（需求 S-226 §10：每小时 5 条）。
 *
 * **进程内 Map，不落库** —— systemd 单实例，重启丢计数是可接受的代价；
 * 落库反而每条提交都要写一次 WAL，把最该轻的路径做重了。
 *
 * `now` 可注入：测试里不用真的等一小时。
 */

export function createRateLimiter({
  limit = 5,
  windowMs = 60 * 60 * 1000,
  now = Date.now,
  /** Map 的 key 上限：万一来的是「每次换 IP」的分布式肉鸡，不能让 Map 无限涨 */
  maxKeys = 5000
} = {}) {
  /** @type {Map<string, number[]>} key → 时间戳升序数组 */
  const seen = new Map()

  function sweep(cutoff) {
    for (const [key, stamps] of seen) {
      const kept = stamps.filter((t) => t > cutoff)
      if (kept.length) seen.set(key, kept)
      else seen.delete(key)
    }
  }

  return {
    /**
     * @returns {{ allowed: true, remaining: number } | { allowed: false, retryAfterMs: number }}
     */
    check(key) {
      const t = now()
      const cutoff = t - windowMs
      const stamps = (seen.get(key) ?? []).filter((x) => x > cutoff)

      if (stamps.length >= limit) {
        // 存回过滤结果，免得被拒的请求反复把过期时间戳带在 Map 里
        seen.set(key, stamps)
        // 最早那次滑出窗口的时刻 = 可以再试的时刻
        return { allowed: false, retryAfterMs: Math.max(0, stamps[0] + windowMs - t) }
      }

      stamps.push(t)
      seen.set(key, stamps)
      if (seen.size > maxKeys) sweep(cutoff)
      return { allowed: true, remaining: limit - stamps.length }
    },

    /** 当前在册的 key 数（测试与运维观测用） */
    size: () => seen.size,

    reset: () => seen.clear()
  }
}
