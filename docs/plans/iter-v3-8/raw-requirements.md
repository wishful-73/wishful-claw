# v3-iter-8 需求清单

> 拆分于 2026-11-05 14:49（老大「开新迭代」）。来源 = **v3-iter-7 收尾移交 1 条（S-318）** + 本迭代新登记 4 条（S-321 / S-322 / S-323 / S-324）+ **16:40 分层体检登记 3 条（S-325 / S-326 / S-327，见 §五）**。
> 本文件只列清单与依据，刀序见 [plan.md](plan.md)。

## 一、本迭代实施（5 条）

> 内存三条原是一张合单（S-322 里写 A/B/C 段），**15:14 老大指出「你刚刚直接登记三个也行啊 突然搞个abc干啥」⇒ 拆成 S-322 / S-323 / S-324 三个独立编号**，便于日后溯源。公共背景（主仓日志实证、证伪清单）在各自单内写全，不在这里重复堆砌。

| 编号 | 标题 | 现状 / 依据 | 正文 |
|---|---|---|---|
| S-321 | **清理从 OpenCowork 搬来但从未接通的死代码（宠物 / 翻译 / 通道残留）** | 2026-11-05 14:56 老大「登记吧」。触发点：S-318 刀 2 原写「`lib/auth/` 不能整目录删，宠物和翻译在用多账号轮转」，老大反问「宠物不要，翻译是什么？」⇒ 核实后**两者都是死代码**，前提不成立。**宠物 1261 行**（`lib/pet/` 7 文件 + 4 个 `pet-*-store.ts`）：`src/main` 零命中、渲染层零组件 import、无资源目录。**翻译约 790 行**（`translate-store` / `translate-service` / `translate-agent-service`）：`useTranslateStore` 零消费者。**另 12 条通道白名单残留**（`messagepack-channel-routing.ts:17-27, :400-402`）指向不存在的 handler，`NavItem` 的 `'translate'`（`ui-types.ts:13`）与两组 locale key 同样无消费点。五处唯一外部依赖都是 `ensureProviderAuthReady` 一个函数 ⇒ **删完之后 S-318 刀 2 可以从「摘 OAuth 留多账号轮转」简化成「整目录清」** | [requirements/S-321.md](requirements/S-321.md) |
| S-318 | **公开版剔除「订阅额度 OAuth 冒充」（5 个 preset）** —— 合规清理 | v3-iter-7 唯一移交项。老大 11-05 09:47「workbuddy 是一个风险点，如果我去抖音推广大家使用，有这个功能的话，会被腾讯这些直接告」+ 09:5x「页面 ai 授权服务商也需要删掉才对啊」+ 10:12「统一都需要处理。不过可以丢到下个迭代单独处理」。**5 个 preset**：`workbuddy` / `workbuddy-ai`（`server_poll` + 6 个 `X-IDE-*` 头）/ `codex-oauth`（`codex_cli_rs/0.144.5` UA + `chatgpt.com/backend-api`）/ `copilot-oauth`（`GitHubCopilotChat/0.26.7` + `copilot_internal/v2/token`）/ `moonshot-coding`（`KimiCLI/1.49.0` + 客户端白名单）。**保留 `moonshotPreset`（API Key 版，`moonshot.ts:123`）**。四个坑已实读确认：①「授权 AI 服务商」整页只收 `server_poll` ⇒ 可整页删、不影响其它 OAuth ②`reconcileProviders:224-229` 对同 preset 第二三条记录原样保留 ⇒ 僵尸记录需显式剔除名单 ③`lib/auth/provider-auth.ts` **不是纯 OAuth**，含多账号轮转 —— **但消费者是 S-321 要删的死代码** ⇒ S-321 先行后此顾虑消失 ④靠「preset 不存在」隐式清理不可靠。**删除边界（老大 11-05 15:19「318 正常通过apikey请求的不删哈」）：48 个 builtin preset 只删这 5 个，其余 43 个一个字段都不改** —— 含 `moonshot`（API Key 版，与 `moonshot-coding` 同文件）、6 个「套餐端点但凭自己的 Key」的 coding/plan preset、`ollama` / `lmstudio`（`requiresApiKey: false` 但本地无冒充）。判据两条须同时命中：`authMode:'oauth'` + `requiresApiKey: false` + 冒充 UA。明细见 S-318 §3B.0 | [../iter-v3-7/requirements/S-318.md](../iter-v3-7/requirements/S-318.md) |
| S-324 | **`StripDataUrlPrefix` 整串复制** —— 一张 600 KB 图复制两遍只为看前 64 字符 | 2026-11-05 15:04 登记，15:14 拆出独立编号。**刀 6**（三条里最安全，先做它建立「改动不改判据」的信心）。`ProviderContentHelpers.cs:44-49` string 版 + `:62` 的 `.Trim()`（整串再复制一遍只为看前 64 字符）+ `ImageFileProbe.cs:159` 同样用整串。.NET `string` 是 UTF-16 ⇒ 600 KB base64 在内存里占 1.2 MB，两处两遍 2.4 MB 瞬时垃圾/每图每轮。私有仓组包分配实测放大 **5.13x**（UTF-16 口径；拿字符数当字节数是 10.26x，差整一倍）。**纯性能、判据不变**：五种输入新旧结果须逐字节一致 | [requirements/S-324.md](requirements/S-324.md) |
| S-323 | **`request_debug` 每轮推完整 body** —— 99.97% 生成即丢 | 2026-11-05 15:04 登记，15:14 拆出独立编号。**刀 7**。`OpenAIChatProvider.cs:46-55`（三个 provider 同构）每轮每重试把完整 body 序列化进 `request_debug`，而渲染层 `debug-store.ts:20-22` 上限只有 `MAX_DEBUG_BODY_CHARS=2_000` / `MAX_RESIDENT_DEBUG_BODY_CHARS=4_000` ⇒ 实测 11,983,135 字符推到前端，实际驻留 **2,695**（**0.02%**）。中间白走 `JsonSerializer` + MessagePack + pipe + base64 + JSON。**不能硬截断**（面板要 `JSON.parse`）⇒ 结构化换占位符；**三个 provider 漏一处不算完成** | [requirements/S-323.md](requirements/S-323.md) |
| S-322 | **会话驻留永不淘汰** —— worker 内存只涨不降的**结构性来源**（治根） | 2026-11-05 15:04 登记，15:14 拆出独立编号。**刀 8**（唯一治根，也风险最高 —— 淘汰错＝用户上下文没了 ⇒ 放最后动）。**主仓日志实证**：`2026-11-05.log` 连续 51 条 `memory high role=worker managed=1060.8→1062.9MB`，同时刻 `renderer ws=256.2MB` ⇒ worker 是 renderer 的 **4 倍**；`managed` 浮动 ±3 MB、`heap` 几乎不动、`frag` 仅 15.8 MB ⇒ **稳态数据，不是线性泄漏**。**根因**：`SessionConversationManager`（主仓 73 行）只有 `GetOrCreate`/`TryGet`/`Remove`/`ClearAll`，**零闲置淘汰、零容量上限**；类注释「entries are removed on session switch」**是错的** —— `Remove` 只在 `AgentRuntimeTools.cs:408`（显式清空）/ `SubAgentExecutor.cs:172` / `GoalOrchestratorModels.cs:120` 三处调，**没有一处是切换会话**；`SessionConversation.cs:22` 的 `List<JsonElement> _wireConversation` 常驻持有完整 base64 ⇒ **发过消息**的会话永不退出（纯切换不建条目），多会话累加即 GB 级，而**压缩只让单个会话变小、从不让别的退出**。修法：闲置 **2h** 淘汰 + 常驻上限 **8 条** + `SessionConversation.Touch()`。**已证伪、别再试**：改 GC 模式（默认就是 Workstation）/ 换 AOT（三次独立启动 `managed` 一字不差）/ dev-vs-prod（差 0.3 MB）/ 换 Tauri（WebView2 就是 Chromium 占 72%）/ `totalJSHeapSize` 涨 ≠ 泄漏 / 看任务管理器判泄漏 | [requirements/S-322.md](requirements/S-322.md) |

## 二、挂账 / 阻塞（七条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账** | 频率低、**只在新版本第一个会话偶发**；老大 2026-10-31 定「先登记等以后模型牛掰了再试试能解决不」。S-274 / S-315 修完后仍未消失 ⇒ 根因不同 | [../iter-v3-2/requirements/S-233.md](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约** | 全树搜 `qoder` 零命中，契约不到不写任何请求代码 | [../iter-v3-2/requirements/S-230.md](../iter-v3-2/requirements/S-230.md) |
| S-273 段 B | 第三方窗口的元素树（`EnumChildWindows`） | **待拍板** | 段 A（自家窗口走 CDP）已随 v3-iter-5 交付。段 B 只覆盖 Win32 控件，Chromium 系第三方窗口拿不到 ⇒ 收益存疑 | [../iter-v3-4/requirements/S-273.md](../iter-v3-4/requirements/S-273.md) |
| S-320 | .NET 11 SDK 升级（消 NU1903 / ILCompiler Brotli 告警） | **挂账，等 .NET 11 GA** | 零暴露（全仓 `Brotli` / `Accept-Encoding` / `AddRequestDecompression` 零命中，唯一 `HttpClient` 显式 `AutomaticDecompression = None`）；只能升 SDK 才能消，**不 `NoWarn`** | [../iter-v3-7/requirements/S-320.md](../iter-v3-7/requirements/S-320.md) |
| — | `ui-store` 两个空占位（已删） | **✅ 已落地（2026-11-09）** | `ui-store.ts:524` / `:527` 两个函数体只有一行注释（`// Placeholder: no URL routing for now`），**全仓零调用点**；接口声明在 `ui-store-interface.ts:286-287`。与 S-340 / S-341 同类（零引用死壳），那两轮普查扫「文件级死代码」时漏了「store 里的方法级空壳」。删掉 4 行（2 声明 + 2 实现），零行为变化。**2026-11-09 已删**：`ui-store.ts` 524-529（实现含空行）、`ui-store-interface.ts` 286-287（声明），`npm run typecheck` 三配置 0 错、`npm test` 129/129 | 2026-11-09 落地 |
| — | `MemoryFtsService.scopeFilter` 字符串拼接（已参数化） | **✅ 已落地本迭代（2026-11-09）** | S-326 §八已记：`$" AND scope = '{EscapeSql(scope)}'"` 仍是拼串，未随 S-328 族收口。**当下无注入风险**（`EscapeSql` 在转义），属口径不统一 —— 判据进章程后这一处是唯一例外，留着会让下次普查反复把它当新发现。**2026-11-09 收口**：`scope` 改参数化（` AND scope = @scope` + `@scope` 参数，与 `DbMemoryTools.BuildScopeClause` 同构），`EscapeSql` 随之成为零引用、已删；FTS / LIKE 两条通道共用一份参数实例（互斥执行且前者 reader 已释放）。回归断言补在 `MemoryRecallRegressionTests.RunTimeFilterSuite`：含撇号的 `scope` 不炸且筛空，78/78 PASS。原始登记见 [S-326.md](requirements/S-326.md) §八 | 2026-11-09 落地 |
| — | `assets/main.css` 豁免标记（**样式文件整类豁免，不拆**） | **✅ 已裁定并落地（2026-11-09）** | 全仓 `.ts/.tsx/.cs/.js/.mjs/.css/.scss` 实扫：**62 个超 500 行，61 个有标记，1 个没有**，就是它。`AGENTS.md` §大文件拆分 只写「C# 用 partial / TS 用模块化」，第 8 条单独放过 locale JSON，**CSS 留了空洞**。该文件是 Tailwind v4 单一入口（`@import 'tailwindcss'` + `@theme inline` 主题变量 + `@layer components`），拆开要保 `@import` 顺序与变量作用域 ⇒ 建议按「单一数据对象」类豁免、**同样不写行数**。判据落进章程之前，这条会在每轮审查里被当成新的 ❌。**2026-11-09 老大裁定：「样式不用强拆，这种豁免就行，我定义 500 行的目的是为了减轻 agent 读代码的压力，而不是单纯为了 500 行拆而拆」** ⇒ `AGENTS.md` §大文件拆分 新增第 9 条（样式文件整类豁免，不逐条论证、不判 ❌，但要留头注释），`main.css` 头注释已补 | 2026-11-09 裁定 |

## 三、候选池（老大提过但暂不做）

| 编号 | 标题 | 为什么现在不做 |
|---|---|---|
| S-232 | 安全加固 | 老大 2026-10-27 裁定「无限期搁置」 |

## 四、本次拆分顺手订正的文档欠账（**防下次重复排查**）

拆分时扫了 v3-iter-1 ~ v3-iter-7 全部 98 个需求单的状态行，三处与事实不符，已就地订正：

| 编号 | 原状态行 | 改成 | 依据 |
|---|---|---|---|
| S-316 | 「待开工」 | 「✅ 已实施（v3-iter-7 刀 5，`a478ffd6`），随 v1.0.7 发布」 | plan.md 刀 5 已落地、v1.0.7 已发布 |
| S-317 | 「待开工」 | 「✅ 已实施（v3-iter-7 刀 6，`6e660276`）+ 补刀 `2364a78b`，随 v1.0.7 发布」 | plan.md 刀 6 已落地、v1.0.7 已发布 |
| S-305 | 「已实施，待真机验收」 | 「✅ 已实施，随 v1.0.7 发布；CodeGraph 已实测装了 / 停了」 | v3-iter-7 raw §二·B 已按 dev 实测口径收口 |

> **没核实的不要假装核过**：v3-iter-1 ~ v3-iter-5 里有一批需求单（S-217 ~ S-260 中的多数）本就没写状态行，本次**未逐条核实是否已实施**，因此不作为本迭代待办池的依据。真要用，先按「打开文件确认闸在哪一层」复核 —— 这是 S-281 / S-277 / S-265 三次错法的共同教训：**没打开文件就下结论，下个迭代会为一条不存在的缺陷排一刀**。

## 五、分层体检登记（2026-11-05 16:40，**只登记，未动代码**）

> 老大 11-05 16:36「你看下我们项目立项是规划的分层结构这些，现在是不是有很多违反了，如果有给我列出来」⇒ 16:40「先登记」。
> **前提结论**：七层**依赖方向零违规**（`Agent` 不引 `Worker`、`Workspace` 不引 `Persona`、`Core` 只引 `Contracts`）。以下三条全是「层内职责」与「章程过期」，不是逆向依赖。

| 编号 | 标题 | 性质 / 归属 | 实测依据 |
|---|---|---|---|
| S-325 | **章程指向了一个不存在的项目** —— 分层文档与实际结构脱节 | **修文档，零代码**；**本迭代可做**（不占刀序，10 分钟） | `WishfulClaw.CodeGraph` 已在 v3-iter-6（**S-303**）剥离为独立仓 + MCP 插件，`src/runtime/` 下已无该项目。但 `AGENTS.md:25`、`docs/project-structure.md:30-31`、`:56` 三处仍当它 vendored 写。**另含**：`AGENTS.md:81` 的 Agent 依赖清单漏 `Workspace`（实际 9 个文件 `using WishfulClaw.Workspace.Memory`，靠 `Persona → Workspace` 传递才编过；按方向图这条边**合法**，是清单漏写，且隐式传递有实害 —— Persona 哪天不引 Workspace 会连坐 Agent 编译不过）；空目录残留 `Infrastructure/Memory/` + `Agent/tmp/agent-verify-*`。**⚠️ 别误删**：`src/main/lib/codegraph-assets.ts` 等是插件资产下载器，正常功能 |
| S-326 | **分层职责条款与实际实现打架** —— 改章程还是迁代码 | **二选一裁定**；**待老大拍板** | **A1**：`AGENTS.md:92` 写 Worker「只保留进程入口与模块注册，其余已迁入 Agent/Infrastructure」，实际 `Modules/MemoryModule.cs` 378 + `.Entries.cs` 134 = **512 行真实现**（`File.ReadAllText` / `MemoryPathResolver` / SQLite 分页 / 业务常量 `MaxEntriesLimit=500`，注释还写着「500 而非 200 是因为渲染层同步窗口」⇒ 已业务耦合）；且 `docs/project-structure.md:51` 写「模块注册**与实现**」⇒ **两份文档互相打架**。对照 `GoalModule.cs` 235 行是薄转发，合规。**A2**：`AGENTS.md:56` 把 33 个 `Db*Tools`（**8,204 行**，占 Infrastructure 14,783 行的 55%）算作本层职责，`:59` 又说本层目的是「使 Tools / Modules 能迁出到 Agent」⇒ **同节自相矛盾**。判据：`Db/` 占该层 92%，而同层 `Http/` 只 47 行、`Storage/` 1,055 行 —— 后两者才是「通用能力」的样子。**我的建议选 A（改章程 + 写清判据）**，理由：迁 `Db*Tools` 进 Agent 会让 Agent 直接压在表和 Entity 上，**耦合加深不是减弱** |
| S-327 | **Agent 根目录平铺 140 个 `.cs`** —— 章程只认 6 类，其中 52 个它没提过 | **纯结构重构**（只挪不改）；**建议下个迭代** | 实测分布：`AgentRuntime*` 执行器 **52**（`ProjectExecutor` 650 / `GlobalTaskExecutor` 606 / `PlanExecutor` 495 / `Tools` 463 / `DesktopExecutor` 444 + `.Encoding` 292 + `.Windows` 262 …）、模型 Provider 23、SubAgent 12、AgentLoop 11、`Tool*` 10、ContextCompression 8、Session 5、AskUser 2、**其它杂项 17**（`AgentStreamMessagePackEmitter` 389 / `ConversationCodec` 297 / `BackgroundSubAgentRegistry` 292 …）。`AGENTS.md:54` 只承认 6 类 ⇒ **69 个（49%）无归属**。**⚠️ 新目录不能叫 `Providers/`** —— `Agent/Tools/Providers/` 已存在（25 个**工具提供者**），`docs/project-structure.md:56` 专门写过「别混」，建议叫 `Llm/`。**不能塞本迭代**：140 文件改 namespace 会污染 `git blame`，与刀 6~8 的内存修复混在一起出问题无法归因 |



## 六、只读审查五条登记（2026-11-06 08:23，**只登记，未动代码**）

> 老大 11-06 08:23「先登记，然后动手清理，在本迭代处理」。
> 审查口径：1683 个源文件全量扫，HEAD `f0e1824f`，工作区干净。刀序见 [plan.md §二·补 2](plan.md)。

| 编号 | 标题 | 性质 / 归属 | 实测依据 |
|---|---|---|---|
| S-328 | **Agent 层自己写 SQL** —— **实测 9 张表 30 处 / 9 个文件**（登记报「7 张表 12 处 / 5 文件」全部偏低） | 结构重构；**本迭代**（刀 23~29）｜**09:0x 老大裁定拆为六个编号** | **根因订正**：Entity 与 `EntityMappers` 都在 Db 层、Agent 层正在用（`db.Query(sql, EntityMappers.MapProject, …)`）⇒ **缺的不是强类型能力，是把 SQL + Mapper + 连接粘起来的「表访问」那层封装**。真实分布：`Executors/AgentRuntimeProjectExecutor.cs` **8 处**（`projects` + `sessions`；登记说「`sessions` 1 处」）、两个 `.Db.cs` 各 **5 处**（登记各 3）、`Goal/GoalOrchestratorMaterialize.cs` 3 ✅、`SubAgents/SubAgentReportStore.cs` **3**（登记 2）、**完全没登记到的**：`Tools/PathBoundary.cs` 2（`projects`，沙箱根集合）、`Sessions/SessionRestoreTools.cs` 2（`messages`）、`Executors/AgentRuntimeProjectExecutor.Creation.cs` 1、`Executors/AgentRuntimeGlobalTaskExecutor.cs` 1。**口径坑**：第一次机器扫用 `-match`（PowerShell 默认不区分大小写），把工具描述里的 `multi-select questions` 当命中 ⇒ 假阳性淹掉真阳性，必须用 **`-cmatch`** |
| S-329 | **超 500 行且从没豁免过的文件** | 补标记；**本迭代**（刀 19，`b5434cb9`）。原「真拆 3 个」已作废 | **订正（2026-11-06 实测）**：审查报「超 500 行 60 个、48 有标记、**12 无**」—— 实际**只有 6 个无标记**。差的是 `Compression/ContextCompression.cs` 1120 / `AgentLoop.cs` 931 / `ToolDispatchRouter.cs` 635 三个**用英文 `500-line exemption` 写豁免**的文件，审查的正则只认中文写法 ⇒ 误判成「从来没豁免过」，还被我列进「真拆」。复核后三条豁免全部成立（管线不变量 + 叶子已拆 / 步骤间是顺序不是接口 + 已拆 6 个 partial / 分支顺序即路由契约），**不该拆**。真缺的 6 个已补齐（5 个「超标待拆分」+ `DbClient.Schema.cs` 补豁免），全仓 **60/60、差集 0**。**审查盲区是真的**（前几轮只核「有标记那批」没扫全集对差集），但以本单为戒：**差集判定还必须同时认英文写法**，否则每轮都报同一批假欠账 |
| S-330 | **4 具遗骸 + 1 个用户能点开的英文空壳** | 删死代码；**本迭代**（刀 18） | 0 引用可直删：`lib/chat-route.ts`(24 行，三函数全空实现，`parseChatRoute` 恒返回 home)、`lib/utils/export-chat.ts`(26 行，两函数无调用方)。占位壳（引用 4，不能直删）：`components/terminal/ProjectTerminalDock.tsx`(13 行 `return null`)、`lib/session-window.ts`(14 行，两函数体只有 `void sessionId`)。**用户可见**：`components/layout/RuntimeStatusPanel.tsx` 全文只有 `Runtime status — coming soon`，但 `MainLayout.tsx:10` import、`:207` 条件渲染、`ui-store` 有 `runtimeStatusPanelOpen` 开关 + hover 触发器 ⇒ **用户能点开看到英文占位**。**与 S-321 同类**（清宠物/翻译是同一批没接通的搬运物），S-321 只清了那两个目录 |
| S-331 | **文档 4 处代码路径失效** | 只改文档；**本迭代**（刀 16） | `S-322.md` 写 `Agent/SessionConversationManager.cs` → 实为 `Agent/Sessions/`（S-327 刀 13）；`S-323.md` 写 `Agent/OpenAIChatProvider.cs`、`S-324.md` 写 `Agent/ProviderContentHelpers.cs` → 实为 `Agent/Llm/`（刀 10）；`S-323.md` 写 `stores/debug-store.ts` → 实为 `lib/debug-store.ts`（**老错，与搬迁无关**，三次审查都没发现，因为**审查只读代码不读文档路径**）。**害处**：下个迭代照文档找过去扑空，然后开始怀疑「这段代码是不是被删了」—— S-281 / S-277 / S-265 三次踩的都是这个坑 |
| S-332 | **renderer 层 8 处 `console.log`** | 清调试残留；**本迭代**（刀 17） | `BottomTerminalDock` 1 / `use-channel-auto-reply` 2 / `use-chat-actions` 1（**`:176` 打 `session.sshConnectionId`** ⇒ 信息暴露）/ `agent-bridge-streaming` 1 / `agent-bridge` 1 / `prompt-optimizer` 2。**边界**：`src/main/` 侧 59 处**不动**（主进程日志是排查手段，用户看不到）；`console.warn/error` 不动；桥接协议那 2 处 `Console.WriteLine` 不动 |
| S-333 | **`projects` 5 处**（跨 3 文件） | 本迭代（刀 26） | `AgentRuntimeProjectExecutor.cs` 75/76（列表，filter 二选一）、124、214；`…ProjectExecutor.Creation.cs` 98（建项目查重）；**`Tools/PathBoundary.cs` 89 / 126 —— 沙箱根集合，全族唯一跨到 Tools 层的**。沙箱的 `try/catch` 降级必须留在调用点（「沙箱是保护措施，不能反过来把正常干活挡死」），`S-103` / `S-144` 两段注释跟着 SQL 一起搬。`:89` 有 `ssh_connection_id` 过滤、`:98` 没有，**两处条件不同不许合并**；`:75/:76` 不许改成 `WHERE (@f IS NULL OR …)`（会放弃索引）；`:84/:88` 的 N+1 本族不动 |
| S-334 | **`goal_*` 三表 3 处**（一个方法） | 本迭代（刀 25） | 全在 `GoalOrchestratorMaterialize.AbortSubtree`：`:249` goal_plans、`:262` goal_tasks、`:274` goal_execution_runs。**全族唯一有隐藏语义的**：三条 UPDATE 在**同一个 try** 里 ⇒ ① 失败则 ②③ 不执行（注释自称 best-effort，实际不是各自尽力）。包事务 / 各自 try **都改变语义** ⇒ 只能照抄。三处 where 各异：plans 4 个终态含 `superseded`、tasks 3 个不含、runs 只有 `goal_id` 且 `status = @executing`。状态值来自 `GoalPlanStatusValues` / `GoalExecutionAttemptStatusValues`，Db 层方法只收 `string` 参数，不反向依赖 Agent 层 |
| S-335 | **`sub_agent_runs` 3 处** | 本迭代（**刀 23，首刀**） | `SubAgents/SubAgentReportStore.cs` 121 行、`:48` / `:56` / `:69`。**最小 ⇒ 样板在这里定死**，S-328 / S-333 / S-334 / S-337 / S-338 五个照抄。主键是 `tool_use_id` 不是 `id`（方法名要写明）；`:56` INSERT 与 `:69` UPDATE 先看是不是 upsert，是才合并；`data` 是 `TEXT` 可 NULL ⇒ 签名 `string?`，**空串和 NULL 在快照语义里不是一回事** |
| S-336 | **判据落章程 + `Db*Tools` 端点薄化** | 本迭代（**刀 29，族尾**，依赖前六个全部完成） | A：`AGENTS.md` 加可机器复核判据（给命令，不写没法判的话），注意必须 `-CaseSensitive`；B：只薄化本族碰过的 **9 张表**，其余 25 个 `Db*Tools` 不动、**也不欠账**（它们没有 Agent 层手写 SQL，不存在「两份」）。薄化工时七成在**逐字段 diff** —— 端点那份 `SELECT` 列常比 Agent 层多，直接换会掉字段；端点保留自己的 try/catch 与 `{ ok:false }` 组装，只换「查/写」那一句。可分批，停了要登记剩余项 |
| S-337 | **`sessions` 5 处**（跨 2 执行器） | 本迭代（刀 27） | `AgentRuntimeProjectExecutor.cs` 85 / 89（两个 COUNT）、133（最近 20）、**246（建会话 INSERT）**；`AgentRuntimeGlobalTaskExecutor.cs` 129（`SELECT project_id`）。**全族唯一会造新行的写入**：`:241-244` 两段注释必须跟着 SQL 搬到 Db 层 —— `model_selection_mode` NOT NULL 无默认值（**S-115**）、`collaboration_mode`/`permission_mode` 留 NULL 由 `rowToSession` 回填（**S-189**），漏了两个月后重踩。`:246` 硬编码 `message_count=0` / `pinned=0` 保留字面量；`:89` 的 1 小时窗口在调用点算，只传 `cutoff` |
| S-338 | **`messages` 2 处** | 本迭代（刀 28） | `Sessions/SessionRestoreTools.cs` `:232`（增量，`created_at > @snapshotCreatedAt`）/ `:258`（全量）。**签名里不许出现 `through_sort_order`** —— `:224-231` 记着：`sort_order` 是渲染端 `messages.indexOf`，压缩插入边界对会让它位移，曾导致假 `invalid_cursor` **永久卡死会话**；它只能当 `ORDER BY` 的第二排序键，不许进 WHERE。`ORDER BY created_at ASC, sort_order ASC` 不能简化。`AttachPartsToEntities`（S-285，parts 表）顺序不动、不在本单范围 |
| S-339 | **同名文件大小写重名** | 2026-11-06 10:0x 欠账普查。`components/error-boundary.tsx`(48 行) 与 `components/ErrorBoundary.tsx`(35 行) **两份都在 git 索引**；`App.tsx:9/:241` 只用大写那份，小写那份 `-cmatch` 零引用。NTFS/APFS 大小写不敏感能共存、ext4 区分 ⇒「改了 A 实际改了 B」、路径换个大小写就换文件、clone 落盘谁覆盖谁不确定。**建议本迭代修**（`git rm` 小写那份，零功能变化） | [requirements/S-339.md](requirements/S-339.md) |
| S-340 | **死代码清理 26 文件 2,460 行 + 1 空函数** | 判据：basename 在全部源码里搜 `from '…/<name>'`、`import('…')`、`require('…')` 三种形态全 0 命中（**大小写敏感**，否则被 S-339 那对假命中）。分组：`lib/agent/` 遗留 10 文件 806 行、`components/layout/` 对话框 5 文件 419 行、`main/lib/agent-history-store.ts` 268 行（**单独验**，可能在 `main.ts` 里副作用引入）、其它 10 文件 967 行。另 `use-chat-actions.ts:558 sendImplementPlanInNewSession` 空函数零调用。**删一个验一个，按 4 组分批**，主进程那批单独 commit | [requirements/S-340.md](requirements/S-340.md) |
| S-341 | **`ProjectTerminalDock` 空壳 + 两处 `terminalDockOpen = false` 死分支** | 组件体只有 `// TODO: implement terminal dock` + `return null`；两处渲染点（`ChatHomePage:330` / `ProjectHomePage:151`）条件第一项都是**硬编码 `const terminalDockOpen = false`** ⇒ 永远不渲染。**不是功能缺失**：真正在跑的是 `BottomTerminalDock`(403) / `LocalTerminal`(309) / `TerminalPanel`(228) / `AgentSshTerminal`(149)，注释「dock state is session-level now」就是取代说明。修法 = 删组件 + 删两处常量与 JSX 块 + 顶部 import。**不实现**（从没提过这需求） | [requirements/S-341.md](requirements/S-341.md) |
| S-342 | **两个「接口在 / 调用方在 / 实现是空」** | ①`lib/agent/session-scoped-agent-state.ts:25 selectSessionScopedAgentState` 恒返回空对象（`isSessionRunning` / `hasActiveToolCallOutput` / `hasOrchestrationData` 恒 `false`，`toolCalls` 恒 `[]`），4 处真调用 + 2 处注释「still a stub」并绕开。**开工第一件事是核实那 4 处拿空值后靠什么保底** —— 另有来源就删调用、真靠它就是显示缺陷，**核实前不写代码**。②`stores/chat-store/session-slice.ts:555 clearSessionPromptSnapshot` 空函数体、**16 处调用**（follow-up claim/fail、plan-store 8 处、task-store 4 处）；先确认「快照」存储是否存在，不存在则删接口+删调用 | [requirements/S-342.md](requirements/S-342.md) |
| S-343 | **`iter-v3-1/plan-s224/review_report.md` 半段 GBK 混杂** | **不是整份乱码**：`0~18725` 是合法 UTF-8，`18725~22654` 那 3,929 字节是 **GBK(936)**，当 UTF-8 读才成片问号。严格解码抛在索引 18725 字节 `BD`；那段按 936 解码 **0 个 U+FFFD**、中文一字不差。**可无损恢复**，但 **emoji 已被当初那次错误转换降级成 `?`，永久丢失**（能推断的补、推不出的一律留 `?` 不编）。入库唯一 commit `fb7b5beb` 就是混的。**建议本迭代修** | [requirements/S-343.md](requirements/S-343.md) |
| S-344 | **主进程 59 处 `console.log` 没走 `logger.ts`** | `src/main/lib/logger.ts` 设施完整（logError / logWarn / logInfo / logDebug + 读数/清理/列表），**15 个文件已在用**，但仍有 59 处裸 log：`channels/` **42**、`mcp/` 6、`lib/` 5、`ipc/` 4、`index.ts` 1、`ssh/` 1。打包版主进程无控制台 ⇒ 输出直接丢弃，用户报渠道问题在「查看日志」里翻不到任何渠道记录（`feishu-service.ts` 的 `Skipping duplicate message` 这类关键信息都在里面）。分批：channels 先做。**不动 `console.error` / `console.warn`**，不加 monkey-patch | [requirements/S-344.md](requirements/S-344.md) |

### 审查没查出问题的（别重复查）

七层依赖方向**零违规**（6 个 csproj 依赖矩阵逐条核过：`Contracts` 无依赖、`Core → Contracts`、`Infra → Contracts + Core`…）；铁律 3 匿名类型序列化 **0**；铁律 6 `new JsonSerializerOptions` **0**；铁律 7 `System.Reflection` **2 处**（`WorkflowTemplateWriter.cs`、`PersonaPresetService.cs` 读嵌入资源）**正是例外条款允许的场景**；`NotImplementedException` **0**；「探针」6 处全是注释；`debugger` 17 处全是 CDP `webContents.debugger` API；精确筛出的 9 处 TODO/FIXME **全落在 S-330 那批空壳里**。

## 七、二轮欠账普查（2026-11-06 11:0x，**只登记，未动代码**）

> 老大 11-06 10:54「继续找欠账吧。上午我不想去测试，下午再测试」。
> 一轮普查（S-328~S-344）收工后复扫，判据沿用：basename / 标识符在全部源码里**大小写敏感**搜，0 引用才算死代码。
> **本轮只查出 3 条，其中 2 条是真缺陷** —— 前两轮扫的都是「有没有多余的东西」，这轮换了个角度扫「有没有该有却没有的」，才扫出来。

| 编号 | 标题 | 性质 / 归属 | 实测依据 |
|---|---|---|---|
| S-345 | **`isBrowserToolName` 恒假桩，三处下游全失效** | 缺陷；**本迭代** | `lib/app-plugin/browser-tool-names.ts` 全文 3 行 `return false`，形参写成 `_name`。对照物 `desktop-routing.ts`(21 行) 是活的标准写法（`Set` + `has`）；该判的 8 个名字全在 `types.ts:14-21`（`BrowserNavigate` / `BrowserGetContent` / `BrowserScreenshot` / `BrowserSnapshot` / `BrowserClick` / `BrowserType` / `BrowserScroll` / `BrowserSetDevice`）。三处失效：① `tool-block-renderer.tsx:127-128` 浏览器截图不算 `hasVisualResult` ⇒ **截图不进图卡**（且这段还叠了第二层错：判 `input.action === 'screenshot'`，真实工具名里就写着 Screenshot、根本没有 `action` 字段）；② `:279-298` `BrowserToolCard` 整段永不渲染 ⇒ 一套专属卡片 + 6 个图标 + 7 种中文摘要（S-250 搬出的 `BrowserToolCard/` 三个文件）**一次都没渲染过**；③ `execution-outline.classify.ts:196` `'browser'` 分类永不命中 ⇒ 浏览器工具落进 `attention`/`unknown`，**S-315 的折叠规则对它不生效**（老大 11-05 10:43 报「3 次调用出 3 个折叠块」的候选成因之一） | [requirements/S-345.md](requirements/S-345.md) |
| S-346 | **图片「重试」按钮点了没反应** | 缺陷；**本迭代** | `lib/app-plugin/image-tool-retry.ts` 13 行，`resolveImageGenerateRetry(_error: string)` **恒返回 `null`**；**唯一**调用点 `ImagePluginToolCard.tsx:201` 传的实参却是 `toolUseId` ⇒ 名字和实参语义都不对，是被掏空后连签名都没改的壳。**周边全活、只断这一环**：`:66 parseRetryState` 正常解出 `_retryState`（completed/total/errorMessage/status）、`:158 isAwaitingRetry` 正常、`:178` 状态文案正常、`:269-287` 提示块三句文案齐全、`:297` 按钮能点能弹确认框 —— **后端已经把「该重试了」完整传过来了，前端提示计数确认框全做好，唯独最后「发出去」那一下是空的**。用户体感：按钮 → 确认框 → 点确认 → **弹窗关掉，什么也没发生**，比没有按钮更糟。修法先查 main / native worker 有没有按 `toolUseId` 重跑的通道：有就走它、没有就走「往会话补一条 retry 消息」、**都没有就删按钮和整套提示**（不猜） | [requirements/S-346.md](requirements/S-346.md) |
| S-347 | **S-340 漏网：1 整文件 + 2 死导出 + 1 处空行** | 死代码；**本迭代**。零功能变化 | ① `lib/agent/teams/team-native-control.ts` **24 行整文件零引用**（`team-native-control` 在 `src`+`tests` 大小写敏感搜，除自身外 0 次；四个导出各只出现 1 次），内部还有**只写不读**的 `pendingShutdownRequests` Set（`requestTeammateShutdown` 塞、`abortAllTeammates` 清，没人读）；同目录 8 个兄弟文件全是活的（380/180/111/75/59/63/32/8 行），就这一个不通电。② `PluginPanel.tsx:78-80 ChannelPanel` 恒返回 `null`，全量搜**只出现 1 次**（`PluginPanel` 文件本身活，只删这个导出）。③ `lib/tools/plan-tool.ts:11-13 createPlanModeInlineToolHandlers` 返回 `{}`，全量搜**只出现 1 次** —— 返回空集是**对的**（计划模式工具已整体迁到 .NET Worker，同文件 `:15` 的 `enterPlanModeHandler` 走 `nativeOnlyPlanResult` 才是活的），问题是没人调它了。④ `stores/right-panel-tab-factories.ts:4-8` **5 行连续空行**（S-340 删 import 后的疤）。**明确不删**：`getDefaultRightPanelTabs()` 恒 `[]` 是合法初始值、`tooltip.tsx:115 TooltipContent` 是 React compound 空壳（115 次命中）、`image-attachments.ts` 两处和 `weixin-crypto.ts sniffImageMediaType` 是正则误报（抓到的是早退分支） | [requirements/S-347.md](requirements/S-347.md) |

### 本轮复扫清零 / 误报的（别重复查）

| 项 | 结果 |
|---|---|
| `TODO` / `FIXME` / `HACK` / `XXX`（大小写敏感，`src`+`tests`+`scripts`） | **0** |
| 空 `catch {}` 块 | **0** |
| 大小写重名文件（S-339 那类，全仓） | **0**（S-339 修干净了） |
| `package.json` 74 个依赖未在 `src`/`scripts`/`tests`/`website`/配置 中出现 | **0** |
| C# 连续 3+ 行注释掉的代码 / 空方法体（`src/runtime` 全量） | **0** / **0** |
| 超 500 行且无豁免标记（`src`+`tests` 复扫） | **0** —— 脚本初次报 4 个全是**我脚本的缺陷**（只取前 3 行找标记，而豁免注释在第 7~9 行）；全文复核 4 个全部有标记（`qq-service.ts` 558 / `terminal-handlers.ts` 684 / `ContextCompression.cs` 1120 英文标记 / `AgentRuntimePlanExecutor.cs` 562） |
| i18n zh/en 键差集 | **0 真欠账**。`chat` 那 3 条（`ranCommandsInline` / `_one` / `_other`）是 **i18next 复数规范**：zh 无复数形式用无后缀键、en 用 `_one`/`_other`，调用处 `utils.ts:260` 传了 `count`，**正确** |
| `@ts-ignore` 4 处 | **合理**：`preload/index.ts:163,165`（`define in dts`）+ docx/pdf viewer 两处（optional dependency）。**不算欠账** |

## 八、三轮 dev 审查三条（S-348 ~ S-350）

> 2026-11-06 21:0x dev 实例测试 + 审查上报五条，逐条核实**全部属实**。
> 按「文件不重叠 + 回滚边界独立」归并成三条 —— dev 的第 3 条（`resetSessionScopedAgentStateCache` 零引用）
> 与第 5 条（缓存逻辑零测试）本是同一件事的两面，合并进 S-350。

| 编号 | 标题 | 性质 / 归属 | 实测依据 |
|---|---|---|---|
| S-348 | **浏览器卡片兜底回显工具名 ⇒ `BrowserSetDevice` 裸英文** | 缺陷（用户可见，中危）；**本迭代** | `BrowserToolCard/summary.ts` 的 `buildSummary` 有 7 个分支，缺 `BROWSER_SET_DEVICE_TOOL_NAME`，落末行 `return name`；而 `BrowserToolCard.tsx:105` 是 `primary: summary || title` ⇒ summary 拿到非空工具名就短路、已本地化的 title（zh `chat.json:949` = 「浏览器设备模拟」）**永远用不上**。**S-270 修过同一个病的另一侧**（title 的 `fallbackTitle` 末行 `return name` → `resolveToolDisplayName`，注释还在 `:86`）。顺带 `getResultRows` 也没有 SET_DEVICE 分支 ⇒ 卡片展开后一行字段都没有。**修法不只补一个 if**：末行改空串（任何新浏览器工具都不会再裸英文）+ `BROWSER_CLICK` 末位 `\|\| name` → `\|\| ''` + 补两处分支 + i18n 中英各 4 键 + 新增 `tests/browser-summary-fallback` 8 条（按 8 个工具常量逐个过，加第 9 个漏分支直接红） | [requirements/S-348.md](requirements/S-348.md) |
| S-349 | **两处注释还在说「选择器是桩」** | 注释失效；**本迭代**。零代码行为变化 | `SubAgentsPanel.tsx:237` / `SubAgentExecutionDetail.tsx:245` 原文一模一样：`// Directly access agent store fields (selectSessionScopedAgentState is still a stub)`。实际它现在是 **198 行真实现**（S-342 `6b501efb`：按 sessionId 分组 + 源引用缓存 + 限 32 会话）。当时「这两处代码不依赖它、所以代码不用动」的推论是对的，**但推不出「注释也不用动」** —— 注释写的前提没了就是假话，后人会以为子代理编排里还悬着一坨没接通的桩。只改注释，`git diff -U0` 确认 6 增 2 删全为注释行 | [requirements/S-349.md](requirements/S-349.md) |
| S-350 | **`_options` 假参数 + 198 行缓存逻辑零测试** | 接口欠账 + 测试欠账；**本迭代** | ① `selectSessionScopedAgentState` 第三个形参写成 `_options?: { mode?: string }`，**4 个调用点全传 `{ mode: 'coarse' }`、函数体一次没读**（`useMessageListData.ts:142` / `MessageList.tsx:33` / `StaticMessageTranscript.tsx:65` / `SubAgentCard.tsx:241`）。危害不是浪费 CPU，是**撒谎**：后来人会照「传了 coarse 所以视图被裁剪、比较便宜」的假设去做优化。② 该选择器被丢进 `useAgentStore(selector)`，zustand 用 `Object.is` 比对返回值，**每次造新对象就是无限重渲染**（老大反复骂的「聊几轮内存上 G、列表卡死」）；守这条线的只有 `CacheEntry` 里 6 个 `===`，而 `npm test` 里**一条都没碰它**。③ `resetSessionScopedAgentStateCache`（注释写「仅供测试与诊断」）全仓 0 调用 —— **不删，补测试让它兑现**（删了下次写测试还得补回来） | [requirements/S-350.md](requirements/S-350.md) |

**核实后与 dev 转述的两处差异**：

- S-348 转述为「8 个分支缺 1 个」，属实但**没点到病根** —— 病根是末行 `return name` 这个兜底本身，补第 8 个分支只能挡这一个工具。
- S-350 的第 3 条 dev 建议删 `resetSessionScopedAgentStateCache`，第 5 条又建议补测试 —— **这两条是同一件事的两面**，补了测试它就有用，不该删。

---

## 2026-11-09 09:1x 用户报：浏览器截图重开会话后看不到预览图

> 原话：「浏览器截图 页面看不到预览图，卡片点开是
> `[{"type":"image","source":{"type":"base64","mediaType":"image/png","filePath":"D:\...\1794186665198-4f7662f4.png"}},{"type":"text","text":"Screenshot captured: 575x1434px - https://example.com/"}]`」

| 编号 | 标题 | 性质 / 归属 | 实测依据 |
|---|---|---|---|
| S-351 | **历史消息里的图片块长不回来 —— 浏览器截图卡只剩原文 JSON** | 缺陷（显示层数据形态不一致，中危）；**本迭代**，已修复 | 库里 `message_parts.kind='tool_use'` 的 `payload.output` 是**字符串**（后端 DTO 的 `output` 是 `string`，块数组被 stringify），实时链路里却是**内联数组**。三张卡片一律 `Array.isArray(output)` 取图（`BrowserToolCard.tsx:64` / `ImagePluginToolCard.tsx:104` / `text-output.tsx:27`）⇒ 同一张截图「执行中有预览、重开会话只剩原文」。**S-294 当年只修了桌面/窗口截图那一条**（`splitDesktopToolBlocks` 自己 decode），另三条全漏着 —— 同一个病修了四分之一。**修法不在卡片上补 decode**（每加一张卡就要再抄一遍判据），改在渲染态统一出口 `buildToolCallRenderState` 归一：`output: reviveImageBlocks(result?.content ?? liveToolCall?.output, decodeStructuredToolResult)`，历史+实时一起覆盖。判据刻意收窄到「解出来是数组**且含 image 块**」—— 普通文本输出恰好是合法 JSON 数组时原样返回，不被误当成块数组把原文藏起来（那会变成一张空白卡，比原来的 JSON 更难查）。解码器走参数注入，理由同 `desktop-tool-blocks.ts`：`tool-result-format` 顶部 import 了 zustand，直接拖进纯函数 node 里跑不了回归。新增 `tests/tool-output-revive` 17 条断言 | [requirements/S-351.md](requirements/S-351.md) |