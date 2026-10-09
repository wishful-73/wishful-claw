# 验证报告：plan-s179（阶段六 · 验证态）

> 被验证对象：`docs/plans/iter-v2-38/plan-s179/plan.md`（+ 需求正文 `requirements/S-179.md`）
> 落地形态：工作区未提交改动 —— **1 个源码文件**（`SubAgentCard.tsx`，`16+/1-`）+ 文档
> 验证方式：独立跑门禁（typecheck + C# 编译 + 全量回归）；改动面逐行实读核对；真机部分标 PARTIAL
> 前置：阶段五 `review_report.md` = **❌ 0 / ⚠️ 1 / ℹ️ 7**（唯一 ⚠️ 为注释措辞，已修 ⇒ 放行进验证态）
> 验证时间：2026-10-09
> **真机复验补记（2026-10-09 13:45）**：老大确认「178和179都测试通过了」⇒ §六 三项真机项**全部闭环**，本报告结论由 **PARTIAL 升为 PASS**。

---

## 一、总体结论

**PASS** —— 编译与回归**全绿**（`npm run typecheck` 0 错 / `dotnet build` 0 错 0 警 / `npm test` **67/67** 退出码 0），需求目标在代码路径上成立（步骤追加 ⇒ 240px 视口贴底）；**真机观感已由老大确认通过**（2026-10-09 13:45，plan §五 步骤 4）。

> 说明：验证时点本报告判 **PARTIAL**（真机未做）；真机通过后升级为 **PASS**，其余证据未变。

---

## 二、编译证据

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `npm run typecheck`（`typecheck:node` + `typecheck:web` 两配置） | **0** | 0 错 |
| 2 | `dotnet build src/runtime/WishfulClaw.sln` | **0** | `已成功生成。0 个警告 0 个错误` |

> 注：本刀为纯渲染端 TS 改动，C# 侧零触及；`dotnet build` 仍跑，用于确认迭代级门禁未被污染。

---

## 三、测试证据

### 3.1 总门禁

```
npm test  →  67/67 通过      （ES 51 + C# 16）  退出码 0
```

### 3.2 本需求专项覆盖

**无独立套件，也无新增断言** —— 本刀是「给只往下长的日志区补默认贴底」的纯呈现改动，现有测试基建不含渲染端 DOM / 滚动行为的执行环境（无 jsdom 滚动断言设施）。故验证以**编译 + 回归不破 + 逐行实读**为准，**真机观感**为最终判据。

> 这是本刀与 S-178 的差别：S-178 有 C# 可测层（limiter 并发语义），S-179 没有。**缺口已写明**，不虚构断言。

---

## 四、改动面核对（实读，非推断）

| # | 位置 | 内容 | 核对 |
|---|---|---|---|
| ① | `SubAgentCard.tsx:80` | `const listRef = React.useRef<HTMLDivElement \| null>(null)` | 位于 `:79` `useReducer` 之后、`:96` early return 之前 ⇒ 两渲染路径 hook 数一致（各 3 个） |
| ② | `SubAgentCard.tsx:82-87` | 六行英文注释（含阶段五 ⚠️ 改写后的依赖理由） | 英文，与文件既有注释风格一致 |
| ③ | `SubAgentCard.tsx:88-95` | `useEffect(…, [toolCalls.length])`：`if (!node) return` → `requestAnimationFrame` 内 `node.scrollTop = node.scrollHeight` → cleanup `cancelAnimationFrame` | 依赖只取长度；rAF 规避「追加行尚未布局」；无 setState，无卸载后写入面 |
| ④ | `SubAgentCard.tsx:106` | `<div ref={listRef} className="max-h-[240px] overflow-y-auto px-3 py-1">` | className 逐字未变；同文件 `:204` HoverCard 的 `overflow-y-auto` 未被误挂 |

- `git diff --numstat -- src/` ⇒ `16  1  src/renderer/src/components/chat/SubAgentCard.tsx`（唯一源码改动面）。
- 无新增依赖、无新增 import、无主进程 / 共享层改动、无硬编码路径与密钥。

---

## 五、阶段五 1 条 ⚠️ 的处置

| ⚠️ | 内容 | 处置 |
|---|---|---|
| ⚠️1 | 注释称「`toolCalls` 每次渲染都是新数组引用」**只对回落路径成立**（活路径 `effectiveToolCalls = tracked.toolCalls` 引用可稳定），属过度概括 | **已修** —— `:82-87` 改为「长度变化才是『多了一步』的充要信号；直接依赖数组会沿回落路径每帧触发，并会漏掉原地变更」。**仅改文案、未动代码**；改后复跑 typecheck + 全量回归仍全绿 |

ℹ️ 7 条：6 条无需动作；ℹ️（第 8 条，把裸 `requestAnimationFrame` 统一成 `window.` 前缀）**不取** —— 与同仓三处同型实现行为等价，改动无功能收益。

---

## 六、真机部分（PARTIAL）

| 项 | 状态 |
|---|---|
| 展开一个正在跑的子 Agent 卡片，步骤持续追加时视口始终停在最新一步 | ✅ **已通过**（老大 2026-10-09 13:45） |
| 折叠后再展开 ⇒ 直接落到最新一步（`AnimatePresence` 重挂载触发一次 effect） | ✅ **已通过** |
| 用户主动上滚后是否被强行拉回（A-2 未做，属**已知取舍**，非缺陷） | ✅ 老大未就不打扰提异议 ⇒ 取舍接受 |

---

## 七、结论

- **可提交**：本刀编译 + 回归全绿，需求目标在代码路径上成立（长度变化 ⇒ rAF 贴底，挂载 / 追加两条路径均覆盖）。
- **未闭环项**：真机观感（步骤 4）⇒ **已闭环**（2026-10-09 13:45 老大确认通过）；仅余本需求**无自动化断言**（缺口已写明，非疏漏）。
- **提交口径**：按「一需求一刀」提交 —— 本刀带 `SubAgentCard.tsx` + `requirements/S-179.md` + `plan-s179/plan.md`；`review_report.md` / `verification_report.md` 与迭代级文档一并**攒进收尾刀**。
