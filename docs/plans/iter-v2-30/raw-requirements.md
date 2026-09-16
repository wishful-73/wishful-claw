# iter-v2-30 原始需求登记

> 2026-09-16 建档。老大定调「**30 迭代主要是 spill + 清尾巴**」+ 一项额外需求（免费对话页）。
> 本文件为权威需求文档。
> **已立项 7 项**：S-26 spill（30 主打）／S-27 免费对话页／S-28 大图预览／S-29 后台任务执行记录／S-30 渠道 shell 文本审批／S-31 思考流式跳动仍存在／S-32 回复结束折叠致聊天窗跳动。
> （S-27 / S-30 为老大口述；S-28 / S-29 来自知识库；S-31 / S-32 为老大 2026-09-16 真机反馈。）
> 「清尾巴」的其余候选（29 收尾待议 4 项、《正式版发布规划》）**尚未点名**，见文末「待登记」，不擅自排入。
> 勘测行号均为 2026-09-16 实读。**S-26 我们侧代码零勘测**（仅勘测了上游参考），接手时从零核实。

## S-26 工具输出落盘（spill）

**一句话**：工具输出过大时不整段进上下文，落盘为会话作用域私有文件，模型只看「有界首尾预览 + 定位符 + 检索提示」，要细节时用 `Read`/`Grep` 取回。

### 背景

知识库 `issues/改进.md` 2026-09-14 待优化项（原文摘要）——浏览器取网页正文、命令执行日志、大文件读取，动辄几万到几十万字节，后果：① 单轮请求直接爆预算 ② 后续每一轮都背着它 ③ 触发压缩、多花一次摘要钱。知识库自评「**这是 agent 产品的生死线**」。

老大 2026-09-16 定调：30 主打本项，并指示拉取上游参考 —— `D:\claw\deepseek-harness`（已于 2026-09-16 clone，commit `0d1f50007f`，见记忆「deepseek-harness 参考仓库已拉取」）。

### 参考蓝本（**参考侧已勘测**，2026-09-16）

- `docs/subsystems/spill.zh.md` —— 中文设计文档，seam 语义全在里面
- `packages/spill/spill/` —— 抽象 seam：唯一方法 `saveText(input) → SpillRef{ locator, bytes, retrievalHint }`
- `packages/spill/spill-local/` —— 本地实现（`store.ts` / `cleanup.ts`）
- `packages/spill/spill-policy/` —— 策略（`notice.ts`，超 `maxInlineBytes` 换首尾预览）
- `packages/util/output-retention/` —— 保留库（首尾预览生成）

**照抄要点**：

| 点 | 参考做法 |
|---|---|
| 落盘路径 | `<root>/session-<sha256(sessionId)>/<random>-<safeName>` |
| 安全 | root 私有 0700；`open(path,'wx',0o600)` 独占 —— 防预埋符号链接重定向 |
| locator | **对消费方不透明**，一律靠 `retrievalHint` 渲染，不许 parse |
| 策略失败姿态 | **尽力而为**：存盘失败保留原内联结果，绝不把成功调用变成 `isError` |
| seam 边界 | 只管存储；保留策略、结果替换、检索 API 都归消费方 |

### 三条硬不变式（知识库原有登记，必须遵守）

1. **替换内容永不超上限** —— 先给通知预留字节；通知都放不下就退回原文
2. **失败退回原状** —— 绝不把成功调用变成 `isError`，绝不隐藏内联结果
3. **跳过 `read`** —— 防 `read → spill → read` 死循环

### 我们侧现状（**未勘测**）

- **头号待确认（知识库原登记就挂着）**：核心侧工具结果在进会话消息前，**有没有一个统一出口** —— 这是能否一次覆盖全部工具的前提。**接手第一件事就查这个**，查不到就得逐个工具改，方案规模完全不同。
- 知识库已排除的路径：Custom Extension V1 的 manifest 只有 `tools` 数组，无既有工具结果的后置钩子；JS 沙箱不支持 filesystem（文档明列 Not available），而 spill 必须写文件 ⇒ **落地形态是核心改动，不是扩展**。

### 待定口径

- `maxInlineBytes` 默认值与是否暴露设置项
- 取回提示的措辞（`Read`(offset/limit) / `Grep` 怎么给）
- 会话删除时 spill 文件的清理策略（参考侧 seam **不定义**逐会话清理，只提「保留期清理可连同其他旧会话产物一起使旧定位符失效」）

---

## S-27 免费对话页（组合按钮 + 内置浏览器固定站点）

**一句话**：左侧栏「新对话」改为组合按钮——**左段新对话 / 右段免费对话**；右段打开一个新页面，页面内用内置浏览器固定访问若干「网页版免费对话」站点（DeepSeek 网页版等），**登录由用户自己完成**，我们只提供浏览器。

### 背景

老大 2026-09-16 口述（原话）：「目前我们软件面板左侧有个新对话，我想把这个新对话改成一个组合按钮，左边按钮是新对话，右侧按钮是免费对话。然后新做一个页面，里面是接入当前网页版本的 DeepSeek 以及其它支持不收费的网页版本对话，我们有内置浏览器，在新页面里面就直接用这个浏览器。有点类似 skill 市场中对浏览器的使用。」
老大同日澄清：「**登录是用户自己去登录，我们只是提供一个浏览器去固定访问**。」

溯源：知识库 `正式版发布规划.md`「快捷搜索扩展整合」已有「在线聊天直接接入 DeepSeek 网页版，省模型调用费」；v3-规划 Phase 2「URL 型插件」同向。

### 现状勘测（2026-09-16 实读）

**入口**

- 「新对话」= `WorkspaceSidebar.tsx:184-199` 的 `navItems[0]`，由 `renderNavItem()`（`workspace-sidebar-nav.tsx:57`）渲染成整宽单按钮
- 组件签名 `NavButtonItem { key, label, icon, active, onClick }` —— **无分段概念，组合按钮需新写组件**
- 点击行为 `handleNewChat()`（`WorkspaceSidebar.tsx:151-158`）：只导航到 home，**不建会话**（会话在真正发消息时才建）

**页面机制**

- 状态：`ui-store.ts` 一组互斥布尔（`drawPageOpen` / `tasksPageOpen` / `taskBoardPageOpen` / `skillsPageOpen` / …）；`open*Page()` 各自把其他页面置 false（**手写互斥**）
- 分发：`MainLayout.tsx:70-113` `ContentArea()` 按优先级 if 链 return 具体页面
- 连带：`TitleBar.tsx:36-50` 的 `isSessionPage` 判定逐个列了这些布尔 —— 新页面须同步（否则标题栏误判）
- 新页面预计触碰：`ui-store.ts` / `ui-store-interface.ts` / `MainLayout.tsx` / `TitleBar.tsx` / `WorkspaceSidebar.tsx`

**内置浏览器（可复用）**

- `BrowserPanel.tsx`，props 仅 `{ sessionId, projectId }`
- `partition: persist:wishfulclaw-browser`（`shared/browser-plugin.ts:8`）—— **持久分区，登录态跨重启保留**
- `allowpopups: true`（第三方登录弹窗可开）；UA 可 `stripElectronFromUserAgent`；`browserUserDataReuseEnabled` 设置可复用系统浏览器数据
- 页面状态按 `browserStatesBySession[sessionId]` **隔离**
- 访问管控 `getBrowserAccessDecision`（`lib/app-plugin/browser-access.ts:80`）：**默认全放行**，仅当项目配了 `browserAllowedDomains` / `browserBlockedDomains` 才限制

**现成模板（老大点名的「skill 市场的用法」）**

`components/settings/skill-panel.tsx`：

```tsx
const SKILL_MARKET_SESSION_ID = 'skill-market'                       // :23 独立 sessionId
const browserUrl = useUIStore((s) => s.getBrowserState(SKILL_MARKET_SESSION_ID, null).url)  // :45
<BrowserPanel sessionId={SKILL_MARKET_SESSION_ID} projectId={null} />                       // :202
```

两个 tab 都挂载、用 CSS `hidden` 切换以保住 webview 状态（`:178-204`）—— 站点切换可照此办理。

**不可复用的**：`lib/app-plugin/` 是**给 agent 用的能力插件**（BrowserNavigate/Click/Type 等工具），不是 UI 入口；v3 规划的「URL 型插件」**尚未实现**。⇒ 本页无现成体系可搭，照 `SkillPanel` 模板自建。

### 待定口径（**待老大拍板**）

1. **站点清单** —— DeepSeek 之外接哪些（老大说「其它支持不收费的网页版本对话」，需点名，不猜）
2. **地址栏保不保留** —— 「固定访问」理解为隐藏地址栏只留站点条；保留则可作逃生口（跳登录页等）
3. **登录态分区** —— 与内置浏览器**共用** `persist:wishfulclaw-browser`（别处登过即登录态）还是**独立**一份
4. **站点切换时页面状态** —— 单实例改 URL（省内存，切走即重载）vs 每站点一实例 CSS 隐藏（切换瞬时、状态保留，站点多则内存涨）
5. **是否同时进搜索面板** —— 现有 Draw/Automation/TaskBoard 在 `search-dialog.tsx:551/559/567` 均有入口；不加则范围最小

---

## S-28 聊天窗大图预览超出弹窗边界

**一句话**：发送大尺寸图片后，在聊天窗点击缩略图预览，图片渲染尺寸超出预览弹窗边界，看不全。

### 背景

知识库 `issues/bugs.md` 2026-09-14 条目（原文）：「发送尺寸过大的图片后，在聊天窗点击预览，图片渲染尺寸超出预览弹窗边界，无法完整查看」；复现：发送一张大尺寸图片 → 聊天窗点击预览 → 图片比弹窗还大，看不全。原登记备注「疑似预览未按弹窗容器做等比缩放约束（**未查源码，待确认**）」。

### 现状勘测（2026-09-16 实读，**已定位到具体代码**）

**触发链**（用户消息的图片）：

- 缩略图：`components/chat/user-message-views.tsx:287-295` —— `max-h-[180px] max-w-[240px] object-contain`，点击 `onPreview(image.dataUrl)`（`:283`，键盘同 `:263`）
- 宿主：`components/chat/UserMessage.tsx:370` `onPreview={setPreviewImageSrc}`，弹窗在 `:376-423`
- 弹窗：shadcn `Dialog` + `DialogContent`（`:382`）`max-h-[90vh] !w-fit !max-w-[min(96vw,1100px)] overflow-hidden p-2`
- 图片（`:415-419`）：`block h-auto max-h-[calc(90vh-1rem)] w-auto max-w-[min(92vw,1068px)] rounded object-contain`

**关键实证**：上述两处约束由 `d6228b27`「全量移植 OpenCowork 聊天渲染系统」引入，`git log -S 'max-h-[min(92vw,1068px)]'` / `-S 'min(96vw,1100px)'` 均只命中该提交 —— 即**从未因本 bug 调整过**，不存在"已修"。

**别改错的另一套**：AI 回复里的图片走 `components/chat/ImagePreview.tsx:320-400`（`fixed inset-0` 全屏 + `h-full w-full object-contain`），与用户图片预览是**两套独立实现**，约束看起来正确。本项只动用户消息那条链。

**待实测的疑点（两条候选，按可能性排序）**：

1. **容器裁切**：`DialogContent` 是 `max-h-[90vh] + overflow-hidden`，图片是 `max-h-[calc(90vh-1rem)]`，两者只差 `p-2` 的 1rem —— 边界几乎贴死。图片若把容器顶满，超出的 1rem 内的部分会被 `overflow-hidden` 裁掉，表现即「看不全」。
2. **约束没落到图片上**：`:382` 用 `!w-fit` + `!max-w-[…]` 覆盖 shadcn `DialogContent` 默认的 `w-full max-w-lg`，覆盖后若 `w-fit` 的收缩行为与图片固有尺寸计算打架，`max-w` 可能失效。

**确认方法**：真机复现大图 → DevTools 量 `DialogContent` 与 `img` 的 `clientWidth/scrollWidth/clientHeight/scrollHeight`，看是裁切还是没约束。**取证后再改，别照着候选瞎修。**

### 待定口径

- 修法方向（尺寸约束补齐 vs 改 `overflow` 策略 vs 换全屏预览组件）—— 取证后定
- AI 回复图片那套（`ImagePreview.tsx`）要不要顺带统一口径？**倾向不动**，除非实测同样有问题

---

## S-29 后台任务执行记录（记忆整理等）

**一句话**：记忆整理这类后台任务已配置定时执行，但**没有任何执行记录**，用户无法判断「到底执行了没有、结果如何」。

### 背景

知识库 `issues/改进.md` 2026-09-14 条目（原文要点）：根因是**不可观测**，不是没效果 —— 没有记录时，「处理了」和「完全没跑」在用户视角里无法区分。最小执行记录：每次执行留痕（时间 / 触发来源 / 处理条数 / 写入目标 / 成功或失败）。

**知识库明确划的边界（勿合并）**：与本迭代 S-25「Agent 工作时间线」**不是一回事** —— 时间线记的是 agent 为用户做的**业务工作**（受众=用户，用途=盘点回溯）；本条记的是 agent 维护自身的**内部任务执行**（用途=诊断确认健康）。混进业务时间线即噪音。知识库建议归为「系统/后台任务执行记录」一类（记忆整理、索引重建、自动备份等同属此类）。

### 现状勘测（2026-09-16，**部分**）

- 记忆整理管线：`lib/agent/memory-automation*.ts`（`-utils` / `-internal`）；调度与投递路径**未勘测**
- 知识库提示的三个待确认点（接手时逐条核）：
  1. **触发源到底是什么** —— 是 cron 定时任务（可指定 `agentId` + `deliveryMode=session` 投递）还是内置调度。**先查清这个，否则记录没地方挂**
  2. 记忆整理任务是否使用了投递、投递到哪个会话
  3. 参考 `参考-deepseek-harness工具深挖.md` 附节：后台任务执行记录宜含状态机（running / completed / failed / killed）+ 有界输出

### 待定口径

- 记录落在哪（新表 / 复用现有日志 / 面板呈现位置）
- 是否只做记忆整理，还是同时覆盖索引重建、自动备份等同类后台任务（**知识库倾向后者**，但要老大拍）

---

## S-30 渠道会话的 shell 审批走文本消息

**一句话**：渠道会话（微信/飞书）里 Agent 要执行 shell 类工具时，用户不在桌面 UI 前、看不见审批弹窗，改**用渠道文本消息向用户征询**，用户**回文本**即完成审批；渠道配置中若已设为**无条件放行**则不走此流程。

### 背景

溯源：iter-29 收尾挂的「下版本待议」第 ① 条 —— 默认 `shellRequiresApproval = true` 下，渠道会话执行 shell 会**卡在一个用户看不见的审批上，一直挂到 run 被取消**（当时无人报，因为还没人在渠道里让它跑过 shell）。

老大 2026-09-16 口述（原话）：「**shell 审批，在渠道对话中，并且在渠道配置中没有无条件放行的，需要文本方式审批**」。

### 现状勘测（2026-09-16 实读）

**审批门**：`ToolCallProcessor.Approval.cs:60-97` `RequiresApprovalBeforeExecution`

- `:75-78` 渠道会话**只豁免了文件/图片工具**（`IsChannelFileTool`，`:119-122` 列了 6 个 `*SendImage` / `*SendFile`），注释原文 *"Channel sessions cannot complete a remote approval dialog"*
- `:82-85` shell 类走 `IsChannelShellApprovalWaived`（`:103-105`）= `渠道会话 ∧ ShellApprovalTools ∧ !ShellRequiresApproval`；`ShellApprovalTools`（`:35-38`）= `Bash` / `Shell` / `ShellExec` / `PowerShell`
- ⇒ **默认 `true` 时渠道 shell 会要求审批，但没有表达出口**

**审批事件流（桌面路径）**：

- Worker → 渲染端：`shared/agent-stream-protocol.ts:117` `{ type: 'tool_call_approval_needed', toolCall }`；工具态含 `'pending_approval'`（`:51`）
- 渲染端 → Worker：`lib/agent-runtime-sync.ts:47` `{ kind: 'resolve_approval', toolCallId, approved }`
- ⇒ **卡点就在这里**：渠道会话发起了 run，但**没有渲染端在消费这个事件**，事件发出去没人答 ⇒ 挂死

**既有相关能力（可复用，勿重造）**：

- `shared/permission-policy.ts` —— bash deny/allow 规则 + 工具白名单，优先级：bash deny > 白名单/allow 规则 > 正常审批流（`:12`）；已支持「总是允许」类的通配规则（`:295` 的 wildcard 建议，供审批弹窗快捷添加）
- 渠道侧已有向用户发文本的能力（`ChannelSendMessage` 一族），且 `plugin-command-handlers.ts:339` 的 `/status` 已能打印 `shellRequiresApproval` 当前态

### 待定口径（**待老大拍板**）

1. **回复词表** —— 用户回什么算「同意」（「同意」/「ok」/「y」/「1」？），回什么算拒绝，不匹配时怎么办
2. **超时策略** —— 挂多久算默认拒绝（还是无限等？），超时后 agent 怎么继续
3. **「总是允许」要不要支持** —— 支持的话落在哪（permission-policy 的 allow 规则？）
4. **多审批并发** —— 一轮里多个 shell 调用同时待批，怎么排队 / 怎么让用户指认「批的是哪一个」
5. **拒绝后的话术** —— 拒绝结果怎么回给模型（让它是继续换个法子，还是直接终止）
6. **开关归属** —— 「无条件放行」就复用现有 `shellRequiresApproval`，还是另加开关（**倾向复用**，29 需求 28 刚把它收敛成全局 2 键之一）

---

## S-31 思考流式跳动问题仍存在（T-8 未闭环）

**一句话**：iter-29 处理过的「思考模式跳动」，老大 2026-09-16 真机反馈**仍然存在**。

### 背景

老大 2026-09-16 口述（原话）：「29迭代处理的思考模式跳动问题还是存在」。

**T-8 的历史（iter-29）**：

| 步骤 | 内容 | 结果 |
|---|---|---|
| 第一版 `d2d91864` | `CollapsibleHeightPanel enabled={!isThinking}` | **废弃回退** —— 日志显示 `clientHeight` 没抖，假设被数据否掉 |
| 真因定位 `6a500cdb` | 内层滚动容器缺 `overflow-anchor: none`，浏览器滚动锚定与手动贴底对打 | 老大真机确认「这次抖动就很少了」 |
| 残留收口 `d50d0702` | 两行缓冲 + `useLayoutEffect` | 老大确认「确实不上下跳了」 |

**当前代码仍在**（2026-09-16 实读）：

- `ThinkingBlock.tsx:166` `style={{ overflowAnchor: 'none' }}` —— 在
- `ThinkingBlock.tsx:34` `THINKING_SCROLL_BUFFER_PX = 48`（两行缓冲）—— 在

> ⚠️ **结论修正（2026-09-16 老大定性）**：不是「修了没断根」，而是**两行缓冲这一段的实现本身就是理解错误**。
>
> 老大原话：「那这个就是**理解没对**」。
>
> 现场：`ThinkingBlock.tsx:92-94` 写的是 `if (maxTop - scrollTop >= THINKING_SCROLL_BUFFER_PX) scrollTop = maxTop` —— **距底不足 48px 就不滚、攒够才滚一次**。这恰恰是老大否定的「台阶化」：把「连续跟随」做成「攒够再跳」，单次阶跃反而更大。
>
> ⇒ **门槛式判定要拆掉（不是保留）**。

**★ 老大 2026-09-16 补充澄清 —— T-8 的方向写反了（本意）**：

> 原话：「我的意思本意是留 48px **提前滚动**了，这样新输入的内容在这 48px 里面就会被作为缓冲，**滚动条不用再滚**。之前的方案不是给我添乱么，**攒着不滚** 我去……」

- 老大要的是 **恒定预留 48px + 滚动提前**：滚动条维持在「内容底 − 48px」，新内容落进这 48px 缓冲里。**缓冲是「欠着」的（恒有），不是「攒着」的。**
- T-8 写成了 **下限阈值 + 攒够才滚** —— **耗掉缓冲**。一个保缓冲、一个耗缓冲，**方向完全相反**。
- ⇒ 正确写法（每帧执行，无门槛）：
  ```js
  el.scrollTop = Math.max(0, maxTop - THINKING_SCROLL_BUFFER_PX)
  ```
  缓冲恒 48px 不波动，滚动量 = 每帧内容增量，天然连续。**无门槛、无攒批、无台阶。**
- ⇒ 这条**不需要真机取证**：不是「难以复现的抖动」，是**逻辑写反了**，读代码即可判定。
>
> ⚠️ 由此推翻我 2026-09-16 的一句错误表述：我曾把「滚动条不贴底」说成「T-8 的设计预期行为」——**错**。那是设计本身写错了，必须修。

**iter-29 自己记的已知残留**（`docs/progress/v2-iter-29.md` T-8 条）：「内容刚跨 `max-h-80` 的头几帧仍可能 `after=0`（疑似首帧时序），可选 `useLayoutEffect`」—— **需确认老大这次看到的就是这个残留，还是新的触发场景**。

### 待补 / 待定口径

1. **老大补复现细节**：在哪个阶段跳（刚开思考 / 跨 `max-h-80` 时 / 全程）、幅度、频率
2. **取证先行**（重要教训）：T-8 第一版就是因为**没取证先改**，被老大两条观察拽回两个错误方向，最后**废弃回退**。本次必须先量数据（`scrollTop` / `scrollHeight` / `clientHeight` 前后值）再定修法
3. 与 S-32 同源 —— **2026-09-16 已确认**，且**思考流式输出也是同一个问题**（老大原话：「思考流式输出也是这个问题」）

### 统一根因复核（2026-09-16，覆盖 S-31 / S-32 / 思考流式）

**需求来龙去脉（老大 2026-09-16 完整叙述 —— 定调，据此判断成败）**：

> 原话：「本来正常情况下就是**一直往下贴底**，只是有**组件执行中展开、执行后收起**，会导致有**上下跳**。现在加**留白和只增不减**的目的是**做缓冲**，结果实现最后**差强人意**」

| # | 环节 | 内容 |
|---|---|---|
| 1 | **原始状态** | 一直往下贴底 —— **这本身是正常、可接受的** |
| 2 | **问题** | 组件**执行中展开 / 执行后收起** ⇒ 高度变化 ⇒ **上下跳** |
| 3 | **设计思路**（R-10.2） | 加**留白** + **只增不减** ⇒ 做**缓冲**，吸收高度变化的抖动 |
| 4 | **结果** | **差强人意** |

⇒ **设计意图正确，R-10.2 方向没错，差在实现层**。五轮修正后积累了新的抖动源（水位线收回时序错位 / `isSessionOutputting` 闪变 / 内层台阶过小 / 大阶跃无平滑）。**修法应是「修正 + 简化」，不是「再加一层」。**

**老大澄清的口径（关键，纠正了我此前的误判）**：

- 「偶尔留白过多」——**可接受**，不必治
- **不可接受的是**：「有时候**完全没有留白**，导致内容一直往下跳」
- 初衷（原话）：「组件会运行时展开、运行结束后收起，导致页面会抖动，所以想只增不减，这样避免上下跳。**以前虽然跳但是看起来是正常的。现在是有点不正常了**」
- 我此前的「水位线累积成死留白」假说 —— **被老大否掉**（「死留白问题反而我没发现，基本都是能收掉的」）

**根因 = 三个「阶跃」叠加，缺一不可**：

| # | 层 | 机制 | 证据 |
|---|---|---|---|
| ① | **上游渲染池** | `getCatchupStep = max(1, ceil(poolSize / catchupFrames))`，agile `K=2` ⇒ **首帧吞掉 backlog 的一半**。provider 一个 burst 来 2000 字符，第一帧就渲染 1000 字符（几百 px） | `hooks/use-typewriter.ts:25-34, 56-59` |
| ② | **内层（思考区）** | 「攒够 48px 才滚一次」：`if (maxTop - scrollTop >= THINKING_SCROLL_BUFFER_PX) scrollTop = maxTop` ⇒ 台阶式；**滚完落后归 0 = 零留白** | `ThinkingBlock.tsx:85-95`（T-8 加的） |
| ③ | **外层（聊天窗）** | `isSessionOutputting` 闪变 false（文本段结束、工具尚未出结果的间隙）⇒ **水位线立即收回** `contentHeightWatermarkRef = 0` + `autoScrollMode = 'off'` ⇒ GAP 姿态消失，退回 `bottom = scrollHeight - clientHeight`（**贴死底、零留白**） | `useMessageListScroll.ts:570-581, 548-549, 156`；`useMessageListData.ts:174` |

**❗ 回跳的确切机制（2026-09-16 老大补充 —— 这是最难受的一点）**：

> 原话：「明明都搞了缓冲了，**一直往下贴底也是能接受的**，偏偏现在效果是会有**回跳**，这个就让人特别难受」

- **回跳 = scrollTop 反向（变小）移动**。老大的容忍边界很清楚：**单向往下贴底可以接受，双向来回不行**。
- **主因 —— 水位线收回那一帧的时序错位**（`useMessageListScroll.ts:570-590`）：
  1. `isSessionOutputting` 翻 false ⇒ `contentHeightWatermarkRef.current = 0`（**ref 立即清零**）+ `setMinContentHeight(0)`（**DOM 要等 re-render**）
  2. 紧接着的 `scrollToBottomImmediate()` 因 ref 已清零，**判定为「非水位线」分支** ⇒ `bottom = ref.scrollHeight - ref.clientHeight`，而此刻 **DOM 的 `min-height` 尚未撤掉** ⇒ `scrollHeight` 仍是**含水位线的大值** ⇒ scrollTop 被**强推到底（向下跳）**
  3. 下一帧 `min-height` 真正撤掉 ⇒ `scrollHeight` 变小 ⇒ 浏览器 **clamp** scrollTop ⇒ **向上弹回**
  - ⇒ **一推一弹 = 回跳**。且恰好发生在「留白被收掉」的同一瞬间，与老大「留白全收了然后滚动条还往下跳」的观察完全吻合。
- **次因 —— 悬空救援分支主动回缩**（`:164-168`）：`scrollTop > realBottom + 1` 时**无条件** `scrollTop = target`。而 `getRealContentBottom()` 只遍历**已渲染的虚拟行**（`content.children`），虚拟器未渲染 / 卸载行时 `realBottom` 会偏小 ⇒ 无条件回缩到更小的 scrollTop ⇒ **回跳**。
- **修法原则（直接由老大的容忍边界推出）：`scrollTop` 保持单调不减**（除非用户手动滚动）。具体：
  1. 水位线收回时**不主动调** `scrollToBottomImmediate`（等 DOM 撤完 `min-height` 再决定）；
  2. 悬空救援改为**只推不拽**，或在 virtualizer 未渲染完（`realBottom` 可疑）时跳过；
  3. 全面贯彻文件内既有的「只推不拽」写法（`:175-178`）。

**为什么「上游越快越跳」**：① 的首帧步长与 backlog 成正比 ⇒ 上游 burst 越大，单帧高度增量越大。

**为什么「以前正常、现在不正常」**：R-10.2 之前姿态**单一**（一致地每帧贴底），虽是连续微动但**跳法均匀**；引入水位线 + 两行缓冲后，姿态在「有留白 / 零留白」之间**反复切换**，跳法不再一致 —— 观感上就「不正常」了。

**要害判断**：老大的直觉（下方留白当缓冲）**方向是对的**，但当前实现把「连续跟随」做成了「**攒够再跳**」—— 把连续位移攒成离散台阶，**台阶越大越像跳**。留白必须**恒定存在 + 连续跟随**，而不是「攒到阈值跳一次」。

**2026-09-16 老大定性印证 —— 主因坐实为 ①**：

> 原话：「内容越多的时候问题越严重，就是输出文本超级多的时候，本来是预留了两行用于缓冲，结果感觉**缓存没起效果一样**」

- **机制**：`use-typewriter.ts:109-122` 每帧（32ms）渲染 `getCatchupStep(poolSize) = ceil(poolSize / K)` 字符。稳态下每帧渲染量 ≈ 上游速率 R，而 poolSize ≈ K·R。**R 随内容量 / 上游速度增长 ⇒ 每帧高度增量 ∝ R，且无任何上限。**
- **为什么缓冲形同虚设**：T-8 的缓冲是**固定 48px（≈2 行）**，而阶跃幅度是**变量**、随内容量线性增长。一旦单帧增量 > 48px，缓冲被瞬间击穿 —— 这就是「感觉没起效果」的确切原因。
- **结论**：缓冲形同虚设的根因是「**固定容量的缓冲 vs 无上限的阶跃**」。但**解法不是限制阶跃**（那会拖慢内容，老大明确不接受），而是**让滚动跟随自己去限幅** —— 见上文「修法方向」表。同理 T-8 内层「攒够 48px 才滚」也是"等攒够再跳"的台阶化写法，属同类问题。
- **现成取证埋点**：`recordStreamingRenderPoolFlush(..., { poolSize, step, renderedLength, targetLength })`（`use-typewriter.ts:123-128`）**已记录 step 分布**，可直接佐证单帧步长量级。

**建议**：S-31 与 S-32 **合并为一条**（含思考流式），统一按本节三阶梯修法处置 —— 分开登记只是保留老大原始口径，实际是同一次根因修复。

**修法方向（2026-09-16 按老大纠正后重定）**：

> ⚠️ **我曾提出的「给 step 加每帧上限、让内容变慢以适应缓冲」——方向错了，已撤回。**
> 老大原话：「**不能让内容去适应缓冲，应该是让缓冲去适应内容。不能因为缓冲去导致内容变慢这些，这种我接受不了**」

**正确原则：内容是自变量（不限速），滚动是因变量。**

跳的本质是「**scrollTop 阶跃**」，不是「内容增长快」—— 内容一帧长 500px 本身不跳，只要滚动条**不是一帧跳 500px**。

| 侧 | 动作 |
|---|---|
| **内容侧**（`use-typewriter.ts`） | **不动。** 渲染速度不设限，burst 该多快就多快 |
| **滚动侧 · 外层** | `scrollToBottomImmediate` 目标仍是「内容底 + GAP」，但 scrollTop 改为**每帧限幅逼近**（非瞬时赋值）：小 delta 一次到位、大 delta 摊到多帧 |
| **滚动侧 · 内层** | `ThinkingBlock` 取消「攒够 48px 才滚」的台阶判定（**同类错误：等攒够再跳 = 台阶化**），改同样的每帧限幅逼近 |
| **滚动侧 · 开关** | `isSessionOutputting` 加**滞后**（翻 false 后延迟收回水位线），吃掉断续间隙的闪变；`autoScrollMode` 同理 |
| **留白（GAP）** | 基准值恒定（如 80px）。**限幅跟随会让留白在 burst 期间临时变大** —— 这正是「偶尔留白过多」，老大 2026-09-16 明确：「**留白可以涨到半屏都是可以接受的**」（较 iter-28「整屏留白不可接受」的口径**放宽**）。**调参边界：留白峰值 ≤ 半屏**；接近该上限时**解除限幅、直接跟上**作兜底，避免出现整屏空白 |

**留白的作用原理（老大 2026-09-16 解释 —— 这是设计核心意图，勿当"浪费空间"）**：

> 原话：「空白的时候，**内容逐渐从上面一行行写内容，这时候是不会跳动的**，所以这种我接受并且觉得效果好。所以我也专门说弄这种来作为缓冲，但是现在就感觉这个策略没有执行好」

- 留白**不是浪费空间，是缓冲区**：留白期间新增内容在缓冲区内逐行生长，**视口不必发生阶跃** ⇒ 平滑。
- 老大最初要求「下方留白作缓冲」的**方向从一开始就是对的**。
- **当前没执行好，两个断点**：
  1. **内层缓冲太小（48px）** —— 一帧的大增量就把它击穿，缓冲期几乎不存在；
  2. **外层 GAP 会被闪变收掉** —— `isSessionOutputting` 一翻 false 就 `contentHeightWatermarkRef = 0`，缓冲区消失。
- **要害**：「限幅连续跟随」**天然同时产出留白与平滑** —— 内容一帧长 Δ、scrollTop 每帧最多走 V（V < Δ）时，滚动条自然落后 ⇒ 留白自然增长 ⇒ 而这期间的滚动是**连续的**而非阶跃。**不需要再单独设计"缓冲"**，缓冲是限幅的自然结果。
- 反过来说：现行的「攒够 48px 再跳一次」**两头不讨好** —— 留白只有 48px（不够黑），滚的时候又是阶跃（会跳）。

**取证线索（现成埋点）**：`ThinkingBlock.tsx:171-173` 已挂 `data-render-pool-size` / `data-rendered-length` / `data-target-length`。若抖动时 `pool-size` 经常几百上千 ⇒ 坐实 ① 是大头。

---

## S-32 回复结束时思考块折叠 + 正文输出，聊天窗来回跳动

**一句话**：一轮回复结束时，Agent 回复块折叠、下方开始输出最终结论，此时**聊天窗（外层滚动区）来回跳动**。

### 背景

老大 2026-09-16 口述（原话）：「在回复结束 agent 回复块折叠，并且下面输出最终结论的时候，聊天窗内也在来回跳动」。

### 现状勘测（2026-09-16 实读）

**折叠机关**：`ThinkingBlock.tsx:63-70`

```tsx
// Auto-collapse when thinking transitions from active to completed
const prevIsThinkingRef = useRef(isThinking)
useEffect(() => {
  if (prevIsThinkingRef.current && !isThinking) {
    setCollapsed(true)          // ← 思考完成 → 立即折叠
  }
  prevIsThinkingRef.current = isThinking
}, [isThinking])
```

**高度过渡**：折叠走 `CollapsibleHeightPanel`（`ThinkingBlock.tsx:156`），该组件带 `transition: height 0.2s`（iter-29 T-8 排查时实读：`CollapsibleHeightPanel.tsx:138/140`）。

**假说（待实测）**：折叠的「高度骤减」与正文流式增长的「高度增加」**在同一时间窗内叠加**，而 `transition` 的 0.2s 期间高度**连续变化** ⇒ 外层滚动补偿被反复触发 ⇒ 表现为来回跳。

**外层已有防护**：`MessageList/VirtualListContent.tsx:144` 有 `overflowAnchor: 'none'`、`:126` 有吸附/layout 相关处理 —— 说明外层**不是完全没管**，问题可能出在「折叠动画期间」这个补偿没有覆盖到的时序。

### 待补 / 待定口径

1. **老大补复现细节**：跳动发生在折叠动画期间还是之后；正文已经开始输出没有
2. **取证先行**：同上，先量外层容器的 `scrollTop` / `scrollHeight` / `clientHeight`
3. **候选修法**（取证后再定，**别先改**）：
   - 折叠改为**无动画**（瞬时）或缩短 duration
   - 折叠与正文首帧之间做时序错开
   - 折叠发生时把外层滚动位置显式锁定到「底部保持」
4. **与 S-31 的关系** —— 两条很可能同源（都指向「高度变化 + 滚动补偿」这一域）。**建议合并排查，但按老大口径登记为两条**，修完再决定是否并条目

---

## S-33 队列 banner 新增「立即插入」按钮

**一句话**：队列里的消息可以**直接塞进当前正在跑的那一轮**，不必等本轮结束。

**来源**：老大 2026-09-16 原话 ——「我也倾向于进渲染端度队列，渲染端队列进入以后目前有个 banner 显示，上面可以加一个按钮用于直接插进当前这一轮。也就是用户可以手动点击立即插入」。

**已落地**（提交 `34e63dde`）：

- `hooks/use-chat-actions.ts:774+` —— 把队列某条消息塞进当前 run，**走 Worker 的 message queue**，不打断正在执行的工具，AgentLoop 下一次 iteration 起点读到它
- `components/chat/InputArea/use-queued-messages.ts:166-169` —— `canInsertQueuedMessageNow`：只在当前会话**确有活跃 run** 时才给按钮（没有可插入的轮次就不显示）
- `components/chat/InputArea/queued-messages-panel.tsx:45-47` —— 按钮渲染
- locale `chat.json`：`input.queueInsertNow` / `queueInsertNowHint` / `queueInsertNowFailed`

---

## S-34 会话 todo 状态与实际执行脱节（代码层兜底）

**一句话**：agent 建了 todo 之后**忘了更新状态**，banner 上挂着的条目与真实执行进度不一致。老大要求**从代码层兜底**，不接受靠提示词 / `agents.md` 之类「协议」去约束使用者。

### 背景（2026-09-16 老大原话）

> 「你没有更新 todo 里面的内容，我们需要想一个策略，毕竟你没更新就意味着我们代码有问题」

> 「我想从代码层去解决这个 todo 问题，**而不是通过协议**，毕竟我是作者，我要为所有使用的用户负责，我不能要求他们也去加 agents.md 呀」

老大已排期：**进 30 迭代**（2026-09-16）。

### 现状勘测（2026-09-16 实读）

**存储**：`src/runtime/WishfulClaw.Agent/AgentRuntimeTaskExecutor.cs`（OpenCowork 移植）。SQLite 支撑、**session 作用域**，5 状态 `pending / in_progress / blocked / in_review / completed`，`deleted` = **物理删除**。工具族 `TodoTaskCreate / Get / Update / List`（`:21-26`，旧名 `Task*` 保留兼容）。

**唯一写入方 = agent 自己调**：`ExecuteUpdate`（`:117-248`）只认 agent 传进来的 `status` 字段，**代码里没有任何自动状态推进**。

**唯一的「督促」是提示词** —— `WishfulClaw.Persona/PromptBuilder.cs:379-382`：

```
- Call TodoTaskList before creating tasks to avoid duplicates.
- Use TodoTaskUpdate to mark `in_progress` when starting (one at a time),
  `blocked` when stuck, `in_review` when done and awaiting user confirmation,
  `completed` only when fully done and verified.
```

⇒ 这正是老大说的**「协议」**。agent 不照做，代码不会拦、不会提示、不会纠正。

**已有埋点（可复用做卫生检查）**：`ExecuteUpdate` 内已产出 `todo_created` / `todo_status_changed` / `todo_deleted`，经 `DbAgentTimelineTools.Log` 落库（`:89-90`、`:242-245`）。

**渲染端**：`components/chat/SessionTodoPanel.tsx`（banner）；`stores/chat-store/index.ts:51` `NATIVE_TASK_TOOL_NAMES` 从工具结果解析后刷新。

### 候选方向（**先讨论，别写死**）

| # | 方向 | 说明 |
|---|---|---|
| A | **run 收口时校对** | 一轮 run 终结时扫本 session 仍为 `in_progress` 的 todo，与运行态对齐后修正，并落 timeline |
| B | **状态机强制** | run 结束时若存在「建了从未被 update」的 `pending`，由代码注入一轮提醒（**代码注入，不是提示词**） |
| C | **渲染端对齐** | banner 的「执行中」标记与 run 活跃度挂钩：run 不活跃而 todo 仍 `in_progress` ⇒ 显示「待确认」，不再假装在跑 |
| D | **孤儿归档** | 会话结束后残留 todo 归档 |

### 待定口径

1. A 的语义边界 —— 跨轮长任务会不会被误降级
2. B 的注入时机 —— 挂在 AgentLoop 哪个 hook
3. 与 `deleted` 物理删除的交互
4. 最终形态（A/B/C/D 取哪几项）**待老大拍板**

### 实施（2026-09-16 定稿 + 落地）

**裁定**：取 **C（渲染端对齐）**，走 **甲案 —— agent 说了算，代码只对齐展示、绝不动数据**。**B（代码主动催 agent）与 D（孤儿归档）不做**：B 会往每一轮请求里塞额外内容，D 会删用户的任务，都越界了。

三态，**只影响渲染**：

| 显示 | 条件 | 表现 |
|---|---|---|
| 执行中 | 本会话有活跃 run | 蓝色 + 转圈（原样） |
| 待续 | run 已结束、`updatedAt` 未超阈值 | 转圈**停掉**，中性色 + tooltip |
| 已过期 | run 已结束、`updatedAt` 距今 > 3 天 | 灰色虚线圆 + tooltip |

- 阈值 **3 天**（`STALE_IN_PROGRESS_MS`）：「今天没空、明天接着干」是正常场景，1 天会把人误判成过期
- run 活跃度与 `hasActiveSessionRunForSession`（`hooks/use-chat-actions.ts:964`）同口径，组件里改用订阅以触发重渲染
- banner 顶部汇总图标此前只看 `status === 'in_progress'` 就转圈 —— 改为**真有 run 在跑**才转
- `TaskItem` 本就带 `createdAt` / `updatedAt`（`task-store-helpers.ts:17`），**零新链路、零 schema 变更**

**落地**：`components/chat/SessionTodoPanel.tsx`（新增 `InProgressState`、`TaskStatusIcon` 改签名）；locales `chat.json` 新增 `todo.inProgressSuspended` / `todo.inProgressStale`（zh/en）。

---

## S-35 文件树「发送到会话」对文件夹不成立

**一句话**：文件树右键把**文件夹**发送到会话，发送后消息下面挂一条「Read failed」附件（`Path is a directory`）。**「目录」这个语义在整条链上不存在**，被当成「读不出内容的文件」。

### 来源（2026-09-16 老大口述原话）

> 「文件夹右键发送到会话，然后会话消息发送后，我们会默认读取发送中的链接对于文件，没有判断是文件夹，这个可能是右键发送到会话就没有带一些东西」

### 现状勘测（2026-09-16 实读）

**入口三处不一致** —— 同一操作两种态度：

| 入口 | 位置 | 对目录 |
|---|---|---|
| 行内 hover 按钮 | `tree-item.tsx:192`（`!agentSurface && !isDir && !isRenaming`） | **排除** ✓ |
| 行右键菜单「发送到会话」 | `tree-item.tsx:232`（**无条件**渲染） | **包含** ✗ |
| 根节点右键菜单 | `file-tree-context-menu.tsx:51-56`（根节点即 `workingFolder`） | **包含** ✗ |

**动作侧**：`use-file-tree.ts:294-300` `handleAddToChat` —— 只做一件事，把相对路径包成 select-file tag 写进输入框，**不看 `isDir`**：

```ts
const relativePath = toRelativePath(filePath, workingFolder)
useUIStore.getState().setPendingInsertText(createSelectFileTag(relativePath))
```

（老大猜的「没带一些东西」—— 这半成立。）

**读取端**：`lib/agent/selected-file-context.ts`

- `:302` `statFileForRead` **认得出目录** —— `if (result.isDirectory) return 'Path is a directory'`
- `:176-179` 但把它按 **error** 处理：`metaFiles.push({ ...baseMeta, error: statError })`
- 而 PDF / 二进制（`:169-173`）、超预算（`:199-211`）、不可解析（`:164-167`）**全都走 `skipped`**

⇒ **真因不是「信息缺失」，是目录被归进了「读取失败」而不是「路径引用」。** 读取端明明知道，却走了错分支。

**渲染端**：`components/chat/user-message-views.tsx:47-89`

- `error` → 橙色 `AlertCircle` + `selectedFileReadFailed`（"Read failed"）
- `skipped` + `'pdf'` → PDF 文案；`'unresolved' | 'budget'` → 未注入文案；**其余 skipped 一律 → `skippedNonText`**（"binary or document file was not read directly"）

### 方案（推荐 **A + B + C1**；C 待老大拍板）

**A（核心）读取端把「目录」从 `error` 改成 `skipped`**

`statFileForRead` 的返回值改为能区分「目录」与「真错误」：目录 → `{ skipped: true, skipReason: 'directory' }`，真错误保持 `error`。
作用面覆盖**所有**入口（右键 / `@` 搜索 / 手打路径），不只右键这一条。

**B（配套）渲染端加 `'directory'` 文案分支**

不加则落进最后一个 `else`，显示 "binary or document file was not read directly" —— 目录不是二进制文件，**文案是错的**。新增 `userMessage.selectedFileReadSkippedDirectory`（zh/en）。

**C（产品语义）目录该不该能「发送到会话」？**

- **C1 允许**（推荐）：目录作为**纯路径引用**发出，**不读内容**；AI 在消息里看到 `@src/components`，自己 `LS` 即可。「看看这个目录」是常见诉求；且根节点本身就是目录，禁止等于顺带把根节点这项也砍掉。采纳 C1 的话，hover 按钮（现排除目录）应一并放开，**三处统一**。
- **C2 禁止**（备选）：三处入口统一排除目录。

### 待定口径

1. **C 取 C1 还是 C2 —— 待老大拍板**（默认按 C1 推）
2. C1 下 hover 按钮是否一并放开（要一致就放开）

---

## 待登记（清尾巴，**等老大点名**）

老大原话「30 迭代主要是 spill + 清尾巴」，**未逐条点名**。以下为当前已存在的候选池，按来源分组，**均未排入**：

**A. 知识库剩余待处理（3 条）→ ✅ 已全部立项**

- ~~改进 2026-09-14 大输出落盘 spill~~ → **S-26**
- ~~缺陷 2026-09-14 聊天窗大图预览超出弹窗边界~~ → **S-28**
- ~~改进 2026-09-14 记忆整理等后台任务缺执行记录~~ → **S-29**

知识库 `issues/bugs.md` / `issues/改进.md` 经 2026-09-16 归档后核对，**已无其他待处理条目**。

**B. iter-29 收尾挂的「下版本待议」（4 项）→ ① 已立项**

- ~~① 渠道会话的 shell 审批**没有出口**~~ → **S-30**（老大 2026-09-16 定形态：走文本审批）
- ② 渠道 `displayName` 的 i18n（存库默认名，只能在渲染端按 `channel.type` 映射）
- ③ `meta.requestModel` 全仓零写入方 ⇒ 无法显示「上一条消息真正用了谁」
- ④ `serviceTier` / fast mode 整体未落地（preset 标了但无任何路径发出去）

**C. 知识库《正式版发布规划》**（2026-08-18，从未进过任何迭代）

- 左侧面板整理：扩展功能清空重建、自动化（定时任务）移入扩展、增加任务面板、绘图移入扩展
- 快捷搜索扩展整合：Alt+Space 并入扩展数据源 + 「扩展」Tab（**与 S-27 同源，可能有重叠**）

**D. `use_capability` 参数错层的代码层兜底**（2026-09-16 讨论产物，老大拍板「登记」）

- **背景**：本轮已按老大口径做了 1+2 —— `UseCapabilityToolProvider.cs` 给 `capability_id` 补「顶层字段」说明，`arguments` 从**零描述**补成语义描述（`ToolSchemaBuilder.Object` 为此新增可选 `description` 形参，通用能力）。但 schema 描述只能**降低**概率，**不能消除** —— 它是被读的，不是被执行的。
- **依据**：`docs/prompt-authoring.md` 第 3 关 ——「**能在代码里强制就不要靠嘱咐**」。工具描述和系统提示词同样是每轮重发的位置，排在提示词队尾、最后选。
- **做法**：在 `AgentRuntimeUseCapabilityExecutor.CallCapabilityAsync` 取 `arguments` 处（`:256-259`）加一道纠偏 —— `arguments` 里若出现 `capability_id` / `action`，**自动提到顶层**再执行。
- **前置核实**：目标工具自身是否存在同名参数（尤指 `capability_id`），避免误吞。
- **触发条件**：**先观察** 1+2 之后模型是否仍踩这个坑（需重编 worker 后实测）；仍踩则升级为代码强制。

> 登记原则：**只记不排**。哪几条进 30、哪几条留 31，等老大点名后回填编号。

---

## 裁定记录（2026-09-16 老大拍板）

### S-27 免费对话页

| # | 事项 | 裁定 |
|---|---|---|
| 1 | 站点清单 | **做成配置项** —— 位置 `设置页 → AI 服务 → 免费对话清单`，用户自己增删（不写死站点） |
| 2 | 地址栏 | **不留** |
| 3 | 登录态分区 | **共用**（能共用就共用） |
| 4 | 站点切换 | **单实例**（改 URL，非多实例） |
| 5 | 搜索面板 | 老大原话「**不仅搜索面板**」⇒ 按**要加搜索面板入口**处理 ⚠️ 是否还另有入口待确认 |

### S-28 聊天窗大图预览

- **免真机取证，按推荐修法直接做**（补齐尺寸约束 + 去掉 overflow 裁切）

### S-29 后台任务执行记录

- **采纳 A**：补强现有记忆整理报告（**不做**通用后台任务框架）
- **落点：记忆设置处** —— 让用户能看到「**是否执行了**」（老大原话）

### S-30 渠道会话 shell 文本审批

- **全部按推荐**：词表 `同意 / y / yes / ok / 1` ↔ `拒绝 / n / no / 0`；超时 **10 分钟按拒绝**；**支持「总是允许」**（落 `permission-policy` allow 规则）；**串行**（一次批一个）；复用现有 `[USER REJECTED]` 话术；**开关复用 `shellRequiresApproval`**

### 新增（2026-09-16 老大追问，未立项）

- 聊天窗消息虚拟化的 overscan / 首屏条数**是否要做成设置项** —— 当前硬编码于 `MessageList/utils.ts:225-227`，无设置项。**待老大点名**。
