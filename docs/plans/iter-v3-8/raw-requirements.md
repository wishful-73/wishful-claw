# v3-iter-8 需求清单

> 拆分于 2026-11-05 14:49（老大「开新迭代」）。来源 = v3-iter-7 收尾移交 + 该迭代挂账结转。
> 本文件只列清单与依据，刀序见 [plan.md](plan.md)。

## 一、本迭代实施（2 条）

| 编号 | 标题 | 现状 / 依据 | 正文 |
|---|---|---|---|
| S-321 | **清理从 OpenCowork 搬来但从未接通的死代码（宠物 / 翻译 / 通道残留）** | 2026-11-05 14:56 老大「登记吧」。触发点：S-318 刀 2 原写「`lib/auth/` 不能整目录删，宠物和翻译在用多账号轮转」，老大反问「宠物不要，翻译是什么？」⇒ 核实后**两者都是死代码**，前提不成立。**宠物 1261 行**（`lib/pet/` 7 文件 + 4 个 `pet-*-store.ts`）：`src/main` 零命中、渲染层零组件 import、无资源目录。**翻译约 790 行**（`translate-store` / `translate-service` / `translate-agent-service`）：`useTranslateStore` 零消费者。**另 12 条通道白名单残留**（`messagepack-channel-routing.ts:17-27, :400-402`）指向不存在的 handler，`NavItem` 的 `'translate'`（`ui-types.ts:13`）与两组 locale key 同样无消费点。五处唯一外部依赖都是 `ensureProviderAuthReady` 一个函数 ⇒ **删完之后 S-318 刀 2 可以从「摘 OAuth 留多账号轮转」简化成「整目录清」** | [requirements/S-321.md](requirements/S-321.md) |
| S-318 | **公开版剔除「订阅额度 OAuth 冒充」（5 个 preset）** —— 合规清理 | v3-iter-7 唯一移交项。老大 11-05 09:47「workbuddy 是一个风险点，如果我去抖音推广大家使用，有这个功能的话，会被腾讯这些直接告」+ 09:5x「页面 ai 授权服务商也需要删掉才对啊」+ 10:12「统一都需要处理。不过可以丢到下个迭代单独处理」。**5 个 preset**：`workbuddy` / `workbuddy-ai`（`server_poll` + 6 个 `X-IDE-*` 头）/ `codex-oauth`（`codex_cli_rs/0.144.5` UA + `chatgpt.com/backend-api`）/ `copilot-oauth`（`GitHubCopilotChat/0.26.7` + `copilot_internal/v2/token`）/ `moonshot-coding`（`KimiCLI/1.49.0` + 客户端白名单）。**保留 `moonshotPreset`（API Key 版，`moonshot.ts:123`）**。四个坑已实读确认：①「授权 AI 服务商」整页只收 `server_poll` ⇒ 可整页删、不影响其它 OAuth ②`reconcileProviders:224-229` 对同 preset 第二三条记录原样保留 ⇒ 僵尸记录需显式剔除名单 ③`lib/auth/provider-auth.ts` **不是纯 OAuth**，含多账号轮转 —— **但消费者是 S-321 要删的死代码** ⇒ S-321 先行后此顾虑消失 ④靠「preset 不存在」隐式清理不可靠 | [../iter-v3-7/requirements/S-318.md](../iter-v3-7/requirements/S-318.md) |

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
