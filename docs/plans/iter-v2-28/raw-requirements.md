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

登记日期：2026-09-11；2026-09-12 追加裁定后逐条复核。来源：R-3 的 **B 口径（两步走）**、R-2 裁定 ② 的记账要求，以及 R-3.I（中心名单收敛）那一批实测新登记的 S-10／S-11。

**本节开头原写"这六项均为行为变更，本次迭代只做机制、力求零行为变化"，该口径已被老大 2026-09-12 追加裁定作废**（原话："零行为变化是 agent 规划的时候的步骤，并不是必须"）。收敛那一批因此**实际改变了行为**：105 格快照 = **69 格逐字节等价 / 36 格收窄 / 0 格放宽**，36 格逐组有裁定出处（差异表在 `plan.md` R-3.I）。本节记的是**那之后仍未做的面**，不是"为守零变化而故意推迟"。每项仍附触发条件与验证口径，接到下一代迭代时**逐条复核当时代码**再立项。

| # | 需求 | 来源 | 为何本次不做 | 本次已留下的接续点 |
|---|---|---|---|---|
| S-1 | **提示词核心集机制 + 名单收窄**——`BuildToolCapability()` 改为收会话上下文、只输出本档可见的**核心**工具，`<tool_calling>` 的 27 类降到核心集规模 | R-3.7 / R-3.10 / R-3.C-bis | 计划原设想"机制本次做、名单用等价现状"，实读后判定**两者在提示词侧不可切分**：要让字节不变只能给函数传一个永远全量的参数，`IsCore` 也停在无人读取的假接线状态 | `IsCore` 字段已按 R-3.1 走通四处注册路径（**已声明、暂无消费方**）；`use_capability` 的 description/`list`/`call` 三载体已同源，核心集落地时只需换 `BuildToolCapability` 一个出口 |
| S-2 | **`global:chat@subagent` 集合收束**——全局 PM 的子 Agent 要不要再收一刀（R-3.F 的"PM 助手不做工作"边界），老大未裁定的一项 | R-3.6② / R-3.D 收窄 6 | 属**产品裁定**，不是遗留机制活：该档现状完全由逐工具声明决定，要再收只需改声明，无需动机制 | **2026-09-12 三次复核（收敛后，修正本行原口径，勿再照抄）**：原写"该档与全局 PM 本体同一套工具、`Edit`/`Write`/`Bash` **仍在**（preset=full 时 30 件）"**两处都不成立**——30 件是 `project:cowork@subagent`／`@goalsubagent` 的数；本档**全 7 个 preset 都是 21 件**，且**收敛前后逐字节未变**（该格不在 36 格差异内，写/执行类工具本就带 `*:cowork@*` 形状，把它挡在外面）。实测 21 件构成：读检索 7（`Read`/`Glob`/`Grep`/`LS`/`WebFetch`/`WebSearch`/`codegraph_explore`）＋临时 todo 4（`TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate`）＋记忆 5（含 `memory_hot_write`/`memory_append`/`memory_update` 三件写）＋子 Agent 状态 2＋`AskUserQuestion`/`visualize_show_widget`/`use_capability`。**本项剩余的问题因此只有两个**：① 这个已无写无执行的全局子 Agent 是否还该持有 todo 与记忆写；② **子 Agent 可否直接问人**——`AskUserQuestion` 在 4 档子 Agent（`project:chat@subagent`/`project:cowork@subagent`/`global:chat@subagent`/`@goalsubagent`）全可见，老大仅裁定过浏览器，未裁过交互件 |
| S-3 | **后台定时三类排除启用**——`unknown@automation` 下排除 `browser` 类 + 渠道专用工具 + 交互三件 | R-3.D 收窄 5 | **2026-09-12 追加裁定后只剩两类的一半**：中心表删除后 automation 不再全放行，实测该档已少 22 件渠道专用工具；**浏览器与交互件仍可见**（金样 `full` 档实测：9 个 `Browser*` 全在；`AskUserQuestion`/`visualize_show_widget` 在每一格 automation 均可见。`ExitPlanMode` 只在 `project:cowork@automation` 可见、`global:cowork@automation` 不可见——差在 `availableModes` 轴而非 `VisibleScopes` 轴：它声明 `availableModes:["normal"]`，而 global 档的 `sessionMode` 是 `global`。**故本项若要接真，须同时想清楚拦在哪一轴**） | 剩余缺口有两处，都不必再动机制：① **真实运行里还没有 `unknown@automation` 这一格**——`cron-runtime.ts:485` 发的 scope 仍是 `project`/`global`，要按 R-3.C 6b 的口径收窄须前端发 `scope:"unknown"`；② 交互三件现声明 `HumanAttended`＝`*:chat@*` + `*:cowork@*`，automation 归一读作 cowork 因而**照样命中**，要排除须把形状收到 role 粒度（如 `*:cowork@sessionagent`）。`unknown` scope 与 `unknown@automation` 串的渲染与匹配均已打通并有测试 |
| S-4 | ~~**显式化 early-return**——`FilterToolDefinitions` 的 `!channelSession && BypassesChatAllowlist(context) ⇒ 原样返回` 短路改为显式声明~~ **【已关闭 2026-09-12】** | R-3.10 / 合规第 4 条 | — | **随中心名单整体删除而落地**（`plan.md` R-3.I）：`BypassesChatAllowlist`、`IndependentRuntimeRoles`、`FilterToolDefinitions` 的原样返回短路三者均已不存在，判定对 105 格每一格都执行。当初记的两处泄漏实测都已收口：① `preset=full` + `project:cowork` 的 22 个渠道专用工具已从该档消失（差异表组①）；② `project:cowork@subagent`／`@goalsubagent` 的 9 个 `Browser*` 同样消失（组②），四载体同源同裁从此对直连侧也成立。**关闭该泄漏带来的 36 格差异全部有裁定出处**，见 R-3.I |
| S-7 | **`browser` 出三处 preset 白名单**（`ToolPreset.cs:53,68,83` = `chat`/`coding`/`channel` 三档的 `AllowedCategories`）——老大定性浏览器与 MCP 同类，须经 `use_capability` 获取 | R-3.8c③ 的后一半 | 收敛后重测（2026-09-12 金样）：摘掉后这**三档各少 6～9 个直接工具**，且**每档 15 格里 11 格受影响**（4 格子 Agent 已是 0，被 `SubAgentRoles` 否决先命中）。属能力面变更，未见老大"现在就摘"的指令 | `browser` 已在 `ProxiedCategories`，故摘后仍可经 `use_capability` 取到。**⚠️ 摘这三处 ≠ 浏览器只经 proxy**：`full` 档 `AllowedCategories = null`（全类别放行），摘后该档仍留 6～9 个 `Browser*` 直连（11/15 格），要彻底只经 proxy 须连 `full` 的口径一起定。**本行原记的接续点"`ToolVisibilityPolicy` 已有 `browser` × 后台角色的排除谓词"已失效**——中心谓词随 R-3.I 删除，现状是 9 件 `Browser*` 各自声明 `Everywhere` + `ExcludedScopes = SubAgentRoles`。曾按此改 `ToolPreset.cs`，被快照拦下后**已整体回滚**，该文件现与 HEAD 一致 |
| S-8 | ~~`task` 出 `ProxiedCategories`、`goal` 整体进 proxied~~ **已随 R-3.8c①② 落地**；~~剩余的是 `ProxiedBuiltinTools` 里 `list_goals`/`get_goal_history`/`reopen_goal` 三件名字是否可删~~ **【已关闭 2026-09-12】** | R-3.8c①② / R-3.I | — | **名字表已删**：`goal` 整类在 `ProxiedCategories` 内，代理侧"该工具归不归代理管"的判定改为按类别单点 `IsProxiedBuiltinCategory(category)`，`ProxiedBuiltinTools` 零引用点。证据链三步：① 全仓该表仅剩一处读取；② 三件均属 `goal` 类且该类已整类 proxied；③ 调用点在类别未知时本就走 `category is null` 分支，不依赖名字表。`GoalRegressionTests` 按注册表动态推导 goal 条目，删表未失去覆盖 |
| S-10 | **chat 档整条"轻通道"断开**——`send_session_message`（声明 `GlobalSideAndWorkRuns`＝`global:*@*` + `*:cowork@*`）、`update_session_follow_up`（声明 `WorkRunsOnly`＝`*:cowork@*`）对任意 `*:chat` 档均不可见 | R-3.12 派生（`plan.md` R-3.I 遗留登记） | 收敛前该格由 `ProjectChatTools` 名单决定，删表后**声明即裁决**，这一格从"名单没写就等于没有"变成显式硬拦截。**金样实测删表前后逐字节一致**，故非本次引入的回归，是本次把既有事实显式化，因此不当作本次的行为变更记账 | 若老大要"chat 档源会话也能发临时任务 Todo"，改法只有两种：给这两件加 `*:chat@*` 形状（即 `HumanAttended`），或新建一档形状。**当前链路内部自洽**：发信端与收尾端在 chat 档同时不可见，不存在"发得出去但收不了尾"的半截状态。是否要接由老大判定；改动只需碰声明，不碰机制 |
| S-11 | **审批与分派的名字表未随准入一起收敛**——审批 3 张 `HashSet<string>`（`ToolCallProcessor.Approval.cs:19,35,45` = `SubAgentApprovalTools`/`ShellApprovalTools`/`DefaultModeApprovalTools`）＋路由分派 12 张 `*ToolNames` 家族表（含 `SkillManagementTools`）＋5 个 `Allowed*` 入参校验集合 | 老大 2026-09-12 裁定的字面范围 | 裁定说的是**准入判定**这一轴（"工具本身有黑白名单，应用起来"）。审批与分派是另外两轴：**审批问"这次调用要不要人点同意"，分派问"这个工具名交给哪个 executor 跑"**，都与"哪些档能看见"无关，硬塞进 `VisibleScopes` 会串轴 | **不得对外说成"全仓 `HashSet` 已清零"**。准入轴确已清零：`ToolVisibilityPolicy.cs`／`AgentRunContextPolicy.cs` 两文件 `HashSet<string>` **零命中**，proxy 侧仅剩 `ProxiedCategories`（类别表，非名字表）与一处方法内局部去重集合。审批要落到工具自身声明，须新增"审批作用档"字段并连带改审批文案，属新需求；12 张分派表是 `switch` 的等价物、5 个 `Allowed*` 是入参枚举校验，均不建议动 |

另有三项**记账类**（非需求，但须防误认"已生效"）：

| # | 事项 | 来源 | 说明 |
|---|---|---|---|
| S-5 | **5 个字段仍不生效**——`streamingReply` + `allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents` | R-2 裁定 ② → R-2.7 | **R-2 交付后复核（2026-09-12）**：五个全部**无强制执行点**，只被存进 Worker `ConfigStore` 的 `channelSettings`、在设置面板回显，`streamingReply` 与三个 `allow*` 额外在 `/status` 打印并标注 `(not enforced yet)`，`readablePathPrefixes` **连 UI 输入项都没有**。本条只搬家 + 记账，接真须新立需求。**同批搬家的 `shellRequiresApproval` 不在此列**——它是唯一已生效项（见 R-2 裁定 ② 及其修正） |
| S-6 | **`ChannelInstance.tools` 零调用方**——渠道级工具开关整条主进程链已接好，但 **C# 侧零处发起** | R-2 现状勘查 | 与 R-3.9「渠道工具开关接真」直接相关，两项应同批处理。当前渠道工具筛选实际走 `toolPreset + sessionMode`（`AgentLoop.cs:161-168`；收敛后的准入入口是 `AgentRunContextPolicy.cs:131 IsToolAllowed` / `:151 FilterToolDefinitions`，**原引的 `:117-133,176` 已随中心名单删除而失效**） |
| S-9 | **`newSessionDefaultModel` 零消费方**——已声明、有默认值、进 persist 白名单、migrate 补默认，但**全仓无任何读取点** | R-1.5 执行时新发现 | 与裁定 ③ 那四个哑字段同族，但**不在老大点名的四项清单内，故本次未删**。其类型已随 `SessionDefaultModelBinding`（含同样无人读取的 `useGlobalActiveModel`）一并收窄为普通 `ModelBinding`。将来要么接真"新会话默认模型"，要么按裁定 ③ 口径删除，**不得当作已生效功能引用** |

> ⚠️ **剩余各项（S-1、S-2、S-3、S-7、S-10、S-11）的共同前提**：本次 R-3 交付的是**机制 + 准入面的整体收敛**（`ctxStr` 单点渲染 + 唯一判定入口 + 逐工具 `VisibleScopes`/`ExcludedScopes` 声明 + 四载体同源 + 中心名字表与短路全部删除），但**工具提示词主体本次完全未动**（`BuildToolCapability()` 仍是静态全 27 类，即 S-1）。故下一代迭代接到这六项时，**改动面已被收敛到"只改声明值／提示词组装"**，无需再动机制。
>
> **"任一档位逐字节等价"这句话不得再说，且旧数字不得再引用**。2026-09-12 收敛后重跑（口径见 `plan.md` R-3.I）：**105 格 = 7 preset × 15 档，其中 69 格逐字节等价、36 格收窄、0 格放宽**。本节与 `plan.md` R-3.H ① 曾记的"97 格等价／8 格差异（4 preset × 两档 chat 子 Agent 各少 6 个 `Browser*`）"**是收敛前的中间测量，已被上述数字取代**——那 8 格只是当年被短路绕过的一半，收敛后子 Agent 浏览器差异变成组② 的 8 格 × `project:cowork@subagent`／`@goalsubagent`（各少 9 个）。**36 格逐组都有老大裁定出处，不再存在"保留还是回退"的悬置项**；仍悬置的是**验证面**：无人值守三档（宠物／翻译／providerTurn）的 UI 效果本环境无法目视取证，"这些档是否真需要被收掉的工具"须老大实测判定。
>
> 对账时注意一格改名：老大裁定「定时任务走的也是 cowork」后 `RenderContext` 把 `runtimeRole=="automation"` 归一读作 cowork，故该格标签由 `global:chat@automation` 变为 `global:cowork@automation`。比对须按此改名配对，否则 105 格键集不相等、会凭空多出 7 格差异。另有一处本次确实变了、但不在这 105 格内：`use_capability` 的 description 按 R-3.8b 改为按档动态生成（R-3.H ⑤）。
>
> 上述行号来自 2026-09-11 的实读，立项时仍须按当时代码复核。
