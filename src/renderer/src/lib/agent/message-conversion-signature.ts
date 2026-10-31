// 转换层缓存的签名判据（iter-v3-5 S-247）。
//
// 为什么单独一个文件：这段逻辑是「`convertChatMessagesToUnified` 的缓存会不会漏判」
// 的唯一判据，必须能被 node 直接单测。挂在 `MessageList/utils.ts` 里做不到 ——
// 那个文件的值 import 链会把 IPC / zustand 拖进 node（`window is not defined`），
// 和 S-276 把 `trimMessagesToRecentTurns` 搬进 `lib/agent/turn-window.ts` 是同一个理由。
//
// 判据的**唯一职责**：`convertOneMessage` 读到的字段，只要可能变，就必须进签名。
// 少一个就是「界面停止更新且不报错」——这种 bug 没有异常、没有日志，只有用户觉得
// 「怎么不动了」。所以宁可多取几个 O(1) 字段，也不省。

/**
 * 单条 ChatMessage 的轻量签名。
 *
 * ⚠️ **不要为了缩小盲区在这里读文本内容**（`charCodeAt` / `slice` / `includes`）。
 * `text` 是流式 `+=` 拼出来的 ConsString，`length` 是 O(1)，但任何读字符的操作都会
 * 强制 V8 把整条 rope flatten 成连续字符串 —— 长回复下每帧复制上百 KB，
 * 实测 32 秒堆涨 425MB 就是这么来的（S-247 §17）。
 *
 * 覆盖的字段，逐条对应 `convertOneMessage` 的读取点：
 *
 * | 字段 | 为什么必须进签名 |
 * |---|---|
 * | `id` | 历史加载换 id ⇒ 整条换人 |
 * | `text.length` | 流式主路径，每个 token 都变 |
 * | `thinking.length` | 同上（思考通道） |
 * | `toolCalls` 状态摘要 | **长度不变**，`tool_call_result` 只改 `status`/`output`/`error` |
 * | `error.length` | 出错后追加 `agent_error` 块 |
 * | `updatedAt` | 轮次收尾盖章 |
 * | `preToolPhase` | 独立赋值，不碰 `updatedAt`（store `index.ts:1155`） |
 * | `memoryRecall` | 独立赋值，不碰 `updatedAt`（store `index.ts:1921`） |
 *
 * 刻意**没**进签名的（复核过，安全）：
 * - `role` / `createdAt`：创建后不变。
 * - `usage` / `debugInfo` / `content`：只在从 DB 加载时一次性 set，那时 `messages`
 *   数组整个换新，`chatMessageConversionCache` 的 WeakMap key 就换了，必然全量重转。
 * - `meta`：`chat-store/index.ts:1702` 写入，同块 `:1711` 顺手盖了 `updatedAt`。
 * - `segments`：它和 `msg.text` / `msg.thinking` / `msg.toolCalls` 是**同步**改的
 *   （`flushStreamDeltas` 与 `tool_call_result` 两处都成对赋值），上面三项已经覆盖；
 *   段自身的 `startedAt` / `completedAt` 只在 `message_end` 换新对象时变，那时也 miss。
 */
export function getMessageSignature(msg: Record<string, unknown>): string {
  const text = (msg.text as string) ?? ''
  const thinking = msg.thinking as string | undefined
  const toolCalls = msg.toolCalls as Array<Record<string, unknown>> | undefined
  const error = typeof msg.error === 'string' ? msg.error : ''
  const memoryRecall = msg.memoryRecall as { hits?: unknown[] } | undefined
  const toolCallsDigest = toolCalls
    ? toolCalls
        .map((tc) => {
          const out = typeof tc.output === 'string' ? tc.output.length : 0
          const err = typeof tc.error === 'string' ? tc.error.length : 0
          return `${(tc.status as string) ?? ''}:${out}:${err}`
        })
        .join(',')
    : ''
  return [
    msg.id as string,
    text.length,
    thinking?.length ?? 0,
    toolCallsDigest,
    error.length,
    (msg.updatedAt as number) ?? 0,
    msg.preToolPhase ? 1 : 0,
    memoryRecall ? 1 + (memoryRecall.hits?.length ?? 0) : 0
  ].join(':')
}

/** 整个消息数组的签名（外层缓存 `chatMessageConversionCache` 用）。 */
export function getChatMessageConversionSignature(messages: readonly unknown[]): string {
  const parts: string[] = []
  for (const raw of messages) {
    parts.push(getMessageSignature(raw as Record<string, unknown>))
  }
  return parts.join('|')
}
