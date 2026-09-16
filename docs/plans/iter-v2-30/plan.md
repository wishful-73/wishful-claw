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
