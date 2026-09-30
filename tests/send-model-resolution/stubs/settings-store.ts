/*
 * Stub for `@renderer/stores/settings-store` — S-167 收尾刀的测试用。
 *
 * 真实模块带 persist + 迁移链。被测代码只读 `mainModelSelectionMode`
 * （`inherit` / `manual` / `auto` 那个全局档位）。
 */

export interface StubSettingsState {
  mainModelSelectionMode: string
}

const EMPTY: StubSettingsState = { mainModelSelectionMode: 'manual' }

let state: StubSettingsState = EMPTY

export const useSettingsStore = {
  getState: (): StubSettingsState => state
}

export function __setSettingsState(next: Partial<StubSettingsState>): void {
  state = { ...EMPTY, ...next }
}
