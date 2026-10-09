# Plan-S177：`sendMessage` 契约归位 —— 「已入队」从 `false` 改判 `true`

> 归属 iter-v2-38。需求正文见 [`../requirements/S-177.md`](../requirements/S-177.md)。
> 状态：**已实施、真机复验无法进行**（2026-10-09）。方案由老大 2026-10-09 09:36 裁定；步骤 4 真机复验由老大 13:47 裁定「验证不了，这个得等后续实机情况」⇒ **转实机长期观察**，本刀不带真机结论收尾。
> 一句话：不是判断写错了，是**返回值的契约定义错了** —— 把「已受理、已排队」也算成了「失败」。

---

## 一、目标

渠道会话长时间空闲后，首条入站消息**立刻**收到 `Agent error: Agent run was not started`，**随后 agent 的回复又正常发回**。报错与事实相反，本刀消除这句误报。

---

## 二、根因（已锁定，实读）

链路三处，一条线：

| 环节 | 位置 | 现状 |
|---|---|---|
| ① 判据 | `chat-store/index.ts:268-272` | `if (state.streamingMessages[sessionId]) { enqueue(...); return false }` —— **已入队，却返回 `false`（=失败）** |
| ② 翻译 | `use-channel-auto-reply.ts:299-302` | `const started = await sendPromise; if (!started) throw new Error('Agent run was not started')` |
| ③ 送达 | `use-channel-auto-reply.ts:307` | `sendChannelNotice(task, \`Agent error: ${err.message}\`)` ⇒ 微信那句报错 |

**关键**：`sender` 没判错，它只是**如实翻译了 `sendMessage` 给的契约**。契约把 `false` 定义成「其余全部」，其中就包含「已受理、已排队」。**定义错，不是赋值错。**

`sendMessage` 返回 `false` 的**四种来源**（实读）：`:236` 无 sessionId（真未受理）｜**`:268-272` 已入队（已受理）**｜`:487-508` Worker 拒绝（真未启动）｜`:514-529` 异常（真失败）。**四种全报同一句话**，其中两种根本不成立。

**老大现象是铁证**：「过一段时间后实际 agent 又回复微信消息回来了」—— 真没启动的话谁来回复？⇒ 那一轮**确实启动了**，只是排队等前面的 run。**只有「入队」这一条分支能同时满足「立即返回假」+「稍后真开跑」。**

**同一坑本项目踩过一次**：iter-31（`docs/progress/v2-iter-31.md:89-91`）在**会话派发侧**打过「失败后回查队列」的补丁绕开这个 boolean；`project-send-message.ts:200-202` 也留着一份「比队列长度差」的绕行。**渠道路至今没有** —— 同一个 `false` 在它这儿就直接变成报错。

---

## 三、做法

**改一处，一行**：

```ts
// src/renderer/src/stores/chat-store/index.ts:271
        return false      // ← 改为 return true
```

`sendMessage` 的新契约：

| 返回值 | 含义 |
|---|---|
| `true` | **已受理** —— 立刻开跑 / 已排队等前一个 run |
| `false` | **未受理** —— 无 sessionId / Worker 拒绝 / 抛异常 |

**为什么这样改是对的**：入队之后由 `dispatchNextQueuedMessageForSession` 在 `loop_end` 后派发（`index.ts:1743-1751`），消息**一定会跑**。「已受理」与「未受理」本就该分在 `true` 的两侧。

---

## 四、影响面（8 类消费点 / 10 处调用点全查，实读；行为变化 3 处）

> **行号口径**：本表为 **2026-10-09 实施前**快照。实施后 `chat-store/index.ts` 整体 **+4** 行、`use-chat-actions.ts` **+2** 行（都因插入注释）—— 定位按内容，行号会漂。

| 消费点 | 现在怎么用返回值 | 改后 |
|---|---|---|
| `use-channel-auto-reply.ts:299`（**恒可达**） | `if (!started) throw` ⇒ **本次误报源** | ✅ 修复 |
| `use-chat-actions.ts:258`（`handleSendMessage`，**窄竞态可达**） | `if (!started) pausePendingSessionDispatch` ⇒ 入队被误当失败，**反向暂停**了本该继续的派发 | ✅ 由「误暂停」变为不暂停（`:102-108` 的前置拦截已覆盖绝大多数情况；此路只在放行后被别的路径置忙时命中） |
| `use-chat-actions.ts:910`（出队重放，**路径不可达**） | `if (!started) { pause; return }` | ✅ 同上；出队前 `:875` / `:890` 已确保不忙，实际走不到入队分支；即便竞态入队，`true` 后按 `:914-920` 正常推进，消息不丢 |
| **`lib/tools/project-send-message.ts:208`** | 忽略返回值，自用「队列长度前后差」区分入队（`:199-202` 的 S-58 补丁） | ⚠️ **等价文案变化**：改后入队 ⇒ `started=true` ⇒ 不再进 `:230-251` 的「queued」分支，改走 `:253` 成功分支 —— `result` 文案由 `Message queued for session …` 变为 `Message sent to session …. The target session is now processing.`，`success` 仍为 `true`。**S-58 补丁从此失去作用，可以撤**（另立一刀，见 §七.4） |
| `use-background-subagent-wakeup.ts:103` | `void`（忽略） | 无变化 |
| `use-chat-actions.ts` 三处内部 `await`（表内旧记 `:367/426/507`） | `await`（忽略） | 无变化 |
| `lib/tools/cron-runtime.ts:412` | `await`（忽略） | 无变化 |
| `lib/agent/provider-auto-fallback.ts:228` | `await`（忽略） | 无变化 |

⇒ **行为变化 3 处**：恒可达 1（渠道路，修复误报）／窄竞态 1（`handleSendMessage`，去掉误暂停）／路径不可达 1（出队重放）；另加 `project-send-message` 的**等价文案变化**（入队不再被称作 queued）。**全部正向或等价，无回归。**

---

## 五、步骤清单

- [x] **步骤 1：改 `index.ts:271` 的返回值 + 订正注释**
  - `return false` → `return true`；把 `:255-267` 那条 iter-30 注释块补一句「入队 = 已受理 ⇒ 返回 true」，否则下一个读代码的人又会以为 `false` 是有意的。
  - **验证检查点**：`npm run typecheck` 0 错。✅ 0 错。
- [x] **步骤 2：订正 `use-chat-actions.ts` 两处消费点的注释（不改行为）**
  - `:258` / `:910` 的 `if (!started)` 语义现在是「未受理才暂停」—— 注释此处的旧推断若有「入队也是 false」的描述，同步订正。
  - **验证检查点**：`npm run typecheck` 0 错。✅ 实读发现两处**本无旧推断注释**（裸 `if (!started)`），改为**补一句新语义说明**，防下一轮被当「故意设计」保回去。0 错。
- [x] **步骤 3：整体测通**
  - `npm run typecheck` 0 错；`npm test` 不破基线（**67/67**）。
  - 本刀**不新增测试套件**：断言对象是 zustand store 的入队分支，需拉起 store + IPC 依赖，成本高于本刀收益；语义由 §四 的消费点表 + 真机验证兜住（与 S-172 / S-173 同处理）。
  - **验证检查点**：全绿 ⇒ 本刀测通，按一需求一刀提交。✅ `typecheck` 0 错；`npm test` **67/67**；改动文件 CRLF 无 BOM。
- [ ] **步骤 4：真机复验（老大侧）—— 本轮无法验证**
  - 空闲 ≥ 10 分钟后发首条微信消息 ⇒ **不再出现** `Agent error: Agent run was not started`；消息稍后正常回复。
  - **验证检查点**：微信侧无假报错。**残留本身仍在**（见 §七），若残留久到离谱，走第 2 刀。
  - ⛔ **无法验证**：老大 2026-10-09 13:47 裁定「验证不了，这个得等后续实机情况」（受控条件下构造不出「渠道空闲 10 分钟~几十小时」的场景）⇒ 转**实机长期观察**，后续真实使用中若复现假报错，按 §七 第 2 刀跟进。本刀**不带真机结论收尾**。

---

## 六、涉及文件

| 文件 | 动作 |
|---|---|
| `src/renderer/src/stores/chat-store/index.ts` | 修改：`:271` 返回值 + `:255-267` 注释 |
| `src/renderer/src/hooks/use-chat-actions.ts` | 修改：`:258` / `:910` 消费点注释（行为不变） |
| `docs/plans/iter-v2-38/requirements/S-177.md` | 回填实施记录、状态头 |

**不动**：`use-channel-auto-reply.ts:299-302` 的 `throw` 与那句文案（见 §七.2）；iter-30 BUG-A/B 的入队前置拦截（`:255-272`）—— 那修的是「跨会话派发撞 Worker 单会话单 run 锁致渲染端丢 run」，删了会复现丢流；`setStreamingMessageId` 的「已有活跃 run 不覆盖」（`streaming-slice.ts:48-51`）同理。

**参考源码**：无 —— 本刀是本仓 `sendMessage` 契约归位，不涉及 OpenCowork / KodaClaw / OpenClaw.net 任一参考项目。

---

## 七、刻意不做（边界，写死免得下一轮走回去）

1. **不做「残留销账」（第 2 刀）** —— 本刀只治**误报**。残留（`streamingMessages[sessionId]` 空闲时仍非空）仍在：**残留期间消息会安静排队，直到残留被清才派发**（§4.4 那条约束：入队判定与队列派发共用 `streamingMessages`，`use-chat-actions.ts:939-944`）。用户体感 = 「消息稍后才有回复」，与正常排队一致，**但残留本身未销账**。
   - 候选治本：给渲染端加一个只读 IPC 去问 Worker 侧**现成**的 `AgentRuntimeTools.HasActiveSessionRun(sessionId)`（`ActiveSessionRuns.ContainsKey`，目前仅手动压缩在用），判忙前核一次 —— 比「空闲超时猜」可靠。**待老大另行裁定。**
   - 本刀**不需要**先定案「空闲时 `streamingMessages` 为什么非空」（§4.3 已排除 Worker 侧；残留只可能在渲染端事件送达，见 S-177 正文 §四）。
2. **不改真失败时的文案** —— Worker 拒绝 / 异常仍抛硬编码的 `Agent run was not started`，**真因被吞**（例如 Worker 实际回的是 `Session already has an active agent run: …`）。是否透传 `result.error` **待老大裁**（S-177 正文 §5.3），**不属本刀**。
3. **不给微信单独写分支** —— 三渠道（微信 / 飞书 / 钉钉）共用同一链路，修就修链路。
4. **不撤 `project-send-message.ts` 的「队列长度差」补丁** —— 改后可撤，但属另一刀。

---

## 八、实施记录（2026-10-09）

**落地**：`chat-store/index.ts:271` `return false` → `return true`（并把 `:255-267` 的 iter-30 注释块补上「返回值语义」）；`use-chat-actions.ts:258` / `:911` 补语义注释（行为未变）。**代码改动净额 = 1 行。**

**与计划的偏差（一处）**：步骤 2 原写「订正旧推断注释」，实读发现两处消费点**本无旧注释**（裸 `if (!started)`）⇒ 改为**补一句新语义说明**，目的不变（防下一轮被当「故意设计」保回去）。

**门禁**：`npm run typecheck` 0 错；`npm test` **67/67**（不破基线）。改动文件 CRLF、无 BOM。

**未走的路（记一笔，免得重复论证）**：原「甲 = 渠道路回查队列」方案（iter-31 派发侧同款补丁）**未采用** —— 老大 09:36 裁定走「返回值契约归位」，一处改动覆盖三个消费点，比在渠道路再打一个补丁干净。

**规划验证（阶段三）**：独立 subagent（`code-reviewer`，只读）×2 交叉复核，结论 **❌ = 0 · 可进入执行态**；两份报告一致判定「目标覆盖、验证检查点、路径合规、分层无越界、既有修复无回退、`false` 四来源论断属实」。报告点出的文档准确性问题已在本文件订正：

1. §四 原写「只有 2 处受影响」，与表内 3 个 ✅ 自相矛盾 ⇒ 改为「**行为变化 3 处**（恒可达 1 / 窄竞态 1 / 路径不可达 1）」。
2. `project-send-message.ts:208` 原标「无变化」不准 ⇒ 实为**等价文案变化**（入队不再被称作 queued），已订正并印证 §七.4「S-58 补丁可撤」。`requirements/S-177.md` §5.1 同格一并订正。
3. §二/§四 行号为**实施前快照**，实施后 `chat-store/index.ts` +4、`use-chat-actions.ts` +2 ⇒ 已在 §四 表头写明口径。
4. 补齐模板要求的 `## 参考源码`（写「无」）。
5. `requirements/S-177.md` §七 原写「不改返回值语义」与做法正面冲突 ⇒ 已改为「按 09:36 裁定改判」（验证报告生成前已订正）。

验证报告另记一条**非本刀欠账**：`docs/plans/` 全树有 61 个历史文件带 UTF-8 BOM（全在 `iter-v2-19` ~ `iter-v2-28`），本刀文件不在其中，留待收尾单独立项清理。

**待老大真机复验**：见 §五 步骤 4。
