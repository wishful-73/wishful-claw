# iter-v2-30 实施计划

> 2026-09-16 建档。**范围由老大拍板：「30 迭代就做这些了」**（原话附背景：「之前迭代东西做太多了，导致半天没法更新修复内容」⇒ 本迭代刻意收敛）。
> 需求原文见 `raw-requirements.md`；只读核验见 `exploration_findings.md`。
> 分支 `dev/v2-iter-30`（base `main` @ `5aca9b1c`）。

## 一、范围（7 项）

| 编号 | 需求 | 来源 | 状态 |
|---|---|---|---|
| **S-26** | 工具输出落盘 spill | 知识库 + 30 主打 | 探索完成，可开工 |
| **S-27** | 免费对话页（组合按钮 + 内嵌浏览器） | 老大口述 | **阻塞：5 个口径待老大拍板** |
| **S-28** | 聊天窗大图预览超出弹窗 | 知识库 | 待真机取证（量尺寸） |
| **S-29** | 后台任务执行记录 | 知识库 | 待勘测触发源 |
| **S-30** | 渠道会话 shell 文本审批 | 老大口述 | 待定 6 个口径 |
| **S-31** | 思考流式跳动仍存在 | 老大真机反馈 | **阻塞：待真机取证** |
| **S-32** | 回复结束折叠致聊天窗跳动（含回跳） | 老大真机反馈 | **阻塞：待真机取证** |

> S-31 / S-32 **同源**（见 `raw-requirements.md` 统一根因节），按老大口径分开登记、**一次修复**。

## 二、实施顺序（按「可独立推进度」排）

| 序 | 需求 | 理由 |
|---|---|---|
| 1 | **S-26 spill** | 无阻塞，单点改造，我能独立完成 |
| 2 | **S-28 大图预览** | 小修，取证后一次到位 |
| 3 | **S-29 执行记录** | 需先勘测触发源（我能做） |
| 4 | **S-30 渠道文本审批** | 需老大定 6 个口径，但口径可边做边问 |
| 5 | **S-27 免费对话页** | 等老大 5 个口径 |
| 6 | **S-31 / S-32 滚动跳动** | 等老大真机取证；三条修法一起落 |

## 三、S-26 详细计划

### 目标

工具输出超 `maxInlineBytes` 时，**中间部分落盘**（而非丢弃），模型看到「有界首尾预览 + 定位符 + 检索提示」。

### 落点（已核验）

| 项 | 位置 |
|---|---|
| 统一出口 | `ToolCallProcessor.ApplyToolOutputLimit`（`ToolCallProcessor.cs:82-94`） |
| 现有截断 | `ToolCallProcessor.TruncateToolOutput`（`:25-43`） |
| 调用点 | `ToolCallProcessor.cs:545`（`ExecuteAsync` 内，**已持有 `state`**） |
| sessionId | `state.SessionId`（`AgentRuntimeRunState.cs:29`，公开只读） |
| 落盘根 | `WishfulClawDataDir.Resolve("spill")`（API 用法见 `SubAgentDefinition.cs:41`） |
| 数据目录常量 | `WishfulClawPaths.DataDirName = ".wishful-claw"`（`WishfulClawPaths.cs:5`） |

### 步骤

- [ ] **步骤 1**：新建 `src/runtime/WishfulClaw.Agent/Spill/SpillStore.cs`
  - `SaveText(sessionId, suggestedName, content) → SpillRef { Locator, Bytes, RetrievalHint }`
  - 路径 `<root>/session-<sha256(sessionId)>/<random>-<safeName>`（`sha256` 用 sessionId，`safeName` 由 `suggestedName` 净化成**单个安全路径段**）
  - root 私有 0700（首次创建时设置）；文件以**独占 + 仅所有者可访问**打开（.NET：`new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)` + 权限设置），防预埋符号链接
  - **失败即抛**（权限 / 磁盘满 / 后端不可用），由调用方降级
- [ ] **步骤 2**：改造 `TruncateToolOutput` → `SpillToolOutput(sessionId, toolCall, output)`
  - 阈值以内的行为**完全不变**
  - 超限：**先算通知文本字节**，剩余预算给首尾预览（**不变式 a**：替换内容永不超上限；通知都放不下则退回原文）
  - 落盘成功 → 预览 + 定位符 + 「用 `Read`(offset/limit) 或 `Grep` 取回」
  - **落盘失败 → 退回现状截断结果**（**不变式 b**：绝不改 `IsError`、绝不隐藏内联结果）
  - **`Read` 跳过 spill**（**不变式 c**，防 `read → spill → read` 死循环）
- [ ] **步骤 3**：`ApplyToolOutputLimit` 加 `sessionId` 形参 + 调用点 `:545` 传 `state.SessionId`
- [ ] **步骤 4**：扩 `tests/WishfulClaw.GoalRegressionTests/Program.Lifecycle.cs:493/505/523` 既有断言
  - 不超限 → 原样返回
  - 超限且落盘成功 → 有预览 + 定位符 + 提示；**替换内容字节数 ≤ 上限**
  - 落盘失败（模拟不可写目录）→ 退回现状截断；**`IsError` 仍为 false**
  - `Read` → 不落盘
  - 定位符路径存在、内容与原文一致（round-trip）

### 待老大确认（不阻塞开工，实施中定）

1. `maxInlineBytes` 沿用现常量 32KB，还是暴露设置项（**倾向沿用**，本迭代不扩设置面）
2. 清理策略：会话删除时是否清理 spill 目录（参考侧 seam **不定义**；**倾向本迭代不做**，留 v3）
3. 是否也跳过 `Glob`/`Grep`/`LS`（**倾向只跳 `Read`**，对齐参考侧原设计）

### 门禁

- `dotnet build tests/WishfulClaw.Tests.sln` 与 `WishfulClaw.Worker.csproj` 0 警告 0 错误
- `npm run build:worker:prod`（AOT）成功，无 IL2026 / IL3050 / IL3051
- 既有 C# 回归全过 + 步骤 4 新增断言全过

## 四、S-27 ~ S-32 概要（实施前逐个细化）

- **S-27**：**等老大答 5 个口径**（站点清单 / 地址栏 / 分区 / 切换保状态 / 是否进搜索面板）——`raw-requirements.md` S-27 节已列全
- **S-28**：先真机量 `DialogContent` / `img` 的 `clientWidth/scrollWidth`，判定「裁切」还是「未约束」，再定修法
- **S-29**：先勘测「记忆整理的触发源是 cron 还是内置调度」——决定记录挂在哪
- **S-30**：6 个口径（回复词表 / 超时 / 总是允许 / 并发 / 拒绝话术 / 开关归属）——倾向「无条件放行」复用 `shellRequiresApproval`
- **S-31 / S-32**：三条修法（回跳时序 + 限幅连续跟随 + `isSessionOutputting` 滞后），**需老大真机复现取证后动手**

## 五、提交流程（遵循 AGENTS.md）

- 一个需求一个 commit；修复调整攒进收尾一刀
- 需求 commit 后不 push；Plan 完成后一次性 push
- 迭代是否收尾**由老大手动发起**，agent 不自行判定

---

## 六、增补需求 S-36 ~ S-38（2026-09-16 下午登记）

老大原话：「现在就核实，核实完成后去出计划，如果没有需要我裁定的，你就直接推进执行」

| 编号 | 需求 | 来源 | 核实状态 | 裁定点 |
|---|---|---|---|---|
| **S-36** | 后台子 agent 结论回不到主会话 | 老大口述 | **根因已实测钉死** | **4 个（阻塞）** |
| **S-37** | 更新弹窗正文未取剩余高度 | 老大口述 | **已核实（确凿）** | 无 |
| **S-38** | 未设 API Key 时提醒宽度异常 | 老大口述 | **已核实（确凿）** | 无 |

**实施顺序**：S-37 → S-38（无裁定点，直接做）→ S-36（**等老大答 4 个口径**）。

### 6.1 S-37 详细计划（已核实，无裁定点）

**根因**：`UpdateReleaseNotes.tsx:27` 默认态写死 `max-h-48`（192px），全屏态 `maxHeight:'none'`；而 `DialogContent` 是 `sm:min-h-[70vh]` ⇒ 正文卡在 192px，**剩余 300+px 全留白**。全屏态正文自然铺开 ⇒ 「全屏是对的」。
**辅证**：`ui/dialog.tsx:56` 的 `DialogContent` 是 `grid` 但**无 `grid-rows-*`** ⇒ 无行吃 `min-h-[70vh]` 的剩余空间；全屏态才补 `grid-rows-[auto_minmax(0,1fr)_auto]`。

**落点**：`components/updater/UpdateDialog.tsx`、`components/updater/UpdateReleaseNotes.tsx`。

**步骤**：

- [ ] **步骤 1**：`UpdateDialog.tsx:93-100` —— `grid-rows-[auto_minmax(0,1fr)_auto]` 从「仅全屏」提到**基础 class**（全屏分支里的重复项删掉）
- [ ] **步骤 2**：`UpdateDialog.tsx:132` 内容区 `cn('space-y-4', isFullscreen && 'min-h-0 overflow-y-auto')` → **恒为** `flex min-h-0 flex-col gap-4`（让正文可 `flex-1`；`space-y-4` 换 `gap-4`，flex 下 gap 更可靠）
- [ ] **步骤 3**：`UpdateReleaseNotes.tsx:26-29` 容器 `max-h-48` → **`flex-1` + 兜底 `min-h-32`**；删 `style={expanded ? {maxHeight:'none'} : undefined}`（被 `flex-1` 取代）；`overflow-y-auto` 保留 ⇒ 正文内部滚动
- [ ] **步骤 4**：极端情况（版本卡片 + 进度 + 错误提示挤满）由 `DialogContent` 自带的 `overflow-y-auto` 接管整体滚动

**风险与对策**：内容区改 flex 后，非正文兄弟元素默认 `flex-shrink:1`。若总需求 > 容器，正文先被 `min-h-32` 挡住 ⇒ 其余元素可能被压扁。**实施时验证**：构造「长 release notes + 下载进度 + 错误提示」同时在场的情形，确认不压扁；若压扁，给兄弟元素补 `shrink-0`。

**门禁**：`npm run typecheck` 0 错 + 全量 `test:*` + 目视（默认态正文撑满、长内容内部滚动；全屏态不回归）。

### 6.2 S-38 详细计划（已核实，无裁定点）

**根因**：`composerWidthClass`（`InputArea/index.tsx:206`）= `mx-auto w-full max-w-[820px]`（居中 + 与输入框同宽）。`composer-banners.tsx` 里 **API key 提醒（`:42-49`）与工作目录提醒（`:54`）没套它**，只有裸 `w-full`；而 `ComposerBanners` 的挂载点在 `composerWidthClass` 容器**之外** ⇒ 撑满外层容器，比输入框宽。（Plan mode `:66` / Pending goal `:96` 都套了 ⇒ 正常。）

**落点**：`components/chat/InputArea/composer-banners.tsx`。

**步骤**：

- [ ] **步骤 1**：API key 提醒 `className` —— 裸 `w-full` → `cn(composerWidthClass, 'mb-2 flex items-center gap-2 rounded-md border …')`（与 Plan mode 写法对齐；`composerWidthClass` 已含 `w-full`，**替换**而非叠加）
- [ ] **步骤 2**：工作目录提醒同理一并修（**同一处 class 缺失，同类一并修才算真修完**）
- [ ] **步骤 3**：复核同文件其余 banner —— Plan mode / Pending goal 已套 ✓；工作目录指示行（`:88`）是纯文本行、非 banner，**不动**

**门禁**：`npm run typecheck` 0 错 + 全量 `test:*` + 目视（两条提醒与输入框左右对齐）。

### 6.3 S-36 详细计划（**含 4 个裁定点，阻塞**）

完整根因链、实测对照证据、OpenCowork 对标逐项表见 `raw-requirements.md` S-36 节。此处只列**要做的事**与**待裁定项**。

**修法分四组**（详细见 raw-requirements S-36「修法」节）：

1. **抓报告**（渲染端）：`stores/chat-store/sub-agent-slice.ts:359` 让 `event.result.output` **优先覆盖**（现在只在 `sa.report` 为空时才用）；Worker 显式给「是否产出最终报告」（弃用 `output.length > 0`）；剥离报告头的过渡话术
2. **汇报通道**（根因）：汇报改「新起一轮 run」（父 run 活 → 插话，死 → `send`），取代「缓冲 + 等唤醒」
3. **状态可见**：`reportStatus` 落库（`pending / blocked / reported`），弃内存 Set；失败置 `blocked` 不静默 return；「主 run 活跃」判定改用 `hasActiveSessionRunForSession`
4. **界面**：「重新汇报」按钮（对标 OpenCowork `Thread.tsx:320`）

**★ 4 个裁定点（老大定后才能动 S-36）**：

1. **子会话落库粒度** —— 复用 `sub_agent_runs.data`（已有 148KB~245KB 的 `transcript` 字段，**不动 schema**，但只有渲染端写、Worker 读不到）vs 子会话独立落 `messages` 表（Worker 可回读，对标 OpenCowork `childSessionId` + `getSession`）
2. **报告正文口径** —— 取「子会话最后一条 assistant 消息」（干净，对标 OpenCowork）vs「`GetFinalOutput()` 的 text 事件拼接」（已验证可用，但要剥过渡话术）
3. **「重新汇报」按钮要不要**
4. **`reportStatus` 落点** —— `sub_agent_runs` 加列 vs 塞进现有 `data` JSON

**架构前提**：`SubAgentExecutor.cs:162` finally 里 `SessionConversationManager.Remove("__subagent__{childRunId}")` —— **子会话现在不留**。老大口径「子会话要落库」已定，具体粒度见裁定点 1。

### 6.4 提交粒度

- **S-37 + S-38 合并一刀**：同为 UI 尺寸修复、同类同因，且都在本批次一并取证 ⇒ 一刀 `fix(iter30): S-37/S-38 弹窗与提醒的尺寸对齐`
- **S-36**：涉及 C# + 渲染端 + 可能的 schema 变更，按需独立成刀；若与收尾期重叠则并进收尾刀
