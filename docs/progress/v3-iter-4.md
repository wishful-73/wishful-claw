# v3-iter-4：插件基座落地 + 上下文与图片链路收口

- 状态：已完成，已合并 main 并发布
- 分支：dev/v3-iter-4（已删除）
- Plan: docs/plans/iter-v3-4/plan.md
- VERDICT: PASS（自动化回归全绿 + dev 实例 20 轮以上实测；插件线五条按「基座已交付，真机验收待插件落地」放行）
- 产品版本: 1.0.4
- Tag: v1.0.4
- 日期: 2026-10-30
- 迭代定位：**三条线并行，一条共同主题 —— 坏数据不许出门。** 插件基座五条把「给 agent 用的插件」扩成「带 UI、用户自己用的插件」，是下个代际的功能地基；上下文与图片链路一整条（400 / 脏图 / 压缩 / 窗口计数）修的是同一件事 —— 坏输入、坏输出、超预算的东西都不许进会话；渲染与性能那条线则由 S-274 的崩溃级缺陷定义，它顺带纠了本迭代自己犯的错：**「极简模式＝性能方案」这条口径是错的**。

## 范围与功能单元（承接 24 条 / 实施 24 条 / 移交下迭代 15 条）

### 插件基座（S-240 ~ S-244，5 条）

- **S-243 探路先行（刀 0，只测不改码）** —— Windows 系统内录是整迭代最大不确定项，开工前一次性打掉：纯音频 `getDisplayMedia({audio:true})` **直接抛 `AbortError`**，必须先要 video 再丢掉 video track；loopback 与麦克风实测都是 48 kHz / 1 ch，但实现一律按 `track.getSettings()` 动态取值，不写死单声道。结论写进 `exploration_findings.md` §1.7 与 `S-243.md` §3.3 / §4.3 / §6 —— 这刀省掉了一条「引入原生 WASAPI」的弯路
- **S-240 清单扩展与导轨入口（刀 1）** —— 地基，其余四条全依赖它。阻断点是 `ExtensionManifestNormalizer.cs:52-55` 的 `tools.Count == 0` 强校验 + `:60-105` 字段白名单，三处（TS 契约 / `ExtensionModels.cs` / 归一化器）必须同刀改。9 个文件 + 新增回归套件
- **S-241 视图独立窗口与生命周期（刀 2）** —— 主进程新增 `plugin-window` / `plugin-view-rules` / `plugin-lifecycle` / `plugin-view-handlers` 四件。**门禁抓到一条 typecheck 抓不到的真缺陷**：四个 channel 漏进 `MESSAGEPACK_INVOKE_CHANNELS`，`test:ipc-msgpack-routing` 当场拒 —— 这条是本迭代「门禁比人可靠」最干净的一个证据
- **S-242 资产下载器（刀 3）** —— 状态机 + 多源回退 + Range 续传 + 流式 sha256 + 并发闸门 2 + 取消保留 `.part`；七个 IPC 动作 + 进度广播。落盘根 `~/.wishful-claw/plugin-assets/`，`test:plugin-assets` 用本地 http server **真下载** 38 断言
- **S-243 录音落地（刀 4）** —— 照刀 0 结论写，不引入原生 WASAPI。新增 `plugin-audio-wav`（纯 node 可测）/ `plugin-audio`（electron 侧 loopback 与落盘）/ `plugin-audio-handlers` / 渲染端 `audio-recorder`。46 断言：44 字节头逐字段、17 s 按 5 s 切段得 5/5/5/2、空录音不建文件
- **S-244 安装确认与卸载清理（刀 5）** —— 卸载顺序钉死（停用收进程 → 关窗口 → 清 session 分区 → C# 删目录 / state / KV），清理失败只回 `cleanupWarnings`，不影响卸载结果；安装前确认弹窗按 id 记住勾选。`test:plugin-cleanup` **96 断言**含 19 个必须拒绝的 id。**纠一处旧结论**：KV / secret 其实 C# 早就清了，本号真正缺的只有 session 分区

### 上下文与图片链路（S-261 ~ S-269 / S-275 / S-276 / S-283 / S-284，12 条）

同一条线的五层收口，刀序刻意连排（1b ~ 1g / 3b / 15 ~ 18），分开做会把同一份判据改三遍：

- **S-261 脏图 400 之后自愈缺失（刀 1b）** —— 一张坏图卡死整个会话。线上已发生的真缺陷，不是待验功能
- **S-262 400 请求级拒绝（刀 1c）** —— 把失败变成 agent 的观察，而不是会话的死刑。`ProviderRejection` 套件 39 → 43 断言钉住判据、指纹去重、替换语义、三道安全阀
- **1g 补正（刀 1g）** —— 1b ~ 1f 判决「真机生效」后，dev 第 6 轮审查点出三处「修了却没修完」：S-261 的 url 闸漏了 `OpenAIResponsesInputWriter` 的用户消息路径、S-266 的判据只活在 `Read` 工具里而真实日志 13/18 条走微信渠道、S-262 的一次性消费仍没动。**三处都不是新需求，是同一条线的收口** —— 一次性补齐：`IsSendableImageBlock` 作为单块判据接管四处、`HasCompleteContainerInBase64` 只解头尾窗口、S-262 改成按 `ToolUseId` 记死撑满整个 run
- **S-263 侧栏一收起就白屏（刀 1d）** —— S-240 的回归缺陷，hooks 被追加在 early return 之后。改动只落一个文件，但它挡住后面所有真机验证，必须紧接 1c
- **S-264 脏图源头治理（刀 1e）** —— 宁可标读图失败，也不把脏图送上上游。三层同改（工具层 / 组包层 / 记忆层）。**发布前必须做完的真理由**：它顺带消掉「一张脏图把能看图的模型永久标瞎」这个**不可逆**副作用
- **S-266 没写完的图（刀 1f）** —— 签名合法但容器不完整，照样内联出门。补 `HasCompleteContainer`（PNG IEND / JPEG EOI / GIF trailer / WebP RIFF 长度）+ `ReadImage` 第五档；测试里现造了一个最小 PNG 编码器（stored deflate + CRC32 + Adler-32）
- **S-267 截图成功但页面是白的（刀 1g 顺路）** —— 工具报成功、实际什么都没画。`browser-screenshot-blank.ts`（白图抽样 + DOM 探针），`executeBrowserScreenshot` 尾部拼警告
- **S-269 摘要请求被 429 拒绝后降级成「摘要器不可用」（刀 3b）** —— 老大 10-29 一天撞了五波，所有长会话用户都会撞。`SummaryFailurePolicy` 纯函数分流（429 / 5xx 原样重发、只有 `context_length_exceeded` 才砍预算、真 400 直接放弃）；非 2xx 改抛 `ProviderHttpException` 保住状态码与 `Retry-After`；失败原因透传进 `context_compressed` 事件，渲染端按档位给文案。`SummarizerRetryChecks` 24 断言
- **S-283 截图落盘返回路径（刀 15）** —— S-275 的**硬前置**：压缩占位文案会写「可重新 Read 查看」，图不落盘这句就是假的。新增 `lib/screenshot-dir.ts` 纯函数 + `image-persist.ts` 可选 `fileName`；`captureDesktopScreenshot` 与窗口捕获的 `targetPath` 为空分支改成**默认落盘**
- **S-275 压缩对图片工具结果无效（刀 16）** —— 病根：尾部预算把 image block 的 base64 长度当 token 算，一条截图 24 万字符 ≈ 24 万 token，是 16384 预算的 15 倍；而 `minKeep = 2` 又让尾部两条绕开预算，一次 Read 正好就是那两条。新增 `ContextCompression.ImagePlaceholder.cs`：超预算的 image block **就地占位化**，不拆 `tool_use` / `tool_result` 配对。**测试抓到真 bug**：第一版「遇到图才建列表」把第一张图之前的 `text` 块全丢了
- **S-276 聊天窗「最近 N 轮」把压缩摘要当用户轮（刀 17）** —— 打开会话满屏「任务暂告一段落」。四处判据都只看 `role = 'user'`：渲染层 `trimMessagesToRecentTurns`、worker `totalTurns` / 窗口起点两分支 / `hasMore`。**跨语言共用不了函数** ⇒ 两侧各自实现 + 各配一套回归，注释互相指名；不加 `is_artifact` 列，走 `meta LIKE`，零迁移。反向验证：谓词退回 `role='user'` ⇒ `expected 6, actual 14` 当场红
- **S-284 图片块补 `filePath`（刀 18）** —— 刀 15 只把路径写进了**文字行**，本条把路径补进 image block 的 `source`，剥离器的条件才第一次真正满足。`stripStringifiedJson` 处理字符串化 JSON（三道廉价判据，解析失败原样返回）。**真库实测 14.34 MB → 1.41 MB（−90.2%）**，32 个 image 块全部剥净、0 残留

### 渲染形态与性能（S-247 / S-248 / S-256 / S-260 / S-270 / S-271 / S-272 / S-274，7 条 + 1 条第一段）

- **S-274 长文本流式时渲染进程涨到 4.3 GB 并崩溃（刀 13 + 14）** —— 本迭代唯一崩溃级缺陷，也纠正了本迭代自己的一条口径。刀 13 只夹住 `scrollTop`（四处写入点全部先夹 + 把「已钉底」守卫改为对夹取后的值比较）；刀 14 才查出真正的放大器：流式中尾部行每帧都在长 ⇒ `measureVisibleMessageHeights()` **每帧**返 `changed` ⇒ `assistantRailMeasureVersion` 每帧 +1 ⇒ 整条消息列表每帧重算重渲染；而三处写 `scrollTop` 都派发 scroll 事件 → `handleListScroll` → `requestAssistantRailSync` → 再测 → 版本再 +1，**不需要任何新内容就能自持**。修法：150 ms 节流 + 程序化滚动窗口内跳过 rail 同步 + 尾调用定时器随卸载清理。**实测 3.85 GB → 1.3 GB**。**「极简档治不了它」** —— 极简减的是每条消息的 DOM 量，条数与重渲染**频率**都不变
- **S-248 纯文本档换形态（刀 8）** —— S-225 的返工补丁：8 个 policy 字段全是布尔，`text` 档只是把卡片变窄。改为形态轴 `card | line`（只有 `text` 走 `line`）+ `process-text-line.tsx` 行渲染 + 折叠面板内间距归零。**发现并订正一处口径冲突**：S-225 的「force 项浮出面板」会把报错弹回卡片，`text` 档收窄为「只有仍需卡片的项才浮出」，错误留在面板里当红行。`tests/render-density` 14 → 19 组
- **S-256 模型输出超长文本时整页像截图一样静止（刀 9）** —— 症状与 v2-36 的 S-149 逐字重合。允许改 `tests/streaming-render-pool/program.ts:57,68` 的「不设步长上限」契约，**且同刀修根因 B**（tail 永不 settle）
- **S-270 新工具在聊天窗显示英文名（刀 10）** —— 中文标签表停在 OpenCowork 迁移期。补 **124 条**中文标签（zh / en 对齐）+ 统一出口 `lib/tools/tool-display-name.ts` + 七个渲染点接入。**两次补正**：①原闸只扫 TS 侧，漏了 **C# 侧 61 个第一方工具**（Cron / SubAgent / goal / 全局任务 / 飞书 / 微信 / Terminal / Monitor 全在 C# 里声明）；②状态栏两处一直只调 `resolveProxyStatusName()`，非代理工具原样返回 ⇒ 卡片中文化了、状态栏还在念 `BrowserNavigate`，新增 `resolveStatusToolName()`（先拆代理再过统一出口，顺序不能反）。闸都做过反向验证
- **S-271 失败的工具调用会从折叠块里跳出来（刀 11）** —— 三处判据不同步。`getToolCategory` 去掉 `hasError` 入参与分支，只留 `pending_approval` / `requiresApproval` 判 `attention`；`ToolExecutionRun` 新增 `failedCount`（只数可见项）+ 折叠头红色 `XCircle` 与「M 个失败」徽章。**口径随之改为「失败不脱离折叠，用 run 级徽章保可见」**
- **S-272 桌面坐标算不出来（刀 12，只做第一段）** —— 截图不给参照系，模型只能对着图瞎猜。第一段：`scaleFactor` + 每屏物理矩形 + `toPhysicalRect()`（`dipToScreenRect` 优先，回退 `bounds × scaleFactor`）+ 截图文本补 origin / scale / 每屏矩形 + 末尾给模型直接指令「坐标就是这张图里的像素，不要重新缩放」。**第二段（`grid` / `window` / 相对坐标三个参数）要加参数、随机化面大，按规则移到下个迭代**
- **S-247 内存占用异常偏高（刀 6）** —— 第一阶段交「看得见」：`memory-shape` 纯函数 + `memory-monitor`（`app.getAppMetrics()` + 早就存在但没人调的 `worker/memory`，5 s 采样、5 分钟落日志、超阈值 Warn 同 pid 10 分钟去重）。**落地时改了形态**：原拍「状态面板常驻数字」，实际做成设置页「关于 → 资源与诊断」页签 —— 场景是事后复盘与用户报障，不是实时盯，采样与日志不依赖面板打开。36 断言钉住单位、类型映射、阈值边界三类「不抛异常只会说谎」的坑
- **S-260 内置浏览器保活池（刀 7）** —— `browser-keepalive.ts` 纯判据 141 行：上限 2、目标已在池中即幂等、可见作用域与 leased 绝不淘汰、空闲 5 分钟回收、一个都不许动时给结构化说明。名额没拿到时渲染占位卡（不静默空白）。工具侧 lease 用 `try/finally` 包住整个调用。**纠一处与需求冲突的口头说法**：plan 原写「不做 LRU」与需求 §4.2 淘汰分级表矛盾，以需求为准 —— 软淘汰确实做了，缺 lease 时才轮到「拒绝 + 告知」

## 工程收口

- **门禁的价值在这一迭代被反复验证**：S-241 的 `MESSAGEPACK_INVOKE_CHANNELS` 漏项 typecheck 抓不到，只有 `test:ipc-msgpack-routing` 会拒；S-275 的「第一张图之前的 text 块全丢」是 `CompactionImagePlaceholder` 两条断言当场红的，不是人眼发现的。凡新增闸一律做**反向验证**（把实现改回错误版本必须变红），本迭代共做了 9 次
- **跨语言判据只能两侧各写一遍**：S-276 的「只数真实用户消息」在 TS 与 C# 各有一份实现（渲染层 `isRealUserTurn` / worker `RealUserTurnPredicate` 常量），共用不了函数，靠注释互相指名 + 两套回归守。**不为好看加 `is_artifact` 列** —— 走 `meta LIKE`，零迁移
- **测试套件 89 → 104**（`npm test` 全程绿）。主要新增：`plugin-cleanup` 96 断言、`plugin-audio` 46、`plugin-assets` 38、`memory-monitor` 36、`browser-keepalive` 36、`CompactionImagePlaceholder` 26、`SummarizerRetryChecks` 24、`plugin-view-rules` 22、`RealUserTurnRegressionTests` 21、`screenshot-dir` 16、`tool-run-folding` 12、`tool-labels-coverage` 12、`real-user-turn` 10；扩面：`image-payload` 27→42、`ReadImage` 40→77、`ImageInput` 33→62、`ProviderRejection` 39→43、`scroll-watermark` 103→110、`render-density` 14→19
- **500 行上限全仓复扫**：79 个超标、78 个有豁免注释、1 个漏标（`file-search/main.tsx` 因 S-253 从 456 → 516）。已补。豁免注释一律不写死行数，改为「行数以实际为准」+ 理由 + 日期

## 验证

- `npm run typecheck`（node + web 两配置）**0 错误**
- `npm test` **104/104**（57.9 s）
- `dotnet build tests/WishfulClaw.Tests.sln` **0 警告 0 错误**
- `node scripts/ci-checks.mjs` 全过
- 格式：新增与大改文件全部 CRLF / UTF-8 无 BOM / 裸 LF = 0
- 官网本迭代**零改动** ⇒ 发版只走 `installer`，不重发站点
- 真机口径（老大定）：dev 实例上反复跑过的即「dev 实测通过」，不列打勾清单。S-274 实测 3.85 GB → 1.3 GB、S-284 真库 14.34 MB → 1.41 MB、S-248 / S-270 / S-271 / S-283 均在 dev 多轮验收

## 遗留

- **插件线五条按「基座已交付，真机验收待插件落地」放行** —— S-240 ~ S-244 的代码与自动化回归全部完成，但没有真插件可装，九条真机判据（资产下载 / 录音 / 卸载清理等）走不到。`fixtures/fake-plugin/` 只覆盖到清单与视图开窗
- **S-272 第二段未做** —— `grid` / `window` / 相对坐标三个参数要加参数面、随机化风险高，按「收尾期只允许加字段与文案的形状」这条规则移到下个迭代。第一段已让模型知道「坐标就是这张图里的像素」，但点得准不准仍取决于它自己估
- **S-247 余下的 1.3 GB 已定性为 dev 加载方式，不是产品缺陷** —— dev 走 vite 开发态，与打包版基线不可比。真机若在打包版复现，再按新缺陷立（见 plan.md §2.6）
- **S-276 的已知残留**：`LEGACY_SUMMARY_PREFIXES` 那批老摘要卡没有 `meta`，SQL 认不出，只在渲染层兜底。彻底解决应做数据回填，不是往 SQL 里堆三个 `LIKE` 变体
- **S-233 聊天窗抖动仍未关闭** —— 缺陷成立、频率低、只在新版本第一个会话偶发；「抖一下、滚一下就停」与 S-274 根因不同（S-274 修好后仍复现）。重开前必须先补 plan.md §三 那两处判据盲区
- **S-230 Qoder 接入阻塞** —— 缺契约，契约不到不写请求代码
- **移交 v3-iter-5（15 条）**：S-265 / S-268 / S-273 / S-277 / S-278 / S-279 / S-280 / S-281 / S-282 / S-285 / S-286 / S-288 / S-289 / S-290 + S-272 第二段

## 发布

待补（收尾后另落一刀）。
