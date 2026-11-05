# v3-iter-8（产品 1.0.8）—— 公开面合规清理

> 分支：`dev/v3-iter-8`（base = `86166fd4`，= v1.0.7 发布记录提交，即最新 `main`；tag `v1.0.7` → `02ae848b`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.8`（开工时 `package.json` 是 `1.0.7`，收尾时改），tag `v1.0.8`。
> 状态：**已拆分，未开工**（2026-11-05 14:49 老大「开新迭代」）。
> 门禁基线（沿用 v3-iter-7 收尾实测）：`npm run typecheck` 三配置 0 错｜`npm test` **125/125**｜`dotnet build` 两套 sln（`-t:Rebuild`）—— 主 sln 2 警告（均为已挂账 S-320 的 `NU1903`）/ 0 错误，测试 sln 0/0。
> 前置：v1.0.7 已双面发布，是**最后一个带 WorkBuddy 的公开版**。

## 一、本迭代的定位

**这是合规清理，不是功能迭代。** 删代码，不写新东西。

公开仓 `wishful-claw` 里有 5 个 preset 做的是同一件事：**拿用户自己的订阅额度、冒充官方客户端身份**去请求厂商的非公开端点。个人违反服务协议最坏是封号；做成产品对外分发是另一个量级 —— 老大 11-05 09:47 原话「如果我去抖音推广大家使用，有这个功能的话，会被腾讯这些直接告」。

已发出的 v1.0.0 ~ v1.0.7 二进制删不掉，只能靠后续版本自然淘汰。本迭代负责的只有一件事：**从 v1.0.8 起公开面干净，且以后修 provider bug 时带不回来。**

## 二、刀序

| 刀 | 需求 | 做什么 | 前置 / 风险 |
|---|---|---|---|
| **1** | **S-318 A 段** —— WorkBuddy 专项 | 4 个文件整删（两个 preset / 扫码登录 / 签到 / 签到定时器）+ 设置页「授权 AI 服务商」整页删（`ProviderAuthPanel.tsx` 及其 3 处引用 + 两组 i18n key）+ 注册与判据 4 处 + 主进程 IPC 3 处 + C# `ApplyOAuthAccount` / `ApplyOAuthAccountDebug` 整对删 + 测试引用 2 处 | 整页删的前提已验证成立：`ProviderAuthPanel.tsx:200` 用 `isServerPollProvider` 过滤，全仓只有 WorkBuddy 两个 preset 是 `server_poll` ⇒ 删这一页**不影响** Kimi / Copilot / Codex 的登录入口（那些走 `device_code`，入口在 `ProviderPanel` 内） |
| **2** | **S-318 B 段** —— 三家同类 | 删 `codex-oauth` / `copilot-oauth` / `moonshot-coding` 三个 preset；`lib/auth/` 里 `copilot.ts` / `oauth-utils.ts` / `oauth.ts` 三个文件随之删；`provider-auth.ts` **只摘 OAuth 部分**（`buildOAuthProviderPatch` / `disconnectProviderOAuth` / `finalizeOAuthToken`），**保留多账号轮转**；`provider-auth-utils.ts` 随整页删；`ui.hideOAuthSettings` 全删后成死字段一并清 | ⚠️ **最容易低估的地方**：「删掉所有 OAuth」≠「删掉 `lib/auth/` 目录」。`provider-auth.ts` 导出的 `pickUsableAccount` 等被 `pet-agent` / `pet-voice` / `translate-store` 引用，硬删会打断宠物和翻译。**保留 `moonshotPreset`（API Key 版，同文件 `:123`）** |
| **3** | **S-318 §四** —— 僵尸服务商记录 | `reconcileProviders` 加显式剔除名单 `REMOVED_BUILTIN_IDS`（5 个 `builtinId`），命中即连 `extraBuiltinRecords` 一起丢弃 | **实施前必须先验**：会话 / 插件 / 定时任务 / 渠道 / 设置项里存的 `providerId` 失效后**有没有回落路径**。验不通就改成「保留记录但不显示」。不能指望「preset 不存在 ⇒ 自然不进列表」这个隐式行为 —— `:224-229` 对同 preset 的第二三条记录是原样 push |
| **4** | **S-318 §五** —— 构建期硬拦截 | 打包脚本在 `electron-builder` 产出后扫 `app.asar` 解包内容 + `resources/`，命中 `WorkBuddy` / `workbuddy` / `X-IDE-Name` / `X-IDE-Version` / `codex_cli_rs` / `GitHubCopilotChat` / `KimiCLI` 任一 ⇒ **构建直接失败** | **必须与删代码同一迭代交付**，否则删了也拦不住下次顺手带回来。只扫源码不算 |
| **5** | **核验收口** —— 全仓关键字零命中 + 门禁 | `grep` 全仓（源码 + 测试 + 文档 + 打包脚本）确认 7 个关键字零命中；门禁三条全绿；按 S-318 §九 八条验收 | 第 7 条（产物解包 grep）依赖刀 4 的扫描器，可复用 |

## 三、开工前必须拍板的事

S-318 §八 留了两条待定，**都不阻塞开工，但刀 3 / 刀 2 各自需要先有答案**：

| # | 事项 | 需要谁定 |
|---|---|---|
| 1 | 僵尸记录：**剔除** vs **保留但隐藏** | 取决于悬空 `providerId` 回落路径验不验得通 —— 验通即剔除，验不通即隐藏。**实施时先验再定，不用回头问** |
| 2 | `pet-agent` / `pet-voice` / `translate-store` 用的多账号轮转，OAuth 全摘后还剩多少真实用途 | 若无他用可一并精简；**默认保留**（只删 OAuth 冒充，不动通用能力） |

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
| 2 | 本迭代做完 A 段 + B 段 + 剔除 + 硬拦截 |
| 3 | 随本迭代发 **v1.0.8 —— 第一个公开面干净的版本** |
| 4 | 旧产物按 `release-workflow.md` §七 只留最近 3 版（v3-iter-7 已执行过一次，两版之后公开面自然淘汰） |

> **抖音推广硬约束：v1.0.8 之前别拍设置页的 AI 服务商列表** —— 那一屏明晃晃一行「WorkBuddy 已连接」。

## 六、文档

- [raw-requirements.md](raw-requirements.md) —— 清单（实施 / 挂账 / 候选池 / 订正记录）
- [changelog.md](changelog.md) —— 裁定与口径流水（按日期追加）
- 需求正文：[S-318](../iter-v3-7/requirements/S-318.md) —— **留在原目录不搬家**（v3-iter-7 登记时就在那里），本迭代不新建 `requirements/`
