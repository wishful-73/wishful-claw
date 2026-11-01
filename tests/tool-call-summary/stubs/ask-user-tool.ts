/*
 * S-286 测试桩：`@renderer/lib/tools/ask-user-tool` 的替身。
 *
 * 为什么桩：`tool-call-summary` 为了 `coerceAskUserQuestions` 引了这个模块，而它拖着
 * `i18n`（`locales/index.ts` 用 vite 专有的 `import.meta.glob`）、`chat-store`、
 * `background-session-store` —— node 下加载就 `TypeError: import_meta.glob is not a function`。
 *
 * 本套件测的是**桌面截图的尺寸解析**，`AskUserQuestion` 那一路与它无关（真实现要不要
 * 从 `questions` 里挖出第一个问句，不影响锚定正则的行为），所以给个空数组即可：
 * 调用方会落到 `'asking user...'` 那条兜底。
 */

export interface AskUserQuestionItem {
  question?: string
  header?: string
  options?: unknown[]
  multiSelect?: boolean
}

export function coerceAskUserQuestions(_value: unknown): AskUserQuestionItem[] {
  return []
}
