# S-197 验证报告（阶段六）

**VERDICT: PARTIAL**

一句话结论：门禁四绿（`typecheck` 0 错 / `npm test` **71/71** / `dotnet build` 0 警告 0 错误；本条不触碰官网故免跑 `website build`），口径四条不变量已由新套件 `tests/composer-status-elapsed`（**30 断言**）钉死，「与操作栏同口径」的对照断言逐档通过；但**核心观感 —— 走字是否真每秒在动、跑工具/等审批/子 Agent 阶段会不会停表、末值与随后操作栏亮出的数字跳不跳字 —— 必须实机肉眼确认** ⇒ **PARTIAL，无 FAIL、无阻断项**。

> 验证者：**主会话**（本需求阶段五审查已由独立 subagent 出具 `plan-s197/review_report.md`；验证由主会话现场跑，证据口径与被举荐的 S-193 报告一致：能跑必须跑、必须有工具证据）。
> 范围：`dev/v2-iter-39`（base `2c925c88`），工作区 HEAD = `11699421`（S-196）+ S-197 **未提交**改动（3 个源码/配置文件 + 1 个新测试目录，攒收尾刀）。
> 基准：`plan-s197/plan.md` + `plan-s197/review_report.md`。

---

## 一、门禁证据

**环境前提**：仓库内**无 dev 实例 / Worker** 命中（打包版在 `C:\Program Files\WishfulClaw\`，不锁仓库 `bin\`）⇒ 门禁可跑，C# 套件执行的是本次编译的产物而非旧 exe。

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **0 错误** | `typecheck:node` / `typecheck:web` 两段均无诊断输出，`exit=0` |
| `npm test` | **71 / 71 通过**（TS 54 + C# 17） | 汇总行 `71/71 通过`；新增 `test:composer-status-elapsed` 在列（0.2s）；C# 17 套件全 ok |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。 0 个警告 0 个错误`，`WishfulClaw.Worker -> …\bin\Debug\net11.0\WishfulClaw.Worker.dll` |
| `cd website; npm run build` | **免跑** | 本条改动**不触碰官网**（仅 renderer 3 文件 + `package.json` + 测试），无回归面 |

与 `plan.md` §四基线一致。**唯一的门禁数变动**：`npm test` 由 **70/70 → 71/71**，增量即本条新注册套件 —— 无既有套件回退。

---

## 二、静态验证（逐改动）

| # | 改动 | 位置 | 验证结论 |
|---|---|---|---|
| 1 | 纯函数 `resolveRunningElapsedLabel` | `lib/format-duration.ts:34-61` | 三条守门（`disabled` / `startedAt == null` / `now <= startedAt`）+ 非有限值兜底，全部 `return null` ⇒ **不会吐出 `0ms`、负数或 `NaNms`**；正常路径直接复用 `formatDurationMs(now − startedAt)`，与操作栏同一函数、同一起点 |
| 2 | selector 带出起点 | `InputArea/composer-status-indicator.tsx:56-58` | `streamingStartedAt = message?.createdAt ?? null`；`message` 由 `streamingMessages[targetSessionId]` 定位（`:39-42`）⇒ 起点与 `isStreaming` **同源**，无新增订阅 |
| 3 | tick | 同文件 `:97-108` | `useState` / `useEffect` 在组件顶层、无条件调用；effect 依赖 `[elapsedStartedAt, messagesOverride]`，`return () => window.clearInterval(timer)` ⇒ 会话切换 / run 结束 / 卸载均清表；`nowTick` **未**进入 `statusView` 的 `useMemo` 依赖（`:216-243`）⇒ 每秒只重渲状态行，不重算整张 `statusView` |
| 4 | 渲染（形态 B） | 同文件 `:258-264` | 耗时段 `shrink-0` ⇒ 长工具名先被截、耗时不被挤掉（裁定①）；`tabular-nums` 防每秒宽度抖动；`aria-hidden="true"` 挡住外层 `aria-live="polite"` 的逐秒播报 |
| 5 | 新套件 | `tests/composer-status-elapsed/program.ts` | 30 断言 / 4 组：守门（含 `NaN` / `Infinity` / 时钟回拨）、**与操作栏同口径对照**（11 档 Δt 逐档断言 `=== formatDurationMs(Δt)`）、单位阶梯（`999ms` / `1.2s` / `12s` / `1m` / `1m5s` / `1h2m`）、口径单一实现 |
| 6 | 注册 | `package.json` `test:composer-status-elapsed` | `run-tests.mjs` 按 `test:*` 前缀自动发现 ⇒ 已进全量门禁，会随 `npm test` 长期跑 |

### 2.1 过程中被实测纠正的一处（记录在案）

纯函数**第一版**放在 `InputArea/utils.ts`，新套件直接跑挂：

```
ReferenceError: window is not defined
  at ElectronIPCClient.on … at chat-store/index.ts → context-compression.ts → agent-bridge.ts
```

`InputArea/utils.ts` 的依赖链会经 `chat-store` 拉进 IPC 层，bundle **2.7 MB**。改放零依赖叶子模块 `lib/format-duration.ts` 后正常，bundle **7.4 kb**。

⇒ 这不只是「测试跑不起来」：它说明**该链路在 node 侧不可加载**，纯口径逻辑放那儿就永远没有单测可能。落点已写进函数注释（`format-duration.ts:42-44`），并有套件第 4 组的路径断言守着（挪走即报错）。

---

## 三、实机验证项（**分级**；PARTIAL 的来源）

### ★ 主干（必须验，决定本条是否真的可用）

| 编号 | 验什么 | 怎么验 | 期望 |
|---|---|---|---|
| **E-1** | 走字本身 | 随便发一条会跑一会儿的消息 | 状态栏状态文案右侧出现耗时，**每秒在动**（`1.2s → 2.3s → …`） |
| **E-2** | **跑工具阶段不停表** | 发一条会调工具的消息 | `Running {{tool}}` 期间**耗时继续走**（这是 §4.5 被推翻后最需确认的一条：开关只挂「起点存在」） |
| **E-3** | 末值衔接 | 记下跑完前最后一个读数，对照操作栏亮出的耗时 | **不跳字**（差值 ≤ 1 个 tick，约 1s） |
| **E-4** | 跑完不保留 | run 结束后看状态栏 | 立即回 `Ready`，**耗时消失**（裁定③） |
| **E-5** | 长工具名 | 触发一次工具名很长的调用（如 `mcp__…` 全名） | 工具名被截断，**耗时仍在**（裁定①的落点） |

### ☆ 次要（顺带看，不阻断）

| 编号 | 验什么 | 期望 |
|---|---|---|
| E-6 | 历史会话回看 | 切到旧会话，状态栏**不走表**、无耗时段 |
| E-7 | 等审批 / 子 Agent 阶段 | 同样持续走字，不停表 |
| E-8 | 多会话并行 | 状态栏耗时只反映**当前会话**，不串会话 |
| E-9 | 超长 run | 跑过 1 小时 → `1h2m` 档观感正常 |

> **为什么这些必须实机**：本次可自动化的只有「什么条件下出数、出什么数」（已钉死 30 条）。而「`setInterval` 在 Electron 渲染进程里是否被节流 / 是否真的每 1000ms 触发」「`shrink-0` 在真实 flex 布局里是否按预期让工具名先让位」「10px + `opacity-70` 的颜色对比度够不够」—— 这三类**没有 node 侧替身**，只能肉眼看。

---

## 四、新发现问题

### 4.1 来自阶段五审查（独立 subagent）

审查已出：`plan-s197/review_report.md`，**✅ 通过（无阻断）**。7 条建议项**全部非阻断** —— 按工作流纪律（「审查/验证发现的问题不逐条提交，全部攒到收尾那一次修复调整提交」）**不在本次提交内修**，全部挂账。

| 编号 | 严重度 | 摘要 | 归属 |
|---|---|---|---|
| S-1 | info | `startedAt === 0` 未被守门拦（注释承诺「不可报荒谬数字」但 0 会漏；**可达性低** —— 流式消息 `createdAt` 恒为 `Date.now()`） | 收尾刀（1 行） |
| S-2 | info（低） | 套件第 4 组用 `includes` 判消费方，遇 barrel 再导出会**误报失败**（实现没坏、测试先红） | 收尾刀（改匹配 import 语句） |
| S-3 | info | 称 `plan.md:32` 落点写 `utils.ts` 与实现不一致 | **已消解** —— 审查读到的是主会话编辑前的版本；`plan.md:32` 现已是 `lib/format-duration.ts` |
| S-4 | info（a11y） | `text-[10px]` 叠 `opacity-70` 对比度 ≈ **1.8:1**，WCAG AA（小字 4.5:1）不达标（即便不加 opacity，父文案本身也仅 ≈2.4:1） | **待老大取舍** —— 属观感，可维持 |
| S-5 | info | `messagesOverride` / `disabled` 分支**当前无调用方** ⇒ 历史回放护栏是死代码（防御性、合理） | 记录在案，不改 |
| S-6 | info | 恢复路径 `session-runtime-sync.ts:103-105` 有瞬态：`isStreaming` 真而 `startedAt` 空 ⇒ 那一拍不显示耗时 | 记录在案，不改（符合「宁可没有」） |
| S-7 | info | effect 依赖字面不含 `sessionId`（与需求 §六-2 措辞不同），实际行为正确 | 记录在案，不改 |

**审查另确认「不是坑」的 4 条**（防我后续误报）：首帧亚秒读数与操作栏用**同一个** `formatDurationMs`，属既定观感；`aria-hidden` 确能挡住 `aria-live` 逐秒播报；形态 B 的 `shrink-0` 在绝对定位 shrink-to-fit 容器里成立；`isStreaming`（prop）与 selector 同源同键。

**审查独立实测出的两条硬证据**（比本报告 §2.1 更细）：

- **落点理由坐实**：`esbuild --bundle --platform=node` 打包对比 —— `InputArea/utils.ts` → **2,812,061 字节 / 内含 30 处 `window.api`**（IPC 链）；`lib/format-duration.ts` → **2,237 字节**。与 §2.1 的 2.7 MB / 7.4 kb 同量级。
- **「Ready 分支低对比度」担忧不可达**：耗时出现 ⟹ `startedAt != null` ⟹ `streamingMessages[sessionId]` 存在 ⟹ `isStreaming` 为真 ⟹ `statusView` 必经 `Thinking`/`Generating`/`Waiting`/工具/审批/重试等非 Ready 分支 —— 二者**不可能同帧共存**。

**审查对三处最担心问题的裁定**：

| 我担心的 | 审查裁定 | 依据 |
|---|---|---|
| `createdAt` 会被 S-196 的 `adjustCompactArtifactTimestamps` 改写导致跳字 | **不会**，零交叉 | 该函数只改 `messages[boundaryIndex]` / `messages[summaryIndex]` 两个**压缩工件**（`chat-store/index.ts:2098-2131`），不碰流式消息 |
| 跑工具 / 等审批 / 重试期间会停表 | **不会** | `request_retry`（`:1761-1779`）只写重试状态、**不清** `streamingMessages`；`loop_end`/error 才删（`:1653-1681` / `:1877-…`），且与回写 `updatedAt` 在**同一次 `set()`** 内 ⇒ run 结束无残留帧 |
| `setStreamingMessageId` 与 `beginUserTurn` 两处写 `streamingMessages` 有分歧 | **无分歧** | `streaming-slice.ts:44-62` 与 `session-slice.ts:730-732` **同为「不覆盖」**；正常发送路径里 push 消息与挂 id 在**同一次 immer `set()`** 内原子完成 |

### 4.2 验证过程本身发现的

| # | 发现 | 定性 |
|---|---|---|
| 4.2-1 | 纯函数若落在 `InputArea/utils.ts` 则 node 侧不可测（§2.1） | **已在实施中修正**，非遗留问题 |
| 4.2-2 | 需求文档 §4.5（「开关必须放宽」）与 §五-2（「整轮 = 含排队」）两处初判**已被证伪**，已在 `S-197.md` §4.7 订正并归档裁定 | **文档订正**，非代码问题 |

---

## 五、汇总

| 项 | 结果 |
|---|---|
| 门禁 | typecheck 0 错 / `npm test` **71/71** / `dotnet build` 0 警告 0 错误 / website 免跑 |
| 静态验证 | 6 项改动逐条核过，含一处被实测纠正的落点（§2.1） |
| 自动化覆盖 | 新套件 **30 断言**，其中 11 条专钉「与操作栏同口径」 |
| 实机项 | **9 条**（★ 主干 5 + ☆ 次要 4），全部待老大验 |
| 阻断项 | **0** |
| FAIL | **0** |
| **VERDICT** | **PARTIAL** —— 静态与门禁全过，实机观感待验 |
