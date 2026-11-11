# v3-iter-9 changelog

> 裁定与口径变更流水，按日期追加。跨需求，不塞进任何单需求文档。

## 2026-11-09

- **10:0x 老大「拆分新迭代」** ⇒ 从最新 `main`（`92afd54d`，= v1.0.8 发布记录）拆 `dev/v3-iter-9`，建 `docs/plans/iter-v3-9/`。产品版本目标 `1.0.9`，tag `v1.0.9`。执行期只 commit、不 push。
- **拆分结论：本迭代目前一条已确认的实施项都没有。** 老大只给了「拆分新迭代」四个字，没给主题、没给清单。所以这一刀只做三件事：切分支、落移交账、把「他说过但没落文档」的那批候选列出来等拍板。**不为了把文档填满而替他定主题** —— 上个迭代的教训是，范围一旦靠猜，后面几十刀都在补错的前提。
- **核对方式（写下来防下次重做）**：`docs/plans/iter-v3-8` 全量 34 个需求单的状态行逐条扫，**S-321 ~ S-351 全部已完成**、编号最大 `S-351`；全 docs 搜「下个迭代 / 下个版本 / 下一个迭代」，没有独立的候选池文件；`docs/progress/v3-iter-8.md` 的「遗留」段只有 S-320 与 A 档验收。⇒ **v3-iter-8 的正式移交就这些，剩下的都在对话里**，因此按「对话原话」单列在 [raw-requirements.md](raw-requirements.md) §三，并标注未核实。
- **顺手订正两处上一轮的误判**（详见 [raw-requirements.md](raw-requirements.md) §四）：
  - **`roadmap-post-1.0.md` 的「5 处失效 `src/` 路径」不存在。** 逐个 `Test-Path` 实测：`src/Astra.Clients/Adapters/WorkBuddyClientAdapter.cs`、`src/credential.ts` 在本仓**不存在**，因为那是**参考项目**的路径 —— 上下文写的是「实读 OpenCowork 的哪个文件」。改成我们的路径反而是错的。这类「指着别人仓库说实读」的路径，本来就该是对方写法。
  - **S-336 §五「12 个文件端点薄化」不是欠账。** 单内原话：「它们现在的 SQL 是各自唯一一份……留着不影响正确性、**也不算欠账**。后续谁碰哪张表，顺手换掉即可」。上一轮收尾把它记进待办是读漏了这句。
- **一条判据**：移交项必须 `Test-Path` / 打开文件核过才写进下一个迭代的待办池。v3-iter-8 收尾时这两处都是「看起来像欠账」就记下了，跟前两个迭代 S-277 / S-265 / S-281 三次错法是同一个病 —— **没打开文件就下结论，下个迭代会为一条不存在的东西排一刀**。
- **口径继承**（不变）：门禁三条 + 真机验收「dev 上跑过即通过」；只 commit 不 push；收尾由老大手动发起；`afterPack` 冒充扫描每次打包必跑。
- **抖音推广约束已解除**（v1.0.8 起公开面干净），本迭代不再受限。
- **10:08 老大「这里面的内容基本都是做了的，你可以去查看历史登记的需求排查」⇒ 11 条候选逐条核实，全部已实施。** 核实路径三步：① 抓 v3-iter-1 ~ v3-iter-8 全部 **135 个需求单首行标题**做编号映射；② 对每个编号跑 `git log --all --grep`；③ 读需求单状态行对照。结果与映射表见 [raw-requirements.md](raw-requirements.md) §三。
  - 落点依次是：C-1 → **S-278 / S-279 / S-280**（v3-5 交付，S-278 `f4f89e35`）；C-2 → **S-227**（`49dffe76`）；C-3 → **S-221**；C-4 → **S-289**；C-5 → **S-288 / S-286 / S-294**（S-288 `fc61ad88`）；C-6 → **S-235**（`23e5da37`）；C-7 → **S-236 / S-264**；C-8 → **S-248**；C-9 → **S-313**；C-10 → **S-307**；C-11 → **S-240 ~ S-244**（S-243 `0869d144`）。
  - **我犯的错值得记**：这 11 条全是真需求、真编号、真交付，我却因为「v3-iter-8 的清单里没有」就当成没做。**判据错在「用当前迭代的清单当全集」** —— 需求是跨迭代活的，一个编号登记在 v3-3、交付在 v3-5，从 v3-8 的清单里当然是看不见的。以后判断某条需求做没做，**只认 commit 和状态行，不认「在我手上这份清单里找不着」**。
  - 同一类错这一轮出现了两次、方向相反：v3-iter-8 收尾把**参考项目路径**当本仓欠账（假阳性），这次把**已完成的需求**当候选（假阴性）。合起来一条判据：**两个方向都必须打开证据核，记忆和清单都不算。**
- **顺手把 S-247 捡回来了**：它是 v3-iter-3 登记的「内存占用偏高（观测型）」，一直没写状态行。根因已由 v3-iter-8 的 S-322 结掉，而那套 memory 探针在 11-08 调完内存后按老大要求**已移除** ⇒「根因已解 + 可观测已撤」两项都成立，**建议直接关单**，列进 plan.md §三 待拍板。**关单这个动作不替老大做。**
- **S-265 早已收口**：需求单头两行写着「❌ 已撤销（2026-11-01 20:5x）」，这次扫清单时又被 `下一迭代` 命中捞出来一次 —— 已在 raw §四 记明，别再反复捞。
- **10:13 S-273 段 B 关闭，不立项**（老大「那就关闭吧」）。段 A（自家窗口走 CDP `Accessibility.getFullAXTree`）已随 v3-iter-4 刀 8 交付，原始诉求「让 dev 点自己的页面」已覆盖。不做的三条理由：**① 覆盖面窄** —— `EnumChildWindows` 只对记事本这类 Win32 控件有效，微信 / UWP 基本拿不到，最想点的那些恰恰覆盖不了；**② 体积倒挂** —— 方案 A 要独立非 AOT 进程，安装包 +60~80 MB（102 → 160~180 MB）；**③ AOT 三条路实测全断**（L1 `NETSDK1168`、L2 ILC 卡 `C++/CLI`、L3 运行时 `InvalidProgramException`），不是配置问题，是能力边界。
  - **重开条件写死在需求单里**：日后有真实场景报「某个具体软件点不了」，再按 S-273 §9.3 方案 A 单独立项。**§9.3 那套论证原样保留** —— 删了就等于把这一轮的实测白费，下次还得重跑三层探针。
  - 这条的处置方式值得记：**「关闭」不是「删除」**。关掉的单子要留下三样东西 —— 不做的理由、重开的条件、当时撑起结论的证据。前两个防止反复讨论，第三个防止重跑实验。
- **10:14 S-230（Qoder 账号接入）关闭，不立项**（老大「S-230 Qoder 关掉」）。**这条容易关错，记清楚**：
  - 表面上它一直挂着「**阻塞在契约**」—— 全树搜 `qoder` 零命中，`D:\claw` 下也没有 WorkBuddy 那套同级参考实现的副本。照这个读法，它像是「等有料就能开工」。
  - 但翻回单子 §4 第 2、3 条，它自述的是「流程若是 `server_poll` 就复用 S-218 那套、走同一条非官方接入合规提示链」—— 也就是说它属于**「非官方接入 + 用用户自己的订阅额度 + OAuth 冒充官方客户端」**这一类。
  - 而这一类已经被 **v3-iter-8 的 S-318 从公开面整体摘干净**：5 个 preset 删掉、「授权 AI 服务商」整页删掉、`lib/auth/` 整目录清、`afterPack` 加冒充证据硬拦截。
  - ⇒ **契约到手也不该做。** 缺契约是「做不了」，合规裁定是「不该做」，后者不随契约变化。这两件事以前被混在一格里写，正好是这次差点又按「等契约」挂下去的根源。
  - ⚠️ 补一句反向提醒：`afterPack` 那道闸扫的是 S-318 那 14 个关键字，**Qoder 不在里面** —— 挡不住它，只能靠这条裁定。
  - 重开条件：只在私有仓 `D:\claw\wishful-work` 自用场景讨论；公开仓不再接同类服务商。
- **10:19 S-232（prompt 前本地脱敏）关闭，不立项**（老大「这个直接关了」）。它 10-27 已经裁过「无限期搁置」，这次是**从「搁置」走到「终局关闭」**，不是重复裁定。
  - 搁置意味着「等条件成熟」，但把三条路重摆一遍，**没有哪条收益压得住代价**：
    - A 出站不可逆 —— 热路径全扫 + 击穿 prefix cache + `Write` 可能把 `[REDACTED]` 写进用户 `.env`；
    - B 来源侧 —— 挡不住用户自己粘贴、读本地文件，而真实泄露路径大多走这两条；
    - C 可逆占位 —— 唯一两头满足，但要维护映射表状态机（跨轮次存活 / 压缩后不丢 / 子 agent 与主会话共享 / 并发 turn 加锁）。
  - **更根本的一条**：key 是用户直连自己选的服务商，**服务商收到请求那一刻就能看到真 key** —— 脱敏防的是「服务商日志留档」，不是防我们。而 `Write(".env", "API_KEY=[REDACTED]")` 是真实可复现的文件破坏，概率远高于「服务商日志泄露」。**拿高概率的破坏换低概率的泄露，方向是反的。**
  - 关闭 ≠ 拆防护：`SanitizeExceptionMessage`（异常消息 3 条规则）、`CodeGraphPathSafety.IsConfigLeafNode`、`ProviderHttpHeaders` 全部照旧生效，已在 §11.3 记明。
  - **重开条件写死三条**（§11.4）：实证泄露 / 第三方审计列为必须项 / 架构改为经我们服务器中转。且重开必须**单独立项、不复活本编号**。
  - 处置方式沿用 S-273 / S-230 的规矩：**保留 10-27 的搁置裁定原文，新增 §11 关闭裁定**，两段并存 —— 搁置是当时的事实，关闭是现在的事实，覆盖掉前者就等于篡改记录。
- **10:24 S-247（内存占用异常偏高）关闭**（老大「247也关掉吧」）。这条是条「总账型」需求，关闭前逐项核过**没有可移交的未结子项**。
  - **可观测层已交付且仍在跑**（`memory-monitor.ts` 5912 B / `memory-shape.ts` / `diagnostics-handlers.ts` / `DiagnosticsPanel.tsx` / `tests/memory-monitor` 36 断言；`main/index.ts:359-360` 仍 `startMemoryMonitor()` + `registerDiagnosticsHandlers()`，设置页 `diagnostics` 页签仍在）。
  - **定性已收口**：不是内存泄漏，是「每帧重做」；生产构建锯齿 115↔203、GC 在收；老大 11-08 真机确认「确实是还了的」。
  - 派生项全部各自结案：S-322（会话驻留，治根）/ S-297（search-dialog 宽订阅，A/B 实测 0.20 MB/s）/ 侧栏签名订阅（190 行 362×）/ tail 纯文本（贡献 23%，保留不回滚）。**S-296 / S-293 本就是独立单，不属本条。**
  - 🔧 **订正一条过期表述**：raw §一 原来写「那套 memory 探针在 11-08 调完内存后按老大要求**已移除**」——**这是把两个东西混了**。被删的是 dev 渲染端探针 `src/renderer/src/lib/diagnostics/renderer-memory-probe.ts`（文件头自己写着「定性完连本文件一起删」，§21.5.3 记的也是它）；**主进程观测 `memory-monitor.ts` 一直在，从未移除**。所以「根因已解 + 可观测已撤」这个描述是错的，实际是「根因已解 + 可观测仍在」。已就地改正。
  - ⚠️ **一条不吞掉的东西**：老大 11-08 说过「这个可以设置回收周期么，或者我们可以主动触发回收之类的」。实测**既没登记成需求、也没实现** —— `docs` 下搜 `回收周期|主动回收|主动触发回收|强制回收|GC.Collect` 只有两处历史记录命中（§7 禁令 + v3-iter-4 探索结论），`src` 下零实现。而且 §7 原本就列着禁令「不做自动内存回收（定时 `GC.Collect` / 主动 kill 渲染进程）—— 拿副作用换数字好看」。⇒ 它是**待定想法，不是本单欠账**。关闭 S-247 **不代表这条想法作废**：要推进须**另开新单、不复活 S-247**（本单是观测型，性质不同），且得先解决「怎么回收不卡、不丢 UI 状态」。
  - 落笔口径：**关的是「这一单」，不是「这套观测」。** 观测是本单最值钱的交付物，留着以后用户报内存问题时用。
- **10:33 老大钉死归属原则：「本仓主要是负责做插件底座。不负责具体功能实现」。** 这句话重新切了 R 系（能听 / 会说 / 反代 / 插件化）的边界，**我此前切错了**。
  - 错法：我理解成「渠道发语音必须主程序干 ⇒ R-2 在本仓做」，于是把 TTS 合成也划进来。**把「通道能力」和「功能实现」混成了一件事。**
  - 正法：本仓做 manifest 加载、导轨入口、独立窗口、资产下载、生命周期、卸载清理、**通道能力**（录音采集 / 出站媒体）；**转写、TTS 合成、说话人分离、会议 UI、纪要生成全归插件（另一个项目）**。
  - 这条原则一落，R 系的处置立刻清楚了：**R-4 插件化**基座 8 条全落地（S-240~S-244，v3-iter-4 五刀：`plugin-window.ts` / `plugin-view-rules.ts` / `plugin-assets.ts` / `plugin-audio.ts` / `plugin-lifecycle.ts` / `plugin-cleanup.ts` / `extension-install-guard.ts` 等，未决只剩 `views[].mode` 仅 `'window'`）；**R-1 听**本仓部分已交付（录音采集三件套），转写插件在 `D:\claw\QwenAsr`、**该仓未建**；**R-3 反代**整条已空（WorkBuddy 被 S-318 摘、Qoder 由 S-230 关闭）；**R-2 说**本机朗读 `src/renderer/src/lib/speech.ts` 是 S-138 老底子、`window.speechSynthesis` 走 OneCore，**渠道语音发送零实现**。
  - ⇒ **本仓在 R-2 上缺的只有「出站媒体」这一格**，这是纯通道能力，属底座。据此登记 **S-352**、并在 roadmap 新增 **R-5「出站媒体通道」**。
- **10:36 老大「其他缺口，进行新迭代下的需求登记」⇒ 登记 S-352（R-5），本迭代定位由「主题待定」改为「底盘补格」。**
  - **根因是实读出来的，不是猜的**：统一接口 `MessagingChannelService`（`channel-types.ts:132-156`）出站只有 `sendMessage(chatId, content: string)` / `replyMessage(messageId, content: string)` —— **两个方法参数都是纯字符串，零 media 概念**；而同文件入站 `ChannelIncomingMessageData`（`:97-127`）有 `images` / `audio` / `mediaRefs` / `msgType` **四个媒体字段**。**同一个渠道，收的方向有媒体，发的方向没有。**
  - 七家逐家实读（这是这单的主要工作量来源）：飞书**有** `sendImageMessage`/`sendFileMessage`（`feishu-media-api.ts:199/220`）但**绕过统一接口**，调用方走 `channel-feishu-handlers.ts:39/79/352/363` 的 `service.api.media.*` 私有路径；微信 `sendItems(params.items: Array<Record<string, unknown>>)`（`weixin-api.ts:209`）是开放式 iLink `item_list`、**理论上能塞任意 item 但没有任何代码构造过语音**；**钉钉 `dingtalk-service.ts:273` / Discord `discord-service.ts:36` / QQ `qq-service.ts:100` / Telegram `telegram-service.ts:31` / 企业微信 `wecom-service.ts:31` 五家 `sendMessage(chatId, content: string)` 纯文本。**
  - ⇒ **飞书那两个方法之所以是私有实现，正是因为接口上没有位置放它们。** 一家有、六家没有，且有的那家长在渠道私有分支里 —— 这是「底座该收口而没收口」的典型。
  - **刀序据此排定**：刀 0 先做**七家能力逐家实机验证**（不动代码），刀 1 把飞书已有能力**收编进统一接口、不改行为**（纯搬家，先建立「接口改了行为没变」的信心，同 v3-iter-8 把 S-324 判据不变排最前的道理），刀 2~7 逐家接入一家一刀，刀 8 降级链路。**六家不并刀** —— 各家协议 / 鉴权 / 错误码完全不同，合一刀出事分不清是谁。
  - **倾向 C 方案**（单一 `sendMedia` 入口 + `supportedMediaKinds` 只读能力声明）的理由：入站已是四字段形态，出站走单一入口刚好镜像；**降级是刚需** —— 老大的原始诉求是「用户不方便看文字就直接听语音」，那么「这家发不了语音」必须能退回发文字而不是抛错，能力声明让这件事在**调用前**就能判断。
  - ⚠️ **写死一条前置**：没验完不写接口。猜着设计出来的抽象会被某一家的限制推翻。尤其「钉钉 / 企业微信机器人到底能不能发语音」要确认 —— 如果确认不能，`supportedMediaKinds` 为空**是正确结论，不是失败**。
  - **待老大一条裁定**：要不要降级（发不了语音时退回文字还是直接报错）。**不答我按「要」推，不回头问。**
- **10:46 老大裁定降级：「发不了就只能退避发文字呗」⇒ 降级从「待裁定」变成「既定行为」。**
  - 落法钉死：`sendMedia` 前查 `supportedMediaKinds`，不含目标 kind 就直接走 `sendMessage(text)` —— **不抛错、不静默丢弃、不弹窗**。
  - **调用方（插件）不需要知道这家支持什么，底座替它退。** 这条是「本仓做底座」原则的直接推论：让插件去判断七家各自的媒体能力，等于把底座的活推给插件。
  - ⇒ S-352 §5.2 方案 **C 定案**（单一 `sendMedia` + `supportedMediaKinds` 只读声明），阶段二「规划」标记完成。开工前置仍是**刀 0 七家能力逐家实测**，未变。
- **10:52 老大一句「247不是早就说的关掉么」揪出一处自留的假条目。**
  - 事实：S-247 在 **10:24 就关了**（`7dcdc73b`，我自己提的），而 plan.md §三 的待拍板表到 10:52 还把它列成「**待定**」。
  - **根子**：关闭动作和「待办清单」两处各写各的 —— 单子标了 ✅，清单里那一行却没人回去清。**清单会因此越攒越多假条目，下个迭代又照着它排刀。**
  - **改法**：plan.md §三 改成「无待拍板事项」，两条裁定并列 ✅；并写死一条规矩 —— **关单的同一次编辑里，必须回头把 plan / raw 里对应的待办行一起清掉。**
  - 顺手订正同一行的错述：原写「探针已移除」，实际被删的只是渲染端 `renderer-memory-probe.ts`，**主进程 `memory-monitor.ts` 一直在跑**（`main/index.ts:359-360`）。跟 §六 S-247 那条订正是同一件事，两处都改。
  - **本刀不 commit** —— 属文档订正，按纪律攒进收尾刀。

## 2026-11-09 11:0x~11:3x · 老大「继续推进」⇒ S-352 刀 0 / 刀 1 / 刀 2 三刀落地

- **刀 0（探索）落地时揪出登记里的两个事实错误**，两条都是我自己挖的坑：
  - **漏了一家** —— 登记时按「七家」算，实际是**八家**，漏了 **whatsapp**（`whatsapp-service.ts` 同样只有 `sendMessage(chatId, content)`）。
  - **微信判错** —— 登记写「微信 `sendItems` 是开放式 `item_list`，未验证语音」，实际 `WeixinService` 上**早就有了** `sendImage(chatId, buffer, text?)` / `sendFile(...)`（`weixin-service.ts:159/168`）。**根子：我只看到协议层（`weixin-api.ts`）就下了结论，没往上翻一层服务层。**
  - ⇒ 定性变了：**不是「补新能力」，是「把已经有的两家长在私有分支里的能力收编，再给其余六家补」**。
- **一个反复出现的病根：同一件事有两份实现。** 飞书和微信都是「IPC handler 一份 + `execute*ChannelTool` 一份」，各自把「读源 → 上传 → 发送」抄一遍。收编的价值不只是多个统一入口，**更是把抄出来的第二份删掉** —— 否则改一处漏一处，谁也说不清线上跑的是哪份。
- **`caption` 这个字段是「不改行为」逼出来的。** 微信 `sendImage` 第三个参数 `text?` 是附言，原 handler 一直在传 `args.content`；载荷里没有格就只能丢，那是真行为变化。所以加 `caption?`，飞书**忽略**它（飞书只认 key，要带文字得再发一条、消息条数会变）。**「文字必须送达」的调用方自己另发 `sendMessage`**，不靠这个字段。
- **`WeixinService.sendImage` / `sendFile` 删了**（收编后零调用方）。留着就是下一次又有人从私有分支走的入口。协议层 `api.sendImage` / `api.sendFile` 保留。
- **`feishu-service.ts` 501 行加豁免**（AGENTS.md §大文件拆分第 5 条第 3 类）：WS 生命周期 / 流式卡片轮转 / 入站媒体下载共享多份可变状态，拆开要新增中间层；出站媒体已抽走。
- **两个 `audio` 都不声明**：飞书要 `msg_type: 'audio'`（现有 `sendFileMessage` 硬编码 `'file'`）；微信入站已确证 `type: 3` + `voice_item`，但**出站结构一次没验过**。**验完再加，不猜。**
- **门禁**：两刀各跑一次 `npm run typecheck` 三配置 0 错 + `npm test` **130/130**。
- **提交**：`14837e16`（刀 1）→ `405bc9df`（刀 2）。plan.md 刀表与本节留到收尾刀。

## 2026-11-09 12:xx · S-352 刀 3：audio 出站 —— 上一段那套「推断」全废

- **起因**：老大「所以我们要做的是基座…至于怎么录音 怎么转写 那是另一个项目的事」+「我要的是能发语音」。
  上一段曾说「两个 audio 都不声明，验完再加，不猜」—— 但**根本没料可验**：环境里没有
  ffmpeg、没有 opus 样本、四家参考项目全无实现。老大 11:17 点了一句「不确认的可以去网上搜索方案，
  而不是自己蒙头去造」，这才去翻外网，一翻就翻到了官方 SDK。
- **关键证据**：[`abczsl520/weixin-bot-sdk`](https://github.com/abczsl520/weixin-bot-sdk)，
  描述里明写 `Send/receive text, images, videos, files, and voice`。`src/bot.js:sendVoice` 是完整原型。
- **上一段写的那三处推断，两处错、一处对**：
  | 项 | 推断 | 实际 |
  |---|---|---|
  | 上传 `media_type` | `2` | **`4`** —— 枚举 IMAGE 1 / VIDEO 2 / FILE 3 / **VOICE 4**，跟消息 `item.type`（VOICE = 3）**是两套编号** |
  | 时长字段 | `voice_len` | **不存在**，官方是 `encode_type` / `sample_rate` / `bits_per_sample` / `playtime` |
  | 加密块 | 与 image/file 同构 | **对**，唯一一条对的 |
  - 按旧代码发出去，`media_type: 2` 会被当**视频**上传。CDN 只看字节和 key，所以上传会「成功」——
    **最容易骗过自己的一种失败**。
- **改成枚举常量**：`WeixinUploadMediaType` / `WeixinVoiceEncodeType` 进 `weixin-types.ts`；
  `sendImage` / `sendFile` 的裸数字 `1` / `3` 一并换掉。同一个文件里两种写法并存，就是下一个坑。
- **`inferVoiceEncodeType(fileName)`** 按扩展名推 `encode_type`。原来的兜底名 `audio.opus`
  跟默认 `silk` 是自相矛盾的，兜底改成 `audio.silk`。`opus → OGG_SPEEX`（官方枚举无独立 opus 项），
  注释标了「真机播不出来先来改这行」。
- **工具入口才是最后一环**：协议写对但 agent 调不到，等于没做。七个文件一串：
  `channel-descriptors` → `ChannelPluginToolProvider.cs` → `AgentRuntimeChannelPluginExecutor.cs`
  （白名单 + 路由 + `RequiresApproval`）→ `ToolCallProcessor.Approval.cs` → `plugin-tools.ts`
  → `locales/{zh,en}` → `messagepack-channel-routing.ts`。
- **`messagepack-channel-routing.ts` 这条漏了会被测试当场抓住**：`npm test` 直接报
  「registered on `<channel>:msgpack` only but nothing routes to it」。那条测试就是为这种事写的，
  这次真派上用场了。
- **顺手发现一个既有缺陷，没修**：`FeishuSendImage` / `WeixinSendImage` 的 schema 写 `imagePath`，
  但 `R(call, "file_path")` 的回落规则是「有下划线才转 camelCase」，`imagePath` 没下划线 ⇒
  **模型照 schema 传 `imagePath` 会读到空字符串**。audio 三个工具我直接写 `filePath` 避开了。
  修它属于另一条线，记在 §6.5。
- **`weixin-api.ts` 压到正好 500 行**（原 496，加字段后 506，压注释回落）。全程没有走豁免。
- **门禁**：`npm run typecheck` 三配置 0 错｜`npm test` **130/130**｜`dotnet build` 两套 sln
  各 0 错误（主 sln 2 个 `NU1903` = S-320 挂账）。
- **状态**：S-352 代码部分收口。剩「微信 `encode_type` 真机是否匹配」要有样本才能验，不是欠账。

- **13:xx S-353 实施（`ab2b2dbe`）** —— S-352 刀 3 收尾时顺手发现的既有缺陷，老大 11:38「要修啊，登记需求，然后根据开发工作流推进」⇒ 当场登记 + 实施。与 S-352 同线，但独立一刀。
  - **病灶一句话**：schema 用驼峰（`filePath` / `userIds` / `recordIds`），路由代码按蛇形读（`file_path` / `user_ids` / `record_ids`），而 `JsonHelpers` 全是 `TryGetProperty` 精确匹配。旧的 `R()` 只给必填字符串打了个「名字含下划线才回落驼峰」的补丁 ⇒ 可选字段、数字、数组、布尔**全部读不到**，模型照 schema 传了也白传，报错还像是模型没传参。

## 2026-11-11

- **09:1x dev 只读审查交回 13 条发现**（`dev/v3-iter-9` HEAD `ab2b2dbe`，基线 `v1.0.8`，34 文件 / +1801 −233 + 项目级扫描）。台账 [review-2026-11-11.md](requirements/review-2026-11-11.md)，拆成 4 单：**S-354**（D-1/2/3/5，P1×4）／**S-355**（D-6/7，P1×2 含安全）／**S-356**（D-4/8/9/10，P2×4）／**S-357**（D-11 lint，不占刀序）。D-12 / D-13 不立项。
  - **一句话结论**：问题不在「写码」，在「接线」—— 零件全在，线没接。**与 v3-iter-7 的迭代标题是同一个病，第二次犯。**
  - **我自己复核了 D-1 与 D-2，都成立**。D-1：`grep channel-media` 全仓零 import，而 `feishu-service.ts:359` / `weixin-service.ts:165` 各写各的 `sendMedia`；D-2：`ChannelPluginToolProvider.cs:35` 无条件注册 + `ChannelOnly = ["*:channel@*"]` 不区分渠道，而 `ResolveGenericRoute`（`AgentRuntimeChannelPluginExecutor.cs:119-123`）只认 weixin/feishu，其余返回 `null` ⇒ `:55` 报 `Unsupported channel plugin tool`。
- **⚠️ 09:2x 揪出一个流程病：dev 建了单、写了台账，`plan.md` 一个字没动。**
  - `raw-requirements.md` §五 登记得挺完整，可 `plan.md` 刀序表第 38 行还挂着「降级链路 ✅ 已随刀 1 交付（`channels/channel-media.ts`）」—— **正是 D-1 判定为假的那一句**。
  - 11-09 那次是「**关了单，清单没清**」（S-247 关了但待办表还列着）；这次是「**建了单，清单没更**」。两次同根：**单子与清单两处各写各的**。
  - ⇒ **规矩扩成双向**：建单的同一次编辑里，把 `plan.md` 刀序表 + `raw-requirements.md` 实施项表一起加上；关单的同一次编辑里，把两处的状态行一起改。**单子与清单永不同步，就等于没有清单。** 已写进 [plan.md](plan.md) §三 第二条自省。
- **09:2x 老大「先补文档，然后根据开发工作流推进」** ⇒ 本轮先只补文档，不动代码：
  - `plan.md`：撤回第 38 行的假结论，改为「代码存在但零 import，真接线见刀 9」；新增 **§二·乙 第二轮刀序（刀 9 ~ 12）**；§三 拍板表从「无」改为「1 条待拍板（D-7）+ 2 条已定」。
  - `raw-requirements.md`：§〇 标题从「实施项（1 条）」订正为「（6 条）」（本来就漏算了 S-353），新增 **§〇·乙** 四行；§五 末尾「本轮没有动 plan.md」改为已处置。
  - 本 changelog 条目。
- **刀序排定：S-354（刀 9）→ S-355（刀 10）→ S-356（刀 11）→ S-357（不占刀序）**。S-354 最前，因为 D-1 是「文档说交付了、代码没生效」，不补则下一迭代照假结论排刀；S-355 排在 S-356 之前，因为 D-6 与「卡炸 / 内存暴涨」同源，是 P1 不是清理项。
- **⏳ 新增一条待拍板：D-7 路径边界**。渠道会话里这批文件工具**免审批直接执行**（`ToolCallProcessor.Approval.cs:81-84`，既有设计 —— 渠道弹不出审批框），而 `readBinarySource` 对 `source` 零校验 ⇒ `ChannelSendImage(source: "C:\Users\x\.ssh\id_rsa")` 可把私钥当图片发群。本迭代把 `ChannelSendAudio` 加进 `IsChannelFileTool`，等于多开一个入口。**「允许发哪些目录」是产品策略不是技术判断，我不替老大定**；方案 A（只登记风险）/ B（白名单）/ C（凭据类黑名单）已列进 [plan.md](plan.md) §三，我的倾向是 **A + C**。
  - **治根不是补名字**：`TryGetProp` 做驼峰/蛇形双向归一，`R` / `RArray` / `RBool` / `WOpt` / `WOptI` 一律走它。⇒ 旧缓存 prompt 里残留的老名字天然兼容，不用写兼容分支。
  - **实施中另挖出两处同源缺陷**：`BitableMut` 的 `if…else…;` 尾巴无条件执行（真传了数组必抛 `InvalidOperationException`，不只是读不到）；`FeishuBitableListApps` 的执行体是 `_ => { }`，一个字段都不写，schema 里那个 `pageSize` 永远送不到插件。
  - **一条方法论**：这个 executor 坏到现在没人发现，因为 `npm test` 130 条里**没有一条覆盖它**。补的 22 条断言钉的不是「某个函数返回什么」，而是**「`Get*` 必须与 `As*` 同源」** —— 原来 `GetString` / `GetBool` / `GetIntNullable` / `GetStringArray` 各把同一套「判 ValueKind 再取值」写了一遍，四份实现、四条演化路径，正是它们分叉才养出这个缺陷；只要有人再给其中一个单独写分支，断言立刻红。
  - **登记文档自身的错也记一笔**：S-353 初次登记时那张「schema 属性」对照表是从 executor 的读取代码**反推**的，没打开 provider 核，三处记错（`FeishuAtMember` / `FeishuSendUrgent` / `FeishuListChatMembers`）。实施时逐行实读订正，教训写进了单内 §3.3 的订正记录：**凡「对方那一侧长什么样」的列，必须打开对方文件看，不能从自己这侧推。**
  - ⚠️ **真机未测**（飞书 / 微信都没有发图、发文件、@人、加急、多维表格增删的实测环境）⇒ 本单剩余风险集中在「编译过 ≠ 能发」。
- **10:35 老大新登记 S-358：token 显示单位 `G` → `B`** ⇒ 立 [S-358](requirements/S-358.md)，刀序 **13**（§二·丙，非审查来源）。
  - **定性：口径变更，不是 bug。** `G` 是 S-194 登记时的原始口径（老大原话「我在考虑增加 G 这些单位」），按 SI 前缀 Giga 实现；现在改按 AI 行业通行 **`B`（Billion）**。这条写进单内 §1 与 §4，防止后人当缺陷「修回去」。
  - **改动面实测**：`format-tokens.ts:20` 一个字面量 + 同文件 3 处注释/例子 + `tests/token-format/program.ts` 4 处断言（`:46` / `:55` / `:56` 文案 / `:71`）。**26 个调用点零改动**（S-194 起就是唯一实现）；**C# 侧 `.cs` 零 token 格式化实现**，无跨语言同步。
  - **方案取舍**：A 只换字母（推荐，`B` 与 `G` 等宽等长，零布局风险）／B `B` + 中文括号（设置页定宽列会撑破）／C 全中文单位（等于推翻 S-194 整套断言与用户读法）。**默认按 A 执行**，中文口径你若确需则整条阶梯一起中文化，不是只在十亿级挂括号。
  - **排刀建议**：插在刀 9 之前 —— 一行实改、与渠道线零文件交集、且是用户可见的错误读法。等你一句话确认排位。
- **10:40 老大「根据你推荐来，根据开发工作流推进」** ⇒ S-358 按**方案 A** 实施，刀 13 插在刀 9 之前执行完毕。
  - **代码**：`format-tokens.ts` 的 `TOKEN_UNITS` `'G'` → `'B'`（含注释补「Billion 不是 Giga」的理由）；26 个调用点零改动，`k` / `M` / `T` 三档与精度分档、进位逻辑零触碰。
  - **测试**：`tests/token-format/program.ts` 四处期望值与消息同步 + 测试名改 `k / M / B / T`；**另加 1 条防回退断言**「十亿级不出现 `G`」—— 旧的 `endsWith('B')` 只能证明当前是 B，钉不住「有人改回 G」。
  - **门禁**：`npm run typecheck` 三配置 0 错；`npm test` **131/131**；`token-format` 单套 **28 assertions passed**。
  - **一处判断**：没排真机截图验收。`B` 与 `G` 同宽同长、只是字母变化，布局风险为零；dev 起界面一眼即可，不值得单占一刀。
  - **刀 9~11 排位不变**，从媒体线继续。
- **11:03 老大报缺陷：dev 默认服务商选中了未启用的 Ollama** ⇒ 立 [S-359](requirements/S-359.md)，刀序 **14**（§二·丁）。
  - **先纠我自己的判断**：10:52 我第一次的回答定性成「老问题、给绕过方案」，被老大 10:59 否掉 —— 「绕什么？这是以前一直没有的问题……是当前迭代弄出来的」。查证后**老大对**：引入点是 `7fc9647a`（2026-11-05，S-318 A 段），随 **v1.0.8**（`b68f8e37`）发布，正是本迭代 base 的上一版；v1.0.8 之前 `ensureBuiltinPresets` 没有这段挑选，只有「无 active 取 `providers[0]`」。
  - **第二次判断错**：我把判据写成分级「1. enabled&&apiKey / 2. enabled&&免 key / 3. providers[0]」，被老大 11:03 直接否 —— 「不看 enabled 不看是否启用 那看什么？必须是启用的。」`providers[0]` 那一档就是绕过 `enabled` 的口子，删掉。
  - **根因**：`nextProviders.find((p) => p.requiresApiKey === false || !!p.apiKey) ?? nextProviders[0]` 零 `enabled` 判断；内置投影默认 `enabled: false`（`provider-materialization.ts:64`），Ollama 免 key 且排在 preset 第 6 位 ⇒ 空配置启动必中。选中结果落盘后 `activeExists` 恒真 ⇒ 永久钉死，用户看到「选了服务商但没有模型」。
  - **实测证据**：dev 数据目录五家 `enabled && apiKey && models>0`（routin.ai / OpenCode Go / 商汤 / agnes / 小米套餐）被晾着，`activeProviderId` 指向 `enabled=false / apiKey='' / models=[]` 的 Ollama。
  - **判据分裂是本轮的真正发现**：横幅（`use-input-area-selectors.ts:218-225`）本来就写对了 `enabled && (免 key || 有 key)`，store 五处全不看 enabled ⇒ 「横幅说你有五家能用的，store 塞给你一个停用的」。**一套判据只能有一份实现。**
  - **修复**：`provider-materialization.ts` 新增 `isProviderUsable` / `pickActiveProvider` / `resolveActiveProvider` / `pickDefaultModel`（纯函数，plain-node 可测）；`ensureBuiltinPresets`、`getActiveProvider`、`deleteProvider`（两处）、`isProviderAvailableForModelSelection`、横幅 selector 全部收敛到这一份。
  - **迁移必须一起做**：老盘 `activeProviderId` 已指着 Ollama、`activeExists` 恒真，光改判据不会重挑 ⇒ `resolveActiveProvider` 把「存在」升级成「存在且可用」（悬空 / 停用 / 无凭据都失效）。
  - **空集合行为（老大 11:06）**：不选，`activeProviderId = null`；既有横幅会亮「未配置 API Key，点击此处打开设置」。`send-model-resolution.ts:72` 已有 `if (!provider) return null`，调用方吃得下 —— **不需要新造空状态**。
  - **不做模型数过滤**：老大只要求 `enabled`；用户启用 Ollama 而没拉模型是他自己的事，底座不替他否决。
  - **门禁**：`npm run typecheck` 三配置 0 错；`npm test` **131/131**；`provider-presets` 单套 **579 assertions**（新增 `active-selection-suite.ts` 19 条断言）。
- **11:20 老大再纠一层：模型本身也有启用状态** ⇒ 同一需求的下沉返工，并入 S-359 这一刀。
  - 原话：「逻辑还是有问题，我们模型本身也是有是否启用状态的，现在默认到小米套餐上了 但是模型本身是没有启用的模型」。
  - **实测**：`activeProviderId = xiaomi-coding`（provider `enabled=true` ✅），`activeModelId = "mimo-v2.5-pro"` —— 该模型 `enabled=false`；小米套餐里唯一启用的是 `mimo-v2.6-flash`，被跳过。
  - **根因下沉到 `pickDefaultModel`**：第一档 `m.id === provider.defaultModel` **不看 `enabled`**，`mimo-v2.5-pro` 正是 preset 的 `defaultModel`，直接命中；末档 `models[0]` 更是无条件。⇒ 用户把 preset 默认模型关掉，每次启动都被拨回来。
  - **修正**：`isProviderUsable` 增加 `models.some(m => m.enabled)`；`pickDefaultModel` 三档全部要求 `enabled`、删掉 `models[0]` 兜底（无启用模型返回 `undefined`）；`defaultModel` 从「选择依据」降级为「启用时才采用的提示值」。
  - **`activeModelId` 也迁移**：`ensureBuiltinPresets` 从「为空才补」改为「不存在 **或未启用** 就重挑」—— 否则老盘里那个停用模型永远拨不回来。
  - **判据现在两层一致**：服务商层与服务商内的模型层都以 `enabled` 为硬门槛；插件侧 `app-plugin-store.ts:176-178` 早就是这套双层判断，本次只是把 store 侧对齐。
  - **测试**：新增「零模型不可用 / 全部模型停用不可用 / `defaultModel` 指向停用模型时跳过（小米场景）/ 全停用无默认模型」4 条断言，套件 579 assertions。
- **11:26 老大「验收通过」** ⇒ S-359 关单。两轮判据修正（服务商层 `enabled` + 模型层 `enabled`）均已在 dev 实例实测生效；提交 `924e76f2`（未推送）。
- **11:30 老大「继续推进」** ⇒ 刀 9 开工，**发现 `3922a827` 早已做完 S-354，但三处清单仍写「待实施」** —— 第三次犯「单子与清单各写各的」。
  - 核实（不只看提交信息）：`channel-media` 12 处 `sendMediaOrText` 调用点、`SupportsOutboundMedia` 与 `IsChannelMediaToolAvailable` 同源、飞书 audio 注释已改实话、`npm run test:channel-media` 通过。四条**均真实生效**。
  - 订正：`S-354.md` 状态行 + §9 开放问题结案 + 新增 §10 实施记录；`plan.md` §二·乙 第 9 行、第 40/41 行（「降级未接线」假结论）、`raw-requirements.md:15/23/27`。
  - **新规矩**：落刀前先 `git log --grep=<单号>` + 实读代码，**不信清单状态行**。
- **刀 10 / S-355 D-6** ⇒ 出站媒体读源加固落地。
  - `MAX_OUTBOUND_MEDIA_BYTES = 30 MB`：**底座护栏，不复刻平台限制**。飞书 30MB / 图片 10MB、微信语音 60s 这些是平台规则，会变；抄进读源入口等于维护两份真相。护栏只回答「一次读多少字节算失控」。
  - URL 分支：`AbortSignal.timeout(60s)` + 先判 `content-length` + **不信声明值**（`getReader()` 边读边累加，超限 `cancel()` 断连）。
  - 本地分支：`existsSync`+`readFileSync` → `fs.promises.stat`+`readFile`，`stat.size` 先判、读后再判（TOCTOU 兜底）。
  - 顺带补两处可读错误：`Not a file:`（传目录，此前是 EISDIR）、`empty body`（此前静默 0 字节）。
  - **测试**：`tests/channel-media` 新增 `runSourceCases()` 7 条，含本地起 `http` 服务实测「声明值超限」与「chunked 流式超限」。超时不进套件（跑一次 60s），走 S-355 §8 手工验收。
  - **D-7 仍未拍板**（`source` 路径边界 A/B/C），本刀不动 —— 见 plan.md §三 第 3 条。微信侧 `encryptOutboundMedia` 的二次复制也没动：加上界后峰值从「无界」变「≤3×30MB」，可控。
- **刀 11 / S-356** ⇒ 一致性残局四项收口。
  - **D-4 别名方向差点写反**：第一版写成 `["imagePath"] = "filePath"`（旧名 → 新名），但代码是按 `filePath` 去读输入的 —— 该查的是「`filePath` 以前叫什么」。改成 `["filePath"] = ["imagePath","image_path"]` 后测试才真能命中。**别名表的方向由「读的那一侧」决定，不是由改名史决定。**
  - **D-9 是五处不是两处**：executor 写 ×2（`file_type` / `fileType`）+ C# schema 声明 + 渲染端 schema 声明 + handler 泛型 `fileType?`。只删写侧不删声明侧，模型照 schema 传照样白传 —— 与 S-353「传了读不到」是同一个病的两个方向。
  - **D-8**：删 `FeishuMediaApi.downloadUrl` 28 行，顺带删因此空掉的 `http` import；`feishu-outbound-media.ts` 头部注明「下载统一走 `readBinarySource`」。
  - **D-10 选补齐不选拆**：整条渲染端工具线（`plugin-tools.ts` 475 行）零 import 属实，但删它是方向性决定，单独立项；本刀补 `channelSendAudio` 一行，三处对齐即可。**待办另记**：那批导出要么接线要么清掉。
  - **门禁**：typecheck 三配置 0 错；`npm test` 131/131；`ChannelToolVisibility` **200 assertions**（新增 9 条别名断言）。
- **11:48 老大「渠道工具目前就是免审批」** ⇒ S-355 D-7 拍板 **A + C**，刀 10 余下部分落地。
  - **读法**：这是在确认前提（免审批是既定设计、不动它），不是让我绕开风险 —— 正因为免审批不能改，「读哪个文件」才是唯一还能挡的地方。
  - **C 黑名单**：`assertOutboundSourceAllowed()` 在 `readLocal` 的 `stat` **之前**调用 —— 连「文件存不存在」都不该告诉想发凭据的调用方。挡目录 `.ssh` / `.aws` / `.gnupg` / `.kube` / `.docker`，文件名 `.env*` / `.npmrc` / `.netrc` / `.pgpass` / `credentials*`，SSH 私钥名 `id_rsa` 等四个，扩展名 `.pem` / `.p12` / `.pfx`。
  - **刻意不拦**：`.key`（太泛，可能只是普通数据文件）、任意点目录（`.cache` 之类）、URL（远端资源不涉及本机凭据）、`id_rsa.pub`（公钥）。
  - **A 明文风险**：S-352 新增 §9 —— 黑名单之外**任意其它文件仍可被发出**，「这是已知风险，不是设计意图」，并写明「渠道会话里的 agent 等价于拿着这个账号的读权限」。
  - **B 不做**：白名单会把「把刚生成的图发出去」主场景一起挡掉（生成目录可能在数据根之外）。
  - **测试**：13 条必拒（含大小写 / 分隔符变体）+ 7 条不得误伤。**「不误伤」这半边比「必拒」更要紧** —— 误伤会让主场景挂掉。
  - 门禁：typecheck 三配置 0 错；`npm test` 131/131。
- **11:57 老大「现在还有很多文档欠账，去处理一下」** ⇒ 全量普查一轮，改了 9 处。
  - **查法**（不只扫关键词，三条并行）：① 全 `docs/` 822 个 md 的 Markdown 相对链接逐个 `Test-Path`；② 本迭代每张单的 `git log --grep=<单号>` 与状态行对照；③ 根目录活文档（`PROGRESS` / `iteration-plan` / `roadmap-post-1.0`）逐节核。
  - **断链只有 1 条真**：`S-355.md` 指向 `../iter-v3-3/requirements/S-247.md`，少一层 —— 从 `plans/iter-v3-9/requirements/` 出发，同级迭代要 `../../`。另一条 `S-307.md` 的 `\d{2}` 是代码块里的正则，扫描器误报。**全 docs 无其它断链**。
  - **S-352.md 状态行还写着「登记，未开工」** —— 本迭代从头到尾都在做它，这是**第五次**「单子与清单各写各的」：前三张单（S-354 / S-355 / S-356）的状态行都改过，唯独主单没人回头动。已改为实施状态 + 三个 commit 编号。
  - **门禁基线数字过期**：`plan.md` 文件头还写 `130/130（95 TS + 35 C#）`，本迭代实测 `131/131（96 TS + 35 C#）`。
  - **「6 条」→ 8 条**：`raw-requirements.md` §〇 标题数的是 S-352 + S-353，漏了后来追加的 S-354~S-357 与 S-358 / S-359。
  - **散落待办归口**：本轮有 4 条待办只写在各单正文里（S-356 §9「另记一笔」、S-355 §10.4「未做」、`plan.md`「收尾时统计即可」、S-357 移交），清单里查不到 ⇒ 新建 `raw-requirements.md` **§六**，分 5 小节（移交 / 代码残留 / 收尾 / 真机验收 / 长期挂账）。**规矩：下个迭代只认 §六，不认单内「另记一笔」。**
  - **D-12 复测**：`src/**/*.{ts,tsx,cs}` 的 `TODO|FIXME|HACK` 仍 **248** 处，与审查时同数 —— **无增量**，可作「本迭代没往里堆垃圾」的自证。
  - **`roadmap-post-1.0.md` R-5 整节停在「登记，未开工」** —— 已补：表格状态行、R-5 状态块、微信「未验证」那行的推翻说明、与 R-1 对称表的出站行、**新增 §落地结果**（接口形态 / 降级 / 已接入 / 未接入 / 读源护栏 / 路径边界）、开工前置的「已执行」注记、R-2 行、文件头追加记录。**「七家现状」表保留为设计当时快照**，因为它是 11-09 的实读证据，改了就丢了溯源。
  - **`review-2026-11-11.md` 加「处置状态」行** —— 台账从此只作快照，状态以 `plan.md` §二·乙 为准，**避免它被当成待办池**。
  - **没动的**：v3-iter-8 及更早的历史迭代文档。**存档不改** —— 那些是当时的判断记录，改了反而失去溯源价值。
  - **仍缺的（不是欠账，是收尾要写的）**：`docs/progress/v3-iter-9.md` 与 `PROGRESS.md` 的 v3-iter-9 行，迭代收尾那一刀一起补。
