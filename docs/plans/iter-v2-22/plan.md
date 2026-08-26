# Plan: v2-iter-22 — 微信/飞书渠道与定时任务打磨

## 目标

将微信/飞书渠道和 Cron 定时任务从“基础链路已存在”打磨到可持续使用：渠道会话首次创建时使用“渠道前缀 + 机器人名称”作为固定标题，渠道前缀只拼接一次；后台任务可以向指定微信/飞书会话主动发送消息；Cron 任务进入 SQLite，支持启动恢复、执行状态记录和 UI 管理闭环。

本 Plan 不包含快捷搜索扩展、URL 插件、扩展 Tab、本地文件搜索插件、ZIP 轻应用和 XinXiang JSBridge，这些内容统一移入 v3。

## 设计边界

- SQLite 是 Cron 任务配置和任务级运行状态的持久化来源。
- Cron 调度器仍由 Main 进程负责 timer/node-cron，不把定时器塞入 Worker。
- Worker/Infrastructure 提供 AOT 安全的 Cron 数据模型、DDL、CRUD 和查询端点。
- Main 负责调度器启动恢复、触发通知和渠道 `sendMessage`。
- Renderer 负责定时任务管理 UI、事件展示和 Agent 执行状态联动。
- 本次追加实现独立 `cron_runs` 执行记录表；任务级 `lastRunAt/lastRunStatus/lastRunSummary/lastError/fireCount` 继续保留作为快速摘要，`cron_runs` 负责逐次审计。

## 步骤清单

### FU-A：渠道会话标题与前缀收口

- [x] 步骤1：统一渠道标题生成规则。首次创建渠道会话时生成固定标题：优先使用渠道连接配置中的机器人名称，格式为 `飞书:<机器人名称>` 或 `微信:<机器人名称>`；名称缺失时回退为 `飞书对话`/`微信对话`。Main 负责生成并写入，renderer hydration 只使用 payload/DB 标题，不再次拼接；兼容历史 `飞书:`/`微信:` 标题，避免继续叠加。验证：新增飞书/微信会话的标题断言覆盖机器人名称、缺失名称回退和重复前缀输入；TypeScript web/node 零错误。实现提交：`121d52c`。
- [x] 步骤2：修复渠道标题持久化和后续消息复用。确保同一 `pluginId + chatId` 路由到已有会话时不因新消息重新生成或更新标题；历史标题保持不变，新增会话只初始化一次。验证：源码验证已有会话只读取 DB 标题，TypeScript web/node/根配置和 Infrastructure build 通过；项目暂无渠道单元测试 harness，连续消息人工联调留待端到端验收。实现提交：`121d52c`。

### FU-B：渠道主动消息边界

- [x] 步骤3：梳理并统一渠道主动发送 API。为 Main 内部后台通知建立显式参数模型，至少包含 `pluginId/pluginType/chatId/content`，微信需要保留发送所需 context token；复用现有 `plugin:exec sendMessage`，补齐飞书/微信参数校验、服务未启动和发送失败错误。验证：`sendChannelMessage` 已统一复用到 `plugin:exec sendMessage`，覆盖参数/服务状态/渠道类型校验；TS web/node/root、Infrastructure build 和 `diff --check` 通过。项目暂无 mock ChannelManager harness，真实微信/飞书发送留待端到端验收。实现提交：`b6ce3e7`。
- [x] 步骤4：补齐渠道主动消息日志和结果反馈。统一成功/失败日志字段（任务 ID、插件 ID、chatId、消息长度、错误），将发送结果回传给 Cron 任务状态层；不在日志中输出 token、secret 或完整消息内容。验证：`sendChannelMessage` 返回底层 `messageId`，成功/失败均写入统一 Main 日志，敏感字段和消息正文不进入日志；TypeScript 三配置和 `diff --check` 通过。Cron 状态回传将在 FU-D 接入。实现提交：`b6ce3e7`。

### FU-C：Cron 数据库持久化与启动恢复

- [x] 步骤5：设计并创建 Cron 数据表和迁移。新增 `CronEntity`/`CronRow`/`EntityMappers.MapCron`，字段覆盖任务配置（id/name/sessionId/scheduleJson/prompt/agentId/model/workingFolder/deliveryMode/deliveryTarget/pluginId/pluginType/pluginChatId/deleteAfterRun/maxIterations/enabled/deletedAt）和任务级运行状态（lastFiredAt/lastRunAt/lastRunStatus/lastRunSummary/lastError/fireCount/createdAt/updatedAt）。在 `DbClient` 增加 `cron_tasks` 的 `CREATE TABLE IF NOT EXISTS`、启停/软删除/更新时间索引和旧库 `EnsureColumn` 迁移；在 `InfrastructureJsonContext` 注册 `CronRow` 与 `List<CronRow>`，JSON 字段保持 opaque string，符合 AOT 分层约束。验证：DDL 覆盖新库初始化，`EnsureColumn` 覆盖已有库迁移路径；`git diff --check`、`npx tsc --noEmit -p tsconfig.node.json`、`npx tsc --noEmit -p tsconfig.web.json`、`npx tsc --noEmit -p tsconfig.json` 和 `set DOTNET_ROOT=D:\claw\dotnet-sdk && dotnet build src\\runtime\\WishfulClaw.Infrastructure\\WishfulClaw.Infrastructure.csproj --no-restore` 均通过（C# 0 错误、0 警告）。实现提交：`2677869`。
- [x] 步骤6：实现 Worker Cron CRUD/状态端点。新增 `DbCronTools`，注册 list/get/create/update/delete/toggle/mark-fired/mark-run-finished 八个端点；默认过滤软删除记录，删除使用软删除，SQL 全部参数化，结果类型显式注册到 Infrastructure AOT JSON context。验证：TypeScript 三配置、`git diff --check`、Infrastructure build 均通过（0 警告、0 错误）；Worker 重启后 SQLite 持久化验证留待步骤 10/15 联调。实现提交：`5d79154`。
- [x] 步骤7：改造 Main 调度器为 DB 驱动。Cron 创建/更新/删除/启停先通过 Worker DB 端点持久化，再注册或重排 timer；Main 启动时恢复 enabled 且未软删除任务；保留 at/every/cron 校验和时区逻辑，`+Ns/+Nm/+Nh/+Nd` 在落库前规范化为绝对毫秒；触发时记录 fired 状态，一次性任务软删除归档，并使用主窗口注册表发送事件。验证：TypeScript 三配置和 `git diff --check` 通过；真实应用重启/Worker 重启和三种调度端到端证据留待步骤 10/15。实现提交：`311d505`。

### FU-D：Cron 执行、渠道通知与失败恢复

- [x] 步骤8：完善 cron:fire 到 Agent 的参数透传。新增 Renderer Cron runtime，监听 MessagePack `cron:fire`，保留 prompt、模型、工作目录、sessionId、maxIterations、deliveryMode、deliveryTarget、pluginId、pluginChatId，复用 Sidecar Agent 执行链；为 fired、run-started、run-progress、run-finished 统一事件 payload，运行完成/失败/取消后回写 DB 状态。运行事件不携带完整 prompt 或敏感凭据，摘要限制长度。验证：`ipcClient.on('cron:fire')` 路由、App 单次初始化/卸载、TypeScript web/node/全量三配置和 `git diff --check` 均通过；桌面/会话/微信/飞书实际 delivery 端到端验证留待步骤 9/10/15。实现提交：`773621f`。
- [x] 步骤9：实现执行结果持久化和渠道通知。Agent 完成/失败/取消后统一生成结果摘要；支持 `desktop`（`notification:show`）、`session`（SQLite 消息持久化并同步已加载会话）、`plugin`（复用 `plugin:exec/sendMessage` 统一渠道边界）和 `none`。通知失败追加到任务 `last_error`，不改变 Agent 执行状态且不阻断周期任务后续触发；`deleteAfterRun` 任务触发时先停止并禁用，待执行、通知和状态持久化完成后再软删除归档并发出 `job_removed`。Worker `{ success:false, error }` 响应统一识别。验证：TypeScript 三配置、`git diff --check`、Infrastructure build 均通过（0 警告、0 错误；仅既有 .NET preview SDK 提示）；周期连续触发、Agent 失败恢复和微信/飞书成功/失败通知的真实运行证据留待步骤 10/15。实现提交：`4203f9e`。
- [x] 步骤10：补齐 Cron 功能测试与恢复测试。独立 `WishfulClaw.CronRegressionTests` 使用临时目录和隔离 SQLite，覆盖新库完整 DDL、精简旧表迁移、create/get/list、软删除过滤、`includeDeleted`、`enabledOnly`、patch update、toggle、重复 mark-fired、mark-run-finished、软删除禁用、子进程重开持久化，以及 Native `CronToolProvider` 的 at/every/cron 和完整执行参数 schema；追加断言验证 `mark-fired` 在单条 SQL 中原子递增计数并消费一次性任务。最终结果：父进程 38 项、旧库迁移/CRUD 76 项、进程重开 8 项、新库 DDL 8 项全部通过；新增独立 `cron_runs` 的 start/finish/list、会话过滤和重启恢复断言均通过。新增 `WISHFULCLAW_DATA_DIR` 后，SQLite、Provider、settings、渠道配置、MCP、日志与 Electron userData 均可隔离；受控 Electron 冒烟验证一次性任务恰好触发一次、预期 Agent/Provider 失败写入、完成后软归档并禁用，且无测试进程残留、无真实 Home MCP 连接、无未处理异常。基础实现提交：`5fc6788a`；本次审查补强尚未提交。

### FU-E：定时任务 UI 重设计

- [x] 步骤11：将 Automation 占位页替换为 Reasonix 风格的定时任务设置页。新增 `components/automation/AutomationPage.tsx`：任务列表（从 `cron:list` 加载）、状态筛选（全部/已启用/已禁用/最近成功/有错误）、Switch 启用禁用（`cron:toggle`）、删除（`cron:delete` 软删除）、运行一次（新增 Main 端 `cron:run-now`，复用 `fireJob` 触发完整执行链）、下次执行时间估算、最近运行状态图标、展开详情含 prompt 摘要/触发次数/通知方式/错误摘要；`cronEvents` 订阅 run_started/run_finished/job_removed 实时联动运行状态并刷新列表。MainLayout tasks 入口与 FEATURE_PAGES 均指向真实页面。新建任务按钮暂留禁用态（步骤 12 实现表单）。验证：TS web/node/root 三配置零错误；列表从 DB 加载待应用内人工确认。
- [x] 步骤12：实现创建/编辑任务表单。新增 `components/automation/CronJobFormDialog.tsx` + 共享类型 `cron-job-view.ts`：at（datetime-local）/every（分钟数）/cron（表达式+时区）三种模式、prompt、模型选择（provider-store，可跟随全局默认）、工作目录、最大迭代次数、deleteAfterRun、通知方式（desktop/session/plugin/none）；plugin 模式展示插件 ID 与 chatId 输入；name/prompt/schedule/sessionTarget/plugin 字段前端必填校验；创建走 `cron:add`、编辑走 `cron:update`（Main 反向请求），成功后刷新列表。中英文文案齐全无裸 key。验证：TS web/node/root 三配置零错误；UI 创建的任务能被 CronList 读到留待应用内人工确认。
- [x] 步骤13：将 OpenCowork Automation 日历作为预览视图并补执行反馈。新增 `AutomationCalendar.tsx`，列表/日历可切换，支持月份导航、按 Main 调度器提供的真实 `nextRunAt` 展示下一次执行、运行/错误状态和点击跳转详情；列表、详情、表单和日历共享 SQLite 任务数据与 `cronEvents` 运行态，不引入第二套编辑或持久化逻辑。运行中 Switch、编辑和删除统一禁用。验证：TypeScript 三配置、Electron build 和隔离运行时冒烟通过。实现提交：`5fc6788a`。

### FU-G：审查后补强：Cron 执行记录与会话关联

- [x] 步骤16：新增 `cron_runs` 表、Worker start/finish/get/list 端点；每次 `cron:fire` 生成独立 `runId` 记录，持久化 `cronId/sessionId/fireId/status/summary/error/toolCallCount/startedAt/finishedAt`。
- [x] 步骤17：Session 投递消息写入 `cronTaskId/cronRunId` 元数据，Automation 详情支持跳转关联 Session；补充新库 DDL、独立执行记录、过滤查询和重启恢复回归。

### FU-H：Automation 信息架构重构与双执行模式（用户逐项确认的产品决策）

> 本节记录 2026-08-26 与用户讨论后最终确认的决策与实现。这些是对步骤 11-13 表单的**有意推翻重做**，不是偏离计划；后续会话以此为准。

最终确认的产品规则：

1. 表单信息架构：标题 → 作用域（全局/项目）→ 提示词（含优化入口）→ Provider/Model → 执行权限 → 执行方式 → 输出目标。不向用户暴露 agentId/maxIterations/workingFolder/sessionId/pluginId/pluginChatId。
2. 固定少量选项使用 Reasonix `set-seg` 风格 segmented control（单一轨道、按钮贴边、选中态轻背景），高度对齐 Select 的 h-9；动态数据源仍用 Select。封装为共享组件 `components/ui/segmented-control.tsx`。
3. 执行频率为固定快捷项：一次性 / 固定间隔（数值+分钟/小时两字段）/ 每天 / 工作日 / 自定义（Cron+时区）；保存时转换为既有 at/every/cron 结构，编辑旧任务自动反解（本地时间格式化，避免 UTC 偏移）。
4. 执行权限默认 YOLO：表单只读展示，运行时显式传 `permissionMode: 'fullAccess'`（`buildSidecarAgentRunRequest` 增加可选覆盖参数，普通聊天不受影响）。
5. 执行方式双模式（`cron_tasks.run_mode`，默认 `background`）：
   - **后台执行**：沿用旁路 sidecar 链路，过程不可见；
   - **会话内执行**：复用 `chatStore.sendMessage` 主链路，全程流式可见；发送前确保 session 在 renderer store 中（重启后渠道会话由 Main 创建、store 缺失，必须注入并从 DB 恢复历史，否则 beginUserTurn 静默丢弃占位消息导致 delta 无处挂载）；目标为渠道会话时注册 `registerExternalChannelReply`，loop_end 后回复经 auto-reply 管道转发回飞书/微信；目标会话忙时跳过本次触发并记为 aborted。
6. 输出目标四项：**不通知（none）/ 新建会话 / 复用会话 / 机器人**。「不通知」是后台模式下的合法选项（deliveryMode=none，零投递）；机器人固定走后台。
7. 运行记录语义：会话内执行不在记录中重复存摘要（结果在会话里），记录提供「打开会话」跳转（按 run.sessionId，新建会话模式每次指向当次创建的会话）；后台执行记录保留摘要/错误/工具数。
8. 孤儿 running 记录处理原则：**禁止在应用启动时清理 DB**（避免启动污染）。采用查询侧惰性归一化——renderer 查询 `db/cron-runs-list` 时携带内存活跃 `activeRunIds`，Worker 将不在集合中的 running 行标记 aborted；不做时间启发式判定。另以 fireId 去重防止重复投递产生重复记录。
9. 列表/详情不展示内部实现字段；任务详情层不放「打开关联会话」按钮（执行记录中已有）。

实现状态：

- [x] 步骤18：数据层 `run_mode/scope/project_id/output_mode/reuse_session_id` 迁移与全链路 CRUD/fire 透传；Main 调度器与 renderer 契约同步。
- [x] 步骤19：新表单 `AutomationTaskFormDialog.tsx` + `AutomationModelSelector.tsx` 替换旧 `CronJobFormDialog.tsx` 入口；列表详情改为用户层字段；执行记录面板（最近 10 条、状态图标四态、会话内可跳转）。
- [x] 步骤20：会话内执行链路（sendMessage 复用、session 注入、渠道转发注册、忙时跳过、waitForStreamEnd 等待流结束）、fireId 去重、惰性孤儿归一化（`activeRunIds` 参数）、YOLO 权限覆盖链。
- [ ] 步骤21：端到端人工验收——渠道会话实时渲染与飞书回包、非渠道会话回归、后台+各输出目标组合、一次性任务归档；Electron/AOT 完整验证并入步骤 15 统一收口。

### FU-F：审查与最终验证

- [x] 步骤14：独立审查代码和数据迁移，并按 review-09-iter22 逐项补强。已修复 I22-1 Cron 更新失败补偿、I22-2 一次性任务默认行为、I22-4 Automation 失败 refresh、I22-5 agentId 表单、SAQ-1 全局配置驱动 limiter，以及 SAQ-2/SAQ-3 FIFO/取消/释放/生命周期回归；I22-3 已补充生产 Main 协调器级 harness，真实 Electron Main/Renderer 进程级 harness 仍是集成覆盖缺口。I22-6 文档状态已统一。审查报告仍作为问题基线，当前不能表述为“0 个审查缺口”。
- [ ] 步骤15：完整编译、AOT、启动和人工验收。本轮已重跑 C# solution build、TS 三配置、Goal/Cron regression、Cron Main 协调器 harness 与 diff check；Electron build、Worker Native AOT、隔离 Electron 冒烟和真实 Electron Main/Renderer 进程级 harness 仍待完成。当前状态为“技术验证部分通过，待用户最终裁定/确认迭代完结”；Agent 不自行将本迭代标记为 PASS 或完结。

### FU-I：追加修复批次（2026-08-26 用户确认追加）

> 来源：知识库 `D:\koda\Obsidian\02-AI教学\wishfulclaw\issues` 中筛选的简单可独立完成项 + 本轮提示词优化器重构收尾。
> 原则：每步独立可回滚，TS/C# 双编译零错误后 commit。

- [x] 步骤22a：提示词优化器剥离 agent loop 改单次请求（provider/complete），强制恰好 3 个不同视角方案；修复成功判定竞态（setState updater 惰性执行导致误报失败）；结果弹窗固定高度（85vh/60vh）。实现见 optimizer.ts / use-prompt-optimizer.ts / optimization-dialog.tsx。
- [x] 步骤22b：优化取消全链路贯通——渲染层 cancelKey 预生成随请求注册到 NativeWorkerManager（id 分配同刻注册消除时序竞态）→ worker/cancel → C# IWorkerRequestContext 取消令牌贯通 HTTP 与重试链。涉及 native-worker.ts / misc-handlers.ts / preload / ProviderCompletionService.cs / ProviderTestModule.cs / WorkerIpcHelpers.cs（诊断日志）。
- [x] 步骤23：删除服务商后"未配置 API Key"误报修复。横幅语义从"当前激活服务商缺 Key"改为"不存在任何已配置可用的服务商"（扫描全部 providers），删除无 Key 新建服务商后不再残留误报。实现提交：`24e5664`。
- [x] 步骤24：桌面图标白角调查。逐像素检测 icon.ico 全部 5 尺寸与全部 PNG 资源四角 alpha 均为 0（完全透明），打包产物与仓库资源 md5 一致——**资产与构建链路无误，白角为 Windows 图标缓存残留**。处理方式：用户清图标缓存后观察；若仍复现需截图进一步定位。结论记录于 `.tmp/step24-icon-findings.md`，无代码改动。
- [x] 步骤25：定时任务弹窗布局固定。新增/编辑弹窗标题与按钮固定、仅内容区滚动（DialogContent flex 列 + h-[88vh]，内容区 min-h-0 flex-1 overflow-y-auto，footer 加顶部分隔线）。实现提交：`35746a5`。
- [ ] 步骤26：FU-I 收尾——TS 三配置 + C# solution build 全绿，更新知识库三文件状态，等待用户统一验收（并入步骤 15）。

> 明确不纳入本批次（复杂度高或需用户进一步输入）：虚拟列表 prepend 闪烁（需方案重评估）、快速搜索内置应用扩展/简写匹配、工具并发队列、上下文压缩通知卡片、消息锚点吸附、Goal 编排可视化（已另列）、历史会话摘要体系、悬浮块重构、activity 占位面板（待用户确认来源）。

## 当前执行状态

- 已完成：步骤 1-14、16-20；FU-H（Automation 双执行模式重构）步骤 18-20 代码与静态验证已完成，步骤 21 端到端人工验收待用户执行。
- FU-H 补充说明：本轮在迭代 22 基线上追加 Automation 信息架构重构（用户逐项确认，见 FU-H），涉及文件含 `AutomationTaskFormDialog.tsx`、`AutomationModelSelector.tsx`、`segmented-control.tsx`、`cron-runtime.ts`、`use-channel-auto-reply.ts`、`sidecar-mapping.ts` 及 Cron DB/Main/renderer 契约扩展；旧 `CronJobFormDialog.tsx` 不再被页面引用但保留未删。TypeScript 三配置、Infrastructure C# 构建、locale JSON 解析、`git diff --check` 均通过；Electron/AOT 完整验证并入步骤 15。
- I22-3 的生产 Main 协调器级 harness 已补齐，但真实 Electron Main/Renderer 进程级 harness、步骤 15 剩余验证、人工验收、最终 PASS/FAIL/PARTIAL 与迭代完结仍待用户确认。
- 当前安全点：基础代码提交 `5fc6788a` 之上存在未提交的审查补强与 FU-H 改动；TypeScript 三配置、Cron Main 协调器 harness（15）、C# solution build（0 warning/0 error）、Goal regression（113）、Cron regression（38/76/8/8）、`git diff --check` 均通过。此前 Electron build、Worker Native AOT 和隔离冒烟证据仍见 `verification_report.md`；本次补强尚未重新执行 Electron/AOT。
- 运行时证据：隔离目录 `D:\claw\wishful-claw\.tmp\iter22-smoke-data-69209de3834545d9a05fdc2394a35e8e`；一次性任务恰好触发一次、记录预期 Provider 失败、完成后软归档并禁用；测试 Electron 根 PID `14524` 及其子进程已精确终止，`ROOT_RUNNING=False`、`RELATED_COUNT=0`，未触碰已安装版。
- 下一步：用户验收 FU-H 步骤 21 场景清单 → 审阅 `docs/reviews/review-09-iter22.md` / `verification_report.md` → 裁定迭代是否完结。
- 未执行：merge、tag、push、release。
- 既有 CodeGraph solution 基线断链已通过补回 Worker 项目引用修复；当前全量 solution 与 AOT 均通过。

## 涉及文件与模块

### Main / 渠道 / Cron

- `src/main/channels/auto-reply.ts` — 入站消息路由、标题生成、session-task payload。
- `src/main/channels/channel-types.ts` — 渠道消息/服务契约。
- `src/main/channels/providers/feishu/feishu-service.ts` — 飞书名称解析和主动发送。
- `src/main/channels/providers/weixin/*` — 微信入站信息和主动发送。
- `src/main/ipc/channel-handlers/channel-plugin-handlers.ts` — `plugin:exec` 和消息动作。
- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts` — Cron 调度、恢复、触发。
- `src/main/ipc/reverse-handlers/index.ts` — reverse request 路由。

### Runtime / DB / Worker

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — DDL、索引和迁移。
- `src/runtime/WishfulClaw.Infrastructure/Db/DbCronTools.cs` — 新建或拆分的 Cron CRUD/状态操作。
- `src/runtime/WishfulClaw.Infrastructure/Db/CronEntity.cs` / `CronRow.cs` — 新增数据模型，具体命名按现有 Db 约定落地。
- `src/runtime/WishfulClaw.Worker/Modules/DbModule.cs` — Worker 端点注册。
- `src/runtime/WishfulClaw.Infrastructure/InfrastructureJsonContext.cs` / Worker JsonContext — AOT 类型注册。
- `src/runtime/WishfulClaw.Agent/AgentRuntimeCronExecutor.cs` — 工具参数/反向请求适配，必要时补齐字段。

### Renderer / UI / IPC

- `src/renderer/src/components/layout/MainLayout.tsx` — Automation 页面入口替换。
- `src/renderer/src/components/layout/WorkspaceSidebar.tsx` — 保持入口，必要时调整文案/状态。
- `src/renderer/src/components/automation/*` — 新建任务列表、详情、表单、日历预览和执行状态组件。
- `src/renderer/src/components/ui/segmented-control.tsx` — FU-H 新增：Reasonix 风格 segmented 单选共享组件。
- `src/renderer/src/components/automation/AutomationTaskFormDialog.tsx` / `AutomationModelSelector.tsx` — FU-H 新表单与模型选择器（替代旧 `CronJobFormDialog.tsx`）。
- `src/renderer/src/lib/tools/cron-runtime.ts` — 事件模型与订阅；FU-H 扩展双执行模式、fireId 去重、会话内执行链。
- `src/renderer/src/lib/tools/cron-events.ts` — 事件模型与订阅。
- `src/renderer/src/lib/tools/cron-tool.ts` — schema 与 DB 端点参数保持一致。
- `src/renderer/src/hooks/use-channel-auto-reply.ts` — FU-H 扩展外部渠道回复注册（定时任务→飞书回包）。
- `src/renderer/src/lib/ipc/sidecar-mapping.ts` — FU-H 增加 permissionMode 覆盖参数。
- `src/renderer/src/lib/ipc/channels.ts` / `messagepack-channel-routing.ts` — 新增端点和事件常量。
- `src/renderer/src/stores/ui-store.ts` 或新增 automation store — 页面状态，不重复持久化任务数据。
- `src/renderer/src/locales/zh/layout.json`、`en/layout.json` 及相关设置文案。

### 文档

- `docs/plans/iter-v2-22/exploration_findings.md`
- `docs/plans/iter-v2-22/plan.md`
- `docs/plans/iter-v2-22/compliance_report.md`
- `docs/reviews/review-09-iter22.md`
- `docs/plans/iter-v2-22/verification_report.md`
- `docs/PROGRESS.md`

## 参考源码

- `D:\claw\OpenCowork`：Cron 调度、任务 UI、渠道主动消息设计参考；只参考边界和行为，不直接复制命名空间。
- 本仓库已有实现：`src/main/ipc/reverse-handlers/cron-reverse-handler.ts`、`src/renderer/src/lib/tools/cron-events.ts`、`src/runtime/WishfulClaw.Agent/AgentRuntimeCronExecutor.cs`、`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`。

## 不在本 Plan 内

- 快捷搜索扩展数据源、扩展 Tab、在线翻译、DeepSeek 网页版。
- URL 插件注册、用户自定义插件、ZIP 轻应用、XinXiang JSBridge。
- Cron 执行记录的复杂统计报表、分页 UI 和完整逐事件轨迹可继续后续迭代；本次已完成逐次运行账本和会话关联。
- 正式版 v2-iter-23 发布、打包、tag、GitHub Release。
