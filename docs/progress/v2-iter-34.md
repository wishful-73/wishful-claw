# v2-iter-34：S-107 ~ S-139

- 状态：**已收尾**（合并 main + tag `v0.2.34` + Release）
- 分支：`dev/v2-iter-34`（base `main` @ `02e57d3f`，即 v0.2.33 收尾点）
- Plan：`docs/plans/iter-v2-34/`（`plan.md` / `plan-b2.md` / `plan-s113/` / `plan-s114/` / `plan-s132/` / `plan-s134/`）
- 原始需求：`docs/plans/iter-v2-34/raw-requirements.md`
- 产品版本：`0.2.34`
- 日期：2026-09-21 ~ 2026-09-22

## 已落刀（20）

> 另有质量刀 `424c4d64`「验收修正与文档组织改制」（98 files，+3672/−1812）：S-109 弹窗收缩与按钮行为、`CHAT_MIN_WIDTH` 530 → **600**、S-134 三条微调、正文网址可点（`web-url.ts` + `WebUrlCode.tsx`）、官网端口 5280 / 5281，以及文档改制（`iteration-plan.md` 988 行 → 166 行 + `docs/iterations/` 38 个明细 + `dev-workflow.md` 目录约定）。

| 提交 | 需求 | 内容 |
|---|---|---|
| `16aa97f4` | S-113 阶段 1 | 官网骨架与单页内容 |
| `a4ce3c61` | S-114 / S-116~S-121 / S-122~S-125 / S-127 / S-128 | 官网首版完成 |
| `24311a9e` | S-130 + S-131 | 聊天窗最低宽度守卫补全 |
| `14468e3f` | S-112 | 顶栏问号 → 设置页「关于」 |
| `31b53119` | S-111 | 更新机制：巡检 6h + 顶栏图标取代常驻浮块 |
| `de390331` | S-132 | 彻底去掉子代理轮次上限 |
| `544e1eb7` | S-133 | 流式正文不再被工具卡从中间截断 |
| `6fc9d72d` | S-115 | 项目工具建会话补 `model_selection_mode`，不再撞 NOT NULL |
| `e5dd5ee0` | S-109 | 更新弹窗主按钮拆成「开始下载」/「后台下载」两步 |
| `b447fd20` | S-108 | `contextLength` 缺失时告警，不再静默 undefined |
| `df857315` | S-107 | 全局请求上下文上限，会话默认继承 |
| `466ca6a4` | S-107 调档 | 全局上下文上限改固定档位滑条（200K / 400K / 800K / 1M） |
| `244e4d18` | S-134 | agent 可起、可读、可停的常驻终端 |
| `951706d4` | S-135 | 流式渲染降级：主进程侧自适应事件批处理 |
| `30c4392b` | S-136 | 消息「分叉」成新会话 |
| `e1c7447e` | S-136 修正 | 分叉按**真实消息 id** 回查 —— 原按排序下标，中途压缩过就对不上 |
| `f0d99d4c` | S-137 | shell「停止进程」真生效（C# 侧杀进程树，main 只转发） |
| `4eb5fc05` | S-138 | 朗读音色可配（音色 / 语速 / 音调）+ 设置页试听 |
| `3366f8f1` | S-133 补完 | 流式正文不再被**思考块**从中间劈开 |
| `51571a62` | S-139 | 消息操作按钮组死链清理 + 「编辑」改回填输入框 |

### S-111 更新机制调整：巡检 6h + 顶栏图标取代常驻浮块

- **巡检**：1h → 6h；**发现更新即自停**巡检（不再空转），无更新时不占任何位置。
- **顶栏**：新增常驻更新图标（hover 带百分比 tooltip），**取代左下角下载浮块** ⇒ 连带撤销 S-110，Toaster 的让位 offset 一并撤掉。图标不按相位判可见性，否则点上去的瞬间会消失。
- **交互**：点图标重开弹窗时先查一次远端，避免「已发现更新却一直在处理旧版本」。
- **提示**：下载完成改为 `toast.success`（原由浮块承担）；设置页关于的开关描述改为「启动时检查一次，之后每 6 小时在后台巡检」。
- **两处保护**：已下载过同一版本时不再推倒状态重来（否则点一次图标就得重下一遍）；新版本确实变新时清掉磁盘上被取代的已下载包。

### S-112 顶栏问号图标改为打开设置页「关于」

顶栏问号原来是外链打开使用指引网页，改为 `openSettings('about')` 直接落到设置页关于页；tooltip 与语言文件 key 同步改名 `topbar.userGuide` → `topbar.about`。`openUserGuide` 本身保留（设置页关于里的「查看指引」仍在消费它），未成死代码。

### S-113 / S-114 / S-116~S-128 官网（独立前端项目）

仓库根新增独立静态前端项目 `website/`（Vite + React 19 + Tailwind 4，**独立 `package.json`**，门禁零污染已实测）。四个页面：首页、`/guide`（使用指引）、`/changelog`（更新日志）、下载页。

- **干净路由**（S-121）：`/guide` 而不是 `/guide.html`。
- **版本与下载 URL 运行时读** `public/latest.json` ⇒ 发版零官网构建。
- **更新日志**实拉 GitHub Releases，失败自动隐藏。
- **首页收敛**：删「对比大厂」两板块与成本对比（S-122）、删「服务商完全自由」整类优势（S-124）、去顶部版本号徽章（S-125）、对外撤掉「非正式版」自标只留版本号（S-123）。
- **首屏结构**（S-127）：Hero 回到第一块，「不花钱」由副标题承担，三层阶梯从 618px 压成 295px 窄带 —— 原布局里它占满首屏，把产品主标题挤到 770px、截图整个出屏。
- **文案去歧义**（S-128）：重度层「自带 key、自选渠道，用多少花多少」改为「软件不收费，费用按实际用量结算」—— 原句两处歧义都指向相反意思。
- **下载区**：状态标签收进按钮内部并绝对定位，三平台按钮等宽等高；Windows 直链指向 GitHub Release，**官网上线后改 `latest.json` 一个值即切换**。

### S-130 + S-131 聊天窗最低宽度守卫补全

- **S-130**：`CHAT_MIN_WIDTH` 800 → 530。原判据「工具栏那一行放不下会被裁」已部分失效（左组现有 `overflow-x-auto`，最坏是横向滚动）；真正硬约束只剩右组 `shrink-0`，估算 260~280。
- **S-131**：`WorkspaceSidebar` 渲染时补 `clampLeftSidebarWidth`，与右栏 `RightPanel.tsx:131` 对齐。此前左栏**裸用** `leftSidebarWidth`、视口变小不跟着收，拖窄窗口会把聊天窗挤破底线（900 视口 + 左栏 420 ⇒ 聊天窗 480）。**只收渲染值、不回写 store**，窗口拉回即可恢复。

### S-132 彻底去掉子代理轮次上限

产品层**不再拿 `maxTurns` 当硬截断依据**：任何真子代理 run 一律不限轮次，`maxTurns` 降级为「轮次提醒点」。改前它被原样送进子 run 的 `maxIterations`，撞上限即被掐断，且状态仍报 `completed`、产出全丢。

- `SubAgentExecutor.Parameters.cs`：`BuildChildParameters` **恒写** `maxIterations=0`；skip 列表加入 `maxIterations`（原先先拷贝再覆盖一次，产物出现**重复键**）；该方法 `private` → `internal` 供回归测试。
- `AgentLoop.cs`：`hasIterationLimit` 排除真子代理 run（`sessionMode ∈ {subAgent, goalSubAgent}`，内联自算并放宽大小写；不触碰 `:59-60` 那对变量，避免改变 `conversationKey` 行为）。
- `limits.ts`：`DEFAULT_SUB_AGENT_MAX_TURNS` 12 → 0。
- `Program.SubAgentReminder.cs`：新增 4 条断言，锁「组装后恒 0」。

**判据绑定 `sessionMode`，不是「有没有传 `maxIterations`」** —— 侧边栏 / 生成标题 / 记忆整合 / 翻译都用 `maxIterations: 1` 表达「只发一轮、不调工具」，绑错会把它们全变成无限轮。**不改用户机器上的 `maxTurns: 8/10` 定义文件**：恒写 0 后自动失效。

### S-133 流式正文不再被工具卡从中间截断

**根因在 store，不在渲染层**（前次判断已修正）：`flushStreamDeltas` 追加文本时只认「**末尾那个** segment 是 text」，而工具卡是 `push` 到末尾的 ⇒ 卡之后到达的文本只能**另起一段** ⇒ 同一段正文被劈成两个 `text segment`，渲染时表现为正文被卡从中间切开。这与实测吻合：**先出正文、再调工具**出问题，**先调工具、后出正文**正常。

改法：跨过末尾连续的 `tool_use` **往前找**最近的非 tool segment —— 撞到 `text` 且同 `iteration` 就并回去，撞到 `thinking` / 别的 `text` / 到头就新建。`iteration` 判据天然区分「同一响应内的碎片」与「跨轮次的独立文本」。渲染层的 `splitProcessAndFinal` 只是把「已经劈开的数据」切得更明显，**未改动**。

### S-107 全局请求上下文上限（含调档）

设置页「上下文压缩」节新增全局「请求上下文上限」，会话默认继承。唯一出口 `resolveEffectiveContextCapTokens`：会话值仍受「换模型作废」约束，**全局值不绑模型**；`context-ring` 的「跟随全局」一次还原压缩阈值与上限两项。

**调档（`466ca6a4`，7 files）**：第一版的数字输入框与 `0 = 不限制` 被老大否掉（「档位没有 0 没有不限制，我搞不懂你非要弄不限制干嘛」）⇒ 改**固定档位滑条** `200K / 400K / 800K / 1M`。`clampGlobalContextCapTokens` 语义从「夹到量程」改成「**吸附到档位**」（档位是白名单不是范围）；非正数（含旧的 0 哨兵）与非法值**回落默认档 1M 而不是吸到最低档** —— 吸到 200K 等于把老窗口静默砍一半。`settings-store-migrate.ts` 加 v41 迁移**同时吸附内存态**（只靠 `partialize` 会留下「滑杆停在 400K、发给后端的还是 384000」的两套账）。新增 `globalContextCapStageIndex` 做下标换算的唯一入口。

### S-108 `contextLength` 缺失静默 undefined

后半段（缺失时告警）已落 `b447fd20`；前半段「384K 显示却按 200K 压缩」**老大 2026-09-22 结案：未复现，挂账不修**。取证结论是**前后端两套分母** —— 前端按模型窗口 384k 算百分比、后端按会话级 cap 200k 算触发线，两个百分比被当成同一个。200000 的唯一来源是会话滑条**最左端**（`MIN_SESSION_CONTEXT_CAP_TOKENS = 200_000`）被拖到底。遗留隐患记档（滑条 0 语义、两处 `currentModelId` 不同源、两套分母未统一）。

### S-109 更新弹窗主按钮语义

`e5dd5ee0` 把主按钮拆成两步：初始「开始下载」→ 下载中变「后台下载」，点后收窗。**老大 2026-09-22 追加两处小调整（已随 `424c4d64` 落盘）**：① 点「开始下载」不再自动收窗（原先直接跳过「后台下载」那个按钮，进度也看不见）；② 弹窗尺寸 `sm:max-w-5xl / min-h-[70vh]` 收到 `sm:max-w-2xl / min-h-[28rem]`（缩约三分之一，全屏查阅仍在）。

### S-115 项目工具建会话撞 NOT NULL

`6fc9d72d`：`create_session` 补 `model_selection_mode`，两个项目都复现的 `SQLite Error 19` 消失。

### S-134 常驻终端（agent 可起、可读、可停）

`244e4d18`，16 files，+981/−7。新增 `Terminal` 工具（`action: start / read / stop`），反请求落到 main 现成真 PTY 会话管理器，复用现成 `LocalTerminal` 渲染、**零新增渲染组件**；agent 起的进程建 tab 并**打开该会话的底部面板**（非当前会话、或面板已打开时只加 tab 不抢选中 —— 口径见下方验收修正）；`ShellApprovalTools` 加 `"Terminal"` 接同一套审批（子代理 / 自动化 / 频道仍被 `NoHumanToAnswer` 挡住）。两个改动前即超 500 行的文件（`ToolDispatchRouter.cs` 573 / `terminal-handlers.ts` 512）补豁免头注释。详见 `raw-requirements.md` 与 `plan-s134/`（阶段三 PASS ❌0 ⚠️5，5 条建议已全部回写计划）。

**验收修正（已随 `424c4d64` 落盘）**：老大真机报「没有 `PS D:\claw\wishful-claw>` 那行」「Ctrl+C 观感不对」——同一根因：带 `command` 时走 `powershell -NoProfile -Command`，PowerShell 进非交互模式（无提示符 / 无回显 / 无 profile / Ctrl+C 杀整个 shell）。改成**启交互式 shell 再把命令敲进去**；同时 `read` 改**增量**（`lastReadSeq` 游标，第一次 read 不重放 start 的 tail），并用 `\x03` 中断标记修掉「用户 Ctrl+C 后 start 同命令仍 attach 到空闲终端」。代价：短命令不再回 `exitCode`（契约本意就是要 exitCode 用 Bash）。`TerminalTool` 断言 26 → 27。**追加（同轮）**：老大真机反馈「启动终端没有默认打开底部终端面板」⇒ `_onCreated` 反转原「建 tab 但不动屏幕」口径，起终端即打开该会话面板（非当前会话、或面板已打开时只加 tab 不抢选中），详见 `raw-requirements.md` S-134「验收修正」第 4 条。

### S-135 流式渲染降级

主进程侧新增**自适应事件批处理**（`src/main/ipc/batcher/` 三文件：批处理本体 / codec / config），`agent-stream-handler.ts` 由「17 行裸转发」改为经批处理再广播。**前台 / 后台两档刷新率**（约 30fps 与更低的背景档）+ `maxBufferSize` 上限 + idle 超时；控制类事件**不走合批、直通**。新增 `test:adaptive-event-batcher`（26 断言）。落点选 **main** —— 少一次跨进程 IPC 就少一次渲染。

### S-136 消息「分叉」成新会话

`session-slice.ts` 补上原先**只有类型声明、没有实现体**的 `forkSessionFromMessage`：截到目标消息为止复制（消息重 id）→ 建新会话并切 active → **逐条 `dbAddMessage` 落库** → 返回新 id。`action-bar` 接线。
**修正刀 `e1c7447e`**：原实现按**排序下标**定位消息，会话中途触发过上下文压缩就对不上 ⇒ 改为按**真实消息 id** 回查。

### S-137 shell「停止进程」真生效

选**方案 B（接通）而不是 A（删按钮）**。关键架构差异：我们的 `Bash` 是 **C# 内联执行**，**main 手里没有进程句柄** ⇒ 中止只能由 C# 侧做、main 只转发（OpenCowork 那套 main 直接 abort 的代码抄不动，只能抄设计）。

- `ShellExecuteTool.Process.cs`：杀**进程树**；并补回「**外部取消也应走 kill 分支**」—— 原 `catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)` 恰好把外部取消排除在外 ⇒ 会话「停止」时留孤儿进程（顺带修掉的独立真 bug）。
- main `worker-forward-handlers.ts` + 渲染层 IPC 路由接上转发链路。
- **同时砍掉恒不渲染的后台按钮组**：`backgroundProcesses` 初值 `{}` 且两个写入点全仓零调用 ⇒ 那组「打开会话 / Ctrl+C / 停止进程」**从不出现**。纯删除、不改逻辑。

### S-138 朗读音色可配

设置页「通用」新增**音色下拉 + 语速 / 音调 + 预设文本试听**；`lib/speech.ts` 收敛朗读入口（在回调里读最新设置，不让每条消息各订阅一遍）。**砍掉两件**：① 云端 TTS —— 老大否掉，且它是给用户用的，收费就尴尬；② 「引导下载语音包」—— 实测本机 OneCore 中文语音**只有 3 个且全部已装**，引导等于引导去空货架。
**变声器路线当场否掉**：`speechSynthesis` 的音频由浏览器直接交给系统音频输出，JS 侧**拿不到任何音频出口**（无 `MediaStream` / `AudioBuffer` / 回调）⇒ 不是代价大小问题，是**通路不存在**。

### S-133 补完（`3366f8f1`）

首刀 `544e1eb7` 修的是「**工具卡**劈开正文」；老大真机复现的另一形态是「**思考块**劈开正文」（「沙」+ 思考块 + 「箱」被挤到下一行）。`chat-store/index.ts` 同法收口：跨过末尾的 `thinking` 段往前找最近的 text 段并回去。

### S-139 消息操作按钮组死链清理

`51571a62`，**20 files，+68 / −571**（净删 503 行）。TS → C# 迁移留下的孤儿 UI 契约。

- **删三条死链**：重新生成 / 删除消息 / 继续执行 —— 含横跨 13 个文件的 `showContinue` 判定位与数据字段（`useMessageListData` 真算过 `continueAssistantMessageId`，但**零消费**；渲染链实际走的是硬编码 `false` 的 `RenderableChatItem.showContinue`）。
- **删 `UserMessage` 内联编辑态整套**（state / 副作用 / 逻辑 / UI / 11 个 import），连带 `UserSkillEditControl` 变死组件一并删。
- **「编辑」按钮改为把内容追加回底部输入框**（命令 `/名字 正文`、技能 `[Skill: 名字]` + 换行正文、普通为展开正文，图片一并带上）：**不截断历史、不自动重发**。回填由**拥有输入框的容器**（`SessionConversationPane` / `floating-chat-window`）接 `onEditUserMessage` 灌 store —— **不能在 `UserMessage` 内直连 store**，导出视图与静态转录也会渲染它。
- 清 zh / en `chat.json` 死键 9 个。

**踩到一个坑（已修正）**：我最初把回填逻辑放进 `MessageList/utils.ts`，那里一条静态 `import { useUIStore }` 把**整条 store 链**（含 `@shared/messagepack/binary-ipc` / `@shared/data-dir`）拉进了 `test:message-timestamp` 的 esbuild bundle —— 该测试只配了 `@renderer` 一个 alias ⇒ 门禁从 `48/48` 掉到 `47/48`。改为**容器内联调用 store**（与队列「取回」等 5 个现成调用方同一写法），`utils.ts` 保持纯净，门禁回绿。

## 验收期小调整（不登记需求，已随 `424c4d64` 落盘）

老大真机验收期间下的零散改动，都不构成独立需求，**已随质量刀 `424c4d64` 一并落盘**：

| # | 调整 | 落点 |
|:--:|---|---|
| 1 | 更新弹窗收缩约 1/3；点「开始下载」不再立刻收窗，等点「后台下载」才收 | `App.tsx` / `UpdateDialog.tsx`（S-109 的验收微调，老大定性「不登记成需求」） |
| 2 | agent 起终端即打开该会话底部面板 | `terminal-store.ts`（见上节「验收修正」第 4 条） |
| 3 | 官网端口固定 **5280**（dev）/ **5281**（preview）+ `strictPort`，避开主项目占用的 5173 / 4173 | `website/vite.config.ts`（说明见 `iter-v2-34/website.md`） |
| 4 | **正文里的网址可点，点了开右侧浏览器面板** | 新增 `lib/preview/web-url.ts` + `AssistantMessage/WebUrlCode.tsx` |

**第 4 条的根因与面**：agent 输出网址常用反引号包着（`` `http://localhost:5280/` ``），会落进 markdown 的 `code` 分支；那边只认本地路径（`isLikelyLocalFilePath` 对 http 直接返回 false）⇒ 渲染成不带链接样式的普通行内 code ⇒ **点了没反应**，正是老大报的「我点不了」。三处收口：

- 新增 `web-url.ts`，出 `isWebUrl` / `openWebUrl` —— 网址一律交 `openBrowserTab(url, activeSessionId)`，不再递系统浏览器（`openMarkdownHref` 里原来那个 `window.electron.shell.openExternal` 其实永远走不到：`window.electron` 来自 `@electron-toolkit/preload`，压根没有 `shell` 字段）。
- 新增 `WebUrlCode` 行内可点标签，与 `LocalPathCode` 同模式；区别是**不做 stat 预校验**（网址点不开只会是「服务没起来」，那正是点一下想知道的事）。标签省掉 scheme 显示、完整地址进 `title`。
- 三处行内 code 分支（正文 `markdown-renderer` / 思考块 `ThinkingBlock` / 文档预览 `markdown-components`）在**路径判定之前**加网址判定。

顺带修掉一个隐患：工具输出（`text-output.tsx` 的 `MarkdownOutputBlock`）原来吃 react-markdown 默认的 `<a>`，而主进程只拦了 `window.open`（`setWindowOpenHandler`）、**没有 `will-navigate` 兜底** —— 点一条裸网址输出会把主窗口整个导航走。现在同样接 `openMarkdownHref`。

> 同源隐患仍有 10 处未动：`memory-output.tsx` / `SystemCommandCard.tsx` / `ask-user-question-block.tsx` / `PlanReviewCard.tsx` / `ContextCompressionMessage.tsx` / `MessageItem.tsx` / `PlanReviewCard` 等用默认 Markdown 的地方同样没有 `<a>` 拦截。本轮只动了「agent 输出」这条主路径，其余**待老大裁定**是否统一收口（属新一刀）。

## 待办

- **立项项全部落刀**：S-107 ~ S-139 各自成刀，共 **20 刀**，`dev/v2-iter-34` **未推送**。
- **工作区只剩收尾刀的文档改动**（本文 / `changelog.md` / `S-139.md` 实施记录 / `raw-requirements.md` 状态）—— 按提交纪律**攒进收尾刀**。
- **S-129**（更新源全面切换到官网）：需要官网先上线，**等域名备案**，本轮不动手。
- **收尾已完成**：合并 `dev/v2-iter-34` → `main`（`--no-ff`）+ tag `v0.2.34` + GitHub Release（流程见 `docs/release-workflow.md`）。

## 门禁（S-139 落刀后实测）

- `npm run typecheck` → `EXIT=0`（node + web 两段）
- `npm test` → **48/48 通过**：TypeScript 36 + C# 12（含新增 `adaptive-event-batcher` **26 断言**；`TerminalTool` 27、`context-cap` 76、Goal 329）
- C# 两 sln（`src/runtime/WishfulClaw.sln` / `tests/WishfulClaw.Tests.sln`）→ **0 错 0 警**
- `website/` 构建：`tsc --noEmit && vite build` 零错

## 已知限制 / 待真机验证

- **S-111 的更新源仍指向 GitHub Release**，官网上线后改 `public/latest.json` 一个值切换（S-129）。
- **S-131 路径二未修**：两侧面板同开时缩窗照样破底线（左 370 + 右 370，视口 900 ⇒ 聊天窗仅 160）。收侧判定只在展开 / 拖宽时跑，**无 resize 监听**；主窗口最小 900×600。修法 A（加视口监听，变窄时重跑收侧判定）待老大裁定。
- **S-108 挂账未修**：前后端两套分母、滑条最左端 200000 的语义坑仍在。

## 真机验收进度（2026-09-22）

老大口径（12:42，当时 13 刀）：「子代理的轮次这个没测试，其它基本都测试过了」。

**已验**：

- S-107 调档（四档 `200K / 400K / 800K / 1M`、默认 1M、无 0 / 无不限制；老配置 `384000` ⇒ 吸附 400K、`0` / 非法 ⇒ 回落 1M）
- S-133 正文不被工具卡片劈开
- S-134 常驻终端：起 / 读 / 停主链路，以及三条修正（提示符、Ctrl+C、自动开底部面板）
- S-109 更新弹窗收缩 + 「开始下载 / 后台下载」按钮行为
- 网址可点 → 右侧浏览器面板；官网端口 5280 / 5281
- 记忆相关显示（记忆库默认收起、点单条展开、i18n —— 设置页与项目档案两处）
- 终端面板滚动条宽度
- 官网页面本身

**老大 19:37 复验**：「基本都测试过了，除了长任务下页面停止，这个不太好测试，只有等后面看真实运行的咯」⇒ 下列各项**全部验过**：S-132 子代理轮次上限、S-136 分叉（含中途压缩过的修正）、S-137 shell「停止进程」、S-138 朗读音色 / 语速 / 音调 + 试听、S-133 补完（思考块不再劈正文）、S-139（编辑回填 / 三条死链消失 / 导出视图无编辑按钮）。

**观察项（唯一未验）**：

- **S-135 流式渲染降级**：高压长任务（工具快 + 模型快 ⇒ 单位时间渲染量大）**人工不好造**，留待真实运行观察。判据两条：① 页面不再「像截图一样静止」；② 主会话「停止」即时生效。

**待确认**：

- S-134 的「切到另一个会话 / 结束会话但 tab 还开着 ⇒ 进程仍在」—— 这条一直没结论，需老大给一句。
