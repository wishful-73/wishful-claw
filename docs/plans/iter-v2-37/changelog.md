# iter-v2-37 裁定流水

> 跨需求的决策、口径变更与偏差记录。按时序追加，一节一事。
> 需求正文见 `requirements/`，清单见 `raw-requirements.md`。

---

## 2026-09-29

- **14:39　开迭代** —— 老大「先开 37，暂时没有新需求」。从最新 main `77adb84b`（= tag `v0.2.36`）切出 `dev/v2-iter-37`。规划文档不单独提交，留工作区随第一个需求一起入库（`dev-workflow.md:327`）。

- **14:49　遗留盘点 → 两条登记 + 一条待裁定** —— 老大问「之前的迭代中有遗留的需求没处理的没」。盘点范围：各迭代 `progress` 的遗留 / 已知限制节 + 迭代 plan 的「不纳入」节 + 代码侧死配置；对高价值候选做了代码级抽查复核。老大点选：
  - **S-156｜登记** —— 「PersonaGeneratorDialog 零入口　我就说这个我没找到地方，加到需求里面」。勘测结论：组件 + store + C# 链路全在位，**只缺挂载点**。
  - **S-157｜登记** —— 「`.wishful-claw` 字面量三处未收敛　加」。
  - **`plugin:tool-enabled`｜待裁定**（未登记）—— 老大问「这个是什么」。答：渠道「按工具逐个开关」的查询接口，存储字段 `ChannelInstance.tools` 与主进程三层壳齐全，但**配置方（UI）与调用方（C# 运行时）两头皆零** ⇒ `tools` 表恒空、函数恒返回 `true`。建议 **a. 删**（四个通道工具本就少，无逐工具开关的真实诉求），等老大拍。

- **盘点副产物（顺带结掉的旧账，记录备查、不立项）**：
  - `PersonaGenerator.cs:22` 自建第三套 HTTP 客户端 —— **已修**，现走 `WorkerHttpClientFactory.Create`。
  - iter-28 记的渠道 `streamingReply` / 四个 `allow*` 死配置 —— **已删**（iter-29 清理，`plugin-panel-global.tsx` 顶部注释留了说明）。
  - iter-34 记的「release-workflow 缺『给官网 changelog 补条目』一步」—— **自然消亡**（S-143 已把官网更新日志页下架、入口改跳 GitHub）。
  - iter-27 Plan D（多服务商 fallback）—— 设置项与链路均在（`provider-auto-fallback.ts` / `ProviderCompletionSettings` / 设置面板），**判定已落地**；未做端到端复核，需要时单验。
  - 仍活着的其余欠账（未登记，备查）：用量日志 `request_usage_logs` 无保留策略；`newSessionDefaultModel` 只写不读；`CodeGraphDataDir.cs:56` 兜底不读 `WISHFULCLAW_DATA_DIR`；文件搜索无 mac / Linux 实现。

- **14:57　两条裁定落地**：
  - **S-156 → 选项 A：接通** —— 老大「156 是接通啊」。设置页人格区加入口，把 `PersonaGeneratorDialog` 的 `open` / `onClose` / `onSaved` 接上；备选 B「删除」作废。
  - **S-158｜新登记：删** —— 老大「plugin:tool-enabled —— 删还是接通？　这个删」。删除渠道「按工具逐个开关」全链路（6 个文件、纯 TS 侧；C# 无对应字段、`tests/` 无命中）。取舍理由与 iter-29 删同批死配置一致：渠道工具本就少，不存在逐工具开关的真实诉求。

- **15:10　S-159｜新登记：删** —— 老大「那就删」。删除设置项「新会话默认模型」死字段 `newSessionDefaultModel`（代码侧 4 处，全在 `settings-store.ts` / `settings-store-migrate.ts`）。判定依据：无 UI、无读取方，恒为 `null`；上游 OpenCowork 亦已移除；现役「新会话跟随全局激活模型」由 `mainModelSelectionMode` + `inherit` 档承担，语义自洽。**单开一刀，不并进 S-158**（一动渠道配置、一动渲染端设置 store）。

- **16:33　S-160｜新登记（本迭代首条产品诉求）** —— 老大「关于页面需要增加 官网信息，以及使用指引需要指向官网　这个需求登记上」。两条：① 设置页「关于」tab（`AboutPanel`）补官网入口；② 应用内「查看指引」从 GitHub `docs/user-guide.md` 改指官网指引页。

- **16:36　S-160 勘误 + 揪出一处死链** —— 登记中我把官网域名误记为 `wishful-claw.shop`，老大当场纠正「我们的官网是 wishful-claw.work　你这在乱搞啥哦」。**根因**：我直接采信了 `ConversationGuideDialog.tsx:313` 的硬编码字面量，没做交叉验证。curl 实测：`.work` 的 `/`、`/guide`、`/download` 全 **200**；`.shop` **000**（DNS 解析不到）⇒ 该行是**死链**。全仓排查：官网域名写错的**只此一处**，其余（`dev-app-update.yml:2` / `electron-builder.yml:12` / `scripts/deploy.mjs:65` / `README.md`）全对。**已并入 S-160 修复面**。三条口径（官网区块装什么 / 指引按钮替换还是并列 / 仓库侧 `docs/user-guide.md` 去留）**待老大裁定**。

- **16:56　S-161｜新登记** —— 老大「如果刚触发自动压缩，然后正在回复或者输出流的时候，用户中断执行 然后 重新发送新的内容，这个时候又会触发压缩」。实读代码后**病根钉死**，是 **S-141（`788063e2`）的同族残留**：那条只修了**恢复路径**（`SessionRestoreTools.cs:199` 逐条 `StripUsage`），**运行中压缩**这条路没修 —— `ContextCompression.cs:175-179 / :187-196 / :217-221` 三处把压缩前的 wire 消息**原样复制**进产物，旧 `usage`（压缩前的高水位）留在新对话里；`AgentLoop.ContextCompression.cs:172` 又把水位 `Reset` 到压缩后的新 count，此后任意新消息都能越过闸门。平时不暴露是因为压缩后紧接的那轮 provider turn 会用新 usage 覆盖尾部；**一旦该轮被用户中断**（usage 在流末尾才到，没来），旧高值就留在尾部 ⇒ 下个 run 的 `FindRecentContextUsage` 取到它 ⇒ **又压一次**。倾向方案 **A+B**（CompactAsync 三处复制逐条剥 usage + `StripUsage` 提到 `ContextCompression` 与 S-141 共用），备选 C（中断时剥尾部残留）。**待老大裁定**。

- **17:31 → 17:39　参考项目摸底 → 四条登记（S-162~S-165）** —— 老大「你看下 zcode 有哪些好东西是值得我们弄上的，包括 NextCoWork 的也是，你分析下呢」。摸底对象：`D:\claw\ZCode`（智谱 AI 编程工作台，本轮新拉，实读 README / `CONTEXT.md` / `DESIGN.md` 标题结构 / `architecture-policy.yaml`）与 `D:\claw\NextCoWork`（实读 README / `AGENTS.md` 标题 / `CHANGELOG.md` 的 v2.3.0·v2.4.0·v2.5.0 三节）。

  **摸底先做的一件事是「排除」** —— 两边高度重叠的能力（终端 / Skills / MCP / 内置浏览器 / Git 面板 / 主题预设 / inline widget / SSH 会话）我们都已有，逐项核过后**不抄**，避免重复造轮子。核查方式为代码侧 grep 实证（如 widget 确认在 `lib/tools/widget-tool.ts` + `AgentRuntimeWidgetExecutor.cs`；主题确认在 `lib/theme-presets/`）。

  老大点选四项，**1 与 3 的措辞不同，按不同性质处理**：

  - **S-162｜登记（产品诉求）** —— 「1. 图片产物的「就地出口」…… 这个登记上」。勘测发现**缺口比预想的小**：出口能力（复制 / 下载）**已在** `ImagePreview.tsx`（`handleCopy :249` / `handleDownload :195` + 两颗按钮 `:349` `:360`），缺的是**生图卡片上就地可达**（`ImagePluginToolCard.tsx` 只有放大 + 重试两个动作）。另勘出两处真缺：**无 `SaveImage` 工具**（主进程搜 `saveImage` 零命中，agent 存不了图进工作区）、**扩展名按 src 字符串判**（`ImagePreview.tsx:38` `getDownloadExtension`）。附带经验里「剪贴板写图一律转 PNG」一条**我方已符合**（`lib/utils/image-clipboard.ts:8` 注释与实现均已是先转 PNG 再写），正文如实标注「无需改」。
  - **S-163｜登记（工程规范）** —— 「我们自己的一份 DESIGN.md」。勘测**修正了我的初判**：我原以为我们只有零散样式，实际 `lib/theme-presets/` 下已有 **6 套成品配色**（`studio` 默认 / `dawn` / `forest` / `graphite` / `mulberry` / `ocean`）+ 明暗双档 + 完整 CSS 变量体系（`ALL_THEME_CSS_VAR_KEYS` / `applyThemePresetCssVars`）。⇒ 所以这条的定位是**成文**，不是建体系。
  - **S-164｜登记（研究类）** —— 「4. 需求文档补两段…… 这几个登记研究一下」。抄的是 `NextCoWork` changelog 的两类段落：**代价（刻意保留）** 与 **故意不做**。我方 `requirements/` 已有「方案取舍表」，缺的正是这两节。
  - **S-165｜探查后登记（预防性加固）** —— 老大原话是「**这个需要探查是否我们有这种顾虑**」，措辞与另外三条不同，故**先探查再登记**。实读 `OpenAIChatSseParser.cs` 全文（225 行）后结论分两面：**我方不会踩**参考项目那个「合法帧判 invalid ⇒ 整轮中止、正文全空」的坑（我们对不合法帧是跳过不是中止），**但**归格语义确有偏差 —— `:20` `JsonHelpers.GetInt(fragment, "index", toolBuffers.Count)` 的 fallback 是「**新建一格**」而非「**找可用格**」，叠加 `:27-30` 无 `id` 归并兜底，会造出三个隐患（续片被劈格 / id 帧与参数帧不合并 / 无 index 片插到显式大 index 前面而**打乱工具执行顺序**）。**主流上游每帧都带 index，故无实测症状**，正文按「预防性加固」定位，**是否实施待裁定**。

  四条**均未开工**。刀序扩到 11 刀（10 需求 + 收尾），其中 S-163 / S-164 属**文档类**、S-165 视裁定。

- **17:51　四条逐一下裁定（＋新增 S-166）** —— 老大对上一轮四条登记一次性回应：

  - **S-162 → 追加诉求，另立 S-166** —— 老大原话「162 我们现在还缺图片生成，当前的图片生成是需要去配置专门的模型，我想要一个通用的，当前模型就能调用的图片生成」。实读生图链路（`AgentRuntimeImageGenerateExecutor.cs:42` 反向请求 `image:generate` → `src/main/ipc/reverse-handlers/image-reverse-handler.ts` → `POST {baseUrl}/images/generations`）后钉死现状：**`:38` 模型默认硬编码 `dall-e-3`**，**`:47-49` 只挑 `type === 'openai'` 且有 apiKey 的 provider**，找不到就报 `No OpenAI-compatible provider with API key configured` ⇒ 「需要配专门的模型」的**确切含义是必须额外有一个 OpenAI 类型的 provider**，对话用 DeepSeek / 智谱 / Anthropic 的用户生图直接不可用。**未并入 S-162**（一动渲染端出口与落盘、一动生图链路，合并即一需求两刀），另立 **S-166**，正文列三条路径（A 走当前模型的多模态输出 / B 放宽 provider 限定 / C 端点可自由配置）**待裁方向**。S-162 正文已加姊妹需求交叉引用。
  - **S-163 → 范围定 a：只梳理现有** —— 老大「163 这个是把我们现有的规范梳理出来，调整不着急」。按代码现状反向固化 token 与用法，**不做改造、不加组件规范**。落点是否用 `docs/design-system.md`、「减弱动效 / 动效等级」是否单开，仍待明确。
  - **S-164 → 范围定：只对新需求适用** —— 老大「164 新需求才补这两节」。**不回溯补老需求**，从新需求开始写「代价与取舍」「刻意不做」。是否写进 SOP 仍待明确。
  - **S-165 → 老大倾向不做，核实后建议改标「暂不实施（备查）」** —— 老大「165 我们不一定需要，35 迭代紧急修复应该就是类似的问题，所以我们可能已经不需要了」。**核实结果：两者不是同一个问题。** iter-35 全迭代只实施 **S-141** 与 **S-142** 两项（见 `docs/progress/v2-iter-35.md`），其中那条「紧急修复」是 **S-142「同一段思考流被正文劈开」**（`7cf7638a` → `758528d3` → `0a7a5b09`）—— **症状在渲染端显示，根因与主修在后端**：34 S-135 的 batcher 把正文与思考攒进两个独立串后**按固定顺序（正文→思考→工具）倒出、丢了到达顺序**，思考尾巴被排到正文之后；修法是**协议加 3 个无载荷边界事件**（`text_start`/`thinking_start`/`thinking_end`）+ C# 新增 `StreamSegmentBoundary` 在 Anthropic / OpenAI Chat / Responses **三处发边界** + **batcher kind 冲突先 flush**（渲染端只按边界续段）。属「两条**独立流**（thinking / text）→ **分段归属**」；而 S-165 是**运行时**的工具调用分片归格（`OpenAIChatSseParser.cs:20`，缺省 `index` 的 fallback 语义）—— 属「同一路工具调用分片 → **归格**」。**关键取证：`OpenAIChatSseParser.cs` 在 iter-35 三刀里零改动，`OpenAIChatProvider.cs` 的改动只往 thinking/text 分支前插边界发射、未碰 `toolBuffers` ⇒ S-142 不覆盖 S-165。** 但老大有一半判断成立：S-165 **无实测症状**、优先级低。⇒ **我的建议是保留登记、标「暂不实施（备查）」、不占刀序**（归格语义偏差是客观事实，删掉就没人记得了），最终去留待老大一句话。
  - **⚠️ 口径订正（17:57）** —— 上面这条初稿把 S-142 记成「修的是渲染端 `chat-store/stream-segments.ts`」，**老大当场指出不准确**：「142 虽然是渲染端显示的被劈开，实际修复是后端的接收逻辑」。复核 `git show --stat 7cf7638a / 758528d3 / 0a7a5b09` 证实：`stream-segments.ts` 是**第三刀收尾**才抽出的纯函数模块、属**消费方**；后端才是根因与主修。S-165 正文 §五 已按此订正，并补「同族观察」（S-142 与 S-165 隐患③ 同属「顺序信息被某一层丢掉」）。

---

## 2026-09-30

- **08:24　登记知识库新 bug ⇒ S-167** —— 老大「查看下知识库 昨天又增加了一个 bug 需要登记」。知识库 `D:\koda\Obsidian\05-WishfulClaw\issues\bugs.md` 于 2026-09-29 新增一条（21:52 补实证）：**多会话模型串台** —— 会话 A 配 M1、B 配 M2，A 跑完转非活跃后轮到 B 时 **B 实际用 M1**；且老大手动把某会话切成付费模型后，**从外部（全局助理派工单）发消息会把该会话模型顶掉**。

  **登记前实读定死根因**（不是猜）：

  - **正常发送路径早已修对** —— `src/renderer/src/hooks/use-chat-actions.ts:323` `resolveSendModel(sessionId)` → `resolveSessionModelSelection`（优先 `source: 'session'`）；该函数上方注释自陈这个坑修过一次：「Session-bound model switches used to update only the UI while sends kept reading the global provider store」。
  - **外部投递路径绕过了它** —— `src/renderer/src/lib/tools/project-send-message.ts`（全局助理派工单落点）：`:168` `providerStore.getActiveProvider()`、`:175` `providerStore.activeModelId || targetProvider.defaultModel`，`:183` 就此 `buildProviderPayload` 定型 —— **`targetSession.providerId` / `modelId` 一次都没读**。
  - **同族路径**（同一病，建议一并收）：`use-background-subagent-wakeup.ts:82-83`、`use-channel-auto-reply.ts:203,214`、`cron-runtime.ts:77-99`。
  - **写会话绑定的只有两处调用者**（`session-slice.ts:777/790/800/812` 的四个 setter）：`ModelSwitcher/utils.ts:100/134/149`（用户手动切）与 `cron-runtime.ts:203`（**新建**会话时设置）⇒ **投递路径不写 session**。
  - ⇒ 正文把「**投递这一轮跑错模型**」（已定死）与「**老大看到『被切回去』是显示观感还是真写了库**」（待验证，附取证法：投递前后各查一次 DB）**分开登记**，另记一个放大器：`resolveSessionModelSelection` 的 `manual` 分支要求 `providerId` 与 `modelId` **同时非空**（`session-model-resolution.ts:107`），任一被清空即静默回落全局。

  刀序由 11 刀扩到 **12 刀**（11 需求 + 收尾）；**十二条均未开工**。知识库另有的 **2026-09-22 沙箱 / 文件工具** 一条本次**只读未动**（对应 iter-36 S-144，但知识库记的触发候选未逐项核对是否都覆盖，且进度文档标「⚠️ 未真机验证」）—— 正文附录已记明，待专项核对。

- **08:25　老大补充：这是两个方向，不是一条** —— 「不只是派工单的时候，还有**项目下会话回复全局任务进度**导致的**全局助理的模型也没用上**」。遂把反向路径一并勘查，结论：**两条方向汇聚到同一个 handler**：

  ```
  ① 全局助理派工单        send_session_message（AgentRuntimeProjectExecutor.cs:257）
  ② 项目会话回复全局进度   reply_global_dispatch（AgentRuntimeGlobalDispatchReplyExecutor.cs:184-185，sessionMode: "global"）
        └─ 两路都发反向请求 project/send-session-message
             → 渲染端同一个入口 src/renderer/src/lib/tools/project-send-message.ts
  ```

  ⇒ **修一处即覆盖两条方向**。且现象 ③ 反证了「**本轮跑错模型**」这一侧 —— 全局助理**自己有绑定却没用上**，说明病在「这一轮取模型的方式」，不是某个会话的库被改写（§四 的判定天平据此压向显示/取用侧，仍待实测钉死）。S-167 正文已补：现象第 3 条、§3.1「两个方向汇聚同一 handler」、§四 的印证说明、§五 新增注意（`sessionMode: 'global'` 只管提示词与工具集，**不应影响模型解析**）、§六 新增反向验证项。

- **08:27　老大补三条最终后果 —— 查出一条独立缺陷** —— 老大：「最后造成的结果就是，用户去项目会话下**手切也切不回来**，**思考模式的配置也匹配不上**。**模型显示跟实际使用对不上账**」。逐条落代码：

  - **「思考模式也匹配不上」= 独立缺陷，已定死。** `project-send-message.ts:183` 传的是 `buildProviderPayload(targetProvider, modelId, settings, { thinkingEnabled: false })` —— 而这个 option 在 `lib/agent/provider-payload.ts:42-49` 的注释里写着是**故意**的：「The project dispatch path has always sent `false`; **keep it that way until someone decides otherwise**」。⇒ **外部投递的每一轮都强制关思考**，模型换对了思考档位也对不上。**需要老大拍板**：保持关思考（省 token）还是跟随设置？**我的建议是跟随设置**（用户按任务配的模型策略里，思考档位是同一套策略的一部分，保持 `false` 等于只生效一半）。附带一条待核：`reasoningEffort` 不随 `thinkingEnabled` 归零（`provider-payload.ts:54-62` 只看 `thinkingConfig` 存不存在），两字段在 C# 侧是否被一致解释需核实。
  - **「手切也切不回来」= 两个可能，待核。** 事实面：`resolveSendModel` 调用点是全的（`use-chat-actions.ts:119/382/441/638` + `cron-runtime.ts:393`），手动切换也 store + DB 双写（`ModelSwitcher.tsx:535 selectModel` → `session-slice.ts:767-778`）⇒ **UI 自己发消息走的是对的路**。可能一（倾向）：切成功了但**外部投递照样跑全局**，感觉切不回来。可能二：`ModelSwitcher/utils.ts:88-113` 的 `selectModel` 在 `scopedSessionId` 为 `null` 时**切的是全局、不是会话**（`:107-110`）。**取证：切前切后各查一次 DB `sessions.providerId` / `modelId`，分辨「没写进去」还是「写了没用上」。**
  - **「显示与实际对不上账」= 症状必然**：显示侧走 `resolveSessionModelSelection`（会话绑定），实际侧走全局 `activeModelId`，两边必然劈叉。

  S-167 正文已补 §3.3 / §3.4 两节与 §五.5、§六 验证项。

- **08:31　老大裁定：外部投递必须用会话本身的设置** —— 老大原话：「外界投递的消息，**必须用会话本身的设置**，不管是**思考**还是**模型**。」

  ⇒ **裁定 = 跟随会话设置**：`project-send-message.ts:183` 的 `{ thinkingEnabled: false }` **去掉**，改走 `buildProviderPayload` 默认口径（`options?.thinkingEnabled ?? (settings.thinkingEnabled && !!thinkingConfig)`）。**我在上一轮提的建议（跟随设置）被采纳。**

  **更重要的是这条裁定给出的设计准则**（已写进 S-167 正文，作为实施与评审口径）：

  > **外部投递不是特殊通道。它必须与「用户在该会话里自己发消息」走完全一致的设置解析。**

  由此推出：模型取用（§3.2）与思考档位（§3.4）**必须收敛到同一个解析入口**（`resolveSendModel` + `buildProviderPayload` 默认口径），**投递路径不允许自带任何 override** —— 这也把 §五 的修复范围从「改一处取值」提升为「**把投递路径拉回统一解析**」。

  边界已记明：本次是「投递跟随会话既有设置」，**不是**新增「会话级思考开关」；若日后要做每会话独立思考档位，另立需求。

- **08:33　老大澄清「手切切不回来」的机制 —— 定位到 `providerId:modelId` 这个 key** —— 老大：「手切切不回来是因为**模型和思考参数对不上账**，就算切回来了**有些场景下也报错**。是其中一种后果。」

  ⇒ 这否掉了我上一轮列的「可能二（切换功能坏了 / 切到全局去了）」：**切换本身是好的**（`resolveSendModel` 调用点齐全、`setSessionModelManual` store + DB 双写）。真正的机制是**模型变了、思考参数没跟着变**。

  **实读定位**：思考档位按 **`providerId:modelId` 的 key** 存 ——

  - key 构造：`settings-store-types.ts:360-361` `return \`${providerId}:${modelId}\``
  - 取用：`provider-payload.ts:54-62` `resolveReasoningEffortForModel({ reasoningEffortByModel, providerId: provider.id, modelId, thinkingConfig })`

  ⇒ **投递路径查的是「全局 provider:model」的档位，UI 显示的是「会话 provider:model」的档位，两个 key 不同 ⇒ 必然两套值**；再叠加 §3.4 的 `thinkingEnabled: false` 硬编码，**一个字段按全局、一个字段被钉死**，拼出来的请求 UI 对不上账是必然，个别模型 / 服务商不接受这套组合时即报错。报错的具体形态**列为待实测**（三种候选已写进正文），未猜死。

  S-167 §3.3 已整节重写（标题由「两个可能，待核」改为「机制是『模型与思考参数对不上账』」），§一 现象 ④ 的指引同步更正。

- **08:35　老大下令开工，S-167 提到本迭代第一刀（已实施）** —— 老大「根据 docs 下开发工作流开始推进，当前这个 bug 排最前面推进」。刀序表随之调整：S-167 由第 9 位提至**第 1 位**，其余顺延。

  - **比原计划多一步** —— 原计划是「`project-send-message.ts` 加一个 `resolveSendModel` 导入即可，无循环依赖风险」。实读发现**渠道那条路径有环**：`use-chat-actions.ts:12` 顶层反向 import 了 `use-channel-auto-reply`（`registerExternalChannelReply`）。⇒ 把统一入口从 hook 模块搬到 `lib/send-model-resolution.ts`，`use-chat-actions.ts` 改成 `export { resolveSendModel }` re-export，**既有调用方零改动**。不搬的话，渠道那处只能继续自己手写兜底序 —— 而那正是本次 bug 的来源。
  - **四条投递路径一次覆盖**：`project-send-message`（派工单 + 回复全局，两方向同一 handler）／`use-background-subagent-wakeup`／`use-channel-auto-reply` 全部改走 `resolveSendModel(sessionId)`；`{ thinkingEnabled: false }` 一并去掉，改走 `buildProviderPayload` 默认口径。
  - **`provider-payload.ts:42-49` 的注释已改** —— 原文「keep it that way until someone decides otherwise」此刻已被拍板；注释不改，下一轮又会被当成「故意设计」保回来。
  - **门禁**：`npm run typecheck`（web / node / root 三配置）全 0；`npm test` **61/61**（TS 45 + C# 16）。
  - **未实测**：S-167 §六 的 1～5 条都是运行期行为，本刀只到「编译 + 回归套件」级别，未在跑起来的实例里逐条复现。

- **09:05　S-156 实施（第 2 刀）—— 接通 \PersonaGeneratorDialog\** —— 老大 09-30 09:01「继续推进」。

  **改动落在 \PersonaPanel.tsx\ 一个文件**：头部工具栏「新建人格」左侧加 \ariant="outline"\ 的「AI 创建人格」按钮（图标复用已在文件里 import 的 \Sparkles\，此前只用于空态占位），新增 \generatorOpen\ state，根部渲染 \<PersonaGeneratorDialog open onClose workingFolder={wf} />\。

  - **文案零新增**：复用既有 key \persona.aiCreate\（弹窗标题，语义与入口一致）⇒ zh / en 两份 locale **未改**。
  - **未传 \onSaved\**：\savePersona\ 在 store 里已自刷列表并重选，弹窗内部 \handleSave\ 也会自己 \handleClose()\，外部只需管 \open\。
  - **未加 dirty 拦截**：AI 生成是「新增一份人格」，不切换当前 \draft\，与 \handleNewPersona\ / \handleSelectPersona\ 不同，不需要 \unsavedConfirm\。
  - **项目侧一并生效**：全局页与项目页共用本组件，\workingFolder\ 原样透传 ⇒ 项目上下文里生成的人格落项目人格库（既有 props 语义，非新增行为）。
  - **门禁**：\
px tsc --noEmit\ 三配置（web / node / root）全 \EXIT=0\；\
pm test\ **61/61**（TS 45 + C# 16）。
  - **未实测**：生成 → 四段预览 → 保存这条链路需真机点，本刀只到「编译 + 回归套件」级别。
- **09:08　S-157 实施（第 3 刀）—— 数据目录名收敛，代码内字面量清零** —— 登记列三处，实做**五处**：按需求自己的验收标准（全仓复搜裸字面量 0 命中）复搜后另有四处命中 —— codegraph-handlers.ts:158/:159 两处前缀串（与登记的 :170 同函数同语义）、SkillsMenu.tsx:370/:416 的 UI 空态文案、	ask-board-store.ts:103 派工单提示词正文里的路径示例。后两类同样是「数据目录名写死」，只是载体是文案 / 提示词。WISHFUL_CLAW_DIR 与 PROJECT_MEMORY_DIRNAME 保留导出名、改指向常量（二者都有消费方）。复搜余下 27 命中**全是注释** + 唯一定义点自身。门禁：tsc 三配置全 0；
pm test 61/61。

- **09:11　S-158 实施（第 4 刀）—— 删渠道「按工具逐个开关」死配置全链路** —— 登记清单 6 处全做。**登记漏掉的关联面一并清**（不清则 	sc 直接报错）：ChannelInstance.tools 有**写入方** —— uildToolsMap 专门生产这张表，被 channel-plugin-handlers.ts 三处调用（新建内置实例 / 每次 plugin:list 回写 / plugin:add）。**这几处正是「死配置看起来是活的」的原因**：每次列渠道都在重写这张表，所以它一直有内容，只是没人读。另删渲染端镜像类型 PluginInstance.tools。ChannelDescriptor.tools?: string[] 是另一个字段，保留。**一处刻意不删**：getChannelPlugin 因本次改动失去唯一调用者，但它是 channel/config-get 的通用查询口，不属本链路，留给收尾盘点。复搜 0 命中；tsc 三配置全 0；61/61。

- **09:14　S-159 实施（第 5 刀）—— 删死字段 
ewSessionDefaultModel** —— 四处全删，与登记清单一致，**无关联面溢出**（纯自留地字段，不像 S-158 有写入方）。ModelBinding 类型保留（memoryOrganizationModel 仍在用）；migrate 不写 delete。复搜 src + 	ests 0 命中，git grep 余下命中全在 docs/ 历史记录。tsc 三配置全 0；61/61。

- **09:15　推进暂停 —— 余下六条全部卡在待裁定口径上** —— 本迭代十二条已落五刀（S-167 / S-156 / S-157 / S-158 / S-159）。**S-160 / S-161 / S-162 / S-163 / S-166 五条各有一组口径待老大拍板，S-165 待定「备查」与否**；再往下每条都得先有裁定，故停下报告，不擅自选路。

- **09:27　六条裁定一次下齐 ⇒ 转入全面实施** —— 老大对上一轮的暂停报告逐条拍板：

  - **S-160 → ①a1 + ②b1 + ③不维护仓库侧指引**：①「官网信息」装 **a1**（官网地址 + 心相团队）；②指引按钮走 **b1（替换，不并列）**；③**不再维护 GitHub 侧的 `docs/user-guide.md`**。
  - **S-161 → 复发时复用已压快照** —— 老大原话「这个是已经成功压缩后，用户中断后续执行，然后重新发言，这种应该能**复用之前的压缩快照**才对」。**关键口径：不是「把旧 usage 删掉」就完事，而是复发那一轮要复用已经压好的快照。**
  - **S-166 → 按 agent 推荐** —— 老大「我用 **DeepSeek v4.1 flash** 和 **glm 5.3 flash** 这些模型」⇒ 都是 chat 模型、不产图像块 ⇒ **A 方案（解析模型自产图像）否掉**，走 **B（放宽 provider 限定）+ 回落**。
  - **S-162 / S-163 / S-164 → 按 agent 推荐** —— S-162 实做 A+B+C（卡片就地出口 + `SaveImage` + 字节魔数判扩展名）；S-163 落 `docs/design-system.md`；S-164 落 `dev-workflow.md`。
  - **S-165 → 不做**，标「**暂不实施（备查）**」，**不占刀序**（收口与代价说明见 `requirements/S-165.md §六`）。

- **第 6 刀 S-160（`99a07798`）** —— 关于页补官网信息（地址 + 心相团队），「查看指引」由 GitHub `docs/user-guide.md` 改指官网 `/guide`；`ConversationGuideDialog.tsx:313` 的 `.shop` 死链一并修掉。**按 ③ 裁定删掉仓库侧 `docs/user-guide.md`**，停维护。门禁：typecheck 0；`npm test` 61/61。

- **第 7 刀 S-161（`764f9c72`）** —— 压缩产物剥离压缩前的旧 `usage`，堵住「压缩后中断、重发又触发压缩」。**按 09:27 裁定落在「复用已压快照」这一侧**（不是简单删旧值）。门禁：typecheck 0；61/61。

- **第 8 刀 S-162（`37fe4f51`）** —— 生图卡片加「就地出口」（复制 / 下载，能力本就在 `ImagePreview` 浮层里），新增 `SaveImage` 工具，扩展名改按**字节魔数**判。门禁：typecheck 0；61/61。

- **第 9 刀 S-166（`cc26da7e`）** —— 通用生图：不再限定 `type === 'openai'`，按「激活 provider → host 映射表 → 任何有图像能力的 provider」三级解析，都没有时给可操作的明确报错。新增 `src/main/lib/image-endpoint.ts` 与 `tests/image-endpoint/`（30 断言），**套件数由 61 涨到 64**。顺带修掉 `count` 读不到（executor 送 `count`、handler 读 `n`，张数恒为 1）。

- **第 10 刀 S-163（`5cf0c100`）** —— 新增 `docs/design-system.md`（198 行 / 13.9 KB），按现有 `theme-presets` 反向固化 token 与用法。**只梳理现有、不做改造**（09-29 17:51 裁定的范围）。

- **第 11 刀 S-164（`53a9c938`）** —— `dev-workflow.md` 的「文档组织」节新增「需求正文段落模板」七段（原话/来源 → 现象 → 代码链路 → 根因 → 修复方向 → 代价与取舍 → 刻意不做）。**仅对新登记需求适用**，历史需求不回溯补。

- **S-165 收口（不占刀）** —— `requirements/S-165.md` 状态改 ⏸，补 §六「裁定与收口」：裁定 = 不做；**核实结果记明「不是已经被修掉，而是暂时不值得做」**（S-142 修的是 thinking / text 分段归属，`OpenAIChatSseParser.cs` 在 iter-35 三刀里零改动）。

- **迭代收尾刀（审查与验证修复调整）** —— 门禁：`npm run typecheck`（web / node）全 0；`npm test` **65/65**（TS 49 + C# 16）。收尾刀内容：

  - **执行 S-167 审查报告的行动项**（`review_report.md` ⚠️-1/3/4/5/6/7）：
    - ⚠️-1：`cron-runtime.ts` 的 `new_session` 分支改走 `resolveSendModel(sessionId)`（原先自己 `resolveProvider(runEvent)` 一遍，`runMode === 'session'` 时 event 的 agentId/model 已被置 null ⇒ 回落全局，与 S-167 同病）；sidecar / bot 路径**有意保留** `resolveProvider` 并注明理由。
    - ⚠️-7：`use-chat-actions.ts` 的 `cancelPlan` 通知消息改走 `resolveSendModel(sessionId)`（原先读全局 `getActiveProvider()`）。
    - ⚠️-3：新增 `tests/send-model-resolution/`（9 断言，store 走 stub），把入口的优先级钉住。
    - ⚠️-4：修 `tests/provider-payload/program.ts:212` 的过期注释；`sendSites` 补 `use-background-subagent-wakeup.ts` / `goal-session-views.tsx`，`cron-runtime.ts` 显式豁免「不得手写 apiKey」那一半并注明理由。
    - ⚠️-5：清掉 `send-model-resolution.ts` 的 `(m: any)`。
    - ⚠️-6：把两处优先级细节（plugin 会话实际是 **channel > session**；渠道有 provider 无 model 时取**该 provider 的默认模型**而非全局激活模型）写进 `send-model-resolution.ts` 的注释。
  - **未采纳**：⚠️-2（`goal-session-views.tsx` 读全局 `activeModelId`）—— C# 侧注释明示那是 Goal 自身的 legacy fallback，改它会与 Goal 的优先级链打架，**单独立案**。
  - `review_report.md` / `verification_report.md` 随本刀入库。