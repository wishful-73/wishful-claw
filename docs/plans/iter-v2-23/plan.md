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
- [x] 步骤 8：统一压缩完成产物。实现：`ContextCompression.CompactAsync` 改为返回结构化 `CompactionOutcome`（压缩会话 + wire 会话 + Compacted/SummarizerFailed/MessagesSummarized/SummaryMessageId）；摘要消息带稳定 id 与 `meta.compactSummary`（`CreateSummaryWireMessage` 新重载）；新增 `ContextCompression.Artifacts.BuildCompactArtifacts` 从同一产物派生 [边界消息, 摘要消息] 聊天产物（边界含 trigger/preTokens/messagesSummarized/preservedSegment.headId 插入锚点）；自动压缩路径（AgentLoop）与手动压缩端点均消费同一产物，`context_compressed` 事件与手动响应统一携带 Trigger/SummarizerFailed/MessagesSummarized/CompactArtifacts，机械截断降级时标记 `summarizerFailed` 并清空产物；MessagePack emitter 与事件模型同步新增三字段编码（跳过 null，兼容旧客户端）。持久化快照落库由步骤 10 承接。
  - 验证：自动/手动产生同格式的压缩上下文、摘要正文与边界元数据（持久化快照落库由步骤 10 验证）。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [x] 步骤 9：完善压缩事件和聊天窗摘要卡。实现：chat-store 的 `context_compressed` 事件接入新字段（trigger/summarizerFailed/messagesSummarized/compactArtifacts），完成时经 `applyCompactArtifactsToSession` 将边界+摘要产物对合入会话转写（`mergeCompressedMessagesKeepHistory`）并 `dbUpsertMessage` 落库，落库前按 (created_at, sort_order) 排序语义重定位产物时间戳（插到保留段头消息之前，重载后仍在压缩点）；手动压缩路径复用同一 `recordCompressionStatusMessage` + `applyCompactArtifactsToSession` 产出同形状状态卡与产物；新增 `CompactBoundaryMessage` 边界分隔线（触发方式/摘要条数/触发 token），`CompressionStatusMessage` 增加触发徽章与降级警示（summarizerFailed 琥珀色降级提示）；`CompressionStatusMeta`/`CompressionResult` 扩展 trigger/messagesSummarized/summarizerFailed；transcript 过滤器放行 compressionStatus/compactBoundary 系统消息。loop_end 不替换会话消息，产物不会被冲掉。
  - 验证：聊天窗显示压缩开始状态；完成后显示可展开的“上下文摘要”正文、压缩数量/范围、保留信息和降级状态；重载历史后仍可查看；不依赖 Activity 面板。
- [x] 步骤 10：压缩结果持久化与 Worker 会话同步。实现：`DbCompactionSnapshotStore.UpsertSnapshot` 提取为共享写入器（事务内从最新持久化消息派生游标 + `ON CONFLICT(session_id) DO UPDATE` 替换旧行，失败保留旧快照），`DbCompactionSnapshotTools.Upsert` 端点改为委派调用；新增 `ContextCompression.Persistence.PersistSnapshot`——从同一 `CompactionOutcome` 派生 wireConversation/compactArtifacts JSON 数组与 summaryMessage/summaryText（按稳定 SummaryMessageId 定位），仅在有效压缩（非机械截断降级、非未压缩）时落库，异常记 `CompactionSnapshot: persist` 警告不传播；AgentLoop 自动压缩在 `sessionConv.Replace` 后落快照（仅主会话——子 Agent 循环共享父 sessionId 但会话隔离），手动端点在 Worker 持有权威会话时落快照（stateless 回退路径不落，避免调用方消息与游标覆盖的持久化历史不一致）。
  - 验证：内存 `SessionConversation`、SQLite 快照、聊天摘要消息语义一致；持久化失败不静默吞掉，按已定策略回退或保留旧快照。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。

### Plan 23-4：历史恢复、前端分页解耦与当前轮吸附

- [x] 步骤 11：改造 `SessionRestoreTools` 使用快照/全量兼容恢复策略。实现：`DbCompactionSnapshotTools.TryGetValidSnapshot` 提取为共享校验读取（版本/载荷/游标三重校验，问题降级为 null+reason 并记日志），`Get` 端点改为委派调用；`RestoreSession` 优先快照路径——反序列化 `wire_conversation` + 契约 §3.1 游标后增量查询，增量按 id 去重（防时间戳重定位后的摘要行重复）并跳过聊天专用产物（compactBoundary/compressionStatus 不入模型上下文），恢复后 `MarkCompactionWatermark` 防止立刻重折摘要；快照缺失/不支持/损坏/游标无效/读取异常均回退全量恢复（全量路径同样跳过聊天专用产物）；响应新增 `FromSnapshot` 诊断字段，日志标注 source=snapshot/full。前端分页加载更早历史（`fetchOlderMessages`）本就不调用 `agent/restore-session`，仅首次加载触发恢复，无需改动。
  - 验证：有快照恢复快照 + 后续消息；无快照全量恢复；加载更早 UI 历史不触发 Worker 恢复。252 断言快照回归测试全过；C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [x] 步骤 12：历史加载改为点击触发。实现：`handleListScroll` 移除滚动触顶自动加载（删除 `OLDER_MESSAGE_LOAD_SCROLL_THRESHOLD` 门限与高度变化/程序滚动守卫，滚动仅同步底部状态与 assistant rail）；顶部按钮保留并改为唯一入口，点击加载更早 5 轮（`fetchOlderMessages` 防重入 + flushSync 后 scrollHeight 差值补偿 scrollTop，不重新引入 prepend 闪烁专项重构）；`db/messages-list-by-turns` 新增 `TotalTurns` 返回（user 消息总数），前端 `Session.totalTurns` 随首次/增量/窗口加载更新，按钮下方显示“已加载 X/Y 轮 · M/N 条消息”（`loadProgress` 新 i18n，zh/en 同步；修复旧 `loadOlder` 把时间戳当 count 传参的问题）。
  - 验证：移除滚动触顶自动加载；顶部按钮可连续加载更早 5 轮；显示总轮数/已加载范围；不重新引入 prepend 闪烁专项重构。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [x] 步骤 13：实现进行中当前轮 user message 吸附。实现：`useMessageListData` 新增 `pinnedTurnMessage`——仅在 `isAgentExecutionActive`（运行/流式/团队执行中）时取最后一条普通 user 消息（排除压缩摘要消息与 team 消息），历史折叠会话无运行态自然不启用；`useMessageListScroll` 新增吸附可见性同步（锚点消息已渲染时用 `getBoundingClientRect` 判断滚出可视区顶部，未渲染时按虚拟行索引与首个可见行比较；滚动事件/总高度变化/行数变化时重算，切换会话重置）与 `handleJumpToPinnedMessage`（点击吸附卡平滑滚回原消息并高亮，未渲染时走 `scrollToIndex`）；`VirtualListContent` 在列表容器顶部渲染吸附卡（`AnimatePresence` 淡入、与消息列对齐、两行截断、点击跳回，原消息仍在流内不重复展示）；执行完成/取消/失败后 `isAgentExecutionActive` 转假自动解除。新增 `pinnedTurnEmpty` i18n（zh/en，图片/附件消息兜底文案）。
  - 验证：当前轮执行时 user message 固定在可视区域顶部；thinking/tool/output 增长在其下方；完成/取消/失败/切换会话后解除；历史折叠会话不启用。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。

### Plan 23-5：聊天窗右上角悬浮操作块重构

- [x] 步骤 14：将 `SessionConversationPane` 右上角操作块改为竖向布局，移除其中的清除会话入口。实现：原顶部横条（占用聊天区一行高度）改为消息区右上角悬浮竖向块（`absolute right-3 top-3 z-30`，不占布局空间，盖在 assistant rail 之上保证可点击，tooltip 改向左弹出）；移除悬浮块中两处清除会话入口（独立 Eraser 按钮与更多菜单的 Clear messages 项）及关联 `handleClear`/`toast`/`hasMessages` 代码——清除能力保留在侧边栏会话菜单与输入区菜单（`workspace-sidebar-items.tsx` / `InputArea`），非误删；保留终端开关与更多菜单（重命名/删除会话），竖向容器为后续步骤 15/16/17（压缩会话/打开文件夹/宽窄调节）预留扩展位。
  - 验证：普通聊天、项目聊天、无消息、执行中、切换会话场景布局和状态正确；清除会话能力不被误删，应保留在其他明确入口或按产品决策移位。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [x] 步骤 15：接入“压缩会话”。实现：悬浮竖向块新增压缩按钮（`Archive` 图标，压缩中切 `Loader2` 旋转并 `disabled` 防重复点击），复用 `useContextCompression` 统一反馈 hook 与 `compressSessionContext` 统一手动压缩链路（与 ContextRing 同一端点/状态语义：运行中会话即时返回 blocked，不重复触发）；按钮 tooltip 优先显示状态文案（压缩中/已压缩/无需压缩/暂时无法压缩/失败，3.2 秒后回退），新增 `layout.compressContext` 与 `input.*` 压缩状态 i18n（zh/en layout.json，此前仅有 defaultValue 英文兜底）。
  - 验证：调用统一手动压缩链路，显示压缩中/成功/失败反馈，执行期间防重复点击。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [x] 步骤 16：接入“打开右侧文件夹”。实现：悬浮竖向块新增 `FolderOpen` 按钮，点击调用已有 `ensureFilesTab(resolvedSessionId)`（打开右侧面板并激活 Files tab，tab 已存在时仅切换，文件树展开状态由持久层保留）；会话与工作区均无工作目录（`session.workingFolder ?? projectWorkingFolder`）时按钮 `disabled` 且 tooltip 提示“未设置工作目录”，不伪造成功；新增 `layout.openFolderPanel` i18n（zh/en）。
  - 验证：有工作区时打开右侧面板并切换 Files tab；无工作区时禁用或提示，不伪造成功。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。
- [x] 步骤 17：接入聊天区域宽窄调节。实现：`conversationPanelFullWidth` 偏好持久化到 settings-store（version 32→33 + 迁移守卫，刷新/重启按既定策略恢复）；悬浮竖向块新增宽窄切换按钮（窄态 `ChevronsLeftRight` / 宽态 `ChevronsRightLeft`），同一布尔值同时驱动 `MessageList fullWidth` 与 `InputArea fullWidth`（820px 标准列 ↔ 全宽，Composer 与消息列同宽不溢出）；聊天列为弹性列，右侧面板开关后 `max-w-none` 自然随可用宽度重适配；顺带清理 ui-store 中从未使用的同名冗余字段；新增 `layout.widenChat`/`layout.standardChatWidth` i18n（zh/en）。
  - 验证：聊天内容区宽度可调，Composer 不溢出；右侧面板开关后重新 clamp；刷新/重启后按既定策略恢复。C# solution 0 warning/0 error，TypeScript web/node/root 0 error。

### Plan 23-6：工具结果即时持久化与崩溃恢复

- [x] 步骤 18：在 `tool_call_result` 工具完成边界形成可恢复状态。实现：Renderer `chat-store` 在 `tool_call_result` 事件的内存更新后立即调用既有 `dbUpsertMessage`（与 `message_end`/`loop_end` 同一 upsert 路径），不再等待后续持久化边界；成功、错误、取消、审批拒绝、跳过结果全部经 `tool_call_result` 事件流（ToolCallProcessor 三处 emit 点）统一覆盖；稳定键为消息 id（runId），Worker `db/messages-upsert` 存在则 UPDATE、不存在则 INSERT，重复事件幂等，并发工具后写携带先写结果的超集，不互相覆盖。纯 Renderer 改动，无 C# 变更。
  - 验证：不等待 30 秒检查点、`message_end` 或 `loop_end`；成功、错误、取消、审批拒绝、跳过结果均可恢复。
- [x] 步骤 19：确定并实现 messages upsert 或 Worker durable journal 的最小方案。定案：采用最小 messages upsert 方案，不引入 Worker 独立 durable journal（不新增双重数据源）。实现：`dbUpsertMessage` 增加按消息 id 的串行写入队列（`messageUpsertChains`），工具边界/`message_end`/`loop_end` 的 fire-and-forget upsert 严格按发起顺序提交，后写快照携带先写结果超集，即使 Worker 并发分发也不会出现旧快照回退；单次写入失败隔离不阻塞后续快照；保持调用方 fire-and-forget 语义。稳定键覆盖：session（`session_id`）/ run（消息 id = runId，`messages.id` 主键）/ tool（toolCallId 内嵌于消息 content/segments，与 tool_use 一一对应）；重复事件与 Provider 重试复用同一 runId，只 UPDATE 同一行不产生重复消息。
  - 验证：重复事件、重试、多工具并发不会互相覆盖或重复写入；稳定键至少覆盖 session/run/tool。
- [x] 步骤 20：实现恢复 reconciliation 和中间记录清理。实现：`SessionRestoreTools` 恢复链路（快照增量路径与全量路径共用）在实体转 wire 消息时补配工具结果——assistant 行的 `meta.toolCalls` 中已完成结果（`completed`/`error`，含 output）原位恢复为独立 user `tool_result` wire 消息（与 live 路径 `CreateToolResultsWireMessage` 同构），未完成调用（`running`/`streaming`/无状态，即崩溃中断）补 `[INTERRUPTED]` 占位结果（`isError`），保证恢复后的对话对 Provider API 合法（每个 `tool_use` 必配 `tool_result`）。合成只在恢复时内存中进行，不回写 DB、不重放工具；旧格式（user 行携带 toolCalls 的 split 存储）通过预扫 `providedResultIds` 去重，不产生重复结果。中间记录清理：步骤 19 定案不引入 journal，本步骤无新增持久化中间记录，合成产物随恢复结束释放，不存在无限增长问题；快照失效沿用步骤 10 的 `InvalidateIfUpsertCovered`。纯 C# 改动（WishfulClaw.Agent），C# solution 0 warning/0 error。
  - 验证：已有 tool_use 缺 tool_result 时能找回已完成结果；不会因恢复重放重复执行工具；journal/中间记录不会无限增长。
- [x] 步骤 21：覆盖前台、后台 Cron、渠道会话和异常退出。审计结论：三路径均汇入 chat-store 事件链——前台 `sendMessage`；Cron in-session 模式 `runInSession` → `sendMessage`（发送前 `loadRecentSessionMessages(force)` 触发 restore）；渠道 `plugin:session-task` → `handleSessionTask` → `sendMessage`，步骤 18/19 的持久化边界（工具完成/`message_end`/`loop_end` + 串行队列）天然全覆盖。Cron 静默 sidecar 模式按设计不存会话，仅持久化投递摘要（`deliverToSession`）与 `cron_runs` 运行记录。发现并修复缺口：渠道重启后注入 store 的会话未加载历史也未触发 `agent/restore-session`，Worker 会话为空导致新轮丢失全部历史——`handleSessionTask` 发送前若消息列表为空先 `await loadRecentSessionMessages` + `await agent/restore-session`（参照 `runInSession`），保证 Worker 状态先于 `agent/run` 落位；restore 幂等（`MessageCount > 0` 跳过）常态零开销。异常退出：Renderer 崩溃→工具边界结果已落库（步骤 18）重开可见；Worker 崩溃→上一工具边界快照在库，未找回结果由步骤 20 占位补齐；恢复只读不重放（`RestoreSession` 不触及工具执行器，无静默重跑）；cron 中断 run 留 `running` 行由查询侧孤儿归一化，不自动重跑。纯 TS 改动，TS 三配置 0 错误。
  - 验证：三种执行路径持久化行为一致；Renderer/Worker 在工具完成后异常退出，重开后结果可见且不静默重跑。

### Plan 23-8：追加 Issue 修复与体验改进（issues 库 2026-08-27 新增）

> 来源：`D:\koda\Obsidian\02-AI教学\wishfulclaw\issues`（bugs.md + 改进.md，2026-08-27 新增项）。其中 08-26/08-24 的悬浮块/历史摘要/点击加载/压缩卡片四项已被 Plan 23-2/23-4/23-5 覆盖；桌面图标白角项调查结论为 Windows 图标缓存残留，代码侧无可修复项（待用户清缓存确认）；Goal 编排可视化原排后续迭代、滚动锚点吸附为独立大交互优化，均不纳入本追加。本 Plan 在 Plan 23-7 全量回归之前实施，使回归覆盖新增代码。

- [x] 步骤 26：修复项目档案路径斜杠混用。
  - 现状：`project-archive-helpers.ts` 的 `joinFsPath` 一律用 `/` 拼接，与 Windows 反斜杠 `workingFolder` 混出 `D:\gy\Obsidian/.wishful-claw/MEMORY.md`。
  - 实现：`joinFsPath` 平台感知（win32 用 `\`，其余用 `/`），展示路径与实际读写路径同一拼接结果；排查 ProjectArchivePage 其余直接拼接点。
  - 验证：项目档案页各路径统一为系统分隔符；记忆/人格/日常文件读写正常。TS 三配置 0 错误。
  - 已实现：`project-archive-helpers.ts` 的 `joinFsPath` 改为平台感知拼接——首段去尾部分隔符、后续段去首尾分隔符，分隔符优先取 base 路径已有分隔符，无则按 `window.electron.process.platform === 'win32'` 取 `\`，否则 `/`（对齐 `memory-files.ts` 既有实现风格）；排查确认 `ProjectArchivePage`/`PersonaFilePreview` 所有路径（memory/daily/persona 文件）均经 `joinFsPath`，无其他直接拼接点。TS 三配置 0 错误。
- [x] 步骤 27：输入草稿持久化实装（切页不丢输入内容）。
  - 现状：main 侧 `input-draft:*` 五个 handler 全为空 stub，renderer `useInputDraftPersistence` 是 no-op；draft 类型与 IPC 通道均已就位。
  - 实现：main 侧实现草稿 JSON 文件持久化（`~/.wishful-claw/` 下，get/set/remove/list/cleanup）；renderer hook 实装：输入变化防抖保存、挂载恢复、发送成功后清除；沿用现有 draftKey（session/project/home）。
  - 验证：输入内容→切设置页→回来内容保留；会话/项目各自独立；发送成功后草稿清除。TS 三配置 0 错误。
  - 已实现：新增 `src/main/ipc/input-draft-handlers.ts`——草稿存于 `~/.wishful-claw/input-drafts.json`（兼容 `WISHFULCLAW_DATA_DIR` 隔离目录）单文件 JSON map（draftKey → draft + updatedAt），get/set/remove/list/cleanup 五端点实装（空内容 set 转为删除，cleanup 清 30 天前旧草稿），替换 `index.ts` 空 stub；`use-input-draft-persistence.ts` 实装：draftKey 变更时先读内存缓存再读盘（请求序号防竞态）、`saveDraft` 空内容转 remove、`removeDraft` 同步清本地状态；既有 `use-input-area-effects` 的 400ms 防抖保存/挂载恢复/`resetComposer` 发送后清除链路无需改动直接生效。后续审查修复：写盘改临时文件 + `rename` 原子替换；注册时启动清扫一次过期草稿；`deleteSession` 同步删除对应 `session:*` 草稿；`hasInputDraftContent` 纳入 `selectedFiles` 与主进程判定一致。TS 三配置 0 错误。
- [x] 步骤 28：新建服务商弹窗改造。
  - 实现：① `AddProviderDialog` 增加 API Key 输入（随 `addCustomProvider` 落库）；② 保存后立即触发一次 `fetchModels`（错误仅 toast 不阻断）；③ `ProviderConfigPanel` 取消原“连接测试”下拉框整行，改为模型列表项 hover 时显示“检查连接”图标按钮（复用 `testConnection` + 既有 toast 反馈）。
  - 验证：新建时可填 Key、保存即拉模型列表；连接测试能力不丢失，入口换到模型行。TS 三配置 0 错误。
  - 已实现：① `AddProviderDialog` 新增 API Key 密码输入（可切换明文），`addCustomProvider`/`createCustomProvider` 增加可选 `apiKey` 参数随服务商落库；② 保存后 fire-and-forget `fetchModels`，成功非空时 `setModels` + toast，失败仅 toast 不阻断；③ `ProviderConfigPanel` 移除连接测试下拉框整行与结果横幅（清理 `testModelId`/`testResult` 状态与废弃 i18n 键），模型行操作区新增 hover “检查连接”闪电图标按钮（`testingModelId` 单模型级转圈，无 Key 禁用，复用 `testConnection` + 原 toast 文案）；zh/en 新增 `provider.add.apiKey*` 与 `models.checkConnection`。TS 三配置 0 错误。
- [x] 步骤 29：模型编辑弹窗图标选择器引入真实图标。
  - 现状：`ModelFormDialog` 图标选择器所有 `MODEL_ICON_OPTIONS` key 渲染为 `Server` 占位。
  - 实现：复用 `provider-icons` 的 `ModelIcon` 渲染各 key；核对覆盖度，缺失的 key 补齐图标资源/分支；选择交互不变。
  - 验证：选择器显示真实系列图标，选择结果在模型列表与消息头生效。TS 三配置 0 错误。
  - 已实现：`ModelFormDialog` 图标选择器由 `Server` 占位改为 `<ModelIcon icon={key} size={16} />`（复用 `provider-icons` 的 lobehub 静态图标链路，自动跟随明暗主题）；覆盖度核对：`MODEL_ICON_OPTIONS` 23 个 key 在 `modelIconSlugMap` 全部有映射（bigmodel→chatglm、mimo→xiaomimimo 等，审查后补 `bigmodel` 映射遗漏），无需新增资源/分支；选择交互与保存链路不变，既有 `ModelIcon` 消费 `icon` 字段，模型列表与消息头自动生效。TS 三配置 0 错误。
- [x] 步骤 30：文件树 tab 彩色图标与中文标题。
  - 现状：`RightPanelHeader` files tab 用无颜色 `FolderOpen` + 英文标题。
  - 实现：i18n 中文标题（zh/en）；文件树 tab 与左侧面板项目树图标换为彩色图标（对齐 OpenCowork）。
  - 验证：tab 展示对齐，切换/折叠功能不受影响。TS 三配置 0 错误。
- 已实现：① `RightPanel` tabs useMemo 补 files 分支（`t('rightPanel.files', { defaultValue: 'Files' })`），zh/en layout.json 新增 `rightPanel.files` 键（“文件”/“Files”），tab 标题随语言切换；② `RightPanelHeader` TabIcon 的 files 分支与“打开文件”下拉项加 `text-sky-400`（对齐 OpenCowork `WorkbenchTabButton`）；③ `workspace-sidebar-items.tsx` 项目行主图标（展开 `FolderOpen`/收起 `Folder`）同加 `text-sky-400`。tab 创建处硬编码标题保留，运行时被 i18n 覆盖；切换/折叠逻辑未动。TS 三配置 0 错误。
- [x] 步骤 31：左侧面板对话命名/图标 + 扩展/自动化图标。
  - 实现：① 左侧面板“全局对话”分区展示对齐 OpenCowork（当前直接展开），“会话”命名改“对话”并增加图标；② 扩展入口图标从文件夹改为 OpenCowork 扩展图标；③ 自动化入口图标从日历改为时钟。
  - 验证：各入口图标/标题正确，导航功能不受影响，i18n 双语完整。TS 三配置 0 错误。
- 已实现：① `WorkspaceSidebar` 全局对话分区头部加 `MessageSquare` 图标与会话计数（对齐 OpenCowork `SessionListPanel` 头部），zh `sidebar.conversations` 由“会话”改“对话”（en 保持 Conversations，键仅单处引用）；② 扩展入口图标 `FolderOpen` → `Plug`（对齐 OpenCowork 扩展触发器）；③ 自动化项图标 `CalendarDays` → `Clock3`（对齐 OpenCowork automation nav item）；项目排序下拉的 `CalendarDays` 语义不变保留。导航/点击链路未动。TS 三配置 0 错误。

> 每步骤一个本地 commit，不 push；纯前端步骤验证以 TS 三配置为准。

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
