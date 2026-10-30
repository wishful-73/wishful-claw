/*
 * S-271 测试桩：`components/chat/tool-call-summary` 的替身。
 *
 * 为什么桩：这个模块为了 `coerceAskUserQuestions` 引了 `ask-user-tool`，
 * 而后者拖着 `i18n`（`locales/index.ts` 用 vite 专有的 `import.meta.glob`）、
 * `chat-store`、`background-session-store` —— 在 node 下加载即炸。
 *
 * 被测的折叠判据（category / visibility / failedCount）与摘要文案无关：
 * `execution-outline` 只把 `inputSummary` 的结果塞进 `item.summary` 供界面展示。
 * 所以这里给一个确定性的简化实现，摘要文案由界面自己看，不由本套件看。
 */

import type { ToolResultContent } from '@renderer/lib/api/types'

export function inputSummary(
  name: string,
  input: Record<string, unknown>,
  _output?: string
): string {
  const key = Object.keys(input)[0]
  return key ? `${name}:${String(input[key]).slice(0, 32)}` : name
}

export function summarizeSearchToolOutput(_name: string, _output?: ToolResultContent): string {
  return ''
}
