# Plan-S179：子 Agent 卡片步骤列表「追着贴底」—— 240px 滚动区补自动滚动

> 归属 iter-v2-38。需求正文见 [`../requirements/S-179.md`](../requirements/S-179.md)。
> 状态：**已完成**（2026-10-09）。阶段二~四完成（唯一代码改动 = `SubAgentCard.tsx`）；阶段五审查 / 阶段六验证见同目录 `review_report.md` / `verification_report.md`。**真机复验已通过**（老大 2026-10-09 13:45：「178和179都测试通过了」）。
> 容器已由老大坐实 = **候选 A**（卡片内 240px 步骤列表，老大 2026-10-09 11:31）。
> 一句话：卡片内那个 240px 滚动区**只有滚动条、没有任何自动滚动逻辑** —— 步骤往下长，视口钉在原地。

---

## 一、目标

子 Agent 卡片展开后，内部步骤列表（`max-h-[240px] overflow-y-auto`）随新步骤追加**自动贴底**：用户看到的是「最新一步」，而不是「最早一步」。

---

## 二、现状（实读，行号为 2026-10-09 快照）

`src/renderer/src/components/chat/SubAgentCard.tsx`

| # | 位置 | 现状 |
|---|---|---|
| ① | `:72-139` `SubAgentStepList` | **整个函数零 `ref` / 零 `useEffect` / 零 `scrollTop`** —— 只有 `useReducer` 的 `forceUpdate`（`:79`，仅服务审批按钮重绘） |
| ② | `:90` 滚动容器 | `max-h-[240px] overflow-y-auto px-3 py-1` —— 卡片**主体**内唯一的滚动条容器（同文件 `:189` 的 HoverCard Prompt 区另有 `overflow-y-auto`，不属卡片主体；措辞按规划验证 ⚠️1 订正） |
| ③ | `:464-479` 挂载点 | `AnimatePresence` + `isExpanded && hasSteps` ⇒ 展开时**重新挂载**（外层 `motion.div` 0.15s 高度动画 + `overflow-hidden`） |
| ④ | 数据源 | `toolCalls` = `effectiveToolCalls`（`:474`），步骤**只追加**、不重排 |

⇒ **结论**：这是「只往下长的日志区缺贴底逻辑」。与「用户滚上去被强行拉回」是两回事，与 S-176 的「高度回收」也不是同一机制。

---

## 三、候选容器排除（为什么不是 B / C）

| # | 容器 | 排除理由 |
|---|---|---|
| B | 详情面板转录 `SubAgentExecutionDetail.tsx:379` → `TranscriptMessageList.tsx:108-117` | 有 `autoScrollToBottom`，**跑着的时候本来就贴底**；且那是「面板」不是「卡片」。**残留子问题**：`isRunning=false`（排队 / 已结束）时不贴底 —— 见 §七.2，不在本刀 |
| C | 聊天窗主滚动 `useMessageListScroll.ts` | S-176 地盘、S-176 真机残留（老大 11:13），不属本条 |

---

## 四、做法（A-1，最小）

`SubAgentStepList` 内加一个 `ref` + 一个贴底 `useEffect`：

```tsx
const listRef = React.useRef<HTMLDivElement | null>(null)

React.useEffect(() => {
  const node = listRef.current
  if (!node) return
  const frame = requestAnimationFrame(() => {
    node.scrollTop = node.scrollHeight
  })
  return () => cancelAnimationFrame(frame)
}, [toolCalls.length])
// ...
<div ref={listRef} className="max-h-[240px] overflow-y-auto px-3 py-1">
```

**三个必须守住的细节**：

1. **hooks 不能落在 early return 之后** —— 现有函数在 `:81-87` 有 `toolCalls.length === 0` 的提前返回，`useRef` / `useEffect` 必须插在 `:79`（`useReducer`）之后、`:81`（early return）之前，否则 hooks 调用顺序会在「有步骤 / 无步骤」两种渲染间变化（React 直接报错）。
2. **依赖只取 `toolCalls.length`** —— `toolCalls` 数组每次渲染都是新引用，直接作依赖会**每帧触发**；长度变化才代表「多了一步」。
3. **用 rAF 而非同步设值** —— 步骤追加时 DOM 尚未布局完成，同步读 `scrollHeight` 会拿到旧值。

---

## 五、步骤清单

- [x] **步骤 1：`SubAgentStepList` 加 `listRef` + 贴底 `useEffect`**（挂在 early return 之前）
  - 验证：`npm run typecheck`（node + web 两配置）0 错 —— 已跑，EXIT=0
  - 落地：`SubAgentCard.tsx:80` `listRef` + `:87-94` effect（依赖 `[toolCalls.length]`，rAF 内 `scrollTop = scrollHeight`，cleanup `cancelAnimationFrame`），注释 `:82-86`
- [x] **步骤 2：滚动容器挂 `ref`**（`:90` 那个 `max-h-[240px]` div）
  - 验证：`npm run typecheck` 0 错；`scrollTop = scrollHeight` 的目标节点即它
  - 落地：`SubAgentCard.tsx:105` `<div ref={listRef} className="max-h-[240px] overflow-y-auto px-3 py-1">`（className 未变，同文件 `:189` HoverCard 的 `overflow-y-auto` 未被误挂）
- [x] **步骤 3：整体门禁** —— `npm run typecheck` ＋ `dotnet build` ＋ `npm test`
  - 验证：全绿 ⇒ 本刀测通，按一需求一刀提交
  - 结果：`npm run typecheck` EXIT=0（node + web）；`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`npm test` **67/67**
- [x] **步骤 4：真机复验（老大侧）** —— 展开一个正在跑的子 Agent 卡片，步骤持续追加时视口应始终停在最新一步
  - ✅ **已通过**（老大 2026-10-09 13:45：「178和179都测试通过了」）

---

## 六、涉及文件

| 文件 | 动作 |
|---|---|
| `src/renderer/src/components/chat/SubAgentCard.tsx` | 修改：`SubAgentStepList` 加 ref + 贴底 effect（**唯一代码改动**） |
| `docs/plans/iter-v2-38/requirements/S-179.md` | 回填：状态头 + 实施记录 |
| `docs/plans/iter-v2-38/plan-s179/` | 本计划 + `compliance_report.md` + `review_report.md` + `verification_report.md` |

**不动**：`SubAgentExecutionDetail.tsx`、`TranscriptMessageList.tsx`（B）、`useMessageListScroll.ts`（C，S-176 地盘）、`sub-agent-slice.ts`。

**参考源码**：无 —— 本仓自有的卡片呈现缺陷，不涉及 OpenCowork / KodaClaw / OpenClaw.net。

---

## 七、刻意不做（写死免得下一轮走回去）

1. **不做「用户手动上滚就不打扰」的门闩（A-2）** —— 那需要记录用户滚动意图，与 S-176 那套已经很复杂的 `autoScrollMode`（`off` / `stream` / `user`）语义相撞。本刀只给「只往下长的日志区」补最贴直觉的默认贴底。老大若要 A-2，另开一刀。
2. **不碰候选 B（详情面板转录）** —— `autoScrollToBottom` 绑 `isRunning` 是有意为之；**已知残留**：排队期 / 已结束时不贴底（S-178 落地后排队期 `isRunning=false`，该窗口会更常见）。属另一处、另一刀。
3. **不碰候选 C（聊天窗主滚动）** —— S-176 地盘，动了就是第三次翻转。
4. **不改 `max-h-[240px]` 的高度** —— 老大 11:31 只要求「让滚动条跟着往下走」。
5. **不引入新依赖**；不新建文件。

---

## 八、待老大确认

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | 容器 = A？ | **已确认**（老大 2026-10-09 11:31：「179 整个函数（:72-139）一行自动滚动都没有…让滚动条跟着往下走」） |
| 2 | 是否要 A-2（手动上滚不打扰）？ | 建议**不做**（见 §七.1），先落最简贴底 |
| 3 | 「展开动画 0.15s 期间首次贴底可能落空」是否接受？ | 步骤是**逐步追加**的，多数贴底发生在展开之后 ⇒ 预期影响很小；真机若发现「展开瞬间没到底」，再加一次性延时兜底（不改本方案结构） |
