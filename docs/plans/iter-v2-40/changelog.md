# iter-v2-40 裁定与变更流水

> 跨需求的裁定、口径修订、提交记录按时间追加。
> 需求正文见 `requirements/`，总览见 `plan.md`。

---

## 2026-10-14 —— 迭代开启

- **17:19** 老大「本地切40迭代 等需求吧」⇒ `main` 已是最新（`a3b966d5`），切出 `dev/v2-iter-40`；本目录随之建立。
- **17:33** 登记 **S-203**（官网页脚在高分辨率屏上不贴底，定性 **bug**，官网侧）—— 本迭代第 1 条。根因静态坐实：`#root` 无 `min-h-screen` + flex column ⇒ 内容不满一屏时页脚不贴底。**待开工。**
- **17:37** **迭代定位落定** —— 老大原话「基本都是收bug 和优化为主」⇒ 范围 = bug 修复 + 体验优化，不做主打新功能（与 39 现行口径同向）。措辞用「基本」⇒ 留个别例外口子。**转正 `1.0.0` 是否落 40、判定标准，本轮未定**（39 的口径是最早候选落 40）。已补入 `plan.md` §一。
- **17:38 / 17:41** **跨迭代验证结论（39 验 38 闭环）** —— 老大原话「还有38升级39已经真机测试 进度这些都有了，不再是未知」+「没有出现异常 更新说明看到了的」。即 **`0.2.38` 客户端升 `0.2.39` 这一跳已实跑，38 的三项待验修复全部验到**：①「差分下载无进度」（`electron-builder.yml` 的 `useMultipleRangeRequest: false`）⇒ **进度正常**（38 `changelog.md` 记的「机器 B 全程进度与大小未知」状态终结）；②「已下载却装不上」（安装闸门改判盘上事实）⇒ **未出现异常**；③「更新说明兜底拉取」（`latest.yml` 干净、客户端按版本号拉同目录 md）⇒ **更新说明看到了**。⇒ **39 迭代 `plan.md` §一 的「验证链条：38 修 → 39 验 38 → 40 验 39」中，「39 验 38」一环闭环**，已回填至 39 `plan.md` §一。
- **17:43 ~ 17:50** **补做 39 收尾漏掉的 `§4.4 上传资产到 Release`** —— 老大指出「根据agents.md 进行收尾的发布流程缺少了东西 GitHub上没有上传安装包」。核查：`v0.2.39` Release **存在、`draft=false`、`isLatest=true`，但 `asset count = 0`** —— 首轮收尾只走了 4.2（官网下载目录）/ 4.3（建 Release），**4.4 没走**，§六 的「GitHub 侧资产核验」也随之没做。按 `docs/release-workflow.md` §4.4 原文补传 setup.exe + latest.yml + blockmap（两刀 `--clobber`，均 `EXIT=0`，直连可用、未开代理）。补做后三件资产 `state=uploaded`；`latest.yml` 与 setup.exe 逐项对上（`version` 0.2.39 / `path` / `files[].url` / `size` 113603743 / `sha512` 实测一致）；`gh release download v0.2.39 --pattern latest.yml` 下载成功、内容与本地逐字相同。**⇒ 至此 §四 4.1~4.4、§五、§六 全部完成；仅 §七 清理本地产物未做**（`release/` 仍留 0.2.38 旧版 108.4 MB）。已记入 39 `plan.md` 新增的 `## 七、发布记录`。
  - **教训**：**建 Release ≠ 发布完成** —— 空 Release 在页面上看着「已发布」，实际没有包可下；核验必须落到 `asset count` 与逐项对账。
  - **环境备注**：`curl` 直连 `github.com/releases/download/...` 返 `000`（HTTP/2 被 reset），但 `curl --http1.1` 返 **206**、`gh` 全程正常 ⇒ **判可达性别只看一次 curl**。

## 2026-10-15

- **08:20** 登记 **S-204**（「清空会话」只清内存不删库 ⇒ 切走再切回消息与上下文全回来；并补右侧浮窗入口）—— 本迭代第 2 条，定性 **bug + 体验优化**。老大原话：「我需要在右侧浮窗 重置用量下也增加这个清空会话，并且完善这个清空会话，它就不只是重置用量了，它需要删掉当前会话所有的消息，因为当前存在一个bug 点击清空会话再来回切换会话，历史会话和上下文又回来了」。
  - **根因坐实（只读勘察）**：渲染层 `clearSessionMessages`（`session-slice.ts:477-507`）只清**渲染层内存** + 调 `agent/clear-session`（worker 侧 `AgentRuntimeTools.cs:346-357` 仅 `SessionConversationManager.Remove`，清**运行时上下文**），**DB 的 `messages` 行一条没删** ⇒ ①切回时 `loadRecentSessionMessages`（`session-slice.ts:~900`）按 `dbGetMessageCount` 从 DB 原样拉回（**消息回来**）；②首次发送时 worker 会话**懒重建**（`session-slice.ts:966` 注释写明）⇒ 重建出的仍是清空前的历史（**上下文回来**）。**同一根因，两个后果。**
  - **为何切回必重载**：清空后 `isRuntimeResident=false` + `messages.length===0`，`loadRecentSessionMessages` 的两条早退（`isRuntimeResident` / `messagesLoaded && length>0`）**都不成立** ⇒ 必然重载。
  - **端点早已写好、只是没接线**：`db/messages-clear`（`DbMessageToolsMutations.cs:171-191`，删 messages + detach 压缩快照 + `message_count=0`）与 `db/session-reset-conversation`（`DbSessionTools.cs:256-292`，另加删 tasks + **标题重置**）**在渲染层均零调用**；`db-helpers.ts:625` 的 `dbClearMessages` 是**死代码**。后者仅渠道插件 `/new`（`plugin-command-handlers.ts:231`）在用。
  - **影响面**：左侧右键「清空消息」（`workspace-sidebar-items.tsx:246-249`）与输入框「清空对话」（`clear-conversation-dialog.tsx`，经 `InputArea/index.tsx:457`）**共用同一 store 方法** ⇒ 改 store 一处，两个入口同时治好。
- **08:25** **S-204 四点裁定（老大逐条拍板）**：①**清空后标题不动** ⇒ 走 `db/messages-clear`，**不用**会把标题重置为 "New Conversation" 的 `db/session-reset-conversation`；②**「重置用量统计」保留** ⇒ 浮窗两项并存；③**请求明细不删** ⇒ `request_usage_logs` 是独立表、`db/messages-clear` 本就不碰，与「删除会话」口径一致；④**竞态要处理** ⇒ in-flight guard 方案（模块级 `Set` + 三个回读入口拦截）。**否决的备选**：让 store 方法变 `async` 由调用方 `await`（治不了 await 期间切走）、删除完成后回写内存（窗口内发新消息会被误清，更糟）。
- **08:26** 老大纠正登记流程 —— 本需求**先登记、不开工**（我此前直接出了实施计划，越步）。**S-204 状态 = 待开工**，等「改吧」。
- **09:48** 登记 **S-205**（官网与 README 文案太中规中矩、没诱惑力 ⇒ 允许适当标题党，重写对外描述）—— 本迭代第 3 条，定性 **体验优化**，轨道 = **官网侧 + 仓库根**（不随软件版本发布）。老大原话：「再登记一个官网优化需求，这个也需要同步项目的Readme文档，当前我们描述太中规中矩了，没有诱惑力，可以适当标题党一下」。
  - **文案面盘点（只读勘察）**：官网文案**唯一源**是 `website/src/content/site.ts`（其 `:2` 注释写明「改文案只改这里，不散落进 JSX」），8 个区块组件（`src/sections/`）只读不改；可动字段 6 组 —— `hero`（`title.lead`/`title.highlight`/`subtitle`/`primaryCta`）、`advantages`（`quote`/`body`）、`valueLadder`、`features`（`name`/`desc`）、`quickStart`、`faq`。README 侧需同步首屏 `<strong>` 定位句（`README.md:4`）+ 简介行（`:5`）+ 各节开场句。
  - **现状问题逐处摘录**：Hero 主标题「你说一句，它去把活干完」（平，无反差）；副标题**功能罗列式**（一句话塞四个动词）；README 首屏「桌面 AI Agent 工作台 — 有记忆、有人格、能动手」（规格化）；`advantages` 前两条 quote 偏辩解、第三条偏空；`features` 的「真干活」desc 以「不是什么」立论；README 结尾「自用项目，慢慢打磨。」与邀请使用相反。
  - **⚠️ 五处待裁定（动笔前必须拍板）**：①**标题党的「度」**（A 克制／B 适度／C 激进，老大原话「**适当**」⇒ 倾向 B）；②**是否突破既有红线** —— `site.ts:46-48` 记着老大 2026-09-21 定的两条：「**不写成程序员工具**」（目标人群是被配置门槛挡住的人）与「**不碰瓷大厂**」（原「你的 AI 助手，key 自己带」因「第一句就跟大厂吵架」被撤）；③**合规边界** —— 官网已过 ICP + 公安联网备案，标题党不得构成虚假宣传（如「永久免费」「全自动无人值守」这类与实况不符的承诺）；④官网与 README 是否同一套措辞；⑤英文面是否同步（默认不出）。
  - **范围外**：`BRAND`（品牌名与备案全称是合规面，改它会牵动 `index.html` / `download.html` 的 `title`/`description` 4 行静态投影）、`downloadSources` / `platforms` / `footer` 备案信息、README 徽章区与 License 段、`docs/` 开发文档措辞、软件内 `locales/**`、`assetNo` 素材位体系。
- **09:53** **S-205 裁定落定（老大原话：「红线不破，只是需要改我们的叙述，变得更有诱惑力一点」）** —— ①**「度」=「更有诱惑力一点」**：介于 A（克制）与 B（适度）之间，**换叙述方式、加钩子**，但**不上 C 档**（不搞悬念式标题、不夸张失真）；②**两条红线原样有效** —— `site.ts:46-48` 的「**不写成程序员工具**」（受众定位不变）与「**不碰瓷大厂**」（不与大厂对比叫板）；③合规边界（ICP + 公安联网备案，不得虚假宣传）是**硬约束不需另行裁定**；④官网与 README **同源**（README 可略详）；⑤英文面**不同步**（只改中文）—— ④⑤ 已按此默认执行，如无异议照此推进。
  - **由此得到的写作准则**：**改的是「怎么讲」，不是「讲什么」**（事实/能力清单/受众定位不动）／**卖点前移、形容词后退**（多讲「你会因此少干什么」）／**允许修辞与反差但每句都能在软件里找到对应事实**／**不碰瓷、不设假想敌**（不出现「比 XX 强」「不像 XX 那样」）。已写入 `S-205.md` §四。
- **11:38** 登记 **S-206**（官网首屏加背景动画，参考 `https://astra-gate.si/`）—— 本迭代第 4 条，定性 **体验优化**，轨道 = **官网侧**。老大原话：「登记40迭代需求 官网 参考https://astra-gate.si/的背景动画」。
  - **参考站实测（内置浏览器，只读勘察）**：Hero 的 `<main class="astra-home …">` 下挂**两层装饰 `<canvas aria-hidden="true">`** —— ①`pointer-events-none fixed inset-0 -z-20 size-full`（backing store 仅 **116×120**，CSS 拉满视口 ⇒ 约 8 倍放大，作柔和的**全视口色雾底**）；②`pointer-events-none absolute inset-0 -z-10 size-full [mask-image:linear-gradient(to_bottom,black_70%,transparent)]`（1359×945，**只盖 Hero、底部 30% 渐隐**）。两层均在**负 z 层** + `pointer-events-none` + `aria-hidden` ⇒ 纯装饰，不拦交互、不进无障碍树。
  - **确为连续动画**：稳定态 3 秒内该 2D 上下文约 **13005 次绘制调用**（≈ 4300 次/秒）；`visibilityState === 'visible'`，排除后台节流造成的假静止。**观测备注**：首轮探针（页面刚导航完、只挂少数方法）读到 **0 次调用**，完全激活后复测才读到上值 ⇒ **判断同类站点是否在动，必须等页面完全激活再读**。
  - **另一处动效**：唯一自定义关键帧 `astra-pulse`（4s / infinite），挂在 `.astra-core absolute -inset-10 -z-10 rounded-full` —— Hero 标志块后的**脉冲光晕**。视觉形态为柔和 pastel 渐变（浅蓝 → 淡紫 / 粉）上浮着**极细线段与圆弧**（无填充、朝向随机，像「星座 / 流线」状线稿）。
  - **我方现状**：`website/src/sections/hero.tsx` **纯文案 + 一层扫光、无背景层**（首屏大图 2026-09-23 已撤）；扫光由 `shine shine-muted` 内层 span + `h1` 的 `::after`（`index.css` 的 `.hero-shine` + `data-text`）**两处联动**；设计 token = 2026-09-21 指定的 reasonix.io **浅色纸面 + 单一琥珀强调色**。
  - **⚠️ 6 处待裁定**：①**技术路线**（建议 **CSS + SVG**，不上 canvas、不引依赖 —— 为纯装饰付常驻 rAF 的代价不值，且与现有 CSS 动效风格统一）；②**配色**（建议**用我们自己的纸面 + 琥珀同色系**，照搬参考站冷调蓝紫会跟既定视觉语言打架、违反「单一强调色」）；③**强度**（建议**极低对比**）；④**范围**（建议**只 Hero**）；⑤**无障碍**（`prefers-reduced-motion: reduce` 时建议**关掉**）；⑥**与 S-205 的先后**（建议 **S-205 文案先落、S-206 随后**，同面同文件族，少返工一轮）。
  - **⚠️ 一处必须一并考虑的冲突**：`h1` 现有扫光与新背景动画**同屏叠加两层动效**，动笔时要实际看一眼是否显脏；若打架，**优先保扫光**（2026-09-23 定下的首屏手法）。
  - **范围外**：文案（`site.ts`，S-205 的地盘）、配色体系与设计 token、Hero 结构与两个入口按钮、其余页面（`/download` `/guide` `/go`）、软件侧（`src/renderer/**` / `src/runtime/**`）。
- **17:56 ~ 18:02** 登记 **S-207**（沙箱模式下越界访问 ⇒ 从「直接拒绝」改为「弹窗审批 + 临时关闭沙箱」）—— 本迭代第 5 条，定性 **体验优化**（非 bug：现有拒绝行为按既定设计工作）。老大原话四段：**17:56**「目前我们有沙箱模式，开启的情况下无法访问工作目录外的地址，如果开启沙箱模式的情况下用户希望访问某个路径，这种需要弹窗审批。**就算已经是 yolo 的情况下也需要审批**」；**17:58**「**YOLO 本身就是全放行啊，只是沙箱模式在 YOLO 之上**」（纠正我第一轮复述的「收窄 YOLO 语义」措辞）；**18:01**「我的意思其实比较简单，就是**临时关闭沙箱模式**」（砍掉我第一轮提的目录白名单 / 勾选框 / 设置项三样）；**18:02**「**临时指的是 比如放行 1 小时**」。
  - **口径归一**：沙箱越界不再直接拒 ⇒ 弹窗问「要不要临时关闭沙箱模式」⇒ 同意则**沙箱临时关闭 1 小时**、到点自动恢复；**YOLO 不豁免这一问**。
  - **层级关系（老大 17:58 定）**：三层 —— ①**沙箱边界**（`PathBoundary`，本次要改的一层）／②**审批策略**（`permissionMode`：`default` 需确认、YOLO(`fullAccess`) 全放行）／③工具自身交互。**YOLO 管的是 ②，沙箱管的是 ①，套在它外面** ⇒ **不是收窄 YOLO，而是沙箱根本不问 YOLO**；YOLO 既有语义一行不改。
  - **机制坐实（只读勘察）**：①**判定唯一方法** = `ToolHelpers.EnsureInsideSandbox`（`Tools/ToolHelpers.cs:106-112`），**同步、由工具在执行器内部自己调**，调用点至少 6 处（`ToolHelpers.cs:77` / `:98`、`FileSaveImageTool.cs:106`、`ShellExecuteTool.Helpers.cs:31/45/57`）；②异常由 `ToolDispatchRouter.cs:563-569` 接住转**工具错误**，文案原样喂模型（`BuildViolationMessage`，`:252-260`）；③**校验先于动作**（写入/起进程之前调）⇒ 越界时工具**什么都没做**，这是"问完可安全重跑"的前提；④YOLO ⇒ **闸门根本不建**（`ToolCallProcessor.cs:220-222`「never create an approval barrier or dialog」+ `Approval.cs:70-75`「must never pause」）；⑤**子 agent 无审批**（`Approval.cs:19-28` `SubAgentApprovalTools` 是空集）；⑥**渠道会话**不弹的机制不是"没人点"而是**把该审批的工具剔出名单**（`Approval.cs:80-90`，`use-channel-auto-reply.ts:273` 原话「对面没人守着，弹审批只会把这一轮挂死」）。
  - **实现落点（推荐路线 B）**：**捕获越界 ⇒ 审批 ⇒ 临时关沙箱 ⇒ 重跑该次调用**（改 `ToolDispatchRouter` catch + 审批通道一处）。**否决路线 A（派发层越界预检）**：Shell 类工具的路径是从**命令串里抠**的（`ShellExecuteTool.Helpers.cs:31/45/57` 含 fallback），派发层还原等于抄一份抠法，**两处判定必然漂移**。
  - **「1 小时」状态存哪**：渲染端加**非持久化**到期时间戳（`sandboxEnabled` 本身在 `settings-store.ts:462-488` 的 `partialize` 白名单里 ⇒ 直接改它会写盘、重启残留，与"临时"矛盾）；worker 侧需同一轮内持有内存豁免（**已启动的那一轮用启动时透传的 policy**，`ToolCallProcessor.cs:180`「一批算一次」，渲染端中途改值不影响本轮）⇒ **必须双端可见**。9 个透传点收口成一个 helper（`use-chat-actions.ts:259/412/471/552`、`use-channel-auto-reply.ts:285`、`use-background-subagent-wakeup.ts:122`、`provider-auto-fallback.ts:248`、`project-send-message.ts:228`）。**顺带**：`SystemPromptCache.cs:74` 的缓存 key 含沙箱标记 ⇒ 临时关闭后提示词自动重建、agent 立刻知道边界没了。
  - **附带三条（推荐，待老大点头）**：①**渠道会话不弹、维持直接拒绝**（无审批接收端）；②**子 agent 也弹**（否则「沙箱在 YOLO 之上」在子 agent 这里是空的）；③**沙箱关时一切照旧**。
  - **⚠️ 四处待裁定**：①「1 小时」固定值 vs 给档位（推荐**固定**）；②到期自动恢复 + 可见倒计时 + 可手动立即恢复（推荐**全要**）；③附带三条（推荐照办）；④实现路线 A vs B（推荐 **B**）。
  - **非目标**：不改 YOLO 语义／不做目录白名单（我 18:01 前理解偏了，已纠正）／不加设置项开关／**`PathBoundary` 判定逻辑与 6 个工具校验点一行不动**／不改 `EnsureInsideSandbox` 同步签名／不动渠道"剔名单"机制／不改 `partialize` 持久化语义。

## 2026-10-16

- **08:28** **S-207 实现路线订正（老大原话：「实现路线不是捕获什么的，**不插入原有边界**。**由 agent 自行弹出提权审批** 这是一个**单独的弹窗**，也是一个**单独的 agent 调用工具**」）** —— 我此前建议的**路线 B（捕获越界异常 ⇒ 审批 ⇒ 重跑）整个作废**，改为**路线 C：新增一个 agent 工具 + 独立弹窗**。
  - **路线 C 与 B 的差别**：B 是 worker 接住越界异常后**系统自动**弹审批、代 agent 重跑（要改 `ToolDispatchRouter` 的 `catch`）；C 是 **agent 自己调工具**申请提权、**agent 自己重试**（原边界一行不动）。老大选 C ⇒ 改动更小、语义更干净：越界这件事**仍然是"拒"**，只是**多给了一条申请通道**。
  - **现成先例坐实（只读勘察）**：`AskUserQuestion` 形态与本需求**完全同构**，逐环节可照抄 —— ①**工具注册** `Tools/Providers/AskUserToolProvider.cs`（`IToolProvider` + `registry.Register`）；②**可见性** `visibleScopes: ToolVisibilityScopes.HumanAttended`（= `["*:chat@*", "*:cowork@*"]`，`ToolVisibilityScopes.cs:55`）+ `excludedScopes: ToolVisibilityScopes.NoHumanToAnswer`（= `[.. UnattendedRoles, "*:channel@*"]`，`:83`）；③**路由分支** `ToolDispatchRouter.cs:41-69`（`IsAskUserTool` ⇒ executor，`nonInteractive` 时直接返回错误，**不动 catch**）；④**反向请求** `AgentRuntimeReverseRequests.RequestAsync(context, "ask-user/request", …)`（`AskUserAnswerBuilder.cs:35-39`）；⑤**主进程转发** `native-agent-runtime.ts:32-37` `USER_INTERACTION_METHODS` + `:210-216` `rendererMethods` 两个集合；⑥**渲染端接收** `renderer-tool-bridge.ts:87` method 分发 + `lib/tools/ask-user-tool.ts` `handleNativeAskUserRequest`（resolver map + `resolveAskUserAnswers`）；⑦**弹窗** `chat/AskUserQuestionCard.tsx` / `ask-user-views.tsx`；⑧**超时兜底** `USER_INTERACTION_TIMEOUT_MS = 30 * 60 * 1000`。
  - **★ 架构免费送的两条（无需额外设计）**：①`excludedScopes: NoHumanToAnswer` ⇒ **渠道会话 / 后台定时任务 / 子 agent 里这个工具直接不可见** ⇒ agent 看不到就不会调 ⇒ **不会把无人值守的一轮挂死**（老大昨天的担忧在架构层面已解）；②30 分钟用户交互超时兜底现成。
  - **★ 由此产生一个与昨天建议相反的结论**：`HumanAttended` 只给 `chat` / `cowork` ⇒ **子 agent 拿不到提权工具**。我昨天建议"子 agent 也弹"，**现改推荐照 AskUser 形态（不给）**：子 agent 越界就拒，回头报告主会话去申请。列入待裁定（§五-6）。
  - **⚠️ 新增待裁定项**：①工具名 + 参数（推荐 `RequestPathElevation`，参数 `path` + `reason`）；②**越界文案改不改** —— `PathBoundary.BuildViolationMessage`（`:252-260`）现在只劝「关沙箱 / 加工作目录」，**不改它 agent 就不知道有这个工具**；我建议**只加一句指路**（判定逻辑不动），但是否算"插入原有边界"请老大裁；③弹窗显示内容（申请路径 + 理由 + 「同意后临时关闭 1 小时」）。
  - **链路**：agent 越界 ⇒ **直接拒（现状不变）**+ 文案指路 ⇒ agent 调工具 ⇒ 反向请求 `sandbox/elevation-request` ⇒ 渲染端弹**独立弹窗** ⇒ 同意 ⇒ 渲染端写非持久化到期戳 + worker 写内存豁免 ⇒ agent **自己重试**原调用。
  - **落点清单（11 项，预估）**：新增 `SandboxElevationToolProvider.cs` / executor / `sandbox-elevation-tool.ts` / 提权弹窗组件；改 `ToolDispatchRouter`（**新增并列分支，不动 catch**）/ `native-agent-runtime.ts`(2 集合) / `renderer-tool-bridge.ts` / 9 个透传点收口 / 语言包 /（待裁）越界文案。**明确不动**：`PathBoundary` 判定 / `EnsureInsideSandbox` / 6 个校验点 / `ToolDispatchRouter` 的 `catch` / `ToolCallProcessor` 审批闸门 / `Approval.cs` 渠道机制。
  - **文档**：`S-207.md` 全文按路线 C 重写（八节，§三 换成「实现形态 + 现成先例对照表 + 完整链路 + 无人值守 + 状态存哪 + UI」；§四 换成落点清单；§五 六项待裁；§六 12 条验收；§七 九条非目标）。
- **08:34** **S-207 渠道口径订正（老大原话：「渠道会话 走文字同意，跟取消一样的处理方式 因为渠道无法弹窗」）** —— **作废我 08:28 推出的「渠道不可见」判断**；渠道**不是排除**，而是**走文字审批**。
  - **★ 现成机制坐实（只读勘察）**：渠道的**文字审批链路早已投产** —— ①**worker 侧发起** `ToolCallProcessor.cs:518-521` ⇒ 反向请求 `sub-agent:approve-tool`，**请求体带 `channelSession: true`**（`:510-513`）；②**主进程** `native-agent-runtime.ts:36`（`USER_INTERACTION_METHODS`，30 分钟）+ `:216`（`rendererMethods`）；③**渲染端分流** `renderer-tool-bridge.ts:125-134` ⇒ `handleSubAgentApprovalRequest`；④**渠道分支** `sub-agent-approval.ts:69-90` —— 检测到 `channelSession === true` ⇒ `requestChannelShellApproval({ …, send })`，`send` 经 `IPC.PLUGIN_EXEC` 的 `sendMessage` 发回渠道；⑤**审批模块** `lib/channel/channel-shell-approval.ts` —— `pendingBySession`（**每会话最多一个待审批**，`:97-104`）、`SHELL_APPROVAL_TIMEOUT_MS = 10 * 60 * 1000`（**超时按拒绝**，`:107-113`）、同意词 `['同意','批准','允许','是','yes','y','ok','1']` / 拒绝词 `['拒绝','取消','否','no','n','0']`（`:18-21`）、提示文案 `buildShellApprovalPrompt`（`:69-75`）；⑥**用户回复消费** `use-channel-auto-reply.ts:139` —— `resolvePendingChannelShellApproval` 命中即**消费该消息**（不启动新 run），**非裁决词不消费、照常走普通请求**。
  - **（澄清）** 我此前担心的 `use-channel-auto-reply.ts:273`「渠道会话跑 YOLO：对面没人守着，**弹审批**只会把这一轮挂死」，说的是**弹窗**；渠道**不弹窗**、走文字 ⇒ 两句不矛盾。
  - **★ 可见性口径随之改（§3.4）**：`visibleScopes` = `["*:chat@*", "*:cowork@*", "*:channel@*"]`（= `HumanAttended` **＋ `*:channel@*`**），`excludedScopes` = `ToolVisibilityScopes.UnattendedRoles`（= `["*:*@subagent", "*:*@goalsubagent", "*:*@automation"]`，`ToolVisibilityScopes.cs:65`）。**不能照抄 `NoHumanToAnswer`** —— 它是 `[.. UnattendedRoles, "*:channel@*"]`（`:83`），**含渠道**，与老大 08:34 相反。**排除那三个角色**的理由：子 agent 是委托执行、后台定时任务无人值守，**没有可回话的人**。**声明位置**：`ToolVisibilityScopes.cs:7-8` 注释写明「一个工具独有的组合写 inline，不进共享表」⇒ **inline 声明在 provider 上，不动该文件**。
  - **⚠️ 新增待裁定项（§五-7）**：渠道审批的复用方式 —— **(a) 复用 `channel-shell-approval.ts` 并把提示文案参数化**（推荐：保住"每会话单待审批"的 `pendingBySession` 保证；代价是模块名 `channel-shell-approval` 名不副实，是否顺手改名待定）vs (b) 另建并行模块（**会绕过单待审批保证**）。
  - **链路（§3.3）加渠道分支**：④分流 —— 桌面 ⇒ 独立弹窗；**渠道 ⇒ 发渠道文字消息**（三段信息同桌面：申请路径 + 理由 + 恢复方式 / 回复方式 + 10 分钟超时说明）。
  - **两个时钟不冲突（§3.7）**：审批**等待**期（渠道 10 分钟 / 主进程 30 分钟）与批准后**豁免期 1 小时**是两个维度。
  - **文档**：`S-207.md` 再次全文重写 —— 新增 **§1.4「渠道已有文字审批的现成机制」**整节；§3.2 对照表加「渠道文字审批」行；§3.4 改为「桌面 + 渠道都给，只排无人值守角色」；新增 §3.5「渠道文字审批的复用方式」；§四 落点加第 8 项（渠道文案参数化）；§五 六项 → **七项**；§六 12 条 → **16 条**；§七 九条 → **十条**。
- **08:45** **S-207「跟取消一样的处理方式」含义坐实（老大原话：「用户在渠道里发文字给系统裁决，跟取消命令一样都是走文字」）** —— 关闭歧义：**指交互形态，不指取消语义**。
  - **只读勘察**：`main/channels/channel-cancel-commands.ts` —— 渠道取消 = 用户在渠道发**精确文字词**（`取消 / 取消执行 / 停止 / 停止执行 / 终止 / 终止执行 / 中断 / 中断执行 / /cancel / /canel / /stop / /interrupt`，`:6-19`），由 `isChannelCancelCommand`（`:25-33`）**先 `stripLeadingAtMention` + 去空白 + 转小写再精确匹配**裁决；文件头注释明写「故意精确，避免普通用户文本里含这些词被误判」（`:2-4`）。导出面：`plugin-commands.ts:25` re-export。
  - **与提权审批同一体例**：都是「用户发文字 ⇒ 一个识别函数精确匹配 ⇒ 裁决」；区别只在**谁先开口**（取消是用户主动发，提权是发消息请用户回）。⇒ **不碰 `channel-cancel-commands.ts`**。
  - **文档**：`S-207.md` 新增 **§2.1「『跟取消一样的处理方式』= 什么」**对照表（含两边词表与识别函数出处）；§二 追加 08:45 原话；§五 加一行说明「歧义已关闭，§五-7 问的是代码层面复用方式」。**§五-7（复用方式）仍待裁。**
- **08:48** **S-207 两处定案（老大原话：「你在梦游么。**这个作用是临时关闭沙箱 没有参数**。**可以在越界文案增加指路**，也就是**被权限卡住后在返回文本里面**。」）** —— 作废我此前设想的 `path` / `reason` 参数。
  - **① 工具无参数（定案）**：作用就是「**临时关闭沙箱**」这个动作本身，**不带路径、不带理由、不带时长档位**。⇒ 反向请求、弹窗、渠道消息**均为固定文案**；§五 原「工具名与参数」项去掉「参数」半截，只剩**工具名**待定（推荐 `RequestSandboxElevation`）。
  - **② 越界文案加指路（定案：加）**：在 `PathBoundary.BuildViolationMessage`（`:252-260`）**返回文本里**增一句指路「或用 `RequestSandboxElevation` 申请临时关闭沙箱（需用户同意）」。**只改文案字符串、不碰判定逻辑** ⇒ 与 08:28「不插入原有边界」不冲突（那条边界是**逻辑**，文案不属于它）。**必要性**：不加 ⇒ agent 不知有此工具，链路永远走不到。
  - **③ 归一四句更新**：目标 / 实现路线（新增独立工具 + 独立弹窗、原边界一行不动）/ **工具形态（无参数，08:48）** / 渠道（文字审批）。
  - **④ 已知取舍（记入 §3.8）**：无参数 ⇒ 用户在弹窗/消息里**看不到 agent 具体想访问哪**，只能就「关不关沙箱」表态；换来的是链路极简 + 路径不经过不可信文本。
  - **文档**：`S-207.md` 全文重写 —— 标题改「申请临时关闭沙箱（**无参数**）」；§3.2 加「**入参**」行（空 schema）；§3.3 链路 ② 改无参；§3.6 改为「**08:48 已定：加**」；§3.8 加已知取舍；§四 落点第 12 项转定案；§五 **七项 → 六项**（去掉越界文案项）；§六 16 条验收（第 1 条加「错误文本含指路句」）；§七 十二条非目标（新增「工具不带参数」、末尾「不碰 `channel-cancel-commands.ts`」）。
- **08:53** **S-207 §五 六项实现细节全部定案（老大原话：「我看到你列出来这些东西不需要裁决，都是你自己可以做主的东西，暂不开工」）** —— 这些是工程细节，不该上呈 ⇒ **老郑定案**：
  - **① 工具名** = **`RequestSandboxElevation`**（无参 ⇒ 不带 `Path` 字样）；
  - **② 豁免时长** = **固定 1 小时**（老大 18:02 已给「比如放行 1 小时」）；
  - **③ 恢复机制** = **倒计时 + 到期自动恢复 + 手动立即恢复，三条全要**；
  - **④ 文案** = 双端**同一句**「Agent 申请临时关闭沙箱 1 小时，是否同意？」，渠道附「回复同意 / 拒绝，10 分钟未回复将自动拒绝」；
  - **⑤ 子 agent** = **不给**（`excludedScopes: UnattendedRoles`）；
  - **⑥ 渠道复用** = **(a) 复用 `channel-shell-approval.ts`，提示文案参数化**；**模块不改名**，仅文件头补注「已是通用工具审批、非仅 shell」；(b) 并行模块**否决**（会破 `pendingBySession` 的每会话单待审批）。
  - **状态**：S-207 **仍待开工**（老大 08:53 明确「暂不开工」）；**无待上呈项**。
  - **文档**：`S-207.md` §五 标题改「实现决策（**已定案**，08:53 老大授权自主裁定）」+ 逐项写"定案 / 理由"；§3.5 改定案口径；§3 页顶状态行与 §八 状态行同步；`plan.md` / `raw-requirements.md` 的 S-207 行去掉「待裁定」措辞。
- **08:58** **S-206 冲突处置口径变更（老大原话：「真打架 保动画，扫光最早做的目的就是觉得静态页面太素了」）** —— **推翻 2026-09-23 旧口径「真打架则保扫光」**。
  - **新口径**：首屏**背景动画优先**；`h1` 首屏文字扫光**让步，可撤可减弱**。理由（老大原话）：扫光最早的目的就是觉得静态页面太素 —— 背景动画接了这个班，扫光的历史使命完成。
  - **撤销范围（已逐处摸过）**：**首屏文字扫光**共 2 组 3 处 —— ①`.shine` / `.shine-muted`（`index.css:391-415`；`hero.tsx:12` 的 `className="shine shine-muted"`）；②`.hero-shine` + `.hero-shine::after`（`index.css:426-449`）；③`data-text` 属性（`hero.tsx:17` —— `::after` 的 `content: attr(data-text)` 靠它取字，`hero.tsx:14-15` 注释已标「两处得同步改」）；配套 `prefers-reduced-motion` 条（`index.css:469-478`）随清。
  - **⚠️ 不在撤销范围（关键区分）**：**下载按钮扫光 `.dl-shine` + 旋转描边环 `.dl-current`**（`index.css:594-691` / `download-buttons.tsx:67-68`）—— 在按钮胶囊内（`inset:2px` + `overflow:hidden`），与首屏背景**不同面、不叠加**，且 `:599-600` 注释写明只为「能下的那个平台」服务 ⇒ **照旧保留**。`reveal`（进场动画）同样不动（进场 ≠ 背景）。
  - **文档**：`S-206.md` —— §五 冲突预警段升级为 **§5.1「冲突处置已定：保动画，扫光让步」**（含精确撤销范围表 + 两项不在范围内 + 明写「覆盖 09-23 旧口径」）；§一 现状表「现有动效」行加撤销提示；§四 两行落点补撤销动作与行号；§六 验收补第 8、9 条；§七 非目标补第 6、7 条；页顶状态行与 §八 同步。
- **09:01** **S-205 外部文案建议已评审（老大原话：「205的 这是我让其它agent提供的一点建议」）** —— 老大转来另一 agent 的文案建议（主标题 4 组备选 + Hero 三版 + 分模块优化 + 语气建议），**逐条对账后落 `S-205.md` 新增 §七**。
  - **★ 事实核查（先查证再判断）**：建议的事实面**无幻觉** —— ①Agnes **真实存在**（`providers/agnes.ts:3-11`，`builtinId:'agnes'`，`apihub.agnes-ai.com`，`badge:'free'`）、商汤日日新 = `sensenova`（同 `badge:'free'`，`provider-recommendations.ts:20-22`）；②六套主题**属实**（`settings.json` `presets`，`site.ts:103` 注释指向）；③内置免费对话站点属实且**建议漏了一家** —— 除 DeepSeek / Kimi / 元宝 / 豆包外还有**智谱清言**（`settings-store.ts:35-38`，`site.ts:187` 已列全五家）。
  - **✅ 采纳 8 条**：主标题强化「在你电脑上」/「动嘴的是你，动手的是它」/「模型你选，钱你说了算，活它来干」/ FAQ「我的文件会上传吗？」/「我能接哪家？」/「现在能放心用吗？」/「它能干什么」加一句话总结 / 四步精简。
  - **△ 改造 4 条**：「装好填 Key 派活三步」的 **"填 Key" 须弱化**（撞红线②）/ 「心之所向，它替你动手」降为 slogan / Hero 版本 A 只取句式 / 「先白嫖，再干活」见下。
  - **❌ 否决 6 条**：① FAQ「**免费对话是降级入口吗？**」—— **自曝负面词**（现答案 `site.ts:211` 本在**否认**"降级入口"，提到问题里等于自贴标签）；② FAQ「**它不是给程序员用的？**」—— **自贴"程序员工具"标签**（红线②），正解是问「我要懂技术才能用吗？」；③ FAQ「**Mac 和 Linux 什么时候有？**」—— 「什么时候」暗示时间承诺，与 `site.ts:221` 冲突；④「心想，它动」信息量为零；⑤ Hero 版本 C（又用被 §一 判弱的「不是聊天玩具」，且「住在我电脑里」不准确 —— 非常驻服务）；⑥ 用「六套主题…」**替换**现版是**降级**（丢六个主题名 + 「左管会话右干活」）。
  - **★★ 建议漏掉的两处既有红线违规（比"度"更该管，见 §7.3）**：`site.ts:85`「…**不像 Codex 这类工具**要装环境、改配置文件」+ `site.ts:216-217`「和 **Cursor / Claude Code** 有什么区别？」「**它们是给程序员的编程工具**」—— **碰瓷竞品 + 提拔竞品名**，属红线②的直接违反（与 `site.ts:46-47` 自记的教训同源，没清干净）。**S-205 开工时一并清掉。**
  - **⚠️ 唯一上呈项（§7.4）**：**「白嫖」进不进官网** —— 事实与语义都没问题，但官网是**已过 ICP + 公安备案的正式对外站**，俚语进正式面有观感风险。我的倾向：**Hero / 区块标题不用，正文或次级小标题可用**，或换「先不花钱，再动手」；**最终听老大的**。
  - **★ 总原则（§7.5）**：否决 6 条与 §7.3 两处**指向同一件事** —— 现文案弱在**以否定立论**（「不是聊天玩具」「不是只会在对话框里聊天」「和 XX 有什么区别」）⇒ 开工时**把"不是什么"全部改写成"是什么"**。
  - **文档**：`S-205.md` 新增 **§七「候选文案素材与评审」**（7.1 事实核查 / 7.2 逐条评审 / 7.3 漏掉的红线违规 / 7.4 「白嫖」待定 / 7.5 与 §一 的关系），原 §七「登记回执」顺延为 **§八**；页顶状态行与 §八 同步。
- **09:05** **S-205 「白嫖」定案可用 + 写作准则放宽（老大原话：「可以有白嫖字，这个不算红线，总要说些现在的人爱听的，而不是我们之前纯介绍」）** —— **并纠正我 09:01 的自设限制**：我把「官网是备案正式站 ⇒ 不能用俚语」当成了红线（§7.4 原写「唯一上呈项 / 观感风险」），**老大明确这不是红线**。
  - **定案**：「**先白嫖，再干活**」**直接采纳**（§7.2 由 △ 转 ✅）。
  - **★ 准则放宽（说服力 > 端庄）**：「**总要说些现在的人爱听的，而不是我们之前纯介绍**」⇒ **允许用当下流行的口语 / 网络词**，判据是「**人爱听**」，**不是「正式」**；**红线只有 §四-2 那两条（不写成程序员工具 / 不碰瓷大厂）+ 合规面（不虚假宣传）**，**不自行扩大红线范围**。已补入 `S-205.md` §四 写作准则**第 5 条**。
  - **文档**：`S-205.md` §7.4 改为「**✅ 可用（定案）**」+ §7.2 表格转 ✅ + §四 加第 5 条 + §八 状态行去掉「白嫖待定」字样。

## 2026-10-19 —— 官网首屏收尾定案（S-205 / S-206）+ S-207 真机验证与验证期修复

### 官网侧：S-205 / S-206 收尾定案（提交 `502b1c5f`，11:51）

> 这一轮先在另一会话推进，**模型调用超时**，转到本会话继续。老大当时逐条给的口径如下，**六处改写了 `S-205.md` / `S-206.md` / `plan.md` 里已写的定案**，特此记账 —— 阶段六验证必须按本节判据，不能照旧稿判「不合格」。

- **11:20** **首屏主标题改写**（老大原话：「**你说一句，它去把活干完** 这个标题改成 **你提需求，它跑全程**」）。⇒ 逆转 S-205 原定案「首屏主标题按裁定不动」（`plan.md:34`）。
- **11:24** **首屏描述最后一句调整 + 价格表述整体移出首屏**（老大原话：「首屏描述 最后一句需要调整一下 —— 装完就能用，不花钱：问问题、搜本地文件、快捷启动软件、剪贴板增强。它跑在你自己的电脑上，真动手：读写文件、执行命令、开浏览器、操作桌面软件。要它干重活，接一家服务商——接上之后，你提需求，它跑全程。」「**不想在首屏介绍上还在纠结价格，下面的不花钱已经够了**」）。⇒ 首屏只留「装完就能用，不花钱」一句，重度层的费用口径全部下沉到价值阶梯。
- **11:26** **重度层文案重写**（老大原话：「重度层 **软件不收费，花费透明** …… 这个文案也需要调整」⇒ 定稿「服务商自己选，Key 自己填，费用直接付给服务商；内置用量统计，账单看得见」）。
- **11:28** **价值阶梯三列费用统一上色**（老大原话：「不花钱，也能用起来 这里的重度层 **软件不收费，花费透明** 这句话跟前面的 **完全不花钱** 一样 都给上颜色啊，不知道还以为心虚呢」）。⇒ 逆转 S-205 原定案「不改配色」（`S-205.md:97` §六-1）：三列费用统一琥珀，重度层不再单独降灰。
- **11:30** **背景动画铺开**（老大原话：「本地跑起来 我看看效果」⇒ 看过之后定案）。落地 = ① 整站暖色雾 `site-mist` 挂三张页面；② 首屏光束收束层 `converge-streams`（**canvas**，注释写明「纯 CSS/SVG 做不出螺旋与尾迹」，逆转 S-206 §五「技术路线 CSS+SVG」）；③ 顶栏首屏透明、滚动后回玻璃底（逆转 `S-206.md:63` §4.2-3「不动 SiteHeader」）。**「只 Hero」随之收窄为「收束层只首屏、雾层整站」**。
- **11:32** **发布范围**（老大原话：「发布官网，**只是发布官网哈**」）⇒ 本次只发官网，不含软件包。
- **11:51** 提交 `502b1c5f`「首屏文案调整与整站背景动画层铺开」，10 个文件 / +377 −113。

### 软件侧：S-207 真机验证与验证期修复

- **19:55** **S-207 真机一跑就挂：`CannotWritePropertyWithinArray, None`**（老大原话：「我给你说的意思就是让你改啊，我正在进行测试」）。现象：调用 `RequestSandboxElevation` 15 ms 内失败，弹窗不出现。**根因**：`SandboxElevationExecutor.BuildRequest` 用 `WorkerJsonHelper.BuildJsonElement(writer => …)` 时**漏写 `WriteStartObject()` / `WriteEndObject()`**，第一个 token 就是属性名，`Utf8JsonWriter` 抛 `InvalidOperationException`；发布包 AOT 剪掉 System.Text.Json 的资源串，消息退化成「资源键 + 参数」，日志里只剩 `CannotWritePropertyWithinArray, None`。用 net10.0 临时探针复现出原报错原文（探针用后即删）；旁证：全仓 40+ 处 `BuildJsonElement` 调用点里只有这一处漏外壳。**⇒ 缺外壳必抛，S-207 的反向请求链路此前从未真正跑通过。** 修法：`BuildRequest` 首尾补 `WriteStartObject()` / `WriteEndObject()` + 注释说明外壳要自己写；`WishfulClaw.Agent` 单项目构建 0 警告 0 错误。
- **20:00** **S-207 端到端真机通过**（老大原话：「S207 刚刚测试通过了，但是临时关闭生效以后 显示的提示条位置不太对 1.放左上角 2.边距怎么自己乱来了，没有跟其它的合拍」）。越界 → 指路语 → 模型调用 → 独立弹窗 → 批准 → 进程级豁免生效，**整条链路第一次真机跑通**。
- **20:01** **提示条改挂聊天窗左上角**（老大原话：「放到聊天窗左上角，现在输入框上方需要显示的东西太多了」）。`SandboxElevationChip` 撤出 `InputArea/index.tsx`（原先插在 `SessionTodoPanel` 之后），改挂 `SessionConversationPane.tsx` 消息区左上角 `absolute left-3 top-3 z-30`，与右上角悬浮操作块同一套边距 / 层级；组件加 `className` 参数，只负责胶囊外观。**已知取舍**：① 可能与第一条消息顶部重叠；② 浮动聊天窗（设置页小窗）不再显示该提示。
- **20:06** **文档状态同步**（老大原话：「目前都测试过了，你更新一下文档状态」）—— `S-207.md`：页顶状态改 **已实施 + 真机验证通过（2026-10-19）**；§9.4-1 由「端到端手点未做」改记已通并列仍未验子项；§9.4-2 记 chip 两轮落点变化；新增 **§9.5 验证期缺陷与修复**（请求包序列化 / 提示条位置各一条）；§9.1 文件表同步（chip 67 行、`SessionConversationPane.tsx` 新挂载点、`SandboxElevationExecutor.cs` 修复）。`plan.md`：加 2026-10-19 当前状态段、S-207 行状态同步。
- **S-207 仍未验**：1 小时自然到期自动消失、点「恢复」后 Worker 侧清零再越界被拦、渠道文字往返观感。

## 2026-10-20 —— S-208 补充裁定（时间 + 执行状态 + 数据/显示分层）

- **08:21** **老大提两个场景之分**（原话：「S-208 消息 和摘要的数据有携带时间没有。我担心的效果如下，用户发送了一条消息，5分钟后触发了压缩，这时候 agent 正常判断是以摘要为准了，因为已经过去执行过多轮了。虽然 208 的首要目的是 用户发送消息 立即触发压缩，导致用户消息比重被无限降低。**这是两种不同的场景**」）。
  **查证结论**：`AgentRuntimeChatMessage`（`Models/ConversationModels.cs:17-25`）**无任何时间字段**，DB 的 `MessageEntity.CreatedAt` 转进 agent 上下文即丢；摘要提示词（`ContextCompression.cs:74-91`）与 `RenderTranscript`（`ContextCompression.Transcript.cs:62-103`）也都不含时间。**唯一现成时间源**是 `InjectTransientPrefix`（`AgentLoop.Helpers.cs:344-351`）永久前置进用户消息的 `<current_time>` 块。⇒ 模型手里有「那条消息几点发的」，**没有「现在几点」**，算不出间隔。
- **08:26** **老大给方案**（原话：「我的方案很简单就是这里加上时间 用户的消息时间 以及压缩时刻的时间」）。评估后补充：**光加时间分不开场景 B 内部的两种** —— 08:05 发话→08:05:20 答完→08:10 压缩（差 5 分钟，已交卷，该降级）与 08:05 发话→跑 10 分钟测试→08:15 压缩（差 10 分钟，仍在跑，绝不能降级），量级一样、结论相反。⇒ **时间 + 执行状态一起给**，状态按结构判定（那条消息之后有没有 `ToolUses.Count == 0` 的最终答复）。
- **08:28** **快照不能撤**（老大原话：「问题是压缩后 用户的消息也会不见了，上下文里面只有压缩摘要了」）。复核四种情况后认账：自动压缩尾巴预算内 `minKeep = 2` 保住最后 2 条（`ContextCompression.cs:470`）；已执行若干轮后滑出预算的会被切；**单条超 `MaxPinnedFirstUserTokens = 1500` 的消息直接归 fold**（`:54`、`:440-450`、`:498`）；**手动压缩 `preserveTail: false` 整条尾巴不保**（`:386`）。⇒ 摘要里的快照是后两条路的**唯一载体**，**不做「场景 B 就不加快照」的减法**。首版 §2.3 / §5.1 里「新消息永远在尾巴里」的断言就此**收窄**。
- **08:31** **★ 通用口径：数据 + 显示分层**（老大原话：「正常应该是数据+显示。给用户渲染的是显示。发给 agent 的是拼接后的数据+显示」，并明确嫌我「绕 `StripInjectedBlocks` 剥来剥去」太复杂）。
  ⇒ **既要模型读得懂、又要卡片干净，正确解法不是在字符串上擦，是分层**：
  - **数据**：`AgentRuntimeChatMessage` 加 `OriginalText`（干净原文）与 `SentAt`（发送时刻），由 `InjectTransientPrefix` 盖戳时落。
  - **显示**：时间 / 状态进 `meta.compactSummary` 结构化字段，渲染端读 meta（沿用 `meta.summarizerFailed` 既有模式），不解析正文。
  - **发给 agent**：正文仍是拼接结果（原话 + 时间 + 状态 + 摘要）。
  **本条口径适用于后续所有需求**，不只 S-208。
- **实施落地**：4 个后端文件（`ConversationModels.cs` / `AgentLoop.Helpers.cs` / `ContextCompression.cs` / `ContextCompression.TokenEstimation.cs`）+ 2 个渲染端文件（`lib/agent/context-compression.ts` / `lib/api/types.ts`）。门禁 `dotnet build` 0/0、TS 三配置 0 错、`npm test` 72/72。详见 `requirements/S-208.md` §5.7 + §九。

## 2026-10-20 —— 阶段五审查（第二轮）与收尾修复

第二轮审查范围 `00dcf7db..96c8fa3d`，两支线各审一遍：官网面 ❌ 0 / ⚠️ 12，软件面 ❌ 1 / ⚠️ 8。全文见 `review_report.md` 第二节。

### 软件面

- **B1（唯一必修，❌）** **快照剥离按空行切块 ⇒ 用户消息含空行就漏字**。`getCompactSummaryDisplayText` 靠「逐块看前缀」剥 S-208 的快照块，而 `splitCompactSummaryBlocks` 正是按空行切的：用户粘多段文本时，块 1 是「第二段」⇒ 不以前缀开头 ⇒ 循环停下 ⇒ 后半段 + 整块压缩时刻一起漏回卡片。单段能过纯属块数巧合。
  ⇒ 改用 Worker 写死的收束句 `以上为压缩时刻的快照；此后用户若再有消息，以对话中最新消息为准。` 作结束锚点，一次剥到位；认不出锚点就原样返回（旧摘要没有这一段，猜位置截断会吃正文）。
  ⇒ 顺带把显示链路拆出 `src/renderer/src/lib/agent/context-compression-display.ts`：纯模块、不 import IPC —— 原文件顶层依赖 `agent-bridge-streaming`，这正是该函数长期零覆盖的原因。主函数改名 `getCompactSummaryDisplayTextWith(message, t)`，`t` 由调用方注入。
  ⇒ 新增 `tests/compaction-snapshot-display/`（script `test:compaction-snapshot-display`，esbuild + node，同 `test:token-format` 形态），**10 用例全过**，含「多段用户消息不漏字」「多段原文 + 多段摘要」「旧摘要无快照原样返回」。
- **3.1 S-208 显示面补落地**：裁定 3 的 `compactedAt` / `latestUserSentAt` / `latestUserState` 此前全仓只有类型声明，卡片零消费。⇒ `ContextCompressionMessage.tsx` 展开区加「压缩时刻 / 用户发言时刻 / 当时状态」三行，`LATEST_USER_STATE_KEYS` 把 Worker 中文字面量映射到 i18n 键；zh/en `agent.json` 各补 6 键。
- **09:58 真机回看后调整**（老大原话：「这个当时正在执行中是什么东西」→ 讲清口径后「按照这个调整下」）：**卡片删掉第三段，只留「压缩于 / 你上次发言」两个时刻**。理由 = 状态记的是压缩那一刻的事实，卡片不随 run 跑完更新，答完仍写「正在执行中」像在骗人；它存在的意义是给模型区分「正在跑的活」与「刚下的指令」，用户自己知道自己在干什么。落地 = 渲染端去掉 `latestUserState` 与 `LATEST_USER_STATE_KEYS` 映射，zh/en 各删 4 键；**数据面不动**（`meta.compactSummary.latestUserState` 与摘要正文的【压缩时刻】块照旧给模型）。门禁 typecheck 0 错 / `npm test` 73/73（i18n-coverage 过）。
- **3.2 批准侧补审计**：`SandboxElevationStore.Grant()` 无日志而「恢复」有。⇒ `SandboxElevationExecutor` 批准后记 `session / run / until / reason`。
- **3.3 沙箱状态与提示词口径拉平**：提示词按 run 开头构建（`sandboxEnabled` 进 cacheKey），批准后仍写「沙箱开着」，与 `PathBoundary.IsEnabled` 实时豁免打架。⇒ 新建 `AgentLoop.SandboxTransition.cs`，每轮 provider 调用前比对实时状态，变了才注入一条临时提示（不落库、不进 durable conversation，同 `InjectSessionTodo` 手法）。
- **3.4 `BuildJsonElement` 约定补进文档**：`WorkerResponse.cs:146-149` `<remarks>` 写明「回调拥有整个文档形状，本助手不替你开 object/array；不给外壳会在首个属性名抛 `InvalidOperationException`，AOT 裁剪后退化成 `CannotWritePropertyWithinArray, None`」；`JsonHelpers` 套件加「回调只写属性名必须抛」用例（24→28）；`SandboxElevationExecutor.BuildRequest` 改 `internal` + `SandboxPath` 套件加形状用例（14→20）。
- **3.5 沙箱审批文案 i18n**：弹窗 / 渠道 summary / 倒计时 / 恢复 toast 全硬编码中文，「1 小时」三处独立硬编码。⇒ 统一走 `agent` 命名空间 `sandboxElevation` 段（zh/en 各 11 键）；时长由 `SANDBOX_ELEVATION_DURATION_MS` 推、审批超时由 `SHELL_APPROVAL_TIMEOUT_MS` 推；`grantLocal(_approved: boolean)` 的未用参数去掉。
- **3.6 S-209 空轮不落库**：`conversation.Add(turn.AssistantMessage)` 早于催办判定 ⇒ 催办 2 次留 2–3 条 `Text == ""` 的 assistant 落库。⇒ 判定块前移，空轮直接 `continue`，真实产出（正式答复 / 带工具调用）在判定之后统一写入。
- **3.8 超长文件拆分与豁免头**：`ContextCompression.cs` 1056 行无豁免头。⇒ 快照逻辑抽到 `ContextCompression.UserSnapshot.cs`（111 行），主文件降到 **936 行**并补豁免头；`ToolDispatchRouter.cs` 豁免头 573 → **633**（实测）；`AgentLoop.cs` 补豁免头（**755**）。

### 官网面

- **⚠️1 定案被逆转但 changelog 零记录** ⇒ 本文件上一节补 6 条（首屏主标题 / 删价格表述 / 重度层改口径 / 三列统一上色 / 动画铺开 / 只发官网）。
- **⚠️2 README 与官网 hero 不同源**（违反 S-205 判据 2）⇒ `README.md:4-5` 改「你提需求，它跑全程」+ 与 `site.ts` 同源简介行。
- **⚠️7 注释漂移** ⇒ `converge-streams.tsx` 三处、`advantages.tsx`、`App.tsx` 共五处按当前实现重写。
- **⚠️11 `S-205.md:297` 数字漂移** ⇒ 按实测改为「3 行注释」「`site.ts` 13 处」。
- **⚠️6/⚠️7 渲染开销** ⇒ `converge-streams.tsx` 加 `IntersectionObserver`（滚出视口即 `stop()`）、`ResizeObserver` 加尺寸守卫、每帧模板字符串改按 `(颜色, alpha 档)` 缓存。
- **未动（等老大拍板）**：⚠️3 `site.ts:61`「搜本地文件」实况需另装 Everything；⚠️4「它跑全程」是否贴近禁写的「全自动无人值守」；⚠️5 README `✨`/`💾`/`❓` 三节开场是否同步新调性。
- **未动（观感参数）**：⚠️8 粒子下限 36、⚠️9 `color-mix()` 无 `@supports` 降级、⚠️10 `site-header` backdrop-filter 瞬切、⚠️12 标点排版 + `index.css` 695 行超标 —— 改的是观感，等真机看完再定。

### 门禁（修复后实测）

`dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误 / `dotnet build tests\WishfulClaw.Tests.sln` 0/0 / `npm run typecheck` 退出 0 / `npm test` **73/73** / `cd website; npm run build` 退出 0。

### 收尾刀之后的补做：500 行豁免头（老大 09:16 追问「文件超限处理了没」）

第一轮审查 W7 报了 4 个文件无有效豁免头，收尾刀只补了 C# 三个，`session-slice.ts` 漏了、`index.css` 与 `types.ts` 也没算进去。复核本迭代**改动过**的越线文件实际是 **7 个**，全部补齐（详见 `review_report.md` §W7 处置结果）：

- `session-slice.ts` 1103 / `db-helpers.ts` 712 / `types.ts` 525 / `index.css` 699 —— 补豁免头（分别按「高度内聚 store」「高度内聚」「单一数据对象」「同质数据」）。
- `ContextCompression.cs` 豁免头原写 936 实际 **949** —— 订正（当时是按预估值写的）。
- `AgentLoop.cs` 豁免头挂在 `namespace` 之后，不算文件头 ⇒ 移到第 1 行，755 实测相符。
- `ToolDispatchRouter.cs` 633 相符，未动。
- **tech-debt 记账**：`session-slice.ts`（按职责拆 slice 组合）、`db-helpers.ts`（按表拆四模块）需要改多个调用方 import，留给专门拆分需求。

### 10:03 登记 S-210：折叠收尾要显示真实原因

- 老大原话：「目前我们聊天窗 在用户终止执行或者 触发压缩后，之前的执行过程会折叠 并且显示一个固定值 任务暂告一段落 作为总结。这个我希望登记一个需求，能实际显示是用户取消执行，触发压缩等实际情况」。
- 定性 **体验优化**，软件侧，预计零后端改动。**本轮只登记，不动代码。**
- 排查坐实：显示点 `content-renderer.tsx:501-505` 写死 `assistantMessage.executionPaused`；原因是**中间层没有落点** —— `MessageMeta`（`lib/api/types.ts:384-392`）无结束原因字段，`loop_end.reason` 只用于通知与队列收尾、用完即弃，落库也无此字段。
- 修法方向：`MessageMeta` 加 `runEnd: { reason, at }`（`db-helpers.ts` 整体展开 `meta` ⇒ 零 DB schema 改动），显示侧 reason → i18n 键抽成**不 import IPC 的纯函数**（B1 教训），`executionPaused` 保留作老消息兜底。
- **§六 三问待实施前答**：①压缩场景究竟命中「压缩轮无正文」还是「重建窗口后正文被移出」，必须真机复现；②`aborted` 是否区分「点停止」与「插消息打断」（默认不区分，区分要加 Worker 侧 reason 值）；③文案是否带步数（默认不加，折叠块标题已显示工具数）。

### 10:07 登记 S-211：渠道入站图片被丢在渲染端边界

- 老大原话：「渠道入站图片不保留 … 微信渠道发图，Agent 拿不到图片内容，只收到占位符 … 之前我们只处理了聊天窗发送图片，渠道发送的现在也有这个问题」。
- 定性 **bug**，软件侧，零 Worker 改动。
- **根因钉死（不是回归）**：上游微信 / 飞书**都下载了图片**（`weixin-service.ts:390-414` / `feishu-service.ts:194`），`auto-reply.ts:251-257` 也把 `images` 带进了 task payload；断在 `use-channel-auto-reply.ts:255-258` —— `sendMessage` 只收到字符串 `content`，**`task.images` 全文件只在第 48 行类型声明里出现过，从未被读取** ⇒ DB `content` 是占位符、`meta` 长度为 0、无文件落盘，与老大实测完全对得上。聊天窗走 `ImageBlock`（`types.ts:100-112`）所以能用。
- 主修 = 拼 `ImageBlock` 走既有多模态链路，渲染 / 落库 / 模型三侧零新造。老大提的「落盘记路径」「取入站附件能力」不解决本 bug（属另一层优化），单独排。
- **§五 三问**：①base64 直入 `meta` 的 DB 膨胀现在处理还是记 tech-debt（默认后者）②QQ 是否一并补下载（`parse-ws-message.ts:65` 连下载都没做，默认一并补）③`task.audio` 同为死负载是否一并查（默认不碰）。
- **历史两条消息不可回补** —— 图片字节在内存里已销毁。

### 10:22 S-210 根因重定：不是「不读结束原因」，是聊天窗把正文吞了

- 老大 10:14 原话：「210 的问题需要排查，这个是聊天窗口的显示」。
- **重查方法**：拿正式库 `~/.wishful-claw/index.db` 最近 800 条 assistant，按渲染链逐步复刻 —— `meta.segments` → `buildChatMessageContent` → `renderItems` → `splitProcessAndFinal`，统计哪些会落到「`finalItems` 空 + 有工具」分支。
- **实测结论**：**会显示灰字 83 条，83 条全部在 DB 里都有正文（text 列非空）**。首版登记的「这轮没说话所以显示固定值」不成立。
- **真凶**：`components/chat/AssistantMessage/process-summary.ts:144-182` 的切分口径 —— 从尾部跳过 text/image，遇到第一个过程项就切，于是**只有「最后一个过程项之后的文字」算最终答复**。消息以 `tool_use` / `thinking` / `tool_result` 结尾时切点落在末尾，**整条消息的所有文字被归进 `processItems` 折进过程块**，外面没正文，`content-renderer.tsx:499-505` 用固定灰字兜底。
- **为什么「中止 / 压缩」时最明显**：中止时最后一步几乎总是工具调用（没有收尾文字）⇒ 必然命中。**与结束原因无因果** —— 结束原因只是另一个可改进点。
- **为什么刷新也不好**：落库消息 `meta.content` 为数组的 **0 条**，全靠 `meta.segments`；`buildChatMessageContent:43-53` 在每个 `tool_use` 段后补一个内联 `tool_result` 块，它天然成为切点 ⇒ 重新加载照样命中。
- **修法拆两半**：①情况 A（83/83）= `finalItems` 空但过程里有 text ⇒ 回填最后一段连续 text 当正文，**不再显示任何「暂告一段落」**；②情况 B（真·一个字没说）⇒ 才显示结束原因，按 `runEnd.reason` 分文案（`MessageMeta` 加字段，零 DB schema 改动）。探针留在 `.wishful-claw/notes/probe-s210-display.js`（已被 gitignore）。


### 10:10 渠道拆分：S-211 收敛为共用断点，另立 S-212（QQ）/ S-213（钉钉）

- 老大原话：「所有渠道的都需要，可以不同渠道登记不同的需求」。
- **全量核查 8 个 provider** 后的结论：有入站实现的只有 **4 个**（微信 / 飞书 / QQ / 钉钉）；**Discord / Telegram / 企业微信 / WhatsApp 是纯发送桩**（只有 `sendMessage` / `getGroupMessages` 空实现，连 `incoming_message` 都不发）⇒ 它们的「入站图片」是伪命题，该补的是入站本身，属另一类需求，**本轮未登记，待老大定**。
- **S-211 收敛**：只做渲染端共用断点（`use-channel-auto-reply.ts:255-258` 不消费 `task.images`），一次修好**微信 + 飞书**（两者都已在服务层下载成 base64）。原 §五.2「QQ 一并补」作废，改指 S-212。
- **S-212（QQ）**：`qq/parse-ws-message.ts:57-69` 只读 `content_type` 挑占位符文案，`attachments[].url` 丢弃，从不下载。修法 = 解析层填瞬态 `mediaRefs`（保持纯同步、可单测）+ `qq-service.ts:364-372` emit 前下载成 base64，形状照抄微信；URL 有时效必须即时下。
- **S-213（钉钉）**：比 QQ 更彻底 —— `dingtalk-service.ts:160-178` 只解 `payload.text.content`，**`msgtype` 在钉钉 provider 里从未被读取**，图片消息解析出空串后被 `:178 if (!content) return` **静默丢弃**（不是占位符，是消息整个消失）；`dingtalk-api.ts` 也无媒体下载方法。修法 = 按 `msgtype` 分派（未知类型也出占位符）+ 新增 `downloadMedia`；**实施前必须先实测下载接口权限**。
- 三条互不越界：后两条只负责把 `images` 填好，渲染端消费统一归 S-211。**Worker 侧三条全零改动。**

### 10:52 后 登记 S-214：设置页「关于」删掉重复的「使用指引」板块

- 老大原话：「设置页的关于，里面的使用指引板块删掉，访问官网实际上就能去查看指引，官网的描述需要改一下」。
- 定性 **体验优化**，软件侧（渲染端），零 Worker 改动。**本轮只登记，不动代码。**
- **重复性坐实**：设置页「关于」的 `官网` 与 `使用指引` 两块指向**同一站点的两个 path** —— `openWebsite()` → `https://wishful-claw.work`，`openUserGuide()` → `${WEBSITE_URL}/guide`；而官网站点顶栏第一项就是「使用指引」（`website/src/content/site.ts:75`）⇒ 设置页这块是重复入口，两个外形一样的按钮并排放着纯噪音。成因是 S-160 把指引从仓库 `docs/user-guide.md` 迁到官网 `/guide` 时为老用户留的一键入口，迁完没人回看。
- **删点**：`components/settings/SettingsPage.tsx:355-369` 整个 `SettingsSection id="sec-about-guide"`。
- **描述改动（本需求的价值点）**：少一个按钮不能让人觉得指引没了 ⇒ 把「官网」区块描述改成指引入口，`about.website.desc` 由「下载安装包、查看使用指引与更新日志」改为把「使用指引」放句首的写法（zh / en 同步）。另 `settings.nav.about.desc` 原写「产品介绍、使用指引与应用更新」，板块删后是对不存在内容的承诺，默认改成「产品介绍、官网与应用更新」。
- **死代码**：全量 grep 后 `openUserGuide` / `USER_GUIDE_URL` 引用点仅 `user-guide.ts:13,15` + `SettingsPage.tsx:19,364` ⇒ 删板块后零调用，一并删；`WEBSITE_URL` / `WEBSITE_HOST` / `openWebsite` 保留。`:7-12` 那段「指引指向官网而非 GitHub blob」的注释结论搬进 `openWebsite` 注释，防止以后又把入口加回来。
- **官网侧不动**：`/guide` 正文（`guide-page.tsx` eyebrow / title / description）、`guide-nav.ts`、`user-guide.md`、顶栏「使用指引」全部保留。
- **§五.1 待确认一句**：「官网的描述需要改一下」按**设置页「关于 → 官网」区块描述**理解（主口径，`settings.json:868` zh/en）；备选口径是官网 `/guide` 首屏 `description`（`guide-page.tsx:43`）。**两者差一个文件，实施时确认一句即可，不影响其余改动。**

### 2026-10-20 阶段二~四：按 `docs/dev-workflow.md` 推进 S-210 ~ S-214（五刀落地）

- **开工前核实**：工作区未提交改动逐文件看过，S-210 那批（`run-end-label.ts` / `AgentLoopEndReasons.cs` / `tests/run-end-display`）是**完成态**（代码 + 协议 + 落库 + 渲染 + 专项测试齐全），非半成品。
- **刀 1 `7f58cb7c` S-210** —— `feat(chat): 折叠收尾照实显示这一轮的结束原因`，16 文件 +494 −25。提交前补两处 500 行豁免头：`content-renderer.tsx`（实测 533 行，单一渲染分派器）、`lib/tools/cron-runtime.ts`（实测 621 行，单一职责流水线）。`test:run-end-display` 通过、`typecheck` 0 错、`dotnet build` 两套 sln 0/0。
- **刀 2 `38e61a3d` S-214** —— 删 `sec-about-guide` 整块；`about.website.desc` zh「使用指引与更新日志都在官网上，安装包也从这里下」/ en 同步；`nav.about.desc` 去「使用指引」；删 `openUserGuide` / `USER_GUIDE_URL` 与 `about.guide.*`。**§五.1 按「设置页关于 → 官网区块描述」口径实施，官网 `/guide` 首屏未动**（备选口径仍待老大一句话确认）。
- **刀 3 `91fbbd7f` S-211** —— 新增 `lib/channel/inbound-content.ts`：无图原样返回字符串（零行为变化），有图拼 `[text, image…]`；`use-channel-auto-reply.ts` 消费 `task.images`。新增 `tests/inbound-content`。
- **刀 4 `49a27335` S-212** —— `ChannelIncomingMessageData` 加瞬态 `mediaRefs`；`parse-ws-message` 带出图片地址（最多前 5 张，类型判不出按扩展名、再判不出不猜）；新增 `qq/download-media.ts`（协议相对地址补 https、拒非 http 与内网地址、魔数嗅探、15s 超时 / 单张 10MB、逐张降级）；`qq-service` emit 前下载，全失败改写为 `download failed` 占位符。新增 `tests/qq-attachments`。
- **刀 5 `cf6e7649` S-213（解析层）** —— 新增 `dingtalk/parse-message.ts`：text / picture / file / voice / richText 分派，老版塞在 `text.content` 的结构化 JSON 转占位符，**未知类型也落占位符**（这才是「消息整个消失」的真修法）。新增 `tests/dingtalk-msgtype`。
- **S-213 下载层未做，卡 §五.1**：本地两份 `plugins.json`（`~/.wishful-claw`、`~/.wishful-claw-dev`）里钉钉 `appKey` / `appSecret` 均为空串、渠道 `enabled: false`，`downloadCode` 也需真实入站消息才产生 ⇒ **权限实测无法进行**，按派单口径不硬写，等老大给凭证后再接 `downloadMedia`。
- **门禁实测（本轮）**：`npm run typecheck` 0 错；`npm test` **77/77**（新增 `test:inbound-content` / `test:qq-attachments` / `test:dingtalk-msgtype` 三套）；`dotnet build` 两套 sln 各 0 警告 0 错误；`cd website; npm run build` 0 错。




