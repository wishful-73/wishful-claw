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

## 二、挂账 / 阻塞（四条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账** | 频率低、**只在新版本第一个会话偶发**；老大 2026-10-31 定「先登记等以后模型牛掰了再试试能解决不」。S-274 / S-315 修完后仍未消失 ⇒ 根因不同 | [../iter-v3-2/requirements/S-233.md](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约** | 全树搜 `qoder` 零命中，契约不到不写任何请求代码 | [../iter-v3-2/requirements/S-230.md](../iter-v3-2/requirements/S-230.md) |
| S-273 段 B | 第三方窗口的元素树（`EnumChildWindows`） | **待拍板** | 段 A（自家窗口走 CDP）已随 v3-iter-5 交付。段 B 只覆盖 Win32 控件，Chromium 系第三方窗口拿不到 ⇒ 收益存疑 | [../iter-v3-4/requirements/S-273.md](../iter-v3-4/requirements/S-273.md) |
| S-320 | .NET 11 SDK 升级（消 NU1903 / ILCompiler Brotli 告警） | **挂账，等 .NET 11 GA** | 零暴露（全仓 `Brotli` / `Accept-Encoding` / `AddRequestDecompression` 零命中，唯一 `HttpClient` 显式 `AutomaticDecompression = None`）；只能升 SDK 才能消，**不 `NoWarn`** | [../iter-v3-7/requirements/S-320.md](../iter-v3-7/requirements/S-320.md) |

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


