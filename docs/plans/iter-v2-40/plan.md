# iter-v2-40 迭代计划（总览）

> 承接 iter-v2-39（`v0.2.39`，2026-10-14 发布）之后的迭代。
> 分支 `dev/v2-iter-40` 已从 `main`（base `a3b966d5` = tag `v0.2.39`，39 收尾合并点）切出。
> 本文件 = 迭代总览（目标 / 需求索引 / 刀序 / 门禁基线）；需求正文见 `requirements/`，裁定流水见 `changelog.md`。

**当前状态（2026-10-20 10:52 后）：登记第 12 条需求 S-214 —— 设置页「关于」删掉独立的「使用指引」板块。** 老大原话：「设置页的关于，里面的使用指引板块删掉，访问官网实际上就能去查看指引，官网的描述需要改一下」。核查：**「官网」与「使用指引」两块指向同一站点的两个 path**（`openWebsite` → 站点根，`openUserGuide` → `/guide`），而官网站点顶栏第一项就是「使用指引」（`site.ts:75`）⇒ 设置页这块是**重复入口**，两个按钮并排放着纯噪音。修法 = 删 `SettingsPage.tsx:355-369`（`sec-about-guide`）+ **把「官网」区块描述改成指引入口**（「使用指引」放句首，这是本需求的实际价值点：少一个按钮但别让人觉得指引没了）+ 清死代码（`openUserGuide` / `USER_GUIDE_URL` 渲染端仅两处引用，删板块后零调用）+ zh / en 同步删 `about.guide.*`、改 `settings.nav.about.desc`（原文「产品介绍、使用指引与应用更新」会变成对不存在内容的承诺）。**§五.1 待确认一句**：「官网的描述需要改一下」我按**设置页「关于 → 官网」区块的描述**理解；备选口径是官网 `/guide` 首屏 description（`guide-page.tsx:43`），两者差一个文件、不影响其余改动。官网 `/guide` 正文、`guide-nav.ts`、顶栏「使用指引」**一律不动**。**软件侧，零 Worker 改动；本日只登记，不落码。** 见 [S-214.md](requirements/S-214.md)。

**当前状态（2026-10-20 10:22）：S-210 根因重定 —— 不是我首版登记的「不读结束原因」，是聊天窗把正文吞进了折叠块。** 老大 10:14「210 的问题需要排查，这个是聊天窗口的显示」后按渲染链复刻实测（正式库最近 800 条 assistant，`segments → buildChatMessageContent → renderItems → splitProcessAndFinal`）：**会显示灰字 83 条，83 条全部在 DB 里都有正文（text 列非空）**。真凶是 `process-summary.ts:144-182` 的切分口径 —— 只把「最后一个过程项之后的文字」算最终答复，于是**消息以工具 / thinking / tool_result 结尾时，整条消息的文字全被归进 `processItems` 折进过程块**，外面没正文可显示，`content-renderer.tsx:499-505` 拿固定灰字兜底。「中止执行 / 压缩」只是提高命中率的时机（中止时最后一步几乎总是工具），**跟结束原因没有因果**。另查明：落库消息 `meta.content` 数组为 0 条，全靠 `meta.segments`，而 `buildChatMessageContent:43-53` 在每个 `tool_use` 段后补一个 `tool_result` 块 ⇒ **刷新也不会好，一直都在**。⇒ **修法拆两半**：①**情况 A（83/83）**：`finalItems` 为空但过程里有 text 时，把最后一段连续 text 回填成正文，不再显示任何「暂告一段落」；②**情况 B（真·一个字没说）**：才显示结束原因，按 `runEnd.reason` 分文案（`MessageMeta` 加字段，零 schema 改动）。见 [S-210.md](requirements/S-210.md)。

**当前状态（2026-10-20 10:10）：渠道入站图片按渠道拆成三条（老大指令「所有渠道的都需要，可以不同渠道登记不同的需求」）。** 全量核查 8 个 provider 后坐实：**有入站实现的只有 4 个渠道** —— 微信、飞书、QQ、钉钉；Discord / Telegram / 企业微信 / WhatsApp **是纯发送桩**（`discord-service.ts` 之类只有 `sendMessage`，连 `incoming_message` 都不发）⇒ 它们的「入站图片」是伪命题，要补的是入站本身，属另一类需求，**未登记**。拆分结论：
- **S-211**（共用断点）= 渲染端 `use-channel-auto-reply.ts:255-258` 不消费 `task.images`。**微信 / 飞书**均已把图下载成 base64 带上，修这一处两条渠道一起好。
- **S-212**（QQ）= 解析层 `describeAttachments`（`parse-ws-message.ts:57-69`）只读 `content_type` 挑文案，**`attachments[].url` 直接丢掉**，从不下载。修法：解析层填瞬态 `mediaRefs`（保持纯同步可测）+ 服务层在 emit 前下载。
- **S-213**（钉钉）= **比 QQ 更彻底，整条消息消失** —— `dingtalk-service.ts:160-178` 只解 `payload.text.content`，`msgtype` 在钉钉 provider 里**从来没被读过**，图片消息解析出空串后被 `if (!content) return` 静默丢弃；`dingtalk-api.ts` 也没有任何媒体下载方法。修法：按 `msgtype` 分派 + 新增 `downloadMedia`（**实施前先实测 download 接口权限**）。
- 三条都**不碰对方**：后续两条只负责把 `images` 填好，渲染端消费统一归 S-211。**Worker 侧三条全零改动。**

**当前状态（2026-10-20 10:07）：登记第 9 条需求 S-211 —— 渠道入站图片在渲染端边界被丢弃，Agent 只看到占位符。** 老大实测：微信发图，DB 里 `content` = `[User sent an image]`（长度 20）、`meta` 长度 **0**、全域搜不到落盘文件。**根因已钉死**：上游微信 / 飞书都**确实下载了图片**（`weixin-service.ts:390-414` / `feishu-service.ts:194`）并把 base64 放进 `images`，`auto-reply.ts:251-257` 也照带不误；断在 `use-channel-auto-reply.ts:255-258` —— `messages: [{ role:'user', content }]` 只传字符串占位符，**`task.images` 全文件只在第 48 行类型声明里出现过，从未被读取**。聊天窗走 `ImageBlock`（`types.ts:100-112`）所以能用 ⇒ **不是渠道下载的问题，是一条通道没接上**。⇒ 结论：这功能**从未实现**，不是回归。修法主修 = 把 `images` 拼成 `ImageBlock` 走既有多模态链路（渲染 / 落库 / 模型三侧零新造）；老大提的「落盘记路径」「取入站附件能力」属另一层优化，不解决本 bug，单独排。**§五 三问**：①base64 直入 `meta` 的 DB 膨胀是否现在处理②QQ 是否一并补下载（`parse-ws-message.ts:65` 连下载都没做）③`task.audio` 同为死负载是否一并查。**历史两条不可回补**（图片字节已销毁）。见 [S-211.md](requirements/S-211.md)。

**当前状态（2026-10-20 10:03）：登记第 8 条需求 S-210 —— 折叠块下方那句写死的「任务暂告一段落」应显示真实结束原因。** 老大原话：用户终止执行或触发压缩后，过程折叠并显示固定值，希望「实际显示是用户取消执行、触发压缩等实际情况」。排查结论：**原因数据后端早就有**（`loop_end.reason` 四值 `completed` / `max_iterations` / `aborted` / `error`，`AgentLoop.cs:557` 等），**但中间层没有落点** —— `MessageMeta`（`lib/api/types.ts:384-392`）无结束原因字段，reason 只用于通知与队列收尾、用完即弃，落库也没它 ⇒ 切回 / 重启 / 压缩后永久丢失。修法按 S-208 已定的**数据 + 显示分层**：`MessageMeta` 加 `runEnd: { reason, at }`（`db-helpers.ts` 整体展开 `meta` ⇒ **零 schema 改动**），显示侧把 reason → 文案抽成不 import IPC 的纯函数（吸取 B1 教训，保证能被 node 测试覆盖）。**§六 三问待实施前答**：①压缩场景究竟命中「压缩轮无正文」还是「重建窗口后正文被移出」，**必须先真机复现**②`aborted` 是否要区分「点停止」与「插消息打断」③文案是否带步数（默认不加，折叠块标题已有）。**尚未开工，本日只登记。** 见 [S-210.md](requirements/S-210.md)。

**当前状态（2026-10-20 阶段五第二轮审查完成）：❌ 1 项已修 + ⚠️ 20 项已处置 / 记账。** 第二轮覆盖 `00dcf7db..96c8fa3d`，官网面与软件面各审一遍：官网 ❌ 0 / ⚠️ 12，软件 ❌ 1 / ⚠️ 8。**唯一必修 B1** —— 压缩卡片的快照剥离按空行切块，用户消息一含空行（粘多段文本）就漏字；已改用 Worker 写死的收束句作锚点，并把显示链路拆成不 import IPC 的纯模块（它此前零覆盖正是因为顶层依赖 `agent-bridge-streaming`），新增回归套件 10 用例。软件侧另修 3.1 显示层漏做 / 3.2 批准无审计 / 3.3 提示词与实际沙箱状态打架 / 3.5 审批文案未走 i18n / 3.6 催办空轮落库 / 3.8 超长文件拆分与豁免头；官网侧补 changelog 定案记录、README 首屏同源、注释漂移、`converge-streams` 渲染开销。**仍是三处待老大拍板**：`site.ts:61`「搜本地文件」口径、「它跑全程」是否贴禁写的「全自动无人值守」、README 三节开场是否同调。全文见 `review_report.md` 第二节。

**当前状态（2026-10-20 08:40）：S-208 按老大补充裁定修订完成，全部门禁通过。** 首版只覆盖「用户刚发消息就撞上压缩」；老大 08:21 指出**另一种时机**（发完消息跑了几分钟才压缩，此时该以摘要为准，而不是把老指令当当前指令）。修法在首版基础上补三件：①快照带**用户消息时刻 + 压缩时刻**；②带**执行状态三值**（未开始 / 执行中 / 已答复），按「那条消息之后有没有交卷的 assistant 轮」判定，不靠时间差推算；③**数据 + 显示分层** —— 原文存 `OriginalText`、时刻存 `SentAt`、显示信息进 `meta.compactSummary`，不在字符串上剥。**同时确认快照不能撤**：单条超 1500 token 的消息和手动压缩路径下，尾巴里没有原文，摘要是唯一载体。门禁 `dotnet build` 0/0、TS 三配置 0 错、`npm test` 72/72。**至此 7 条需求的实施全部完成**，S-208 真机压缩验证并入阶段六。见 `requirements/S-208.md` §5.7 + §九。

**当前状态（2026-10-19 20:00）：S-207 真机跑通端到端链路（老大原话「S207 刚刚测试通过了」）。** 越界 → 指路语 → 模型调用 `RequestSandboxElevation` → 独立弹窗 → 批准 → 进程级豁免生效，**这条反向请求链路本次才第一次真正跑通**。验证期暴露并修掉两处缺陷：① `SandboxElevationExecutor.BuildRequest` 漏写 `WriteStartObject()` / `WriteEndObject()`，AOT 剪裁后报 `CannotWritePropertyWithinArray, None`；② 倒计时提示条从输入框上方改挂**聊天窗左上角**（`SessionConversationPane.tsx`，`left-3 top-3 z-30`，与右上角悬浮操作块对称）—— 输入框上方已堆了目标条 / 待办面板 / 压缩条 / 队列 slot 四条，老大原话「现在输入框上方需要显示的东西太多了」。**S-207 仍未验的子项**：1 小时自然到期自动消失、点「恢复」后越界回拦、渠道文字往返观感。缺陷与修复记账见 `requirements/S-207.md` §9.4 / §9.5。

**当前状态（2026-10-16 晚间）：老大已下「根据开发工作流开始推进 40 迭代下的需求」指令（实施态），7 条需求（S-203 ~ S-209）按刀序实施中。** 已登记 7 条：S-203 官网页脚不贴底 / S-204 清空会话不落库 + 补浮窗入口 / S-205 官网与 README 文案重写 / S-206 官网首屏背景动画 / S-207 沙箱越界新增「申请临时关闭沙箱」工具 / S-208 压缩抢跑 / S-209 GLM 空响应。**S-203 / S-204 / S-205 / S-206 / S-207 / S-208 / S-209 全部已实施（7/7），待阶段五审查 + 阶段六真机验证。** **官网侧 3 条（S-203 / S-205 / S-206）为独立轨道、零软件改动，可单独发一波、不必等软件 0.2.40。** S-204 四点裁定、S-205 五项裁定、S-207 六项实现细节、S-208 修法（A）、S-209 修法（判定收窄 + 提醒催一轮）均已落定；S-206 冲突处置已定（08:58：保动画、扫光让步）。

---

## 一、目标

**迭代定位（老大 2026-10-14 17:37 原话）**：

> 「基本都是收bug 和优化为主」

拆解：

1. **范围**：以 **bug 修复 + 体验优化** 为主 —— 与 39 的现行口径（`docs/plans/iter-v2-39/plan.md` §一：「39迭代的目的是不新做主打功能，体验优化 bug修复 这些都可以列入」）同向。
2. **不做**：**主打新功能**（如 S-174 绘图工作台 / 自定义工作流 —— 仍顺延，等参考源）。
3. **措辞留口**：老大用「**基本**都是」⇒ 不排除个别例外，但默认按上述范围收。
4. **转正**：39 的口径里 `1.0.0` 转正的**最早候选落在 40**（原「39 或 40」→ 39 用于沉淀；验证链条 **38 修 → 39 验 38 → 40 验 39**）。**是否在 40 转正、转正判定标准，本轮未定** —— 待老大另行确认。

## 二、需求索引

| 编号 | 标题 | 状态 | 正文 |
|---|---|---|---|
| S-203 | 官网页脚（含备案条）在高分辨率屏幕上不贴底 | **已实施**（10-14 17:33 登记，10-16 实施完成；定性 **bug**）；官网 build 0 错，视觉验收并入阶段六；**官网侧，独立于软件版本** | [S-203.md](requirements/S-203.md) |
| S-204 | 「清空会话」只清内存不删库（切走再切回消息与上下文全回来）+ 补右侧浮窗入口 | **已实施**（10-15 08:20 登记，10-16 实施完成；定性 **bug + 体验优化**）；四点裁定已落；`typecheck` 0 错 / `npm test` 72/72，真机验收并入阶段六；**软件侧**，端点已存在、零后端改动 | [S-204.md](requirements/S-204.md) |
| S-205 | 官网与 README 文案「太中规中矩、没诱惑力」（允许适当标题党，重写对外描述） | **已实施 + 10-19 收尾定案**（10-15 09:48 登记，10-16 实施完成，**10-19 老大逐条给稿重写首屏**，定性 **体验优化**）；唯一源 `site.ts` 累计改 **13 处** + README 改 5 处，**两处既有红线违规一并清掉**（碰瓷 Codex / Cursor / Claude Code）；**10-19 逆转两处旧定案**：①主标题改「你提需求，它跑全程」（原「按裁定不动」）②价值阶梯三列费用统一上色（原「不改配色」）；首屏价格表述整体下沉到价值阶梯；**10-20 审查后补** README 首屏同源；官网 build 0 错，视觉验收并入阶段六；见 [S-205.md](requirements/S-205.md) §十 | [S-205.md](requirements/S-205.md) |
| S-206 | 官网首屏加背景动画（参考 `astra-gate.si`） | **已实施 + 10-19 收尾定案**（10-15 11:38 登记，10-16 实施完成，**10-19 看过效果后重定**，定性 **体验优化**）；**10-19 改写三项定案**：①技术路线 **CSS+SVG → canvas**（螺旋与尾迹 CSS 做不出来）②「只 Hero」→ **收束层只首屏、雾层整站**③顶栏从「不动」改为**首屏透明、滚动回玻璃底**；配色仍守纸面 + 琥珀；**冲突处置按 08:58 口径：保动画、扫光让步** —— 首屏文字扫光（`.shine` / `.shine-muted` / `.hero-shine` + `data-text`）整体撤掉，下载按钮 `.dl-shine` / `.dl-current` 与 `reveal` 未动；**10-20 审查补** `converge-streams.tsx` 渲染开销（`IntersectionObserver` 滚出视口即停、`ResizeObserver` 尺寸守卫、每帧模板串改按颜色 + alpha 档缓存）；官网 build 0 错，视觉验收并入阶段六；见 [S-206.md](requirements/S-206.md) §十 | [S-206.md](requirements/S-206.md) |
| S-207 | 沙箱模式下越界访问 ⇒ **新增「申请临时关闭沙箱」工具（无参数）**（agent 主动申请，沙箱临时关 1 小时；**YOLO 之上，不豁免**；**桌面弹窗 / 渠道文字审批**） | **已实施**（10-15 17:56 登记、10-16 实施完成，**10-16 08:28 订正实现路线为「新增工具 + 独立弹窗」**、**08:34 定渠道走文字审批**、**08:48 定「工具无参数」「越界文案加指路」**、**08:53 六项实现细节已自主定案**，定性 **体验优化**）；形态照抄 `AskUserQuestion`、渠道复用 `channel-shell-approval` 链路，机制均已逐行坐实；**无待上呈项**；**原沙箱边界逻辑零改动**，越界文案仅加一句；落地 = **新建 6 / 修改 15**（无参工具 `RequestSandboxElevation` + 独立反向请求 + **进程级 1 小时豁免** + 桌面弹窗 / 渠道文字审批 + 倒计时 chip + 手动恢复）；子 agent 与后台自动化**不给**该工具；门禁 `dotnet build` 0/0、`typecheck` 0 错、`npm test` 72/72；**端到端手点已通过（10-19）**，验证期修掉请求包序列化缺陷 + 提示条改挂聊天窗左上角，见 [S-207.md](requirements/S-207.md) §9.5；**10-20 审查补**批准侧审计日志、提示词与实时沙箱状态比对（`AgentLoop.SandboxTransition.cs`）、审批文案 i18n，见 §9.6 | [S-207.md](requirements/S-207.md) |
| S-208 | 压缩抢跑 —— 用户发新消息刚好撞上自动压缩，agent 注意力被压缩摘要带跑、不执行用户末条消息 | **已实施 + 修订**（10-16 登记并实施完成，**10-20 按老大补充裁定修订**，定性 **bug**）；根因链已坐实；修法 **A** 全落地 = 提示词侧软约束（`SummarySystemPrompt` 四处措辞，删掉 `the single most concrete next action to take`）+ **代码侧把用户末条消息原话拼进摘要正文最前、且落在 `<compaction-summary>` 标签之内**；**10-20 补三件**：①快照带**用户消息时刻 + 压缩时刻**（`MM-dd HH:mm`）②带**执行状态**三值（未开始 / 执行中 / 已答复，按结构判定而非时间推算，解决「刚发话就压缩」与「跑几分钟后压缩」两种时机语义相反的问题）③按**数据 + 显示分层**落地 —— 原文存 `AgentRuntimeChatMessage.OriginalText`、时刻存 `SentAt`，显示信息进 `meta.compactSummary`，卡片跳过只给模型看的快照块；标签首位不变式保住；门禁 `dotnet build` 0/0、TS 三配置 0 错、`npm test` 72/72；**10-20 审查修** B1（快照剥离按块判定 ⇒ 用户消息含空行就漏字 ⇒ 改收束句锚点 + 拆纯模块 + 10 用例回归）并补上显示层（卡片「压缩时刻 / 用户发言时刻」两行 —— 第三段「当时状态」09:58 老大拍掉，只留给模型），`npm test` **73/73**，见 §9.6 / §9.7；**软件侧**，真机压缩验证归阶段六 | [S-208.md](requirements/S-208.md) |
| S-209 | GLM-5.3 / 5.3-Flash「结束但无内容」 ⇒ `openai-chat returned no usable assistant output (stopReason=stop, textLength=0, toolCalls=0)` | **已实施**（10-16 登记并实施完成，定性 **bug**）；形态由本机 16 条日志**实证收敛**；修法落地 = ①`EnsureProviderTurnHasOutput` 判定收窄（thinking-only 也算有输出）②`AgentLoop` 在 `ToolCalls.Count == 0` 分支最前拦「正文空 + 有思考 + 有额度」⇒ 置标记 + `continue` ③临时副本注入 `EmptyTurnNudge` 提醒催一轮 ④上限 2 次（`TryScheduleEmptyTurnNudge`）；提醒不落库、聊天窗不可见；真·空流仍走 iter-29 重试链；`dotnet build` 0 警告 0 错误；**§5.3（GLM 内置清单）未做，留待定**；**10-20 审查补**催办轮次不再落库（写入挪到催办判定之后，空轮直接 `continue`），见 §8.5；**软件侧** | [S-209.md](requirements/S-209.md) |
| S-210 | 正文被折叠进过程块，外面只剩一句写死的「任务暂告一段落」 | **已实施**（提交 `7f58cb7c`，16 文件 +494 −25；10-20 10:03 登记，**10:22 老大指出「这个是聊天窗口的显示」后重查，根因与首版不同**，定性 **bug**）；实证 = 正式库最近 800 条 assistant 里**会显示灰字 83 条，83 条全都有正文**；真凶 = `process-summary.ts:144-182` 切分口径「只有最后一个过程项之后的文字才算最终答复」⇒ 以工具 / thinking / tool_result 结尾的消息，**整条文字被折进过程块**；`content-renderer.tsx:499-505` 拿灰字兜底；**「中止 / 压缩」只是提高命中率的时机，与结束原因无因果**；刷新也不好（`meta.content` 为 0 条，靠 `segments`，`buildChatMessageContent:43-53` 给每个 tool_use 补 tool_result 块）；修法两半 = ①`finalItems` 空但有 text ⇒ 回填最后一段连续 text，不显示灰字 ②真没文字才按 `runEnd.reason` 分文案（`MessageMeta` 加字段，零 schema 改动）；**软件侧，零 Worker 改动** | [S-210.md](requirements/S-210.md) |
| S-211 | 渠道入站图片不保留（**微信 / 飞书**：渲染端不消费 `task.images`，Agent 只收到占位符） | **已实施**（提交 `91fbbd7f`；10-20 10:07 登记、10:10 收敛范围，定性 **bug**）；根因已钉死 = `use-channel-auto-reply.ts:255-258` 只传字符串 content，**`task.images` 从未被消费**（全文件仅第 48 行类型声明）；上游微信 / 飞书均已下载 base64；**结论「从未实现」，非回归**；主修 = 拼 `ImageBlock` 走聊天窗同一条多模态链路，渲染 / 落库 / 模型三侧零新造；**§五 三问**（base64 入 meta 的 DB 膨胀 / 音频是否一并查）；**软件侧，零 Worker 改动**；历史两条不可回补 | [S-211.md](requirements/S-211.md) |
| S-212 | **QQ** 渠道入站图片：解析层丢 `attachments[].url`，从未下载 | **已实施**（提交 `49a27335`；10-20 10:10 登记，定性 **bug**）；根因 = `qq/parse-ws-message.ts:57-69` 只读 `content_type` 挑占位符文案，URL 丢弃；`buildIncomingMessage:86` 虽认 `images` 但解析层从不填；修法 = 解析层填瞬态 `mediaRefs`（纯同步可测）+ `qq-service.ts:364-372` emit 前下载成 base64，形状照抄微信；下载失败降级占位符不吞消息；**QQ 附件 URL 有时效，必须即时下载**；单条多附件默认取前 5、上限 10 MB；渲染端归 S-211 | [S-212.md](requirements/S-212.md) |
| S-213 | **钉钉**渠道入站图片：只解 `text.content`，图片消息整条静默丢弃 | **解析层已实施（`cf6e7649`）/ 下载层待权限实测**（10-20 10:10 登记，定性 **bug**）；根因 = `dingtalk-service.ts:160-178` 只解 `payload.text.content`、`msgtype` 全 provider 从未读取（仅发送侧 `:234` 出现）+ `:178 if (!content) return` ⇒ **非文本消息一律消失**；`dingtalk-api.ts` 无任何媒体下载方法；修法 = 按 `msgtype` 分派（picture / file / voice / richText / 未知出占位符）+ 新增 `downloadMedia`（两步：downloadCode → 临时 URL → GET）；**实施前必须先实测下载接口权限**（§五.1）；渲染端归 S-211 | [S-213.md](requirements/S-213.md) |
| S-214 | 设置页「关于」里独立的「使用指引」板块删掉，指引统一走官网 | **已实施**（提交 `38e61a3d`；10-20 10:52 后登记，定性 **体验优化**）；现状 = 「官网」与「使用指引」两块是**同一个站点的两个 path**（`openWebsite` → 站点根，`openUserGuide` → `/guide`），而站点顶栏第一项就是「使用指引」（`site.ts:75`）⇒ 重复入口；修法 = 删 `SettingsPage.tsx:355-369` 整块 `sec-about-guide` + 把 `about.website.desc` 改成**指引入口**（把「使用指引」放句首）+ 清死代码（`openUserGuide` / `USER_GUIDE_URL` 渲染端零调用）+ zh/en 同步删 `about.guide.*`、改 `settings.nav.about.desc`；**§五.1 待确认一句**：「官网的描述」指设置页「官网」区块描述（主口径）还是官网 `/guide` 首屏 description（备选），两者差一个文件；官网 `/guide` 正文与顶栏**不动**；**软件侧、零 Worker 改动** | [S-214.md](requirements/S-214.md) |

## 三、刀序

| # | 提交 | 需求 | 类型 | 范围 |
|---|---|---|---|---|
| 1 | `fix(website): 官网页脚不贴底` | S-203 | 官网 | `index.css` + 3 个页面组件 |
| 2 | `fix(chat): 清空会话落库并补浮窗入口` | S-204 | 软件 | `session-slice.ts` + `db-helpers.ts` + `SessionConversationPane.tsx` + 2 语言包 |
| 3 | `feat(chat): 折叠收尾显示真实结束原因` | S-210 | 软件 | `types.ts` + `chat-store/index.ts` + `content-renderer.tsx` + 新纯函数 + 2 语言包 + 单测 |
| 4 | `fix(channels): 入站图片送进多模态消息` | S-211 | 软件 | `use-channel-auto-reply.ts` + 新纯函数 + 渠道文案 + 单测（微信 / 飞书一并好） |
| 5 | `fix(channels): QQ 入站图片补下载` | S-212 | 软件 | `channel-types.ts` + `qq/parse-ws-message.ts` + `qq/qq-service.ts` + 单测 |
| 6 | `fix(channels): 钉钉按 msgtype 解析并下载入站媒体` | S-213 | 软件 | `dingtalk-service.ts` + `dingtalk-api.ts` + 单测 |
| 7 | `refactor(settings): 关于页删掉重复的使用指引板块` | S-214 | 软件 | `SettingsPage.tsx` + `user-guide.ts` + 2 语言包 |

**S-210 ~ S-214 实际落地（2026-10-20 按 `docs/dev-workflow.md` 六阶段推进）**：

| 实际 | 提交 | 需求 | 说明 |
|---|---|---|---|
| 刀 1 | `7f58cb7c` | S-210 | `feat(chat): 折叠收尾照实显示这一轮的结束原因`，16 文件 +494 −25；补两处 500 行豁免头（`content-renderer.tsx` 533 行、`cron-runtime.ts` 621 行） |
| 刀 2 | `38e61a3d` | S-214 | `refactor(settings): 关于页删掉重复的使用指引板块`；§五.1 按「设置页官网区块描述」口径实施，官网 `/guide` 未动 |
| 刀 3 | `91fbbd7f` | S-211 | `fix(channels): 入站图片送进多模态消息`；新增 `lib/channel/inbound-content.ts` + 回归套件 |
| 刀 4 | `49a27335` | S-212 | `fix(channels): QQ 入站图片补下载`；`channel-types` 加瞬态 `mediaRefs`、新增 `qq/download-media.ts` |
| 刀 5 | `cf6e7649` | S-213 | `fix(channels): 钉钉按 msgtype 解析，非文本消息不再静默丢弃`；**下载层未做**，卡 §五.1 权限实测（本地钉钉 `appKey` / `appSecret` 为空、渠道未启用） |

## 四、门禁基线

沿用 39 收尾时的四道，**本迭代已复跑（2026-10-20 阶段五第二轮修复后）**：

- `npm run typecheck` 0 错误（node + web）
- `npm test` **77/77**（TS + C#；较 39 基线多出 `test:compaction-snapshot-display` / `test:inbound-content` / `test:qq-attachments` / `test:dingtalk-msgtype` 四套，另 JsonHelpers 24→28、SandboxPath 14→20）
- `dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误（`tests/WishfulClaw.Tests.sln` 同）
- `cd website; npm run build` 0 错

## 五、裁定汇总

（待补）

## 六、遗留项

- **S-199 未开工**（39 遗留）：浏览器工具卡片空壳 `isBrowserToolName`，修法无歧义（约 15 行），属可见行为变化 ⇒ 等老大点头。是否顺延到 40 **待裁定**。
- **S-202 同类点 5 处是否扩面**（39 审查 ⚠️2.2~2.6）：`SubAgentExecutor.cs:272-284` / `SubAgentExecutor.Background.cs:138-157` / `GoalOrchestratorOwnedRun.cs:100-113` / `AgentLoop.ContextCompression.cs:199-222` / `GoalSubAgentExecutor.cs:58-66`。**老大 2026-10-14 17:28「暂时不管」。**
- **39 补充轮审查 ⚠️ 2 条**留裁定（S-191 ⚠️-1 多会话孤儿收敛、S-195 ⚠️-1 空转卡）。
- **`release-workflow.md` §二 版本号处数出入**：文中写「共 4 处」，39 收尾实际只改 3 处（`package.json` / `package-lock.json` 2 行 / `README.md`）。若表里确有第 4 处需补改。

### 6.1 阶段五第二轮审查遗留（**待老大拍板，未动**）

| # | 事项 | 现状 / 待定原因 |
|---|---|---|
| 1 | `site.ts:61`「搜本地文件」 | 实况需另装 Everything（`src/main/lib/everything-search.ts:4-10`），风险是「装了没搜到」。属对外口径，不由我改 |
| 2 | 「你提需求，它跑全程」 | 老大 10-19 已点这句，但它贴近 §四-3 禁写的「全自动无人值守」。红线段落归属由老大定 |
| 3 | README `✨` / `💾` / `❓` 三节开场 | 首屏已同源，三节开场仍是旧调性；是否按新调性重写需确认范围 |
| 4 | 观感参数：粒子下限 36、`color-mix()` 降级、`backdrop-filter` 瞬切 | 见 `S-206.md` §10.6，等真机看完再定 |

### 6.2 tech-debt（已记账，不在本迭代动）

- `stores/chat-store/session-slice.ts`（1103 行）：按「会话生命周期 / 消息读写 / 用量统计」拆成 slice 组合，与 S-204 的清除链路天然对齐。当前已挂豁免头（高度内聚 store）。
- `stores/chat-store/db-helpers.ts`（712 行）：22 个同构 `workerRequest` 薄封装，按 session / message / project / usage 拆四模块。当前已挂豁免头。
- 两者都要改多个调用方 import，单独立需求做。
