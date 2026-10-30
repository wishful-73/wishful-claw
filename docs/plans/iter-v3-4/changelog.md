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

## 2026-10-29 10:40 · 刀 1g —— dev 第 6 轮审查的回头刀（S-261 / S-262 / S-266 补正 + S-267）

**起因**：dev 第 6 轮（`review-feedback-round6.md`）判决 1b~1f **全部真机生效** —— S-261 零 400、S-264 零误杀、S-266 七张坏图全拦、S-262 引擎侧 43 条断言全绿。**判决是真的，缺陷也是真的**：dev 同时点出三处「修了却没修完」，都是**同一条线上漏掉的调用点**，不是新需求。

### 一、S-261 补正：判据第三条协议没接上

刀 1b 把 url 闸补进了 chat（`:253`）和 Anthropic，**漏了 Responses 的用户消息路径** —— 那里自己写着两份「url 非空」的旧判据：`OpenAIResponsesInputWriter.HasImageContent` 与 `WriteResponsesMultimodalMessage` 的内联过滤。于是 `file:///D:/x.png`、`oc-media://…` 这类**根本没填**的引用，在 Responses 上照旧裸透传。

顺带发现 chat 的 `:333`（tool result 路径）与 Responses `:289` 是同一个遗漏 —— 刀 1b 只改用户消息那处，没改工具结果那处。

**收口方式**：`ProviderContentHelpers.IsSendableImageBlock(block, warn)` 作为**单块判据**（非图块 `⇒ true`；url 块逐字复用 S-261 的本地绝对路径判据；base64 块走 S-264+S-266 的嗅探 + 容器完整性），三处协议、五个调用点全部改走它。**理由**：这个问题已经因为「每个调用点写一份」错了两次，再修一次只会错第三次。

`ImageInput` 套件 53 → 62 条断言。裸透传那条用「渗透法」验：214 个坏 url 逐条喂，断言**没有任何坏块能到线上**。

### 二、S-266 补正：判据只活在 Read 工具里

dev 坐实 `HasCompleteContainer(string path, …)` 全仓**只有 `FileReadTool.cs:273` 一个调用点**，且只有 path 版 —— 没有 base64 版。而真实日志 18 条图像 400 里 **13 条在微信渠道**：那条路的图从来不是 agent 读出来的，是渲染层注入的历史块，**组包时才第一次见到字节**。

只修 Read 路径 = 治了一半就关需求。**修法**：

| 层 | 改动 |
|---|---|
| 判据本体 | 抽成 `JudgeContainer(head, tail, totalLength, mediaType)`，path 版与 base64 版**共用一份** |
| 新入口 | `HasCompleteContainerInBase64(string?, mediaType)` —— **只解头部 16 字符与尾部一个窗口**，不解全量（4 MB 的图不该为看尾巴整段解码）；解不开一律放行，与 path 版「读不到就不拦」同一取舍 |
| 接线 | 接进 `IsSendableImageBlock` 的 base64 分支 ⇒ 「能不能出门」只有一处答案 |

`ReadImage` 套件 70 → 77 条断言（逐格式正反例 + data URL 前缀剥离 + 尾部追加容忍）。

**当初选 A 不选 B**（B = 文档里写明「只管 Read 这条路」）：A 成本很低，B 会让下次翻文档的人以为治过了。

### 三、S-262 补正：替换只活一轮

dev 连续两轮点名同一处：注入一次就把 `PendingProviderRejectionReport` 置 null，下一轮 `ExecuteTurnAsync` 从 durable conversation 重建 wire 副本时，**坏数据原样回来** ⇒ 同一 400 再来 ⇒ 指纹去重命中 ⇒ 抛。**会话照样废**。

**修法**：不再按「最后一条带工具结果的消息」替换，改成**按 `ToolUseId` 认人**。

| 新增/改动 | 作用 |
|---|---|
| `AgentRuntimeRunState.ProviderRejectionToolUseIds`（HashSet） | 记死哪几份坏数据，**整个 run 有效** |
| `AgentRuntimeRunState.ProviderRejectionRegistrationPending` | 登记开关 —— catch 里拿不到组包副本，只能先置标记、下一轮组包时按标记认人 |
| `ReplaceMarkedToolResults`（替掉 `ReplaceTrailingToolResults`） | 遍历**全部**消息、命中 id 就换。位置变了也换得掉 —— 重发成功后模型继续调工具，坏数据很快就不再是最后一条 |

上限 2 与指纹去重**不变**：修好之后同一份坏数据不会再 400，去重不会误伤。`ProviderRejection` 套件 39 → 43 断言（新增「坏数据移到中间仍被替换」与「未登记的 `ToolUseId` 不动」）。

### 四、S-267：`browser_screenshot` 白图静默成功

与 S-264 / S-266 同一个病根 —— **坏数据包装成好东西发出去** —— 只是这次的坏数据是我们自己造的。浏览器侧截到全白（无容器 / 撞 preload 沙箱 / 页面没画完）时，工具照旧返回成功 + 一段 base64 图，模型拿去推理，最终表现为 400 或幻觉。

**修法**：新建 `browser-screenshot-blank.ts`（白图抽样 + DOM 探针），`executeBrowserScreenshot` 尾部拼警告文本。**不阻断**（白图有时真是用户要的），只在结果里说清楚。

### 五、门禁

`npm test` **91/91**（`ImageInput` 62 / `ImageMediaGate` 38 / `ProviderRejection` 43 / `ReadImage` 77 全绿）/ `npm run typecheck` exit 0 / `dotnet build` 两个 sln 均 0 警告 0 错误。

**修掉一个自己造成的红灯**：`ImageMediaGate` 的 `goodContent` 用的是 14 字节 PNG 头（签名 + IHDR，**没有 IEND**）。S-264 之后容器完整性判据一接上组包层就把它拦了 —— 那是对的（素材本身发不出去），已换成完整 1×1 PNG。

### 六、判据 3（「真实日志逐条不再复现」）仍欠

S-261 验收清单第 3 条要求拿 `2026-10-28-请求错误导出.txt` 的 18 条逐条复验，目前只验了新造的坏图。**欠着不是忘了，是那条需要真机 + 家里那台机器的原图**，留给老大迭代收尾前跑一次。

## 2026-10-29 11:40 · 刀 2 —— S-241 插件视图独立窗口落地

**做了什么**：S-240 声明的 `views[]` 从「点了弹一句『下个版本可用』」变成真开独立窗口，并把进程生命周期管住。

### 一、落点

| 文件 | 内容 |
|---|---|
| 新增 `src/main/plugins/plugin-window.ts`（307 行） | 开窗 / 重开 / 销毁 / 崩溃处理 / 注册表 |
| 新增 `src/main/plugins/plugin-view-rules.ts`（54 行） | **比需求 §4.3 多拆的一层**：两条纯判据，零 electron 依赖，可单测 |
| 新增 `src/main/plugins/plugin-lifecycle.ts`（97 行） | 空闲回收 + 退出时 pid 树回收 |
| 新增 `src/main/ipc/plugin-view-handlers.ts`（45 行） | `plugin-view:open` / `close` / `list` / `status` |
| `src/main/index.ts` | 注册四个 handler + `registerPluginLifecycle()` |
| `channels.ts` / `messagepack-channel-routing.ts` | 四个 channel 常量 + 分类 |
| `WorkspaceSidebar.tsx` | 占位 toast 换成真开窗，失败分「崩溃循环 / 其它」 |
| `locales/{zh,en}/layout.json` | 删 `extensionViewNotReady`（占位期的死 key），换 `extensionViewOpenFailed` / `extensionViewCrashLoop` |
| `tests/plugin-view-rules/program.ts` | 新增套件 **22 断言** |

### 二、三个刻意选择

1. **渲染端只传 id，不传 entry / 尺寸。** 标题、尺寸、加载哪个 html 都由主进程自己 `extension/list` 查。让渲染端传 entry 看着少一次请求，但那等于让渲染端决定主进程加载哪个本地文件 —— 权限全开不该从这扇门漏出去。
2. **越界判据自己解析 `.` / `..`，不依赖调用方 resolve。** 多一个调用点漏 resolve，这条闸就等于不存在；`fake-plugin-bar` 那种同前缀兄弟目录靠「必须带分隔符」挡住。
3. **崩溃计数按时间窗淘汰，不按累计次数。** 一分钟三次 = 循环，必须停手；两分钟两次 = 偶发，必须允许重开 —— 按累计数算，一次显卡驱动抖动就把插件永久废掉。

### 三、门禁抓到一条真缺陷（值得记）

`test:ipc-msgpack-routing` **直接拒了本刀**：四个 channel 用 `registerMessagePackHandler` 注册、却没加进 `MESSAGEPACK_INVOKE_CHANNELS` ⇒ 渲染端 `invoke` 走非 msgpack 路径 ⇒ 主进程回 `No handler registered`。**typecheck 抓不到**（两边都对，就是接不上），只有这个套件会喊。已补分类，该套件 153 断言 / 300 channel 全绿。

### 四、验收夹具

新增 `docs/plans/iter-v3-4/fixtures/fake-plugin/`（`extension.json` + `view/index.html`）：900×680 独立窗口，页面里直接显示 Node 版本 / `require('fs')` 可用性 / 本进程 pid，另有「拉起 ping 子进程」与「让本窗口崩溃」两个按钮。**S-242 / S-244 的验收也用它**，不止本条。

### 五、门禁

`npm run typecheck` exit 0（node + web）/ `npm test` **92/92**（新增 `plugin-view-rules` 一条）/ 本刀无 C# 改动，沿用 10:40 的 `dotnet build` 0 警告 0 错误。

### 六、真机待验

§5 七条逐条对应见 `S-241.md` §8.4。两条主动挂账：**空闲回收**（15 分钟真机等不起，只有纯判据覆盖）、**`persist:plugin-<id>` 分区隔离**（要两个插件才看得出，交给 S-244 五条全通验证）。

## 2026-10-29 13:20 · 刀 3 —— S-242 插件资产下载器落地

**做了什么**：把「插件声明资产 id → 用户点下载 → 校验就绪 → 插件拿绝对路径」这条链打通，落在主进程 + 设置页两层。资产**不进插件目录**，统一落 `{dataRoot}/plugin-assets/`，多插件共用、插件换版不重下、卸载插件不删（删是 S-244 的独立入口）。

### 一、落点

| 文件 | 内容 |
|---|---|
| 新增 `src/shared/plugin-asset-types.ts`（97 行） | 两端共用的契约：`PluginAssetState` / `PluginAssetStatus` / `PluginAssetProgressEvent` / `PluginAssetPublicInfo` + `formatAssetSize`。**刻意不含 url / sha256** |
| 新增 `src/main/plugins/plugin-assets.ts`（~490 行） | 状态机 / 多源回退 / Range 续传 / 流式 sha256 / 节流推送 / 单源退避重试 / 并发闸门 / 取消保留 `.part` |
| `src/main/plugins/plugin-asset-catalog.ts` | 加 `toPublicAssetInfo`（目录表 → 渲染端投影，剥掉 url / 哈希）；`formatAssetSize` 迁到 shared 供两端共用 |
| 新增 `src/main/ipc/plugin-asset-handlers.ts`（95 行） | 七个动作 `catalog` / `status` / `status-of` / `download` / `cancel` / `verify` / `remove` + 进度事件 `plugin-asset:progress` 广播 |
| `src/main/index.ts` | 注册 `registerPluginAssetHandlers()` |
| 新增 `src/renderer/src/lib/plugins/plugin-assets.ts`（57 行） | 渲染端封装：查状态 / 下载 / 取消 / 校验 / 订阅进度 |
| 新增 `src/renderer/src/components/settings/extension-assets.tsx`（~240 行） | 资产区：状态徽章 + 体积 + 进度条 + 下载 / 取消 / 重试；`compact` 版给卡片用 |
| `ExtensionPanel.tsx` | 卡片挂 `compact`（未就绪才显示），详情页挂完整版 |
| `channels.ts` / `messagepack-channel-routing.ts` | 七个 invoke channel + 一个事件 channel |
| `locales/{zh,en}/settings.json` | `extension.assets.*` 十二条 |
| `tests/plugin-assets/program.ts` | 新增套件 **38 断言**（本地 http server 跑真下载） |
| `fixtures/fake-plugin/extension.json` | 声明 `demo/logo.png`（真条目）+ `demo/not-in-catalog`（未知 id，验验收第 7 条） |

### 二、四个刻意的选择

1. **`status` 只查存在性 + 大小，不重算 sha256。** 这是需求 §4.4 明写的判据：每次开面板都全量校验，用户看到的是几秒卡顿。代价是「同大小篡改」看不出来 —— 所以另有显式 `verify`，单测第 ⑦⑧ 条把这两面都钉住了。
2. **渲染端拿不到 url 与 sha256。** 目录表是主程序独占的：给了渲染进程地址等于给它一条绕过主进程直接下载的路，而那条路上没有任何校验。
3. **取消 ≠ 失败。** 取消回 `absent` 且保留 `.part`，失败才记 `failed` 并清 `.part`（坏字节留到下次只会更糟）。用户点两次取消等于重下，是这里最容易写错的地方。
4. **进度节流放在 manager 里，不放 IPC 层。** ≥ 200 ms 或 ≥ 5% 才推；下载 500 MB 时不节流会推上万个事件，渲染端直接卡死。状态类事件（verifying / ready / failed）一律强推，不节流。

### 三、单测为什么值得写（六条都是「错了不报错」）

断点续传没续上 → 只是从 0 重来；校验失败落了 ready → 投毒文件冒充官方资产；多源不回退 → 主源一挂全国下不动；取消删 `.part` → 点两次取消重下；并发不限 → 十个资产一起拉，用户以为软件死了；status 全量哈希 → 面板卡三秒。本地 http server 覆盖：全新下载 / 续传（断言 `Range: bytes=N-`）/ sha 不符 / 404 回退 / 取消后重下 / 三路并发峰值 2 / 未知 id / 不支持 Range 的源整下重来。

**并发那条第一版写错了**：按服务端 TCP 连接数断言，把「数据已下完、连接还没 close」的几十毫秒算成第三路，误报。改成看 `runningCount`（槽位占用）才测对 —— 顺带给 manager 加了只读 `runningCount`，设置页以后能显示「正在下载 N 项」。

### 四、门禁

`npm run typecheck` exit 0（node + web 三配置）/ `npm test` **93/93**（TS 71 + C# 22，新增 `plugin-assets` 一条）/ C# 侧本刀零改动，`dotnet build tests.sln` 沿 1g 的 0 警告 0 错误。

### 五、真机待验

`S-242.md` §5.1 九条对应表。两条主动挂账：**插件视图内的空状态（§4.6 层 3）** 与 **装插件那一刻的体积提示（层 2，属 S-244 安装确认弹窗）** —— 前者要等有真插件视图，后者要等 S-244 那刀。
## 2026-10-29 11:02 · 登记 S-269 —— 摘要请求 429 重试窗口错配

> 老大原话：「多次压缩的时候压缩失败了，摘要生成失败，已使用回退摘要 —— 这个是什么原因呢」。**本轮只登记，不动代码。**

### 一、根因（日志坐实，不是推断）

生产实例 `~/.wishful-claw/logs/` 五波失败（10-28 20:31 / 10-29 09:25 / 10:08 / 10:24 / 10:42）全是同一条：

```
OpenAI summarization HTTP TooManyRequests:
{"error":{"message":"Upstream request failed: [ttft_admission_refused]
  the cell is at capacity; retry shortly (after 29 s)"}}
```

上游是**容量准入拒绝**，明确说了等 3~39 秒。而 `ContextCompression.cs:598-601` 的退避是 `1500ms * (1 << attempt)` ⇒ 1.5s / 3s，三次尝试写入时间 `10:08:20 → 10:08:22 → 10:08:26`，**整根重试链只活 6 秒**，全部落在同一个拒绝窗口 ⇒ 等于一次都没真正重试。

### 二、为什么这场失败会被翻译成「摘要器不可用」

三次失败 ⇒ `MechanicalFoldDigest` 零信息占位 ⇒ `AgentLoop.ContextCompression.cs:115-123` 再截断并置 `SummarizerFailed` ⇒ 渲染端 `contextCompression.summarizerFailed` = 「摘要生成不可用，已使用回退摘要」。**用户拿到的结论是错的**：摘要器好好的，渠道在限流。

### 三、一处自我更正（先说清楚，免得后面跟着错）

我先前说「truncate 路径不打水印 ⇒ 几分钟重来一遍」，**读错了**：`AgentLoop.ContextCompression.cs:172` 的 `ResetCompactionWatermark` 对两条路径都执行。10:08 / 10:24 / 10:42 三波是会话在 135k~143k tokens 区间持续增长、反复顶到 144k 触发线，**不是水印缺陷**。S-269 **不含**水印改动。

### 四、五条修法（同刀）

| # | 做什么 | 为什么 |
|---|---|---|
| A | 摘要调用非 2xx 改抛 `ProviderHttpException` | 该类早就带 `StatusCode` + `RetryAfter`（`ProviderRetryPolicy.cs:20-49`），现在却被丢掉 |
| B | `ComputeDelayMs` 提到 `internal` 并加 `maxBackoffMs` 参数 | 现有 `Math.Min(raMs, MaxBackoffMs)` 会把「等 29 秒」压成 15 秒，3 次机会不够覆盖 |
| C | 按失败类型分流：429/5xx 重试且**不砍预算**；context-window 超限才递减；真 400 不重试 | 递减 400k→200k→100k 是为输入超长设计的，对限流毫无意义 |
| D | 降级文案按原因分档（限流 / 超时 / 其它） | 「摘要器不可用」是错误结论 |
| E | 原因透传进 `CompressionError` | 渲染端全仓 grep `compressionError` **零命中**，故障原因从没到过用户眼前 |

**核心判断：不造第二套退避。** 摘要请求是整条 provider 调用链里唯一绕开 `ProviderRetryPolicy` 的地方，而那边的判据（429/≥500、honor `Retry-After`、指数退避 + jitter）都是现成的。

### 五、文档落点

`requirements/S-269.md`（新建）/ `plan.md` §2.4 + §七 刀序 3b + §7.1（承接 **15 → 16**）/ `raw-requirements.md` §一二。

## 2026-10-29 11:20 · 刀 3b 交付 —— S-269 摘要请求按上游要求等

**改了什么**（细节见 `S-269.md` §八）：

- `ProviderRetryPolicy.ComputeDelayMs` 提 `internal` + 新增 `maxBackoffMs` 参数（默认仍 15 s，主 turn 零变化）；摘要侧传 45 s，`Retry-After: 29` 不再被压成 15 s。
- `ContextCompression` 新增三个类型：`SummaryFailureAction`、`SummaryFailurePolicy`、`ResolveSummaryFailurePolicy(Exception)`。`SummarizeAsync` 原来三个 `catch` 收成一个，按 policy 分流 —— **429 原样重发并按上游时间等**，只有 `context_length_exceeded` 才砍预算，真 400 一次都不重试。
- 非 2xx 从裸 `InvalidOperationException` 改抛 `ProviderHttpException.CreateAsync(...)`，状态码与 `Retry-After` 一起带走。
- 失败原因（`rate_limited` / `server_error` / `timeout` / `context_overflow` / `empty_output` / `other`）经 `context_compressed` 事件到渲染端，文案按档位分：限流就说「服务商繁忙」，不再一律说「摘要生成不可用」。
- 日志统一成 `attempt failed attempt=N action=X reason=Y budget=Z error=…`，一行看全判定。

**为什么「抽纯函数」不算加戏**：判据 7 明确要求「覆盖判据 1~4 的纯函数部分（退避计算 / 重试分类 / 预算不递减）」。分类散在三个 `catch when` 过滤器里，测试根本够不着；收成一个返回 policy 的函数后，`ShrinkBudget` 成了唯一动输入的 action，于是「429 的 action ≠ ShrinkBudget」这一条断言就等价于「限流不砍预算」，比 mock 一整个 HTTP 端点便宜也稳。

**测试**：新建 `tests/WishfulClaw.CompactionSnapshotRegressionTests/SummarizerRetryChecks.cs`，24 条断言。`npm run typecheck` 0 错、`npm test` **93/93**、`dotnet build WishfulClaw.Agent.csproj` 0 警告 0 错误。

**欠账**：判据 1 要一个恒返 429 + `Retry-After: 3` 的 mock 端点看真实间隔，判据 5 要在真会话里看「服务商繁忙」文案 —— 两条都等老大真机；`ContextCompression.cs` 的 500 行豁免头已按规矩重盖时间戳与行数（1108，2026-10-29），不重新审。

## 2026-10-29 14:05 · 刀 4 交付 —— S-243 录音采集基座

**做了什么**（细节见 `S-243.md` §8）：

- `plugin-audio-wav.ts`（纯 node，能直接跑回归）：44 字节 RIFF/WAVE 头、`WavWriter` 先占位后回填两个长度字段、`SegmentingWriter` 按 `segmentSeconds` 整帧切段，余量带到下一块。
- `plugin-audio.ts`：`installDisplayMediaHandler` 走 `callback({ video, audio: 'loopback' })` 拿系统音（拿不到源就 `callback({})` 明确拒绝，不挂死）；`AudioRecorderRegistry` 管会话 → 目录 → 分段 writer，落盘 `{dataRoot}/audio/{sessionId}/`。
- `plugin-audio-handlers.ts`：`sources` / `start` / `append` / `stop` 四动作 + `plugin-audio:segment` 广播。
- 渲染端 `audio-recorder.ts`：麦克风 / 系统内录 / both，`AudioContext({ sampleRate: 16000, channelCount: 1 })` 做重采样，写链串行化（IPC 异步，乱序 append 会让音频前后颠倒）。
- preload 挂 `window.api.audio`；四条通道进 MessagePack 白名单。

**为什么不给插件视图包一层 API**：插件窗口 `nodeIntegration: true` / `contextIsolation: false`（`plugin-window.ts:193-195`），插件本来就能自己开流，再包一层纯属多余。真正需要统一入口的是主窗口那侧的「能听」面板。

**两条实测约束写进代码**：①纯音频 `getDisplayMedia({audio:true})` 抛 `AbortError`，必须先要 video 再 `stop()` 掉 video track 并 `removeTrack`；②loopback 与麦克风实测都是 48 kHz / 1 ch，但实现按 `track.getSettings()` 动态取值，不写死单声道。

**测试**：新建 `tests/plugin-audio`，46 条断言 —— 44 字节头逐字段（含两个长度字段与 `byteRate` / `blockAlign`）、17 s 按 5 s 切段得 5/5/5/2 且帧数不重不漏、空录音不建文件、短录音保留精确长度、`segmentSeconds: 0` 整段一文件。`npm test` **94/94**、`npm run typecheck` 0 错。

**欠账**：麦克风 / 系统内录 / both 混音 / 电平四条要真机（第 0 刀用 440 Hz 探针验过 loopback 通，本刀是端到端复核）；`segmentSeconds` 缺省 30 在 IPC 层与 `SegmentingWriter` 各一份，将来改要一起改。

## 2026-10-29 15:10 · 刀 5 交付 —— S-244 安装确认与卸载清理

**先纠一处旧结论**：S-244 §3.2 原来写「卸载不清理私有 KV」——实读 C# 不成立。`ExtensionManifestStore.cs:140-186` 早就把插件目录、state、KV 命名空间、manifest 声明过的 secret 全清了。本号真正缺的只有 **session 分区**（S-241 才出现，C# 不知道它存在）。

**做了什么**（细节见 `S-244.md` §8）：

- `extension:remove` 顺序钉死：停用收子进程 → 关插件窗口 → 清 session 分区 → C# 删目录/state/KV。窗口必须排在清分区之前，否则渲染进程还在往同一个分区写 localStorage，清完立刻长回来。
- 新增 `plugin-cleanup-rules.ts`（纯判据：`isValidExtensionId` / `pluginPartitionName` / `pluginPartitionDirName`，正则与 C# `ExtensionIdRegex` 一字不差）+ `plugin-cleanup.ts`（`clearStorageData` + `clearCache` + 删 `{userData}/Partitions/plugin-<id>`）。清理不抛错，失败只回 `cleanupWarnings`，卸载照样算成功 —— 一个锁住的 Cookie 文件不该留下「列表里有、目录删一半」的脏状态。
- `plugin-window.ts:197` 原来自己拼 `persist:plugin-${pluginId}` 字面量，改调 `pluginPartitionName` 共用判据。两处各写一遍早晚会漂，漂的那一次就是删错目录。
- 安装确认（**不采用** §4.3 设想的「后端加 confirm 参数」）：确认是用户看不看懂的事，拦在主进程只会让两套文案同时要维护。改成渲染端安装前先读 `<folder>/extension.json` 摘要 → 资产 id 去目录表算体积（查不到的不计入，宁可少报不编数字）→ 弹窗（按 `views` 有无分两套「它会碰什么」文案、资产行无资产时整行不出现、不勾禁用安装）→ 按插件 id 记在 localStorage，同一插件更新不再问。
- 「已下载的运行文件」独立清理区（S-244 §6 风险 5 的落点）：只列已就绪的资产，单项删 + 全部清理，都走 confirm。卸载不删共享资产，那就必须有个看得见删得掉的地方。

**测试**：新建 `tests/plugin-cleanup`，**96 条断言**。重点不在「拼得对」，而在**什么情况必须拒绝**：19 个必须拒绝的 id（`../evil`、`C:\temp`、长度越界、空格、点、`.`／`-` 开头、unicode……），拒绝即不删。另有「只要被接受，产物里不许出现 `..` / `/` / `\`」的最后一道门。`npm test` **95/95**、`npm run typecheck` 0 错。

**欠账**：判据 1~8 全在 UI 侧，要拿一个真插件目录走一遍；Windows 上 `clearStorageData` 之后删分区目录仍可能被 Electron 握住，已用 warning 兜底，若真机复现再补启动清扫。

## 2026-10-29 16:05 · 刀 6 交付 —— S-247 内存观测「看得见」

**只做观测，不做优化**（S-247 §7 一条没碰：不定时 GC、不杀渲染进程、不设上限）。

**做了什么**（细节见 `S-247.md` §9）：

- `app.getAppMetrics()` 一次拿全主 / 渲染 / GPU / utility —— 分别采样口径会不一致，越算越糊涂。Worker 走它早就写好、但全仓零调用的 `worker/memory`。
- 5 s 采样、5 分钟落一组日志（`memory role=... pid=... ws=...MB`），单进程 ≥ 1.5 GB 或 Worker 托管堆 ≥ 800 MB 追加一条 `memory high`，同 pid 10 分钟去重 —— 去重不是省事，是不让「内存高」这种持续状态把 5 分钟一组的采样日志淹掉。
- 设置页「关于 → 资源与诊断」：合计 / 取样时间 / 每进程一行 / Worker 托管堆·堆·碎片 / 超阈值标红。**只读**，没有「清理内存」按钮 —— 给按钮只会让人以为问题解决了。
- 单位只换算一次：`getAppMetrics` 报 KB，`buildProcessRows` 换成字节，渲染端不再除一遍。两处换算就是两处可能写错。

**一处偏差须老大确认**：plan §7 原拍「状态面板常驻数字」，落地做成设置页页签。理由：这条需求的场景是事后复盘与用户报障，不是实时盯；面板打开与否不影响采样与日志。`RuntimeStatusPanel` 占位原样未动。

**测试**：新建 `tests/memory-monitor`，**36 条断言**。钉的不是「数字对不对」，是三类**不会抛异常只会说谎**的地方：KB→字节、`Browser` 才是主进程 / `Tab` 是渲染进程、告警阈值边界与去重窗口。`npm test` **96/96**（此前 95/95），`npm run typecheck` 0 错。

**顺带记一笔**：`logger` 的 `source` 只允许 `main / renderer / worker / ipc`，最初写了 `memory` 直接被 typecheck 拒 —— 改成 `source=main` + 消息前缀 `memory`。

**欠账**：真机四条待验（面板数字会动 / Worker 三数齐全 / 日志有 memory 行 / 截图可定位进程），见 `S-247.md` §9.5。

## 2026-10-29 19:30 · 刀 9 交付 —— S-256 超长文本整页静止

**先纠一句历史结论**：iter-29 T-15「取消步长上限」是为了「长思考追得上上游」，代价写在 S-149 §7.4 里 —— 「要真正消除得上流式期间限制单帧渲染的文本量，未做、等口径」。这一刀就是那个口径。**上限从 ∞ 收到 1600**（agile）/ 1200（elegant），公式 `min(比例步长, maxStepChars)`；折成速率仍是每秒 5 万字符，正常流式照旧追得上，只有异常积压才慢下来。

**第二根口子是老大给的样本形态**：连续长段落没有空行 ⇒ 一个块都切不出来 ⇒ tail = 全文累积，每帧全量重解析。`MAX_TAIL_CHARS = 8000` + 硬切纯函数 `resolveTailHardCut`（空行 → 行边界 → 行内让开标记字符），fence / math 内部绝不切。

**C（`content-visibility: auto`）主动放弃，要老大点头**：它治不了视口内正在疯长的 tail（本 bug 的主场），却会因为估算高度让滚动锚点跳 —— 老大对聊天窗抖动零容忍（S-233 就是为此挂的账），拿它去换抖动不值。

**没做的那件事如实记**：需求 §5.1 要求先实测 longTask / reactCommit 数据再定权重，**没做**（没有真实压测环境），修法择取依据仍只有代码层事实，不是实测。真机压测四条待验见 `S-256.md` §7.5。

**测试**：`tests/streaming-render-pool` 改写「无步长上限」断言（口径变更落地点）+ 新增「上限折成速率 ≥ 每秒 3 万字符」防调小；新建 `tests/streaming-tail-split`（15 checks，钉切点选择 —— 切错不会报错，只会渲染出破碎文本）。`npm test` **98/98**（此前 97/97），`npm run typecheck` 0 错。

## 2026-10-29 18:45 · 刀 8 交付 —— S-248 纯文本档换形态

**这根轴上一版根本没做**：S-225 只做了「开合深度」，纯文本档照样是满屏带边框的卡片壳，只是全收起了 —— 老大 2026-10-28 09:34 要的是「不呈现组件了，也不能点开组件查看，类似子 agent 卡片里面的显示方式」。所以这刀补的是**形态**：`card` / `line` 两根独立轴，只有 `text` 走 `line`。

**判据先落纯函数**：`deriveProcessRenderForm` + `shouldRenderToolAsLine` 全在 `render-density.ts`，四步判据的顺序就是优先级 —— 非 text 档 → 卡片；交互类 → 卡片（一行字点不了）；输出即结果 → 卡片（藏起来等于没做）；待审批 → 卡片（安全底线）；其余降级。文件保持**零业务依赖**，工具名白名单由调用方传，不 import 工具常量。

**行渲染直接抄子 agent 卡片那一套**：`getStepStatusIcon` / `getStepStatusColor`，不新造一套配色。行尾保留耗时与 `+N -N`（§9.1 拍的「保留」），diff 只在有落盘快照时现算。

**一处口径冲突已订正**：S-225 的「force 项浮出折叠面板」在 text 档会**把报错弹回卡片形态** —— 与老大 09:40「错误丢了就丢了，文字行显示红色就行」直接顶上。已收窄为「text 档只有仍需卡片的项才浮出」，错误留在面板里当红行；`compact` / `detail` 一字未动。

**边界**：运行中也降级，所以命令类工具跑起来时看不到输出流 —— 这是「不提供点开输出」的必然结果，要边跑边看就切 `compact`。

**测试**：`tests/render-density` 从 14 组加到 **19 组**，钉五件事：只有 text 换形态 / 普通工具降级 / 非 text 档不降级 / 交互·视觉·待审批不降级 / 错误仍降级。`npm test` **97/97**，`npm run typecheck` 0 错。

**欠账**：真机四条待验（观感 / 禁点 / 档位可逆 / 白名单生效），见 `S-248.md` §10.3。

## 2026-10-29 17:20 · 刀 7 交付 —— S-260 浏览器保活池（上限 2）

**判据先落地，再接线**：淘汰顺序错了不会抛异常，只会让 agent 拿到「Browser view is not attached」然后无脑重试 —— 那是最难查的一类问题，所以全部判断收进纯函数 `lib/browser/browser-keepalive.ts`（141 行，不 import React / store），store 与 UI 只做状态读写。

**两条硬规矩**（需求 §4.2 级 0）：当前展示的作用域、agent 持 lease 的会话，**一个都不许动**。动不了时不许静默 —— 给一段能转述给用户的话：谁占着、占的什么页面、空闲多久、能做什么。

**用户与 agent 的不对称**：用户自己要看（点 tab / 手动输地址）⇒ 池满也强制腾位，但要**优先挑没被任务占着的**那个，不能为了看个页面让另一个会话返工；agent 后台调用 ⇒ 拿不到就说清原因，绝不去抢别人的名额（`goto` 传 `keepAliveExplicit: false`）。

**挂载名单是这刀真正的改动**：`RightPanel` 从「全部 browser tab 都挂着、只切 opacity」改成「只挂池成员」。每个 webview 是独立 renderer 进程（80~150 MB 量级），这正是 S-247 里最确定的一条可疑源。

**缺口不留在界面上**：名额没拿到时渲染占位卡（标题 + 说明 + 「在此处打开」），否则用户看到的是一片空白，分不清「满了」还是「坏了」。

**一处口径冲突已订正**：plan §七 第 7 行原写「不做 LRU」，与需求 §4.2 的淘汰分级表直接矛盾 —— 不做软淘汰的话「池一满就永远打不开第三个」，§7 验收第 1 条根本过不去。**以需求为准**，plan 该行已改并注明出处。

**一处比需求更保守，要老大点头**：§4.2 级 3「面板关着但曾是当前会话 ⇒ 可淘汰」**没实现**。当前作用域无论面板开合都受保护 —— 收起面板多半是临时让位，判「关着即可淘汰」会让用户来回切面板时反复销毁重建 webview。

**测试**：新建 `tests/browser-keepalive`，**36 条断言**。钉的是三类「错了不报错」的场景：把可见的那个卸掉（界面白掉）、把跑任务的会话卸掉（agent 无脑重试）、该拒绝时静默混过去（agent 去做用户没让它做的事）。另含时钟回拨、幂等、`describeScope` 缺省不崩。`npm test` **97/97**（此前 96/96），`npm run typecheck` 0 错。

**欠账**：真机四条待验（3 会话只挂 2 / lease 期间不消失 / 拒绝文案带两者信息 / 关 tab 立即释放 + 5 分钟空闲回收），见 `S-260.md` §9.3。

## 2026-10-29 14:20 · 刀 10 交付 —— S-270 工具名统一出口

老大 13:56 报「后续处理了很多新工具，聊天窗里直接显示英文名称，看着不舒服，很多用户也看不懂」；14:03 追加「这些需要进本迭代」，并拍了两处口径：**兜底用「工具 · 原名」**、**`en` 侧一并友好化**。

**根因不是「忘了一条」，是机制上就没有防漏**，三层叠在一起：

1. `permission.toolLabels` 只有 **23 条**，清一色 OpenCowork 迁移期那批；之后每个迭代新增的浏览器 / 桌面 / codegraph / 目标 / 交互类工具**一个都没补**。
2. 渲染点是 `t(key, { defaultValue: name })` —— 缺 key 静默回退英文原名，**没有告警、没有兜底、没有测试**。
3. `FileChangeCard:264` 和 S-248 新增的 `ProcessTextLine` **根本不查表**，直接渲染原始 `name`。

⇒ 只补表会留一半窟窿，三件套一起做才收得干净：**补到 61 条 + 统一出口 `resolveToolDisplayName` + 防漏回归**。

**统一出口的链路**：历史别名归一（`normalizeToolName`，`BrowserSearch` → `WebSearch`）→ 查表 → MCP（`mcp__srv__tool` → `Tool`）→ `codegraph_` 前缀族（「代码图谱 · 探索」）→ 兜底「工具 · 原名」。**任何一环都不再裸回退 camelCase / snake_case。**

未命中判据不依赖 i18next 配置（`returnNull` / `parseMissingKeyHandler` 都没设）：缺 key 时逐级 fallback 到 `en`、再到 `fallbackNS: common`，全落空后**返回 key 本身** —— 「返回值等于 key」就是确定的未命中信号。

**顺手收掉的一个同类旧兜底**：`BrowserToolCard/icons.tsx` 的 `fallbackTitle()` 末行是 `return name`，新浏览器工具（如 `BrowserEvaluate`）照样露英文。整个函数删掉，改走统一出口。`DesktopActionToolCard` 的 `t(\`toolCall.desktop.${name}.title\`)` **连 defaultValue 都没有**，缺 key 会把 `toolCall.desktop.Xxx.title` 原文顶上去，一并补。

**防漏测试（本条最值钱的部分）**：新建 `tests/tool-labels-coverage`，9 条断言。与既有 `test:i18n-coverage` **互补而非重复** —— 后者静态扫 `t('字面量')`，而工具名取键是动态拼接（`t(\`permission.toolLabels.${name}\`)`），**静态扫天生扫不到**，这正是漏了 38 条却一路静默的原因。新测试反过来：扫代码里声明的工具名常量（实测 47 个），反查 locale 表。第 2 条以后就是闸 —— **新增工具常量忘了补中文，`npm test` 直接红**。

**门禁**：`npm test` **99/99**（新增 1 条）、`npm run typecheck` 三配置 0 错。

**顺手修的**：`package.json` 里刀 9 加的 `test:streaming-render-pool` 少了 4 空格缩进，该处还有 1 个 bareLF，一并归一。

**真机待验**：四处（工具卡 / 折叠条 / 文件变更行 / 纯文本行）都不再露 camelCase；MCP 与插件工具走兜底；切 `en` 同样干净。清单见 `S-270.md` §8.6。

## 2026-10-29 14:45 · 刀 10 补正 —— S-270 漏了 C# 侧 61 个第一方工具

**dev 第 7 轮审查给的两张「兜底卡」是活证据**：`CronList` 与 `SubAgentStatus` 在聊天窗显示成「工具 · CronList」，不是 bug 回归，是 S-270 交付缺口 —— 中文表把 C# 侧定义的第一方工具整片漏了。

**我的闸当时扫不到它们**，这是设计漏洞不是疏忽：第一版只扫 `src/renderer/src` 的 TS 常量（`*_TOOL_NAME`），而 cron / goal / 全局任务 / 项目 / 团队 / 插件 / 飞书 / 微信 / 子代理 / `Terminal` / `Monitor` / `ExitPlanMode` 这些工具**全部在 C# 里声明**，一条闸都没看着。

**实际缺口比 dev 说的 17 个更大**：全量扫 C# 侧两种声明方式（`ToolDefinitionPlaceholder("X", ...)` 注册 + `public string Name => "X"` 的 `IToolExecutor` 实现），`Tools/` 目录下共 **97 个**第一方工具，**62 个没有中文标签**（含 `Terminal`；`SubAgentStatus` / `SubAgentDetail` 是需求 §4.1 点名要补的）。

**补法**：`permission.toolLabels` 61 → **124 条**（zh/en 逐条对齐），按族分组：定时任务 6 / 目标 6 / 全局任务与派发 7 / 项目与会话 11 / 团队 4 / 子代理 2 / 消息渠道通用 8 / 飞书 12 / 微信 2 / 其它 4。

**测试加固（本条真正的收获）**：`tests/tool-labels-coverage` 加第 3 条断言 —— 扫 C# 侧 `Tools/` 目录的工具名反查表，**扫不到 ≥ 90 个就判判据失效**。判据只认 `Tools/` 路径：Module / Resolver 也有 `public string Name => "git"` 这类同名属性，不限定会把模块名当工具名（实测污染 47 个）。

**闸有效性做了反向验证**：临时删掉 `CronList` 那条标签跑测试 → 变红；恢复后内容逐字节一致、`bareLF=0`。

**门禁**：`npm run test:tool-labels-coverage` 10/10、`npm test -- --ts-only` **77/77**、`npm run typecheck` 三配置 0 错。

## 2026-10-29 14:55 · S-266 文档补刀 1g 收口（dev round6 §2.2 的结论反了）

**dev 第 6 轮建议的是 B 方案**：接受「校验只在 `Read` 路径」这个现状，但在需求文档里明写一行「渠道直传截断图不在自动化覆盖内」。
提议本身没错，错在它记录的那个事实已经作废 —— round6 写于 10:04，**刀 1g 是 10:40**，而刀 1g 走的正是 round6 推荐的 A 方案：
判据下沉到 `ProviderContentHelpers.IsSendableImageBlock` 的 base64 分支（`:358`），那是所有出站图像的唯一放行判据。
照 B 写会把「已覆盖」记成「未覆盖」，等于主动在文档里埋一个假边界。

**所以补的不是那一行，是需求单里没跟上的三处**：

| 位置 | 原文状态（停在刀 1f） | 补正后 |
|---|---|---|
| §四 交付内容 | 三行，只有 `HasCompleteContainer(path)` + `ReadImage` 第五档 | 八行，补「判据层 `JudgeContainer` 共用」「`HasCompleteContainerInBase64` 入口」「组包层 `IsSendableImageBlock`」「`ImageInput` 套件」，每行标刀次 |
| §四 补充段 | 无覆盖边界说明 | 新增「覆盖边界（刀 1g 后）」，并点明**仍不覆盖 `type: "url"` 远程图块**（判据只看本地拿得到字节） |
| §五 判据 | 8 条，全是 `Read` 路径 | 补第 9 条（base64 形态同样受判，判据不许只有 `path` 入口有）、第 10 条（不解全量、带 `data:` 前缀也判得对） |
| §六 待验 | 2 行，且 `ReadImage` 数字停在 70 | 4 行：判据 1-8 / 9-10 分开、Read 真机标**已过**、**渠道直传标「未验」**并写清验法 |

**数字全部当场跑过，没按记忆写**：`ReadImage` **77 passed / 0 failed**、`ImageInput` **62 passed / 0 failed**。

**这条留给自己的教训**：审查报告有时效性。dev 的观察成立，结论依赖它当时的代码快照；对着旧快照抄结论会把修好的东西记成没修。
处理审查意见时先核现状再动文档 —— 与刀 1g 同一轮里，我自己也差点把「已修」写成「待补」。

## 2026-10-29 15:00 · 登记 S-271（失败工具跳出折叠块），移交下迭代

**登记，不动码。** 归属 v3-iter-5，不占本迭代承接、不占刀序。

老大原话：「我们正常连续的工具调用 会折叠收起到工具调用下，但是如果某个工具调用报错或者失败了，就不会被折叠进去，感觉是偶然情况，并不是一定」。

**核完代码，不是偶然 —— 是「刻意设计 + 三条判据不同步」四层叠出来的：**

| # | 机制 | 位置 | 效果 |
|---|---|---|---|
| ① | `hasError` 一律判 `attention` ⇒ `visibility = force` ⇒ 渲染在折叠面板**外面** | `execution-outline.ts:201-204` / `:227-238` / `content-renderer.tsx:353-357` | **这就是老大看到的现象本身**，S-225 §8 定的口径（「档位不得藏错误」） |
| ② | `hasError` 第四个来源 `hasStructuredOutputError` 靠**嗅探输出文本** | `execution-outline.ts:361-365` / `:166-179` | 失败写在纯文本里、`isError` 没置位 ⇒ `hasError=false` ⇒ 照常折进去 |
| ③ | `canceled` 在白名单工具于 `:209-212` 就归类完，走不到 `:221` | `execution-outline.ts:209-223` | 取消的 `Read` 折进去、取消的未知工具跳出来 |
| ④ | `pinnedTools` 额外要求 `processForm === 'card'` | `content-renderer.tsx:329-332` | **卡片档跳出来、纯文本档折进面板当红行** —— 切档位表现就变 |

②③④ 各自都能单独解释「有时候跳、有时候不跳」，叠起来就成了老大说的「偶然」。真正的**稳定性缺陷在 ①**：它每次都跳，只是跳的条件被 ② 和 ④ 挡住了。

**建议方案 A**（写进需求单 §四）：`hasError` 不再单独决定 `force`（只保留 `pending_approval` / `requiresApproval` 判 attention），`ToolExecutionRun` 加 `failedCount`，折叠头出红色失败徽章、点开定位第一个失败项。
否决 B（只统一判据 —— 治飘不治跳）与 C（pin 但降级成一行 —— 多一套行形态，纯文本档本来就是行）。

**为什么移交下迭代**：改的是 S-225 §8 的一条已验收口径，收尾期插刀要连带重跑 S-225 三档 + S-248 纯文本档两套真机验收，收益不抵风险。

**顺带记两条判据盲区（以后别踩）**：

- `force` 项**仍在 run 内**（`execution-outline.ts:406` 无条件 `push`）—— 所以「折叠块的边界」没坏，坏的是渲染时把 force 项拎到面板外。谁要改都别去动 run 切分逻辑。
- `components/chat/ToolCallGroup.tsx`（163 行）**全仓无人引用**，OpenCowork 迁移残留。做折叠相关改动时容易误以为它是入口，实际入口是 `execution-outline.ts` + `content-renderer.tsx` 的 `renderToolRun`。

## 2026-10-29 16:10 · 刀 11 交付：S-271 失败的工具调用不再跳出折叠块

**改判记录**：本条 15:00 登记时按「收尾期插刀要连带重跑 S-225 三档 + S-248 纯文本档两套真机验收」移交下迭代；15:40 老大拍板「方案 A，本迭代做」—— 拍板后重新估了改动面：只动渲染层一条判据 + run 级一个计数 + 折叠头一个徽章，**不碰后端、不碰流式渲染主链路**，且验收当场就能在聊天窗看到一个折叠块，不需要专门造真机场景。承接条数 17 → 18，插为刀 11。

### 口径变更（S-225 §8 的一半）

S-225 §8 原文「档位不得藏错误」，实现方式是把 `hasError` 一律判 `attention` ⇒ `force` ⇒ 渲染在折叠面板**外面**。本条把实现方式换掉，**不换意图**：

- 失败项留在 run 里，跟着折叠块一起收；
- 折叠头出红色「M 个失败」徽章（`XCircle` + 计数），折叠态下失败**依然有可见信号**；
- 展开后失败项本身仍是错误态（`ToolBlockRenderer` 未动）。
- **仍必须露在面板外的两类一项没放开**：`pending_approval` / `requiresApproval` —— 用户此刻必须做点什么，藏了就卡死。

### 交付内容

| 文件 | 改动 |
|---|---|
| `components/chat/execution-outline.ts` | `getToolCategory` 去掉 `hasError` 入参与分支；`ToolExecutionRun` 加 `failedCount`（只数可见项 —— hidden 的失败用户本来也看不见）；run 构建处计数 |
| `components/chat/AssistantMessage/ui-buttons.tsx` | `GenerationProcessLine` 收 `failedCount` / `failedLabel`，折叠头追加红色徽章，无失败不渲染 |
| `components/chat/AssistantMessage/content-renderer.tsx` | 传 `run.failedCount` + `t('assistantMessage.toolRunFailed')` |
| `locales/zh/chat.json` / `locales/en/chat.json` | `assistantMessage.toolRunFailed` = `"{{count}} 个失败"` / `"{{count}} failed"` |
| `tests/tool-run-folding/`（新建） | 6 组 12 条断言 + 两个桩，见下 |

同一文件里把 `inputSummary` 的 import 由相对路径改成 `@renderer/components/chat/tool-call-summary` —— 与本文件其余 import 风格一致（它本来只有这一行用相对），同时也是回归套件能 alias 它的前提。

### 回归套件 `npm run test:tool-run-folding`

12 条断言：一个 run 不断裂、失败项归类为 ordinary、折叠态不 pin、无失败不出徽章、纯文本结构化失败计入、hidden 不计入、待审批仍 pin、交互类仍 pin、子 agent / 生成图 / 桌面截图仍 force、失败与取消归类一致、三档 run 结构一致、普通成功 run 也不 pin。

**两个桩（`tests/tool-run-folding/stubs/`）**，都是「真实模块在 node 下加载即炸」逼出来的，不是图省事：

- `settings-store.ts` —— `execution-outline` → `tool-result-format` → `settings-store` → i18n → `locales/index.ts`，而那里用 vite 专有的 `import.meta.glob`。被测路径只读 `toolResultFormat`，且 `decodeStructuredToolResult` 是「先 JSON 再 TOON」逐次尝试、与该设置无关。
- `tool-call-summary.ts` —— `execution-outline` → `tool-call-summary` → `ask-user-tool`，后者拖着 i18n / `chat-store` / `background-session-store`。摘要文案不属本套件判据。

加桩后 bundle 由 2.7 mb 降到 83 kb。

**闸有效性反向验证**：把 `hasError` 判据临时注回 `attention` 分支 ⇒ 断言「折叠态下失败项不 pin 出去」变红（`actual ['t3'] / expected []`）；撤销后逐字节恢复、12/12 复绿。这条闸不是空转。

### 门禁

`npm run test:tool-run-folding` 12/12 · `npm test` **100/100** · `npm run typecheck:web` 0 错。

### 未做

真机验收（`S-271.md` §六 第 4 项）：连续 5 次 Read 中间一次读不存在文件 → 折叠成一个块 + 徽章 → 切纯文本档再看 → 再验一次取消执行。

## 2026-10-29 15:46 · 极简档里的桌面截图不再出卡（S-248 一处例外收窄）

老大原话：「当使用桌面截图的时候，实际上还是显示的是个卡片，虽然是极简模式，而且卡片的内容对我来说没什么意义，输出的是 输入 `{"require_active_window": false}`」。

**为什么极简档还有卡**：`content-renderer.tsx` 的 `pinnedTools` 判据里有 `entry.item.category === 'desktop'`，加上截图还在 `PROCESS_LINE_CARD_ONLY_TOOL_NAMES` 里 ⇒ 形态已经是行，但桌面工具被单独拎出折叠面板、按卡片渲染。S-248 当初给截图开例外，理由是「输出即结果，藏起来等于没做」；实际体验相反 —— 整屏截图拍的是用户桌面，一张随时会变的实时画面糊在消息流中间，比一行「1920×1080」烦人得多。

四处改动：

| 文件 | 改动 |
|---|---|
| `content-renderer.tsx:326-333` | `pinnedTools` 去掉 `entry.item.category === 'desktop'`，桌面操作与其它工具一样留在折叠块 |
| `tool-block-renderer.tsx` | `PROCESS_LINE_CARD_ONLY_TOOL_NAMES` 去掉 `DESKTOP_SCREENSHOT_TOOL_NAME`；`hasVisualResult` 同步去掉截图 |
| `tool-call-summary.ts` | 新增 `summarizeDesktopAction()`，桌面五件套各有摘要（截图 `1920×1080` / 点击 `click (512, 384)` / 输入文本前 40 字 / 滚动 `(0, -600)` / 等待 `800ms`）。原本走兜底「取第一个入参的值」，截图那条正好是 `require_active_window: false` ⇒ 行上显示 `false` |
| `DesktopActionToolCard.tsx` | 原始入参块只在 `density === 'detail'` 显示，紧凑 / 极简档不再露出「输入 { JSON }」 |

**口径变更**：S-248「输出即结果不降级」里点名过桌面截图，本次收窄 —— 保留的例外只剩交互类（答题 / 审批 / 目标）、子 agent、团队事件、生成图、widget，它们的共同点是「一行字点不了，功能会消失」。改完 `test:render-density` 19/19 仍全绿（该套件用本地 `keep` 集合，不引用生产常量）。

### 门禁

`typecheck:web` 0 错 · `npm test` 100/100 · `test:render-density` 19/19 · `test:tool-run-folding` 12/12。四个文件 CRLF / bareLF=0 / 无 BOM。

### 未做

未提交，攒收尾刀。真机待验：极简档跑一次桌面操作，确认只剩文字行。

---

## 2026-10-29 15:53 · 登记 S-272 / S-273（桌面坐标两条线），刀 12 交付 S-272 第一段

老大原话：「我今天尝试让 dev 实例点击自己的页面进行测试，它先进行了桌面截图，然后后面是点击，最后进行的窗口截图，遇到一个问题就是它不知道怎么去点击坐标」。紧接着 15:55：「我希望的是做全，如果复杂的话可以先登记，然后下个迭代去推进」。

**不是模型笨，是没给参照系。** 六处代码事实：

1. `CreateAppWindowCaptureContent`（`Encoding.cs:69-99`）只回 `WxH`，**不含窗口在屏幕上的位置** ⇒ dev 最后一步拿着这张图，永远算不出屏幕坐标。这是卡住的直接原因。
2. `captureDesktopScreenshot()` 算了 `originX` / `originY` / `displayCount`，C# 编码时只用 `width` / `height` ⇒ 前两项丢在半路（多屏、负坐标屏时模型不知道图对应哪块）。
3. `ExecuteScreenshotAsync` 的请求体是 `CreateJsonObject(_ => { })`，从图里拿不到任何参照。
4. `DesktopToolProvider` 写 `Absolute X coordinate` —— 不说是哪个坐标系。模型看到的是上游缩放过的图，它按眼里的像素报数。
5. **`isPointInsideDesktop()` 拿 DIP 边界校验物理像素坐标** —— robotjs 的 `SetCursorPos` 要物理像素。150% 屏、1920×1080 逻辑（物理 2880×1620）下，`(2000,800)` 完全合法却被判 outside ⇒ **右半边点不动**。`docs/plans/iter-v2-23/plan-aux-window-placement/plan.md:28` 早就写过这条规矩，只是当年只约束了辅助窗口那条线。
6. 截图只有整屏一张，搜索空间 2560×1440。

### 分两段

**第一段 · 本迭代（刀 12）**

| 文件 | 改动 |
|---|---|
| `desktop-control.ts` | `DesktopScreenshotResult` 加 `scaleFactor` + `displays[]`（每块屏的物理矩形）；`captureDesktopScreenshot()` 填上；新增 `toPhysicalRect()` / `getDesktopPhysicalBounds()` / `describeDesktopBounds()`，`isPointInsideDesktop()` 改按物理像素边界判；两处越界报错带边界数值 |
| `window-capture-handler.ts` | `WindowCaptureResult` 加 `bounds`（`getContentBounds()`，DIP）+ `scaleFactor`，用 `screen.getDisplayMatching()` 取窗口所在屏的缩放比 |
| `AgentRuntimeDesktopExecutor.Encoding.cs` | 新增 `DescribeScreenshot()` / `DescribeDisplays()` / `DescribeAppWindowCapture()` / `FormatScale()`；截图文本补 `origin` / `scale` / 每块屏矩形，窗口文本补 DIP 矩形与「× scale 后的屏幕像素」，末尾给模型直接指令：「坐标就是这张图里的像素，不要重新缩放」 |
| `DesktopToolProvider.cs` | `DesktopScreenshot` / `DesktopClick` / `DesktopScroll` / `CaptureAppWindow` 四段描述改成「以最近一次截图的原点为参照，单位是那张图的像素」；`CaptureAppWindow` 明写会回报窗口位置 |

`toPhysicalRect()` 优先用 Electron 43 运行时的 `screen.dipToScreenRect`（类型未声明 ⇒ 能力检测），不可用时按 `bounds × scaleFactor` 回退。回退分支在混合 DPI 多屏下不精确，已记进 `S-272.md` §五 待查。

**第二段 · 移交 v3-iter-5**（`S-272.md` §四）：相对坐标 `{x: 0.62, y: 0.28}`（根治「模型看的图被缩过」）、`DesktopScreenshot({ grid: true })` 画网格刻度、`DesktopListWindows` + `DesktopScreenshot({ window })` 按窗口截图。

**S-273 · 移交 v3-iter-5**：换路径，不算坐标 —— `DesktopQueryElements` 读 UIA 元素树（`name` / `controlType` / `rect`），`DesktopClick({ window, element })` 取矩形中心。Chromium / Electron 把 DOM 可访问性树暴露给 Windows UIA，我们自己的页面完全可点。只作增强路径，不替代坐标路径（第三方原生应用覆盖度参差）。开工前四件待查已写在需求单 §四。

### 门禁

`npm run typecheck`（node + web）0 错 · `npm test` 100/100 · `test:render-density` 19/19 · `test:tool-run-folding` 12/12 · `test:tool-labels-coverage` 10/10 · `dotnet build WishfulClaw.Agent.csproj` 0 警告 0 错误。改动的四个源文件 CRLF / bareLF=0 / 无 BOM。

### 未做

真机验收：高 DPI 屏（150%）点右下角不报 outside；截图文本能在聊天窗看到 origin / scale / displays；`CaptureAppWindow` 文本含窗口矩形。都未提交，攒收尾刀。

## 2026-10-29 16:53 · S-270 刀 10 补正之二 —— 输入框状态栏的第六个漏点

老大原话：「我们聊天窗的输入框左上角有个状态栏显示，这里现在也是一样的问题，使用工具的时候显示的是工具英文名称」。

**不是没做，是那一处从来没接过统一出口。** 两个状态栏变体（`composer-status-indicator.tsx:82-83` 精简条、`runtime-status.tsx:226-227` 完整面板）都在 zustand selector 里调 **`resolveProxyStatusName()`** —— 那函数的唯一职责是把 `use_capability` 拆回它代理的真实工具（`builtin:Read` → `Read`、`mcp-tool:s/t` → `mcp__s__t`），**对非代理工具原样返回**。刀 10 把卡片、折叠条、文件变更行、纯文本行、桌面 / 浏览器 / codegraph 卡全接上了 `resolveToolDisplayName`，唯独状态栏没接 ⇒ 平时跑工具显示 `BrowserNavigate` / `FileEdit` / `DesktopScreenshot` 原文。

这恰好印证 S-270 §2.2 的判断：**缺了不会报错，所以一直没人发现**。防漏测试扫的是「代码里声明的工具名有没有中文表」，扫不到「某个显示点没查表」—— 判据的固有盲区。

### 改法

`src/renderer/src/lib/tools/tool-display-name.ts` 新增 `resolveStatusToolName(name, input, t)`：

1. 先 `resolveProxyStatusName()` 拆能力代理（**顺序不能反** —— 反过来 `use_capability` 会被查成「调用能力」，用户永远看不到真实工具）；
2. 再过 `resolveToolDisplayName()`（查表 / MCP 拆词 / codegraph 前缀族 / 兜底）；
3. `skill:<id>` 保持原样（能力 id 不是工具名，与接入前一致，记入挂账）。

两个组件的 selector 改成只取**原始** `name` + `input`（新增 `activeToolInput` / `pendingApprovalToolInput`，`!showStatus` 分支同步补 `undefined`），中文名在组件 `useMemo` 里算 —— `t` 在组件作用域，且能力代理要等 args 到齐。`statusView` 的依赖列表同步换成 label。

### 测试加固（11 → 12 条）

新增两条断言直接钉 `resolveStatusToolName`：

- `状态栏工具名也走统一出口` —— `Read` → 读取文件、`BrowserNavigate` → 打开网址、`DesktopScreenshot` → 桌面截图、`RequestSandboxElevation` → 申请关闭沙箱、未知 → 「工具 · 原名」、`null` → `null`。
- `状态栏先拆能力代理、再过统一出口` —— `builtin:BrowserNavigate` → 打开网址、`mcp-tool:my_server/do_thing` → `Do thing`、`skill:commit` → 原样。

**闸有效性反向验证**：实现临时改成 `return resolved`（退回接入前的行为）⇒ 立刻红，`actual: 'Read' / expected: '读取文件'`；逐字节恢复后 12/12 复绿。

### 门禁

`test:tool-labels-coverage` **12/12** · `npm test` **100/100** · `test:render-density` 19/19 · `test:tool-run-folding` 12/12 · `npm run typecheck`（node + web）0 错。四个改动文件 CRLF / bareLF=0 / 无 BOM。

### 未做

- **挂账**：`skill:<id>` 显示成 `skill:commit`（能力 id，`commit` 翻不动）—— 要做需先定口径（「技能 · commit」？还是走 `Skill` 标签 + 参数）。
- 真机待验五条（`S-270.md` §8.9）：状态栏跑 `BrowserNavigate` 显示「打开网址」、待审批显示「等待批准：申请关闭沙箱」、能力代理不被查成「调用能力」、两处状态面板文案一致。
- 未提交，攒收尾刀。

## 2026-10-29 17:53 · 两处口径收紧（不占刀）—— S-248 例外收窄 + S-225 弹层只列档位名

真机测试中当场发现的两处，各自只动渲染层一处、无新增判据，故不设刀号，随刀 13 / 14 一并提交。

### `9d4c2152` · 极简档的桌面操作只留文字行

极简档里 `DesktopScreenshot` 仍出一张卡，而卡片内容对用户没意义 —— 正文就一行 `{"require_active_window": false}`。老大原话：「当使用桌面截图的时候，实际上还是显示的是个卡片，虽然是极简模式，而且卡片的内容对我来说没什么意义」。**S-248「白名单不降级」的例外清单收窄**：桌面类工具在极简档一律走 `ProcessTextLine`，不出卡。

> 这是 S-248 三条硬约束里第一条（白名单不降级）的**主动例外**，理由是桌面工具的入参本身就是给模型的、给人看没价值。不违反约束原意 —— 约束防的是「把有信息量的卡片降成文本」。

### `d88d6a31` · 渲染详细度弹层只列档位名

三档弹层里每档下面挂一段描述，整齐度差、弹层被撑高。改为只列档位名，描述挂 `title`（悬停看）。动三处：`RenderDensityToggle.tsx` + `locales/{zh,en}/settings.json`。

**同批口径记一笔**：极简档「管观感不管速度」—— 上一轮把它当性能方案推荐给老大是判断错误，真相是极简只减每条消息的 DOM 量，**条数与重渲染频率都不变**（刀 14 的真机数据坐实）。设置页说明文字待收尾一并改。

## 2026-10-29 17:50 · 登记并交付 S-274（刀 13）—— 长文本流式撞爆 React 嵌套更新上限

老大原话：「之前几次测试就已经比较卡了，我以为是内存占用问题，就是在长文本输出修复以后开始测试开始，基本都比较卡」，附 `[renderer:LOG] Uncaught Error: Maximum update depth exceeded`。

### 一、先排除，再定位

按顺序排掉三条常见的：

1. **不是内存泄漏。** 渲染进程确实涨到 4.3 GB（`memory type=Tab ws=4360.4MB peak=4832.9MB`），但那是「每帧自激重渲染」的**结果**，不是原因 —— 报错停下来的那一帧之后内存就不再涨。
2. **不是 selector 抖动。** 全仓脚本扫「返回新对象却没 `useShallow`」⇒ **0 命中**。
3. **不是 hook 依赖写错。** `use-typewriter` / `use-streaming-markdown-blocks` 是纯计算不 setState；两个状态栏的 `setInterval` 依赖是 `createdAt` 字符串，稳。

日志落点值得记一笔：渲染端 console 不单独落盘，只经主进程 `index.ts:165` 转发；真正的证据在主进程 memory 采样行 + 紧跟的 ERROR 行。而 **dev 实例的日志在 `~/.wishful-claw-dev/logs/`**，跟生产 `~/.wishful-claw/logs/` 分家（`data-dir.ts:11-18`）—— 我第一眼看的是生产那份，2150 行干净得可疑，白跑一趟。

### 二、根因（栈帧直指文件）

栈：`dispatchSetState` ← `useMessageListScroll.ts:246` / `:270` / `:276`（vite 转换后行号，文件确定）。

链条：

1. 跟随目标 `bottom = realBottom + gapTarget - clientHeight`，`gapTarget` 是**提前量**（最多 240px），比容器底部 padding 大得多；
2. 尾部行未挂载那一帧（`tailMounted=false`）`scrollHeight` 撑不住 `bottom` ⇒ 写 `scrollTop` 时浏览器 clamp（写 1000 读回 760）；
3. 于是 `Math.abs(ref.scrollTop - bottom) <= 1` **恒不成立**，那道注释里写着的「已钉底就不重复滚」的守卫被穿透；
4. 每帧写 scrollTop → 派发 scroll → `handleListScroll` → `setIsAtBottom` → layout effect → 再写 ⇒ 撞 React 50 层嵌套上限。

**为什么偏偏现在发作**：S-256 把长文本流式的时长从「一瞬」拉到几十秒（以前循环来不及跑几轮就静止了）+ S-233 的 `observeGrowthOnly` 让 floor 只升不降、与真实可滚范围脱钩 + S-176 的 gapTarget。三者叠起来才成为常态。

### 三、改法：只夹写入没用，必须同时夹判据

- `scroll-watermark.ts` 新增纯函数 `clampScrollTop(value, scrollHeight, clientHeight)`；
- `useMessageListScroll.ts` 四处写入点全部先夹：悬空救援 `:293` / 回收计划 `:320` / 跟随落位 `:352` / 撤水位线 `:866`；
- **`:361` 那道「已钉底」守卫改成比较夹取后的值** —— 这是本条的关键。只夹写入、判据还拿未夹的值比，clamp 条件照样永远真，循环照跑。我第一版就只夹写入，靠反向验证才揪出来。

### 四、闸与反向验证

`tests/scroll-watermark` **103 → 110** 条（新增 7 条：夹取 / 幂等 / 内容不满一屏返 0 / 负数返 0 / 超范围目标夹到 maxScrollTop 等）。

反向验证：把 `clampScrollTop` 临时改成 `return Math.max(0, value)` ⇒ 红 `AssertionError: 超范围目标夹到 maxScrollTop（实际 640）`，恢复后 110/110 复绿。

门禁：`npm test` **100/100** · `typecheck` 0 错 · `test:render-density` 19/19 · `test:tool-run-folding` 12/12。

### 五、与 S-233 的关系（别混）

S-233（挂账的视觉抖动）同文件同链路，但**根因不同**，本条修好不代表 S-233 解决。S-233 的观察窗口仍按原判据补盲区，不因本条提前重开。

### 六、未做

- 真机待验 6 条（`S-274.md` §七）：长文本流式不再涨到 4.3 GB、不再报 `Maximum update depth exceeded`、正常跟随 / 回收 / 悬空救援仍贴底。
- **「卡」的另一半仍在**：S-256 只限了单帧步长（1600 字符），长文积压时仍是 30fps 持续全量重渲染。建议加「跳尾」（`poolSize` 超 3200 字符直接把 `renderedLength` 推到 `targetLength - 1600`，只对尾巴做追赶动画），**待老大拍板**，未做。
- 未提交，攒收尾刀。
## 2026-10-29 18:20 · 登记 S-275 / S-276 / S-277 —— 压缩链路三连（老大报「上个会话全是压缩记录」）

**老大原话（17:53）**：「我刚刚在 dev 新建了一个会话进行测试，因为我发现上一个会话居然全是压缩记录，用户消息其它的都看不到」。（18:00）「能看出来是什么原因导致的么」。

**结论先说**：消息一条都没丢。库里 141 条全在（真实用户 51 / 压缩摘要 20 / 助手 50 / 边界 20）。坏的是**两处独立缺陷串成一条链**，外加一个长期累积问题。

---

### S-275 · 压缩对图片工具结果无效

**实锤（dev 库 `~/.wishful-claw-dev/index.db`，会话 `9yXnLPAM00ea6qAXu6qPp`）**：

- 2026-10-29 16:40~17:31 的 **50 分钟里连压 9 次**，间隔 2~6 分钟；
- 日志 `context compression DIAG` 非 skip 行 16 条，峰值 `inputTokens=503539`，其余在 144204~162441 徘徊（触发线 144000）；
- 21 个快照里，29 日那批 wire 是 **250~441 KB**，同期没图的快照只有 7~26 KB；
- 最后一个快照（54 条消息）按字符排序：`[53] user 243496 字符`，内容就是 `Read image: …(1680x1120, image/png)` + `{"type":"image","source":{"type":"base64",…}}`。**index 53 就是最后一条**。

**根因**：`ContextCompression.cs:557-583` 的 `TailStart` ——

```csharp
var minKeep = 2;                                   // 最后 2 条无条件保留
...
if (conversation.Count - i > minKeep && acc + tok > budgetTokens)
    break;                                         // 预算只在 minKeep 之外生效
```

`DefaultTailTokens = 16384`（`:65`），但 `minKeep` 那两条**不参与预算判断**。而一次 Read 截图恰好产生 `assistant(tool_use)` + `user(tool_result)` **两条**，正好占满名额。`EstimateTextTokens`（`TokenEstimation.cs:45-51`）返回 `Math.Max(len/4, len)` = 243496 ⇒ 单条估值是尾部预算的 **15 倍**，被原样抬过去。

于是：压掉几千 token 历史 → 摘要 300~5000 字符 → 24 万 token 的图不动 → 下一轮仍超 → **立刻再压**。图换一张就再压一轮，时间点与 6 张截图完全对应。

**建议方案 A**（待拍板）：压缩前把超预算的 `image` block 占位化成 `[图片已省略：xxx.png 1680×1120，可重新 Read 查看]`，只留原有文本行。语义不丢、体积降三个数量级，只动一个纯函数，可做反向验证。

> 起草时我先写成「按条数保留」，读到 `DefaultTailTokens` 才发现尾部是**按 token 预算**裁的 —— 那个判断是错的，已推翻。真正问题是 `minKeep` 的例外条款，不是预算本身。

### S-276 · 「最近 N 轮」把压缩摘要当成用户轮

三个「数轮次」的地方都只看 `role`，而摘要卡的 `role` 就是 `user`（`TokenEstimation.cs:78-120`，为的是让模型当用户陈述读）：

| # | 位置 | 代码 |
|---|---|---|
| 1 | `session-slice.ts:77-90` | `if (messages[index]?.role !== 'user') continue` |
| 2 | `DbMessageToolsQueries.cs:84 / :93` | `WHERE role = 'user' ORDER BY created_at DESC LIMIT @turns` |
| 3 | `DbMessageToolsQueries.cs:75-77` | `COUNT(*) … AND role = 'user'` ⇒ `totalTurns` 71（实际 51） |

**实测窗口**：

| 窗口 | 起点 | 加载 | 真实用户 | 压缩摘要 |
|---|---|---|---|---|
| `turns=5`（首次加载默认，`session-slice.ts:973`） | 17:11:53 | 10 条 | **0** | **5** |
| `turns=15` | 15:36:39 | 30 条 | 6 | 9 |

最近 8 个 `role=user` 里最后 5 个**全是摘要**，`turns=5` 正好落在那一段 —— 屏幕上就是五张「任务暂告一段落」。

**修法**：统一 `isRealUserTurn`（`role=user` 且无 `meta.compactSummary`），三处同口径；卡照常返回但不占名额。三处不同步会重演 S-271 的教训。

### S-277 · 压缩产物在 `messages` 表永久累积（移交 v3-iter-5）

同一会话 21 个快照 / 20 对消息行，占全部消息 14%。wire 侧是对的（旧摘要一律折进折叠区，one-summary invariant 没破），错的是**持久化与渲染从不清理**。三方案待拍：A 加 `superseded_by` 只展开最新一对（可与 S-276 的 `is_artifact` 列合成一次迁移）/ B 删旧行（破坏溯源）/ C 纯渲染端合并（零迁移，但窗口仍被占名额）。**不删快照表** —— 那是唯一证据链。

---

### 影响与后续

- **S-275 是 S-276 的放大器**：以前压缩一天 1~2 次，20 张卡不存在；现在 50 分钟 9 次，卡把窗口淹掉。两条建议一起做，分开做会各自半好。
- **S-277 不占本迭代**：三个方案要么改 schema、要么动分页口径，收尾期插不进去。
- 归属待老大拍板：进本迭代则承接 19 → **22 条**（S-274 本就没计入口径行，已一并补正）；移交则两条一起挪进 §2.5。

### 只改文档，未动代码

本轮是**登记**：新建 `requirements/S-275.md`、`S-276.md`、`S-277.md`；`raw-requirements.md` 增三行（§1.2 两条、§1.3 一条，标题计数一并修准：八条→十二条、三条→五条）；`plan.md` 增头注 + §2.4 两行 + §2.5 一行，并把「19 条承接」补正为 **20 条**（原口径漏了已交付的 S-274）。工作量在取证：两个只读脚本 `.wishful-claw/notes/dev-db-wire.js`（既有）与 `dev-db-window2.js`（新建）。

## 2026-10-30 08:30 · 登记 S-278 / S-279 / S-280 —— 全局会话 ↔ 项目会话通信三连（全部移交 v3-iter-5）

**老大原话（08:19，一次给三条）**：

1. 「全局会话发送消息给项目会话，这个消息我希望能识别并且渲染成组件，包括全局任务下发，项目下会话对全局任务回执。」
2. 「全局会话发送的常规消息也要有可以回复的方式，因为现在是渲染成卡片了，所以可以携带一些参数过去，项目下会话回复的时候只需要拿到卡片标识之类的就能直接回复，不需要操心那么多参数。」
3. 「全局会话下发的全局任务，有时候项目下会话做完以后不进行回执，这个需要不依赖 agent 本身做回执，得我们想想其它办法。」

**先说结论**：三条不是三个独立需求，是**一条链的三段**。① 缺结构化通道，② 缺回执入口，③ 缺确定性归档。② 和 ③ 都得靠 ① 的 meta 才能做对。

---

### 现状（读码确认，行号都在）

| 工具 | 有 dispatch 记录 | 能回执 |
|---|---|---|
| `send_work_request` | 有（`gd_xxx`，`AgentRuntimeGlobalTaskExecutor.cs:200`） | 能 |
| `send_session_message` | **没有** | **不能** |

**投递机制**：`send_work_request` 拼一段文本（`AgentRuntimeGlobalTaskExecutor.cs:226-235`）

```
[GLOBAL AGENT WORK REQUEST] dispatch_id=gd_… global_task_id=gt_…

<instruction>

This work request was dispatched by the global agent. …report back via the `use_capability` tool…
```

然后走反向请求 `project/send-session-message`；渲染端 handler（`lib/tools/project-send-message.ts`）拿到 `{ sessionId, content }`，直接 `chatStore.sendMessage()` —— **文件头注释自己写着 *fully simulating a user action***。

所以目标会话里就是一条 `role=user` 的纯文本消息，**给模型看的英文协议说明用户全看得见**，没有卡片、没有来源、没有状态、点不回全局任务。

### 三个根因

1. **无结构化信息**：只传 `content`，渲染端只能嗅探 `[GLOBAL AGENT WORK REQUEST]` 前缀 —— 这正是 S-208 早就定过口径要避免的（结构化字段进 meta，别解析正文）。
2. **普通消息没有 id**：`SendSessionMessageAsync`（`AgentRuntimeProjectExecutor.cs:274-328`）裸传 content，而 `reply_global_dispatch` 的 `dispatchId` 是**必填**（`GlobalDispatchReplyToolProvider.cs:28-36`）⇒ 想回也回不了。现有 `followUp` 是**反方向**的定时追问，救不了。
3. **回执是可选的工具调用**：模型可以不调。四个会漏的原因里最要命的是第一条 —— **那段协议说明写在消息正文里，长会话一压缩就没了**，而 S-275 / S-276 正在放大压缩。

### 附带发现：同一段协议文本有两份实现，已经漂移

| 位置 | 措辞 |
|---|---|
| C# `AgentRuntimeGlobalTaskExecutor.cs:233-235` | 走 `use_capability` → `capability_id="builtin:reply_global_dispatch"` |
| 渲染端 `task-board-store.ts` `buildWorkRequestContent()` | 「call the `reply_global_dispatch` tool」（注释自称 *mirrors*） |

同一个动作，一份教模型「用代理调」，一份教「直接调」。两份都在用（任务板派发走渲染端那份，全局 agent 派发走 C# 那份）。

---

### 三条的需求口径

**S-278（打底）** —— 反向请求加 meta（`dispatchId` / `globalTaskId` / `kind` / 任务标题），`sendMessage` 落库带 meta，渲染端按 `dispatchId` 出卡片；**协议说明移出消息正文**（进 `meta.modelHint` 或不落库只拼 wire）。老的派发消息不做兼容层。

**S-279** —— 普通消息也建轻量 dispatch（`kind=message`，建议 `gm_` 前缀），复用**同一个**回执工具（不拆两个，S-270 的教训是出口越少越好），默认 `hidden_from_board`；`report` 允许为空（只是「收到」）。只允许一层回执，不许套娃。

**S-280** —— 三层归档：投递态（已有）→ 执行态（`loop_start` 转 `in_progress`，`loop_end` 触发归档）→ 归档分**显式 / 隐式**。三条硬规矩：

1. 显式覆盖隐式，反向不许；
2. **隐式不许伪装成完成** —— 卡片必须写明「本轮已结束 · 未显式回复」，跟 S-267 同一个原则；
3. 自动归档只写 dispatch 记录，不往全局会话塞消息。

**核心难点**是「这一轮是不是在干这个 dispatch」，现有信号里**没有答案**。推荐借 S-278 的 meta 做强判据（worker 每轮能看到「本会话有未回执 dispatch」）；先落地版本用中判据（投递时间后的首个 `loop_end`）+ 三条收窄，等 meta 到位再换。

### 依赖顺序

```
S-278（meta 通道） → S-279（kind 扩展） → S-280（强判据）
```

拆开做会各自半好：S-279 没有 meta 就得靠 `gm_` 前缀嗅探正文，S-280 没有 meta 就只能用假阳性率高的中判据。

### 只改文档

新建 `requirements/S-278.md` / `S-279.md` / `S-280.md`；`raw-requirements.md` §1.3 增三行（五条 → 八条）；`plan.md` 增头注 + §2.5 三行（4 条 → 7 条）。**不改代码、不提交。**

## 2026-10-30 08:41 · 刀 14 —— 渲染进程执行中内存暴涨（S-274 续），`e174bd6d`

老大 08:26：「我们刚做了极简模式，现在也用的是极简模式，本身是为了解决卡的问题，你现在反向优化了？」08:30：「我一直以为我们的渲染是异步的，只会渲染最新输出的消息呢，怎么会导致消息列表全部重新渲染呢」。

### 根因（不需要任何新内容就能自持的环）

```
流式中尾部行每帧在长
  ⇒ measureVisibleMessageHeights() 每帧返回 changed = true
  ⇒ assistantRailMeasureVersion 每帧 +1
  ⇒ 它进了 useMessageListData 的依赖
  ⇒ buildAssistantRailLayout + 整条消息列表每帧重算 + 重渲染
  ⇒ 跟随 / 回收 / 救援三处写 scrollTop
  ⇒ 派发 scroll 事件 → handleListScroll → requestAssistantRailSync → 再测
  ⇒ 版本再 +1（回到第 3 步）
```

**真机表现**：执行中 3 分钟 0.3 GB → 1.3 GB；发送键与会话列表的转圈控件持续上下跳动（老大 17:41 报的「转圈都上下跳动」就是这个，当时归因成内存不够，方向错了）。

### 为什么极简档治不了

极简减的是**每条消息的 DOM 量**，条数与**重渲染频率**都不变。这条纠正了「极简＝性能方案」的口径 —— 上一轮把它当性能手段推荐给老大，是判断错误。

### 修法（三处，`+39/−1`，单文件 `useMessageListScroll.ts`）

1. `ASSISTANT_RAIL_MEASURE_THROTTLE_MS = 150` 节流 + **尾调用**补最后一次（否则被挡掉的那次测量不生效，rail 停在旧 state）；
2. 程序化滚动窗口内（`programmaticScrollUntilRef`）直接跳过 rail 同步 —— 用户没在滚，同步既无意义又最贵；
3. 尾调用定时器随组件卸载清理，不许活过组件。

**实测 3.85 GB → 1.3 GB，保留。**

## 2026-10-30 11:05 · 内存问题定性：dev 加载方式固有，不是产品缺陷（撤销「必须回滚」）

同一天上午老大三次加压：「现在内存都到 2G 了，这个问题不解决，本迭代就必须回滚了」。决定回滚前先做三档对照，结果是**产品代码没退化**。

| 实例 | renderer WS | 时长 | 加载方式 |
|---|---|---|---|
| dev（vite dev server） | **1256 MB**（横盘至 1279） | 启动 5 分钟即到位 | 78.5 MB 未压缩预构建依赖 + 871 个未压缩模块（5.85 MB 源码）+ 全量 inline sourcemap |
| preview（构建产物） | **180～204 → 240 MB** | 45 s～5 min | 走 `out/renderer`，`file://` |
| 生产 1.0.3 | **337 → 650 MB** | 10-29 16:52 起持续 17 小时 | 打包 asar，bundle 45 MB |

- **上涨形态**：启动 5 分钟内一次性 +500～700 MB（首屏成本），之后只在渲染活动时涨；**空闲 30 分钟 ±2% 零增长**（pid 21272：1256 → 1237 / 1242 / 1242 / 1387 / 1363 / 1279）。涨上去 Chromium 不归还。
- **组件数据**：JS 堆 ~100 MB（peak 234.9 / 294.8）、DOM 节点 1430～1640、`dataUrlImgs = 0`、图片 1 张 1.6 MB、正文 5.8 万字符 —— 差异全在 V8 堆外，不是渲染层漏。
- **结论**：卡与内存均为 **dev 加载方式固有**，本迭代无需回滚。老大 10:56 复测 preview 后认可：「我测完了，肉眼观测来看，确实预览版没有问题」。
- **口径落定**：**验收一律走 `npx electron-vite preview --skipBuild`**，dev 内存数值不具判据价值。

### 排查中三条被自己数据推翻的判断（记下来别再犯）

1. **监听器累积泄露 → 错**：`listeners` 335 → 537 → **7559** → 437 → 408 是波动，自建审计账本 net 恒为 263；`chips.ts` 10 add / 0 remove 已排除（临时节点）。
2. **闲聊也泄漏 → 错**：空闲 30 分钟零增长。
3. **产品代码退化 → 错**：preview 对照直接证伪。

### 排查中的失误（都是环境层，与产品无关）

- 只筛 `electron.exe` 漏掉生产进程名 **`WishfulClaw.exe`**，误判「生产没开」。
- 硬编码 `C:\Users\Administrator`，实际 **`C:\Users\龚翼`** ⇒ `process_singleton_win.cc:446 Lock file can not be created! Error code: 3`。
- `git checkout --` 里把 `MessageList.tsx` 写成 `chat/MessageList/MessageList.tsx`（真实位置 `components/chat/MessageList.tsx`），整条命令静默失效。
- **CDP `Memory.startSampling` 在 Windows 返回空 profile**（连报 6 次 `renderer alloc profile empty`）—— native 分配栈这条路不通。
- `npm start`（= `electron-vite preview`）会白 build 一遍（52 s）、且仍缺目录 ⇒ 用 `--skipBuild`。

### 代码状态

- **保留**刀 14 的 `e174bd6d`（实测有效）。
- **A 方案（删 rail 测量账本 5 文件）放弃**：动机（监听器累积）被证伪，且删账本后导轨 marker 从实测退化为估算 —— 拿精度换一个不存在的收益。
- **已 `git checkout --` 撤销**：`App.tsx`、`main.tsx`、`MessageList.tsx`、`locator-utils.ts`、`useMessageListData.ts`、`useMessageListScroll.ts`（排查期临时改动）、`utils.ts`、`memory-monitor.ts`、`main/index.ts`；**已删**：`hooks/use-memory-diagnostics.ts`、`lib/listener-audit.ts`。

## 2026-10-30 11:23 · 收尾审查：交付核对 + 七处文档欠账补齐

老大 11:07：「你先审查一下本迭代做的事情是否都做完了，以及移交下个迭代做的是否已经迁移完毕」。

### 交付核对：20 条，与清单一致

| 分组 | 条数 | 结果 |
|---|---|---|
| §2.1 资源治理（S-247 / 248 / 256 / 260） | 4 | 全交付 |
| §2.2 插件基座（S-240 ~ S-244） | 5 | 全交付 |
| §2.4 本迭代新登记 | 13 | **11 交付 / S-275·S-276 未做（待拍板）** |
| §2.3 挂账（S-233 / S-230） | 2 | 按约定不动 |

S-275 / S-276 代码侧 grep 验过，**确实零实施**（无图片占位化、无 `isRealUserTurn`）。

### 九处欠账（本次全改）

1. `plan.md` §2.1 **S-247 状态写「待开工」** —— 实际刀 6 早交付，唯一一条状态与事实相反的。
2. `S-270.md` **归属写「下一迭代（v3-iter-5）」** —— 实际刀 10 已交付 + 两次补正；按字面算移交该是 10 条。
3. `S-271.md` **归属写「刀 10」** —— 实际刀 11，刀号串位（刀 10 是 S-270）。
4. **刀 14 全仓零记录** —— §7.1 止于刀 13、changelog 无一条，而它是本迭代最大一次性能修复。
5. **§五 门禁基线停在刀 2 的 92/92** —— 刀 3b ~ 11 七次复跑没回写，实际 100/100，收尾最容易拿错基线。
6. **`plan.md` 进度行**停在「截至 10-29 14:20、99/99、刀序已走完」—— 之后刀 11 ~ 14 + 整场内存排查一个字没进。
7. **§2.5 漏了 S-272 第二段** —— 归属行明写移交 v3-iter-5，九条清单里没有它。
8. **§二 子章节顺序错乱**（HEAD 里就是）：`2.1 → 2.4 → 2.5 → 2.2 → 2.3 → 2.6`。按章节切片重排为 `2.1 → 2.2 → 2.3 → 2.4 → 2.5 → 2.6`，行数 264 不变、字符多重集逐字符校验一致（纯换序）。
9. **`S-270.md` 每行以 `\r\r\n`（双 CR）结尾** —— 275 行，**全仓唯一一个**，历史遗留。已规整为 `\r\n`；正文用「去掉全部 `\r`/`\n` 后逐字符比对」验过一字未改。**这个坏行尾本轮把助手坑了三次**：`Edit` 写回后整份被撑开 274 行空行、`git show` 经 PowerShell 重定向又被转成裸 LF 骗过一次；最终靠字节级替换才做干净。以后碰到大 diff 先跑 `git diff --numstat --ignore-space-at-eol` 分辨「内容差异」与「行尾噪音」。

> 未动的另 94 个异常文件：`docs/plans/iter-v2-19 ~ v2-28` 的 BOM、`.plan/`、`.agents/`、`.workbuddy-ai/`、`docs/progress/` 的裸 LF —— 全是历史迭代遗留，不在本迭代范围，**不动**。本迭代目录现已全部干净。

### 迁移状态：未完毕

`docs/plans/iter-v3-5/` **目录尚不存在**。移交条目目前只有「需求单归属行 + `plan.md` §2.5 一行摘要」，**没有下迭代的承接表、刀序、优先级**。按 v3-iter-3 → v3-iter-4 的先例（收尾写清单、拆分支建目录），现状流程上没错，但「已迁移完毕」不成立 —— 真正到位＝下迭代能直接开工。

### 注释乱码（10-30 11:16 老大报，dev 审查时发现）

三处文件、共 **78 个 U+FFFD**（字节 `EF BF BD`）的真实落地，全在注释里：

| 文件 | U+FFFD | 坏行 | 引入提交 |
|---|---|---|---|
| `src/renderer/src/lib/tools/tool-display-name.ts` | 73 | 30（共 111 行） | `7212dbc5`（10-29 17:52，S-270 补正之二） |
| `src/runtime/WishfulClaw.Agent/Tools/FileTools/ImageFileProbe.cs` | 4 | 1 | `9abf2283`（10-28，S-246） |
| `docs/plans/iter-v3-3/requirements/S-246.md` | 1 | 1 | 同上 |

**成因**：不是编码判断错，也不是存成了 GBK —— 是**源码里真的写了裸控制字节**。`ImageFileProbe.cs` 描述 PNG 魔数时贴了原始的 `89 50 4E 47 0D 0A 1A 0A`；`tool-display-name.ts` 里的中文标点（`——`、`→`、`「」`）在某个非 UTF-8 编码管线上被逐字节替换成了 U+FFFD。同文件 L105 早就用转义写法 `\x89PNG` 描述同一个魔数，那才是正确范式。

**修法**：整行精确替换 —— 每处坏行在文件内唯一，命中 1 次就换、命中 ≠1 就跳过并告警，绝不模糊匹配。

- TS 侧：**30/30 行**替换。前 18 行以干净版 `9e593749` 为准逐行抄回；状态栏那段（L88 ~ L99，是该提交之后新写的）原文已不可考，按语义逐句还原。
- C# 与文档：统一改成转义写法 `\x89PNG`，与 `ImageFileProbe.cs` L105 的既有写法对齐。

**验证**：全仓兜底扫描（`.ts/.tsx/.js/.mjs/.cs/.json/.css/.scss/.html/.yml/.md/.txt` 等，跳过 `node_modules`/`out`/`release`/`.git` 等）U+FFFD **归零**；`npm run typecheck` 0 错；含 `ImageFileProbe.cs` 的 csproj build **0 警告 0 错误**；`npm test` **100/100**。diff 为纯行替换（`30 + 1 + 1` 行，零增删），无任何结构改动。


#### B 层：em dash 被 GBK 误读 —— 4 处，且**不是纯注释**

`鈥?` —— UTF-8 的 `—`（`E2 80 94`）被按 GBK 解码：`E2 80` → `鈥`，`94` 单字节无映射 → `?`。

| 文件 | 行 | 性质 |
|---|---|---|
| `MemoryTools/MemoryAppendTool.cs` | 44 | 工具 Description 字符串 |
| `MemoryTools/MemoryHotReadTool.cs` | 21 / 37 | 注释 + Description 字符串 |
| `MemoryTools/MemorySearchTool.cs` | 47 | 工具 Description 字符串 |

后三处**会直接发给模型**——在此之前模型读到的一直是 `call this tool 鈥?verbal acknowledgment` 这种坏字。全部还原成 ` — `。

**A 层扫描盖不住这类**：`鈥` 是合法汉字，不是替换符，`EF BF BD` 判据扫不到。补了强信号扫描器（`鈥` / `锛` / `銆` 等 GBK 残渣前导字，**单字即报**），全仓复扫 **0 处**。

> 排查中一度以为 `src/main/lib/data-dir.ts:26` 也有乱码 —— 那是 **PowerShell 用 GBK 回显 UTF-8** 的假象，node 按 UTF-8 读出来是干净的。判断编码问题一律用 node 读字节，别信控制台。
> 复现时又踩同一个坑：`node -e` 内联脚本里的**反引号会被 PowerShell 吃掉**（`Expected a semicolon`），必须落到 `.js` 文件再跑 —— 与之前 `git log --format=%ad` 里 `%ad is not recognized` 同源。这条记住：**PowerShell 下只要脚本里带反引号或 `%`，一律落文件。**

---

## 2026-10-30 11:42 · 刀 15 · S-283 截图落盘并回传路径，图不再只活在内存里

**一句话**：截图此前只有内存里那一份 base64 —— 进消息 `meta` 会胖、进压缩预算会爆，而模型想「再看一眼」只能重新截一次。落盘之后图才有身份（路径），压缩占位、重新 Read、重开会话显示全都得挂在这个路径上。

### 根因

`captureDesktopScreenshot` 与 `captureAppWindowCapture` 的 `targetPath` 一直是**可选的空分支**：不给路径就不写盘，只在返回值里塞 base64。于是「落盘」这件事在整条链路上根本不存在 —— 这也直接决定了刀 16（压缩占位文案写「可重新 Read 查看」）与刀 18（剥 base64）**必须先有盘上那份**才能成立。

### 改动

| 文件 | 改了什么 |
|---|---|
| `src/main/lib/screenshot-dir.ts`（新增） | `formatScreenshotMonth` / `screenshotFileNameFromBuffer` / `resolveScreenshotDir` 三个纯函数，**零 electron 依赖**（因此 node 侧可测）。落点 `{dataRoot}/screenshots/{yyyy-MM}/{sha256 前 16}.png`，按内容哈希命名 ⇒ 同一张图重复截不会堆文件 |
| `src/main/lib/image-persist.ts` | 落盘入口加可选 `fileName`，不传沿用旧行为 |
| `src/main/ipc/desktop-control.ts` | `captureDesktopScreenshot` 的 `targetPath` 为空分支改成**默认落盘**，返回值带 `filePath` |
| `.../reverse-handlers/window-capture-handler.ts` | 同上，窗口截图同待遇 |
| `AgentRuntimeDesktopExecutor.Encoding.cs` | `DescribeScreenshot` 补 `Saved to {path}` 一行，`DescribeAppWindowCapture` 删掉「没给 path 就不写盘」的旧口径 |
| `DesktopToolProvider.cs` | 四段工具描述同步改口径 |

### 测试

新建 `tests/screenshot-dir`，**16 断言**：月份格式（跨年、补零）、文件名取自内容哈希前 16、同内容同月同名、目录拼接不依赖 `app.getPath`。`npm test` **101/101** · `typecheck` 两配置 0 错 · `dotnet build` 0 警告 0 错误。

### 真机待验（4 条）

截一次桌面 → 盘上出现 `screenshots/{yyyy-MM}/*.png` → 工具文本行有 `Saved to …` → 同日重截不产生重复文件。

---

## 2026-10-30 11:52 · 刀 16 · S-275 大图不再钉死保留尾部，超预算的 image 块就地占位

**一句话**：压缩算 token 时把 base64 的**字符数**当成了 token 数 —— 一张截图 24 万字符 ≈ 24 万 token，是 16384 预算的 15 倍，而 `minKeep = 2` 又让尾部那两条绕开预算。于是「压完 3 分钟又超」，50 分钟连压 9 次。

### 根因（两条叠加）

1. **`TailStart` 的 `minKeep = 2`**：尾部至少保留两条原文，绕开 16384 的 token 预算。
2. **一次 Read 截图正好产生「`tool_use` + `tool_result`」两条** ⇒ 243,496 字符的 base64 原样钉在 wire 尾部，预算形同虚设。

dev 库日志实锤：`9yXnLPAM…` 会话 16:40~17:31 连压 **9 次**，间隔 2~6 分钟，每次压完 `inputTokens` 仍在 14.4 万触发线之上。

### 改动

新增 `src/runtime/WishfulClaw.Agent/ContextCompression.ImagePlaceholder.cs`（274 行）：

- `TailBudgetTokens` 作为尾部预算的**唯一出口**，`PlanCompaction` 与 `CompactAsync` 读同一个数（此前两处各算一遍）；
- `PlaceholdOversizedImageResults`（conversation 侧，降估算）与 `PlaceholdWireMessageImages`（wire 侧，降上游真实 token）**成对调用** —— 只降一侧就是「本地看着小了、发上去还是爆」；
- `PlaceholdImageBlocks` 逐块重建保序，**不拆 `tool_use` / `tool_result` 配对**（拆了上游直接 400）。

### 测试

新建 `CompactionImagePlaceholder` 套件，**26 断言**，含幂等性与「一块 base64 都不许漏」。

**测试抓到真 bug**：第一版「遇到图才建列表」把第一张图之前的 `text` 块全丢了 —— 两条断言当场红。这正是纯函数化 + 真数据断言的价值，靠真机看是看不出来的。

`npm test` **102/102** · `typecheck` 0 错 · `dotnet build` 0 警告 0 错误。

### 真机待验（4 条，见 `S-275.md`）

压一次之后 token 真正落到触发线以下 ⇒ 不再连环压缩；压缩卡里图位置显示占位而不是空白；占位文案与实际能力一致（刀 15 落地后才成立）。

---

## 2026-10-30 12:04 · 刀 17 · S-276 最近 N 轮只数真实用户消息，压缩摘要卡不再挤占窗口名额

**一句话**：消息一条没丢 —— 是「数轮次」的判据把压缩摘要卡当成了用户消息。卡越多，真话被挤出窗口越彻底。

### 根因（四处，比登记时多一处）

所有「最近 5 轮」类判据都用 `role = 'user'` 认用户消息，而**压缩摘要的 `role` 就是 `user`**（`meta.compactSummary` 才标出它是卡）。首次加载 `turns=5` 拉回 10 条**全是卡、真实用户 0 条**；状态栏分母跟着虚高（71 而不是 51）。

四处：渲染层 `trimMessagesToRecentTurns`、worker `totalTurns`、窗口起点两个分支、`hasMore`。登记时只找到三处，第四处是实施时全仓复扫补上的。

### 改动

| 侧 | 改了什么 |
|---|---|
| 渲染层 | 新增 `isRealUserTurn`（`context-compression-display.ts`，纯函数）；`trimMessagesToRecentTurns` **从 store 搬到 `lib/agent/turn-window.ts`** —— store 一 import 就把 zustand + IPC 拖进来、node 跑不了，不搬就只测得了判据、测不到「窗口里到底有没有人话」。`session-slice.ts` 改为引用，删本地实现 |
| worker | `DbMessageToolsQueries.cs` 抽 `RealUserTurnPredicate` 常量，四处 SQL 全改走它 |
| 共用判据 | `isLegacyCompactSummaryMessage` 收窄为 `matchesLegacySummaryPrefix(role, content)`，供两处复用 |

**跨语言共用不了函数** ⇒ 两侧各自实现 + 各配一套回归，注释互相指名。**不加 `is_artifact` 列**（老大定案）：走 `meta LIKE`，零迁移。

### 测试

- `tests/real-user-turn`：**10 断言**，含主症「尾部 5 张卡不能把真实消息挤出 turns=5」与对照「卡不被顺手过滤掉」；
- C# `WishfulClaw.RealUserTurnRegressionTests`：**21 断言**，真 sqlite 跑 `ListByTurns`，覆盖分母 / 窗口 / 分页 `hasMore` / 全卡会话四组。

**反向验证**：谓词临时退回 `role = 'user'` ⇒ `assertion failed: totalTurns 只数真实用户消息 (expected 6, actual 14)` 当场红，撤销后 21/21 复绿。

`npm test` **104/104** · `typecheck` 两配置 0 错 · `dotnet build` 0 警告 0 错误。

### 已知残留（写进 `S-276.md` §九）

`LEGACY_SUMMARY_PREFIXES` 那批**老摘要卡没有 `meta`**，SQL 认不出，只在渲染层兜底。彻底解决应做数据回填（可与 S-277 合并排期），**不是往 SQL 里堆三个 LIKE 变体**。

### 刻意不做

压缩卡在窗口里的配额（「最多 2 对、其余折叠」）—— 那是新的展示设计，不是修判据；S-277 落地后卡的数量自然下来。

### 真机待验（3 条，见 `S-276.md` §十）

打开会话 `9yXnLPAM00ea6qAXu6qPp` 首屏必须见 17:06 那条真话 / 加载更早不多出空页 / 状态栏分母显示 51 不是 71。

---

## 2026-10-30 14:50 · 刀 18 · S-284 图片块补 `filePath`，让「已落盘的那份」真正被剥掉

**一句话**：截图落了盘，可剥 base64 的剥离器从头到尾没看见路径 —— 那头链两头都铺好了，中间少一个字段。

### 根因（三条，缺一不可）

1. **写入方没填 `filePath`**。`stripImagePayloads` 的剥离条件是「`type === 'image'` 且 `source.filePath` 非空且 `'data' in source`」—— 这个安全条件是 S-224 定的（没有路径的块一旦被剥，图就彻底没了），本身没错；错的是 `CreateScreenshotContent` 与 `CreateAppWindowCaptureContent` 从来没往 `source` 里写过 `filePath`。后者甚至已经在 `:145` 把 `filePath` 取到了，只用在文字描述里。
2. **`output` 是字符串化的 JSON**。工具结果的 `output` 不是数组，是被上游 `stringify` 过一层的文本（`"[{\"type\":\"image\",\"source\":{…}}]"`）。`stripNode` 遇到 string 直接原样返回 —— **连里面的 image 块都没看见**，所以就算补了 `filePath` 也剥不动。
3. 两处叠加，效果是「库里 99% 的字节原地不动」：单条 meta 14,496 KB，图片 base64 占 13,238 KB（同一张图在 `toolCalls` 与 `segments` 各存一份）。

### 改动

| 文件 | 改了什么 |
|---|---|
| `AgentRuntimeDesktopExecutor.Encoding.cs` | `CreateScreenshotContent` 取 `response.filePath` 写进 `source`；`CreateAppWindowCaptureContent` 同样一段。**`data` 一个字节不动** —— 模型这一轮还要看图，剥的是落库副本 |
| `src/renderer/src/lib/image-payload.ts` | 新增 `stripStringifiedJson`，`stripNode` 遇 string 不再直接返回。三道廉价判据（长度 ≥ 32、首字符 `[`/`{`、含 `"image"`）命中才 `JSON.parse` → 剥 → `stringify`，解析失败原样返回 |
| `src/renderer/src/lib/tools/image-block-source.ts` | `src` 加 `filePath` 兜底 → `filePathToMediaUrl()`（`oc-media://local/<encoded>`）。剥掉 `data` 之后重开会话只有路径，这里是唯一的显示出口 |
| `ToolCallCard/utils.ts` · `BrowserToolCard.tsx` · `DesktopActionToolCard.tsx` · `content-renderer.tsx` | 四处内联拼 `data:` 全部收敛到统一入口 |

判据用 `"image"` 而不是 `"base64"`：要剥的块靠 `type === 'image'` 认，而字符串里出现 `"base64"` 反而可能是 thinking 正文在讨论 base64（库里真有）。判别错了的代价只是白 parse 一次。

### 实测（真库那条 `wc-agent-1793264773464-cz0mvm`）

给 32 个 image 块补上 `filePath` 后跑剥离：

```
14.34 MB  →  1.41 MB     降幅 90.2%
image 块总数 32，仍带 data 的 0
```

产物里残留 6 处 `iVBORw0KGgo` / 2 处 `;base64,` **全在 thinking 文本里** —— 是模型自己讨论 base64 时引用的字面量，不是图片载荷，不该动。

剩下 1.41 MB 是纯文本 output（836 KB）+ thinking 两份（272 KB）+ 结构开销，归 S-285（拆 `message_parts` 表）。

### 测试

- `tests/image-payload`：27 → **42 断言**。新增字符串化 JSON 六组，其中「**没有 filePath 的字符串化 JSON 一个字节都不许动**」是安全断言，优先级高于正向断言。
- `tests/image-block-source`：15 → **16**。原来那条「只有 filePath 时 src 为空串，靠 filePath 回读」**正是本需求要推翻的契约**，改写为「兜底成 `oc-media://`」，并补「剥空的块不得产出 `data:` URL」「url 存在时不被 filePath 顶掉」。
- 闸做过反向验证：把 `stripNode` 的 string 分支退回 `return node` ⇒ 字符串化 JSON 那六条当场红。

`npm test` **104/104** · `npm run typecheck` 两配置 0 错 · `dotnet build` 0 警告 0 错误。

### 已知边界

**存量旧数据剥不掉。** 10-30 之前进库的 meta 里 `source` 没有 `filePath`，剥离条件仍不满足 ⇒ 那些会话不会瘦下来，旧会话 `9yXnLPAM…` 首屏仍是 32.6 MB。治存量只能靠回填或迁移脚本，另立，不在本条范围。

### 真机待验（3 条，见 `S-284.md` §九）

截一次桌面 → 新消息 meta 不再有 6 MB 级 base64 → 重开会话截图能正常显示。

---

## 2026-10-30 16:48 · 文档欠账清理（收尾前置，零代码改动）

老大 16:48：「嗯 你先处理文档欠账」。**只动文档，代码一行为零。**

### 补：changelog 缺刀 15 / 16 / 17 三节

刀 15 ~ 17 之前**全仓零记录** —— 三条都只活在各需求文档与 `plan.md` 的表格行里，changelog 从「刀 14」直接跳到「刀 18」。已按提交时间补齐三节（11:42 / 11:52 / 12:04），含根因、改动表、测试数与真机待验项。

顺带记两条以前只在会话里说过、没落文档的事实：

- **刀 16 的测试抓到真 bug**：第一版「遇到图才建列表」把第一张图之前的 `text` 块全丢了。纯函数化 + 真数据断言的价值 —— 这个错靠真机永远看不出来。
- **刀 17 是四处判据，不是登记时的三处**：第四处（`hasMore`）是实施时全仓复扫补上的，`plan.md` §7.1 有记，changelog 现在也有了。

### 修：`plan.md` 五处

| # | 欠账 | 订正 |
|---|---|---|
| 1 | §2.4 表头「14 条」 | → **15 条**（S-284 插入后没改表头） |
| 2 | §五 门禁基线停在刀 14 的 100/100 | 补刀 15 / 16 / 17 / 18 四行（101 → 102 → 104 → 104），最终值改 **104/104**，并记 16:48 的 typecheck 复核 |
| 3 | §七 刀序表刀 16 **重复两行** + 刀 13 排在刀 12 前面 | 合并重复行、按依赖对调 12 / 13 |
| 4 | §七 刀序表里刀 16 / 17 / 18 三行写成了**进度口径**（§7.1 的活） | 收敛回「为什么排在这」；进度留在 §7.1。**刀 16 原本在 §7.1 里整行缺失**，已补 |
| 5 | §7.1 顺序 `…13 → 17 → 15 → 18` | 重排为 `…13 → 14 → 15 → 16 → 17 → 18` |

### 修：`raw-requirements.md` 六处（账最多的一份）

| # | 欠账 | 订正 |
|---|---|---|
| 1 | **S-274 被误列入 §1.3「移交下迭代」** | 它是本迭代刀 13 + 刀 14 交付的，已移回 §1.2 并补交付状态。这条错得最实 —— 按字面读，刀 13 白做了 |
| 2 | §1.2 标题「十三条」 | → **十五条**（补 S-274 归位 + S-284） |
| 3 | §1.3 标题「八条」 | → **十二条**（移出 S-274，补 S-281 / S-282 / S-285 / S-286 / S-288） |
| 4 | §一 标题「承接需求（二十二条）」 | → **二十四条**，并加一行口径说明「= 插件基座 5 + 资源治理 4 + 本迭代新登记 15」，与 `plan.md` §2 对齐 |
| 5 | 顶部追加行停在 10-30 11:29 | 补 11:05（S-281/282）、14:32（S-284/285）、15:10（S-286/288 + **S-287 空号说明**）三段 |
| 6 | §四 门禁基线停在刀 2 的 92/92 | 补齐到 104/104 完整推进链 + 16:48 复核 |

### 修：五份需求文档的归属行

| 文档 | 原来写的 | 实际 |
|---|---|---|
| `S-274.md` | 「v3-iter-4 交付」（无状态） | 刀 13 + 刀 14 续，`e174bd6d`，实测 3.85 GB → 1.3 GB |
| `S-275.md` | **「待老大拍板」** | 刀 16 已交付 `45ed198f` —— 10-29 18:20 §七 刀序就拍定了，这行一直是旧的 |
| `S-276.md` | 有交付无 hash | 补 `840d99e9` |
| `S-283.md` | 「本迭代 · 刀 15」（无状态） | 已交付 `3b6e02a9`，真机 4 条待验 |
| `S-284.md` | 「本迭代」（无状态） | 已交付 `3d948561`，真机 3 条待验 |

### 格式

十份文件统一走 `fix-crlf-s286-288.js` 复核：**裸 LF = 0 / BOM = false / U+FFFD = 0**，全部 CRLF。`npm run typecheck` 两配置 exit 0、0 错。

> 未动：`S-246.md`（iter-v3-3 目录）与 `S-270.md` / `S-271.md` 的工作区改动 —— 那三份是前几次迭代内提交时的正常修订，不是本轮的账。

---

## 2026-10-30 16:55 · 登记 S-289（用量折线图不 hover 时圆点抢戏），移交 v3-iter-5

老大 16:55：「用量统计的**曲线图，未选中时，也就是鼠标没有移上去之前的圆点太大了，有点抢戏**，未 hover 时**没有圆点都是可以的**。」

**登记，不动码。** 移交 v3-iter-5，不占承接、不占刀序。

### 根因三条（不是「半径调小就行」）

`line-chart.tsx:79-95` 给「每个系列 × 每个时间桶」**无条件**渲染 `<circle>`：

| # | 因素 | 效果 |
|---|---|---|
| 1 | 非 hover 也画 | 点数 = 系列数 × 时间桶数。默认 24 小时 + 3 个模型 = **72 个点**；一天 24 桶 × 5 模型 = 120 个 |
| 2 | `r=2.5` | 折线 `strokeWidth` 也是 2.5 ⇒ **点的直径正好等于线宽**，读起来像一串珠子不是一条趋势线 |
| 3 | `opacity=0.72` | 半透明拼成片，比实心更容易糊成带子 |

**顺带发现一处冗余**：每个 circle 上的 `<title>`（`:91-93`）是多余的 —— `ChartTooltip` 是**列级**的（`chart-primitives.tsx:109`，传 `bucket` + 全部 `series`），hover 时这一列所有系列的数据已经摆出来了。删点可连同 `<title>` 一起删，不丢信息；否则原生 tooltip 与我们自己的浮层会同时弹出、互相遮挡。

### 方案 A（登记采纳）

未 hover 只画 `path`；hover 只给那一列画点，`r=4` + 实心 + `stroke=var(--background)` 的高亮样式**原样保留** —— 视觉反馈一点没减，代码量反而减少（删 list 渲染 + 三条三元表达式）。

**B（不推荐）**：只把 `r` 调小 —— 点数问题、`<title>` 双弹层问题都不解，只是把「抢戏」变成「脏」。

### 明确不做

- **`preserveAspectRatio="none"` 的椭圆变形**：`chart-primitives.tsx:241-245` 记着这个坑，但 `useMeasuredSize` 让 viewBox 与容器 1:1，只在首帧（`FALLBACK_SIZE 800×320`）或 resize 那一帧短暂拉伸。改它属于图表坐标系改造，与本条无关。
- **不新增测试套件**：JSX 条件渲染，没有值得抽的纯判据 —— 抽出 `shouldRenderDot()` 只会造一个一次性导出，与 S-270「出口越少越好」的教训相反。验收靠真机 4 条 + `typecheck`。

### 账目变动

`plan.md` §2.5 由 13 → **14 条**、`raw-requirements.md` §1.3 由 12 → **13 条**，承接清单（24 条）不变。需求号 **S-289**。

## 2026-10-30 19:30 · 登记 S-290（截图 image 块被 32 KB 截断）

**来源**：验 S-283 / S-284 的真机截图时，看 dev 日志撞见一行不该有的东西：

```
19:24:38.398 [worker] agent tool output truncated
  runId=wc-agent-1793359476027-uf70aq  tool=use_capability
  originalBytes=712499  truncatedBytes=32768
```

同一轮库里落的是**干净数据** —— 这两个事实放在一起，说明落库与送模型拿的不是同一份内容。顺着查，两个出口分开摆着：

| 行 | 去处 | 变量 | 结果 |
|---|---|---|---|
| `ToolCallProcessor.cs:389` | `tool_call_result` 事件 → 落库 | `toolOutput`（完整 712,499 B） | S-284 正常剥 `data`，meta 10,909 B |
| `:412` | 交给模型（provider 报文） | `truncatedOutput`（32,768 B） | 砍断的 JSON 文本，图不可用 |

**根因**：`ApplyToolOutputLimit`（`OutputLimit.cs:81-99`）的豁免名单只有 `use_capability` 的 `list`/`inspect` 与 `Read`。截图是 `builtin:DesktopScreenshot` 经代理调用，两头不沾 ⇒ 走 `SpillToolOutput`，内联只留 head 16 KB + 提示 + tail 16 KB。**被截断的是 JSON 文本不是结构**，head 里是半截 base64、tail 里是尾巴和 `filePath`。模型这轮拿到的不是 image 块。

`ToolCallProcessor.cs:410-412` 那句注释（「结构化 content 优先，文本截断对 base64 图像块没有意义也不该动它」）**写得没错，但只有 `Read` 有 `toolContentBlocks`** —— 截图走的是 `??` 右边。

### 不是回归

截断逻辑早于 S-283，`MaxToolOutputBytes = 32 * 1024` 是既有常量。让这件事显形的是 S-283 方案 A 的假设 —— `S-283.md:55` 写着「落盘 + 路径写进文本行 + **image block 照旧保留**，本轮不省」。实际是**省了、也废了**。

### 现场实测（两侧都成立，不矛盾）

dev 库 `wc-agent-1793359476027-uf70aq`：落库 output 459 字符、`data.length = 0`、`filePath` 有值、整条 meta 10,909 B（原始 712,499 B，剥掉 98.5%）。S-283 落盘 + 文本行 `Saved to`、S-284 补 `filePath` + 剥 `data` —— **三项全部生效**。

功能没断：agent 下一轮自己 `Read` 盘上那份（`Read` 读图走 `toolContentBlocks`，不吃截断），拿到 2520×1680。代价是**每次截图多一次往返**，且第一轮它据一个坏块做判断。

### 方案（推荐 A）

在 `ApplyToolOutputLimit` 最前面按「输出里存在带 `filePath` 的 image 块」短路豁免 —— **判内容不判工具名**，将来谁返回图都自动免疫。判据选「带 `filePath`」而不是「含 `"type":"image"`」：只有带路径的才保证「截掉也能从盘上取回」，没有路径的 image 块（用户粘贴图）一旦放行就是纯吃上下文，该截还得截。

**成本要认**：豁免后这 700 KB 真进 wire，本轮不再省 —— 这正是 S-283 方案 A 原本的设计，省 wire 那一刀是 S-275，不靠截断。

**B（不推荐）**：把 `DesktopScreenshot` 加进工具名白名单 —— 枚举当契约维护，漏一个即静默降级（S-270 的教训）。
**C（留作以后重构方向）**：让截图工具改返回 `toolContentBlocks`，最干净但动 `ToolDispatchRouter` 返回契约，超出本条范围。

### 明确不做

- 不修 `SpillToolOutput` 本身（超大文本输出落盘是对的，只动 image 块）；
- 不动 `TruncateToolOutput`（`Read` 走它，`Read` 有 `toolContentBlocks` 兜着）；
- 不按 `mediaType` 白名单扩面（视频 / PDF 不管）；
- 与 S-286 分开：本条让模型能看图，但「尺寸摘要撞 base64 正则」那条 bug 独立存在。

### 另有一条更危险的分支（19:37 补记）

`SpillToolOutput` 失败会退到 `TruncateToolOutput`（`OutputLimit.cs:131`）。两条路的差别不在截断本身，在**模型知不知道**：

| 路径 | 模型看到 | 能否自救 |
|---|---|---|
| spill 成功（19:24 实测） | head + `[tool output too large: … saved to <路径> — <取回提示>]` + tail | 能 —— 提示里给了路径，模型当场 `Read` |
| spill 失败（`:131`） | head + `[truncated N of 712499 UTF-8 bytes — rerun with narrower args]` + tail | **不能** —— 「用更窄的参数重跑」对截图毫无意义，也没路径可读 |

模型 19:24 的原话可以作证：*"The screenshot was captured but **the base64 was spilled**. I have the filePath: … Let me read it."* —— 它是靠 spill 提示里的路径自救的，`spill failed` 那条没有这根绳子。

触发条件是磁盘满 / 会话目录权限 / spill 目录被清。概率低，但命中即是**静默错误**：模型可能对着半张残图直接下结论（照残图算点击坐标），我们这边只留一行 `spill failed` 的 warn。方案 A 的短路排在 `SpillToolOutput` 之前，顺带把这个分支一起消掉 —— 验收加了第 5 条专门验这个顺序。

### 账目变动

`plan.md` §2.5 由 14 → **15 条**、`raw-requirements.md` §1.3 由 13 → **14 条**，承接清单（24 条）不变、刀序不动。需求号 **S-290**。

**本迭代不修**：老大 19:30 原话「登记到下个迭代吧，当前迭代越弄越久，有种尾大不掉的感觉了」。

### 19:45 · 迭代收尾 —— 产品版本 1.0.4，24 条全交付

按 `docs/release-workflow.md` 走。本节记「收尾做了什么 + 门禁 + 账目」，发布过程见 §七。

**① 版本号四处**：`package.json`、`package-lock.json`（顶层 `version` 与 `packages[""].version` **两处**，漏一处下次 `npm ci` 就会悄悄改回来）、`README.md` 徽章。全仓再扫一遍残留：命中的 `1.0.32767`、`1.1.0.38` 是假阳性；`docs/progress/v3-iter-3.md` 等历史文档里的 `1.0.3` **按原样保留** —— 那是上一版的真实记录，跟着改就是把历史改成假的。

**② 进度文档**：新建 `docs/progress/v3-iter-4.md` 明细；`docs/PROGRESS.md` 的 v3 段新增一行（该段倒序，最新压在最上面）。

**③ 门禁复跑**：`npm run typecheck`（node + web）0 错 / `npm test` 104/104 / `dotnet build tests/WishfulClaw.Tests.sln` 0 警告 0 错误 / `node scripts/ci-checks.mjs` 全过。改动只有文档与四个版本号字段，理论上不动门禁，但收尾这一刀的门禁**必须自己跑一遍** —— 「上一刀是绿的」不能当证据，这是本迭代被 S-274 教会的规矩。

**④ 账目**：承接 **24 条**全部实施，刀序 0 ~ 18 共 **26 刀**（含 1b ~ 1g、3b 这几把插刀），累计 **30 个提交**。

| 块 | 条数 | 编号 |
|---|---|---|
| 插件基座 | 5 | S-240 / S-241 / S-242 / S-243 / S-244 |
| 400 与图片链路 | 12 | S-261 / S-262 / S-263 / S-264 / S-266 / S-267 / S-269 / S-275 / S-276 / S-283 / S-284 |
| 渲染形态与性能 | 7 | S-247 / S-248 / S-256 / S-260 / S-270 / S-271 / S-274 |

（400 与图片链路一行写 11 个编号：S-267 是 1g 顺路带上的，不单独占刀；S-272 只做第一段，第二段移入下个迭代，两条都已在明细里逐条写清。）

**⑤ 移交 v3-iter-5（15 条）**：S-265 / S-268 / S-273 / S-277 / S-278 / S-279 / S-280 / S-281 / S-282 / S-285 / S-286 / S-288 / S-289 / S-290 + S-272 第二段。

**⑥ 不作数的三条**：S-233 抖动仍未关闭（缺陷成立、频率低、与 S-274 根因不同）；S-230 Qoder 缺契约阻塞；插件线的真机验收要等真插件落地，本迭代按「基座已交付」放行，不写「已验证」。

**收尾时最该记住的一条**：这个迭代开工时的自我定位是「插件基座 + 存量修准」，实际花在「怎么收场」上的刀数远多于预期 —— 上游拒绝之后不许把会话打死（S-261 / S-262 / S-269）、坏数据不许出门（S-264 / S-266 / S-267）、超预算的东西不许进上下文（S-275 / S-276 / S-284）。三条加起来，是同一个判断：**agent 的健壮性不取决于它多聪明，取决于它拿到坏东西时还能不能继续走。**



