# v3-iter-5：通信回执闭环 + 桌面坐标参照系 + 渲染链「每帧重做」收口

- 状态：已完成，已合并 main 并发布
- 分支：dev/v3-iter-5（已删除）
- Plan: docs/plans/iter-v3-5/plan.md
- VERDICT: PASS（自动化回归全绿 + dev 实例多轮实测；S-277 / S-265 / S-273 段 B 三条按「只出方案 / 缺证据 / 待拍板」移交）
- 产品版本: 1.0.5
- Tag: v1.0.5
- 日期: 2026-11-01
- 迭代定位：**三条线，一条共同的病根 —— 把「正确性」押在某个不会报错的地方。** 通信三连（S-278 / S-279 / S-280）修的是「回执靠 agent 自觉」；桌面两刀（S-272② / S-273 段 A）修的是「坐标靠模型自己估」；渲染那条线（S-247 / S-297）修的是「每帧重做一遍、反正不会报错」。三处的现象都是「看起来一切正常」，只有真机盯下去才看得见。

## 范围与功能单元（承接 15 条 / 实施 12 条 / 撤销 1 条 / 移交 6 条）

### 启动与显示层说假话（S-282 / S-289 / S-286，刀 0~2）

- **S-282 `WISHFULCLAW_DATA_DIR` 指向全新目录时静默退出（刀 0）** —— **阻断级，实测连踩两次**。`resolveDataPath` 只拼不建 ⇒ `SingletonLock` 父目录不存在 ⇒ 进程直接退出，**连日志都没建出来**（退出早于日志初始化）。修法 `mkdirSync(..., { recursive: true })`，且必须在 `requestSingleInstanceLock()` 之前。把「选哪个目录」抽成纯函数 `pickDataDir`（`src/shared/data-dir.ts`）才能 node 下单测；新增 `tests/data-dir` 17 断言，其中 3 条是**源码行序闸**（`mkdirSync` < `setPath` < `requestSingleInstanceLock`）—— 这条修复的正确性全押在顺序上
- **S-289 用量统计折线图未 hover 时圆点太大（刀 1）** —— 方案 A：整批 `buckets.map` 改成只画 `hoveredBucket` 那一列。连带去掉 `formatBucketLabel` 的死 import。无新增套件（需求单预先裁定：没有值得抽的纯判据）
- **S-286 桌面截图尺寸摘要取自 base64 ⇒ 极简档显示 `8×5`（刀 2）** —— 正则撞 base64 随机字节。锚定 `Captured desktop screenshot (\d+)x(\d+)`（加 `/i`）+ 摘要专用短路 `outputTextForSummary`。**刻意没动 `outputAsString`** —— 它还被 S-262 一线的结构化错误嗅探用着，短路会顺手废掉那处判据。新增 `tests/tool-call-summary` 11 断言

### 图片与截图链路（S-290 / S-288 / S-268 / S-294，刀 3~5 + 收尾补刀）

- **S-290 截图经能力代理调用时 image 块被 32 KB 截断（刀 3）** —— 落库出口与送模型出口不是同一份内容（日志实证 `originalBytes=712499 truncatedBytes=32768`）。方案 A：`ApplyToolOutputLimit` 最前面按「输出里存在带 `filePath` 的 image 块」**整份放行** —— 判内容不判工具名。顺带消掉一条更危险的分支：「spill 失败 → 无提示截断」对图片不再存在。新增 C# 套件 13 断言
- **S-288 聊天窗图片点开不能放大（刀 4）** —— 浮层拆 `ImageLightbox.tsx` 并换 `ImageViewer`（缩放 0.25~5 / 旋转 / 拖拽 / 复制），自己补下载。**顺带挖出真因**：`DialogContent` 自带 `sm:max-w-lg`，Tailwind 变体优先级压掉裸工具类 ⇒ `max-w-[95vw]` 在 ≥640px 视口一直无效，浮层长期只有 512px 宽。两处都补 `sm:max-w-[95vw]`
- **S-268 `DesktopScreenshot` 的 `path` 参数完全无效（刀 5）** —— 以为要补落盘，实际只缺一层透传（`persistImageBuffer` 早就支持 `targetPath`）。**假成功比报错更糟**。抽出 `ResolveCaptureTargetPath` 两处共用；`IsNullOrEmpty` 改 `IsNullOrWhiteSpace` —— 纯空白路径会被 `Path.Combine` + Windows 吃尾空格解析成工作目录本身，测试当场咬住
- **S-294 截图卡片点开后应是图片预览（收尾补刀）** —— 卡片按真实 output 形状解析（字符串先解码、窗口截图补路由），`result` 优先于 `input`，并且**不再把给模型看的坐标说明展示给用户**。三刀收口后卡片显示真实尺寸与图

### 桌面操作（S-272 第二段 / S-273 段 A，刀 6~7）

- **S-272 第二段 相对坐标 / 截图网格 / 窗口枚举（刀 6）** —— 本迭代参数面最大的一条。①`{x:0.62,y:0.28}` 按最近一次截图归一化，判据钉在纯函数 `resolveCoordinatePair`（**两个值都在 0~1 且至少一个不是整数**才算相对，整数仍按绝对像素解释）；②`grid: true` 在原图上画网格（自己写像素循环，不建离屏窗口用 canvas）；③`DesktopListWindows` + `DesktopScreenshot({ window })` 按物理像素裁剪。顺手把 `desktop-control.ts` 的截图线挪到 `desktop-screenshot.ts`、共享判据抽到 `desktop-screen.ts`。新增 `tests/screenshot-grid` 23 断言
- **S-273 段 A 自家窗口的元素树走 CDP（刀 7b）** —— 原方案（`IUIAutomation`）撞 AOT 硬约束：`System.Windows.Automation` 在 AOT 下不可用，手写 COM vtable 全仓零先例。改走 CDP `Accessibility.getFullAXTree` —— 主进程本来就拿得到 `webContents`，还不用开全局 a11y 开关。**段 B（第三方窗口走 `EnumChildWindows`）待拍板，移交**

### 全局会话 ↔ 项目会话通信（S-278 / S-279 / S-280，刀 8~10 + 刀 17）

一组，不许拆散：S-278 打底（meta 通道）、S-279 扩通道（`gm_` 分表）、S-280 借 meta 做强判据（归档层）。

- **S-278 派活消息不再是裸文本（刀 8）** —— wire 文本与 display 文本分开，协议说明移出正文；措辞收敛成一个渲染端源（`lib/tools/global-work-request.ts`）；`meta.globalDispatch` 落库、不进 Worker；来路徽章。新套件 `tests/global-dispatch-meta` 25 条，其中 3 条是**跨语言源码闸**（C# 与 TS 两份实现不许漂移）
- **S-279 普通消息也能回执（刀 9）** —— 走 **C 方案**：另建 `global_message_dispatches`（`CREATE TABLE IF NOT EXISTS`，零数据搬运），**不碰 `global_task_dispatches` 一个字节**（那张表的 `global_task_id` 是 `NOT NULL`，为一条约束重建它赌的是看板数据）。`DispatchTableRouter` 前缀路由只此一处；两套状态机抽公共层 `DispatchStatusMachine`。真 sqlite 回归覆盖建表幂等（**子进程二次启动**才测得出）
- **S-280 回执不再押在 agent 自觉上（刀 10）** —— `DispatchArchive.ArchiveImplicitCompletions(sessionId)` 在 `EmitLoopEndAsync` 收口，一把覆盖两张表。三条硬规矩：①显式永远覆盖隐式（`completed_implicit` **不算终态**）；②隐式必须标明「未显式回复」，徽章刻意用中性灰而不是绿色；③自动归档只写 dispatch 记录、不塞消息。**顺手修掉一个真缺陷**：`ResolveExplicitReply` 原先把 `completed_implicit` 退回 `acknowledged`，等于降级
- **刀 17 补课 —— 真机验收暴露的需求未达成** —— 判据写 `completed`、跑出来 `completed_implicit`：**不是判据写错，是需求没达成**。普通消息的 wire 正文里没有 `dispatchId`，工具描述还写着「不要用于普通用户消息」⇒ 结构上不可能回执。照抄 `send_work_request` 那套（`BuildSessionMessageWireText`，wire 带身份、界面不带协议）+ 回执卡片化。新开独立 C# 项目 `WishfulClaw.SessionMessageWireRegressionTests`（11 断言）—— 这条缺陷不报错、不抛异常，只有断言真字符串才抓得住

### 数据结构与持久化（S-285 落地 / S-277 只出方案）

- **S-285 助手消息块拆 `message_parts`（刀 11 + 11b）** —— 工具调用语义上是追加，而 `messages.meta` 是整行覆盖：一条 148 次工具调用的消息 = 148 次 upsert × 14.5 MB。**零迁移**：老消息走原路径逐字节不变，新消息只追加 parts。真机八步验完（基线 1124 条消息、`message_parts` 0 行、新消息 59 段、重启幂等）。**11b 补刀**：缺 `iteration` 的老段走负区间保序，clamp 到 99 会静默吞段
- **S-277 压缩产物永久累积（刀 12，只出方案）** —— 三个方案（`superseded_by` / 删旧行 / 纯渲染合并）各有代价，其中两个动 schema 或分页口径。**回填 SQL 已逐行写死**，标 v3-iter-6 第一刀候选

### 渲染与内存（S-247 / S-297）

- **S-247 内存占用异常偏高 —— 定性收口** —— 结论一句话：**这不是内存泄漏，是「每帧重做」**。生产构建 5 分钟末值 172.6 MB / 峰值 252.6 MB、跑完能还；按真实流式速率换算 ≈0.09 MB/s，落「<50 MB 正常成本」档。归因拿到两个硬数：①`MessageRow` 的 `React.memo` **有效**（「所有行重渲」被推翻）；②组件 inclusive 全 <1%。修的是三处每帧重建：渲染链签名、`message_parts` 先删后写、think 标签工具抽纯模块
- **S-297 搜索框关着也每帧重建会话列表（收尾补刀）** —— 宽订阅 `useChatStore((s) => s.sessions)`，A/B 摘订阅法实测占残量 58%。修法：`recent-sessions.ts` 里做 top-5 签名 + 关闭态短路。**真实修复 A/B 0.14 vs 0.34 MB/s**（贡献 0.20，与摘订阅法的 0.22 互相印证）。回归套件 14 断言
- **探针与后门清理** —— `__repro-harness.temp.ts` / `renderer-memory-probe.ts`（93 行）删除，`main.tsx` 回到 9 行无 dev-only import；构建产物扫 `__harness|__repro|startRendererMemoryProbe` 0 命中

### 只勘察 / 撤销 / 未动工

- **S-265 裸 body 400（刀 13，只勘察）** —— 能定死的只有「两种 400 的耗时分布完全不重叠」（裸 body 36~52 s / 图像类 2.7~7.6 s），缺 `input_tokens` / `context_cap_tokens`，本地复现不了。**缺证据之前任何实现都是猜**，移交
- **S-281 主窗口 `backdrop-blur-xl`（已撤销）** —— 前提不成立。全仓 30 处 `backdrop-blur` 逐处走完，**没有一处压在不透明底上**。需求单保留供溯源。**流程教训比需求本身值钱**：这是「grep 到匹配就下结论、没打开文件确认是哪个入口」的产物，路径少写 `clipboard/` 一段，结论就翻了个个儿

## 工程收口

- **门禁的价值再次被验证**：S-268 的「纯空白路径被解析成工作目录」是测试咬住的；S-279 的建表幂等必须**起子进程**才测得出（`DbClient.Initialize` 有幂等早退）；刀 17 的缺陷**不报错不抛异常**，只能断言真字符串。凡新增闸一律做**反向验证**（把实现改回错误版本必须变红），本迭代共做了 11 次
- **跨语言判据只能两侧各写一遍**：S-276 那轮定的口径延续到 S-278 —— C# 与 TS 共用不了函数，靠注释互相指名 + 两套回归守
- **测试套件 104 → 119**（`npm test` 全程绿）。新增：`WishfulClaw.SessionMessageWireRegressionTests` 11 断言、`WishfulClaw.ToolOutputLimitRegressionTests` 13、`WishfulClaw.CaptureTargetPathRegressionTests` 14、`WishfulClaw.DispatchRouterRegressionTests` 72 检查、`screenshot-grid` 23、`data-dir` 17、`image-lightbox` 13、`tool-call-summary` 11→15、`search-recent-sessions` 14、`sidebar-session-signature` 10、`message-parts`、`desktop-ax-elements` 35；扩面：`global-dispatch-meta` 25→37、`render-density`
- **`ci-checks` 81 → 90 条**
- **500 行上限**：新拆出的 `desktop-screenshot.ts` / `desktop-screen.ts` / `image-lightbox.tsx` / `recent-sessions.ts` 全部在 500 行内，无需豁免
- **PowerShell 读写文本的老坑又踩了两次**（S-290 §8.4 / S-288）：`Copy-Item` 还原保留 mtime ⇒ MSBuild 不重编、跑的是坏 dll；`Set-Content` 按 ANSI 写 ⇒ 中文注释整片乱码。规矩升级成硬约束：**任何文本文件都不用 PowerShell 做读改写**。收尾审查时抓到 `package.json` 的 `description` 被这条坑写成 mojibake，已按字节修复

## 验证

- `npm run typecheck`（node + web 两配置）**0 错误**
- `npm test` **119/119**
- `dotnet build src/runtime/WishfulClaw.sln` 与 `dotnet build tests/WishfulClaw.Tests.sln` 各 **0 警告 0 错误**
- `node scripts/ci-checks.mjs` **90/90 通过**
- 格式：新增与大改文件全部 CRLF / UTF-8 无 BOM / 裸 LF = 0
- 官网本迭代**零改动** ⇒ 发版只走 `installer`，不重发站点
- 真机口径（老大定）：dev 实例上反复跑过的即「dev 实测通过」。已过：S-282（4 条）、S-285（8 步）、S-279（含操作 9 显式回执 + 卡片化）、S-280（隐式归档 + 补显式）、S-286 / S-290 / S-294（截图一条龙）、S-288（图片放大）、S-289（折线图）、S-272② / S-273 段 A（点自己页面）、S-247（内存跑完能还）、S-297

## 遗留

- **S-273 段 B 未做** —— 第三方窗口的元素树要 `EnumChildWindows`（只覆盖 Win32 控件，Chromium 系第三方窗口拿不到），拍板前不动
- **S-277 回填未执行** —— SQL 已写死，**回填不可逆**，执行前必须备份库并先出 `COUNT(*)` 基线
- **S-265 取证未做** —— 缺 `input_tokens` / `context_cap_tokens` 与完整请求体，加列属 schema 范畴
- **S-291 渠道消息重复投递** —— 根因已读码定性（长轮询 at-least-once + 无 `messageId` 去重），修法不动 schema，但要真机发消息才验得了
- **S-293 preview / dev 污染生产库 schema** —— 生产库里出现只存在于本迭代 DDL 的两张空表，`pickDataDir` 要加「非打包构建指向已存在的生产目录则拒绝或告警」
- **S-295 Electron → Avalonia 评估** —— 研究型，只出报告
- **S-296 `tests/**` 不在任何 tsconfig 里** —— 88 个套件从没编译过，断言写错会恒真
- **S-292 插件「压缩会话」no-op** —— 依赖 S-285 的块结构，前置已解除，设计要重做
- **S-233 聊天窗抖动仍未关闭** —— 频率低、只在新版本第一个会话偶发，与 S-274 根因不同；重开前必须先补两处判据盲区
- **S-230 Qoder 接入阻塞** —— 缺契约
- **S-233 / S-230 之外的挂账口径**：两条都待专门迭代，不占刀序

## 发布

待补（收尾后另落一刀）。
