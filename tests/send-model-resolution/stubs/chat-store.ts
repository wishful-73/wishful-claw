/*
 * Stub for `@renderer/stores/chat-store` — S-167 收尾刀的测试用。
 *
 * 真实模块是 chat-store 的一整套 slice，依赖 IPC / 数据库层。被测代码只读
 * `useChatStore.getState().sessions`。
 */

export interface StubChatState {
  sessions: unknown[]
}

const EMPTY: StubChatState = { sessions: [] }

let state: StubChatState = EMPTY

export const useChatStore = {
  getState: (): StubChatState => state
}

export function __setChatState(next: Partial<StubChatState>): void {
  state = { ...EMPTY, ...next }
}
