# S-192 实施规划：用户点「停止」后队列自动派发下一条

> 需求：`requirements/S-192.md`（2026-10-13 登记，定性「体验优化」）。
> 方案：老大 2026-10-13 拍板按助手推荐走 **B**。
> 范围：`dev/v2-iter-39`（base `2c925c88`）。按「一个需求一刀」提交。

---

## 一、目标

用户点「停止」后，被冻住的队列**自动派发下一条**，不再需要手动去队列点「继续」。

## 二、根因（详见 `S-192.md` §三）

停止链路 `stopStreaming`（`hooks/use-chat-actions.ts:280`）与 `cancelStream`（`stores/chat-store/index.ts:541`，`:556`）**两处**都调 `pausePendingSessionDispatch` 把队列冻住；而**所有自动派发路径传的都是 `resumePaused = false`** ⇒ **冻结没有自动出口**（`resumePendingSessionDispatch` 的注释自述了这一点）。

## 三、方案 B（采纳）

在**用户侧停止入口** `stopStreaming` 的收尾处主动解冻 + 派发：

```ts
await cancelStream()
if (sessionId) dispatchNextQueuedMessageForSession(sessionId)   // 默认 resumePaused = true ⇒ 解冻 + 派发
```

**为什么不动 `cancelStream` 本身**：它同时服务 PM 侧（`lib/tools/project-session-queue.ts:218`，S-188 第三刀已自带 resume + dispatch）与渠道侧（`hooks/use-channel-auto-reply.ts:448`）。把「自动续」塞进 `cancelStream` 会一并改掉 PM「停完待命」的语义 ⇒ 只改用户侧入口。

**为什么保留停前的 `pausePendingSessionDispatch`**：旧 run 尚在收尾，这期间不该放行下一条；解冻由收尾这一步负责。

## 四、改动面

| 文件 | 改动 |
|---|---|
| `src/renderer/src/hooks/use-chat-actions.ts` | `stopStreaming` 收尾加 `dispatchNextQueuedMessageForSession(sessionId)`（+ 注释） |

**1 文件 / 1 处**。不动 DB / C# 侧 / 协议层。

## 五、验证方式

- **门禁**：`npm run typecheck` / `npm test` / `dotnet build`。
- **实机（必须）**：跑一轮 → 排队 2 条 → 点停止 ⇒ **立即自动派发第 1 条**，顺序与内容不变。
- **边界**：停 + 空队列（不报错）；停 + 队列仅 1 条；连续停两次。

## 六、非目标

- **不改 PM 侧「停完待命」语义**（S-188 第三刀）。PM 的 `stop_session_run` 仍走自己的显式 resume。
- **不动悬浮聊天窗** —— `floating-chat-window.tsx:74` 的 `handleStop` 走同一 `cancelStream`，但该窗没有队列 UI（点不到「继续」也看不到队列），是否一并处理另行登记。
