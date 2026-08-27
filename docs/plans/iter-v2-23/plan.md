# Plan: v2-iter-23 — 会话可靠性收口与正式版发布（待确认）

> 状态：规划审查 PASS，用户已确认，执行中
>
> 基线：`main`，产品版本 `0.2.22`，最新 tag `v0.2.22`
>
> 用户已授权进入产品代码执行态；版本升级、合并 main、tag 和发布动作仍需等待迭代最终验收确认。

## 目标

围绕上下文压缩、历史会话恢复、聊天窗执行体验和工具结果可靠性完成正式版前收口；验证通过且用户确认迭代完结后，再将产品升级为 `1.0.0` 并发布 Windows 安装包及 GitHub Release。

## 已确认的产品边界

- 前端首次打开历史会话默认展示最近 5 个完整轮次；这只是 UI 分页策略。
- 点击加载更早历史只改变 UI 展示，不修改后端 Agent 上下文。
- 后端有有效压缩快照时恢复快照及其后的增量消息；没有快照时沿用当前全量恢复策略。
- 摘要只在手动压缩或达到阈值自动压缩时产生，普通对话结束不额外生成摘要。
- 自动压缩和手动压缩都必须把“上下文摘要”推送到聊天窗，显示进行状态和可展开的摘要正文。
- 进行中当前轮的 user message 吸附在聊天可视区域顶部；历史会话和已完成轮次继续使用折叠展示。
- 右上角悬浮操作块改为竖向，包含压缩会话、打开右侧文件夹、聊天区域宽窄调节；移除该悬浮块中的清除会话入口。
- 工具结果需要在工具完成边界形成可恢复状态，覆盖前台、后台 Cron 和渠道会话。
- 发布目标为 `v1.0.0`；发布动作必须等用户确认迭代完结后执行。

## 依赖顺序

```text
23-1 探索与契约定案
  ↓
23-2 压缩快照数据层
  ↓
23-3 手动/自动压缩统一 + 聊天上下文摘要
  ↓
23-4 历史恢复 + 前端分页解耦 + 当前轮吸附
  ↓
23-5 右上角悬浮操作块
  ↓
23-6 工具结果即时持久化与恢复
  ↓
23-7 全量验证与 v1.0.0 发布
```

## 步骤清单

### Plan 23-1：压缩/恢复/持久化链路探索与契约定案

- [x] 步骤 1：确认 `agent/compress-context` 的 Worker 端点归属、输入输出、取消和错误协议；清理或收口前端重复 stub。实现：新增 `AgentRuntimeContextCompressionTools.CompressAsync`，注册 Worker endpoint；开放共享 wire message parser；补 AOT result records；前端移除重复抛异常 stub并统一使用实际 bridge。
  - 验证：`agent/compress-context` 已在 `AgentRuntimeModule` 注册，输入为 `provider/messages`，输出为压缩后的 `messages` + `ContextCompressionResult`；取消沿 `IWorkerRequestContext.CancellationToken` 传播，压缩结果支持 `compressed`/未压缩和显式 `error`；C# solution 0 warning/0 error，TypeScript web/node/root 0 error，`git diff --check` 通过。手动按钮的上层调用接入、blocked/skipped/failed 的完整 UI 状态闭环留在 Plan 23-3。
- [x] 步骤 2：确定压缩摘要、压缩状态卡、压缩快照三者的数据关系。契约见 `compression-contract.md`：完整 wire conversation 是 Agent 恢复权威，compact boundary/summary artifacts 负责聊天展示，compression status 只负责生命周期反馈，SQLite 快照保存同一压缩结果和游标。
  - 验证：自动和手动压缩使用同一摘要语义；完成事件通过可选 `messages/compactArtifacts` 关联摘要正文、压缩范围、保留信息和降级状态；现有 MessagePack encoder 已支持可选 messages/artifacts，Renderer 已有 compactBoundary/compactSummary/compressionStatus 类型；AOT DTO 必须使用具名 record 并注册 JsonContext。
- [x] 步骤 3：确定压缩快照存储、游标、版本、失效和失败回退策略。契约见 `snapshot-contract.md`：独立 `session_compaction_snapshots` 表、每会话最新快照、`created_at + sort_order` 二元游标、version 1、破坏性历史修改失效、损坏/未知版本回退全量恢复。
  - 验证：已明确无快照全量恢复、有效快照+增量恢复、损坏/未知版本回退；快照写入失败保留旧快照和内存状态；清空/删除/整体替换删除快照，快照覆盖区内的删除/截断/重试使快照失效；fork/duplicate 不继承快照；正式契约记录于 `snapshot-contract.md`。

### Plan 23-2：压缩快照数据层与旧库迁移

- [x] 步骤 4：实现压缩快照 schema、Entity/Row/Mapper、查询/写入端点和 AOT JSON 注册。实现：新增 `session_compaction_snapshots` 表 DDL + 旧库迁移；`CompactionSnapshotEntity`/EntityMappers；`DbCompactionSnapshotStore` + `DbCompactionSnapshotTools` 读写端点；`InfrastructureJsonContext` AOT 注册；破坏性变更失效钩子接入 `DbMessageToolsMutations`/`DbSessionTools`/`DbProjectTools`/`DbPluginSessionTools`。
  - 验证：新库 DDL、旧库迁移、参数化 SQL、AOT 序列化检查通过。
- [x] 步骤 5：实现快照游标后的消息增量查询和损坏快照安全回退。实现：`created_at + sort_order` 二元游标增量查询端点；快照损坏/版本不兼容/游标无效时安全回退全量恢复并记录日志。
  - 验证：无快照全量恢复；有效快照 + 增量恢复；快照损坏、版本不支持、游标无效时回退全量且有日志。
- [x] 步骤 6：补数据库回归测试。实现：新增 `tests/WishfulClaw.CompactionSnapshotRegressionTests`，覆盖新库、`0.2.22` 旧库迁移、快照 CRUD、空值、损坏 JSON、版本不兼容、消息删除/清空/fork 失效规则，252 断言全过。
  - 验证：覆盖新库、`0.2.22` 旧库迁移、快照 CRUD、空值、损坏 JSON、版本不兼容、消息删除/清空/fork 失效规则。

### Plan 23-3：统一手动/自动压缩与聊天窗上下文摘要

- [x] 步骤 7：实现 Worker 手动压缩端点，复用自动压缩核心逻辑。实现：`AgentRuntimeContextCompressionTools.CompressAsync` 增强为支持 `sessionId`——优先压缩 Worker 内存 `SessionConversation` 并在成功后 `Replace` + 更新水位（与自动压缩同一 `ContextCompression.CompactAsync` 核心）；会话有运行中 run 或重复触发时返回 `blocked`，取消/跳过/失败返回 `cancelled`/`skipped`/`failed` 明确状态；前端新增 `compressSessionContext` 动作并接入 `SessionConversationPane` 的 ContextRing，复用 `useContextCompression` 状态反馈与防重复触发。
  - 验证：悬浮块/ContextRing 点击可实际触发压缩；压缩中不可重复触发；取消、跳过、失败和降级均返回明确结果。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [ ] 步骤 8：统一压缩完成产物。
  - 验证：自动/手动都能产生同格式的压缩上下文、摘要正文、边界元数据和持久化快照。
- [ ] 步骤 9：完善压缩事件和聊天窗摘要卡。
  - 验证：聊天窗显示压缩开始状态；完成后显示可展开的“上下文摘要”正文、压缩数量/范围、保留信息和降级状态；重载历史后仍可查看；不依赖 Activity 面板。
- [ ] 步骤 10：压缩结果持久化与 Worker 会话同步。
  - 验证：内存 `SessionConversation`、SQLite 快照、聊天摘要消息语义一致；持久化失败不静默吞掉，按已定策略回退或保留旧快照。

### Plan 23-4：历史恢复、前端分页解耦与当前轮吸附

- [ ] 步骤 11：改造 `SessionRestoreTools` 使用快照/全量兼容恢复策略。
  - 验证：有快照恢复快照 + 后续消息；无快照全量恢复；加载更早 UI 历史不触发 Worker 恢复。
- [ ] 步骤 12：历史加载改为点击触发。
  - 验证：移除滚动触顶自动加载；顶部按钮可连续加载更早 5 轮；显示总轮数/已加载范围；不重新引入 prepend 闪烁专项重构。
- [ ] 步骤 13：实现进行中当前轮 user message 吸附。
  - 验证：当前轮执行时 user message 固定在可视区域顶部；thinking/tool/output 增长在其下方；完成/取消/失败/切换会话后解除；历史折叠会话不启用。

### Plan 23-5：聊天窗右上角悬浮操作块重构

- [ ] 步骤 14：将 `SessionConversationPane` 右上角操作块改为竖向布局，移除其中的清除会话入口。
  - 验证：普通聊天、项目聊天、无消息、执行中、切换会话场景布局和状态正确；清除会话能力不被误删，应保留在其他明确入口或按产品决策移位。
- [ ] 步骤 15：接入“压缩会话”。
  - 验证：调用统一手动压缩链路，显示压缩中/成功/失败反馈，执行期间防重复点击。
- [ ] 步骤 16：接入“打开右侧文件夹”。
  - 验证：有工作区时打开右侧面板并切换 Files tab；无工作区时禁用或提示，不伪造成功。
- [ ] 步骤 17：接入聊天区域宽窄调节。
  - 验证：聊天内容区宽度可调，Composer 不溢出；右侧面板开关后重新 clamp；刷新/重启后按既定策略恢复。

### Plan 23-6：工具结果即时持久化与崩溃恢复

- [ ] 步骤 18：在 `tool_call_result` 工具完成边界形成可恢复状态。
  - 验证：不等待 30 秒检查点、`message_end` 或 `loop_end`；成功、错误、取消、审批拒绝、跳过结果均可恢复。
- [ ] 步骤 19：确定并实现 messages upsert 或 Worker durable journal 的最小方案。
  - 验证：重复事件、重试、多工具并发不会互相覆盖或重复写入；稳定键至少覆盖 session/run/tool。
- [ ] 步骤 20：实现恢复 reconciliation 和中间记录清理。
  - 验证：已有 tool_use 缺 tool_result 时能找回已完成结果；不会因恢复重放重复执行工具；journal/中间记录不会无限增长。
- [ ] 步骤 21：覆盖前台、后台 Cron、渠道会话和异常退出。
  - 验证：三种执行路径持久化行为一致；Renderer/Worker 在工具完成后异常退出，重开后结果可见且不静默重跑。

### Plan 23-7：正式版全量验证与 v1.0.0 发布

- [ ] 步骤 22：完整构建和回归验证。
  - 验证：TypeScript web/node/root 三配置 0 error；C# solution 0 warning/0 error；Native AOT 0 warning；压缩/恢复/DB/工具结果测试通过；`git diff --check` 通过。
- [ ] 步骤 23：真实 Electron Main/Renderer 进程级 harness 和隔离冒烟。
  - 验证：补齐 v2-iter-22 的 I22-3 缺口；验证压缩事件聊天展示、历史恢复、悬浮块、当前轮吸附、Cron/渠道消息链；无测试进程残留、无真实 Home 数据污染。
- [ ] 步骤 24：正式版安装验证。
  - 验证：AOT Worker、Windows NSIS、覆盖升级、旧库迁移、托盘、图标、Worker 启动、卸载/重装通过。
- [ ] 步骤 25：用户最终人工验收后更新版本和发布元数据。
  - 验证：仅在用户确认迭代完结后将 `package.json`/README/文档规则更新为 `1.0.0`，创建 `v1.0.0`，推送 main/tag，创建 GitHub Release 并上传安装包。

## 涉及文件和模块

### Runtime / DB / Worker

- `src/runtime/WishfulClaw.Agent/AgentLoop.cs`
- `src/runtime/WishfulClaw.Agent/ContextCompression.cs`
- `src/runtime/WishfulClaw.Agent/SessionConversation.cs`
- `src/runtime/WishfulClaw.Agent/SessionRestoreTools.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeModule.cs`
- `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`
- `src/runtime/WishfulClaw.Agent/StreamEventModels*.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/*`
- `src/runtime/WishfulClaw.Infrastructure/Db/Db*Tools*.cs`
- 对应 `InfrastructureJsonContext` / `AgentRuntimeJsonContext`

### Renderer / Main / Shared

- `src/renderer/src/lib/ipc/agent-bridge-streaming.ts`
- `src/renderer/src/lib/agent/context-compression.ts`
- `src/renderer/src/lib/agent/stream-event-adapter.ts`
- `src/renderer/src/lib/agent/types.ts`
- `src/renderer/src/stores/chat-store/index.ts`
- `src/renderer/src/stores/chat-store/session-slice.ts`
- `src/renderer/src/stores/chat-store/db-helpers.ts`
- `src/renderer/src/components/chat/CompressionStatusMessage.tsx`
- `src/renderer/src/components/chat/ContextCompressionMessage.tsx`
- `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts`
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx`
- `src/renderer/src/components/layout/SessionConversationPane.tsx`
- `src/renderer/src/components/layout/RightPanel.tsx`
- `src/renderer/src/stores/ui-store*.ts`
- `src/shared/agent-stream-protocol.ts`
- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts`
- `src/main/channels/auto-reply.ts`
- `src/main/ipc/sidecar-handlers.ts`
- 仅在探索确认需要时修改其他具体 Cron/channel/background handler，禁止扩大到无关 Main 逻辑

### 文档 / 测试 / 发布

- `docs/plans/iter-v2-23/`
- `docs/PROGRESS.md`
- `docs/new-session-prompt.md`
- `docs/iteration-plan.md`
- `AGENTS.md`
- `README.md`
- `package.json`
- 现有 Goal/Cron/Agent 回归测试和新增 Electron harness

## 参考源码

- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeContextCompression.cs` — 压缩状态/摘要事件；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\OpenAIChatRuntime.cs` — 压缩生命周期与结果；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeToolResultJournal.cs` — 工具结果恢复查询；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\Db\DbSchemaMigrator.cs` — durable journal schema；
- `D:\claw\OpenCowork\src\renderer\src\lib\agent\runtime-reattach.ts` — 工具结果 reconciliation；
- `D:\claw\OpenCowork\src\main\cron\cron-agent-background.ts` — 后台工具结果边界 flush；
- `D:\claw\OpenCowork\src\main\channels\headless-auto-reply.ts` — 渠道执行结果收集/落库；
- `D:\claw\OpenCowork\cli\ARCHITECTURE.md` — 压缩事件及 transcript result 设计说明。

## 不在本 Plan 内

- 虚拟列表 prepend 一帧闪烁的大规模重构；
- 每轮普通对话结束后自动生成摘要；
- 前端历史分页轮数配置化；
- 人格混血、Agent 日记；
- 快速启动器插件化、URL 插件、DeepSeek 网页版、ZIP 轻应用；
- Goal 编排扩展；
- 与本迭代目标无关的相邻重构。

## 执行门槛

- 阶段一探索报告已产出：`exploration_findings.md`。
- 规划合规审查必须 0 个阻断项。
- 用户确认 Plan 方向后，才创建或切换 `dev/v2-iter-23` 执行分支。
- 用户未确认迭代完结前，不合并 main、不打 tag、不 push 发布、不创建 `v1.0.0` Release。
- `v1.0.0` 是用户确认正式版完结后对现行 `0.2.N` 规则的版本迁移例外；执行期间仍保持产品版本 `0.2.22`，不得提前创建 `v0.2.23` 或 `v1.0.0` tag。
