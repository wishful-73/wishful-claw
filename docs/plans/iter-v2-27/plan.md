# Plan: v2-iter-27 任务跟进、更新体验与运行时容灾

- 状态：已收尾发布 `v0.2.27`（2026-09-11 老大确认完结）；交付状态见「交付状态」节，明细见 `docs/progress/v2-iter-27.md`
- 分支：`dev/v2-iter-27`
- 基线：`v0.2.26` / `main` commit `59d86e6209c4621fe646d108995bae8233b257f1`
- 目标版本：`0.2.27`
- 探索证据：`docs/plans/iter-v2-27/exploration_findings.md`
- 需求来源：Obsidian `issues/bugs.md`、`issues/改进.md`、`docs/progress/v2-iter-26.md` 的升级验证移交，以及老大补充的输入框 Bug

## 交付状态（2026-09-11 收尾）

十个功能单元交付九个，**Plan D 未实施**。

| Plan | 内容 | 状态 |
|---|---|---|
| A | 更新弹窗扩大与全屏阅读 | 代码交付；A3 经老大确认；A4 见下 |
| B | 扩展子项互斥切换 | 代码交付；B3 经老大确认 |
| C | 会话 Todo 倒计时与全局任务闭环 | 代码交付；C3.1/C3.2 链路核对完成，仍缺真实 dispatch 并发集成入口 |
| **D** | **多服务商有限重试后 fallback** | **未实施**，D1–D5 整块移交 iter-28 |
| F | 重试失败后 Agent 回复折叠块保留 | 代码交付；F3 经老大确认 |
| G | 渠道服务商筛选与模型隔离 | 代码交付；G3 经老大确认 |
| H | 输入框粘贴与 Ctrl+Z 撤销 | 代码交付，经老大 dev 与生产包两轮实测；残留撤销后选中态移交 iter-28 |
| J | 日志配置接管与日志管理 | 代码交付；J3 经老大确认 |
| K | 数据目录配置化与 dev/生产隔离 | 代码交付并经生产包安装验证；K0 常量收敛 TS 侧残留 3 处 |
| I | 统一审查、验证与发布 | I1–I5 全部完成；收尾发布已执行（merge `c3dde76f`、tag `v0.2.27`、Release 三资产齐备） |

**勾选依据**：实现类条目按代码证据勾（`logger.ts:51 setLogMinLevel`、`index.ts:546/553/560` 三个 log IPC、`settings-store.ts:222 logLevel`、`ui-types.ts:96 'logs'`、`WishfulClawDataDir.cs`、`ChannelConfigStore.cs` 等）。桌面验证类条目（A3/B3/F3/G3/J3/K3）按老大 2026-09-11「已经都测试过了，文档只是没同步而已」的确认勾，**未逐项留截图或录屏证据**，plan 原文要求的 `evidence/*.png` 未产出。

**Plan D 判定为未实施的证据**：`src/runtime` 全量 .cs 检索无 provider fallback 实现；`settings-store.ts` 中唯一的 `fallback` 是无关的 `memoryRecallGlobalFallback`。上文「已确认决策」第 47–49 条与「跨功能硬契约 · Provider fallback」整节停留在设计态。

**K0 残留**：约定 `.wishful-claw` 全项目仅两处定义。C# 侧已收敛到 `WishfulClawPaths.cs:5` 一处；TS 侧除正主 `src/shared/data-dir.ts:1` 外仍有三处字面量——`project-archive-helpers.ts:41`（`WISHFUL_CLAW_DIR`）、`memory-files.ts:9`（`PROJECT_MEMORY_DIRNAME`）、`codegraph-handlers.ts:170`（直接拼接），前两处是 K0 点名要删的独立定义。移交 iter-28。

**A4 为何留到发布后**：GitHub Release 在发布 0.2.27 之前只有 0.2.26，升级链路无法在发布前实跑。须发布后按 AGENTS.md「发布后核验」用低于当前 Release 的本地安装版实调 `electron-updater.checkForUpdates()`，确认进入 `update-available`，再测下载确认与安装确认。

## 目标

在已有实现基础上完成十个功能单元：

1. 更新弹窗扩大、全屏阅读和 v0.2.26 → v0.2.27 真机升级验证。
2. 修复扩展子项之间无法切换的导航缺陷。
3. 打通会话级临时 Todo、跨会话普通消息、临时倒计时和自动跟进；同时保持复杂任务直接走全局任务与 dispatch 回传。
4. 在现有 Provider 内重试之上增加有限重试耗尽后的多服务商 fallback。
5. 修复重试失败后的 Agent 回复折叠块保留问题。
6. 完善渠道配置的服务商筛选、启用和模型隔离。
7. 修复输入框偶发不接收粘贴值以及粘贴后 Ctrl+Z 无法撤回的问题。
8. 完成独立审查、三套 TypeScript、C#、AOT、核心流程和发布资产验证。
9. （迭代中追加）日志等级接管统一设置并新增设置内日志管理页面（Plan J）。
10. （迭代中追加）数据目录配置化与测试环境隔离，支持 dev/生产双实例并存（Plan K）。

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
- （Plan K）使用模式：生产安装版为开发主力，`npm run dev` 拉第二实例验证改动，两实例并发是常态。
- （Plan K）目录名单一定义点：`.wishful-claw` 这个字符串在全部代码中只允许**两处**定义——TS 一处、C# 一处，与 `package.json` 之于版本号同构（版本号现状即 `package.json` → `app.getVersion()` 单源，仅 README 徽章为手工投影）。其余任何位置一律引用常量，不得再出现字面量。
- （Plan K）dev 名由常量派生：dev 目录名写作 `${WISHFUL_CLAW_DATA_DIR_NAME}-dev`，只在全局 resolver 内部拼接，不作为第二个字符串常量存在。
- （Plan K）同源不同根：全局数据目录与项目级 `{工作区}/.wishful-claw/` 复用**同一个名字常量**，但根不同（home vs workingFolder），且**项目级永不加 dev 后缀**——它是用户仓库内的 gitignore 约定目录，改名等于污染别人的工作区。
- （Plan K）优先级链：`WISHFULCLAW_DATA_DIR` 环境变量 > dev 态默认（`!app.isPackaged` → `<name>-dev`）> 生产默认 `<name>`。
- （Plan K）C# Worker 不实现 dev 判断：只认 `WISHFULCLAW_DATA_DIR`，由 Main 经 worker 启动 env 链路传入，否则回退默认目录。
- （Plan K）不做生产 → dev 数据自动迁移；dev 目录首次启动为空，provider key 等手动复制一次。
- （Plan K）AUMID 相同、托盘双图标属外观共存问题，本迭代不处理。

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

- [x] A1：读取现有 updater 组件、共享快照和样式约束，设计默认尺寸与 fullscreen 状态；确认不会破坏后台下载、托盘恢复、显式安装闸门。验证：形成实现范围记录，确认 `UpdateDialog` 仍只通过既有回调触发下载/安装。
- [x] A2：修改 `UpdateDialog.tsx`、必要的 updater 样式和中英文 settings 文案，实现响应式大尺寸与弹窗内全屏切换；保持 `UpdateReleaseNotes` 的安全渲染与滚动。Mini：三套 `tsc --noEmit -p`、C# solution、更新相关测试、`git diff --check`。
- [x] A3：开发态交互核验普通/全屏模式、键盘可达性、长日志滚动、状态切换和弹窗关闭恢复。证据：截图保存到 `docs/plans/iter-v2-27/evidence/update-dialog-fullscreen.png`，不含真实路径、凭据或用户数据。
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

- [x] B1：在保留 `drawPageOpen`、`tasksPageOpen`、`taskBoardPageOpen` 兼容字段及现有 open/close 调用方的前提下，使三个 `openXxxPage` 操作互斥清理另外两个状态；更新 `ui-store.ts`。验证：静态断言保证任意 open 操作最多激活一个扩展页。
- [x] B2：核对 `WorkspaceSidebar.tsx`、命令面板和 `MainLayout.tsx` 的既有入口与页面清理行为；依靠互斥 open 操作使扩展菜单选项切换到目标页面并避免旧页面遮挡，返回聊天仍沿用现有清理逻辑。Mini：三套 TypeScript、既有 C# solution 构建结果、`git diff --check`。
- [x] B3：人工回归聊天 → 自动化 → 任务面板 → 自动化 → 绘图 → 聊天，以及反向切换路径；截图或录屏证据保存到 `docs/plans/iter-v2-27/evidence/extension-switching.png`。

涉及文件：

- `src/renderer/src/stores/ui-store-interface.ts`
- `src/renderer/src/stores/ui-store.ts`
- `src/renderer/src/components/layout/WorkspaceSidebar.tsx`
- `src/renderer/src/components/layout/MainLayout.tsx`
- 相关 UI store 测试（如已有测试目录）

### Plan C：会话 Todo 临时倒计时与全局任务闭环

#### C1：数据契约与持久化

- [x] C1.1：在 `DbClient.cs` 增加独立临时跟进表及索引，配套实体、行模型、JSON context 和 DB 工具；设计字段覆盖来源 Todo、目标 session、触发时间、状态、查询指令、最近结果、重试/下一次跟进时间和通知幂等键。兼容已有数据库，使用现有初始化/迁移模式，不删除或重建用户表。Mini：对全新库和已有库执行 schema 检查，确认表/索引存在且原有 `tasks`、`global_tasks` 数据不变；运行 DB 单测并执行 `npx tsc --noEmit -p tsconfig.web.json`。
- [x] C1.2：增加 Worker endpoint 与 shared/renderer 类型，支持创建、查询到期记录、领取/锁定、更新结果、取消和恢复。所有写入幂等；到期领取只能成功一次。Mini：C# build 0 错误；执行 `npm run build:worker:prod`（即 `node scripts/publish-aot-worker.mjs`，设置 `DOTNET_ROOT=D:\claw\dotnet-sdk`），AOT 0 错误且无 IL2026/IL3050/IL3051 警告；端点回归测试覆盖重启恢复、重复领取和取消。

#### C2：简单临时跨会话路径

- [x] C2.1：扩展 Agent/Renderer 的临时任务调用契约：无 `followUp` 参数的普通 `send_session_message` 只发送并立即返回；显式 `SessionFollowUpRequest` 才按 `todoId`/`sourceSessionId`/`targetSessionId`/`followUpAt`/`queryInstruction` 创建幂等跟进记录，再发送普通消息并返回 `followUpId`。创建失败不得发送原始任务，普通消息失败须标记跟进失败；全过程禁止创建 global task/dispatch。Mini：契约测试断言普通消息不写 `tasks`/follow-up/global 表，临时模式只写 Todo/跟进表且立即返回 `followUpId`，重复 `followUpId` 不重复发送。
- [x] C2.2：实现 Main 侧临时跟进调度器，复用现有 Cron scheduler 的 timer、恢复、锁和事件投递原则，但不复用 Cron 的用户任务 UI。到期事件发送到 Renderer/Agent runtime；来源 session 忙时不打断，按策略延期重排。Mini：使用可控时钟测试到期恢复、重启恢复、重复事件单飞、忙会话延期和取消后不触发；证据写入 `docs/plans/iter-v2-27/evidence/follow-up-scheduler.md`。
- [x] C2.3：实现自动唤醒来源会话 Agent 的查询消息；查询目标 session 的运行状态、最近结果或失败原因。结果完成时更新 Todo；未完成时只更新 follow-up 并安排下一次倒计时，不重复发送原始任务。Mini：状态机测试覆盖 running/completed/failed/not-found，断言唤醒只发生一次、未完成只更新 `nextFollowUpAt`、原始消息发送次数保持 1。
- [x] C2.4：接通应用内和渠道反馈，复用现有 session message 与 plugin sendMessage 路径；反馈成功后写入幂等状态，失败保留可重试状态和日志。Mini：覆盖简单跨会话成功、未完成重排、目标不存在、来源会话忙、应用重启、重复到期事件和渠道发送失败。

#### C3：复杂全局任务路径保持并验证

- [x] C3.1：核对并补齐已有 `create_global_task` → `send_work_request` → `reply_global_dispatch` → source session 回传链路，只修实际缺口，不把简单 Todo 转换为全局任务。Mini：对现有链路做调用图与集成断言，确认 dispatch reply 更新后只唤醒来源 session 一次，且 session follow-up 表保持 0 新记录；记录实际缺口与修复文件。
- [x] C3.2：确认目标会话回传完成/阻塞/失败/追问时，全局 task、dispatch 和来源会话状态一致；来源会话被唤醒后能整理结果并反馈应用内/渠道。Mini：全局任务现有回归测试 + 重复 reply 幂等测试。

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

### Plan F：重试失败后的 Agent 回复折叠块保留

**目标**：Provider 重试最终失败时，保留本轮已经产生的 Agent 回复折叠块；错误卡片作为失败状态或附加错误信息展示，不覆盖或清空已有回复内容。

- [x] F1：梳理 Agent 回复块、流式文本、Provider 重试失败事件和错误卡片的状态更新链路，确定失败时回复块被移除或替换的具体状态边界；不得改变成功路径和取消语义。
- [x] F2：修复失败收尾逻辑，确保已有 Agent 回复块在 429 重试耗尽、超时、网络错误等失败场景下仍可见；错误卡片与回复块共存，避免重复渲染、空块异常和错误信息丢失。
- [x] F3：补充回归验证：有部分回复后失败、无回复直接失败、重试后成功、取消、连续两轮失败；确认下一轮发送不会复用上一轮错误状态。

**验收标准**：模型重试失败后，聊天中仍保留 Agent 回复折叠块，错误卡片同时显示失败原因；成功、取消和下一轮对话不受影响。

### Plan G：渠道配置的服务商筛选与模型隔离

**目标**：渠道配置只展示并使用明确启用的服务商及其模型，避免全局服务商/模型列表污染渠道配置。

- [x] G1：梳理渠道配置中的服务商、模型来源、启用状态和保存载荷，明确渠道可见集合与全局 Provider 管理的边界。
- [x] G2：增加服务商筛选/启用控制，模型选择随服务商联动，仅展示该服务商可用且已启用的模型；已有配置若指向已禁用或已删除项，显示可诊断的失效状态，不静默改写。
- [x] G3：补充渠道配置与实际回复路由回归：服务商启用/禁用、模型增删、渠道间配置隔离、已有配置恢复、渠道发送时使用所选服务商和模型。

**验收标准**：渠道配置页面不再显示未启用或不属于当前服务商的模型；保存并发送消息时使用渠道明确选择的服务商/模型，其他渠道和全局配置不被污染。

### Plan H：输入框粘贴与 Ctrl+Z 撤销修复

**目标**：修复输入框偶发不接收粘贴值，以及复制/粘贴后用户无法通过 Ctrl+Z 撤回的问题。

- [x] H1：梳理输入框主文件及其 effects、controls、快捷键/剪贴板处理逻辑，复现并定位粘贴事件丢失、受控值覆盖或编辑历史断裂的具体原因；不得破坏输入法组合输入、光标位置和消息发送。
- [x] H2：修复粘贴处理，使文本、长文本和多行文本在输入框获得焦点或刚切回焦点时均可靠插入光标位置；保留浏览器原生编辑语义，避免重复插入或被异步状态覆盖。
- [x] H3：修复粘贴后的编辑历史，使 Ctrl+Z 能将内容恢复到粘贴前状态；连续输入、连续粘贴、选区替换、撤销后继续输入均保持正确，且不影响现有快捷键和草稿持久化。
- [x] H4：补充人工/自动回归：普通输入、复制粘贴、长文本粘贴、多行粘贴、选区粘贴、连续 Ctrl+Z、输入法组合输入、切换设置页后返回；记录复现结果和验证证据。

**验收标准**：粘贴内容每次都能进入输入框且插入位置正确；粘贴后按 Ctrl+Z 可撤销整次粘贴，恢复到粘贴前文本；常规输入、输入法、草稿保存和发送流程不回归。

**残留（2026-09-11）**：撤销后的文本结果正确，但会遗留一段选中态（例：粘贴 `1234` 后改成 `12你好34`，撤销得 `1234` 且 `34` 呈选中）。仅观感，不影响发送与后续输入；经老大裁定不卡本迭代收尾，已登记 `docs/plans/iter-v2-28/editor-undo-selection-issue.md`。

涉及文件（以 H1 排查结果为准）：

- `src/renderer/src/components/chat/` 输入区主组件及其 `effects`、`controls`、`selectors` 相关文件
- `src/renderer/src/stores/` 草稿或聊天输入状态文件
- 输入框快捷键/剪贴板相关测试与中英文文案（如需要）

### Plan J：日志配置接管与日志管理（迭代中追加）

> 需求来源：`docs/plans/iter-v2-27/logging-management-requirement.md`，口径已确认——日志配置仅一个等级字段（默认 `error`，只记录异常），不新增启用开关；环境变量 `WISHFUL_CLAW_LOG_LEVEL` 保留为启动覆盖。

**目标**：日志等级接入统一设置存储（`settings/general.json` 设置 Store），保存后运行时立即生效；设置内新增「日志」页面（位于「关于」下方），上方配置等级，下方按日文件列表 + 点击预览 + 手动刷新 + 按天数清理。

- [x] J1：日志核心改造。`logger.ts` 最低等级从模块加载期常量改为可变状态：新增 `setLogMinLevel`；启动时从 `readPersistedSettings('wishfulclaw-settings').state.logLevel` 初始化（优先级：环境变量 > 持久化设置 > `error`）；`settings:set` 写入该 Store 后同步应用新等级。新增日志文件管理 API 与 IPC：`log:list-files`（按日期倒序）、`log:read-file`（严格校验 `YYYY-MM-DD.log` 文件名并限制在日志目录内，超过 1 MB 只取尾部并标记截断）、`log:cleanup`（按严格文件名日期解析删除指定天数之前的文件）。错误日志为过滤下限，任何等级设置下都强制写入。Mini：三套 TypeScript、`git diff --check`。
- [x] J2：设置页面与文案。Renderer 设置 Store 新增 `logLevel` 字段（默认 `error`，sanitize + partialize + 迁移版本 35→36）；`ui-types.ts` 新增 `logs` Tab 并入白名单；`SettingsPage.tsx` 在「关于」分组下新增导航项与面板分发；新增 `LogsPanel`（上方等级选择 + 保存，下方文件列表/预览/刷新/清理，进入页面不默认读取内容，离开不轮询）；中英文 `settings.json` 文案。Mini：三套 TypeScript、`git diff --check`。
- [x] J3：人工核验：修改等级保存后立即生效（调低等级后新日志出现/消失）、文件列表倒序、点击预览、刷新、清理指定天数、预览文件被清理后的空态、读取失败/空列表反馈。证据记录到 `docs/plans/iter-v2-27/verification_report.md`。

**边界**：不重新实现日志框架；不调整模型重试次数/退避/fallback 策略（重试日志经 Worker stderr 以 warn 级落盘，默认 `error` 等级下不可见属预期，排查时调高等级）；不把日志写入数据库；不做远程上传与后台轮询。

涉及文件：

- `src/main/lib/logger.ts`
- `src/main/lib/settings-store.ts`（如需读取辅助）
- `src/main/ipc/settings-handlers.ts`
- `src/main/index.ts`
- `src/renderer/src/stores/settings-store.ts`
- `src/renderer/src/stores/settings-store-migrate.ts`
- `src/renderer/src/stores/settings-store-types.ts`（默认值/规范化如集中于此）
- `src/renderer/src/stores/ui-types.ts`
- `src/renderer/src/components/settings/SettingsPage.tsx`
- `src/renderer/src/components/settings/LogsPanel.tsx`（新增）
- `src/renderer/src/locales/zh/settings.json`、`src/renderer/src/locales/en/settings.json`
- `src/shared/`（如需共享 `LogLevel` 类型）

### Plan K：数据目录配置化与测试环境隔离（迭代中追加）

> 需求来源：`docs/plans/iter-v2-27/data-directory-config-requirement.md`，排期已确认跟随本迭代。动机：生产与开发共用同一份 `~/.wishful-claw`（DB + 配置 + 记忆），导致不敢在生产实例中让 Agent 开发自身；隔离后 dev 实例数据独立，写坏只影响测试环境。

**本 Plan 只有两个目的**（老大 2026-09-10 定，超出即为跑偏）：

1. **不要裸写 `.wishful-claw`**——避免硬编码到处都是（收敛为每语言一个定义点 + 两个访问器）。
2. **软件运行时的数据库与文件区分开发环境和生产环境**——dev 落 `~/.wishful-claw-dev`。

**归属原则**：项目下的文件属于那个项目，跟软件本身没关系。所以 `{工作区}/.wishful-claw/` 永远保持裸名、不加 `-dev`，两实例同时操作同一项目也属预期（图谱库并发不做防护，老大已确认可接受）。

**目标**：`.wishful-claw` 目录名收敛为**每个语言一个定义点**（TS/C# 各一处），消灭实测 36 处字面量与 16 处各自独立定义的重复常量；数据目录解析收敛为一个 resolver（TS）+ 一个 helper（C#）；dev 与生产实例可双开并存；`~/.wishful-claw-dev` 完整承接 personas、agents、记忆、剪贴板、扩展、渠道、MCP、日志、DB 等**全部软件自身运行时数据**，实现真隔离（现状 `WISHFULCLAW_DATA_DIR` 仅覆盖约 70%，半隔离比不隔离更危险）。codegraph 按上面的归属原则分治：项目级图谱库不跟随，仅 SSH 镜像与集中式回退跟随。

#### 实测清单（2026-09-10 全仓扫描，替代需求文档的估算）

字面量共 **36 行**，按根目录语义分两类——这个区分是本 Plan 的正确性命门：

| 语义 | TS | C# | dev 是否改名 |
|---|---|---|---|
| 全局数据目录（根 = home / UserProfile） | 12 | 14 | **是**，→ `<name>-dev` |
| 项目级配置目录（根 = workingFolder） | 3 | 7 | **否**，必须保持 `.wishful-claw` |

- TS 全局 12 处：`clipboard-enhancer.ts:37`、`quick-launcher.ts:81`、`ipc/extension-plugin-sync.ts:18`、`ipc/video-handlers.ts:70`、`ipc/input-draft-handlers.ts:27`、`ipc/mcp-handlers.ts:11`、`lib/logger.ts:74`、`mcp/mcp-client.ts:31`、`lib/agent-history-store.ts:5`、`lib/ai-provider-store.ts:6`、`lib/settings-store.ts:5`、`renderer/lib/agent/memory-snapshot.ts:76`
- TS 项目级 3 处：`ipc/codegraph-handlers.ts:158`、`renderer/components/chat/project-archive-helpers.ts:41`、`renderer/lib/agent/memory-files.ts:9`
- C# 全局 14 处：`DbClient.cs:41`、`ConfigStore.cs:22`、`ProviderStore.cs:15`、`QqSessionStore.cs:18`、`ChannelConfigStore.cs:19`、`ExtensionManifestStore.cs:23`、`PersonaStore.cs:12`、`MemoryPathResolver.cs:17`、`SystemPromptCache.cs:87`、`SubAgentDefinition.cs:32`、`OpenAIAudioTools.cs:217`、`SeedanceVideoTools.cs:145`、`XaiVideoTools.cs:144`、`CodeGraphDataDir.cs:55`
- C# 项目级 7 处：`MemoryPathResolver.cs:65`、`AgentRuntimeProjectExecutor.cs:128`、`AgentRuntimePlanExecutor.cs:24`、`GoalFileTools.cs:14`、`GoalPlanTracker.cs:23`、`SystemPromptCache.cs:89`、`PersonaModels.cs:13`
- **同文件双语义，禁止整文件替换**：`MemoryPathResolver.cs`（17 全局 / 65 项目）、`SystemPromptCache.cs`（87 全局 / 89 项目）、`PersonaStore.cs`（31-35 三元分支）。
- **需求文档清单勘误**（实现时勿按旧清单找）：`SkillCatalog.cs`、`SkillConfigStore.cs` 存在但在 `WishfulClaw.Agent/Modules/Skills/` 下，且硬编码的是 `.agents` 而非 `.wishful-claw`，故不在上表 36 处之内；`codegraph-assets.ts` 的 `homedir()` 指向 `~/.nuget/packages`（非数据目录）；`misc-handlers.ts:243` 是 `join(homedir(), 'wishful-claw', 'image')`——**无前导点，非数据目录**；`CodeGraphDataRootRegistry.cs`、`CodeGraphToolHandler.cs`、`ExtensionManifestHelpers.cs` 仅注释或已引用常量，无字面量。
- **改名只作用于"软件自身存放 DB 与其它文件的位置"**（老大 2026-09-10 澄清口径）：数据目录与其派生的 dev 变体参与改名，项目级目录、shell home、`~/.nuget`、无前导点的 `~/wishful-claw/image` 等"其它东西"一律不受影响。
- **已定口径：`.agents` 整体略过不处理**（老大 2026-09-10 决定）。理由：`~/.agents/skills` 实测 41 个技能，与 Qoder 当前会话可用技能同名同集合（`create-extension`、`docx`、`xlsx`、`hyperframes*`、`product-design*`、`find-skill-skillhub` 等），属**多 Agent 工具共用的约定目录**，不是"我们软件自己放文件的地方"，迁入数据目录会连带波及其它工具。技能目录既不作改名，也不迁移、不做双源扫描。由此遗留三项已知问题，**本迭代不修**，记录备查：
  - `~/.agents/skills-config.json`（`disabledSkills`）是自有状态却落在共用目录，dev 与生产互写同一份启用开关（`SkillConfigStore.cs:78`）。
  - dev 实例安装/新建技能会写进生产可见的共享目录（`SkillCatalog.cs:70,300` 创建并复制），隔离在 skills 写入这一个面上留口。
  - `SkillsMenu.tsx:416` 宣称技能在 `~/.wishful-claw/skills/`，代码实际读 `~/.agents/skills`（`SkillCatalog.cs:449-454`、`AgentRuntimeSkillExecutor.cs:22`），文案与实现不一致。

#### API 契约：一个常量 + 两个访问器

目录名只定义一次，对外**只有两个调用方式**（老大 2026-09-10 定形态）：

| 访问器 | 形态 | 语义 | 用于 |
|---|---|---|---|
| **A · 环境感知解析器** | TS `resolveDataDir()` / `resolveDataPath(...segments)`；C# `WishfulClawDataDir.Root` / `.Resolve(...)` | 返回**绝对根路径**，内部走完优先级链，dev 态自动带 `-dev` | 全局数据落盘（TS 12 + C# 14 = 26 处） |
| **B · 裸名常量** | TS `WISHFUL_CLAW_DATA_DIR_NAME`；C# `WishfulClawPaths.DataDirName` | 只有名字 `.wishful-claw`，**永不派生 dev 后缀** | 拼在别人仓库里的隐藏目录（TS 3 + C# 7 = 10 处） |

- **判定口诀**：根在**用户主目录**里 → 用 A；根在**用户工作区仓库**里 → 用 B。没有第三种。
- **A 是唯一允许出现 `-dev` 和 `homedir()/UserProfile` 的地方**，其余文件一律不得自行拼根。
- **禁止反模式**：`join(homedir(), B)` 或 `Path.Combine(UserProfile, B)` —— 那是把 A 手抄一遍，正是当前 26 处的成因。K1/K2 的 Mini 断言除"字面量仅剩定义处"外，还要断言"homedir/UserProfile 与裸名常量同现"的写法在 resolver/helper 之外为 0 命中。
- **B 与 A 同名不同物**：B 是常量，A 内部引用 B 拼出生产默认根，所以两处永远不会写歪；但 A 的返回值带 dev 后缀，**绝不能**被拿去拼项目级路径。
- **渲染进程只能拿到 B**：`app.isPackaged` 在 renderer 不可用，凡需要 A 的结果必须经 IPC（见 K1 的 `app:global-memory-home`），renderer 内不得用 B 自行构造任何全局路径。
- **常量落点**：TS 的 B 在 `src/shared/data-dir.ts`（同时放 `WISHFULCLAW_DATA_DIR_ENV`）；C# 的 B 在 `WishfulClaw.Contracts`（`WishfulClawPaths.DataDirName` + `DataDirEnvVar`）。C# 的 A 在 `WishfulClaw.Infrastructure`。
- **CodeGraph 跨在 A/B 两侧，不能整模块归类**（图谱库**每项目一个**）：① 本地可写工作区 → `{workingFolder}/.wishful-claw/codegraph/graph.db`，**用 B、故意不加 dev 后缀**（索引跟着仓库走，这是设计）；② SSH/不可写根 → 全局镜像 `<A>/projects/{id}/codegraph`；③ 未注册且无覆盖 → 集中式 `<A>/codegraph/<sha256(根)>/graph.db`。只有 ②③ 属 A。

- [ ] K0：目录名常量单一来源（前置，先于 K1/K2）。TS 新建 `src/shared/data-dir.ts`，导出访问器 B `WISHFUL_CLAW_DATA_DIR_NAME = '.wishful-claw'` 与环境变量名 `WISHFULCLAW_DATA_DIR_ENV = 'WISHFULCLAW_DATA_DIR'`，dev 名不另立常量、只在访问器 A 内部由 B 派生；main 用相对路径引入（`@shared` 别名仅配置在 renderer，见 `electron.vite.config.ts:27`，main 侧按现有 `../shared/logging` 写法），renderer 用 `@shared/data-dir`。C# 在 `WishfulClaw.Contracts` 定义具名常量类——**必须放 Contracts 而非 Infrastructure**，因为 `WishfulClaw.CodeGraph` 仅引用 Contracts + Core，放低了才谈得上 21 个 C# 点全部同源且不违反依赖方向。删除全部 16 处独立定义（TS：`agent-history-store`/`ai-provider-store`/`settings-store` 的 `DATA_DIRECTORY_NAME`、renderer 的 `WISHFUL_CLAW_DIR`/`PROJECT_MEMORY_DIRNAME`；C#：`ConfigStore`/`ProviderStore`/`PersonaStore`/`QqSessionStore`/`ChannelConfigStore`/`ExtensionManifestStore` 的 `DataDirectoryName`、`PersonaModels.ProjectConfigDirectoryName`、`PlanDirectoryName`/`GoalDirectoryName`×2/`AgentsDirectoryName` 四个复合常量改为 `Path.Combine(常量名, 子目录)` 形式）。Mini：三套 `tsc --noEmit -p`、`dotnet build src/runtime/WishfulClaw.sln`、`git diff --check`。
- [x] K1：TS 统一 resolver。新建 `src/main/lib/data-dir.ts`，实现优先级链 `WISHFULCLAW_DATA_DIR` > dev 默认（`!app.isPackaged` → `${WISHFUL_CLAW_DATA_DIR_NAME}-dev`）> 生产默认；替换 11 处 main 全局点（`codegraph-assets.ts` 不改，见勘误）。已支持环境变量的 `input-draft-handlers`、`mcp-handlers`、`ai-provider-store`、`settings-store`、`logger` 改为调用同一 resolver，保持行为不变。`index.ts` 的 userData 重定向保持 `setPath` 在 `requestSingleInstanceLock()` 之前，并改走 resolver。
  - **K1 必修的真实泄漏**：`app:homedir` 与 `app:global-memory-home` 在 renderer 白名单 `messagepack-channel-routing.ts:4-5` 中注册，但主进程**没有任何 handler**（全仓 grep 仅 `app:get/set-login-item-settings`）。因此 `memory-snapshot.ts:63-81` 恒落到本地兜底 `joinFsPath(homeDir, '.wishful-claw')`，dev 下渲染进程的全局记忆路径会指回**生产目录**。修法：新增 `app:global-memory-home` handler 返回 resolver 结果，并**删除 renderer 本地重建根目录的兜底**——宁可返回 undefined 走既有空态，也不能静默回退到另一个根。
  - **K1 必修的第二个反模式（SSH 镜像图谱库）**：`codegraph-project-index.tsx:88-89` 拼出 `` `~/.wishful-claw/projects/${activeProjectId}/codegraph` ``，在 `:119`/`:159` 作为 `dataRoot` **传给 Worker**——它是**全局镜像路径（访问器 A 语义）却由渲染进程用裸名手拼**。且 `resolveCodeGraphDataRoot`（`codegraph-handlers.ts:150-152`）中 `explicitOverride` 的优先级**高于**本地可写判定，该字面量原样直达 Worker，由 `CodeGraphDataRootRegistry.Register:36-49` 展开成 `%USERPROFILE%\.wishful-claw\projects\{id}\codegraph`。后果：SSH 项目在 dev 实例索引时**写进生产数据目录**，`WISHFULCLAW_DATA_DIR` 与 dev 后缀全部失效。修法：renderer 只传 `projectId` 语义标志，由 Main 用 `resolveDataPath('projects', id, 'codegraph')` 出绝对路径注入。K3.1 走查须包含 SSH 项目索引。（注：`~` 展开逻辑确实存在，先前记为"落进字面 `~` 目录的活 bug"系我方误判，iter-v2-21 审查报告同条结论亦需在实现期以本条为准。）
  - TS 项目级 3 处改为引用 shared 常量，值不变、不加 dev 后缀。
  - Mini：三套 `tsc --noEmit -p`、`git diff --check`、`grep -rn "'\.wishful-claw\|\"\.wishful-claw" src/main src/renderer/src src/preload src/shared` 命中仅剩 `src/shared/data-dir.ts` 一行。
- [x] K2：C# 统一 helper（`WishfulClaw.Infrastructure` 内），只认 `WISHFULCLAW_DATA_DIR`、回退 `UserProfile + 常量`，不实现 dev 判断；14 处全局点改走 helper，7 处项目级点仅引用 Contracts 常量。已支持环境变量的 `DbClient`、`ConfigStore`、`ProviderStore`、`ChannelConfigStore` 改为调用同一 helper。确认 Main → Worker 环境变量经 `native-worker.ts` 的 `env: workerEnv` 传递（现有链路已继承，仅需回归确认）。
  - **CodeGraph 特例**：`CodeGraphDataDir.cs:55` 在 vendored 项目内，拿不到 Infrastructure helper，**不得复制一份根解析**。改法：Worker 启动 env 追加 `CODEGRAPH_HOME=<resolver 结果>/codegraph`，复用其既有 hook（`CodeGraphDataDir.cs:44-48`）；项目本地索引仍走 `CodeGraphDataRootRegistry` 注入。
  - `ShellExecuteTool.Helpers.cs`、`terminal-handlers.ts:180` 属 shell home/cwd 语义，核实后不动。
  - Mini：`dotnet build src/runtime/WishfulClaw.sln` 0 错误；执行 `npm run build:worker:prod`（设置 `DOTNET_ROOT=D:\claw\dotnet-sdk`），AOT 0 错误且无 IL2026/IL3050/IL3051 警告；`git diff --check`；`grep -rn '"\.wishful-claw' src/runtime --include=*.cs` 命中仅剩 Contracts 定义处。
- [x] K3：隔离验证（不以代码走查代替）：
  - [ ] K3.1：用 `icacls` 将生产 `~/.wishful-claw` 设为拒绝写入，`npm run dev` 全功能走查（聊天、记忆读写、personas、agents、codegraph 索引、剪贴板、MCP、渠道、扩展、QQ 会话），日志无写入报错——证明 dev 全部数据落在 `~/.wishful-claw-dev`。**记忆读写必须分别覆盖渲染进程路径与 Worker 路径**（K1 泄漏点属渲染进程侧，只测 Worker 会漏）。
  - [ ] K3.2：生产实例运行时启动 dev 实例，两者并存、单实例锁互不抢占；反向亦验证。（两实例同时索引同一本地项目会共用同一份项目级 `graph.db`——按归属原则属设计预期，老大已确认接受，不加锁、不设验证项。）
  - [ ] K3.3：打包版启动数据目录仍为 `~/.wishful-claw`，全功能不回归。
  - [ ] K3.4：显式 `WISHFULCLAW_DATA_DIR` 指定时 Main / Renderer / Worker / 日志四方全部跟随（复用 GoalRegressionTests 场景回归）。
  - [ ] K3.5：**项目级不得被改名**——dev 实例对某工作区执行记忆整理、goal/plan 落盘、codegraph 索引后，该工作区内必须仍是 `.wishful-claw/`，且 `git status` 无新增未忽略目录。
  - [ ] K3.6：文档投影同步（版本号同款漂移面）：`README.md:49,142`、`AGENTS.md:207,394-399`、`docs/data-storage.md`、`docs/new-session-prompt.md` 补 dev 目录说明；`.gitignore:63` 为项目级规则，确认不需要动。
  - [ ] K3.7：证据写入 `docs/plans/iter-v2-27/verification_report.md`。

**验收标准**：`npm run dev` 全部数据读写仅落在 `~/.wishful-claw-dev`；dev 与生产双开互不抢占、数据互不污染；打包版行为不变；**全仓 grep 后 `.wishful-claw` 字面量仅剩 TS/C# 各一处定义点**（注释与 Agent 提示词文案除外）；任何项目级目录在 dev 态下仍为 `.wishful-claw`。

**边界**：不迁移、不同步生产数据到 dev 目录；项目级 `{工作区}/.wishful-claw/` **机制与目录名都不变**，仅把字面量换成常量引用；不把 Agent 提示词与 UI 展示文案（`PlanToolProvider.cs:59`、`ProjectToolsProvider.cs:31`、`AgentRuntimeProjectExecutor.cs:404,412`、`SkillsMenu.tsx:370,416`）模板化——它们是给人/给模型读的路径说明，不是目录解析（原列于此的 `codegraph-project-index.tsx:89` 经核实是传给 Worker 的真路径，已移入 K1 必修）；不改 `.agents`（skills 与 `skills-config.json`）——老大已定口径整体略过，不迁移、不改名、不做双源；不新增设置页 UI（目录选择属开发基建，走环境变量与 dev 态默认值）；不为 SSH/远程项目调整全局目录逻辑；AUMID 与托盘外观共存问题不处理。

涉及文件：

- `src/shared/data-dir.ts`（新增，TS 唯一定义点）
- `src/main/lib/data-dir.ts`（新增，resolver）
- `src/runtime/WishfulClaw.Contracts/`（新增具名常量类，C# 唯一定义点）
- `src/runtime/WishfulClaw.Infrastructure/`（统一 helper，及 `DbClient`/`ConfigStore`/`ProviderStore` 调用点）
- `src/main/index.ts`（userData 重定向改走 resolver，保持锁顺序；新增 `app:global-memory-home` handler 注册）
- `src/main/clipboard-enhancer.ts`、`src/main/quick-launcher.ts`
- `src/main/ipc/extension-plugin-sync.ts`、`video-handlers.ts`、`input-draft-handlers.ts`、`mcp-handlers.ts`、`codegraph-handlers.ts`（项目级仅换常量引用）
- `src/main/lib/agent-history-store.ts`、`ai-provider-store.ts`、`settings-store.ts`、`logger.ts`
- `src/main/mcp/mcp-client.ts`
- `src/renderer/src/lib/agent/memory-snapshot.ts`（删本地兜底）、`memory-files.ts`、`src/renderer/src/components/chat/project-archive-helpers.ts`
- `src/runtime/WishfulClaw.Agent/`（`SubAgentDefinition`、`SystemPromptCache`、`AgentRuntimePlanExecutor`、`AgentRuntimeProjectExecutor`、`Goal/*`、`Modules/{Channels,Extensions,OpenAIAudio,Video}`）、`WishfulClaw.Persona/`、`WishfulClaw.Workspace/`、`WishfulClaw.CodeGraph/Support/CodeGraphDataDir.cs`
- `src/runtime/WishfulClaw.Worker/`（worker 启动 env 追加 `CODEGRAPH_HOME`）
- 文档：`README.md`、`AGENTS.md`、`docs/data-storage.md`、`docs/new-session-prompt.md`、需求文档与验证报告更新

### Plan I：统一审查、验证与发布

- [x] I1：每个实现步骤完成后执行 Mini 门槛：
  - `npx tsc --noEmit -p tsconfig.web.json`
  - `npx tsc --noEmit -p tsconfig.node.json`
  - `npx tsc --noEmit -p tsconfig.json`
  - `dotnet build src/runtime/WishfulClaw.sln`
  - C#、JSON 契约或 Worker 注册改动必须额外设置 `DOTNET_ROOT=D:\claw\dotnet-sdk` 执行 `npm run build:worker:prod`（`node scripts/publish-aot-worker.mjs`）；要求 Native AOT 发布成功且无 IL2026/IL3050/IL3051 警告，产物只写既有 `resources/worker`，不另建临时发布目录
  - 对应单元/回归测试与 `git diff --check`
  每个通过步骤立即 commit，提交信息遵循 `feat/fix/test(scope): 步骤N - 简述`。
- [x] I2：启动独立代码审查，输出 `docs/plans/iter-v2-27/review_report.md`；检查分层、AOT、错误处理、任务幂等、取消传播、渠道安全和是否误把简单任务送入全局任务。
- [x] I3：修复审查问题并提交 `review(v2-iter-27): 审查修正`；审查报告无阻断项后进入验证态。（修正代码已随 2026-09-11 收尾提交入库，未单独使用 `review` 前缀，而是并入对应功能单元提交。）
- [x] I4：输出 `docs/plans/iter-v2-27/verification_report.md`，记录所有命令、退出码、测试结果、日志/截图证据、未能验证的项目和原因；不得用走查代替真机升级或渠道人工验证。
- [x] I5：用户确认 PASS 后才执行 v0.2.27 收尾：更新 `package.json` 和 README 版本徽章，打包 NSIS，核验并上传 setup.exe、`latest.yml`、必要的 blockmap；合并 main、打 tag `v0.2.27`、更新 `docs/PROGRESS.md` 和 `docs/progress/v2-iter-27.md`，发布 GitHub Release。（2026-09-11 执行：merge commit `c3dde76f` 已推送 main，annotated tag `v0.2.27`（对象 `638315ea`）指向同一提交，Release <https://github.com/wishful-73/wishful-claw/releases/tag/v0.2.27> 已上传 `wishful-claw-0.2.27-setup.exe`、`latest.yml`、`.blockmap` 三资产且大小与本地一致，远程 `latest.yml` 下载 200 且与本地逐字节相同；A4 真机升级验证仍待用低于 0.2.27 的本地安装版实跑。）

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
