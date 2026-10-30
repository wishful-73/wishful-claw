# v3-iter-5 裁定与口径流水

> 跨需求的裁定、口径变更、方向性决定记这里。单需求细节留在 `requirements/S-{NNN}.md`。
> 上游需求正文不搬家，留在原迭代目录，本文件与 `raw-requirements.md` 只做链接。

## 2026-10-30

### 20:25 · 迭代建立（拆分支）

`dev/v3-iter-5` 从最新 `main`（`3f27090d` = v1.0.4 收尾合并点）拆出，产品版本 `1.0.5`、tag `v1.0.5`。

初始承接 **15 条**（v3-iter-4 §2.5 移交）：S-265 / S-268 / S-273 / S-277 / S-278 / S-279 / S-280 / S-281 / S-282 / S-285 / S-286 / S-288 / S-289 / S-290 + **S-272 第二段**。

挂账 **2 条**不占刀序：S-233（聊天窗抖动）、S-230（Qoder 缺契约，阻塞）。

同批新建 `raw-requirements.md` / `changelog.md` / `plan.md`（承接索引 + 刀序）。

### 20:30 · 知识库三条核对完毕

按 AGENTS.md:273 硬规矩核 `D:\koda\Obsidian\05-WishfulClaw\issues\bugs.md`（剩余 3 条 + 1 条待观察）。

**第 1 条（2026-09-22 沙箱 Write 被拦）—— 不立项，重复登记。**

它**早就立项并修完了，就是 S-144**（`docs/plans/iter-v2-36/requirements/S-144.md`，2026-09-23，状态 ✅ 已修，14 断言回归、`npm test` 53/53）。

更要紧的是：**知识库记的三个「触发候选」全是错的**。`PathBoundary.IsInsideAnyRoot` 全程只做一次 `Path.GetFullPath` + 前缀比较（`PathBoundary.cs:229-256`），没有按文件名 / 字符集 / 层数的分支 —— 中文、下划线、十层子目录走的是同一条「前缀命中」路径，机制上不可能被拦。

**真根因是 `workingFolder` 漏传**：渲染端每个 run 组装点各自透传，漏一处 ⇒ 沙箱根集合与文件工具基准路径**同时落空** ⇒ 项目内写入被判越界，而报错还在劝用户「把目录加进项目工作目录」（他早就加了）。这与知识库描述的「写工作目录下的深层子目录被拦、agent 反复重试后改走脚本」完全吻合，也解释了为什么它与文件名无关。两侧都已堵：C# `ResolveProjectWorkingFolder` 缺失时按 `projectId` 回查项目表、渲染端补三处回退。

⇒ 该条**回写知识库归档**，附注唯一尾巴：用户现场（凶兆 agent，`F:\data\novel`）未能复验，但机制已闭环。

**第 2 条（2026-10-27 图像消息 400）—— 归档。**

已被 v3-iter-3 / v3-iter-4 整条链路覆盖并结案：S-246（组包侧闸门 + 工具入口收紧，`S-246.md:231` 老大原话「本需求结案，且不需要造脏图会话做真机复验」）+ S-261（marker 表缺 `unsupported image` 词形 / `source.type==='url'` 绕过闸）+ S-262（400 不钉死会话）+ S-264（脏图源头治理）+ S-266（签名在头、截断在尾）+ S-267。v3-iter-4 收尾时全部判「真机生效」。

⇒ 知识库该条**移入《历史记录》**。

**第 3 条（2026-10-30 渠道消息重复投递）—— 已从代码定性，建议立项，待老大点头。**

**不需要把 logLevel 降到 information 抓日志**，根因读代码就能定：

`src/main/channels/providers/weixin/weixin-service.ts`（443 行，微信用**长轮询**不是 WS）：

1. **`handleIncomingMessage`（`:346-435`）全程没有去重表**。`messageId` 在 `:366` 算出来后，只被当作 `messageReplyMeta` 的 Map key（`:378`）用，从不参与「这条处理过没有」的判定。⇒ 服务端重放同一批，就重复 emit `incoming_message`，上层照单全收、重复入库、重复触发回复。
2. **两条结构性重放路径**：
   - `request_timeout`（`AbortError`）⇒ `:322-323` 只 warn + **2 秒后带着旧 `syncBuf` 重试**。长轮询下「服务端已推进游标、客户端没收到响应」就是 at-least-once，不是偶发。
   - `session_timeout` ⇒ `:306-308` `resetPollingCursor()` 把 `syncBuf` 清空（`:235-238`），重新同步时历史会再来一遍。
3. **为什么只看到「旧消息」**：`:361-364` 有 `timestamp < Date.now() - 15 分钟` 的窗口过滤 —— 挡住老消息、**放行 15 分钟内的重放**。知识库 09:13:22 → 09:16:07（2 分 45 秒）那一对正好落在窗口内，完全吻合。
4. **与「`messages` 表里只有 1 份记录」不矛盾**：出站重复不经过 `messages` 表；入站那两条本来就该是 2 行（知识库自己确认「两次 user 消息内容逐字相同」）。

**修法不动 schema**：入口加有界 `Set<messageId>`（保留最近 N 条），命中即 return。

**建议本迭代做掉**：①根因已定位，不等日志；②一个文件一个集合，不碰 schema；③手机端重复收消息是用户直接可见的缺陷，而「无去重」本身就是与是否真发生过重放无关的正确性缺口。

⇒ 已登记为 **S-291**，**待老大拍板是否本迭代开工**（按纪律，立项与否不自行拍板）。

### 20:35 · 刀序拟定，两条要拍板

刀序 0~14 见 `plan.md` §六。排序原则沿用 v3-iter-4：依赖优先、不确定性先暴露、改动面小的先做。

**0 = S-282（启动静默退出）** —— 它是「起不来」级别，且后面所有真机验证都可能要换数据目录，先通它。

**12 = S-285、13 = S-277、14 = S-265 三条卡住**：前两条动 schema / 分页口径（按纪律不自行拍板），第三条归因不明需完整请求体。

### 21:00 · 刀 0 收刀 —— S-282 启动静默退出

按需求单 §五 落地，**加了一处原方案没有的调整**：把「选哪个目录」抽成纯函数 `pickDataDir`（`src/shared/data-dir.ts`），主进程 `resolveDataDir()` 退成薄壳。

这一步不是顺手重构 —— §六 第 4 条要「补一条单测」，而 `resolveDataDir()` import 了 electron，node 下直接测不了。不拆就测不了，拆了才能把判据钉住。先例是 `project-dir.ts` 的 `pickProjectDirName`。

`pickDataDir` 返回 `{ fromEnv, value }` 而不是字符串，因为两种来源语义不同：env 是完整路径、默认值只是目录名。压成一个字符串只能靠 `isAbsolute()` 猜来源，`WISHFULCLAW_DATA_DIR=.\data` 会被拼到 home 下。

新门禁 `tests/data-dir`，**17 断言**，三块：目录名 2 条 / 来源与取值 11 条 / 源码行序闸 3 条。行序闸扫 `index.ts` 断言 `mkdirSync` < `app.setPath` < `app.requestSingleInstanceLock()` —— 这条修复的正确性全押在顺序上，挪一下缺陷就静默回来，而真机只表现为「双击没反应」。

**反向验证做了两次**：`fromEnv` 改 false ⇒ 红 `env 有值时必须标记 fromEnv=true`；`dataDirName` 三元写反 ⇒ 红 `打包版默认必须是 .wishful-claw`。撤销后复绿。

**踩到自己的坑**：套件第一次跑第一条就红 —— 我把 `dataDirName(isPackaged)` 的参数语义照 `projectDataDirName(isDev)` 抄反了。已在注释里点名两者的参数是相反的。

**订正一处口径**：本文件 §四 原写「根目录没有 `.sln`，只有 `tests\WishfulClaw.Tests.sln`」，实测 `src\runtime\WishfulClaw.sln` 也在，两套都得编。已改。

门禁：typecheck 0 错 / `npm test` **105/105** / 两套 sln 0 警告 0 错误 / `ci-checks` **81/81 通过**。

**未完成**：需求单 §六 真机第 1、2 条（指向全新数据目录启动）未跑，属真机范畴，命令已写进需求单 §八 末尾。
