/**
 * agent 回复里的网址 → 可点标签。
 *
 * 与 LocalPathCode 同一模式，区别是**不做可用性预校验**：路径要先 stat 才知道存不存在，
 * 而网址点不开的常见原因只有「服务没起来」—— 那正是用户点一下想知道的事，
 * 拦在点击前反倒把结论藏住了。
 *
 * 点击后交给右侧浏览器面板（与正文里 markdown 链接同一归宿）。
 * 标签主体省掉 scheme（`http://` 一截宽度换不来信息），留 host + path 分清是哪个页面，
 * 完整地址放原生 title，hover 可见。
 */

import * as React from 'react'
import { Globe } from 'lucide-react'
import { openWebUrl } from '@renderer/lib/preview/web-url'

interface WebUrlCodeProps {
  url: string
  style?: React.CSSProperties
}

export function WebUrlCode({ url, style }: WebUrlCodeProps): React.JSX.Element {
  const label = url.replace(/^https?:\/\//i, '')

  return (
    <button
      type="button"
      title={url}
      className="not-prose inline-flex max-w-full cursor-pointer items-center gap-1 rounded border border-border/60 bg-muted px-1.5 py-0.5 align-middle font-mono text-xs text-primary transition-colors hover:bg-accent"
      style={style}
      onClick={() => openWebUrl(url)}
    >
      <Globe className="size-3 shrink-0 opacity-70" />
      <span className="max-w-[16rem] truncate">{label}</span>
    </button>
  )
}
