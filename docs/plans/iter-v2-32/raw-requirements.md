# iter-v2-32 原始需求登记

> 2026-09-18 建。分支 `dev/v2-iter-32`（base `main` @ `2498dcae`，v0.2.31）。
> 本文件为权威需求文档。本迭代节奏放缓，需求**逐步积攒**，不定收口时间。
> **已立项 10 项**：S-72 agent 运行中「发送」按钮不可用／S-73 会话级「请求上下文上限」开关／S-74 输入框底部工具栏间距过宽／S-75 聊天窗最低宽度保护／S-76 压缩片段重复显示同一个耗时与更新时间／S-77 会话 todo 面板条数累加与单条显示方式／S-78 审批弹窗正文过多时撑出弹窗／S-79 沙箱模式：工具参数的工作目录边界校验／S-80 文件写入的 BOM 处理不一致／S-81 输入框上方多条提示互相遮挡。
> 其余候选见文末「待登记」，**未点名，不擅自排入**。
> 勘测行号均为 2026-09-18 实读。

---

## S-72 agent 运行中「发送」按钮不可用，只能回车排队

**一句话**：agent 正在跑的时候，输入框有内容也只能按回车送进队列，右侧那颗按钮被锁死成「终止」；应当**有内容→发送（排队）、无内容→终止**。

### 现象（老大 2026-09-18 口述）

> 「当前 agent 执行中我们也是可以发送消息进队列的，这里有个瑕疵，就是我们的按钮还是显示的是中断还是终止，用户只能回车发送消息，不能点击按钮，所以在输入框有值的情况下，就算 agent 在运行中也应该是发送，没有值才是中断」

### 勘测（2026-09-18）

按钮语义分流只有**一个点**：

- `src/renderer/src/components/chat/InputArea/composer-toolbar.tsx:180-220` 的 `sendControl`
  - `:191` `onClick={isStreaming ? () => onStop?.() : onSend}` ← 唯一分流
  - `:192-200` `disabled`：`isStreaming` 时**恒 false**（可点，但点了是 stop）
  - `:201-213` 文案/图标：`isStreaming` → 转圈 + `action.stop`；否则 → `action.send` / `action.start` + `Send`
  - `:187` `data-tone={isStreaming ? 'warning' : undefined}`

**判据已齐**：同一处的 `disabled` 非流式分支已经用了 `!finalSerializedText.trim() && attachedImagesCount === 0` —— 正是「有无内容」的现成判据，改成流式下复用即可。

**回车路径是通的**：`index.tsx:268` `onSend?.(message, ...)`，上游 `use-chat-actions` → `chat-store.sendMessage` 内部判忙入队（iter-30 S-58 那次修复打的地基），所以「有内容点按钮」应走同一条路，不新增通道。

### 待核实（实施前）

1. `handleSend`（`index.tsx:268` 附近 → `use-composer-interactions.ts`）在 `isStreaming` 时是否被自身拦截或清稿行为异常 —— 需确认点按钮与回车**完全同路径**（同一函数、同样清稿）。
2. 流式期间点发送后，输入框是否应清空并进队列面板（对齐回车行为）。
3. 「有附件无文字」算不算有内容（现有 `disabled` 判据把图片算进去，倾向沿用）。

### 实施（2026-09-18）

三条待核实全部实测确认：

1. **点按钮与回车完全同路径** —— `composer-toolbar` 的 `onSend` 就是 `index.tsx:249` 的 `handleSend`，回车走 `use-composer-keydown.ts:123` 调的是同一个函数；`handleSend` 内部**不判 `isStreaming`**（`index.tsx:258-259` 只挡空内容、`disabled`、缺工作目录、图片读取中），所以流式下点按钮与回车行为一致，清稿（`resetComposer()`）也一致。
2. 输入框清空并入队 —— 由 `handleSend` → `use-chat-actions` → `chat-store.sendMessage` 内部判忙入队（iter-30 S-58 地基）承担，本次未新增通道。
3. 「有附件无文字」算有内容 —— 沿用原判据，图片也计入。

改动仅在 `src/renderer/src/components/chat/InputArea/composer-toolbar.tsx` 的 `sendControl`：

- 新增两个派生值：`hasSendableContent = Boolean(finalSerializedText.trim()) || attachedImagesCount > 0`；`isStopAction = isStreaming && !hasSendableContent`。
- 原 `isStreaming` 在按钮上的四处用途（`data-tone` / `onClick` / `disabled` 分流 / 文案与 tooltip）**全部换成 `isStopAction`**，语义从「是否在跑」变为「这一下是不是要终止」。
- `disabled` 判据结构不变：`isStopAction ? false : (!hasSendableContent || disabled || needsWorkingFolder || pendingImageReads > 0 || isOptimizingLocked)` —— 非流式路径与原 `!finalSerializedText.trim() && attachedImagesCount === 0` 逐字等价，无行为变化。

门禁：`npx tsc --noEmit` 三配置 `WEB=0 NODE=0 ROOT=0`；全量 `test*` 脚本 **31/31** 通过；文件 BOM=False。

---

## S-73 新增「请求上下文上限」开关（超阈值自动压缩，控成本）

**一句话**：加一个开关，开启后**所有模型的请求上下文封顶在一个绝对值**（老大口述 265K），到阈值就触发压缩 —— 上下文越大越费钱，给上限后整体更省。

### 需求（老大 2026-09-18 口述）

> 「我希望加一个开关，开启后所有的模型请求上下文最大 265K，这样的好处如下，上下文越大越费钱，给上限后，到达阈值会压缩，这样整体使用上相对便宜点，先记录，然后你可以探索，我们不着急做功能了」

**追加口径（同日）**：**开关是会话级别，不需要全局** —— 即不做成 `settings-store` 里的全局设置项，而是跟随单个会话（参考 S-59 权限档那种「挂在会话上、工具栏可切」的形态）。

**核心语义澄清（老大 2026-09-18 13:39）**：

> 「S-73 的主要目的是强制将上限降低，本来是 1M 的 正常我们会渲染端和后端都会看到 1M 上下文，强制上限变成 256K，简单来说就是为了实惠，降低消费」

⇒ ① **上限值 = 256K**（「265K」系笔误，已确认）。
② 这**不是**「把压缩阈值提前」，而是把模型的**有效上下文窗口本身**改成 `min(模型真实 contextLength, 256K)` —— **渲染端与后端必须看到同一个数**：1M 的模型开启后，两边都按 256K 算、也都在界面上显示 256K。

**生效范围与显示分层（老大 2026-09-18 13:41 确认）**：

> 「有些模型本身上下文就比较小，比这个值更小的就保持原值，比这个大的，如果开关开了才生效。目前还不知道放哪个位置 你的理解是对的」

③ **生效范围**：只对**真实窗口 > 256K** 的模型生效；模型本身窗口 ≤ 256K 的（如 128K 的模型）**保持原值不动**。即有效窗口 = `min(真实 contextLength, 256K)`，开不开开关都适用此式。
④ **显示分层**（已确认）：模型**档案**里的 `contextLength`（`ModelSwitcher/model-info.tsx`、`model-management-row.tsx`、`ProviderConfigPanel.tsx`）**保持真值** —— 那是「这模型支持多少」；运行时**有效窗口**（`context-ring.tsx` → `getEffectiveContextWindow`）才跟着变 256K —— 那是「这次实际用多少」。两个概念不混。
⑤ **开关入口位置**：**未定** —— 老大原话「目前还不知道放哪个位置」，实施前需回来定。

### 勘测（2026-09-18）

现有机制**是按模型自身窗口乘比例**触发，没有**绝对上限**：

- 设置项：`settings-store.ts:144-146` `contextCompressionEnabled`（默认 `true`）、`contextCompressionThreshold`（默认 `0.8`，钳制 0.3~1，见 `settings-store-migrate.ts:152-159`）
- `contextLength` 来源 = provider 配置字典里的模型字段，**fallback** `DefaultContextCompressionLimit = 200_000`（`ContextCompression.cs:50`）
- 触发算：`effectiveWindow = contextLength - DefaultContextCompressionReservedOutputTokens`，再乘 `thresholdRatio`（`AgentLoop.ContextCompression.cs:38-40`、`AgentLoop.cs:658-685`）

**四处独立读 `contextLength`**（改 cap 必须一并罩住，否则行为不一致）：

| 文件:行 | 用途 |
|---|---|
| `AgentLoop.ContextCompression.cs:38` | 压缩判定 |
| `AgentLoop.cs:658` | 压缩判定（另一条路）+ 诊断日志 |
| `ContextCompression.cs:282` | 压缩目标预算（`maxByWin = contextLength * 0.5`） |
| `ContextCompression.cs:350` | 首条用户消息保留预算（`PinnedFirstUserWindowFrac`） |

### 待探索 / 待定（不着急）

1. **cap 的施加点**：`effectiveWindow = min(模型 contextLength, cap)` 在四处夹心，还是把 cap 合成「虚拟 contextLength」在读取层统一替换 —— 后者改动面更小、四条读取点零改动。
2. **会话级开关怎么落**（新口径）：
   - 存哪 —— session 字段（DB 加列，跟着会话走、重启还在）还是 per-session 内存（`useUIStore`，只影响本次运行）。S-59 的 `permissionMode` 走的是会话字段，可比照。**我倾向落库**（持久设定，重启丢掉会被当成没生效）。
   - **UI 入口 —— 未定**（老大「目前还不知道放哪个位置」）。候选：① 输入框工具栏（与权限档并列）② `InputArea/context-ring.tsx`（上下文用量环，语义最近，我倾向）③ 会话设置弹窗。
   - 现有 `contextCompressionEnabled` / `contextCompressionThreshold` 是**全局** settings（9 处复制透传，见下），会话级 cap 是**第二条链**还是并进同一条 —— 需定性。
3. **纯会话级 ≠ 复用全局链**：现行 run params 透传点有 9 处（`use-chat-actions.ts` ×4、`use-channel-auto-reply.ts`、`use-background-subagent-wakeup.ts`、`provider-auto-fallback.ts`、`project-send-message.ts`、`chat-store/index.ts`）。会话级字段若也走这条路，同样要在这 9 处补；是否有更省的挂法（如塞进已有的 session 参数对象）需勘。
4. **默认态与取值**：新会话默认关（保持现状）还是开；上限**固定 256K**（已定），是否另给下拉（如 128K / 256K）待定。
5. **与 `contextCompressionEnabled` 的关系（已定性）**：cap **不是**压缩阈值提前，而是**有效窗口本身变小**（`min(真实 contextLength, 256K)`）。压缩逻辑照旧按比例跑，只是分母换了；即便全局压缩被关，cap 依然成立 —— 它就是窗口本身。
6. **副作用**：cap 低于模型真实窗口时，超长单轮（如大文件贴入）会立刻触发压缩/截断，需确认可接受。
7. **渲染端一致性**：`context-ring.tsx:35-60` 与 `lib/agent/context-compression.ts` 都在算阈值，cap 生效后两侧必须同口径，否则环上显示的百分比会与实际触发点不符。

### 实施（2026-09-18）

**cap 施加点选「合成虚拟 contextLength」** —— 在 provider 定稿后克隆一份、把 `contextLength` 夹到上限，四条读取点（`AgentLoop.cs:658` `ShouldCompress`、`AgentLoop.ContextCompression.cs:38` `ManualCompressionValueFloorTokens`、`ContextCompression.cs:282` 尾部预算、`:350` 钉住预算）**零改动**，天然同口径。逐处夹心要改四处，将来再有第五处读取点就漏。

**Worker 侧（3 文件）**
- `AgentLoop.cs` 新增 `internal const int SessionContextCapTokens = 256 * 1024`；`ExecuteLoopAsync` 在 persona 提示词注入后加一行 `provider = ApplyContextCap(provider, JsonHelpers.GetBool(parameters, "contextCapEnabled", false))`。
- `AgentLoop.Helpers.cs` 新增 `ApplyContextCap(provider, enabled)`：关闭、或模型窗口 ≤ 上限、或未声明 `contextLength` 时**原样返回**（连对象都不重建）；否则照 `InjectSystemPrompt` 的写法重建 JSON，只替换 `contextLength`。

**会话级落库（4 文件）**
- `DbClient.cs`：`EnsureColumn("sessions", "context_cap_enabled", "INTEGER")`（缺省 NULL = 关）。
- `Entities/SessionEntity.cs`：`SessionEntity` / `SessionRow` 各加 `ContextCapEnabled`（int 0/1），`FromEntity` 转发。
- `EntityMappers.cs`：`MapSession` 用 `GetBoolAsInt`（0/1 且容忍 NULL）。
- `DbSessionTools.cs`：Create 的 INSERT、Update 的 UPDATE、`ReadSessionInput`、`ApplySessionPatch` 四处补齐 —— 缺任一处，开关点完一存就丢。

**渲染端**
- `lib/session-context.ts`：归一化加 `contextCapEnabled`（**只有显式 true 才算开**，其余一律关）。
- `stores/chat-store/types.ts`：`Session` 加必填 `contextCapEnabled`、`CreateSessionOptions` 加可选同名项、`createRestorableSessionSnapshot` 转发。
- `stores/chat-store/db-helpers.ts`：`SessionRow` 接口、迁移判定、`rowToSession`、`dbCreateSession`、`dbUpdateSession` 五处。
- `stores/chat-store/session-slice.ts`：`createSession` 透传 + 新增 `updateSessionContextCap(id, enabled)`（走同一套归一化与落库）。
- `lib/agent/context-compression-config.ts`：新增 `SESSION_CONTEXT_CAP_TOKENS = 256 * 1024`（注释写明与 Worker 常量必须同值）与 `applySessionContextCap(contextLength, enabled)`；`lib/agent/context-compression.ts` re-export。
- `components/chat/InputArea/context-ring.tsx`：环的有效窗口改 `applySessionContextCap(resolveCompressionContextLength(...), session.contextCapEnabled)`；**UI 入口就落在这个环上** —— 外面包一层 `DropdownMenu`（hover 仍是原提示、双击仍是压缩），菜单里一项 `DropdownMenuCheckboxItem` 切上限、一项「立即压缩上下文」。**模型档案里的 `contextLength` 不动**，只有运行期窗口变。
- run params 透传 8 个调用点补 `contextCapEnabled`：`hooks/use-chat-actions.ts` ×4、`hooks/use-channel-auto-reply.ts`、`hooks/use-background-subagent-wakeup.ts`、`lib/agent/provider-auto-fallback.ts`、`lib/tools/project-send-message.ts`；`stores/chat-store/index.ts` 的 `SendMessageRequest` 加字段。
- locale zh/en `chat.json`：`input.contextCapToggle` / `input.compressContextNow`。

**默认态**：关（V2）。**取值**：固定 256K，无下拉（V6）。

**测试**
- 新增 `tests/WishfulClaw.SessionTaskCascadeRegressionTests/SessionContextCapTests.cs`（`RunSessionContextCapSuite`）：创建带/不带开关、patch 开与关、改别的字段不冲掉开关、`MapSession` 与 `SessionRow` 读回。
- 新增 `tests/WishfulClaw.GoalRegressionTests/Program.ContextCap.cs`（`RunContextCapSuite`）：关着不动、1M 夹到 256K、128K 保持、未声明 `contextLength` 不新增字段、其余字段保留、恰好等于上限不改写。

**门禁**：Worker 与 tests.sln 各 0 警告 0 错误；C# 回归 **10/10**；typecheck 三配置 `WEB=0 NODE=0 ROOT=0`；全量 `test*` **31/31**；触碰文件 BOM clean。

**真机待验**（需 `npm run dev:full` 重编 Worker）：1M 模型开启后环显示 256K、到阈值触发压缩；关闭后恢复 1M；重启后开关仍在。

---

## S-74 输入框底部工具栏控件间距过宽

**一句话**：协作模式、模型选择器、人设等控件本身都带 `px-2`，toolbar 又叠了一层 `gap-2`，两个控件之间视觉距离约 24px，看着散。

### 需求（老大 2026-09-18 口述）

> 「然后输入框 底部的按钮这些我希望把间距收一下，本身协作模式啊 模型选择器啊，他们本身就有pading 现在就看起来距离特别远」

### 勘测（2026-09-18）

容器：`components/chat/InputArea/composer-toolbar.tsx`

| 位置 | 现状 |
|---|---|
| `:225` 外层 | `flex items-center justify-between gap-2 px-2 pb-2` |
| `:228` 左侧组（协作模式 / 模型 / 人设 / 技能 / 文件夹） | `flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pr-1` |
| `:253` 右侧组（上下文环 / 清空 / 优化 / 权限 / 发送） | `flex shrink-0 items-center gap-1.5` |

各控件自带水平内边距（这就是「本身就有 padding」）：

| 控件 | 自带 class |
|---|---|
| `CollabModeSwitcher.tsx:87` | `h-8 gap-1.5 rounded-lg px-2` |
| `ModelSwitcher.tsx:270`（trigger） | `h-8 max-w-56 gap-1.5 rounded-l-lg px-2`（外层容器 `:263` 另有 `rounded-lg border`） |
| `PersonaSwitcher.tsx:68` | `gap-1 rounded px-2 py-1` |
| 图标按钮 | `composerIconControlClass = 'composer-control rounded-xl'`（`InputArea/index.tsx:291`），`.composer-control` 在 `assets/main.css:426+` **只管颜色/背景/阴影，无 padding** ⇒ 其内边距来自 `Button size="icon-sm"` |

⇒ 相邻两控件实测视觉间距 = `gap`(8px) + 左控件右 `px-2`(8px) + 右控件左 `px-2`(8px) ≈ **24px**。

### 改法方向（值待真机定）

把 toolbar 的 gap 收到接近 0，让控件自身的 `px-2` 承担分隔（这正是老大说的「他们本身就有 padding」）。落点就是上表三处 gap；`icon-sm` 按钮之间没有 `px-2` 兜底，右侧组可能得留一点，需分别定而不是一刀切。

**注意**：左侧组是 `overflow-x-auto` 横向滚动容器，gap 收到 0 后触控/点击热区会相邻，需确认相邻控件的 hover 底色块不粘连。

---

## S-75 聊天窗最低宽度保护：挤到下限时自动收起另一侧面板

**一句话**：给聊天窗区域设一个最低宽度；两侧面板谁把聊天窗挤到这个下限，就自动收起另一侧面板（展开右侧挤到下限 → 收左侧；展开左侧挤到下限 → 收右侧）。

### 需求（老大 2026-09-18 口述）

> 「假设在点开右侧面板的时候，聊天窗区域不太够了，给聊天窗区域一个最低宽度，如果聊天窗到这个宽度了，就收起左侧面板。反过来也是一样，如果用户这时候选择展开左侧面板，挤压到聊天窗区域宽度不够，收起右侧面板」

### 勘测（2026-09-18）

**布局链**（`components/layout/MainLayout.tsx:160-176`）：

```
:160  <div className="flex h-screen overflow-hidden bg-background">
:162    <WorkspaceSidebar />                                    ← 左侧面板
:165    <div className="flex min-w-0 flex-1 flex-col">
:168      <div className="flex min-h-0 flex-1 overflow-hidden">
:170        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">   ← 聊天窗区域
:175        <RightPanel />                                     ← 右侧面板
```

**关键事实：聊天窗侧**（`:170`）是 `min-w-0 flex-1` —— **没有任何最小宽度约束**，两侧面板一路挤压它就一路缩小，可以趋近 0。这就是本需求要补的那一块。

**两侧宽度都是可拖的**（`components/layout/right-panel-defs.ts`）：

| 常量 | 值 |
|---|---|
| `LEFT_SIDEBAR_DEFAULT_WIDTH` / `MIN` / `MAX` | 292 / 272 / 420 |
| `RIGHT_PANEL_DEFAULT_WIDTH` / `MIN` | 384 / 280 |
| `RIGHT_PANEL_MAX_WIDTH` / `MAX_WIDTH_RATIO` | ∞ / **0.8（视口比例）** |
| `RIGHT_PANEL_RAIL_WIDTH` / `RAIL_SLIM_WIDTH` | 48 / 12 |

- 右侧面板渲染用 `style={{ width: rightPanelOpen ? targetPanelWidth : 0 }}`（`RightPanel.tsx:226`），宽度经 `clampRightPanelWidth`（`:19-26`，上限 = `min(∞, viewport*0.8)`）
- 开关状态在 `useUIStore`：`leftSidebarOpen` / `setLeftSidebarOpen`、`rightPanelOpen` / `setRightPanelOpen`、`rightPanelWidth` / `setRightPanelWidth`

### 老大裁定（2026-09-18 13:53 / 13:54 / 13:55）

> 13:53「拖拽也触发呀，从 视口 × 0.8 改成 视口 − 左侧(若开) − 聊天窗最低宽度」
> 13:54「从 视口 × 0.8 改成 视口 − 聊天窗最低宽度 **这个才对吧**，左侧如果开了，我可以继续拖拽直到左侧关掉呀」
> 13:55「聊天窗的最低宽度就是**不能输入框出现滚动条**」

- **② 拖拽也触发** —— 已定。拖拽路径（`RightPanel.tsx:143`）与展开/收起路径**走同一套判定**，不再只在开关时判。
- **③ 上限改算法** —— 已定，口径 `视口 − 聊天窗最低宽度`（**不减去左侧**）。理由（老大 13:54 的自我更正，我的第一版算式是多余的）：左侧若开着，继续拖拽右侧会把聊天窗挤到下限 → **触发规则自动收掉左侧** → 聊天窗宽度够了 → 右侧可以接着拖。**左侧由「挤到下限就收另一侧」这条动态规则解决，不该在算式里静态预留**；写进算式反而会让「左侧开着时右侧被莫名限制住」。
  实现（若下面选 B）：`clampRightPanelWidth` 上限由 `min(∞, 视口 × 0.8)` 改为 `视口 − 最低宽度`；`0.8` 退居兜底（留作兜底还是直接移除，实施时定）。
- **④ 「最低宽度」的判据已定（13:55）** —— **不是拍一个数字，是「输入框不出现横向滚动条」**。（此前文档里我建议的 560px 作废。）
  输入框里先被挤的是哪块：`InputArea/composer-toolbar.tsx:228` 工具栏左侧组 `flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pr-1 [scrollbar-width:none]` —— **它是先被压缩的那块**（滚动条已被 `[scrollbar-width:none]` 藏掉，用户实际看到的是控件被裁掉），右侧组 `shrink-0`（`composer-toolbar.tsx:253`）不动；再往上横幅（`composer-banners.tsx`）、排队面板、待办面板（均带 `composerWidthClass`）同样先挤。
  ⇒ 落地形态 = **横向溢出检测**，观测点取输入框整块（`index.tsx:296` 的 `rootRef`，含上述所有子块）：
  ```
  输入框整块.scrollWidth > 输入框整块.clientWidth   →   挤到了
  ```
  它是客观信号，跟着内容自动变（模型名长短、有无附件条 `image-preview-strip.tsx:34`、协作模式/权限控件显不显示、中英文文案宽度差）—— 这正是写死数字必然失准的地方。

### 老大补充（2026-09-18 13:56）：这排控件的构成与「贴一起」现象

> 「目前我们协作模式 模型选择器 人格选择器 额外功能 右侧 压缩百分比 yolo 发送按钮。他们中间区域可以没有 但是贴一起就出现滚动条了」

排布（`composer-toolbar.tsx:227` 内层 `flex w-full items-center justify-between gap-2`）：

| 位置 | 控件 | 容器 |
|---|---|---|
| 左 | 协作模式 / 模型选择器 / 人格选择器 / 额外功能（SkillsMenu）/ 文件夹 | `:228` 左侧组 `flex min-w-0 flex-1 gap-2 overflow-x-auto pr-1 [scrollbar-width:none]` |
| 右 | 压缩百分比（ContextRing）/ 清空 / 优化 / YOLO（权限）/ 发送 | `:253` 右侧组 `flex shrink-0 gap-1.5` |

- **中间那段空白是弹性区、先被吃** ⇒ 阈值 = **控件自然总宽 + 必要间距**，低于它才溢出。这同时说明 **A（被动检测）不会误判**：吃空白阶段不产生滚动条，只有吃到控件本身才溢出。
- **检测点收窄到工具栏这一行**（`:225`），**不取 `index.tsx:296` 的 `rootRef`**：输入框里还有横幅 / 排队面板 / 待办面板，那些内容长度不可控（一句长待办标题就能溢出），混进来会把「窗口太窄」和「内容太长」算成一回事。
- **与 S-74 强耦合**：相邻控件视觉间距 = gap `8` + 左控件 `px-2` `8` + 右控件 `px-2` `8` = **24px**，左侧 5 个控件即 4 × 24 ≈ **96px**。**S-74 收窄间距 = 直接降低 S-75 的阈值**。⇒ 实施顺序 **先 S-74 再 S-75**（否则阈值算出来是虚的）；若 S-75 走 A（动态检测）则天然免疫这一变化。
- **滚动条来源已查明（2026-09-18 13:58，老大判断「就是左侧那组出来的」）**：左侧组那层 `[scrollbar-width:none]` **大概率没生效**。
  机制：`assets/main.css:302-305` 有一条**裸写在 `@layer` 外**的全局伪元素规则
  ```css
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ```
  Chromium 下自定义 `::-webkit-scrollbar` 会让标准 `scrollbar-width` 被忽略（legacy 伪元素优先）⇒ `composer-toolbar.tsx:228` 的 `[scrollbar-width:none]` 形同虚设，左侧组溢出时横向滚动条照常出现。
  **注意这跟 CSS 优先级无关**：`[scrollbar-width:none]`（layer 外）本身已经赢过 `main.css:289` 的 `* { scrollbar-width: thin }`（`@layer base` 内）—— 失效发生在「webkit 伪元素 vs 标准属性」这一层，不是选择器权重。
  连带代价：`height: 5px` 的横向滚动条**会占位**，挤压时把工具栏行撑高 5px（控件随之上移）。
  **验证方法**：devtools 选中那个 div → 手动加 `scrollbar-width: none` 看滚动条是否还在；或直接看 Computed 里的 `scrollbar-width`。
  **待老大定**：这条修不修、算 S-75 的一部分（它就是现象来源）还是单独立条。若把隐藏修好，S-75 的判据就应转为「控件不被裁」（`scrollWidth > clientWidth`）—— 因为**滚动条没了 ≠ 控件不丢**，被裁的控件照样点不到。

### 触发方式已定（2026-09-18 13:59）：固定默认最低值，不做动态检测

> 「其实这里给个默认最低值就行」

- **放弃**动态路线（溢出检测 / 运行时实测值两条都不要），改回**常量**：聊天窗区域给一个默认最低宽度，低于它就收另一侧。简单、可预测、没有测量时序问题。
- **但该常量有硬约束**：必须 **≥ 输入框的自然宽度**，否则判据（不出滚动条）自己就破了 ⇒ 取值方向 **宁大勿小**（取大了只是面板早点被收；取小了输入框照样挤，等于没做）。
- **量级估算**（按现间距粗估，误差 ±100px 量级，须真机校准）：

  | 段 | 宽度 |
  |---|---|
  | 左侧组 5 控件 + 4 × `gap-2` | ≈ 434px |
  | 右侧组 5 控件 + 4 × `gap-1.5` | ≈ 318px |
  | 工具栏 `gap-2` + `px-2` | ≈ 24px |
  | `rootRef` `px-4` 左右 | 32px |
  | **输入框所需合计** | **≈ 800px** |

  ⇒ **聊天窗最低宽度 ≈ 800px 量级**（S-74 收窄间距后约少 50~60px）。
- **副作用须老大知悉**：这个数不小 —— 1366px 屏上左右面板同开（272 + 280 + 800 ≈ 1352）几乎必然触发收面板。**这是「输入框不出滚动条」这条判据的必然结果，不是实现问题**；若嫌激进，只能放宽判据（例如接受控件被裁，只保证不出现滚动条本身）。
- **校准方法**：真机把窗口拖到输入框刚出滚动条，量聊天窗区域宽度，即得准数。

### 边界情况（实施时必须处理）

1. **左右对称** —— 左侧现在固定 `MAX = 420`，与聊天窗无关，单独拖宽（右侧已关）也能挤爆聊天窗。若选 **B**，左侧上限按同一口径取 `min(420, 视口 − 最低宽度)`；若选 **A**（纯检测），两侧都不设上限，由「收另一方」覆盖。
2. **「没得收」的退化分支**：两侧都关 / 只剩一侧可收、且视口本身就窄到放不下时（按现常量约 <1260px 同时开就紧张），数学上无解。倾向 **保持现状不再动**（无处可收，硬折腾只会抖动）；退化路径行为要明确，不能出现「两边互相收」或抖动。

---

### 实施（2026-09-18）

**落点 1 —— `src/renderer/src/components/layout/right-panel-defs.ts`**

- 新增 `export const CHAT_MIN_WIDTH = 800`（按上表粗估，**待真机校准**）。
- 新增私有 `panelBudget()` = `window.innerWidth - CHAT_MIN_WIDTH`；视口不可知（SSR / `innerWidth` 非正）时返回 `Infinity`，退化为「不限制」，避免无窗口环境下把面板宽度钳成 0。
- `clampLeftSidebarWidth` 上限：`420` → `min(420, panelBudget())`，补上「边界情况 1」里左侧固定 420 那条隐患。
- `clampRightPanelWidth` 上限：`min(∞, 视口 × 0.8)` → `min(∞, panelBudget(), 视口 × 0.8)`。`0.8` 按原裁定**留作兜底**，未移除。
- 新增纯函数 `resolveChatWidthGuard({ changed, leftOpen, leftWidth, rightOpen, rightWidth }): 'left' | 'right' | null`：
  `used = 开着的两侧宽度之和`；`used + CHAT_MIN_WIDTH <= 视口` ⇒ `null`（不动）；否则返回**另一侧**，但**只在另一侧确实开着时**才返回，否则也 `null`（无处可收就保持现状 —— 对应「边界情况 2」的退化分支，不来回抖动）。

**落点 2 —— `src/renderer/src/stores/ui-store.ts`**

- 新增 `yieldIfChatSqueezed(state, changed, width)`：把本次动作填进 `resolveChatWidthGuard` 的入参 —— **被操作的那一侧按「已展开」计**（它正在开 / 正在被拖），另一侧取当前 store 状态；返回 `{ leftSidebarOpen: false }` / `{ rightPanelOpen: false }` / `{}`。
  （初版把两侧都按「已展开」传，导致「另一侧本来就没开」时也返回它，退化分支失效；改为按 `changed` 区分后修复。）
- 新增 `openLeftSidebarWithGuard(state)` / `openRightPanelWithGuard(state)`：`{ 该侧: true, ...yieldIfChatSqueezed(...) }`。
- 接入 8 个动作，**展开路径与拖拽路径共用同一判定**（对应裁定 ②）：

  | 动作 | 处理 |
  |---|---|
  | `toggleLeftSidebar` | 关闭不动；展开走 `openLeftSidebarWithGuard` |
  | `setLeftSidebarOpen` | 同上 |
  | `setLeftSidebarWidth` | clamp 后过 `yieldIfChatSqueezed(state, 'left', nextWidth)` |
  | `toggleRightPanel` | 关闭不动；展开走 `openRightPanelWithGuard` |
  | `setRightPanelOpen` | 同上 |
  | `setRightPanelWidth` | clamp 后过 `yieldIfChatSqueezed(state, 'right', nextWidth)` |
  | `setActiveNavItem` | 点导航栏会展开左栏，同样走 `openLeftSidebarWithGuard` |
  | `closeFreeChatPage` | 退出免费对话页会强制展开左栏，同样走 `openLeftSidebarWithGuard` |

**门禁**：`tsc --noEmit` 三配置 `WEB=0 / NODE=0 / ROOT=0`；`npm run test*` 30 个脚本全过。

**遗留**：`CHAT_MIN_WIDTH = 800` 是估算值，须真机校准（把窗口拖到输入框刚出横向滚动条，量聊天窗区域实际宽度）。

---

## S-76 压缩切分出的 assistant 片段，每段都显示同一个耗时与更新时间

**现象（老大 2026-09-18 14:07 原话）**：

> 「我们上个版本增加了 agent 回复耗时，但是在执行过程中，假设是长时间的任务，会出现上下文压缩，压缩一次就会多一个折叠块，现在每个折叠块下的耗时和更新时间都是同一个」

**根因（已定位，证据链完整）**：

1. 上下文压缩会在**正在流式的那条 assistant 消息**里插一个切点 —— `renderable-chat-items.ts:350` 的 `anchoredPairsByAssistantId` 分支，锚点 `displayAnchor.assistantMessageId` 指向当前消息。
2. `createAssistantFragment`（`:173-200`）按切点把消息切成若干段，**每段是独立的 `kind: 'message'` 渲染项**：
   ```ts
   message: { ...message, id, content },   // ← 浅拷贝整条消息
   fragment: { position, operationId }
   ```
   ⇒ **每段都带着同一条底层消息的 `createdAt` / `updatedAt`**。
3. 一次压缩净增 1 段（切点前 fragment + 压缩卡 + 切点后 fragment），这就是老大说的「压缩一次多一个折叠块」。
4. 每段都走完整 `AssistantMessage` → `AssistantActionBar`（`AssistantMessage/index.tsx:452`），所以**每段下方各渲染一套「耗时 · 更新时间」**。
5. S-54 的耗时/更新时间取的就是 message 上的 `createdAt`/`updatedAt`，而所有片段共享同一个 message ⇒ **值必然完全相同**。

**定性**：这不是压缩的 bug，是 **S-54 的时间显示挂错了层级**。`fragment` 是渲染层人为造的切片，**不是真实的消息边界**，它没有自己的时间。

**修法**：

- **C（老大 2026-09-18 14:14 采纳）**：每段的时间取**对应那一刀压缩的时间** —— 见下节。
- **A（备选，未采纳）**：时间只出现在该消息最后一段，中间段不显示。判据用现成的 `item.fragment`（`position === 'before'` 的中间段不显示），落点 `MessageItem.tsx:218-219` 或新增 `isFragmentTail` prop。

**更正一处我先前的错误判断**：上一版我写「数据里没有切点时间，只能造假」—— **错了**。压缩工件对自带 `createdAt`，切点时间有真实来源，不需要编。

**老大补充口径（2026-09-18 14:14）**：

> 「这种可以取压缩的创建时间作为更新时间不，主要是被压缩破坏的，也应该由压缩来补上」

**可行，且数据现成**：压缩工件对自带 `createdAt` —— `lib/agent/context-compression.ts:92` 已经在用它给压缩对排序打分（`Math.max(boundary.createdAt, summary.createdAt)`），语义就是「这一刀发生在什么时候」。渲染端另有 `status.completedAt`（`CompressionStatusMessage.tsx:45`）可用。

**但只把 `updatedAt` 换成压缩时间会引出新毛病**：耗时 = `updatedAt − createdAt`。若 `createdAt` 仍复制原消息的创建时间，第 2 段显示的就成了「从消息开始到第 2 刀」的**累计**时长，看起来像耗时在膨胀。

**自洽的窗口 = 首尾相接**（建议）：

| 段 | 显示时间（`updatedAt`） | 耗时 |
|---|---|---|
| 第 1 段 | 第 1 刀的时间 | 消息创建 → 第 1 刀 |
| 第 2 段 | 第 2 刀的时间 | 第 1 刀 → 第 2 刀 |
| …… | …… | …… |
| 末段（`after`） | 消息结束时间（**不变**） | 最后一刀 → 结束 |

⇒ `createdAt` 也要跟着前移，取上一刀的时间。这样每段就是「这一段时间」，相邻段首尾相接、不重不漏。成本几乎为零：`splits` 已按 `splitAt` 排过序（`renderable-chat-items.ts:364`），顺扫一遍即可。

**边界**：压缩时间取不到时（`completedAt` 缺失）该段退化为原复制值，实现时兜住，不影响其它段；`live` 段（压缩进行中）可用 `liveState.startedAt`（`renderable-chat-items.ts:336`）。

**已定（2026-09-18 14:17）**：

> 「这种应该是只存在压缩的才需要这么处理，其它的正常就行，你说的要自洽我认同」

- 采纳**首尾相接**的窗口（上表）。
- **作用范围仅限被压缩切分过的消息**；没有压缩的消息行为**完全不变**。
- 这一点在实现上**天然成立、无需额外判断**：没有切点时 `splits` 为空 ⇒ 不产生 fragment ⇒ 走到 `renderable-chat-items.ts:434` 的 `appendMessage(message)`，消息原样进列表。**只有 `splits` 非空（＝确有压缩）时才进 fragment 分支**（`:350-435`）。所以新窗口只作用在片段上，普通消息零影响。

**补充（2026-09-18 14:19）**：

> 「最后一段 你可以加个总耗时，只在有压缩时出现，也就是有压缩的，有纯分段时长，也有总时长」

- **末段显示两个耗时**：本段时长 ＋ **整轮总时长**。总时长 = 消息 `createdAt` → `updatedAt`，**就是 S-54 原本算的那个值，不必新算**。
- **只在有压缩（确有切分）时出现总耗时**。无压缩的消息维持现状 —— 它只有一段，段时长本就等于总时长，天然一致。
- 呈现建议：末段 `09:20 · 1m30s · 共 8m34s`；中间段仍只有本段 `09:12 · 3m10s`。前缀用词（「共」/「总」）实施时可调。

### 实施（2026-09-18）

**落点 —— `src/renderer/src/components/chat/renderable-chat-items.ts`**

- 新增 `resolveCutTime(pair, liveState)`：一刀的时刻 = `Math.max(boundary.createdAt, summary.createdAt)`，与 `context-compression.ts:92` 判定「哪个压缩是活的」同口径；`live` 段没有工件对，用 `liveState.startedAt`；两者都取不到时返回 `null`（该段回落）。
- `createAssistantFragment` 末尾加 `createdAt` / `updatedAt` 两个参数，写进片段的 `message`：片段是渲染层切出来的、本无自己的时间戳，不覆写就会每段都显示整条消息的结束时间。
- 切分循环引入 `cursorTime`（初始 = 消息 `createdAt`）：每段 `createdAt = cursorTime`、`updatedAt = cutTime`，然后 `cursorTime = cutTime` —— 首尾相接、不重不漏。
- 末段（`position === 'after'`）额外挂 `fragment.totalElapsedMs`（= `message.updatedAt − message.createdAt`），`RenderableMessageItem.fragment` 加该可选字段。
  - `message.updatedAt` 缺失（老消息）或 `updatedAt <= createdAt` 时不挂，末段回落成现状。

**消费端接线**（3 处，纯透传）

| 文件 | 改动 |
|---|---|
| `components/chat/MessageItem.tsx` | assistant 分支加 `totalElapsedMs={item?.kind === 'message' ? item.fragment?.totalElapsedMs : undefined}` |
| `components/chat/AssistantMessage/types.ts` + `index.tsx` | `AssistantMessageProps` 加 `totalElapsedMs?: number`，透传给 action-bar |
| `components/chat/AssistantMessage/action-bar.tsx` | 加同名字段；时间戳那行追加 ` · ${t('messageActions.elapsedTotal', { duration })}` |

- `updatedAt` 不用额外传 —— 片段自带覆写后的 `message.updatedAt`，`MessageItem` 本就在往下传；段内耗时由 action-bar 现成逻辑（`updatedAt − createdAt`）自动算出。
- i18n：`locales/{zh,en}/chat.json` 的 `messageActions` 加 `elapsedTotal`（zh `共 {{duration}}` / en `{{duration}} total`）。

**测试**：`tests/renderable-chat-items/program.ts` 新增 `testFragmentTimestamps`（17 项全过 → 原 16 项 + 1），断言首尾相接的两个时间戳、末段总耗时、老消息回落、无压缩消息不产生片段。

**门禁**：`tsc --noEmit` 三配置 0 错；`npm run test:renderable-chat-items` 17/17；BOM clean。

---

## S-77 会话 todo 面板：任务条数累加与单条显示方式

**老大口述（2026-09-18 14:23 原话）**：

> 「还有一个关于 todo 临时任务的 bug 或者说优化也算：
> 1. 任务显示的太多了，可以一行，hover 出全文，或者直接有缩略标题
> 2. 任务做完了都做第二批了，第一批不清理，还在累加任务个数。你先记一下」

**落点（已勘测）**：会话 todo 悬浮面板 `src/renderer/src/components/chat/SessionTodoPanel.tsx` —— 贴在 composer 上方、展开体内部滚动、**不占聊天窗 flex 高度**。

### 问题 1：单条任务文本会折成多行，且 hover 无提示

- `:212-228` 每条任务正文是 `div.min-w-0.break-words`，长标题会折成多行，列表看上去很"重"。
- 该条 `li` 上**已有** `title`（`:195`），但值只在 `suspended` / `stale` 时才有（`inProgressHint`）—— **正常任务 hover 什么都不出**。
- **已定（2026-09-18 14:26 老大原话）**：

  > 「我希望一个任务只能占用一行，最好是缩略标题，6 个任务就只有 6 行，移上去可以出hover」

  - **一条任务只占一行**，标题按**缩略**处理（CSS 单行截断 + 省略号），6 条任务就是 6 行。
  - **hover 出全文**。
  - 落点：`:212-228` 的 `div.min-w-0.break-words` → 单行截断（外层已是 `min-w-0`，够用）；`:195` 的 `title` 由「只在待续/已过期时才有值」改为**整行常挂全文** —— 提示语（`inProgressHint`）与全文**合并**，两者都不能丢。

### 问题 2：第一批完成后不清，条数持续累加

- 计数在 `:130`：`summaryLabel = t('todo.tasksDone', { completed, total: tasks.length })`，`total` = **该会话全部任务数**。
- 数据源 `:100-102` `useTaskStore((s) => s.getTasksBySession(sessionId))` → `stores/task-store.ts:198-201`，返回会话下**所有**任务（**含历史 `completed`**）。
- ⇒ 第一批 5 条做完、agent 开第二批 5 条，总数直接变 10，面板一路涨。
- **同源现象**：Worker 侧 `TodoTaskList` 也返回全部（`AgentRuntimeTaskExecutor.cs:266` `EncodeTaskListResult(LoadTasksBySession(db, sessionId))`）⇒ **agent 自己看到的也是累加值**。
- 注：每轮注入的 `<todo_status>` 只列未完成项（S-44 `BuildSessionTodoBlock`），不受此影响。

### 裁定与实施

1. **「第一批不清理」怎么解** —— 老大 2026-09-18 14:26：「其它的暂时没啥好想法」。候选：
   - **A（我推荐）** 渲染端只显示「当前批次」，**数据一字不动** —— 但得先定切批规则；我倾向「上一批全部 `completed` 之后的第一个新建任务 = 新批起点」。**纯渲染过滤**：删任务是不可逆动作，不能为了显示去删数据。
   - **B** 让 agent 每完成一批自己删旧任务 —— **靠嘱咐，与「能在代码强制就不要靠嘱咐」相悖**，不推荐。
   - **C** 只改计数口径（`total` 只算未完成 + 当前批），列表仍全量。
2. **问题 1** —— **已定**，见上（单行截断 + hover 全文）。
3. 面板是否加「只看未完成」的过滤开关 —— 老大未提，**不擅自加**。

---

### 实施（2026-09-18）

**裁定**：按 **V3 = A** —— 渲染端只显示「当前批次」，**数据一字不动**（任务状态归 agent 所有，删任务不可逆）。

**切批判据（`src/renderer/src/lib/agent/session-todo-batch.ts`，新增纯函数 `resolveCurrentTodoBatch`）**

切批需要**同时**满足两条：

1. 前一批全部 `completed`（同一时刻只会有一批在跑）；
2. 这条任务**是上一批做完之后才建的** —— `createdAt >= max(前一批的 updatedAt)`。

**第 2 条不是可选项，是我第一版漏掉、被测试当场抓出来的**：只按第 1 条判断时，状态序列 `[t1=completed, t2=in_progress, t3=pending]`（同一批、agent 正常推进）会被切成 `[t2, t3]` —— **每完成一条，列表就少一条**，做完的任务凭空消失。加上第 2 条后：同批任务的 `createdAt` 必然早于本批任何一条的完成时刻，跨批的新任务则在之后，比较不需要任何时间阈值。

**为什么不用「创建时间间隔」判定**：查了真实库（生产 13 条 / 开发 19 条）—— 同一批任务创建的相邻间隔最小 0s、最大 **46s**（`lOzL9w1ou1FUddATk2XEq` 8 条跨 46 秒仍是同批），秒级阈值必然误判，跨批间隔也可能只有几十秒。时间间隔这条路走不通。

**落点 —— `src/renderer/src/components/chat/SessionTodoPanel.tsx`**

| 项 | 改动 |
|---|---|
| 计数与列表 | `tasks` → `batchTasks = useMemo(() => resolveCurrentTodoBatch(tasks), [tasks])`；`completed` / `total` / `isComplete` / `inProgressStates` / 列表 `map` 全部改用 `batchTasks`（早退判断一并改） |
| 问题 1 单行 | 正文 `min-w-0 break-words` → **`min-w-0 truncate`**（CSS 单行截断 + 省略号） |
| 问题 1 hover | `li` 的 `title` 由「只在 suspended/stale 有值」改为**整行常挂全文**；提示语不顶掉全文，两者合并成 `全文\n提示语`（换行在原生 tooltip 里成立） |

- 「只看未完成」的过滤开关**未加**（老大未提）。
- 文案一个没动。

**测试**：新增 `tests/session-todo-batch/program.ts` + `package.json` 的 `test:session-todo-batch`，**12 断言**。含两条防回归关键例：同批中途完成不能切（`testSameBatchMidProgress`）、批内乱序完成不能切（`testOutOfOrderCompletionStillCounts`）。

**门禁**：`tsc --noEmit` 三配置 0 错；`npm run test:*` 31 套全过；BOM clean。

---

## S-78 审批弹窗正文过多时撑出弹窗

**老大口述（2026-09-18 14:33 原话）**：

> 「我们如果没有开启 YOLO 会出审批弹窗，审批弹窗正文过多的情况下，内容撑出去了，应该需要弹窗相应变高去适应，可以加一个最大高度，还不够的话出滚动条」

**触发路径**：没开 YOLO（`permissionMode !== 'fullAccess'`）⇒ Worker 走审批门 ⇒ 渲染端 `handleSubAgentApprovalRequest` 的 `default-mode` 分支弹 `confirm()`。

**落点（已勘测）**：

| 环节 | 位置 |
|---|---|
| 弹窗正文来源 | `src/renderer/src/lib/tools/sub-agent-approval.ts:97-105` —— 正文 = `inputSummary(toolName, input)`，Bash / PowerShell 的**命令全文，不截断** |
| 弹窗本体 | `src/renderer/src/components/ui/confirm-dialog.tsx:163` `<AlertDialogContent size="sm">`，正文放 `:166-168` 的 `AlertDialogDescription` |
| 原语 | `src/renderer/src/components/ui/alert-dialog.tsx:41`（`AlertDialogContent`）、`:84-95`（`AlertDialogDescription`） |

**根因（两条独立）**：

1. **`AlertDialogContent` 完全没有垂直约束** —— `ui/alert-dialog.tsx:41` 那一长串 class 里只有 `max-w-lg`（**宽度**上限），**没有任何 `max-h` / `overflow`**。垂直方向完全由内容决定 ⇒ 正文一长，弹窗就一路长高，超出视口即被裁/撑出去。
   - 注：老大的「弹窗相应变高去适应」这半其实**已经成立**（短内容时高度就是自适应的），真正缺的是**上限**。这条要按事实写，不能把现状说成坏的。
2. **正文换行会被折叠** —— `AlertDialogDescription` 是 Radix 的 `<p>`，类名仅 `text-sm text-muted-foreground`，**没有 `whitespace-pre-wrap` / `break-words`** ⇒ shell 命令里的换行不保留、超长无空格行不折行，**横向也会溢出**。这是「撑出去」的另一半，光加高度上限治不了。

**修法（已定 —— 2026-09-18 14:44 老大「按照你的推荐登记」，采纳 A）**：

- **A** 动两处（原语兜底 + 正文区自滚）：
  1. `ui/alert-dialog.tsx` 的 `AlertDialogContent` 加**视口上限** `max-h-[calc(100vh-2rem)]` —— 兜住所有 AlertDialog，任何内容都不再撑出视口；
  2. `ui/confirm-dialog.tsx` 的**正文区**加自滚层：`min-h-0` + `max-h` + `overflow-y-auto` + `whitespace-pre-wrap` + `break-words` —— **滚动只发生在正文，标题与底部按钮钉住不动**。
     - `whitespace-pre-wrap` 保住命令里的换行；`break-words` 治超长无空格行。这两条对**其它 27 个普通 confirm 调用点同样是纯增益**（多行文本本就该换行），所以放在通用容器里即可。
  - **等宽字体不进通用容器**（普通句子用等宽很怪）—— 只给**审批弹窗**开：`ConfirmOptions` 加可选开关（如 `descriptionVariant?: 'code'`），由 `lib/tools/sub-agent-approval.ts` 传 `'code'`；不传 ＝ 现状，其余调用点零改动。
- **B（未采纳）** 只改公共原语、让 header 区整体滚 —— `AlertDialogHeader` 里**标题与正文是同一个 grid item**，滚动的代价是**标题一起被滚走**，不可接受。

**实现要点（须真机验证，别照抄当定论）**：

- `AlertDialogContent` 是 `grid`，隐式行默认 `auto`；**只加 `max-h` 压不住行高**，需要显式行模板让中段可收缩（`grid-rows-[…]`）+ 容器 `overflow-hidden`。
- 标题要 `shrink-0`，否则会被正文挤扁。
- 正文区的 `max-h` 需与 Content 的 `max-h` 联动算（扣掉标题、底部按钮、`p-6` 与 `gap-4` 的固定开销），**别让两者打架**：Content 管「整体不出视口」，正文区管「溢出就在这块滚」。

**影响面**：`confirm()` 全仓 **28 个调用点**（删除确认、git 操作、渠道、设置页…），`AlertDialogContent` 另有 7 个文件直接用。改动性质 = **只新增「上限 + 溢出滚动」**，**短内容零影响**。

**取值**：Content 上限先取 `max-h-[calc(100vh-2rem)]`；正文区上限按真机调到「弹窗整体不出视口」为止。**数值以真机为准，文档不写死**。

---

### 实施（2026-09-18，方案 A）

**`src/renderer/src/components/ui/alert-dialog.tsx`**

`AlertDialogContent` 的 class 加 `max-h-[calc(100vh-2rem)]` + `overflow-hidden`（插在 `grid … w-full max-w-lg` 之间）。

- 加的是**通用**约束：任何 `AlertDialog` 都不该超出视口，这一层不引入任何布局假设。
- **没在这里写 grid 行模板**：`AlertDialogContent` 被 7 个文件直接使用，各自子元素结构不同，写死行数会错乱。行模板交给具体使用方传（见下）。

**`src/renderer/src/components/ui/confirm-dialog.tsx`**

| 项 | 改动 |
|---|---|
| `ConfirmOptions` / `DialogState` | 新增可选 `descriptionVariant?: 'text' \| 'code'`（默认 text） |
| `pumpDialogQueue` | 透传该字段（队列 → DialogState） |
| `AlertDialogContent` | 传 `className="grid-rows-[minmax(0,1fr)_auto]"` —— 第一行（标题＋正文）可收缩，第二行（按钮）保持自然高度 |
| `AlertDialogHeader` | 加 `min-h-0`（grid item 默认 `min-height: auto`，不加这一行压不下去） |
| `AlertDialogTitle` | 加 `shrink-0`，钉住 |
| `AlertDialogDescription` | 加 `min-h-0 overflow-y-auto whitespace-pre-wrap break-words`；`code` 变体再加 `font-mono text-xs` |

- **`whitespace-pre-wrap` 是必须的**：`AlertDialogDescription` 是 Radix 的 `<p>`，默认折叠换行、不折超长无空格行 —— 光加高度上限治不了横向溢出。
- **等宽字体只给需要的调用点**：正文容器是通用的，不该把 28 个调用点的弹窗全变成等宽。由调用方传 `descriptionVariant: 'code'` 显式开启。
- 引入 `import { cn } from '@renderer/lib/utils'`。

**`src/renderer/src/lib/tools/sub-agent-approval.ts`**

`confirm({...})` 加 `descriptionVariant: 'code'` —— 这里的正文是 `inputSummary(toolName, input)`，即 shell 命令全文。

**影响面**：`confirm()` 全仓调用点**零改动**（新字段可选）；`AlertDialogContent` 的 `max-h` 对 7 个直接使用方是纯加固。

**门禁**：`tsc --noEmit` 三配置 0 错；`npm run test:*` 31 套全过；BOM clean。
**待真机验**：长 shell 命令（未开 YOLO）→ 弹窗不出视口、正文可滚、换行保留、标题与按钮钉住。

---

## S-79 沙箱模式：工具参数的工作目录边界校验

**来源**：2026-09-18 15:56 老大口述 —— 「还有用户提出了质疑，希望能引入沙箱模式，我的打算是在工具执行给参数的统一地方，对参数进行验证，如果开了沙箱就需要验证，如果没开就不用，沙箱的目的是不允许跳出工作目录去做其它事情」。

### 现状（2026-09-18 实读）

- **现在零工作目录约束**：iter-29 需求 28 把那套路径许可配置删干净了（`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside`），全仓只剩注释里的 retired 字样（`src/main/channels/channel-types.ts:38`、`src/runtime/WishfulClaw.Infrastructure/Storage/GlobalChannelSettings.cs:7`）。agent 目前可以读 / 写本机任意路径。
- **「统一地方」真实存在**：`ToolCallProcessor.ExecuteAsync`（`src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:150`），`AgentLoop.cs:470` 是全仓**唯一**调用点。循环内已具备三件东西 —— 每个调用的 `Name` + `Input`（JsonElement）、`workingFolder`（`:157-159`）、准入判定（`:203-211`）。
- **路径解析也已收敛**（但只做拼接，零校验）：

| helper | 位置 | 读取的参数 | 行为 |
|---|---|---|---|
| `ResolveFilePath` | `Tools/ToolHelpers.cs:58` | `file_path` / `path` | 相对则 `Path.Combine(workingFolder, path)`，最后 `Path.GetFullPath` |
| `ResolveSearchPath` | `Tools/ToolHelpers.cs:74` | `path` | 空或 `.` 时回落 `workingFolder ?? Environment.CurrentDirectory` |
| `ResolveCwd` | `Tools/ShellTools/ShellExecuteTool.Helpers.cs:18` | `cwd` | shell 的起始目录 |

- **消费方覆盖全**：FileRead / FileWrite / FileEdit / FileList / Glob / Grep / ShellExecute 各 1 处，全部经过上面三个 helper。
- `ToolExecutionContext`（`src/runtime/WishfulClaw.Core/Tools/ToolTypes.cs`）已带 `WorkingFolder` / `ProjectId` / `SshConnectionId`，**无需新通道**。

### 能力边界（写进文档，避免对外宣称失真）

**能防住的**：文件工具的绝对路径越界、Glob / Grep 的搜索根越界、shell 的**起始 cwd** 越界 —— 即**防呆 + 防被注入骗着去读别处**。

**防不住的**（所以不能对外叫「沙箱」）：

- **shell 命令内部的一切**：`Bash("cd /d C:\\ && dir")`、`PowerShell("Get-ChildItem C:\\Users -Recurse")`、`Bash("curl …")`。`ResolveCwd` 只定起点，命令自己能 `cd` 出去、能用绝对路径、能联网。**这是最大的一条洞。**
- **`use_capability` 代理路径**：`AgentRuntimeUseCapabilityExecutor` 自己执行目标工具（它只复用了 `IsDefaultModeApprovalTool`，见 `AgentRuntimeUseCapabilityExecutor.cs:314`），**不经过** `ResolveFilePath`。MCP / browser / desktop / image 这些 executor 有没有自己的路径参数，实施前要逐个审。
- **间接路径**：工作目录内的符号链接 / 快捷方式指向外部。

**定性**：本需求做出来的是**工作目录边界强化（防呆层）**。真沙箱（防越权 / 防恶意）要 OS 级隔离（Windows 上至少是受限令牌或 AppContainer + 目录 ACL），成本高一个量级，**本迭代不做**，也不该拿「沙箱」这个名字对外承诺。

### 落点：A vs B

- **A（老大原话：在工具执行的统一地方校验）** = 在 `ToolCallProcessor.ExecuteAsync` 的循环里加一道。代价：需要维护「哪个工具、哪个参数是路径」的映射表（`Read.file_path` / `Grep.path` / `Bash.cwd` …），**新工具忘了登记就静默漏检** —— 与刚废掉的 `ToolPreset` 白名单是同一个坑（iter-31 S-43 的教训）。
- **B（推荐）** = **在路径解析层做**，即上面三个 helper 内加边界判定。结构上「任何想碰文件系统的工具都必须经过这里」（现有 7 个消费方全部如此），新工具自动受益，**零映射表**；与 S-51 的做法同思路（判据收进单一谓词，一处开闸处处生效）。
  - 越界时**必须显式失败**（抛错 / 返回哨兵，由工具回一条明确错误），**不能静默回退**到工作目录 —— 静默回退会把「写到了别处」伪装成「写到了工作目录」，更难排查。

### 裁定（2026-09-18 晚）

老大原话：「**这个是全局的，默认是开，只针对项目下会话，因为我们的全局 PM，理论上 PM 只会去读取多个项目所在路径。**」

| 项 | 裁定 |
|---|---|
| 开关粒度 | **全局**（放 `settings-store`，与 `contextCompression*` 同级），**不是会话级** —— 与 S-73 的会话级开关不是一回事 |
| 默认值 | **开** |
| 生效范围 | 项目会话用**自己的工作目录**；全局会话用**所有项目工作目录的并集**（见下） |
| 渠道会话归属 | **属于全局**，边界同样是「所有项目工作目录的并集」 |
| 越界 | **直接拒绝**，不转审批（除非关掉沙箱） |

**关键澄清（2026-09-18 晚，老大纠正）**：全局会话**不是「不校验」**。老大原话追加：

> 「**全局不是不校验，全局是所有的项目的工作目录都可以**」

即边界是一个**集合**，不是单根，也不是空集：

| 会话 | 允许的路径根 |
|---|---|
| 项目会话 | 该项目的 `workingFolder` 一个根 |
| 全局会话（含渠道） | 全部已注册项目的 `workingFolder` 的**并集**（多根，命中任一即放行） |

这与老大的原始理由完全咬合 —— 「全局 PM 理论上 PM 只会去读取多个项目所在路径」：它要读多个项目，但**不是满盘乱读**，读的是「已登记的那几个项目」。

### 多根边界的数据源（实测：Worker 自己就有，无需新通道）

这一点比 S-51 省事 —— 不需要渲染端传参数：

- `projects` 表在 Worker 侧（`DbClient.cs:77`），列含 `working_folder` / `ssh_connection_id` / `plugin_id`。
- 现成读法：`DbProjectTools.List`（`WishfulClaw.Infrastructure/Db/DbProjectTools.cs:25`，`SELECT * FROM projects ORDER BY pinned DESC, updated_at DESC`）。
- 所以边界集合可直接由 Worker 查库得到，与 S-51 那次「索引在不在只能渲染端算」不同（那次是索引路径依赖渲染端推导的 dataRoot，这次路径就在库里的明文字段）。

### 实现注意：边界从「单根」变「多根」

- 判定式从「路径以 `workingFolder` 开头」变为「路径以**集合中任一**根开头」，且比较必须做**路径规范化 + 目录边界**（`C:\a` 不能匹配 `C:\abc`，且要处理大小写与 `\..`）。
- `ToolCallProcessor.cs:157-159` 现在只在 `Scope == "project"` 时取 `workingFolder`；全局会话要在同一处也备好 roots 集合（空集合时的行为需定义，见下）。
- **SSH 项目是唯一没想透的点**：SSH 项目的 `working_folder` 是**远程路径**（`ssh_connection_id` 非空）。全局会话里跑**本地**工具时，把远程路径当本地根会误判；跑 **SSH 工具**时，边界理应换成该项目的远程路径。倾向处理：按 `ssh_connection_id` 分组，本地工具只匹配非 SSH 项目的根，SSH 工具匹配对应项目的远程根。**实施前需确认**，别一刀切。
- 项目列表可能为空（全新用户）：此时全局会话的允许集合为空 —— 与「关掉沙箱」等价还是「一切拒绝」？倾向**视为未开**（没有可依凭的边界，硬拒会把全局会话废掉）。**待老大定。**

### 渠道会话的归属（2026-09-18 晚二次确认）

老大原话：「**渠道会话就是全局 PM**」。

这一点在代码里本来就已经是这个结构：`AgentRunContextPolicy.Resolve`（`AgentRunContextPolicy.cs:35-40`）把 `sessionMode == "channel"` **强制 `scope = "global"`**，注释写得很清楚 ——「A channel is a global session whose replies leave through a chat plugin」。所以渠道会话的边界与全局会话**完全一致**（所有项目工作目录的并集），不是漏掉，是**与 scope 模型一致**。

**风险记档（不作为待办，只是留痕）**：渠道会话与普通全局会话的风险面并不相同 —— 它自 S-59 起默认 `fullAccess`（YOLO，审批门短路）、全自动无人值守、消息来自**外部不可信入口**。将来若要把两者拆开，判据是现成的：`AgentRunContextPolicy.IsChannelSession(parameters)` 与 `scope` 是两条独立的线，不必改 scope 推导。**当前按老大的口径不拆。**

### 越界行为（2026-09-18 晚三次确认）

老大原话：「**开了沙箱的就不能操作了，除非关闭沙箱**」。

即取**直接拒绝**，不转审批。理由：能审批的就不叫沙箱；而且转审批等于把判定推回给用户，用户没时间看。

- 越界时**显式失败**（抛错 / 返回哨兵，由工具回一条明确错误），**绝不静默回退**到工作目录 —— 静默回退会把「写到了别处」伪装成「写到了工作目录」，比报错更难排查。
- 错误文案给出两条出路：**关闭沙箱开关**，或**把该目录设为工作目录**。

### 两条实现细节（2026-09-18 晚结清）

1. **SSH 项目 —— 老大裁定「暂时管不了」**，本迭代不做特殊处理。落地口径：**SSH 项目的 `working_folder`（远程路径）不参与本地边界集合**，即只收 `ssh_connection_id` 为空的项目的根。这样既不会把远程路径误当本地根，也不留半成品逻辑。将来要支持「SSH 工具按对应项目远程根校验」时再单独立项。
2. **项目列表为空时**（全新用户，本地项目 0 个）：允许集合为空 ⇒ **视为未开**（不校验）。理由：没有可依凭的边界，硬拒会把全局会话整个废掉，而这类用户本来也没配项目。

### 默认开带来的既有影响（提醒）

- **项目会话**：`workingFolder` 就是它自己的工作目录，项目内正常用法不受影响；被挡的只有「主动往工作目录外伸手」这一类。
- **全局会话（含渠道）**：边界是「所有项目工作目录」，所以**跨项目**干活照常可以；被挡的是「伸手到任何一个项目目录之外」—— 比如临时写到 `C:\Temp`、改系统配置、动用户主目录。这是相比旧行为变化最大的一处，升级后可能开始报错。
- 错误文案要把出路说清楚：关开关 / 把该目录设为工作目录。

### 实施前的覆盖清单

直连侧（File* / Glob / Grep / ShellExecute，经 helper）已覆盖；另需核：`Monitor`（也是执行命令的）、`use_capability` 代理路径、子代理 / cron / skill 内部的工具调用（同 loop，但要确认 context 传得下去）、MCP 工具自身的路径参数。

---

## S-79 实施（2026-09-18）

### 落点：路径解析层（方案 B）

在 `ToolHelpers` 的路径解析函数内判定，而不是在 `ToolCallProcessor.ExecuteAsync` 的循环里维护「哪个工具哪个参数是路径」的映射表。理由：映射表是新的 `ToolPreset` 式陷阱 —— 新工具忘登记就静默漏检；而 helper 是所有文件/搜索类工具解析路径的必经之路，新工具照抄写法即自动受益。

### C# 侧改动

**新增 `src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs`**

- `Policy(bool Enabled, IReadOnlyList<string> Roots)` —— 一批工具调用共用一份策略，避免跑到一半用户加了项目导致前后判据不一致。
- `ResolvePolicy(JsonElement)` —— 开关关掉就**不查项目表**（默认开，见渲染端）。
- `ResolveRoots(JsonElement)` —— 项目会话取 `workingFolder` 单根；全局会话查 `projects` 表拿并集（`working_folder` 非空 ∧ `ssh_connection_id` 为空，即 SSH 项目不参与，按第五节裁定）。
- `IsInsideAnyRoot(path, roots)` —— 逐根比对，**目录边界**用 `root + 分隔符` 前缀判（`C:\a` 不会放行 `C:\abc`），Windows 下大小写不敏感；`..` 逃逸由 `Path.GetFullPath` 规范化后自然落空。**空 roots 一律放行**（项目列表为空的降级路径）。
- `BuildViolationMessage` —— 文案含被拒路径 + 允许的根 + 两条出路（关开关 / 设为工作目录）。模型会把这句原样读给自己看，缺了出路它只会反复重试同一条路径。
- `ResolveScope` **刻意不复用 `AgentRunContextPolicy.Resolve`** —— 后者在「scope=project 但缺 projectId」时会抛，而这是每个工具调用都要过的检查，不能让一次参数残缺把工具打挂。这里复刻它判 scope 的那几行（含「渠道即 global」）。测试当场抓到过这个坑。

**`PathSandboxViolationException`** —— 单独类型，让分发层能把「预期内的拒绝」和「工具自己炸了」分开：前者消息原样交给模型，后者才带 `Tool execution failed` 前缀。

**`src/runtime/WishfulClaw.Core/Tools/ToolTypes.cs`** —— `ToolExecutionContext` 加 `SandboxEnabled`（默认 `false` = 不校验，没接线的调用方不该被一个它们拿不到的设置拦住）与 `SandboxRoots`。

**`src/runtime/WishfulClaw.Agent/Tools/ToolHelpers.cs`** —— `ResolveFilePath` / `ResolveSearchPath` 第二参由 `string? workingFolder` 改为整个 `ToolExecutionContext`，出口统一走新增的 `EnsureInsideSandbox`。6 个调用点（`FileReadTool` / `FileWriteTool` / `FileEditTool` / `FileListTool` / `GlobTool` / `GrepTool`）随之改签名。

**`src/runtime/WishfulClaw.Agent/Tools/ShellTools/ShellExecuteTool.Helpers.cs`** —— `ResolveCwd` 的**三个分支**（显式 `cwd` / 会话工作目录 / `UserProfile` 兜底）逐条校验。兜底那条尤其要拦，否则沙箱开了还能靠「不带 cwd」跑到用户主目录。

**`src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs`** —— `DispatchAsync` 多收一个 `PathBoundary.Policy`，构造 `ToolExecutionContext` 时带上；`catch` 链在 `catch (Exception)` **之前**插 `catch (PathSandboxViolationException)`。

**`src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`** —— `ExecuteAsync` 里 **一批算一次** `PathBoundary.ResolvePolicy(parameters)`，经 `ExecuteGatedAsync` / `ExecuteSingleAsync` 透传到 `DispatchAsync`。

**`src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityExecutor.cs`** —— 代理路径（`use_capability action=call`）也过同一道边界，否则 `Read`/`Write`/`Bash` 经代理绕一圈就能跳出去。这里没有整批共享的机会，就地算策略。

### 渲染端改动

- `stores/settings-store.ts` —— 新增 `sandboxEnabled: boolean`（默认 `true`），纳入 `partialize`。
- `components/settings/RuntimePanel.tsx` —— 上下文压缩段之后新增「沙箱模式」开关段。
- `locales/{zh,en}/settings.json` —— 新增 `general.sandbox.{label,desc,hint}`。
- 透传 8 处（与既有 `contextCompressionEnabled` 同位置）：`hooks/use-chat-actions.ts` ×4、`hooks/use-channel-auto-reply.ts`、`hooks/use-background-subagent-wakeup.ts`、`lib/agent/provider-auto-fallback.ts`、`lib/tools/project-send-message.ts`；另有 `stores/chat-store/index.ts` 的 run params 类型。

### 覆盖审计（对应第五节清单）

| 入口 | 结论 |
|---|---|
| `File*` / `Glob` / `Grep` | 经 helper 覆盖 |
| `ShellExecute` | 经 `ResolveCwd` 覆盖 |
| `use_capability` 代理 | 已覆盖（上节） |
| 子代理 / cron / skill | 同 loop、同 `ExecuteAsync`，随 `state.Parameters` 取策略，无需单独接线 |
| MCP 工具自身路径参数 | **不覆盖** —— 它们的参数结构由各 MCP server 定义，无统一路径字段 |
| `Monitor` | **不适用** —— 其 schema 只声明 `session_id`（无路径参数）；且它当前有参数名与执行器不一致的独立缺陷（见 S-60 同源问题），语义待定 |

### ⚠️ 机制边界（必须知道，不要以为全拦住了）

沙箱校验的是**工具参数里的路径**，**不是命令字符串内部引用的路径**。`Bash` 传 `rm -rf /etc/foo`、`powershell -c "Remove-Item C:\Windows\..."` 这类，参数里根本没有路径字段，helper 无从判定 —— 本机制**拦不住**。

要拦这一层只能靠 OS 级隔离（job object / 容器 / 受限用户），不在本迭代范围，也无现成设计。老大的原始口径就是「在工具执行给参数的统一地方，对参数进行验证」，本条按此落地，边界如实记录。

### 测试

`tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs`（新增，19 断言，注册于 `Program.cs` 的 `RunContextCapSuite();` 之后）：
- 边界判定：根自身 / 子目录 / **前缀陷阱**（`wc-sandbox-root` vs `wc-sandbox-root-sibling`）/ 根外 / `..` 逃逸 / 空 roots 放行 / 多根命中任一
- 开关 × 集合：显式关 / 字段缺失按默认开 / 项目会话单根 / 项目会话缺 `workingFolder` 无根 / 关闭时不计算边界
- 执行层：关不拦、开且根内放行、开但无根不拦、越界抛 `PathSandboxViolationException` 且文案含路径与根、相对路径拼出根外同样拦

### 门禁

- C#：`WishfulClaw.Worker` 0 警告 0 错误；`tests/WishfulClaw.Tests.sln` 0/0；10 个回归套件全过（Goal 249 → **268**）
- TS：`tsc --noEmit` 三配置 0 错；`npm run test:*` **31/31**
- 26 个触碰文件 BOM 全 clean

### 两条已知影响（升级后可能开始报错，属预期）

- **全局会话（含渠道）**：边界 = 所有非 SSH 项目工作目录的并集。跨项目干活照常；被挡的是「伸手到任何项目目录之外」—— 临时写到 `C:\Temp`、改系统配置、动用户主目录。这是相比旧行为变化最大的一处。
- **项目会话**：边界 = 自己的工作目录，项目内正常用法不受影响。

---

## S-80 文件写入的 BOM 处理不一致

**来源**：2026-09-18 21:50 老大提问 —— 「工具 Edit 写入的文件易带 BOM？之前专门审查过不是说不会么，把这个工具修复也追加进需求，然后进行修复」。

### 核实结论（先证伪，再定修法）

老大记得的审查结论**是对的**：`Edit` 工具**不会**加 BOM。但查下来发现的是**另一个方向的缺陷** —— 它会**丢掉**原本存在的 BOM。

`.NET` 行为实测（PowerShell 复刻，非推断）：

| 调用 | 结果 |
|---|---|
| `File.WriteAllText(p, t, Encoding.UTF8)` | **写 BOM**（6 字节 = 3 BOM + 3 内容） |
| `File.ReadAllText(p, Encoding.UTF8)` | **剥 BOM**（读回 3 字节） |
| `Encoding.UTF8.GetBytes(t)` | 不带 BOM（97,98,99） |
| `WriteAndFlushAsync` 等价实现（`FileMode.Create` + `GetBytes`） | **无 BOM** |

所以链路是：`Edit` 读时 `File.ReadAllTextAsync(path, Encoding.UTF8)` **把 BOM 剥掉**，写时 `WriteAndFlushAsync` 又**不补** ⇒ 一个原本带 BOM 的文件被编辑一次就变成无 BOM。

### 现状清单（全仓排查）

| 位置 | 行为 | 判定 |
|---|---|---|
| `Tools/ToolHelpers.cs` `WriteAndFlushAsync` | 永不写 BOM | **Edit / Write / MemoryHotWrite 的统一写路径** ⇒ 编辑带 BOM 文件会丢 BOM |
| `Tools/MemoryTools/MemoryHotReadTool.cs:71` | `File.WriteAllTextAsync(..., Encoding.UTF8, ...)` ⇒ **写 BOM** | 只在 `!File.Exists` 时走，**是产品里唯一的 BOM 制造者** |
| `Tools/MemoryTools/MemoryHotWriteTool.cs:86` | 同上 | 同上 |
| `AgentRuntimeNotebookEditExecutor.cs:98` | `File.WriteAllTextAsync(path, result, ct)` ⇒ 无 BOM | 编辑带 BOM 的 `.ipynb` 同样会丢 |
| `AgentRuntimePlanExecutor*.cs`（3 处） | 无 Encoding ⇒ 无 BOM | 写的是产品自己的 plan 文件，无 BOM 是对的，**不动** |
| `Tools/AgentChanges/AgentChangeTools.cs:242` | 显式 `Utf8NoBom` | 回滚路径。原文本读时已剥 BOM，回滚同样恢复不了 —— 本次未改（见下） |

**佐证**：渲染端 `lib/agent/memory-json-parsers.ts:11` 有 `.replace(/^\uFEFF/, '')` —— 正是被上面那两处 memory 写入逼出来的防御。BOM 确实被写出来过，不是理论问题。

**主进程（Node）侧无此问题**：`fs.writeFile(..., 'utf8')` 不写 BOM；`memory-json-parsers` 的 strip 是唯一的渲染端防御点。

### 修法：写入保留目标文件原本的 BOM 状态

契约：**不主动加、不主动丢**；新建文件按无 BOM。

1. **`ToolHelpers.WriteAndFlushAsync`**（核心）—— 写入前探测目标文件是否以 `EF BB BF` 开头，是则在 `FileMode.Create` 之后先手写 preamble 再写内容。`Encoding.UTF8.GetBytes` 不产 BOM，所以只能用这种方式补。
   - 探测失败（读不动 / 不存在）一律当「无 BOM」—— **探测不该让本来能写成功的写入失败**。
   - 打开探测流用 `FileShare.ReadWrite`，不干扰别人读。
   - 新建文件天然落到「无 BOM」分支。
2. **`MemoryHotReadTool.cs:71` / `MemoryHotWriteTool.cs:86`** —— 去掉 `Encoding.UTF8` 参数（.NET 默认即 UTF8 无 BOM），与 `WriteAndFlushAsync` 行为一致。**存量带 BOM 的 MEMORY.md 不动**（不主动改用户既有文件）；渲染端的 strip 防御保留。
3. **`AgentRuntimeNotebookEditExecutor.cs:98`** —— 改走 `ToolHelpers.WriteAndFlushAsync`，顺带获得 BOM 保留 + 立即 flush。

**明确不做**：不批量回填/清除既有文件的 BOM（那是改用户数据）；`AgentChangeTools` 的回滚路径不额外处理（回滚的 `beforeText` 读时已剥 BOM，要真修得连 `beforeText` 一起带上 BOM 状态，属另一件事）。

### 测试

`tests/WishfulClaw.GoalRegressionTests/Program.Bom.cs`（新增，7 断言，注册于 `Program.cs` 的 `RunSandboxSuite();` 之后）：带 BOM 文件写回保留 BOM、无 BOM 文件不许补、新建无 BOM、连续写两次状态稳定、只有 BOM 的文件也判得出、内容正确性不受影响。

**这组断言在改之前必然是红的** —— 旧实现下「带 BOM 的文件写回后保留 BOM」一定失败。

### 门禁

- C#：`WishfulClaw.Worker` 0 警告 0 错误；`tests/WishfulClaw.Tests.sln` 0/0；10 个回归套件全过（Goal 268 → **275**）
- 触碰文件 BOM clean

---

## S-81 输入框上方多条提示互相遮挡

**来源**：2026-09-18 21:55 老大 —— 「我们输入框上方会有各种 banner 条显示，当同时出现多种的时候会出现遮挡情况，修复这个 bug」。

### 勘测：composer 上方一共挂了 5 类块

`InputArea/index.tsx:295-326` 自上而下：

| # | 组件 | 定位 | 出现条件 |
|---|---|---|---|
| 1 | `InputAreaBanners`（API Key / 工作目录缺失 / Plan Mode / 工作目录指示 / Goal 提示，共 5 条） | 流式 `mb-2` | 各自条件 |
| 2 | `QueuedMessagesPanel` | 流式 `mb-2` | 有排队消息 |
| 3 | `GoalSessionBar` | 流式 `mb-2` | 有 goal 会话 |
| 4 | **`SessionTodoPanel`** | **零高度包裹层 + `absolute inset-x-0 bottom-full z-30 mb-2`** | 本批有任务 |
| 5 | `composer-shell`（内含 `ComposerStatusIndicator` 与 `composer-flyovers`） | `relative`；flyover 为 `absolute inset-x-0 bottom-full z-30 mb-2` | 恒有 / 触发时 |

### 根因

**只有 #4 是悬浮的，而它悬浮的方向正好是「压在上面的条上」。**

`SessionTodoPanel` 用零高度包裹层 + `bottom-full` 把「摘要条 + 展开的任务列表」整体托到 composer 上方。包裹层自身不占高度（`SessionTodoPanel.tsx:138-143` 的注释写明这是刻意的：*「不再占用聊天窗的 flex 高度」*），但它的**锚点是自己在流式中的位置** —— 也就是 #3 的下方、composer 的上方。于是这个浮块**向上展开**时，覆盖的正是 #1 / #2 / #3 占据的区域。

摘要条是**常驻**的（不是展开才出现），所以「API Key 提醒 + 待办摘要」这种「两条常驻提示同时存在」的情况下，后者稳定盖住前者 —— 这就是老大看到的遮挡。

次要冲突：#4 的浮块与 #5 的 `composer-flyovers`（`@` 文件选择 / `/` 命令菜单）**用的是同一个 `inset-x-0 bottom-full z-30 mb-2`**，锚点也都落在 composer 顶边附近 ⇒ 两者区域几乎完全重合、层级相同 ⇒ 谁后渲染谁盖谁。

### 修法：把 #4 从悬浮改回流式占位

理由：**用遮挡换来的那点高度不划算**。#1 / #2 / #3 都是正常流式占位，同为「输入框上方的常驻提示」，#4 没有理由特殊。改回流式后：

- 摘要条排在 #3 下方，与其它条依次排列，**谁也不盖谁**
- 展开的任务列表同样在流式里（`max-h-64` 已限高），最多把聊天窗外挤 256px —— 那是用户主动展开的合理代价
- z 冲突自动消失（不再有第二个 `bottom-full z-30` 与 flyover 抢位）

实现：删掉 `SessionTodoPanel` 的零高度包裹层与 `absolute inset-x-0 bottom-full z-30 mb-2`，外层改为 `mb-2` 参与流式。

**刻意保留**：`composer-flyovers` 仍是 `bottom-full` 悬浮 —— 那是**临时**面板（用户敲 `@` / `/` 才出现），盖住上方条是下拉菜单的正常行为，不属本缺陷。

### 门禁

- `tsc --noEmit` 三配置 0 错；`npm run test:*` 31 套全过；触碰文件 BOM clean

### 待真机验

「API Key 未配置 + 有排队消息 + 有待办 + 敲 `@` 弹文件菜单」四种同时出现 —— 每条都要完整可见，文件菜单浮在最上。

---


## 待登记

（暂无）

---

## 裁定记录

（暂无）