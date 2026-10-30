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

### 21:10 · 刀 1（S-281）未动工 —— 前提不成立，改判待拍板

按方案 A 去删 `backdrop-blur-xl`，第一步就没找到目标：需求单引的 `src/renderer/src/main.tsx:196/:302` **全文只有 10 行**（`createRoot(...).render(<App />)`），没有任何 JSX 根容器。

真正带这段 class 的是 **`src/renderer/src/clipboard/main.tsx:196/:302`** —— **剪贴板浮窗**的独立入口（`electron.vite.config.ts:36`），而它的窗口是 `transparent: true`（`clipboard-enhancer.ts:588`）。那层模糊**真有用**，而且就是需求单 §八 自己点名「不能动」的对象。

主窗口这条线 `App.tsx → MainLayout` 全链**没有** `backdrop-blur`。

§六 那 20 处也逐一看完了（实际 30 处，这段时间新增了弹层）：弹层/浮层约 18、吸顶条/标题栏约 8、小面积元素约 4、透明浮窗根容器 2 —— **没有一处压在不透明底上**，§三 描述的「纯烧管线」在当前代码里不存在。

⇒ 建议**撤销**本条，不是顺延。按纪律「哪条该砍不自行拍板」，**留档未删、未改代码**，等老大点头。教训已写进 S-281 §九 末尾：grep 命中要先 `Read` 那行再定性，路径少一段就能把结论翻个个儿。

### 21:15 · 刀 2 收刀 —— S-289 折线图圆点

方案 A 原样落地：`line-chart.tsx` 里整批 `item.buckets.map(...)` 换成「只画 `hoveredBucket` 那一列，且该列在这个系列里存在」。未交互时图上只剩折线。

**连带一处必须改**：删掉每点 `<title>` 后 `formatBucketLabel` 在本文件再无引用，import 一并去掉 —— 否则 `tsc` 未使用检查会红。这类「删点即塌一处 import」是纯渲染改动的固定尾巴。

保留未动：`:69` 的 `<title>{modelSeriesLabel(item)}</title>` 是**整条线**的无障碍标签不是点提示；`interval` 仍被 tooltip 与时间轴用；`preserveAspectRatio="none"` 按 §五 不碰。

§五 里那个「顺手可选」的 `role="img"` + `aria-label` **没做** —— 需求单写的是「不加也行」，本轮只做本体不扩面。

**无新增门禁、无反向验证**：需求单 §五 预先裁定不新增套件（没有值得抽的纯判据，抽出 `shouldRenderDot()` 只会造一次性导出）。这是裁定不是漏做。

门禁：`typecheck:web` 0 错 / `npm test` **105/105** / `ci-checks` **81/81 通过**。

真机 4 条未跑（不碰图无点 / 横向移动只有一列有点 / 移出全消失 / 切柱状图再切回无残留）。

### 21:25 · 刀 3 收刀 —— S-286 截图尺寸显示 `8×5`

4.1 主修：裸 `(\d+)x(\d+)` 换成锚定 `Captured desktop screenshot\s+(\d+)\s*x\s*(\d+)`，加 `/i`（文案由 C# 拼，大小写不该决定成败）。base64 字符集不含空格，`Captured desktop screenshot` 这个短语不可能藏在 `data` 里，锚定即安全。

4.2 补刀**和需求单的字面写法有偏差，得记一笔**：需求单说「在 `outputAsString` 加短路」，但 `outputAsString` 有两个调用点 —— `hasStructuredOutputError` 要拿原串 `decodeStructuredToolResult` 找 `success:false` / `exitCode!==0`。在那儿短路等于顺手废掉 S-262 一线留下的结构化错误嗅探。所以改成新增**摘要专用**的 `outputTextForSummary()`，`outputAsString` 一字未动。

两处豁免：桌面截图（要原串取尺寸）、Bash/Shell/PowerShell（输出本身就是结构化 JSON，摘要要从里面取退出码和首行错误）。

判据也比需求单多一条：`长度>4096` + `开头 [{ 或 {"` + **`含 "base64"`**。第三条是我加的 —— 否则任何 4 KB 以上的普通 JSON 输出都被短路，误伤面比收益大。

**4.2 老实说对现有分支没有可观察效果**：读 output 的三个分支里桌面截图和命令行都豁免了，`LS` 输出是文件名列表。它是给将来新增工具摘要留的护栏，注释里写明，不冒充成修了什么。

新门禁 `tests/tool-call-summary`，**11 断言**。`tool-call-summary` 为 `coerceAskUserQuestions` 引了 `ask-user-tool`，后者拖 `locales`（`import.meta.glob`）⇒ node 下炸，照 `tool-run-folding` 先例加 `stubs/ask-user-tool.ts` 顶掉。

**踩到一次自己的期望错误**：第 9 条我按「Bash 摘要只读入参」写，实际 `summarizeBashInput` 有输出时会拼「命令 — 首行」，红了一次。改成真正要守的东西（Bash 输出里的 `8x5` 不许被渲染成尺寸样式）。

**反向验证**：锚定正则退回裸正则 ⇒ `桌面截图摘要必须取文案里的 2520×1680，不能被 base64 里的 8x5 带跑` 当场红，撤销后复绿。

门禁：typecheck 0 错 / `npm test` **106/106** / 两套 sln 0 警告 0 错误 / `ci-checks` 全过。

真机 §六 4 条未跑。

### 21:12 · 刀 4 收刀 —— S-290 截图 image 块被 32 KB 截断

`ApplyToolOutputLimit` 最前面加 `if (HasRecoverableImageBlock(output)) return output;`。**整份放行，不是需求单 §四 写的「只截文本块」** —— 拆块要 `JSON.parse` 700 KB 再序列化回去，而这个函数挂在每一次工具返回上；要截的那段“文本块”本身就是一行尺寸摘要，几百字节，截它没收益。结论一致，路径更短。将来真出现「图 + 几十 KB 文本」再补真拆块（§8.1）。

判据两次子串扫描、不解析 JSON：`len>=32` → 含 `"type":"image"` → 含 `"filePath":"` → **值非空**。`"filePath":""`（S-284 剥 data 后的落库形态）不算，空路径取不回任何东西。判据**看内容不看工具名**，`use_capability` 代理 / 直接调 `DesktopScreenshot` / `Read` 三条都豁免。

**顺手消掉一条静默错误分支**：豁免排在 `SpillToolOutput` 之前 ⇒ 带 `filePath` 的块压根不走 spill ⇒ 「spill 失败 → 退回无提示截断」那条路对图片不再存在。

新门禁 `tests/WishfulClaw.ToolOutputLimitRegressionTests` **13 断言**（`InternalsVisibleTo` + `dotnet sln add`，`run-tests.mjs` 按目录名自动发现）。里面 4 条是反证 —— 空路径不豁免、无路径不豁免、200 KB 纯文本照旧限流、小/空输出原样返回。

**反向验证**：守卫末句改 `return false` ⇒ 红 `带 filePath 的 image 块必须原样放行（原 700197 字符，实得 32754）`，与真机日志 `originalBytes=712499 truncatedBytes=32768` 同形。

**踩了个大坑，写进 §8.4**：`Copy-Item` 还原备份**保留源 mtime** ⇒ 比编译产物旧 ⇒ MSBuild 不重编 ⇒ 跑的还是反向验证那份坏 dll。更迷惑的是中途顺手用 PS `Set-Content` 改 C# 源码，PS 5.1 默认 ANSI 把 spill notice 的 `—` 写坏，导致那份坏 dll 把 `Goal` 套件一起带红（`the spill notice exposes a locator between the expected markers`），一度以为是连带缺陷。规矩：① 还原后 touch；② 改 C# 源码禁用 `Set-Content`。

门禁：typecheck 0 错 / `npm test` **107/107** / 两套 sln 0 警告 0 错误 / `ci-checks` **82/82 通过**。

真机 §九 5 条未跑（第一轮就能看图 / 日志不再 `truncatedBytes=32768` / 落库 meta 仍小 / 纯文本网页照旧截断 / spill 目录不可写时仍能看图）。

### 21:40 · 刀 5 收刀 —— S-288 图片点开不能放大

`ImagePreview.tsx` 436 → **365 行**，浮层搬进新文件 `ImageLightbox.tsx`（171 行），两个都在 500 行内、不用豁免头。有 `filePath` 走 `Dialog` + `ImageViewer`（缩放 0.25~5 / 旋转 / 最大化 / 复制 / 拖拽），没 `filePath` 保留原 `object-contain`。

按 §四 倾向 ②：**没给 `ImageViewer` 加 `src` 入参**。另两处入口都用 `filePath`，加覆盖源要连带改它们的取图与 canvas 复制（`oc-media://` 有 taint 风险）。而「缩略看得见、浮层读不到」这个组合不会出现 —— 缩略本身就走 `oc-media://`。

`ImageViewer` 没有下载，浮层自己补一个按钮（`right-12` 让开内置关闭 X），复用原 `handleDownload`，四条能力才齐。

**顺带挖出真因，得单独记一笔**：`DialogContent` 自带 `sm:max-w-lg`，Tailwind 变体优先级高于裸工具类 ⇒ `LocalImagePreviewDialog` 那句 `max-w-[95vw]` **在 ≥640px 视口一直无效**，浮层长期只有 512px 宽。这不是「图能不能缩放」的问题，是「盒子本身就这么小」。两处都补 `sm:max-w-[95vw]`。属于需求单 §五 候选 3 的入口，但根因一致，不修等于没解决。

缩略加 `max-h-[320px]`，`aspectRatio` 保留（去掉就是 S-233 那类抖）。横图 341px 压到 320、左右留 16px 底色 —— 不裁切。

新门禁 `tests/image-lightbox` **13 断言**，源码闸（纯 className 缺陷抽不出纯函数，先例 `tests/data-dir` 的行序闸）。反面验证：删掉 `sm:max-w-[95vw]` ⇒ 红，加回复绿。

**又踩了同一个坑**：反向验证时用 `(Get-Content -Raw) -replace | Set-Content` 改 `.tsx` —— PS 5.1 按 ANSI 解码 ⇒ 中文注释整片乱码，`-Encoding UTF8` 又加 BOM，整个文件重写才复原。规矩升级成硬约束：**任何文本文件都不用 PowerShell 做读改写**（见 S-290 §8.5 同款记录）。

门禁：typecheck 0 错 / `npm test` **108/108** / 两套 sln 0 警告 0 错误 / `ci-checks` 全过。

真机 §九 5 条未跑。

### 22:20 · 刀 6 收刀 —— S-268 截图的 `path` 一直是死的

**以为要补落盘，实际只缺一个透传。** `persistImageBuffer`（`src/main/lib/image-persist.ts:59`）早就支持 `targetPath`，`CaptureAppWindow` 一直在用；`DesktopScreenshot` 这条链从 `AgentRuntimeDesktopExecutor` 到 `native-agent-runtime.ts` 再到 `captureDesktopScreenshot()` 三处都没把 `path` 往下带 —— 模型填了、工具回包说成功、文件落在默认目录。**假成功比报错更糟**，它会让模型以为图已经在指定位置，接着去读就扑空。

改动比登记时估的小：抽出 `ResolveCaptureTargetPath(requestedPath, workingFolder)` 两处共用（原来 8 行内联在 `ExecuteAppWindowCaptureAsync` 里），补一层参数透传，描述跟 `CaptureAppWindow` 口径对齐。顺手把 `delayMs` 的 "Capped at 5000" 写进描述 —— 代码早就有 clamp，描述里一直没说。

**不新增沙箱审批**：`CaptureAppWindow` 落盘从来没经过审批，给截图单独加一道只有它才有的关卡没有道理。§五 这条待查项结论就是「不用」。

**实施中撞到一个真边界，且当场被测试咬住。** 第一版用 `string.IsNullOrEmpty` 判空：`path = "   "` 不是空串 ⇒ `Path.Combine(baseDir, "   ")` ⇒ Windows 吃掉尾部空格 ⇒ **解析结果等于工作目录本身**。于是「工作目录」被当成目标文件路径。测试第 10 条直接红，改 `IsNullOrWhiteSpace`。

调用点其实已经 `.Trim()` 过，现实中撞不到 —— 但这正是把判据写进纯函数的价值：以后谁新加调用点忘了 Trim，函数自己扛住。

新门禁 `tests/WishfulClaw.CaptureTargetPathRegressionTests` **14 断言**，反向验证两次都红（`baseDir` 写死 cwd ⇒ 相对路径断言红；判空退回 `IsNullOrEmpty` ⇒ 纯空白断言红）。

门禁：typecheck 0 错 / `npm test` **109/109** / 两套 sln 0 警告 0 错误 / `ci-checks` 全过。

真机 §九 5 条未跑。

### 21:53 · 刀 7 收刀 —— S-272 第二段（相对坐标 / 截图网格 / 窗口枚举）

**刀 6 修的是「假成功」，这一刀修的是「成功但点偏」。** 模型看的是被上游缩过的图，报出来的像素数天然不等于 PNG 的像素 —— 这个偏差靠描述怎么写都消不掉，只能给它参照系。

**三件落地**：

- **相对坐标**：`DesktopClick({ x: 0.62, y: 0.28 })` 现在按「最近一次截图的实际尺寸 + 图片原点」换算。判据钉在纯函数 `resolveCoordinatePair`（`src/main/lib/desktop-coordinate.ts`）：两个值都在 0~1 且**至少一个不是整数**才算相对。整数仍按绝对像素解释，向后兼容。特意写了 `{x:0, y:0.5}` 这一条 —— 最自然的「左边中点」写法，判据写歪一点就会退化成屏幕左上角，而现象只是「点偏了」，日志里查不出来。
- **截图网格**：`DesktopScreenshot({ grid: true })` 在原图上画淡灰网格、每 200px 一条、边缘标刻度。**自己写像素循环，不建离屏窗口用 canvas**：离屏 `BrowserWindow` 要走 GPU、要处理 DPI 与 `capturePage()` 的尺寸语义（`getSize()` 是 DIP 还是物理像素至今没定论），为几条线开一个窗口不划算。灰是三通道同权混合 ⇒ BGRA / RGBA 不用判平台。
- **窗口枚举 + 按窗口截图**：新工具 `DesktopListWindows({ match? })` 给 `title / className / processId / rect`；`DesktopScreenshot({ window: "记事本" })` 按标题子串选窗口、按物理像素裁剪，文本前缀换成 `Captured window "标题" WxH`。把搜索空间从 2560×1440 缩到一个窗口。

**顺手拆了文件**：`desktop-control.ts` 395 行、截图与输入两条线混在一起，这轮 `grid` / `window` 一进来必然破 500 行。截整条线挪到 `src/main/ipc/desktop-screenshot.ts`，`desktop-control.ts` 退回纯输入模块；`toPhysicalRect` / `isPointInsideDesktop` 抽到 `src/main/lib/desktop-screen.ts` 两处共用 —— 否则就是「截图 import 输入模块」的怪形状。

**新门禁** `tests/screenshot-grid` **23 断言**（网格线位 / 入参不被污染 / 尺寸非法原样返回 / 相对与绝对的分界 / NaN 与 Infinity 不许流进点击）。反向验证做了一次：相对判据从 `||` 改成 `&&` ⇒ `{x:0, y:0.5}` 那条当场红。
`tests/tool-call-summary` 补 4 条（窗口截图带标题、标题含空格点号、`DesktopListWindows` 带/不带过滤词）。

极简档不另开分支：桌面类工具本来就走「一行文本摘要」的降级，新工具进 `DESKTOP_ACTION_TOOL_NAMES` 即可，摘要由 `summarizeDesktopAction` 出。

**已知残留**：`DesktopListWindows` 会把最小化窗口也列出来（矩形是 `-32000`），模型可能对着屏幕外算坐标。归因清楚、改动面一处，**留 v3-iter-6**，不在这轮收尾期发散。

门禁：typecheck 0 错 / `npm test` **110/110** / 两套 sln 0 警告 0 错误 / `ci-checks` 84/84。

真机判据 9、10 未跑（窗口矩形一致性、全链路自己截屏点输入框）。

