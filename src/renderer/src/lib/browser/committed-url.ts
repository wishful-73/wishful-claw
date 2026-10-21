/**
 * 内置浏览器的「导航目标」状态机。
 *
 * 背景：`BrowserPanel` 用受控的 `committedUrl` 驱动 `<webview src>`，而 Electron
 * 认为「给 src 赋值」就是一次导航 —— 所以只要把站内跳转的结果也回写成导航目标，
 * 就会触发整页重载。这里把「用户/外部明确要求去哪」与「页面自己跳到了哪」拆开：
 *
 * - `storedUrl`  = 页面**当前**地址（由 webview 事件回写，只用于显示与恢复）
 * - `committedUrl` = **导航目标**（只在明确指令下变化）
 *
 * 纯函数，无副作用，可单测。
 */

export interface CommittedUrlInput {
  /** 当前的导航目标 */
  prev: string
  /** 页面当前实际地址 */
  storedUrl: string
  /** 命令式导航请求序号（外部打开 / 地址栏 / 面板按钮） */
  navigationSeq: number
  /** 上一次的序号 */
  prevNavigationSeq: number
  /** 切换会话或项目 */
  scopeChanged: boolean
  /** 「复用浏览器数据」开关发生变化 —— webview 会重建 */
  reuseModeChanged: boolean
}

/**
 * 推导新的导航目标。判定顺序即优先级，先命中先返回：
 *
 * 1. 切会话/项目      → storedUrl（允许空，空即不渲染 webview）
 * 2. 命令式导航序号变  → storedUrl（用户明确要求去这个地址）
 * 3. 当前目标为空      → storedUrl（首次有值，webview 靠它挂载）
 * 4. 复用开关变化      → storedUrl（webview 重建，用实际地址，否则回跳）
 * 5. 其余             → prev（站内切 tab / hash / pushState：一律不动）
 */
export function nextCommittedUrl(input: CommittedUrlInput): string {
  const { prev, storedUrl, navigationSeq, prevNavigationSeq, scopeChanged, reuseModeChanged } = input

  if (scopeChanged) return storedUrl
  if (navigationSeq !== prevNavigationSeq) return storedUrl
  if (prev === '') return storedUrl
  if (reuseModeChanged && storedUrl !== '') return storedUrl
  return prev
}

/**
 * 宽松比较两个地址是否指向同一页。
 *
 * 用途：地址栏里输入当前页面地址再回车时，导航目标不会变化（React 会 bail out），
 * 必须显式重载一次 —— 这里负责判断「是不是同一个地址」。
 *
 * 规则：忽略协议大小写、主机名大小写、尾部斜杠、以及无意义的默认端口。
 */
export function isSameBrowserUrl(a: string, b: string): boolean {
  const left = canonicalizeBrowserUrl(a)
  const right = canonicalizeBrowserUrl(b)
  if (left === null || right === null) return a === b
  return left === right
}

function canonicalizeBrowserUrl(raw: string): string | null {
  if (!raw) return null

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return raw.trim().toLowerCase()
  }

  const protocol = parsed.protocol.toLowerCase()
  const host = parsed.hostname.toLowerCase()
  const defaultPort =
    (protocol === 'https:' && parsed.port === '443') ||
    (protocol === 'http:' && parsed.port === '80')
  const port = defaultPort ? '' : parsed.port

  const pathname = trimTrailingSlash(parsed.pathname)
  const search = parsed.search
  const hash = parsed.hash

  return `${protocol}//${host}${port ? `:${port}` : ''}${pathname}${search}${hash}`
}

function trimTrailingSlash(value: string): string {
  if (value.length <= 1) return value
  return value.endsWith('/') ? value.slice(0, -1) : value
}
