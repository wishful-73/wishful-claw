# iter-v2-34 原始需求登记

> 2026-09-20 建。分支 `dev/v2-iter-34`（base `main` @ `02e57d3f`，v0.2.33）。
> 本文件为权威需求文档。本迭代节奏放缓，需求**逐步积攒**，不定收口时间。
> **已立项 7 项**：S-107 ~ S-113（S-110 已撤销，实为 6 项有效）。**S-113 明细见同目录 `website.md`**；其余见下文同名小节。
> 其余候选见文末「待登记」（含 iter-33 结转项），**未点名，不擅自排入**。

---

## S-107 请求上下文上限纳入全局设置，会话默认继承

### 需求（2026-09-20 老大）

> 「请求上下文上限 跟压缩阈值一样 在全局页面有个设置，会话上默认继承」

### 现状（2026-09-20 实读）

| 事实 | 位置 |
|---|---|
| 全局设置页「上下文压缩」节只有两项：启用开关 `contextCompressionEnabled` + 触发比例滑条 `contextCompressionThreshold`（30~90%） | `src/renderer/src/components/settings/RuntimePanel.tsx:274-318` |
| **全局没有「请求上下文上限」这一项**，设置存储里也无对应字段 | 同上；`stores/settings-store.ts` |
| 会话级上限只存在于输入区的 `ContextRing` 弹出面板（滑条 + 「Model max / 具体值」两态） | `components/chat/InputArea/context-ring.tsx:363-401` |
| 落库字段 `Session.contextCapTokens` + `contextCapModelId` | `stores/chat-store/types.ts:84`；`db-helpers.ts:373` |
| 生效口径：**上限只在它被设置时的那个模型上有效**，换模型即作废（返回 0） | `resolveSessionContextCapTokens`（`lib/agent/context-compression-config.ts:139-148`） |
| 运行期盖章：`sendMessage` 把 `contextCapTokens` 写进 `agent/run` run param；Worker `ApplyContextCap` 把 provider 的 `contextLength` 夹到该值 | `stores/chat-store/index.ts:418-423`；`AgentLoop.Helpers.cs:58-88` |

对照「压缩阈值」已具备的范式（`resolveSessionCompressionThreshold`：会话设过用会话的、否则用全局；`0` = 跟随全局 + 面板里带「跟随全局」还原出口），**全局上限这一整套是缺的**。

### 待裁定

1. **全局值的量纲**：绝对 token 数还是百分比？上限天然依赖当前模型窗口（`resolveSessionContextCapRange` 的量程上限 = 模型 `contextLength`），做成全局单值就得先定义「跨模型」的语义。
2. **会话默认继承怎么落地**：沿用 `contextCapTokens`（`0` = 跟随全局？）还是新增独立字段 —— 现约定 `0` = 没设过 / 模型已换，两种含义已经叠在一起。
3. **与 S-84「换模型作废」口径共存**：全局值不应受 `capModelId` 约束（它本来就不是绑在某个模型上设的）。
4. 是否保留会话级覆盖与「跟随全局」还原出口（与压缩阈值对齐则保留）。

---

## S-108 模型窗口 384K 未生效：后端按 200K 兜底算触发线（未设会话上限）

### 需求（2026-09-20 老大）

> 「这个384k有点误导你了，准确说我没有设置，这是模型上设置的最大上下文 结果默认按照200k压缩了 这是后台行为，前端看着是正常的，但是才46%左右就开始压缩了，这个说明是后端的问题」

**口径更正**：初版按「会话上限被夹回 200K」登记，**方向错了** —— 老大**从没设过会话上限**，384K 是**模型档案的窗口**。症状：前端百分比看着正常，**后端约 46% 就触发压缩** ⇒ 后端用的窗口不是 384K。

### 后端取值链（已核实）

| 环节 | 事实 | 位置 |
|---|---|---|
| **窗口唯一来源** | 后端压缩窗口只读 `provider.contextLength`，**读不到就兜底 `DefaultContextCompressionLimit = 200_000`** | `AgentLoop.cs:671`、`AgentLoop.ContextCompression.cs:38`、`ContextCompression.cs:289` / `:355`；常量 `AgentLoop.cs:22` / `ContextCompression.cs:52` |
| 触发线算式 | `effectiveWindow = contextLength - reserved(20_000)`；`trigger = min(effectiveWindow × ratio, effectiveWindow - 13_000)`；`ratio` 读 `contextCompressionThreshold`，夹 0.3~0.9 | `AgentLoop.cs:686-697` |
| 上限叠加 | `ApplyContextCap` 仅在 `provider.contextLength > capTokens` 时改写；`capTokens <= 0`（未设 / 换过模型）**原样返回** ⇒ 没设上限时这条不参与 | `AgentLoop.Helpers.cs:58-88`；`AgentLoop.cs:240` |
| **前端**侧窗口 | `useActiveModelConfig(activeSession)` → `resolveSessionModelSelection`（会话级模型覆盖 / 全局模式 / 渠道）→ 在 `providers[].models[]` 按 id 找档案 | `components/chat/InputArea/use-active-model-config.ts:23-35` |
| **后端**侧窗口 | `buildProviderPayload(activeProvider, modelId, …)` → `activeProvider.models.find((m) => m.id === modelId)`；**取不到就 `contextLength: undefined`**（字段在 JSON 里被丢掉 ⇒ 后端吃兜底 200K） | `lib/agent/provider-payload.ts:51`、`:75` |

**两条路径不是同一处代码**（前端走 `resolveSessionModelSelection`，payload 走 `activeProvider + modelId`）—— 一旦指向不同档案、或 id 对不上，就会出现「前端按 384K 显示、后端按 200K 触发」，与症状吻合。

### 待取证（一条就能对半砍）

**Worker 日志已内建诊断行**（`WorkerLog.Warn`，每次判定都打，`AgentLoop.cs:698`）：

```
context compression DIAG: inputTokens=… contextLength=… effectiveWindow=… thresholdRatio=… trigger=… -> WOULD COMPRESS / skip
```

- 若 `contextLength=200000` ⇒ 窗口根本没到后端（模型档案没匹配 / 字段被丢）⇒ **根因在前端 payload**
- 若 `contextLength=384000` 而 `trigger` 与前端不一致 ⇒ 偏差在阈值 / reserved / buffer 常量 ⇒ **根因在后端算式**

另需：当前会话 id、模型档案 id 与 `contextLength`、该次请求实际发出的 `provider.contextLength`。

### 与 S-107 的关系（已修正）

两者**不再强耦合**：S-107 是「全局上限设置项缺失」，本条是「模型窗口没传到后端」。但 S-107 落地前必须先确认本条结论 —— 否则全局值会以同样的方式被后端忽略。

---

## S-109 更新弹窗主按钮语义：先「开始下载」，下载中变「后台下载」并收起

### 需求（2026-09-20 老大）

> 「更新弹窗页面 点击是开始下载，而不是后台下载，点击下载后，按钮可以变成后台下载，点击后再收起来，而不是一开始就是后台下载」

### 现状（2026-09-20 实读）

| 事实 | 位置 |
|---|---|
| 发现新版本时的主按钮：key `updater.dialog.download`，**中文值就是「后台下载」** | `components/updater/UpdateDialog.tsx:231-235`；`locales/zh/settings.json:1514` |
| 下载中（`isDownloading`）的第二个按钮是「稍后」`updater.dialog.later`（zh `:1518`），点击 `handleOpenChange(false)` 收起弹窗 | `UpdateDialog.tsx:212-215` |
| 下载中另有提示「下载会在后台继续，关闭此窗口不会中断」 | `:166-177`；zh `:1512-1513` |

### 目标行为

1. **初始**：按钮文案 =「开始下载」（点击即开始下载）；
2. **下载开始后**：按钮变为「后台下载」，点击后**收起弹窗**（下载在后台继续，进度由 `UpdateStatusBanner` 承接）；
3. 现状「一开始就是后台下载」作废。

**待裁定**：下载中是否仍保留「稍后」一档，还是由「后台下载」直接取代 —— 两者行为一致（都收起），差别只在文案语义。

---

## S-110 更新下载悬浮窗默认位置移到最左侧 —— ❌ 已撤销（2026-09-21）

### 需求（2026-09-20 老大）

> 「下载的悬浮窗默认位置可以移动到最左侧，不用担心遮挡左侧面板」

### 现状（2026-09-20 实读）

- 默认锚点 = **左下角，跟随左边栏宽度**：`bannerLeft = leftSidebarOpen ? leftSidebarWidth + 16 : 16`，类里另有 `bottom-6`。位置被手拖过后 `updateBannerPosition` 非 `null`，锚点让位给持久化位置。见 `UpdateStatusBanner.tsx:169-174`、`:243`、`:248-252`；类型说明见 `shared/updater/types.ts:114-124`。
- 「跟随左边栏」这一设计本身就是为了不遮左侧面板；连带 `shouldLiftToastsForBanner` / `UPDATE_BANNER_TOAST_BOTTOM` 也是围绕「默认与 toast 同处左下角」写的（`UpdateStatusBanner.tsx:40-55`）。

### 目标行为

默认位置改为**最左侧**（`left = 16`，不再随左边栏宽度偏移）；**不再考虑遮挡左侧面板**。

### ❌ 已撤销（2026-09-21，老大）

老大裁定 **S-111 砍掉左下角浮块**（方案 A）⇒ 本条**失去实施对象**：

- 浮块整体删除后，`bannerLeft`（`UpdateStatusBanner.tsx:172`）、拖动与持久化位置（`:176-236`）、`placedBannerStyle`（`banner-position.ts:59-72`）全部随之消失 —— **「浮块默认位置」这个概念不存在了**。
- 连带作废：`shouldLiftToastsForBanner` / `UPDATE_BANNER_TOAST_BOTTOM` / `banner-position.ts`（清单见 S-111 的「连带影响」）。
- ⇒ **本条不实施**，保留档仅作设计历史记录。

---

## S-111 更新机制调整：巡检策略 + 顶部黄色下载图标取代常驻悬浮块

### 需求（2026-09-20 老大）

> 「还有就是定时更新机制需要调整，当前是一个小时进行一次扫描，然后左下角弹出浮窗。 需要调整 具体我们可查看Reasonix 的做法，并且有更新以后 顶部面板增加一个黄色的下载图标，而不是一直有悬浮块」

### 现状（2026-09-20 实读）

| 环节 | 事实 | 位置 |
|---|---|---|
| 巡检间隔 | 硬编码 `PERIODIC_RECHECK_INTERVAL_MS = 60 * 60 * 1000`（**1 小时**） | `src/main/updater.ts:52` |
| 调度 | `startPeriodicRecheck()` = `setInterval(runPeriodicRecheck, 1h)`；`initializeUpdater()` 里「启动查一次 + 起定时器」 | `updater.ts:580-586`、`:588-596` |
| 巡检跳过条件 | 非打包版 / 不能检查 / `autoUpdateEnabled === false` / 已有 `availableVersion` 或 `downloadedVersion` ⇒ 停止巡检 | `runPeriodicRecheck` `:561-578` |
| 巡检是静默的 | `checkIsPeriodic` 标记 + `UpdateAvailablePayload.silent` ⇒ 渲染端**不弹窗**，只点亮悬浮块 | `updater.ts:62`、`shared/updater/types.ts:31`、`App.tsx:58-69` |
| 巡检失败只落日志 | 不推事件、相位不落 `error`（GitHub 直连时通时不通） | `updater.ts:571-577` |
| **悬浮块出现条件** | `VISIBLE_PHASES = available / downloading / downloaded / error` —— **`available` 在列** ⇒ 一旦发现新版本，左下角悬浮块就出现并**一直挂着** | `UpdateStatusBanner.tsx:29-38` |
| 悬浮块形态 | `fixed bottom-6`、可拖动、**无关闭按钮**（注释明写：可关闭会重现「状态看不见也够不着」的问题） | `UpdateStatusBanner.tsx:81-94`、`:238-252` |
| toast 让位 | `UPDATE_BANNER_TOAST_BOTTOM = 90` / `shouldLiftToastsForBanner`（默认角与 toast 同处左下角才让位） | `:43-55`；`App.tsx:229` |
| 顶部面板 | `TitleBar`（h-10）。右侧按钮簇：使用指引 / Files / 浏览器 / Terminal / 右侧栏 / 窗口控制 —— **没有更新指示位** | `layout/TitleBar.tsx:90-161` |
| 设置项文案**与行为不符** | 开关 `autoUpdateEnabled` 文案是「启动时自动检查更新 / **只在启动时检查**，下载和安装始终需要你确认」，实际却是**每小时巡检** | `SettingsPage.tsx:354-372`；`locales/zh/settings.json:845-846` |

### Reasonix 的做法（`D:\koda\DeepSeek-Reasonix-main-v2`，供参考）

- **只在挂载时查一次**：`UpdateBanner` 的 `useEffect` → `check()`，**没有小时级轮询**（`desktop/frontend/src/components/UpdateBanner.tsx:19-22`）。
- **只在「可行动」时才出现**：`idle / checking / upToDate` 一律 `return null`，注释原话「a quiet auto-check that only surfaces when actionable」（`:8-13`、`:91-93`）。
- **横幅在顶部、且可关闭**：`available` 档带「下载更新」+「关闭」，`dismissed` 按版本号记住关闭（`:27-43`）；`downloaded` 档带「重启安装」+「关闭」（`:58-70`）；`error` 档带「重试」+「关闭」（`:75-90`）。
- **状态机含 `reset()`**：关闭即回 `idle`（`useUpdater.ts:8-18`、`:107`）。
- **顶栏由设置开关驱动**：`<UpdateBanner enabled={startupUpdateChecksEnabled === true} />`，开关对应设置里的 `checkUpdates`（`App.tsx:3176`、`:1053`）。
- **注意**：Reasonix 的 Go 侧另有独立更新实现（`desktop/updater.go`：manifest 拉取 + SHA256 校验 + 自替换），那是**自更新的执行机制**，与本次讨论的「何时查、怎么提示」无关，别混为一谈。

### 目标行为（按老大口径）

1. 巡检策略调整（不再是一小时一次就完事）；
2. 发现新版本时，**顶部面板加一个黄色下载图标**，而不是左下角常驻悬浮块。

### 进阶参考：OpenCowork（`D:\koda\OpenCowork`）

| 环节 | 做法 | 位置 |
|---|---|---|
| **触发** | **全文无 `setInterval`** —— 只有「启动时查一次」（受 `isAutoUpdateEnabled` 约束）+ 用户手动点检查 | `src/main/updater.ts:610-611`、`:605-608`；`src/main/index.ts:701` |
| 自动下载 | 开关开着时收到 `update-available` **直接开始下载**，不等用户点 | `updater.ts:551-559` |
| 顶栏指示 | **琥珀色按钮**（`border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`）；下载中 `Loader2` 转圈、否则 `Download`；文案随状态（下载中百分比 / 已就绪 / 更新到 vX）；点击开弹窗 | `components/layout/TitleBar.tsx:341-376` |
| 任务栏进度 | `win.setProgressBar(percent / 100, { mode: 'normal' })` | `updater.ts:378` |
| 下载完成 | **自动弹开更新弹窗** + `toast.success` | `App.tsx:762-773` |
| 失败 | `toast.error` | `App.tsx:775-781` |
| 去重 | main 侧 `notifiedAvailableVersions` + 渲染侧 `shownUpdateVersionsRef`，同版本只报一次 | `updater.ts:354-357`；`App.tsx:738-741` |
| 瞬时错误抑制 | `isTransientUpdateError` / `shouldReportUpdaterError` | `updater.ts:138-158` |
| **有一处不能抄** | 顶栏按钮 class 带 `hidden ... xl:inline-flex` ⇒ **窗口 < 1280px 直接消失** | `TitleBar.tsx:347` |

**对照结论**：OpenCowork 的形态（顶栏琥珀图标 + 弹窗承载详情 + 无左下角浮块）与老大要的一致，**S-111 的目标形态以它为准**。另外——**它的「双层版本去重」与「瞬时错误抑制」我们本来就有**（`silent` 标记 + phase、巡检失败只落日志），无需移植。

### 裁定（2026-09-21 老大）

1. **巡检频率 = 启动一次 + 低频定时（6h）+ 手动** —— 定时器保留但拉长到 6 小时（现为 1 小时；6h 系 2026-09-21 二次拍定，初定 3h 后加长）；**不照抄** Reasonix / OpenCowork 的「只启动查一次」（本机 24 小时常驻，纯启动一次等于永远停在开机那一刻）。
2. **不做自动下载** —— **不抄** OpenCowork 的自动下载，与 **S-109**「先开始下载」保持一致。
3. **顶栏图标用纯图标** —— 不带文案。⚠ 连带：**OpenCowork 那个 `xl:inline-flex` 的坑不抄** —— 图标在任何窗口宽度下都要在。
4. **任务栏进度条** —— 老大原话「抄」，但**我们已经有了**：`src/main/updater.ts:375-376`（下载中，`percent === null` → `indeterminate`，否则 `percent / 100`）、`:390`（下载完成清）、`:409`（出错清）。⇒ **本条无需实施**；若真机没看到，属「已实现但表现异常」，需另查。
5. **左下角浮块：砍掉**（方案 A，2026-09-21 定）—— 依据是弹窗本身已有进度（`UpdateDialog.tsx:146-179`：进度条 + 百分比 + 速率 + 已用时间）；**连带撤销 S-110**。
6. **下载完成自动弹开更新弹窗 + `toast.success`** —— 抄 OpenCowork（`App.tsx:762-773`）。这是「砍浮块」的前提：不补这条，用户不知道下载好了。
7. **图标 hover 带百分比 tooltip** —— 老大口径：「这个图标其实就是替代浮块的」⇒ 浮块原本承载的信息（相位 + 进度）要由图标补齐。
8. **图标常驻** —— 只要有新更新，图标**一直存在**（不自动消失、不做 dismiss），直到下载 + 安装完成。
9. **发现更新即停定时器** —— 老大：「定时就可以关了，不能一直跑定时」。**这条已具备**：`runPeriodicRecheck()` 在 `snapshot.availableVersion || snapshot.downloadedVersion` 时 `stopPeriodicRecheck()`（`updater.ts:566-570`；`stopPeriodicRecheck` 定义 `:551-555`，`clearInterval` + 置 `null`），之后只在**下次启动**由 `initializeUpdater()` 重新起（`:580-586`、`:588-596`）。⇒ **无需实施**。
10. **手动点图标必须重查最新** —— 老大：「手动点击，弹开更新弹窗需要查询最新哦，避免出现你说的 发现更新后续不处理，这时候可能需要一次性更新到最新版本」。现状**不查**（点图标只读快照）⇒ **需实施**，四个风险点见下节。
    - **10a 重查时机 = 方案 B** —— 先开弹窗显示快照、后台同时查，内容随 state 自动刷新，**不引入等待**。
    - **10b 旧包处置 = 方案 A** —— 重查发现更新版本时**丢弃已下载的包**，让用户重下最新。
    - **10c 图标语义 = 「有更新」的信号** —— 无更新时图标**不出现**，故点图标重查只发生在图标已亮时；主动检查只能去**设置页「关于」**点。

### 浮块删除方案（已定，2026-09-21）

**砍掉的可行性取决于三个缺口都有替代载体 —— 三个都已落定：**

| 缺口 | 浮块现在承担的 | 砍掉后的替代 | 是否现成 |
|---|---|---|---|
| A. 下载完成要「主动提醒」 | 浮块显示「已下载，等待重启安装」+「重启安装」按钮 | **自动弹开更新弹窗 + `toast.success`**（OpenCowork 现成做法）；「立即重启安装」在弹窗 footer | 需实施 |
| B. 失败要可见 | `error` 相位浮块显示错误文本 | **`toast.error`**（OpenCowork 做法）；顶栏图标可同时转警示色 | 需实施 |
| C. 窗口隐藏到托盘时 | 浮块同样看不见 ⇒ 靠托盘 | **托盘「更新详情」已存在**（永久项，不依赖更新状态：`src/main/index.ts:203-205`），点击 `showMainWindow()` + 发 `update:show-details` | **现成，无缺口** |

**连带影响（必须一起定）：**

- **S-110 已撤销** —— 它整条就是「更新下载悬浮窗默认位置移到最左侧」，浮块砍掉后无对象可挪（详见 S-110 节）。
- **`shouldLiftToastsForBanner` + `UPDATE_BANNER_TOAST_BOTTOM` 一起删** —— 让位的唯一理由（浮块默认角 = toast 角）随浮块消失（`UpdateStatusBanner.tsx:45-55`、`App.tsx:229`）。
- **`banner-position.ts` 整体可删** —— `clampUpdateBannerPosition` / `placedBannerStyle` / `BANNER_MAX_WIDTH` / `BANNER_MIN_WIDTH` / `BANNER_VIEWPORT_MARGIN` 五个导出只服务浮块；`UpdateBannerPosition` 类型 + `settings-store` 的 `updateBannerPosition` + 迁移里的 `normalizeUpdateBannerPosition` 是否一并清理（涉及存量 settings 字段，删前要确认迁移不炸）。
- **`trayHint` 文案要复核** —— 弹窗里那句「可随时从托盘『更新详情』查看进度」（`UpdateDialog.tsx:172-176`）在浮块消失后成了**唯一**指引，而顶栏图标也是入口，措辞可能要补。
- **`available` 相位的「拒绝」路径** —— 保持「不可关」：纯图标不碍事，且按第 8 条**图标常驻**（OpenCowork 亦无 dismiss，图标常驻至更新完成）。

**结论（2026-09-21 老大，方案 A）**：**砍**。浮块存在的原始理由已被顶栏图标（看得见 + 够得着 + 常驻）与托盘入口接管，进度由弹窗 + 任务栏承担；**S-110 一并撤销**。缺口 A（下载完成提醒）与 B（失败可见）按第 6 条与 OpenCowork 做法补齐。

### 手动点图标需重查最新（2026-09-21 老大，新增）

**现状：点图标不查远端，只读快照**

| 环节 | 事实 | 位置 |
|---|---|---|
| 点图标 / 托盘入口 | `showUpdateDetails()` = `await updater.refreshStatus()` + `setUpdateDialogOpen(true)` | `App.tsx:73-76` |
| `refreshStatus` | `invoke('update:status')` ⇒ **读 Main 的 snapshot**，不碰 GitHub | `use-app-updater.ts:61-68` |
| 真正会查的入口 | 弹窗里的「重新检查」：`onCheck={updater.checkForUpdates}` → `invoke('update:check')` → `requestUpdateCheck()` → `updater.checkForUpdates()` | `UpdateDialog.tsx:237-242`、`use-app-updater.ts:136-157`、`updater.ts:430-473` |

⇒ 今天要拿最新版本，得**先点图标、再点弹窗里的「重新检查」两步**。老大要求合并成一步。

**目标**：点图标 → 顺带触发一次远端检查，使 `availableVersion` 刷新到最新 ⇒ 可**一次性更新到最新版本**（正是「发现更新后不处理、后续版本再也发现不了」的解药 —— 见裁定第 9 条的语义后果）。

**重查本身可行（已核实）**：`checkForUpdatesInternal()` 会真查并把 `latest` 作为 `latestVersion` 回传（`updater.ts:457-465`）；renderer 的 `checkForUpdates` 成功分支用返回值刷新 `phase` / `availableVersion`（`use-app-updater.ts:144-153`）⇒ **能覆盖旧的 `availableVersion`**。

**四个风险点必须一起处理（本条隐藏成本）：**

1. **已下载的旧包会状态错乱** —— `checkForUpdates` 的 setState **不碰 `downloadedVersion`**（`use-app-updater.ts:144-153`）。场景：已下载 0.2.34（`phase='downloaded'`）→ 远端出 0.2.35 → 点图标重查 → `phase` 回 `available`、`availableVersion='0.2.35'`，但 **`downloadedVersion` 仍是 `'0.2.34'`**。而「重启安装」的判据读的正是 `snapshot.downloadedVersion`（`updater.ts:531-548`，`requestUpdateInstall`）⇒ **会装旧包**。需定：重查发现更新版本时是**丢弃已下载的包**（让用户重下最新），还是明确提示「已下载 0.2.34 / 有 0.2.35」。
2. **dev / 不支持检查的形态会让图标消失** —— `checkForUpdatesInternal` 在 `canCheckForUpdates()` 为假时返回 `skipped: true, available: false`（`updater.ts:433-442`）；renderer 据 `available` 把 phase 置 `idle` 并清 `availableVersion`（`use-app-updater.ts:146-148`）⇒ **点一下就查没了**。重查必须对 `skipped` / 失败做保护：**不动原状态**。
3. **`silentAnnounce` 语义** —— 该标记只在 `update:available` 事件与刷新页面时变动（`use-app-updater.ts:74`，`setSilentAnnounce(payload.silent === true)`）。手动重查属用户主动，**不应被当作 silent**，否则 `App.tsx:58-69` 的 effect 会因它把弹窗压掉。
4. **in-flight 共享** —— 点图标时若正好有 6h 巡检在飞，`requestUpdateCheck` 会让手动调用**搭那个车**并沿用第一次调用者的 `checkIsPeriodic`（`updater.ts:475-484`，注释明写「the poll rides along with it」）。`availableVersion` 仍会更新，但别把它误判成静默。

**另需确认**：弹窗里的「重新检查」按钮**保留** —— 弹窗开着时用户可能想再查一次，与「点图标即查」不冲突。

**已定（2026-09-21 老大）**：① 重查时机 = **方案 B**（先开弹窗显示快照，后台同时查，内容随 state 自动刷新）；② 旧包处置 = **方案 A**（发现更新版本即丢弃已下载的包，让用户重下最新）；③ **图标即「有更新」的信号** —— 无更新时图标不出现，点图标重查只发生在图标已亮时；主动检查走**设置页「关于」**。

**由此确认的边界**：风险点 2（dev / 不支持检查会把 phase 打回 `idle`、图标消失）**仍需保留保护** —— 图标亮着时若重查返回 `skipped: true`，不能因一次跳过就把已有的 `available` 状态清掉。

### 顺带发现：手动检查有**三条**路径打同一个 IPC 端点（需收口）

| 路径 | 实现 | 是否复用 `useAppUpdater` | 位置 |
|---|---|---|---|
| 弹窗「重新检查」 | `updater.checkForUpdates` | ✅ | `UpdateDialog.tsx:242` → `use-app-updater.ts:136-157` |
| 设置页「关于 → 检查更新」 | **自己写了一份** `handleCheckForUpdates` | ❌ | `SettingsPage.tsx:298-313` |
| 点图标重查（S-111 新增） | 待实施 | —— | `App.tsx:73-76` |

**设置页那份的三个问题：**

1. **有更新时它自己不做任何提示** —— `handleCheckForUpdates` 只在 `!result.available` 时 `toast.success('当前已是最新版本。')`（`SettingsPage.tsx:303-307`）；`available === true` 分支**什么都不做**。它完全依赖 Main 推 `update:available` 事件（`updater.ts:325-351`；`silent` 仅在 `checkIsPeriodic` 时置 `true`，而设置页不带 `periodic` ⇒ 事件非静默）→ 渲染端 `use-app-updater` 监听器更新 state → `App.tsx:58-69` 的 effect **自动弹出更新弹窗**。⇒ 实际体验是「设置页点检查 → 有更新则更新弹窗自动弹开」。**需确认这是否为期望行为**（还是只要亮图标）。
2. **事件链一旦被拒就完全没反馈** —— `applyAvailable()` 在 phase 不允许时返回 false，Main 只 `logWarn` 并 **return、不推事件**（`updater.ts:335-340`）⇒ 用户点了按钮、界面毫无反应。
3. **状态处理分叉** —— `useAppUpdater` 版先 `setState({ phase: 'checking' })` 再用返回值刷 state；设置页版只调 IPC + 本地 loading、不信返回值。同一个端点两个消费方，行为不一致。

**建议**：S-111 把「检查更新」**收口到一处**（一个实现，三处调用），否则新增的「点图标重查」就是第三份分叉逻辑。

**老大裁定（2026-09-21）：设置页「关于」保持现状、不单独处理**（「设置页的关于不去单独处理了，当前我就挺满意的」）⇒ 上述三个问题**不做**。收口范围相应缩小为**只收拢「点图标重查」与弹窗「重新检查」两处**（都归 `useAppUpdater`），设置页那份 `handleCheckForUpdates` **保持原样、不动**。

### 顺带发现（登记，不单独开刀）

- 设置页开关 `autoUpdateEnabled` 的中文描述「**只在启动时检查**」与实际的**每小时巡检**不符 —— 频率已定 **6h**，文案应随 S-111 一起改成「启动时检查 + 每 6 小时后台巡检」之类。

---

## S-112 顶栏问号图标改为打开设置页「关于」

### 需求（2026-09-21 老大）

> 「还有 titlebar 上有个问号图标，当前是直接跑去网页上，现在调整是打开我们的设置页关于」

### 现状（2026-09-21 实读）

| 环节 | 事实 | 位置 |
|---|---|---|
| 按钮 | 右侧按钮簇第一个，图标 `HelpCircle`，tooltip `topbar.userGuide`（zh「使用指引」） | `layout/TitleBar.tsx:92-102` |
| 点击行为 | `onClick={openUserGuide}` ⇒ **`shell:openExternal` 打开 GitHub 上的 `docs/user-guide.md`** | `TitleBar.tsx:95`；`lib/user-guide.ts:8-12` |
| 目标页 | 设置页 tab id **`'about'` 已在 `SETTINGS_TABS` 白名单内**（无需扩白名单） | `stores/ui-types.ts:87`；导航项 `SettingsPage.tsx:116` |

### 目标行为

问号按钮 → 打开设置页「关于」，**不再外链**。

### 实现（2026-09-21 老大裁定）

**打开路径 = A `openSettings('about')`** —— 老大口径：「这个点击后就相当于正常点击设置页然后点到关于是一样的效果哈」。

- 「正常点击设置页」= 侧栏底部那个设置按钮 `openSettings('provider')`（`WorkspaceSidebar.tsx:441-449`），走的正是 `view='settings'` **整页**这条路径（`App.tsx:222-224`）。
- ⇒ 一致地调 `openSettings('about')` 即可：`view='settings'` + `settingsTab='about'`，与「点设置 → 点关于」逐字等价。
- **TitleBar 消失是正常现象**（整页设置本来就这样），设置页自带返回键 `ArrowLeft` → `closeSettings`（`SettingsPage.tsx:124-139`）⇒ 用户不会走不出去。（先前建议的 B 路径 —— `openSettingsPage` 内嵌 —— **已否**。）

**tooltip 文案 = 「关于」** —— `topbar.userGuide` 由「使用指引」改为「关于」。该 key **全仓只有 TitleBar 一处消费**（`TitleBar.tsx:101`），zh/en 值分别在 `locales/{zh,en}/layout.json:101`（`使用指引` / `User guide`）。⇒ 建议**顺手把 key 重命名为 `topbar.about`**（只有一处消费，留着旧名会名不副实）；en 侧文案同步为 `About`。

**图标**：老大未提，**暂保持 `HelpCircle`**（设置页 about tab 用的是 `Info`；要统一可换，未定）。

**`openUserGuide` 不会变成死代码** —— 关于页里的「查看指引」按钮仍用它（`SettingsPage.tsx:345`），**外链能力保留在关于页内**（即「问号 → 关于 → 查看指引」多一跳）。

### 改动面（预估）

| 文件 | 改动 |
|---|---|
| `components/layout/TitleBar.tsx` | `:95` `onClick={openUserGuide}` → `openSettings('about')`；`:101` tooltip key 改名；**移除 `:6` 的 `openUserGuide` import**（否则成未使用导入） |
| `locales/zh/layout.json`、`locales/en/layout.json` | `:101` 文案「使用指引 / User guide」→「关于 / About」（key 同步改名） |

---

## S-113 官网前端项目（`website/`）

> **明细文档：同目录 `website.md`** —— 本文件只登记条目，不重复技术细节。

### 需求（2026-09-21 老大）

> 「官网我们还没有开发。我打算在 wishfulclaw 中新增一个前端项目，就是用于呈现官网。以及以后我们发布版本的时候顺便更新官网的最新包」
> 「域名刚备案，但是官网需要列入进程了」

### 一句话立项

**在 `wishful-claw` 仓库内新增独立静态前端项目 `website/` 承载官网（单页 + 独立 `/download`）；下载源改造一并规划但推迟实施。**

### 要点

| 项 | 内容 |
|---|---|
| 形态 | 单页 + 独立 `/download` 页，纯静态 |
| 技术栈 | **Vite + React 19 + Tailwind 4**（复用本仓依赖，不引新工具链） |
| 位置 / 依赖 | 根级 `website/`，**独立 `package.json`**；**门禁零污染**（四条链路已核证，见 `website.md` 第四节） |
| 内容口径 | 权威源 = 知识库 `D:\koda\Obsidian\05-WishfulClaw\官网方案.md`（**只读**） |
| 阶段 | ① 骨架+单页+本地构建 → ② 素材替换 → ③ Nginx+HTTPS+备案号（等备案）→ ④ 下载源改造（等备案） |

### ❗ 明确排除

- **下载源改造（COS 直链 / `latest.yml → latest.json` / app 内更新迁 COS）暂时不动手** —— 老大 2026-09-21：「目前下载源更新暂时不动手，等官网备案过了再调整」。**只是推迟不是取消**，设计结论保留在 `website.md` 附录。
- Nginx 部署 + 备案号：等备案通过。

### 待确认

1. ~~备案状态~~ → **已确认（2026-09-21）：域名备案已提交、尚未通过**；**阶段 1/2 可先行**（老大「搭建代码可以先行」），阶段 3/4 等通过。
2. 官网版本号来源（阶段 1~2 可占位）
3. 是否纳入主门禁（`test:*` 脚本）

---

## 待登记

> iter-33（`v0.2.33`）收尾时已取证、**未纳入实施**的项，**原样结转**到本候选池。
> `docs/plans/iter-v2-33/**` 是历史计划文档，按口径不再改动，候选池不在本文件延续就会失联。
> **均未立项**；老大点名后才排入实施。

### 代码 / 行为类

1. **档案页 Refresh / 切项目会丢弃未保存草稿**（来源：iter-33 `verification_report.md` §2.8 R4）。`ProjectArchivePage.tsx:159-165` 的 `handleReload` 无条件 `reloadToken + 1` ⇒ `key` 变化强制重挂载；`memoryPath` 变化同样重跑 `load`。改动前切 tab 时草稿也已丢，**非回归**，但 iter-33 承诺的「切 tab 不丢草稿」不覆盖这两条路径。建议：有脏稿时先提示或跳过刷新。
2. **热记忆镜像判重是「子串包含」+ 500 条扫描窗口**（来源：iter-33 `verification_report.md` §2.8 R5）。`memory-hot-sync.ts:15` 的 `DB_SYNC_SCAN_LIMIT = 500`；`:68-76` 用归一化后的**互相包含**判重 ⇒ 新记忆若是既有条目的子串 / 超串会被**永久跳过**；单 scope 超 500 条后窗口外的重复项可能被重复插入。建议：改指纹（精确等值或哈希）+ 分页读取。
3. **GrepTool 残余**（来源：S-88 审查 ⚠️-5）：文件名 glob 正则**无超时**（agent 入参可控）；连续 `*` 未折叠成单 `*`；`SearchFilter.IsExcluded` 默认排除名单未核。

### 测试缺口

4. **三处无自动化断言**（来源：iter-33 `verification_report.md` §2.8 R1/R2/R3）：常驻挂载（S-91 tab 语义）/ 镜像前移与幂等（S-93）/ `aria-labelledby`（S-90）。`Grep tests/` 对 `memory-organization|memory-hot-sync|mirrorHotParagraphs` **0 命中**。建议补纯函数级单测（`extractHotParagraphs` + 判重：第二次 `count = 0`）。

### 大文件红线 / 工程卫生

5. **超 500 行红线**（`AGENTS.md`）：`ContextCompression.cs` **839 行**、`memory-organization.ts` **636 行**（iter-33 已豁免记档）、`memory-automation-utils.ts` **618 行**（死代码链）、`ToolDispatchRouter.cs` **573 行**。建议按模块重组另开一刀。
6. **行尾损坏**：约 20 个文件的磁盘形态是 `\r\n\r\n`（每个逻辑行后多一个空白行），历史层取证显示**每个历史提交都如此**（`GrepTool.cs` 空行恒占 ~58%）。iter-33 只修了 `GrepTool.cs`。建议全仓一次性折叠并加 `.gitattributes` / 提交钩子防复发。

### 既有残留（iter-33 未动）

7. `projectArchive.tabs.dormant` 孤儿 i18n key；`memory-files.ts` 的 daily 三函数；`MemoryModels.cs` 的 `DailyCount` / `TopicsCount` 死字段（「每日记忆」无实体）。
8. cron `CronRuns` 的跨会话权限面（是否该限制到本会话项目）；sidecar 共用合成 `sessionId` 的语义。
9. `AgentLoop.Helpers.cs` 的 `state.PendingMemoryRecall` 是死变量（消费点永远早于设置点）。
10. `ToolCallCard/output-blocks/memory-output.tsx:115` 的 `hit.priority` 仍是裸英文（iter-33 的 S-106 只收了 `MemoryPanel` / `MemoryEntriesTab` / `ProjectMemoryLibraryTab`）。
11. 5 个 C# 回归套件跑完不自清目录（`npm run test:clean` 兜底）。

### 待裁定（老大提出，尚未定性）

12. **遗留测试工程体量**：老大 2026-09-20 提出「这些测试项目基本都是遗留的东西，是不是大部分可以干掉了」—— **未裁定**。裁前需先出一份现状清单（工程名 / 断言数 / 是否被 `run-tests.mjs` 收编 / 最后一次改动），再定去留。

---

## 裁定记录

- 2026-09-20：**iter-34 立项开工**（老大「先拆分34迭代吧」）。分支 `dev/v2-iter-34` 从 `main` @ `02e57d3f`（`v0.2.33`）切出；递归上一轮，iter-33 已收尾合并 main、tag 与 Release 均就位。
- 2026-09-20：iter-33「待登记」11 条**原样结转**到本文件候选池（对应本文 1~11），**均未立项**。理由：iter-33 已收尾，`docs/plans/iter-v2-33/**` 按口径冻结，候选池不延续即失联。
- 2026-09-20：**S-107 立项**（请求上下文上限纳入全局设置、会话默认继承）。**只登记不执行**（老大：「登记一点小东西，暂时先不做」）。勘测结论：全局压缩设置页只有开关 + 触发比例两项，**「请求上下文上限」全局侧整个缺失**；会话级上限现挂在 `ContextRing` 面板，且受 S-84「换模型作废」约束 ⇒ 全局值落地前必须先与 `capModelId` 语义解耦（本节 4 条待裁定）。
- 2026-09-20：**S-108 立项**（模型窗口 384K 未生效，后端按 200K 兜底触发压缩）。**只登记不执行。**
  **口径更正（同日，老大）**：初版按「会话上限被夹回 200K」登记 —— **方向错了**。老大**没设过会话上限**，384K 是**模型档案窗口**；症状是「前端百分比正常、后端约 46% 就压缩」⇒ 问题在**后端取值链**。已核实：后端压缩窗口**只读 `provider.contextLength`、读不到即兜底 200K**；且前端（`resolveSessionModelSelection`）与 payload（`activeProvider.models.find`）**是两条不同的模型解析路径**，指向不同档案或 id 对不上就会分叉。**定案证据现成**：Worker 日志 `context compression DIAG` 行直接打印 `contextLength` / `trigger`（`AgentLoop.cs:698`）—— 看它是 200000 还是 384000 即可对半砍。
- 2026-09-20：**S-109 立项**（更新弹窗主按钮先「开始下载」、下载中变「后台下载」并收起）。**只登记不执行。** 已核实现状：中文文案 key `updater.dialog.download` 的值就是「后台下载」（`locales/zh/settings.json:1514`），下载中另给的是「稍后」按钮。
- 2026-09-20：**S-110 立项**（更新下载悬浮窗默认位置移到最左侧）。**只登记不执行。** 已核实现状：默认锚点为「左下角 + 左边栏宽度偏移」（`bannerLeft = leftSidebarOpen ? leftSidebarWidth + 16 : 16`），该偏移存在的唯一目的就是避开左侧面板 —— 老大明确不要这个顾虑。
- 2026-09-20：**S-111 立项**（更新机制调整：巡检策略 + 顶部黄色下载图标取代常驻悬浮块）。**只登记不执行。** 参考对象定为 `D:\koda\DeepSeek-Reasonix-main-v2`。已核实：本项目巡检为 `updater.ts:52` 硬编码 **1 小时**、`available` 相位在 `VISIBLE_PHASES` 内（`UpdateStatusBanner.tsx:29-38`）⇒ **新版本一被发现，左下角悬浮块就一直挂着**（且无关闭按钮，是刻意设计）；`TitleBar` 右侧**无更新指示位**。Reasonix 为「只在挂载查一次 + 只在可行动时出现 + 顶部可关闭横幅」，无小时级轮询。**巡检频率要先拍**（照抄 Reasonix 与本项目 24 小时常驻定位冲突）；点击图标行为与 **S-109**、toast 让位与 **S-110** 需一并定。
- 2026-09-20：**顺带记**（未立项）：设置开关 `autoUpdateEnabled` 的中文描述「只在启动时检查」与实际的每小时巡检**不符**。
- 2026-09-21：**S-111 第 1~4 条裁定**（老大）：① 巡检频率 = **启动一次 + 低频定时（6h）+ 手动**（初定 3h，同日二次拍定加长为 **6h**）；② **不做自动下载**；③ 顶栏**纯图标**；④ 任务栏进度条**无需实施（已具备）**。第 5 条「浮块砍不砍」老大要求先讨论（「下载浮块可以考虑砍了，我们本身弹窗里面是有进度的 这个需要讨论一下」）⇒ 已列出三个缺口的替代载体与连带影响（S-110 失去对象等），**结论待拍**。
- 2026-09-21：**参考对象增加 OpenCowork**（`D:\koda\OpenCowork`）—— 它「启动查一次 + 手动、无 `setInterval`」，顶栏是**琥珀色按钮**（`TitleBar.tsx:341-376`），**无左下角浮块**，下载完成自动弹窗 + `toast.success`，失败 `toast.error`。形态与老大要的一致 ⇒ **S-111 目标形态以 OpenCowork 为准**（其 `xl:inline-flex` 窄窗消失的坑不抄）。其「双层去重」「瞬时错误抑制」我们本已有，无需移植。
- 2026-09-21：**S-111 第 5~9 条裁定**（老大，方案 A 全套）—— ⑤ **浮块砍掉**；⑥ **下载完成自动弹窗 + `toast.success`**（抄 OpenCowork）；⑦ **图标 hover 带百分比 tooltip**（「这个图标其实就是替代浮块的」）；⑧ **图标常驻**（有新更新就一直存在）；⑨ **发现更新即停定时器**（已具备，无需实施）。
- 2026-09-21：**S-110 ❌ 撤销** —— 随 S-111 砍浮块一并作废（无实施对象）。`docs/plans/iter-v2-34` 中 S-110 节改为历史记录保留。
- 2026-09-21：**S-111 裁定完毕，可开工**（实施态另行触发）。
- 2026-09-21：**巡检频率由 3h 加长为 6h**（老大：「1h → 6h 我想了下 加长点吧」）⇒ `PERIODIC_RECHECK_INTERVAL_MS` 定为 `6 * 60 * 60 * 1000`。设置页 `autoUpdateEnabled` 的说明文案随之按 6h 定稿。
- 2026-09-21：**S-111 第 10 条立项**（老大：「手动点击，弹开更新弹窗需要查询最新哦，避免出现你说的 发现更新后续不处理，这时候可能需要一次性更新到最新版本」）⇒ 点图标须**顺带重查远端**。已核实现状**只读快照不查远端**（`App.tsx:73-76` → `refreshStatus`），拿最新版需「点图标 + 点『重新检查』」两步。重查本身可行（`checkForUpdatesInternal` 会真查并回传 `latest`），但**四个风险点**须一并处置：① 已下载旧包与 `availableVersion` 错乱（`downloadedVersion` 不被清 ⇒ 可能装旧包）；② dev/不支持检查时重查会把 phase 打回 `idle`、图标消失，须对 `skipped` 做保护；③ `silentAnnounce` 不该把用户主动重查当静默；④ in-flight 共享会沿用巡检的 `checkIsPeriodic`。
- 2026-09-21：**S-111 第 10 条三项子裁定**（老大）—— **10a 重查时机 = 方案 B**（先开弹窗、后台同时查，内容随 state 刷新，不引入等待）；**10b 旧包处置 = 方案 A**（发现更新版本即丢弃已下载的包）；**10c 图标语义 = 「有更新」的信号**（无更新时图标不出现 ⇒ 点图标重查只发生在图标已亮时；主动检查走**设置页「关于」**）。
- 2026-09-21：**顺带发现（随 S-111 处理）** —— 「检查更新」现有**三条路径打同一个 IPC 端点 `update:check`**：弹窗「重新检查」（复用 `useAppUpdater`）、设置页「关于」（**自己写了一份** `handleCheckForUpdates`）、点图标重查（待实施）。设置页那份**有更新时自己不做任何提示**（仅靠 Main 推事件 → App effect 自动弹窗）、**事件被拒时毫无反馈**（`updater.ts:335-340` 只 `logWarn` return）、**状态处理与 `useAppUpdater` 分叉**。⇒ 建议 S-111 把「检查更新」**收口到一处**。
- 2026-09-21：**设置页「关于」保持现状、不单独处理**（老大：「设置页的关于不去单独处理了，当前我就挺满意的」）⇒ 上面那条的三个问题**均不做**；S-111 的收口范围缩小为**只收拢「点图标重查」与弹窗「重新检查」**（都归 `useAppUpdater`），设置页那份不动。
- 2026-09-21：**S-112 立项**（顶栏问号图标改为打开设置页「关于」）。**只登记不执行。** 现状：`TitleBar.tsx:92-102` 的 `HelpCircle` 按钮 `onClick={openUserGuide}` ⇒ `shell:openExternal` 开 GitHub 的 `docs/user-guide.md`（`lib/user-guide.ts:8-12`）。目标页 tab id `'about'` **已在白名单内**。**待裁定**：① 用 `openSettings('about')`（整页、TitleBar 消失）还是 **`openSettingsPage('about')`（内嵌、TitleBar 保留，建议）**；② tooltip「使用指引」文案同步改；③ 图标是否由 `HelpCircle` 换成 `Info`。
- 2026-09-21：**S-112 定案**（老大「文案改成关于，这个点击后就相当于正常点击设置页然后点到关于是一样的效果哈」）—— **路径 = A `openSettings('about')`**（与侧栏「设置」入口 `WorkspaceSidebar.tsx:443` 的 `openSettings('provider')` 同一条整页路径，逐字等价；TitleBar 消失属正常，设置页自带 `ArrowLeft` 返回 `SettingsPage.tsx:124-139`）⇒ **先前建议的 B 被否**。**tooltip 文案 = 「关于」**，`topbar.userGuide` 全仓仅 `TitleBar.tsx:101` 一处消费（zh/en 值在 `locales/{zh,en}/layout.json:101`）⇒ 建议顺手把 key 改名 `topbar.about`。图标老大未提，**暂保持 `HelpCircle`**。
- 2026-09-21：**S-113 立项**（官网前端项目）—— 老大「官网我们还没有开发。我打算在 wishfulclaw 中新增一个前端项目，就是用于呈现官网。以及以后我们发布版本的时候顺便更新官网的最新包」「域名刚备案，但是官网需要列入进程了」。**登记方式取 A**：本文件立 S-113 条目，**明细单开同目录 `website.md`**（已建，104 行）。技术栈/依赖归属/位置按我的推荐（老大「按照你的推荐来」）：**Vite + React 19 + Tailwind 4 + 独立 `package.json` + 根级 `website/`**，**门禁零污染已核证**（`tsconfig.node/web` 的 include、`electron-builder.yml` files 白名单、`.gitignore`、`run-tests.mjs` 四条链路均不扫）。
- 2026-09-21：**下载源改造推迟**（老大：「目前下载源更新暂时不动手，等官网备案过了再调整」）⇒ COS 直链 / `latest.yml → latest.json` / app 内更新迁 COS **本阶段全部不做**，**等备案通过后调整**。设计结论（一个源两个消费方）保留在 `website.md` 附录备查。⇒ **S-111 的更新链路本阶段仍走 GitHub Releases**。
- 2026-09-21：**备案状态确认 + S-113 开工时机** —— 老大「域名是刚提交，所以我们搭建代码可以先行，不过下午 6 点后我们动手更便宜」⇒ ① 域名备案**已提交、尚未通过**（管局 5-10 工作日）⇒ **阶段 3/4 等通过，阶段 1/2 可先行**；② **动手时机定在 2026-09-21 下午 6 点后**（成本更优），**6 点前不动手**。
- 2026-09-21：**开工时机放开**（老大：本会话非 wishfulclaw 软件内跑，不用等 6 点）⇒ S-113 阶段 1 即刻推进。
- 2026-09-21：**S-113 下载区口径**（老大：「这个需要两个都有，一个是官网的，一个是跳去 GitHub」）⇒ 下载入口**两个并列**：① 官网直链（主按钮，阶段 1 URL 空占位、置灰提示「建设中」，阶段 4 接 COS 后填充即生效）；② GitHub Releases（次按钮，跳转）。两 URL 走 `latest.json` 运行时读取，**先前「主按钮暂指 GitHub」的草案口径作废**。
- 2026-09-21：**S-113 阶段 1 实施完成**（本会话）—— `website/` 骨架 + 单页 10+1 区块 + 独立下载页 + `latest.json` 运行时读取 + 双下载入口，构建/两页浏览器实渲/主仓 typecheck + `npm test` 45/45 全过。计划与验证：`docs/plans/iter-v2-34/plan-s113/`。验证中修复一处自有缺陷（下载页顶部导航锚点死链）。遗留：视觉精修并入阶段 2、`/download` 干净 URL 待阶段 3 Nginx `try_files`。
- 2026-09-21：**S-113 阶段 1 视觉改版**（老大看首版：「参考 reasonix 的官网，你这个有点那啥」）—— 抓 `reasonix.io` 设计 token 后重构：深色朴素 → **浅色纸面 + 品牌橙 + 居中大标题关键词高亮 + 状态徽章 + 13px 圆角卡片 + 下载双卡并排 + 滚动 reveal 渐显**（带 1.5s failsafe）。强调色保留龙虾橙不抄其蓝。改版后 website tsc/build、两页实渲、主仓 typecheck + `npm test` 45/45 全复验通过。折进阶段 1 同一提交（本地未 push）。详见 `plan-s113/verification_report.md` §4。
