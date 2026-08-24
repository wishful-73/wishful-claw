# 合规审查报告：iter-v2-20 plan.md

> 审查对象：`docs/plans/iter-v2-20/plan.md`
> 规范依据：`AGENTS.md`（7 层结构、分层依赖、AOT 规范）、`docs/dev-workflow.md`（plan.md 格式）
> 对照审查报告：`docs/reviews/review-02 ~ review-08b`
> 审查性质：只读审查，未修改任何文件（除本合规报告外）

---

## 1. 步骤是否完整覆盖 plan 目标（对照 review-02~08b 高优先级问题）

✅ **覆盖完整。** 计划中 17 个步骤与用户列出的 17 项必修问题一一对应，SA-5b 与 AL-3 按用户明确指示归入"明确不做"（iter-21/22），未混入本次修复清单。

逐项映射核对：

| 审查编号 | 步骤 | 覆盖 |
|---------|------|------|
| PV-1a（TLS 开关） | 步骤1 WorkerHttpClientFactory | ✅ |
| PV-1b（统一工厂） | 步骤2 四 Provider 收敛到工厂 | ✅ |
| MB-1（路径穿越） | 步骤3 MemoryPathResolver 前缀校验 | ✅ |
| TL-6（NotebookEdit 审批） | 步骤4 DefaultModeApprovalTools | ✅ |
| AL-1（同 session 互斥） | 步骤5 AgentRuntimeRunState 入口互斥 | ✅ |
| DB-1（DbClient 并发初始化） | 步骤6 Lazy<T> | ✅ |
| SA-1（终态无上限） | 步骤7 BackgroundSubAgentRegistry 裁剪 | ✅ |
| SA-2（取消注册泄漏） | 步骤8 finally Dispose | ✅ |
| SA-3（SubAgentRegistry 非线程安全） | 步骤9 ConcurrentDictionary | ✅ |
| GL-2（RunState 泄漏） | 步骤10 GoalContext 长驻 RunState | ✅ |
| MB-3（MemoryStore 无锁） | 步骤11 SemaphoreSlim | ✅ |
| AL-2（SystemPromptCache 失效） | 步骤12 PersonaStore + hot-write 失效 | ✅ |
| GL-1/GL-3（状态词汇表） | 步骤13 GoalPlanStatusValues.Complete + 图标映射 | ✅ |
| PV-2（fire-and-forget） | 步骤14 await EmitAsync | ✅ |
| TL-5（IsJsonError null 误判） | 步骤15 非空判断 | ✅ |
| RC-1（handleEnvelope 会话匹配） | 步骤16 envelope.sessionId 优先 | ✅ |
| DB-3（QueryScalar Nullable） | 步骤17 Nullable 特判 | ✅ |

"明确不做"清单（EM-1/EM-2、RC-2/RC-3、AL-3、AL-6、TL-1/TL-4、SA-4、TL-8/MB-5/RC-9/AL-4/MB-4）与用户指示一致，未越界。

---

## 2. 每步是否有明确的验证检查点

✅ **形式合规。** 17 个步骤均显式包含"验证检查点："字段，且步骤18 提供了 `dotnet build sln + 三份 tsconfig + 启动冒烟` 的总验证。

⚠️ **说明（不阻断）：** 多数检查点为 `dotnet build 零错误` 或 `tsc --noEmit 零错误`，属于编译级验证；对 PV-1（TLS 开关默认关闭）、MB-1（路径穿越拒绝）、SA-3（并发安全）等安全/并发类修复，缺少行为级或单测级验证检查点。步骤3 提到"构造恶意 scope 单测路径逻辑人工核验"是唯一的非编译级检查点，值得肯定。建议在后续执行态为安全/并发类步骤补上针对性单测或人工行为验证（不影响本合规判定）。

---

## 3. 涉及文件路径是否符合 AGENTS.md 项目结构

### 3.1 文件存在性抽查

✅ 抽查 22 个文件路径，20 个命中真实文件（WorkerHttpClientFactory.cs、AnthropicMessagesProvider.cs、OpenAIChatProvider.cs、ProviderTestService.cs、PersonaGenerator.cs、MemoryPathResolver.cs、MemoryStore.cs、ToolCallProcessor.cs、AgentRuntimeTools.cs、DbClient.cs、DbService.cs、SubAgentExecutor.Background.cs、BackgroundSubAgentRegistry.cs、SubAgentRegistry.cs、AnthropicMessagesEventParser.cs、ToolDispatchRouter.cs、PromptBuilder.cs、PersonaStore.cs、GoalOrchestrator.cs、GoalFileTools.cs）。

### 3.2 路径准确性问题

❌ **步骤10 涉及文件 `src/runtime/WishfulClaw.Agent/Goal/GoalContext.cs` 不存在。** `GoalContext` 是 `GoalOrchestrator.cs` 内的嵌套类，并非独立文件。计划写为 `src/runtime/WishfulClaw.Agent/Goal/*` 可以接受，但步骤10 描述"GoalContext 持有长驻 AgentRuntimeRunState"需要明确指向 `GoalOrchestrator.cs`（或其 partial 拆分文件），否则执行方可能新建一个错误的 `GoalContext.cs` 文件。

❌ **步骤12 涉及文件 `src/runtime/WishfulClaw.Persona/SystemPromptCache.cs` 路径错误。** 实际文件位于 `src/runtime/WishfulClaw.Agent/SystemPromptCache.cs`（Agent 层，非 Persona 层）。虽然 `SystemPromptCache` 的失效由 PersonaStore 写入触发（跨层调用），但文件本身属于 Agent 层。计划写为 `Persona/PromptBuilder.cs、PersonaStore.cs + SystemPromptCache.cs` 会误导执行方在 Persona 项目下新建/修改文件，违反 AGENTS.md 分层约定。

❌ **步骤16 涉及文件 `src/renderer/.../chat-store/index.ts` 使用省略号占位。** 实际路径为 `src/renderer/src/stores/chat-store/index.ts`（review-07a 明确定位 `chat-store/index.ts:409-497`）。plan.md 格式要求"涉及文件和模块"应给出可定位路径，`...` 占位不满足。

### 3.3 分层归属核对

✅ 其余文件路径分层归属正确：
- `WorkerHttpClientFactory.cs` → Infrastructure/Http ✅
- `DbClient.cs`、`DbService.cs` → Infrastructure/Db ✅
- `MemoryPathResolver.cs`、`MemoryStore.cs` → Workspace/Memory ✅
- `PersonaGenerator.cs`、`PersonaStore.cs`、`PromptBuilder.cs` → Persona ✅
- `AnthropicMessagesProvider.cs`、`OpenAIChatProvider.cs`、`ToolCallProcessor.cs`、`ToolDispatchRouter.cs`、`SubAgent*`、`Goal*`、`AnthropicMessagesEventParser.cs`、`AgentRuntimeTools.cs`、`SystemPromptCache.cs` → Agent ✅
- `chat-store/index.ts` → renderer ✅

---

## 4. 分层依赖是否正确（无逆向依赖）

✅ **无逆向依赖。** 逐项核对：

- 步骤1/2：Agent（Provider）调用 Infrastructure（WorkerHttpClientFactory）—— Agent → Infrastructure，允许 ✅
- 步骤3/11：Workspace（Memory）内部修改—— Workspace 层内，允许 ✅
- 步骤6/17：Infrastructure（Db）内部修改—— Infrastructure 层内，允许 ✅
- 步骤7/8/9/10/13/14/15：Agent 层内修改—— Agent 层内，允许 ✅
- 步骤4：Agent（ToolCallProcessor）层内修改—— Agent 层内，允许 ✅
- 步骤5：Agent（AgentRuntimeTools）层内修改—— Agent 层内，允许 ✅
- 步骤12：Persona（PersonaStore/PromptBuilder）+ Agent（SystemPromptCache）—— Persona 层代码触发 Agent 层缓存失效属于上层调用下层（Persona → Agent），**此处需留意**：按 AGENTS.md，Persona 不依赖 Agent，但 `SystemPromptCache` 是静态类，Persona 层代码不应直接引用 Agent 层类型。步骤12 描述"PersonaStore 写入与记忆 hot-write 路径调用 Invalidate/Clear"若落在 Persona 层代码中，会构成 Persona → Agent 逆向依赖。

❌ **步骤12 存在潜在逆向依赖风险。** `SystemPromptCache` 位于 Agent 层，而步骤12 计划在 `PersonaStore`（Persona 层）写入路径中调用 `SystemPromptCache.Invalidate/Clear`。按 AGENTS.md 第 136 行"Persona 不依赖 Agent"，此方案会在 Persona 项目引入对 Agent 项目的引用，构成逆向依赖。修复建议：将失效调用放在 Agent 层的 Provider/PromptBuilder 调用链中（Persona 层仅抛事件或返回标记，由 Agent 层消费），或把 `SystemPromptCache` 下沉到 Core/Infrastructure 层。

---

## 5. plan.md 格式（目标/步骤清单/涉及文件/参考源码）

✅ **格式合规。**

- `# Plan: v2-iter-20 — 审查修复 · 安全与运行时健壮性` —— 标题 ✅
- `## 目标` —— 一句话描述修复范围 ✅
- `## 步骤清单` —— 17 个步骤 + 收尾步骤18，均带 `[ ]` 复选框 + 验证检查点 ✅
- `## 涉及文件` —— 列出所有修改文件并标注步骤编号 ✅
- `## 参考源码` —— 说明本迭代无外部源码搬入，符合实际（审查修复型 plan）✅
- 附加"明确不做（留 iter-21/22）"段落 —— 超出格式要求但有助于边界清晰 ✅

---

## 总结论

| 检查项 | 结果 |
|--------|------|
| 1. 步骤覆盖 | ✅ |
| 2. 验证检查点 | ✅（⚠️ 建议补行为级验证，不阻断） |
| 3. 文件路径合规 | ❌ 3 处（GoalContext.cs 不存在 / SystemPromptCache.cs 路径错层 / chat-store 路径省略号） |
| 4. 分层依赖 | ❌ 1 处（步骤12 Persona → Agent 逆向依赖风险） |
| 5. plan.md 格式 | ✅ |

**❌ 项数量：4（3 项路径 + 1 项分层依赖）**

**结论：阻断。** 建议修订以下 4 处后再进入用户确认环节：

1. **步骤10**：将 `Goal/GoalContext.cs` 改为 `Goal/GoalOrchestrator.cs`（或 `Goal/GoalOrchestrator*.cs` partial 集合），明确 `GoalContext` 是嵌套类。
2. **步骤12**：将 `Persona/SystemPromptCache.cs` 修正为 `Agent/SystemPromptCache.cs`；同时调整失效调用位置——避免在 Persona 层代码中直接调用 Agent 层 `SystemPromptCache.Invalidate/Clear`，改为在 Agent 层的 PromptBuilder 调用链或 Provider 初始化路径中触发失效，或把失效机制下沉到 Core/Infrastructure。
3. **步骤16**：将 `src/renderer/.../chat-store/index.ts` 补全为 `src/renderer/src/stores/chat-store/index.ts`。
4. **步骤12（分层依赖）**：同步修订方案，消除 Persona → Agent 逆向依赖。
