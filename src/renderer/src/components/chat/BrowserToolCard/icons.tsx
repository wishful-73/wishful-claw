/**
 * 浏览器工具卡的图标与兜底标题映射。
 *
 * S-250 从 `BrowserToolCard.tsx` 搬出，判断分支逐条平移。
 */

import {
  Camera,
  FileText,
  Globe2,
  Keyboard,
  Monitor,
  MousePointerClick,
  ScrollText
} from 'lucide-react'
import {
  BROWSER_CLICK_TOOL_NAME,
  BROWSER_GET_CONTENT_TOOL_NAME,
  BROWSER_NAVIGATE_TOOL_NAME,
  BROWSER_SCREENSHOT_TOOL_NAME,
  BROWSER_SCROLL_TOOL_NAME,
  BROWSER_SNAPSHOT_TOOL_NAME,
  BROWSER_TYPE_TOOL_NAME
} from '@renderer/lib/app-plugin/types'

export function getToolIcon(name: string): React.JSX.Element {
  if (name === BROWSER_SCREENSHOT_TOOL_NAME) return <Camera className="size-3.5" />
  if (name === BROWSER_SNAPSHOT_TOOL_NAME) return <Monitor className="size-3.5" />
  if (name === BROWSER_CLICK_TOOL_NAME) return <MousePointerClick className="size-3.5" />
  if (name === BROWSER_TYPE_TOOL_NAME) return <Keyboard className="size-3.5" />
  if (name === BROWSER_SCROLL_TOOL_NAME) return <ScrollText className="size-3.5" />
  if (name === BROWSER_GET_CONTENT_TOOL_NAME) return <FileText className="size-3.5" />
  return <Globe2 className="size-3.5" />
}

export function fallbackTitle(name: string): string {
  if (name === BROWSER_NAVIGATE_TOOL_NAME) return 'Browser Navigate'
  if (name === BROWSER_GET_CONTENT_TOOL_NAME) return 'Browser Content'
  if (name === BROWSER_SCREENSHOT_TOOL_NAME) return 'Browser Screenshot'
  if (name === BROWSER_SNAPSHOT_TOOL_NAME) return 'Browser Snapshot'
  if (name === BROWSER_CLICK_TOOL_NAME) return 'Browser Click'
  if (name === BROWSER_TYPE_TOOL_NAME) return 'Browser Type'
  if (name === BROWSER_SCROLL_TOOL_NAME) return 'Browser Scroll'
  return name
}
