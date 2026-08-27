# v2-iter-23 探索报告

> 阶段：探索态（只读）
>
> 日期：2026-08-27
>
> 基线：`main`，产品版本 `0.2.22`，最新 tag `v0.2.22`
>
> 本报告基于 Wishful Claw 当前代码、v2-iter-23 临时计划、项目知识库和 `D:\claw\OpenCowork` 参考源码整理。探索阶段未修改产品代码，未运行写入类命令。

## 一、迭代范围基线

当前讨论已确认 v2-iter-23 暂定包含：

- 上下文压缩产物持久化与历史恢复；
- 手动/自动压缩统一；
- 压缩事件推送到聊天窗，显示可回看的“上下文摘要”；
- 未压缩会话兼容当前全量恢复；
- 前端历史分页只负责展示，不影响后端 Agent 上下文；
- 进行中当前轮 user message 吸附置顶，历史折叠会话不启用常驻吸附；
- 聊天窗右上角悬浮操作块改造：竖向布局、压缩会话、打开右侧文件夹、聊天区域宽窄调节；移除该悬浮块中的清除会话；
- 工具结果即时持久化与崩溃恢复；
- 正式版验证目标 `v1.0.0`。

不纳入当前范围：虚拟列表 prepend 闪烁的大规模重构、人格混血、Agent 日记、快速启动器插件化、URL 插件、Goal 扩展等，详见 `draft-plan.md`。

## 二、上下文压缩与摘要链路

### 2.1 自动压缩当前调用链

```text
renderer handleSendMessage
  → agent/run
  → AgentLoop 每轮检查 lastInputTokens + CompactionWatermark + ShouldCompress
  → context_compression_start
  → ContextCompression.CompactAsync
  → 无缩减时 TruncateMessages 兜底
  → SessionConversation.Replace
  → context_compressed
  → loop 继续执行
```

关键位置：

- `src/renderer/src/hooks/use-chat-actions.ts:133-155`：发送上下文压缩配置；
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs:181-239`：自动压缩触发、watermark、替换和事件；
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs:474-512`：阈值判断；
- `src/runtime/WishfulClaw.Agent/ContextCompression.cs:81-165`：压缩、LLM 摘要、机械兜底、压缩结果组装；
- `src/runtime/WishfulClaw.Agent/SessionConversation.cs:41-47,140-179`：watermark、增量追加和内存替换。

当前压缩结果并非固定“摘要 + 最近 5 轮”，而是：

```text
pinned prefix
+ fold 区域保留的 user turns
+ compaction summary
+ recent tail
```

### 2.2 当前聊天窗事件展示

当前协议已有：

- `context_compression_start`；
- `context_compressed { originalCount, newCount, keptMessageCount? }`。

关键位置：

- `src/shared/agent-stream-protocol.ts:148-156`；
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs:185-221`；
- `src/renderer/src/lib/agent/stream-event-adapter.ts:70-74`；
- `src/renderer/src/stores/chat-store/index.ts:506-546`；
- `src/renderer/src/components/chat/CompressionStatusMessage.tsx:24-70`；
- `src/renderer/src/components/chat/ContextCompressionMessage.tsx:27-102`。

事实：

- 聊天窗已有压缩中/压缩完成状态卡；
- `context_compressed` 当前主要只有数量信息；
- 自动压缩产生的 summary 是 `<compaction-summary>` 标签包裹的普通 user 消息，没有 `meta.compactSummary`；
- `ContextCompressionMessage` 只会渲染带 `meta.compactSummary` 或旧格式前缀的消息；
- 因此当前用户看到的是“已压缩/压缩数量”，不是可展开的完整“上下文摘要”。

本迭代必须补齐：自动压缩和手动压缩都向聊天窗推送可阅读的摘要结果，而不是只写 Activity 或状态卡。

### 2.3 手动压缩当前调用链

前端已有入口和 bridge：

- `src/renderer/src/components/chat/InputArea/context-ring.tsx:113-119`；
- `src/renderer/src/components/chat/InputArea/use-context-compression.ts:11-63`；
- `src/renderer/src/lib/ipc/agent-bridge-streaming.ts:383-430`。

bridge 调用：

```text
worker:request
  method = agent/compress-context
```

但当前 `AgentRuntimeModule.cs` 只注册了 `agent/append-messages` 和 `agent/restore-session` 等端点，尚未发现 `agent/compress-context` 的 Worker 注册/实现。全项目搜索也未发现对应 Worker handler。

此外，`src/renderer/src/lib/agent/context-compression.ts:6-18` 仍存在一个直接抛异常的旧 stub；实际调用路径使用的是 `agent-bridge-streaming.ts` 的 bridge，造成同名实现并存和维护歧义。

### 2.4 OpenCowork 摘要参考

OpenCowork 的可参考边界：

- `D:\claw\OpenCowork\cli\src\runtime\open-cowork-worker-runtime.ts:3733-3742`：将压缩开始、压缩增量、压缩完成作为运行时事件处理；
- `D:\claw\OpenCowork\cli\ARCHITECTURE.md:314`：压缩事件不仅更新底部状态，也保留一个完成/失败的 transcript result；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeContextCompression.cs:373`：压缩增量事件；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\OpenAIChatRuntime.cs:126-221,535-677`：压缩状态、取消、失败和完成结果；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeModels.cs:81`：压缩摘要消息作为结果的一部分。

参考结论：Wishful Claw 应保留自己的协议和 7 层结构，只借鉴“压缩是聊天可见的 transcript result，完成事件携带/关联摘要产物”的行为边界。

## 三、历史会话与压缩恢复

### 3.1 前端历史加载

前端当前默认加载最近 5 个完整轮次，顶部已有加载更早消息按钮。

关键位置：

- `src/renderer/src/stores/chat-store/session-slice.ts:449-506`：最近消息加载；
- `src/renderer/src/stores/chat-store/session-slice.ts:508-538`：更早消息查询和 prepend；
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx:114-140`：顶部点击按钮；
- `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts:301-323`：当前仍有滚动触顶自动加载。

已确认的职责边界：

- 最近 5 轮只属于前端首屏展示；
- 点击加载更早历史只更新 UI；
- 不触发 Worker `SessionConversation` 重建；
- 不影响后端 Agent 上下文。

### 3.2 后端恢复

当前 `SessionRestoreTools.RestoreSession`：

```sql
SELECT * FROM messages
WHERE session_id = @sid
ORDER BY created_at ASC, sort_order ASC
```

关键位置：

- `src/runtime/WishfulClaw.Agent/SessionRestoreTools.cs:25-89`；
- `src/runtime/WishfulClaw.Agent/SessionRestoreTools.cs:98-215`：DB 消息转换为 wire message；
- `src/runtime/WishfulClaw.Agent/SessionRestoreTools.cs:221-299`：解析为 Agent conversation。

当前没有压缩快照字段，也没有压缩覆盖游标。Worker 重启后只能从 `messages` 全量重建，无法恢复内存中已经压缩过的上下文状态。

目标恢复策略：

```text
存在有效压缩快照
  → 恢复快照
  → 追加压缩完成后新增的全部持久化消息

没有有效压缩快照
  → 沿用当前全量读取 messages 的兼容逻辑
```

不能只保存摘要正文，因为现有压缩结果还包含 pinned prefix、保留 user turns 和 recent tail。

## 四、工具结果持久化链路

### 4.1 当前路径

```text
ToolCallProcessor
  → tool_call_result
  → renderer chat-store 更新内存 toolCalls/segments
  → message_end 或 loop_end
  → dbUpsertMessage
```

关键位置：

- `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:337-506`：工具执行和结果事件；
- `src/renderer/src/lib/agent/stream-event-adapter.ts:91-95`：事件透传；
- `src/renderer/src/stores/chat-store/index.ts:1133-1201`：`tool_call_result` 只更新内存；
- `src/renderer/src/stores/chat-store/index.ts:679-747`：`message_end` 持久化；
- `src/renderer/src/stores/chat-store/index.ts:1207-1269`：`loop_end` 最终持久化；
- `src/renderer/src/stores/chat-store/db-helpers.ts:311-320`：message upsert。

### 4.2 崩溃窗口与风险

工具完成后到 `message_end`/`loop_end` 之间存在持久化窗口：

- Renderer 崩溃时，已完成工具结果可能只在内存；
- Worker 重启恢复只读 `messages`，无法找回未落库结果；
- 尾部可能出现已有 tool_use、但缺失 tool_result；
- 后续模型可能重新判断并重复执行工具。

Cron 和渠道会话当前也依赖 Renderer/聊天主路径，没有独立 Worker 侧工具结果恢复保障。

### 4.3 OpenCowork 工具结果参考

关键参考文件：

- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeToolResultJournal.cs`：读取 `runtime_tool_results`；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeModule.cs`：注册 `agent/tool-results-lookup`；
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\Db\DbSchemaMigrator.cs:848-867`：`runtime_tool_results` durable journal；
- `D:\claw\OpenCowork\src\renderer\src\lib\agent\runtime-reattach.ts:68-128`：工具结果恢复、尾部 tool_use 修复和去重；
- `D:\claw\OpenCowork\src\main\cron\cron-agent-background.ts:1665-1696`：工具边界和 message boundary flush；
- `D:\claw\OpenCowork\src\main\channels\headless-auto-reply.ts:375,478,598-630`：渠道 headless 执行结果收集和最终落库。

参考结论：核心行为是工具完成边界立即写入可恢复状态，恢复时按稳定键 reconciliation，最终消息落库后清理中间记录。是否在 Wishful Claw 引入独立 journal，应在正式 Plan 中基于现有 7 层和最小变更原则定案。

## 五、聊天 UI 链路

### 5.1 右上角悬浮操作块

当前实现位置：

- `src/renderer/src/components/layout/SessionConversationPane.tsx:128-190`：横向操作块；
- `SessionConversationPane.tsx:131-148`：打开底部终端；
- `SessionConversationPane.tsx:152-187`：清除会话按钮和更多菜单；
- `src/renderer/src/stores/ui-store-tab-slice.ts:135-154`：`ensureFilesTab`；
- `src/renderer/src/components/layout/RightPanel.tsx:23-282`：右侧面板和文件树。

当前没有：

- 右上角压缩会话入口；
- 打开右侧文件夹入口；
- 聊天区域宽窄调节入口。

v2-iter-23 暂定改为：

```text
竖向悬浮块
├─ 压缩会话
├─ 打开右侧文件夹
└─ 聊天区域宽窄调节
```

原清除会话不再放在该悬浮块中。是否保留到更多菜单属于实现细节，不能因此误删现有清除能力。

### 5.2 当前轮 user message 吸附

当前未发现当前轮用户消息吸附实现。

可复用结构：

- `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts:72-215,256-431`：滚动 refs、自动滚动、程序滚动守卫；
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx:114-160`：虚拟列表行；
- `src/renderer/src/components/chat/useMessageListData.ts`：消息行数据和当前消息关系；
- `src/renderer/src/stores/chat-store/index.ts`：streaming session/message 状态。

目标行为：

- 仅在当前轮正在执行、thinking/tool/output 持续增长时启用；
- 当前轮 user message 固定在聊天可视区域顶部；
- 执行完成、取消、失败、切换会话后解除；
- 历史会话继续使用折叠展示，不启用常驻吸附；
- 不与点击加载历史的 scrollHeight 补偿混用。

## 六、依赖、风险与设计建议

### 高风险

1. 手动 `agent/compress-context` 端点缺失，当前点击入口无法形成闭环。
2. 自动/手动压缩产物模型不一致，摘要正文没有稳定进入聊天窗。
3. 压缩结果只在内存替换，Worker 重启后恢复丢失压缩状态。
4. 工具结果在 `tool_call_result` 到 message/loop end 之间存在崩溃丢失窗口。
5. v1.0.0 发布会改变当前项目 `0.2.N` 版本规则，需要同步文档和 Release 流程。

### 中风险

1. 压缩快照与 messages 的游标一致性；
2. 多工具并发结果持久化覆盖；
3. 前台、Cron、渠道三种执行路径的一致性；
4. 当前轮吸附与虚拟列表尺寸变化、用户主动滚动、会话切换之间的状态竞争；
5. OpenCowork 参考代码体量较大，直接复制会破坏 Wishful Claw 的分层和 AOT 约束。

### 设计建议

- 压缩快照优先采用可版本化、AOT 安全的明确数据结构；
- 未压缩会话保留全量恢复，不做迁移期强制摘要；
- 摘要正文、聊天摘要卡、后端恢复快照使用同一份语义来源；
- 工具结果先验证现有 messages upsert 是否足以承载即时持久化，再决定是否增加 Worker durable journal；
- 所有事件和数据库写入都使用稳定 session/run/tool key，避免重复消息和重复工具执行；
- 用户可见反馈必须位于聊天窗主链路，Activity 仅作辅助展示。

## 七、阶段一输出与下一步

探索态输出：

- 本文件 `exploration_findings.md`；
- `draft-plan.md`：此前记录的讨论稿。

下一步按 `docs/dev-workflow.md` 进入规划态：

1. 依据本报告和讨论稿生成 `plan.md`；
2. 启动独立规划合规审查，产出 `compliance_report.md`；
3. 若合规审查无阻断项，停在用户确认门；
4. 用户确认后才创建/使用 `dev/v2-iter-23` 执行分支和产品代码改动。
