# v3-iter-4（产品 1.0.4）—— 承接清单与刀序

> 分支：`dev/v3-iter-4`（base = `58136a9f`，= v1.0.3 收尾合并点，即最新 `main`；tag `v1.0.3` → `58136a9f`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.4`（开工时 `package.json` 是 `1.0.3`，收尾时改），tag `v1.0.4`。
> 状态：**阶段一勘察已完成（2026-10-28 17:57）**，10 条待决问题**全部拍定**（见 `exploration_findings.md` §七），§七 刀序已确认。
> 进度：**刀 0 ~ 14 代码 + 自动化回归全部完成（截至 2026-10-30 11:00），真机待验**；`npm test` **100/100**、`npm run typecheck`（node + web）0 错。刀序已走完，进入收尾。本迭代 `58136a9f..HEAD` 共 **26 个提交**（1 条建分支 + 25 条代码/文档），逐条与 §7.1 对照见该节末「收尾期补修」。
> 追加（2026-10-28 20:40）：**登记 S-261**（图像块 400 自愈缺失，S-246 下半段），承接条数 **9 → 10**，插入为刀 **1b**。
> 追加（2026-10-29 08:24）：**登记 S-262**（400 请求级拒绝的自愈与告知，通用兜底），承接条数 **10 → 11**，插入为刀 **1c**。
> 追加（2026-10-29 09:07）：**登记 S-263**（侧栏收起即崩，hooks 排在 early return 之后，S-240 回归），承接条数 **11 → 12**，插入为刀 **1d**。
> 追加（2026-10-29 09:32）：**登记 S-264**（脏图源头治理 —— 宁可标读图失败，也不把脏图送上上游），承接条数 **12 → 13**，插入为刀 **1e**，**发布前必须做完**（它同时消掉「一张脏图把模型永久标瞎」这个不可逆副作用）；同批**登记 S-265**（裸 body 400 归因不明）**移交下迭代**，不占承接、不占刀序，见 §2.5。
> 追加（2026-10-29 10:40）：**dev 第 6 轮审查补正，插入刀 1g**。S-264 / S-266 判决「真机生效」，但有 3 件事必须回去补（① Responses 用户消息路径漏 url 闸；② 容器完整性只活在 Read 工具里；③ S-262 一次性消费没动），另加 1 个产品级缺陷。**登记 S-267**（截图成功但页面是白的）随本刀交付，承接条数 **14 → 15**；**登记 S-268**（`DesktopScreenshot` 的 `path` 无效）**移交下迭代**，不占承接、不占刀序，见 §2.5。
> 追加（2026-10-29 11:02）：**登记 S-269**（摘要请求 429 重试窗口错配 ⇒ 降级成「摘要器不可用」），承接条数 **15 → 16**，插入为刀 **3b**（紧跟 S-242 之后）。生产实例日志坐实根因，不是猜的；**本迭代做**，理由见 §七 刀 3b。
> 追加（2026-10-29 13:56）：**登记 S-270**（新工具在聊天窗显示英文名 —— 中文标签表停在 OpenCowork 迁移期，且 `defaultValue: name` 让漏登记永远静默），承接条数 **16 → 17**，插入为刀 **10**。14:03 老大拍板「这些需要进本迭代」+ 两处待决口径（兜底用「工具 · 原名」、`en` 侧一并友好化），当天下午交付。
> 追加（2026-10-29 15:00 / 15:40 改判）：**登记 S-271**（失败的工具调用会从折叠块里跳出来 —— 三处判据不同步，所以「有时跳有时不跳」）。登记时按「收尾期插刀」移交下迭代，**15:40 老大拍板「方案 A，本迭代做」** —— 理由是本条不改后端、只动渲染层三条判据 + 一个 run 级计数，且当场就能在聊天窗一眼验收；承接条数 **17 → 18**，插为刀 **11**（排在刀 10 之后）。老大原话「感觉是偶然情况，并不是一定」，实为 S-225 §8 的刻意口径（错误必须露在折叠面板外）+ 三条判据不同步叠加，**改它须先拍板推翻 S-225 §8 那一半**；收尾期插刀要连带重跑 S-225 / S-248 两套真机验收，不动。
> 追加（2026-10-29 17:50）：**登记 S-274**（长文本流式时渲染进程涨到 4.3 GB 并崩溃 —— scrollTop 被 clamp 绕过「已钉底」守卫）。来源是 dev 实例日志实锤（`~/.wishful-claw-dev/logs/2026-10-29.log`：17:20:45 `memory type=Tab ws=4360MB`，17:20~17:34 连报 6 次 `Maximum update depth exceeded`），不是内存泄漏。**崩溃级，本迭代随刀 13 交付**；与 S-233（挂账的视觉抖动）同文件同链路但**根因不同**，修好本条不代表 S-233 已解决。
> 追加（2026-10-29 15:53）：**登记 S-272**（桌面坐标算不出来 —— 截图不给参照系）与 **S-273**（UI Automation 元素点击）。S-272 **跨迭代**：第一段（元数据补全 + DPI 判定修复）随**刀 12** 交付，第二段（相对坐标 / 网格 / 窗口枚举）移交 v3-iter-5，承接条数 **18 → 19**；S-273 换路径、工程量独立，**移交下迭代**，不占承接（见 §2.5）。老大 15:55 拍「做全，复杂的先登记，下个迭代推进」。
> 追加（2026-10-29 18:20）：**登记 S-275 / S-276 / S-277**（压缩链路三连）。来源是老大 17:53 报「上个会话全是压缩记录，用户消息其它的都看不到」，18:00 追问「能看出来是什么原因导致的么」。**不是显示 bug，是两个独立缺陷叠出来的**：①**S-275** —— `TailStart` 的 `minKeep = 2` 让尾部两条绕开 16384 token 预算，而一次 Read 截图正好产生「`tool_use` + `tool_result`」两条 ⇒ 243496 字符的 base64 原样钉在 wire 尾部 ⇒ 压完 3 分钟又超 ⇒ 50 分钟连压 9 次；②**S-276** —— 三处「数轮次」判据都用 `role = 'user'`，而压缩摘要的 `role` 就是 `user` ⇒ 首次加载 `turns=5` 拉回 10 条**全是卡、真实用户 0 条**（消息一条没丢，141 条都在库里）。S-275 / S-276 **建议本迭代做，待老大拍板**（不动数据结构、只动判据，与 S-274 同一条真机链路）；S-277（压缩产物在 `messages` 表永久累积，一天攒 20 张卡）**移交 v3-iter-5**，因为它的三个方案都要么改 schema、要么改分页口径。口径以 [S-275](requirements/S-275.md) / [S-276](requirements/S-276.md) / [S-277](requirements/S-277.md) 为准。
> 追加（2026-10-30 08:30）：**登记 S-278 / S-279 / S-280**（全局会话 ↔ 项目会话通信三连），**全部移交 v3-iter-5**，不占承接、不占刀序。来源是老大 08:19 一次给三条：①希望派发消息**渲染成组件**而不是裸文本；②普通消息也要能回执，且回执**只给卡片标识**、不操心参数；③全局任务的回执**不能只靠 agent 自觉**。①+②的根因是投递路径「完全模拟用户输入」（`project/send-session-message` → `chatStore.sendMessage()`）只传裸 `content`、无 meta，而 `reply_global_dispatch` 的 `dispatchId` 是必填 ⇒ 普通消息根本没有回执入口；③的根因是回执被实现成**可选工具调用**，而那段协议说明写在**消息正文**里，长会话一压缩就丢（正被 S-275 / S-276 放大）。**三条是一组**：S-278 打底（meta 通道）、S-279 扩 `kind`、S-280 借 meta 做强判据 —— 拆开做会各自半好。

## 一、从哪里来

v3-iter-3（1.0.3）收尾时，老大 2026-10-28 09:44 定：**「没有做的需求都移入下个迭代」**。

本文件只做**承接索引**。需求正文一律留在原目录，不搬家：

- 插件基座五条 → `../iter-v3-3/requirements/S-24x.md`
- 本迭代新登记的两条 → `../iter-v3-3/requirements/S-247.md` / `S-248.md`
- S-233 / S-230 → `../iter-v3-2/requirements/`

## 二、承接清单

### 2.1 新登记、已定开工口径（4 条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-247 | 内存占用异常偏高，但当时并无实际负载 | **代码 + 自动化回归已完成（2026-10-29 16:05，刀 6，commit `05e5166c`）** —— `memory-shape` / `memory-monitor` / `diagnostics:memory` / 设置页「资源与诊断」页签，`test:memory-monitor` 36 断言，`npm test` 96/96。**第一阶段交付「让内存可见」，优化本身在后续迭代**；本条真正的价值是给整场内存排查提供了 `ws` 维度实锤（`memory type=Tab ws=4360MB`）。真机四条待验（见 `S-247.md` §9.5） | [S-247](../iter-v3-3/requirements/S-247.md) |
| S-248 | 纯文本档换形态 —— 过程层降级为行式文本 | **代码 + 自动化回归已完成（2026-10-29 18:45）**（S-225 返工补丁；补「渲染形态」这根轴。三条硬约束：白名单不降级 / 切换档位完整可逆 / 报错只上红字） | [S-248](../iter-v3-3/requirements/S-248.md) |
| S-256 | 模型输出超长文本时整页像截图一样静止 | **代码 + 自动化回归已完成（2026-10-29 19:30）**（2026-10-28 14:55 老大定从 v3-iter-3 移来）。症状与 iter-v2-36 **S-149** 逐字重合，当年就写明「要真消除得上流式期间限制单帧渲染的文本量，未做、等口径」。三条口子：①`getCatchupStep = ceil(pool/K)` **无步长上限**，积压 10 万字符即单帧喂 5 万进解析器，且 `tests/streaming-render-pool/program.ts:66-68` 把「一百万字符也按比例排干、不设上限」**钉成断言**；②`useStreamingMarkdownBlocks` 只在「空行 + 下一行顶格」切块，无空行长段 / 未闭合 fence ⇒ tail = 全文累积，每帧全量重解析；③跑完那一下正文与思考各一次全量 markdown。全仓零 `content-visibility`。**开工前要先拍**：建议 A 步长上限 + B tail 强制分段，**A 必然要改那条既有断言的口径** | [S-256](../iter-v3-3/requirements/S-256.md) |
| S-260 | 内置浏览器保活池 —— 上限 2 个会话，满了要明确告诉 agent | **代码 + 自动化回归已完成（2026-10-29 17:20）** —— 判据收口在纯函数 `lib/browser/browser-keepalive.ts`（上限 2 / 可见与 leased 绝不淘汰 / 空闲 5 分钟回收），守卫接在 `closeRightPanelTab` 与 `openBrowserTab`，工具侧 lease 包裹整个调用。`npm test` 97/97。真机四条待验（见 `S-260.md` §9.3） | [S-260](../iter-v3-3/requirements/S-260.md) |

> ⚠️ S-260 在 v3-iter-3 收尾的承接清单里**漏列过**（只写了 8 条），17:24 拆分支时补回。
> **清单口径以本表为准：20 条承接**（9 条 + 20:40 登记的 S-261 + 29 日 08:24 登记的 S-262 + 29 日 09:07 登记的 S-263 + 29 日 09:32 登记的 S-264 + 29 日 09:50 登记的 S-266 + 29 日 10:40 登记的 S-267 + 29 日 11:02 登记的 S-269 + 29 日 13:56 登记的 S-270 + 29 日 15:40 改判进本迭代的 S-271 + 29 日 15:53 登记的 S-272（第一段）+ 29 日 17:50 登记、随刀 13 交付的 S-274，见 §2.4）。
> ⚠️ **S-275 / S-276 尚未计入上式** —— 已登记、已定位根因，但归属待老大拍板。拍板进本迭代则为 22 条，移交下迭代则两条一起挪进 §2.5。

### 2.2 插件基座五条（5 条，v3-iter-3 只登记未动码）

| 编号 | 标题 | 依赖 | 明细 |
|---|---|---|---|
| S-240 | 插件基座（1/5）· 清单扩展与导轨入口 | —— 地基 | [S-240](../iter-v3-3/requirements/S-240.md) |
| S-241 | 插件基座（2/5）· 视图独立窗口与生命周期 | S-240 | [S-241](../iter-v3-3/requirements/S-241.md) |
| S-242 | 插件基座（3/5）· 资产下载器 | S-240 | [S-242](../iter-v3-3/requirements/S-242.md) |
| S-243 | 插件基座（4/5）· 录音采集能力 | 无依赖，可并行 | [S-243](../iter-v3-3/requirements/S-243.md) |
| S-244 | 插件基座（5/5）· 安装确认与卸载清理 | S-240（验证依赖 S-241） | [S-244](../iter-v3-3/requirements/S-244.md) |

**开工注意**：S-243 的 Windows loopback 是最大不确定项（`getDisplayMedia` 拿不到干净系统音 / `desktopCapturer` 参数未实测）⇒ **先测再写**，不通就改 WASAPI loopback 原生模块。

### 2.3 挂账 / 阻塞（2 条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **挂账**。28 日 09:44 复验：探针 24 条心跳 0 命中、0 JITTER，**无可判定证据**。并发现判据两处盲区（见 §三） | [S-233](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约**，全树搜 `qoder` 零命中。契约不到不写任何请求代码 | [S-230](../iter-v3-2/requirements/S-230.md) |

### 2.4 本迭代新登记（14 条，全部已拍板）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-261 | 图像块 400 之后自愈缺失 —— 单张脏图卡死整个会话 | **已交付（刀 1b + 刀 1g 收口）**，dev 第 6 轮判决「真机生效」。**刀 1b**（2026-10-28 20:55，commit `fd386222`）修 marker 表与 url 绕过；**刀 1g**（2026-10-29 10:40）补完最后一块 —— `OpenAIResponsesInputWriter` 的用户消息路径还在用「url 非空」的旧闸（`HasImageContent` 与 `WriteResponsesMultimodalMessage` 各写一份），`file:///`、`oc-media://` 在那条路上裸透传。判据收进 `ProviderContentHelpers.IsSendableImageBlock` 单块版本，三条协议共用一个，再不会有调用点漏掉。**S-246 的下半段，不是重复需求**：S-246 只交付了输入端闸门，「脏块已进历史」的自愈路径在它 §7 被标「退化为兜底」而没做。两处根因：**A** marker 表缺上游原文 `unsupported image`（词形与表里 `does not support image` 不同）⇒ 自愈进不去；**B** `source.type==='url'` 的 image 块**绕过** S-246 白名单闸 ⇒ 400 源头没掐干净。红色约束：**S-236 判据 10 的两道闸（`AgentLoop.cs:464`）不许动** | [S-261](requirements/S-261.md) |
| S-262 | 400 请求级拒绝 —— 把失败变成 agent 的观察，而不是会话的死刑 | **已交付（刀 1c + 刀 1g 补正）**，dev 第 6 轮点名「一次性消费一字未动」。**刀 1g**（2026-10-29 10:40）把注入从「只活一轮」改成**按 `ToolUseId` 记死、撑满整个 run**：触发 400 的工具结果在报错前已写回 durable conversation，而 wire 副本每轮重建 —— 只换一轮，下一轮原文回来、同一 400 再来、指纹去重命中直接抛，会话照样废。新增 `ProviderRejectionToolUseIds` 集合 + `ProviderRejectionRegistrationPending` 登记开关，`ReplaceTrailingToolResults` 换成 `ReplaceMarkedToolResults`（按 id 认人，位置变了照样换）。**通用兜底，不是 S-261 的重复**：S-261 只管 image 块，本条管「认不出原因的 400」。做法沿用既有骨架 —— catch 链尾加第四个分支，把**本轮最后一条工具结果**替换成拒绝说明（`ToolUseId` 原样保留）后重发，同时 emit 事件告知模型与用户。**三道安全阀**：上限 2 / 报文指纹去重 / 必须有可替换对象。**口径变更**：S-236 判据 10 的「无关 400 不被截走」改为「不许静默吞掉」，`AgentLoop.cs:464` 两行不动 | [S-262](requirements/S-262.md) |
| S-263 | 侧栏一收起就白屏 —— hooks 被追加在 early return 之后 | **代码已修复（2026-10-29 09:07 登记，刀 1d）**，真机待验。**S-240 的回归缺陷，不是新需求**：`WorkspaceSidebar.tsx` 的 `if (!leftSidebarOpen) return null` 排在 S-240 新增的 `useExtensionStore` / `manifestViewItems` 两个 hook **之前** ⇒ 侧栏收起时少跑两个 hook ⇒ React 抛 `Rendered fewer hooks than expected`、整棵侧栏被 ErrorBoundary 兜走。修法：early return 后移到全部 hook 之后 + 原位留警告注释；顺带补 500 行豁免头（511 → 521 行）。**本条暴露的缺口**：项目没有 eslint（`rules-of-hooks` 用不上）、渲染端无组件测试，这类缺陷只能靠运行时撞见 —— 是否补工具链单独评估 | [S-263](requirements/S-263.md) |
| S-264 | 脏图源头治理 —— 宁可标读图失败，也不把脏图送上上游 | **已交付（刀 1e + 刀 1g 收口）**，dev 第 6 轮**真机判决「生效」**：造 7 张坏图全拦住，仓里 40 张真图全量跑判据**零误杀**，8 轮截图读图 + 113k tokens 上下文 + 历史 8 张图，日志 `400 / unsupported image / image block dropped` 零命中。老大原话「读图工具如果读到没有图，可以直接标读图失败么？而不是把脏图丢上去」。**S-236 / S-246 / S-261 的收口**：前三者都在修「撞了 400 之后怎么收场」，本条改「根本不让脏图出门」。勘察坐实**魔数判据全写好了、结论被三处丢掉**，真正漏水口是 `ProviderContentHelpers.ResolveSupportedImageMediaType:201-208` —— 嗅探认不出时**回落信任声明的格式**，而「脏图」的定义恰恰就是嗅探认不出。**三层一起改**（工具层签名校验 / 组包层去回落 / 脏图不写 `ImageVisionMemory`），缺一层就漏：真实日志 18 条图像 400 里 **10 条在微信渠道会话**，不经过 `FileReadTool`。**判据拆四档**，只有「认不出」才标失败，扩展名骗人要按真实格式纠正 | [S-264](requirements/S-264.md) |
| S-266 | 没写完的图 —— 签名合法但容器不完整，照样内联出门 | **已交付（刀 1f + 刀 1g 收口）**，dev 第 6 轮**真机判决「生效」**：7 张坏图全拦、40 张真图零误杀。**刀 1g 把覆盖边界补完** —— 判据原先是 `path` 形态，只有 `Read` 工具能用；而现场 18 条图像 400 里 **13 条在微信渠道**，那条路的图从来不是 agent 读出来的，是渲染层注入的历史块，组包时才第一次见到字节。拆成 `JudgeContainer(head, tail, totalLength, mediaType)` 共用判据 + `HasCompleteContainerInBase64` 入口（只解头部 16 字符与尾部一个窗口，不解全量），接进 `ProviderContentHelpers.IsSendableImageBlock` 的 base64 分支。**S-264 的第五档，不是重复需求**：S-264 修「认不出是什么格式」，本条修「认得出、但文件没写完」—— 签名在文件开头，截断在文件末尾，前者的判据天生够不着后者。现场（下载一半的截图 / 中断的保存 / 拷一半的 U 盘文件）头 8 字节完全合法 ⇒ 过完四档一路内联 ⇒ 400 `invalid image` ⇒ 坏块留历史每轮重发，与 S-246 同一现场、换了触发条件。**不做解码**（PNG 要 inflate、JPEG 要熵解码，AOT 体积与攻击面不划算），改看**容器尾部结束标记**：PNG 的 IEND 定值 / JPEG 的 EOI / GIF 的 trailer / WebP 的 RIFF 声明长度，只读头 + 尾 64 字节，常数级 I/O。判据刻意宽松（漏检代价是一次 400 有 S-262 兜底，误杀代价是模型彻底看不到好图） | [S-266](requirements/S-266.md) |
| S-267 | 截图成功但页面是白的 —— 工具报告成功，实际什么都没画 | **已交付（刀 1g，2026-10-29 10:40）**，真机待验。用 `file://` 打开未构建的 Vite 外壳时，`.tsx` 不转译 ⇒ 页面全白，但 `BrowserNavigate` 报 `success: true`、`BrowserGetContent` 拿回正确标题、`BrowserScreenshot` 返回干净的纯白 PNG，日志里的 `ERR_ABORTED` 只落在 subresource 上、`did-fail-load` 不触发 ⇒ **agent 拿到白图以为看到了，照着白图去改壳子，全程零报错**。判据两个条件同时成立才警告（视口抽样近全白 **且** DOM 几乎没元素、无可见文本），宁可漏报不许误报；**不改 `isError`** —— 截图确实成功了，模型需要的是一条「你看到的是空的」，不是一次假失败 | [S-267](requirements/S-267.md) |
| S-269 | 摘要请求被 429 拒绝，6 秒内重试三次全撞墙 —— 降级成「摘要器不可用」 | **已交付（刀 3b，2026-10-29 11:20）**，真机待验。生产实例日志五波全是 `ttft_admission_refused ... retry shortly (after 3~39 s)`，而我们 `SummaryRetryDelayMs=1500` 的退避只给 1.5s / 3s ⇒ 三次机会全落在同一个拒绝窗口。**摘要请求是整条 provider 链里唯一绕开 `ProviderRetryPolicy` 的地方** —— 自建静态 `HttpClient`（`:50-55`）、自建退避、非 2xx 时丢掉 `Retry-After` 头（`:846-850` / `:710-713`），而 `ProviderHttpException`（带 StatusCode + RetryAfter）与 `IsRetryableStatus` 早就写好。五条修法：A 改抛 `ProviderHttpException` / B 复用 `ComputeDelayMs` 并加 `maxBackoffMs` 参数（现有 `Math.Min(raMs, MaxBackoffMs)` 会把 29 秒压成 15 秒）/ C 429 不递减输入预算、真 400 不重试 / D 降级文案按原因分档 / E 原因透传进 `CompressionError`。**不含水印改动**（§三 更正） | [S-269](requirements/S-269.md) |
| S-270 | 新工具在聊天窗显示英文名 —— 中文标签表停在 OpenCowork 迁移期 | **已交付（刀 10，2026-10-29 14:20）**，真机待验。老大原话「后续其实处理了很多的新工具，这些工具都是直接显示英文名称，看着就不舒服，很多用户也看不懂」。**根因不止「忘了一条」**：①`permission.toolLabels` 只有 23 条、全是迁移期那批；②渲染点是 `t(key, { defaultValue: name })` —— 缺 key 静默回退英文原名，**机制上没有防漏**；③`FileChangeCard` 与 `ProcessTextLine`（S-248 新增）根本不查表，直接渲染原始 `name`。三件套一起做：补到 **61 条**（zh/en 对齐）+ 统一出口 `lib/tools/tool-display-name.ts`（历史别名归一 → 查表 → MCP → codegraph 前缀族 → 兜底「工具 · 原名」，绝不再裸回退）+ 新增 `test:tool-labels-coverage`（扫代码里的工具名常量反查表，漏补即红）。详见 [S-270](requirements/S-270.md) §8 |
| S-271 | 失败的工具调用会从折叠块里跳出来 —— 三处判据不同步，所以「有时跳有时不跳」 | **已交付（刀 11，2026-10-29 16:10）**，纯函数回归 12/12、闸做过反向验证，真机待验。老大原话「感觉是偶然情况，并不是一定」。**不是偶然，是刻意设计 + 三条判据不同步**：①`hasError` 一律判 `attention` ⇒ `force` ⇒ 渲染在折叠面板**外面**（S-225 §8「档位不得藏错误」的原做法）；②`hasStructuredOutputError` 靠**嗅探输出文本**，失败写在纯文本里就不算错误；③`canceled` 在白名单工具走不到 attention 分支；④卡片档与纯文本档判据不同 ⇒ 切档位表现就变。**方案 A**（老大拍板）：`hasError` 不再单独决定 `force`（只留 `pending_approval` / `requiresApproval` 判 attention），`ToolExecutionRun` 加 `failedCount`，折叠头出红色「M 个失败」徽章 —— 连续不再断裂，错误信号靠徽章 + 展开后的错误态保住，不靠把卡拎到面板外 | [S-271](requirements/S-271.md) |
| S-272 | 桌面坐标算不出来 —— 截图不给参照系，模型只能对着图瞎猜 | **第一段已交付（刀 12，2026-10-29 16:20）**，第二段移交 v3-iter-5。老大原话「它不知道怎么去点击坐标」。**不是模型笨**：①`CreateAppWindowCaptureContent` 只回 `WxH`、不含窗口在屏幕上的位置 —— dev 最后一步拿着这张图永远算不出屏幕坐标；②`captureDesktopScreenshot()` 算了 `originX/originY/displayCount`，C# 编码只用 `width/height`，前两项丢在半路；③`ExecuteScreenshotAsync` 请求体是空对象，图里没有任何参照；④工具描述写 `Absolute X coordinate`、不说是哪个坐标系（模型看的是上游缩放过的图）；⑤**`isPointInsideDesktop()` 拿 DIP 边界校验物理像素坐标** ⇒ 150% 屏右半边点不动（违反 `iter-v2-23/plan.md:28` 早就写下的 screen-physical 规矩）；⑥截图只有整屏一张。第一段：截图 / 窗口截图的文本行补齐 origin、scale、每块屏矩形与窗口 DIP+像素矩形；判定改按物理像素边界、报错带边界数值；四段工具描述改成「以最近一次截图的原点为参照」。第二段（下迭代）：相对坐标 `{x:0.62,y:0.28}`、可选网格、`DesktopListWindows` + 按窗口截图 | [S-272](requirements/S-272.md) |
| S-274 | 长文本流式时渲染进程涨到 4.3 GB 并崩溃 —— scrollTop 被 clamp 绕过「已钉底」守卫 | **已交付（刀 13，2026-10-29 17:50）**，闸 103 → 110 条、做过反向验证，真机待验。**根因**：跟随目标 `realBottom + gapTarget - clientHeight` 里的 gapTarget 是提前量（最多 240px），大于容器底部 padding；尾部行未挂载那帧 `scrollHeight` 撑不住 ⇒ 浏览器 clamp 写入值（写 1000 读回 760）⇒ `Math.abs(scrollTop - bottom) <= 1` 守卫永远不成立 ⇒ 每帧写 scrollTop → scroll 事件 → `setIsAtBottom` → layout effect → 再写。**为什么现在才发作**：S-256 把流式拉长到几十秒（以前一帧吃完就静止，循环跑不了几轮）+ S-233 的 `observeGrowthOnly` 让 floor 与可滚范围脱钩 + S-176 的 gapTarget。**修法**：新增纯函数 `clampScrollTop`，四处写入点先夹、守卫改对夹取后的值比较。见 [S-274](requirements/S-274.md) |
| S-275 | 压缩对图片工具结果无效 —— 24 万字符 base64 钉在保留尾部，压完 3 分钟又超 | **已交付（刀 16，2026-10-30 12:40）**，真机 4 条待验（见 `S-275.md` §十）（2026-10-29 18:10 登记）。会话 `9yXnLPAM…` 50 分钟连压 9 次、16 条非 skip `DIAG`、峰值 `inputTokens=503539`。**根因**：`TailStart`（`ContextCompression.cs:557-583`）的 `minKeep = 2` 让尾部两条**不参与** `DefaultTailTokens = 16384` 的预算判断；而一次 Read 截图恰好产生「`assistant(tool_use)` + `user(tool_result)`」两条 ⇒ 243496 字符的 base64（`EstimateTextTokens` 估成 24 万 token，预算的 15 倍）原样钉在 wire 尾部 ⇒ 压完仍 16 万 token ⇒ 立刻再压。**建议方案 A**：压缩前把超预算的 `image` block 占位化成 `[图片已省略：xxx.png 1680×1120，可重新 Read]`，语义不丢、体积降三个数量级。**代价**：只动压缩一个纯函数，可做反向验证 | [S-275](requirements/S-275.md) |
| S-276 | 聊天窗「最近 N 轮」把压缩摘要当成用户轮 —— 打开会话满屏「任务暂告一段落」 | **已交付（刀 17，2026-10-30 12:00）**，真机 3 条待验（见 `S-276.md` §十）（2026-10-29 18:05 登记）。**消息一条没丢**（141 条全在库里：真实用户 51 / 摘要 20 / 助手 50 / 边界 20），是三处「数轮次」判据都只看 `role` ⇒ 摘要吃掉名额：`session-slice.ts:77-90`、`DbMessageToolsQueries.cs:75-77 / 84 / 93`。实测首次加载 `turns=5` ⇒ 拉回 10 条**全是压缩卡、真实用户 0 条**。**修法**：统一 `isRealUserTurn`（`role=user` 且无 `meta.compactSummary`），三处同口径；压缩卡照常返回但不能占名额。最低限度先修渲染窗口 + worker 窗口起点两处 | [S-276](requirements/S-276.md) |
| S-283 | 桌面截图 / 窗口截图落盘返回路径 —— 图不再只活在内存里 | **已交付（刀 15，2026-10-30 12:05）**，真机 4 条待验（见 `S-283.md` §十）。老大原话「我希望是放到数据目录的临时文件里面，返回的是路径」。**方案 A**：落盘 + 路径写进文字行 + image block 照旧保留 —— **本轮不省上下文**（省靠 S-275），本条是 S-275 的**硬前置**：占位文案「可重新 Read 查看」要靠图真在盘上才成立。目录 `{dataRoot}/screenshots/{yyyy-MM}/{sha256前16}.png`，渲染端零改动 | [S-283](requirements/S-283.md) |

### 2.5 移交下迭代（10 条，不占承接、不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-265 | 裸 body 400 —— 上游只回 `{"model":"xxx"}`，30~52 秒慢拒绝，归因不明 | **待查，下一迭代**（2026-10-29 09:32 登记）。家里电脑真实日志里 14 条，全在会话 `Uy5QPV02…`、全打同一渠道。**与 S-264 / S-261 不是同一个 bug**，别合并。S-262 已能保证它不钉死会话（替换工具结果重发一次 + 指纹去重后抛），代价是每次多烧一次 30~52 秒请求 —— 可接受，不是缺陷 | [S-265](requirements/S-265.md) |
| S-268 | `DesktopScreenshot` 的 `path` 参数完全无效 | **待开工，下一迭代**（2026-10-29 10:40 登记）。与 S-267 同一类：**工具报告成功，实际没做成**。`ExecuteScreenshotAsync` 的请求体是 `CreateJsonObject(_ => { })` 空对象，除了 `delayMs` 一个字段都没读，`path` 从未被解析；而 `CaptureAppWindow` 认真解析并落盘。两个工具调用姿势长得一样、行为差一半 ⇒ 模型照搬 `CaptureAppWindow` 的习惯传 `path`、以为存了、下一轮去 Read 一个不存在的文件。**比直接报错更糟：报错模型会换招，假成功让它继续往下走。** 建议补 `path` 支持（照抄既有实现），不是只在描述里写「不支持」 | [S-268](requirements/S-268.md) |
| S-273 | 桌面操作别算坐标了 —— 用 UI Automation 直接找元素 | **待开工，下一迭代**（2026-10-29 15:53 登记）。**S-272 的换路径版**：前者把「看图算坐标」的误差压小，本条干脆不算。`DesktopQueryElements` 读 UIA 元素树（`name` / `controlType` / `rect`），`DesktopClick({ window, element })` 取矩形中心点，`DesktopType({ element })` 先 SetFocus。Chromium / Electron 把 DOM 可访问性树暴露给 Windows UIA，**我们自己的页面完全可点**。只作增强路径，不替代坐标路径（第三方原生应用覆盖度参差）。开工前四件待查：主进程有没有 `setAccessibilitySupportEnabled`、DOM→UIA `Name` 映射、AOT 下 `IUIAutomation` 互操作、混合 DPI 下 `BoundingRectangle` 坐标系 | [S-273](requirements/S-273.md) |
| S-277 | 压缩产物在 `messages` 表永久累积 —— 一个会话一天攒 20 张「任务暂告一段落」 | **待开工，下一迭代**（2026-10-29 18:15 登记）。同一会话 21 个快照 / 20 对消息行，占全部消息 14%。wire 侧是对的（旧摘要一律折进折叠区，one-summary invariant 没破），错的是持久化与渲染从不清理。**三个方案待拍**：A 加 `superseded_by` 只展开最新一对（可与 S-276 的 `is_artifact` 列合并成一次迁移）/ B 删旧行（破坏溯源，且动 `sort_order` 游标）/ C 纯渲染端合并（零迁移，但窗口仍被卡占名额）。不删 `session_compaction_snapshots` —— 那是唯一证据链 | [S-277](requirements/S-277.md) |
| S-278 | 全局会话发给项目会话的消息是裸文本 —— 希望识别出来渲染成组件 | 2026-10-30 08:19 登记，**下一迭代**（v3-iter-5）。项目会话里看到的是一条 `role=user` 纯文本，正文是 `[GLOBAL AGENT WORK REQUEST] dispatch_id=…` + 一段给模型看的英文协议说明，**用户全看得见**。根因：`project/send-session-message` 走 `chatStore.sendMessage()` 完全模拟用户输入（文件头注释自述 *fully simulating a user action*），只传 `content`、无 meta，渲染端只能嗅探正文前缀；dispatch 记录与这条消息**没有 id 级关联**。附带：同一段协议文本有两份实现（C# `AgentRuntimeGlobalTaskExecutor.cs:233-235` vs 渲染端 `task-board-store.ts` `buildWorkRequestContent`，注释自称 mirrors），**措辞已漂移**。推荐方案 A：meta 带 `dispatchId`/`globalTaskId`/`kind`/任务标题，协议说明移出消息正文。见 [S-278](requirements/S-278.md) |
| S-279 | 普通消息（`send_session_message`）发出去就没法回 —— 需要轻量回执 | 2026-10-30 08:19 登记，**下一迭代**（v3-iter-5）。`send_work_request` 有 dispatch 记录能回执，`send_session_message` **裸 content 无任何标识**（`AgentRuntimeProjectExecutor.cs:274-328`），而 `reply_global_dispatch` 的 `dispatchId` 是必填 ⇒ 普通问答回不了。现有 `followUp` 是反方向定时追问（`delayMs>=1000`），救不了。方案：普通消息也建轻量 dispatch（`kind=message`，建议 `gm_` 前缀），复用同一个回执工具（**不拆两个**，S-270 的教训是出口越少越好），默认 `hidden_from_board`。见 [S-279](requirements/S-279.md) |
| S-280 | 全局任务的回执不能只靠 agent 自觉 —— 需要确定性的归档机制 | 2026-10-30 08:19 登记，**下一迭代**（v3-iter-5）。`reply_global_dispatch` 是可选工具，模型会漏：①协议说明写在消息正文里，长会话一压缩就没了（正被 S-275/S-276 放大）；②活干长了收尾忘了；③不觉得这算「汇报」；④这轮压根不是在做这件事。**把状态正确押在模型自觉上本身就是设计缺陷**（同 S-267/S-268 病根）。方案三层：投递态 → `loop_start`/`loop_end` 事件驱动执行态 → 归档分**显式 / 隐式**。三条硬规矩：显式覆盖隐式、隐式必须标明「未显式回复」不许伪装成完成、自动归档只写 dispatch 记录不塞消息。核心难点是「这一轮是不是在干这个 dispatch」—— 推荐借 S-278 的 meta 做强判据，先落地可用中判据 + 三条收窄。见 [S-280](requirements/S-280.md) |
| S-281 | 主窗口根容器挂了一层全窗口 `backdrop-blur-xl`，而窗口不透明 —— 纯烧管线，零视觉效果 | 2026-10-30 11:05 登记，**下一迭代**（v3-iter-5）。`main.tsx:196` 与 `:302` 两处根容器是 `h-screen w-screen … rounded-2xl bg-background/95 backdrop-blur-xl`，24px 模糊铺满整个窗口；而全仓 `transparent: true` 只有 `quick-launcher/window.ts:146` 与 `clipboard-enhancer.ts:588`，**主窗口不透明** ⇒ 模糊采样的背后就是自己的背景色 ⇒ 肉眼零差别，但 Chromium 照样每帧走整屏模糊 pass、根容器被迫独立合成层。**不是本次内存暴涨的原因**（已定性命为 dev 加载方式），吃的是 CPU/GPU，且是流式卡顿类问题的放大器。修法 A：删 `backdrop-blur-xl` + `bg-background/95` 改 `bg-background`；修法 B（若真要毛玻璃）走主进程 `backgroundMaterial: 'mica'`，不要靠 DOM。附带：全仓另 20 处 `backdrop-blur` 需逐一确认「背后真有内容可透」，弹层多数该留、小面积元素可评估。见 [S-281](requirements/S-281.md) |
| S-282 | `WISHFULCLAW_DATA_DIR` 指向全新目录时首次启动静默退出 —— userData 子目录没人建，Chromium 建不了单例锁 | 2026-10-30 11:05 登记，**下一迭代**（v3-iter-5）。**阻断级，且是排查时连踩两次的实测**。`index.ts:257` `app.setPath('userData', resolveDataPath('electron-user-data'))`，而 `resolveDataPath` 只拼不建 ⇒ 新目录下建 `SingletonLock` 时父目录不存在 ⇒ `process_singleton_win.cc:446 Lock file can not be created! Error code: 3` ⇒ 进程直接退出，**没有窗口、没有对话框、日志文件都没建出来**（退出早于日志初始化）。一直没暴露是因为 dev 数据目录是历史积累的、`electron-user-data` 早在第一次启动时就被 Electron 建过。影响面：**S-223 工作区隔离想换全局数据目录就起不来**、多实例并行起不来、用户手工迁移起不来。修法：`setPath` 前 `mkdirSync(userDataPath, { recursive: true })`（必须在 `requestSingleInstanceLock()` 之前，现顺序是对的）；建目录放调用点、别塞进 `resolveDataDir`（解析不该有副作用）。附带记一笔：全局数据用 `WISHFULCLAW_DATA_DIR`、项目记忆用 `WISHFULCLAW_PROJECT_DIR`，两套目录两个开关，做隔离时容易漏配。见 [S-282](requirements/S-282.md) |
| S-272 第二段 | 桌面坐标：相对坐标 / 网格 / 窗口枚举 | **待开工，下一迭代**。第一段已随刀 12 交付（截图补 origin / scale / 每屏矩形、判定改物理像素）。第二段是「让模型根本不用算绝对坐标」：①相对坐标 `{x:0.62,y:0.28}`（按最近一次截图的矩形归一化，抗移动与换屏）；②可选网格叠加图（图上直接标刻度，模型读格子）；③`DesktopListWindows` + 按窗口截图（`CaptureAppWindow` 已有 `bounds` + `scaleFactor`，补一个枚举入口即可拼出）。**与 S-273 分工**：S-273 是换路径（UIA 找元素），本条是把现有坐标路径做稳，两条并行不冲突，先做哪条都能独立验收 | [S-272](requirements/S-272.md) |

### 2.6 渲染进程内存：已定性为 dev 环境，不是产品缺陷（2026-10-30，非需求）

老大 09:51 的原话是「我一直在闲聊，现在内存都到 2G 了，这个问题不解决，本迭代就必须回滚了」。**这是本迭代最可能触发回滚的一条，实测后撤案。**

| 实例 | renderer WS | 运行时长 | 加载方式 |
|---|---|---|---|
| dev（vite dev server） | **1256 MB** | 启动 5 分钟即到位，之后横盘 | 78.5 MB 未压缩预构建依赖 + 871 个未压缩源码模块 |
| preview（同一份代码 + 同一份数据） | **240 MB** | 启动 45 秒 | 构建产物，走 `file://` |
| 生产 1.0.3（打包 asar） | **337 MB** | 运行 17 小时 | 45 MB minify bundle |

**同一份代码、同一份数据库，只换加载方式，差 5.2 倍。** 差异全在 V8 堆外（三档 `jsHeapUsed` 都只有 100 MB 上下），来源是 V8 编译未压缩模块的字节码 / 字符串常量池 / code space。

**三条被数据推翻的错误判断（留档，避免重走）**：

1. ~~监听器累积泄漏~~ —— CDP `jsEventListeners` 在 335～10985 之间**大幅波动**，不是累积；我们自己的 add/remove 账本净存活稳定在 263。波动值与 GC 时机相关，不可当判据。
2. ~~闲聊期间持续泄漏~~ —— 10:05～10:35 机器完全空闲，1256 → 1279（±2%），**零增长**。形态是「启动 5 分钟一次性冲上 +500～700 MB，之后只在有渲染活动时涨，涨上去 Chromium 不归还」。
3. ~~产品代码退化~~ —— preview 用同一份代码只要 240 MB。

**已排除的取证手段**：CDP `Memory.startSampling`（native 分配栈）在 Windows 上返回空 profile，此路不通。

**由此定下的口径**：

- **验收一律走 `npx electron-vite preview --skipBuild`**，dev 只用于开发时的热更新。**dev 的内存数值不具备性能判据价值**，不得再拿它判断产品退化。
- dev / preview 并行时用 `WISHFULCLAW_DATA_DIR` 分离全局数据目录（注意 S-282 的坑：新目录首次启动会静默退出，需先建 `electron-user-data/`）。
- 本节与 [S-247](../iter-v3-3/requirements/S-247.md)（内存可见性）不是一回事：S-247 交付的观测能力保留，它的数值必须按本节口径解读。

## 三、S-233 移交时必须带走的两条盲区

这轮复验没抓到抖动，但**不能因此判定「抖动不存在」** —— 是探针有两处覆盖不到。下个迭代重开 S-233 时先补这两处，否则再跑多少轮都是 0 命中：

| # | 盲区 | 具体 | 影响 |
|---|---|---|---|
| 1 | **只采 `out=1` 的帧** | 心跳条件是「正在等模型响应」。工具执行中、组件渲染回收时 `out=0`，**完全不采样** | 而抖动最容易发生在渲染回收阶段 —— 主战场恰好是盲区 |
| 2 | **位移判定窗口 1~40px** | `isSmallChange` 只认小幅位移。2026-10-28 09:34:19 实测一帧 `st` 12435.3 → 11739.3（**-696px**）而 `sh` 反而 +19，被直接挡在判据外 | 视觉上的「跳一下」可以是几百像素，不是几像素 |

**同时要带走的事实**（省得下个迭代从零查）：

- `36aca60e` 定论：TanStack Virtual 贴底时自写 `scrollTop`，证据链未塌
- `d8a00a3b`：盲区帧不采信回落，已断掉一批自持环路径
- 判据收紧后实测：10-28 那次报警从 3 次命中降到 1 次（不报警）；10-27 同样 1 次；合成真抖动 8 次仍报；合成流式增长 0 次不报
- `mh`（水位线）与 `sh`（scrollHeight）每帧**完全相等** ⇒ 两条判据实际是同一个信号，不是两个独立维度

## 四、v3-iter-3 的真机待验项（**已清空**）

原本挂四条待验，2026-10-28 09:48 老大确认**基本都测过了**：

| 需求 | 待验什么 | 结果 |
|---|---|---|
| S-234 | 更新说明二次打开不空白 | 已验过 |
| S-235 | 5 条判据（清除浏览数据链路） | 已验过 |
| S-245 | 耗时读数无小数 | 已验过 |
| S-246 | 脏 image 块 | **验收口径校正** = 「源头不产生脏块」，不是「脏会话能救回来」⇒ 不需要造脏会话 |

⇒ **无遗留溢入本迭代**。

## 五、门禁基线

**2026-10-28 17:31 复跑实测，与 v3-iter-3 收尾值一致，未漂**：

| 命令 | 结果 |
|---|---|
| `npm run typecheck`（node + web） | exit 0，0 错 |
| `npm test` | **89/89** |
| `dotnet build src\runtime\WishfulClaw.sln -v m` | 0 警告 0 错误（16.42 s） |

**2026-10-28 18:15 第 1 刀后复跑**：`npm test` 由 89 变 **90/90**（新增 C# 套件 `ExtensionManifest`，13 条断言），其余两项不变（typecheck exit 0 / `dotnet build` 0 警告 0 错误）。⇒ **本迭代门禁基线上调为 90/90**。

**2026-10-29 09:55 刀 1e + 1f 后复跑**：`npm test` **91/91**（`ProviderRejection` 套件是 91 的那一条，S-262 加的），`npm run typecheck` exit 0，`dotnet build tests\WishfulClaw.Tests.sln` 0 警告 0 错误。⇒ **本轮门禁 91/91**。

**2026-10-29 10:40 刀 1g 后复跑**：`npm test` **91/91**（`ImageInput` 62 / `ImageMediaGate` 38 / `ProviderRejection` 43 / `ReadImage` 77 全绿），`npm run typecheck` exit 0，`dotnet build src\runtime\WishfulClaw.sln` 与 `tests\WishfulClaw.Tests.sln` 均 0 警告 0 错误。⇒ **门禁仍是 91/91**（刀 1g 只加断言不改套件数）。

> 刀 1g 期间修掉一个**自己造成的**红灯：`ImageMediaGate` 的 `goodContent` 用的是 14 字节的 PNG 头（签名 + IHDR，**没有 IEND**），S-264 之后容器完整性判据一接上组包层就把它拦了。那是对的 —— 素材本身发不出去 —— 已换成完整的 1×1 PNG。

**2026-10-29 11:40 刀 2 后复跑**：`npm run typecheck` exit 0（node + web），`npm test` **92/92**（新增 `plugin-view-rules` 套件 22 断言）。本刀无 C# 改动，`dotnet build` 沿用 10:40 的 0 警告 0 错误。⇒ **门禁 92/92**。

> 刀 2 期间门禁抓出一条真缺陷：新增的四个 `plugin-view:*` channel 忘了进 `MESSAGEPACK_INVOKE_CHANNELS`，`test:ipc-msgpack-routing` 直接拒 —— **typecheck 抓不到这类错**（两边都对，就是接不上）。

**2026-10-29 刀 3b ~ 2026-10-30 刀 14 · 套件数逐刀推进**（此前七次复跑只写在 §7.1 各行里、没回写到本节，收尾时容易拿 92 当基线，故一并归拢）：

| 刀 | 需求 | `npm test` | 新增/变化 |
|---|---|---|---|
| 3b | S-269 | **93/93** | 新建 `SummarizerRetryChecks.cs`，24 断言 |
| 4 | S-243 | **94/94** | 新建 `test:plugin-audio`，46 断言 |
| 5 | S-244 | **95/95** | 新建 `test:plugin-cleanup`，96 断言（含 19 个必须拒绝的 id） |
| 6 | S-247 | **96/96** | 新建 `test:memory-monitor`，36 断言 |
| 7 | S-260 | **97/97** | 新建 `test:browser-keepalive`，36 断言 |
| 8 / 9 | S-248 / S-256 | 97/97 | 只改渲染层与流式池，无新套件 |
| 10 | S-270 | **99/99** | 新建 `test:tool-labels-coverage`；补正后 9 → **12 条断言**（加 C# 侧扫描 + 状态栏） |
| 11 | S-271 | **100/100** | 新建 `test:tool-run-folding`，12 断言 |
| 12 / 13 / 14 | S-272 / S-274 / 刀 14 | **100/100** | 只加断言（`scroll-watermark` 103 → 110），套件数不变 |

⇒ **本迭代门禁基线最终值：`npm run typecheck`（node + web）exit 0 · `npm test` 100/100 · `dotnet build tests\WishfulClaw.Tests.sln` 0 警告 0 错误 · `test:tool-labels-coverage` 12/12 · `test:render-density` 19/19 · `test:tool-run-folding` 12/12。** 收尾复跑以本行为准。

> 刀 11 的闸做过反向验证：把 `hasError` 判据临时注回 attention 分支 ⇒ 断言 3 变红（`actual ['t3'] / expected []`），撤销后恢复 12/12。刀 13、14 同法验证过 `clampScrollTop` 与 rail 重测。

> 修构建命令：根目录没有 `.sln`，只有 `tests\WishfulClaw.Tests.sln`。上面 §五 开头那条写的 `src\runtime\WishfulClaw.sln` 实际不存在（`MSB1009`），以本条为准。

跑之前确认过：`bin\Debug` 下无 `WishfulClaw.Worker.exe`、无开发用 `electron.exe`（只有打包版 `C:\Program Files\WishfulClaw\` 的 worker，按约定不碰）。

## 六、文档状态

- `plan.md`（本文件）—— 承接索引 + 目标 + 刀序
- 需求正文**不复制**，一律链接原目录；本迭代**新登记**的需求才落 `requirements/`
- `raw-requirements.md` —— 需求清单（2026-10-28 17:24 建；§三 已按探查订正）
- `changelog.md` —— 裁定与口径流水（2026-10-28 17:24 建）
- `exploration_findings.md` —— 阶段一探查报告（2026-10-28 17:44 落盘，含 §七 全部拍定）

## 七、刀序（已确认，2026-10-28 17:57）

排序依据只有两条：**依赖**、**不确定性先暴露**。同一依赖链内不并行，避免改同一批文件。

| 刀 | 需求 | 为什么排在这 |
|---|---|---|
| 0 | S-243 **探路**（只测不改码） | Windows loopback 是本迭代最大不确定项。**已于勘察阶段消解大半**：`session.setDisplayMediaRequestHandler` + `Streams.audio: 'loopback'` 官方支持 Windows（`electron.d.ts:23668-23674` 注释原文），**不需要原生 WASAPI**。本刀只剩三点实测：①纯音频 `getDisplayMedia` 是否被允许 ②整机混音必含自身播放（**已拍接受**）③48 kHz stereo → 16 kHz mono 下混 |
| 1 | S-240 | 基座地基，S-241 / S-242 / S-244 全部依赖它。**阻断点**：`ExtensionManifestNormalizer.cs:52-55` 的 `tools.Count == 0` 强校验 + `:60-105` 字段白名单，**三处必须同刀改**（TS 类型 / `ExtensionModels.cs` / 归一化器） |
| 1b | S-261 | **插在刀 1 之后**，理由三条：①线上已发生的真缺陷、用户可见（会话直接废掉），不是待验功能；②改动面小且集中（`ImageInputErrors.cs` + 组包层 url 分支 + 两个 locale），与插件线**零交集**；③正好趁刀 1 收尾、`npm test` 基线刚从 89 抬到 90 时补，回归缺口最小 |
| 1c | S-262 | **紧随 1b**。与 1b 共用同一条 catch 链，连着做能一次把「400 不许钉死会话」这条线收干净；且它改的是 `AgentLoop` 主循环 + 状态类，与插件线同样零交集。排在 1b 之后而不是之前，是因为 1b 的专项分支必须在它**前面**匹配（否则通用兜底会抢走图像 400） |
| 1d | S-263 | **紧随 1c**。S-240 的回归缺陷，用户可见（侧栏一收整页白掉），而且它正好挡住老大要做的 400 真机复现 —— 不先修，后续任何真机验证都测不了。改动只落在一个渲染端文件，与 1c 零交集 |
| 1e | S-264 | **紧随 1d，且必须在发布前做完**。与 1b / 1c 同属「400 这条线」的收口：1b 管图像 400 的自愈、1c 管认不出的 400 不钉死会话，本条管**别让脏图出门**。三层一起改（工具层 / 组包层 / 记忆层），共用 `ProviderContentHelpers` 那套嗅探判据，分开做要改两遍。**排在最后**的理由：它动的是全 provider 共用的发送层判据，爆炸半径比前两刀大得多（改严万一误杀 = 所有渠道所有图都发不出去），必须等 1b / 1c 的回归基座先在位。**发布前必须做完**的真理由：它顺带消掉「一张脏图把能看图的模型永久标瞎」这个**不可逆**副作用 —— 不带这个修复发 1.0.4，等于把不可逆的坑推给所有用户 |
| 1f | S-266 | **紧随 1e**。它补的是 1e 那道判据够不着的另一半：签名位于文件开头、截断发生在文件末尾，所以「按签名判」天生放行截断。两刀共用 `ImageFileProbe` 与 `ReadImage` 的分档结构，分开做要把第五档插进半成品里重排一遍。**与前序各刀零交集**（不动 catch 链、不动组包层、不动渲染端），所以敢放在这条线的尾部 |
| 1g | S-261 / S-262 / S-266 补正 + S-267 | **dev 第 6 轮审查的回头刀，插在 1f 之后**。1b~1f 全部判决「真机生效」，但 dev 点出三处「修了却没修完」：① S-261 的 url 闸最后一次没补到 `OpenAIResponsesInputWriter` 的用户消息路径；② S-266 的判据只活在 `Read` 工具里，而真实日志 13/18 条走微信渠道、根本不经过它；③ S-262 的一次性消费上一轮就点名、这轮仍未动。三处**都不是新需求，是同一条线的收口** —— 分开做会把同一份判据改三遍。S-267 顺路带上：它和 S-264/266 同一个病根（坏数据包装成好东西发出去），改动面在渲染端、零交集。**排在这里的理由**：再往后拖，1b~1f 的「已完成」就会变成假状态 |
| 2 | S-241 | 依赖 S-240；同时是 S-244 的验证前提 |
| 3 | S-242 | 依赖 S-240，与 S-241 改的文件不重叠。落盘根 `~/.wishful-claw/plugin-assets/` |
| 3b | S-269 | **插在刀 3 之后**，理由三条：①**线上真缺陷、用户可见** —— 老大自己 10-29 一天撞了五波，所有长会话用户都会撞，不是待验功能；②改动面集中且与插件线**零交集**（`ContextCompression.cs` + `ProviderRetryPolicy.cs` 抽 `internal` + 两个渲染端文案 + locale），可以随时插；③它和 1b~1g 同属一条主线 —— **上游拒绝之后怎么收场**：1b/c 管 400、1e/f 管别让脏数据出门，本条管 429 要按人家说的等。**排在这里而不是更早**的理由：它改的是 provider 重试判据（`ComputeDelayMs` 加参数），刀 1c / 1g 的回归基座必须在位，否则 429 分流一改会把 400 那条线的断言搅乱 |
| 4 | S-243 **落地** | 照第 0 刀结论写；**不引入原生 WASAPI**，不通则麦克风先交付、系统音挂账 |
| 5 | S-244 | 依赖 S-240，验证依赖 S-241；收口整条基座，用假插件跑通五条 |
| 6 | S-247 | 内存治理第一步「看得见」；**消费形态已拍**：状态面板常驻数字 + 超阈值写日志，轮询 5 s。**落地时改为设置页「关于 → 资源与诊断」页签**（场景是事后复盘与用户报障，不是实时盯；采样与日志不依赖面板打开），理由见 `S-247.md` §9.2 |
| 7 | S-260 | 随 S-247 同批；**已拍**：全局上限 2、满了拒绝新开并结构化告知 agent。⚠️ 此处原写「不做 LRU」是 S-247 讨论期的口头说法，与需求 §4.2 的淘汰分级表**冲突**，实施以需求为准：软淘汰（不可见 + 无 lease + 空闲最久）确实做了，缺 lease 时才轮到「拒绝 + 告知」，细节见 `S-260.md` §9.2 |
| 8 | S-248 | 纯渲染形态改造，与后端无关，独立一刀。**已拍**：`text` 档完全不渲染工具卡片、折叠保留、错误行红色。**交付（2026-10-29 18:45）**：新增形态轴 `card \| line`（只有 `text` 走 `line`）、`process-text-line.tsx` 行渲染、折叠面板内间距归零；发现并订正一处口径冲突 —— S-225 的「force 项浮出面板」会把报错弹回卡片，text 档已收窄为「只有仍需卡片的项才浮出」，错误留在面板里当红行。`tests/render-density` 14 → **19 组** |
| 9 | S-256 | 放最后是因为它牵动流式渲染主链路。**已拍**：允许改 `tests/streaming-render-pool/program.ts:57,68` 的「不设步长上限」契约，**且必须同刀修根因 B**（tail 永不 settle） |
| 10 | S-270 | **排在刀 9 之后**：纯显示层，与后端 / 流式渲染主链路零交集，真机待验的其它刀不受它影响；改完立刻能在聊天窗一眼验收。唯一的耦合是 S-248 新增的 `process-text-line.tsx` —— 它本身就在渲染裸 `name`，同一刀顺手接上，避免「刚做完纯文本档就露新的英文名」 |
| 11 | S-271 | **排在刀 10 之后**：与刀 10 同在渲染层，刀 10 刚把折叠行的标题接上中文名，本条紧接着调折叠归属，两刀的验收可以在同一次真机里做完。**不排更早**的理由：它改的是 S-225 §8 的口径，必须先由老大拍板；口径一定，改动就只有 `execution-outline` 一条判据 + 折叠头一个徽章 |
| 13 | S-274 | **收尾期插刀，排在最后**：崩溃级缺陷，只动 `useMessageListScroll.ts` 一处判据 + 一个纯函数，不改数据结构、不加参数、与后端零交集。**必须先于其它真机验收** —— 它会污染所有长文本相关的验收结果（4.3GB 自激重渲染下，任何流的观感都不可信）。见 [S-274](requirements/S-274.md) |
| 12 | S-272 第一段 | **排在刀 11 之后**：纯元数据 + 一处坐标系判定，改的是 C# 文本行与主进程两个 handler，与渲染层 / 流式链路零交集。只加字段与文案、不加参数，随机化面最小 —— 收尾期插刀只允许这个形状。第二段要加 `grid` / `window` / 相对坐标三个参数，必须等下一迭代 |
| 15 | S-283 | **S-275 的硬前置**，必须先做：压缩占位文案会写「可重新 Read 查看」，图不落盘这句就是假的。改动面横跨主进程两个 handler + C# 两处文案 + 一个纯函数模块，**不改数据结构、不加参数**，随机化面小 |
| 16 | S-275 | **代码 + 自动化回归已完成（2026-10-30 12:40）** —— 新增 `ContextCompression.ImagePlaceholder.cs`（275 行）：`TailBudgetTokens` 作为尾部预算唯一出口、`PlaceholdOversizedImageResults`（conversation 侧，降估算）+ `PlaceholdWireMessageImages`（wire 侧，降上游真实 token）成对调用、`PlaceholdImageBlocks` 逐块重建保序。`PlanCompaction` 与 `CompactAsync` 读同一个预算数。新套件 **26 断言**（含幂等与「一块 base64 都不许漏」）。**测试抓到真 bug**：第一版「遇到图才建列表」把第一张图之前的 text 块全丢了，两条断言当场红。`npm test` **102/102**、`typecheck` 0 错、`dotnet build` 0 警告 0 错误。真机 4 条待验 |
| 16 | S-275 | **病根**。压缩尾部预算把 image block 的 base64 长度当 token 算，一条截图 24 万字符 ≈ 24 万 token，是 16384 预算的 15 倍 ⇒ 压完 3 分钟又超、50 分钟连压 9 次。方案 A：保留尾部超预算的 image block **就地占位化**，不拆 `tool_use`/`tool_result` 配对 |
| 17 | S-276 | **代码 + 自动化回归已完成（2026-10-30 12:00）** —— **放大器**，紧跟 16。四处「数轮次」只看 `role` 不看 `meta.compactSummary`（比登记时多一处）：渲染层 `trimMessagesToRecentTurns`、worker `totalTurns` / 窗口起点两分支 / `hasMore`。抽共用 `isRealUserTurn()`（渲染层）+ `RealUserTurnPredicate`（worker SQL 常量，跨语言无法共用函数，两侧各有套件钉住）；**不加 `is_artifact` 列**，走 `meta LIKE`，零迁移。`trimMessagesToRecentTurns` 搬到 `lib/agent/turn-window.ts` 是为了能在 node 侧验「切片结果」而不只是验判据。新增 `test:real-user-turn`（**10 断言**）+ C# `RealUserTurn` 套件（**21 断言**，真库跑 `ListByTurns`）。`npm test` **104/104**、`typecheck` 0 错、C# 0 警告 0 错误。反向验证：谓词退回 `role = 'user'` ⇒ `expected 6, actual 14` 当场红。真机 3 条待验 |

### 7.1 刀序进度

| 刀 | 需求 | 状态 |
|---|---|---|
| 0 | S-243 探路 | **已完成（2026-10-28）** —— 结论全部写进 `exploration_findings.md` §1.7 与 `S-243.md` §3.3 / §4.3 / §6。硬结论：纯音频 `getDisplayMedia({audio:true})` 直接抛 `AbortError`，**必须先要 video 再丢掉 video track**；loopback 与麦克风实测都是 48 kHz / 1 ch，但实现必须按 `track.getSettings()` 动态取值，不写死单声道 |
| 1 | S-240 | **代码 + 自动化回归已完成（2026-10-28 18:15）** —— 改动 9 个文件（TS 契约 / 3 个 C# 扩展模块 / 侧栏 / zh·en locale / 测试 sln）+ 新增测试套件。真机三项待验（点入口提示 / 停用消失 / 卸载无残留），见 `S-240.md` §5.1 |
| 1b | S-261 | **代码 + 自动化回归已完成（2026-10-28 20:55，commit `fd386222`）** —— 判据 1 / 3 / 4 由自动化覆盖（ImageInput 套件 33 → 53 条断言），判据 2 / 5 / 6 待真机。现场未在本机复现（事发在家里 PC 打包版实例，日志零命中），根因读码定案 |
| 1c | S-262 | **代码 + 自动化回归已完成（2026-10-29 09:10）** —— `ProviderRejection` 套件 39 条断言把判据、指纹去重、替换语义、三道安全阀全钉住，`npm test` 91/91。真机待验（见 S-262 §6 验收清单）。commit hash 由收尾刀统一订正（amend 前为 `1bede63c`） |
| 1d | S-263 | **代码已修复（2026-10-29 09:07）** —— `WorkspaceSidebar.tsx` early return 后移到全部 hook 之后 + 原位警告注释 + 补 500 行豁免头（511 → 521 行）。全仓同款扫描 `NO VIOLATIONS`。真机 5 条判据待验（见 S-263 §五） |
| 1e | S-264 | **代码 + 自动化回归已完成（2026-10-29 09:55）** —— 三层一起落地：`ImageFileProbe.DetectMediaTypeFromFile` 签名判据、`FileReadTool.ReadImage` 四档分流、`ProviderContentHelpers.ResolveSupportedImageMediaType` 去掉回落、`AgentLoop` 脏图不写 `ImageVisionMemory`。**顺带修正欠账**：`ImageMediaGate` 套件三条断言仍停在「嗅探不出 ⇒ 信任声明」的旧口径（S-264 改实现时没跟着改），已改为「一律丢块」并补一条 null 声明覆盖。真机待验（见 S-264 §六） |
| 1f | S-266 | **代码 + 自动化回归已完成（2026-10-29 09:50）** —— `ImageFileProbe.HasCompleteContainer`（PNG IEND / JPEG EOI / GIF trailer / WebP RIFF 长度）+ `FileReadTool.ReadImage` 第五档。`ReadImage` 套件 40 → 70 条断言（新增最小 PNG 编码器，stored deflate + CRC32 + Adler-32），`ReadVideo` 76 条全绿。真机待验（见 S-266 §六） |
| 1g | S-261 / S-262 / S-266 补正 + S-267 | **已完成（2026-10-29 10:40）** —— ①`ProviderContentHelpers.IsSendableImageBlock` 作为单块判据，Responses 的 `HasImageContent` / 组包过滤 / 两处裸透传（Responses + chat 的 tool result 路径）全部改走它；②`ImageFileProbe` 拆出 `JudgeContainer` 共用判据 + `HasCompleteContainerInBase64` 入口（只解头部 16 字符与尾部窗口），接进 base64 分支；③S-262 改成按 `ToolUseId` 记死、撑满整个 run（新增 `ProviderRejectionToolUseIds` + `ProviderRejectionRegistrationPending`，`ReplaceMarkedToolResults` 替掉 `ReplaceTrailingToolResults`）；④新建 `browser-screenshot-blank.ts`（白图抽样 + DOM 探针），`executeBrowserScreenshot` 尾部拼警告。断言：`ImageInput` 53 → 62、`ReadImage` 70 → 77、`ProviderRejection` 39 → 43、`ImageMediaGate` 38（素材修正）。真机待验（见 S-261 / S-262 / S-266 / S-267 各自的验收清单） |
| 2 | S-241 | **代码 + 自动化回归已完成（2026-10-29 11:40）** —— 新增主进程 4 个文件（`plugin-window` / `plugin-view-rules` / `plugin-lifecycle` / `plugin-view-handlers`）+ index 注册 + 渲染端 channels / routing / 侧栏真开窗 + locale 两条。`plugin-view-rules` 套件 22 断言。**门禁抓到一条真缺陷**：四个 channel 漏进 `MESSAGEPACK_INVOKE_CHANNELS`，`test:ipc-msgpack-routing` 直接拒（typecheck 抓不到）。真机 7 条待验（见 S-241 §8.4），夹具 `fixtures/fake-plugin/` |
| 3 | S-242 | **代码 + 自动化回归已完成（2026-10-29 13:20）** —— 主进程下载器（状态机 / 多源回退 / Range 续传 / 流式 sha256 / 并发闸门 2 / 取消保留 `.part`）+ 七个 IPC 动作 + 进度广播 + 渲染端资产区（卡片 compact + 详情带进度条）+ shared 契约。`plugin-assets` 套件 **38 断言**（本地 http server 真下载）。真机九条待验（见 `S-242.md` §5.1），层 3 空状态与层 2 安装前体积提示分别挂给真插件视图与 S-244 |
| 3b | S-269 | **代码 + 自动化回归已完成（2026-10-29 11:20）** —— ①`ProviderRetryPolicy.ComputeDelayMs` 提 `internal` + 加 `maxBackoffMs` 参数；②`ContextCompression` 新增 `SummaryFailureAction` / `SummaryFailurePolicy` / `ResolveSummaryFailurePolicy` 纯函数，`SummarizeAsync` 三个 `catch` 收成一个按 policy 分流（429/5xx 原样重发、只有 `context_length_exceeded` 才砍预算、真 400 直接放弃）；③非 2xx 改抛 `ProviderHttpException`，保住状态码与 `Retry-After`；④失败原因（`rate_limited` / `server_error` / `timeout` / `context_overflow` / `other`）透传进 `context_compressed` 事件，渲染端按档位给文案，不再一律说「摘要生成不可用」。新建 `SummarizerRetryChecks.cs`，**24 断言**锁判据 2/3/4/7。`npm test` 93/93。**判据 1（mock 端点看真实等待间隔）与判据 5 的真机部分待老大验**（见 S-269 §八） |
| 4 | S-243 落地 | **代码 + 自动化回归已完成（2026-10-29 14:05）** —— 新增 4 个文件（`plugin-audio-wav` 纯 node 可测 / `plugin-audio` electron 侧 loopback 与落盘 / `plugin-audio-handlers` 四动作 + 分段广播 / 渲染端 `audio-recorder`），preload 挂 `window.api.audio`，四条通道进 MessagePack 白名单。`test:plugin-audio` **46 断言**（44 字节头逐字段、17 s 按 5 s 切段得 5/5/5/2、空录音不建文件、`segmentSeconds:0` 整段一文件）。`npm test` **94/94**。真机四条待验（麦克风 / 系统内录 / both 混音 / 电平），见 `S-243.md` §8.3 |
| 5 | S-244 | **代码 + 自动化回归已完成（2026-10-29 15:10）** —— ①`extension:remove` 顺序钉死：停用收进程 → 关窗口 → 清 session 分区 → C# 删目录/state/KV；清理失败只回 `cleanupWarnings` 不影响卸载结果；②新增 `plugin-cleanup-rules`（id/分区名纯判据，与 C# 正则一字不差）+ `plugin-cleanup`（clearStorageData + clearCache + 删分区目录），`plugin-window.ts` 改为共用同一判据不再自己拼字面量；③安装前确认弹窗（读 `extension.json` 摘要 + 目录表体积 + 按 id 记住勾选）；④「已下载运行文件」独立清理区（单向删除 + 全部清理）。`test:plugin-cleanup` **96 断言**（含 19 个必须拒绝的 id）。`npm test` **95/95**。**纠 §3.2 旧结论**：KV/secret 其实 C# 早就清了，本号真正缺的只有 session 分区。真机八条待验（见 S-244 §8.5） |
| 6 | S-247 | **代码 + 自动化回归已完成（2026-10-29 16:05）** —— `memory-shape`（纯函数：类型映射 / KB→字节 / 合计 / 阈值 / 告警去重）+ `memory-monitor`（`app.getAppMetrics()` + 早就存在但没人调的 `worker/memory`，5 s 采样、5 分钟落日志、超阈值 Warn 同 pid 10 分钟去重）+ `diagnostics:memory` 单动作 IPC + 设置页「关于 → 资源与诊断」页签。`test:memory-monitor` **36 断言**（钉单位 / 类型映射 / 阈值边界三类「不抛异常只会说谎」的坑）。`npm test` **96/96**。**一处偏差须老大确认**：plan §7 原拍「状态面板常驻数字」，实际做成设置页页签 —— 场景是事后复盘与用户报障，不是实时盯；采样与日志不依赖面板是否打开。`RuntimeStatusPanel` 占位原样未动。真机四条待验（见 `S-247.md` §9.5） |
| 7 | S-260 | **代码 + 自动化回归已完成（2026-10-29 17:20）** —— ①`lib/browser/browser-keepalive.ts`（纯判据，141 行）：上限 2、目标已在池中即幂等、可见作用域与 leased 绝不淘汰、空闲 5 分钟回收、一个都不许动时给结构化说明；②store 加 `browserKeepAliveBySession` / `browserLeasesBySession` + 四个动作，淘汰/释放接在 `openBrowserTab` 与 `closeRightPanelTab`；③`RightPanel` 挂载名单从「全部 browser tab」改为「池成员」，名额没拿到时渲染占位卡（不静默空白）；④工具侧 lease 在 `handleNativeBrowserToolRequest` 里 `try/finally` 包住整个调用，`goto` 走 `keepAliveExplicit: false` 不抢别人名额。`test:browser-keepalive` **36 断言**。`npm test` **97/97**。真机四条待验（见 `S-260.md` §9.3） |
| 8 | S-248 | 代码 + 自动化回归已完成（2026-10-29 18:45） |
| 9 | S-256 | 代码 + 自动化回归已完成（2026-10-29 19:30） |
| 10 | S-270 | 代码 + 自动化回归已完成（2026-10-29 14:20） —— 补 61 条中文标签（zh/en 对齐）+ 新增统一出口 `lib/tools/tool-display-name.ts` + 五个渲染点接入（`ToolCallCard` / `execution-outline` / `FileChangeCard` / `ProcessTextLine` / `BrowserToolCard` / `DesktopActionToolCard` / `CodeGraphToolCard`，顺手删掉 `fallbackTitle` 这个「末行 return name」的旧兜底）+ 新增 `test:tool-labels-coverage`（9 条断言，扫到 47 个工具名常量反查表）。`npm test` 99/99、`npm run typecheck` 0 错。**刀 10 补正（14:45，dev 第 7 轮）**：原闸只扫 TS 侧，漏了 **C# 侧 61 个第一方工具**（`CronList` / `SubAgentStatus` / goal / 全局任务 / 飞书 / 微信 / `Terminal` / `Monitor` 全在 C# 里声明）—— 中文表补到 **124 条**，测试加 C# 侧扫描（`Tools/` 目录 97 个，少于 90 判判据失效），并做了删条变红的反向验证。**刀 10 补正之二（16:53，老大报「输入框左上角状态栏使用工具时显示英文名」）**：状态栏两处（`composer-status-indicator` / `runtime-status`）一直只调 `resolveProxyStatusName()` —— 那函数只拆 `use_capability`、非代理工具原样返回 ⇒ 卡片全中文化了，状态栏还在念 `BrowserNavigate`。新增 `resolveStatusToolName()`（先拆代理 → 再过统一出口，顺序不能反；`skill:<id>` 原样保留），selector 改取原始 name + input、中文名在 `useMemo` 里算。测试 11 → **12 条**，闸做反向验证（实现退回 `return resolved` ⇒ `actual: Read / expected: 读取文件` 变红）。 |
| 11 | S-271 | **代码 + 自动化回归已完成（2026-10-29 16:10）** —— ①`getToolCategory` 去掉 `hasError` 入参与分支，只留 `pending_approval` / `requiresApproval` 判 `attention`（S-225 §8 的口径随之改为「失败不脱离折叠，用 run 级徽章保可见」）；②`ToolExecutionRun` 新增 `failedCount`，只数可见项（hidden 的失败用户本来也看不见）；③`GenerationProcessLine` 收 `failedCount` / `failedLabel`，折叠头出红色 `XCircle` + 「M 个失败」徽章，无失败不渲染；④`locales/{zh,en}/chat.json` 各加一条 `assistantMessage.toolRunFailed`。新增 `tests/tool-run-folding`（**12 条断言**，含「三档 render form 下 run 结构一致」与「普通成功的 run 也不 pin」两条回归），`npm run test:tool-run-folding` 12/12、`npm test` **100/100**、`typecheck:web` 0 错。**闸做过反向验证**：把 `hasError` 判据临时注回 attention 分支 ⇒ 断言 3 变红（`actual ['t3'] / expected []`），撤销后恢复 12/12。真机待验（见 `S-271.md` §六） |
| 12 | S-272 第一段 | **代码已完成（2026-10-29 16:20）** —— ①`desktop-control.ts`：`DesktopScreenshotResult` 加 `scaleFactor` + `displays[]`（每屏物理矩形），新增 `toPhysicalRect()`（优先 `screen.dipToScreenRect`，能力检测不到按 `bounds × scaleFactor` 回退）/ `getDesktopPhysicalBounds()` / `describeDesktopBounds()`，`isPointInsideDesktop()` 改按物理像素边界判、两处越界报错带边界数值；②`window-capture-handler.ts`：`WindowCaptureResult` 加 `bounds`（`getContentBounds()`，DIP）+ `scaleFactor`（`getDisplayMatching()` 取窗口所在屏）；③`AgentRuntimeDesktopExecutor.Encoding.cs`：新增 `DescribeScreenshot()` / `DescribeDisplays()` / `DescribeAppWindowCapture()` / `FormatScale()`，截图文本补 origin/scale/每屏矩形、窗口文本补 DIP 与「× scale 后的屏幕像素」，末尾给模型直接指令「坐标就是这张图里的像素，不要重新缩放」；④`DesktopToolProvider.cs` 四段描述改口径。`npm run typecheck` 0 错 · `npm test` 100/100 · `dotnet build` 0 警告 0 错误 · 四个源文件 CRLF/bareLF=0/无 BOM。真机待验：150% 屏点右下角不报 outside、聊天窗能看到 origin/scale |
| 13 | S-274 | **代码 + 自动化回归已完成（2026-10-29 17:50）** —— ①`scroll-watermark.ts` 新增纯函数 `clampScrollTop`（夹取 + 幂等 + 内容不满一屏返 0）②`useMessageListScroll.ts` 四处 scrollTop 写入点全部先夹（悬空救援 `:293` / 回收计划 `:320` / 跟随落位 `:352` / 撤水位线 `:866`），**并把手 `:361` 那道「已钉底」守卫改为对夹取后的值比较** —— 只夹写入不夹判据仍然无效。`tests/scroll-watermark` 103 → 110 条；反向验证：`clampScrollTop` 退回不夹 ⇒ `AssertionError: 超范围目标夹到 maxScrollTop（实际 640）`，撤销后 110/110 复绿。`npm test` 100/100 / `typecheck` 0 错。**真机待验 6 条**（S-274.md §七）|
| 14 | S-274 续 | **代码 + 实测已完成（2026-10-30 08:41，commit `e174bd6d`）** —— `+39/−1`，单文件 `useMessageListScroll.ts`。**根因**：流式中尾部行每帧都在长 ⇒ `measureVisibleMessageHeights()` **每帧**返回 `changed = true` ⇒ `assistantRailMeasureVersion` 每帧 +1 ⇒ 它进了 `useMessageListData` 的依赖 ⇒ `buildAssistantRailLayout` 与整条消息列表**每帧重算 + 重渲染**；而跟随 / 回收 / 救援三处写 `scrollTop` 都派发 scroll 事件 → `handleListScroll` → `requestAssistantRailSync` → 再测 → 版本再 +1，**不需要任何新内容就能自持**。真机表现：执行中 3 分钟 0.3 GB → 1.3 GB，发送键与会话列表的转圈控件持续上下跳动。**极简档治不了它** —— 极简减的是每条消息的 DOM 量，条数与重渲染**频率**都不变（这一条纠正了「极简＝性能方案」的错误口径）。修法三处：①`ASSISTANT_RAIL_MEASURE_THROTTLE_MS = 150` 节流 + 尾调用补最后一次（衬线不丢）；②程序化滚动窗口内（`programmaticScrollUntilRef`）直接跳过 rail 同步；③尾调用定时器随组件卸载清理。**实测 3.85 GB → 1.3 GB，保留。** 余下 1.3 GB 归属 dev 加载方式（见 §2.6），与本刀无关 |
| 17 | S-276 | **代码 + 自动化回归已完成（2026-10-30 12:00）** —— ①渲染层新增 `isRealUserTurn`（`context-compression-display.ts`，纯函数）与 `lib/agent/turn-window.ts` 的 `trimMessagesToRecentTurns`（从 store 搬出，原实现只看 `role`）；`session-slice.ts` 改为引用，删掉本地实现；②worker `DbMessageToolsQueries.cs` 抽 `RealUserTurnPredicate` 常量，四处 SQL 全部改走它：`totalTurns`、窗口起点两个分支、`hasMore`；③`isLegacyCompactSummaryMessage` 收窄成 `matchesLegacySummaryPrefix(role, content)` 供两处复用。**新增两套测试**：`tests/real-user-turn`（10 断言，含「尾部 5 张卡不能把真实消息挤出 turns=5」主症与「卡不被顺手过滤」对照）+ `tests/WishfulClaw.RealUserTurnRegressionTests`（21 断言，真 sqlite 跑 `ListByTurns`，覆盖分母 / 窗口 / 分页 `hasMore` / 全卡会话四组）。**反向验证**：谓词临时退回 `role = 'user'` ⇒ `assertion failed: totalTurns 只数真实用户消息 (expected 6, actual 14)`，撤销后 21/21 复绿。`npm test` **104/104**、`typecheck` 两配置 0 错、`dotnet build` 0 警告 0 错误。真机 3 条待验（见 `S-276.md` §十）|
| 15 | S-283 | **代码 + 自动化回归已完成（2026-10-30 12:05）** —— 新增 `lib/screenshot-dir.ts`（`formatScreenshotMonth` / `screenshotFileNameFromBuffer` / `resolveScreenshotDir`，纯函数零 electron 依赖）+ `image-persist.ts` 加可选 `fileName`；`desktop-control.ts` 的 `captureDesktopScreenshot` 与 `window-capture-handler.ts` 的 `targetPath` 为空分支都改成**默认落盘**；C# `DescribeScreenshot` 补 `Saved to {path}`、`DescribeAppWindowCapture` 去掉「没给 path 就不写盘」的旧口径。新增 `tests/screenshot-dir` **16 断言**。`npm test` **101/101**、`typecheck` 双配置 0 错、C# 0 警告 0 错误。真机 4 条待验 |

**收尾期补修（不占刀、不进 26 条主线的编号里）**：`9d4c2152`「极简档的桌面操作只留文字行 —— 截图不再出卡（S-248 例外收窄）」、`d88d6a31`「渲染详细度弹层只列档位名，描述挂 title（S-225 收紧）」。两条都是 10-29 真机测试中当场发现的口径收窄，各自只动渲染层一处、无新增判据，故不设刀号；changelog 前者有记（`15:46`）、后者本次补齐。

**不占刀序**：S-233（挂账，重开前先补 §三 那两处判据盲区；**S-274 修好后它仍未解决** —— 两者根因不同）、S-230（阻塞在契约，契约不到不写请求代码）、Goal `KeyNotFoundException`（当前 HEAD 89/89 不复现，**已拍本迭代不做**）。

**验收总纲（插件线）**：用一个假插件（一个按钮 + 一次资产下载 + 一段录音）跑通 S-240 ~ S-244 五条，再交给插件项目。基座不依赖语音，可独立验。
