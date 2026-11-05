# v3-iter-8（产品 1.0.8）—— 先清垃圾，再合规，后治内存

> 分支：`dev/v3-iter-8`（base = `86166fd4`，= v1.0.7 发布记录提交，即最新 `main`；tag `v1.0.7` → `02ae848b`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.8`（开工时 `package.json` 是 `1.0.7`，收尾时改），tag `v1.0.8`。
> 状态：**已拆分，未开工**（2026-11-05 14:49 老大「开新迭代」；14:56 追加 S-321 插为刀 0；15:04 追加内存三条；15:14 内存三条从一张合单拆为 **S-322 / S-323 / S-324** 三个独立编号 —— 老大：「你刚刚直接登记三个也行啊 突然搞个abc干啥」）。
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
| **6** | **S-324** —— `StripDataUrlPrefix` span 化 | `ProviderContentHelpers` 加 `TryStripDataUrlPrefixSpan(ReadOnlySpan<char>, out ReadOnlySpan<char>, out string?)`；`DetectImageMediaTypeFromBase64`（`:62`）与 `ImageFileProbe.HasCompleteContainerInBase64`（`:159`）改用它，**去掉那个整串复制的 `Trim()`**；**保留 string 版**给三处真正要产 string 的调用点（`:408` / `:297` / `:221`） | 纯性能、**判据不变**。排在刀 8 前是为了先建立「改动不改行为」的信心。五种输入（png / jpeg / 无前缀 / 空串 / 带空白）新旧结果须逐字节一致 |
| **7** | **S-323** —— `request_debug` 结构化裁剪 | 新增 `RequestDebugBodyTrimmer`（超 8 KB 的字符串值换占位、非法 JSON 退回硬截断、短 body 走快速路径），三个 provider 全接入：`OpenAIChatProvider.cs:46` / `AnthropicMessagesProvider.cs:54` / `OpenAIResponsesProvider.cs:217` | **不能硬截断** —— 调试面板要 `JSON.parse`，截断变非法 JSON 等于用「看不见」换「不卡」。主仓渲染层上限本就是 4 KB（`debug-store.ts:20-22`）⇒ 截到 8 KB 不损失可视化。**三个 provider 漏一处不算完成** |
| **8** | **S-322** —— 会话闲置淘汰（**治根**） | `SessionConversationManager` 补两条闸：闲置 **2h** 淘汰 + 常驻上限 **8 条**（超额按最久未访问砍）；`SessionConversation` 加 `Touch()` 记最后访问时刻 | **唯一治「只涨不降」的一刀，也风险最高**（淘汰错＝用户上下文没了）⇒ 放最后动。安全性靠 `AgentLoop.cs:83-89`：`MessageCount == 0` 时从 DB 懒恢复。唯一会丢的是 status bar 的 cache hit/miss 累积计数 ⇒ 展示指标，归零不算 bug（验收须显式确认） |

## 三、开工前必须拍板的事

**只剩一条**，且不阻塞开工：

| # | 事项 | 怎么定 |
|---|---|---|
| 1 | 僵尸记录：**剔除** vs **保留但隐藏** | 取决于悬空 `providerId` 回落路径验不验得通 —— 验通即剔除，验不通即隐藏。**实施时先验再定，不用回头问** |

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
