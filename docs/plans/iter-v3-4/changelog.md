# v3-iter-4 裁定与口径流水

> 跨需求的裁定、口径变更、方向性决定记这里。单需求细节留在 `requirements/S-{NNN}.md`。
> 上游需求正文不搬家，留在原迭代目录，本文件与 `raw-requirements.md` 只做链接。

## 2026-10-28

### 17:24 · 迭代建立（拆分支）

`dev/v3-iter-4` 从最新 `main`（`58136a9f` = v1.0.3 收尾合并点）拆出，产品版本 `1.0.4`、tag `v1.0.4`。

初始承接 **9 条需求 + 2 条挂账**：插件基座五条（S-240 ~ S-244）、资源治理三条（S-247 / S-248 / S-256）、浏览器保活池一条（S-260）；挂账 S-233（抖动）、S-230（Qoder 缺契约，阻塞）。

同批新建 `raw-requirements.md` / `changelog.md`，`plan.md` 补目标与刀序初稿。

### 17:24 · 补回承接清单漏列的 S-260

v3-iter-3 收尾写的承接清单只列了 8 条，**S-260（浏览器保活池上限 2）漏列** —— 而需求单本身写明「归属 v3-iter-4」「随 S-247 内存治理同批」，老大 16:22 也定过「有两个活着就行了」。

⇒ 已补进 `plan.md` §2.1，并加显式提醒。**清单口径以 `plan.md` §二 为准：9 条承接。**

### 17:46 · 阶段一探查完成，纠正 S-207 误记

两份只读探查均交付（插件基座 67 次调用 / 资源治理与渲染 193 次调用），结论落 `exploration_findings.md` §四、§五。

**必须记一笔的错**：v3-iter-3 收尾把「S-207 沙箱提权 `CannotWritePropertyWithinArray`」列进「遗留未排查」，**实际它早在 2026-10-20 就修完并真机验证通过**：

- 修复提交 `b6a95eca`（`fix(agent): 修沙箱申请工具请求包序列化与提示条落点（S-207）`）
- `S-207.md:3` 状态行：「已完成（阶段五审查修复 + 真机验证通过，2026-10-20）」
- `S-207.md:349-350` 已写全根因：`SandboxElevationExecutor.BuildRequest` 漏写 `WriteStartObject()` / `WriteEndObject()`，首 token 即属性名 ⇒ `Utf8JsonWriter` 抛 `InvalidOperationException`；AOT 裁掉资源串后退化成 `CannotWritePropertyWithinArray, None`
- 旁证：`src/runtime` 全量扫同类写法 **0 残留**

⇒ `raw-requirements.md` §三 已订正为「早已修复，无需再做」，**本迭代不为它安排刀序**。

另一条 Goal `KeyNotFoundException` 订正为「需一次运行时抓栈才能定案」：Goal 目录内 `GetProperty` 与字典读索引器**均无直接抛点**，嫌疑在 Goal 之外被它调用的层；且 17:31 复跑 `npm test` 89/89 全过（含 Goal 335 断言），当前 HEAD 不复现。

### 17:57 · 10 条待决问题全部拍定

老大回「根据你的建议来」⇒ 授权按技术判断拍板。细则见 `exploration_findings.md` §七，此处只记口径：

| # | 事项 | 拍定 |
|---|---|---|
| 1 | 零工具插件 | **允许**，放宽为「tools / views 至少一项」 |
| 2 | 资产落盘根 | `~/.wishful-claw/plugin-assets/` |
| 3 | 卸载 partition 删不掉 | 两段式：本次 `clearStorageData`，下次启动补删 |
| 4 | S-256 改测试契约 | **允许**。那两处「no step cap」是把现状固化成需求，不是产品意图。**同刀必须一起修根因 B**（长段落无空行 / 未闭合 fence ⇒ tail 永不 settle），只加步长上限卡死照旧 |
| 5 | S-260 口径 | **全局上限 2**；满了**拒绝新开 + 结构化告知 agent**；**不做 LRU**（会踢掉用户正在看的页面，比拒绝更糟）。依据是老大原话「有两个活着就行了，要是能提示 agent 已经有两个是最好的」 |
| 6 | S-248 text 档形态 | **完全不渲染工具卡片**，降级纯文本行；**折叠保留**；错误行红色。依据是老大原话「不呈现组件了，也不能点开组件查看，类似子 agent 卡片里面的显示方式」 |
| 7 | S-243 系统音混入自身播放 | **接受**，不做「录制期间静音自身」。Windows loopback 无按进程排除 API；主场景是听会议 / 听别人说话，此时本程序不播放 |
| 8 | S-243 是否引原生 WASAPI | **不引入**。Electron 43 官方 `Streams.audio: 'loopback'` 已声明 Windows 支持，为未发生的假设引 native 依赖不值。实测失败则麦克风先交付、系统音挂账 |
| 9 | S-247 消费形态 | 状态面板常驻数字 + 超阈值写日志；轮询 5 s |
| 10 | Goal `KeyNotFoundException` | **本迭代不做**。当前 HEAD 89/89 不复现，无稳定复现路径的抓栈是浪费；维持挂账，复发即抓 |

### 18:15 · 第 0 刀闭环 + 第 1 刀（S-240）代码完成

**第 0 刀（S-243 探路，只测不改码）已闭环。** 探针在 `.wishful-claw/notes/s243-probe/`（独立 `userData`，跑完删数据目录、脚本留给第 4 刀复用），`electron exit=0`。四条实测结论：

| # | 结论 | 影响 |
|---|---|---|
| 1 | **纯音频 `getDisplayMedia({audio:true})` 不可用** —— 抛 `AbortError: Invalid capture constraints`，`setDisplayMediaRequestHandler` 根本没被调到 | 必须先要 video、拿到后丢掉 video track。**硬约束，不是优化** |
| 2 | `callback({ video, audio: 'loopback' })` 生效，能采到系统混音；设备枚举 7 个、audioInputs 3 | 不需要原生 WASAPI |
| 3 | loopback 与麦克风实测都是 **48 000 Hz / 1 ch** | 只需重采样到 16 kHz，不需声道下混；但实现必须按 `track.getSettings()` 动态取值，不能写死单声道 |
| 4 | 整机混音必然混入本程序自身播放 | 17:57 已拍「接受」，真出问题再单独立需求 |

**第 1 刀（S-240 清单扩展与导轨入口）代码完成。** 改动 9 个文件 + 新增 1 个测试套件：

- 契约 `src/shared/extension-types.ts`：`ExtensionViewDefinition` / `ExtensionAssetDefinition`；`ExtensionManifest` 加 `views?` / `assets?`
- C# 四个模块：`ExtensionModels.cs`（`Views` / `Assets`）、`ExtensionManifestHelpers.cs`（`ViewIdRegex`）、`ExtensionManifestReader.cs`（`ReadViews` / `ReadAssets`，`ReadTools` 放宽）、`ExtensionManifestNormalizer.cs`（**真阻断点**：`NormalizeViews` / `NormalizeAssets` + 「至少一项」抛错 + 白名单显式输出）
- 渲染端 `WorkspaceSidebar.tsx`：manifest 视图**追加**在硬编码三项下方，按 `nav.order` 排序、同序按 `id` 兜底
- locale `zh` / `en` `layout.json`：补 `sidebar.extensionViewNotReady` —— **门禁抓到的欠账**，侧栏引用了未定义的 key，`test:i18n-coverage` 直接红
- 新增 `tests/WishfulClaw.ExtensionManifestRegressionTests`（已进 `WishfulClaw.Tests.sln`，13 条断言）

**门禁：`npm test` 89 → 90/90**，typecheck exit 0，`dotnet build` 0 警告 0 错误。

**两条纪律写进 `S-240.md` §4.2**：归一化输出是白名单，漏写字段等于渲染端永远看不见；「至少一项」必须抛错，否则 `ListExtensionsCore` 的 catch 会让插件静默消失。

**待验**：点入口的提示 / 停用消失 / 卸载无残留 —— UI 行为，自动化覆盖不到，需真机。


**S-243 不确定性大幅下降**：`Streams.audio?: 'loopback' | 'loopbackWithMute'` 在 `electron.d.ts:23668-23674`，注释原文「currently only supported on Windows」⇒ 官方能力，不需要原生模块。第 0 刀只剩三点实测（纯音频 `getDisplayMedia` 是否获批 / 整机混音必含自身 / 48k stereo → 16k mono 下混）。

### 20:40 · 登记 S-261 —— 图像块 400 自愈缺失（S-246 下半段）

老大 20:29 指令「把上个迭代『读取图片 400』的 bug 继续登记到当前迭代」。**这不是重复登记**：S-246 自己 §3.2 写明「次因：这个 400 认不出来，也没有自愈路径」，§5 判据 2 在 §7 被标「退化为兜底」；而 `plan.md` §四 表里 S-246 的验收口径又被校正成「源头不产生脏块，不是脏会话能救回来」⇒ 下半段等于被放下了，本条把它提为硬判据。

勘察出**两处根因**（读码定案，正文见 `requirements/S-261.md` §三）：

| # | 根因 | 位置 |
|---|---|---|
| A | marker 表缺上游原文 `unsupported image`（表里只有 `does not support image`，`unsupported` 与 `does not support` 词形不同，匹配不上）⇒ 自愈链路**进不去** | `ImageInputErrors.cs:24-44` |
| B | `source.type === 'url'` 的 image 块**绕过** S-246 白名单闸 —— 同一个语义两份判据，base64 那半有闸、url 那半零闸 | `OpenAIChatRequestBuilder.cs:253-256`、`AnthropicMessagesInputWriter.cs:331-338`、`ProviderContentHelpers.cs:238-245` |

**现场诚实交代**：事发在老大**家里 PC** 的打包版实例（`C:\Users\Administrator\.wishful-claw`）。本机 `~/.wishful-claw/logs/`（生产）与 `~/.wishful-claw-dev/logs/`（dev）三条日志精确检索 `HTTP 400` / `statusCode=400` / `unsupported image` / `image[0]` / `ImageInput` —— **零命中**。所以结论全部来自读码，不是猜。**浏览器截图链路已排除干净**：`capturePage().toDataURL()` 恒输出 PNG → `{type:'base64', mediaType:'image/png'}`，走的是有闸那条路，不会 400。

**附带事实（改正知识库留档的时效性）**：`ProviderRetryPolicy.cs:246` 自 2026-10-27 起 `IsRetryableStatus` 已收紧为 `429 || >=500`，**400 不再重试**。⇒ 现在的现场比知识库记的那次**更快死**（不再白烧 20 次往返，每轮立刻失败），但脏块依然永留历史，「这个会话废了」的体感不变。

**定案四条**：

1. **剥离粒度 = 只剥 image 块**，不剥整轮、不动历史不动 DB。依据：text 段仍在（模型照旧知道读了哪个文件、多大、什么格式）；`AgentLoop.ImageInput.cs:21-23` 红线；剥整轮会吃掉用户消息里的文字。
2. **识别口径 = 两层**。第一层结构化优先：给 url 形态补上 `ResolveSupportedImageMediaType` 闸，从源头掐掉 400（零文案依赖）；第二层文案兜底：marker 补 `unsupported image` 等真实原文形态。
3. **重发一次**，仍撞同一个错即原样抛出走正常报错，不静默吞。
4. **提示**并进既有 i18n 键 `chat:assistantMessage.imageInputUnsupported` 扩写，zh / en 双语，不新造键。

**红线**：S-236 判据 10 的两道闸（`AgentLoop.cs:464` —— 本轮无图可剥 / 本 run 已剥过一次 ⇒ 原样抛）**不许动**。marker 加得越多，越依赖这两道闸兜底。

### 20:55 · 刀 1b（S-261）代码 + 自动化回归完成，commit `fd386222`

> 订正（2026-10-29 08:24）：这条原先记的是 `bda3bca4`。该提交随后用 `git commit --amend` 把三处文档状态行并了进来，**最终落库 hash 是 `fd386222`**（14 文件 +460/−30）。以本行为准。

11 文件 +460/−30。四处改动：

| # | 文件 | 改动 |
|---|---|---|
| 1 | `ImageInputErrors.cs`（66 → 82 行） | marker 表补 `unsupported image` / `image format is not supported` / `image is not supported` / `invalid image` / `图片格式不支持` / `图像格式不支持`，并把「为什么敢放宽」写进注释（两道闸兜底） |
| 2 | `ProviderContentHelpers.cs`（289 → 353 行） | 新增 `SendableImageUrl(JsonElement, bool warn)`：http(s) 放行、`data:…;base64,` 交回 `ResolveSupportedImageMediaType`（与 base64 **同源判据**）、其余 scheme 直接丢 + Warn；`HasUsableImageBlock` 的 url 分支改成调它 |
| 3 | `OpenAIChatRequestBuilder.cs` / `AnthropicMessagesInputWriter.cs`（494 / 495 行） | url 分支由「非空即透传」改为过 `SendableImageUrl`。**两个文件原本都正好 494 行，加注释就会破 500 红线** ⇒ 判据全部下沉到 `ProviderContentHelpers`，writer 只替换表达式，净增 0 / +1 行 |
| 4 | `locales/{zh,en}/chat.json` | `imageInputUnsupported` / `…Detail` 扩写，同时覆盖「格式不支持」与「模型不读图」两种成因 |

**回滚锚点做成了回归断言**：`tests/WishfulClaw.ImageInputRegressionTests/Program.cs` 新增 20 条，其中第一条直接把现场原句
`.messages[477].image[0]: You have uploaded an unsupported image …` 灌进 `IsImageUnsupportedError` 断言必须为 true —— 修复前它返回 false。另有 6 条「无关 400 不许被吞」的反向断言守 S-236 判据 10，以及 8 条 url / data URL 闸门断言。

**门禁**：`typecheck` exit 0；`npm test` **90/90**（套件数不变，ImageInput 断言 33 → 53）；`dotnet build` runtime + tests 两套 sln 均 **0 警告 0 错误**；`website build` exit 0。

**待验（真机）**：判据 2 / 5 / 6 —— 造一个「历史带 url 形态非白名单图」的会话，看提示 toast 是否出现、后续轮次能否继续、切回会话原图是否还在。

## 2026-10-29

### 08:24 · 登记 S-262 —— 400 请求级拒绝的自愈与告知（通用兜底）

老大三句口述：「不只是图片，只要是 400 的请求，收到以后就把之前的请求文调整一下，然后告知报错了」／「能收集并且告知 agent 上一步操作 400 了，但是又不会直接卡死直接导致 agent 中断执行」／「根据你的推荐 开始推进」。

**这不是 S-261 的重复**。S-261 只覆盖 image 块；本条是**认不出原因的 400 的最后一道保险**，catch 分支挂在图像 / 配对 / 超限三条**之后**。

**勘察结论**：

| # | 事实 |
|---|---|
| 1 | `AgentLoop.cs:375-493` 的 while + catch 链本来就是「改请求文再重发」的成熟骨架，已有超限压缩 / 配对修复 / 剥图三个分支 |
| 2 | 「告知模型」有三份现成先例：`InjectSessionTodo` / `InjectEmptyTurnNudge`（S-209）/ `InjectSandboxTransition`（S-207），清一色临时副本、不落库 |
| 3 | 300 行注入链在 `ExecuteTurnAsync` 内部（`:731-746`）从 `conversation` 派生 `wireConversation` ⇒ **唯一合法落点是再挂一个注入函数**，改 `conversation` 等于改用户历史 |
| 4 | 三条 provider 主链路**全部**走 `ProviderHttpException.CreateAsync`，异常带 `StatusCode` ⇒ 判据可写 `== 400`，**零文案依赖** |
| 5 | 工具结果内部表示是 `role="user"` + `ToolResults`，替换只能换 `Content` / `IsError`，**`ToolUseId` 必须原样保留**，否则立刻制造配对错 |

**定案**：认不出的 400 → 把本轮**最后一条工具结果**替换成「本次结果被上游拒绝（HTTP 400）：<报文>，请换一种方式」+ `IsError=true` → 重发。

理由是它一石二鸟：**既告知了模型**（下一轮它在对话里看到自己上一步失败），**又真修好了请求文**（坏数据从本轮消失，重发可能成功）。只追加一条提醒治不了根 —— 坏数据还在，必再 400。

**三道安全阀**（直接对治 2026-10-27 撤掉 400 重试的教训）：

1. **上限 2** —— `MaxProviderRejectionRecoveriesPerRun = 2`，一个 run 最多修两个**不同**的问题；真正的防火墙是指纹去重，额度只决定「最多能修几个」；
2. **报文指纹去重** —— 归一化后取前 120 字做指纹，重发后撞同一指纹立刻抛，不等额度用完；
3. **必须有可替换对象** —— 本轮一条工具结果都没有就不进这个分支（坏数据是用户消息，我们无权替它删）⇒ 直接抛。

**⚠️ 口径变更必须记住**：S-236 判据 10 原文是「无关 400 不被降级路径截走」。本条**会截走所有剩余 400**，与字面冲突。但判据 10 的**本意**是「不许静默吞掉无关 400」，而本条显式 emit 事件、显式告知模型、显式提示用户、显式写日志 —— 不吞、不静默，最坏结果只是**多花一次请求**然后照原样报错。`AgentLoop.cs:464` 那两行（S-236 两道闸）一个字不动。

**已知代价**：认不出的 400（模型名不存在 / key 错 / 渠道 schema 变更）会多花一次请求才报出来。老大已拍接受。

**不做**（防蔓延）：不解析报文里 `messages[N]` 索引去精确定位坏消息（索引经压缩 / 剥图 / 配对修复后与 UI 对不上，猜错会改坏历史）；不动 `ProviderRetryPolicy.IsRetryableStatus`；不做历史性脏数据的通用清理。

### 09:10 · 刀 1c 实施完成（S-262）

**交付物**：新建 `ProviderRejectionErrors.cs`（判据 / 取料 / 指纹）+ `AgentLoop.ProviderRejection.cs`（额度常量、`CanRecoverFromProviderRejection`、`InjectProviderRejectionNotice`）；`AgentLoop.cs` catch 链尾加兜底分支、`wireConversation` 派生后追加注入；`AgentRuntimeRunState` 加三个状态字段（不落库，与 `PendingEmptyTurnNudge` 同）；协议加 `provider_request_rejected` 事件（`agent-stream-protocol.ts` + `stream-event-adapter.ts` 透传）；渲染端 toast 合并提示 + zh/en 文案。

**实施中改了一个口径：额度 1 → 2。** 理由：一个长 run 里可能先后撞上两个**不同**的 400（指纹不同），各修一次是合理的；且真正的防火墙是**指纹去重**（同一指纹只试一次），额度只决定「最多能修几个不同的问题」，改成 2 不扩大浪费上界。同步订正了 `S-262.md:27`、`S-262.md:135`、`plan.md` §2.4 三处写「上限 1」的笔误 —— 需求单 §4.3 正文本来就是 2，是登记时的笔误没散干净。

**回归**：新建 `tests/WishfulClaw.ProviderRejectionRegressionTests`，39 条断言。其中一半是「不许认」的断言（429 / 5xx / 401 / 普通异常 / 图像 400 都不能被兜底吞掉）—— 因为兜底分支判的是「是不是 400」，图像 / 配对 / 超限的 400 **同样满足它**，它们没被吞靠的是 catch 链**书写顺序**而非判据互斥，所以把顺序契约一并钉进断言。

**门禁**：`npm test` **91/91**（C# 套件 22 个，新增 ProviderRejection 39 assertions）；`npm run typecheck` 三配置 0 错；`dotnet build tests/WishfulClaw.Tests.sln` 0 警告 0 错误；官网 build 0 错。

**顺带修掉的 TS 缺口**：`chat-store` 里消费 `provider_request_rejected` 时协议联合类型没这个事件名，typecheck 直接报 TS2678 —— 补了协议定义与 adapter 透传才过。这条记一笔：**新增流事件必须同时改 `src/shared/agent-stream-protocol.ts`，否则渲染端 switch 编不过**。

**未完成**：真机验收（S-262 §6 清单）。commit hash 由收尾刀统一订正（amend 前为 `1bede63c`）。

### 09:07 · 登记 S-263（侧栏收起即崩），刀 1d

**来历**：老大 09:02「dev 我让它复现昨天 400 的过程，现在页面渲染已经炸了，你能看下 dev 的日志不」。查 `~/.wishful-claw-dev/logs/2026-10-29.log` 定位到 `09:01:33 Rendered fewer hooks than expected` @ `WorkspaceSidebar`（componentStack 指向 `WorkspaceSidebar.tsx:39:17`，整棵侧栏被 ErrorBoundary 兜走）。老大 09:07 定「单开一个登记」⇒ 立 **S-263**，编号排在 S-262 之后。

**代码先于登记落地**：修复是 09:0x 先做的（当时按「看日志 + 修 bug」推进），09:07 才补登记。所以本条流水的时间戳是登记时刻，不是修复时刻 —— 记清楚免得以后按时间线追责时对不上。

**根因**：`WorkspaceSidebar.tsx` 的 `if (!leftSidebarOpen) return null` 排在 `useExtensionStore` / `manifestViewItems` 两个 hook **之前**。两个 hook 是 S-240 追加的（它加在文件末尾、紧挨 `extensionItems` 数组，而那个数组本来就在 early return 之后）。⇒ 侧栏展开跑 N+2 个 hook、收起跑 N 个，React 一比对数量就抛错。**侧栏一收就必崩**，与「复现 400」无关 —— 老大当时正是收起了侧栏。

**为什么前面所有门禁都没抓到**（写清楚，免得以为门禁白跑）：

| 门禁 | 为什么抓不到 |
|---|---|
| typecheck | TS 不管 hook 调用顺序 |
| `npm test` 渲染端套件 | 全是纯函数 / store 断言，不挂载组件 |
| **eslint** | **项目根本没装**（无 `.eslintrc*` / `eslint.config.*` / 依赖 / `lint` 脚本）。`react-hooks/rules-of-hooks` 就是为这个缺陷存在的规则 |
| S-240 真机清单 | 只列了「点入口提示 / 停用消失 / 卸载无残留」，没有「收起侧栏」 |

**修法**：early return 后移到全部 hook 之后（不动 hook 位置，免得打散「插件视图入口」小节的注释与逻辑），原位留警告注释写明后果；顺带补 500 行豁免头（文件 511 行无豁免，S-240 加插件入口时就已超限）。511 → 521 行。

**全仓同款扫描**：项目无 eslint，于是按「同缩进层级、遇函数边界即停」写了一次性判据扫 `src/renderer/src` 全部 `.tsx` ⇒ `NO VIOLATIONS`。**口径如实记**：第一版按「return 之后出现任何 hook」判，误报两百多条全是跨函数假阳性，收紧到同缩进才可用；本质是文本匹配，不是 AST。**真要根治得装 `eslint-plugin-react-hooks`** —— 那是工具链级决定，单开评估，本条不动（写进 S-263 §八）。

**附带查实的事实**：当天全日志**零条 400**（`HTTP 400` / `provider_request_rejected` 均无命中），三条 ERROR 全是这条渲染崩溃加一条 `allowpopups` 属性警告；worker 侧最后心跳 `09:02:17 inputTokens=44938`（阈值 144000，远未触发压缩）⇒ **400 复现没走到**，不是没记录，是没发生。老大要知道这条，否则会以为 S-262 已验。

**未完成**：真机 5 条判据（S-263 §五）—— 其中「反复收展 10 次」和「收起状态下有流式输出」是复现本缺陷最直接的动作。

### 09:32 · 登记 S-264（脏图源头治理，刀 1e）+ S-265（裸 body 400，移交下迭代）

**来历**：老大 09:25 给出家里电脑的 `2026-10-28-请求错误导出.txt`（`C:\Users\Administrator\.wishful-claw\index.db` → `request_usage_logs` 直查，条件 `status<>'success' AND started_at >= 2026-10-27`），并说「刚刚 dev 上没有复现成功」。09:30 提出方向「读图工具如果读到没有图，可以直接标读图失败么？而不是把脏图丢上去」。09:32「根据你的推荐来 登记然后按照工作流推进吧」⇒ 立 **S-264**（本轮做，刀 1e）+ **S-265**（移交下迭代）。

**真实日志（33 条失败，三种形态）**：

| 形态 | 条数 | 报文 | 会话 |
|---|---|---|---|
| 图像 400 | 18 | `.messages[N].image[0]: You have uploaded an unsupported image` | 微信:老郑 10 / 1zwmBISgkW 8 |
| 裸 body 400 | 14 | `{"model":"deepseek-flash"}` / `{"model":"deepseek-v4.1-flash"}` | Uy5QPV02 14 |
| 502 | 1 | `远程主机强迫关闭了一个现有的连接` | Uy5QPV02 |

坏图全在历史深处：`.messages[477]`（7）、`.messages[33]`（8）、`.messages[207]`（2）、`.messages[40]`（1）。

**对 S-262 的校验（结论：判据正确，不用改）**：catch 链顺序 配对（`AgentLoop.cs:430`）→ 剥图（`:453`）→ 兜底（`:493`），图像 400 不会被抢；`StripImagesWhenModelCannotSee` 遍历**整条** wire conversation，历史 477 条那种坏图也剥得掉，第二道闸 `ConversationHasImageBlocks` 同口径；裸 body 400 的指纹归一后是 `openaicompatiblechatrequestfailedhttpmodeldeepseekflash`，第二次同错必被拦。**顺带回答老大 08:52 那问**：`request_usage_logs` 只落 `error_message`（报文全文），**不落请求体** —— 33 条完整报文在手，零条请求参数。

**dev 不复现的原因**：图像线已被 S-261 治好（`unsupported image` marker + 全量剥图），要复现只能人工造脏图。不是没修好，是修好了。

**勘察坐实的关键事实（这是本条的立论）**：魔数判据其实**全写好了**，结论被三处丢掉 ——

| 位置 | 判据 | 结论怎么用了 |
|---|---|---|
| `ImageFileProbe.MediaTypeFor` | 纯看扩展名 | `.png` ⇒ `image/png`，不管内容 |
| `ImageFileProbe.TryReadSize` | **读头做魔数校验** | 只取尺寸，`false` 只写「size unavailable」，图照发（类注释 `:15` 明写） |
| `ProviderContentHelpers.ResolveSupportedImageMediaType:201-208` | **嗅探 + 白名单** | 嗅探认不出时**回落信任声明** |

第三处是漏水口。「脏图」的定义就是 `DetectImageMediaTypeFromBase64` 返回 `null`（文件头不符合任何已知格式），而这一刻代码选择信任声明 ⇒ 损坏 / 半截 / 非图内容全被贴上 `image/png` 送上上游换 400。

**定案（老大 09:32 拍「按你的推荐来」）**：三层一起改，判据拆四档，**发布前必须做完**。

- 四档：有效且扩展名对 ⇒ 发；有效但扩展名骗人 ⇒ **按真实格式纠正后发**（不判失败，否则误报）；有效 bmp/tiff/ico ⇒ 保持 S-246 的文本降级；**认不出 ⇒ 标读图失败，不附像素**。
- 三层：工具层签名校验 / 组包层去回落 / 脏图不写 `ImageVisionMemory`。缺一层就漏 —— 真实日志 18 条图像 400 里 **10 条在微信渠道会话**，根本不经过 `FileReadTool`。
- 两个坑写进需求单：①不能拿 `TryReadSize` 返回 false 当脏图判据（只读 4 KB 找 JPEG SOF，大 EXIF 的合法 JPEG 会被误杀），只判签名；②`AgentLoop.cs:464` 两道闸（S-236 判据 10 红线）一个字不许动。

**发布前必须做完的真理由**：`ImageVisionMemory` 是**落盘永久**的（`image-vision-unsupported.json`，全文只有 `IsKnownUnsupported` / `RememberUnsupported` / `GetRememberedAt`，**无清除、无 TTL、无 UI 入口**），而 `unsupported image`（S-261 加的 marker）与「模型不吃图」共用同一个 catch 块（`AgentLoop.cs:453-492`）⇒ **一张脏图把能看图的模型永久标瞎，不可逆**。老大自己的现场就是反证：「我截图发消息，实际上是能识图的，结果它自己读取就不行了」。S-236 档 2 的动机是「不让本地表替模型决定能不能看图」，现在变成「让一张脏图替模型决定以后永远不能看图」—— 反向复发。不带这个修复发 1.0.4，等于把不可逆的坑推给所有用户。

**S-265 移交下迭代**：裸 body 400 共 14 条，报文只有 model 名、无 `error` 结构，30~52 秒慢拒绝，无法定位字段。**与 S-264 / S-261 不是同一个 bug**，合并处理必错。S-262 已保证它不钉死会话（替换工具结果重发一次 + 指纹去重后抛），代价是每次多烧一次 30~52 秒请求 —— 可接受，不是缺陷。下一迭代先取证（对照 `input_tokens` vs `context_cap_tokens`、直连上游看是否渠道丢信息）再定性。

**顺带确认的正面事实**：10-28 那批 400 全是 `attempt=1 / total_attempts=1`，而 10-27 那批是 `attempt 1..9` ⇒ **S-245「400 不重试」在 1.0.3 已生效**，不再白烧 20 次往返。

### 09:55 · 交付 S-264（刀 1e）+ S-266（刀 1f）—— 脏图这条线收干净，并修正 S-264 遗留的测试口径欠账

**来历**：老大 09:30 提出「读图工具如果读到没有图，可以直接标读图失败么？而不是把脏图丢上去」，09:32 拍「根据你的推荐来 登记然后按照工作流推进吧」。09:32 立 S-264（刀 1e），实施过程中发现它有一处判据天生够不着，09:50 补立 S-266（刀 1f）。

**为什么一刀不够**：S-264 的判据是「按文件头签名判」，而**签名在文件开头、截断发生在文件末尾**。下载到一半的截图、被中断的保存、拷一半的 U 盘文件 —— 头 8 字节完全合法，于是四档全部放行、一路内联出去 ⇒ 400 `invalid image` ⇒ 坏块留历史每轮重发。与 S-246 同一现场，只是触发条件从「格式不收」换成「数据不全」。

**S-266 的判据选择**：不走「解码试试」（PNG 要 inflate + 反滤波，JPEG 要熵解码，四套解码器对 AOT 体积和攻击面都不划算），改看**容器尾部结束标记**，只读头 + 尾 64 字节：

| 格式 | 结束标记 | 之后容忍追加 |
|---|---|---|
| PNG | IEND 定值 12 字节（含 CRC） | 16 字节 |
| JPEG | EOI（`FF D9`） | 32 字节 |
| GIF | trailer（`0x3B`） | 2 字节（单字节标记，放宽就撞压缩数据） |
| WebP | RIFF 头声明的长度（偏移 4，uint32 LE） | 不适用 |

BMP / TIFF / ICO 不判（本来就不内联像素）。从后往前找最后一个命中（压缩数据里可能恰好出现同样字节）。**代价刻意不对称**：漏检代价是上游 400 一次（S-262 兜底），误杀代价是模型彻底看不到一张好图，所以宁松不宁紧。

**交付范围**：

| 层 | 位置 | 改动 |
|---|---|---|
| 探测层 | `ImageFileProbe.HasCompleteContainer` | 新增，四种容器尾部校验，判定出错时返回「不拦」 |
| 工具层 | `FileReadTool.ReadImage` | 新增第五档，排在「超限」之后、「内联」之前（超限的图反正不出门，报「太大」比报「坏了」更有行动指引） |
| 测试 | `ReadImage` 套件 | 新增最小 PNG 编码器（stored deflate + CRC32 + Adler-32），40 → 70 断言；`ReadVideo` 76 断言全绿 |

**顺手修掉的欠账（S-264 自己留下的）**：`ImageMediaGate` 套件有三条断言停在旧口径 —— `junk` 字节 + 声明 `image/png` 应「回落信任声明」，而 S-264 已把实现改成「嗅探不出 ⇒ 一律丢块」。实现改了、测试没跟着改，`npm test` 因此红着。已改为断言丢块，并补一条 `declared=null` 覆盖，套件头注释同步补第四类口径。**这条不是我这刀引起的**，是 1e 的回归缺口，但门禁红着没法收尾，所以同批修掉。

**顺带纠正的文档事实**：根目录没有 `.sln`，只有 `tests\WishfulClaw.Tests.sln`；§五 开头那条 `dotnet build src\runtime\WishfulClaw.sln` 实际不存在（`MSB1009`），已在 §五 补注。

**门禁**：`npm run typecheck` exit 0（node + web）/ `npm test` **91/91** / `dotnet build tests\WishfulClaw.Tests.sln` 0 警告 0 错误。改动文件行数：`FileReadTool.cs` 446、`ImageFileProbe.cs` 335、`ReadImage` 套件 469，全部在 500 行内。

**真机待验**：S-264 §六（造 `foo.png` 装 jpg 内容 / `bar.png` 装 html）+ S-266 §六（造一张截断 PNG 用 Read 读，确认模型收到「读图失败」而不是 400）。
