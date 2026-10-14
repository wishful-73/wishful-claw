# S-197 计划（运行中在输入框状态栏增加「动态耗时」）

> 状态：**已实施**（2026-10-14）；阶段五审查已出（`review_report.md`，**✅ 通过 / 无阻断**，7 条建议全非阻断、挂收尾刀）；阶段六验证已出（`verification_report.md`，**PARTIAL** —— 实机项待老大验）。步骤清单见 §三。
> 需求：`requirements/S-197.md`。
> 老大裁定（2026-10-14）：① 显示形态 = **B（右侧独立一段）**；② 口径 = **整轮**；③ 跑完后 **不保留**。
> 归属：**iter-v2-39**（体验优化 —— 不改数据 / 协议 / 状态机，只加一处派生显示）。

---

## 一、目标

run 运行期间，在**输入框左上角状态栏**追加一个**秒级走字**的耗时；跑完即消失，不保留。

末值必须与随后操作栏亮出的耗时**同起点、同口径**，不能出现「走字到 3m12s、一跑完跳成 3m18s」这种割裂。

## 二、关键订正（推翻需求 §4.5 的「放宽判据」）

需求 §4.5 主张「计时开关不能只挂 `isStreaming`，要放宽到 `sessionStatus / activeToolName / pendingApprovalToolName / activeSubAgentCount`」。**该主张在本次勘察中被证伪，实现按收紧版走**：

1. **`isStreaming` 就是「run 活着」** —— `SessionConversationPane.tsx:39-41` 定义为 `Boolean(s.streamingMessages[resolvedSessionId])`，与组件 selector 里取消息用的 `s.streamingMessages[targetSessionId]`（`composer-status-indicator.tsx:39`）**是同一份数据**，两者恒等价。
2. **起点只能来自流式消息** —— 计时起点取 `message.createdAt`，而消息由 `streamingMessages[sessionId]` 定位。run 一结束该 id 即被删除（`chat-store/index.ts:1655`、`:1879`），起点随之消失 ⇒ **放宽判据也拿不到起点**，那 6 个条件对「算不算得出来」毫无影响，纯属多余。
3. **放宽反而有害** —— `activeToolName` / `pendingApprovalToolName` / `activeSubAgentCount` 这些桶在 run 结束后可能**残留**（状态栏那几条分支刻意不看 `isStreaming` 就是为兜住它们）。把开关放宽到它们，等于要求「run 结束后仍显示耗时」，直接违背裁定 ③。

⇒ **实现判据**：`startedAt != null`（即 `streamingMessages[sessionId]` 存在且消息已入 store）**且** 非历史回放 **且** `now > startedAt`（首帧兜底）。

**「整轮 vs 含排队」无歧义**：需求 §五-2 把「整轮」注成「含排队等待」，**注释错了**。会话忙时 `sendMessage` 会在前置分支里**入队并直接 return**（`chat-store/index.ts:272-276`），**消息不创建** ⇒ `createdAt` 取的是**真正开跑时刻**，天然不含排队。故「整轮」= `Date.now() − message.createdAt`，与操作栏的 `updatedAt − createdAt`（`AssistantMessage/action-bar.tsx:61-65`）同一起点。

## 三、落点与步骤（终止检查）

| 文件 | 改什么 |
|---|---|
| `lib/format-duration.ts` | **新增**纯函数 `resolveRunningElapsedLabel({ startedAt, now, disabled })`：判据 + 复用同文件的 `formatDurationMs`，取不到即返回 `null`。**落点刻意选零依赖叶子模块** —— 第一版放 `InputArea/utils.ts` 实测跑挂（依赖链经 chat-store 拉进 IPC，node 侧 `window is not defined`，bundle 2.7MB → 挪对后 7.4kb） |
| `components/chat/InputArea/composer-status-indicator.tsx` | ① selector 带出 `streamingStartedAt = message?.createdAt ?? null`；② `setInterval(…, 1000)` tick（照 `SubAgentCard.tsx:299-305` 惯用法）；③ 状态文案后追加 `shrink-0 tabular-nums` 的耗时段（形态 B） |
| `tests/composer-status-elapsed/program.ts` | **新增**：钉死口径四条不变量 |
| `package.json` | 注册 `test:composer-status-elapsed`（`run-tests.mjs` 自动发现 `test:*`） |

- [✓] 1. `lib/format-duration.ts` 加 `resolveRunningElapsedLabel`（纯函数，无副作用、无新依赖）
- [✓] 2. selector 带出 `streamingStartedAt`
- [✓] 3. tick：running 起表 / 停下清表，依赖 `[startedAt]`
- [✓] 4. 渲染：形态 B（`shrink-0` + `tabular-nums` + `aria-hidden`）
- [✓] 5. 新套件 `tests/composer-status-elapsed`（4 组断言）
- [✓] 6. 门禁：`npm run typecheck` 0 错误；`npm test` **71/71**（TS 54 + C# 17）；`dotnet build` 0 警告 0 错误
- [✓] 7. 提交（4 文件 + 本目录文档）→ 一刀 `feat(迭代39): S-197 运行中状态栏动态耗时`
- [✓] 8. 阶段五：独立审查（subagent）→ `plan-s197/review_report.md`，**✅ 通过 / 无阻断**；7 条建议全挂收尾刀
- [✓] 9. 阶段六：验证 → `plan-s197/verification_report.md`，**VERDICT PARTIAL**（实机 9 项待老大验）

**9 项步骤全清；实机验证（老大）与审查 7 条建议挂账收尾刀。**

## 四、门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | **0 错误**（node + web 两段均无诊断，`exit=0`） |
| `npm test` | **71 / 71 通过**（TS 54 + C# 17）—— 由 70/70 涨到 71/71，增量即本条新套件 |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** |
| `cd website; npm run build` | **免跑** —— 本条不触碰官网，无回归面 |

现场证据与逐项核对见 `plan-s197/verification_report.md` §一 / §二。

## 五、验收判据

1. **主判据**：一次长任务（跑工具 / 等审批 / 子 Agent 期间）状态栏持续走字，**跑工具那几段不停表**。
2. 状态栏最后一个 tick 的数字，与随后操作栏亮出的耗时**不跳字**（差值 ≤ 1 个 tick）。
3. 跑完状态栏立刻回到 `Ready`，**耗时消失**，不残留。
4. 历史会话回放（`messagesOverride` 分支）**不走表**。
5. 会话空闲（无 run）时状态栏**没有**耗时段。
6. 长工具名被 truncate 时，**耗时仍在**（`shrink-0`），不被挤掉。

## 六、非目标（刻意不做）

1. **不改 `action-bar.tsx` 的完成态耗时算法** —— 它是对的（S-196 刚收口）。
2. **不给 store 加 `startedAt`** —— 起点从消息 `createdAt` 拿就够，这是本条保持零风险的前提。
3. **不做预估剩余时间 / 进度百分比** —— 没有可靠进度来源，硬做就是编。
4. **不做「超 N 分钟变红 / 告警」** —— 另一个需求。
5. **不显示「本轮 + 整轮」两个耗时** —— 一个状态栏放不下。
6. **不顺手改状态栏那几条分支的残留语义**（run 结束后 `N sub-agents running` 仍在）—— 既有行为，与本条无关。
