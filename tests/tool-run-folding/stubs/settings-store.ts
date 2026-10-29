/*
 * S-271 测试桩：`@renderer/stores/settings-store` 的替身。
 *
 * 为什么桩：`execution-outline.ts` 为「结构化失败嗅探」引 `tool-result-format`，
 * 而它 `getCurrentToolResultFormat()` 会摸 `useSettingsStore` —— 真实 store 带
 * persist + i18n 装载，其中 `locales/index.ts` 用 `import.meta.glob`（vite 专有），
 * 在 node 里直接 `TypeError: import_meta.glob is not a function`。
 *
 * 被测路径只读 `toolResultFormat`，而且 `decodeStructuredToolResult` 是
 * 「先 JSON 再 TOON」逐次尝试、与这个设置无关（该设置只影响 encode）。
 * 所以这里给个常量就够，不需要复刻 persist。
 */

export interface StubSettingsState {
  toolResultFormat: 'toon' | 'json'
}

const STATE: StubSettingsState = { toolResultFormat: 'json' }

export const useSettingsStore = {
  getState: (): StubSettingsState => STATE
}
