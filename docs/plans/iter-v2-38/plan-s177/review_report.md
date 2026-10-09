# 审查报告：plan-s177（阶段五 · 审查态）

> 被审查对象：需求 `docs/plans/iter-v2-38/requirements/S-177.md`；计划 `docs/plans/iter-v2-38/plan-s177/plan.md`；落地提交 `2e3b5727`（fix(chat): 渠道空闲后首条消息误报「Agent run was not started」—— 入队改判已受理（S-177））
> 审查方式：独立 subagent（code-reviewer，只读源码；未改任何文件、未跑构建/测试）
> 时间：2026-10-09

## 一、总体结论

**❌ 项 = 0 · 可进入验证态（阶段六）。**

改动与需求 / 计划一致：`sendMessage` 入队分支 `return false` → `return true`，契约归位为「`true` = 已受理 / `false` = 未受理」；两处消费点补语义注释（行为不变）。逐点复核 10 处调用点，行为变化 3 处 + 等价文案变化 1 处，全部正向或等价，无回归；无新依赖、无域外改动、无分层越界。仅存 2 条「知晓 / 建议」级欠账（真失败文案仍硬编码吞真因、契约「已受理」不保证最终执行），均已被需求 / 计划显式划为范围外。

## 二、逐项结论（审查项 5 条 + 回归风险 + 域外改动，共 7 行表）

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 分层约定（渲染端 store / hooks） | ✅ 合规 | `git show --numstat 2e3b5727` 源码仅 2 文件、全在 `src/renderer/src/**`（`stores/chat-store/index.ts` +5/-1、`hooks/use-chat-actions.ts` +4/-0）；未碰 `src/main/**` 与 C# `src/runtime/**`。改动是纯渲染端 store 返回契约 + 消费点注释。 |
| 2 | 硬编码 / 魔法值 | ⚠️ 建议（范围外） | `use-channel-auto-reply.ts:301` 仍硬编码 `throw new Error('Agent run was not started')`，真失败时吞掉真因（Worker 回的是 `result.error`，如 `Session already has an active agent run: …`，`chat-store/index.ts:504-508` 已解析却不外传）。改后该字面量**只在真失败**（无 sessionId / Worker 拒绝 / 异常）触发，危害较改前显著缩小。需求 §5.3 / plan §七.2 已显式划为范围外、待老大裁 ⇒ **不阻断本刀**。 |
| 3 | 正确性：契约改后消费点是否仍正确 | ✅ 正确 | 自 `grep "sendMessage("` 重数 = **10 处 store 级调用点**，逐点核对见 §三。忽略返回值的 6 处（`use-background-subagent-wakeup.ts:103`、`use-chat-actions.ts:369/428/509`、`cron-runtime.ts:412`、`provider-auto-fallback.ts:228`）行为不变；`use-chat-actions.ts:224`（handleSendMessage）与 `:902`（出队重放）由「误暂停」变「不暂停」，属正向修复；`project-send-message.ts:208` 队列长度差补丁改后成死代码但结果等价（`success` 仍 `true`）。 |
| 4 | 错误处理充分性 | ✅ 充分 | 真失败三来源仍可达且语义清晰：`:236` 无 sessionId、`:491-514` `result.started === false`（Worker 拒绝）、`:518-535` 异常 —— 三者仍 `return false`。`false` 来源由改前 4 变 3，剩余 3 者**全部**是「真未受理」，语义自洽。注：入队分支（`:272-276`）未包 `try/catch`，`await import` / enqueue 抛错则 Promise reject（非返 false）——此为**改动前既有**行为，本刀未新增。 |
| 5 | 是否引入不需要的依赖 | ✅ 无 | diff 仅改 1 个 return 值 + 注释，无新增 import / 无新依赖。入队分支用的 `await import('@renderer/hooks/use-chat-actions')`（`:273`）是**既有**动态 import，非本刀引入。 |
| 6 | 回归风险 | ✅ 低（与 compliance 一致） | 无遗漏消费点（自 grep 重数 10 处）。回归面 = 3 处行为变化 + 1 处等价文案变化，全部落在「入队被误当失败」的同类位点上，无一处把「已受理」误判为「失败」。唯一语义张力：契约 `true = 已受理` 不保证最终执行（入队后派发依赖 `streamingMessages` 残留被清），已由 plan §七.1 / 需求 §5.2 划为范围外（见 §四 #1）。 |
| 7 | 域外顺手改动 | ✅ 无 | 提交含 5 文件：2 源码（本刀目标）+ 3 文档（`plan.md` / `S-177.md` / `compliance_report.md`，属本刀工作流产物）。**无**顺带修改的其它源码；diff 首行无 BOM / 行尾捎带变更（改动文件均无 BOM、CRLF）。 |

## 三、对 compliance_report 结论的独立复核

> 复核方式：不用 compliance_report 的表，自己 `Select-String "sendMessage\("` 重数调用点，再逐点读实码。

**① 消费点「10 处无遗漏」——属实 ✅**

自 grep（`src/renderer/src/**` 全量）得 store 级 `sendMessage` 调用点**正好 10 处**，与 compliance 表逐行对应（括号内为 compliance 用的实施前行号）：

| # | 位置（当前 HEAD） | 用法 | 改后行为 |
|---|---|---|---|
| 1 | `use-channel-auto-reply.ts:255` | `const started = await …; if(!started) throw` | ✅ 修复（第 3 行证据：入队不再 throw） |
| 2 | `use-chat-actions.ts:224`（=`handleSendMessage`） | `if(!started) pausePendingSessionDispatch` | ✅ 窄竞态：由「误暂停」变「不暂停」 |
| 3 | `use-chat-actions.ts:902` | `if(!started){pause;return}`（出队重放） | ✅ 路径不可达（`:877`/`:892` 已前置拦） |
| 4 | `project-send-message.ts:208` | 忽略返回值，用队列长度差自判 | ⚠️ 等价文案变化（queued→sent） |
| 5 | `use-background-subagent-wakeup.ts:103` | `void`（忽略） | 无变化 |
| 6-8 | `use-chat-actions.ts:369 / 428 / 509` | `await`（忽略） | 无变化 |
| 9 | `cron-runtime.ts:412` | `await`（忽略） | 无变化 |
| 10 | `provider-auto-fallback.ts:228` | `await`（忽略） | 无变化 |

⇒ 「10 处」口径如实，**无漏数**。（另有 6 处组件调 `useChatActions().sendMessage`＝`handleSendMessage`，属 hook 层，boolean 全忽略，compliance 未单列亦无误。）

**② 「行为变化 3 处」——属实 ✅**

- 恒可达 1（渠道路，修复误报）：`:299-302` 的 `!started` 不再命中入队分支 ⇒ 微信 `Agent error: Agent run was not started` 不再出现。
- 窄竞态 1（`handleSendMessage:224-260`）：前置 `:102-108` 用 `hasActiveSessionRunForSession`（`:943-948`：`_startingSessionSends` / `streamingMessages` / `runningSessions`）拦绝大多数忙态；若在 `resolveSendModel`（`:117`）等 `await` 期间被别的路径置忙，则 store 内入队 → 改后返 `true` → 不暂停。**独立确认属实。**
- 路径不可达 1（出队重放 `:902`）：派发前 `:877`、`:892` 两次 `hasActiveSessionRunForSession(sessionId)` 均为假才继续，故 `streamingMessages[sessionId]` 已被清，正常走不到入队分支。**独立确认属实。**
- 另加 `project-send-message.ts` **等价文案变化**（改后 `started=true` ⇒ 跳过 `:230-251` queued 分支 ⇒ 走 `:253` 成功分支，`success` 仍 `true`，文案由 `Message queued …` 变 `Message sent …`）。**独立确认属实**，S-58「队列长度差」补丁自此成死代码（保留无害）。

**③ 「`sendMessage` 返 false 四种来源」——属实 ✅（且已过时于改后）**

改前 `:236` / `:268-272` / `:491-514` / `:518-535` 四处逐点与实码吻合；改后 `:268-272` 转 `true` ⇒ 剩 **3 来源**。compliance / plan 已声明其表为「实施前快照」，口径无误。

**④ 独立发现的补充（compliance 未覆盖，但不改变其结论）**

- **契约后置条件弱于字面承诺**：`true = 已受理`，但入队后能否真跑取决于 `streamingMessages[sessionId]` 残留被清（plan §4.4 共用判据）。即 `true` 是「已受理」而非「已启动」，与需求 §5.2（残留期间消息安静排队）自洽，但**读契约的人可能误读为「已启动」**。—— 见 §四 #1（ℹ️）。
- **`false` 的字面量仍不区分来源**（本刀未改，见 §四 #2）。

## 四、问题与建议

| # | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ℹ️ 知晓 | `stores/chat-store/index.ts:268-276`（契约注释） / `use-channel-auto-reply.ts:299-303` | 契约 `true = 已受理` 的字面承诺强于实际后置条件：入队后能否真跑取决于 `streamingMessages[sessionId]` 残留被清（plan §4.4 共用判据），残留不清则消息静默滞留。渠道路拿到 `true` 后不再报错，但也不代表 run 已启动。 | 无需改本刀。若日后治残留（第 2 刀），建议把契约从「已受理」细化为「已受理（可能排队）」并在 `:269` 注释里点明「不保证已启动」。 |
| 2 | ⚠️ 建议 | `use-channel-auto-reply.ts:301`（+ `chat-store/index.ts:508` 同款兜底文案） | 真失败（无 sessionId / Worker 拒绝 / 异常）仍抛硬编码 `Agent run was not started`，真因被吞。改后危害缩小（只在真失败触发），但仍让用户看到误导文案。 | 不改本刀（需求 §5.3 / plan §七.2 已划范围外、待老大裁）。若批准，改为透传 `result.error`（`store` 侧已在 `:504-508` 解析，只需把 `result.error` 回传给渠道路而不再一律翻成同一句）。 |
| 3 | ℹ️ 知晓 | `stores/chat-store/index.ts:272-276` | 入队分支未包 `try/catch`：`await import` 或 `enqueuePendingSessionMessage` 若抛错，`sendMessage` 会 **reject**（而非返回 `false`），调用方的 `await` 会炸。 | 既有行为（改动前同样如此），本刀未新增，且 `enqueuePendingSessionMessage` 是同步内存 push（无 IO），实际风险极低 —— 记录，不改。 |
| 4 | ℹ️ 知晓 | 提交 `2e3b5727` | 无自动化回归断言覆盖「入队返回 `true`」这条契约（plan §五 步骤 3 说明理由：需拉起 zustand store + IPC）。 | 与 compliance §四 一致，属既有欠账。若日后引入 store 层轻量测试，优先补此断言。 |

## 五、非本刀欠账（记录，不纳入本刀）

1. **残留销账（「空闲时 `streamingMessages[sessionId]` 为何非空」）未定案** —— 本刀只治误报。治本候选：渲染端加只读 IPC 去问 Worker 侧现成的 `AgentRuntimeTools.HasActiveSessionRun(sessionId)`（`ActiveSessionRuns.ContainsKey`）。待老大另行裁定（plan §七.1 / 需求 §5.2）。
2. **真失败文案未改** —— `use-channel-auto-reply.ts:301` / `chat-store/index.ts:508` 的 `Agent run was not started` 仍硬编码、吞真因。待老大裁（§四 #2）。
3. **`project-send-message.ts:199-251` 的 S-58「队列长度差」补丁已成死代码** —— 改后可撤，属另一刀（plan §七.4）。
4. **`docs/plans/` 全树 61 个历史文件带 UTF-8 BOM**（落在 `iter-v2-19` ~ `iter-v2-28`）—— 既有欠账，与本刀无关（compliance §四）。
5. **日内无自动化回归断言覆盖「入队返回 `true`」契约**（§四 #4）。

## 六、结论

**❌ = 0 ⇒ 可进入验证态（阶段六）。**

- 分层：✅ 纯渲染端，未越界到 main / runtime。
- 正确性：✅ 10 处调用点逐点核对，3 处行为变化 + 1 处等价文案变化，无回归、无遗漏。
- 错误处理：✅ 真失败三来源仍可达，`false` 语义收敛为「未受理」。
- 依赖：✅ 无新增。
- 域外：✅ 无。
- 唯一 2 条带「建议」的欠账（真失败文案硬编码、契约后置条件）**均已被需求 / 计划显式划出本刀范围**，不构成阻断。

⇒ **本刀可进入阶段六验证态。**

## 七、审查范围自述

- **读过的文件**（只读）：`docs/plans/iter-v2-38/requirements/S-177.md`、`docs/plans/iter-v2-38/plan-s177/plan.md`、`docs/plans/iter-v2-38/plan-s177/compliance_report.md`、`src/renderer/src/stores/chat-store/index.ts`、`src/renderer/src/hooks/use-chat-actions.ts`、`src/renderer/src/hooks/use-channel-auto-reply.ts`、`src/renderer/src/hooks/use-background-subagent-wakeup.ts`、`src/renderer/src/lib/tools/project-send-message.ts`、`src/renderer/src/lib/tools/cron-runtime.ts`、`src/renderer/src/lib/agent/provider-auto-fallback.ts`。
- **跑过的命令**（全只读）：`git show --stat 2e3b5727`、`git show 2e3b5727 -- <两源码文件>`、`git show 2e3b5727 --numstat`、`git log --oneline -5 2e3b5727`、`git status --short`、`Select-String "sendMessage("` 全量重数调用点、`Select-String` 定位 `enqueuePendingSessionMessage` / `hasActiveSessionRunForSession` / `dispatchNextQueuedMessageForSession` 定义。
- **未做**：未改任何源码 / 计划 / 需求文档；未 commit / push；未跑构建 / 测试（本阶段只审查，不验证）。
- **产物**：仅本文件 `docs/plans/iter-v2-38/plan-s177/review_report.md`。
