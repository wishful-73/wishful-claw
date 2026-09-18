# v2-iter-31：S-46~S-71 二十六项需求

- 状态：**已收尾**（合并 main + tag `v0.2.31` + Release）
- 分支：`dev/v2-iter-31`（base `main` @ `f815e739`，即 v0.2.30 收尾点）
- Plan：`docs/plans/iter-v2-31/plan.md`；原始需求：`raw-requirements.md`
- 产品版本：`0.2.31`
- 日期：2026-09-18

## 范围与功能单元

### S-46 废弃入口与占位页清理（死代码）

删掉 `MainLayout` 里整块 `FEATURE_PAGES`（10 项）与 `activeNavItem !== 'chat'` 分支，外加 5 组零调用方状态/动作（skills / souls / sync / resources / codegraph）。判据是「入口可达 ∧ 功能确实没有」——`setActiveNavItem` 全仓唯一调用是 `setActiveNavItem('chat')`，那条分支永不触发。

`PlaceholderPage` **保留**（draw / git 分支仍在引用）。

### S-47 删除项目主页的渠道入口

渠道定位是**全局**的，不该有项目级入口。删 `ProjectHomePage` 的入口按钮 + `navigateToChannels`（仅此一处调用）+ `MainLayout` 的 `chatView 'channels'` 分支 + `ChatView` 类型的 `'channels'` 字面量。

### S-48 移除消息操作栏的翻译入口

翻译功能已放弃，但按钮还在且点击会 toast「已发送到翻译」再跳占位页 —— **假承诺**。删 `AssistantMessage/action-bar.tsx` 与 `UserMessage.tsx` 的菜单项、`translatePageOpen` 状态与动作、`MainLayout` 的占位分支。

翻译能力本体（translate-agent-service / translate-store）**保留**，只摘入口。

### S-49 右侧面板接入 GitPage

`GitPage` 此前是全仓零 import 的孤儿（`branch-panel.tsx` 注释都写着「mutating branches already has a home in the Git page」），断链根因就在这里。

挂进 `AgentFilesPanel`，并让它**优先读会话级 `workingFolder`**（右侧面板本来就按会话取工作目录）。面板默认宽 384px 放不下整页三栏，所以加了 `compact` 分支：宿主宽度 < 640px 时走单栏 + 点文件弹 diff 弹窗，拖宽过阈值自动切三栏。

### S-50 侧栏组合按钮改为分段控件

「新对话 / 免费对话」从两个独立按钮改成一个分段控件（两半等宽、中间分隔线、共用圆角容器），全用语义色，light / dark 自动成立。

### S-51 代码图谱核心化（`codegraph_explore` 进直连工具表）

老大定的准入判据：**插件开关为开 ∧ 该项目有代码图谱索引**。

关键设计：门控从「代理侧私有谓词」搬进 `AgentRunContextPolicy.IsToolAllowed` 的**第一道判据** —— 直连注入 / `use_capability` 代理 / 执行前准入三处共用同一谓词，一处开闸处处生效。补上了当初搁置这条时记的「重启前提」。

判据**必须在渲染端算**：`AgentRunContextPolicy.Resolve` 是测试 golden 的入口，判据进那里会让 golden 随「跑测试的机器有没有索引」而变；而且 SSH 项目的索引根路径只有渲染端能推出来。

### S-52 探索结论：tgrep 不能替代代码图谱（非需求，仅存档）

`microsoft/tgrep` 是 trigram 索引 + client/server 正则搜索，只有「候选文件筛选 + 正则验证」，**没有符号定义、没有调用关系、没有影响面分析**。它真正对标的是我们的 `Grep` 工具，不是 CodeGraph。

### S-53 子代理轮次预算失控：触顶不落盘、结束不回主会话

四层根因：① 16 个 agent 定义里 15 个写的是 `maxIterations`，而代码只读 `maxTurns` ⇒ 静默回落 12 轮；② 触顶直接退循环，没有任何收尾机会；③ 触顶事实丢失（`StopReason` 一直是 null，子代理还跳过 `EmitLoopEndAsync`）⇒ UI 一律显示 completed；④ 回主会话的链有洞。

修法（按老大口径「**上限只是提醒作用，其实是无限**」）：`DefaultMaxTurns` 改成不限；新增每轮提醒块（**只给事实、不加嘱咐**）；补上 `RecordStopReason`；后台唤醒改成「挂号 + 订阅会话空闲」，不再靠固定次数重试。

报告回传另有补漏：`sub_agent_end` 到达渲染端时，此前**只更新 UI、从不通知唤醒总线**，报告只能躺在 Worker 通知区等人手动捞。改为在 `handleSubAgentEvent` 之前挂号，且只对后台子代理挂号（前台报告本来就是父 run 的 tool result）。

唤醒消息的呈现也一并收口：不再冒充用户气泡，改走 `AgentWakeNotification` 卡片（agent 名 + 报告全文），标题口径对齐右侧面板（**任务描述优先，agent 名垫底**）。

### S-54 agent 消息时间戳显示错误（永远显示开始时间）

根因：`ChatMessage` → `UnifiedMessage` 的转换层是**白名单式重建，漏搬 `updatedAt`**。写入侧、持久化侧、读回侧全是对的，断在转换那一行。

顺带按老大要求显示「结束时间 · 耗时」（`09:20 · 8m34s`），`formatDurationMs` 补了小时档并掐掉无意义零尾（`1.0s` → `1s`、`1m0.0s` → `1m`）。

老数据（该列上线前）`updated_at` 为 NULL，属天然降级只显示时间 —— **不回填**（回填等于造假数据）。

### S-55 免费对话站点清单支持上移下移

`moveFreeChatSite` 纯函数 + 弹窗内一对箭头按钮。越界返回**原数组引用**，调用方据此跳过写盘。

三个易踩点实测都天然成立：选项卡渲染跟配置数组顺序、选中项按 id 存不串位、webview 常驻不重建所以登录态不丢。

### S-56 终端默认 shell 可配置

勘测发现 `shellExecutionEndpoint` / `customShellExecutable` 这一整套配置**早就存在**，但 UI 零引用、`resolveShellExecutable()` 零调用方 —— 是「存了不用」的死配置，不是缺字段。所以这条是**把死配置接上**。

Windows 候选链改为 PowerShell 优先（`preferred → powershell.exe → pwsh.exe → ComSpec`）；设置项并入原 ssh tab，改名「终端与SSH」。

### S-57 排队消息在 UI 上看不到内容

排队面板本来就会渲染，但每条只有一行 72 字截断摘要、且**没有 `title`** —— 所以「只知道有一条」。

改为：摘要两行（`line-clamp-2`）+ 悬停显示全文；「立即插入」从头部下放到**每条**；标题区可点折叠（默认展开）；「编辑」改「取回」（文本走 `pendingInsertText` **追加**语义、图片走新增的 `pendingInsertImages`，都不覆盖已有草稿）。

另修一个回显缺口：「立即插入」此前只往 Worker 塞消息、**渲染端队列里删掉但聊天窗和库里一个字不动**。新增 `insertUserMessageIntoRunningTurn`（插在正在流式的 assistant 消息**之前**）+ 落库。

### S-58 跨会话派发被误报为失败（实际是排队中）

三层根因：`sendMessage` 的 `false` 返回值被复用（入队也是 false）；派发侧把 `!started` 一律当失败，还撤渠道回执 + 标 `blocked`；Worker 侧把整份 JSON 信封交给 agent，agent 读到 `success:false` 判定报错。

修法：派发侧调 `sendMessage` 前记队列长度、失败后**回查队列**判断到底是不是入队；Worker 侧新增 `FormatSendSessionMessageResult`，`success:false` 才转错误，成功只交出文案。入队是同步写，无竞态。

### S-59 聊天模式（含全局会话）放开 YOLO 权限档

以前权限档被协作模式绑死：非 cowork 一律抹成 `default`，全局会话（恒 chat）永远拿不到 YOLO，每次跑 shell 都得点审批。

按老大定稿口径「**YOLO 也共享 cowork 中的默认值**」：缺省不再按协作模式分流，chat / 协作 / 全局共用一个默认来源；**渠道会话默认 YOLO**（原口径「渠道护栏保留」被推翻）。

改到四处门：UI 显隐 / 渲染派生 / 渲染端归一化 / Worker 归一化 —— 只改前三个不改第四个等于白改。再加一层数据迁移：NULL 与非法值、以及渠道会话里被系统塞的 `'default'`，都归一成 `fullAccess`。

**边界**：非渠道会话里用户**显式选过的** `'default'` 不动（那是用户的决定）。

### S-60 PowerShell 工具参数名与 schema 不符（任何调用都失败）

schema 声明 `command`，执行器却读 `script` ⇒ **参数永远取不到值**，任何调用都失败。与代理无关。

顺带把命令行改成 `-EncodedCommand`（Base64 UTF-16LE），原手拼双引号的做法遇到内容里的引号会被拆坏。

> 同类错位未修：`Monitor` 声明 `session_id`（监控已启动进程）而执行器读 `command`（执行一段命令），**语义都不一致**，等定性。

### S-61 右侧面板 git 三选项卡职责重排

变更选项卡下架，它那套更全面的 diff 弹窗搬到 git 上；git 本身的分支操作保留。分支选项卡补上 fetch / pull --rebase / push / sync 与点分支名切换。

共享弹窗外壳抽成 `GitDiffDialog`（96vw / 全屏切换 / `N / total` 计数 / ←→ 环绕翻页 / 跳外部预览 / 左侧文件列表），宽态内联与紧凑态弹窗共用同一份差异渲染。

### S-62 git 提交区上移 + 主按钮/下拉形态 + 接线真实提交

面板自上而下定为：分支区 → **提交区** → 文件列表（冲突 / 暂存的修改 / 更改）。

提交按钮改「主按钮 + 下拉」四项（提交 / 提交（修订）/ 提交并推送 / 提交并同步）。第一版按 VS Code 语义只提交已暂存内容，老大实测「输入了文字也不行」⇒ 改回**先全部暂存再提交**（与旧变更面板一致）。

顺带修掉两个假东西：「提交（修订）」菜单项此前点了和普通提交一样（后端根本不认 `--amend`），现在真正落地；AI 生成提交信息此前是空壳，现在接线。

### S-63 聊天窗图片「复制」谎报成功

整条图片复制链路**从移植进来就是死的**：`image-clipboard.ts` 三个导出全是空实现（空函数不抛错 ⇒ 调用方走 success 分支、toast「已复制」），`window.api.writeImageToClipboard` 只有类型声明、主进程没有 handler。

修法：主进程新增 `clipboard:write-image`；渲染端 blob / dataURL / SVG 三个入口统一落到 `writeBase64ImageToClipboard`，SVG 先光栅化成 PNG。

### S-64 agent 回复里的工作区文件路径渲染成可点击

`openLocalFilePath` 是个 `TODO` 空壳 —— 路径标签能渲染、能点，但没反应。

按老大裁定：**必须先校验存在性，不存在就不给点**；点击按类型分派 —— 图片走**全屏图片预览**，其它（文件 / 代码 / 文档）走**右侧预览面板**。识别逻辑一行没改，只把出口接上。

### S-65 剪贴板增强：置顶（pin）项被 maxItems 裁掉

`purgeExpired` 对置顶项本来就有豁免，缺口在**四处裸 `slice(0, maxItems)`** —— 它们不看置顶标记，置顶项沉到数组末尾就被切掉且落盘不可恢复。

统一改成 `trimToMaxItems`（置顶全保留、其余按「新的在前」取满）。

### S-66 剪贴板增强：支持图片的复制粘贴

图片落盘为文件（`clipboard-images/<sha256>.png`），历史条目存路径；轮询优先级调整（图片优先，1s 节流）；粘贴回前台窗口也支持图片；`maxItems` 裁剪后清理孤儿图片文件；面板显示缩略图。

### S-67 文档预览排版语义复位

预览面板的 markdown 渲染异常，三层叠加：`p` / `li` 挂着 `whitespace-pre-wrap`（从聊天窗照抄）⇒ HTML 源码缩进被保留；`img` 组件写死 `block`（按「正文插图」设计）⇒ 每张图独占一行；而这两个副作用是**本轮给预览加 `rehypeRaw` 才暴露出来的**。

老大裁定按 **C 方案**（不做 iframe / Shadow DOM 隔离）：视觉皮肤跟随产品，只有**排版语义**要对齐标准。落地为「收窄全局 + 容器集中复位」——两条裸写在 `@layer` 外的 `*` 通配符收进 `@layer base`，新增 `.markdown-doc` 容器做复位；聊天窗拆出不含 `rehypeRaw` 的插件列表，**回到改动前**。

### S-68 自动更新增加后台巡检

产品定位是 24 小时常驻不关机，而更新检测只在启动跑一次 —— 两者互斥。

`initializeUpdater()` 末尾启动 60 分钟定时器，每个 tick **重判三道门**（已打包 ∧ 可检查 ∧ 用户开关），一旦发现有新版就停表。后台发现的更新**静默**：只亮常驻横幅、不弹窗（弹窗只留给启动那次和手动检查），失败只记日志、不进 error 相位。

### S-69 服务商列表新增「推荐」分组

在「已启用」与「已禁用」之间插入推荐分组，只收**用户没碰过的**内置项，碰过的正常待在原分组不重复推。名单落在独立文件（产品决策不是服务商属性，上下架只动一处）。

判据实现上踩了一个坑：`isUnownedBuiltin` 名字与语义相反 —— 它对 **virtual 投影恒返回 false**，而「用户没碰过的内置项」恰恰全是 virtual 投影，两个条件互斥 ⇒ 推荐组恒为空。改为 `virtual === true || isUnownedBuiltin`。顺带把推荐项从「已禁用」分组排除（它们都是 `enabled:false`，不排会两头各出现一次）。

角标只写事实：`$10/月` / `限时免费`。

### S-70 填入 API Key 后自动启用服务商并拉取模型

以前填 Key 只写 `apiKey`，启用是完全独立的开关 ⇒ 填完仍是灰的。

触发方式取**输入框失焦**，且只在「**原先没 Key → 现在填了**」这个跃变上联动 —— 已配好的换 Key 不重复触发（否则会把用户手动关掉的模型又拉回来）。

### S-71 服务商配置面板的请求头改为可折叠

实现方式是**手写折叠**而不是用现成折叠原语：`ui/collapsible` 在 `open=false` 时把 children **整体**返回 `null`，触发器放在里面就跟着一起被藏 ⇒ 整个板块消失且无法展开。

同一根因下连做了三件：把该原语全仓两个使用点都改手写折叠（`ScmSectionHeader` 此前恰好因为触发器**忘了接 `onClick`** 才没暴露消失问题，代价是那个三角箭头是装饰品）、删掉该原语（已零引用）。

## 额外修复

- **后台子 agent 报告回传**（`523be508`）—— 见 S-53。真因是渲染端收到 `sub_agent_*` 只更新 UI、**从不通知唤醒总线**
- **服务商设置修复批**（`739c3bf7`）—— 推荐组判据修正、推荐项去重、删除坏原语、角标文案、商汤名字收短、请求头与协议块互换位置
- **CodeGraph 下线 explore 次数提示**（`0ed5b91c`）—— 工具描述与结果末尾的「最多调用 N 次」全部移除，并按提示词四关精简工具描述（303 → 283 字符）
- **opencode-go 内置模型价格与清单**（`9813f0c7`）—— 新增 3 个模型、2 个模型改价（取官方分档里的最高档）
- **opencode-go 官网地址改为推广链接**（`1faaf1b0`）—— 带邀请码
- **终端光标改细竖线**（并入 `3050e9f8`）—— 从 OpenCowork 搬来时就带的 `cursorStyle: 'block'`
- **README 补充「不花 Token 也能用」**（`011ea7d0`）—— 免费对话 / 快速启动器 / 剪贴板历史

## 验证（2026-09-18 收尾时点重跑实测）

- **TypeScript**：三配置（`tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json`）**0 错误**
- **TS 回归 30/30 exit=0**（`package.json` 中全部 `test:*` 脚本）
- **C#**：`WishfulClaw.Worker.csproj` 与 `tests/WishfulClaw.Tests.sln` 均 **0 警告 0 错误**
- **C# 回归 10/10 exit=0**：AgentTimeline / ChannelShellApproval / ChannelToolVisibility / CompactionSnapshot / Cron / Goal / MemoryRecall / ProviderHeader / SessionTaskCascade / ToolConcurrency
- **AOT**：`npm run build:worker:prod` 成功，**无 IL2026 / IL3050 / IL3051**
- **BOM**：本次触碰文件全部无 BOM

## 遗留

**待真机验收（agent 无环境）**：

1. **S-59 渠道会话默认 YOLO** —— 本地 dev 库零渠道会话造不出来，**只能真机验**：绑一个真实渠道，发一条要跑 shell 的消息，确认不再弹审批（项目 / 全局会话那三道门可直接刷新验）
2. **S-51 代码图谱** —— 有索引的项目问结构问题看 agent 是否直调；无索引项目应看不到该工具；插件关掉应立即消失
3. **S-49 / S-61 / S-62 git** —— 右侧面板拖宽过 640px 切三栏、窄时点文件走弹窗、分支右键菜单 / stage / commit / push / pull、提交下拉四项
4. **S-46~S-48 清理项** —— 项目主页「渠道」按钮、消息操作栏「翻译」项、一批零调用方占位开关应消失

**技术欠账**：

- **`Monitor` 工具参数名与 schema 语义错位** —— schema 说监控已启动进程、执行器读 `command`，需要先定语义再改
- **`window.api.fetchImageBase64` / `downloadImage` 是假声明** —— 主进程无对应 handler，调用点在 `ImagePreview.tsx` 的远程图兜底与下载
- **`docs/prompt-authoring.md:47-48` 的 vendored 说明已是假事实** —— CodeGraph 没有上游，是本仓库自己的代码，等拍板改写
- **`NavItem` 的 8 个废弃取值 + `activeNavItem` 字段本身** —— S-46 清完后恒为 `'chat'`，属该需求的延伸但不在其登记范围内
- **悬空引用** —— 删除 `automation-test-plan.md` / `smoke-test-checklist.md` 后，`docs/plans/**/plan.md`（2 处）与 `in-app-update-plan.md`（2 处）仍有引用
- **`opencode-go` 三个价格数字待核** —— Qwen3.6 Plus 输出档、Qwen3.8 Flash 缓存写比值、三个新模型的 `contextLength`（沿用同族值，截图未给）

## 提交粒度

本迭代 **26 刀**（`f815e739..HEAD`），133 files, +6334/−1306。

- **需求刀 20**：S-46 / S-47 / S-48 / S-49 / S-50 / S-51 / S-53 / S-54 / S-55 / S-56 / S-57 / S-58 / S-59 / S-53补漏+S-60 / S-61+S-62 / S-63+S-65+S-66 / S-64+S-67 / S-68 / S-69+S-70+S-71 / CodeGraph 提示下线与描述精简
- **修复刀 3**：后台子 agent 报告回传 / opencode-go 价格与清单 / opencode-go 推广链接
- **杂项刀 3**：服务商设置修复批 / 收尾流程拆出 `docs/release-workflow.md` / README 补充

命中「需求数 + 1」的口径（26 = 25 + 1）。

**合刀的原因**都是文件物理耦合、硬拆会互相夹带：S-61 与 S-62 共用 `GitPage.tsx`；S-63 / S-65 / S-66 共用 `clipboard-enhancer.ts`；S-64 与 S-67 共用 `markdown-components.tsx`；S-69 / S-70 / S-71 共用 `ProviderConfigPanel.tsx` 与两个 locale 文件。
