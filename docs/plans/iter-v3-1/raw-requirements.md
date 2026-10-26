# v3-iter-1 需求清单

> 一行一需求，正文落 `requirements/S-{NNN}.md`，本文件不贴正文。
> 迭代目标：待填（迭代启动时补 plan.md）。

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-217 | 更新安装沿用历史安装范围与安装路径 | 已实施（真机待验） | [S-217](requirements/S-217.md) · [plan-s217](plan-s217/plan.md) |
| S-218 | WorkBuddy 账号接入（A 形态 · 复用用户已有套餐额度） | 已实施（缺口 §10.3，真账号待验） | [S-218](requirements/S-218.md) · [plan-s218](plan-s218/plan.md) |
| S-219 | 文件写入工具并发冲突（同 turn 多次编辑同一文件报 SharingViolation） | 已实施（真机待验） | [S-219](requirements/S-219.md) · [plan-s219](plan-s219/plan.md) |
| S-220 | 内置浏览器手输地址 / 刷新后仍加载旧版页面（刷新按钮改硬刷新） | 已实施（真机待验） | [S-220](requirements/S-220.md) · [plan-s220](plan-s220/plan.md) |
| S-221 | 官网首页右侧悬浮联动导航（板块锚点） | 已实施（阶段六 PASS，待观感过目） | [S-221](requirements/S-221.md) · [plan-s221](plan-s221/plan.md) |
| S-222 | 聊天窗内时间统一为时分 HH:MM，跨天补日期 | 已实施（真机待验） | [S-222](requirements/S-222.md) · [plan-s222](plan-s222/plan.md) |
| S-223 | dev 实例的项目级数据目录与生产隔离（`.wishful-claw-dev`） | 已实施（阶段六 PASS，真机待验） | [S-223](requirements/S-223.md) · [plan-s223](plan-s223/plan.md) |
| S-224 | 聊天图片落盘存储（按日期分桶），DB 只存路径 | 已实施（阶段六 PARTIAL，真机待验） | [S-224](requirements/S-224.md) · [plan-s224](plan-s224/plan.md) |

## 候选池

### S-225（下迭代 v3-iter-2 承接）聊天窗时间轴渲染详细度分级（**3 档**）

> 本迭代不做，正文待 v3-iter-2 启动时落 `requirements/S-225.md`。

**原话**

- 首轮（2026-10-26）：「我们聊天窗渲染组件，需要分等级，这个是参考 OpenCode 的桌面端。1. 纯文本，只看消息，类似我们执行结束后折叠，默认执行中也折叠，只看外层总消息。2. 安静型。3. 紧凑型。4. 详情。5. 一切。」
- 订正（2026-10-26，补三张截图）：「我们不需要这么多颗粒细化。估计我们 3 档就行。」

**档数：3**（覆盖首轮的 5 档）

**OpenCode 三档原文（截图，作为口径基线）**

| OpenCode 档 | 文案 |
|---|---|
| 安静 | 对已使用的编辑和子代理进行分组。隐藏其他活动。 |
| 紧凑型 | 隐藏详细信息，将工具分组，并折叠思考内容。 |
| 详情 | 展开 shell 输出和编辑。单独显示子代理，并在已使用中对其他活动进行分组。 |

三档共用一个副标题：「选择时间轴上显示的活动量。**消息始终可见**。」
⇒ 正文永远显示，档位只控「活动 / 过程」这一层，不控消息本身。

**我们的 3 档（建议，待老大点头）**

| 档 | 名称 | 看到什么 | 来源 |
|---|---|---|---|
| 1 | 纯文本 | 只看消息。执行中与执行结束都折叠，只留外层总消息 | 老大首轮原话 |
| 2 | 紧凑（默认） | 隐藏详细信息，工具分组，折叠思考内容 | OpenCode「紧凑型」原文 |
| 3 | 详情 | 展开 shell 输出与编辑，单独显示子代理，余下活动分组 | OpenCode「详情」原文 |

**建议丢掉首轮的「安静」和「一切」**，理由：安静与紧凑边界模糊（都在「分组 + 隐藏其他」，
只差折叠思考这一条）；「一切」≈ 现在的默认行为（全展开），作为档位没有增益。
若老大要的是「安静」而非「纯文本」当第 1 档，一句话切换即可。

**档位作用域（2026-10-26 老大拍板）：全局设置。** 不是会话级，不进 DB 的会话表。

**两个入口**

1. **设置页**：主落点，3 刻度滑块 + 档位说明 + 高级区。
2. **聊天窗内快捷调整**（老大原话「可以在聊天窗找地方调整显示方式，比如放到右侧悬浮块里」）：
   两处改的是同一个全局值，聊天窗侧只是快捷通道。

**聊天窗入口落点待定 —— 实查结果（2026-10-26）**：右侧没有空槽位可用，现有的是
`components/chat/MessageList/AssistantReplyRail.tsx`（助手回复**定位导轨**：竖条 marker + 悬停预览 + 点击跳转，
`items` 为空时不渲染）。它语义是导航，不是设置，**不建议把档位开关塞进这条导轨**。候选：

- 甲：导轨外侧/上方加一个独立齿轮钮，点开是紧凑的 3 档选择器（与导轨同层，但不混语义）
- 乙：新起一个聊天窗右侧悬浮块（类似 S-221 官网那套悬浮导航的思路，但只放这一个入口）
- 丙：输入框工具条里一个图标（不进右侧）

**交互形态**（设置页，截图）：一条 3 刻度滑块，下方随档位显示一句说明，再下方「高级」区放细化开关。
截图里的高级区示例：「Changed files —— List the files each turn changed when it finishes」。

**现状（2026-10-26 实查）**：全仓**没有**任何渲染密度 / 详细度设置项 ——
`compactMode` / `density` / `timelineDetail` / `verbosity` / `showThinking` 在 `src/renderer/src` 下均 0 命中。
现有机制是分散且各自为政的：

- 执行结束统一收成「折叠块 + 正文」（S-210 / S-215 的口径），执行中默认展开
- `ToolCallCard/compact-header.tsx`（473 行）自带一套紧凑头，只作用于工具卡自身
- 思考块（thinking）独立渲染，无全局开关
- 子 Agent 卡（`SubAgentCard.tsx` 515 行）、压缩卡、文件变更卡各自决定展开态

⇒ 本需求本质是**把散落的展开/折叠策略收敛成一个可调的单一旋钮**，而不是新增一套渲染器。
工作量主要在关系统一，不在画滑块。

**待钉死（v3-iter-2 阶段一必须解决，否则无法进阶段二）**

1. 三档到底取哪三档（上表是建议：纯文本 / 紧凑 / 详情）
2. **档位 × 渲染单元开关矩阵**：思考块 / 工具卡片 / 工具输出（结构化 vs 原始）/ 子 Agent 卡 / 压缩卡 / 文件变更卡 / 正文
3. 默认档位（建议「紧凑」）
4. 「高级」区是否保留、放哪几个开关
5. **聊天窗入口取甲 / 乙 / 丙**（见上文候选），以及具体形态（齿轮钮 + 弹层，还是三段式分段控件）

**已定，不再讨论**

- 作用域：**全局设置**（2026-10-26 老大拍板）
- 入口数量：设置页 + 聊天窗快捷通道，两处同一份全局值

**落点预判**：`components/chat/AssistantMessage/content-renderer.tsx`、`ToolCallCard/*`、
`SubAgentCard.tsx`、`FileChangeCard.tsx`、压缩卡片。

**范围外**：不改执行逻辑；不动数据面与 DB（除第 3 条定为会话级外）；
不改折叠块「按事实显示收尾原因」的既有口径（S-210 / S-215）。

### S-226（下迭代 v3-iter-2 承接）官网用户反馈登记：提交 · 后台审核 · 首页展示

> 本迭代不做。老大原话已标注「可能会有点大差异」—— 确实是官网第一次引入**写操作**。

**原话**：「另外官网也登记一条。这个可能会有点大差异，也是下个迭代做，准备让官网可以登记用户的反馈需求或者 bug。然后在首页底部可以渲染出来，但是需要我在后台先审核过，以及可以标记是待办还是已做。」

**三件事**

1. **提交**：官网可提交「需求」或「Bug」
2. **审核**：默认不进公开列表，老大后台审核通过后才露出；驳回的不外露
3. **标记**：`待办` / `已做`，首页按此展示（已做打勾）

**现状（2026-10-26 实查）**

- 官网是**纯静态站**：`website/src` 全树只有两处 `fetch` —— `./downloads/latest.yml`（版本清单，`lib/site-data.ts`）
  与 `./stats.json`（统计，`lib/site-stats.ts`）。**没有任何写接口、没有后端服务、没有数据库**。
- **但服务器是自控的**：`119.45.103.252`（Ubuntu / `ubuntu`），nginx 同时供站点与 `/stats.json`
  （`alias /data/stats/summary.json`），cron 每 5 分钟跑 `/usr/local/bin/wishfulclaw-stats.sh`
  把 nginx 日志聚合到 `/data/stats/`。部署走 `scripts/deploy.mjs`（SSH + `~/.ssh/wishfulclaw_deploy`）。

⇒ 有自控服务器，**轻后端做得出来**；代价是攻击面从 0 变 1。

**方案建议（A，推荐）：服务器极小服务 + SQLite**

| 块 | 形状 |
|---|---|
| 提交 | `POST /api/feedback`，字段 `type`(`bug`\|`feature`) / `title` / `content` / `contact`(可选) / `page`(可选) |
| 公开读 | `GET /api/feedback`，**只返回 `status in (todo, done)`**；`pending` / `rejected` 永不外露 |
| 存储 | `SQLite` @ `/data/feedback/feedback.db` |
| 审核 | 本地 CLI `node scripts/feedback.mjs list\|approve\|reject\|done`，走 SSH，复用 `scripts/site-stats.mjs` 那套模式 |

**审核为什么建议先做 CLI 而不是网页后台**：不用做后台页面、不用管 admin 口令、不用给 `/admin` 加防护，
攻击面最小；老大在本地终端一条命令就能审。若要手机上随时审，再补一个口令保护的 `/admin`（第二阶段）。

**否决的替代方案**

- **GitHub Issues 当后端**：零服务器成本，但国内访问不稳、且提交要 GitHub 账号 —— 面向国内用户不可行。
- **Supabase / Cloudflare 之类**：引入外部依赖，且备案站把用户信息发到境外有合规风险。

**首页渲染落点**

- 位置：`Faq` 之后、`SiteFooter` 之前**新起一个 section**
  （现首页顺序：Hero → Advantages → ValueLadder → Features → DownloadCta → QuickStart → Faq → Footer）。
- 形态建议：`待办` / `已做` 两栏或两个标签，已做打勾；默认只显示前 N 条 + 「查看全部」。
- **空态**：一条都没有就整段不渲染 —— 与 `site-stats` 同口径（拿不到就什么都不显示，不显示 0、不报错）。

**风险（按严重度）**

1. **垃圾提交 / 刷屏**：必须做最小防刷 —— 同 IP 每小时 N 条、正文长度上限、蜜罐字段。
   没有验证码的前提下，它就是一个公开写入点。
2. **XSS**：用户内容要渲染到官网 ⇒ **一律当纯文本渲染**，绝不 `dangerouslySetInnerHTML`。
3. **合规**：站点已过 ICP + 公安备案；收集 `contact`（邮箱/微信）属个人信息，表单下要写清用途
   （「仅用于回复，不公开」），且**不强制填写**。
4. **发布清库**：`deploy site` 是整目录原子替换 ⇒ 后端服务与 DB 必须放在站点目录**之外**
   （`/data/feedback/`），否则一次发布就清库。
5. **新增运维负担**：进程守护（systemd）、日志、备份 —— 这是官网从「纯静态」变成「带服务」的长期成本。

**待钉死**

1. 审核载体：CLI（建议先做）/ 网页后台（手机可用）
2. 条目字段与展示形态：标题 + 正文 + 时间 + 状态？要不要显示提交者昵称
3. 首页默认展示几条、要不要详情页
4. 不登录就没有身份 ⇒「我的反馈」进度查询做不了，是否接受

**已定，不再讨论**

- **公开口径（2026-10-26 老大拍板）：「只要审核过的就公开」** —— 审核通过即公开，
  `待办` / `已做` 两者都展示，只有 `待审` 与 `驳回` 不外露。
  即公开集 = `status in (todo, done)`，与上文 `GET /api/feedback` 的过滤条件一致。

**范围外**：不做用户账号体系；不做站内评论 / 投票（除老大点名）；
不改现有下载链路与统计链路（S-182 那套）。

### S-227（下迭代 v3-iter-2 承接）官网「它能干什么」板块改为 banner 切换

> 本迭代不做，正文待 v3-iter-2 启动时落 `requirements/S-227.md`。

**用户原话（2026-10-26 10:12）**

> 「登记一个官网需求，这个也是放入下一个迭代。就是当前『它能干什么』板块改成 banner 方式切换，
> 而不是现在 tab —— 实际上又加了 banner 切换的方式。」

**现状（`website/src/sections/features.tsx`，已核）**

- 布局：左侧 `176px` 竖排 tab 列表（宽屏 `lg:grid-cols-[minmax(0,176px)_minmax(0,1fr)]`），
  窄屏退化为横向滚动 tab；右侧 `role="tabpanel"` 只渲染**当前一条**（描述 + 真机截图占位）。
- 面板比例 `PANEL_ASPECT = '2520 / 1608'`，与真机截图同比例，切换时不跳高。
- **三种切换方式已并存**：点击 tab、hover 切换（`HOVER_DELAY_MS = 90` 防抖）、
  自动轮播（`AUTOPLAY_MS = 3500`）。轮播三个刹车：鼠标在区块内 / 键盘焦点在区块内 /
  区块不在视口（IntersectionObserver `threshold: 0.4`）；`prefers-reduced-motion: reduce` 时不自转。
- 键盘：roving tabindex（选中项 `tabIndex=0`，其余 `-1`）+ 方向键上下/左右移动焦点。
- 历史约束（文件头注释，2026-09-23 老大原话）：①画面要占满整行（排三列细节全糊）；
  ②九条竖排会把区块撑到六千像素 ⇒ 用选项卡；③要自动轮播；④要 hover 切换且点击保留。
- 条目数：`features.items` 共 **9 条**。

**需求意图（2026-10-26 10:14 老大拍板：取 A · 替换）**

- **A · 替换（✅ 已定）**：左侧 tab 列表**整个去掉**，板块只剩 banner 切换（大图/大卡片滑动），
  tab 不再对外可见。
- **B · 并存（❌ 否决）**：tab 保留 + 另加一层 banner 轮播。
- **C · 换皮（❌ 否决）**：左列表改成 banner 式大卡片，切换方式不动。

> 否决 B / C 的理由：目标形态只保留**一种**切换 UI，不做 tab 与 banner 并存的两套。
> 因此 `features.tsx` 里的 `role="tablist" / tab / tabpanel` 语义与左侧 `176px` 栏都要一并拆掉，
> 不是在其上叠加。

**待钉死（v3-iter-2 阶段一）**

1. banner 形态细节：单张全宽大图？多张并排滑动（几列）？标题/描述做成浮层还是图下说明？
2. **3.5s 自动轮播保不保留**。hover 切换随 tab 删除**自然消失**（文案已定，不再问）。
3. 9 条内容在 banner 下怎么组织：一屏一条（9 屏太长，与「别撑到六千像素」冲突）还是分页 / 分组。
4. 指示点 / 进度条 / 左右箭头的取舍。
5. 移动端 375px 下 banner 高度与可读性（真机截图 2520×1608 缩到 375 宽后细节基本不可辨，
   可能需要在窄屏换竖屏截图或裁切）。

**风险**

1. **高度膨胀**：banner 单条全宽 + 9 条内容，比现在「单面板 + 小 tab」更容易把板块拉长，
   与 2026-09-23 那条「别撑到六千像素」的约束冲突。
2. **输入源打架**：banner 会有箭头 / 指示点 / 手势 / 自动轮播多套输入，共存时必须定优先级 ——
   手动操作要先抢过自动轮播并**重置计时**，否则用户刚点到第 5 张，3.5s 一到就被翻走。
   （原 hover 切换随 tab 删除而消失，不再是冲突源。）
3. **无障碍退化**：现有 `tablist / tab / tabpanel` 语义是完整的；改成 carousel 要换成
   `aria-roledescription="carousel"` + `aria-live` 控制，**不能只换视觉不管语义**，
   否则键盘和读屏用户拿不到当前是第几张。
4. **首屏性能**：现在只渲染当前一条的图；banner 若预载多张 2520×1608 真机图会明显拖慢首屏。
5. **与 S-221 的联动**：右侧悬浮导航锚点指向 `#features`，板块结构调整后要确认锚点仍准。

**范围外**：不改 `site.ts` 里 `features` 的条目文案（文案归 S-205 那一轨）；不改其它板块的交互；
不引入第三方轮播库（现有交互都是手写的，保持零依赖）。

### S-228（下迭代 v3-iter-2 承接）官网「回到顶部」按钮

> 本迭代不做，正文待 v3-iter-2 启动时落 `requirements/S-228.md`。官网独立轨道，零软件改动，可单独发。

**用户原话（2026-10-26 10:15）**

> 「官网还缺少一个回答顶部按钮，你看下要登记不。」

（按「回到顶部」理解。已核：官网当前**确无**回到顶部控件。）

**现状（已核代码 + 线上）**

- 全站回到顶部相关代码 **0 命中**：`website/src` 全树搜 `backToTop / back-to-top / 回到顶部 / 返回顶部 /
  scrollIntoView` 均无匹配；`scrollTo(` 只有两处（`features.tsx:56` 横滚 tab、`site-header.tsx` 只读 `scrollY`
  控制样式）。
- **线上（https://wishful-claw.work/）大屏小屏都没有回顶入口。** 线上跑的是已发布版本，
  不含 S-221 的右侧悬浮导航（S-221 在 `dev/v3-iter-1`，**尚未发布**）。
- **本地 dev 分支上有等价物，但那不是「回到顶部」**：`components/section-rail.tsx` 右侧悬浮导航第一项
  `{ id: 'top', label: '概览' }`（`site.ts` 的 `sectionRail`），点它跳 `#top` 回顶 ——
  语义是「板块锚点」，形态是竖排文字项，**不是回顶按钮**。
- 即便 S-221 发布，该悬浮栏整体 `lg`（1024px）以下**隐藏** ⇒ 窄屏 / 移动端仍然无路径。
- 平滑滚动已有全局基础：`index.css` 的 `scroll-behavior: smooth`，不需要自己写动画。

**需求意图**

补一个**明确的回到顶部入口**（按钮形态），不依赖「悬浮栏第一项」这种隐式路径。

**待钉死**

1. **大屏是否也上**。倾向 **上** —— 2026-10-26 10:18 老大指出「官网上我没看到有回到顶部」，
   说明「概览」那一项不构成回顶入口的认知。若要上，需与 `section-rail` 视觉区分，别让人以为重复。
2. **落点**：并入 `section-rail.tsx` 同一右侧栏位（文字列表下方独立按钮，不进 `sectionRail` 数组 ——
   它不是板块）；还是独立固定浮动按钮（右下角）。

**风险**

1. **右侧栏位拥挤**：`section-rail` 已有 7 项竖排，再加一项要确认 1080p 高度下不溢出。
2. **与 S-227 无关但同期改同一页**：两条官网需求都在 v3-iter-2，注意别同改 `section-rail.tsx` 冲突。
3. 阈值定太高会跟 `site-header` 的滚动态样式（`scrollY > 8`）抢视觉。

**范围外**：不改悬浮栏现有的高亮联动逻辑；不加「滚动进度条」（老大没提）。

### S-229（v3-iter-1 追加，Bug）内置 OAuth 预设投影丢协议字段 —— 授权页全空 + 登录/续期/请求头连锁失效

**用户原话（2026-10-26 10:59）**

> 「授权服务商怎么只有这么一个提示啊？workbuddy呢？国际版 国内版列出来啊，让用户自己启用授权什么的啊？」

**根因（已实查，可复现）**

`ProviderAuthPanel.tsx:169` 的收录条件是
`provider.authMode === 'oauth' && provider.oauthConfig?.flowType === 'server_poll'`，
而 `providers` 里的内置服务商是**虚拟投影**，投影函数
`stores/provider-materialization.ts:16-37` 的 `createProviderFromPreset` 只投了 14 个字段：

```
id / name / type / apiKey / baseUrl / homepage / enabled / models /
builtinId / presetVersion / createdAt / requiresApiKey / defaultModel / virtual
```

**`authMode` 与 `oauthConfig` 均未投影 ⇒ 恒为 `undefined` ⇒ 筛选条件恒假 ⇒ `targets = []`。**
页面只剩风险提示 +「暂无支持账号登录的服务商」。

预设本身完好：`stores/providers/workbuddy.ts:138`（国内版 `workbuddy` / copilot.tencent.com）、
`:158`（国际版 `workbuddy-ai` / workbuddy.ai），`flowType: 'server_poll'` 正确，均已注册进 `PRESETS`。

**同一个根因的四个面（不止「显示不出来」）**

| 断点 | 位置 | 后果 |
|---|---|---|
| 收录不到 | `ProviderAuthPanel.tsx:24` | 卡片不渲染 |
| 登录直接失败 | `workbuddy-signin.ts:204-205` 读 `provider.oauthConfig` | 抛「该服务商没有 OAuth 配置」 |
| 续期失败 | `provider-auth-accounts.ts:20-22` 读 `provider.authMode` + `resolveOAuthConfig` | token 过期即断 |
| 请求头不全 | 投影同样漏 `userAgent` / `requestOverrides` | `workbuddy.ts:149` 注释「缺它报 10085」；`X-IDE-Type` 等头缺失 |

**为什么一直没爆**：R-9（`7cb22530`，2026-09-13 迭代 28）引入虚拟投影时漏的。老 OAuth 服务商
（codex / copilot / moonshot）多有 R-9 之前落盘的完整记录，`reconcileProviders:140` 对已物化记录
原样保留；WorkBuddy 是 10-25 才加的，**从未落盘**，每次启动都是新投影 ⇒ 必踩。
这也解释了 S-218 为何一直 blocked 在「需真账号实测」—— 真测必撞。

**需求意图**

1. 投影补齐协议字段：`authMode` / `oauthConfig`（浅拷贝）/ `userAgent` / `requestOverrides` / `ui`
2. 已物化记录**只补缺失、不覆盖**（`existing.authMode === undefined` 才补），不碰用户改过的配置
3. **收录范围放宽到所有 `authMode === 'oauth'`**（老大要「WorkBuddy 和 Qoder 这些也列出来」，
   页面语义就是「账号授权」统一入口；现只筛 `server_poll` 太窄）。放宽后多出
   `copilot-oauth` / `moonshot`（`flowType: device_code`）与 `codex-oauth`
4. 卡片副标题标注**国内版 / 国际版**（老大 2026-10-26 11:04：按推荐的来 = 名字不动、副标题标注）

**风险**

1. 放宽收录后 codex / copilot / moonshot 与「服务商」页既有 OAuth 入口**重复**，
   需确认不出现「两处都能连、状态不同步」。
2. 补 `oauthConfig` 时若直接共享 preset 引用，运行时改一处会污染全站 —— 必须浅拷贝。
3. 已物化记录补字段不能覆盖用户改过的值，否则等于静默重置配置。

**范围外**：不改设备码 / 授权码流程本身；不改签到逻辑；不动 `providers/index.ts` 的预设清单。

### S-230（v3-iter-1 追加，新接入）Qoder 账号接入

**用户原话（2026-10-26 11:04）**

> 「还有 WorkBuddy 和 Qoder 这些也列出来」

**现状**：`src` 全树搜 `qoder`（忽略大小写）**0 命中** —— 从未接入，不是「有但没列出来」。

**待钉死（缺契约，无法开工）**

1. **接口契约来源**：WorkBuddy 的契约来自 `astragate-community/astra-gate-plugins → packages/workbuddy/`，
   但 `D:\claw` 下**无该仓库副本**。Qoder 需要同级别的参考实现或抓包结论。
2. 登录流程类型（server_poll / device_code / authorize 跳转）
3. 模型清单与计费口径
4. 是否需要 UA / 自定义头白名单

**范围外**：未拿到契约前不写任何请求代码。

### S-231（v3-iter-1 追加，Bug）运行时附加块改后置 —— 修 WorkBuddy 会话标题被 `<current_time>` 污染

**用户原话（2026-10-26 14:24→14:44）**

> 「我现在看到 workbuddy 那边的标题是这个 不太符合他们的请求，而且我们在上下文里面塞了人格。。我不知道会不会有问题」

> 「这个是我们消息里面的，它应该是拿的首条消息作为的标题」

> 「人格注入应该是没有问题的，workbuddy 有专家团」

> 「`<current_time>` 这个标签是消息的话 它肯定读取的是首条 user」

> 「A 这个需要登记需求」

**根因（已实查）**

用户消息的运行时附加块是**前置**的，两层叠加：

| 顺序 | 位置 | 动作 |
|---|---|---|
| 1 | `AgentLoop.cs:259` 每轮调 `InjectTransientPrefix` | 拼 `<memory-recall>` / `<memory-update>` / `<current_time>` |
| 2 | `AgentLoop.Helpers.cs:351-360` | `Text = parts + msg.Text` —— 前置 |
| 3 | `AgentLoop.cs:357-360` → `MemoryRecall.cs:112-116` | `Text = recallBlock + Text` —— 再前置 |

出站原样写：`OpenAIChatRequestBuilder.cs:159`（OpenAI）/ `AnthropicMessagesInputWriter.cs:125-129`（Anthropic）都直接写 `message.Text`。
⇒ 任何「取首条 user 消息做会话标题」的服务端（WorkBuddy 国内版/国际版）截到的开头就是 `<current_time>\n2026-10-26 …`。

**判据全部位置无关**：`Contains` 守卫（`Helpers.cs:317`）、`StripInjectedBlocks`（`MemoryRecall.cs:167-190`）、
`OriginalText`（S-208）、压缩快照（`UserSnapshot.cs:61`）、前缀缓存 —— 均不依赖块在头还是尾。

**我们自己的标题链路不受影响**：`renderer` 全树无「首条消息起标题」实现，会话标题来自平台 chatName / senderName
（`auto-reply.ts:199-201`、`DbPluginSessionRouting.cs:66`）。缺陷只体现在第三方服务端。

**需求意图（方案 A，已裁定）**

1. `Helpers.cs:351-360` 改后置：`Text = 原话 + "\n\n" + parts`；空文本不加前导分隔
2. `MemoryRecall.cs:112-116` 改追加到尾部（`iteration == 1` 才注入，天然落在最后）
3. 五处注释订正（`Helpers.cs:313-316` / `MemoryRecall.cs:41-47,109-110,164-166` / `ConversationModels.cs:19-24` /
   `OpenAIChatRequestBuilder.cs:143-148` / `AnthropicMessagesInputWriter.cs:125-128`）
4. 存量历史消息**不迁移**：两套形状并存，消费方都按标签剥、不按位置读

**风险**

1. **唯一非确定性风险**：尾部块会改变模型对时间/召回的注意力 —— 阶段六要真机验证「现在几点」类问题仍答得准。
2. 纯图片消息 `Text` 为空 ⇒ 拼接必须判空，否则请求体以 `\n\n` 开头。
3. 渲染端露出标签 —— 全树 grep `current_time` 0 命中，历史从未显示过，阶段一实施前再确认一次落库字段来源。

**范围外**：人格 / system prompt 一律不动（14:42 已裁定「workbuddy 有专家团」）；不改 WorkBuddy 标题字段（出站本无此字段，不编造）；
不迁移存量消息；不动我们自己会话标题策略。

