/*
 * Stub for `@renderer/stores/channel-store` — S-167 收尾刀的测试用。
 *
 * 真实模块依赖 ipcClient。被测代码只读 `channels`，按 `session.pluginId` 找渠道绑定。
 */

export interface StubChannelState {
  channels: unknown[]
}

const EMPTY: StubChannelState = { channels: [] }

let state: StubChannelState = EMPTY

export const useChannelStore = {
  getState: (): StubChannelState => state
}

export function __setChannelState(next: Partial<StubChannelState>): void {
  state = { ...EMPTY, ...next }
}
