/*
 * 判定一条 provider 错误是不是「限额」—— 决定要不要替用户自动换服务商并发一条推进。
 *
 * 单独成模块的原因：`provider-auto-fallback` 一被 import 就会拉起 chat / provider /
 * ui 三个 store，node 里跑不起来；而这条判定的正确性必须能被单独测（它误判的代价是
 * 「用户没要求的一次换服务商 + 自动发消息」）。
 */

// 429 / 503 是 ProviderHttpException 消息里的固定形态："... request failed HTTP 429: ..."
const QUOTA_STATUS_PATTERNS = [/HTTP\s+429/, /HTTP\s+503/]

/**
 * 没有状态码时的文案兜底，刻意收得很窄。
 *
 * 起因：这里原本有 `/overload/i` 和 `/\bcapacity\b/i`，两个都是通用词。工具输出里
 * 完全可能出现 TypeScript 的 "No overload matches this call" 或 "at capacity"，一旦
 * 命中就会替用户换掉服务商并自动再发一条消息。真限额由上面的状态码负责，这里只认
 * 明确的限额措辞。
 */
const QUOTA_PHRASE_PATTERNS = [
  /rate[_\s-]?limit/i,
  /\bquota\b/i,
  /usage[_\s-]?limit/i,
  /too many requests/i,
  /\boverloaded\b/i
]

/** 上下文超限换个服务商也好不了，必须排除 —— 否则会一路切到列表尽头。 */
const NOT_QUOTA_PATTERNS = [
  /context[_\s-]?(window|length)/i,
  /too[_\s-]?long/i,
  /maximum[_\s-]?context/i
]

export function isQuotaFailure(message?: string | null): boolean {
  if (!message) return false
  for (const pattern of NOT_QUOTA_PATTERNS) {
    if (pattern.test(message)) return false
  }
  for (const pattern of QUOTA_STATUS_PATTERNS) {
    if (pattern.test(message)) return true
  }
  return QUOTA_PHRASE_PATTERNS.some((pattern) => pattern.test(message))
}
