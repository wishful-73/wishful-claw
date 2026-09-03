# v2-iter-24 迭代全面审查分析报告

> 审查范围：`v0.2.23..HEAD`（44 commits，295 文件，+31378/-4625）
> 审查时间：2026-09-01
> 审查基线：`dev/v2-iter-24`，HEAD `f3d1862`
> 审查方式：提交历史分析 + 代码审查报告 + 功能完整性验证

---

## 一、迭代概览

### 1.1 基本信息

| 项目 | 内容 |
|------|------|
| 迭代编号 | v2-iter-24 |
| 产品版本 | 0.2.24（待发布） |
| 分支 | `dev/v2-iter-24` |
| 开始日期 | 2026-08-29 |
| 当前状态 | 进行中（功能开发完成，待用户验证） |
| 总提交数 | 44 commits |
| 文件变更 | 295 文件，+31378/-4625 行 |

### 1.2 核心目标

建立一个**全局 Agent 作为通用小助手/产品经理**，能够跨项目查看工作上下文、维护自己的全局任务、向具体项目会话发送消息和工作请求。同时补齐**项目会话 Agent 的 OpenCowork 风格临时 Todo**。

---

## 二、功能模块分解

### 2.1 共同前置：会话上下文模型统一

**目标**：统一会话层级、协作模式、权限模式与运行角色。

**实现内容**：
- 新增 `SessionScope`（global/project）、`CollaborationMode`（chat/cowork）、`PermissionMode`（default/fullAccess）、`RuntimeRole` 四个正交模型
- 会话显式持久化 scope，`projectId` 只保存项目关联，不再推导会话身份
- 合法核心会话组合：`global:chat`、`project:chat`、`project:cowork`
- Settings v34 新增「会话默认值」区域

**验证状态**：
- ✅ TypeScript 3/3 零错误
- ✅ C# solution 0 warning/0 error
- ✅ Native AOT 无 IL/AOT warning
- ✅ Goal 113 / SessionTaskCascade 124 / MemoryRecall 18 回归通过

---

### 2.2 Plan A：全局产品经理 Agent

**目标**：全局 Agent 跨项目协调，维护全局任务，向项目会话发送消息/工作请求。

**实现步骤**：

| 步骤 | 提交 | 功能 |
|------|------|------|
| Step 1 | `8943c2d` | 全局 Agent prompt injection via `sessionMode='global'` |
| Step 2 | `e7a8297` | `global_tasks` / `global_task_dispatches` 数据层 |
| Step 3 | `05f8b54` | global task/dispatch DB tools + Worker registration |
| Step 4 | `23d07c1` | global agent task toolset (provider + executor + dispatch wiring) |
| Step 5 | `7cf8ad6` | cross-session dispatch protocol |
| Step 6 | `c136314` | Task Board 全局工作台落地 |
| Step 7 | `2214e6f` | global board change events (worker emit + main relay + live refresh) |

**核心功能**：
- 全局任务表 `global_tasks`（不删除只归档）
- 分派记录表 `global_task_dispatches`（永久保留）
- Task Board 看板（全局任务/分派列表、筛选、详情、归档视图）
- 跨会话分派协议（source session routing + delivery failure tracking）
- 实时更新事件（`global/task-changed` / `dispatch-changed`）

**验证状态**：
- ✅ 编译验证通过
- ⏳ 待用户 E2E 测试

---

### 2.3 Plan B：会话临时 Todo

**目标**：项目会话 Agent 的 OpenCowork 风格临时 Todo，辅助当前工作拆解和推进。

**实现步骤**：

| 步骤 | 提交 | 功能 |
|------|------|------|
| Step 1-3 | `555fe70` | tasks 表 + 四工具改造 + db:tasks:* IPC |
| Step 4 | `b36d3de` | 会话 Todo 展示接线（输入框上方 TodoCard） |
| Step 5 | `49ca482` | 会话 Todo Prompt 引导（PromptBuilder 段 + 开关） |
| Step 6 | `adebba4` | session task lifecycle cleanup + cascade regression |

**核心功能**：
- `tasks` 表持久化（SQLite）
- TaskCreate/TaskGet/TaskUpdate/TaskList 四工具
- InputArea 上方 TodoCard 展示
- 会话切换/启动恢复/工具完成刷新
- 全局 Agent 不读取、不管理、不统计会话 Todo

**验证状态**：
- ✅ 编译验证通过
- ⏳ 待用户 E2E 测试

---

### 2.4 issues 批次修复

| 提交 | 功能 |
|------|------|
| `7594af4` | 会话列表「加载更多」流式中不再重置收起 + 项目文件夹图标接管运行态 |
| `b8da2e4` | 文件树搜索节点动作保持 |
| `2c0d604` | 流式时固定消息列表 |
| `02011ba` | 保留用户图片块 |
| `54e7bba` | 桌面更新流程 + 设置集成 |
| `f3d1862` | 压缩卡片统一渲染（live draft + summary divider） |

---

### 2.5 文档与审查

| 提交 | 内容 |
|------|------|
| `7c37174` | 迭代全量审查报告（review-10-iter24.md） |
| `48bf595` | 精简内置人格文件（-43% 行数，-11% 字符） |
| `b6f146a` | issues 批次规划与验证报告 |
| `b4b039e` | README 删减 Development Progress |
| `4769ec0` | plan-compression 文档更新 |

---

## 三、代码审查发现

### 3.1 阻断项（建议合并前修复）

#### I24-1：use_capability 代理绕过上下文策略

**位置**：
- `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityExecutor.cs:299-313`
- `AgentRuntimeUseCapabilityDiscovery.cs:142-160`
- `src/runtime/WishfulClaw.Agent/Tools/Providers/TaskToolProvider.cs:23-74`

**问题**：
- 代理的 list/call 只校验 `registry.IsAvailableInMode()`
- 不套用 `AgentRunContextPolicy.IsToolAllowed`
- TaskToolProvider 注册时未声明 availableModes
- **后果**：全局会话可读写会话 Todo，违反核心边界

**修复方向**：代理路径同样套用 `IsToolAllowed` 检查（一行级改动）

**优先级**：🔴 P0 - 工具精简方案先决条件

---

#### I24-2：Task Board 部分更新数据损坏

**位置**：
- `src/renderer/src/stores/task-board-store.ts:164-175`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskTools.cs:180-183`（ApplyPatch）

**问题**：
- `updateTask` 无条件序列化全部 7 个 patch 字段
- `undefined` 经 MessagePack 变 `nil`（→ JSON `null`）
- ApplyPatch 对 `dueAt` 置 null、对 `archived` 置 0

**后果**：
- 改状态/优先级会**清掉截止日期**
- 编辑保存会**静默解除归档**

**修复方向**：前端只发送有定义的键；或 Worker 把 null 视为「不变」

**优先级**：🔴 P0 - 用户可见行为缺陷

---

### 3.2 重要项（⚠️）

#### A. 隔离与安全纵深（I24-3 ~ I24-7）

| 编号 | 问题 | 位置 | 修复难度 |
|------|------|------|----------|
| I24-3 | TaskGet/TaskUpdate 缺 sessionId 时退化为跨会话查询 | `AgentRuntimeTaskExecutor.cs:90-138` | 低 |
| I24-4 | dispatch 目标会话只校验存在性，不校验 scope | `DbGlobalTaskDispatchTools.cs:98-112` | 低 |
| I24-5 | reply_global_dispatch 不校验调用方即目标会话 | `AgentRuntimeGlobalDispatchReplyExecutor.cs:41-56` | 低 |
| I24-6 | 身份回退静默化，违反设计约束 12 | `AgentRunContextPolicy.cs:82-91` | 中 |
| I24-7 | PromptBuilder 未按 scope 清洗原始参数 | `PromptBuilder.cs:49-57,186-211` | 低 |

#### B. 数据一致性与并发（I24-8 ~ I24-10）

| 编号 | 问题 | 位置 | 修复难度 |
|------|------|------|----------|
| I24-8 | Update 为跨连接无事务全行覆写，并发写静默丢失 | `DbGlobalTaskDispatchTools.cs:139-175` | 中 |
| I24-9 | dispatch Create 存在 check-then-insert TOCTOU | `DbGlobalTaskDispatchTools.cs:93-132` | 中 |
| I24-10 | Archive 对不存在 id 返回成功 | `DbGlobalTaskTools.cs:143-164` | 低 |

#### C. 行为与承诺一致性（I24-11 ~ I24-14）

| 编号 | 问题 | 位置 | 修复难度 |
|------|------|------|----------|
| I24-11 | automation 权限承诺与实现不一致 | `cron-runtime.ts:418` | 低 |
| I24-12 | 分派投递 fire-and-forget 误报成功 | `project-send-message.ts:104-134` | 中 |
| I24-13 | InputArea TodoStatusList 数据源与会话不一致 | `InputArea/index.tsx:83,383-386` | 低 |
| I24-14 | Task Board「打开目标会话」对已删除会话仍可点击 | `TaskDetailPane.tsx:231-238` | 低 |

#### D. 可观测性与工程规范（I24-15 ~ I24-18）

| 编号 | 问题 | 位置 | 修复难度 |
|------|------|------|----------|
| I24-15 | 主进程分派回复失败路径不进统一日志 | `native-agent-runtime.ts:298-304` | 低 |
| I24-16 | PromptBuilder 身份 prompt 与工具过滤依据脱钩 | `PromptBuilder.cs:60-70` | 低 |
| I24-17 | InputArea 559 行超红线 | `InputArea/index.tsx` | 中 |
| I24-18 | qr-page-capture 无超时，窗口可能泄漏 | `qr-page-capture.ts:123` | 低 |

---

### 3.3 压缩卡片专项审查

#### 正常闭环已完整（C24-1 已修复）

| 环节 | 位置 | 结论 |
|------|------|------|
| 后端事件发射 | `AgentLoop.cs:253-380` | started/delta/compressed 齐全 |
| 线上字段映射 | `AgentStreamMessagePackEmitter.cs:84-89` | 与前端读取一致 |
| 渲染端落库 | `chat-store/index.ts:572-654` | 状态消息 + 边界 + 摘要均写 DB |
| 过滤保留 | `transcript-filters.ts:73` | 带 compressionStatus/compactBoundary 的 system 消息保留 |
| 卡片渲染 | `MessageItem.tsx:152-157` | context-compression/live-compression 分发给 ContextCompressionMessage |
| 手动压缩 | `use-chat-actions.ts:606-659` | 同样经 recordCompressionStatusMessage 进转录 |

#### C24-1：live 卡片泄漏路径（已修复）

**问题**：
- `context_compression_started` 发出后，若取消，后端直接 `EmitLoopEndAsync("aborted")` + return
- **不发 `context_compressed`**
- 渲染端只在 `context_compressed` 时清 live store
- `loop_end`/`error` 均无兜底 → 琥珀色卡片永久悬在消息列表末尾

**修复**：
- 后端：取消分支补发 `CompressionStatus: "cancelled"` 的 `context_compressed`
- 前端：`loop_end` 与 `error` 两个 case 增加 `store.clear(sessionId)`

**验证**：
- ✅ 编译通过
- ⏳ 待手测验证

---

## 四、建议修复顺序

根据审查报告 §7 建议，结合优先级排序：

### Phase 1：阻断项（P0）
1. **I24-1** 代理越权（一行级）—— 工具精简方案先决条件
2. **I24-2** 数据损坏 + **I24-12** 误报成功 —— 用户可见行为缺陷

### Phase 2：重要项（P1）
3. **I24-3 ~ I24-7** 隔离纵深五件套
4. **I24-8 ~ I24-10** 并发与语义一致性
5. **C24-1** 手测验证

### Phase 3：建议项（P2）
6. **I24-11 ~ I24-18** 行为一致性与工程规范
7. §4 建议项随手修
8. §5 专项事项（S2 删除死副本、S3 核实）

---

## 五、待验证项

1. **Plan A 全局任务工作台** — 端到端功能测试
2. **Plan B 会话 Todo** — 端到端功能测试
3. **压缩取消竞态** — 手测 live 卡片泄漏修复
4. **自动更新端到端** — 低版本安装包验证 update-available → 下载确认 → 安装重启
5. **真实 Electron E2E** — 环境约束未运行

---

## 六、总结

### 已完成
- ✅ 共同前置：会话上下文模型统一
- ✅ Plan A 步骤 1-7：全局 Agent + Task Board
- ✅ Plan B 步骤 1-6：会话 Todo 体系
- ✅ issues 批次：侧边栏/文件树/流式/图片/更新/压缩卡片
- ✅ 代码审查报告 10/11：发现 2 阻断 + 16 重要 + 若干建议
- ✅ 人格精简：-43% 行数，-11% 字符

### 待完成
- ⏳ Phase 1 阻断项修复（I24-1、I24-2）
- ⏳ Phase 2 重要项修复（I24-3 ~ I24-10）
- ⏳ 用户 E2E 验证
- ⏳ 迭代收尾（合并 main、打 tag、发 Release）

---

## 七、参考文档

- 迭代计划：`docs/plans/iter-v2-24/plan.md`
- Plan A 详细计划：`docs/plans/iter-v2-24/plan-task-panel/`
- Plan B 详细计划：`docs/plans/iter-v2-24/plan-session-tasks/`
- issues 修复计划：`docs/plans/iter-v2-24/plan-issue-fixes/`
- 审查报告 10：`docs/reviews/review-10-iter24.md`
- 审查报告 11：`docs/reviews/review-11-iter24-updater-compression.md`
- 工具精简分析：`docs/tool-slimming-analysis.md`
- 人格精简记录：`docs/persona-slimming-record.md`
