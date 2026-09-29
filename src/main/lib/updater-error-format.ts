/**
 * 更新失败的「面向用户」分类。
 *
 * 纯函数、零 electron 依赖 —— main 进程与回归套件跑的是同一份代码（同 S-142 抽
 * `stream-segments` 的做法），这样分类规则可以被断言钉住，而不是只活在运行日志里。
 *
 * 为什么需要它：`updater.ts` 原先在认不出错误时 `return message`，把**原始报文**直接送进
 * 更新对话框 —— 用户看到的是 `HttpError: 500 Internal Server Error`、
 * `net::ERR_CONNECTION_RESET`、`ERR_UPDATER_CHECKSUM_MISMATCH`，甚至整段 HTML 错误页或带栈
 * 的文本。这里把「认得出」的几类固定下来，「认不出」的也只放行一个能进日志对照的短码。
 */

/** 分类结果。`code` 仅在 `kind === 'unknown'` 时有值。 */
export interface UpdaterErrorClassification {
  kind: 'missingMetadata' | 'network' | 'unknown' | 'fallback'
  code?: string
}

/**
 * Node / undici 一系的网络错误码。
 * 报文里以 `code` 形式出现（如 `connect ECONNRESET 1.2.3.4:443`），或缀在 `Error:` 之后。
 */
const NODE_NETWORK_CODE_RE =
  /\b(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ESOCKETTIMEDOUT)\b/i

/**
 * Chromium net 栈的错误码 —— `net::ERR_CONNECTION_RESET` 这种整体前缀形式。
 *
 * 这一族此前是漏网的主力：Electron 的 `net` 模块与 electron-updater 的下载都走 Chromium
 * 网络栈，报文里出现的正是 `net::ERR_*`（而不是 Node 的 `ECONNRESET`），所以既有的码表
 * 一个都匹配不上 ⇒ 原样落到「裸吐报文」的兜底分支。
 */
const CHROMIUM_NET_CODE_RE = /\bnet::(ERR_[A-Z0-9_]+)\b/i

/** updater 自有的错误码（校验失败、签名不符、安装器缺失等）。 */
const UPDATER_CODE_RE = /\b(ERR_UPDATER_[A-Z0-9_]+)\b/i

const HTTP_STATUS_TEXT_RE =
  /\b(\d{3})\s+(?:Request Timeout|Forbidden|Not Found|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out|Too Many Requests)\b/i

const HTTP_STATUS_INLINE_RE = /\b(?:HttpError|HTTP|status|statusCode)\b[^0-9]{0,4}(\d{3})\b/i

/** 从报文里摘 HTTP 状态码：`HttpError: 500` / `HTTP 502` / `502 Bad Gateway` 三种写法。 */
export function extractHttpStatus(message: string): number | null {
  const inline = message.match(HTTP_STATUS_INLINE_RE)
  if (inline) return Number.parseInt(inline[1], 10)
  const verbose = message.match(HTTP_STATUS_TEXT_RE)
  if (verbose) return Number.parseInt(verbose[1], 10)
  return null
}

function isNetworkFailure(message: string): boolean {
  if (CHROMIUM_NET_CODE_RE.test(message)) return true
  if (NODE_NETWORK_CODE_RE.test(message)) return true
  // 服务端抖动（5xx）与限流 / 超时（408 / 429）：对用户是同一句话「稍后重试」。
  const status = extractHttpStatus(message)
  return status !== null && (status === 408 || status === 429 || status >= 500)
}

/**
 * 短码 —— 只作为「这一点能拿去对照日志」的标识，不是给用户读的。优先级：
 * `net::ERR_*` → `ERR_UPDATER_*` → `HTTP <3 位>`。
 */
export function extractErrorCode(message: string): string | null {
  const chromium = message.match(CHROMIUM_NET_CODE_RE)
  if (chromium) return chromium[1].toUpperCase()
  const updater = message.match(UPDATER_CODE_RE)
  if (updater) return updater[1].toUpperCase()
  const status = extractHttpStatus(message)
  if (status !== null) return `HTTP ${status}`
  return null
}

/**
 * 判定顺序即优先级，改动前先想清楚「两个判据都命中时该报哪一类」：
 *
 * 1. `missingMetadata` —— 清单缺失是**发布侧**问题，文案要指向「重新生成并上传」，所以必须在
 *    网络类之前判（404 也会被 4xx 之外的规则忽略，但顺序写死更省心）。
 * 2. `network` —— 网络 / 服务端抖动，用户能做的是「检查网络、稍后重试」。
 * 3. `unknown` —— 认得出短码，带码展示。
 * 4. `fallback` —— 认不出，只给通用文案（原文不出口，仍进日志）。
 */
export function classifyUpdaterError(message: unknown): UpdaterErrorClassification {
  const text = typeof message === 'string' ? message : String(message ?? '')

  if (/latest\.ya?ml/i.test(text) && /\b404\b/.test(text)) {
    return { kind: 'missingMetadata' }
  }

  if (isNetworkFailure(text)) return { kind: 'network' }

  const code = extractErrorCode(text)
  if (code) return { kind: 'unknown', code }

  return { kind: 'fallback' }
}
