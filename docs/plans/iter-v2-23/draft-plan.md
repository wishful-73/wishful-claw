# v2-iter-23 临时计划（讨论稿）— 会话可靠性收口与正式版发布

> 状态：讨论中，未批准执行
>
> 创建日期：2026-08-27
>
> 基线：`main`，产品版本 `0.2.22`，最新 tag `v0.2.22`
>
> 本文只记录当前已确认结论、代码现状和待讨论事项。未完成范围确认前，不创建迭代分支、不修改产品代码、不执行发布。

## 一、暂定目标

围绕历史会话恢复、上下文压缩持久化和流式消息可靠性做正式版前收口；完成验证后，将 Wishful Claw 作为首个正式版 `v1.0.0` 发布。

暂定主线：

1. 统一手动压缩和自动压缩的上下文产物与持久化边界。
2. 历史会话恢复时优先恢复已持久化的压缩上下文；未发生过压缩的会话继续兼容当前全量恢复策略。
3. 前端历史分页与后端 Agent 上下文严格解耦。
4. 缩小工具执行完成后、消息最终落库前的崩溃丢失窗口。
5. 补齐正式版发布所需的集成验证、AOT、安装包和版本规则迁移。

## 二、已确认的产品与架构决策

### 2.1 前端历史消息分页

- 前端首次打开历史会话时默认展示最近 5 个完整轮次。
- 用户通过聊天顶部入口继续加载更早历史，每次加载 5 轮。
- UI 加载更多历史只改变聊天记录展示，不修改 Worker 中的 `SessionConversation`，也不重新构建 Agent 上下文。
- “最近 5 轮”只属于前端分页口径，不进入后端会话恢复算法。

### 2.2 摘要生成时机

- 普通对话结束后不额外生成会话摘要。
- 摘要只在上下文压缩时产生：
  - 用户手动点击压缩；
  - 达到配置阈值后自动压缩。
- 手动压缩和自动压缩应使用同一套核心压缩实现、相同的持久化结构和恢复语义。

### 2.3 后端历史会话恢复

- 如果会话从未发生过压缩，没有有效压缩快照：沿用当前做法，全量读取该会话的历史消息恢复 Agent 上下文。
- 如果存在有效压缩快照：恢复最近一次压缩后的完整上下文状态，并追加压缩完成后新增的全部消息。
- 后端不能只恢复“摘要正文”，因为当前压缩结果还包含 pinned prefix、保留的 user turns 和 recent tail。
- 用户在 UI 点击加载更早历史，不得改变上述后端恢复状态。

### 2.4 进行中轮次的用户消息吸附

- 本迭代加入“当前进行中轮次的用户消息吸附置顶”。
- 当 Agent 正在执行当前轮次，用户向下查看持续增长的 thinking、工具调用和回复内容时，本轮 user message 固定在聊天可视区域顶部，作为当前任务锚点。
- 吸附对象只限当前活跃轮次，不对普通历史消息逐条启用。
- 执行完成、取消或失败后解除运行态吸附；历史会话继续使用现有折叠展示，不需要常驻吸附。
- 该功能与历史分页解耦，不依赖滚动触顶加载，也不重新引入旧的自动 prepend 行为。

### 2.5 聊天窗右上角悬浮操作块

本迭代纳入聊天窗右上角悬浮操作块重构，作为当前会话操作入口。

- 操作区由横向布局改为竖向布局。
- 保留并接入“压缩会话”入口，触发用户手动压缩，并复用手动/自动压缩的统一持久化链路。
- 增加“打开右侧文件夹”入口，打开右侧面板并切换到当前工作区文件树。
- 增加聊天区域宽窄调节入口，解决当前聊天区与左右面板之间留白过大的问题。
- 移除原悬浮块中的“清除会话”操作；清除会话不再作为该悬浮块的功能。
- 操作入口的可用性应随当前会话、工作区和右侧面板状态正确变化；无工作区时不得伪造文件夹操作成功。

### 2.6 正式版版本

- v2-iter-23 验证通过并经用户确认完结后，产品版本升级为 `1.0.0`，Git tag 使用 `v1.0.0`。
- `v2-iter-23` 仍是迭代编号，不作为产品版本号。
- 发布动作必须在用户确认迭代完结后执行。

## 三、当前代码事实

### 3.1 前端历史加载

当前 `loadRecentSessionMessages` 默认通过按轮次查询加载最近 5 轮；聊天顶部已经存在加载更早消息的按钮。

现有缺口：

- 滚动到顶部仍会自动触发 `loadOlderMessages()`，与“只点击加载”目标不一致。
- 顶部按钮当前使用 `loadedRangeStart` 作为展示参数，但该值是定位范围/时间戳语义，不是稳定的“剩余轮数”。
- 前端加载最近消息后会调用 `agent/restore-session`；后续必须保证该调用只负责首次确保 Worker 会话恢复，加载更早 UI 历史不能重复改变 Worker 上下文。

关键文件：

- `src/renderer/src/stores/chat-store/session-slice.ts`
- `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts`
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx`

### 3.2 后端历史恢复

当前 `SessionRestoreTools.RestoreSession` 会从 SQLite 全量读取该会话的 `messages`：

```sql
SELECT * FROM messages
WHERE session_id = @sid
ORDER BY created_at ASC, sort_order ASC
```

随后转换为 wire messages，并在 `SessionConversation` 为空时执行 `Initialize()`。

当前行为可以兼容未压缩旧会话，但不会恢复 Worker 进程重启前的内存压缩状态。

关键文件：

- `src/runtime/WishfulClaw.Agent/SessionRestoreTools.cs`
- `src/runtime/WishfulClaw.Agent/SessionConversation.cs`

### 3.3 自动上下文压缩

当前自动压缩已具备：

- 根据上一轮 `inputTokens` 和模型 context length 判断阈值；
- `CompactionWatermark` 防止同一批消息在每轮循环反复压缩；
- LLM 总结失败时使用机械折叠/截断兜底；
- 压缩成功后调用 `SessionConversation.Replace()`；
- 向前端发送 `context_compression_start` / `context_compressed`；
- 前端已有压缩状态反馈，但当前完成事件主要携带压缩数量，聊天窗还没有完整展示可阅读的“上下文摘要”结果；
- 本迭代要求参考 OpenCowork 的“上下文摘要”模式：自动压缩和手动压缩都必须把压缩过程及最终摘要推送到聊天窗，形成可回看的摘要消息/摘要卡，而不只显示 Activity 或“已压缩”状态。

当前压缩结果结构不是简单的“摘要 + 固定轮数”，而是：

```text
pinned prefix
+ fold 区域中保留的 user turns
+ compaction summary
+ recent tail
```

关键文件：

- `src/runtime/WishfulClaw.Agent/AgentLoop.cs`
- `src/runtime/WishfulClaw.Agent/ContextCompression.cs`
- `src/renderer/src/stores/chat-store/index.ts`
- `src/renderer/src/components/chat/CompressionStatusMessage.tsx`
- `src/renderer/src/components/chat/ContextCompressionMessage.tsx`

### 3.4 手动压缩链路

前端已经存在手动压缩入口和 IPC 调用意图：

- InputArea 上下文环/工具栏入口；
- `useContextCompression` 状态反馈；
- `agent/compress-context` IPC 方法调用。

当前仍需在正式探索阶段确认：

- `agent/compress-context` 在当前 Worker 中是否有完整注册和实现；
- 前端 `context-compression.ts` 中遗留 stub 与 `agent-bridge-streaming.ts` 实际 bridge 的关系；
- 手动压缩结果是否会正确更新 `SessionConversation`、UI 历史和 SQLite；
- 手动压缩与自动压缩是否存在两套不同的数据模型。

本讨论稿不预设修复方案，待 Plan 23-1 探索后定案。

### 3.5 当前 sessions 数据模型

当前 `sessions` 表及 `SessionEntity` 没有压缩快照、压缩覆盖位置或压缩版本字段。

关键文件：

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/SessionEntity.cs`

### 3.6 工具结果持久化窗口

当前 `tool_call_result` 到达后会先更新前端 Zustand 中的 assistant message；SQLite 写入主要发生在 `message_end` 和 `loop_end`。

因此存在候选正确性问题：工具已经执行完成，但在下一次消息持久化边界前 Renderer/Worker 异常退出，数据库中的工具结果可能不完整。

此项暂定纳入 v2-iter-23，但需在正式探索阶段确认实际 DB 状态、重复执行风险和最小修改边界。

实现参考 OpenCowork 的工具结果可靠性设计：工具完成边界立即写入 durable journal/消息状态，恢复时执行未完成工具结果的 reconciliation，并保证重复事件、重试、后台任务和渠道会话都具备幂等行为。本迭代只参考行为和边界，不直接复制 OpenCowork 实现代码。

关键文件：

- `src/renderer/src/stores/chat-store/index.ts`
- `src/renderer/src/stores/chat-store/db-helpers.ts`
- `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`

## 四、暂定数据设计方向（未定案）

后端恢复需要持久化“压缩后的完整上下文状态”，不能只保存一段摘要文字。

候选方向 A：在 `sessions` 表保存快照字段：

- `compact_context`：AOT 安全序列化的完整压缩 wire conversation；
- `compact_summary`：供 UI、诊断和搜索使用的摘要正文；
- `compact_through_sort_order` 或等价稳定游标：标记快照已覆盖到哪条持久化消息；
- `compact_updated_at`：快照生成时间；
- `compact_version`：快照格式版本，用于未来兼容升级。

恢复算法候选：

```text
读取会话
  ├─ 无有效 compact_context
  │    └─ 全量读取 messages，沿用当前恢复逻辑
  └─ 有有效 compact_context
       ├─ 反序列化压缩上下文快照
       ├─ 查询压缩游标之后新增的全部消息
       ├─ 快照 + 增量消息
       └─ 初始化 SessionConversation
```

待讨论/验证：

1. 快照放在 `sessions` 表，还是建立独立 `session_compactions` 表保留多次压缩历史？
2. 游标使用 `sort_order`、`created_at + sort_order`，还是消息 ID/独立单调序列？
3. 压缩快照是否需要保留多版本以支持审计/回滚，还是只保存最新有效快照？
4. 机械截断兜底是否也持久化为快照；若无真实摘要，UI 应如何标识降级状态？
5. 快照持久化失败时，是保留内存压缩继续运行并记录错误，还是回滚本次 `SessionConversation.Replace()`？
6. 消息删除、会话重试、fork、清空会话后，压缩快照如何失效或重建？

## 五、暂定功能单元与 Plan 拆分

> 以下只是讨论顺序，不代表最终范围或执行步骤已经批准。

### Plan 23-1：压缩与恢复链路探索、数据契约定案

目标：在修改代码前完成手动/自动压缩、消息持久化、会话恢复的全链路证据梳理，并确定快照模型。

暂定内容：

- 跟踪 `agent/compress-context` 的完整注册与调用链；
- 对比手动压缩和自动压缩产物；
- 明确压缩摘要/边界卡片当前如何进入前端和 SQLite；
- 明确压缩快照的 AOT JSON 结构；
- 确定快照游标、失效规则、错误处理和兼容策略；
- 输出 exploration findings 和正式 Plan 细化稿。

独立验证：只读探索、架构审查和数据迁移设计评审，不修改产品行为。

### Plan 23-2：压缩快照数据层与旧库迁移

目标：建立压缩上下文持久化能力，并保证 `0.2.22` 及更早数据库无损升级。

暂定内容：

- 新增快照字段或独立表；
- Entity/Row/Mapper/CRUD；
- AOT JsonContext 类型注册；
- 旧库 `EnsureColumn` 或表迁移；
- 新库 DDL、旧库迁移、CRUD、损坏快照降级回归测试。

### Plan 23-3：统一手动/自动压缩并持久化快照

目标：两种触发方式生成相同格式的压缩结果，并在成功后形成可恢复快照。

暂定内容：

- 收口手动压缩 bridge 和 Worker 端点；
- 复用 `ContextCompression.CompactAsync` 或抽取共享服务；
- 自动压缩成功后持久化快照；
- 手动压缩成功后同步 Worker 会话、UI 与 SQLite；
- 压缩 skipped/blocked/failed/cancelled 状态闭环；
- 自动压缩和手动压缩都向聊天窗推送可见的压缩事件；
- 参考 OpenCowork 的“上下文摘要”模式，在完成事件中携带或关联可展示的摘要正文、压缩范围/数量、保留信息和降级状态；
- 聊天窗显示“正在压缩上下文”过程状态，以及完成后的“上下文摘要”卡片；摘要可展开查看，不依赖右侧 Activity 面板；
- 摘要卡与压缩快照、SQLite 持久化结果保持同一份语义，历史会话重载后仍可查看；
- 降级摘要和持久化失败策略按 Plan 23-1 决策执行。

### Plan 23-4：历史会话恢复、前端分页解耦与当前轮吸附

目标：后端使用快照/全量兼容策略恢复；前端分页只负责展示；进行中的当前轮次始终有清晰的用户任务锚点。

暂定内容：

- 有快照：快照 + 压缩后增量消息恢复；
- 无快照：全量消息恢复；
- 损坏或版本不支持的快照：记录错误并回退全量恢复；
- 前端默认最近 5 轮；
- 移除滚动触顶自动加载，改为顶部点击加载；
- 展示总轮数/已加载轮数；
- 加载更早消息不得触发 Worker 上下文重建；
- Agent 执行当前轮次时，本轮 user message 在聊天可视区域顶部吸附；
- 执行结束、取消、失败或切换会话后解除吸附；
- 历史会话和已完成轮次继续使用现有折叠展示，不启用常驻吸附。

### Plan 23-5：聊天窗右上角悬浮操作块重构

目标：把当前会话相关操作集中到紧凑、清晰的右上角悬浮操作块中，减少聊天区域两侧的无效留白，并与压缩会话链路、右侧工作区面板联动。

暂定内容：

- 将现有横向操作布局改为竖向布局；
- 移除原有“清除会话”入口，不在新的悬浮块中保留该操作；
- 增加“压缩会话”入口，触发用户手动压缩，并接入统一的压缩状态反馈和持久化链路；
- 增加“打开右侧文件夹”入口，打开右侧面板并切换到当前工作区文件树；
- 增加聊天区域宽窄调节入口，支持调整聊天内容区宽度，解决当前左右两侧空间过大的问题；
- 无工作区、无文件树或右侧面板不可用时，入口显示正确的禁用/提示状态，不产生无效操作；
- 操作块状态随会话切换、工作区切换、右侧面板状态和压缩进行状态同步。

独立验收：在普通聊天、项目聊天、压缩进行中、无工作区和右侧面板已打开等场景下，确认入口布局、可用状态、操作反馈和状态恢复正确。

### Plan 23-6：工具结果即时持久化与崩溃恢复

目标：工具执行完成后立即形成可恢复的消息状态，减少静默重复执行风险。

参考 OpenCowork 的工具结果可靠性边界：Renderer 在每个工具完成边界立即持久化 assistant row/tool_result；Native Worker 同时维护按工具写入的 durable journal，用于进程异常后的结果查询与 reconciliation。Wishful Claw 根据现有 7 层架构选择最小可行实现，只借鉴行为和恢复语义，不直接复制代码或引入不必要的双重数据源。

暂定内容：

- `tool_call_result` 边界立即 upsert 当前 assistant message；
- 评估是否需要 Worker 侧独立工具结果 journal，或由现有 messages 持久化配合事件幂等即可满足恢复要求；
- `message_end` / `loop_end` 保留最终 flush；
- 以 `sessionId/runId/toolUseId` 或等价稳定键保证重复事件和重试幂等；
- 恢复时识别“已有 tool_use 但消息中缺失 tool_result”的尾部状态，并与已持久化结果做 reconciliation；
- 覆盖前台聊天、后台 Agent/Cron、渠道会话、成功、错误、取消、多工具并发和进程异常场景；
- 明确 journal/中间结果的保留和清理策略，避免数据库无限增长；
- 验证恢复后工具结果不丢失、不被静默重新执行。

### Plan 23-7：正式版发布验证与 v1.0.0

目标：完成正式版前验证；只有用户确认迭代完结后才执行合并、tag、Release。

暂定验证：

- TypeScript 三配置 0 错误；
- C# solution 0 warning / 0 error；
- Native AOT 0 警告；
- 压缩/恢复/DB 迁移回归测试；
- 工具结果持久化回归；
- v2-iter-22 遗留的真实 Electron Main/Renderer 进程级 harness；
- 隔离数据目录 Electron 冒烟；
- 旧库升级和新库启动；
- Windows NSIS 安装、覆盖升级、卸载/重装、托盘、图标、Worker 启动验证。

用户确认完结后的发布动作：

- 更新 `package.json` 为 `1.0.0`；
- 同步 README 版本徽章；
- 修改 AGENTS.md 和相关文档中的“正式版前 0.2.N”规则；
- 合并 `dev/v2-iter-23` 到 main；
- 创建 tag `v1.0.0`；
- 推送 main/tag；
- 创建 GitHub Release；
- 上传 `wishful-claw-1.0.0-setup.exe`；
- 核验 main、tag、Release 和安装包。

## 六、暂定验收标准

### 压缩与恢复

- 未压缩旧会话重启后仍按当前全量历史恢复，行为不回归。
- 手动压缩成功后重启应用，Agent 恢复的上下文与压缩完成时语义一致。
- 自动压缩成功后重启应用，同样可恢复。
- 手动压缩和自动压缩均在聊天窗显示压缩进行状态；完成后显示可展开的“上下文摘要”内容，而不是只有数量或成功提示。
- 上下文摘要消息与压缩快照使用同一份摘要语义，重启并重新加载历史后仍可查看。
- 压缩后继续多轮对话再重启，压缩完成后新增消息全部保留。
- UI 点击加载更早历史不会改变 Agent 上下文或破坏 prefix cache。
- 损坏/不支持的快照不会阻断会话打开，能安全回退全量恢复并写错误日志。

### 消息可靠性

- 工具结果完成后即使在 `loop_end` 前异常退出，重启后仍可查看已完成工具结果。
- 不因持久化重放导致工具重复执行。
- 多工具并发完成时消息元数据完整、顺序稳定。
- 工具完成边界的持久化不依赖等待 30 秒检查点或整个 Agent run 结束。
- 如果采用 Worker 侧 durable journal，异常恢复后能按 `sessionId/runId/toolUseId` 或等价稳定键完成结果 reconciliation，并在确认消息落库后清理中间记录。
- 前台、后台 Cron 和渠道会话的工具结果持久化行为一致。

### 前端历史展示与当前轮锚点

- 首次只显示最近 5 轮。
- 不再因滚动触顶自动加载。
- 点击一次加载更早 5 轮，可连续点击直到全部加载。
- 页面能显示总轮数和当前已加载范围。
- Agent 执行期间，本轮 user message 吸附在聊天可视区域顶部，持续增长的执行过程在其下方滚动。
- 执行完成、取消、失败或切换会话后吸附正确解除，不影响历史折叠展示。

### 正式版

- 开发构建、AOT、安装包、旧库升级和核心 Agent 流程全部通过。
- 用户完成最终人工验收并明确确认迭代完结。
- GitHub main、`v1.0.0` tag、Release 和 Windows 安装包均到位。

## 七、当前明确不纳入的范围

除非后续讨论明确追加，否则不纳入 v2-iter-23：

- 人格混血；
- Agent 自动写日记；
- 快速启动器插件化、URL 插件、DeepSeek 网页版；
- 虚拟列表 prepend 一帧闪烁的大规模重构：历史加载改为用户点击后，该旧问题不再作为专项需求处理；
- 新的记忆系统架构；
- Goal 编排功能扩展；
- 每轮对话结束后自动调用模型生成摘要；
- 前端分页轮数配置化；
- 与会话可靠性和正式发布无关的相邻重构。

## 八、待继续讨论清单

1. 压缩快照存储：`sessions` 单行字段还是独立 `session_compactions` 表？
2. 是否只保留最新快照，还是保留多次压缩历史？
3. 快照游标的稳定定义与消息增量查询方式。
4. 自动压缩产生机械截断时，是否视为有效可恢复快照？
5. 快照 DB 写入失败时，内存压缩继续还是回滚？
6. 用户删除/重试/fork/清空消息时，快照失效规则。
7. 手动压缩当前真实链路和 `agent/compress-context` 后端实现情况。
8. “上下文摘要”采用完整摘要正文随事件传输，还是事件携带摘要消息/快照引用后由聊天窗读取；需要保持 AOT、流式协议和历史恢复一致。
9. 工具结果即时落库应由 Renderer 执行，还是 Worker/DB 在工具边界直接记录？
10. v1.0.0 发布前是否需要 RC 阶段或一段时间的安装版人工使用观察？
11. 正式版 Release notes 的定位：自用首个稳定版，还是面向公开用户的产品发布？

## 九、当前状态

- 已完成：知识库、原始迭代规划、v2-iter-22 状态、历史加载、会话恢复、自动压缩和工具结果落库位置的初步核对。
- 已确认：前端最近 5 轮仅用于展示；后端有快照则按快照恢复，无快照则兼容全量恢复；摘要只在手动/自动压缩时产生；正式版目标为 `v1.0.0`。
- 未确认：快照数据模型、手动压缩真实闭环、错误回滚策略、工具结果持久化责任层、最终 Plan 边界。
- 已执行：创建本地迭代分支 `dev/v2-iter-23`，提交探索与规划文档；规划合规审查 PASS，用户已确认继续推进。
- 已执行：Plan 23-1 步骤 1 已接通 `agent/compress-context` Worker 端点，开放共享消息解析并清理前端重复 stub；步骤 2 已完成压缩摘要/状态卡/快照单一数据契约；步骤 3 已完成快照存储、游标、版本、失效和失败回退策略；C#/TS Mini 验证通过。
- 已执行：Plan 23-2 步骤 4/5/6 已完成：压缩快照数据层、游标增量查询与安全回退、252 断言回归测试全过。
- 已执行：Plan 23-3 步骤 7 已完成：手动压缩端点支持会话内存压缩与 blocked/cancelled/skipped/failed 明确状态，前端 `compressSessionContext` 接入 ContextRing；C#/TS 编译验证通过。
- 已执行：Plan 23-3 步骤 8 已完成：`CompactAsync` 返回结构化 `CompactionOutcome`，新增 `BuildCompactArtifacts` 统一边界/摘要聊天产物，自动与手动路径消费同一产物并携带 Trigger/SummarizerFailed/MessagesSummarized/CompactArtifacts；C#/TS 编译验证通过。
- 已执行：Plan 23-3 步骤 9 已完成：`context_compressed` 事件与手动压缩响应接入聊天窗——状态卡（触发/降级）+ 边界分隔线 + 可展开摘要卡，产物合入转写并按 (created_at, sort_order) 重定位时间戳后落库，重载历史仍可查看；TS 三配置 0 错误。
- 已执行：Plan 23-3 步骤 10 已完成：`UpsertSnapshot` 共享写入器 + `ContextCompression.PersistSnapshot`，自动（仅主会话）与手动（仅权威会话）压缩在 Replace 后落持久化快照，失败记日志保留旧快照；C#/TS 编译验证通过。Plan 23-3 全部完成。
- 已执行：Plan 23-4 步骤 11 已完成：`RestoreSession` 改为快照/全量兼容恢复（`TryGetValidSnapshot` 共享校验读取 + 游标后增量去重/跳过聊天产物 + 恢复后打水印），问题均回退全量；252 断言快照回归测试全过；C#/TS 编译验证通过。
- 已执行：Plan 23-4 步骤 12 已完成：历史加载改为点击触发（移除滚动触顶自动加载），`db/messages-list-by-turns` 返回总轮数，顶部按钮下方显示“已加载 X/Y 轮 · M/N 条消息”；C#/TS 编译验证通过。
- 已执行：Plan 23-4 步骤 13 已完成：进行中当前轮 user message 吸附——执行中取最后一条普通 user 消息作为锚点，滚出可视区顶部时显示顶部吸附卡（点击可跳回并高亮），执行结束/切换会话自动解除，历史折叠会话不启用；TS 三配置 0 错误 + C# 0 警告 0 错误。Plan 23-4 全部完成。
- 已执行：Plan 23-5 步骤 14 已完成：`SessionConversationPane` 右上角操作块改为悬浮竖向布局（不占聊天区高度，z-30 盖在 assistant rail 之上），移除其中两处清除会话入口（能力保留在侧边栏与输入区菜单）；TS 三配置 0 错误。
- 已执行：Plan 23-5 步骤 15 已完成：悬浮块接入“压缩会话”——复用 `useContextCompression` 统一反馈与 `compressSessionContext` 统一链路，压缩中防重复点击，状态文案走 tooltip；新增 layout.json 压缩相关 i18n；TS 三配置 0 错误。
- 已执行：Plan 23-5 步骤 16 已完成：悬浮块接入“打开右侧文件夹”——调用 `ensureFilesTab` 打开右侧面板并激活 Files tab，无工作目录时禁用并提示，不伪造成功；TS 三配置 0 错误。
- 已执行：Plan 23-5 步骤 17 已完成：悬浮块接入聊天区域宽窄调节——`conversationPanelFullWidth` 持久化到 settings-store（version 33 + 迁移守卫，刷新/重启恢复），悬浮块宽窄切换按钮同步驱动 MessageList 与 Composer 列宽（820px ↔ 全宽），右侧面板开关时弹性列自动重适配；同时清理 ui-store 中同名冗余死字段；TS 三配置 0 错误。Plan 23-5 全部完成。
- 已执行：Plan 23-6 步骤 18 已完成：`tool_call_result` 工具完成边界立即形成可恢复状态——Renderer 在内存更新后立即复用既有 `dbUpsertMessage` 落库，不等 `message_end`/`loop_end`；五种结果状态（成功/错误/取消/审批拒绝/跳过）全经 `tool_call_result` 事件统一覆盖；稳定键为消息 id（runId），既有 upsert 幂等，并发工具后写携带先写结果超集不互相覆盖；定案采用最小 messages upsert 方案，暂不引入 Worker 独立 durable journal。TS 三配置 0 错误。
- 已执行：Plan 23-6 步骤 19 已完成：最小方案定案为 messages upsert（不引入 Worker 独立 journal）；`dbUpsertMessage` 增加按消息 id 的串行写入队列，工具边界/`message_end`/`loop_end` 写入严格按发起顺序提交，旧快照不会回退新结果，单次失败隔离；稳定键覆盖 session/run（runId 主键）/tool（toolCallId 内嵌消息体），重复事件与重试只 UPDATE 同一行。TS 三配置 0 错误。
- 已执行：Plan 23-6 步骤 20 已完成：恢复 reconciliation——`SessionRestoreTools` 两条恢复路径在实体转 wire 时，从 assistant 行 `meta.toolCalls` 原位找回已完成结果（合成独立 user `tool_result` wire 消息，与 live 路径同构），中断未完成调用补 `[INTERRUPTED]` 占位结果，保证每个 `tool_use` 必配 `tool_result`、恢复对话对 Provider API 合法；合成只在内存进行，不回写 DB、不重放工具；旧格式 user 结果行预扫去重；无 journal 故无中间记录增长问题。纯 C# 改动，C# solution 0 警告 0 错误。
- 已执行：Plan 23-6 步骤 21 已完成：三路径覆盖审计——前台、Cron in-session、渠道均汇入 `sendMessage` → chat-store 事件链，步骤 18/19 持久化边界天然全覆盖；Cron 静默 sidecar 模式按设计仅存投递摘要与 `cron_runs` 记录。修复发现的缺口：渠道重启后注入的会话未触发历史加载/`agent/restore-session`，发送前补 `await` 加载+恢复（参照 `runInSession`，restore 幂等零开销）；异常退出结论：崩溃重开结果可见（工具边界已落库 + 恢复占位补齐）、恢复只读不重放、cron 中断 run 孤儿归一化不自动重跑。TS 三配置 0 错误。Plan 23-6 全部完成。
- 已执行：Plan 23-8 追加计划已制定（来源：issues 库 2026-08-27 新增）：步骤 26 项目档案路径斜杠混用、步骤 27 输入草稿持久化实装、步骤 28 新建服务商弹窗改造、步骤 29 模型图标选择器引入真实图标、步骤 30 文件树 tab 彩色图标与中文标题、步骤 31 左侧面板对话命名/扩展/自动化图标；在 Plan 23-7 全量回归前实施。不纳入：桌面图标白角（待用户清缓存确认）、Goal 编排可视化、滚动锚点吸附。
- 已执行：Plan 23-8 步骤 26 已完成：`project-archive-helpers.ts` 的 `joinFsPath` 改为平台感知拼接（分隔符优先跟随 base 路径，无则按 win32 取 `\`），项目档案页记忆/人格/日常路径展示与读写同一拼接结果，无其他直接拼接点；TS 三配置 0 错误。
- 已执行：Plan 23-8 步骤 27 已完成：`input-draft:*` 五端点实装（草稿存 `~/.wishful-claw/input-drafts.json` 单文件 JSON map，兼容隔离数据目录，空内容转删除 + 30 天过期清理）；`useInputDraftPersistence` 实装（缓存优先读盘、请求序号防竞态、空草稿转 remove），既有防抖保存/水合/发送后清除链路直接生效；TS 三配置 0 错误。
- 已执行：Plan 23-8 步骤 28 已完成：新建服务商弹窗新增 API Key 输入（随服务商落库）+ 保存即拉模型列表（失败仅 toast）；`ProviderConfigPanel` 移除连接测试下拉框整行，改为模型行 hover “检查连接”图标按钮（复用 `testConnection`）；清理废弃状态与 i18n 键，zh/en 补齐新键；TS 三配置 0 错误。
- 已执行：Plan 23-8 步骤 29 已完成：`ModelFormDialog` 图标选择器改用 `ModelIcon` 真实系列图标（23 个 key 在 `modelIconSlugMap` 全覆盖，无需新增资源），选择交互不变，模型列表/消息头自动生效；TS 三配置 0 错误。
- 已执行：Plan 23-8 步骤 30 已完成：`RightPanel` tabs useMemo 补 files i18n 分支 + zh/en layout.json 新增 `rightPanel.files`（“文件”/“Files”）；`RightPanelHeader` files tab 图标与“打开文件”下拉项、左侧面板项目行图标统一上 `text-sky-400`（对齐 OpenCowork）；切换/折叠逻辑未动；TS 三配置 0 错误。
- 已执行：Plan 23-8 步骤 31 已完成：全局对话分区头部加 `MessageSquare` 图标与计数（对齐 OpenCowork），zh `sidebar.conversations` “会话”→“对话”；扩展入口 `FolderOpen`→`Plug`、自动化 `CalendarDays`→`Clock3`（均对齐 OpenCowork）；导航链路未动；TS 三配置 0 错误。Plan 23-8 全部完成。
- 已执行：Plan 23-8 步骤 26-31 代码审查完成（审查子代理 + 逐项核实）：发现并修复 1 中 3 低问题——草稿生命周期缺口（启动清扫 + 删会话清草稿）、草稿写盘改原子替换、`hasInputDraftContent` 纳入 `selectedFiles`、`bigmodel` 图标映射补齐；步骤 26/28/30/31 审查通过，无新增安全风险。TS 三配置 0 错误。
- 未执行：用户人工核验步骤 26-31、Plan 23-7（全量验证与 v1.0.0 发布，需用户确认）、后续 push、merge、tag、打包、Release。
