# iter-v2-29 原始需求登记

> 2026-09-13 建档。S-16 / S-17 / S-18 三条来自 iter-28 收尾讨论（R-10 期间）派生，原登记于
> `docs/plans/iter-v2-28/raw-requirements.md` 后继需求表；2026-09-13 老大拍板三条**全部排 29 迭代**，
> 本文件为权威需求文档，28 侧仅留溯源行。
> S-19 / S-20 是同日老大**新增口述**的需求，不在 28 的后继表内，直接建在本文件。
> 勘测行号均为 2026-09-13 实读，立项时按当时代码复核；**S-20 属纯登记，尚未做任何代码勘测**，接手时从零核实。
> **S-21** 是 2026-09-14 老大口述「这个列入29迭代的需求」的多服务商限额自动 fallback，来源为知识库
> `issues/改进.md` 2026-09-09 待优化项 + iter-27 Plan D（设计成文、零代码）+ iter-28 两次移交；勘测行号 2026-09-14 实读。
> **S-22 / S-23 / S-24 / S-25** 是 2026-09-14 老大「bugs 和改进项都需要排进 29 迭代」的拍板结果，
> 即知识库同步后 `issues/bugs.md` 与 `issues/改进.md` 的**全部剩余条目**（2 条缺陷 + 2 条改进，S-21 已先登记）。
> 四节勘测行号均为 2026-09-14 实读；其中**断点/根因均为我的推断**，立项时须实测复核后再定口径。

## S-16 输入框长粘贴折叠块（复刻 DeepSeek-Reasonix）

**一句话**：长文本粘贴进输入框不整段展开，折成带标签的可折叠 chip；chip 原文无损保存，提交时替换回全文。

### 背景

老大 2026-09-13 R-10 吸附卡讨论原话「我在想要不要复刻 Reasonix 对粘贴文本的处理」。当次拍定吸附卡紧凑指示条（iter-28 `plan.md` R-10.5，已落地），粘贴折叠留到本迭代。

### 为何 28 不做

吸附卡指示条已解决「执行中当前轮长消息」的展示问题；粘贴折叠属**编辑器输入侧新机制**——undo/redo 栈、caret 管理、per-session 草稿状态都要与折叠块联动，改动面独立。

### Reasonix 实现勘测（2026-09-13）

来源 `D:\claw\DeepSeek-Reasonix\desktop\frontend\src\components\Composer.tsx`：

- 折叠阈值 `LONG_PASTE_MIN_CHARS=2000`／`LONG_PASTE_MIN_LINES=20`（`:98-99`，满足其一即折）
- `PastedBlock{label,text}` 原文无损保留（CRLF 原样）
- chip 标签形如「粘贴 #N · L 行」，带**显示预览／展开回填原文／移除**三操作（`:4402-4429`）
- 提交前 `expandPastedBlocks()` 把标签替换回原文（`:1817`）
- 图片粘贴走附件（`SavePastedImage`），PDF/doc 等二进制粘贴落盘为文件附件
- `pendingPaste` 计数在异步附件处理期间禁提交（`submitBlocked` 含 `pendingPaste > 0`）

### 接手要点

- wishful-claw 输入框在 `FileAwareEditor.tsx` 一族；undo 栈已有 iter-28 `editor-undo-selection-issue.md` 记录的既有问题，折叠块必须与 undo 联动设计（回填/移除是一条 undo 记录还是多条）
- caret 定位按 label 长度换算；展开回填与移除后 caret 的落点要跟 Reasonix 对齐实测

---

## S-17 代理调用状态显示真实工具名

**一句话**：Agent 经 `use_capability` 代理调用工具时，输入框左上角的运行状态条显示被代理的**实际工具**（如 `BrowserNavigate`／`skill:xxx`），而不是 `use_capability` 本身；审批提示文案同口径。

### 背景

老大 2026-09-13 R-10 收尾讨论原话「调用 use_capability 进行工具代理调用的时候写的是 use_capability 本身，我希望这里的状态也是显示被代理的工具」（同日老大更正：状态条位置在**输入框左上角**，首次描述误说为聊天窗左上角）。

### 现状勘测（2026-09-13 实读）

- 状态条文案源：`runtime-status.tsx:191`——`activeToolName` = 最近一条 `running`/`streaming` 工具记录的 `name`；代理调用时记录 name 即 `use_capability`
- 真实工具在该调用的 `arguments.capability_id`（形如 `mcp-tool:server/tool`／`builtin:toolName`／`skill:name`），解析即可得显示名
- 同文件 `:327-331` 审批提示（`pendingApprovalToolName`）同口径要一并改；`:361-365` 执行中文案与 `:411-412` 依赖数组联动

### 接手前要定的口径

- 显示裸工具名还是 `server/tool` 全路径；`action`（list/call）要不要带
- skill 与 mcp-tool 两种 capability_id 形态怎么显示

### 一处分歧要问老大

聊天窗内 `use_capability` 工具卡已被 `execution-outline.ts:111-112` 刻意隐藏（注释「an unresolved use_capability card is noise, so hide it」）——确认卡片与状态条是否统一口径（都显示真实工具名），还是维持卡片隐藏只改状态条。i18n 文案 key 随之补齐。

---

## S-18 右侧面板分支视图（本地/远程分支列表 + 提交图谱）

**一句话**：右侧面板（已有「文件树 / 变更」双 Tab，`layout/AgentFilesPanel.tsx`）增加 Git 分支视角：远程有哪些分支、本地有哪些分支、提交图谱（分支线可视化）。

### 背景

老大 2026-09-13 R-10 收尾讨论原话「右侧面板文件树块，之前增加了文件变更，希望能找位置再可以看分支线，比如远程有哪些分支，本地有哪些分支，有哪些提交的图谱」。

### 现状勘测（2026-09-13 实读）

- 面板落点 = `layout/AgentFilesPanel.tsx`；iter-v2-26 Plan H 已接入「文件树/变更」Tab（`docs/plans/iter-v2-26/plan-changes-panel.md`），分支视图顺势成第三 Tab 或在变更 Tab 内找锚点——**位置取舍由老大定**
- 数据层大半已有：`git:list-branches`（`git-handlers.ts:160`，走 `queryGit`）、`git:create/checkout/merge/rebase-branch`、`git:fetch` 均已注册
- **提交图谱无现成 IPC**——须新增（`git log --graph --all --date-order` 结构化，或按 refs+parents 自行组装拓扑），并考虑挂 `git-cache.ts` 缓存
- 渲染复用 `useGitStore`；图谱绘制无现成组件，SVG 手绘或引依赖（isomorphic-git-graph 类）要选型
- 多仓库工作区场景（`git:scan-repositories` 支持扫描）图谱按单仓库展示，入口层级接手时对齐现有变更 Tab 的仓库选择逻辑

---

## S-19 软件自身界面截图能力 —— 使用指引配图由 Agent 自建

**一句话**：让 Agent 能在应用里截取**软件自身界面**并**落盘到仓库路径**，用来补全 iter-28 R-4 交付的《使用指引》配图；即"指引由 agent 自己建、自己配图"。

### 背景

老大 2026-09-13 授权 28 迭代收尾时的原话：

> 「我需要 29 迭代可以进行软件本身截图，因为我需要补充使用指引中的截图，我希望到时候 agent 自己自建指引这种方式」

这条推翻了 iter-28 当时的判断。iter-28 R-4 把《使用指引》文档骨架、README 拆分、应用内双入口都交付了，但 **R-4.5 配图明确记为"本次不做、且属人类动作"**（`docs/plans/iter-v2-28/plan.md:969` 步骤至今未勾，`verification_report.md` §4 R-4 行记为 PARTIAL），理由是整桌面截图会把别人的窗口和凭据一并拍进公开仓库，"清场只能本人做"。本需求把这件事**从人类专属动作变成 agent 可自助完成的闭环**，因此 29 迭代要交付的是**能力**，不只是那批图。

### iter-28 侧已记录的缺口（接手时的起点，须按当时代码复核）

来源 `docs/plans/iter-v2-28/raw-requirements.md` R-4 段与 `verification_report.md` §4/§5：

- 应用自带 `DesktopScreenshot` 工具**只截主显示器**（返回的 `displayCount` 只是附带信息，不是多屏都截）、**只回 base64 不落盘**，且无窗口/区域入参
- 现成的 `image:persist-generated` 能落文件，但**目录写死在用户 home 下**，指不到仓库路径
- **截图工具无窗口/区域入参**这件事当时被判定"符合预期、不算缺口"（因为老大只要整桌面）；本需求改口径后，它成为**必须先补的主缺口**——只截应用自身窗口才能天然避开别的窗口入镜
- 外部通路也不可用（当时实测，勿重复踩）：`mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (visible=false)`；把 in-app browser 指向 dev 渲染进程 `127.0.0.1:5173` 后 `take_snapshot` 只拿到空 `RootWebArea`，原因是没有 Electron preload 桥、IPC 支撑的界面全空。**浏览器通路不能替代真机**
- 待配图落点清单**已成文**：`docs/user-guide.md` 文末列了 10 处（iter-28 R-4.5 记账），本需求接手时先核对这份清单还差哪些

### 接手时要定的取舍（原话未覆盖，须问老大）

- 截**自身窗口**（干净、无脱敏负担）还是仍**整桌面 + 清场**（能拍到悬浮窗、多窗口关系，但需要脱敏）——两条路的能力面不同，老大这句只点名了"软件本身截图"
- 产物落盘约定：`docs/assets/` 之类的仓库目录、命名规则、以及是否要求与指引里的引用路径单点对应
- 脱敏底线沿用 iter-28 已立口径：**含完整用户路径/凭据的图像不得入公开仓库**（当时据此把启动日志证据排除在库外，见 `verification_report.md` §2 开头）

---

## S-20 自定义服务商无法携带特定请求头（OpenCode Go 会话标识）

**一句话**：部分上游服务商要求请求携带**特定 HTTP 头**来传递会话标识，用户自行创建自定义服务商时满足不了这个要求；29 迭代要解决。

### 背景

老大 2026-09-13 在使用 OpenCode Go 过程中发现，原话：

> 「目前我们使用 OpenCode Go 的过程中发现，这个服务商要求特定的请求头用于传递会话标识，用户自定义创建服务商的时候无法满足这个要求，需要在 29 迭代解决这个问题」

### 登记口径说明

本条**按老大要求只做登记，未做任何代码勘测**（与 S-16~S-19 带实读行号不同，这里没有已核实的事实可引用）。接手时先从零查清三件事，再谈方案：

1. **自定义服务商现在到底能配什么** —— `apiKey`／`baseUrl`／模型清单之外，是否已存在附加请求头字段（有声明无消费方的哑字段也算"不能配"）；各 Provider 实现（Anthropic / OpenAI Chat / Gemini / Vertex）拼 HTTP 请求时有无统一的"额外头"注入口，还是每个 Provider 各写一遍。
2. **这个头是静态值还是动态值** —— 若"会话标识"的值随会话变化，就不能只做成设置页上的一个固定 key-value。三种形态要分清：**固定值**（配置一次）／**每会话一个值**（会话创建时生成或复用）／**每请求一个值**（trace id 类）。取哪种**由第 1 项查出的真实能力面决定，不要先定形态再找落点。**
3. **OpenCode Go 的确切要求** —— 头名称、取值格式、是否还伴随其它必需头。以官方文档或一条真实失败请求为准；**必要时向老大要一份真实报错/请求样例**，别凭印象猜头名。

### 与 iter-28 R-9 的张力（我的理解，待老大确认）

自定义服务商是"官方 preset 覆盖不到的入口"。这个口子堵着，任何要求非标请求头的上游即使用户手里有 baseUrl + apiKey 也**接不进来**，只能等我们把它做成内置 preset——而 iter-28 R-9 刚把内置服务商改成"懒物化、preset 只读基线化"，方向上不希望为单个上游频繁动内置。**故推定本条的方案应偏向"给自定义服务商补通用能力"，而不是"再加一个 preset"。** 这是我的推论不是他说的话，立项时先确认。

---

## S-21 多服务商限额自动 fallback（优先级排行 + 5h/周/429/503 自动切换）

**一句话**：用户可给多个服务商配优先级排行与限额类型；当前服务商触发限额（5 小时限额／周限额／429／503）时**自动降级到下一个服务商继续执行**，且**保持上下文连贯**（同一逻辑请求内切换，不重开会话、不丢已产出的工具结果）。

### 背景

- 知识库 `issues/改进.md` 2026-09-09 待优化项原文：「多服务商限额自动切换：用户可配置优先级排行榜 + 限额类型（5h/周限额/临时限流429/503），限额到时自动fallback到下一个服务商继续执行，保持上下文连贯」；备注「实现方案待定，需设计配额监控+自动降级机制；用户可配置各服务商的限额类型」。
- iter-27 立为 **Plan D**，D1–D5 步骤与涉及文件已成文（`docs/plans/iter-v2-27/plan.md` Plan D 节），**整块未实施**，当时标注「排在模型请求日志之后」。
- iter-28 两次移交：`docs/plans/iter-v2-28/raw-requirements.md:354`「设计已写在 `docs/plans/iter-v2-27/plan.md:195-205`，零代码」；`docs/progress/v2-iter-28.md` 移交项 19「Plan D 多服务商 fallback — 设计成文、零代码」。
- 2026-09-14 老大口述「这个列入29迭代的需求」→ 本文件 S-21 节为权威登记，28 侧与 27 侧仅留溯源。

### 现状勘测（2026-09-14 实读）

- **重试入口单点**：`src/runtime/WishfulClaw.Agent/AgentLoop.cs:324` → `ProviderRetryPolicy.ExecuteAsync(...)`（`provider` 载荷随 `parameters` 传入）。`ProviderRetryPolicy.cs:80` 是唯一包装点；`:201` 判定可重试状态码 = `400 or 429 or statusCode >= 500`；`:59` 默认 10 次、`:65-66` 超 10 次转固定 60s 间隔。
- **重试耗尽即抛错，全仓无跨 provider 切换**：现有策略是「同一 provider 重试到上限 → 抛出」。渲染端 `fallbackProviderId` 的命中（`AssistantMessage/use-completion-summary.ts:73`、`AppPluginPanel.tsx:456`、`ProviderCompletionSettingsPanel.tsx:8`）**都是补位模型／图片模型解析，非本需求语义**，不要误认已实现。
- **Provider 实现只有三种**：`AgentLoop.cs:37` 只接受 `openai-chat` / `anthropic` / `openai-responses`，分派在 `:536` / `:544` / `:549`。⚠️ `AGENTS.md` 写 Anthropic/OpenAI Chat/Gemini/Vertex 四家，**实际无 gemini/vertex 代码**（`grep -rl "gemini\|vertex" src/runtime --include=*.cs` 零命中）——接手时按当时代码复核，勿照抄 AGENTS.md。
- **配置面**：`ProviderConfig`（`src/renderer/src/lib/api/types.ts:447`）已有 `requestMaxRetries`（`:460`，0 = 无限）、`requestTimeoutSeconds`、`baseUrl`、`model` 等；**无任何 priority/order 字段**，provider store 与 preset 亦无（`grep "priority\|order"` 零命中）——优先级排行须新增字段（注意 iter-28 R-9 的 `virtual` 语义：字段加在 preset 上要考虑未物化的内置记录）。
- **执行上下文**：`ExecuteTurnAsync`（`AgentLoop.cs:526`）持有 `parameters / provider / conversation / toolDefs / state / context`——切换 provider 时这些**必须整体复用**，这是"保持上下文连贯"的落点；`AgentLoop.cs:316-330` 的 `while(true)` 外还有一层「上下文超窗 → 压缩重试」逻辑，切换与压缩的先后关系要一并想清楚。
- **与 iter-28 R-1 不是一件事**：R-1 三级解析（显式指定 → 补位模型 → 全局激活模型）解决"这个请求**用哪个模型**"，是**请求前的静态解析**；本需求解决"**同一个请求跑到一半被限额**，换 provider 接着跑"，是**请求内的动态降级**。两者不重叠但在同一条链上相邻，立项时先确认排序关系。

### 接手前要定的口径（Plan D 已有设计，须按当时代码复核）

- **切换粒度与产物处理**：一个逻辑请求 = 一次 provider turn？重试耗尽后切换时，**已产出的流式内容与工具调用怎么处理**（丢弃重放／保留续写）——Plan D D1 已要求"确认不会重复工具调用"，须实测复核。
- **候选集与顺序**：谁进候选（所有 enabled provider？仅同 category？含不含自定义）、排序按用户配置还是按模型能力。
- **限额识别**：5h／周限额目前**无统一响应头或错误体约定**。Plan D D5 已定「配额信息只作可选观测增强；无法统一解析时仍按当前 provider 重试，有限上限耗尽后切换」——须确认是否维持该降级口径。
- **`requestMaxRetries=0`（无限）与 fallback 的关系**：Plan D D3 定「0 保持无限且不切换」。
- **取消语义**：Plan D D3 定「取消立即终止」，切换途中取消须一并终止。
- **人工验证方式**：Plan D D5 已定「至少两个可控测试 Provider/Mock endpoint，禁止依赖真实 API 触发限额」——沿用。

### 建议

**沿用 iter-27 Plan D 的 D1–D5 骨架**（先出调用链与不变式 → 配置面 → 纯状态机 → 接入 Loop → 观测与人工验证），不重开设计；立项时按当时代码复核全部行号，并把「已产出内容与工具结果如何跨 provider 复用」列为第一优先待定项。

---

## S-22 全局任务回报回推渠道后，助理的新消息未推送到微信

**一句话**：全局会话派发 work request → 项目会话完成回报 → 全局助理能收到回报并继续说话，但**它随后发出的新消息没有推送到微信渠道**，用户在微信端看不到。

### 背景

知识库 `issues/bugs.md` 2026-09-13 缺陷条目（🔴 未修复）原文：

> 全局任务派发回报回推渠道时，全局助理能收到项目会话的回报消息，但助理随后发出的新消息未推送到微信渠道，用户收不到
> 复现路径：全局会话派发 work request → 项目会话完成回报 → 助理回复；回报正常送达助理，助理的回复未到微信。日志等级高（Information）无落盘错误，排查时可先降日志等级

2026-09-14 老大拍板「bugs 和改进项都需要排进 29 迭代」→ 登记为 S-22。

### 现状勘测（2026-09-14 实读）

- **回报回推（入）是通的**：`AgentRuntimeGlobalDispatchReplyExecutor.cs:138-191` —— 通过 `AgentRuntimeReverseRequests.RequestAsync`（`:171`）把回报投递回 `sourceSessionId`，并显式写 `sessionMode: "global"`（`:165`）以保住全局身份提示词。`:194` 返回的 `delivered` **只表示"投递回全局会话成功"**，这条路径上**不存在任何渠道外发**。
- **渠道外发是另一条链**：`src/main/channels/auto-reply.ts` → `use-channel-auto-reply.ts:95-147`（`:100` `activeAutoReplies.set(sessionId, ...)`），最终走主进程 `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:148/158` 的 `sendMessage` / `replyMessage`。
- **断点假设（我的推断，非老大原话，须实测复核）**：回报注入让全局会话又跑了一轮，但这轮产生的助手消息**没有触发 `registerExternalChannelReply`**——该注册按 `sessionId` 记（`:128` 解构 `sessionId / pluginId / chatId`），而回报注入的是 `sessionMode:"global"` 的**全局会话**，与渠道会话 id 不是同一个，可能因此匹配不上。⚠️ 也可能只是"这轮新消息根本没走到外发触发点"，两种都要验。
- **排查工具已就绪**：老大备注说"日志等级高（Information）无落盘错误，排查时可先降日志等级"——iter-27 **Plan J** 已把 `setLogMinLevel` 改成可变状态（环境变量 > 持久化设置 > `error`），并新增了设置页日志页 `LogsPanel`（`src/renderer/src/components/settings/LogsPanel.tsx`）与 `log:list-files` / `log:read-file` / `log:cleanup`，可直接降档复现，不用改码。

### 接手要点

- 先**复现再改**：按老大给的复现路径跑一遍，确认是"入通出不通"，并把断点定位到"全局会话这一轮的消息流"上的具体环节
- i18n：若涉及新增错误态/提示文案，按项目既有 key 体系补齐
- 与 iter-27 **Plan C**（全局任务闭环，回报用进程内 `SemaphoreSlim` 串行化 + 终态幂等）相邻，改动时注意别破坏幂等语义

---

## S-23 内置搜索对中文查询失效

**一句话**：Agent 用内置搜索工具查中文内容时拿不到搜索结果，返回的是**词典/翻译类条目**（如查「即梦 免费额度」返回词典结果）。

### 背景

知识库 `issues/bugs.md` 2026-09-13 缺陷条目（🔴 未修复）原文：

> 内置搜索工具对中文查询失效，返回词典类结果而非搜索结果（2026-09-13 素材调研时发现，英文查询未验证是否正常）
> 复现：Agent 使用内置搜索工具查中文内容（如「即梦 免费额度」）→ 返回词典结果；影响调研类任务的信息获取

2026-09-14 老大拍板排 29 → 登记为 S-23。

### 现状勘测（2026-09-14 实读）

- **实现在 Worker 侧直连**：`WebToolProvider.cs:16-26` 注册 `WebSearch`（category `web`，`Everywhere`）；执行落 `AgentRuntimeWebSearchExecutor.cs` + `WebSearchProviders.cs`。
- **八家 provider**：`WebSearchProviders.cs:10`（Google / Bing / Baidu / Tavily / Searxng / Exa / Bocha / Zhipu）。
- **⚠️ 中文失效的最可能根因（推断，须实测复核）**：**语言被硬编码成英文**——
  - Google：`WebSearchProviders.cs:16` URL 带 `hl=en`，请求头 `Accept-Language: en-US,en;q=0.9`（`:20`）
  - Bing：`:39` 同样是 `Accept-Language: en-US,en;q=0.9`
  - **Baidu 是对的**：`:56` 用 `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`
  - 中文查询喂给英文语境的 Google/Bing，极易返回词典/翻译类条目而非搜索结果
- **工具 schema 没有语言/地区入参**：`WebToolProvider.cs:19-25` 只有 `query` 与 `count`，**Agent 无法为中文查询指定中文引擎或语言**——这是"能力面缺口"，不只是 bug。
- **provider 来自配置**：`AgentRuntimeWebSearchExecutor.cs:105-117`，`provider` 空字符串时返回 `null`（即未启用）；`enabled` 默认 `false`（`:110`）。

### 接手前要定的口径

- 是**只修 bug**（让中文查询拿到正常结果），还是**顺带补能力**（给 `WebSearch` 加语言/地区入参，或让 provider 按查询语言自动选引擎）——后者改动面更大，先问老大
- **英文查询是否正常未验证**（老大原话）→ 修复后两种语言都要验
- 若加配置：搜索引擎设置在哪（设置页是否已有联网搜索项？⚠️ iter-13 曾"去掉联网搜索设置项"，`docs/历史` 记为已优化——接手时确认现在还有没有入口）

---

## S-24 用量统计：请求明细上移进选项卡体系

**一句话**：把「请求明细」从图表下方的独立区块**移进现有选项卡体系**（曲线图 / 柱状图 / 统计概览 之外新增一个「请求明细」选项卡），移走后图表高度可以调高，解决当前图表偏矮的错位感。

### 背景

知识库 `issues/改进.md` 2026-09-13 待优化项原文：

> 请求明细目前位置偏低，希望上移：在现有曲线图、柱状图、统计概览基础上增加一个「请求明细」选项卡，把请求明细移入选项卡体系
> 附带收益：请求明细移走后，曲线图/柱状图下方不再被占位，图表本身高度可以调高，解决当前图表偏矮的错位感

⚠️ **优先级信号**：`promotion/抖音发布指南.md`「素材清单」把它列为开工前置，并标注「**建议优先做**」——用量统计页是抖音"成本对比"案例的**账单展示道具**（案例 A 明确要用曲线图/柱状图/请求明细当展示器）。

2026-09-14 老大拍板排 29 → 登记为 S-24。

### 现状勘测（2026-09-14 实读）

- 面板落点 `src/renderer/src/components/settings/UsagePanel.tsx`（iter-28 #1 交付，配套 `UsagePanelParts.tsx` / `usage-detail-table.tsx` / `lib/agent/usage-merge.ts`）。
- **现有选项卡只有三个**：`:33` `type UsageChartTab = 'line' | 'bar' | 'stats'`；`:148` `useState<UsageChartTab>('line')`；`:314-335` 是切换条（`role="tablist"`）；`:337-450` 按 `chartTab` 分支渲染。
- **请求明细在选项卡之外**：`:455-462` 是独立 section（`id="sec-usage-detail"`，title `t('usage.detail.title')`，内含 `UsageDetailTable`）——正是老大说"位置偏低"的那一块。
- **数据加载**：`:165-231` `load(next: UsageRange, detailPage: number)`，明细走 `requestUsageLogs(next, detailPage)`（`:192`），已带 `logsLoadSeq` 防串号（`:161` 注释、`detailSeq` 判定）。移进选项卡要保留这套防串。
- i18n：`usage.detail.*` key 已存在，新增选项卡要补 key（zh/en）。

### 接手要点

- 加 `'detail'` 到 `UsageChartTab` 后，`:337-450` 那一大段分支渲染要跟着补一格，并确认 `stats` / `line` / `bar` 三格不受影响
- 移走后**把图表高度调高**（老大明确要的附带收益），一并做，别只搬位置
- 明细分页/加载态/空态在选项卡内要重新过一遍

---

## S-25 Agent 工作时间线（自动履历）

**一句话**：为 Agent 增加**自动**时间线/进度表——自动记录 Agent 干了哪些事、什么时间做的（派发了什么任务、完成了什么、做了什么决策），用户可随时查看和回溯。

### 背景

知识库 `issues/改进.md` 2026-09-13 待优化项原文：

> 新功能需求：为 Agent 增加自动时间线/进度表——自动记录 Agent 干了哪些事、什么时间做的（如派发了什么任务、完成了什么、做了什么决策），用户可随时查看和回溯。用途：盘点、回溯、进度一目了然
> 类似「Agent 工作履历」，**自动记录而非手动维护**

2026-09-14 老大拍板排 29 → 登记为 S-25。

### 现状勘测（2026-09-14 实读）

- **没有统一的事件/时间线表**，原始素材**散落在多张既有表**（`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` 的 `CREATE TABLE`）：

  | 表 | 行号 | 能提供什么 |
  |---|---|---|
  | `goal_events` | `:266` | Goal 编排事件 |
  | `global_tasks` / `global_task_dispatches` | `:394` / `:408` | 全局任务派发与回报 |
  | `tasks` | `:348` | 会话临时 todo |
  | `session_follow_ups` | `:366` | 倒计时的延迟查询 |
  | `cron_runs` | `:252` | 定时任务执行 |
  | `sub_agent_runs` | `:125` | 子 Agent 运行 |
  | `goal_execution_runs` | `:239` | Goal 执行轮次 |
  | `session_compaction_snapshots` | `:295` | 压缩节点 |

- **先例可循**：「编排记录可视化」是 iter-19 做过的（`GoalHistoryPanel` + `goal_plan_tasks` 表）——但那**只覆盖 Goal 模式**，不是全 Agent 口径。
- **与相邻能力的边界要划清**（立项时先定，否则容易做成第四份重复数据）：
  - ≠ `request_usage_logs`（用量日志）：那是**模型请求/计费**维度（token / 成本 / 重试次数），与「Agent 干了什么」的业务语义无关，**不作为时间线素材**（2026-09-14 老大点名纠正，勿再并入）
  - ≠ 会话 Todo（`tasks`）：todo 是**计划**，时间线是**已发生的事实**
  - ≠ 消息历史：消息是原始流，时间线是**提炼后的条目**

### 接手前要定的口径

- **记录粒度**：工具调用级 / 单轮级 / "决策"级（老大举例是"派发了什么任务、完成了什么、做了什么决策"，偏**决策级**）——这条不定就没法定表结构
- **新建一张统一事件表，还是做成跨表现有数据的聚合视图**？前者要定写入埋点（多点侵入），后者零写入但查询复杂
- **作用域**：按会话？按项目？跨项目的全局时间线要不要
- **保留策略**：若选择新建事件表，**落库的同时就须定保留/清理策略**（按条数或按天），不要等数据量涨起来再补
- **落点 UI**：右侧面板新 Tab？设置页新面板？独立入口？参考 S-18 也要在右侧面板找位置，两者可能要一起规划布局
