# Plan: 压缩显示闭环与 OpenCowork 分隔线对齐

> 迭代：v2-iter-24
>
> 日期：2026-09-01
>
> 状态：规划验证中，用户确认前不得进入执行态

## 目标

修复上下文压缩期间和完成后的聊天显示：压缩期间只显示一个临时、本地化、阻塞式压缩提示并隐藏普通 thinking/loading；压缩完成后临时提示立即消失，仅在稳定 `displayAnchor` 位置保留一条 OpenCowork 风格可点击分隔线，点击后在原位置展开/收起 Markdown 摘要，reload 后位置一致，且旧 `compressionStatus` 历史消息不再污染 transcript。

## 范围决策

- 后端 `AgentLoop.cs` 已通过 `await ContextCompression.CompactAsync(...)` 等待压缩完成，本计划不修改后端等待控制。
- 不修改压缩算法、快照 schema、SQLite 表结构和摘要协议。
- 自动压缩与手动压缩必须共用锚点生成和产物接纳逻辑。
- OpenCowork 组件不仅参考行为，还完整迁移适配其图标、渐变线、琥珀色胶囊按钮、预览、Markdown 展开和失败提示样式。
- 失败、跳过、阻塞、取消只做临时反馈或现有 toast/返回状态，不常驻聊天记录。
- 旧数据库里的 `compressionStatus` 消息只在显示层过滤，不删除历史数据。

## 步骤清单

- [ ] 步骤 1：建立单一 live compression phase，并从普通执行态中排除压缩
  - 在消息列表数据层读取当前 session 的 live compression 状态，区分“Agent 正在运行”和“正在压缩”。
  - 压缩期间不把空 assistant message 判为普通 streaming/loading，避免 `ModelThinkingIndicator` 与压缩提示同时出现。
  - pinned current-turn、continue 等依赖普通执行态的 UI 不因压缩 phase 误触发。
  - 验证检查点：构造 active run + live compression 状态时，页面只出现压缩提示，不出现普通“思考中”或空 assistant loading。

- [ ] 步骤 2：收敛临时压缩提示与 transcript 状态消息
  - 保留唯一 `LiveCompressionCard`（或等价组件）作为压缩期间临时提示，沿用 live draft/retry 信息和中英文文案。
  - 完成、失败、跳过、阻塞、取消时清理 live store，不将进行中或成功状态卡写入 transcript。
  - 调整自动/手动压缩路径，停止用 `recordCompressionStatusMessage` 生成成功/进行中 synthetic system message；失败类状态使用最小临时反馈，不永久污染消息记录。
  - 在 transcript/renderable message 过滤层隐藏旧数据库中的 `meta.compressionStatus` 消息，保证历史会话不会重新出现重复卡片。
  - 验证检查点：新压缩全程只有一个临时提示；完成后提示消失；reload 后没有状态卡；旧历史状态消息仍存在数据库但不显示。

- [ ] 步骤 3：生成并保留稳定 `displayAnchor`
  - 参考 OpenCowork `withLiveCompactSummaryDisplayAnchor(...)` 与 `adoptCompactionSummary(...)`，在 Wishful Claw 中实现适配的锚点生成/摘要接纳辅助函数。
  - 自动和手动压缩都在 `applyCompactArtifactsToSession(...)` 前为摘要产物生成同一语义的 `displayAnchor`。
  - 锚点优先指向压缩切口之后仍保留的稳定 assistant message，并包含可用于 reload 后恢复顺序的必要位置字段。
  - 核对 `sidecar-mapping.ts`：后端模型请求仍可剥离纯显示字段，但前端会话产物和持久化消息不能丢失 `displayAnchor`。
  - 验证检查点：自动压缩和手动压缩都生成非空稳定锚点；切换会话和 reload 后摘要仍出现在同一 assistant message 位置；无有效锚点时采用可预测 fallback，不重复显示独立摘要卡。

- [ ] 步骤 4：完整对齐 OpenCowork 可点击压缩分隔线组件和样式
  - 将 `ContextCompressionMessage.tsx` 从独立圆角摘要卡重构为分隔线组件。
  - 完整迁移并适配以下 OpenCowork 结构/样式：`Scissors` 图标、两侧琥珀渐变线、琥珀圆角胶囊按钮、消息数文案、`ChevronDown` 旋转、`aria-expanded`、折叠预览、原位 Markdown 展开、fallback warning。
  - 核对是否复用现有 `continueSessionFromCompactSummary` 能力；若当前 API 已完整闭环，则保留 OpenCowork 的 `MessageSquarePlus` + Tooltip；若能力不完整，则不引入半成品入口，并在验证报告中说明差异。
  - 停止同时渲染独立 `CompactBoundaryMessage` 和独立摘要卡；完成态只通过锚定后的 `ContextCompressionMessage` 呈现。
  - 补齐 `agent` 中英文 locale 键，文案统一为“上下文已压缩 / 已总结较早消息 / 展开摘要 / 收起摘要”等语义。
  - 验证检查点：默认只看到一条居中分隔线；点击胶囊或预览在原位置展开 Markdown；再次点击收起；明暗主题下图标、渐变线、边框和文字样式与 OpenCowork 参考一致。

- [ ] 步骤 5：覆盖虚拟列表、静态 transcript 与历史兼容
  - 检查 `MessageItem`、`AssistantMessage`、`VirtualListContent`、`StaticMessageTranscript` 的分支，确保虚拟列表和静态历史使用同一完成态组件语义。
  - 删除无用 import/分支；仅在确认没有调用者后删除或退役 `CompressionStatusMessage` / `CompactBoundaryMessage`，避免留下两套入口。
  - 确保摘要消息本体不会作为独立 row 重复渲染，assistant rail 也不产生重复节点。
  - 验证检查点：当前会话尾部、加载较早消息、静态 transcript、会话切换和 reload 五种场景均只出现一个分隔线；无重复摘要 row、无常驻输入框上方卡片。

- [ ] 步骤 6：编译、差异和运行态验证
  - 运行 `npx tsc --noEmit -p tsconfig.web.json`。
  - 运行 `npx tsc --noEmit -p tsconfig.node.json`。
  - 运行 `npx tsc --noEmit -p tsconfig.json`。
  - 运行 `git diff --check`。
  - 若 C# 无改动则不重复构建后端；若实现阶段实际修改 C#，使用 `DOTNET_ROOT=D:\claw\dotnet-sdk` 构建 `src/runtime/WishfulClaw.sln`。
  - 运行态验证场景：自动压缩、手动压缩、压缩完成、失败/跳过/阻塞、切换会话、reload、旧状态消息历史兼容、明暗主题展开/收起。
  - 验证检查点：三套 TypeScript 全部零错误；所有本次相关运行态场景符合目标；任何失败明确区分预存问题与本次引入问题。

## 涉及文件

### 预计修改

- `src/renderer/src/components/chat/ContextCompressionMessage.tsx` — 迁移 OpenCowork 分隔线结构、交互和完整样式。
- `src/renderer/src/components/chat/CompactBoundaryMessage.tsx` — 退役独立边界展示，或收敛为兼容入口。
- `src/renderer/src/components/chat/CompressionStatusMessage.tsx` — 仅保留单一 live 临时提示，移除/退役 transcript 状态卡。
- `src/renderer/src/components/chat/MessageItem.tsx` — 过滤旧状态消息，移除重复完成态分支。
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx` — 单一 live 提示和普通 loading 门控。
- `src/renderer/src/components/chat/MessageList/useMessageListData.ts` — live compression phase、执行态排除、摘要锚点渲染。
- `src/renderer/src/components/chat/MessageList/StaticMessageTranscript.tsx` — 静态历史的锚点一致性。
- `src/renderer/src/components/chat/transcript-filters.ts` — 旧 `compressionStatus` 消息显示层兼容过滤。
- `src/renderer/src/components/chat/AssistantMessage/index.tsx` — 锚点/内联摘要接入核对。
- `src/renderer/src/components/chat/AssistantMessage/content-renderer.tsx` — 完成态组件调用参数适配。
- `src/renderer/src/hooks/use-chat-actions.ts` — 自动/手动压缩停止持久化状态卡，并补锚点生成/接纳。
- `src/renderer/src/lib/agent/context-compression.ts` — 锚点生成、摘要产物适配和合并辅助函数。
- `src/renderer/src/lib/ipc/sidecar-mapping.ts` — 明确纯显示字段剥离边界，避免持久化路径丢锚点。
- `src/renderer/src/stores/chat-store/index.ts` — 若现有 `recordCompressionStatusMessage` / `applyCompactArtifactsToSession` 需要收敛，做最小精确修改。
- `src/renderer/src/locales/zh/agent.json` — 分隔线与临时提示中文文案。
- `src/renderer/src/locales/en/agent.json` — 分隔线与临时提示英文文案。

### 预计不修改

- `src/runtime/WishfulClaw.Agent/AgentLoop.cs` — 后端等待逻辑已正确。
- SQLite schema、快照实体和压缩算法文件 — 本专项无数据结构变更。

实际执行时若文件范围收缩，以最小闭环为准；若需扩大到未列出的模块，先在 plan 中补充原因。

## 参考源码

- OpenCowork：`D:\claw\OpenCowork\src\renderer\src\components\chat\ContextCompressionMessage.tsx`
  - 参考剪刀分隔线、琥珀渐变线、胶囊按钮、预览、Markdown 展开、fallback warning、Tooltip/新会话入口样式与交互。
- OpenCowork：`D:\claw\OpenCowork\src\renderer\src\hooks\use-chat-actions.ts`
  - 参考 `withLiveCompactSummaryDisplayAnchor(...)`、自动压缩完成后的 `adoptCompactionSummary(...)` 和稳定锚点生成。
- Wishful Claw 当前实现：`src/renderer/src/lib/agent/context-compression.ts`
  - 复用现有 compact boundary/summary 判定、摘要文本提取和压缩产物合并逻辑。
- Wishful Claw 当前实现：`src/renderer/src/stores/live-compression-store.ts`
  - 复用当前 session-scoped live draft/retry 状态，不新增第二套临时状态源。

## Git 与隔离策略

- 前一批 updater/设置页改动已提交为 `54e7bba` 并推送；本计划从干净工作区开始。
- 用户要求在测试确认前不提交本次压缩实现，因此规划文档可单独提交；业务代码实现和 commit 必须等规划确认、编译验证和用户运行测试结论。
- 不执行 stash、reset、checkout 覆盖用户改动。
- 执行阶段每次修改前重新读取目标文件；尤其是 `chat-store/index.ts`，确保与前一批提交后的基线兼容。

## 验收标准

1. 压缩期间 Agent Loop 的 UI 表现为等待压缩，只显示一个本地化临时提示，不显示普通 thinking/loading。
2. 压缩完成后临时提示立即消失，不显示 `CompressionStatusMessage`，不常驻输入框上方。
3. 完成态仅有一条 OpenCowork 风格可点击分隔线，图标、渐变线、胶囊按钮、预览和 Markdown 展开样式完整对齐。
4. 自动和手动压缩都有稳定 `displayAnchor`；会话切换和 reload 后位置一致。
5. 旧数据库中的 `compressionStatus` 消息在显示层被过滤，不需要清库。
6. 不显示独立 `CompactBoundaryMessage` + 摘要卡组合，不产生重复摘要 row。
7. 三套 TypeScript 检查全部通过，`git diff --check` 通过；若有 C# 改动，.NET 11 preview SDK 构建通过。
8. 未经用户测试确认，不提交业务代码、不 push。
