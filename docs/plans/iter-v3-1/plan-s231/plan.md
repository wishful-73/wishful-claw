# Plan: S-231 运行时附加块由前置改为后置

## 目标

一句话：把 `<current_time>` / `<memory-update>` / `<memory-recall>` 从用户消息**头部**挪到**尾部**，
让「取首条 user 消息做标题」的第三方服务端（WorkBuddy 国内版 / 国际版）截到的是用户原话。

## 前置约束

- **不碰** `system-prompt.ts` / `memory-context-builder.ts`（人格注入，老大 2026-10-26 14:42 裁定不动）
- **不碰**四个「追加临时 user 消息」的注入器（`InjectSessionTodo` / `InjectSubAgentTurnReminder` /
  `InjectEmptyTurnNudge` / `InjectSandboxTransition`）—— 它们不改写已有消息，见 `exploration_findings.md` §2
- **不迁移**存量消息（依据见「存量形状的准确口径」一节）
- 只改拼接方向，块内容 / 标签名 / 注入时机一律不动
- 纯图片消息（`Text` 为空、只有 `ContentBlocks`）是**真实存在**的路径，但出站写入器**优先判图片**：
  `OpenAIChatRequestBuilder.cs:152-159` 与 `OpenAIResponsesInputWriter.cs:115-122` 都是
  `HasImageContent` 命中即只写 content blocks，**整段 `Text`（含注入块）被丢弃**；
  文本分支在其后的 `IsNullOrWhiteSpace(Text)` 判断里。
  ⇒ 「空 Text 不加前导分隔」锁的是**内存 `Text` 的不变量**（`OriginalText`、压缩快照、后续轮次都会读它），
  不是出站首字符——出站层该路径恒不含 text 片段。

## 存量形状的准确口径

`AgentLoop.cs:130-131` 同时持有两个引用：`GetConversation()`（活引用，注入改这份）与
`GetWireConversation()`（入库来源，注入**不**改这份）。⇒ **注入块从不入 DB**：

- 历史上落库的 `messages.content` 从来就不含 `<current_time>` / `<memory-*>`，不存在「已落库的前置形状」
- 前置形状只活在**旧进程内存**里，进程重启即消失
- ⇒ 「不迁移」是结论正确、且**无需任何数据动作**；阶段六不必去库里抽查旧行

本口径同步回填 `requirements/S-231.md §4.4` 与 `exploration_findings.md §5`。

## 分隔符规则（统一口径，抽成一个 helper）

三个块自身都自带结尾空行（`MemoryRecall.cs:106` 的 `"</memory-recall>\n\n"`、
`Helpers.cs:340` 的 `AppendLine()`、`Helpers.cs:349` 的 `"</current_time>\n\n"`）。
前置时这层空行无害；**后置后会在消息末尾留白行**，且可能与用户原话之间出现双空行。

两处拼接点（`Helpers.cs:353`、`MemoryRecall.cs:116`）**共用一个 internal helper**，放在
`AgentLoop.Helpers.cs`（两文件同为 `partial class AgentLoop`）：

```csharp
/// <summary>
/// 把运行时块追加到用户原话尾部。原话为空/空白时只留块，不产生前导换行；
/// 块自身尾随空行会被裁掉，原话的尾部空白一律保留。
/// S-231：块必须在尾部 —— 第三方服务端（WorkBuddy）取首条 user 消息做会话标题。
/// </summary>
internal static string AppendTransientBlock(string? text, string block)
{
    var blocks = block.TrimEnd();                       // 只裁块，不裁用户原话
    return string.IsNullOrWhiteSpace(text) ? blocks : text + "\n\n" + blocks;
}
```

- 判空用 **`IsNullOrWhiteSpace`**，不用 `IsNullOrEmpty`（纯空格原话同样不能产生前导换行）
- **不裁**原话的尾部空白（那是用户输入的一部分）
- 尾块之间（recall 与 memory-update）：recall 自带 `\n\n`，天然分隔；`memory-update` 段自带
  `AppendLine()` 收尾，天然分隔。**不额外插入分隔符**
- **抽 helper 的理由不只是复用**：`TryInjectMemoryRecallAsync` 是 `private`（`MemoryRecall.cs:20`），
  测试工程调不到它 ⇒ 若不抽出来，「把 `MemoryRecall.cs:116` 改回前置」这件事**任何测试都抓不到**。
  抽出后测试直调 helper 锁形状，两处调用点只能传参、不能改方向

## 步骤清单

- [ ] **步骤 1：新增 `AppendTransientBlock` helper + `InjectTransientPrefix` 改为后置**
  - 文件：`src/runtime/WishfulClaw.Agent/AgentLoop.Helpers.cs:304-367`（+ helper 紧随其后）
  - 改动 A：按上节「分隔符规则」新增 `internal static string AppendTransientBlock(string? text, string block)`
  - 改动 B：`Text = parts.ToString() + msg.Text`（`:353`）→ `Text = AppendTransientBlock(msg.Text, parts.ToString())`
  - 注释订正（同一步内）：`:313-316` 的 `Contains` 守卫理由改为「块在尾部，`Contains` 判断与位置无关，
    换 `StartsWith` 会漏检」
  - 验证检查点：`dotnet build src\runtime\WishfulClaw.sln` 零 CS 错误；重读改后 8 行确认
    ①helper 内无 `"\n\n" + blocks` 的空原话分支 ②`TrimEnd()` 只作用于 `block` ③`OriginalText` /
    `SentAt` 赋值未动

- [ ] **步骤 2：召回块改为追加**
  - 文件：`src/runtime/WishfulClaw.Agent/AgentLoop.MemoryRecall.cs:109-120`
  - 改动：`Text = recallBlock + conversation[i].Text`（`:116`）→
    `Text = AppendTransientBlock(conversation[i].Text, recallBlock)`（步骤 1 的 helper，两处共用一个实现）
  - 注释订正：`:109-110`「BEFORE the `<current_time>` block」→「AFTER，追加在消息尾部」
  - 执行序：`InjectTransientPrefix`（`AgentLoop.cs:259`）先跑、recall（`AgentLoop.cs:357-360`，
    `iteration == 1`）后跑 ⇒ 最终形状 = `原话 + current_time 块 + recall 块`。两者都在尾部，符合目标
  - **前提（必须成立，实施时确认）**：`InjectTransientPrefix` 拼装时 `state.PendingMemoryRecall`
    **必为 null**（`MemoryRecall.cs:107` 只在 iteration 1 之后赋值，`AgentLoop.cs:450` 每个 provider turn
    结束后清空）⇒ `Helpers.cs:323-326` 的「recall 排最前」分支在本轮天然空转，不会出现
    「`原话 + recall(旧) + update + current_time`」这种块序。若发现续跑路径会让它非空，先置 null 再拼
  - 验证检查点：编译零 CS 错误；确认 `iteration == 1` 守卫与 `state.PendingMemoryRecall` 赋值均未动

- [ ] **步骤 3：测试断言（五层，含真实请求体与两轮字节对比）**
  - 文件：`tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs`
    （`WishfulClaw.Agent.csproj:25` 已有 `InternalsVisibleTo`，internal 成员可直接调）
  - **3a 组合层（锁注入结果，能检出前导 `\n\n` 与尾部留白）**：直调 `InjectTransientPrefix(conv, state)`，
    `state` 用 `new AgentRuntimeRunState(runId, sessionId)` 构造（`AgentRuntimeRunState.cs:21-26` 仅赋值
    三个字段，无 timer / 无 DB / 无 I/O；**用 `using var`**，类实现 `IDisposable`；
    `MemoryUpdateQueue.Drain("")` 对空白 id 直接返回空表，无副作用）。断言：
    - `Text` **以用户原话开头**（`StartsWith(userText)`）——拦前置回退
    - `Text` **不以 `\n` 开头** ——拦空原话分支漏判
    - `Text` **不以 `\n` 结尾** ——拦 `TrimEnd()` 漏写
    - `Text` **恰含一个分隔空行**：`Contains(userText + "\n\n<current_time>")` ——拦双空行
    - `OriginalText == userText`、`SentAt != null`
  - **3a-2 helper 单元（直调 `AppendTransientBlock`，锁住两处共用实现的方向）**：
    `AppendTransientBlock("原话", block)` ⇒ `"原话\n\n" + block.TrimEnd()`；
    `AppendTransientBlock("", block)` / `AppendTransientBlock("   ", block)` ⇒ 等于 `block.TrimEnd()`；
    `AppendTransientBlock("原话  ", block)` ⇒ **保留**原话尾部两个空格。这组断言让
    「helper 被改成前置」立刻变红 —— 调用点本身（private 方法内）测不到，靠 helper 形状兜住
  - **3b 空/空白原话不变量**：`Text = ""` 与 `Text = "   "` 各一次 ⇒ 结果不以 `\n` 开头、
    不以 `\n` 结尾、`Contains("<current_time>")` 为真。**注**：这条锁的是内存 `Text` 不变量，
    出站走 `HasImageContent` 分支（见前置约束），不产出 text 片段
  - **3c 剥离层**：`StripInjectedBlocks` 对「原话 + 块在尾部」「块在中间」「纯块无原话」三种形状都还原
    （注：`StripInjectedBlocks` 内有 `Trim()`（`MemoryRecall.cs:190`），**它检不出前导/尾随空行**，
    所以空行必须由 3a 锁）
  - **3d 真实出站请求体**：调 `OpenAIChatProvider.BuildRequestBodyForTests(parameters, provider, conv,
    toolDefs, state)`（`OpenAIChatRequestBuilder.cs:14-20`，internal，签名已核实），解析 JSON，
    定位 `messages` 里**第一条 `role == "user"`**（不是 `messages[0]`——provider 带 systemPrompt 时
    `:99-105` 会先写一条 system），断言其 `content` **以用户原话开头**。这是「服务端取首条 user 做标题」的
    端到端等价物
  - **3e 召回形状（补 ⚠️2）**：置 `state.PendingMemoryRecall = "<memory-recall>\n…\n</memory-recall>\n\n"`
    后再走 3d ⇒ 首条 user 仍以原话开头（锁住「recall 不会被塞回头部」），且
    `content` 里 `<memory-recall>` 出现在原话**之后**
  - **3f 两轮历史段字节不变（对应 §7 #4，补 ❌1）**：构造
    `conv2 = [user("第一轮原话"), assistant 桩, user("第二轮原话")]`，对 `conv2` 跑一次注入 + build 得
    `bodyA`；另构造仅含第一轮的 `conv1` 跑同样流程得 `bodyB`；断言
    **`bodyA` 中第 1 条 user 的 `content` 与 `bodyB` 中第 1 条 user 的 `content` 字符串完全相等**
    （等价于「第二轮注入不触碰历史段字节 ⇒ 前缀缓存稳定」）
  - **反向验证（验断言有效，做完立刻改回）**：
    ① 把 `Helpers.cs:353` 改回 `parts + msg.Text` ⇒ 3a / 3d 必须变红
    ② 把 helper 改成 `block.TrimEnd() + text`（即前置）⇒ 3a-2 / 3e 必须变红
    ③ 去掉 helper 里的 `TrimEnd()` ⇒ 3a 的「不以 `\n` 结尾」与 3a-2 必须变红
    注：`MemoryRecall.cs:116` 的调用点本身测不到（`TryInjectMemoryRecallAsync` 是 private），
    所以方向由 helper 锁、调用点靠步骤 5 的 grep + 阶段五审查覆盖
  - 验证检查点：`npm test -- --csharp-only --filter memory` 全绿；三轮反向验证均如期变红

- [ ] **步骤 4：出站请求体存证**
  - 用步骤 3d 的同一组输入，把 `messages` 里**第一条 `role == "user"`** 的 `content` 前 120 字符写到
    `.wishful-claw/notes/s231-outbound-sample.md`（`notes/` 见 `.gitignore:74`，不入库）
  - 内容需含：改动**前**形状（手工构造 `块 + 原话`）与改动**后**形状各一份对照，标注 `role`
  - 验证检查点：文件存在，两段开头字符肉眼可见差异（前：`<memory-recall>` / `<current_time>`；
    后：用户原话）

- [ ] **步骤 5：注释订正（八处 + 全目录扫描）**
  - `AgentLoop.Helpers.cs:313-316`（`Contains` 守卫理由）—— 步骤 1 内已完成
  - `AgentLoop.MemoryRecall.cs:41-47`、`:109-110`（步骤 2 内）、`:164-166`、`:170-175`
  - **`MemoryUpdateQueue.cs:8-11`**（「injected as a `<memory-update>` block into the user message
    **prefix**」→ 尾部／suffix）
  - `Models/ConversationModels.cs:19-24`（`Text` 由「前面可能被塞了」改「尾部可能附加了」）；
    `:34-35` 的 `OriginalText` 注释同步（36 已是 `SentAt` 注释首行，不纳入）
  - **`AgentRuntimeRunState.cs:74-75`、`:80-81`**（审查新发现：`:80-81` 原文
    「injected into the last user message **before** the timestamp prefix」改动后即为错；
    `:74-75` 「becoming part of the permanent conversation history」与「注入块不入库」冲突，一并订正）
  - `OpenAIChatRequestBuilder.cs:143-148`、`AnthropicMessagesInputWriter.cs:125-128`
  - 说明：`OpenAIResponsesInputWriter.cs` **不需要改** —— `:115-122` 整段写 `message.Text`，无位置假设
  - 验证检查点：`Select-String -Path src\runtime\WishfulClaw.Agent\*.cs,src\runtime\WishfulClaw.Agent\Models\*.cs
    -Pattern "prefix|prepend|前置|头部"` **扫整目录**（不局限清单文件），逐条确认无错误描述残留；
    `StripInjectedBlocks`、`InjectTransientPrefix` 的**函数名**保留，只改描述性文字

- [ ] **步骤 6：全量门禁**
  - 先确认无 dev 实例占用（`dotnet build` 会撞 `WishfulClaw.Worker` 输出锁，见工作流「编译环境」节）
  - `dotnet build src\runtime\WishfulClaw.sln`
  - `npm test`（全量；与 build **不并行**）
  - TS 无改动，但按工作流仍跑三条 `npx tsc --noEmit`（`tsconfig.json` / `tsconfig.web.json` /
    `tsconfig.node.json`）确认零错误，避免被判漏项
  - 验证检查点：0 警告 0 错误；三条 tsc 零错误；测试 `N/N 通过`，N **不小于**本迭代上一次全绿基线
    （以实测为准，不写死数字），新增用例数计入 N

- [ ] **步骤 7：提交（一需求一刀）**
  - `git add` 本需求涉及的全部代码 + `docs/plans/iter-v3-1/plan-s231/**` + `requirements/S-231.md`
    + `raw-requirements.md`
  - 提交前查 BOM（改动文件均为 CRLF，`git diff --stat` 应只显示实际改动行）
  - 提交信息：`fix(loop): 运行时附加块改为后置，修第三方会话标题被 current_time 污染（S-231）`
  - 验证检查点：`git show --stat` 只含本需求文件；`git status` 不残留 `.tmp-*`

- [ ] **步骤 8：阶段五审查 + 阶段六验证报告**
  - 独立审查（只读，不写文件）→ 落 `review_report.md`，**❌ 必须为 0** 才算过
  - 真机验证（逐条对应 `S-231.md §7`）→ 落 `verification_report.md`：
    1. §7 #1 WorkBuddy **国内版**新建会话 ⇒ 标题是首条用户原话，无 `<current_time>`
    2. §7 #2 WorkBuddy **国际版**同上
    3. §7 #3 首轮命中记忆召回的会话 ⇒ 标题不含 `<memory-recall>`
    4. §7 #6 OpenAI 兼容路问「现在几点」⇒ 答对（尾部块可读性）
    5. §7 #6 Anthropic 路问「现在几点」⇒ 答对
    6. §7 #5 发一条纯图片消息 ⇒ 请求体 `content` 为数组、不含空 text 片段（看 worker 日志或代理抓包）
  - 验证检查点：两份报告落盘，`changelog.md` 与 `exploration_findings.md` 状态同步

## 涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/AgentLoop.Helpers.cs` | 改拼接方向（`:353`）+ 注释（`:313-316`） |
| `src/runtime/WishfulClaw.Agent/AgentLoop.MemoryRecall.cs` | 改召回追加（`:116`）+ 注释（`:41-47`、`:109-110`、`:164-166`、`:170-175`） |
| `src/runtime/WishfulClaw.Agent/MemoryUpdateQueue.cs` | 注释（`:8-11`） |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeRunState.cs` | 注释（`:74-75`、`:80-81`） |
| `src/runtime/WishfulClaw.Agent/Models/ConversationModels.cs` | 注释（`:19-24`、`:34-35`） |
| `src/runtime/WishfulClaw.Agent/OpenAIChatRequestBuilder.cs` | 注释（`:143-148`） |
| `src/runtime/WishfulClaw.Agent/AnthropicMessagesInputWriter.cs` | 注释（`:125-128`） |
| `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` | 新增 3a~3f 断言（约 70 行） |

`OpenAIResponsesInputWriter.cs` 确认无需改（`:115-122` 整段写入，无位置假设）。

行数核算：`Helpers.cs` 368 行、`MemoryRecall.cs` 211 行、测试 `Program.cs` 336 + 约 70 ≈ 406 行，
均在 500 行硬上限内。

## 参考源码

- 无外部参考项目。改法是业界通行做法（Claude Code 的 `system-reminder` 走消息尾部），本仓库内
  `InjectSessionTodo`（`AgentLoop.SessionTodo.cs:90-96`）的注释已写明「追加在末尾不属于任何后续请求的前缀，
  缓存不受影响」，与本需求同一理由。

## 风险与处置

| # | 风险 | 处置 |
|---|---|---|
| 1 | 空/空白原话 ⇒ 内存 `Text` 以 `\n` 开头 | 步骤 1+2 用 `IsNullOrWhiteSpace` + 步骤 3b 断言（出站走图片分支，不受影响） |
| 2 | 块自身尾随 `\n\n` ⇒ 消息末尾留白行 | 步骤 1+2 对**块** `TrimEnd()`；不裁原话；步骤 3a 锁「不以 `\n` 结尾」+ 反向验证 ③ |
| 3 | 模型对尾部块的时间感知退化 | 步骤 8 第 4/5 项真机问「现在几点」×2 条 provider 路；唯一非确定性风险，无法自动化 |
| 4 | 前缀缓存命中率 | 步骤 3f 断言两轮历史段字节相等；首轮消息本身一变本来就会 miss 一次 |
| 5 | 「新旧形状并存」误判 | 注入块**从不入库**（见「存量形状的准确口径」）⇒ 无存量、无需迁移、阶段六不抽查旧行 |
| 6 | 断言写成「自我实现」（测试与实现同错） | 步骤 3 末三轮反向验证，覆盖两处拼接方向 + `TrimEnd` |
| 7 | `PendingMemoryRecall` 意外非空导致块序错乱 | 步骤 2 明确前提（`AgentLoop.cs:450` 每 turn 清空），实施时确认 `Helpers.cs:323-326` 不重复写 |
