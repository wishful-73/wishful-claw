# iter-v2-37 原始需求登记（总览清单）

> 建 2026-09-29（iter-36 收尾发布后）。分支 **`dev/v2-iter-37`**（base `77adb84b` = `v0.2.36` 发布点，2026-09-29 14:39 切出）。
> 本文件**只放清单**；需求正文见 `requirements/`，跨需求裁定流水见 `changelog.md`。
> 开局为**历史欠账清扫型**（S-156~S-159，来源是 iter-36 收尾后对历次迭代「遗留 / 死配置」的盘点，2026-09-29 14:49 老大点选）；
> 16:33 起追加一条**产品诉求**（S-160，官网 `.work` 上线 + 备案落地后的应用内收口）；
> 16:56 追加一条**缺陷修复**（S-161，自动压缩刚完成即中断、重发消息又触发压缩 —— S-141 同族残留）；
> 17:39 从**参考项目摸底**结果里点选四条**借鉴型**需求（S-162~S-165，来源 `D:\claw\ZCode` 与 `D:\claw\NextCoWork`）。

---

## 需求清单

### 本迭代新增登记（2026-09-29）

| 编号 | 标题 | 状态 | 正文 |
|---|---|---|---|
| S-156 | 设置页缺「AI 生成人格」入口：`PersonaGeneratorDialog` 组件完整但全仓无 importer | ✅ 已实施（第 2 刀） | [S-156.md](requirements/S-156.md) |
| S-157 | 数据目录名常量收敛残留：TS 侧三处硬编码 `.wishful-claw` 字面量 | ✅ 已实施（第 3 刀，实做五处） | [S-157.md](requirements/S-157.md) |
| S-158 | 渠道「按工具逐个开关」死配置：删除 `plugin:tool-enabled` 全链路 | ✅ 已实施（第 4 刀） | [S-158.md](requirements/S-158.md) |
| S-159 | 设置项「新会话默认模型」死字段：删除 `newSessionDefaultModel` | ✅ 已实施（第 5 刀） | [S-159.md](requirements/S-159.md) |
| S-160 | 关于页面补官网信息 + 使用指引改指官网 | ✅ 已实施（第 6 刀） | [S-160.md](requirements/S-160.md) |
| S-161 | 自动压缩刚完成即中断，重发消息又触发压缩 | ✅ 已实施（第 7 刀） | [S-161.md](requirements/S-161.md) |
| S-162 | 图片产物的「就地出口」+ `SaveImage` 工具 | ✅ 已实施（第 8 刀；姊妹需求 S-166） | [S-162.md](requirements/S-162.md) |
| S-163 | 建立设计系统文档 `docs/design-system.md` | ✅ 已实施（第 10 刀） | [S-163.md](requirements/S-163.md) |
| S-164 | 需求正文补两节：「代价与取舍」「刻意不做」 | ✅ 已实施（第 11 刀） | [S-164.md](requirements/S-164.md) |
| S-165 | 流式工具调用解码器加固：缺省 `index` 归格 + `id` 归并 | ⏸ 暂不实施（备查），不占刀序 | [S-165.md](requirements/S-165.md) |
| S-166 | 通用图片生成：不要求单独配一个图像模型 | ✅ 已实施（第 9 刀；姊妹需求 S-162） | [S-166.md](requirements/S-166.md) |
| S-167 | 外部投递给会话发消息时用全局模型顶掉会话自己的绑定（**两条投递途径**：派工单 `send_work_request` / 临时小任务 `send_session_message`，外加反向 `reply_global_dispatch`） | ✅ 已实施（第 1 刀） | [S-167.md](requirements/S-167.md) |
| S-168 | AI 辅助创建人格：入口挪进新增人格页 + 生成结果回填 + 模型可当场选（**S-156 的形态调整**） | ✅ 已实施（第 13 刀） | [S-168.md](requirements/S-168.md) |
| S-169 | OpenCode Go 内置模型清单全量更新：价格刷新 + 无效模型去除 | ✅ 已实施（第 16 刀） | [S-169.md](requirements/S-169.md) |
| S-170 | DeepSeek 内置服务商默认协议改为 OpenAI Chat | ✅ 已实施（第 14 刀） | [S-170.md](requirements/S-170.md) |
| S-171 | 辅助通道补头链 + persona 生成退出后端（**姊妹项 S-172 本次不做**，随 iter-38 目录登记） | ✅ 已实施（第 15 刀） | [S-171.md](requirements/S-171.md) |

> S-160 起于老大 16:33「关于页面需要增加 官网信息，以及使用指引需要指向官网　这个需求登记上」——
> 官网 `.work` 上线并完成 ICP / 公安备案后的应用内收口。勘测**顺带揪出一处死链**：
> `ConversationGuideDialog.tsx:313` 硬编码的 `https://wishful-claw.shop/`（域名不存在，curl 实测 000），一并纳入修复。

> S-156 起于老大 14:49「PersonaGeneratorDialog 零入口　我就说这个我没找到地方，加到需求里面」——
> 他此前在设置页里**找不到**生成人格的入口，勘测证实：组件与后端链路都在，**只缺挂载点**。
>
> S-157 起于老大 14:49「`.wishful-claw` 字面量三处未收敛　加」——
> 承接 iter-27 K0「全项目只允许两处定义」的规矩，iter-28 记为遗留，至今未收敛。

> S-162~S-165 起于老大 17:31「你看下 zcode 有哪些好东西是值得我们弄上的，包括 NextCoWork 的也是，你分析下呢」——
> 摸底两个参考项目（`D:\claw\ZCode` 智谱编程工作台 / `D:\claw\NextCoWork`）后按价值 × 成本分档汇报，老大点选四项。
> **本轮四项都是「从别处学来的」，不是我方实测暴露的问题**，故正文均以「参考项目做了什么 + 我方现状勘测 + 待裁定」组织。
> 其中 **S-165 是探查后登记**（老大原话「这个需要探查是否我们有这种顾虑」）—— 探查结论：我方**不会**踩「整轮中止」，但归格语义有偏差，详见正文。

> **S-166** 起于老大 17:51 对 S-162 的追加：「162 我们现在还缺图片生成，当前的图片生成是需要去配置专门的模型，我想要一个通用的，当前模型就能调用的图片生成」——
> 与 S-162 是**姊妹需求但彼此独立**（S-162 管「图出来之后怎么拿走」，S-166 管「图怎么出来」），故另立编号、不合并。

> **S-167** 来自**知识库**（非老大口述）：`D:\koda\Obsidian\05-WishfulClaw\issues\bugs.md` 2026-09-29 新增条目（同日 21:52 补实证），老大 09-30 08:22 要求登记。
> 登记前已实读代码，**根因定死**（`project-send-message.ts:168,175` 绕过 `resolveSendModel`），正文含同族路径对照表与两个待验证点。

### 盘点已裁定（2026-09-29 14:57）

| 事项 | 来源 | 现状 | 裁定 |
|---|---|---|---|
| `plugin:tool-enabled` 死配置：渠道「按工具逐个开关」两头没接 | iter-28 S-6 | 存储字段 `ChannelInstance.tools` + 主进程三层查询壳齐全；**配置方（UI）与调用方（C#）皆为零** ⇒ 恒返回 `true` | **删** ⇒ 已登记为 S-158 |
| `newSessionDefaultModel` 死字段：设置项「新会话默认模型」 | iter-28 S-9 | 代码侧 4 处全在 store 自留地（声明 / 初始值 / persist 白名单 / migrate 补默认）；**无 UI、无读取方** ⇒ 恒为 `null` | **删** ⇒ 已登记为 S-159 |

> **S-170** 起于老大 2026-10-08 08:27「登记一个简单需求归属37迭代　DeepSeek的内置api服务商　默认协议改成openai chat」——
> 默认选型调整（非 bug）：现默认 Anthropic 协议（`type: 'anthropic'`、端点 `https://api.deepseek.com/anthropic`），诉求改为 OpenAI Chat。
> 登记前已实读代码，**勘出一条升级路径的坑**：`isUnownedBuiltin` 要求 `baseUrl === preset.defaultBaseUrl`，而 `defaultBaseUrl` 一旦改动，
> 已配 DeepSeek 的老记录（旧 baseUrl）将**永远不满足**该判据 ⇒ 既拿不到新协议、也不会被退回投影。正文列了 A/B/C 三条路径待裁定。
>
> **编号说明**：S-169 已被「OpenCode Go 模型清单全量更新」（归属本迭代，2026-10-07 登记、10-08 实施，第 17 刀）占用，故本条顺延为 S-170。

> **S-169** 起于老大 2026-10-07「OpenCode Go 模型清单全量更新」（登记时只留编号说明，未落文档）。10-08 09:26 老大补范围：
> 「这个就是 S-169 的　应该是漏了文档，当时就是更新各模型的价格这些，以及无效模型的去除」；09:40 老大给官方数据源；09:42 拍定取值口径
> 「以文档为准，分档定价取最高档」。**范围曾在 A（对齐 models.dev 33 个）/ B（对齐网关 43 个）/ C（只修 400 + 改名）三档间待裁，最终按官方文档 31 条落地。**

> **S-171** 起于老大 2026-10-08 08:54~09:07 的三段口径 —— ① 辅助通道（提示词优化 + persona）**一条头链都没有**，需仿造主链补头链
> （`userAgent` / `requestOverrides` / opencode-go 的 `x-opencode-session`）；② 请求应统一到一个地方，**persona 不应有请求** ⇒ persona 生成退出后端、
> 解析与请求构造放到渲染端。**落点勘误**：原计划在 persona 侧新增请求方法，老大当场否掉（「persona 不应该有请求」），改落 `lib/persona/generator.ts`（渲染端）+ 后端 `ProviderCompletionService` 按协议补头链。
>
> 其姊妹项 **S-172**（主链流式头链 5 份收敛：`OpenAIChatHeaders` / `AnthropicMessagesProvider` / `OpenAIResponsesProvider` / `ContextCompression` ×2）**本次不做** ——
> 原挂 iter-37，10-08 13:36 老大「172 也归属到 38 去」⇒ 已移入 **iter-38** 目录登记（`docs/plans/iter-v2-38/requirements/S-172.md`）。
