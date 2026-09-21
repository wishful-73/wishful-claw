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
