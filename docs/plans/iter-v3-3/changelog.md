# v3-iter-3 裁定与口径流水

> 跨需求的裁定、口径变更、方向性决定记这里。单需求细节留在 `requirements/S-{NNN}.md`。

## 2026-10-27

### 10:35 · 迭代建立

`dev/v3-iter-3` 从最新 `main`（`ae31e643`）拆出，产品版本 `1.0.3`。初始 6 条存量需求。

### 13:38 · 拆分支（doc 侧同批）

`docs/roadmap-post-1.0.md` 补 `R-4` 整节；`iter-v3-3/plan.md` 建立；`raw-requirements.md` §二 插入 R-4 + R-1 条目。

### 13:49 ~ 14:06 · 「能听」定性为插件，本仓只做基座

| 时间 | 老大原话 | 落成的决定 |
|---|---|---|
| 13:49 | 「能听**不属于我们这个项目**……走通用插件的形式，加载进来使用」 | `speech-to-text` 是**另一个项目** |
| 13:57 | 「**带 UI 属于用户自己使用的。这种插件的 UI 是插件自带**」 | Type A（给 agent 用）+ Type B（带 UI，插件自带） |
| 14:00 | 「**先只做 window**」「**不做白名单，能开放的越多越好**」「**安装是用户自己点的，要确认**」 | 只做独立窗口；权限全开；保留安装确认 |
| 14:03 | 「**避免不了的东西，没必要去防**」 | 不设防的论据记档（防插件＝防自己） |
| 14:06 | 「**我们要做的是基座**……怎么录音 怎么转写 怎么识别 **那是另一个项目的事情**」 | 本仓范围 = 基座 |

**同时否掉**：`pyannote.audio`（Python + PyTorch 栈不合）、云端 diarization API（会议音频上传）。说话人区分方案定为 **QwenASR 转写（词级时间戳）+ sherpa-onnx 说话人分割**，按时间重叠对齐。

### 14:11 · 基座拆进当前迭代

> 「把基座拆分成需求 放入当前迭代」

⇒ 拆成 **S-240 ~ S-244**（5 条），需求总数 6 → 11，迭代主线改为插件基座。原先 plan.md 里「建议单独立项 `v3-iter-4`」的判断**被老大覆盖**，作废。

**S-238 / S-239 仍预留**给 S-235 牵出的两处缺陷（复用开关被 stub 打回 / 导入 Cookie 死按钮），不被基座占号。

**刀序调整**：先轨道 A（S-240 → S-241 → S-242 → S-243 → S-244），再轨道 B（S-236 → S-234 → S-235 → S-237 → S-233 → S-230）。S-243 无依赖可插空；S-237 / S-233 / S-230 三条本来就阻塞。

### 14:17 ~ 14:19 · 资产目录内置，URL 收归主程序（**改三条需求的口径**）

> 14:17「资产下载器，这个可以我们内置下载么，我的意思是从哪里下载，用户只需要点击下载就行，以及知道有这个功能」
> 14:19「插件我们可以**内置一批目录**，用户在这个插件上点击启用并下载，相当于**我们帮他找到了路径**这些，当然**路径过期那是以后的事情**了」

三条改动：

| # | 改动 | 影响文档 |
|---|---|---|
| 1 | **manifest 的 `assets[]` 只留 `{ id, optional? }`** —— 插件里不出现 URL / 体积 / 哈希，那张表由主程序内置 | S-240 §4.1 |
| 2 | **资产落共享区** `%APPDATA%/WishfulClaw/plugin-assets/<ns>/`，**不落插件目录** —— 原 `dest: "bin/…"` 作废。理由：插件更新不白下、多插件可共用、卸载不误删 | S-242 §4.2 |
| 3 | **卸载不删共享资产**，改由设置页「已下载资产」独立清理入口负责 | S-244 §4.2 |

**不做远端热更**（老大 14:19 定「路径过期那是以后的事情」）：内置表，换源发版。

**新增「用户怎么知道有这个功能」三层落点**（老大 14:17 的「以及知道有这个功能」）：插件卡片先报体积 → 装插件时确认弹窗预告体积 → 视图内空状态给下载按钮。

**自我订正**：此前 S-242 里写的 `size: 513802240` / `sha256: "…"` 是**编的占位**，改成 `TODO 实测`。假哈希比没哈希危险 —— 校验永远失败，用户看到「文件损坏」而实际是表填错。

### 14:20 · 先推轨道 B

> 「你先登记需求文档。然后开始根据开发工作流推进**这个基座以外**的需求」

⇒ 基座五条**只登记、不动码**；本轮实施**轨道 B**：S-236 → S-234 → S-235 →（S-237 / S-233 / S-230 三条阻塞，按各自门槛处理）。

### S-236 实施中定下的三处口径（档 2）

| # | 事项 | 结论 | 理由 |
|---|---|---|---|
| 1 | 渲染端「该模型不支持图像输入」提示放哪 | **toast**，不放进输入框上方 | 老大此前明确「现在输入框上方需要显示的东西太多了」。另：`retry-banner.tsx` 全仓无挂载点，是死代码，不能照抄它 |
| 2 | 剥图剥哪一份对话 | **只剥 `ExecuteTurnAsync` 每轮的 wire 副本** | `GetConversation()` 是 `SessionConversation` 的活引用，在上面删块等于改用户历史 —— 切回会话会发现图没了 |
| 3 | 新测试项目要不要建 | **建**（`WishfulClaw.ImageInputRegressionTests`，33 断言） | 判据 10「无关 400 不许被截走」是这条链最容易被后人改坏的地方，且**一半断言是「不许匹配」**——漏匹配只多一次报错，误匹配会白烧一次往返还把能读图的模型记成瞎的 |

**同时纠正了两条旧断言的错**：`ReadImage` / `ReadVideo` 回归里原本断言「non-vision 模型读图不附像素」，那正是本 bug 的行为，改成断言照常附像素。

### 09:41 · 登记 S-248：纯文本档换形态（S-225 返工）

> 「这个就只是渲染方式变了，如果用户这个时候切换渲染方式还是能又回到现在的模式的」

**S-225 的偏差定位**：`render-density.ts` 的 `ChatRenderDensityPolicy` 8 个字段**全是布尔**，`text` 档只是把开合全设成收起 ⇒ **形态没换，仍是卡片**。缺的是「渲染形态」这根轴。

| # | 裁定 | 来源 |
|---|---|---|
| 1 | 折叠条**保留复用**，只换壳里的渲染 | 老大 09:38 |
| 2 | 参照物 = `SubAgentStepList` 的行式文本（状态字符 + 中文描述），复用 `generateStepDescription` | 老大 09:37 |
| 3 | 纯文本档**不可点**：无 chevron、无输出区、**不弹右侧面板** | 老大 09:34 / 09:37 |
| 4 | 报错**只上红字，不显示错误摘要** —— 「错误丢了就丢了」 | 老大 09:40 |
| 5 | 耗时 / `+3 -1` **挂行尾浅色小字**（结果不是过程细节，复用 S-245 的 `formatDurationMs`） | 讨论推定，老大未异议 |
| 6 | 子 agent 卡 text 档一行、禁点、不弹面板 | 与第 3 条同源 |
| 7 | **切换档位必须完整可逆** —— text 只影响渲染不影响数据，切回来输出/diff/截图/待审批全部完好 | 老大 09:41 |

**不降级的白名单**（降成一行字功能就没了）：`AskUserQuestion` / `SubmitPlanReview` / `create_goal` / 任意 `pending_approval` / widget / 生成图片 / 浏览器截图 / Bash 附件。判定口径复用 `deriveToolOutputOpen` 已有的 `forceOpen || hasVisualOutput || isLiveCommand`，不新造第二套。

**归属**：v3-iter-3 登记，**v3-iter-4（1.0.4）实施**，本迭代不动码。

### 14:23 · 推进 S-253 / S-255 / S-257 三条并接完审查

`S-257`（`e4779c97`）、`S-255`（`59bf75f5`）、`S-253`（`337be9b7`）三刀落地。S-253 此前只有需求单写着「已完成」、代码一直没提交，顺带被审查抓到 `main.tsx` 因它涨到 515 行触了 §大文件硬线 ⇒ 拆出 `result-list.tsx`(185)，全仓复扫回到 78 / 豁免 78 / 未标 0。

**审查（子 agent，47 工具调用 / 24 轮）判 PARTIAL，1 条实质缺陷 + 多条口径问题，逐条处置：**

| # | 问题 | 处置 |
|---|---|---|
| 1 | `en/chat.json` 的 `sizeWan` 写成 `"{{wan}}k chars"` —— 万(10⁴) 配 k(10³)，**1.2 万字显示成 "1.2k chars"**，差 10 倍 | 改成 `{{kchars}}k chars`，`formatPastedBlockSize` 同时传 `wan` 与 `kchars`，各 locale 取自己单位 |
| 2 | 粘 chip 的 memo 缺 `i18n.language` 依赖，切中英不刷新 | 补依赖 |
| 3 | `<div>` 嵌在 `<button>` 里（非法 phrasing content） | 改 `<span>`，`flex` 已改 display，视觉零变化 |
| 4 | 缩略图与芯片**各**给 3 个槽位 ⇒ 媒体行最宽约 410px，`flex-nowrap + overflow-hidden + 全 shrink-0` 下先被裁掉的是 `+N`，即「还有内容」的唯一提示 | 新出纯函数 `selectPinnedMedia`，**共用 4 个槽位**（有图时图优先），并补 5 种极端断言 |
| 5 | 空态文案「（图片/附件消息）」已过时（纯图片现在走缩略图，只有真空才落空态） | 改「（空消息）」/ `(empty message)` |
| 6 | 吸附条显 basename、聊天窗显全路径，顺序也不同 —— 刻意但没记档 | 写进 S-255.md §7.4，注明验收不要按「一致」判 |
| 7 | S-255.md §7.4② 对 `hasEditableDraftContent` 的判断有误（它判的是带标签的 `draft.text`，返回 true） | 订正为「真正好处是不必重复推导 draft」 |
| 8 | S-257.md §4 示例写 `3,200 字`，实现按老大原话不加千分位 | 示例改 `3200 字` 并注明 |
| 9 | `tests/i18n-coverage` 只扫 `t(`，`translateOr` 的 key **结构性不被校验** —— 缺陷 1 正是从这里漏过去的 | 正则加 `translateOr` 分支；只调 `translateOr` 的纯 helper 文件也纳入（它们必带 `ns`，无需声明）。**变异验证**：删掉 zh 的 `sizeWan` 立即报 missing，还原即通过 |

门禁：typecheck 三配置 0 错 / `npm test` **88/88**（`select-file-tags` 18→28 断言、`pinned-turn-preview` 28→41 断言）。**三条需求的真机验收一条都还没走**（S-253 六条、S-255 六条、S-257 五条）。

### 14:55 · S-256 移交 v3-iter-4；本轮 4 刀交 dev 实例审查

> 「我先让 dev 实例审一下你做的这些内容，256 移入下一个迭代」

S-256（超长文本整页静止）本迭代只登记不动码 ⇒ **v3-iter-3 实际 19 条**，剩下的全是真机验收。移交时把三条查证过的口子和「A 步长上限必然要改那条既有断言口径」一并带走（[`../iter-v3-4/plan.md`](../iter-v3-4/plan.md) §2.1）。

本迭代 19 条需求的代码工作到此全部收口，累计 19 刀，工作区干净。

### 15:10 · dev 审查第二轮：3 条全中，逐条修

反馈原文 `.wishful-claw/notes/review-feedback-round2.md`（判 S-254 / S-257 / S-253 主进程侧 / 收尾刀**通过**）。三条我们逐条核过，**全部成立**。

**① S-255 媒体行 —— 上一轮的修复本身是回归（我的错）。** 我把「槽位」当成**元素个数**来分（`4 - 图数`），但缩略图 28px、芯片最宽 110px，个数约束不了宽度：

| 图数 | 上一轮 | 修前宽度 | 本轮修前 | 修后宽度 |
|---|---|---|---|---|
| 0 | 3 芯 | 370px | 3 芯 | 370px |
| **1** | 2 芯 | 288px | **3 芯** | **402px** |
| 3 | 2 芯 | 352px | 1 芯 | 238px |

「1 图 + 3 芯」= 402px，比当初判过宽的 410px 只低 8px —— **修复在最想治的场景里没生效，反而更糟**。而这一档恰恰最常见：贴一张截图 + 粘两段代码 + 引用一个文件。

改成按**宽度预算**反推：`MEDIA_LINE_BUDGET_PX = 400`（缩略图 32、芯片 114、徽章 32），`chipSlots = floor((400 - 32 - 图数×32) / 114)`。终态：0 图 3 芯（370，即旧实现最宽且从未被报裁切的一档）/ 1 图 2 芯（292）/ 2 图 2 芯（322）/ 3 图 2 芯（352）。

**更该反省的是测试**：我写的断言是「1 图时 3 个芯片槽」，**把错误行为固化成期望值**，下轮谁想改小反而会红；另一条 `≤ 4 个元素` 在 10 图 + 10 芯那档正好是 3+1=4，**能通过** ⇒ `npm test` 全绿完全说明不了宽度合规。现在对 0~8 张图逐档断言 `宽度 ≤ 400`，`pinned-turn-preview` 从 41 条涨到 **62 条**。教训记着：**断言要钉「用户能看见的后果」（不超宽、不裁 `+N`），不是钉「实现恰好算出的那个数」**。

**② S-253 `launchingEverything` 会永久卡住。** 渲染端只有一个写入点，而主进程 `done` 推送在「窗口首开 / 刚 reload」时被 `safeSendMessagePackToWindow` **静默丢掉**（返回 `false` 无人检查）；丢了就永远停在 `true`，转圈与空态同屏。6.7 的 `try/finally` 只挡异常，挡不住静默返回。修：`runFirstPage` 开头归零 + `showEmpty` 补 `&& !launchingEverything`。

**③ 两处豁免注释行数各差 8 行**（`clipboard-enhancer.ts` 648→**656**、`updater.ts` 696→**704**，`a9d8b776` 留下的），已按实测订正。另 `504d7a84` 提交信息写「65 个文件」，实际新增 **67 处**，口径记在这里。

门禁：typecheck 三配置 0 错 / `npm test` 88/88 / `dotnet build` 0 警告 0 错误 / 官网 build 0 错。

### 15:40 · dev 审查第三轮：① 位置放错（我的错），② 尺子是歪的

反馈针对 `07c73ed0` + `4fc2dc41`。dev 判 **S-255 宽度预算达标**、**豁免注释彻底解决**，两条要改 —— 一条是我的错，一条是「测试用的尺子本身不准」。

**① S-253 上一轮把清零放错了侧，制造出新的抖动。**

我上一轮在 `runFirstPage` **开头**无条件 `setLaunchingEverything(false)`。dev 按真实时序反算出的问题：`esProbeCache` TTL 30 秒、Everything 启动只要几秒 ⇒ 30 秒内每条 query 都命中缓存、都进 `not-running` 分支、都重推一次 `starting-everything`；而 10 秒冷却常量的判断在推送**之后**（`file-search.ts:352` 只管 spawn），拦不住推送；`enqueueEsSearch` 又是全局串行队列，第一条查询在 while 里轮询最长 3 秒，第二条得排队等。

于是：`T=0` 查询#1 → `T=+5` 推送启动态 → `T=250`（防抖 250ms）用户敲第二个字 → 查询#2 **无条件清零** → 界面从「正在启动 Everything」掉回「搜索中...」→ 等 #1 跑完再推一次又跳回来。两块都是 `h-40` 居中、图标相同、只差文案，观感就是文字在跳。**清零之前没有这个问题**（启动态只由推送写，整段稳定）。

改法：挪到查询**结束**侧（`main.tsx` 的 `finally`）。前提我核过了 —— `startEverythingAndRetry` 在 `executeFileQuery` 里被 `await`，`done` 在它的 `finally` 发（`file-search.ts:145-148`），**invoke 返回就意味着启动流程已结束**，此时清零安全。既修掉「推送丢失卡死」，又不会在启动进行中抹掉启动态。开头的清理删掉。

**② `measurePinnedMediaLine` 公式两个分支误差方向相反，一半分支零覆盖。**

这是我上一轮埋的：`selection.overflow > 0 ? elements + 32 : Math.max(0, elements - 4)` —— `-4` 是我拍的（想着「没徽章就不需要尾部 gap」），叠加「漏算 `pl-0.5`」，在 root 16 下两个误差刚好抵消成 −2.0，**看着像算对了，其实是巧合**。

dev 给的对照（R = 根字号）：

| 场景 | 真实 | 旧 measure | 误差 |
|---|---|---|---|
| R=16，1 图 + 0 芯 | 30.0 | 28 | −2.0 |
| R=12，2 图 + 1 芯 | 159.5 | 174 | +14.5 |
| R=20，2 图 + 1 芯 | 192.5 | 174 | −18.5 |
| R=20，3 图 + 2 芯 + `+N` | 381.2 | 356 | −25.2 |

根因是**量纲混了**：`pl-0.5`(0.125rem) / `size-7`(1.75rem) / `gap-1`(0.25rem) 是 **rem，随根字号缩放**，而芯片 `max-w-[110px]`、`text-[11px]` 是**固定 px**。设置页让根字号在 12–20 可调，所以我按 px 写死的常量在两端都不准 —— 而它偏偏是守门断言唯一的尺子：**若把预算收紧到 360，R=20 的真实 381 会被报成 356 而误判通过**。

第二条零覆盖同样要紧：`program.ts` 用 `chipsOf(8)` / `chipsOf(5)` 喂，而 `MAX_CHIPS = 3` ⇒ `overflow` 恒 `> 0`，`Math.max(0, elements - 4)` **一次都没执行过**。

改法：`measurePinnedMediaLine(selection, rootFontSizePx = 16)` 换成真实 flex 几何 `pl + Σitems + (items − 1) × gap`（没有尾部 gap，所以是 `items − 1`），rem 项全部乘根字号；测试对 **R ∈ {12, 14, 16, 20} 四档**逐档断言 `≤ 400`（图数 0~8），并补 3 条 `overflow === 0` 用例把分支 B 覆盖上。`pinned-turn-preview` 62 → **120 断言**。

顺带核清了「预算 400 要不要随字号调」：**不用**。最坏形状「3 图 + 2 芯 + 徽章」R=16 时 352、R=20 时 **381.5**，两端都在 400 内 —— 因为芯片固定 110 不缩放，只有缩略图与 gap 会随字号涨。这条推导写进了常量注释，免得以后有人以为要动态预算。

**变异验证**（证明尺子真能被抓歪，不是自说自话）：把 `PL_REM` 从 0.125 改成 0，`npm test` 立即 `FAIL test:pinned-turn-preview`（`a lone thumbnail is 30` 那条挂掉），87/88。还原后 88/88。

门禁复跑：typecheck 三配置 **0 错** / `npm test` **88/88** / `dotnet build` **0 警告 0 错误** / 官网 build **0 错**（368ms）。

### 15:54 · 真机验收撞出 S-253 自己的误报（审查验不出来的那一层）

老大在 dev 实例用文件搜索，界面报「已经替你启动过 Everything，但它没起来。多半是安装损坏，或它需要管理员权限才能索引。」**这句话三句全错**：Everything PID 31688 启动于 **15:53:48**（正是我们拉起的，当时就在跑）、es.exe 当场实测 `exit=0` / **119ms** / 5 条结果、`Everything` 服务 `Running`+`Automatic`。

根因两处：①`EVERYTHING_AUTOSTART_WAIT_MS` 只有 **3 秒**，冷启动读索引不够 ⇒ 超时即判 `not-running`；②文案把「慢 / 坏了 / 没权限」揉成一句，而三者处置完全不同。最讽刺的是 `es-probe.ts:347-349` 早退逻辑保证了「能说出这句话 ⇒ exe 必然存在」⇒ 从这个分支说「安装损坏」**逻辑上自我矛盾**。

改法：等待 3 秒 → **8 秒**；新增 `autostartFailed`，spawn 报错 / 非 0 退出才置真（`-startup` 遇到已有实例会立刻以 **0** 退出，不算失败，所以判定必须收紧到 `code !== 0`），文案分「还在初始化（等一等）」与「启动失败（查权限/重装）」两句。`fileSearchFailureView` 此前**零测试**（而它就是现场），补 8 条断言，`everything-search` 61 → **107 checks**；变异验证：`return result.autostartFailed` 改 `return false` 立即 `AssertionError: 「索引还没读完」和「启动失败」必须是两句不同的话，不能合成一句`。

**这一轮的教训**：前三轮 dev 审查全是「按代码反算」，能算出 381.5px、能推 250ms 时序，但**算不出「这台机器冷启动要几秒」**。3 秒写在代码里读起来完全合理，只有真跑一次才知道不够。

### 16:01 · 真机验收再登记两条（S-258 / S-259，只登记未开工）

**S-258｜左侧会话右键「清空消息」缺二次确认。** `workspace-sidebar-items.tsx:180-183` 的 `handleClear` 直接 `clearSessionMessages` 再 toast —— 而**同一文件**里紧挨着的 `handleDelete`（`:164-178`）有 `confirm({variant:'destructive'})`，浮窗 `SessionConversationPane.tsx:109-123` 也有。三个入口只有左侧这个漏了，属 S-204 的遗漏补刀。i18n key（`sidebar.clearSessionConfirmTitle/Desc`）现成，改动约 10 行。数据不可逆，建议随收尾刀落。

**S-259｜右侧面板跨会话串扰。** 老大原话三连：看着全局会话 A，项目会话 B 执行工具要看浏览器 ⇒ **A 的面板自己展开**、**空白**、切到 B 却**反而收起**。链条已查实四段：`browser-native-ui.ts:92` `openBrowserTab(url, ctx.sessionId)` → `ensureBrowserTab`（`ui-store.ts:516-568`）把 tab 记到 B 名下、却把**全局** `rightPanelOpen` 置 true → `RightPanel.tsx:58-61` 只渲染当前查看会话 A 的 tab ⇒ 空 scope + 面板开着 ⇒ 空白 → `prepareSessionSwitch`（`ui-store.ts:196-213`）切会话时**无条件** `rightPanelOpen: false` ⇒ 收起（而 B 的 tab 被 `:197` 特意保留）。

根因一句话：**开关是全局的、内容是分区的，别人的操作能改全局开关却改不动当前视图的内容。** `right-panel-scope.ts:3-6` 自己写着「漏掉的那一处就是下一次切会话串了的来源」—— 这次漏的正是「开关」这个字段本身。三个候选：A 开关也按 scope 存（彻底，20+ 读写点 + 状态迁移）/ B 工具调用只开自己那个会话的窗（最小，三处调用点）/ C 无 tab 自动收起（治标）。**建议 B 止血、A 排下个迭代根治**，需老大拍板。

### 16:11 · S-258 实施 —— 二次确认 + 三处命名统一

**先回答老大的追问**（16:07「右侧悬浮块也有这个操作，需要你确认一下是否有二次确认」）：**有。** 右侧那块就是聊天窗右上角 `absolute right-3 top-3` 的竖排悬浮操作块（`SessionConversationPane.tsx:204`），⋯ 菜单最后一项 `:305-308` → `handleClearSession`（`:109-123`），`await confirm({variant:'destructive'})`，描述插了会话标题、写明「无法恢复」，确认后才落库 —— **三处入口里写得最规范的一个**。真正缺确认的从头到尾只有左侧右键。

顺带查出两件事：①同一个动作三个名字（清空**会话** / 清空**消息** / 清空**对话**）；②composer 那个入口 `InputArea/index.tsx:453` 硬编码 `showInlineClearConversation={false}` ⇒ **它根本不渲染**，那套 `AlertDialog` 是死代码，用户真实能碰到的入口只有两个，不是三个。

**老大 16:11：「都统一成清空会话」。** 做法上选了「合并成一份」而不是「三处改成一样的字」—— 三份重复文案本身就是跑偏的原因，改值只能治一次。于是：删 `sidebar.clearMessages` 与 `chat.input.clearConversation` 两个冗余 key（zh/en 各一份，共四条），`clear-conversation-dialog.tsx` 跨命名空间引用 `sidebar.clearSession`（同文件 `:61` 早有 `t('action.cancel', {ns:'common'})` 先例，不是新玩法），权威文案只剩一处。en 的 `clearSession` 原值 `Clear messages` 一并订正为 `Clear session`，`conversationCleared` 改「会话已清空」/ `Session cleared`。

左侧 `handleClear` 改成 `async` + `confirm`，函数体与 `SessionConversationPane.tsx:109-123` 逐行对齐并在注释里写明「两处不许再分叉」；`useCallback` 依赖补 `session.title`（描述里要用）。

**一处刻意没动**：`chat.input.clearConfirmTitle/Desc` 保留原样 —— 那是弹窗正文（描述性问句，不是动作名），且要并过去得把 `{{title}}` 插值传进 `ClearConversationDialog`，而它手里只有 `activeSessionId`、没有 session 对象。为死代码改签名不值。

另记一笔：`layout.json` 有两个 `conversationCleared`，`:435` 在 `layout.layout` 段是**全树零引用的死 key**，一起改了值 —— 改不改都不影响运行，只是不想留一份字不一样的同名 key 在那儿误导下一个人。

门禁：`npm run typecheck`（node + web）**0 错** / `npm test` **88/88** / 四份 locale JSON `ConvertFrom-Json` 全通过。**待真机验收**：右键弹窗、取消不删、确认后 toast、中英文两套。

### 16:22 · 登记 S-260 —— 浏览器「两个会话活着就行，满了要告诉 agent」

老大的问题一路收窄，最后落在容量与知情权上：先是「能不能每个会话一份属于自己的内存」，我如实回答**不必拆**（进程层早已 per-session：`scopedRightPanelTabId` 每会话固定 tab id、`browserWebviewRefsBySession` 每会话一份 ref、`RightPanel.tsx:281-296` 把**所有** scope 的 webview 全挂着只切可见性、`browser-webview-helpers.ts:19` 按 `ctx.sessionId` 精确定位）⇒ 老大直接收口「我的意思就是比如同时两个会话都要用浏览器，都能活着」，再一句「有两个活着就行了，要是能提示 agent 已经有两个是最好的」。

⇒ 登记 **S-260 内置浏览器保活池**，顺延 v3-iter-4 / 1.0.4，随 S-247 内存治理同批。要点三条已写进需求单：

1. **上限 2 个会话**（不是 2 个 tab —— tab 是会话内的东西，不该跟着受限）；
2. **满了必须明确告诉 agent**，而不是静默失败 —— 这是本条的核心，`browser-native-ui.ts` 现在的失败路径没有「资源已满」这个概念，agent 只会收到一句看起来像页面打不开的错；
3. **不是能力阉割**：两个会话照样能同时活着，禁的只是第 3 个挤进来。

顺带把「共享的到底是什么」一次讲清：**进程与 ref 层早已隔离，真正共享的只有 partition 存储**（`BUILTIN_BROWSER_PARTITION = 'persist:wishfulclaw-browser'`，`browser-plugin.ts:8`）—— cookie / localStorage 串是存储层的事，与「能不能同时活着」是两个问题，别混着排。

### 17:40 · S-259 实施 —— 定案反转，通道早就有了

**这一轮最大的收获是推翻了登记时自己的结论。** 16:01 那会儿给出三个候选（A 开关按 scope 存 / B 工具调用只开自己的窗 / C 无 tab 自动收起），建议「B 止血、A 排下迭代」。落地前把 `ensureBrowserTab` 从头读了一遍，发现 **`options.background` 通道本来就有**：

```ts
if (options?.background) {
  return { rightPanelTabs, ...browserStatePatch }   // ← 不动 rightPanelOpen
}
```

而两个调用点分道扬镳：`browser-webview-helpers.ts:105`（webview 自愈重启）**传了** `{ background: true }`，注释还写着「without stealing the UI」；`browser-native-ui.ts:92`（`BrowserNavigate` 的 goto）**没传**。⇒ **B 不是「要开发的东西」，是「一行没传参」。** 三候选全部作废。

**判据没有照抄 §4.2 推荐的 `isActiveBrowserScope`。** 它用 `getBrowserScopeKey`，把 sessionId **和 projectId** 一起比；而 tab 归属桶 `rightPanelTabScopeId` 只看 sessionId。两把尺子量同一件事，在「projectId 一侧拿不到」的边界上就会判出「你在别的 scope」——面板该掀不掀，比原 bug 更难查。所以判据新写在 `right-panel-scope.ts`：`isRightPanelScopeActive`，**与桶同源**。

**护栏落在 store，不落在调用点。** `ensureBrowserTab` 在 background 分支之后再拦一刀：非当前作用域同样只返回 `{ rightPanelTabs, ...browserStatePatch }`。于是浏览器工具那处（`browser-native-ui.ts`）**一行判断都不用写**，只换了注释；团队两处（`team_start` / `team-native-ui`）显式问同一个判据。合计三处落地、一个函数 —— 换来的是「**以后新加的工具忘了传 background，也抢不了屏**」。调用点会继续长（新工具、新事件），判据写一遍才不漏，这正是 `right-panel-scope.ts` 文件头注释自己说的那句话。

**过程中差点埋一颗更大的雷**：`ui-store.ts` 第一版用的是现成的 `isActiveBrowserScope`，而团队两处用的是新写的 `isRightPanelScopeActive` —— **同一件事两把尺子**。前者比 sessionId + projectId，后者只比 sessionId；而「面板开不开」取决于内容层会不会画出这个 tab，内容层只认 sessionId（`rightPanelTabScopeId`）⇒ 两把尺子换着用，在 projectId 一侧拿不到的边界上会判出「你在别的 scope」，**前台也被锁死不展开**，比原 bug 更难查。发现后统一收口到 `isRightPanelScopeActive`，`isActiveBrowserScope` 的 import 一并撤掉。

**补了测试，因为这个函数太像「一眼就对」。** `isRightPanelScopeActive` 只有两个入参、纯比较，谁都能看出逻辑 —— 但它是四处的唯一开关，一旦有人为了修「前台不展开了」把它改成恒 `true`，四处会同时退化回原 bug，而 UI 上表现为**偶发空白面板**，真机根本抓不稳。`tests/right-panel-scope` 19 断言把边界钉住，重点钉两条最容易被人顺手优化掉的：**空白串 `'   '` 必须按前台处理**（不过 `trim` 会落进 `''` 这个假会话桶）、**没有 sessionId 的调用按前台**（宁可多开一次面板，也不要静默失败）。

**明确没做的**（沿用 §4.4，未变）：`prepareSessionSwitch` 的无条件 `rightPanelOpen: false` **不动** —— 切到 B 时面板仍会收起（现象 3 保留），那是期望问题，与 A 一起定；**A（开关也按 scope 存）** 排 v3-iter-4，因为 `rightPanelOpen` 有持久化键 `rightOpen`，改 map 要处理存量迁移，收尾阶段不做；**C** 不做兜底，A 落地后这种状态不可能出现。

门禁：`typecheck` 三配置 **0 错** / `npm test` **89/89**（新增 `right-panel-scope` 19 断言）。**真机验收 6 条未做**（S-259 §5：双会话后台 goto 不掀面板、B 的能力不受影响、切会话现状保留、前台照旧展开、后台起团队不抢屏、两会话来回切不串）。

### 16:55 · dev 第四轮反馈处置 —— 两条必须改都改了，其中一条是「尺子又低估」

反馈原文 `.wishful-claw/notes/review-feedback-round3.md`（审 `5ccebf11` → `4cfe34bd` → `97e23fbc` + 工作区）。结论 2 必须改 / 3 建议改 / 4 已核实无误，逐条处置：

**① 尺子差一个 gap（必须改，改了）。** `measurePinnedMediaLine` 的 `items` 只数缩略图与芯片，**没数 `+N` 徽标** —— 而徽标是同一个 flex 容器的子元素，也吃一份 `gap-1`。有徽标时间隙是 `items` 个不是 `items-1`。少算 4px（R=16）/ 5px（R=20），**方向又是低估**，与这把尺子历史两次出错同向（第一次漏 `pl` 与 rem/px 量纲）。自证就在常量块自己的注释里：写着「3 图 + 2 芯 + 徽章」= 352，代码算出 348，差值恰好一个 gap。附带 `BADGE_TEXT_PX` 12 → 20（两位数 `+15` 在 11px 下 ≈19.3px）。修完最坏形状 **360 @16 / 389.5 @20**，400 预算仍够但**余量只剩 10.5px**，写进常量注释了。

> 只改代码不够 —— 原来只有 `< 400` 那种宽松断言，**容忍 40px 低估**，正好把 4~5px 藏住。补两条**绝对读数**断言（360 / 389.5）与注释数字逐字对应。变异验证：`itemsOnLine` 改回 `items` 立即炸在 360 那条，还原后 **122 断言全过**。

**② 早退不激活 tab（必须改 → 我拍板是「刻意」，改注释不改行为）。** dev 抓得准：非当前作用域早退时没调 `activateRightPanelTab`，用户切过去会按 `?? tabs[0]` 回落到第一个 tab。**这是刻意的**：`rightPanelActiveTabIds` 写进去不影响当前视图，但会覆盖**用户自己选过**的焦点 —— 他在 B 里手动切到任务面板，后台 agent 导航一次就被弹走一次，连跑十次就是「面板自己乱跳」，正是本条要消灭的体验。代价可接受（浏览器 tab 在 tab 栏上，点一下就到位）。要「切过去自动选中刚打开的」，得另加状态区分「用户选的」与「agent 选的」，不值当。`ui-store.ts` 已补注释写明取舍，S-259 §7.5 记了完整理由，免得下一个人当成漏写又「修」回去。

**③ 冷却窗口内 `autostartFailed` 恒 false（建议改 → 改了）。** 10 秒冷却内不 spawn ⇒ 没有新事实 ⇒ 却报「本轮没失败」。现场表现为「spawn 硬失败 ⇒ 说『启动失败』⇒ 点重试 1 秒内 ⇒ 改口说『等一等』」。新增 `lastAutostartFailed`：进 spawn 分支先清零，三处失败处置真，**冷却窗口内沿用上一次的判定**。没有新事实就重复上次结论，这是唯一诚实的做法。

**④ 判定逻辑零覆盖（建议改 → 改了）。** 上一轮只测消费端（喂 `autostartFailed: true` 看文案），产生端一行没测，而它有陷阱：`-startup` 撞到已在运行的实例会**立刻以 0 退出**（「没事要干」≠失败）。抽成纯函数 `isEverythingAutostartFailure(code)` 放进 `src/main/lib/es-search/parse.ts`（S-252 拆出来的纯逻辑层，`tests/es-search` 本就 import 那里，不碰 electron / 进程），补 4 条断言：`0→false` / `1→true` / `-1073741515→true`（缺 DLL 异常终止码）/ `null→true`。`es-search` 145 → **149 assertions**。

**⑤ 竞态（不改）。** `child.on('exit')` 与轮询循环的时序差异最多多跑一次 `es.exe`（~120ms），不会空等 8 秒。dev 自己也标了「不算缺陷，不需要改」，同意。

**⑨ S-260 §4.5 补强（建议改 → 改了）。** dev 问「组件都卸载了，`waitForWebview` 那 10 秒里 agent 拿到的是什么」，实查后补了一张表：**不会报错**（`ensureAttachedWebview` 自愈：读 `storedUrl` → 后台重开 → 等挂载 → 等加载），但**页面是重新加载、不是进程复活**（SPA 运行时状态全丢，正有 POST 在途还可能重复提交），耗时变长而不是失败。⇒ §4.3 的溢出文案**不必**写「可能先失败一次」，但冷启动文案要写「会重新打开页面」。另把 §4.2 级 0 的判据从 `isActiveBrowserScope` 订正为 `isRightPanelScopeActive`，并在 §5 写明「S-260 一律复用这个判据，不要换回多比 projectId 的那把」。

**⑥⑦⑧ 已核实无误**：S-258 的二次确认与 i18n key 清理、S-259 的判据收口方向、`measurePinnedMediaLine` 主重构（除①②外）—— dev 独立复核过，与我这边一致。

门禁：`typecheck` 三配置 **0 错** / `npm test` **89/89**（`pinned-turn-preview` 122 / `es-search` 149 / `everything-search` 107 / `right-panel-scope` 19）。

### 17:02 · 真机验收全部通过，一条按已知缺口放行

老大重启 dev 实例后：**dev 审查这轮没有要调整的**（静态审查收敛，第四轮反馈修完即止）；**真机验收全部通过**。

| 需求 | 真机结论 |
|---|---|
| **S-253** 文件搜索 | §4 五条 + §6.5 六条全过：三种情况各走各的、文案从现象能反推、有旧结果时顶部提示带在、冷却窗口点重试不**改口** |
| **S-255** 吸附条 | 七条全过，含 §7.7 那个徽标 gap 修正后的现场确认（根字号拉满、构造「3 图 + 2 芯片 + 溢出」⇒ `+N` 不被裁） |
| **S-259** 右侧面板 | 六条全过：B 后台跑浏览器 A 的面板纹丝不动（主要修复目标）、A 自己用照常展开（反向约束）、双会话 tab 不串；§7.5「刻意不激活 tab」经真机确认可接受 |
| **S-254** 耗时读数 | **无法覆盖**，按已知缺口放行 |

**S-254 这条得说明白**：老大定「没有那么多可执行的东西跑满一小时，暂时测不了」。这既不是通过也不是失败，是**没条件验**。已验的是亚秒不出数 / 秒档 / 分档（日常就能撞到，随其它需求顺带过了）；没验的只有 `d` / `h` 两档。判据是纯函数 `formatDurationMs`，`message-timestamp` 把 `0ms / 999ms / 1s / 59.9s / 1m / 59m59.999s / 1h / 24h / 25h` 全钉过断言，逻辑层无疑点 —— **唯一悬着的是「浏览器里每秒重渲染一个更长的字符串会不会顶掉状态栏布局」**。`d/h` 跟 `m` 同组件同插值，差别只在字符串长度，`m` 档已真机正常。所以按已知缺口放行，留作下个迭代**自然观察**项，不专门补测（补测成本 = 等 1 小时，收益不匹配）。

**这个迭代验收环节的账**（值得记一笔）：20 条需求里，S-253 从登记到通过走了 **5 轮静态审查 + 2 次真机**，而真正推翻结论的是真机那两次 —— 15:54 那次证明了「凭空推断的三种失败原因」全错（Everything 其实拉起来了，PID 31688 / 119ms / 5 条结果），17:02 这次确认三条分支互斥且文案可反推。中间五轮审查修的全是边角，**没有一轮碰到主路径**。同一迭代里 S-255 的尺子错三次、S-259 的三条候选全作废（`options.background` 早就存在）—— 都是同一类教训：**先跑起来看，再推理；先搜有没有现成的，再设计该加什么。**

⇒ 本迭代 20 条全部实施完成并验收，仅存 **1 项已知缺口（S-254 长时长档）+ 1 项挂账（S-233 抖动）**。等待老大发起收尾。


