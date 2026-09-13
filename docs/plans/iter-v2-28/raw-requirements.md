# iter-v2-28 原始需求登记（未规划）

> 本文件收老大口述、尚未做代码勘查和范围拍定的原始需求。
> 每条在正式立项时拆成独立需求文档并从这里移出。
> 已立项/已确认范围的需求见同目录其他文件。
> **2026-09-11 收集已封口**：28 迭代范围见文末「状态」小节；本文件四条仍未逐条出 Plan。

---

## R-1 补位模型（不可见 Agent 请求的兜底模型）

登记日期：2026-09-11

老大原话：

> OpenCowork 有快捷模型概念，我这里需要有个补位模型，在进行部分不可见的 agent 请求操作时，我希望有个兜底的模型。什么意思呢，就是在比如提示词优化的时候，我们也会触发请求，这种请求我就希望能通过这个兜底的模型去请求。如果没设置兜底模型，那么就用最近使用的服务商+模型去请求。

需求拆解（按原话，不含设计）：

1. 新增一个"补位模型"配置项（服务商 + 模型）。
2. 作用范围：**部分不可见的 agent 请求操作**——用户不会在主对话流里看到这些请求。老大举的例子是提示词优化。
3. 未配置补位模型时的回退行为：用**最近使用的服务商 + 模型**发这些请求。

> ### ✅ 本条已立案（2026-09-11），最终口径见 `plan.md` R-1 节
> **规划期已闭合五条裁定**，此处仅留登记原文，不再作为口径依据：
> ① 范围边界 = 四条清单（提示词优化 / 新建角色辅助 / 后台定时执行 / 定时任务会话执行）；② **原第 3 点"最近使用"已作废**（服务商下线模型 + 用户删除会造成悬空 id，属**外部不可抗力**，不作为缺陷立案，但足以否定该口径），改为**逐请求显式配置 + 补位兜底**；③ 四个哑字段（`contextCompressionModel` / `useGlobalActiveModel` / `ClaudeCodeConfig` / `promptRecommendationModels`）**全删**；④ 提示词优化与新建角色辅助**各加显式模型配置**；⑤ **三级解析定稿**——① 该请求显式配置 → ② 补位模型配置 → ③ 全局激活模型（**保留 + 强制存在性校验**，失效即报可见错误，不静默）。
>
> **"不可见"的最终定义**（老大 2026-09-11）：「用户也不知道是哪个模型在请求」——描述的是**用户不知道跑的哪个模型**，而非"用户不配给它配模型"（后台定时任务本就可配模型，它仍属不可见）。
>
> 与已登记的 **Plan D（多服务商有限重试后 fallback，`docs/plans/iter-v2-27/plan.md:195-205`）不是同一件事**：Plan D 处理的是可见主对话请求失败后的跨服务商切换；本条处理的是不可见请求的默认路由。两者用词都含"兜底/fallback"，立项时不要合并。

已查明的事实（第一轮系统计需求勘查时顺带所得；标注「2026-09-11 定向复搜」的那条块是针对本条专门查的）：

- 提示词优化走单次 completion，链路是 `src/renderer/src/lib/prompt-optimizer/optimizer.ts:93-97` → `workerRequestWithId('provider/complete')` → `src/runtime/WishfulClaw.Agent/Modules/ProviderTestModule.cs:14`，provider 配置由调用侧传入，不经过 Agent Loop。
- **"看起来像先例"的四个字段，2026-09-11 定向复搜后实测全部是写了不读的哑数据**（判据：字段名在全仓仅出现在 store 声明 / 默认值 / 持久化 partialize / 迁移校验，无任何消费方）：
  - `contextCompressionModel`（`settings-store.ts:131`，注释即 "Dedicated summarizer model"）。C# 侧压缩参数取自 **provider 配置**（`AgentLoop.ContextCompression.cs:38` 的 `contextLength`、`:42` 的 `contextCompressionThreshold`），渲染端这个字段根本没有下发通道。
  - `SessionDefaultModelBinding.useGlobalActiveModel`（`settings-store-types.ts:13-15`）——全仓命中 1 处，就是类型定义本身，连默认值都没有。
  - `ClaudeCodeConfig` 整块（`settings-store-types.ts:17-27`，含 `smallFastModelId` 与 sonnet/opus/haiku 三个槽）——`claudecode` 大小写不敏感全仓只命中 3 个文件且全在 settings-store 三件套内，无 UI 无消费方；C# 侧 `smallFast` / `small_fast` / `ANTHROPIC_SMALL_FAST` 零命中。
  - `promptRecommendationModels`（按 chat/clarify/cowork/code/acp 各绑一个 `ModelBinding | 'disabled' | null`；`settings-store-types.ts:36-40`，store 的 `:225` 声明 / `:365` 默认 / `:523` 持久化 / migrate `:126-138`）——**本节先前记的"已在 `settings-store.ts:225` 生效"是错的，`:225` 只是声明处**；`src/runtime` / `src/main` / `src/shared` 对 `promptrecommendation` 零命中。
- 真正活着的模型解析只有一条：`useProviderStore.activeProviderId / activeModelId`（`provider-store.ts:20` 默认、`:95` setter、`:306` 持久化）＋会话级绑定的回退形状，见 `AssistantMessage/index.tsx:89-98,113-126` 的 `sessionModelBinding ?? activeProviderId` 与 `fallbackModelId`。
- 老大说的「最近使用的服务商+模型」**没有 recency 埋点可取**：全仓 `lastUsedAt` 只挂在 `ProviderOAuthAccount`（`src/shared/types/provider.ts:188`），唯一写点 `lib/auth/provider-auth-accounts.ts:127-130` 是 OAuth 账号轮转戳，与模型无关。所以"最近使用"要么落在上面那个已存在的"全局激活模型"概念上，要么就得新写一份使用序列。
- 立项含义（不代表建议）：本条不是"在几个现成槽位旁边再加一个"，而是"同类槽位已经烂了四个"。新字段落地前应先定那四个的去留（删 / 并入本条统一接线 / 各自补接线），否则"哪种请求跑哪个模型"只会更说不清。

---

## R-2 渠道设置页：功能设置改为全局（选项卡化）

登记日期：2026-09-11

老大原话：

> 渠道设置页，在渠道本身的里面有个功能设置，这个里面包含权限和一些自动处理方式，这个不需要每个渠道单独设置，需要把下面的全局回复设置弄成选项卡，把这些设置都弄下去。

需求拆解（按原话）：

1. 现状：渠道设置页里，**每个渠道内部**各有一个"功能设置"，内容包含权限和一些自动处理方式。
2. 判断：这些不需要逐渠道单独设置。
3. 期望：把页面下方的"全局回复设置"改成**选项卡**形式，并把上述设置挪进去（全局一份）。

> ### ✅ 本条已立案（2026-09-11），最终口径见 `plan.md` R-2 节
> **规划期已闭合三条裁定**（老大 2026-09-11）：
> ① **旧逐渠道 `features`/`permissions` 值 → 摘白名单丢弃**（默认值以全局唯一真源为准，不从既有渠道搬初值）。
> ② **5 个「只展示不生效」字段 → 只搬家 + 记账**，**唯 `allowShell` 例外：本次接真且语义改写为「是否需用户授权」**——本身**恒可见**（属核心集 `shell` 类），`false` = 默认需授权（每次调用需用户确认，即"语言确认授权"），`true` = 免授权直接调用。经实读，`allowShell` 实际是"半死"状态：`bash-tool.ts:50` 的读取逻辑本就符合新口径，但 `channelPermissions` **全仓零注入点**，故该字段从未生效；本次须一并修注入，且**强制执行须落在 C# Worker 侧**（渲染端 `execute` 只返回 `nativeOnlyBashResult()`）。**落在搬家的 4 个**：`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents`。
> ③ 全局设置**不另开文件**，沿用 `plugins.json` 既有存储路径与读写通道，**以增加字段的方式**承载。
>
> 边界提醒：本条与 R-3 共用 4 个文件（`channel-types.ts`、`channel-config-store.ts`、`channel-plugin-handlers.ts`、`channel-handler-utils.ts`），**两项不得并行改**。

> ### 📦 本条已交付（2026-09-12），实现与验证记录见 `plan.md` R-2 节末
> 搬家已完成：渠道详情内不再有"功能设置"，全局设置页改为三张自绘选项卡（回复 / 功能 / 权限），唯一真源在 C# Worker。
>
> 落地过程中**偏离了上面两条裁定字面**，均为实读后的纠偏，结论优先于原口径：
> - **裁定 ③ 修正**：`plugins.json` 根节点是 `JsonArray`（渠道清单本身），装不下一个兄弟全局对象，故全局设置改存 Worker `ConfigStore` 的 `channelSettings` key（即 `~/.wishful-claw/config.json`）。**仍是"不另开文件"**，只是换了既有文件；代价是新增 2 个 IPC 端点与 2 个 AOT 序列化类型，原规划里"无需新增端点、无需新增 AOT 类型"两句作废。
> - **裁定 ② 的 ③④ 两点修正**：放弃"注入 `channelPermissions`"路线——该字段所在的渲染端工具边界从不真实执行 shell（`bash-tool.ts` 的 `execute` 只返回 `nativeOnlyBashResult()`），且 `toolRegistry.checkRequiresApproval` 全仓零调用方，注进去仍是死配置。改为**删除这条死链**，授权判定单点落在 C# `ToolCallProcessor.Approval.cs`，与设置面板读写同一个 store，并有 `tests/WishfulClaw.ChannelShellApprovalRegressionTests` 57 断言钉住。
>
> **仍未接强制执行**（见 S-5）：`streamingReply` + `allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents`，五个字段本次只搬家与存盘回读，UI 段首已明写"尚未接入强制执行"。`shellRequiresApproval` 是唯一已生效项。

---

## R-3 工具可见性：注册期声明"范围:类型"属性，取代写死的白名单

登记日期：2026-09-11

老大原话：

> 目前工具本身我们是需要过滤的，后端设置的过滤是强制性的，我现在搞得什么白名单，一大堆写死的工具名，这个我不希望这么做，我希望在工具注册的时候，就有个属性 比如 use_mode 之类的，然后是组合的 project:chat,project:cowork,global:chat,global:channel 之类的，通过 use_capability 去拿的时候就能直接通过提供的会话范围+会话类型就能获取到工具列表了，还有增加一个字段是否核心工具，提供默认工具的时候就是会话范围+会话类型+核心true，这是优化需求。

需求拆解（按原话，不含设计）：

1. **要去掉的**：现在这套"白名单 + 一大堆写死的工具名"的过滤方式。
2. **要加的**：工具**注册时**就带一个属性（`use_mode` 系老大举例，正式命名待定），值是 `会话范围:会话类型` 的组合，例：`project:chat`、`project:cowork`、`global:chat`、`global:channel`。
3. **取用方式**：通过 `use_capability` 获取工具列表时，调用侧只给「会话范围 + 会话类型」，即可直接拿到对应工具列表。
4. **再加一个字段**：是否核心工具。提供**默认工具集**时的查询条件是「会话范围 + 会话类型 + 核心 = true」。
5. 保留前提：后端设置的过滤是**强制性的**（本条不改变这一点）。
6. 定性：优化需求。

补充确认（2026-09-11 同日，老大原话）：

> use_mode 这个只是我举例的，字段名可以取一个更合适的，插件以及 mcp 走 use_capability 不进核心

> 还有我们渠道配置本身也会设置一些工具是否可以用，这个就是在本身 use_capability 会返回的范围再过滤一次，就是本身是可以的，但是用户关了，那就不可以调用

> 这个不仅仅是 use_capability 返回范围，工具实际上有两种方式放给 agent，一种是系统提示中给核心工具，获取核心工具也会被这个收窄限制

- 字段名 `use_mode` **仅为举例**，立项时另取合适命名，不要当既成契约沿用。
- **插件与 MCP 工具**：走 `use_capability` 获取，**不进核心**——即不出现在「范围 + 类型 + 核心 = true」的默认工具集里。
- **工具投放给 agent 有两条通路**：① 系统提示里直接给核心工具；② 通过 `use_capability` 获取。
- **渠道配置的工具开关对两条通路都生效**：不只收窄 `use_capability` 的返回范围，同样收窄进系统提示的核心工具集。即"本身可以，但用户关了就不可以调用"在两条通路上都成立，该层**只收窄、不扩权**。

### 范围取值与表达形式（2026-09-11 同日第三轮补充）

老大原话：

> 这个权限范围需要明确一下，目前来说有 未知范围 + project:chat, project:cowork, global:chat, global:channel 以及子agent project:chat-subagent, project:cowork-subagent；子agent应该每个下都会有。如果工具是通用的直接给 * ，比如文件查看工具，这样就不用全部列出来了，或者两个设置也可以，一个白名单，一个黑名单，比如反向设置 浏览器工具只有 subagent 不能用

**取值枚举（老大口径）**：

| 组合 | 主 | 子 Agent |
|---|---|---|
| project:chat | ✅ | ✅ 已列 |
| project:cowork | ✅ | ✅ 已列 |
| global:chat | ✅ | 未单列，按"每个下都会有"推定存在 |
| global:channel | ✅ | 未单列，按"每个下都会有"推定存在 |
| 未知范围（如定时任务后端执行） | ✅ | 未提及 |

- **未知范围**指的不是解析失败兜底，而是**本身就没有会话宿主的执行态**。老大原话：

  > 未知范围指的是，比如定时任务后端执行这种

  即后端自发起（如定时任务）没有 chat/cowork/channel 这个宿主可归属。

  我的理解（待你确认）：这类场景是常态而非异常，所以"未知"应当是一个能明确匹配到某档工具集的正常取值；而"真解析不出来"要不要与它共用同一个值，尚未定。
- 「子 agent 应该每个下都会有」——即 `-subagent` 不是一对特例，而是每个 `范围:类型` 组合的固有下档。上表按此推定，具体命名与是否含未知范围待立项确认。

**表达形式（老大给了两种，未定取舍）**：

1. **通配**：通用工具直接给 `*`（例：文件查看工具），不必逐个列出组合。
2. **白名单 + 黑名单两个设置**：用于反向表达。动机例子是"浏览器工具只有 subagent 不能用"——纯正向白名单遇到这种"整体允许、单点排除"时，必须把其余组合全列一遍，故需要黑名单一侧。

待明确（本次不勘查、不规划）：

> ### ✅ 本条已立案（2026-09-11），最终口径见 `plan.md` R-3 节（R-3.A～R-3.G）
> 上述全部待明确项**已在规划期裁定闭合**，摘要如下（细节一律以 `plan.md` 为准）：
> - **通配与黑白名单** → **一个正向集合 + 一个排除集合并存**（声明侧可用 `*`，运行侧永远具体串）；**优先级：黑 > 白 > 默认可见**。
> - **`-subagent`** → 改为串语法中的 `@role` 维度：`<scope>:<mode>[@<role>]`。
> - **强制层与渠道开关** → 属**两层**：统一可见性判定为强制层，渠道工具开关为**收窄层，作用在其后，只减不增**。
> - **插件与 MCP 的范围由谁给** → **按注册来源自动兜**，不要求声明；且**不进核心集**。
> - **自研"非核心"档的运行时表现** → **等同插件/MCP**：可被 `use_capability` 取到，不进默认核心集。
> - **写死白名单位置与条数** → 已勘查：A 类准入表 10 张 + B 类路由谓词 30 个 + C 类审批文案 6 处 + D 类提示词 2 处 + E 类渲染端 5 处（见 `plan.md` R-3.E）。
> - **另需记录的四条规划期新增裁定**（原登记未含）：④ **定时任务拆两类**（`runMode:'session'` 随目标会话 / `runMode:'background'` 为 `unknown@automation` 且排除浏览器、渠道专用、交互组件）；⑤ **核心工具集原则**——系统提示词只列"少而必要"的核心工具，其余经 `use_capability` 按需（这是本需求的**真正意图**）；⑥ **`use_capability` 三载体同源同裁**——提示词核心集 / description 分类清单 / `action="list"` 返回必须是同一套可见面（实读确认 `list` 当前缺收窄，属必修缺陷）；⑦ **本次范围 = B（两步走）**——只做机制、零行为变化，收窄立为后继需求（见文末）。
> - 项目记忆里"工具可见性审查须覆盖白名单 + 代理两级机制"一条**已由勘查证实**并展开为 `plan.md` R-3.E 的五条。

### 实施期追加裁定（2026-09-12，两条，均已在 `plan.md` 落地）

**裁定一 · 中心名字表清零**——原话：「`IsAllowedByChatAllowlist` 比如这种方法 里面还是内置的 HashSet<string> 这个不是应该在工具本身的白名单上么，而不是还存在这么几个内置的 HashSet<string>」＋「HashSet<string> 我希望所有的这个都去掉，不然这次工具处理没有任何意义」＋「部分工具 比如临时todo这种 以及文件查看查询这些 直接是允许 `*`」。同时作废"零行为变化"这条自设约束：「零行为变化是 agent 规划的时候的步骤，并不是必须」→ **`plan.md` R-3.I**。

**裁定二 · 浏览器只经 proxy**——原话：「浏览器工具不属于核心工具，只需要在代理里面能查到使用就行」＋「浏览器工具属于插件里面来的，这些工具都是在代理里面就行。麻烦的一点就是我不希望不可见进程去调用比如子agent去调用」。追问否决要收到哪些档，老大给出**判据**：「部分定时任务也就是自动化是最终去会话里面去执行的，这个就可以调用，但是**后台执行的不行，子会话不行**」→ 区分标准是**有没有一个人在看着的会话宿主**，不是"是否自动触发" → **`plan.md` R-3.J**，并关闭 S-7。

---

## R-4 首个正式版本的使用指引（说明手册）+ README 拆分

登记日期：2026-09-11

老大原话：

> 还有一个就是需要准备第一正式版本的一些指引，类似说明手册，需要用户配合截图，Readme 调整成用户看的使用指引，以及开发看的当前的 readme。使用指引，就是把我们已有的功能都罗列出来，必要的需要用户提供截图，或者 agent 通过调用工具截图。说到截图，我们是不是缺少截图工具，让 agent 可以自主截图。

需求拆解（按原话，不含设计）：

1. 首个正式版本发布前，需要准备一份面向用户的**指引／说明手册**。
2. 现有 README **一分为二**：用户看的《使用指引》＋开发看的当前 README。
3. 使用指引的内容基线：把**已有功能全部罗列**出来。
4. 配图来源两种：用户配合提供截图，或 **agent 调用工具自主截图**。
5. **应用内入口（两处，均跳同一份 GitHub 使用指引）**：
   - ① 「关于」页新增一个按钮。
   - ② 顶部右侧现有图标组的**左边**新增一个**问号图标**。

老大原话（同日）：

> 这个使用指引可以在关于页面增加按钮一个指向到我的 github 仓库中的使用指引上。

> 使用指引还可以在顶部右侧图标的左边增加一个问号图标，也是点击后可以跳转到 GitHub 的使用指引。

两个入口共用同一条 URL，属固定字符串，立项时按单点定义收敛（一处定义、两处引用），不要在关于页和顶栏各写一遍。

### 关于"是否缺截图工具"：不缺（本次定向检索结论）

老大澄清（同日）：

> 我需要的肯定是整桌面截图，目的是截图软件本身，用于给用户做指引。

即**不需要**按窗口／按区域截取，整桌面即可，拍摄对象是软件自身的界面。

Agent 侧已存在两个截图工具，可直接被调用：

| 工具 | 能力 | 落点 |
|---|---|---|
| `DesktopScreenshot` | 整桌面截图，**仅主显示器**，以 base64 PNG 回给 agent | `src/runtime/WishfulClaw.Agent/AgentRuntimeDesktopExecutor.cs:26,81-104` → IPC `desktop:screenshot:capture`（`src/main/ipc/desktop-control.ts:122`）；声明 `Tools/Providers/DesktopToolProvider.cs:18-19` |
| `BrowserScreenshot` | 当前浏览器视口截图 | `AgentRuntimeBrowserExecutor.cs:29`；声明 `Tools/Providers/BrowserToolProvider.cs:38-39` |

能力边界与关联点（已实读代码确认）：

- **只截主显示器**：`desktop-control.ts:124,139-140` 取 `getPrimaryDisplay()` 对应的 source，取不到则退回首个工作项。返回结构里的 `displayCount` 只是附带信息，不代表多屏都被截。截副屏目前无入口。
- **不落盘**：`desktop-control.ts:142-153` 只把 PNG 转 base64 随结果返回，Main 侧不写文件。
- 落盘能力另有现成通道：`image:persist-generated`（`src/main/ipc/misc-handlers.ts:268-277`）接受 base64 写文件，但落点固定在 `~/wishful-claw/image/`（`:243-251`），不能指定目标目录。也就是说"截图 → 存成文档配图"这一步**数据通路已有，但产物位置不在仓库内**，且该 IPC 是否已作为 agent 工具暴露本次未确认。
- 设置页把两个截图工具都标为「无参数」（`src/renderer/src/locales/zh/settings.json:815,821`），无窗口／区域入参——按老大澄清这是**符合预期**的，不算缺口。
- 整桌面截图意味着**桌面其它内容会一并入镜**。用作对外文档配图时，清场与脱敏是前置动作，不能默认截完即用。
- 这两个工具名同样出现在 `src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs:62` 的硬编码清单中，正是 **R-3 要替换掉的那类写死工具名**，两条规划时应一并看，别在旧机制上再加一层。

与既有记账交叉引用：`docs/progress/v2-iter-27.md:29` 已记「桌面验证证据未产出——plan 要求的 `evidence/*.png` 未保存」，iter-26 多个 plan 步骤也以 evidence 截图为验收物。R-4 的配图与这条"取证"缺口是同一块肌肉，规划使用指引时可一并解决。

待明确（本次不勘查、不规划）：

- 功能罗列的粒度（全量到每个面板，还是只到主要能力）。
- 配图最终由谁出：老大手工截 / agent 自主截 / 混合。
- 脱敏要求是否沿用 iter-26 的口径（`evidence/` 只存脱敏截图，不提交凭据与完整用户路径）。
- 使用指引在仓库中的存放路径与文件名（README 拆分后《使用指引》落在哪、关于页按钮指向哪个 URL）。
- 「关于」页与顶部右侧图标区的现有结构本次均未勘查；顶栏已有哪些图标、加一个问号后的余量与落点，立项时看实际代码定。外开链接须沿用项目既有约定 `setWindowOpenHandler` → `shell.openExternal`（口径来源 `docs/plans/iter-v2-26/plan.md:101`），同样以当时代码复核。
- 顶栏问号是否要出现在**所有**带顶栏的窗体（主窗口、全局对话浮框等），还是仅主窗口。

---

## R-5 更新悬浮块支持拖动（＋位置跨重启记住）

登记日期：2026-09-12（执行期内追加）

老大原话：

> 更新页之前是在更新弹窗正在更新的时候可以点击后台下载，隐藏更新弹窗后会有一个小的悬浮块，之前是调整了位置，我觉得位置还是不太合适，但是不打算调整了，想让悬浮块支持拖动可以么

需求拆解（按原话，不含设计）：

1. 更新悬浮块（`UpdateStatusBanner`，隐藏更新弹窗后左下角那个）**支持拖动**，用户可自己摆位置。
2. 不再继续调默认位置——现有落点保持不动。

两条当场裁定：

| 问题 | 裁定 |
|---|---|
| 归属与时点 | **立进 28 作为 R-5，当场做**（不排后继需求） |
| 拖过之后的位置要不要跨重启记住 | **记住** |

与 #2 的边界：#2 的「悬浮窗遮挡位置」是替用户挑默认角落（已实施 `c7287b6e`），R-5 是把选择权交给用户；R-5 **不改** #2 定下的默认落点。

---

## R-6 提示词按「英文 + 四关」约定清理

登记日期：2026-09-12（执行期内追加）

老大原话：

> 人格文档暂时没什么好方案，这个先不用管，我看中的是刚刚的提示词优化本身，除了工具本身用英文描述，下面还有其它的要求

背景：老大把《提示词优化》原则放进仓库（`docs/提示词优化.md` ＋ `docs/提示词优化原则.ipynb`），要求**不只是记着，而是落到本仓库已有的提示词上**。原则四条：

1. 提示词一律英文，注释一律中文（系统提示词每轮重发 + 是 prompt cache 前缀，中文更贵且服从度更低）。
2. 结构照搬 Claude Code：分节的行为规则，不是一段自我介绍。
3. 加一行之前先过四关：① 说得出没有它模型会做错哪件具体事；② 形容词换成阈值或例子；
   ③ 能变成事实／工具描述／代码强制的就不要写成规则；④ 对着真实的失败写。
4. （补充）事实类陈述必须与运行行为一致。

需求拆解（按原话，不含设计）：

1. 提示词本身（系统提示词、工具描述、各执行器内嵌的提示词）按上述四条清理。
2. **人格文档本轮不动** —— 老大裁定「暂时没什么好方案」。
3. 工具描述**已经是英文**，勘查已确认，不在改动范围。

---

## R-8 AI 服务商官网地址与详情页入口

登记日期：本次执行期追加

### 背景

当前 AI 服务商列表只能展示名称、启用状态和模型信息。用户看到内置服务商后，不知道应前往哪个官方站点注册、申请 API Key 或查看服务说明。

### 需求拆解

1. 在 AI 服务商数据模型中新增可选的官网地址字段（建议命名 `websiteUrl`）。该字段不是必填项；自定义服务商可以为空，不得因为缺少官网地址而阻止保存、启用或调用。
2. 为 `builtinProviderPresets` 中的**全部内置 AI 服务商**补齐官方官网地址。地址必须逐项从服务商官方站点核实，优先使用官方产品首页或官方开发者/API 控制台入口，不使用第三方聚合页、推广页或不稳定的临时链接；不得漏填、错填或把模型文档地址误当成服务商官网。
3. AI 服务商详情页在存在官网地址时提供可点击入口，使用系统默认浏览器打开；没有官网地址时不显示空链接或禁用态噪音。
4. 外链打开沿用应用现有的外部链接安全边界（协议白名单 + `shell.openExternal`），不在应用内嵌页面中加载任意地址。
5. 内置 preset 更新、已有用户配置迁移和自定义服务商配置必须兼容：官网地址缺失时按 `null`/未配置处理，不能覆盖用户已有的 API Key、Base URL、模型或启用状态。

### 验收标准

- [ ] AI 服务商类型、preset 和持久化读写支持可选官网地址。
- [ ] `builtinProviderPresets` 中每个内置服务商都有已核实的官方地址，且地址使用 `https`。
- [ ] AI 服务商详情页仅在有地址时显示“官网/官方网站”入口，点击后调用系统浏览器打开正确地址。
- [ ] 无官网地址的自定义服务商仍可正常保存、启用、配置模型和发送请求。
- [ ] 旧配置升级后字段缺失不报错、不丢现有配置；重启应用后官网地址和其他配置状态保持正确。
- [ ] 外链不能通过 `javascript:`、`file:` 等非允许协议绕过现有安全校验。

---

## R-10 聊天窗执行态渲染体验三修（吸附卡不透明 / 执行中高度只增不减 / 定格过程展开限高）

登记日期：2026-09-13 执行期追加；三条口径已与老大讨论当场拍定，已出 Plan（`plan.md` R-10 节）。

### 背景

聊天窗在 Agent 执行期间存在三个渲染体验问题：

1. 当前轮 user message 吸附卡（滚出可视区顶部时钉在列表顶部的 overlay）直接复用 `UserMessage` 气泡，底色为半透明（`bg-muted/35 dark:bg-muted/70`），压在下方滚动内容上时文字透出，造成重叠观感。
2. Agent 回复执行中动态渲染组件（widget 等）使消息内容高度先增后减，虚拟列表总高度收缩时贴底逻辑反复触发，整个聊天窗跳上跳下。
3. 执行结束后过程块自动折叠；手动展开时内容无最大高度限制，自然高度撑满整个聊天窗，要翻很久才能找到收起按钮。

### 需求拆解（口径已拍定）

1. **吸附卡背景不透明**：只在吸附态处理——overlay 容器垫一层不透明 `bg-background`（可配底部渐隐遮罩）；**不改**全局 `USER_MESSAGE_BUBBLE_CLASS`（普通气泡半透明在纯背景上没有问题，不能为此动全局观感）。
2. **执行中内容高度水位线**：执行中内容总高度**单调不减**——虚拟总高度变化时取 `max(水位线, totalSize)`，以 min-height 施加在内容容器上，收缩部分用底部留白补齐；执行结束**立即**收回水位线、高度一次性收回（老大确认接受收回时的一次跳动）；会话切换与初始加载重置水位线，不跨会话残留。
3. **定格过程展开限高**：只作用于**执行结束后**手动展开的定格内容（过程块 / 思考块 / 工具运行组三处统一封顶 `max-h-[70vh]` + 内部滚动条）；内容不足 70vh 时不生效，短内容无感知。**执行中一律不管**——过程块保持现状（自动展开、不封顶、外层自动贴底），不加任何流式联动与内部贴底逻辑（老大 2026-09-13 明确：执行中的高度不用管，限高针对的是执行结束已成定局被收起的内容）。

### 验收标准

- [ ] 吸附卡钉住时下方滚动文字不再透出；普通消息气泡外观不变。
- [ ] 执行中 widget 缩小时聊天窗不跳动，底部出现留白补齐；执行结束高度立即收回；切换会话不残留留白。
- [ ] 执行结束后展开过程块 / 思考块 / 工具运行组，超长内容封顶 70vh 出内部滚动条，短内容高度不变；执行中三处行为与现状完全一致。

---

## 状态：iter-28 原始范围（R-8 为本次追加，已出 Plan 并落地）

老大原话：

> 28迭代目前就是准备做这些了。

范围 = **已立项/已确认范围的三份** ＋ **本文件 R-1～R-8 八条**；R-8 为本次执行期追加，已出 Plan 并落地：

| # | 内容 | 载体 | 成熟度 |
|---|---|---|---|
| 1 | 模型请求日志 + 用量统计面板 | `usage-analytics-requirement.md` | 范围已逐条拍定，已分三个 Plan |
| 2 | 更新弹窗尺寸/全屏失效 + 悬浮窗遮挡位置 | `updater-ui-issues.md` | 缺陷已定位，修法已定，待实施与 dev 复测 |
| 3 | 编辑器撤销后选中态残留 | `editor-undo-selection-issue.md` | 缺陷已登记，根因方向已给 |
| 4 | 补位模型（**不可见请求兜底 + 显式配置 + 三级解析**） | 本文件 R-1 | ✅ **已出 Plan**（`plan.md` R-1 节），五条裁定全闭合 |
| 5 | 渠道设置页功能设置全局化 + 选项卡 | 本文件 R-2 | ✅ **已出 Plan**（`plan.md` R-2 节），三条裁定全闭合 |
| 6 | 工具可见性注册期声明"范围:类型" + 核心位 | 本文件 R-3 | ✅ **已出 Plan**（`plan.md` R-3 节，R-3.A～R-3.M，其中 I／J／K／M 是老大 2026-09-12 四条**追加裁定**批），全部裁定闭合，本次范围 = B |
| 7 | 使用指引 + README 拆分 + 关于页／顶栏问号双入口 | 本文件 R-4 | 原始需求，截图能力已实读确认，已出 Plan（`plan.md` R-4 节） |
| 8 | 更新悬浮块支持拖动 + 位置跨重启记住 | 本文件 R-5 | ✅ **2026-09-12 执行期内追加**，两条裁定当场闭合，已出 Plan（`plan.md` R-5 节）并落地 |
| 9 | 提示词按「英文 + 四关」约定清理 | 本文件 R-6 | ✅ **2026-09-12 执行期内追加**，已出 Plan（`plan.md` R-6 节）并落地；人格文档经裁定排除，三项后续项登记在案 |
| 10 | 临时文档归置 `.wishful-claw/notes/` + 项目数据目录隐藏 | 本文件 R-7 | ✅ **2026-09-12 执行期内追加**，三条裁定当场闭合，已出 Plan（`plan.md` R-7 节）并落地 |
| 11 | AI 服务商可选官网地址 + 详情页外部浏览器入口 | 本文件 R-8 | ✅ **2026-09-13 执行期内追加**，已出 Plan（`plan.md` R-8 节，R-8.0～R-8.5 + R-8.C 六条边界）并落地；R-8.5 含内置模型清单刷新与 46 个 preset 全量 bump |
| 12 | **内置服务商懒物化（preset 只读基线化）＋ 内置 id 固定化 ＋ 存量清理** | 本文件 R-9（原误登记为后继需求 S-15；老大 2026-09-13 裁定：**属 28 迭代追加需求，本次不启用 29 迭代**，故提升为 R-9 走正式流程） | ✅ **2026-09-13 追加**，八条口径已当场拍定，**待出 Plan**（`plan.md` R-9 节）。来源即 R-8 讨论中暴露的根本问题：快照语义下「新数据生效」与「保住用户改动」互斥 |
| 13 | **聊天窗执行态渲染体验三修**（吸附卡背景不透明 / 执行中内容高度只增不减 / 定格过程展开限高 70vh） | 本文件 R-10 | ✅ **2026-09-13 执行期内追加**，三条口径与老大讨论当场拍定，已出 Plan（`plan.md` R-10 节，R-10.1～R-10.3 + R-10.C 三条边界） |

> **后继需求见本文件文末「后继需求登记」小节**：行为变更类 S-1～S-3、S-10、S-11（S-4、S-7、S-8 已在本迭代内关闭），记账类 S-5、S-6、S-9——R-3 与 R-2 本次刻意不做，**不得丢失**。

### 从 iter-27 带过来、是否纳入 28 尚未确认

这些是我这边登记的遗留，不是本轮口述需求，**不得默认算进 28**：

- **Plan D 多服务商有限重试后 fallback** —— 设计已写在 `docs/plans/iter-v2-27/plan.md:195-205`，零代码；此前已定"排在模型请求日志之后"。注意与 R-1 不是一件事（见 R-1 的区别说明）。
- **A4 更新端到端未跑完** —— 装机实测只证到"能发现新版、能触发后台下载"，安装确认一步未提及，`docs/progress/v2-iter-27.md` 不得划完成，需回填措辞。
- **桌面验证证据 `evidence/*.png` 未产出** —— `docs/progress/v2-iter-27.md:29`，与 R-4 配图是同一块能力。
- **K0 常量收敛** —— 3 处写死的 TS 字面量（`project-archive-helpers.ts:41`、`memory-files.ts:9`、`codegraph-handlers.ts:170`）。
- **`CodeGraphDataDir.cs:56` 回退未读 `WISHFULCLAW_DATA_DIR`**。
- **Obsidian 独有项**：全局会话无法调用 shell / 临时任务 todo 被限制（2026-09-10，"shell 是否开放需要讨论"），尚未落任何 plan。

上述行号与文件位置来自本会话早前的勘查，本迭代尚未产生代码改动；正式立项时仍须按当时代码复核，不得照抄。

---

## 后继需求登记（R-3 / R-2 本次刻意不做，**不得丢失**）

登记日期：2026-09-11；2026-09-12 追加裁定后逐条复核，同日 **R-3.J（浏览器只经 proxy）落地后再复核一遍**——该批关闭 S-7、并把 S-3 收窄到只剩交互三件与 `unknown@automation` 两点。

**本节开头原写"这六项均为行为变更，本次迭代只做机制、力求零行为变化"，该口径已被老大 2026-09-12 追加裁定作废**（原话："零行为变化是 agent 规划的时候的步骤，并不是必须"）。裁定之后 R-3 实际动了**两批**行为，各自与自己的前态比：

| 批 | 比什么 | 105 格结果 | 出处 |
|---|---|---|---|
| **R-3.I 中心名字表收敛** | 删表前 vs 删表后 | 69 格等价 / **36 格收窄** / 0 放宽 | `plan.md` R-3.I 差异表，36 格逐组有裁定 |
| **R-3.J 浏览器只经 proxy** | R-3.I 之后 vs 现在 | 61 格等价 / **44 格收窄** / 0 放宽 | `plan.md` R-3.J，44 格减项恰为 9 件 `Browser*` |
| **累计（动手前基线 → 现在）** | 未动 R-3 时的金样 vs 现网金样 | **47 格等价 / 58 格收窄 / 0 格放宽**，58 格里共减 64 件不同工具 | 两批格集有 22 格重叠（`36 + 44 − 22 = 58`），故不得把两批数字相加当累计 |

本节记的是**这两批之后仍未做的面**，不是"为守零变化而故意推迟"。每项仍附触发条件与验证口径，接到下一代迭代时**逐条复核当时代码**再立项。

| # | 需求 | 来源 | 为何本次不做 | 本次已留下的接续点 |
|---|---|---|---|---|
| S-1 | **提示词核心集机制 + 名单收窄**——`BuildToolCapability()` 改为收会话上下文、只输出本档可见的**核心**工具，`<tool_calling>` 的 27 类降到核心集规模 | R-3.7 / R-3.10 / R-3.C-bis | 计划原设想"机制本次做、名单用等价现状"，实读后判定**两者在提示词侧不可切分**：要让字节不变只能给函数传一个永远全量的参数，`IsCore` 也停在无人读取的假接线状态 | `IsCore` 字段已按 R-3.1 走通四处注册路径（**已声明、暂无消费方**）；`use_capability` 的 description/`list`/`call` 三载体已同源，核心集落地时只需换 `BuildToolCapability` 一个出口 |
| S-2 | **`global:chat@subagent` 集合收束**——全局 PM 的子 Agent 要不要再收一刀（R-3.F 的"PM 助手不做工作"边界），老大未裁定的一项 | R-3.6② / R-3.D 收窄 6 | 属**产品裁定**，不是遗留机制活：该档现状完全由逐工具声明决定，要再收只需改声明，无需动机制 | **2026-09-12 三次复核（收敛后，修正本行原口径，勿再照抄）**：原写"该档与全局 PM 本体同一套工具、`Edit`/`Write`/`Bash` **仍在**（preset=full 时 30 件）"**两处都不成立**——30 件是 `project:cowork@subagent`／`@goalsubagent` 的数；该格**在 R-3.I 收敛前后逐字节未变**（不在 36 格差异内，写/执行类工具本就带 `*:cowork@*` 形状，把它挡在外面）。**R-3.K+M 前七 preset 实测为 21／16／16／14／12／5／5**（full／chat／coding／channel／automation／minimal／skill-installer），本行早前"全 7 个 preset 都是 21 件"的记法**不成立，以实测为准**。实测构成：读检索 7（`Read`/`Glob`/`Grep`/`LS`/`WebFetch`/`WebSearch`/`codegraph_explore`）＋临时 todo 4（`TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`）＋记忆 5（含 `memory_hot_write`/`memory_append`/`memory_update` 三件写）＋子 Agent 状态 2＋`use_capability`（R-3.M 后**已不含** `AskUserQuestion`/`visualize_show_widget`；该格现为 **19／15／15／13／12／5／5**）。**本项剩余的问题因此只剩一个**：① 这个已无写无执行的全局子 Agent 是否还该持有 todo 与记忆写。② ~~子 Agent 可否直接问人~~ → **已裁定：不可**（老大 2026-09-12：「子 agent 需要排除，因为子 agent 其实类似后台执行」，`plan.md` R-3.M）；`AskUserQuestion`／`visualize_show_widget` 与计划族四件在 4 档子 Agent 全部不可见，金样残留实测 0 |
| S-3 | **后台定时三类排除启用**——`unknown@automation` 下排除 `browser` 类 + 渠道专用工具 + 交互三件 | R-3.D 收窄 5 | **2026-09-12 两条追加裁定后只剩一类**：① **渠道专用工具**——中心表删除后 automation 不再全放行，实测该档少 22 件（`plan.md` R-3.I 差异表组③）；② **`browser` 类**——已随 R-3.J 整体落地（9 件 `Browser*` 在直连侧 105 格零注入、代理侧 `*:*@automation` 被否决）；③ ~~**交互三件仍可见**~~ → **已关闭**（`plan.md` R-3.K + R-3.M：交互两件 + 计划族四件在**全部** `@automation` 格均不可见，金样残留实测 0）。另记一格反直觉现象（R-3.M 后已随整族否决而消失，留作机制笔记）：`ExitPlanMode` 曾只在 `project:cowork@automation` 可见、`global:cowork@automation` 不可见——差在 `availableModes` 轴而非 `VisibleScopes` 轴：它声明 `availableModes:["normal"]`，而 global 档的 `sessionMode` 是 `global`。**即"拦在哪一轴"这个问题在本项上确实出现过**，将来收窄任何工具都须同时想清楚） | 剩余缺口一处，且不必再动机制：① **真实运行里还没有 `unknown@automation` 这一格**——`cron-runtime.ts:485` 发的 scope 仍是 `project`/`global`，要按 R-3.C 6b 的口径收窄须前端发 `scope:"unknown"`。R-3.J **刻意没顺手改**：改了就使该格所有 `*:cowork@*` 声明不再命中、整格形状重排，且与老大「定时任务走的也是 cowork」裁定冲突；后台档现阶段靠 `*:*@automation` 这个 role 后缀区分。② ~~交互三件现声明 `HumanAttended`＝`*:chat@*` + `*:cowork@*`，automation 归一读作 cowork 因而照样命中，要排除须把形状收到 role 粒度~~ → **已由黑名单解决**（R-3.K + R-3.M）：不必收窄白名单形状，加 `ExcludedScopes` 即可，判定代码未动。`unknown` scope 与 `unknown@automation` 串的渲染与匹配均已打通并有测试 |
| S-4 | ~~**显式化 early-return**——`FilterToolDefinitions` 的 `!channelSession && BypassesChatAllowlist(context) ⇒ 原样返回` 短路改为显式声明~~ **【已关闭 2026-09-12】** | R-3.10 / 合规第 4 条 | — | **随中心名单整体删除而落地**（`plan.md` R-3.I）：`BypassesChatAllowlist`、`IndependentRuntimeRoles`、`FilterToolDefinitions` 的原样返回短路三者均已不存在，判定对 105 格每一格都执行。当初记的两处泄漏实测都已收口：① `preset=full` + `project:cowork` 的 22 个渠道专用工具已从该档消失（差异表组①）；② `project:cowork@subagent`／`@goalsubagent` 的 9 个 `Browser*` 同样消失（组②），四载体同源同裁从此对直连侧也成立。**关闭该泄漏带来的 36 格差异全部有裁定出处**，见 R-3.I |
| S-7 | ~~**`browser` 出三处 preset 白名单**（`ToolPreset.cs:53,68,83`）——老大定性浏览器与 MCP 同类，须经 `use_capability` 获取~~ **【已关闭 2026-09-12】** | R-3.8c③ 的后一半 → 老大第二条追加裁定「浏览器工具不属于核心工具，只需要在代理里面能查到使用就行」 | — | **已按裁定落地，实现与证据见 `plan.md` R-3.J**。本行原记的两个障碍都在落地时解决：① "摘这三处 ≠ 只经 proxy"——`full` 档无白名单，故给它补 `DeniedCategories = {"browser"}` 点名拒绝；② 代理侧完全不读 preset，单摘白名单管不到 `use_capability`，故同时把 9 件 `Browser*` 的 `ExcludedScopes` 从 `SubAgentRoles` 加宽为 **`UnattendedRoles`**（含 `*:*@automation`），老大裁"后台执行的不行、子会话不行、在会话里跑的定时任务可以"由这一半表达。**金样实测**：44 格收窄、0 格放宽、减项恰为 9 件 `Browser*`，直连侧 105 格零注入，代理侧三个无人值守后缀归零而有人格仍含 `BrowserNavigate`/`BrowserGetContent` |
| S-8 | ~~`task` 出 `ProxiedCategories`、`goal` 整体进 proxied~~ **已随 R-3.8c①② 落地**；~~剩余的是 `ProxiedBuiltinTools` 里 `list_goals`/`get_goal_history`/`reopen_goal` 三件名字是否可删~~ **【已关闭 2026-09-12】** | R-3.8c①② / R-3.I | — | **名字表已删**：`goal` 整类在 `ProxiedCategories` 内，代理侧"该工具归不归代理管"的判定改为按类别单点 `IsProxiedBuiltinCategory(category)`，`ProxiedBuiltinTools` 零引用点。证据链三步：① 全仓该表仅剩一处读取；② 三件均属 `goal` 类且该类已整类 proxied；③ 调用点在类别未知时本就走 `category is null` 分支，不依赖名字表。`GoalRegressionTests` 按注册表动态推导 goal 条目，删表未失去覆盖 |
| S-10 | **chat 档整条"轻通道"断开**——`send_session_message`（声明 `GlobalSideAndWorkRuns`＝`global:*@*` + `*:cowork@*`）、`update_session_follow_up`（声明 `WorkRunsOnly`＝`*:cowork@*`）对任意 `*:chat` 档均不可见 | R-3.12 派生（`plan.md` R-3.I 遗留登记） | 收敛前该格由 `ProjectChatTools` 名单决定，删表后**声明即裁决**，这一格从"名单没写就等于没有"变成显式硬拦截。**金样实测删表前后逐字节一致**，故非本次引入的回归，是本次把既有事实显式化，因此不当作本次的行为变更记账 | 若老大要"chat 档源会话也能发临时任务 Todo"，改法只有两种：给这两件加 `*:chat@*` 形状（即 `HumanAttended`），或新建一档形状。**当前链路内部自洽**：发信端与收尾端在 chat 档同时不可见，不存在"发得出去但收不了尾"的半截状态。是否要接由老大判定；改动只需碰声明，不碰机制 |
| S-11 | **审批与分派的名字表未随准入一起收敛**——审批 3 张 `HashSet<string>`（`ToolCallProcessor.Approval.cs:19,35,45` = `SubAgentApprovalTools`/`ShellApprovalTools`/`DefaultModeApprovalTools`）＋路由分派 12 张 `*ToolNames` 家族表（含 `SkillManagementTools`）＋5 个 `Allowed*` 入参校验集合 | 老大 2026-09-12 裁定的字面范围 | 裁定说的是**准入判定**这一轴（"工具本身有黑白名单，应用起来"）。审批与分派是另外两轴：**审批问"这次调用要不要人点同意"，分派问"这个工具名交给哪个 executor 跑"**，都与"哪些档能看见"无关，硬塞进 `VisibleScopes` 会串轴 | **不得对外说成"全仓 `HashSet` 已清零"**。准入轴确已清零：`ToolVisibilityPolicy.cs`／`AgentRunContextPolicy.cs` 两文件 `HashSet<string>` **零命中**，proxy 侧仅剩 `ProxiedCategories`（类别表，非名字表）与一处方法内局部去重集合。审批要落到工具自身声明，须新增"审批作用档"字段并连带改审批文案，属新需求；12 张分派表是 `switch` 的等价物、5 个 `Allowed*` 是入参枚举校验，均不建议动 |

另有三项**记账类**（非需求，但须防误认"已生效"）：

| # | 事项 | 来源 | 说明 |
|---|---|---|---|
| S-5 | **5 个字段仍不生效**——`streamingReply` + `allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents` | R-2 裁定 ② → R-2.7 | **R-2 交付后复核（2026-09-12）**：五个全部**无强制执行点**，只被存进 Worker `ConfigStore` 的 `channelSettings`、在设置面板回显，`streamingReply` 与三个 `allow*` 额外在 `/status` 打印并标注 `(not enforced yet)`，`readablePathPrefixes` **连 UI 输入项都没有**。本条只搬家 + 记账，接真须新立需求。**同批搬家的 `shellRequiresApproval` 不在此列**——它是唯一已生效项（见 R-2 裁定 ② 及其修正） |
| S-6 | **`ChannelInstance.tools` 零调用方**——渠道级工具开关整条主进程链已接好，但 **C# 侧零处发起** | R-2 现状勘查 | 与 R-3.9「渠道工具开关接真」直接相关，两项应同批处理。当前渠道工具筛选实际走 `toolPreset + sessionMode`（`AgentLoop.cs:161-168`；收敛后的准入入口是 `AgentRunContextPolicy.cs:131 IsToolAllowed` / `:151 FilterToolDefinitions`，**原引的 `:117-133,176` 已随中心名单删除而失效**） |
| S-9 | **`newSessionDefaultModel` 零消费方**——已声明、有默认值、进 persist 白名单、migrate 补默认，但**全仓无任何读取点** | R-1.5 执行时新发现 | 与裁定 ③ 那四个哑字段同族，但**不在老大点名的四项清单内，故本次未删**。其类型已随 `SessionDefaultModelBinding`（含同样无人读取的 `useGlobalActiveModel`）一并收窄为普通 `ModelBinding`。将来要么接真"新会话默认模型"，要么按裁定 ③ 口径删除，**不得当作已生效功能引用** |

### 独立复审新增（2026-09-12，R-3 专项；来源见 `review_report.md` 末节）

| # | 事项 | 来源 | 现状 | 建议处置 |
|---|---|---|---|---|
| S-12 | **两条"判定之外"的取工具出口**——① IPC `tool/list`（`ToolModule.cs:80-114`）只按 preset 返回 `registry.GetToolDefinitions(preset)`，**不调 `FilterToolDefinitions`**；② `provider/complete`（`ProviderCompletionService.cs:221-253 / 275-300`）把调用方给的 `tools` 数组原样写进 provider 请求体 | 独立复审 F1／F2 | **两条当前都无害**：① 的产物被渲染端 `lib/tools/tool-cache.ts` 缓存后塞进 `agent/run` 的 `tools` 字段，而 **Worker 根本不读该字段**（`AgentRuntimeTools.cs` 零 `tools` 引用，`AgentLoop.cs:168` 从注册表重建；全仓 `grep '"tools"'` 在 agent 路径零命中）；② 的唯一调用方 `lib/prompt-optimizer/optimizer.ts:101` 不传工具 | 改动很小，二选一即可：① 删掉请求里的 `tools` 载荷（连带 `sidecar-mapping.ts:319` 与 `SidecarAgentRunRequest.tools` 类型），或让 `tool/list` 也走 `AgentRunContextPolicy.FilterToolDefinitions`；② 在 `WriteTools*` 前补一次判定，或明确记为"非可见性路径"。**不修则须在文档里写明"`parameters.tools` 是死载荷"**，否则将来有人为省一次注册表遍历而让 Worker 尊重它，旁路立刻变成真漏口 |
| S-13 | ~~**`automation` 档交互三件仍可见——role 粒度缺口（结构性，改声明值解决不了）**~~ **【2026-09-12 当日关闭】** | 独立复审 F3 → 老大同日裁定走黑名单（`plan.md` R-3.K） | **已按裁定落地**：新增 `ToolVisibilityScopes.NoHumanToAnswer`，交互三件各挂 `ExcludedScopes`。金样实测 **105 格 = 97 等价 / 8 收窄 / 0 放宽**，8 格全为 `@automation`（4 preset × 2 档），减项恰为三件。**复审原结论"改声明值解决不了"已作废**——它对"只用白名单"成立，对黑名单不成立：veto 在 `IsVisible` 里排在 grant 之前，不必把 role 枚举进白名单。**当日随即由 R-3.M 扩围收口，两项剩余问题均已裁定**：① `SubmitPlanReview` → **计划族收全族**（四件全挂 veto，不再只挂 `ExitPlanMode`）；② 子 Agent → **需要排除**（老大：「子 agent 其实类似后台执行」），`NoHumanToAnswer` 的角色轴改为直接取 `UnattendedRoles`，展开后 = `*:*@subagent`／`*:*@goalsubagent`／`*:*@automation`／`*:channel@*`。累计收窄 **27 格**、0 放宽，金样 112 行 / **24,557 B**。另记：channel 那一半**本就已被 `HumanAttended` 形状挡住**（`global:channel` 7 格全等价），加进黑名单属冗余但显式的兜底 |
| S-14 | **翻译／宠物 agent 链路与声明语义冲突（死代码里的定时炸弹）** | 独立复审 F4 | 翻译系统提示词明确要求模型调 `Write()`/`Edit()` 写缓冲区（`translate-agent-service.ts:124,149,178,193`），而这两件现声明 `WorkRunsOnly`（`FileWriteTool.cs:24`／`FileEditTool.cs:23`），在 `global:chat@translation` 下**不可见**；改前靠 `IndependentRuntimeRoles` 全放行才通。另有两条渲染端影子清单 `TRANSLATION_TOOLS`（`:21`）／`PET_AGENT_TOOLS`（`pet-agent.ts:65`）同样被 Worker 忽略。目前不炸只因 `setAgentMode` 全仓零调用、宠物无线程入口 | 接真 agent 翻译时须给 `Write`/`Edit` 补 `*:chat@translation` 形状，或把 translation 归到 cowork 档；同时删掉两条影子清单。**`plan.md` R-3.I 里"翻译只需要读+回文本"这句与代码事实不符，已就地更正** |
| S-15 | **【2026-09-13 已提升为 28 迭代追加需求 R-9 —— 老大裁定本次不启用 29 迭代，本行仅留作溯源，接手请直接看 `plan.md` R-9 节与本文件状态小节第 12 项】** 内置服务商懒物化（preset 只读基线化）＋ 内置 id 固定化——内置服务商不再在启动时全量物化成记录；**读**走 `resolveProvider(id)` 回落到 preset 实时合成、永不落盘，只有**用户产生意图**（启用／填 apiKey／改 baseUrl／拨模型开关／设为活跃）的那一刻才物化 | 老大 2026-09-13 R-8 讨论中的派生需求，**不在 28 范围**，建议排 29 迭代 | 现状（R-8 落地后）：`ensureBuiltinPresets()` 把 46 个 preset 全量复制成记录落 `wishful-claw-providers`，且**全部 `enabled: false`**（9 个显式写 false，其余 37 个靠 `?? false`），约 500 个模型对象整份拷贝、零用户意图；`provider-store-helpers.ts:207` 的 `presetVersion >= preset.version ⇒ continue` 使 preset 后续任何改动（含 R-8 新增 `homepage` 这类纯加字段）对老用户**永不生效**，只能靠手工 bump，而 bump 又会连带把用户改过的模型元数据整块覆盖回去——**「新数据生效」与「保住用户改动」在当前快照语义下互斥**，这是 R-8.5 与 R-8.C.1 的同一个根本问题 | **口径已由老大 2026-09-13 当场拍定，六条**：① 内置记录的 `id` = **裸 `builtinId`**（46 个实测已全局唯一：`openai`／`baidu-coding`／`xiaomi-coding`／`stepfun-plan` 等），**不加前缀**；自定义服务商才用 `nanoid()`，两者命名空间天然隔离。② **内置一 preset 一记录**；用户若想再开一个同类服务商（官方 ＋ 中转），走**自定义**路径、自己填 baseUrl 与名称（老大门话："用户可以自己添加更多同样服务商，只是名称不一样"）。③ `builtinId` 字段**保留**，用作「内置／自定义」判定，不要靠 id 字符串猜。④ `createProviderFromPreset` 的 `id: nanoid()` 改为 `id: preset.builtinId`（即把「随机 id 当主键、稳定 builtinId 只当标签」的现行关系倒过来）。⑤ `addProviderFromPreset`（"从模板再添加一条"）当前**零 UI 调用**、是僵尸 API，接手时可直接删。⑥ **改动面前置清单**：`getProviderById`／`getProviderConfigById` 共 20+ 处调用点（`lib/auth/provider-auth*.ts` 9 处、`lib/pet/pet-agent.ts`＋`pet-voice-audio.ts` 3 处、`lib/agent/memory-automation-utils.ts`、`stores/translate-store.ts`、`stores/app-plugin-store.ts`）须统一收口到 `resolveProvider`；store 内 6 个选中态指针（`activeProviderId`／`activeFastProviderId`／`activeImageProviderId`／`activeTranslationProviderId`／`activeSpeechProviderId` ＋ 压缩配置）与 OAuth 账号绑定都引用 provider id，迁移时要把**有用户意图**的记录的 id 由旧 nanoid 换成 `builtinId` 并同步改引用，**无用户意图**的（46 条里绝大多数）在**进入 AI 服务商管理页时专项清理**——老大 2026-09-13 拍定：**启动路径本身已有太多事要处理，故不在 hydration 时做，专项专做**。清理判定：`builtinId` 存在 && `!enabled` && `!apiKey` && `preset.requiresApiKey !== false` && `baseUrl === preset.defaultBaseUrl` && 无 preset 之外的自定义模型 && 未被 6 个选中态指针引用 && 无 OAuth 账号绑定（建议先只上前四条，后四条作保守兜底——保守的代价只是少清几条，激进的代价是丢用户配置）。⚠️ **两条硬约束**：① **删除必须与 `resolveProvider` 回落同批落地**，不得先删后补——列表页现从 `providers[]` 渲染，只删不回落 = 内置服务商从列表消失；② `requiresApiKey: false` 的 5 个 preset（`codex-oauth`／`copilot-oauth`／`lmstudio`／`ollama`／`moonshot.ts:27`）天生没有 apiKey，不排除会被无条件误删，其中 `ollama` 常被改 baseUrl、删了即丢配置。✅ **一条有利性质**：因内置 id 固定为 `builtinId`，删除记录**不会让引用悬空**——`resolveProvider` 回落到 preset 仍可解析，这与现行 nanoid 情形（删了就真找不到）本质不同。**可复用先例**：全局模型库 `managedModels` 已由 `collectBuiltinManagedModels()` 从 preset 实时收集、不落盘，本项等于把同一做法从「模型库」推广到「服务商本身」。⑦ **停掉 `ensureBuiltinPresets` 为内置创建记录**（老大 2026-09-13 拍定，与清理同批做）：该函数卸掉"为内置 preset 创建记录"这一职责后，内置一律走 preset 实时合成、只在**自定义**服务商层面保留原语义。注意这是给启动路径**减负**（少建 46 条记录、少一次全量写盘），不是加东西，与「启动别再加负担」的诉求同向。连带废弃：整个 `presetVersion` 版本闸门（`provider-store-helpers.ts:207` 的 `continue`）随之内化为历史，**以后改 preset 数据不必再 bump version**（R-8.5 那种 46 个全量 bump 不再需要）。⚠️ 前提仍是 `resolveProvider` 回落先落地——列表页数据源须从 `providers[]` 换成 `presets ∪ 自定义记录`，否则内置服务商会整体消失。⑧ **已物化的归用户自己管**（老大 2026-09-13 裁定："已经物化的用户自己管理，快照是旧的还是新的都是用户自己的事情了"）——**不做 model diff、不做覆盖合并**，用户一旦接管即归其所有，我们不再自动更新其清单，也就不存在"覆盖用户改动"的问题。⚠️ **但该裁定有一个必须满足的前提：内置服务商必须可删**。现 `ProviderConfigPanel.tsx:209`（另 `:286` 有同款判断）用 `{!provider.builtinId && ...}` 把内置的删除入口**隐藏**，当前合理（删了下启动会被 `ensureBuiltinPresets` 重建、等于没删），但 ⑦ 停掉创建后语义已变——**「删除内置」＝ 回到未物化态 ＝ 恢复出厂、拿到最新清单**，此入口必须开放，否则用户将永远困在旧快照上、无任何出口。**但该动作不叫「删除」，叫「恢复出厂设置」**——老大原话："如果是内置的，就不叫删除，叫恢复出厂设置，实际上就是删了，只是名称不一样，免得用户觉得我怎么没删掉"。根因：懒物化后内置服务商由 preset 渲染、**永远存在于列表**，点「删除」而条目仍在会直接造成"没删掉"的困惑；「恢复出厂设置」才准确表达"清空我的配置、回到内置默认"这一语义。**删除只属于自定义服务商**。另注：已物化的服务商用户可随时用 `fetchModels` 从 API 拉取最新模型清单自助更新，本项不动 |

> ⚠️ **剩余各项（S-1、S-2、S-3、S-10、S-11）的共同前提**：本次 R-3 交付的是**机制 + 准入面的整体收敛**（`ctxStr` 单点渲染 + 唯一判定入口 + 逐工具 `VisibleScopes`/`ExcludedScopes` 声明 + 四载体同源 + 中心名字表与短路全部删除），但**工具提示词主体本次完全未动**（`BuildToolCapability()` 仍是静态全 27 类，即 S-1）。故下一代迭代接到这五项时，**改动面已被收敛到"只改声明值／提示词组装"**，无需再动机制——R-3.J 是这条结论的现场验证：本批只碰了三处 preset 类别、一个共享声明常量和九个注册点，判定代码一行未改。
>
> **"任一档位逐字节等价"这句话不得再说，且旧数字不得再引用**。金样 105 格＝**7 preset × 15 档**，本迭代之后有三个不同基线的数：
> - **R-3.I 批（删表前后）**：69 格等价 / 36 格收窄 / 0 放宽（`plan.md` R-3.I 差异表）。
> - **R-3.J 批（浏览器前后）**：61 格等价 / 44 格收窄 / 0 放宽，44 格减项恰为 9 件 `Browser*`（`plan.md` R-3.J）。
> - **累计（未动 R-3 的基线 → 现网金样）**：**47 格等价 / 58 格收窄 / 0 格放宽**，58 格里共减 64 件不同工具。
>
> 三组数**都对，但不得互相替换**，也不得把两批相加当累计（两批格集有 22 格重叠：`36 + 44 − 22 = 58`）。算累计**必须先把 `global:chat@automation` 按改名配到 `global:cowork@automation`**，否则键集不平，会凭空多出 7 格"假放宽"（本迭代实测踩过：不配对得到的是 112 格 / 7 格放宽，全是假象）。`plan.md` R-3.H ① 与 S-7 旧行曾记的"97 格等价／8 格差异（4 preset × 两档 chat 子 Agent 各少 6 个 `Browser*`）"**是删表前的中间测量，已被上述三组数取代**。**58 格逐组都有老大裁定出处，不再存在"保留还是回退"的悬置项**；仍悬置的是**验证面**：无人值守三档（宠物／翻译／providerTurn）的 UI 效果本环境无法目视取证，"这些档是否真需要被收掉的工具"须老大实测判定。
>
> 另有一处本次确实变了、但**不在这 105 格内**（金样只快照直连注入的工具名集合）：`use_capability` 的 description 按 R-3.8b 改为按档动态生成（`plan.md` R-3.H ⑤）。
>
> 上述行号来自 2026-09-11 的实读，立项时仍须按当时代码复核。
