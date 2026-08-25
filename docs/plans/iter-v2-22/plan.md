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
- 暂不实现全量执行日志表；保留任务级 `lastRunAt/lastRunStatus/lastRunSummary/lastError/fireCount`，为后续执行历史迭代留接口。

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
- [ ] 步骤10：补齐 Cron 功能测试与恢复测试。自动化子单元已新增独立 `WishfulClaw.CronRegressionTests`，使用系统临时目录和隔离 SQLite，覆盖新库完整 DDL、精简旧表迁移、create/get/list、软删除过滤、`includeDeleted`、`enabledOnly`、patch update、toggle、重复 mark-fired、mark-run-finished、软删除禁用、子进程重新打开后的配置与运行状态持久化，以及 Native `CronToolProvider` 的 at/every/cron、delivery/plugin/session/model/workingFolder/maxIterations/update patch schema。测试复现并修复两个生产问题：旧 `cron_tasks` 缺列时索引早于迁移创建会导致初始化失败；`DbCronTools.Update` 重复绑定 `@id` 导致 update 失败。自动化验证：Cron regression build 0 警告/0 错误，父进程 schema 35 项、旧库迁移/CRUD 63 项、进程重开 6 项、新库 DDL 5 项全部通过；TypeScript 三配置、Infrastructure build 和 `git diff --check` 通过。仍待 Electron 运行时冒烟：Main timer 的 at/every/cron 与时区、应用/Worker 重启恢复、真实 Agent 成功/失败、周期连续触发、deleteAfterRun 完成后归档、微信/飞书在线/断线及通知失败隔离；完成这些证据前步骤 10 保持未完成。自动化实现提交：`0413ee4`。

### FU-E：定时任务 UI 重设计

- [ ] 步骤11：将 Automation 占位页替换为 Reasonix 风格的定时任务设置页。新增任务列表、状态筛选、启用/禁用、删除、运行一次、最近运行状态、下次执行时间和错误摘要；复用现有 UI store、IPC client 和组件规范。验证：从 WorkspaceSidebar 的 Automation 入口进入真实页面，列表能从 DB 加载并操作任务；TS web 零错误。
- [ ] 步骤12：实现创建/编辑任务表单。支持 at/every/cron 三种模式、时区、prompt、模型/工作目录、最大迭代次数、deleteAfterRun、通知方式；选择微信/飞书时展示插件和目标 chatId 配置，并对必填字段做前端校验。验证：UI 创建的任务能被 Agent 工具 CronList 读到，编辑后调度配置生效；中英文无裸 i18n key。
- [ ] 步骤13：将 OpenCowork Automation 日历作为预览视图并补执行反馈。列表、详情、表单和日历共享同一套 SQLite 任务数据与事件状态；日历只负责展示任务分布、下次执行时间和跳转详情，不引入第二套编辑/持久化逻辑。验证：任务触发时 UI 显示 fired/running/finished/error；页面切换回来状态仍从 DB 恢复。

### FU-F：审查与最终验证

- [ ] 步骤14：独立审查代码和数据迁移。检查分层、AOT、敏感日志、并发更新、任务重复注册、启动竞态、渠道失败隔离、历史数据库兼容性；修正问题并输出 `review_report.md`。验证：审查报告 0 个阻断项。
- [ ] 步骤15：完整编译、AOT、启动和人工验收。运行 C# solution build、AOT publish、TS 三配置、diff check；启动应用完成微信/飞书和 Cron 端到端冒烟，输出 `verification_report.md`。验证：由用户裁定 PASS/FAIL/PARTIAL，Agent 不自行判定迭代完成。

## 当前执行状态

- 已完成：步骤 1-9 / 15；步骤 10 自动化子单元已完成，已落地隔离 Cron 回归测试、Native schema 契约对齐、旧表迁移顺序修复和 update 参数修复。
- 当前安全点：Cron regression build/run、TypeScript 三配置、Infrastructure build 和 `git diff --check` 已通过；自动化实现待提交。
- 下一步：继续 FU-D 步骤 10 的 Electron 运行时冒烟，补 Main timer、应用/Worker 重启恢复、真实 Agent、周期连续触发、完成后归档及微信/飞书成功/失败证据。
- 未执行：merge、tag、push、release；最终 PASS/FAIL/PARTIAL 仍由用户在步骤 15 验证后裁定。
- 当前已知基线问题：全量 `WishfulClaw.sln` 构建仍受既有 CodeGraph 缺失符号影响（`CodeGraphModule`、`CodeGraphNativeLibraryResolver`），不归因于本迭代 Cron 改动。

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
- `src/renderer/src/lib/tools/cron-events.ts` — 事件模型与订阅。
- `src/renderer/src/lib/tools/cron-tool.ts` — schema 与 DB 端点参数保持一致。
- `src/renderer/src/lib/ipc/channels.ts` / `messagepack-channel-routing.ts` — 新增端点和事件常量。
- `src/renderer/src/stores/ui-store.ts` 或新增 automation store — 页面状态，不重复持久化任务数据。
- `src/renderer/src/locales/zh/layout.json`、`en/layout.json` 及相关设置文案。

### 文档

- `docs/plans/iter-v2-22/exploration_findings.md`
- `docs/plans/iter-v2-22/plan.md`
- `docs/plans/iter-v2-22/compliance_report.md`
- `docs/plans/iter-v2-22/review_report.md`
- `docs/plans/iter-v2-22/verification_report.md`
- `docs/PROGRESS.md`

## 参考源码

- `D:\claw\OpenCowork`：Cron 调度、任务 UI、渠道主动消息设计参考；只参考边界和行为，不直接复制命名空间。
- 本仓库已有实现：`src/main/ipc/reverse-handlers/cron-reverse-handler.ts`、`src/renderer/src/lib/tools/cron-events.ts`、`src/runtime/WishfulClaw.Agent/AgentRuntimeCronExecutor.cs`、`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`。

## 不在本 Plan 内

- 快捷搜索扩展数据源、扩展 Tab、在线翻译、DeepSeek 网页版。
- URL 插件注册、用户自定义插件、ZIP 轻应用、XinXiang JSBridge。
- 全量 Cron 执行日志和复杂统计报表。
- 正式版 v2-iter-23 发布、打包、tag、GitHub Release。
