# Plan: v2-iter-27 任务跟进、更新体验与运行时容灾

- 状态：规划验证通过，待用户确认后执行
- 分支：`dev/v2-iter-27`
- 基线：`v0.2.26` / `main` commit `59d86e6209c4621fe646d108995bae8233b257f1`
- 目标版本：`0.2.27`
- 探索证据：`docs/plans/iter-v2-27/exploration_findings.md`
- 需求来源：Obsidian `issues/bugs.md`、`issues/改进.md`，以及 `docs/progress/v2-iter-26.md` 的升级验证移交

## 目标

在已有实现基础上完成五个功能单元：

1. 更新弹窗扩大、全屏阅读和 v0.2.26 → v0.2.27 真机升级验证。
2. 修复扩展子项之间无法切换的导航缺陷。
3. 打通会话级临时 Todo、跨会话普通消息、临时倒计时和自动跟进；同时保持复杂任务直接走全局任务与 dispatch 回传。
4. 在现有 Provider 内重试之上增加有限重试耗尽后的多服务商 fallback。
5. 完成独立审查、三套 TypeScript、C#、AOT、核心流程和发布资产验证。

核心任务边界：

```text
简单临时任务：
当前会话 → 普通 send_session_message → 会话 Todo + follow-up 倒计时
           → 到点自动唤醒当前会话 Agent → 查询目标会话 → 反馈并完成 Todo

复杂任务：
全局会话 → create_global_task → send_work_request
          → 目标会话 reply_global_dispatch
          → 更新 global task/dispatch → 唤醒来源全局会话 → 反馈用户/渠道
```

跨会话不等于全局任务；临时倒计时是跟进机制，不是第三种任务类型。

## 已确认决策

- 更新弹窗：默认扩大，提供弹窗内宽屏/全屏切换；不改为独立窗口。
- 临时倒计时到点：自动唤醒来源会话 Agent 查询，不只是通知用户。
- 简单跨会话任务：使用普通 `send_session_message`，不创建全局任务或 dispatch。
- 复杂任务：直接创建全局任务并发送 dispatch，不先创建会话 Todo 再升级。
- 反馈范围：应用内会话和渠道会话均支持。
- 多服务商切换：当前 Provider 先按现有策略重试，达到有限重试上限后才切换；下一次新请求从首选 Provider 开始。
- `requestMaxRetries=0`：严格无限重试，不触发 fallback。
- 配额格式：5 小时/周限额无法统一解析时仍按重试策略处理，有限重试耗尽后切换；不能因为无法识别配额而提前切换。

## 跨功能硬契约

### 任务路径

- 会话 Todo 继续使用 `tasks` 表；不把全局任务字段直接塞入 Todo 表。
- 临时跟进使用独立的轻量持久化记录，至少保存 `followUpId`、`todoId`、`sourceSessionId`、`targetSessionId`、`followUpAt`、状态、查询指令、最近结果和通知幂等信息。
- 简单任务只写会话 Todo + 临时跟进记录，不写 `global_tasks` / `global_task_dispatches`。
- 复杂任务直接使用已有 `global_tasks` / `global_task_dispatches` / `reply_global_dispatch` 链路。
- 同一 Todo 或 dispatch 的完成结果只能反馈一次；应用内反馈和渠道反馈分别记录成功/失败。
- 来源会话正在执行用户回合时，倒计时跟进不得并发打断；应延迟重排或进入可见的等待状态。
- 应用重启后未触发的临时跟进必须恢复；到期事件必须单飞，不能重复唤醒。

### 临时跟进调用契约

- 普通 `send_session_message` 保持现有语义：参数不含 `followUp` 时只发送消息并返回发送结果，不创建 Todo、follow-up 或 global task。
- 需要自动跟进时由 Agent/Renderer 显式传入具名 `SessionFollowUpRequest`：`todoId`、`sourceSessionId`、`targetSessionId`、`followUpAt`、`queryInstruction`、可选渠道来源信息；调用先校验来源/目标，再以幂等 `followUpId` 创建跟进记录，随后发送普通 session message，并把 `followUpId` 返回给来源会话。
- 创建跟进失败时不发送原始任务；普通消息发送失败时跟进记录标记 `failed` 并保留可重试状态；目标不存在时立即写入失败原因并完成一次来源反馈。跟进查询始终按 `followUpId` 定位，不重复发送原始任务。
- `session_follow_up` 只写 `tasks` 与独立跟进记录，禁止调用 `send_work_request` 或写入 `global_tasks` / `global_task_dispatches`；复杂编排由 Agent 直接选择 `global_dispatch`，不经过该契约。

### 分层与序列化归属矩阵

| 组件 | 所属层 | 允许依赖/职责 | 注册或验证位置 |
|---|---|---|---|
| 跟进请求、状态、响应 DTO | Contracts/shared | 仅数据契约，无 DB/Agent 实现 | Worker/Renderer 显式类型 |
| 跟进实体、表、索引、DB 工具 | Infrastructure | SQLite 持久化；不依赖 Agent/Worker | `InfrastructureJsonContext`；DB migration test |
| 跟进状态机、查询 executor、来源唤醒 | Agent | 复用 Contracts/Core/Infrastructure；不依赖 Worker | Agent runtime tests |
| Main 跟进调度与 IPC 转发 | Electron Main | 定时器、恢复、单飞、事件投递；不承载领域持久化 | Main tests/smoke |
| Worker endpoint/module | Worker | 仅宿主、DI、模块注册和 IPC endpoint wiring | `WorkerModuleCatalog`；不得放业务状态机 |
| Renderer store/UI 与渠道桥接 | Renderer/Main plugin path | 展示和发送反馈，不改变全局任务状态机 | TS typecheck + integration tests |
| Provider fallback 配置/事件 | shared + Agent | 配置由 shared/Renderer 保存，状态机由 Agent 执行 | 对应 JSON context + AOT |

新增具名 JSON 类型必须注册到对应 context；`WorkerResponse.Json` 显式传 `JsonTypeInfo`，集合类型（如 `List<T>`）一并注册。不得使用匿名类型、反射扫描或独立未配置的 `JsonSerializerOptions`。

### Provider fallback

- fallback 不改变现有 Provider 内退避、Retry-After、取消和流式事件语义。
- 一个逻辑请求内 Provider 尝试不得循环；所有候选失败时返回包含各 Provider 最后错误的聚合结果。
- 切换时保留 system prompt、历史消息、当前用户消息、工具调用和工具结果上下文。
- `requestMaxRetries=0` 永不切换；有限值耗尽后才切换。
- 用户取消后不再启动重试或切换。
- fallback 配置和运行状态必须使用显式 JSON 类型，不引入 AOT 禁止的反射或匿名类型序列化。

## 步骤清单

### Plan A：更新弹窗扩大与真机升级验证

- [ ] A1：读取现有 updater 组件、共享快照和样式约束，设计默认尺寸与 fullscreen 状态；确认不会破坏后台下载、托盘恢复、显式安装闸门。验证：形成实现范围记录，确认 `UpdateDialog` 仍只通过既有回调触发下载/安装。
- [ ] A2：修改 `UpdateDialog.tsx`、必要的 updater 样式和中英文 settings 文案，实现响应式大尺寸与弹窗内全屏切换；保持 `UpdateReleaseNotes` 的安全渲染与滚动。Mini：三套 `tsc --noEmit -p`、C# solution、更新相关测试、`git diff --check`。
- [ ] A3：开发态交互核验普通/全屏模式、键盘可达性、长日志滚动、状态切换和弹窗关闭恢复。证据：截图保存到 `docs/plans/iter-v2-27/evidence/update-dialog-fullscreen.png`，不含真实路径、凭据或用户数据。
- [ ] A4：使用低于 `0.2.27` 的旧版安装包，实际执行检查更新 → 查看说明 → 后台下载 → 关闭/恢复弹窗 → 托盘查看 → 下载完成 → 明确确认安装 → 重启。核验安装后版本、用户数据和会话状态；检查 Release 的 setup.exe、`latest.yml`、必要的 `.blockmap` 与 `latest.yml` 中版本/path/url/sha512/size 一致。证据写入 `docs/plans/iter-v2-27/verification-update-upgrade.md`。

涉及文件：

- `src/renderer/src/components/updater/UpdateDialog.tsx`
- `src/renderer/src/components/updater/UpdateReleaseNotes.tsx`（仅在布局需要时）
- `src/renderer/src/components/updater/UpdateStatusBanner.tsx`（仅在全屏/恢复入口需要时）
- `src/renderer/src/locales/zh/settings.json`
- `src/renderer/src/locales/en/settings.json`
- `src/main/updater.ts` / `src/main/updater-state.ts`（仅若现有快照无法支持布局状态，不改变安装契约）
- `docs/plans/iter-v2-27/evidence/*`
- `docs/plans/iter-v2-27/verification-update-upgrade.md`

### Plan B：扩展子项互斥切换

- [ ] B1：将 `draw`、`tasks`、`taskboard` 的活动页统一为单一状态，兼容现有 open/close 调用方；更新 `ui-store-interface.ts`、`ui-store.ts`。验证：状态层测试或静态断言保证任意时刻最多一个扩展页活动。
- [ ] B2：更新 `WorkspaceSidebar.tsx` 和 `MainLayout.tsx`，使扩展菜单选项切换到目标页面并清理旧页面状态；返回聊天时清除活动扩展页。Mini：三套 TypeScript、C# solution、`git diff --check`。
- [ ] B3：人工回归聊天 → 自动化 → 任务面板 → 自动化 → 绘图 → 聊天，以及反向切换路径；截图或录屏证据保存到 `docs/plans/iter-v2-27/evidence/extension-switching.png`。

涉及文件：

- `src/renderer/src/stores/ui-store-interface.ts`
- `src/renderer/src/stores/ui-store.ts`
- `src/renderer/src/components/layout/WorkspaceSidebar.tsx`
- `src/renderer/src/components/layout/MainLayout.tsx`
- 相关 UI store 测试（如已有测试目录）

### Plan C：会话 Todo 临时倒计时与全局任务闭环

#### C1：数据契约与持久化

- [ ] C1.1：在 `DbClient.cs` 增加独立临时跟进表及索引，配套实体、行模型、JSON context 和 DB 工具；设计字段覆盖来源 Todo、目标 session、触发时间、状态、查询指令、最近结果、重试/下一次跟进时间和通知幂等键。兼容已有数据库，使用现有初始化/迁移模式，不删除或重建用户表。Mini：对全新库和已有库执行 schema 检查，确认表/索引存在且原有 `tasks`、`global_tasks` 数据不变；运行 DB 单测并执行 `npx tsc --noEmit -p tsconfig.web.json`。
- [ ] C1.2：增加 Worker endpoint 与 shared/renderer 类型，支持创建、查询到期记录、领取/锁定、更新结果、取消和恢复。所有写入幂等；到期领取只能成功一次。Mini：C# build 0 错误；执行 `npm run build:worker:prod`（即 `node scripts/publish-aot-worker.mjs`，设置 `DOTNET_ROOT=D:\claw\dotnet-sdk`），AOT 0 错误且无 IL2026/IL3050/IL3051 警告；端点回归测试覆盖重启恢复、重复领取和取消。

#### C2：简单临时跨会话路径

- [ ] C2.1：扩展 Agent/Renderer 的临时任务调用契约：无 `followUp` 参数的普通 `send_session_message` 只发送并立即返回；显式 `SessionFollowUpRequest` 才按 `todoId`/`sourceSessionId`/`targetSessionId`/`followUpAt`/`queryInstruction` 创建幂等跟进记录，再发送普通消息并返回 `followUpId`。创建失败不得发送原始任务，普通消息失败须标记跟进失败；全过程禁止创建 global task/dispatch。Mini：契约测试断言普通消息不写 `tasks`/follow-up/global 表，临时模式只写 Todo/跟进表且立即返回 `followUpId`，重复 `followUpId` 不重复发送。
- [ ] C2.2：实现 Main 侧临时跟进调度器，复用现有 Cron scheduler 的 timer、恢复、锁和事件投递原则，但不复用 Cron 的用户任务 UI。到期事件发送到 Renderer/Agent runtime；来源 session 忙时不打断，按策略延期重排。Mini：使用可控时钟测试到期恢复、重启恢复、重复事件单飞、忙会话延期和取消后不触发；证据写入 `docs/plans/iter-v2-27/evidence/follow-up-scheduler.md`。
- [ ] C2.3：实现自动唤醒来源会话 Agent 的查询消息；查询目标 session 的运行状态、最近结果或失败原因。结果完成时更新 Todo；未完成时只更新 follow-up 并安排下一次倒计时，不重复发送原始任务。Mini：状态机测试覆盖 running/completed/failed/not-found，断言唤醒只发生一次、未完成只更新 `nextFollowUpAt`、原始消息发送次数保持 1。
- [ ] C2.4：接通应用内和渠道反馈，复用现有 session message 与 plugin sendMessage 路径；反馈成功后写入幂等状态，失败保留可重试状态和日志。Mini：覆盖简单跨会话成功、未完成重排、目标不存在、来源会话忙、应用重启、重复到期事件和渠道发送失败。

#### C3：复杂全局任务路径保持并验证

- [ ] C3.1：核对并补齐已有 `create_global_task` → `send_work_request` → `reply_global_dispatch` → source session 回传链路，只修实际缺口，不把简单 Todo 转换为全局任务。Mini：对现有链路做调用图与集成断言，确认 dispatch reply 更新后只唤醒来源 session 一次，且 session follow-up 表保持 0 新记录；记录实际缺口与修复文件。
- [ ] C3.2：确认目标会话回传完成/阻塞/失败/追问时，全局 task、dispatch 和来源会话状态一致；来源会话被唤醒后能整理结果并反馈应用内/渠道。Mini：全局任务现有回归测试 + 重复 reply 幂等测试。

涉及文件（以 C1 探索结果为准，禁止未经读取直接修改）：

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/` 临时跟进实体/工具/JSON context
- `src/runtime/WishfulClaw.Contracts/`（如需要新增契约）
- `src/runtime/WishfulClaw.Agent/` 临时跟进 executor、唤醒/查询逻辑
- `src/main/ipc/` 临时跟进调度与 IPC/reverse handler
- `src/renderer/src/stores/task-store.ts`
- `src/renderer/src/lib/tools/project-send-message.ts`
- `src/renderer/src/lib/tools/cron-runtime.ts`（仅抽取可复用调度能力时）
- `src/renderer/src/hooks/use-channel-auto-reply.ts`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalDispatchReplyExecutor.cs`（仅修实际缺口）
- shared types、相关测试和中英文文案

明确不修改：简单临时任务不得调用 `send_work_request`，不得写 `global_tasks` / `global_task_dispatches`；不重写已有全局任务状态机。

### Plan D：多服务商有限重试后 fallback

- [ ] D1：梳理所有 Agent provider turn 入口、Provider payload 构造、重试策略调用点和流式事件生命周期，确定一个逻辑请求的 provider attempt 边界；为 fallback 设计纯状态机/纯函数，明确候选 Provider、已尝试集合、当前 attempt、最终聚合错误和取消行为。验证：输出调用链与不变式，确认不会重复工具调用。
- [ ] D2：扩展 shared/provider 配置和 Renderer provider store，增加 fallback 开关、Provider 优先级和必要的状态字段；在 Provider 设置页增加可排序配置和基础状态展示。保留现有模型选择、Provider 删除/启用和 `requestMaxRetries` 语义。Mini：三套 TypeScript、配置持久化测试、`git diff --check`。
- [ ] D3：扩展 C# `ProviderRetryPolicy` 或其上层调度，使有限重试耗尽后返回可切换结果；`requestMaxRetries=0` 保持无限且不切换；同一请求按排序逐个尝试，不循环；取消立即终止。新增结构化 fallback/重试事件和聚合错误。Mini：C# solution 0 错误；执行 `npm run build:worker:prod`（设置 `DOTNET_ROOT=D:\claw\dotnet-sdk`），AOT 0 错误且无 IL2026/IL3050/IL3051 警告；状态机测试覆盖 429/503/超时、有限/无限、全失败、取消和旧事件。
- [ ] D4：接入实际 Agent Loop/provider turn，切换时完整复用请求上下文和工具结果；覆盖 Anthropic、OpenAI Chat、OpenAI Responses 的共同入口，不在各 Provider 中复制 fallback 状态机。Mini：Provider 请求回归、工具调用中途切换、流式事件不重复、session/channel 路径不丢来源。
- [ ] D5：配额信息只作为可选观测增强；无法统一解析 5 小时/周限额时仍按当前 Provider 重试，有限上限耗尽后切换。日志记录原 Provider、目标 Provider、重试次数、切换原因和最终结果。人工验证至少使用两个可控测试 Provider/Mock endpoint，禁止依赖真实 API 触发限额。

涉及文件：

- `src/runtime/WishfulClaw.Agent/ProviderRetryPolicy.cs`
- `src/runtime/WishfulClaw.Agent/AgentLoop*.cs`
- `src/runtime/WishfulClaw.Agent/Providers/*`
- `src/shared/types/provider.ts`
- `src/renderer/src/stores/provider-store.ts`
- `src/renderer/src/components/settings/ProviderPanel.tsx` 及 Provider 配置子组件
- `src/renderer/src/stores/quota-store.ts`（仅在状态契约确需复用时）
- Worker/IPC 配置同步、JSON context、测试文件和 locales

### Plan E：统一审查、验证与发布

- [ ] E1：每个实现步骤完成后执行 Mini 门槛：
  - `npx tsc --noEmit -p tsconfig.web.json`
  - `npx tsc --noEmit -p tsconfig.node.json`
  - `npx tsc --noEmit -p tsconfig.json`
  - `dotnet build src/runtime/WishfulClaw.sln`
  - C#、JSON 契约或 Worker 注册改动必须额外设置 `DOTNET_ROOT=D:\claw\dotnet-sdk` 执行 `npm run build:worker:prod`（`node scripts/publish-aot-worker.mjs`）；要求 Native AOT 发布成功且无 IL2026/IL3050/IL3051 警告，产物只写既有 `resources/worker`，不另建临时发布目录
  - 对应单元/回归测试与 `git diff --check`
  每个通过步骤立即 commit，提交信息遵循 `feat/fix/test(scope): 步骤N - 简述`。
- [ ] E2：启动独立代码审查，输出 `docs/plans/iter-v2-27/review_report.md`；检查分层、AOT、错误处理、任务幂等、取消传播、渠道安全和是否误把简单任务送入全局任务。
- [ ] E3：修复审查问题并提交 `review(v2-iter-27): 审查修正`；审查报告无阻断项后进入验证态。
- [ ] E4：输出 `docs/plans/iter-v2-27/verification_report.md`，记录所有命令、退出码、测试结果、日志/截图证据、未能验证的项目和原因；不得用走查代替真机升级或渠道人工验证。
- [ ] E5：用户确认 PASS 后才执行 v0.2.27 收尾：更新 `package.json` 和 README 版本徽章，打包 NSIS，核验并上传 setup.exe、`latest.yml`、必要的 blockmap；合并 main、打 tag `v0.2.27`、更新 `docs/PROGRESS.md` 和 `docs/progress/v2-iter-27.md`，发布 GitHub Release。

## 验收场景

### 简单临时跨会话任务

```text
当前会话：让 A 项目会话汇总文档，3 分钟后告诉我结果
```

必须满足：

1. 创建当前会话 Todo。
2. 普通消息发送到 A 项目目标会话并立即返回。
3. 不出现全局任务面板记录。
4. 持久化临时倒计时。
5. 到点自动唤醒当前会话 Agent。
6. 查询目标会话结果。
7. 完成 Todo 并反馈当前应用内会话。
8. 如果来源是微信/飞书，结果回推原渠道。

### 复杂全局任务

```text
全局会话：让 A、B 两个项目分别执行准备工作并最终汇总
```

必须满足：

1. 直接创建全局任务。
2. 创建多个 dispatch。
3. 目标会话执行并 `reply_global_dispatch`。
4. 全局任务和 dispatch 状态一致。
5. 来源全局会话被唤醒并汇总结果。
6. 应用内或渠道收到最终结果。

### Provider fallback

1. 当前 Provider 失败后先按现有配置重试。
2. 有限重试耗尽后切换到下一个启用 Provider。
3. 下一个 Provider 使用完整原始上下文继续执行。
4. 成功后本轮结束，下一轮仍从首选 Provider 开始。
5. 无限重试不切换。
6. 取消不再切换。
7. 所有 Provider 失败时返回可诊断聚合错误。

## 不纳入

- v3 快速启动器插件化、URL/ZIP 轻应用、QwenASR。
- Windows 发布者签名和发布自动化流水线。
- iter-26 已完成事项及其备查的 ToolRegistry 大小写、Task fast-model header、OpenAIChat providerId/id 命名问题。
- 将简单跨会话 Todo 自动升级为全局任务。
- 为统一配额格式而一次性实现所有服务商专用配额适配器。
