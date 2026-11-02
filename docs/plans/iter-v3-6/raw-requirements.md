# v3-iter-6 需求清单

> **迭代状态：已建立**（2026-11-01 20:0x 拆分支）。
> 分支 `dev/v3-iter-6`（base = `98687742`，= v1.0.5 发布记录提交，即最新 `main`；tag `v1.0.5` → `addfbc7f`），**从最新 main 拆**。
> 产品版本 `1.0.6`、tag `v1.0.6`（收尾时才改 `package.json`）。**执行期内只 commit，不 push。**
> [plan.md](plan.md) 有刀序；[changelog.md](changelog.md) 是裁定与口径流水。
> **需求正文一律留在原目录，不搬家** —— 本文件只做索引与链接。本迭代**新登记**的才落 `requirements/`。

## 一、需求清单（**九条在册，其中 S-301 归属待定**）

> 算式：承接六条（S-293 / S-291 / S-296 / S-292 / S-295 + 已撤的 S-265）− S-265 撤销 = 5 条，+ 新登记四条（S-298 / S-299 / S-300 / S-301）= **9 条**。S-277 属 v3-iter-4 移交，20:43 已撤销，留行备查。
> 2026-11-01 20:5x 逐条核对后收敛：**撤销 2 条**（S-277 / S-265），**降级 1 条**（S-293 退出刀 0），**缩范围 1 条**（S-292），**解除前置 1 条**（S-296 错误数已量完）。
> **S-291 于 21:12 定性彻底改写**：原「入站重复投递」方向错误，实际是**出站回执在本次无文本输出时回退到会话里最后一条 assistant 消息**，把上一次的内容当本次结果推出去。
> **S-300 于 2026-11-02 08:30 从候选拉回本迭代** —— 老大裁定「这个需要本迭代做，当前迭代还没开始动手，只在登记需求阶段」。

来源：`docs/progress/v3-iter-5.md` §遗留 + `../iter-v3-5/raw-requirements.md` §4.1 正式移交清单。

### 1.1 数据与库（一条，**已退出刀 0，降为普通刀**）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-293 | preview / dev 构建会污染生产库 schema —— `pickDataDir` 没拦住「非打包构建指向已存在的生产目录」 | **保留，但不再是刀 0** | **原证据已失效**：10-31 的现场是「生产库出现只存在于 v3-iter-5 DDL 的两张空表，而当时跑 1.0.3」。2026-11-01 实测生产库 `message_parts` **284 行**、`global_message_dispatches` **0 行** —— 但 **1.0.5 已发布，这两张表就是 1.0.5 的正式 DDL**，284 行是生产实例自己正常写入的 ⇒ **污染痕迹已被覆盖，当时到底怎么进去的无法复核**。剩余真实风险只有一个：**我们自己开发时显式把数据目录指向生产库**（用户侧零风险，dev 默认 `.wishful-claw-dev`）。修法不变：`src/shared/data-dir.ts` 的 `pickDataDir` 加判据 —— 非打包构建且目标目录**已存在且带 `index.db`** ⇒ 拒绝启动或显式告警。纯函数、已有 17 断言套件，成本最低 | 见 §3.1 |
| ~~S-277~~ | ~~压缩产物在 `messages` 表永久累积~~ | **❌ 已撤销（2026-11-01 20:43）** | 老大原话：「之前一屏显示一大堆摘要，那是本身我们程序报错导致的压缩不到位，跟显示一毛钱关系都没有，这个不做」。原判断把「数据在增长」当成「问题在恶化」—— S-276 修完窗口判定后首屏已不被卡挤占，其余三条危害复核后全不成立。详见 §3.7 | [S-277](../iter-v3-4/requirements/S-277.md) |

### 1.2 渠道与协议（一条**定性改写、明天推进** + 一条撤销）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-291 | **定时任务推送历史回复** —— 本次无文本输出时回退到会话里最后一条 assistant 消息 | **📝 定性已改写（2026-11-01 21:12），只登记、明天推进** | 老大现场：「昨晚收到一条，早上又收到一条」「两个内容是重复的」⇒ **出站内容错，不是入站重复**。链条：`cron-runtime.ts:428` 15 轮掐断（S-299 范围）→ 本次零文本 ⇒ `sentReplyCount === 0` → `use-channel-auto-reply.ts:387-393` 倒序扫 `!isStreaming` 的 assistant、`if (finalText) break` **跳过空消息必然捞到历史** ⇒ 推昨晚那条。只收到一条是因为 `cron-runtime.ts:552` session 模式**跳过 `deliverResult`**。同源第二处：`cron-runtime.ts:437-438` 的 `result.summary` 兜底 | 见 §3.2 |
| ~~S-265~~ | ~~裸 body 400 —— 上游只回 `{"model":"xxx"}`，30~52 秒慢拒绝~~ | **❌ 已撤销（2026-11-01 20:5x）** | 实测生产库 400 共 **57 条，最近一条 2026-10-22**，此后十天零新增；最近 6 条全是结构化 `invalid_request_error`，**没有一条裸 body**。为一个不再发生的形态去加 schema 诊断列，成本与收益不匹配。重开需三条件同时满足，详见 §3.8 | [S-265](../iter-v3-4/requirements/S-265.md) |

### 1.3 工程护栏（两条，**一条已量完可一刀清、一条范围缩到单点**）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-296 | `tests/**` 不在任何 tsconfig 里 —— `npm run typecheck` 一个测试文件都不编译 | **✅ 错误数已量完，一刀清完** | **119 个套件**（2026-11-01 实测）。2026-11-01 20:5x 用临时 `tsconfig.test.json` 实测：**总错误数 4**，集中在 2 个文件（`tests/live-cursor/program.ts` × 3、`tests/fallback-chain/program.ts` × 1），**全是同一类 ASI 陷阱** —— 箭头函数 `=> ({…})` 结尾、下一行紧跟裸块 `{`，按规范不插分号 ⇒ 被解析成函数调用。**行尾加一个分号即消**（已逐行二分验证：`step-28` 触发器是那行裸块，`v5-semicolon` 干净）。原「先量后定」的前置解除，**不豁免任何套件** | [S-296](../iter-v3-5/requirements/S-296.md) |
| S-292 | 插件命令「压缩会话」是 no-op | **范围缩到单点** | 核对后范围比登记时小得多：**界面上的「压缩会话」是好的** —— 走 `compressSessionContext`（`use-chat-actions.ts:629`）由 worker 真压缩；**只有渠道里发 `/compress`** 走 `db/messages-compact-session` → `CompactSession`，对 S-285 之后的纯文本 `content` 返回 `compacted = 0`，于是 `plugin-command-handlers.ts:406-407` 回一句假话「Context is already compact.」。**改法二选一**：让命令真压，或干脆删掉这个命令 | 见 §3.3 |

### 1.4 本迭代新登记（四条，其中 S-301 归属待定）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-298 | 检查更新弹窗的「更新说明」不稳定 —— 每次检查都清零再赌补拉 | **新登记；11-02 09:24 现象不再复现，根因已定位，归属待定** | 老大原话：「二次点开弹窗就看不到更新说明了……点后台下载，过一会儿再点开看进度，结果没有更新说明了」。`UpdateDialog.tsx:142` 只要有内容就渲染，所以丢的是**状态**不是渲染。**11-02 复核定性**：候选 B（`applyNotAvailable` 清空）**已排除** —— `LEGAL_TRANSITIONS:26` 是 `downloading: ['downloaded','error']`，`downloading → idle` 非法，走不到清空那行。真根因是 `updater-state.ts:171` **`applyAvailable` 无条件写 `releaseNotes`**：清单 0.2.39 起不带说明 ⇒ 每次 `update-available` 都清零，再靠 `fetchReleaseNotes`（5s 超时、无重试无缓存、所有 miss 吞空串）异步赌回来。⇒ **不是说明丢了，是每次都要重新拿一次。** 09:24 老大反馈现象已停，但缺陷客观仍在（窗口窄，要求补拉那次失败） | [S-298](requirements/S-298.md) |
| S-299 | 定时任务被 15 轮掐断 —— 默认改成不限，轮次留作手动设置 | **新登记（老大 20:11 拍板默认不限）** | 老大原话：「确实是定时任务触发的……做任务到一半停住了，我还不知道原因」+「我希望默认是不限，可以手动设置轮次。现在是默认 15 实际我其实没有去改」。**不是上限太低，是「用轮次当护栏」这个设计错了**：一轮可能 1 秒也可能 3 分钟，15 轮跟任务复杂度没有比例关系。⚠️ **坑在 `cron-runtime.ts:428` / `:504`** —— `> 0 ? ... : 15` 会把用户填的 0 反向改成 15，只改 UI 默认值无效。UI `min={1}` 连 0 都填不进去，且**零说明** | [S-299](requirements/S-299.md) |
| S-300 | 全局任务增加可选「归属项目」属性 + 项目会话可查询本项目任务 | **新登记（2026-11-02 08:27 口述；08:30 拉回本迭代）** | 老大原话：「全局任务增加一个可选属性 可以选择挂某一个项目下 项目下会话可以查询当前项目的任务」。**现状取证**：`global_tasks` **无 `project_id`**（`DbClient.Schema.cs:362-373`），派活表 `global_task_dispatches` 才有（`:376-390`，那是**派活目标**不是任务归属）；6 个全局任务工具全部 `availableModes: ["global"]` + `GlobalSideAndWorkRuns`，`ToolVisibilityScopes.cs:34-38` 注释写明**项目会话是刻意排除的** ⇒ 本条真正的工作是**新开一条受控只读通道**，不是加个字段。**三条硬边界**：projectId 服务端从 `sessions.project_id` 推导、**不接受模型传参**（验收要求反向验证）；项目侧**只读**；不能用 `workingFolder` 反推项目 | [S-300](requirements/S-300.md) |
| S-301 | 提供工具让 agent 回看**当前会话**的用户历史发言（按日期切单日） | **新登记（2026-11-02 08:53 口述 + 09:01 补参数）；09:05 裁定本迭代做 ⇒ 刀 8** | 老大原话：「当前 agent 在执行过程中会对上下文进行压缩……之前用户说过的话，特别是比如昨天说的这种，可能 agent 就不知道了」+「不需要跨会话，就当前会话的，也不需要什么 query 之类的，我要的是用户发送的消息」+「我需要你参数增加一个日期，其实就单日用户发言来说其实并不多」。**痛点**：全局 PM 统管模式跑久了，压缩把用户早期拍过的板全挤掉，PM 反复问已经定过的事。**现状**：`RealUserTurnPredicate`（`DbMessageToolsQueries.cs:34-35`）已能排除压缩摘要卡，可直接复用；但 `ListByTurns`（`:80+`）返回**整轮全部内容**（含 assistant / 工具块 / 思考流），当工具用会撑爆上下文 ⇒ 需**精简投影新端点**。**三条硬边界**：sessionId 服务端从 run state 注入、**不接受模型传参**（`AgentLoop.cs:69` 证明拿得到；工具侧现有惯例全是模型传参，不能沿用）；只返回 `role='user'`；只读。**时区坑**：`created_at` 是 unix 毫秒，Db 层零日期解析先例，按本地时区切日写错会落到前一天 | [S-301](requirements/S-301.md) |

### 1.5 研究型 + 原型实验（一条，**本迭代真做原型**）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-295 | Electron → Avalonia 技术路线评估 | **口径变更：本迭代做原型实验** | 老大 2026-10-31 给的参考案例（Astra Gate：350M → 50M）是网关控制台，UI 只有几页；我们是 874 个渲染层文件 + 内置 Chromium `<webview>` + 740 个 C# worker 文件的 agent 客户端，业务逻辑本来就在 .NET 里。⚠️ **前提已由 S-247 收口推翻一半** —— 实测「跑完能还 311 MB」，1.3 GB 峰值不是 Electron 固有开销。**2026-11-01 20:11 老大改口径**：「需要在这个迭代，新开文件夹进行尝试哦」⇒ 从「只出报告」改成**真做一个可运行原型**，落点 `experiments/avalonia-shell/`（不进任何现有构建）。详见原文件 §九 | [S-295](../iter-v3-5/requirements/S-295.md) |

## 二、挂账 / 阻塞（三条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账** | 频率低、**只在新版本第一个会话偶发**，S-274 修好后仍未解决 ⇒ 根因不同。重开前必须先补两处判据盲区。老大 2026-10-31 定：「这是个确定的缺陷，只不过出现频率比较低。先登记等以后模型牛掰了再试试能解决不」 | [S-233](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约** | 全树搜 `qoder` 零命中。契约不到不写任何请求代码 | [S-230](../iter-v3-2/requirements/S-230.md) |
| S-273 段 B | 第三方窗口的元素树（`EnumChildWindows`） | **待拍板** | 段 A（自家窗口走 CDP `Accessibility.getFullAXTree`）已随 v3-iter-5 刀 7b 交付。段 B 只覆盖 Win32 控件，Chromium 系第三方窗口拿不到 ⇒ 收益存疑，拍板前不动 | [S-273](../iter-v3-4/requirements/S-273.md) |

## 三、本轮核对掉的七条（**不立项**，记结论防重复登记）

### 3.1 S-293 —— 为什么**退出**刀 0

**原判断建立在一条已被覆盖的证据上。** 10-31 的现场是「生产库出现只存在于 v3-iter-5 DDL 的 `message_parts` / `global_message_dispatches` 两张**空**表，而当时跑 1.0.3」。2026-11-01 实测生产库：`message_parts` **284 行**、`global_message_dispatches` **0 行** —— 但 **1.0.5 已于 11-01 发布，这两张表就是 1.0.5 的正式 DDL**，284 行是生产实例自己正常写入的。⇒ **污染痕迹被正式版本覆盖，当时到底怎么进去的已无法复核。**

**剩余真实风险只有一个**：我们自己开发时显式把数据目录指向生产库（dev 默认走 `.wishful-claw-dev`，用户侧零风险）。所以它不紧急 —— 但仍值得修，因为改动面是一个纯函数（`pickDataDir` 已有 17 断言套件，加判据即可），收益是「以后不会再发生」，而一旦哪天真加了 `ALTER TABLE`，代价不是修 bug 而是恢复数据。

> 降级理由不是「不重要」，是「**不是现在最该先做的那一件**」。刀 0 让给了 S-296 —— 那是门禁本身。

### 3.2 S-291 —— 定性彻底改写：**出站内容错**，不是入站重复

#### 3.2.1 原定性作废

原登记写的是「渠道消息重复投递 —— 投递层无 `messageId` 去重，长轮询是 at-least-once」，指向 `weixin-service.ts` 的**入站**路径。两条否证：

1. 2026-11-01 20:5x 查生产库：`role='user'` 且长度 4~200 字、排除压缩卡的 `GROUP BY content HAVING COUNT(*)>1` —— **结果为空**，零条内容重复的用户消息。
2. 老大 21:09 给的现场是「**昨晚收到一条，早上又收到一条**」，且「两个内容是重复的」—— 收到的是**一条**，不是两条同样的。入站重复会表现为「同一条用户消息被处理两遍」，与现象对不上。

#### 3.2.2 新定性：本次无输出 ⇒ 回退到历史 assistant 消息

老大 21:12 的怀疑（「轮次上限到了，但是 agent 还没有输出文本，导致最后直接推送了上一条回复」）**读码后完全成立**，链条三步：

| 步 | 位置 | 事实 |
|---|---|---|
| ① 被掐断 | `cron-runtime.ts:428` | `maxIterations: runEvent.maxIterations && runEvent.maxIterations > 0 ? runEvent.maxIterations : 15` —— 定时任务默认 **15 轮**硬编码（S-299 范围）。跑满即停，此时 agent 可能一句文本都还没吐 |
| ② 零文本 | `use-channel-auto-reply.ts:379` | `flushAutoReplyText` 冲的是 `textBuffer`；15 轮全在工具调用 ⇒ buffer 空 ⇒ `sentReplyCount === 0` |
| ③ 翻历史 | `use-channel-auto-reply.ts:387-393` | 倒序扫 `role === 'assistant' && !isStreaming`，`finalText = msg.text \|\| extractTextFromContent(msg)`，**`if (finalText) break`** |

第 ③ 步的 `if (finalText) break` 是罪魁：本次运行的消息 `text` 为空 ⇒ 不 break ⇒ **继续往前翻** ⇒ 昨晚那条有文本 ⇒ break ⇒ 推出去。

#### 3.2.3 为什么只收到一条（不是两条）

`cron-runtime.ts:552` 在 `runMode === 'session'` 时**跳过 `deliverResult`**：

```ts
// In-session mode already streamed the full result into the session via
// sendMessage; skip the separate delivery step to avoid duplicates.
if (!(event.runMode === 'session' && runEvent.outputMode !== 'bot')) {
  await deliverResult(runEvent, result, runId)
}
```

⇒ `buildDeliveryMessage` 那条路（带标题的 `${title}\n\n${summary}`）根本不走，**只剩 loop_end 回执这一条**。与老大「早上又收到一条」完全对上。

#### 3.2.4 同源第二处

`cron-runtime.ts:437-438` 的 `result.summary` 是同一个错法：

```ts
const lastAssistant = [...(session?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && !m.isStreaming)
const finalText = completion.text || lastAssistant?.text?.trim() || ''
```

`result.summary` 会进 toast（`:587`）和 `cron_runs` 表 ⇒ **界面提示和运行记录也记的是昨晚那条**。修 S-291 时这两处要一起改，否则只修一半。

> 注：`new_session` 模式（sidecar，`:514-518`）**没有**这个兜底，无输出就回 `'Completed successfully.'` —— 不理想但不会推历史。只有 `runMode === 'session'` 会中。

#### 3.2.5 修法方向（明天实施前再确认）

- **兜底只能在本次运行区间内**：`registerExternalChannelReply` 时记 baseline（`session.messages.length` 或起始时间戳），兜底只扫 `slice(baseline)` 内的消息。**禁止翻到 baseline 之前**。
- **区间内也没有文本 ⇒ 推明确状态**，不回退历史：比如「✅ <任务名> 已完成（本次未产生文本输出）」。用户宁可看到一句实话，也不要看到昨晚的内容。
- `cron-runtime.ts:437-438` 的 `result.summary` 同样按上述两条改。
- 与 **S-299**（默认不限轮次）是**两条独立的刀**：S-299 让任务不被 15 轮掐断，降低触发概率；S-291 让「就算没输出也绝不推历史」。**不能只做 S-299** —— 用户手动设 5 轮、或任务真出错时，兜底照样会翻历史。

#### 3.2.6 风险与验证

要真机：微信凭证 + 白天。写坏了渠道**静默失效**（收不到消息也不报错）。验证步骤：把定时任务轮次手动设成 2、让它在纯工具调用后停 ⇒ 期望收到「已完成，未产生文本输出」，**不是**上一条历史内容。

> **老大 21:12 裁定：只登记，明天再推进。** 本条不动代码、不排今晚的刀。


### 3.3 S-292 —— 只有**渠道命令**是 no-op，界面按钮是好的

**核对后范围缩到单点。** 两条链路要分开看：

| 入口 | 走哪条 | 状态 |
|---|---|---|
| **界面「压缩会话」**（浮块 / ContextRing） | `compressSessionContext`（`use-chat-actions.ts:629`）→ 发 IPC 给 worker，**worker 真压缩** | ✅ 好的 |
| **渠道命令 `/compress`**（微信 / QQ 等） | `handleCompress`（`plugin-command-handlers.ts:386`）→ `db/messages-compact-session` → `CompactSession` | ❌ no-op |

`CompactSession` 里的 `TryCompactMessageContent`（`DbMessageCompactTools.cs:116-141`，调用点 `:37`）要求 `content` 是 **JSON 数组**；S-285 之后新消息的 `content` 是纯文本 ⇒ `Parse` 抛异常 ⇒ 全部 `continue` ⇒ `compacted = 0` ⇒ `plugin-command-handlers.ts:406-407` 回一句 **「Context is already compact.」** —— 用户以为压了，实际什么都没做。

**实施时二选一**：①让命令真压（对齐界面按钮的行为，走 worker 那条链）；②**直接删掉这个命令**。留一句假话比没有这个命令更糟。原「设计要重做 / 三选一（删 parts / 折 meta / 只压 wire）」的判断**不成立** —— 那是把界面按钮也当成了 no-op，而它是好的。

### 3.4 S-298 —— 两条候选链路（根因未确认，别硬编）

- **候选 A（我倾向这条）：说明是「一次性 best-effort 拉取」，没有重试也没有落盘缓存。** `latest.yml` 从 0.2.39 起不带 `releaseNotes` ⇒ 说明**只能**从官网拉 `release-notes-<版本>.md`（`src/main/lib/release-notes.ts:106`）。`announceUpdateAvailable`（`updater.ts:231-254`）拉一次，失败就 `return ''`，而 `applyReleaseNotes`（`updater-state.ts:197-203`）**拒写空串**、也没有第二次机会。于是那一次请求失败 = 本次更新周期内说明永远空 ⇒ 「不稳定」正好对上「有时有、有时没有」。
- **候选 B：下载中重查把相位打到 `error`，再重查一次走 `applyNotAvailable()` 把说明清了。** `updater-state.ts:205-211` 在 `downloadedVersion` 为空时**连 `releaseNotes` 一起清**；而 `error → idle` 是合法跃迁（`LEGAL_TRANSITIONS`），下载中的相位又恰好 `downloadedVersion === null`。触发链：下载中点开弹窗 → `recheckLatest()`（`use-app-updater.ts:189-192`）→ `checkForUpdatesInternal` 抛错 → `setError` → 相位 `error` → 再查一次返回 not-available → 说明被清。

**两条都改得动、互不排斥**：A 是「拉不到就留空且永不重试」，B 是「不相干的状态跃迁顺手清了一个不相干的字段」。真机取证前不判定哪条是主因 —— 先看主进程日志里 `Updater could not resolve release notes for` 有没有出现，有就是 A。

### 3.5 「内置浏览器清除缓存」—— **已实现，不是欠账**

老大 2026-10-30 让登记一条「希望浏览器增加去除缓存操作」，本轮核对：**已经在 1.0.5 里了**。工具栏有按钮（`browser-toolbar.tsx:118`，`title={t('browser.clearCache')}`）、面板有处理器（`BrowserPanel.tsx:161-177`，成功/失败都有 toast）、主进程实现在 `misc-handlers.ts:300-313`（**只清两级缓存，刻意不碰 `clearStorageData`** —— 那会把所有站点登录态一起抹掉）。**不立项。**

### 3.6 「`DesktopListWindows` 列最小化窗口」（原拟编号已撤销，不占用）—— **不成立，v3-iter-5 changelog 那条残留是错的**
`../iter-v3-5/changelog.md:208` 写着「会把最小化窗口也列出来（矩形是 `-32000`）……留 v3-iter-6」。本轮实读代码：**列不出来**。

- `ExecuteListWindows`（`AgentRuntimeDesktopExecutor.Windows.cs:228`）在 `:236` 逐条过 `DesktopWindowLocator.IsCapturable`，不满足就 `continue`；
- `IsCapturable`（`DesktopWindowLocator.cs:38-44`）的第一个条件就是 **`!window.Minimized`**，而 `Minimized` 来自 `:167` 的 `IsIconic(hWnd)`；
- 三处（枚举列表 / 按窗口截图 / 标题匹配）用的是**同一个** `IsCapturable`，没有旁路；
- `DesktopToolProvider.cs:42` 的工具描述本来就写着 *"Minimized windows are not listed; restore them first."* —— 描述与实现一致。

`git log -S "IsCapturable"` 只有一个提交 `e9d60637`（S-272 第二段 · 刀 7），也就是说**闸从第一天就在**，那条残留写下时就已经不成立。**不登记、不排刀**，只订正原文档。

> 这条和 S-281 是同一类错法：**没打开文件确认闸在哪一层就下了结论**。S-281 是路径少写一段导致结论翻个儿，这条是把「枚举层记了 `Minimized` 标志」当成「列表层没拦」。收尾期写「已知残留」必须带 `文件:行号`，否则下个迭代会为一条不存在的缺陷排一刀。

### 3.7 S-277 —— **已撤销（2026-11-01 20:43）**

> 老大原话：「之前一屏显示一大堆摘要，那是本身我们程序报错导致的压缩不到位，跟显示一毛钱关系都没有，这个不做」

原需求把「一屏一大堆摘要卡」定性成**显示层缺陷**，方向就错了：那一屏卡的真实来源是**压缩触发异常**（压缩不到位 ⇒ 反复重压），**S-276 修完窗口判定后首屏已不会被卡挤占**（`DbMessageToolsQueries.cs:34-35` 的 `RealUserTurnPredicate`，四处 SQL 统一用）。剩下的「上滚能看到历史卡」是历史事实的正确呈现。

撤销前逐条复核，其余三条危害也都不成立：

| 原说法 | 实测 |
|---|---|
| 首屏满屏卡 | **已修**（S-276，`840d99e9`） |
| 模型上下文被污染 | **从来不是问题** —— wire 侧一直有 one-summary invariant（`ContextCompression.cs:565-569`） |
| 库越攒越大、拖久回填越慢 | 20 行 / 141 行。一天 20 次 × 一年 ≈ 7000 行，SQLite 无感。**「在增长」不等于「在恶化」** |

**决策错误的教训**：我当时写的是「唯一一条数据只增不减的缺陷，拖越久库越大、回填越慢」—— **把「数据在增长」当成了「问题在恶化」，没量化危害**。「回填越慢」更是伪命题，本来就不该回填。

> **以后登记「数据累积」类需求，必须先回答一句：不清理的实际后果是什么？** 答不出具体后果的，不立项。

不占刀序、不加列、不回填、不动渲染。`DbMessageToolsQueries.cs:28` 那条「不加 `is_artifact` 列」的注释**保持原样**（撤销后代码与注释一致）。方案与探针结论保留在 [S-277.md](../iter-v3-4/requirements/S-277.md) §七，以后真需要时不用重查。

### 3.8 S-265 裸 body 400 —— **已撤销（2026-11-01 20:5x）**

**现象已经停了，取证窗口关着。** 实测老大这台机器的生产库（`request_usage_logs`，只读查询）：

| code | kind | 条数 | 最近一条 |
|---|---|---|---|
| **400** | `http_400` | **57** | **2026-10-22 08:16** |
| null | `exception` | 31 | 2026-11-01 12:04 |
| 429 | `http_429` | 31 | 2026-10-28 12:29 |
| 502 | `http_5xx` | 30 | 2026-10-30 12:05 |

**最近 6 条 400 全是结构化报文**（`invalid_request_error` / `MissingSessionID`），没有一条是裸 body；400 最近一条是 **10-22**，此后十天零新增。

**三条撤销依据**：

1. **代价不对称** —— 原方案要在 `request_usage_logs` 上加列（schema 迁移）去抓一个不再发生的形态。迁移成本实打实，样本收益是零。
2. **归因链本身已断** —— 原文档 §7.1 已写明：老大那台机器的原始库拿不到 `input_tokens` / `context_cap_tokens`，方向 1 永远验不了；方向 3 需要那条渠道 `zuLcBxL9v7dzh45hHO9BY` 的配置，本地没有。**缺的这两环不是客户端加列能补上的。**
3. **它本来就不是缺陷** —— S-262 的兜底让会话不会被钉死，代价只是多烧一次慢请求；S-245 之后 400 不再重试，代价也降到单次。

**重开条件（三条同时满足，缺一不立项）**：①现场再次出现裸 body 400（只有 `model` 回显、无 `error.type` / `error.code`）；②那次请求的 `input_tokens` 与当时 `context_cap_tokens` 都在库里；③能拿到同一渠道配置做直连对比。

> **教训（与 S-277 同一条线）**：登记「缺证据所以先取证」类需求时，必须先回答**「取证窗口还开着吗」**。现象停了再建取证管道，修的是一个不存在的 bug。S-277 是「数据在增长 ≠ 问题在恶化」，这条是「当初观察到过 ≠ 现在仍然成立」—— 同一个错误的两个面：**都没量化「现在还成不成立」就下了结论。**

## 四、候选池（老大提过但本迭代不做，不进刀序）

| 编号 | 标题 | 为什么现在不做 |
|---|---|---|
| S-232 | 安全加固（无限期搁置） | 老大 2026-10-27 裁定「无限期搁置」 |
| 官网侧 | 反馈看板「已做 / 待办」标记 | 官网反馈**无限期搁置**（老大 2026-11-01）。软件内不做对应改动 |
