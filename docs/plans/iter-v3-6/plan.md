# v3-iter-6（产品 1.0.6）—— 承接清单与刀序

> 分支：`dev/v3-iter-6`（base = `98687742`，= v1.0.5 发布记录提交，即最新 `main`；tag `v1.0.5` → `addfbc7f`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.6`（开工时 `package.json` 是 `1.0.5`，收尾时改），tag `v1.0.6`。
> 状态：**实施已收口（2026-11-02 16:3x），刀 10 于 11-03 追加交付** —— **刀 0~11 全部交付**（刀 10 = S-303 CodeGraph 剥离，11-03 完成，待真机验收 4 步）。沿革：2026-11-01 建立；20:5x 逐条核对收敛；21:12 S-291 **定性改写**（出站回执翻历史，非入站重复）；11-02 08:30 S-300 **从候选拉回本迭代**；09:05 S-301 **本迭代做**；09:11 S-295 **挪到最后（尝试性工作）**；14:15 S-302 / S-303 登记；16:05 S-304 **插队本迭代**（老大裁定「报错了能重试」）（撤销 S-277 / S-265）+ 挂账 3 条；11-03 S-303 撤销「不在本迭代实施」改为**本迭代做**（独立仓建好、主仓剥离完成、插件下载链路接通、dev NuGet 回落拆掉）。[raw-requirements.md](raw-requirements.md) 是需求清单，本文件只做刀序。
> 前置：v1.0.5 已双面发布（官网下载目录四件套 + GitHub Release 三资产，逐项对账全绿）。
> 门禁基线（2026-11-01 v3-iter-5 收尾实测）：`npm run typecheck` 两配置 **0 错** ｜ `npm test` **119/119** ｜ `dotnet build` 两套 sln 各 **0 警告 0 错误**。
> `node scripts/ci-checks.mjs` **不是第四道判据**：它内部就跑 `typecheck` + `npm test -- --ts-only`（v3-iter-5 收尾时 TS 侧 90 条，是上面 119 的子集），已钉在 pre-push 钩子与 GitHub Actions 上。**交付时只跑上面三条，别把它也列进来** —— 那等于 typecheck 和 TS 测试各烧两遍。

## 一、本迭代的定位

v3-iter-5 修的是「把正确性押在某个不会报错的地方」。这一迭代接着修**同一类病的另一半：押在「这件事只做一次就够了」上。**

- S-298 押「说明拉一次就能拉到」（没有重试、没有缓存）；
- S-296 押「测试跑得过就等于写对了」（119 个套件从没编译过，esbuild 只剥类型不查类型）；
- S-299 押「15 轮够用」（一轮 1 秒和一轮 3 分钟在同一个数字下被同等对待）；
- S-293 押「dev 不会连到生产库」（已经连过了，虽然痕迹已被 1.0.5 的正式 DDL 覆盖）；
- S-291 押「会话里最后一条 assistant 消息就是本次结果」（本次零输出时它会翻到上一次）。

**共同点**：全都不报错。五条里四条的症状是「看起来正常」。

> S-291 于 21:12 **定性改写**：不是「同一条消息只会来一次」，而是「**本次没输出就去翻历史**」—— 与上面四条是**同一类病的第五张脸**。老大 21:12 裁定只登记、明天推进。

## 二、刀序

| 刀 | 需求 | 为什么排这里 | 前置 / 风险 |
|---|---|---|---|
| **0** | **S-296** `tests/**` 进 typecheck | **✅ 已交付（11-02）** —— 门禁本身，先补齐再干活。 后面每一刀的判据都靠测试兜底，而 119 个套件从没被 tsc 编译过（`npm test` 走 esbuild，只剥类型不查类型）—— 门禁不修，后面所有「判据能红」的验证都打折扣。**⚠️ 规模已重估（11-02 08:4x）：原记的「4 个错」是语法错，修掉后暴露 37 个语义错 / 25 个文件**，见 S-296 §4.4 | 新增 `tsconfig.test.json`（**不写 `types`**，否则误伤 34 个假 TS7016）+ 25 个文件的类型修正；不豁免任何套件；**已一刀清完（`typecheck:test` 常态化跑，0 错）** |
| **1** | **S-298** 更新说明不稳定 | **✅ 已交付（11-02，commit `3008dc35`）**。11-02 09:24 老大反馈「实际更新时没有遇到了」⇒ 现象已停，但根因 11-02 复核已定位（候选 B 排除）：`updater-state.ts:171` `applyAvailable` **无条件写 `releaseNotes`**，清单不带说明 ⇒ 每次检查都清零，再靠 `fetchReleaseNotes`（5s 超时 / 无重试无缓存 / miss 全吞空串）赌回来。修法两处：`applyAvailable` 加「空串不覆盖」守卫 + 补拉重试与落盘缓存 | **三处落地**：`applyAvailable` 空串守卫（同版本保留 / 换版本清空）+ `fetchReleaseNotesWithRetry` 一次重试 + 按版本号落盘缓存（`userData/release-notes-cache.json`，坏文件视为未命中）。判据：同版本空串不覆盖 / 换版本必清 / 只重试一次 / 空说明不落盘
| **2** | **S-299** 定时任务被 15 轮掐断 | **✅ 已交付（11-02）**。老大 20:11 拍板：**默认不限，轮次手动设**。改动是「把 0 = 不限贯通到底」，不是换个更大的数。⚠️ 只改 UI 默认值**无效** —— `cron-runtime.ts:428/504` 会把 0 反向改成 15 | 无 schema 改动；不回填历史任务的 15 |
| **3** | **S-300** 全局任务可选归属项目 + 项目会话查本项目任务 | **✅ 已交付（11-02）**。老大 2026-11-02 08:30 裁定「**这个需要本迭代做**」。功能新增但**纯增量**：`global_tasks` 加 `project_id`（`EnsureColumn` 一行，20+ 条先例，无回填）+ 新只读工具 `list_project_tasks`。现状是项目会话**刻意**看不到任何全局任务工具（`ToolVisibilityScopes.cs:34-38`）⇒ 工作量在**新开一条受控通道**，不在加字段 | 三处易漏：`GlobalTaskSelect` 写死字段列表（漏改会**静默返回空**）、可见性 grant 二选一（推荐新开 `ProjectSideOnly`）、projectId 必须取 `sessions.project_id` 不能用 `workingFolder` 反推 |
| **4** | **S-292** 渠道命令 `/compress` 是 no-op | **✅ 已交付（11-02）**：选「删命令」而非真压 —— 真压需在 main 复制 provider payload 的唯一真源（双真源），且渠道压缩是长耗时 LLM 调用又无进度反馈。连带删掉无人调用的 `db/messages-compact-session` 端点。**范围已缩到单点**：界面按钮走 `compressSessionContext` 是好的，只有渠道命令会回假话「Context is already compact.」 | 前置 S-285 已解除（v3-iter-5 交付） |
| **5** | **S-293** preview / dev 污染生产库 schema | **✅ 已交付（11-02）**：判据拆两半 —— 纯函数 `assessDataDirRisk`（shared 不能引 `node:fs`）+ 主进程 `inspectDataDirRisk` 探盘。三级：打包版 / 非打包未显式配置 ⇒ ok；非打包显式指向「已有库且末段就是 `.wishful-claw`」⇒ **block 拒绝启动**；其它已有库 ⇒ warn 放行。逃生舱 `WISHFULCLAW_ALLOW_SHARED_DATA_DIR=1` | 判据必须在 `mkdirSync` / `setPath` / 单实例锁**全部之前** —— 锁拿到后 Worker 随时能改 schema |
| **6** | **S-291** 定时任务推送历史回复 | **✅ 已交付（11-02）**：`ActiveAutoReply` 记 `baselineMessageCount`（注册回执时、`sendMessage` 之前），兜底改纯函数 `pickRunReplyText` 只扫 `slice(baseline)`；区间内无文本 ⇒ 回明确说明，绝不推历史。`cron-runtime.ts` 的 `result.summary` 同改。**定性已于 21:12 改写**。**与 S-299 是两条独立的刀**：S-299 降概率，S-291 保证「就算没输出也绝不推历史」 | 写坏了渠道**静默失效**（收不到消息也不报错）。验证：定时任务轮次手动设 2、纯工具调用后停 ⇒ 期望收到「本轮执行结束，没有产生可回复的文本输出。」，**不是**上一条历史内容 |
| **7** | **S-301** 工具让 agent 回看**当前会话**的用户历史发言 | **✅ 已交付（11-02）**：`list_user_messages(date?, limit?)` 按本地时区切单日，只回 `role='user'` 精简投影（`text` + `attachmentSummary` + `truncated`/`totalOnDate`）。**零 schema 改动**，过滤复用 `RealUserTurnPredicate`。新端点为并列新增 `db/messages-list-user`，`ListByTurns` 一字未动。测试 `tests/WishfulClaw.SessionHistoryRegressionTests`（真库端到端，已进 `Tests.sln`） | 三处坑均已钉住：①sessionId 由 `ExecuteRunAsync` 注入 `parameters.sessionId`，executor **不读模型入参**，反向验证「模型传别的会话 id 读不到」；②时区——按本地时区取当日毫秒区间，测试造「本地 07:30」撞 UTC 切日；③标签——`list_user_messages` 已补中英文，`tool-labels-coverage` 12 断言绿 |
| **8** | **S-295** 换壳降内存 —— 原型实验 | **✅ 已交付（11-02）**：`experiments/avalonia-shell/` 独立工程（net10.0 + Avalonia 11.3.2），一个窗口 + 三态（空 / 流式文本 / 2520×1680 图）+ 每秒内存采样。四配置各量三态。**结论：不建议迁移。** 空窗口工作集 Debug 197.7 / Release 187.4 / **AOT 156.2** / **软件渲染 96.9** MB；私有字节软件渲染 **43.7 MB** ≈ Astra Gate 报的 50 MB ⇒ 那个数是「软件渲染 + 私有字节」口径，与我们 GPU + 工作集不可比。S-247 已实测 Electron renderer 稳态 150~200 MB，**Avalonia 空壳同量级** ⇒ 重写 874 个文件后最乐观持平 | 前置已核实：`experiments/` 不被 tsconfig / electron-vite / ci-checks 扫到，无需改 ignore。§六 中间路线（Avalonia + WebView2）同样出局 —— WebView2 就是 Chromium，还要重写 IPC 与浏览器控制层。**11-02 补测（老大追问「要完整界面 / 框架依赖能不能 AOT」）**：完整聊天场景（虚拟化列表 + 段落 + 代码块 + 工具卡 + 图）AOT 静态 **154.0** / AOT 流式 **213.6** / JIT 流式 261.6 MB，**500 条比 200 条还低 10 MB** ⇒ 常驻与条数无关；三形态体积 框架依赖 23.2 / self-contained JIT 99.7 / **AOT 32.0 MB（压缩 12.6）**，`--self-contained false -p:PublishAot=true` 报 **NETSDK1102**（AOT 必须 self-contained，不是 Avalonia 不行）；WebView2 本机实测 **25 进程 1015.5 MB**（多宿主口径，单实例推算 ~290）⇒ 与 Electron 同进程模型；依赖盘点 **878 文件 / 15.2 万行**，**7 类在 Avalonia 无等价物**（首要是 Markdown 全家桶 = 消息正文）⇒ 纯 XAML 现实形态是 **A′（XAML UI + WebView2 只渲染正文），收益 35% 而非 60%**。**11-03 14:47 口径变更**：本条线**转并行探索线、不占刀序**（与 S-306 Tauri 并列）；纯 XAML 的「不建议迁」结论保留，下一步做 A′ 原型 |
| **9** | **S-302** Monaco 语言服务瘦身 | **✅ 已交付（11-02 15:2x）**：`out/renderer` **45.92 → 28.59 MB**（−17.33 MB / −90 文件），四个语言 worker 全消失，只剩 `editor.worker` 0.52 MB。**原方案（删 4 条 `?worker` import + 删 `getWorker` 分支）实测是空转** —— 产物一动不动，真根因是 `setup.ts:9` 的 `import * as monaco-editor` 全量入口：包内 `workerManager.js` 写死 `new Worker(new URL('ts.worker.js', import.meta.url))`，Vite 静态识别后无条件打包。解法是换 `editor.api` + `editor.all` + `basic-languages/_.contribution` 三条入口。**§七 原「不做按需导入」判断已推翻并作废** | 收益**全部**来自 worker，`setup-*.js` 6.81 MB 一分没少（原文档以为能砍 setup，算错了）。语言服务退化：TS/JSON/CSS/HTML 智能提示没了、**语法高亮保留**（monarch，产物内 `tokenizer` 137 处）。`editorRemoteLanguageServiceEnabled` 必须保留（只管 URI scheme，删了误伤 SSH 工作区）。真机待验：开 `.ts` 高亮在、改一行保存、diff 增删行正确、控制台无 worker 404 |
| **10** | **S-303** CodeGraph 剥离为可选插件 | **✅ 已交付（11-03），待真机验收 4 步**。独立仓库 `wishful-73/wishful-claw-codegraph`（**public** —— 老大 11-03 08:22「本身我们仓库也是公开仓 推上去有毛线区别呢」），tag `codegraph-v1`，本地 `D:\claw\wishful-claw-codegraph`；主仓 `src/runtime/WishfulClaw.CodeGraph/` 整目录已删，只剩插件配置与下载通道。老大 11-02 14:11「大部分用户其实不写代码，这东西没用」⇒ 主包不再背 tree-sitter。**实测架构**（原判「进程内库 + MCP 服务端」是错的，已更正）：worker 进程内模块 + 原生库随包 ⇒ 真剥离对象**只有 tree-sitter grammars**，`CodeGraph.dll`（1.8 MB）留主包。插件资产 `codegraph-win-x64.zip` **10,133,006 B ≈ 9.7 MB**（`bin/codegraph.exe` + `e_sqlite3.dll` + 30 个 `grammars/*.dll`），`publish-aot-worker.mjs` 不再把 grammars 拷进 `resources/worker`。下载 / 移除 / 进度三通道 + 「重新检测」按钮已接；**dev 专用 NuGet 缓存回落在 11-03 拆掉** —— 否则 dev 永远「已就绪」，「待下载 → 下载 → 移除」这条链路在 dev 上验不到 | 三个坑（原记保留）：①`Storage` 15 文件是独立库，剥离时最容易漏；②工具调用从进程内变 IPC，查询延迟上升；③索引构建独立进程反而是收益。**tree-sitter 裁语言不做**（老大 14:09「不着急砍语言」）。消费方式**不用 submodule**，走插件资产下载。**11-03 真机验收又修两处**：徽章「待下载」与详情「已启用」自相矛盾（`null` 被当 `false`，改为 `'checking'` 态 + 挂载即拉）；「找不到移除」不是缺功能而是 dev 从未下载过资产 |
| **11** | **S-304** 流式响应中途断连零重试 | **✅ 已交付（11-02 16:2x）**：生产日志 `error=HttpIOException: net_http_invalid_response_premature_eof (ResponseEnded)` 直接 `agent run failed`，而那个 run 已跑二十多分钟、多轮工具。**根因是类型认错**：三处 catch 只写 `HttpRequestException`，而 .NET 对流中途断流抛 `HttpIOException`（`ResponseEnded`），它继承 `IOException`、与 `HttpRequestException` 无继承关系 ⇒ 一个都捕不到。修法：判定收进纯函数 `ProviderRetryPolicy.IsRetryableTransportError`，三处共用；**去掉「零输出」守卫**（老大 16:06「报错了那一段就算中断报错呗，新的输出走新的呀」）；抛前 `boundary.AtEnd()` 收尾 thinking 块 | **不是超时**：超时（首字节 / 流空闲）走 `AgentRuntimeRequestTimeout` → `TimeoutException` → 早就在重试。段落天然分开 —— `ProviderRetryPolicy` 的循环体是完整一次请求，重试会重跑整个方法、发新 `text_start`。**不加新事件**、不做 UI 替换（工具副作用已发生，替换边界判不准）。测试 `TransportRetryChecks` 9 条 + 反向验证（改回旧判定 ⇒ 红）。`Http` 是 `private static readonly` 不可注入 ⇒ 端到端只能真机验 |
| — | S-233 / S-230 / S-273 段 B | **挂账** | 见 raw §二 |
| — | ~~S-265~~ 裸 body 400 取证 | **❌ 已撤销（2026-11-01 20:5x）**：400 最近一条是 **10-22**，十天零新增，最近 6 条全是结构化报文，没有裸 body ⇒ 现象已停，取证窗口关着。重开需三条件同时满足（raw §3.8） | — |
| — | ~~S-277~~ 压缩产物累积 | **❌ 已撤销（2026-11-01 20:43）**：一屏摘要卡是压缩触发异常的**表现**，不是显示缺陷；S-276 修完窗口后已无危害。不为伪缺陷排刀（raw §3.7） | — |
| — | ~~原拟 S-299~~ 最小化窗口 | **撤销**：核对后不成立，闸从第一天就在（raw §3.6）。**编号不占用**，S-299 已归「定时任务轮次」 | — |
| — | **S-305** 插件卡片渲染通道是死的 | **下个迭代做**（老大 2026-11-03 09:12「登记一个需求，这个需求暂时不在本迭代处理」）。6 种渲染器（card / table / form / chart / html / component）+ iframe 沙箱 + 高度协商**全部完工**，但总闸没合：`parseExtensionToolResult`（`extension-result.ts:4-6`）无条件 `return null`，且 `__wishfulClawExtensionResult` 全仓只在类型定义里出现一次、主进程零产出 ⇒ 插件卡片一张都渲染不出来。见 [requirements/S-305.md](requirements/S-305.md) | 与 S-303 **无关**，是主仓既有欠账；老大 09:12 定「**CodeGraph 先走普通工具卡片**」（MCP `content:[{type:'text'}]`，零改动） |
| — | **S-307** 分支视图提交列表不显示提交时间 | **✅ 已交付（11-03 19:0x）**。数据链路一直是完整的、**纯渲染层缺失**：后端 `GitQueryTools.cs:244/248` 已按 `--date=iso` 取回 `%ad`、模型 `GitModels.cs:148` 与前端类型 `git-store-types.ts:54` 都有 `date`，但 `branch-panel.tsx` 的 `CommitGraphList` **一次没用**，只画了 `subject` / `refs` / `shortHash`；HoverCard 也只显示 subject。**修法**：抽 `lib/utils/commit-time.ts`（`formatCommitDay` / `formatCommitTime`，零依赖纯函数、不解析成 `Date`），行内加 `MM-DD`（跨年 `YY-MM-DD`），HoverCard 补作者 + 完整时刻（到秒）+ 全 hash。见 [requirements/S-307.md](requirements/S-307.md) | 两项口径 11-03 18:45 已定：**行内不带时分**（面板窄，多两字符就挤没说明）、**不做相对时间**（要常驻定时器重算，不重算就是假精确）。**判据的特别之处**：本需求的病根是「数据在、类型在、组件没用」，纯函数测试对此无感 ⇒ 测试里加了**读源码的静态断言**，锁死 `formatCommitDay(row.commit.date)` 必须出现在组件里。反向验证三次全红（含删掉渲染调用那条）。**分支行自身（`BranchSection`）无最后提交时间属另一条需求**（`for-each-ref` 没取 `%(committerdate)`），不在本条内 |
| — | **S-308** 子 agent 缺少停止手段 | **✅ 已交付（11-04 13:50），真机部分验证（跨 run 停止 / CTS 不泄漏未验）**。三层全不通：①**工具层**只有 `Task`/`SubAgentStatus`/`SubAgentDetail`（`ToolModule.cs:159-160`），无 Stop；②**`BackgroundSubAgentRegistry.Cancel()` 是假取消**（`:166-177`）—— 只把记录状态改成 `Cancelled`，通篇无 `CancellationTokenSource`，实际执行不受影响；③**唯一真取消是父 run 连带**（`SubAgentExecutor.Background.cs:44-45`），但 `background=true` 父 run 结束时 `:192-194` 会 `Dispose` 该 registration ⇒ **孤儿子 agent 彻底无法终止**；④**UI 零入口**（`SubAgentCard` 的 `e.stopPropagation` 与 `SubAgentExecutionDetail` 的 `cancelled` 都不是停止功能）。见 [requirements/S-308.md](requirements/S-308.md) | 核心矛盾：`background=true` 的价值就是「活得比父 run 长」，而唯一取消通路恰在父 run 结束时被主动摘掉 —— **生命周期没闭环，不是漏写按钮**。建议先做 `toolUseId → CTS` 注册表（父结束时只 Dispose link、不 Dispose 子 CTS），再补 `SubAgentStop` 工具与 UI 按钮。**CTS link/dispose 是唯一技术风险**（SA-2 已踩过 `ObjectDisposedException`），要单独验 |
| — | **S-309** 工具调用无超时 —— 十六小时冻结 | **✅ 已实施（11-04 14:05），待真机验收**。收口在**调用方**（`DispatchWithTimeoutAsync` 竞速），不改任何工具实现 ⇒ 新工具自动继承。分档：只读 60 s / shell 630 s（工具自带 600 s + 30 s 宽限）/ 等人 300 s / 未分档 600 s / background 子 agent 豁免；四套文案区分「超时」「用户暂离」「未获批准」「待确认」。见 [requirements/S-309.md](requirements/S-309.md) | **11-04 订正 P1**：原先按 `max(声明, 180 s)` 实现，而模型不传 `timeout` 入参（常态）⇒ shell 实际 180 s，`dotnet build` 一过 3 分钟就被判超时、结果被丢弃。已改基准为 `ShellExecuteTool.DefaultTimeoutMs + 30 s`，测试钉 630 s 并加「不得低于工具自带超时」断言 |
| — | **S-310** 子 agent 卡片：详情入口改成显式文字 | **✅ 已实施（11-04 14:45），待真机验收**。header 整行点击原来**既切展开又开右侧面板**，两个动作绑在同一个手势上；改为行点击只切展开，卡片内新增纯文字「查看详情」入口（`chat.subAgent.viewDetail`，zh/en 同步）。见 [requirements/S-310.md](requirements/S-310.md) | 纯渲染层 + 语言包改动；`typecheck` 三配置 0 错、`npm test` 122/122、`i18n-coverage` passed |
| — | **S-311** 子 agent 运行期间进度恒为 0 | **✅ 已实施（11-04 15:05），待真机验收**。`BackgroundSubAgentRegistry.UpdateProgress` 全仓只有一个调用点，位于 `await ExecuteLoopAsync` **之后** ⇒ 运行期间恒报 `0 calls / 0 iterations`，跑完才有真实数字。dev 实测取证：进程表里 `Start-Sleep` 正在跑，同一时刻状态工具报 0。数据本身一直是准的（collector 经 `EventObserver` 实时累积），缺的只是往注册表送的通道 ⇒ 新增 `SubAgentRunCollector.ProgressChanged`，挂 `tool_call_start` / `tool_call_result` / `iteration_start` 三类低频事件，在 `CreateCollector` 一处挂载、覆盖前台/后台/goal。见 [requirements/S-311.md](requirements/S-311.md) | 不挂 `text_delta`（每帧热路径，挂上去等于每 token 一次字典写入）。**连带推翻 S-308 一条结论**：dev 上轮「没抓住正在执行中的实例」多半是误判，那时子 agent 其实在跑，只是进度看不见 |
| — | **S-312** 窗口最小化被当成「用户把窗口拖窄」 | **✅ 已实施（11-04 16:0x），待真机验收**。左侧栏展开 ⇒ 切走再切回 ⇒ 面板自己收起了。根因不在「状态被重置」：WebView2 在最小化时把视口报成占位尺寸（本机 1680×1072 → **144×18**），而 resize 监听只在**变窄**时跑收侧判定（有意为之：变宽不自动弹回）⇒ 144 被当成用户拖窄、左栏被收掉；恢复只算变宽、判定不跑 ⇒ 左栏回不来。修法：视口低于 `MIN_REAL_VIEWPORT_WIDTH = 480` 直接跳过判定（壳下限 900 / 960，低于一半不可能是真实视口）。见 [requirements/S-312.md](requirements/S-312.md) | 渲染层 root cause ⇒ **Electron 与 Tauri 共用，两边都中招**，不是壳的问题。不动 `enforceViewportWidthGuard` / `resolveViewportYield` 的语义，不做面板状态持久化 |
| **❌ 否决** | **S-295** Avalonia 换壳（含 A′） | **❌ 不推进（11-03 15:59 老大否决）**。原话「Avalonia 相对于tauri成本太高，而且方向太麻烦了」⇒ 整条线含 A′ 一起停，**不占刀序、不作 S-306 的对照项、不作退路**。存量保留存档：四配置 × 三态实测（AOT 32.0 MB / 软件渲染 96.9 MB / AOT 静态 154.0 / AOT 流式 213.6）、**airspace 前置已验通过**（`experiments/webview-airspace/` 三块 XAML 浮层全部盖住 WebView2，`NativeControlHost` 走 dumb window + DirectComposition）。见 [requirements/S-295.md](../iter-v3-5/requirements/S-295.md) §十四 | 否决理由不是「微软贪心」（Windows 上 Tauri 也是 WebView2，§13.2 实测依赖树），**是横向对比**：UI 878 文件 / 15.2 万行要重写 + 7 类生态无等价物 + **XAML/C# 与 React/TS 双栈维护**；而内存维度两边打平 ⇒ 双栈代价换不到独有收益 |
| **🚧 主线** | **S-306** Tauri 换壳 | **🚧 换壳方向唯一主线（11-03 15:59 定），不占刀序；样张六项已全部验完（11-03 16:5x）**。React 零重写是把 Avalonia 比下去的根本原因。落点 `experiments/tauri-shell/`，**硬约束五条隔离**（目录 / 构建 / 依赖 / 扫描 / 产物）。见 [requirements/S-306.md](requirements/S-306.md) §8.3 + [README](../../../experiments/tauri-shell/README.md) | **实测结论：方向可行、无阻断项。** ✅ 多 webview（独立导航/eval/IPC/增删）、✅ React HMR 零重写、⚠️ **浮层必须原生窗口**（HTML 浮层被整块遮住）、✅ 壳 3.26 MB、✅ 内存空窗 292.1~347.3 MB / 载入 664 MB 静置无上行、✅ 迁移清单已出。**收益口径要认清**：赚体积（108.5 MB→30 MB 级）+ UI 零重写 + 省掉 Electron 主进程 219.9 MB；**赔**输入注入（robotjs）/ 截图（desktopCapturer）/ 发布更新链全要 Rust 重写 + 浮层架构重构；**内存一项不赚不赔**（WebView2 ~293 MB 是三家共付的硬成本，换壳治不了 S-247 的 2G） |

## 三、开工前必须拍板的事

20:5x 核对后两条待拍板项都有了结论：

1. ~~**S-265 加诊断列要不要做**~~ ⇒ **不做了，整条撤销**。现象已停（400 最近一条 10-22，十天零新增），取证窗口关着，加 schema 列去抓一个不再发生的形态不划算。详见 raw §3.8。
2. ~~**S-292 的语义**~~ ⇒ **范围缩到单点，不再是「设计重做」**。界面按钮走 `compressSessionContext` 本来就是好的，只有渠道 `/compress` 是 no-op。实施时二选一：**优先让它真压**（对齐界面按钮的行为），做不到就直接删命令 —— 留一句假话比没有这个命令更糟。

3. **S-300 的三个语义（08:30 新增）** —— 已给建议，**按建议实施，不卡开工**：

| # | 问题 | 采用 |
|---|---|---|
| 1 | 挂了项目的任务，全局任务板还显示吗 | **显示**，加归属标签。老大原话是「可选**属性**」，属性不等于搬家 |
| 2 | 项目会话能看到没挂项目的全局任务吗 | **不能**，只返回 `project_id = 当前项目` 的 |
| 3 | 项目会话能改任务状态吗 | **不能**，本次只读 |

⇒ **本迭代可以直接开工，无需再等拍板。** 9 条在册，刀序见 §二。

## 四、门禁与口径

- 每次交付跑**三条**：`npm run typecheck`（两配置）、`npm test`、`dotnet build`（两套 sln）。
- **交付清单里不列 `node scripts/ci-checks.mjs`** —— 它 = `typecheck` + `npm test -- --ts-only`，已钉在 pre-push 钩子与 GitHub Actions 上，push 时自动跑。再列一次就是 typecheck 和 TS 测试各跑两遍，白烧约 38 秒。
- 新增判据一律做**反向验证**（把实现改回错误版本必须变红）。
- 格式：新增与大改文件 CRLF / UTF-8 无 BOM / 裸 LF = 0。
- **任何文本文件都不用 PowerShell 做读改写**（ANSI 坑已两次把中文注释写成 mojibake；S-290 §8.4 / S-288 各有一次）。
- 真机口径（老大定）：dev 实例上反复跑过的即「dev 实测通过」，不列打勾清单。
- 官网本迭代**预计零改动** ⇒ 发版只走 `installer`，不重发站点（官网反馈看板已无限期搁置）。

## 五、文档

- [raw-requirements.md](raw-requirements.md) —— 需求清单（含「本轮核对掉的七条」，防重复登记）
- [changelog.md](changelog.md) —— 裁定与口径流水（按日期追加）
- `requirements/S-{NNN}.md` —— 本迭代**新登记**的需求正文（S-298 / S-299 / S-300 / S-301 / S-302 / S-303 / S-305 / S-306 / S-307 / S-308 / S-309 / S-310 / S-311 / S-312 —— S-305 **不进本迭代**、S-306 是并行探索线，仅登记在这里便于溯源）
- 老需求正文**不搬家**，一律链回原目录
