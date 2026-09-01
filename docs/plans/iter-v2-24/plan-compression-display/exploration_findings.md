# 压缩显示修复探索结论

## 探索范围

本专项针对 v2-iter-24 中上下文压缩的聊天显示闭环，目标是消除压缩期间的重复提示，并将完成态统一为 OpenCowork 风格的可点击压缩分隔线。探索依据：

- 当前 Wishful Claw 工作区与提交历史
- `src/renderer/src/components/chat/` 压缩相关组件和消息列表
- `src/renderer/src/hooks/use-chat-actions.ts`
- `src/renderer/src/lib/agent/context-compression.ts`
- `src/renderer/src/stores/chat-store/index.ts`
- 本地参考项目 `D:\claw\OpenCowork`
- `docs/dev-workflow.md`、`AGENTS.md`、`docs/data-storage.md`、`docs/mvp-scope.md`、`docs/iteration-plan.md`

## 当前项目状态

- 分支：`dev/v2-iter-24`
- 本次探索开始时工作区存在 updater、设置页、本地化、`chat-store/index.ts`、`AgentLoop.cs` 等用户改动。
- 这些既有改动已经独立提交为 `54e7bba feat(updater): add desktop update flow and settings integration`，并已推送到 `origin/dev/v2-iter-24`。
- 当前工作区已恢复干净；本专项尚未修改压缩相关业务代码。
- `AgentLoop.cs` 中 `await ContextCompression.CompactAsync(...)` 已保证 Loop 等待压缩完成，本专项不重做后端等待控制。

## 已确认的现状问题

### 1. 压缩期间普通执行态没有被排除

`src/renderer/src/components/chat/MessageList/useMessageListData.ts:159-162` 当前通过 running、team running 和 streaming message 计算 `isAgentExecutionActive`，没有排除 live compression phase。结果是压缩期间仍可能把最后一条空 assistant 消息渲染成普通 thinking/loading。

`VirtualListContent.tsx:174-180` 又依据 `isAgentExecutionActive` 判断空 assistant 是否处于 loading，因此这里会直接产生“压缩提示 + 普通思考中”的并存。

### 2. 存在两条临时/状态展示路径

- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx:223-228` 在虚拟列表尾部追加 `LiveCompressionCard`，它显示流式摘要草稿。
- `src/renderer/src/components/chat/MessageItem.tsx:232-236` 对 transcript 中 `meta.compressionStatus` 消息渲染 `CompressionStatusMessage`。
- `src/renderer/src/hooks/use-chat-actions.ts:613-616` 的 `recordCompressionStatusMessage` 会写入/更新 synthetic system message，使压缩状态卡进入持久化 transcript。

自动路径和手动路径都会先记录 `compressing`，完成后又记录 `compressed`，因此当前会出现中文/英文或 live/status 重复展示，并且完成状态会常驻聊天记录。

### 3. 完成态被拆成边界卡和摘要卡

`MessageItem.tsx` 当前对 system message 依次处理：

- `compressionStatus` → `CompressionStatusMessage`
- `compactBoundary` → `CompactBoundaryMessage`

`ContextCompressionMessage` 当前是独立圆角摘要卡，位于 assistant 内容内联摘要路径中；`CompactBoundaryMessage` 另行显示静态边界。该组合不符合目标行为：完成后只保留一条分隔线，点击分隔线在原位置展开摘要详情。

### 4. `displayAnchor` 数据流没有闭环

- 类型和渲染读取已存在：`src/renderer/src/lib/api/types.ts`、`AssistantMessage/index.tsx`、`MessageList/useMessageListData.ts`、`StaticMessageTranscript.tsx`。
- `src/renderer/src/hooks/use-chat-actions.ts` 自动/手动路径当前直接调用 `applyCompactArtifactsToSession(sessionId, compactArtifacts)`，没有为摘要产物生成稳定锚点。
- `src/renderer/src/lib/ipc/sidecar-mapping.ts:82-84` 会剥离 `compactSummary.displayAnchor`，会破坏跨进程传递/恢复。
- 摘要应锚定被压缩区间后保留的 assistant message，并在历史 transcript、虚拟列表和 reload 后使用同一锚点。

### 5. 历史数据兼容需要在显示层处理

`docs/data-storage.md` 规定消息历史持久化在 SQLite 中，不能通过清理数据库解决旧数据。因此旧数据库中已有的 `compressionStatus` synthetic system message 必须在 transcript/renderable message 过滤层兼容隐藏；新的压缩流程不再将成功/进行中状态作为聊天消息常驻。

## OpenCowork 参考实现

完整参考文件：

`D:\claw\OpenCowork\src\renderer\src\components\chat\ContextCompressionMessage.tsx`

关键结构和样式必须一并迁移适配：

- `Scissors` 剪刀图标作为压缩分隔线标识。
- 两侧 `h-px flex-1` 渐变线，使用 `from-transparent/to-amber-500/40` 和反向渐变。
- 中央琥珀色圆角胶囊按钮：`border-amber-500/40 bg-amber-500/10 ... hover:bg-amber-500/20 dark:text-amber-300`。
- 分隔线文本支持摘要消息数量；按钮含 `aria-expanded`、`title` 和旋转的 `ChevronDown`。
- 摘要折叠态展示首个有意义行的预览，点击预览也可展开。
- 展开态在原分隔线位置渲染 Markdown，保留项目现有 Markdown remark/rehype 插件和 prose 样式。
- 摘要器失败时显示 `AlertTriangle` 和 fallback warning。
- 参考实现还提供 `MessageSquarePlus` “在新会话继续”入口；是否在本专项保留需以现有会话 store 能力和最小范围为准，不得引入额外持久化卡片。

参考锚点生成路径：

- `D:\claw\OpenCowork\src\renderer\src\hooks\use-chat-actions.ts` 中 `withLiveCompactSummaryDisplayAnchor(...)`
- 自动压缩完成事件附近调用 `adoptCompactionSummary(...)`
- 手动/自动产物都通过同一锚点适配后再写入会话

## 规划边界

### 本专项包含

- renderer 压缩期间的状态门控：压缩时隐藏普通 assistant thinking/loading。
- live compression 只保留一个本地化临时提示，并在完成/失败/跳过/取消后清理。
- 不再把 `compressing` 或成功 `compressed` 状态作为聊天 transcript 常驻消息。
- 显示层过滤旧 `compressionStatus` 消息，避免历史重复卡片。
- `ContextCompressionMessage` 完整对齐 OpenCowork 的分隔线结构、图标、渐变线、胶囊按钮、预览、Markdown 展开和失败提示样式。
- 自动/手动压缩产物生成并保留稳定 `displayAnchor`，reload 后位置一致。
- 移除/绕过独立 `CompactBoundaryMessage` + 摘要卡组合，统一从摘要锚点渲染完成态。
- 中英文 `agent` locale 键补齐并保持 fallback。

### 本专项不包含

- 不重做 `AgentLoop.cs` 已正确工作的压缩等待逻辑。
- 不改变压缩算法、快照 schema、SQLite 表结构或摘要内容协议。
- 不处理无关 updater、设置页、插件或 AgentLoop 用户改动。
- 不在未验证和未获用户确认前提交压缩实现或 push。

## 风险与依赖

1. `chat-store/index.ts` 在既有提交中曾被用户修改；实现阶段必须以提交后基线重新读取，并确保只做与压缩状态/产物相关的精确改动。
2. `use-chat-actions.ts` 同时覆盖自动和手动压缩，必须共用锚点适配，不能只修一条路径。
3. 虚拟列表与静态 transcript 使用不同渲染路径，必须分别验证锚点定位和旧状态过滤。
4. `sidecar-mapping.ts` 的 displayAnchor 剥离可能影响 sidecar 请求，但不能把仅用于显示的字段传给后端模型；需要在正确边界保留/恢复，而不是无条件传递。
5. 既有类型检查可能暴露前一批 updater 改动的预存问题；验证报告必须区分预存失败和本专项引入失败。
6. OpenCowork 参考组件包含“新会话继续”能力；若 Wishful Claw 当前 store API 不完整，计划只保留能闭环的视觉/展开行为，继续入口需单独核对后决定，不扩大范围。

## 探索结论

最小可行闭环是：统一 live compression phase 状态 → 从普通执行态和 transcript 渲染中排除 status synthetic message → 给自动/手动摘要产物补稳定 displayAnchor → 统一使用 OpenCowork 风格 `ContextCompressionMessage` 在锚点处渲染。后端压缩等待、压缩算法和数据库 schema 不需要重做。
