# iter-v2-20 独立代码审查报告

**审查范围**：`dev/v2-iter-20` 分支上 `main..HEAD` 的所有 `fix*` 提交（16 个），对应 `docs/reviews/review-02~08b` 中列出的问题。
**审查方式**：逐 commit `git show` + 关键文件 `git diff main...HEAD` + 交叉引用当前代码（`AgentRuntimeTools.cs` / `AgentLoop.cs` / `SubAgentExecutor*.cs` / `MemoryPathResolver.cs` / `DbClient.cs` / `SubAgentRegistry.cs` / `MemoryStore.cs` / `SystemPromptCache.cs` / `GoalOrchestratorAdaptive.cs` / `AnthropicMessagesEventParser.cs` / `ToolDispatchRouter.cs` / `renderer/src/stores/chat-store/index.ts` / `DbService.cs`）。
**审查员**：独立只读审查，未修改任何被审文件（本报告除外）。

---

## 逐项结论

### 1. PV-1（WorkerHttpClientFactory + 四 provider）— ✅

- `06287b1`：`WorkerHttpClientFactory.Create` 新增 `bool allowInsecureTls = false` 参数；默认路径不再设置 `RemoteCertificateValidationCallback`，TLS 校验恢复为系统默认。opt-in 语义清晰，注释说明自签场景。
- `54e0a12`：四个 provider（`AnthropicMessagesProvider` / `OpenAIChatProvider` / `ProviderTestService` / `PersonaGenerator`）全部改为 `WorkerHttpClientFactory.Create(...)`，旧的 `ServerCertificateCustomValidationCallback = (_,_,_,_) => true` 全部移除。
- **副作用观察（不阻断）**：`AnthropicMessagesProvider` 与 `OpenAIChatProvider` 显式传 `allowAutoRedirect: false`，而工厂默认 `allowAutoRedirect = true`——这是一个行为变化（provider 侧不再跟随重定向）。考虑到 LLM provider 端点通常不需要跟随跳转，此选择合理，但值得记录。
- 分层：Agent/Persona 层引用 Infrastructure 层的 `WorkerHttpClientFactory`，符合 AGENTS.md 分层方向（Infrastructure → Agent 允许）。

### 2. MB-1（MemoryPathResolver SSH scope）— ✅

- `fb64e2e`：`ResolveRoot` 对 `project:ssh:{projectId}` 增加了五重前置校验：空串、`\`、`/`、`Path.IsPathRooted`、`..` 子串。
- 随后做 `Path.GetFullPath` + 前缀比较，且使用 `StringComparison.OrdinalIgnoreCase` 覆盖 Windows 大小写敏感问题；前缀拼接了 `Path.DirectorySeparatorChar`，因此 `C:\Users\projectsX\.wishful-claw\projects\foo` 这类"目录名恰好包含 projects 子串"的绕过不会命中。
- 由于前置校验已经拒绝所有分隔符和 rooted 路径，`Path.GetFullPath` 在此分支上只做大小写/冗余分隔符规范化，不会改变路径层级，前缀比较在 Windows 下正确。

### 3. TL-6（ToolCallProcessor DefaultModeApprovalTools）— ✅

- `1c88b81`：`NotebookEdit` 加入审批集（合理，它是重写 `.ipynb` 的写操作）；`Monitor` 从审批集移除（合理，它是只读观察）。变更范围严格限定在 `DefaultModeApprovalTools` 集合字面量，无副作用。

### 4. AL-1（AgentRuntimeTools ActiveSessionRuns 互斥）— ❌

**核心互斥意图正确，但清理路径有严重缺陷，且未覆盖子 agent 场景。**

- 加锁点（`RunAsync` 入口 `ActiveSessionRuns.TryAdd(sessionKey, 0)`）：✅ 正确，空 `sessionId` 豁免。
- **清理路径缺失（❌ 阻断）**：`ActiveSessionRuns.TryRemove` 只出现在外层 `catch (Exception ex)` 分支（`AgentRuntimeTools.cs:97-103`），即 `ExecuteRunAsync` 抛异常时才清理。**正常完成路径**（`ExecuteRunAsync` 无异常返回）不会删除 session 键——`ExecuteRunAsync` 的 `finally`（第 291-296 行）只清理 `ActiveRuns` / `RunSlots` / `state.Dispose()`，没有 `ActiveSessionRuns`。结果：主会话成功跑完一次 run 后，session 键永久占用，后续任何同 session 的 run 都会被拒绝（"Session already has an active agent run"），直到 worker 重启。
- **子 agent 未纳入互斥（⚠️ 设计缺口）**：`SubAgentExecutor.ExecuteForegroundAsync`（第 118 行）与 `ExecuteBackgroundAsync`（第 31 行）都用 `new AgentRuntimeRunState(childRunId, parentState.SessionId)` 直接构造子 run 状态，**绕过了 `AgentRuntimeTools.RunAsync`**。因此：
  - 子 agent 不会在 `ActiveSessionRuns` 中登记，也就不会被主 run 阻塞；
  - 反过来，主 run 也不会因为子 agent 在跑而阻塞；
  - 而 `AgentLoop.ExecuteLoopAsync`（第 48-50 行注释）正是担心"主会话与 background 子 agent 共享 SessionConversation 会交错"——但 AL-1 的互斥并没有保护这条路径。
  - 子 agent 的 conversation 隔离靠 `AgentLoop.cs:58-61` 的 `__subagent__{runId}` / `__goal__{goalContextId}` key，所以**不会误触发**互斥（因为它们根本不进 `RunAsync`），但**互斥也没保护到它们**。
- **连带暴露的既有问题**：`ExecuteRunAsync` 正常返回时 `RunSlots.Release()` 也未调用（finally 中只在异常路径被外层 catch 触发），这是 AL-1 之前就存在的 run 槽泄漏，AL-1 未修复也未加剧。

**建议**：把 `ActiveSessionRuns.TryRemove` 挪到 `ExecuteRunAsync` 的 `finally`（与 `ActiveRuns.TryRemove` 并列），并决定是否把子 agent 也走 `RunAsync` 或改用 `SessionConversationManager` 层面的 per-conversation 锁。

### 5. DB-1（DbClient.Initialize 加锁）— ✅

- `442207b`：`lock (InitLock)` 包住整个 `Initialize` 方法体，`_initialized` 双检仍在 lock 内（略保守但安全）。并发首次初始化被正确串行化，不会重复建表/迁移。锁是 `static readonly object`，无死锁风险。

### 6. SA-1 / SA-7（BackgroundSubAgentRegistry 淘汰 + 排序）— ✅

- `e97b6b0`：`EvictOldTerminalRecords` 只在 `Complete` / `Fail` / `Cancel` 后触发，按 `CompletedAt` 倒序保留最近 100 条终态记录，running 记录永不淘汰——语义正确，避免长生命周期 worker 内存无限增长。
- `GetAll` 改为 `OrderByDescending(r => r.StartedAt)`，返回稳定顺序，符合 LLM 列表确定性要求。
- 无副作用：淘汰逻辑只作用于 `_records`，不影响正在运行的子 agent。

### 7. SA-2 / SA-6（SubAgentExecutor.Background.cs）— ✅

- `1c7ee53`：`cancellationRegistration` 被保留并在 background task 的 `finally` 中 `Dispose`（第 179 行），避免父 CTS 回调在子状态 Dispose 后触发 `ObjectDisposedException`。
- `catch (Exception ex)` 分支内的 `EmitAsync` 被 `try/catch` 包裹并降级为 `WorkerLog.Warn`（第 149-169 行），防止死传输导致未观测任务异常。
- **小观察（不阻断）**：`catch (OperationCanceledException)` 分支（第 125-141 行）的 `EmitAsync` 没有同样的兜底。若取消时传输已死，该异常会冒泡到外层（外层没有 catch），最终被 `Task.Run` 忽略——不会 crash，但会丢失一次 `sub_agent_end` 事件。属于可接受边界情况。

### 8. SA-3（SubAgentRegistry ConcurrentDictionary）— ❌

- 改为 `ConcurrentDictionary` + `CacheLock` 保护 `_allCache` / `_namesCache`：✅ 解决了原 `Dictionary` 的并发读取/懒初始化撕裂问题。
- **`Unregister` 实现错误（❌ 阻断）**：
  ```csharp
  if (((ICollection<KeyValuePair<string, SubAgentDefinition>>)_agents).Remove(
      new KeyValuePair<string, SubAgentDefinition>(name,
          _agents.TryGetValue(name, out var d) ? d : null!)))
  ```
  `ConcurrentDictionary` 没有覆盖 `ICollection<KeyValuePair<K,V>>.Remove`，实际调用的是 `DictionaryBase` 的默认实现，依赖 `KeyValuePair.Equals`——而 `SubAgentDefinition` 是 `record`，`Equals` 比较的是**内容**而非引用。`TryGetValue` 拿到的 `d` 与字典里的实例是同一个引用，内容必然相等，所以**看起来能删**。但：
  1. 这完全绕过了 `ConcurrentDictionary` 的线程安全语义，退化成非线程安全的基类操作；
  2. 语义上"按 name 删"被实现成"按 (name, value) 内容匹配删"，一旦未来 `SubAgentDefinition` 出现内容相等但语义不同的实例，行为会错；
  3. 更严重的是，如果 `TryGetValue` 返回 false（name 不存在），会构造 `new KeyValuePair(name, null!)`，`Remove` 返回 false，逻辑上"没删"是对的，但 `null!` 掩盖了空值。
- **正确做法**：直接用 `_agents.TryRemove(name, out _)`，一行搞定且线程安全。
- 缓存失效路径（`InvalidateCache` 在 lock 内置 null，`GetAll`/`GetNames` 在 lock 内懒重建）：✅ 正确。

### 9. MB-3（MemoryStore per-scope SemaphoreSlim）— ✅

- `064fef7`：`ScopeLocks` 用 `ConcurrentDictionary<string, SemaphoreSlim>` 按 scope 缓存信号量，`WriteMemoryAsync` / `UpsertSectionAsync` / `DeleteSectionAsync` 三个写路径都用 `WaitAsync` + `try/finally Release` 包裹，读路径（`GetStatsAsync` 等）保持无锁。
- 正确解决了主 agent 与子 agent（或手动编辑）并发 read-modify-write 丢更新的问题。
- **小观察（不阻断）**：`SemaphoreSlim` 永不被 Dispose，长期运行下 `ScopeLocks` 只增不减。对正常项目规模可忽略；若担心极端场景，可加 LRU 淘汰。

### 10. AL-2（SystemPromptCache persona 指纹）— ⚠️

- `9e06246`：`ComputeKey` 追加 `GetPersonaFingerprint(personaId, workingFolder)`，取 persona 目录下 `*.md` 的最大 `LastWriteTimeUtc.Ticks` 作为内容指纹。
- **分层**：Agent 层引用 Persona 层——AGENTS.md 明确允许（"Agent 可依赖 Persona"）。实际实现并未 import Persona 层类型，只是读文件系统，因此**没有反向依赖问题**。
- **错误处理**：`try/catch` 兜底返回空串，不会破坏 prompt 构建。✅
- **性能（⚠️ 建议关注）**：`GetPersonaFingerprint` 每次 `ComputeKey` 调用都会做 `Directory.Exists` + `Directory.EnumerateFiles` + `File.GetLastWriteTimeUtc` 系统调用。`ComputeKey` 在 `AgentLoop.ExecuteLoopAsync` 每轮都被调用（`AgentLoop.cs:128`），即**每个 turn 都触发一次文件系统扫描**。单次开销很小（4 个文件），但累积到高频 turn 场景会成为可测量开销。建议把 fingerprint 缓存到 `SystemPromptCache` 内部（例如按 personaId+workingFolder 缓存 ticks，TTL 或 mtime 变化时失效），避免每 turn 重复 IO。
- 语义正确性：`workingFolder` 存在时优先查本地 `workingFolder/.wishful-claw/personas/{id}`，否则查全局——与 `PersonaStore` 的查找顺序一致。

### 11. GL-3（GoalOrchestratorAdaptive "executing" 字面量）— ✅

- `733eddd`：`live.SetCurrent("executing", ...)` → `live.SetCurrent(GoalPlanStatusValues.Active, ...)`。常量替换，语义一致，无副作用。

### 12. PV-2（AnthropicMessagesEventParser await emit）— ✅

- `d6962a2`：`ProcessContentBlockStart` 改为 `async Task ProcessContentBlockStartAsync`，调用方 `await`；`tool_use_streaming_start` 的 `_ = EmitAsync(...)` 改为 `await EmitAsync(...)`。修复了事件顺序（相对后续 `args_delta`）和异常吞没问题。

### 13. TL-5（ToolDispatchRouter IsJsonError）— ✅

- `de80390`：`IsJsonError` 现在要求 `error` 属性存在**且**不是 `Null` / `Undefined` / 空白字符串。符合"error: null 是成功约定"的语义。
- 表达式 `(errorEl.ValueKind != JsonValueKind.String || !string.IsNullOrWhiteSpace(errorEl.GetString()))` 正确覆盖：`Number`/`Boolean`/`Object`/`Array` 都视为"有意义错误"，只有空白字符串被豁免。

### 14. RC-1（renderer handleEnvelope sessionId 优先）— ✅

- `23c58b4`：`handleEnvelope` 先信任 `envelope.sessionId`，`streamingMessages` 反向查找仅作为 fallback。
- **Worker 端 envelope.sessionId 来源验证**：`AgentRuntimeTools.cs:235-240` 构造 `AgentRuntimeStreamEnvelope` 时 `SessionId = state.SessionId`，而 `state` 来自 `RunAsync` 入口的 `sessionId` 参数（第 43 行），即主会话 run 的 envelope.sessionId 就是渲染端发送的会话 id，**相等**。
- 子 agent run 的 `state.SessionId = parentState.SessionId`（`SubAgentExecutor.cs:118` / `SubAgentExecutor.Background.cs:31`），所以子 agent 发出的 `sub_agent_end` 等事件 envelope.sessionId 也是**父会话 id**——这正是 RC-1 修复的背景（reload 后 streamingMessages 丢失时仍能路由回正确会话）。
- **goal_progress 路由**：`chat-store/index.ts:468-471` 明确在 targetSessionId 检查**之前**把 `goal_progress` 路由到 goal store，且注释说明 goal_progress 事件自带 payload 内的 sessionId。RC-1 的改动不影响该路径。✅

### 15. DB-3（DbService.QueryScalar Nullable 支持）— ✅

- `1319b2f`：`Convert.ChangeType(result, typeof(T))` → `Convert.ChangeType(result, Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T))`。两个重载都改了。修复 `InvalidCastException`。
- 边界：`result == null || result == DBNull.Value` 时仍返回 `default!`，与 Nullable 目标类型语义一致（返回 null）。

---

## AGENTS.md 规范交叉检查

- **分层依赖方向**：
  - PV-1：Agent/Persona → Infrastructure（WorkerHttpClientFactory）✅
  - AL-2：Agent →（未 import Persona 层类型，仅读文件系统）✅
  - 未发现反向依赖（Infrastructure/Workspace/Persona 未新增对 Agent 的引用）。
- **AOT 规范**：
  - 所有新增/修改代码未使用 `Activator.CreateInstance`、`Assembly.GetTypes()`、匿名类型序列化、`System.Reflection`。
  - `WorkerResponse.Json` 调用仍使用显式 `JsonTypeInfo`（`AgentRuntimeJsonContext`）。✅
- **错误处理**：
  - DB-1 / SA-2 / SA-6 / AL-2 都用了 `try/catch` 兜底，符合"永不因辅助逻辑崩溃主流程"的原则。
  - SA-3 的 `Unregister` 用 `null!` 掩盖空值，属于错误处理反模式（见上）。

---

## 总结论

| 项 | 结论 |
|----|------|
| PV-1 | ✅ |
| MB-1 | ✅ |
| TL-6 | ✅ |
| **AL-1** | **❌** |
| DB-1 | ✅ |
| SA-1/SA-7 | ✅ |
| SA-2/SA-6 | ✅ |
| **SA-3** | **❌** |
| MB-3 | ✅ |
| AL-2 | ⚠️ |
| GL-3 | ✅ |
| PV-2 | ✅ |
| TL-5 | ✅ |
| RC-1 | ✅ |
| DB-3 | ✅ |

- **❌ 数量：2**（AL-1、SA-3）
- **结论：阻断**。AL-1 的 session 互斥键在正常完成路径上不释放，会导致主会话一次 run 后永久锁定；SA-3 的 `Unregister` 走的是非线程安全的基类 `Remove`，违背了"改为 ConcurrentDictionary"的初衷。
- ⚠️ 数量：1（AL-2 指纹每 turn 触发文件系统 IO，建议缓存）。
- 其余 12 项修复正确、完整、无显著副作用。

**建议修复优先级**：
1. **AL-1**：把 `ActiveSessionRuns.TryRemove(state.SessionId)` 从外层 catch 移到 `ExecuteRunAsync.finally`；并决定是否把子 agent 也纳入互斥（或改用 `SessionConversationManager` 层面的 per-conversation 锁）。
2. **SA-3**：`Unregister` 改为 `_agents.TryRemove(name, out _)`。
3. **AL-2**（可选）：在 `SystemPromptCache` 内加一层 fingerprint 缓存，避免每 turn 文件系统扫描。
