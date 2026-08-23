# 代码审查报告 8b：Core Protocol + 记忆 + 人格

> 审查范围：`AgentStreamMessagePackEmitter.cs`、`Workspace/Memory/*`（MemoryStore/PathResolver/RecallService/FtsService）、`Persona/PromptBuilder.cs`
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 路径/查询注入交叉验证
> 说明：全项目持续审查第 8b 部分（最后一份），只记录问题，不附带修复。

---

## §1 高优先级

### MB-1 MemoryPathResolver 的 scope 直接拼路径，可逃逸出预期目录

**位置**：`MemoryPathResolver.cs:29-40`

**问题**：
- SSH scope：`projectId` 原样 `Path.Combine(GlobalRoot, "projects", projectId)`——若 projectId 含 `..\` 或为绝对路径（如 `C:\Users\x`），Path.Combine 遇到 rooted 路径会**丢弃前缀直接返回攻击路径**。projectId 来自会话数据，正常流程是 UUID，但 scope 字符串由调用方拼接（AgentRuntimeGoalExecutor 等处 `project:{workingFolder}` 格式由代码拼装，workingFolder 是用户可选的任意目录）。
- 本地项目 scope 本来就指向用户选的任意 workingFolder，这是设计使然；但 **SSH scope 的本意是收敛到 ~/.wishful-claw/projects/**，被绝对路径穿透后等于失效。
- 写路径（MemoryStore.WriteMemoryAsync → WriteAllText）无任何最终路径校验。

**风险等级说明**：利用前提是恶意 scope 字符串进入调用链，而 scope 由内部代码构造而非 LLM 输出——当前是防御深度问题而非可直接利用漏洞。但记忆工具链路长（工具输入→scope 拼装→文件写），一处疏忽就升级。

**建议**：ResolveRoot 出口做 `Path.GetFullPath` 后校验前缀在预期根内；拒绝含路径分隔符的 projectId。

---

## §2 中优先级

### MB-2 MemoryFtsService 的 FTS MATCH 参数未转义，用户查询语法错误静默降级

**位置**：`MemoryFtsService.cs:25-47`

**问题**：
- FTS5 MATCH 直接用原始查询串：用户消息含 `"`, `(`, `)`, `*`, `NEAR`, `AND/OR/NOT` 等 FTS 语法字符时，MATCH 抛 SqliteException → **catch 吞掉** → 走 LIKE fallback。
- LIKE fallback 用 `%{q}%` 全量扫描 memory_entries——表大时慢查询；且语义与 FTS 不同（子串 vs 分词），召回质量骤降且用户无感知。
- 更隐蔽的：包含 `*` 的合法意图（如搜 `File*Tool`）会被解释为 FTS 前缀通配，行为"碰巧可用但不可预测"；双引号包裹短语则可能改变整个查询含义。
- trigram tokenizer 要求查询 ≥3 字符才有意义，短查询必然空结果走 LIKE——这部分是设计内，但注释没说。

**建议**：把用户查询转成安全的 FTS 查询（每词加双引号），或 FTS 失败时区分"语法错"与"无结果"，前者 warn 日志。

### MB-3 MemoryStore 全部读改写无锁，并发写丢更新

**位置**：`MemoryStore.cs:39-61 UpsertSectionAsync/DeleteSectionAsync`

**问题**：
- Upsert/Delete 都是 读全文→内存修改→全量覆写，无 lock、无文件锁、无版本检查。
- 并发场景：主 agent 与子 agent 同时写 MEMORY.md（不同 scope 不冲突，同 scope 会）；或用户在编辑器手改 MEMORY.md 同时 agent 写入——后写覆盖先写，**丢失一方改动且无提示**。
- 对比：ConfigStore 有 lock(Sync) 保护同类读改写。MemoryStore 是 Workspace 层独立类，没有对齐。
- 另外 `GetStatsAsync` 里 `File.ReadAllText`（同步）混在异步 API 里，小问题。

**建议**：按 scope 加静态 SemaphoreSlim；或引入内容版本号检测冲突。

### MB-4 PromptBuilder 的 MEMORY.md 全量注入 prompt，与"记忆必须被用上"原则冲突

**位置**：`PromptBuilder.cs:74-78 BuildMemoryContext` + `SystemPromptCache`

**问题**：
- MEMORY.md 内容作为 system prompt 固定段注入，且经 SystemPromptCache 缓存——**会话中途的记忆写入不会反映到 prompt**（MemoryUpdateQueue 的 turn-tail note 只是个补丁桥接）。
- 项目原则（AGENTS.md）明确说"不靠 System Prompt 全量塞入，Agent 通过工具主动检索读取"。BuildMemoryContext 是残留的全量塞入路径：MEMORY.md 大时挤占预算（不受 20k persona budget 管，是独立段），且缓存导致陈旧。
- 双通道（prompt 注入 + recall 工具）并存还造成重复：同一记忆既在 system prompt 又可能被 recall 注入 user message。

**建议**：要么删 BuildMemoryContext 改纯工具检索，要么给它套 characterBudget 并接受陈旧性（文档化）。当前状态是最差的组合：全量+陈旧+重复。

### MB-5 AgentStreamMessagePackEmitter 的 CountEventProperties 与 WriteEvent 手工同步

**位置**：`AgentStreamMessagePackEmitter.cs:52-96 + 98-140+`

**问题**：
- MessagePack map header 需要"实际写入的字段数"，实现方式是 CountEventProperties 数一遍 nullable 字段、WriteEvent 再写一遍——**同一份字段清单维护两处**。
- 新增 StreamEvent 字段（如 iter-19 加的 SessionCacheHit/SessionCacheMiss/UsageSource——注意！L96 之后是否写了这三个字段？从已读部分看 WriteOptionalUsage 存在，但 SessionCacheHitTokens 在 Usage record 内部随 usage 序列化，UsageSource 也是——需确认 emitter 的 WriteOptionalUsage 是否包含新字段；若 Count 和 Write 各漏一半，map header 计数错误会导致**整包解码失败**，前端报 "Failed to decode"）。
- 这是结构性脆弱：每次加事件字段的 PR 都要人肉保证两处一致，编译器帮不上忙。
- 若计数与写入不一致，MessagePack map 声明 N 实际写 N±k，下游 decoder 要么抛错要么静默错位——后者是灾难性的难排查。

**建议**：改为先写入临时 buffer 数出真实键值对数再写 header（两次遍历自动化），或换 map-less 编码（数组交替 key/value），消灭手工计数。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| MB-6 | `MemoryRecallService.cs:46-48` | 预算判断用 `sb.Length >= budget` 在循环头检查——单条 hit 的 content 截断到 2000 字符后才追加，可能超出 budget 最多 2000 字符（budget 默认 4000，最坏 6000）；末尾虽有整体截断兜底，但中间条目可能被拦腰截断产生半行 |
| MB-7 | `MemoryRecallService.cs:49` | `hit.UpdatedAt == default` 判断——UpdatedAt 从 DB 来的是 `FromUnixTimeSeconds(0)` 即 default，条件恒真输出空串；字段设计上"0 表示未知"的约定散落两处 |
| MB-8 | `MemoryStore.cs:18,45` | 初始化模板 `# Long-Term Memory\n` 硬编码三处（Ensure/Upsert fallback），应常量化 |
| MB-9 | `MemoryFtsService.cs:90 EscapeSql` | 手工单引号转义用于 scopeFilter 插值——scope 是内部构造的所以实际安全，但 `$"...{scopeFilter}"` 插值 SQL 的模式本身危险，statusFilter 是常量无害。统一参数化为 @scope 更稳 |
| MB-10 | `PromptBuilder.cs:24` | DefaultCharacterBudget=20000 字符 ≈5-7k token，占 200k 窗口 3% 合理；但与 ContextCompression 的 reserved output (20k tokens) 无联动校验，超小窗口模型（8k context）配置下 system prompt 本身就爆窗——provider.contextLength 未参与 prompt 预算 |
| MB-11 | `PromptBuilder.cs:62` | sessionMode==goal 注入 goal prompt 用 WorkerLog.Info 每次构建都打——经 SystemPromptCache 缓存后频率低，可接受；但 Bootstrap profile 下 LoadPersonaDocuments 是否跳过已由 L67 保证，逻辑正确 |

---

## 附：确认无误的设计点

- MemoryRecallService 给注入记忆加了 untrusted data 警示头（防提示注入的意识到位）
- recall 按 scope 隔离不跨域合并，避免全局噪音污染项目上下文
- ContextBudgetPlanner 抽象了 token/char 双预算
- FTS5 trigram + external content 方案对中文友好（trigram 免分词），触发器同步在 DbClient 初始化完整建立
- Emitter 的 camelCase 字段名与前端 decoder 对齐，optional 字段省略策略节省带宽
- PromptBuilder 分段顺序经过设计（SSH/Project context 提前防遗漏，goal mode 先于 persona）
- persona 文档字符预算截断有 Debug 日志记录被截断的文档名

---

# 全项目审查总结（报告 2-8b 汇总）

| 报告 | 模块 | 高 | 中 | 低 |
|---|---|---|---|---|
| 02 | 子 agent | 3 | 4 | 6 |
| 03 | AgentLoop/运行时 | （见文档） | | |
| 04 | Provider 层 | （见文档） | | |
| 05 | 工具执行器 | 1 | 5 | 6 |
| 06 | Goal 编排 | 2 | 6 | 8 |
| 07a | 渲染端核心 | 1 | 5 | 7 |
| 07b | Electron 主进程 | 1 | 3 | 8 |
| 08a | Db/Storage | 1 | 4 | 7 |
| 08b | Protocol/记忆/人格 | 1 | 4 | 6 |

**跨模块反复出现的模式**（修复时应一并考虑）：

1. **静态字典只增不清**：BackgroundSubAgentRegistry(SA-1)、lastSeqByRun(RC-4)、pendingEvents(RC-5)、ActiveGoals/PendingGoals(GL 系列)——缺统一的"注册表 + TTL/上限"基建。
2. **状态词汇表多源**："completed" vs "complete"(GL-1)、GoalFileTools 图标映射(GL-3)、paused 死状态(DB-9)——需要单一 Status 常量源并禁止字符串字面量。
3. **best-effort 边界不一致**：DB 物化有失败上抛，文件归档裸奔(GL-5)；有的 catch{} 静默(GL-9)，有的吞异常降级(MB-2)——应定义统一的 best-effort 规范。
4. **临时资源生命周期**：EmitGoalEventAsync 每次 new RunState 不 Dispose(GL-2)、Worker 无优雅关闭(EM-1)——进程内与跨进程的资源收尾都需要补课。
5. **日志隐私**：渲染端 sendMessage 全文落盘(RC-7)、console-message 转发(EM-5)——日志规范缺脱敏约定。
