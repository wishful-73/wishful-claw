# S-231 阶段一：探索发现（2026-10-26，主 agent 实读）

## 1. 注入点：只有两处「改写已有 user 消息」

| # | 位置 | 时机 | 动作 |
|---|---|---|---|
| 1 | `AgentLoop.cs:259` → `AgentLoop.Helpers.cs:304-367` | 每轮一次，在 iteration 循环之前 | 拼 `PendingMemoryRecall` + `<memory-update>` + `<current_time>`，`:353` **前置**到 `msg.Text` |
| 2 | `AgentLoop.cs:357-360` → `AgentLoop.MemoryRecall.cs:112-116` | `iteration == 1` | `Text = recallBlock + Text`，**再前置一层** |

## 2. 另外四个注入器与本需求无关

`InjectSessionTodo`（`AgentLoop.SessionTodo.cs:97`）、`InjectSubAgentTurnReminder`、`InjectEmptyTurnNudge`、
`InjectSandboxTransition`（调用汇聚在 `AgentLoop.cs:684-694`）走的都是**追加一条临时 user 消息 + 临时副本**，
原 conversation 一字不动（各自注释里写明了理由：改写历史会废掉前缀缓存）。
⇒ 它们不会污染「首条 user 消息」，本需求**不碰**。

## 3. 剥块实现完全位置无关

`AgentLoop.MemoryRecall.cs:177-210`：`StripInjectedBlocks` 逐 tag 调 `RemoveInjectedBlock`，
后者 `IndexOf` 找 `<tag>` / `</tag>`、`while` 循环剥到没有为止，未闭合块剥到文末。
**不读写任何位置假设**，块在头在尾都能剥干净。

## 4. 现有测试不会红，但缺尾部形状的断言

`tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs:266-283` 共 **10** 条断言
（`:272-279` 八条 + `:281-283` 两条：时间戳不进查询、关键词保留），覆盖「内存块 + 用户文本 ⇒ 剥回文本」
「纯文本透传」「无关标签保留」「纯块剥空」「未闭合块」等形状，测的全部是 `StripInjectedBlocks`
**函数本身**，不测注入方向。
⇒ 改后置不会让它们失败；但反过来也没锁住「块在尾部」这条路，**要补断言**（计划步骤 3）。
另：`StripInjectedBlocks` 内含 `Trim()`（`MemoryRecall.cs:190`），前导/尾随空行它一律看不出来，
所以空行必须靠组合层断言（直调 `InjectTransientPrefix`）锁住。

## 5. 落库：注入块不进 DB

- `SessionConversation.Initialize/Append` 同时持有 `_conversation` 与 `_wireConversation` 两份
- `GetConversation()`（`SessionConversation.cs:425-431`）返回**活引用**，`InjectTransientPrefix`
  直接改这份内存列表；`GetWireConversation()` 那份不动
- DB 的 `messages.content` 由渲染端按自己发出的 wire 消息写入 ⇒ **不含注入块**

推论（订正）：落库内容从来不含注入块 ⇒ **不存在「已落库的前置形状」**。前置形状只活在
**旧进程内存**里，进程重启即消失。同一进程内新老轮次可能形状不一，但注入只作用于「最后一条 user
消息」，历史轮次的内存形状不会被二次改写。
⇒ 「不迁移」结论不变，且**无需任何数据动作**，阶段六不必去库里抽查旧行。

## 6. 三个出站写入器都不改文本

| 写入器 | user 分支 | 是否改写 |
|---|---|---|
| `OpenAIChatRequestBuilder.cs:107-163`（openai-chat） | `:159` 直接写 `message.Text` | 否 |
| `AnthropicMessagesInputWriter.cs:125-129` | 原样写，注释明说写时不再注入 | 否 |
| `OpenAIResponsesInputWriter.cs:115-122` | `:115` `HasImageContent` 优先走 multimodal，`:119-122` 文本分支整段写 `message.Text` | 否（已确认） |

## 7. 压缩链路读的是「用户原话」而非位置

`ContextCompression.UserSnapshot.cs:61`：`message.OriginalText ?? StripInjectedBlocks(message.Text)`
⇒ 优先干净原文，兜底剥块，两条都与位置无关。

## 8. 渲染端无剥块、无位置依赖

`src/renderer` 全树 grep `current_time` **0 命中**，历史从未显示过标签，也无按位置处理的代码。

## 9. 已知风险点

| 风险 | 证据 | 处置 |
|---|---|---|
| 纯图片消息 `Text` 为空 | `HasImageContent` 命中即只写 content blocks，整段 `Text` 丢弃（`OpenAIChatRequestBuilder.cs:152-159` / `OpenAIResponsesInputWriter.cs:115-122`） | 拼接判空锁的是**内存 `Text` 不变量**（`OriginalText` / 压缩快照会读它）；出站该路径不含 text 片段 |
| 模型对尾部位次的时间感知 | 无先例 | 阶段六真机问「现在几点」×2 条 provider 路 |
| 历史遗留前置形状 | §5：注入块**从不入库** | 无存量，不迁移，无需数据动作 |
