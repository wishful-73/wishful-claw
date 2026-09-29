import { useEffect, useState } from 'react'
import type { ReleaseManifest } from './latest-yml'
import { parseReleaseManifest } from './latest-yml'

// 发布清单走官网的下载目录（与安装包、blockmap 同处，nginx 映射为 `/downloads`）——
// 与 app 内自动更新共用同一份（electron-builder 生成的 latest.yml），发版只覆盖它，前端零改动。
// 相对路径：dev 与产物（根部署或子目录部署）都解析得到；no-store：覆盖清单即时生效。
export function useReleaseManifest(): ReleaseManifest | undefined {
  const [manifest, setManifest] = useState<ReleaseManifest>()
  useEffect(() => {
    let alive = true
    fetch('./downloads/latest.yml', { cache: 'no-store' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`latest.yml HTTP ${res.status}`))))
      .then((text) => {
        const parsed = parseReleaseManifest(text)
        if (alive && parsed) setManifest(parsed)
      })
      .catch(() => {
        // 取不到清单时区块仍渲染：平台按钮退化为置灰，下载页另有 GitHub 兜底入口
      })
    return () => {
      alive = false
    }
  }, [])
  return manifest
}
