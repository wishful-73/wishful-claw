# 代码审查报告 7a：渲染端核心链路

> 审查范围：`chat-store/index.ts`（sendMessage/cancelStream/handleEnvelope/loop_end/error）、`agent-store/slices/sub-agent-slice.ts`、`lib/ipc/agent-stream-receiver.ts`、`lib/ipc/messagepack-ipc-client.ts`、`lib/agent/run-agent-via-sidecar.ts`、`lib/agent/stream-event-adapter.ts`、`lib/ipc/agent-bridge-streaming.ts`
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 事件流交叉验证
> 说明：全项目持续审查第 7a 部分，只记录问题，不附带修复。

---

## §1 高优先级

### RC-1 handleEnvelope 的 targetSessionId 匹配机制导致多会话并发丢事件

**位置**：`chat-store/index.ts:409-497`

**问题**：
- `handleEnvelope` 通过遍历 `streamingMessages` 找 `msgId === envelope.runId` 定位目标会话。该设计依赖"每个 runId 在发送前已注册到 streamingMessages"。
- 两个致命场景：
  1. **恢复会话后重放**：应用重启或切换项目重新加载消息列表时，历史 assistant 消息的 id 就是旧 runId，但 streamingMessages 里没有注册——若 Worker 端有迟到的 envelope（如后台子 agent 的 sub_agent_end、goal_progress），`targetSessionId` 为 null。goal_* 事件因自带 sessionId 幸免，但 **sub_agent_end 走 L497 `if (!targetSessionId) return` 直接丢弃**——后台子 agent 完成事件在主会话不在流式状态时全部丢失（与 iter-19 已修的"唤醒主会话"问题互补但不同：那条修的是 Worker 缓冲+主动唤醒，这条是渲染端被动路径仍会丢）。
  2. **同一 runId 双投递**：runId 由渲染端生成（时间戳+6位随机），碰撞概率低但非零；且 `for...break` 只取第一个匹配会话，理论上无法区分。
- 另外 L447 goal_progress 的回退链 `gp.sessionId ?? input.sessionId ?? targetSessionId`——顶层字段不存在于 Worker 实际载荷（注释自己承认"All fields are inside the Input JSON"），`gp.sessionId` 恒 undefined，靠 `input.sessionId` 兜底才工作。字段访问路径与实际协议不符，纯靠巧合运行。

**建议**：envelope.sessionId 由 Worker 写入信封（已有 sessionId 字段！L120 `AgentRuntimeStreamEnvelope(state.RunId, state.SessionId, ...)`），渲染端应优先用 `envelope.sessionId` 定位会话而不是反查 streamingMessages——信封里明明带着答案。

---

## §2 中优先级

### RC-2 cancelStream 只取消 activeSessionId，无法停止后台会话

**位置**：`chat-store/index.ts:336-345`

**问题**：
- `cancelStream` 无参版：`sessionId = state.activeSessionId`。用户在会话 A 有任务在跑，切到会话 B 点停止——停的是 B（可能根本没在跑），A 的任务继续烧 token。
- 工作区侧栏每个会话都显示 streaming 指示点（workspace-sidebar-items L135），暗示可独立控制，实际没有入口。
- `stopStreaming` hook（use-chat-actions.ts:147）也未暴露 sessionId 参数。

**建议**：cancelStream 接受可选 sessionId，默认 activeSessionId；侧栏指示点提供右键/悬停停止按钮。

### RC-3 error 事件不清理 streamingMessages，依赖 loop_end 补刀

**位置**：`chat-store/index.ts:1313-1349`

**问题**：
- error 分支只把消息标 `isStreaming=false, error=message`，**不删 streamingMessages[sessionId]**。
- 若 Worker 崩溃/管道断导致 loop_end 永不到来（agent-stream-receiver 收不到终结事件），streamingMessages 条目永久残留：该会话永远显示"生成中"，且 handleEnvelope 反查表越来越脏，下次 sendMessage 前 cancelStream 也只认 activeSession。
- 对比 sendMessage 的 catch 分支（L316-330）正确清理了 setStreamingMessageId(null)。两条错误路径清理行为不一致。

**建议**：error 事件同样走 setStreamingMessageId(sessionId, null) + resetLiveSessionExecution；另加兜底超时（如 5 分钟无任何事件强制清流态）。

### RC-4 agentStream.lastSeqByRun 无界增长

**位置**：`agent-stream-receiver.ts:25, 109-115, 136-138`

**问题**：
- `lastSeqByRun` 记录每个 runId 的最新 seq 用于 gap 检测，仅在收到 loop_end/error 时删除条目。
- 后台子 agent / Goal 编排的 runId（`subagent-bg-*`、`goal-*`）事件经 SuppressTransportEvents 不走传输层——但**前台子 agent 的父流转发**（sub_agent_text_delta 等）用的是父 runId，正常结束会清理。真正泄漏的是：Worker 崩溃、用户停止（cancel 路径 Worker 发 aborted loop_end，能清）之外的异常路径，以及每次应用生命周期内大量一次性辅助 run（标题生成、翻译等 sidecar 文本请求各自有 runId）。
- 单条目小（number），增长慢，属慢性泄漏而非紧急问题。

**建议**：LRU 上限（如 500 条）或在 subscribeAll 注销时顺带清理。

### RC-5 run-agent-via-sidecar 的 pendingEvents 缓冲无上限

**位置**：`run-agent-via-sidecar.ts:72-80, 99-103`

**问题**：
- runId 分配前到达的事件推入 `pendingEvents` 数组无上限。正常情况 runAgent 响应在毫秒级返回，缓冲极短；但 Worker 忙（8 并发占满、长工具阻塞 IPC）时，subscribeAll 先于 runId 注册收到事件会持续堆积。
- 极端情况下（Worker 卡死 + 高频 text_delta）内存快速增长且永不释放（finished 依赖 loop_end，而卡死意味着没有 loop_end）。
- 同款模式在 agent-bridge-streaming.ts:157-163 重复实现。

**建议**：pendingEvents 设上限（如 1000 条），溢出丢弃并 warn；或先发 run 请求再订阅。

### RC-6 adaptSubAgentEvent 把 usage 硬编码为 0

**位置**：`chat-store/adapt-sub-agent-event.ts:53-56`

**问题**：
```ts
usage: { inputTokens: 0, outputTokens: 0 }
```
- sub_agent_end 适配时 usage 恒为 0，而 Worker 的 BuildResultJson 根本没输出 usage 字段（只有 output/toolCallCount/iterations）。子 agent 详情面板的 token 统计永远是 0——与 Goal 面板 tokens 恒 0 是同族问题（记账通道无人调用），但这里是**适配层伪造数据**掩盖了协议缺字段的事实。
- 若未来 Worker 补上 usage，这里还会用 0 覆盖真实值吗？不会（spread 在后面），但当前是纯死数据。

**建议**：要么 Worker 在 resultJson 里带上累计 usage（collector 已收集 message_end 的 Usage 事件，只是没存），要么前端隐藏子 agent token 统计直到数据可用。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| RC-7 | `chat-store/index.ts:201-222` | sendMessage 内多处 `writeLog('info', ...)` 打印完整 userText 到日志文件——用户隐私内容（粘贴的代码/密钥片段）全量落盘 `~/.wishful-claw/logs/`。日志规范未约定脱敏 |
| RC-8 | `chat-store/index.ts:208, 217` | `_afterTurn`/`_sessForUserSort` 变量名下划线前缀但实际被使用，命名误导（像弃用变量）；整段调试痕迹代码未清理 |
| RC-9 | `chat-store/index.ts` 全文 | 双倍行距格式（每行后空一行），约 1500 行被撑到 3000+ 行，违反 AGENTS.md 大文件拆分规范（>500 行必须拆），且空行不是拆分能解决的——需要先去空行再按 slice 拆 |
| RC-10 | `messagepack-ipc-client.ts:13-22 invokeMessagePack` | 与 invokeMessagePackBinary 仅差一次 decode，前者响应不解码直接 as T——调用方拿到的其实是 MessagePack 原始结构化对象还是 ArrayBuffer 取决于 main 进程 handler 返回类型，类型系统完全帮不上忙；建议统一走 Binary 版本并审计 invokeMessagePack 的现存调用方 |
| RC-11 | `stream-event-adapter.ts:62` | toAgentEvent default 分支对未知事件静默 return null——新增 Worker 事件类型（如 request_retry 曾经历）忘记登记时无任何告警，排障困难。至少 debug 级 log 一次 |
| RC-12 | `sub-agent-slice.ts:115,149` | `(existing as any).isBackground` / `as any` 绕过 SubAgentState 类型——isBackground 应进正式类型定义 |
| RC-13 | `agent-stream-receiver.ts:104-107` | 协议版本不匹配只 console.warn 后继续丢弃整个 envelope——版本升级期间新旧 Worker/渲染端混跑时表现为"事件全消失"，warn 在生产环境不可见。可考虑上报到日志文件 |

---

## 附：确认无误的设计点

- runId 渲染端预生成 + setStreamingMessageId 先于 await 的时序处理，明确解决了"loop_end 早于注册"竞态（注释清晰）
- rAF 批量 flush text_delta 避免 per-delta re-render，分组逻辑正确
- retry banner 只在四种"证明成功"的事件上清除，避免重试序列中闪烁——考虑周到
- goal_progress/goal_activity 在 targetSessionId 检查前路由，自带 sessionId 不受流式状态影响
- agent-stream-receiver 的 gap 检测（seq 跳变 warn）+ loop_end 清理 seq 表
- cancelStream 取消后持久化 `[cancelled]` 消息，会话重载后状态一致
- sub_agent_slice 的 queued→start→end 全生命周期状态机完整，completedSubAgents 有 30 条上限裁剪
