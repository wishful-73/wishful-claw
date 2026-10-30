# v3-iter-5 需求清单

> **迭代状态：已建立**（2026-10-30 20:25 拆分支）。
> 分支 `dev/v3-iter-5`（base = `3f27090d`，= v1.0.4 收尾合并点，即最新 `main`；tag `v1.0.4` → `3f27090d`），**从最新 main 拆，未从旧迭代分支拆**。
> 产品版本 `1.0.5`、tag `v1.0.5`（收尾时才改 `package.json`）。**执行期内只 commit，不 push。**
> [plan.md](plan.md) 有承接索引与刀序；[changelog.md](changelog.md) 是裁定与口径流水。
> **需求正文一律留在原目录，不搬家** —— 本文件只做索引与链接。

## 一、承接需求（十五条）

来源：v3-iter-4（1.0.4）收尾时，老大 2026-10-30 定「承接 15 条」（见 `../iter-v3-4/plan.md` §2.5）。
十四条完整需求 + **S-272 第二段**（第一段已随 v3-iter-4 刀 12 交付，第二段单独承接）。

### 1.1 阻断与纯消耗修复（四条，改动面小、无依赖）

| 编号 | 标题 | 明细 |
|---|---|---|
| S-282 | `WISHFULCLAW_DATA_DIR` 指向全新目录时首次启动静默退出 | **阻断级，实测连踩两次**。`index.ts:257` `app.setPath('userData', resolveDataPath('electron-user-data'))`，而 `resolveDataPath` **只拼不建** ⇒ 新目录下建 `SingletonLock` 时父目录不存在 ⇒ `process_singleton_win.cc:446 Lock file can not be created! Error code: 3` ⇒ 进程直接退出，**没有窗口、没有对话框、日志文件都没建出来**（退出早于日志初始化）。一直没暴露是因为 dev 数据目录是历史积累的。影响面：S-223 工作区隔离、多实例并行、用户手工迁移全都起不来。修法：`setPath` 前 `mkdirSync(userDataPath, { recursive: true })`（**必须在 `requestSingleInstanceLock()` 之前**）；建目录放调用点、别塞进 `resolveDataDir`（解析不该有副作用）。附带：全局数据用 `WISHFULCLAW_DATA_DIR`、项目记忆用 `WISHFULCLAW_PROJECT_DIR`，两套开关做隔离时容易漏配 | [S-282](../iter-v3-4/requirements/S-282.md) |
| S-281 | 主窗口根容器挂了全窗口 `backdrop-blur-xl`，而窗口不透明 | 纯烧管线、零视觉效果。`main.tsx:196` 与 `:302` 两处根容器是 `h-screen w-screen … rounded-2xl bg-background/95 backdrop-blur-xl`，24px 模糊铺满整个窗口；而全仓 `transparent: true` 只有 `quick-launcher/window.ts:146` 与 `clipboard-enhancer.ts:588`，**主窗口不透明** ⇒ 模糊采样的背后就是自己的背景色 ⇒ 肉眼零差别，但 Chromium 照样每帧走整屏模糊 pass、根容器被迫独立合成层。**不是** v3-iter-4 内存暴涨的原因（已定性为 dev 加载方式），吃的是 CPU/GPU，是流式卡顿的放大器。修法 A：删 `backdrop-blur-xl` + `bg-background/95` 改 `bg-background`。附带：全仓另 20 处 `backdrop-blur` 需逐一确认，弹层多数该留 | [S-281](../iter-v3-4/requirements/S-281.md) |
| S-289 | 用量统计折线图未 hover 时圆点太大太抢戏 | `line-chart.tsx:79-95` **无条件**给「每个系列 × 每个时间桶」渲染 `<circle>`，非 hover 也画（`r=2.5` / `opacity=0.72`）—— 直径正好等于折线 `strokeWidth=2.5`，默认 24 小时视图 + 3 个模型就是 72 个点缀满图面。顺带 `:91-93` 每点的 `<title>` 是冗余的（`ChartTooltip` 是列级的）。**方案 A**：未 hover 只画 `path`，hover 只画该列圆点；代码量反而减少 | [S-289](../iter-v3-4/requirements/S-289.md) |
| S-286 | 桌面截图的尺寸摘要取自 base64 —— 极简档过程行显示 `8×5` | **真 bug，已实测复现**。`tool-call-summary.ts:255` 对 `outputText` 跑 `/(\d+)\s*[x×]\s*(\d+)/` 取第一个命中，而 `outputAsString` 对**字符串** output 原样返回 —— 桌面截图的 output 正是**字符串化的 content 数组**，image 块（含 658 KB base64）排在最前，正则先撞 base64 随机字节。实测那张 `3ad69753123f60ce.png`（493,695 B）转 base64 后首个命中**恰好就是 `8x5`**；真实尺寸 2520×1680。修法：正则锚定 `Captured desktop screenshot (\d+)x(\d+)`，另给其它工具加「大结构化串不参与摘要正则」的零解析短路 | [S-286](../iter-v3-4/requirements/S-286.md) |

### 1.2 图片与截图链路（三条）

| 编号 | 标题 | 明细 |
|---|---|---|
| S-290 | 截图经能力代理调用时 image 块被 32 KB 截断 | dev 日志实证 `tool=use_capability originalBytes=712499 truncatedBytes=32768`。**两个出口拿的不是同一份内容** —— `ToolCallProcessor.cs:389` 落库用完整 `toolOutput`，`:412` 送模型用 `truncatedOutput`。`OutputLimit.cs:89/95` 的豁免名单只有 `use_capability` 的 `list`/`inspect` 与 `Read`，截图两头不沾 ⇒ `SpillToolOutput` 内联只剩 head 16 KB + tail 16 KB ⇒ 模型拿到砍断的 JSON 文本而非 image 块。**方案 A**：在 `ApplyToolOutputLimit` 最前面按「输出里存在带 `filePath` 的 image 块」短路豁免 —— **判内容不判工具名**；无路径的 image 块照旧截。顺带消掉一条更危险的分支：`SpillToolOutput` 失败会退到 `TruncateToolOutput`（`:131`），那条路只给「rerun with narrower args」，对截图毫无意义、也不给路径 | [S-290](../iter-v3-4/requirements/S-290.md) |
| S-288 | 聊天窗图片点开只能「装进窗口」，不能放大看细节 | 三套图片查看器能力不齐：聊天窗 `ImagePreview.tsx` 的浮层只有 `h-full w-full object-contain`（**无缩放 / 无拖拽 / 无 1:1**），而右侧预览面板与 `LocalImagePreviewDialog` 都走 `ImageViewer`（`clampScale` 0.25~5、旋转、复制、拖拽）。`LocalImagePreviewDialog.tsx:5` 注释早写着目标「保证缩放 / 旋转 / 复制 / 拖拽一套能力完全一致」—— **第三处没落到**。2520×1680 截图在 1080p 屏被压到 ≈1000×667，丢 60% 像素。修法：浮层换 `ImageViewer`（无 `filePath` 的来源退回现浮层），顺带给缩略加高度上限 | [S-288](../iter-v3-4/requirements/S-288.md) |
| S-268 | `DesktopScreenshot` 的 `path` 参数完全无效 | 与 S-267 同一类：**工具报告成功，实际没做成**。`ExecuteScreenshotAsync` 的请求体是 `CreateJsonObject(_ => { })` 空对象，除 `delayMs` 一个字段都没读，`path` 从未被解析；而 `CaptureAppWindow` 认真解析并落盘。两工具调用姿势一样、行为差一半 ⇒ 模型照搬习惯传 `path`、以为存了、下一轮去 Read 一个不存在的文件。**比直接报错更糟：报错模型会换招，假成功让它继续往下走。** 建议补 `path` 支持（照抄既有实现），不是只在描述里写「不支持」 | [S-268](../iter-v3-4/requirements/S-268.md) |

### 1.3 桌面操作（两条，S-272 第二段 + S-273）

| 编号 | 标题 | 明细 |
|---|---|---|
| S-272 第二段 | 桌面坐标：相对坐标 / 网格 / 窗口枚举 | 第一段已随 v3-iter-4 刀 12 交付（截图补 origin / scale / 每屏矩形、判定改物理像素）。第二段是「让模型根本不用算绝对坐标」：①相对坐标 `{x:0.62,y:0.28}`（按最近一次截图的矩形归一化，抗移动与换屏）；②可选网格叠加图（图上直接标刻度，模型读格子）；③`DesktopListWindows` + 按窗口截图（`CaptureAppWindow` 已有 `bounds` + `scaleFactor`，补一个枚举入口即可拼出）。**风险最高的一条**：要加 `grid` / `window` / 相对坐标三个参数面 | [S-272](../iter-v3-4/requirements/S-272.md) |
| S-273 | 桌面操作别算坐标了 —— 用 UI Automation 直接找元素 | **S-272 的换路径版**：前者把「看图算坐标」的误差压小，本条干脆不算。`DesktopQueryElements` 读 UIA 元素树（`name` / `controlType` / `rect`），`DesktopClick({ window, element })` 取矩形中心点，`DesktopType({ element })` 先 SetFocus。Chromium / Electron 把 DOM 可访问性树暴露给 Windows UIA，**我们自己的页面完全可点**。只作增强路径，不替代坐标路径。开工前四件待查：主进程有没有 `setAccessibilitySupportEnabled`、DOM→UIA `Name` 映射、AOT 下 `IUIAutomation` 互操作、混合 DPI 下 `BoundingRectangle` 坐标系 | [S-273](../iter-v3-4/requirements/S-273.md) |

### 1.4 全局会话 ↔ 项目会话通信（三条，**一组，不许拆散**）

| 编号 | 标题 | 明细 |
|---|---|---|
| S-278 | 全局会话发给项目会话的消息是裸文本 —— 希望识别出来渲染成组件 | 项目会话里看到的是一条 `role=user` 纯文本，正文是 `[GLOBAL AGENT WORK REQUEST] dispatch_id=…` + 一段给模型看的英文协议说明，**用户全看得见**。根因：`project/send-session-message` 走 `chatStore.sendMessage()` 完全模拟用户输入（文件头注释自述 *fully simulating a user action*），只传 `content`、无 meta，渲染端只能嗅探正文前缀；dispatch 记录与这条消息**没有 id 级关联**。附带：同一段协议文本有两份实现（C# `AgentRuntimeGlobalTaskExecutor.cs:233-235` vs 渲染端 `task-board-store.ts` 的 `buildWorkRequestContent`，注释自称 mirrors），**措辞已漂移**。推荐方案 A：meta 带 `dispatchId`/`globalTaskId`/`kind`/任务标题，协议说明移出消息正文 | [S-278](../iter-v3-4/requirements/S-278.md) |
| S-279 | 普通消息（`send_session_message`）发出去就没法回 —— 需要轻量回执 | `send_work_request` 有 dispatch 记录能回执，`send_session_message` **裸 content 无任何标识**（`AgentRuntimeProjectExecutor.cs:274-328`），而 `reply_global_dispatch` 的 `dispatchId` 是必填 ⇒ 普通问答回不了。现有 `followUp` 是反方向定时追问，救不了。方案：普通消息也建轻量 dispatch（`kind=message`，建议 `gm_` 前缀），**复用同一个回执工具不拆两个**，默认 `hidden_from_board` | [S-279](../iter-v3-4/requirements/S-279.md) |
| S-280 | 全局任务的回执不能只靠 agent 自觉 —— 需要确定性的归档机制 | `reply_global_dispatch` 是可选工具，模型会漏：①协议说明写在消息正文里，长会话一压缩就没了（正被 S-275/S-276 放大）；②活干长了收尾忘了；③不觉得这算「汇报」；④这轮压根不是在做这件事。**把状态正确押在模型自觉上本身就是设计缺陷**（同 S-267/S-268 病根）。方案三层：投递态 → `loop_start`/`loop_end` 事件驱动执行态 → 归档分**显式 / 隐式**。三条硬规矩：**显式覆盖隐式**、**隐式必须标明「未显式回复」不许伪装成完成**、**自动归档只写 dispatch 记录不塞消息**。核心难点是「这一轮是不是在干这个 dispatch」—— 借 S-278 的 meta 做强判据 | [S-280](../iter-v3-4/requirements/S-280.md) |

### 1.5 数据结构与持久化（两条，**都要动 schema 或分页口径，开工前必须拍板**）

| 编号 | 标题 | 明细 |
|---|---|---|
| S-285 | 助手消息块结构拆出 `message_parts` 表 —— 工具调用改追加写 | 老大原话「再加一个表，新的助手消息都是另一个表？」，并明确「**最好能兼容老数据**」。根因：工具调用语义上是**追加**的，而 `messages.meta` 是**整行覆盖**的 —— 一条 148 次工具调用的消息 = **148 次 upsert × 14.5 MB = 2.07 GB** 的 stringify + IPC 分配。**S-284 剥完 base64 后仍有 1,257 KB**（纯文本 output 836 KB + thinking 两份 272 KB + 结构开销），所以不是锦上添花。**方案零迁移**：meta 里已有 `toolCalls`/`segments` 的老消息走原路径逐字节不变，新消息只追加 `message_parts`；读时按 `message_id` 分支合并，对外形状不变、渲染层零改动。**前置 S-284（已交付）** | [S-285](../iter-v3-4/requirements/S-285.md) |
| S-277 | 压缩产物在 `messages` 表永久累积 —— 一个会话一天攒 20 张「任务暂告一段落」 | 同一会话 21 个快照 / 20 对消息行，占全部消息 14%。wire 侧是对的（旧摘要一律折进折叠区，one-summary invariant 没破），错的是持久化与渲染从不清理。**三个方案待拍**：A 加 `superseded_by` 只展开最新一对（可与 S-276 的 `is_artifact` 列合并成一次迁移）/ B 删旧行（破坏溯源，且动 `sort_order` 游标）/ C 纯渲染端合并（零迁移，但窗口仍被卡占名额）。**不删 `session_compaction_snapshots`** —— 那是唯一证据链 | [S-277](../iter-v3-4/requirements/S-277.md) |

### 1.6 归因不明（一条，可能做不了）

| 编号 | 标题 | 明细 |
|---|---|---|
| S-265 | 裸 body 400 —— 上游只回 `{"model":"xxx"}`，30~52 秒慢拒绝 | 家里电脑真实日志 14 条，全在会话 `Uy5QPV02…`、全打同一渠道。**与 S-264 / S-261 不是同一个 bug，别合并**。S-262 已能保证它不钉死会话（替换工具结果重发一次 + 指纹去重后抛），代价是每次多烧一次 30~52 秒请求 —— 可接受，不是缺陷。**定性需要拿到完整请求体**，本地无该会话、渠道侧可能已下线该 model id | [S-265](../iter-v3-4/requirements/S-265.md) |

## 二、挂账 / 阻塞（两条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账**。v3-iter-4 刀 13 / 14 修的是 `scrollTop` 被 clamp 绕过（S-274），**与 S-233 根因不同**，修完 S-274 后 S-233 仍未解决。重开前必须先补两处判据盲区（见 `../iter-v3-4/plan.md` §三） | [S-233](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约**，全树搜 `qoder` 零命中。契约不到不写任何请求代码 | [S-230](../iter-v3-2/requirements/S-230.md) |

## 三、知识库核对（AGENTS.md:273 硬规矩）

核对对象：`D:\koda\Obsidian\05-WishfulClaw\issues\bugs.md`（2026-10-30 版，剩余 3 条 + 1 条待观察）。

| # | 知识库条目 | 本次核对结论 | 处置 |
|---|---|---|---|
| 1 | **2026-09-22 · 沙箱 Write 被拦**（中文 / 下划线 / 深层子目录，🔴 未修复） | **早已立项并修复 —— 就是 S-144**。`docs/plans/iter-v2-36/requirements/S-144.md` 状态行「✅ 已修（勘测结论 + 两处实修 + 14 断言回归）」，2026-09-23 落地。**知识库记的三个「触发候选」全是错的**：`PathBoundary.IsInsideAnyRoot` 全程只做一次 `Path.GetFullPath` + 前缀比较，不按文件名 / 字符集 / 层数分支，中文与十层子目录走同一条「前缀命中」路径。**真根因是 `workingFolder` 漏传** ⇒ 沙箱根集合与文件工具基准路径**同时落空** ⇒ 项目内写入被判越界，而报错还在劝用户「把目录加进项目工作目录」（他早就加了）。两侧都堵了：C# 侧 `ResolveProjectWorkingFolder` 缺失时按 `projectId` 回查项目表；渲染端补三处回退 | **本迭代不立项**（重复登记）。知识库该条**回写归档**，附注「用户现场未复验，但机制已闭环」 |
| 2 | **2026-10-27 · 图像消息 400**（`.image[0] unsupported image`，🔴 未修复） | **已被 v3-iter-3 / v3-iter-4 整条链路覆盖并结案**：S-246（组包侧闸门 + 工具入口收紧，`S-246.md:231` 老大原话「**本需求结案，且不需要造脏图会话做真机复验**」）+ S-261（marker 表缺 `unsupported image` 词形 / `source.type==='url'` 绕过闸）+ S-262（400 请求级拒绝不钉死会话）+ S-264（脏图源头治理，宁可标读图失败）+ S-266（签名在头、截断在尾）+ S-267。v3-iter-4 收尾时全部判「真机生效」 | **归档**。知识库该条移入《历史记录》 |
| 3 | **2026-10-30 · 渠道消息重复投递**（🔴 未确认，根因未知） | **本次勘察已从代码定性，不需要降日志级别**。见下节 | **建议本迭代立项（S-291），待老大点头** |
| 待观察 | 裸 body 400（`{"model":"xxx"}`） | 已立项为 **S-265**，随本迭代承接 | 见 §1.6 |

### 3.1 渠道消息重复投递 —— 勘察结论（2026-10-30 20:30）

**根因：投递层全程没有 messageId 去重，而微信渠道的传输语义是 at-least-once。**

`src/main/channels/providers/weixin/weixin-service.ts`（443 行，微信用**长轮询**不是 WS）：

1. **`handleIncomingMessage` 没有任何去重表**（`:346-435`）。`messageId` 在 `:366` 算出来后，**只被用作 `messageReplyMeta` 的 Map key**（`:378`），从不参与「这条我处理过没有」的判定。⇒ 服务端重放同一批消息，就会**重复 emit `incoming_message`**，上层照单全收、重复入库、重复触发回复。
2. **两条必然产生重放的重试路径**：
   - `request_timeout`（`AbortError`）⇒ `:322-323` 只 `console.warn` + **2 秒后带着旧的 `syncBuf` 重试**。长轮询下「服务端已推进游标、客户端没收到响应」时，这是**结构性 at-least-once**，不是偶发。
   - `session_timeout` ⇒ `:306-308` `resetPollingCursor()` 把 `syncBuf` 清空（`:235-238`）。清空后从服务端重新同步，历史消息会再来一遍。
3. **为什么只看到「旧消息」**：`:361-364` 有个 `timestamp < Date.now() - 15 分钟` 的窗口过滤，把大部分重放挡掉了 —— 挡住的是老消息，**15 分钟以内的重放全放行**。知识库里 09:13:22 → 09:16:07（2 分 45 秒）那一对正好落在窗口内，完全吻合。10-29 18:53:24 → 10-30 09:0x（14 小时）那一对**超出窗口**，说明出站方向可能还有一条独立的重发（`messageReplyMeta` 有界 500 条，被挤掉后 `replyMessage` 拿不到 contextToken，会回落 `sendMessage` 再发一次 —— **待实施时验证**）。
4. **与知识库「`messages` 表里只有 1 份记录」不矛盾**：出站重复不经过 `messages` 表；入站重复那两条本来就该是 2 行（知识库确认 09:13:22 / 09:16:07 两条 user 消息内容完全相同 = 2 行）。

**修法（小，不动 schema）**：`handleIncomingMessage` 入口加一个有界去重集合 —— `Set<messageId>` + 保留最近 N 条（如 1000）/ 时间窗内有效，命中即 `return`。附带把 `request_timeout` 的重试改成「先确认服务端游标是否已推进」或至少记一条可诊断日志（当前 `console.warn` 在 logLevel=error 下不出现在落盘日志里，这是知识库那句「渠道投递根本不写日志」的来源）。

**建议**：**本迭代立项做掉**。理由三条：①根因已从代码定位，不等日志；②改动面是一个文件、一个集合，不碰 schema；③手机端重复收消息是用户直接可见的体验缺陷，而「无去重」本身就是与是否真发生过重放无关的正确性缺口。

## 四、移交下迭代

本迭代新增的移植需求见 `plan.md` §2.5（开工后补）。

## 五、文档状态

- `plan.md` —— 承接索引 + 刀序
- `raw-requirements.md`（本文件）—— 需求清单
- `changelog.md` —— 裁定与口径流水
- 需求正文**不复制**，一律链接原目录；本迭代**新登记**的需求才落 `requirements/`
