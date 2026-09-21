import { useEffect, useState } from 'react'
import type { LatestInfo } from '../content/site'

// 相对路径：dev 与产物（根部署或子目录部署）都解析得到；no-store：发版改 latest.json 即时生效
export function useLatestInfo(): LatestInfo | undefined {
  const [info, setInfo] = useState<LatestInfo>()
  useEffect(() => {
    let alive = true
    fetch('./latest.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`latest.json HTTP ${res.status}`))))
      .then((data: LatestInfo) => {
        if (alive) setInfo(data)
      })
      .catch(() => {
        // 取不到版本信息时区块仍渲染，按钮走各自的兜底文案
      })
    return () => {
      alive = false
    }
  }, [])
  return info
}

export interface ReleaseEntry {
  tag_name: string
  name: string
  html_url: string
  published_at: string
  body: string
}

// 阶段 1 直接吃 GitHub API（CORS 放开）。若被限流则返回空数组，区块自动隐藏
export function useRecentReleases(): ReleaseEntry[] | undefined {
  const [releases, setReleases] = useState<ReleaseEntry[]>()
  useEffect(() => {
    let alive = true
    fetch('https://api.github.com/repos/wishful-73/wishful-claw/releases?per_page=5')
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ReleaseEntry[]) => {
        if (alive) setReleases(Array.isArray(data) ? data.slice(0, 5) : [])
      })
      .catch(() => {
        if (alive) setReleases([])
      })
    return () => {
      alive = false
    }
  }, [])
  return releases
}
