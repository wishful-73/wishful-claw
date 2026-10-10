import { useEffect, useState } from 'react'

/**
 * 官网统计数字（S-182）—— 来自服务器 nginx 日志的每日聚合。
 *
 * 数据源是 nginx 的 `location = /stats.json`（`alias /data/stats/summary.json`），
 * **不在站点目录里**：站点发布是整目录原子替换，放站点里会被 `deploy site` 清掉。
 *
 * 与 `useReleaseManifest` 同一套写法（相对路径 + `no-store` + 失败静默）：
 * 拿不到就什么都不显示，**不显示 0、不报错** —— 数字是锦上添花，不能让它影响页面。
 */
export interface SiteStats {
  /** 累计下载次数 = 官网点击（中转页）+ 应用内自动更新（两个日志源各自去重后相加） */
  downloads: number
  /** 累计访问次数（PV，已过滤机器人） */
  visits: number
}

/**
 * 不足这个数就不显示（S-182 §二 第 4 条）。
 * 数字从 0 起算（历史无法回溯），刚上线时「已下载 3 次」比干脆不显示更劝退。
 */
export const MIN_VISIBLE_COUNT = 100

/** 数字加千分位；用于页面上展示，别把 12345 写成 `12345`。 */
export function formatCount(value: number): string {
  return value.toLocaleString('zh-CN')
}

export function useSiteStats(): SiteStats | undefined {
  const [stats, setStats] = useState<SiteStats>()
  useEffect(() => {
    let alive = true
    fetch('./stats.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`stats.json HTTP ${res.status}`))))
      .then((data: { downloads_total?: unknown; visits_total?: unknown }) => {
        const downloads = Number(data?.downloads_total)
        const visits = Number(data?.visits_total)
        if (!alive || !Number.isFinite(downloads) || !Number.isFinite(visits)) return
        setStats({ downloads, visits })
      })
      .catch(() => {
        // 取不到统计时区块照常渲染：数字整段不显示
      })
    return () => {
      alive = false
    }
  }, [])
  return stats
}
