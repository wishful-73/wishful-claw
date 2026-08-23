# 代码审查报告 3：AgentLoop 与运行时状态

> 审查范围：`AgentLoop.cs / .Helpers / .MemoryRecall`、`AgentRuntimeRunState.cs`、`AgentRuntimeTools.cs`、`ContextCompression.cs`、`SessionConversation.cs`、`ConversationCodec.cs`、`MemoryUpdateQueue.cs`、`SystemPromptCache.cs`
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 调用链交叉验证
> 说明：全项目持续审查第 3 部分，只记录问题，不附带修复。

---

## §1 高优先级

### AL-1 SessionConversation 的 GetConversation 返回活引用，锁形同虚设

**位置**：`SessionConversation.cs:172-190` + `AgentLoop.cs:86-87, 249-251, 307`

**问题**：
- `GetConversation()/GetWireConversation()` 返回**内部 List 的活引用**，注释明说 "The caller (AgentLoop) mutates this list in place"。
- AgentLoop 拿到引用后全程无锁地 `Add`（assistant 消息 L249、wire L251、tool results L307）。
- 同一 session 的并发 run（用户快速连发两条消息、或 Goal owned-run 与普通 run 并存）会拿到**同一个 List 引用**并发写——`List<T>` 非线程安全，并发 Add 可导致内部数组损坏、Count 与实际元素不一致、枚举时抛异常。
- `_lock` 只保护了 `MessageCount/Version/Initialize/Append/Replace/Clear` 这些方法自身，对"拿引用出去随便改"的模式毫无约束。
- 压缩路径（`Replace`）与 loop 的 `Add` 并发时更危险：Replace 整体替换引用，loop 还持有旧列表继续 Add，改动静默丢失。

**影响**：低概率但后果严重（对话历史错乱、缓存前缀污染、难复现的怪异行为）。当前靠"同一 session 很少真正并发 run"侥幸不出事——Goal 后台运行 + 用户同时发消息的场景可以打破这个假设。

**建议**：要么 GetXxx 返回快照 + 所有变更走加锁方法；要么文档化"单 session 单 run"约束并在 RunAsync 入口强制互斥（同 session 已有活跃 run 时拒绝/排队）。

---

### AL-2 SystemPromptCache 有 Invalidate/Clear API 但全仓零调用

**位置**：`SystemPromptCache.cs:27-35` + 全仓 grep 无调用点

**问题**：
- 缓存 key 含 `userRules`（用户自定义规则文本），但不含"记忆文件内容"。设计注释说记忆变更走 turn-tail note 桥接、下次 session 重建——但 cacheKey 不含记忆内容版本，**下次 session 也是同一个 key，直接命中旧缓存**。
- 用户编辑人格/规则后：personaId 变了会 miss（OK）；但编辑的是 persona 文件本身（id 不变）则永远命中旧 prompt。
- `Invalidate/Clear` 两个公开方法没有任何调用方——人格保存、记忆写入、规则修改都没有触发失效。
- MemoryUpdateQueue 的注释声称 "On the next session, SystemPromptCache rebuilds from disk and picks up the fresh content naturally"，**这个声明是错的**：key 不变就不会 rebuild。

**影响**：用户改了人格设定或记忆后，系统提示词静默保持旧值直到 Worker 重启。属于"功能看起来生效实际没生效"的隐性错误。

**建议**：至少在 PersonaStore 写入、记忆 hot-write 路径调用 Invalidate；或在 ComputeKey 中加入相关文件的 mtime/hash。

---

## §2 中优先级

### AL-3 maxIterations=0（无限循环）缺少总轮次保险

**位置**：`AgentLoop.cs:139-150`

**问题**：
- `maxIterations=0` 表示无限迭代，for 循环唯一出口是模型不再发起 tool call 或用户取消。
- 若模型陷入"工具失败→重试→同样失败"的死循环（如 API 配额耗尽但 ProviderRetryPolicy 在 provider 层已消化、返回错误结果给模型），loop 会无限烧 token。
- 渲染端有停止按钮兜底，但无人值守场景（Goal、channel auto-reply）没有熔断。

**建议**：加一个很大的绝对上限（如 500 轮）作为最后防线，触发时以 `max_iterations` 结束。

---

### AL-4 InjectTransientPrefix 的时间戳注入破坏"首条消息不可变"假设

**位置**：`AgentLoop.Helpers.cs:186-240` + `AgentLoop.cs:137`

**问题**：
- 时间戳在 loop 开始时注入 last user message 并**永久留在历史里**（设计如此，保证前缀稳定）。
- 但注入发生在 `Initialize/Append` 之后、直接改 conversation 列表里的 record——**wireConversation 里对应的消息没有被同步修改**。
- 后续压缩（CompactAsync）用 wireConversation 重建时会丢失时间戳前缀；而未压缩路径下 provider 输入用的是 conversation（含时间戳）。两条路径产生**字节不同的请求体**，压缩一次 = 前缀缓存全失效一次。
- 另外 `<current_time>` 用本地时区 `DateTimeOffset.Now`，跨时区使用（笔记本旅行）会让历史消息时区跳变。

**建议**：注入时同步更新 wire 对应项；或统一从 conversation 重建 wire。时间戳考虑 UTC 或固定时区格式。

---

### AL-5 ContextCompression.SummarizeAsync 失败重试无退避且吞掉具体错误

**位置**：`ContextCompression.cs:360-376`

**问题**：
- `for (attempt < 2 && summary == null)` 立即重试，无退避间隔——429 场景下连续两发都会失败，白白多打一次限流接口。
- 循环结束后 `throw lastErr` 只保留最后一次异常，第一次的错误信息丢失。
- `BuildSummaryRequestBody` 是恒等函数（返回 transcript），死代码。

**建议**：两次尝试间加短退避；聚合两次错误信息；删除死代码。

---

### AL-6 MechanicalFold 兜底过于激进地丢弃上下文

**位置**：`ContextCompression.cs:498-503`

**问题**：
- LLM 总结失败时，fold 区域（可能包含几十条消息、大量代码和决策）被替换为一句 "N earlier message(s) were folded... Ask the user if you need details"。
- 主 agent 失去全部中间工作记录，只能问用户——而用户往往也不知道细节。长任务中途网络抖动一次 summarizer 超时，就会造成严重的上下文断崖。
- 更温和的兜底存在但不被使用：`TruncateMessages`（保留 head+tail）至少保住了最近 12 条消息的实际内容，却从未在 CompactAsync 失败路径中被调用。

**建议**：LLM 总结失败时先降级到 TruncateMessages（保留 tail），MechanicalFold 作为最后手段。

---

### AL-7 会话内存队列（MemoryUpdateQueue）与 ClearSession 不同步

**位置**：`MemoryUpdateQueue.cs` + `AgentRuntimeTools.ClearSession`

**问题**：
- `Clear(sessionId)` 存在但 grep 显示**无任何调用方**（只有 Enqueue 被 memory 工具调用）。
- 用户删除会话时 `ClearSession` 只清了 SessionConversationManager，MemoryUpdateQueue 里该 session 的残留 notes 永久驻留（小泄漏）。
- 更微妙：session 删除后新建同名 id 的概率极低，但 notes 一旦残留会在新会话首轮被注入错误的 memory-update。

**建议**：ClearSession 中同步调用 MemoryUpdateQueue.Clear。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| L1 | `AgentLoop.cs:123` | `WorkerLog.Warn` 打印 sshConnectionId/personaId/projectId 的诊断日志级别不当（每次 run 都 Warn，日志噪音），应为 Debug |
| L2 | `AgentLoop.cs:342-373` | `CreateAutoNotifyInput` + `EscapeJson` 是死代码（EmitLoopEndAsync 已改为 renderer 处理通知，这两个函数无调用方），且手拼 JSON 字符串的方式本身就有转义风险 |
| L3 | `ShouldCompress` L477 | 每次 iteration 都 Warn 级别输出压缩诊断（含完整数字），正常会话每轮都刷，应降为 Debug |
| L4 | `SessionConversationManager` | `__default__` 合成 key 让空 sessionId 的所有 run 共享一个对话——多窗口/异常参数下可能串话。建议空 sessionId 直接拒绝而非兜底 |
| L5 | `EstimateTokenCount`（text.Length/4）| 中文约 1.5~2 char/token，估算对中文严重偏高（把 6000 字中文估成 1500 token 实际约 4000+），压缩触发时机对中文会话不准。TailStart 的预算控制同样失真 |
| L6 | `IsReasoningModel` | 硬编码 o1/o2/o3/o4 前缀，o 系列之后的新模型（如 gpt-5.1 推理版）不会命中；应配置化 |
| L7 | `AgentRuntimeTools.RunAsync` L32 | `RunSlots.Wait(0)` 非阻塞获取配额，满载直接报错。前端收到 quota 错误后的表现取决于 renderer 是否有重试 UI——若没有，用户会看到生硬报错。可考虑短暂排队 |

---

## §4 总体评价

AgentLoop 主干设计成熟：后端持有会话（prefix cache 友好）、子 agent 会话隔离、双信号量并发控制、压缩三级规划（pin/partition/fold）都有清晰的 Reasonix 血统注释。本轮实测发现的"父 run 结束杀子 agent"问题源头就在 EmitAsync 的 observer 分发，已修。

最需要警惕的是 **AL-1（活引用并发写）** 和 **AL-2（SystemPromptCache 失效缺失）**：前者是埋在核心数据结构里的并发雷，后者让"记忆/人格热更新"这一卖点功能实际半失效。两者修复成本都不高，建议优先排入下一迭代。

---

## 附：确认无误的设计点

- 子 agent 会话隔离键 `__subagent__{runId}` 前后台一致，finally 清理到位
- TryCloseMessageQueueIfEmpty 的"队列非空则继续迭代"机制正确支撑了排队消息注入
- ProviderRetryPolicy 在 provider 层消化 429/5xx，与 loop 层职责分离清晰
- 压缩的 PinnedPrefixLen 正确处理了多次压缩叠加（prior summaries 保持 pinned）
- ConversationCodec 的 UTF-8/JSON 双向转换对称，extraContent 透传保留了渲染端扩展块
