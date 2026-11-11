# v3-iter-9：底盘补格 —— 渠道出站媒体通道

- 状态：已完成，已合并 main
- 分支：dev/v3-iter-9（已删除）
- Plan: docs/plans/iter-v3-9/plan.md
- VERDICT: PASS（自动化回归全绿；真机验收项见 §遗留）
- 产品版本: 1.0.9
- Tag: v1.0.9
- 日期: 2026-11-11
- 迭代定位：**回归底座，一条新功能都不加。** 老大 2026-11-09 10:33 一句「本仓主要是负责做插件底座，不负责具体功能实现」把 R 系重新切了一刀 —— 把「通道能力」和「功能实现」混成一件事是我此前的错误。切完之后 R-1 听 / R-4 插件化在本仓都已落地，R-3 反代整条关闭，**只剩 R-2「说」缺的正是出站那一格**。所以这一迭代只做一件事：把渠道出站媒体通道补上。补完之后 R-1 / R-2 在本仓的底座就齐了，只剩插件本体在别的项目。

## 范围与功能单元（交付 7 条 / 刀 0 ~ 刀 14 / 17 个提交）

### 一、出站媒体通道本体（刀 0 ~ 3，S-352）

- **刀 0 八家逐家实读（不动代码，2026-11-09）** —— 读的过程订正了登记里两个事实错误：漏了 WhatsApp（实为八家不是七家）；微信「协议层可能有、未验证」判错，`sendImage` / `sendFile` 本来就在（`weixin-service.ts:159/168`）。**有凭证的只有飞书 + 微信**，其余六家按无凭证处理。
- **刀 1 接口 + 飞书收编（`14837e16`）** —— `MessagingChannelService` 出站只有 `sendMessage(chatId, content: string)`，而入站 `ChannelIncomingMessageData` 有 `images` / `audio` / `mediaRefs` / `msgType` **四个媒体字段** —— 收的方向有媒体，发的没有。加可选 `sendMedia` + `supportedMediaKinds`，先只让飞书实现，把已有的 `sendImageMessage` / `sendFileMessage` 从渠道私有分支搬进统一接口。**排在最前的理由**：先建立「接口改了、行为没变」的信心，出问题时能立刻判定是搬家搬坏还是新接入写错。
- **刀 2 微信收编（`405bc9df`）** —— `sendImage` / `sendFile` 收进 `sendMedia`，去掉 `channel-weixin-handlers.ts` 两处重复实现。
- **刀 3 语音出站（`fd97143e`）** —— 微信 `voice_item` 按官方 iLink SDK 重写，**原推断三处全错**：`media_type` 2 → **4**、删掉不存在的 `voice_len`、补 `encode_type` / `sample_rate` / `bits_per_sample` / `playtime`；飞书补 `msg_type: 'audio'`；三家 `send-audio` 工具入口全链路。

### 二、审查补刀（刀 9 ~ 11，S-354 / S-355 / S-356）

> dev 只读审查（`v1.0.8..ab2b2dbe`，34 文件 / +1801 −233）发现 13 条，并成 4 个单。**一句话结论：问题不在「写码」，在「接线」—— 零件全在，线没接。** 这与 v3-iter-7 的迭代标题是同一个病，第二次犯。

- **S-354 降级链路真接线（`3922a827`）** —— 「发不了就退避发文字」是 2026-11-09 老大拍板的既定行为，但代码写了**全仓零 import**，实际行为是 `throw`。飞书 6 处 + 微信 6 处调用点改走 `sendMediaOrText(...)`，两条分支都有测试。顺带把 `ChannelSendAudio` 的注册期可见性按渠道能力收窄（`SupportsOutboundMedia`，判据与执行期路由同源）。
- **S-355 读源加固（`a0b14c2c` + `ebe049fd`）** —— 出站读源此前无上限、无超时、同步读：一张图能撑爆内存、一个挂起的 URL 能卡死主线程。补 **30 MB 硬上界**（本地 `stat` 先判 + 读完再判一次兜 TOCTOU；URL 先判 `content-length` 再流式累加、超限 `cancel()` 断连）+ **60 s `AbortSignal.timeout`** + `fs.promises` 全异步。取值理由写进注释：**底座护栏，不复刻平台规则**（飞书 30 MB / 图片 10 MB、微信 60 s 那些由渠道 API 回错，抄一份即维护两份真相）。
  - **D-7 路径边界（11:48 老大拍板 A + C）** —— 渠道工具**免审批直接执行**（`ToolCallProcessor.Approval.cs:81-84`，渠道弹不出审批框），而 `source` 此前零校验 ⇒ 群里说句话就能让 agent 把 `.ssh/id_rsa` 当图片发出去。免审批是既定设计不动，那么「读哪个文件」就是唯一还能挡的地方：加凭据类黑名单（`.ssh` / `.aws` / `.gnupg` / `.kube` / `.docker`、`.env*` / `.npmrc` / `.netrc` / `.pgpass` / `credentials*`、SSH 私钥名、`.pem` / `.p12` / `.pfx`），**在 `stat` 之前调用 —— 连文件存不存在都不透露**。不做目录白名单，因为会把「把刚生成的图发出去」这个主场景一起挡掉；黑名单之外的已知风险在 S-352 §9 明文登记。
- **S-356 一致性残局（`3d6e9da6`）** —— `imagePath` 旧名别名（**方向从规范名查旧名**，由「读的那一侧」决定，不由改名史决定 —— 第一版写反了，测试没命中才发现）；删 `FeishuMediaApi.downloadUrl` 28 行死代码；删**五处**不生效的 `fileType`（只删写侧不删 schema 声明侧等于没修，模型照 schema 传照样白传）；渲染端补 `channelSendAudio` 让三处声明对齐。

### 三、同线发现的既有缺陷（收尾刀，S-353）

- **S-353 参数名对不上（`ab2b2dbe`）** —— schema 写 camelCase、executor 按蛇形精确读 ⇒ **7 处参数静默丢失**（`imagePath` / `userId` / `userIds` / `atAll` / `recordIds` / `pageSize` / `durationMs`）。治根是 `TryGetProp` 双向归一。实施中另发现两处同源缺陷：`BitableMut` 的 `if…else…;` 无条件尾巴（真传数组必抛异常）、`FeishuBitableListApps` 执行体空写。

### 四、老大直接提的两条（非审查来源）

- **S-358 token 单位 `G` → `B`（`d85053d2`）** —— `TOKEN_UNITS` 按 SI 前缀选了 `G`（Giga），而 AI 行业描述 token 用量通行 `B`（Billion）；`1.13G` 在中文语境会被读成 GB。一个字面量 + 3 处注释 + 4 处断言 + 1 条防回退断言，26 个调用点与 C# 侧零改动。
- **S-359 默认选中未启用的 Ollama（`924e76f2`，P1 回归，已验收）** —— v1.0.8 引入的缺陷（`7fc9647a`，S-318 A 段的兜底）。`ensureBuiltinPresets` 的挑选写 `requiresApiKey === false || !!apiKey`，**零 `enabled` 判断**；内置投影默认 `enabled: false`，Ollama 免 key 且排第 6 位 ⇒ 空配置启动必中，选中结果落盘后永久钉死。**第二层**：服务商选对后模型仍是停用的那个（`pickDefaultModel` 首档不看 `enabled`、末档 `models[0]` 无条件）。修复 = 服务商层 + 模型层双层判据（`enabled` + 有凭据 + 至少一个启用模型），**空集合 = 不选**，由既有横幅引导配置。

### 五、四个关闭单（`3a6525c2` / `4b75d925` / `08e07b3b` / `7dcdc73b`）

- **S-273 段 B** 第三方窗口元素树 —— 段 A（自家窗口走 CDP）已覆盖原始诉求；段 B 覆盖率窄（只对 Win32 控件有效，微信 / UWP 拿不到）、要独立非 AOT 进程 +60~80 MB、AOT 三条路实测全断。**重开条件**：有真实场景报「某软件点不了」。
- **S-230 Qoder 接入** —— 契约从来没有过（全树搜 `qoder` 零命中）；性质已被 S-318 判死。**缺契约是「做不了」，合规裁定是「不该做」，后者不随契约变化。**
- **S-232 prompt 前脱敏** —— 架构上防不到点（key 是用户直连服务商，防的是服务商日志而非我们）、代价 > 收益（出站不可逆会击穿 prefix cache，且 `Write` 可能把 `[REDACTED]` 写进用户 `.env`）。
- **S-247 内存观测单** —— 可观测层早已交付、定性已收口（**不是泄漏，是每帧重做**）、派生项各自结案。**未吞掉的一条**：老大提的「回收周期 / 主动触发回收」既未登记也未实现，且原就禁止自动 GC ⇒ 属「待定想法」不属本单欠账，要推进须另开新单。

## 工程收口

- **门禁三条**：`npm run typecheck`（node + web + test 三配置）、`npm test`、`dotnet build` 两套 sln `-t:Rebuild`。
- **测试套件 130 → 131**（新增 `tests/channel-media`；`ChannelToolVisibility` 191 → **200 assertions**；`provider-presets` 579 assertions）。
- **新增测试一律双向验**：S-355 D-7 的凭据黑名单除了 13 条必拒，另有 **7 条不得误伤**（`.pub` / `.envrc` / `.cache` / URL）—— **「不误伤」那半边比「必拒」更要紧**，误伤一次「发刚生成的图」就没法用了。
- **降级行为不抛错、不静默丢弃、不弹窗**：`sendMedia` 前查 `supportedMediaKinds`，不含目标 kind 直接走 `sendMessage(text)`。**调用方（插件）不需要知道这家支持什么，底座替它退。**
- **文档欠账一轮清（11:57）**：全 `docs/` 822 个 md 的相对链接逐个 `Test-Path`（断链 1 条，真断链）；本迭代每张单 `git log --grep` 对照状态行（捞出 `S-352.md` 还写着「登记，未开工」——**第五次**「单子与清单各写各的」）；4 条散落待办归口到 `raw-requirements.md` §六。**规矩：下个迭代只认 §六，不认单内「另记一笔」。**
- **`roadmap-post-1.0.md` R-5 补记落地结果**：接口形态 / 降级策略 / 已接入 / 未接入 / 读源护栏 / 路径边界。设计当时的「七家现状」表**保留不改**（那是 11-09 的实读证据，改了丢溯源）。

## 验证

- `npm run typecheck`（node + web + test 三配置）**0 错误**
- `npm test` **131/131**（96 TS + 35 C#）
- `dotnet build src/runtime/WishfulClaw.sln -t:Rebuild` **0 错误 / 2 警告**（均为已挂账 S-320 的 `NU1903`，同一预发布包被两个工程各报一次）
- `dotnet build tests/WishfulClaw.Tests.sln -t:Rebuild` **0 警告 0 错误**
- `npm run test:channel-media` / `test:token-format` / `test:provider-presets` 单套均通过
- 真机口径（老大定）：dev 实例上反复跑过的即实测通过。**已过**：S-359（11:26 验收通过）。

## 遗留

| 项 | 内容 | 归属 |
|---|---|---|
| **刀 4 ~ 8 不做** | 钉钉 / Discord / QQ / Telegram / 企业微信 / WhatsApp 六家媒体接入 —— **无凭证**，`supportedMediaKinds` 留空即「退避发文字」，**这是正确结论不是失败** | 不做 |
| **S-357** | 引入 TS 侧 lint（`no-unused-vars` / `no-floating-promises` / `eqeqeq`），`git log --grep` 零命中，确未开工 | 移交下一迭代 |
| **真机验收** | S-354 T-1~T-3（微信 `playtime` 单位 / `opus → OGG_SPEEX` 是否出声 / 飞书拒 mp3 与否）、S-355 超时回收、S-356 旧名 `imagePath`、S-358 布局 | `raw-requirements.md` §6.4 |
| **渲染端插件工具线** | 4 个导出全仓零调用、`descriptor.tools` 零消费者，要么接线要么清掉（方向性决定） | `raw-requirements.md` §6.2 |
| **S-233 / S-320** | 聊天窗偶发抖动（等复现）/ `NU1903` 告警（等 .NET 11 GA，**不 `NoWarn`**） | `raw-requirements.md` §6.5 |
