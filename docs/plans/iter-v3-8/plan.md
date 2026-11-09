# v3-iter-8（产品 1.0.8）—— 先清垃圾，再合规，后治内存

> 分支：`dev/v3-iter-8`（base = `86166fd4`，= v1.0.7 发布记录提交，即最新 `main`；tag `v1.0.7` → `02ae848b`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.8`（开工时 `package.json` 是 `1.0.7`，收尾时改），tag `v1.0.8`。
> 状态：**实施中**（2026-11-05 14:49 老大「开新迭代」；14:56 追加 S-321 插为刀 0；15:04 追加内存三条；15:14 内存三条从一张合单拆为 **S-322 / S-323 / S-324** 三个独立编号 —— 老大：「你刚刚直接登记三个也行啊 突然搞个abc干啥」；S-327 刀 9~15 已于 18:2x 全部落地；08:23 只读审查登记 **S-328 ~ S-332** 五条（Agent 层手写 SQL / 超 500 行缺标记 / 4 具遗骸 + 1 个空壳 / 文档 4 处路径失效 / renderer 8 处 console.log），老大裁定**全部本迭代做**，刀序从刀 16 起，见 §二·补 2；刀 16（S-331）、刀 17（S-332，`c471d849`）、刀 18（S-330，`afdc8335`）、刀 19（S-329，`b5434cb9`）已落地；**刀 20~22 作废** —— 三个大文件的豁免复核全部成立，不该拆；剩余刀 23~29 = S-328 SQL 收口，**已全部落地**（刀 23 `0938f296` / 24 `b1e96a3e` / 25 `7b989c9f` / 26 `17fa7b1f` / 27 `6c384423` / 28 `c6ae3c14` / 29 见日志）。**全 Agent 层 SQL 字面量已归零**（9 张表 30 处清完），判据写进 `AGENTS.md` §6。**10:0x 欠账普查再登记 S-339 ~ S-344 六条**（死代码 26 文件 2,460 行 / 空壳组件 / 空实现 / 大小写重名 / 文档 GBK 混杂 / 主进程 console.log），见 §二·补 3；**其中 S-339（刀 30 `78663ed2`）/ S-343（刀 31）已在 10:3x 修完**；**10:1x 老大「都归属本迭代哦，本迭代是昨天下午才剥离的」** ⇒ 余四条**全部本迭代做完**（刀 32 S-344 `e63b01af` / 刀 33 S-341 `096a94f0` / 刀 34 S-340 `01f9e304`+`ece70216`+`5731c636`+`a941c9e2`+`7f9093ec` / 刀 35 S-342 `6b501efb`）。**11:0x 二轮普查再登记 S-345 ~ S-347 三条**（浏览器工具判据空桩 / 图片重试按钮空实现 / S-340 漏网死代码），见 §二·补 5，刀 36~38，**全部本迭代**；**三条已于 11:1x ~ 11:5x 全部落地**（刀 36 S-345 `6da8fe02` / 刀 37 S-346 `389bf5c0` / 刀 38 S-347 `43b4e656`）。**S-346 处置方向在实施时按「有没有通道」自行判定，结论是「没通道」⇒ 全删**（见 S-346 §六）。**底数纠错**：审查报「12 个超 500 行无标记」实为 6 个，根因是扫描只认中文漏了英文 `500-line exemption`，已记入 S-329 §4.1）；**09:0x 老大「328 你要是觉得过于复杂了，可以拆分成多个需求」** ⇒ S-328 拆为 **S-333 / S-334 / S-335 / S-337 / S-338 + 收尾 S-336** 六个编号，刀序改为 23~29（刀 23 = S-335 首刀立样板，刀 29 = S-336 族尾删重复 SQL）。**拆分时又发现两处口径错**：S-328 真实是 **9 张表 30 处 / 9 个文件**（登记报 7 表 12 处 5 文件），且第一次机器扫用了不区分大小写的 `-match` 把 `multi-select questions` 当命中 —— 见 S-328 §0.1）。
> 门禁基线（沿用 v3-iter-7 收尾实测）：`npm run typecheck` 三配置 0 错｜`npm test` **125/125**｜`dotnet build` 两套 sln（`-t:Rebuild`）—— 主 sln 2 警告（均为已挂账 S-320 的 `NU1903`）/ 0 错误，测试 sln 0/0。
> 前置：v1.0.7 已双面发布，是**最后一个带 WorkBuddy 的公开版**。

## 一、本迭代的定位

**三件事：两件减法，一件治本。**

**S-321 清死代码（刀 0）** —— 从 OpenCowork 整目录搬来、只搬到 lib 层没搬 UI 与主进程层的那批：宠物 1261 行、翻译约 790 行、12 条通道白名单残留。它们不只是占地方，还会**误导判断** —— 我自己就踩着它差点给 S-318 写出一套不必要的兼容逻辑。

**S-318 合规清理（刀 1 ~ 刀 5）** —— 公开仓 `wishful-claw` 里有 5 个 preset 做的是同一件事：**用用户自己的账号订阅、冒充官方客户端身份**去走厂商只对自家客户端开放的 OAuth 通道。额度是用户自己的，但绕开了「只允许官方客户端使用」的限制。个人违反服务协议最坏是封号；做成产品对外分发是另一个量级 —— 老大 11-05 09:47 原话「如果我去抖音推广大家使用，有这个功能的话，会被腾讯这些直接告」。

已发出的 v1.0.0 ~ v1.0.7 二进制删不掉，只能靠后续版本自然淘汰。本迭代负责的只有一件事：**从 v1.0.8 起公开面干净，且以后修 provider bug 时带不回来。**

**内存治本三条（刀 6 ~ 刀 8，S-322 / S-323 / S-324）** —— 私有仓 `D:\claw\wishful-work` 11-04~11-05 的内存专项推翻了「大头在渲染层」这个前提：renderer 可回落到 252 MB，而 **worker 托管堆 1060 MB 是稳态、只增不减**。主仓过去几个迭代（极简模式、虚拟列表、剥 base64、拆表）都建在那个被推翻的前提上。

三条 **各自独立编号**（一张单里写 A/B/C 不好溯源）：

| 编号 | 一句话 | 性质 |
|---|---|---|
| **S-322** | `SessionConversationManager` 永不淘汰 ⇒ 发过消息的会话各留一份完整 wire 副本（含图片 base64）到进程退出 | **治根**，唯一能治「只涨不降」 |
| **S-323** | `request_debug` 每轮推完整 body，渲染层上限只有 4 KB ⇒ 99.97% 生成即丢 | 修浪费（CPU / pipe / 峰值） |
| **S-324** | `StripDataUrlPrefix` 整串复制，一张 600 KB 图复制两遍只为看前 64 字符 | 纯性能，判据不变 |

**排在最后的原因**：内存是体验问题，合规是法律问题 —— 后者优先。且这三条改动文件与刀 0~5 **完全不重叠**，回滚边界独立，晚做不影响前面任何一刀。

## 二、刀序

| 刀 | 需求 | 做什么 | 前置 / 风险 |
|---|---|---|---|
| **0** | **S-321** 死代码清理（宠物 / 翻译 / 通道残留） | 删 `lib/pet/` 7 文件 + 4 个 `pet-*-store.ts`（1261 行）+ 翻译三件套（约 790 行）+ `NavItem` 的 `'translate'` + 两组 locale key + 12 条通道白名单残留 | **必须排在 S-318 之前**：S-318 刀 2 原本要为「宠物 / 翻译用着多账号轮转」留兼容逻辑，而这两者都是死代码 ⇒ 先删它们，刀 2 才能整目录清。三道核验不可跳：动态 `import()` 扫描、持久化 nav 值回落、打包产物字符串扫描 |
| **1** | **S-318 A 段** —— WorkBuddy 专项 | 4 个文件整删（两个 preset / 扫码登录 / 签到 / 签到定时器）+ 设置页「授权 AI 服务商」整页删（`ProviderAuthPanel.tsx` 及其 3 处引用 + 两组 i18n key）+ 注册与判据 4 处 + 主进程 IPC 3 处 + C# `ApplyOAuthAccount` / `ApplyOAuthAccountDebug` 整对删 + 测试引用 2 处 | 整页删的前提已验证成立：`ProviderAuthPanel.tsx:200` 用 `isServerPollProvider` 过滤，全仓只有 WorkBuddy 两个 preset 是 `server_poll` ⇒ 删这一页**不影响** Kimi / Copilot / Codex 的登录入口（那些走 `device_code`，入口在 `ProviderPanel` 内） |
| **2** | **S-318 B 段** —— 三家同类 | 删 `codex-oauth` / `copilot-oauth` / `moonshot-coding` 三个 preset；`lib/auth/` 里 `copilot.ts` / `oauth-utils.ts` / `oauth.ts` / `provider-auth.ts` / `provider-auth-accounts.ts` / `provider-auth-utils.ts` 随刀 0 之后的空消费者一并清；`ui.hideOAuthSettings` 全删后成死字段一并清 | 刀 0 删掉宠物与翻译之后，`provider-auth.ts` 的多账号轮转（`pickUsableAccount` / `markAccountRateLimited` / `trySwitchProviderAccount`）**已无消费者** ⇒ 可以整目录清，不必再摘半截。**但实施前必须复扫一次**：刀 0 与刀 2 之间若有新引用进来，说明判断错了，停手回报。**保留 `moonshotPreset`（API Key 版，同文件 `:123`）** |
| **3** | **S-318 §四** —— 僵尸服务商记录 | `reconcileProviders` 加显式剔除名单 `REMOVED_BUILTIN_IDS`（5 个 `builtinId`），命中即连 `extraBuiltinRecords` 一起丢弃 | **实施前必须先验**：会话 / 插件 / 定时任务 / 渠道 / 设置项里存的 `providerId` 失效后**有没有回落路径**。验不通就改成「保留记录但不显示」。不能指望「preset 不存在 ⇒ 自然不进列表」这个隐式行为 —— `:224-229` 对同 preset 的第二三条记录是原样 push |
| **4** | **S-318 §五** —— 构建期硬拦截 | 打包脚本在 `electron-builder` 产出后扫 `app.asar` 解包内容 + `resources/`，命中 `WorkBuddy` / `workbuddy` / `X-IDE-Name` / `X-IDE-Version` / `codex_cli_rs` / `GitHubCopilotChat` / `KimiCLI` 任一 ⇒ **构建直接失败** | **必须与删代码同一迭代交付**，否则删了也拦不住下次顺手带回来。只扫源码不算 |
| **5** | **核验收口** —— 全仓关键字零命中 + 门禁 | `grep` 全仓（源码 + 测试 + 文档 + 打包脚本）确认 7 个关键字零命中；门禁三条全绿；按 S-318 §九 八条验收 | 第 8 条（产物解包 grep）依赖刀 4 的扫描器，可复用 |

> **刀 1~5 的删除边界（老大 2026-11-05 15:19「318 正常通过apikey请求的不删哈」）**：`builtinProviderPresets` 共 48 个，**只删 5 个** —— `workbuddy` / `workbuddy-ai` / `codex-oauth` / `copilot-oauth` / `moonshot-coding`（`authMode: 'oauth'` + `requiresApiKey: false`，即**走只内置于官方客户端的 OAuth 通道**）。**其余 43 个一个字段都不改**，含 `moonshot`（API Key 版，与 `moonshot-coding` 同文件）、`qwen-coding` / `minimax-coding` / `baidu-coding` / `bigmodel-coding` / `xiaomi-coding` / `stepfun-plan`（套餐端点但凭自己的 Key）、`ollama` / `lmstudio`（`requiresApiKey: false` 但本地无冒充）。明细见 [S-318 §3B.0](../iter-v3-7/requirements/S-318.md)。
>
> **判据落点**：**病灶是「授权通道」，不是「额度归属」**（老大 15:26「workbuddy也是拿自己的账号额度，只是说是冒充workbuddy客户端去请求他们的模型」）。这 5 个用的都是**用户自己的账号、自己付的套餐**，错在走**只内置于官方客户端的 OAuth 通道**、冒充该客户端身份 —— 绕开了厂商「只允许官方客户端使用」的限制。UA 仿冒只是手段，**不是合规指标**（老大 15:23「ua冒名很正常，有些服务商限定了只允许哪些cli调用」），`qwen-coding` 就仿 `claude-cli` 且正常保留。别只看 `requiresApiKey: false` 就开删（`ollama` / `lmstudio` 也命中这个字段）。两种仿冒的区别见 S-318 §3B.0 附。
| 刀 | 需求 | 做什么 | 前置 / 风险 |
|---|---|---|---|
| **6** | **S-324** —— `StripDataUrlPrefix` span 化 | `ProviderContentHelpers` 加 `TryStripDataUrlPrefixSpan(ReadOnlySpan<char>, out ReadOnlySpan<char>, out string?)`；`DetectImageMediaTypeFromBase64`（`:62`）与 `ImageFileProbe.HasCompleteContainerInBase64`（`:159`）改用它，**去掉那个整串复制的 `Trim()`**；**保留 string 版**给三处真正要产 string 的调用点（`:408` / `:297` / `:221`） | 纯性能、**判据不变**。排在刀 8 前是为了先建立「改动不改行为」的信心。五种输入（png / jpeg / 无前缀 / 空串 / 带空白）新旧结果须逐字节一致 |
| **7** | **S-323** —— `request_debug` 结构化裁剪 | 新增 `RequestDebugBodyTrimmer`（超 8 KB 的字符串值换占位、非法 JSON 退回硬截断、短 body 走快速路径），三个 provider 全接入：`OpenAIChatProvider.cs:46` / `AnthropicMessagesProvider.cs:54` / `OpenAIResponsesProvider.cs:217` | **不能硬截断** —— 调试面板要 `JSON.parse`，截断变非法 JSON 等于用「看不见」换「不卡」。主仓渲染层上限本就是 4 KB（`debug-store.ts:20-22`）⇒ 截到 8 KB 不损失可视化。**三个 provider 漏一处不算完成** |
| **8** | **S-322** —— 会话闲置淘汰（**治根**） | `SessionConversationManager` 补两条闸：闲置 **2h** 淘汰 + 常驻上限 **8 条**（超额按最久未访问砍）；`SessionConversation` 加 `Touch()` 记最后访问时刻 | **唯一治「只涨不降」的一刀，也风险最高**（淘汰错＝用户上下文没了）⇒ 放最后动。安全性靠 `AgentLoop.cs:83-89`：`MessageCount == 0` 时从 DB 懒恢复。唯一会丢的是 status bar 的 cache hit/miss 累积计数 ⇒ 展示指标，归零不算 bug（验收须显式确认） |

## 二·补 分层体检三条（S-325 / S-326 / S-327）

> 老大 11-05 16:36「你看下我们项目立项是规划的分层结构这些，现在是不是有很多违反了，如果有给我列出来」⇒ 16:40「先登记」。**本条只登记，未动任何代码。**

**先说结论**：七层**依赖方向零违规** —— `src/runtime` 七个子项目的 `ProjectReference` 矩阵里没有一条逆向依赖（`Agent` 不引 `Worker`、`Workspace` 不引 `Persona`、`Core` 只引 `Contracts`）。违规全部落在「层内该放什么」与「章程本身过期」两类。

| 编号 | 一句话 | 性质 | 归属 |
|---|---|---|---|
| **S-325** | 章程指向了不存在的项目：`AGENTS.md:25` 与 `docs/project-structure.md:30-31`、`:56` 仍把 `WishfulClaw.CodeGraph` 当 vendored 项目写，它早已在 S-303 剥离为插件 | **修文档**（零代码） | **✅ 已实施**（commit `9a4acfeb`） |
| **S-326** | 分层职责条款与实现打架：`AGENTS.md:92` 说 Worker「只保留进程入口与模块注册」，实际 `MemoryModule` 两文件 512 行真实现；`AGENTS.md:56` 把 33 个 `Db*Tools`（8,204 行）算作 Infrastructure 职责，`:59` 又说该层目的是让 Tools 迁出 | **二选一裁定** | **✅ 16:47 裁定 A+C，已实施**（commit `9a4acfeb`） |
| **S-327** | Agent 根目录平铺 **140** 个 `.cs`，章程只承认 6 类，其中 `AgentRuntime*` 执行器 **52** 个 + 其它杂项 **17** 个（占 49%）它完全没提 | **纯结构重构** | **✅ 已实施**（刀 9~15，`06f52e13`…`8bd42ab0`，根目录 140 → **24**） |

**S-325 顺带包含两条零风险清理**：`AGENTS.md:81` 的 Agent 依赖清单漏写 `Workspace`（实际 **10** 个文件 `using WishfulClaw.Workspace`，靠 Persona 传递才编过 —— 登记时写 9 个，实施时实测 10 个）；`Infrastructure/Memory/` 与 `Agent/tmp/agent-verify-*` 是空目录残留。

**S-326 为什么是裁定项而不是缺陷**：`Db*Tools` 迁进 Agent 会让 Agent 从「依赖 Infrastructure 抽象」退化成「直接压在 33 个具体类和表结构上」 —— 耦合会**加深**而不是减弱。我的建议是**选 A（改章程并写清判据）**，理由与 A/B 代价对比见 [S-326 §四-§六](requirements/S-326.md)。

### S-327 刀序（本迭代，**17:03 裁定**）

> 原判断「不能塞本迭代」已推翻 —— 老大 17:03「当前迭代做，主要是当前迭代才拆分出来不久，今天下午才开始的」。复核：原论据只有「刀 0~8 已满」，属排期偏好而非技术障碍；搬迁的真实风险由「一刀一簇 + 每刀独立 commit + 可单独 revert」控制，与放哪个迭代无关。

| 刀 | 建目录 | 移入 | 文件数 | 结果 |
|---|---|---|---|---|
| **9** | `Executors/` | 全部 `AgentRuntime*` ＋ 2 个伪装 partial | **54** | ✅ `06f52e13` · 140 → 86 |
| **10** | `Llm/` | `OpenAI*` / `Anthropic*` / `Provider*` | 23 | ✅ `e6a55181` · 86 → 63 |
| **11** | `SubAgents/` | `SubAgent*` + `BackgroundSubAgent*` | 14 | ✅ `94410801` · 63 → 49 |
| **12** | `Compression/` | `ContextCompression*` | 8 | ✅ `331eb43e` · 49 → 41 |
| **13** | `Sessions/` | `Session*` | 5 | ✅ `bd02143a` · 41 → 36 |
| **14** | `Protocol/` `Results/` `Images/` `Desktop/` | StreamSegmentBoundary / MessagePackEmitter / ApiUserAgent；`Aot*`×3；`Image*`×2；DesktopWindowLocator + SandboxElevationExecutor | 10 | ✅ `6d23bd6f` · 36 → 26 |
| **15** | 归位收口 | `RequestDebugBodyTrimmer`→`Protocol/`、`SystemPromptCache`→`Llm/`；其余杂项与 AgentLoop 同生命周期留根 | 2 | ✅ `8bd42ab0` · 26 → **24** |

**三处与预算的偏差（详见 [S-327 §5.1](requirements/S-327.md)）：**

- 刀 9 是 **54** 不是 52 —— `AskUserAnswerBuilder` / `AskUserCoercion` 文件名不带前缀，实声明 `partial class AgentRuntimeAskUserExecutor`，不同搬会把 partial 劈成两个命名空间的同名类
- 刀 14 的 `Protocol/` 是 **3** 不是 4 —— `ConversationCodec.cs` 实声明 `partial class AgentLoop`，搬走等于拆 AgentLoop，已退回根目录；`Results/` 是 3 不是 4，登记表把 `AotProjectResultTypes` 重复计了一次
- 刀 14 把原计划的四个目录**合并成一刀**：四簇互不相关且各自编译收敛要跑 40~160 错，分四刀的时间成本远超收益。回滚粒度变成「四目录一起」，可接受

**两条硬约束**（详见 [S-327 §五](requirements/S-327.md)）：

- 模型 Provider 目录叫 **`Llm/`**，不能叫 `Providers/` —— `Agent/Tools/Providers/` 已被 25 个**工具**提供者占用，`project-structure.md:56` 已专门写过「⚠️ 别混」
- 只 `git mv` + 改 `namespace`，**不改文件名、不改逻辑**。看到顺手能优化的记下来另开单 —— 掺进搬迁里就分不清编译错误是搬迁错还是改动错

**引用基线（17:05 实测，开工前必读）**：C# 侧 `AgentRuntime` 命中涉及 **Agent 内 165 文件 / Worker 4 / tests 27 / 其它 2**，登记单原估「61 个测试文件」**低估 3 倍**。原因是 C# 命名空间只沿父链查找 —— `WishfulClaw.Agent.Tools` 向上找的是 `WishfulClaw.Agent`，**不会**找到兄弟 `WishfulClaw.Agent.Executors`，所以连原本就在 `WishfulClaw.Agent` 下的文件也要补 using。前端 101 处命中**全是同名无关**（`registerNativeAgentRuntimeHandlers`、局部变量 `agentRuntime`），**一行不改**。明细见 [S-327 §八](requirements/S-327.md)。

## 二·补 2 只读审查五条（S-328 ~ S-332）

> 老大 11-06 08:23「先登记，然后动手清理，在本迭代处理」。来源：v3-iter-8 只读审查（1683 个源文件全量扫，HEAD `f0e1824f`，工作区干净）。**与 S-325 / S-326 / S-327 同源** —— 都是分层体检的余账。

| 编号 | 一句话 | 性质 |
|---|---|---|
| **S-328** | Agent 层自写 SQL 绕过 Db 层。登记报「7 张表 12 处」—— **实测 9 张表 30 处 / 9 个文件**（漏了 `projects` 和 `messages`；第一次机器扫用了不区分大小写的 `-match`，把 `multi-select questions` 当命中）。根因不是偷懒：Entity / Mapper 都在 Db 层且 Agent 正在用，**缺的是把两者粘起来的「表访问」那层** ⇒ S-326 A2 裁定的未尽面。**09:0x 老大裁定拆为 6 个编号**：S-333 / S-334 / S-335 / S-337 / S-338 + 收尾 S-336 | **结构重构（最重）** |
| **S-329** | 超 500 行硬线、**没有豁免标记**的文件。审查报 12 个 —— **实测 6 个**（`ContextCompression` / `AgentLoop` / `ToolDispatchRouter` 用的是英文 `500-line exemption`，审查的扫描只认中文写法）；「没扫全集对差集」这个审查盲区是真的 | 补标记；**原计划的「真拆 3 个」作废**（豁免复核全部成立） |
| **S-330** | 4 具遗骸（2 个 0 引用可直删）+ `RuntimeStatusPanel` 是一个**用户能 hover 点开的英文空壳**（`Runtime status — coming soon`） | 删死代码 |
| **S-331** | 文档 **4 处**代码路径失效：3 处是 S-327 搬迁副作用，1 处（`debug-store.ts`）从登记那天就错 | 只改文档 |
| **S-332** | renderer 层 **8 处** `console.log`，其中 `use-chat-actions.ts:176` 打 `sshConnectionId` ⇒ 信息暴露，不只是噪声 | 清调试残留 |

**审查没查出问题的（别重复查）**：七层依赖方向**零违规**；铁律 3 匿名类型序列化 **0**；铁律 6 `new JsonSerializerOptions` **0**；铁律 7 `System.Reflection` **2 处均合法**（读嵌入资源，正是例外条款）；`NotImplementedException` **0**；「探针」6 处全是注释；`debugger` 17 处全是 CDP `webContents.debugger` API；精确筛出的 9 处 TODO/FIXME **全落在 S-330 那批空壳里**。

### 刀序（刀 16 起）

| 刀 | 需求 | 做什么 | 风险 / 注意事项 |
|---|---|---|---|
| **16** | **S-331** 文档路径订正 | 4 处改实际路径 + 把 v3-iter-8 七个需求单的代码路径**全扫一遍** | 零代码。**先做这一刀是因为它清视线** —— 后面对照着错路径找代码会扑空 |
| **17** | **S-332** `console.log` 收口 | 删 renderer 层 8 处；`console.warn/error` 与 `src/main/` 那 59 处**不动** | 判据：用户能看见 + 不是错误 + 不是为了排查 ⇒ 删。**别扩大半径** |
| **18** | **S-330** 死代码 | 删 2 个 0 引用文件；2 个占位壳**先看引用点再定**（依赖存在就留文件、写「占位未实现」）；`RuntimeStatusPanel` 整条链路拔掉 | renderer 侧删导出最容易漏桶文件重导出 ⇒ typecheck 兜底 |
| **19** | **S-329** 补标记 ✅ `b5434cb9` | **实测只缺 6 个**（登记写「12 个」是错的 —— 扫描只认中文写法，漏了英文 `500-line exemption`，把三个大文件误判成无标记）；1 个补豁免 + 5 个标「超标待拆分」 | **不写死行数**。理由必须落到具体一条。补完 **60/60，差集 0**，见 S-329 §一 / §4.1 |
| ~~20~22~~ | ~~S-329 B/C/D 真拆~~ **全部作废** | 复核后三巨头的豁免**全部成立**：`ContextCompression`（1120，管线不变量 + 叶子已拆）、`AgentLoop`（931，步骤间是顺序不是接口 + 已拆 6 个 partial）、`ToolDispatchRouter`（635，分支顺序即路由契约）。三者都是 `AGENTS.md:193`「拆得动但代价显著大于收益」的原型 | **不拆**。继续拆只会剩下「顺序骨架」，那正是最不该拆的部分。留记录是为了下次别再把它当欠账捡起来。详见 S-329 §三 |
| **23** | **S-335** `sub_agent_runs`（3 处）✅ 首刀 | `SubAgentReportStore`(121 行) 改调；在 Db 层立「表访问」样板 | **最小、一屏看完** ⇒ 样板在这里定死，后面五个照抄。反了的话样板会长出五样 |
| **24** | **S-328** `tasks` + `plans`（10 处） | 两个 `.Db.cs`(212 / 81 行) 改调 | 复用刀 23 的样板。`UPDATE tasks` 是**部分列更新**，别扩成整行覆盖 |
| **25** | **S-334** `goal_*` 三表（3 处） | `GoalOrchestratorMaterialize` 的 `AbortSubtree` 改调 | **全族唯一有隐藏语义的**：三条 UPDATE 在同一个 try 里，**失败是连锁的**。包事务或各自 try 都会改语义 ⇒ 只能照抄。三处 where 条件各不相同，不许合并 |
| **26** | **S-333** `projects`（5 处 / 3 文件） | 含 `Tools/PathBoundary.cs` 两处 | **唯一跨到 Tools 层的**。沙箱根集合的 `try/catch` 降级必须留在调用点；`S-103` / `S-144` 那两段注释要跟着 SQL 一起搬 |
| **27** | **S-337** `sessions`（5 处 / 2 执行器） | 含建会话的 INSERT | 全族**唯一会造新行**的写入。`S-115` / `S-189` 两段 NOT NULL 注释必须一起搬，漏了两个月后重踩 |
| **28** | **S-338** `messages`（2 处）✅ | `SessionRestoreTools` 增量 / 全量两条 | 边界用 `created_at`，**签名里不许出现 `through_sort_order`** —— 出现就会被拿去做过滤，回到「会话永久卡死」那个 bug。`AttachPartsToEntities` 顺序不动 |
| **29** | **S-336** 判据落章程 + 端点薄化 ✅ 已落地 | `AGENTS.md` 加可机器复核的判据；只薄化本族碰过的 9 张表，其余 25 个 `Db*Tools` 不动也不欠账 | 薄化的工时七成在**逐字段 diff** —— 端点那份 SQL 与 Agent 层那份**很可能不一样**，直接换会掉字段。可分批，停了要登记剩余项 |
| **30** | **S-339** 大小写重名 ✅ `78663ed2` | `git rm` 掉零引用的 `error-boundary.tsx`，保留 `ErrorBoundary.tsx` | 删前多核一道：两文件**同类名** `ErrorBoundary`、但类型名不同（`ErrorBoundaryProps/State` vs `Props/State`）⇒ 要确认类型名也没被外部具名导入。实测 0 处 |
| **31** | **S-343** 文档 GBK 混杂 ✅ 已落地（纯文档） | `iter-v3-1/plan-s224/review_report.md` 后半 3,928 B 按 CP936 重解，中文无损 | **切分点是 18726 不是 18725** —— 单据里那个数字来自 .NET 异常消息，报的是 UTF-16 码元位置不是字节偏移。**emoji 一个没补**（`?` 原样留），历史报告不篡改 |
| **32** | **S-344** 主进程 console.log 收口 ✅ `e63b01af` | 58 处改走 `logInfo` / `logDebug`（channels 42 + mcp 6 + ipc 4 + lib 5 + ssh 1） | `index.ts:172` **有意保留** —— 那是 renderer `console-message` 桥的透传，落盘由下一行 `logWarn` 负责，改掉就丢来源标签。`native-worker` 的 `exited` 本来双写，去掉重复那半 |
| **33** | **S-341** 项目终端 dock 空壳 ✅ `096a94f0` | 删 `ProjectTerminalDock.tsx` + 两处 `terminalDockOpen` 硬编码 `false` 的渲染点 + 配套 `project-terminal-context.ts` | 删前核实过「不是功能缺失」：开关本来就是常量 `false`，按钮都不存在 ⇒ 是死代码不是缺 UI |
| **34** | **S-340** 死代码 26 文件 ✅ 五刀分删 | 组 A `01f9e304`（`lib/agent/` 10 文件 971 行）→ 组 B `ece70216`（layout 4 个 git 对话框 418 行）→ 组 C `5731c636`（主进程 `agent-history-store.ts` 268 行）→ 组 D `a941c9e2`（其它 8 文件 685 行）→ 组 E `7f9093ec`（空函数 4 行） | **一次一组、每组单跑 typecheck**，删一个验一个。组 C 先确认了 `agent-history:*` 通道已由 `worker-forward-handlers` 转发给 C# worker（`DbSubAgentTools` 读 `subAgentHistory`），这份文件存储是旧实现 ⇒ 才敢删。**实测净减 2,346 行**，登记写的 2,460 是高估 |
| **35** | **S-342** 两个空壳 ✅ `6b501efb` | ① `selectSessionScopedAgentState` 补真实现（按 `sessionId` 过滤 store 三张表，缓存「源引用三元组 + 运行状态」保证 zustand 选择器返回稳定引用）；`findSubAgentInSelection` 补真实查找 ② `clearSessionPromptSnapshot` 空实现 + `SessionPromptSnapshot` 类型 + 16 处调用一起删 | **两个空壳方向相反**：① 有人消费返回值且接了渲染判断（`hasOrchestrationData` 恒 false 会让子 agent 编排时间轴不渲染）⇒ **补实现**；② `promptSnapshot` 字段在 store 里**根本不存在**，类型注释自己写着「placeholder, 迭代七完善」，从没实现过 ⇒ **全删**。稳定引用是硬要求：每次返新对象会让订阅方无限重渲染 |
| ✅ **36** | **S-345** 浏览器工具判据 | `browser-tool-names.ts` 3 行 → 照 `desktop-routing.ts` 形状写实（8 个常量进 `Set` + `has`）；顺手删 `tool-block-renderer.tsx:127-128` 里那个凭空假设的 `input.action === 'screenshot'` | **这一刀改的是判据，不是渲染** —— 三处下游（图卡、`BrowserToolCard`、时间轴 `browser` 分类）都是被它挡住的，修完三处一起活。**别动** `BrowserToolCard` 内部（没坏）、`visual-context.ts:111` 的小写归一化（另一套语义） |
| ✅ **37** | **S-346** 图片重试按钮 | **先查通道，再决定删还是接**：main / native worker 有按 `toolUseId` 重跑的入口 ⇒ 接上并改名 `retryImageGenerate`；没有 ⇒ 删按钮 + 整套提示块 + i18n 键 | **不许猜**。按钮 + 确认框 + 三句提示文案全齐备、用户能一路点到确认，最后什么都不发生 —— 比没有按钮更伤。三种可能处置见单据 §四 |
| ✅ **38** | **S-347** 死代码残留 | `git rm teams/team-native-control.ts`（24 行，删前核 `teams/register.ts` 没动态引）；删 `ChannelPanel` / `createPlanModeInlineToolHandlers` 两个死导出；清 `right-panel-tab-factories.ts:4-8` 五行空行 | **只删零引用的**。`getDefaultRightPanelTabs()` 恒 `[]` 是合法初始值、`tooltip.tsx:115` 是 compound 空壳、`image-attachments.ts` 两处是正则误报 —— 单据 §五 已列明不删 |
| ✅ **39** | **S-348** 浏览器卡片兜底 ✅ `095352ce` | `BrowserToolCard/summary.ts` 末行 `return name` → `return ''`；`BROWSER_CLICK` 末位 `\|\| name` → `\|\| ''`；补 `BROWSER_SET_DEVICE_TOOL_NAME` 的摘要分支（pc / iPhone / Pixel / iPad / 自定义 W × H）与 `getResultRows` 分支；i18n 中英各 +4 键；新增 `tests/browser-summary-fallback` 8 条 | **病根是兜底位置，不是漏一个 if**。`BrowserToolCard.tsx:105` 是 `primary: summary \|\| title`，summary 拿到工具名就短路、title 永不生效。**S-270 修的是 title 侧同一个病**（`fallbackTitle` 末行 `return name`，注释还在 `:86`），这是对称的另一侧。测试按 8 个常量逐个过，加第 9 个工具漏分支直接红 |
| ✅ **40** | **S-349** 两处假注释 ✅ `29be0c97` | `SubAgentsPanel.tsx:237` / `SubAgentExecutionDetail.tsx:245` 的「`selectSessionScopedAgentState` is still a stub」改写成本组件为什么不走它 | **只改注释，代码一行不动**（`git diff -U0` 确认 6 增 2 删全为注释行）。当时「代码不依赖它所以不用动」的推论是对的，但推不出「注释也不用动」—— 注释写的前提（它是桩）已经没了 |
| ✅ **41** | **S-350** 假参数 + 缓存测试 ✅ `a0bec68f` | 删 `_options?: { mode?: string }` 形参 + 4 处 `{ mode: 'coarse' }` 传参；新增 `tests/session-scoped-agent-state` 12 条 | **假参数比没参数更坏**：后来人会照「传了 coarse 所以视图被裁剪、比较便宜」的假设去做优化。缓存测试是硬需求 —— 该选择器丢进 `useAgentStore(selector)`，zustand 用 `Object.is` 比对，每次造新对象就是无限重渲染；守这条线的只有 6 个 `===`，之前 0 覆盖。顺带让 `resetSessionScopedAgentStateCache` 真的被用起来 |

> **刀 16~19 是「清地」**：每刀十分钟级、零行为变更，可以连做。**刀 23~29 是「动结构」**：每刀都要单跑全门禁、单独 commit，出问题单独 revert。原刀 20~22（真拆三个大文件）已作废 —— 豁免复核全部成立，见上表。

> **刀 23~29 的顺序不能换**：S-335 先立样板 → S-328 复用 → S-334 处理连锁语义 → S-333 跨层 → S-337 写入 → S-338 大表 → S-336 收尾删重复 SQL。**S-336 必须在最后** —— 它要删的是「Db 层原来那份」，前面没搬完就删等于毁掉唯一实现。

## 二·补 3 欠账普查六条（S-339 ~ S-344）

**2026-11-06 09:5x 老大「再找找还有没有欠账」**，对 `src` / `tests` / `docs` / `website` 全量只读普查。刀 23~29 已全部落地（Agent 层 SQL **0**），这一轮查的是**代码之外**的欠账。**六条全部本迭代做完**（刀 30~35）。

| 编号 | 欠账 | 性质 | 归属建议 |
|---|---|---|---|
| **S-339** | `components/error-boundary.tsx` 与 `ErrorBoundary.tsx` **大小写重名，两份都在 git 索引** | 跨平台隐患（ext4 上会出事） | ✅ **本迭代已修**（刀 30 `78663ed2`） |
| **S-340** | **26 个文件 2,460 行**无人 import + `sendImplementPlanInNewSession` 空函数 | 死代码（删了行为不变） | ✅ **本迭代已修**（刀 34，五刀分删，实测净减 2,346 行 —— 登记时 2,460 是高估） |
| **S-341** | `ProjectTerminalDock` 空壳（`return null`）+ 两处 `terminalDockOpen = false` 死分支 | 死代码（**已核实不是功能缺失**） | ✅ **本迭代已修**（刀 33 `096a94f0`） |
| **S-342** | `selectSessionScopedAgentState` 恒返空 + `clearSessionPromptSnapshot` 空实现（16 处调用） | **功能缺口**（有人调、拿不到数据） | ✅ **本迭代已修**（刀 35 `6b501efb`，两个空壳方向相反：选择器补真实现、快照清理连类型一起删） |
| **S-343** | `iter-v3-1/plan-s224/review_report.md` **后半段 3,928 字节是 GBK** | 文档编码（**中文可无损恢复**，emoji 永久丢失） | ✅ **本迭代已修**（刀 31，纯文档） |
| **S-344** | 主进程 **59 处 `console.log`** 没走 `logger.ts`（channels 占 42） | 排障能力（不影响行为） | ✅ **本迭代已修**（刀 32 `e63b01af`，实收 58 处，`index.ts:172` 有意保留） |

**这一轮普查同时纠正了两处我自己的误判**（登记时一并写进单据，防止下次再犯）：

1. **S-341 一度判成「用户点终端按钮没反应」** —— 核对后不成立：开关**硬编码 `false`**，按钮本身不存在。正解是「死代码没人删」，不是「活的 UI 缺实现」
2. **S-343 一度判成「整文件乱码、不可恢复」** —— 错在拿 `Select-String` / `Get-Content` 的默认编码输出下结论（正常中文段也变问号，是**显示层假象**）。字节级复核才看清：`0~18725` 合法 UTF-8、只有后半 3,928 字节是 GBK，**中文可完整恢复**。**以后查编码一律用 `UTF8Encoding($false,$true)` 严格解码，不看肉眼输出**

## 二·补 4 复核通过、不算欠账的

| 项 | 结果 |
|---|---|
| 超 500 行无标记文件 | **0**（`src` / `tests` / `website` 全扫，含英文标记 `500-line exemption`） |
| renderer `console.log` / `debugger` | **0**（S-332 守住） |
| Agent 层 SQL 字面量 | **0**（S-328 全族达成，判据已进 `AGENTS.md` §6） |
| iter-v3-8 文档失效路径 | **0** —— S-330 单据里那几个是记录「已删」、S-321 里 pet 文件是存量清单，都不是坏链接 |
| 七层依赖方向 / 匿名类型序列化 / `NotImplementedException` | 与 09:0x 那次只读审查结论一致，本轮未复扫（无相关改动） |

## 二·补 5 二轮欠账普查三条（S-345 ~ S-347）

**2026-11-06 11:0x 老大「继续找欠账吧。上午我不想去测试，下午再测试」**，全量只读复扫。

**这一轮换了扫描角度才扫出东西**：前两轮（S-328~S-344）扫的是「有没有多余的东西」（死文件、死导出、重复 SQL、多余日志）；这轮加扫「**有没有该有却没有的东西**」（空实现被当真值依赖），立刻查出两条真缺陷 + 一条 S-340 漏网。

| 编号 | 欠账 | 性质 | 归属 |
|---|---|---|---|
| **S-345** | `isBrowserToolName` 恒假桩 ⇒ 浏览器图卡 / `BrowserToolCard` 整段 / 时间轴 `browser` 分类**三处同时失效** | **缺陷**（一套写完的卡片 + 6 图标 + 7 摘要一次没渲染过） | ✅ **本迭代已修**（刀 36 `6da8fe02`） |
| **S-346** | 图片生成「重试」按钮点了没反应（`resolveImageGenerateRetry` 恒 `null`，实参还是 `toolUseId`） | **缺陷**（用户可点、点完全程无效果） | ✅ **本迭代已修**（刀 37 `389bf5c0`，全删 —— 后端 C# 侧 `awaiting_retry` 零命中，这套 UI 移植时就没接） |
| **S-347** | S-340 漏网：`team-native-control.ts` 整文件 + 2 个死导出 + 5 行空行 | 死代码（零功能变化） | ✅ **本迭代已修**（刀 38 `43b4e656`，净减 33 行） |

**三条都不阻塞开工，没有需要拍板的事**。S-346 的处置方向（接上 / 删掉）在实施时按「有没有通道」自行判定，不回头问。

> **11:5x 收口**：三条全部落地。S-346 判定的结果是「没通道」——`AgentRuntimeImageGenerateExecutor.cs` 的 `image:generate` 是一次性 reverse-request，成功返结果、失败返 `{error}`，**没有「分批 + 第 N 张失败 + 等确认」的概念**；全仓 C# 侧搜 `awaiting_retry` 零命中。所以不是「按钮坏了」，是「按钮从来就不存在」——`retryState` 恒 null ⇒ 提示块和按钮永不渲染。按单据 §四 方案 3 全删（文件 + 33 行 JSX + 7 个 i18n 键 × 2 语言），**零可观察变化**。

**这轮同时纠正了我自己一处脚本缺陷**：超 500 行扫描第一次报 4 个无标记，实际是我**只取文件前 3 行找标记**，而豁免注释规范位置在第 7~9 行（版权头之后）。全文复核 4 个全部有标记。**以后这类扫描必须全文搜标记，不能只开头几行。**

## 二·补 6 三轮登记三条（S-348 ~ S-350）

**2026-11-06 21:0x dev 实例测试 + 审查上报五条**，逐条核实**全部属实**，按「文件不重叠 + 回滚边界独立」归并成三条（刀 39~41），**全部本迭代**。

| 编号 | 问题 | 性质 | 归属 |
|---|---|---|---|
| **S-348** | `BrowserSetDevice` 卡片主行显示裸英文，中文标题被挤到副行 | **缺陷**（用户可见，中危） | ✅ **本迭代已修**（刀 39 `095352ce`） |
| **S-349** | 两处注释仍写「`selectSessionScopedAgentState` is still a stub」 | 注释失效（零行为变化） | ✅ **本迭代已修**（刀 40 `29be0c97`） |
| **S-350** | `_options` 假参数（4 处传、0 处读）+ 198 行缓存逻辑零测试 + `resetSessionScopedAgentStateCache` 零引用 | 接口欠账 + 测试欠账 | ✅ **本迭代已修**（刀 41 `a0bec68f`） |

**核实结果与 dev 转述的差异**（两处值得一提）：

1. **S-348 的根因比转述更值得修**。dev 说「`buildSummary` 8 个分支缺 1 个」，这话没错，但真正的病根是**末行 `return name` 这个兜底本身** —— `BrowserToolCard.tsx:105` 是 `primary: summary || title`，只要兜底返回非空就短路。**S-270 修过同一个病的另一侧**（`title` 的 `fallbackTitle` 末行 `return name`，注释还留在 `:86` 解释这件事），当时没顺手把 `buildSummary` 这侧一起收了。所以这一刀不是补一个 if，是把兜底改成空串 + 加测试按 8 个常量逐个过。

2. **S-350 第 3 条（`resetSessionScopedAgentStateCache` 零引用）dev 建议删，我改成「用起来」**。它的注释原本就写着「仅供测试与诊断」，而第 5 条正好要补测试 —— 补了测试它就兑现了，删了下次写测试还得补回来。dev 那五条里第 3 和第 5 条是同一件事的两面，转述时分成了两条。

## 二·补 7 收尾前一条（S-351）

**2026-11-09 09:1x 老大报**：浏览器截图卡**重开会话后看不到预览图**，点开只剩一段原文 JSON。**刀 42**，本迭代做。

| 编号 | 问题 | 性质 | 归属 |
|---|---|---|---|
| **S-351** | 图片块在历史消息里长不回来 —— 实时链路给内联数组、库里 `payload.output` 是 JSON 字符串，卡片一律 `Array.isArray(output)` 取图 ⇒ 执行中有预览、重开会话只剩原文 | **缺陷**（用户可见） | ✅ **本迭代已修**（刀 42 `d08b43c4`） |

**为什么 S-294 当时没修完**：那一次补的是 `splitDesktopToolBlocks`，只覆盖桌面截图 / 窗口截图两条路径。漏掉的三处是 `BrowserToolCard.tsx:64`、`ImagePluginToolCard.tsx:104`、`text-output.tsx:27` —— 每张卡片各自 decode，补一张漏一张。

**这一刀换了位置**：不在卡片里逐张 decode，改在统一出口 `buildToolCallRenderState`（`AssistantMessage/utils.ts`）归一出 `output`，四个 `tool-block-renderer.tsx` 调用点共用，**历史与实时两条来源一起覆盖**。判据**收窄**为「解出来是数组且含 `image` 块」才换 —— 普通文本输出恰好是 JSON 数组时原样返回，避免把原文藏起来变空白卡。解码器做成注入参数（`StructuredDecoder`），因为 `tool-result-format.ts` 顶部 import 了 zustand store，会让 node 测试 import 不了。

## 三、开工前必须拍板的事

**一条**。不阻塞开工。原第 2 条（S-326 A/B）已于 16:47 裁定，见下表。

| # | 事项 | 怎么定 |
|---|---|---|
| 1 | 僵尸记录：**剔除** vs **保留但隐藏** | 取决于悬空 `providerId` 回落路径验不验得通 —— 验通即剔除，验不通即隐藏。**实施时先验再定，不用回头问** |
| 2 | ~~S-326：改章程承认 还是 迁代码~~ **已裁定** | **✅ 16:47 裁定 A + C 并实施**（commit `9a4acfeb`）：A = 章程写清 `Db*Tools` 判据；C = 补 `DbMemoryTools`，把 15 处手写 SQL 收成 1 处。**原「只需 A」的建议被推翻** —— 做完 C 之后 A1 那条指控自己就消解了，不是靠改章程绕过去 |

> 原先第二条「宠物 / 翻译用到的多账号轮转还剩多少真实用途」**已作废** —— S-321 核实后两者都是死代码，OAuth 摘完 `provider-auth.ts` 直接整目录清，不存在「还剩多少用途」这个问题。

## 四、门禁与口径

- 每次交付跑**三条**：`npm run typecheck`（node + web + test 三配置）、`npm test`、`dotnet build`（两套 sln，`-t:Rebuild`）。
- **跑门禁前必须关掉在跑的 `WishfulClaw.Worker.exe`**，否则 runtime sln 被锁（v3-iter-6 踩过）。
- 删除类改动一律做**零命中核验**，不做「应该删干净了」的推断。
- 真机口径不变：dev 实例上反复跑过的即实测通过；「已实施未验收」必须在文档里显式标出。
- 格式：新增与大改文件 CRLF / UTF-8 无 BOM / 裸 LF = 0。
- **官网本迭代零改动** ⇒ 发版只走 `installer`，不重发站点。

## 五、发布节奏（S-318 §七 已定）

| 步 | 动作 |
|---|---|
| 1 | v1.0.7 已发 —— **最后一个带 WB 的公开版** ✅ |
| 2 | 本迭代做完刀 0（清死代码）+ A 段 + B 段 + 剔除 + 硬拦截 + 刀 6~8（内存三条） |
| 3 | 随本迭代发 **v1.0.8 —— 第一个公开面干净、且 worker 不再只涨不降的版本** |
| 4 | 旧产物按 `release-workflow.md` §七 只留最近 3 版（v3-iter-7 已执行过一次，两版之后公开面自然淘汰） |

> **抖音推广硬约束：v1.0.8 之前别拍设置页的 AI 服务商列表** —— 那一屏明晃晃一行「WorkBuddy 已连接」。
> **建议同时别拍任务管理器的内存列** —— worker 1060 MB 的现状拍出来就是「这软件很吃内存」，刀 8 做完才有可展示的曲线。

## 六、文档

- [raw-requirements.md](raw-requirements.md) —— 清单（实施 / 挂账 / 候选池 / 订正记录）
- [changelog.md](changelog.md) —— 裁定与口径流水（按日期追加）
- 需求正文：[S-321](requirements/S-321.md)（本迭代新建，含三处残留的实读证据）；内存三条 [S-322](requirements/S-322.md)（会话驻留淘汰，治根）/ [S-323](requirements/S-323.md)（`request_debug` 白推）/ [S-324](requirements/S-324.md)（base64 前缀重复复制），均本迭代新建、均含主仓实读行号；[S-318](../iter-v3-7/requirements/S-318.md) —— **留在原目录不搬家**（v3-iter-7 登记时就在那里）
- 分层体检三条（本迭代 16:40 登记）：[S-325](requirements/S-325.md)（章程指向不存在的项目 + 空目录，✅ 已完成）/ [S-326](requirements/S-326.md)（Worker 薄层与 `Db*Tools` 归置，✅ 已完成）/ [S-327](requirements/S-327.md)（Agent 根目录 140 文件归位，✅ 已完成）
- 只读审查五条（本迭代 08:23 登记，均本迭代做）：[S-328](requirements/S-328.md)（Agent 层手写 SQL，**族首**）/ [S-329](requirements/S-329.md)（超 500 行缺标记，实测 6 个）/ [S-330](requirements/S-330.md)（4 具遗骸 + 1 个空壳）/ [S-331](requirements/S-331.md)（文档 4 处路径失效）/ [S-332](requirements/S-332.md)（renderer 8 处 console.log）
- S-328 拆分五条（本迭代 09:0x，老大「可以拆分成多个需求」）：[S-333](requirements/S-333.md)（`projects` 5 处，跨 Tools 层 + 沙箱）/ [S-334](requirements/S-334.md)（`goal_*` 三表 3 处，失败连锁语义）/ [S-335](requirements/S-335.md)（`sub_agent_runs` 3 处，**首刀立样板**）/ [S-336](requirements/S-336.md)（判据落章程 + 端点薄化，族尾）/ [S-337](requirements/S-337.md)（`sessions` 5 处，含建会话 INSERT）/ [S-338](requirements/S-338.md)（`messages` 2 处，恢复边界）
- 二轮欠账普查三条（本迭代 11:0x）：[S-345](requirements/S-345.md)（`isBrowserToolName` 恒假桩，三处下游全失效）/ [S-346](requirements/S-346.md)（图片重试按钮点了没反应）/ [S-347](requirements/S-347.md)（S-340 漏网：1 整文件 + 2 死导出 + 5 行空行）
- 三轮 dev 审查三条（本迭代 21:0x）：[S-348](requirements/S-348.md)（浏览器卡片兜底回显工具名，`BrowserSetDevice` 裸英文）/ [S-349](requirements/S-349.md)（两处注释还在说选择器是桩）/ [S-350](requirements/S-350.md)（`_options` 假参数 + 缓存逻辑零测试）
- 收尾前一条（本迭代 11-09 09:1x）：[S-351](requirements/S-351.md)（浏览器截图重开会话后只剩原文 JSON —— 历史侧图片块长不回来）
- **人工验收清单（本迭代刀 0 ~ 刀 42 + S-325/S-326 收口成一份）**：[manual-acceptance.md](manual-acceptance.md) —— A 档必测 6 组 / B 档抽查 1 组（6 条，5 分钟）/ C 档其余全免测。老大 11-06：「只需要留下需要我关注的让我测试，而不是全交给我去过一遍」