# 追加计划：每日记忆自动整理

> 状态：**代码实现完成，待用户验收**（未提交）
> 追加于 2026-08-28，独立于 `plan.md` 的审计修复主线。S1–S9 已完成代码落地与静态/构建验证；运行时人工闭环仍需用户验收。

## 1. 需求

已有主动记忆（会话自动提取写入）+ 主动回忆（工具检索）机制。需补充：**定时自动整理记忆**——去重、合并、过期处理、日志可查。

**用户已定**：
- 触发方式做成设置项，用户自选：**启动后** 或 **凌晨**（默认凌晨 0 点附近）
- 当前记忆形态为"热记忆（MEMORY.md）+ FTS 数据库记忆"，**没有每日记忆文件**，不存在日记文件整理场景
- **整理范围：全局 + 有更新的激活项目**。整理时检查各项目近期（如前一天）是否有会话更新：有更新的项目才纳入整理，有几个处理几个，都没有则跳过项目级整理（全局照常）

## 2. 调研结论

### 2.1 OpenCowork 的记忆整理方案

**结论：OpenCowork 没有定时整理机制**，其方案是"文件分层 + Agent 自维护"：

- OpenCowork 的 `.agents` 结构仅作为调研参考；本项目运行时不使用 `.agents` 作为记忆目录
- 本项目全局记忆使用 `~/.wishful-claw/`，项目记忆使用 `{workingFolder}/.wishful-claw/`
- `MEMORY.md` 是 Hot 热记忆层，但不是全部记忆；SQLite/FTS 是完整数据库记忆层，独立承载存储、检索和 Warm/Cold 状态
- `AGENTS.md` 仅保留人格层行为准则语义，不属于项目记忆层，也不参与根目录协议读取
- 记忆工具（MemoryList/Read/Search）维护的是上述 WishfulClaw 记忆层，不读取 `.agents` 或根 `AGENTS.md`

→ "定时整理"需要自研，OpenCowork 无可抄部分。

### 2.2 我们的现状盘点（已按实际形态修正）

| 能力 | 现状 | 位置 |
|------|------|------|
| 热记忆 | ✅ MEMORY.md（per scope），read/write/upsert/delete 段落级操作 | `Workspace/Memory/MemoryStore.cs`、`Worker/Modules/MemoryModule.cs` |
| FTS 数据库记忆 | ✅ `memory_entries` 表 + `memory_fts`（FTS5），条目带 `priority` / `status` / `updated_at`；检索默认只看 `status='active'`，`include_deprecated` 可回查——**降级标记天然可逆** | `Workspace/Memory/MemoryFtsService.cs`、`DbClient.cs` |
| 主动记忆管线 | ✅ 渲染端：会话触发 → LLM 提取（stage1）→ LLM 巩固合并进 MEMORY.md（phase2 的 `runConsolidation`），带 watermark 去重、undo、记录 | `src/renderer/src/lib/agent/memory-automation*.ts` |
| 主动回忆 | ✅ Agent 工具走 `memory/search`（FTS + LIKE 兜底） | `Agent/Tools/MemoryTools/` |
| 分层降级模型 | ❌ **死代码**：`MemoryTier` Hot/Warm/Cold、dormant 目录路径等只有定义无任何执行代码（`MemoryStore.GetStatsAsync` 里 Warm/Cold 恒为 0），可清理 | `Workspace/Memory/MemoryModels.cs`、`MemoryPathResolver.cs` |
| 每日 rollup | ❌ **旧设计残留空转**：`runDailyMemoryRollup` 读 `memory/{日期}.md`，但当前产品不产生每日记忆文件，实际从不执行；触发器也只是启动后 8 秒一次性 setTimeout | `memory-automation-rollup.ts` |
| 定时基础设施 | ✅ main 进程 cron 调度存在，但面向"拉起对话会话"，不适合静默维护 | `src/main/ipc/reverse-handlers/cron-reverse-handler.ts` |

### 2.3 差距（本需求要填的坑）

1. **没有任何整理动作**：MEMORY.md 只增不减；`memory_entries` 条目只增不减、从不过期
2. **没有触发机制**：需要"启动后 / 凌晨"二选一的用户配置 + 实际调度
3. **顺手清理**：`MemoryTier`/dormant 死代码、空转的 `runDailyMemoryRollup` 残留

## 3. 候选方案

### 3.1 触发器（设置项：启动后 / 凌晨）

新增设置 `memoryOrganizationSchedule`：

| 模式 | 行为 |
|------|------|
| `startup` | 应用启动后延迟若干秒执行一次整理（前提是距上次整理超过阈值，如 20 小时，防止频繁重启重复跑） |
| `nightly` | main 进程每 5 分钟检测一次是否跨过触发时刻（默认 00:00），跨过则通知渲染端执行 |

**两种模式共享离线补偿**：维护"上次整理时间"水位（写配置文件或 DB），启动时发现上次整理不是今天且模式为 `nightly` → 补跑（错过的日期合并为一次，不做逐日回放）。

> 不走现有 `cron:fire`（会拉起对话会话，成本高、有噪音）。

### 3.2 整理动作（整理什么）

**① MEMORY.md 热记忆整理（LLM）**
- 复用 phase2 的 `runConsolidation`，扩一个"纯整理、无新增输入"模式：去重、合并相似条目、压缩冗长表述、保持既有结构
- 产出覆盖回 MEMORY.md，走现有 `ensureMarkdownDocument` + sanitize 保护

**② 记忆分层流转（Hot → Warm → Cold，比重+日期双因子）**
- 用户已定：保留热/温/冷三层，降级由**优先级比重 × 闲置天数**共同决定，不是单纯日期一刀切；过期机制保留（降级不删除）
- 存储全部落在现有 `memory_entries` 的 `status` 字段（不引入文件）：
  - **Hot**：MEMORY.md 段落 + `status='active'` 条目——自动注入与检索优先
  - **Warm**：`status='warm'`——仍参与 FTS 检索/主动回忆，不参与自动注入，排序降权
  - **Cold**：`status='cold'`（即原 deprecated 语义）——默认检索不命中，`include_deprecated` 可回查，可一键恢复升级
- 降级阈值（优先级越高越耐放，具体数值待确认）：
  | 优先级 | → Warm | → Cold |
  |--------|--------|--------|
  | `permanent` | 永不 | 永不 |
  | `lasting` | 90 天 | 180 天 |
  | `standard` | 30 天 | 90 天 |
  | `ephemeral` | 7 天 | 21 天 |
- **回忆复热**：Warm/Cold 条目被检索命中并实际使用时，刷新 `updated_at` 并升回上一层——记忆越用越热，不用才降级（比重的动态部分）
- **热层瘦身联动**：LLM 整理 MEMORY.md 时，过时段落不直接删。每个过期段落必须先成功 append 为当前 scope 的 FTS 条目，再成功批量标记为 `warm`，两步全部成功后才覆盖写 Hot 文件；任一步失败都保留原 `MEMORY.md` 并记录错误。`MEMORY.md` 保持精干；`MemoryStats` 里 Warm/Cold 恒 0 的占位随之填真
- FTS 由 `memory_append`/现有工具链独立维护，不把全部 FTS 条目复制进 `MEMORY.md`；当前 FTS 独立职责是存储、检索和规则分层，没有独立的 FTS LLM 去重/合并实现

**③ 汇总记录**：复用 `MEMORY_AUTOMATION_RECORD` 通道记一条整理报告（合并了几条、降级了几条），记忆管理页可见；全程静默，失败仅写日志。

### 3.3 实现位置

- **编排 + LLM 调用放渲染端**：与现有记忆自动化管线一致，复用 provider 解析、记录、undo 设施
- **DB 操作走现有 Worker 端点**：`memory/update`（已支持改 status）、`memory/search`，无需新增 C# 代码；仅规则筛选可能需要一个"列出过期候选"的查询端点
- 死代码清理（`MemoryTier`、dormant 路径、`runDailyMemoryRollup` 空转残留）随本需求一并删除

### 3.4 反馈与可撤销

- 整理报告入库可见；LLM 整理前的 MEMORY.md 快照留存（复用现有 beforeContent 机制）可撤销；下沉/降级操作逐条可恢复升级

## 4. 待决策点（讨论用）

1. ~~默认触发模式~~ **已定**：触发模式与时刻全部配置化；默认值 `nightly` + `00:00`
2. ~~凌晨时刻~~ **已定**：设置项可调，默认 00:00
3. ~~整理范围~~ **已定**：全局 + 有更新的激活项目（按会话更新时间判定，有几个处理几个）
4. ~~分层阈值数值~~ **已定**：沿用建议值（7/21、30/90、90/180）作为默认，做成设置项可调
5. ~~联动机制~~ **已定**：不能只单向降级——回忆复热 + 热层下沉一期就做；另主动回忆/主动记忆体验优化纳入本计划（参考 D:\claw\openclaw.net，调研已完成，见第 5 节）
5→6. ~~一期范围~~ **已定**：一期全部搞定——触发器 + MEMORY.md LLM 整理 + 分层降级 + 自动提取修复 + 召回改进 + 记忆设置区 + 死代码清理；仅 LLM 合并 DB 条目留二期；实施步骤见第 6 节
6→7. ~~死代码清理~~ **已定**：肯定清理——`MemoryTier` 枚举/dormant 路径/空转 rollup/无调用方的自动运行死代码一并删除（分层概念以 DB status 重新落地，不用文件）
8. ~~体验症状~~ **已确认**：主动回忆"没看到效果"；主动记忆"用户提示才记"——两个根因均已定位，见第 5 节

## 5. 主动回忆/主动记忆体验优化（调研结论）

> 用户反馈：当前体验不佳，参考对象 D:\claw\openclaw.net。

### 5.1 OpenClaw.net 的做法（对比后结论）

**它的主动回忆与我们的实现同构**（我们正是参考它做的）：同样的 FTS 搜索 + 预算截断 + `[Relevant memory]` 不可信数据注入格式。它多出来的只有：

| 能力 | OpenClaw.net | 我们 |
|------|--------------|------|
| 跨作用域回退 | ✅ `memoryRecallPrefix` 搜不到 → 去前缀重搜 | ❌ 项目会话只搜项目，零命中不兜底 |
| 召回参数可配 | ✅ MaxNotes 1–32 / MaxChars 256–100k | ❌ limit=5 / maxChars=4000 写死 |
| retention 清扫 | 30 分钟 sweeper + TTL 天数 + 文件归档（面向 session/branch，非记忆分层） | 无（本计划的整理机制覆盖） |
| FractalMemory | 结构化仓库记忆（MCP 外部插件，默认关）——另一条路线，与本需求无关 | 无 |

→ **照抄 OpenClaw.net 不会解决问题**，它的召回和我们几乎一样；问题在我们自己实现细节的薄弱点。

### 5.2 主动回忆疑似病因（按代码分析，待用户症状确认）

1. **整句搜索**：拿用户整句原话做 FTS 查询，"帮我/谢谢/顺便"等闲聊词稀释 trigram rank，真正相关的记忆排不进前 5 条（`AgentLoop.MemoryRecall.cs` 直接取最后一条 user message）
2. **trigram 最小 3 字符**：短中文查询（如"日志"）零命中 → 落 LIKE 兜底按 `updated_at DESC` 排——变成"召回最新的"而非"召回相关的"
3. **无跨作用域回退**：项目记忆零命中时不回退全局（OpenClaw.net 有此兜底）
4. **无相关性门槛**：低分噪声记忆照样注入——"召回不相关"的直接原因；命中数也恒最多 5 条不随质量伸缩
5. **参数不可调**：注入预算/条数写死，无法按场景调优；`WorkerLog.Warn` 只在日志留痕，UI 看不到召了什么（或没召）

### 5.3 提议的改进（随本计划一期落地）

1. **查询提炼**：召回前先用轻量规则/小模型提关键词（去停用词、取实词），多关键词并行查后合并去重；保留原文兜底
2. **跨作用域兜底**：项目作用域零命中 → 回退搜全局（对齐 OpenClaw.net，结果标注来源）
3. **相关性门槛 + 分层权重**：FTS rank 低于阈值不注入；Hot 条目权重高于 Warm（与分层模型联动）
4. **参数可配**：召回条数上限、注入预算、相关性阈值进设置页（与分层阈值设置项同区）
5. **召回可见性**：会话里以可折叠提示展示"本次召回了哪几条记忆"（或为什么没召回），便于用户感知与调优——交互形式待定，可先只做日志透出到记忆管理页

### 5.4 主动记忆根因（用户症状："用户提示才记"）

**代码实锤：自动触发点根本不存在。**
- `runMemoryAutomationForSession` 全库唯一调用方是 `runManualMemoryAutomationForActiveSession`（手动入口）；`options.manual` 分支、`AUTO_RUN_DEBOUNCE_MS` 防抖、`memoryAutomationMainSessionsOnly` 等"自动运行"设施全部是死代码——会话结束从不自动提取记忆（`memory-automation.ts`）
- 目前记忆入库只剩两条路：用户明确说"记住"时 Agent 调 `memory_append` 工具；用户手动触发整理入口——与用户描述完全吻合

**修复**：会话轮次结束（assistant 回复完成）自动调 `runMemoryAutomationForSession`，尊重现有防抖与开关；触发时机与开关进记忆设置区。

### 5.5 记忆设置区（新增，用户已定：参数全部可配）

设置页新增"记忆"配置区（对齐现有面板模式，锚点导航复用 `section-anchor-nav`），汇总本讨论产生的全部配置项：

| 配置项 | 默认值 | 来源 |
|--------|--------|------|
| 自动整理开关 | 开 | 本需求 |
| 整理触发模式（启动后 / 凌晨） | 待定（决策点 1） | 本需求 |
| 凌晨触发时刻 | 00:00（是否可配待定，决策点 2） | 本需求 |
| Warm 阈值（ephemeral/standard/lasting） | 7 / 30 / 90 天 | 分层模型 |
| Cold 阈值（三档） | 21 / 90 / 180 天 | 分层模型 |
| 主动记忆自动提取开关 + 触发时机 | 开 / 轮次结束 | 第 5.4 节修复 |
| 召回条数上限 | 5（对齐现有行为） | 第 5.3 节 |
| 召回注入预算（字符） | 4000 | 第 5.3 节 |
| 相关性门槛 | 待定默认值 | 第 5.3 节 |
| 跨作用域兜底开关 | 开 | 第 5.3 节 |
| 召回可见性（会话内展示召回内容） | 开 | 第 5.3 节 |

> 现有 `memoryAutomationEnabled` / `memoryGenerateMemories` / `memoryDailyRollupEnabled` 等散落配置项迁入该区统一管理（旧字段走 settings-store-migrate 迁移，不破坏存量配置）；`memoryDailyRollupEnabled` 随空转 rollup 一并废弃。

## 6. 实施步骤（一期，细粒度拆分）

> 每步 = 一个功能单元：编译验证通过 + 用户核验后才 commit；步骤按依赖顺序执行。
> 验证基线：涉 C# 改动 `dotnet build` 0 错 0 警告；TS 三配置（web/node/根）0 错；应用能启动。

### S1 死代码清理（打地基）——✅ 代码完成（待用户验收）
- 删 `MemoryTier` 枚举、`MemoryPathResolver` 的 dormant/daily/topics 死路径（`MemoryPriority` 在用，保留）
- 删整个 `memory-automation-rollup.ts`（`runDailyMemoryRollup` / `installMemoryAutomationDailyRollup` / `undoMemoryAutomationEntry` / `runManualMemoryAutomationForActiveSession`，均无调用方或空转）、`runRollupForDescriptor`、`AutoMemoryPanel.tsx`（返回 null 的死组件）
- 删 `memoryDailyRollupEnabled` / `memoryAutomationDailyRollupEnabled` 配置项（interface/默认值/持久化/migrate 全链路）及 `DailyRollupOptions` / `yesterdayString` / `escapeRegExp` / `_maState.rollupInstalled`
- 删无后端实现的通道：`MEMORY_AUTOMATION_LIST/UNDO/RUN_SESSION/RUN_ROLLUP`、`MEMORY_PIPELINE_LIST_ROOTS/LIST_JOBS/CLEAR_ROOT`、`MEMORY_RECORD_CITATION_USAGE`（含路由表条目）；共享类型删 `MemoryAutomationListResult` / `RunRollupResult` / `UndoResult`
- **重大发现：`memory-automation:record` / `memory-pipeline:run` 也无任何后端实现（main 与 Worker 零注册）**——即整条管线的 IPC 底座缺失，连手动入口也是坏的（用户症状"提示才记"的第二层根因）。S3 方案相应调整，见下。
- 保留：`runMemoryAutomationForSession`（stage1/phase2 编排）、`memory-automation-internal.ts`（IPC 管线层，S3 重写）、`MEMORY_AUTOMATION_RECORD` / `MEMORY_PIPELINE_RUN` 通道常量（S3 定去留）
- 验证：TS 三配置 0 错 + `dotnet build` 0 错；待用户启动核验

### S2 记忆设置区（store + UI）——✅ 代码完成（待用户验收）
- settings-store 新增字段：整理开关 / 触发模式 / 凌晨时刻 / Warm×3、Cold×3 阈值 / 自动提取开关 / 召回条数、预算、门槛、兜底开关、可见性开关；默认值按第 5.5 节表；migrate 迁入散落旧字段（第 5.5 节备注）
- 设置页新增"记忆"面板（对齐 `GeneralPanel` 等现有面板模式，锚点导航接入 `section-anchor-nav`），中英文 i18n
- 验证：设置页可见可改可持久化，旧配置值正确迁入；本步即可交付（有入口有反馈）

### S3 主动记忆自动提取接通（修根因，方案已调整）——✅ 代码完成（待运行时验收）
- **S1 发现管线 IPC 底座缺失后的新方案**：不补 Worker 端 job 管理（prepare-session/complete-stage1/record-job/list-stage1-outputs/complete-phase2），重写 `memory-automation-internal.ts`——stage1 原始记忆直接追加写 `raw_memories.md`（现有 `fs:write-file`），phase2 从文件读回巩固；`recordEntry` 改走整理日志（S7）或暂空实现，废弃两个 `memory-automation:*`/`memory-pipeline:*` 通道常量；复用现有 stage1 提取提示词、脱敏过滤、巩固提示词与回退写入逻辑（这些均完好）
- 在 assistant 轮次结束处自动调 `runMemoryAutomationForSession`（尊重开关 / 防抖 / 仅主会话；不阻塞主流程，错误只记日志）
- 验证：聊一段含值得记忆信息的对话，结束后 MEMORY.md/raw_memories.md 出现自动写入；开关关闭时不跑（修复用户症状"提示才记"）

### S4 DB 分层基础设施（C# 侧）——✅ 代码完成（编译通过，待运行时验收）
- `memory_entries.status` 扩为 `active` / `warm` / `cold`；检索默认含 active+warm（Warm 降权），`include_deprecated` 含 cold；FTS 触发器不动（status 不进 FTS）
- Worker 新增两个端点：列降级候选（priority + updated_at + 阈值参数）、批量状态变更（供降级/恢复/复热复用）；`memory/update` 保持兼容；新类型注册进 `WishfulClawJsonContext`（AOT 规范）
- `MemoryStats` Warm/Cold 填真，记忆面板可展示三层分布（UI 挂 `MemoryPanel`，可并入 S9）
- 验证：手工改条目状态后检索行为符合预期；`dotnet build` 0 警告；`tests/` 相关回归通过（如涉及）

### S5 召回质量改进 + 回忆复热（C# 侧）——✅ 代码完成（编译通过，待运行时用例验收）
- 查询提炼：停用词过滤 + 实词拆分多路查后合并去重（规则版，不引小模型），原文兜底（解决整句稀释 + 短查询失效）
- 项目作用域零命中 → 回退全局，结果标注来源（对齐 OpenClaw.net 兜底）
- 相关性门槛过滤 + Hot 权重高于 Warm（依赖 S4）
- **回忆复热**：被注入的 warm/cold 条目 status 升一级 + 刷新 `updated_at`（经 Workspace 层 `IMemoryReheat` 落库——Agent 层不能反向调 Worker IPC，S4 批量端点留给渲染端降级/恢复用）
- 召回参数（条数/预算/门槛/兜底开关）经 run 参数从渲染端设置传入（不新造配置通道，对齐现有 settings 下发链路）
- 验证：短查询（"日志"）、噪声长句、跨作用域三种用例对照前后召回日志；`AgentLoop.MemoryRecall.cs` 日志留痕完整（修复"没看到效果"的不可见根因之一）

### S6 召回可见性（渲染端）——✅ 代码完成（编译通过，待运行时验收）
- 召回命中/未命中原因通过流式事件透出（`StreamEventModels` 对应事件 + 渲染端类型）
- 会话消息顶部可折叠提示展示本次召回条目（或"未召回原因"），开关受设置区"召回可见性"控制；中英文 i18n
- 验证：有召回 / 无召回两种场景 UI 均正确展示；关闭开关后不展示（修复"没看到效果"的感知根因）

### S7 整理引擎（渲染端编排）——✅ 代码完成（编译通过，待运行时验收）
- "上次整理时间"水位持久化（`~/.wishful-claw/` 配置文件）
- 整理流程：确定范围（全局 + 前一天有会话更新的激活项目，有几个处理几个）→ 逐 scope 读取 `MEMORY.md` 热层快照 → 有 Provider 时执行 LLM 纯整理（去重/合并/压缩 + 标记过时段落）→ 过时段落逐条先成功 append 到当前 scope 的 SQLite/FTS，再成功批量 `status → warm` → 两步成功后才用 `ensureMarkdownDocument` + sanitize 覆盖写 Hot（快照入 `beforeContent` 可撤销）；append/status 任一步失败则保留原 `MEMORY.md` 并写入错误报告，不执行 Hot 覆盖 → 独立执行 DB/FTS 规则降级（按设置阈值，走 S4 端点）→ 写整理报告。无 Provider 时报告 `missing_provider`，跳过 LLM Hot 整理，但仍执行 FTS 规则降级。
- `runConsolidation` 扩"纯整理"模式（无新增输入）；自动提炼链路保持 `raw_memories.md → phase2 模型巩固 → .wishful-claw/MEMORY.md`
- FTS 由 `memory_append`/工具链独立维护，负责完整数据库记忆的存储、检索和规则分层；不全量复制到 Hot，当前没有独立 FTS LLM 去重/合并实现。
- 验证：提供手动"立即整理"入口（挂记忆面板）；整理前后 MEMORY.md diff 合理、报告可见、降级条目可一键恢复（复走 S4 端点）

### S8 触发系统（main 进程）——✅ 代码完成（编译通过，待定时运行验收）
- `startup` 模式：启动后延迟触发，距上次整理 ≥20 小时节流（水位判断）
- `nightly` 模式：每 5 分钟检测跨过配置时刻 → 通知渲染端执行 S7；启动时水位非今日则补跑一次（错过日期合并为一次）
- 设置变更即时生效（改时刻/模式后重算下次触发）；两模式互斥不重复跑（运行锁）
- 验证：临时把时刻改成"当前时间+2 分钟"实测触发；改 `startup` 重启实测；日志可查下次触发时间（修复触发根因）

### S9 面板整合 + 全量回归收尾——✅ 代码完成（构建通过，待用户验收）
- `MemoryPanel` / `AutoMemoryPanel`：整理日志列表、三层分布、deprecated/warm 恢复入口、下次整理时间展示；i18n 补齐
- Warm→Hot：先回写当前 scope 的 `MEMORY.md`，写入成功后再将 DB 条目标记为 `active`；Hot 写失败不得激活。Cold→Warm 只修改数据库状态，不写 Hot。renderer 远程项目 Hot 恢复使用 SFTP IPC；.NET Agent SSH Hot 仍使用本地镜像 `~/.wishful-claw/projects/{projectId}/`，这是当前架构边界与风险。
- 全流程回归：主动记忆自动写入 → 召回可见注入 → 复热升级 → 凌晨/启动整理 → 降级与恢复闭环；`docs/` 同步（PROGRESS / new-session-prompt 视迭代收尾要求）
- 验证：迭代交付标准——有入口、有反馈、有闭环；TypeScript/C# 编译与前端生产构建已通过，启动及核心运行时流程待用户验收。

## 7. 全量审查结论（2026-08-28）

### 已实现与本轮修复

- S1–S3：清理无效的每日 rollup/死组件/死通道，保留并接通会话结束自动记忆提取；模型提炼结果先进入 `raw_memories.md`，phase2 去重巩固后写入 `MEMORY.md` 热层。数据库 FTS 记忆仍由 `memory_append`/工具链独立写入，不把全部数据库记忆复制进热层。
- S4：Worker 提供降级候选、批量状态变更、按状态浏览；`MemoryStats` 统计 Warm/Cold；AOT JSON 类型已注册。
- S5–S6：查询提炼、项目到全局回退、相关性门槛、Warm 权重、回忆复热和召回可见性已接通。默认 `memoryRecallMinScore = 0` 保持兼容。
- S7：全局 + 近期激活项目范围整理、LLM 去重/合并/压缩、快照写回、过时热记忆段落先 append 到当前 scope 的 FTS、再批量标记 `warm`，成功后才覆盖 Hot（不删除，失败保留原 Hot）、规则降级、报告和水位持久化已接通；DB demotion 按每个 target 的精确 scope 执行，显式 `global` 不再扫描全库。无可用 Provider 时报告 `missing_provider`，跳过 LLM 热层整理但仍执行 FTS 规则整理；FTS 无独立 LLM 去重/合并。
- S8：startup/nightly/catch-up、设置变更即时重排、关闭后停用、单次本地时间 timer + 5 分钟轮询兜底已接通；主进程只通知 renderer 执行整理。
- S9：记忆面板已接入立即整理、最近报告、上次/下次整理时间、Warm/Cold 列表和逐条恢复；Warm→Hot 恢复会先回写当前 scope 的 `MEMORY.md` 再激活 FTS 条目，Cold→Warm 只恢复数据库层；renderer 远程项目恢复使用 SFTP，.NET Agent SSH Hot 仍是本地镜像边界；恢复后刷新统计、列表和报告。中英文面板文案已补齐。运行时人工闭环仍待用户验收。

### 本轮发现并修复的缺陷

1. `MemoryPanel` 只有导入/状态，未接入报告、分层列表和恢复 JSX；已补齐完整闭环。
2. `runDbDemotion(targets)` 虽接收 target，但此前项目参数不完整；已按 global/local/SSH target 传递 `workingFolder/projectId/sshConnectionId`。
3. `MemoryModule.MemoryStats` 曾把显式 `global` 当成全库；已改为精确统计 global scope。
4. `MemoryFtsService` 曾把显式 `global` 当成无 scope 过滤；已改为精确全局检索。
5. nightly 调度此前仅依赖 5 分钟轮询；已增加单次 timer，并在设置变化和退出时清理/重建。
6. 本轮编辑引入的 UTF-8 BOM 已扫描并清理；`git diff --check` 无空白错误。

### 已执行验证

- `npx tsc --noEmit -p tsconfig.web.json`：通过。
- `npx tsc --noEmit -p tsconfig.node.json`：通过。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- `dotnet build src/runtime/WishfulClaw.sln --no-restore`：通过，0 错误、0 警告；仅有 .NET preview SDK 的 informational message。
- `npm run build`：通过，Electron main/preload/renderer 生产构建完成。
- `dotnet test src/runtime/WishfulClaw.sln --no-build`：命令通过，但当前 solution 未输出可执行测试用例结果。
- `git diff --check`：通过；全仓扫描未发现本轮目标文件残留 BOM。

### 未能验证与剩余风险

- 尚未启动应用执行真实人工流程：会话结束自动写入 `MEMORY.md`、数据库 FTS 记忆检索、召回可见提示、Warm/Cold 复热、手动整理报告、热层下沉、Warm→Hot/Cold→Warm 恢复。
- 尚未在真实本地时区把 nightly 时间设置为当前时间后约 2 分钟并观察触发，也未重启实测 startup 节流/离线补偿。
- 当前没有针对本追加计划的自动化测试文件；已有 `tests/` 工程存在，但 `dotnet test` 未发现可执行测试结果，未覆盖这些记忆流程。
- 生产构建存在既有 Vite chunk/dynamic-import warning，不影响本次构建成功；未扩大范围处理。
- 运行时项目记忆不读取 `.agents`、`.agents/AGENTS.md`、项目根 `AGENTS.md` 或 workspace protocol fallback；人格层自身 `AGENTS.md` 语义、非本轮插件/技能功能及代码拆分注释不属于本轮项目记忆链。
- 工作树仍保留用户/其他 agent 的全部未提交改动；本轮未 commit、未 push，也未执行破坏性回滚。

### 验收建议

用户验收时按以下顺序验证：设置页持久化 → 会话结束确认模型提炼巩固到 `MEMORY.md` 热层 → `memory_append` 确认数据库 FTS 记忆可检索 → 记忆面板立即整理 → 检查热层去重/过期下沉、报告和水位 → 查看 Warm/Cold 条目并逐条恢复 → 新会话观察召回可见性与复热 → 临时调整 nightly/startup 触发并检查日志。验收通过后再由用户明确确认是否提交。

Verification: tsc(web/node/root)=PASS; dotnet build=PASS; npm build=PASS; dotnet test=PASS（未发现可执行测试）；git diff --check=PASS；runtime manual loop=NOT RUN；commit/push=NOT DONE
