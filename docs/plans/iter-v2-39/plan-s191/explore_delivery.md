# explore_delivery.md — 多 run 并发下 `sub_agent_end` 的投递勘测

- **任务**：只读勘测。确认多 run 并发时，Worker 的 `sub_agent_end` 到底能不能、经由什么通道送达渲染端；给出实证或明确「无法取证」，**不停留在代码推定**。
- **范围**：`D:\claw\wishful-claw`（Windows / PowerShell 5.1）。**未改任何代码、未 commit、未跑构建/测试。** 唯一新增产物即本文件。
- **背景**：`docs/plans/iter-v2-39/changelog.md:664` 写的「父 run finalize ⇒ `sub_agent_end` 必丢」与该文件注释里的「父 run 一死就断」被实测（父 run 已 finalize 时单个后台子 agent 完成仍能渲染卡片并唤醒父 run）证伪，本轮复核。

---

## ① 一句话结论

`sub_agent_end` 的投递**不依赖父 run 存活** —— `AgentRuntimeTools.EmitAsync` 把事件写进**连接级** transport（`context.EmitMessagePackEventAsync` → 客户端连接 stream），父 run finalize 只执行 `state.Dispose()`（关消息队列 + 释放 CTS），**不阻断 emit**；主进程与渲染端也都按 `envelope.sessionId` / `envelope.runId` **全局路由**，不按 run 的活跃度拦截。故 `changelog.md:664`「父 run finalize ⇒ 事件必丢」的结论**不成立**（就 emit/transport 路径而言）。**依据强度：强。** 至于「并发 3 个只到 1 个」的假说，代码里**找不到明确的丢弃点**，日志侧**无法取证**，需实机验证。

---

## ② 逐问题证据

### Q1. Worker 侧 `EmitAsync` 的完整实现与「父 run finalize 后会不会失败」

**核心实现**：`src/runtime/WishfulClaw.Agent/AgentRuntimeTools.cs:228-269`

```csharp
internal static async Task EmitAsync(
    AgentRuntimeRunState state,
    IWorkerRequestContext context,
    params AgentRuntimeStreamEvent[] events)
{
    if (events.Length == 0) { return; }

    // 子 agent 事件拦截：SuppressTransportEvents=true 时改走 EventObserver，
    // 不进前端 transport。
    if (state.SuppressTransportEvents && state.EventObserver is not null)      // :241
    {
        foreach (var evt in events) { await state.EventObserver(evt); }
        return;                                                               // :247  ← 只有这一条会"提前返回"
    }

    var envelope = new AgentRuntimeStreamEnvelope(
        ProtocolVersion,
        state.RunId,          // :252  父 run 的 RunId（readonly，Dispose 后仍有效）
        state.SessionId,      // :253  父 run 的 SessionId（readonly）
        state.NextSeq(),      // :254  Interlocked 自增，Dispose 后仍可用
        events);              // :255

    var messagePackEvent = AgentStreamMessagePackEmitter.Encode(envelope);    // :257
    await context.EmitMessagePackEventAsync(messagePackEvent.EventName, messagePackEvent.Payload);  // :258
    ...
}
```

**判定条件逐条核对**：

| 关注点 | 结论 | 依据 |
|---|---|---|
| 事件写到哪 | **连接级 transport**（客户端连接 stream），非「父 run 的 per-run transport」 | `context.EmitMessagePackEventAsync` → `WorkerRequestContext.EmitMessagePackEventAsync`（`WorkerRequestContext.cs:60-63`）→ 实参 `WriteMessagePackEventFrameAsync(stream, writeLock, …)`（`LocalIpcWorkerServer.cs:315-316`）→ `WorkerIpcHelpers.cs:89-117`（`stream`+`writeLock` 是**连接**的，不是 run 的） |
| 有没有 `state.IsClosed` 检查 | **没有**。`AgentRuntimeRunState` 根本没有 `IsClosed` 之类的属性 | `AgentRuntimeRunState.cs` 全文（唯一「关闭」是 `_messageQueueClosed`，只影响 `EnqueueMessages`，与 emit 无关，见 `:112-145`） |
| `Dispose()` 会不会让 emit 失败 | **不会**。`Dispose` 只关消息队列 + `_cancellation.Dispose()` | `AgentRuntimeRunState.cs:212-219`。emit 不碰 CTS；`NextSeq()`（`:107-110`）是纯 `Interlocked.Increment`，Dispose 后照常 |
| transport 为 null 会不会 | 不会。`context` 非 null；`_emitMessagePackEventAsync` 是捕获的委托 | `WorkerRequestContext.cs:9-24` |
| 失败时抛错还是静默 | **抛错**（沿 `ValueTask` 上抛），**不静默**。fail 点：`writeLock.WaitAsync(cancellationToken)` 若 token 已取消抛 `OperationCanceledException`；payload 为空则**静默早返回** | `WorkerIpcHelpers.cs:95-99`（`if (Payload.IsEmpty) return;`）、`:108`（`await writeLock.WaitAsync(cancellationToken)`） |
| 用的哪个 token | 后台子 agent 走的是 `context`（= `RunAsync` 的 `backgroundContext`），其 `CancellationToken` = **`ConnectionCancellationToken`**，不是 request token | `AgentRuntimeTools.cs:88`（`context.ForBackgroundOperation()`）→ `WorkerRequestContext.cs:30-37`（把 `CancellationToken` 换成 `ConnectionCancellationToken`）。链路：`RunAsync` → `ExecuteRunAsync(state, backgroundContext)`（`:94`）→ `AgentLoop.ExecuteLoopAsync(..., context)`（`:285`）→ `ToolCallProcessor.ExecuteAsync(turn.ToolCalls, parameters, state, context)`（`AgentLoop.cs:491-492`）→ `ToolDispatchRouter.DispatchAsync(toolCall, state, context, …)` → `SubAgentExecutor` |

**所以「父 run finalize ⇒ 必失败」不成立**：连接 token（`ConnectionCancellationToken` = `clientCts.Token`）只在**客户端（主进程）断连**时才被取消（`LocalIpcWorkerServer.cs:278` `await clientCts.CancelAsync()`）；父 run 的 finalize 完全不动它。

**`SubAgentExecutor.Background.cs:31-32` 里 `childState.SuppressTransportEvents = true` 的语义**：

```csharp
var childState = new AgentRuntimeRunState(childRunId, parentState.SessionId);
childState.SuppressTransportEvents = true;   // :32
...
var collector = CreateCollector(parentState, context, definition.Name, toolCallId);
childState.EventObserver = collector.ObserveAsync;   // :35
```

- 这是给**子 run 自己**的 state 打标：子 run 循环里产生的每一个事件（`text_delta` / `tool_call_start` / …）经 `EmitAsync` 时命中 `:241` 的拦截分支，**改投 `collector.ObserveAsync`**，**不进 transport**（否则会污染父 stream）。
- collector 再把它们**加 `sub_agent_` 前缀**、用 `parentState` + 同一个 `context` 转发（`SubAgentRunCollector.cs:28-121`，例如 `sub_agent_text_delta`、`sub_agent_tool_call`）。
- 关键：`sub_agent_end` 本身是**用 `parentState` 发的**（`SubAgentExecutor.Background.cs:86-92`），而 `parentState.SuppressTransportEvents` 恒为 false ⇒ **走 transport（进前端）**，正好是设计意图。

**后台子 agent 的三处收尾 emit（都在 `SubAgentExecutor.Background.cs`）**：
- 正常完成：`:86-92`（`sub_agent_end`，`parentState` + `context`）。
- 被取消：`:142-151`（同样 `parentState` + `context`，**这个分支的 `EmitAsync` 没有 try/catch 兜底**）。
- 异常失败：`:165-174`（`try`），失败再抛时进 `:176-184` 的 `catch (Exception emitEx)`，降级为 `WorkerLog.Warn("background sub-agent failure emit also failed …")` —— **这才是唯一会写进日志的 emit 失败痕迹**。

**「父 run 已 finalize」时的注入/缓冲逻辑**（`:100-130`）：
```csharp
injected = parentState.EnqueueMessages(...) > 0;   // :106
if (!injected) {
    BackgroundSubAgentNotifications.Add(parentState.SessionId, notificationMsg);   // :126
    WorkerLog.Info($"background sub-agent completion buffered session=… (parent run already finalized)");  // :127-129  ← Info 级
}
```
即：父队列关了就缓冲到 session 级通知区，等渲染端 `agent:drain-sub-agent-notifications` 来取（`AgentRuntimeTools.DrainSubAgentNotifications`，`:172-188`）。**注意这条「buffered」日志是 `Info` 级**（对 Q4 关键）。

---

### Q2. 主进程侧：envelope 在哪一层转成 IPC？per-run 还是全局？新一轮 run 后旧 run 的子 agent 事件还能送吗？

**全局订阅，非 per-run。** `src/main/ipc/agent-stream-handler.ts:16-31`：

```ts
export function registerAgentStreamForwarder(): void {
  const worker = getNativeWorker()
  const batcher = new AdaptiveEventBatcher()

  batcher.setHandler((envelope) => {
    for (const win of BrowserWindow.getAllWindows()) {
      safeSendMessagePackToWindow(win, 'agent:stream', envelope)   // :21-23  广播到所有窗口
    }
  })

  worker.onEvent('agent/stream', (payload: unknown) => {           // :26  全局订阅（不是 per-run）
    if (!isAgentStreamEnvelope(payload)) return
    for (const event of payload.events) {
      batcher.push(payload.runId, payload.sessionId, event)        // :29
    }
  })
}
```

- 订阅点是 `worker.onEvent('agent/stream')` —— **全局**，任何 run（含已 finalize 的旧 run）的 envelope 都从这里进来。
- 校验 `isAgentStreamEnvelope`（`agent-stream-codec.ts:55-65`）**只验信封形状**（`v` / `runId` / `sessionId` / `seq` / `events`），**不按事件类型过滤** ⇒ `sub_agent_end` 不被剔除。
- 批处理器 `AdaptiveEventBatcher`（`adaptive-event-batcher.ts:45-66` + `batcher-codec.ts:46-64`）：只累计 `text_delta` / `thinking_delta` / `tool_use_args_delta`；**其余一律 `default: return false` → 先 flush 再直通**。`sub_agent_end` 属「控制类」，**直通**。

**渲染端接收**（`src/renderer/src/lib/ipc/agent-stream-receiver.ts`）：
- 有 `subscribe(runId, cb)`（`:70-84`，per-run）和 `subscribeAll(cb)`（`:86-91`，全局）；但 chat-store 走的是 **envelope 级 `start(cb)`**（`:102-105`）。
- `acceptEnvelope`（`:111-150`）**只校验协议版本**（`:115`），然后分发；**没有任何「run 是否仍活跃」的判定**。`loop_end`/`error` 只清理 `lastSeqByRun`（`:147-149`）。
- chat-store 的接线：`chat-store/index.ts:2240-2244` `getAgentStreamReceiver().start((envelope) => handleEnvelope(envelope))`。

**结论**：**同一 session 起了新一轮 run 后，上一轮 run 的子 agent 事件照送达**。通道是连接级/全局，不随 run 结束而关。唯一注意点：批处理器以 `runId` 为键复用 accumulator 并**重写 seq**（`:130-141`，`acc.seq++`）；旧 run 在 `loop_end` 时已被 `dropRun`（`:63-65`），随后旧 `runId` 上来的 `sub_agent_end` 会**新建** accumulator 从 `seq=0` 起 —— 渲染端也在 `loop_end` 删了 `lastSeqByRun`（`:147-149`），**两侧对齐，不误报 gap、不丢事件**。

---

### Q3. 渲染端 `handleEnvelope`：`targetSessionId` 怎么推导？多 run 并发会否推错/推空？

`src/renderer/src/stores/chat-store/index.ts:654` `handleEnvelope:`，关键在 `:664-716`：

```ts
// RC-1: the envelope carries its sessionId from the worker — trust it first.
let targetSessionId: string | null = (envelope.sessionId ?? '').trim() || null   // :669

if (!targetSessionId) {                                                          // :671
  for (const [sid, msgId] of Object.entries(state.streamingMessages)) {
    if (msgId === envelope.runId) { targetSessionId = sid; break }               // :672-677  兜底反查
  }
}
...
if (!targetSessionId) return                                                     // :716  门
```

- **来源优先 `envelope.sessionId`**（`:669`），兜底才用 `streamingMessages` 按 `runId` 反查（`:671-678`）。
- `envelope.sessionId` 由 Worker 在 `EmitAsync` 里写成 **`state.SessionId`**（`AgentRuntimeTools.cs:253`）—— 对子 agent 的 `sub_agent_end`，即**父 run 的 sessionId**。
- **多 run 场景分析**：
  - 正常 chat run，`sessionId` 恒非空 ⇒ `targetSessionId` 直接命中，**不推空**。
  - 同 session 里父 run finalize、起新一轮 run：旧 run 的子 agent `sub_agent_end` **仍带同一个 sessionId** ⇒ 命中该 session，**不推错**（AL-1 也保证「同 session 同一时刻只有一个主 run」，`AgentRuntimeTools.cs:25-28,72-82`）。
  - 会推空的情形：`sessionId` 为空（空 sessionId 的 run，见 `:74` 豁免）**且** `streamingMessages` 反查不到该 `runId`（父消息已不在流式表里）⇒ `:716` 丢弃。**这是唯一的「会话路由丢弃点」，与「并发 run」无直接关系，而与「空 sessionId / 消息已收尾」有关。**
- 子 agent 分支在门之后（`:842-872`）：`sub_agent_end` 时读 `activeSubAgents[toolUseId]` 得 `sa`，`wakeSessionId = targetSessionId ?? sa?.sessionId`（`:853-854`），若 `sa?.isBackground && wakeSessionId` 则 `backgroundSubAgentCompletions.emit(...)`（`:855-862`）**触发唤醒 hook**；随后 `handleSubAgentEvent(subEvent, targetSessionId)`（`:866`）落卡片。
- **代码注释本身已陈述设计意图**（`:848-851`）：「后台子 agent 的父 run 可能在它跑完之前就 finalize 了……**事件本身却照常送到渲染端**」—— 与 Q1/Q2 的代码路径一致。

**唤醒链**（`use-background-subagent-wakeup.ts`）：监听 completion → `pendingSessions.add(sessionId)` + `scheduleDrain()`（`:158-162`）；`drainPendingSessions` 里 **`if (hasActiveSessionRunForSession(sessionId)) continue`**（`:134`，主 run 活跃就先挂着，等它空闲再补唤醒，`:130-138`）；空闲则 `wakeSession` → `drainBufferedReports`（`:46-48`，`agent:drain-sub-agent-notifications`）→ `sendMessage` 起新一轮（`:103-123`）。**多份报告在同一次 drain 里一次性取回、合成一条唤醒消息**（`:94-101`）。`wakeSession` 内也再判一次 `hasActiveSessionRunForSession`（`:81`）。

---

### Q4. 实证材料：2026-10-12 日志

**日志文件**：`C:\Users\龚翼\.wishful-claw\logs\2026-10-12.log`（154352 字节，638 行；本环境**可读**）。

**先钉死日志级别**（这决定哪些行根本没落盘）：
- 该文件级别标记计数：`[WARN] = 629`，`[ERROR] = 2`，**`[INFO] = 0`，`[DEBUG] = 0`，`[TRACE] = 0`**。
- `WorkerLog` 默认最低级别 = **WARN**（`src/runtime/WishfulClaw.Core/Protocol/WorkerLog.cs:119-134`，`:26-27`）；打包版由 `native-worker.ts:466-473` 显式传 `'warn'`（`app.isPackaged ? 'warn' : 'info'`）。当前运行的是打包版（日志里路径为 `C:/Program Files/WishfulClaw/resources/app.asar/...`）。

**⇒ 关键推论**：要找的三条里，**两条是 `Info` 级、根本不落盘**：
- `background sub-agent completed …`（`SubAgentExecutor.Background.cs:132-136`）＝ **Info**
- `background sub-agent completion buffered … (parent run already finalized)`（`:127-129`）＝ **Info**
- `drained background sub-agent notifications …`（`AgentRuntimeTools.cs:183-184`）＝ **Info**
- `agent run finalized …`（`AgentRuntimeTools.cs:324`）＝ **Info**

唯一会落盘的失败痕迹是 **`background sub-agent failure emit also failed …`（`:181-183`，Warn）**。

**实际检索结果（真实、逐条，非编造）**：

| 检索词 | 范围 | 命中 |
|---|---|---|
| `background sub-agent` | **全库所有 `*.log`** | **0** |
| `failure emit also failed` / `failure emit` | 全库所有 `*.log` | **0** |
| `completion buffered` / `drained background` / `DrainSubAgent` | 全库所有 `*.log` | **0** |
| `agent run finalized` | 2026-10-12 | **0**（仅 09-04～09-10 的旧日志有，说明旧版曾记 Info，此后默认 WARN） |
| `[INFO]` / `[DEBUG]` / `[TRACE]` | 2026-10-12 | **0 / 0 / 0** |

**2026-10-12 里与子 agent 有关、真正落盘的，只有 13 行「tool output truncated」（全是 WARN）**，其中 **3 个是后台（`subagent-bg-`）runId**，逐行摘录：

```
227: [2026-10-12T10:35:44.660Z] [WARN] [worker] [WishfulClawWorker][2026-10-12T18:35:44.6598053+08:00][WARN] agent tool output truncated runId=subagent-bg-call_00_3lxkoarsmu1z25v5ihf30yof-d2a4d845885247fcb33f90dcb313b801 tool=Read originalBytes=38911 truncatedBytes=32856
246: [2026-10-12T10:37:21.434Z] [WARN] [worker] [WishfulClawWorker][2026-10-12T18:37:21.4364894+08:00][WARN] agent tool output truncated runId=subagent-bg-call_00_ptlwhiok07ofhsza94h4t7lr-c972ff5c1d024e62a7add4c685cedff4 tool=Grep originalBytes=39753 truncatedBytes=32767
355: [2026-10-12T11:24:48.615Z] [WARN] [worker] [WishfulClawWorker][2026-10-12T19:24:48.6158992+08:00][WARN] agent tool output truncated runId=subagent-bg-call_00_5bh4zkj59cqlzz09a2zideo9-d9e696f908aa4cc5b8d50b416a3d8954 tool=Bash originalBytes=37828 truncatedBytes=32767
```

（另有前台子 agent：`:529,570,574,575,588,593,595,598,601` 的 `runId=subagent-call_00_k0g5jlz…`（20:02–20:07），`:616` 的 `runId=subagent-call_01_uvcpg…`（20:12）—— 均为前台，非本议题。）

**判定**：
1. **「并发 3 个那次走了 injected 还是 buffered」→ 无法取证。** 决定这条的两行都是 **Info 级**，打包版默认 WARN **不落盘**；日志里也没有任何能反推它们的中间痕迹。
2. **有没有 emit 失败痕迹 → 没有（弱证据，但不为零）。** 唯一落盘的失败行 `failure emit also failed`（Warn）在全库 0 命中 ⇒ **本轮未观测到 `EmitAsync` 失败**。这与 Q1「emit 不依赖父 run 存活、不会因 finalize 抛错」的代码结论**一致**。
3. 上述 3 个后台 `subagent-bg-` runId 的时间跨 18:35–19:24（非严格同时），**不能据此证明「3 个真正并发同一时刻」**。

**额外旁证（非日志）**：`data.db`（`C:\Users\龚翼\.wishful-claw\data.db`，只读打开）**没有 `sub_agent_runs` 表**（全表清单里无该表）。`changelog.md:664` 提到的「DB `SubAgentStatus` 里 5 个子 agent 全 `completed`」在本环境**未能复现**（该表/该 view 不在 data.db；可能在别的库或别的存储，**未在本轮取证**）。

---

### Q5. 结论

**父 run finalize ⇒ 事件其实「能发」，不是「发不出」；此前「必丢 / stream 已不可用」的结论错在把 transport 当成了 per-run。** 渲染端也不以 run 活跃度拦事件（只按会话路由）。**依据强度：强**（emit→transport→主进程→渲染端四条链路全部代码可证，且与「单后台子 agent 完成后仍能渲染+唤醒」的实测吻合）。

**`changelog.md:664` 需要订正**：它把「卡片不收敛」归因于「`sub_agent_end` 走父 run 的 IPC stream、父 run finalize 后不可用」，但：
- emit 用的是**连接** stream（`WorkerIpcHelpers` 的 `stream`/`writeLock`），finalize 不关它；
- `state.Dispose()` 只关消息队列、释放 CTS，不影响 emit；
- 主进程/渲染端都是**全局/连接级**转发与分发。

**「并发 3 个 → 只到 1 个」这条假说**：**代码里未找到能解释它的丢弃点**（Q1–Q3 的每一处门槛都与 run 并发无关；唯一会话路由丢弃点是「空 sessionId + 反查失败」，见 Q3）。**当前无法取证，需实机验证。**

---

## ③ 判断与依据强度

| 命题 | 判断 | 强度 | 依据 |
|---|---|---|---|
| 父 run finalize 后 `EmitAsync` **不会**因 run 死亡而失败 | **成立** | **强** | `AgentRuntimeTools.cs:228-269` + `AgentRuntimeRunState.cs:107-110,212-219` + `WorkerIpcHelpers.cs:89-117` |
| event 走的是**连接级** transport（非 per-run） | **成立** | **强** | `WorkerRequestContext.cs:30-63`、`LocalIpcWorkerServer.cs:304-320` |
| 主进程/渲染端**不按 run 活跃度**拦事件 | **成立** | **强** | `agent-stream-handler.ts:16-31`、`agent-stream-receiver.ts:111-150` |
| 「同 session 起新 run 后旧 run 的子 agent 事件仍能送达」 | **成立** | **强** | 同上 + `chat-store/index.ts:664-716`（按 `sessionId` 路由） |
| 「并发 3 个只到 1 个」 | **未证实，代码无对应丢弃点** | **弱**（假说） | 未找到；日志无法取证 |
| 本轮是否出现 `EmitAsync` 失败 | **否（未观测到）** | **中**（只有 Warn 落盘，Info 全丢） | 全库 0 命中 `failure emit also failed` |

---

## ④ 待验证点（都不改代码，供后续实机/取证）

1. **实机复现 3 并发 + 放开日志级别**：dev 下用 `WISHFUL_CLAW_LOG_LEVEL=info`（`native-worker.ts:466-473`）或 `debug`，把 `background sub-agent completed` / `completion buffered` / `drained background sub-agent notifications` 三条 Info 行抓出来，才能判「injected vs buffered」与「3 个是否都 drain 到」。
2. **打开渲染端 MessagePack 轨迹**：`localStorage.setItem('wishfulClaw.msgpackTrace','1')`（`agent-stream-receiver.ts:177-183`）+ 主进程 `WISHFUL_CLAW_DEBUG`；盯 `[AgentStream] Gap detected for run …`（`:120-125`）是否出现 —— 直接验证「是否真有事件没到」。
3. **核 `agent:session-visibility` 有没有 worker/主进程处理器**：当前全仓仅见渲染端 `notifySessionVisibility` 发送（`agent-stream-receiver.ts:93-95`）+ 路由白名单（`messagepack-channel-routing.ts:358`），**未见接收方**。若确为 no-op 则不构成丢弃；若存在隐藏处理器，需再查它是否按可见性过滤事件（一个潜在的并发丢弃点）。
4. **批处理器 seq 语义复核**：父 run `loop_end` → `dropRun` 清 accumulator（`adaptive-event-batcher.ts:63-65`），随后 `sub_agent_end` 重建 `seq=0`；须与渲染端 `lastSeqByRun` 在 `loop_end`/`error` 时删除（`agent-stream-receiver.ts:147-149`）**严格对齐**，否则会出现假 gap 或误判。当前读码对齐，待实机确认无 gap 警告。
5. **`changelog.md:664` 的「DB 5 个子 agent 全 completed」来源**：`data.db` 无 `sub_agent_runs` 表，本环境未复现，需老大确认其出处（是否别的库 / `SubAgentStatus` 工具读的另一处）。

---

## 附：关键 `文件:行号` 索引

- `src/runtime/WishfulClaw.Agent/AgentRuntimeTools.cs:228-269` — `EmitAsync` 全文；`:241-248` 子 agent 拦截；`:250-258` 信封 + emit；`:88` `ForBackgroundOperation`；`:172-188` `DrainSubAgentNotifications`；`:273-326` `ExecuteRunAsync`（`:312-325` finally：`state.Dispose()` + `agent run finalized` Info）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeRunState.cs:25-39`（`SuppressTransportEvents`）/`:89`（`EventObserver`）/`:107-110`（`NextSeq`）/`:112-145`（`EnqueueMessages`/队列关闭）/`:212-219`（`Dispose`）
- `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs:31-32`（`SuppressTransportEvents=true`）/`:35`（`EventObserver`）/`:86-92`（正常 `sub_agent_end`）/`:100-130`（注入/缓冲）/`:142-151`（取消分支，无兜底）/`:165-184`（失败分支 + `failure emit also failed`）
- `src/runtime/WishfulClaw.Agent/SubAgentRunCollector.cs:28-121`（子事件 → `sub_agent_*` 转发）
- `src/runtime/WishfulClaw.Core/Protocol/WorkerRequestContext.cs:30-63`（`ForBackgroundOperation` + `EmitMessagePackEventAsync`）
- `src/runtime/WishfulClaw.Worker/LocalIpcWorkerServer.cs:304-320`（`HandleRequestAsync` 装配 emit 委托）/`:322-366`（`DispatchRequestAsync`）
- `src/runtime/WishfulClaw.Worker/WorkerIpcHelpers.cs:89-117`（`WriteMessagePackEventFrameAsync` / `WritePayloadAsync`：空 payload 早返回、`writeLock.WaitAsync(token)`）
- `src/runtime/WishfulClaw.Core/Protocol/WorkerLog.cs:26-27,119-134`（默认 WARN；`Info` 才写 `[INFO]`）
- `src/main/lib/native-worker.ts:466-473`（打包版 `'warn'`）
- `src/main/ipc/agent-stream-handler.ts:16-31`（全局订阅 + 广播 + batcher）
- `src/main/ipc/batcher/adaptive-event-batcher.ts:45-66`、`batcher-codec.ts:46-64`（`sub_agent_end` 直通、seq 重写）
- `src/shared/messagepack/agent-stream-codec.ts:55-65`（`isAgentStreamEnvelope` 只验形状）
- `src/renderer/src/lib/ipc/agent-stream-receiver.ts:70-150`（`subscribe`/`subscribeAll`/`start`/`acceptEnvelope`）
- `src/renderer/src/stores/chat-store/index.ts:654`（`handleEnvelope`）/`:669-678`（`targetSessionId`）/`:716`（门）/`:842-872`（`sub_agent_` 分支）/`:2240-2244`（`start(handleEnvelope)`）
- `src/renderer/src/hooks/use-background-subagent-wakeup.ts:44-150`（drain + 唤醒；`:134` 活跃 run 时挂着）
- `C:\Users\龚翼\.wishful-claw\logs\2026-10-12.log`（WARN 629 / ERROR 2 / INFO 0）
