/*
 * Stub for `@renderer/stores/provider-store` — S-167 收尾刀的测试用。
 *
 * 真实模块在顶层 import 了 `@renderer/lib/ipc/ai-provider-storage` 与 zustand 的
 * persist 中间件，在 Electron 之外跑不起来。被测代码只用到 `useProviderStore.getState()`，
 * 所以这里只开这一个口子（外加一个给测试写状态的 setter）。
 */

export interface StubProviderState {
  providers: unknown[]
  activeProviderId: string | null
  activeModelId: string | null
  getActiveProvider: () => unknown
}

const EMPTY: StubProviderState = {
  providers: [],
  activeProviderId: null,
  activeModelId: null,
  getActiveProvider: () => null
}

let state: StubProviderState = EMPTY

export const useProviderStore = {
  getState: (): StubProviderState => state
}

export function __setProviderState(next: Partial<StubProviderState>): void {
  state = { ...EMPTY, ...next }
}
