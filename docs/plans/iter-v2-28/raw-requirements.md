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

## 状态：iter-28 范围已确认（2026-09-11）

老大原话：

> 28迭代目前就是准备做这些了。

范围 = **已立项/已确认范围的三份** ＋ **本文件四条**：

| # | 内容 | 载体 | 成熟度 |
|---|---|---|---|
| 1 | 模型请求日志 + 用量统计面板 | `usage-analytics-requirement.md` | 范围已逐条拍定，已分三个 Plan |
| 2 | 更新弹窗尺寸/全屏失效 + 悬浮窗遮挡位置 | `updater-ui-issues.md` | 缺陷已定位，修法已定，待实施与 dev 复测 |
| 3 | 编辑器撤销后选中态残留 | `editor-undo-selection-issue.md` | 缺陷已登记，根因方向已给 |
| 4 | 补位模型（**不可见请求兜底 + 显式配置 + 三级解析**） | 本文件 R-1 | ✅ **已出 Plan**（`plan.md` R-1 节），五条裁定全闭合 |
| 5 | 渠道设置页功能设置全局化 + 选项卡 | 本文件 R-2 | ✅ **已出 Plan**（`plan.md` R-2 节），三条裁定全闭合 |
| 6 | 工具可见性注册期声明"范围:类型" + 核心位 | 本文件 R-3 | ✅ **已出 Plan**（`plan.md` R-3 节，R-3.A～R-3.G），全部裁定闭合，本次范围 = B |
| 7 | 使用指引 + README 拆分 + 关于页／顶栏问号双入口 | 本文件 R-4 | 原始需求，截图能力已实读确认，未出 Plan |

> **后继需求见本文件文末「后继需求登记」小节**（S-1～S-4 行为变更、S-5～S-6 记账类）——R-3 与 R-2 本次刻意不做，**不得丢失**。

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

登记日期：2026-09-11。来源：R-3 的 **B 口径（两步走）** 与 R-2 裁定 ② 的记账要求。
**这六项均为"行为变更"，本次迭代只做机制、保持零行为变化，故顺延为后继需求。** 每项都附了触发条件与验证口径，接到下一代迭代时**逐条复核当时代码**再立项。

| # | 需求 | 来源 | 为何本次不做 | 本次已留下的接续点 |
|---|---|---|---|---|
| S-1 | **提示词核心集机制 + 名单收窄**——`BuildToolCapability()` 改为收会话上下文、只输出本档可见的**核心**工具，`<tool_calling>` 的 27 类降到核心集规模 | R-3.7 / R-3.10 / R-3.C-bis | 计划原设想"机制本次做、名单用等价现状"，实读后判定**两者在提示词侧不可切分**：要让字节不变只能给函数传一个永远全量的参数，`IsCore` 也停在无人读取的假接线状态 | `IsCore` 字段已按 R-3.1 走通四处注册路径（**已声明、暂无消费方**）；`use_capability` 的 description/`list`/`call` 三载体已同源，核心集落地时只需换 `BuildToolCapability` 一个出口 |
| S-2 | **`global:chat@subagent` 集合收束**——全局 PM 的子 Agent 显式继承全局限制，不再由名字白名单兜 | R-3.6② / R-3.D 收窄 6 | 属新增的行为收窄 | 现状**已被 `GlobalChatTools` 拦着**（`subagent` 不在 `IndependentRuntimeRoles`，chat 档走白名单），故本项是"把既有拦截换成声明"，风险低于原估计 |
| S-3 | **后台定时三类排除启用**——`unknown@automation` 下排除 `browser` 类 + 渠道专用工具 + 交互三件 | R-3.D 收窄 5 | 现状该档走 `runtimeRole:"automation"` 全放行，启用即首次收窄 | 三件交互工具已在 `ToolVisibilityPolicy.ChannelExcludedTools` 单点定义、可直接复用；`browser` × 后台角色的排除谓词已就位；`unknown` scope 与 `unknown@automation` 串的渲染与匹配均已打通并有测试 |
| S-4 | **显式化 early-return**——`FilterToolDefinitions` 的 `!channelSession && BypassesChatAllowlist(context) ⇒ 原样返回` 短路改为显式声明 | R-3.10 / 合规第 4 条 | 会让 cowork/goal/automation 首次开始被拦 | **该短路是现存泄漏点的唯一成因**：`preset=full` + `project:cowork` 实测可见 22 个渠道专用工具（无渠道上下文时发了也没有落点）。修它必须先出 91 格差异表，`visibility-snapshot.expected.txt` 就是那张表的机器版 |
| S-7 | **`browser` 出三处 preset 白名单**（`ToolPreset.cs:53,68,83`）——老大定性浏览器与 MCP 同类，须经 `use_capability` 获取 | R-3.8c③ 的后一半 | 快照实测：摘掉后 chat/coding 档各少 6 个直接工具，属能力面变更 | 前置本次已铺好：`browser` 已进 `ProxiedCategories`，`ToolVisibilityPolicy` 已有 `browser` × 后台角色的排除谓词。曾按此改 `ToolPreset.cs`，被 91 格快照拦下后**已整体回滚**，该文件现与 HEAD 一致 |
| S-8 | ~~`task` 出 `ProxiedCategories`、`goal` 整体进 proxied~~ **已随 R-3.8c①② 落地**；剩余的是 `ProxiedBuiltinTools` 里 `list_goals`/`get_goal_history`/`reopen_goal` 三件名字是否可以删（`goal` 已整类 proxied，名字清单疑似冗余） | R-3.8c①② | 删名字表属行为变更：需先确认三件在 `goal` 类的 `availableModes` 下确实仍被枚举出来 | `GoalRegressionTests` 已改为按注册表动态推导 goal 条目，删了不会静默失去覆盖 |

另有两项**记账类**（非需求，但须防误认"已生效"）：

| # | 事项 | 来源 | 说明 |
|---|---|---|---|
| S-5 | **4 个 `allow*` 权限字段仍不生效**——`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents` | R-2 裁定 ② → R-2.7 | 四个全部**无强制执行点**（三个仅在 `/status` 打印、`readablePathPrefixes` 连读取点都没有）。本次**只搬家 + 记账**。**`allowShell` 不在其列**——它本次接真并改写为"是否需用户授权"（见 R-2 裁定 ②） |
| S-6 | **`ChannelInstance.tools` 零调用方**——渠道级工具开关整条主进程链已接好，但 **C# 侧零处发起** | R-2 现状勘查 | 与 R-3.9「渠道工具开关接真」直接相关，两项应同批处理。当前渠道工具筛选实际走 `toolPreset + sessionMode`（`AgentLoop.cs:166-168`、`AgentRunContextPolicy.cs:117-133,176`） |

> ⚠️ **S-1～S-4、S-7、S-8 的共同前提**：本次 R-3 交付的是**机制**（`ctxStr` 单点渲染 + 唯一判定入口 + `VisibleScopes` 声明 + 三载体同源），**任一档位的可见工具集合已用 91 格快照证明逐字节等价于改动前**（`plan.md` R-3.H ①）。提示词内容本次**完全未动**（`BuildToolCapability()` 仍是静态全 27 类）。收窄全部顺延，故下一代迭代接到这六项时，**改动面已被本次收敛到"只改声明/名单值/提示词组装"**，无需再动机制。
>
> 上述行号来自 2026-09-11 的实读，立项时仍须按当时代码复核。
