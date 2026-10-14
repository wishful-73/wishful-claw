# S-192 阶段六验证报告（用户点「停止」后自动派发队列下一条）

> 状态：**已出**（2026-10-14，主会话执行）。
> 范围：`dev/v2-iter-39`；S-192 提交 `f734e488`（2026-10-13 08:45）。**本报告与其中的修正均未提交** —— 按提交纪律攒收尾刀。
> 判定：**PASS**（门禁四绿 + 静态逐条对账通过 + 老大实机确认）。
> **补记说明**：本条此前**验证结论未落盘**（迭代级 [`../verification_report.md`](../verification_report.md) §七 已记为「文档欠账 ①」），本文件为**事后补记**。门禁为本轮（2026-10-14）**现场复跑**；**实机结论引自老大**，非本报告复跑。

---

## 一、门禁证据（本轮现场复跑，2026-10-14）

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **0 错误** | `typecheck:node` + `typecheck:web` 两段均无任何诊断输出（tsc 静默即通过） |
| `npm test` | **71 / 71 通过** | 汇总行 `71/71 通过`（TS 54 + C# 17） |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。0 个警告 0 个错误` |
| `cd website; npm run build` | **0 错误** | `✓ built in 357ms` |

**环境前置**：按 `ExecutablePath` 过滤，仓库内**无** electron / `WishfulClaw.Worker` 进程命中（仅有打包版 PID 31168，`C:\Program Files\WishfulClaw\...`，**不锁仓库 `bin/`**）⇒ 门禁可跑。构建**未污染工作区**（`website/dist` 已 gitignore，跑完 `git status` 无新增未跟踪文件）。

> **与迭代级报告 §七 的 69/69 差异说明**：`69/69` 是 S-191 ~ S-193 当轮的基线；此后 S-194 / S-197 各自新增过套件，现行基线为 **71/71（TS 54 + C# 17）**。数字上移属**基线正常推进**，**非回归**。

---

## 二、实现核对（实读代码，非照抄计划）

**方案 B 的唯一改动点** = `src/renderer/src/hooks/use-chat-actions.ts:280-289`：

```ts
const stopStreaming = useCallback(async () => {
  const sessionId = useChatStore.getState().activeSessionId
  // 停之前先把队列冻住：旧 run 尚在收尾，这期间不该放行下一条。
  if (sessionId) pausePendingSessionDispatch(sessionId)
  await cancelStream()
  // S-192：停完自动放行 —— 解冻并派发队列里的下一条，用户不必再去队列点「继续」。
  // cancelStream 已把 streaming / sessionStatus 清干净，此处主动派发不会与旧 run 抢跑；
  // 若这一轮尚未真正收敛（仍被判活跃），本次调用只负责解冻，派发交给它的 loop_end。
  if (sessionId) dispatchNextQueuedMessageForSession(sessionId)
}, [cancelStream])
```

三条关键性质：

1. **先冻后停** —— `pausePendingSessionDispatch(sessionId)`（`:283`）在 `cancelStream()` **之前**。旧 run 尚在收尾的窗口内**不放行**下一条，防抢跑。
2. **一次调用同时「解冻 + 派发」** —— `dispatchNextQueuedMessageForSession(sessionId)`（`:288`）走的是**默认参数**。该函数签名 `(sessionId, resumePaused = true)`（`:894-897`），`:899-903` 的分支为：已冻结 **且** `resumePaused` **且** 无活跃 run ⇒ 解冻 —— 这正是本刀与其它自动派发路径的分水岭（其它路径一律显式传 `resumePaused = false`，见 `:856-859` 的注释）。
3. **未动 `cancelStream`** —— `cancelStream` 仍是「停并冻结」的纯语义，被 PM 的 `project/stop-session-run` 与渠道共用；S-192 只把自动续**挂在 `stopStreaming` 这个用户停止入口**上 ⇒ PM 的「停完待命」语义**未被改掉**。
   - 旁证（仍直调 `cancelStream`、不含自动续）：`lib/tools/project-session-queue.ts:218`（PM 停止）、`hooks/use-channel-auto-reply.ts:448`（渠道）。

**竞态边界**（代码注释已写明，`:286-287`）：若停止时这一轮尚未真正收敛、调度器仍判其活跃，则 `:904` 直接 `return false` ⇒ 本次调用**只负责解冻**，派发交给旧 run 自己的 `loop_end`。⇒ 既不会「派发被吞」，也不会「双发」。

---

## 三、验收判据核对

| # | 判据 | 结果 | 依据 |
|---|---|---|---|
| 1 | 队列里有 2 条 → 点停止 ⇒ **立即自动派发第 1 条**，无需再去队列点「继续」 | **通过** | **老大实机确认**（见下「证据来源」） |
| 2 | 停止后进入的排队消息**不再被吞 / 漏派** | 通过 | 静态：`pause → cancel → dispatch(resumePaused = true)` 三步闭环；未收敛时交 `loop_end` 兜底 |
| 3 | PM / 渠道的「停」语义**不变**（停完待命） | 通过 | 静态：两者仍直调 `cancelStream`，未走 `stopStreaming` |
| 4 | 门禁无回归 | 通过 | §一 四道全绿 |

**VERDICT：PASS**（门禁四绿 + 静态对账 + 老大实机确认）。

**证据来源（勿混）**：判据 1 的实机结论**引自老大**（记载于 [`../plan.md`](../plan.md) §二 S-192 行「老大已确认真机测试通过」），**本报告未复跑实机** —— 迭代级报告 §七 列的 E-1 ~ E-5 实机项由该结论一并结清。

---

## 四、刻意不做 / 已知缺口（防后人当 bug 改回去）

1. **不动 `cancelStream` 本身** —— 它是 PM / 渠道共用的「停并冻结」原语。把自动续塞进 `cancelStream` 会**连带改掉 PM 的「停完待命」语义**，这是方案 B 的核心取舍（方案 A 即因此被否）。
2. **PM 的 `stop_session_run` 不带自动续** —— 与上条同源，**刻意保留**（PM 停完应由 PM 自己决定下一步，而非被队列推着走）。
3. ⚠️ **已知缺口（本刀未做，待老大裁定）—— 悬浮窗的停止按钮**：
   - `src/renderer/src/components/settings/floating-chat-window.tsx:73-75` 的 `handleStop` **直调 `useChatStore.getState().cancelStream()`**，走的是 `stopStreaming` **之外**的第二个用户停止入口 ⇒ **在悬浮窗点停止不会自动续队列**。
   - 这与本需求的目标（「用户点停止时应自动续」）**口径不一致**，但改动面牵涉悬浮窗自身的停止语义，**未纳入本刀**，需老大裁定是否补。
4. **实机项本报告未复跑** —— 只做门禁 + 静态对账；UI 观感与触发式行为的最终确认为老大分工。

---

## 五、与其它文档的指针

- 需求正文：[`../requirements/S-192.md`](../requirements/S-192.md)
- 计划：[`plan.md`](plan.md)
- 阶段五审查：[`review_report.md`](review_report.md)
- 迭代级总账：§七（S-191 / S-192 / S-193 索引）
