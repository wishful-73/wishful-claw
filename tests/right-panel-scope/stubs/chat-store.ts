/*
 * Stub for `@renderer/stores/chat-store` — S-259 的测试用。
 *
 * 真实模块是 chat-store 的一整套 slice，依赖 IPC / 数据库层。被测的
 * `resolveRightPanelSessionId` 只在 state 与入参都拿不到会话时才读它，读到的
 * 也只是 `activeSessionId` 这一个字段。
 */

export interface StubChatState {
  activeSessionId: string | null
}

const EMPTY: StubChatState = { activeSessionId: null }

let state: StubChatState = EMPTY

export const useChatStore = {
  getState: (): StubChatState => state
}

export function __setChatState(next: Partial<StubChatState>): void {
  state = { ...EMPTY, ...next }
}
