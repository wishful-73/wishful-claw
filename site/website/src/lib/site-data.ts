import { useEffect, useState } from 'react'
import type { ReleaseManifest } from './latest-yml'
import { parseReleaseManifest } from './latest-yml'

// 发布清单走官网的下载目录（与安装包、blockmap 同处，nginx 映射为 `/downloads`）——
// 与 app 内自动更新共用同一份（electron-builder 生成的 latest.yml），发版只覆盖它，前端零改动。
// 相对路径：dev 与产物（根部署或子目录部署）都解析得到；no-store：覆盖清单即时生效。
//
// 2026-10-11：抽成纯函数供两处共用 —— `/download` 页（取不到就置灰平台按钮）与 `/go`
// 中转页（S-186 口径收紧后，跳转目标由中转页自己按清单拼，见 `goUrl`）。取不到一律返回
// undefined，由调用方各自决定退化形态。
export async function loadReleaseManifest(): Promise<ReleaseManifest | undefined> {
  try {
    const response = await fetch('./downloads/latest.yml', { cache: 'no-store' })
    if (!response.ok) return undefined
    return parseReleaseManifest(await response.text())
  } catch {
    return undefined
  }
}

export function useReleaseManifest(): ReleaseManifest | undefined {
  const [manifest, setManifest] = useState<ReleaseManifest>()
  useEffect(() => {
    let alive = true
    loadReleaseManifest().then((parsed) => {
      // 取不到清单时区块仍渲染：平台按钮退化为置灰，下载页另有 GitHub 兜底入口
      if (alive && parsed) setManifest(parsed)
    })
    return () => {
      alive = false
    }
  }, [])
  return manifest
}
