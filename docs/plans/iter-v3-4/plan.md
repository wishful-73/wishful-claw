# v3-iter-4（产品 1.0.4）—— 承接清单与刀序

> 分支：`dev/v3-iter-4`（base = `58136a9f`，= v1.0.3 收尾合并点，即最新 `main`；tag `v1.0.3` → `58136a9f`）。执行期内只 commit，**不 push**。
> 产品版本：`1.0.4`（开工时 `package.json` 是 `1.0.3`，收尾时改），tag `v1.0.4`。
> 状态：**阶段一勘察已完成（2026-10-28 17:57）**，10 条待决问题**全部拍定**（见 `exploration_findings.md` §七），§七 刀序已确认。
> 进度：**第 0 刀（S-243 探路）已闭环；第 1 刀（S-240）代码 + 自动化回归已完成**，真机三项待验。
> 追加（2026-10-28 20:40）：**登记 S-261**（图像块 400 自愈缺失，S-246 下半段），承接条数 **9 → 10**，插入为刀 **1b**。
> 追加（2026-10-29 08:24）：**登记 S-262**（400 请求级拒绝的自愈与告知，通用兜底），承接条数 **10 → 11**，插入为刀 **1c**。
> 追加（2026-10-29 09:07）：**登记 S-263**（侧栏收起即崩，hooks 排在 early return 之后，S-240 回归），承接条数 **11 → 12**，插入为刀 **1d**。
> 追加（2026-10-29 09:32）：**登记 S-264**（脏图源头治理 —— 宁可标读图失败，也不把脏图送上上游），承接条数 **12 → 13**，插入为刀 **1e**，**发布前必须做完**（它同时消掉「一张脏图把模型永久标瞎」这个不可逆副作用）；同批**登记 S-265**（裸 body 400 归因不明）**移交下迭代**，不占承接、不占刀序，见 §2.5。
> 追加（2026-10-29 10:40）：**dev 第 6 轮审查补正，插入刀 1g**。S-264 / S-266 判决「真机生效」，但有 3 件事必须回去补（① Responses 用户消息路径漏 url 闸；② 容器完整性只活在 Read 工具里；③ S-262 一次性消费没动），另加 1 个产品级缺陷。**登记 S-267**（截图成功但页面是白的）随本刀交付，承接条数 **14 → 15**；**登记 S-268**（`DesktopScreenshot` 的 `path` 无效）**移交下迭代**，不占承接、不占刀序，见 §2.5。

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
| S-247 | 内存占用异常偏高，但当时并无实际负载 | **待开工**（第一阶段交付「让内存可见」，不是优化本身） | [S-247](../iter-v3-3/requirements/S-247.md) |
| S-248 | 纯文本档换形态 —— 过程层降级为行式文本 | **待开工**（S-225 返工补丁；补「渲染形态」这根轴。三条硬约束：白名单不降级 / 切换档位完整可逆 / 报错只上红字） | [S-248](../iter-v3-3/requirements/S-248.md) |
| S-256 | 模型输出超长文本时整页像截图一样静止 | **待开工**（2026-10-28 14:55 老大定从 v3-iter-3 移来）。症状与 iter-v2-36 **S-149** 逐字重合，当年就写明「要真消除得上流式期间限制单帧渲染的文本量，未做、等口径」。三条口子：①`getCatchupStep = ceil(pool/K)` **无步长上限**，积压 10 万字符即单帧喂 5 万进解析器，且 `tests/streaming-render-pool/program.ts:66-68` 把「一百万字符也按比例排干、不设上限」**钉成断言**；②`useStreamingMarkdownBlocks` 只在「空行 + 下一行顶格」切块，无空行长段 / 未闭合 fence ⇒ tail = 全文累积，每帧全量重解析；③跑完那一下正文与思考各一次全量 markdown。全仓零 `content-visibility`。**开工前要先拍**：建议 A 步长上限 + B tail 强制分段，**A 必然要改那条既有断言的口径** | [S-256](../iter-v3-3/requirements/S-256.md) |
| S-260 | 内置浏览器保活池 —— 上限 2 个会话，满了要明确告诉 agent | **待开工**（2026-10-28 16:22 老大定「有两个活着就行了，要是能提示 agent 已经有两个是最好的」⇒ 顺延本迭代，随 S-247 内存治理同批。不是「限制功能」，是**给常驻资源划上限 + 让 agent 知道边界在哪**） | [S-260](../iter-v3-3/requirements/S-260.md) |

> ⚠️ S-260 在 v3-iter-3 收尾的承接清单里**漏列过**（只写了 8 条），17:24 拆分支时补回。
> **清单口径以本表为准：15 条承接**（9 条 + 20:40 登记的 S-261 + 29 日 08:24 登记的 S-262 + 29 日 09:07 登记的 S-263 + 29 日 09:32 登记的 S-264 + 29 日 09:50 登记的 S-266 + 29 日 10:40 登记的 S-267，见 §2.4）。

### 2.4 本迭代新登记（6 条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-261 | 图像块 400 之后自愈缺失 —— 单张脏图卡死整个会话 | **已交付（刀 1b + 刀 1g 收口）**，dev 第 6 轮判决「真机生效」。**刀 1b**（2026-10-28 20:55，commit `fd386222`）修 marker 表与 url 绕过；**刀 1g**（2026-10-29 10:40）补完最后一块 —— `OpenAIResponsesInputWriter` 的用户消息路径还在用「url 非空」的旧闸（`HasImageContent` 与 `WriteResponsesMultimodalMessage` 各写一份），`file:///`、`oc-media://` 在那条路上裸透传。判据收进 `ProviderContentHelpers.IsSendableImageBlock` 单块版本，三条协议共用一个，再不会有调用点漏掉。**S-246 的下半段，不是重复需求**：S-246 只交付了输入端闸门，「脏块已进历史」的自愈路径在它 §7 被标「退化为兜底」而没做。两处根因：**A** marker 表缺上游原文 `unsupported image`（词形与表里 `does not support image` 不同）⇒ 自愈进不去；**B** `source.type==='url'` 的 image 块**绕过** S-246 白名单闸 ⇒ 400 源头没掐干净。红色约束：**S-236 判据 10 的两道闸（`AgentLoop.cs:464`）不许动** | [S-261](requirements/S-261.md) |
| S-262 | 400 请求级拒绝 —— 把失败变成 agent 的观察，而不是会话的死刑 | **已交付（刀 1c + 刀 1g 补正）**，dev 第 6 轮点名「一次性消费一字未动」。**刀 1g**（2026-10-29 10:40）把注入从「只活一轮」改成**按 `ToolUseId` 记死、撑满整个 run**：触发 400 的工具结果在报错前已写回 durable conversation，而 wire 副本每轮重建 —— 只换一轮，下一轮原文回来、同一 400 再来、指纹去重命中直接抛，会话照样废。新增 `ProviderRejectionToolUseIds` 集合 + `ProviderRejectionRegistrationPending` 登记开关，`ReplaceTrailingToolResults` 换成 `ReplaceMarkedToolResults`（按 id 认人，位置变了照样换）。**通用兜底，不是 S-261 的重复**：S-261 只管 image 块，本条管「认不出原因的 400」。做法沿用既有骨架 —— catch 链尾加第四个分支，把**本轮最后一条工具结果**替换成拒绝说明（`ToolUseId` 原样保留）后重发，同时 emit 事件告知模型与用户。**三道安全阀**：上限 2 / 报文指纹去重 / 必须有可替换对象。**口径变更**：S-236 判据 10 的「无关 400 不被截走」改为「不许静默吞掉」，`AgentLoop.cs:464` 两行不动 | [S-262](requirements/S-262.md) |
| S-263 | 侧栏一收起就白屏 —— hooks 被追加在 early return 之后 | **代码已修复（2026-10-29 09:07 登记，刀 1d）**，真机待验。**S-240 的回归缺陷，不是新需求**：`WorkspaceSidebar.tsx` 的 `if (!leftSidebarOpen) return null` 排在 S-240 新增的 `useExtensionStore` / `manifestViewItems` 两个 hook **之前** ⇒ 侧栏收起时少跑两个 hook ⇒ React 抛 `Rendered fewer hooks than expected`、整棵侧栏被 ErrorBoundary 兜走。修法：early return 后移到全部 hook 之后 + 原位留警告注释；顺带补 500 行豁免头（511 → 521 行）。**本条暴露的缺口**：项目没有 eslint（`rules-of-hooks` 用不上）、渲染端无组件测试，这类缺陷只能靠运行时撞见 —— 是否补工具链单独评估 | [S-263](requirements/S-263.md) |
| S-264 | 脏图源头治理 —— 宁可标读图失败，也不把脏图送上上游 | **已交付（刀 1e + 刀 1g 收口）**，dev 第 6 轮**真机判决「生效」**：造 7 张坏图全拦住，仓里 40 张真图全量跑判据**零误杀**，8 轮截图读图 + 113k tokens 上下文 + 历史 8 张图，日志 `400 / unsupported image / image block dropped` 零命中。老大原话「读图工具如果读到没有图，可以直接标读图失败么？而不是把脏图丢上去」。**S-236 / S-246 / S-261 的收口**：前三者都在修「撞了 400 之后怎么收场」，本条改「根本不让脏图出门」。勘察坐实**魔数判据全写好了、结论被三处丢掉**，真正漏水口是 `ProviderContentHelpers.ResolveSupportedImageMediaType:201-208` —— 嗅探认不出时**回落信任声明的格式**，而「脏图」的定义恰恰就是嗅探认不出。**三层一起改**（工具层签名校验 / 组包层去回落 / 脏图不写 `ImageVisionMemory`），缺一层就漏：真实日志 18 条图像 400 里 **10 条在微信渠道会话**，不经过 `FileReadTool`。**判据拆四档**，只有「认不出」才标失败，扩展名骗人要按真实格式纠正 | [S-264](requirements/S-264.md) |
| S-266 | 没写完的图 —— 签名合法但容器不完整，照样内联出门 | **已交付（刀 1f + 刀 1g 收口）**，dev 第 6 轮**真机判决「生效」**：7 张坏图全拦、40 张真图零误杀。**刀 1g 把覆盖边界补完** —— 判据原先是 `path` 形态，只有 `Read` 工具能用；而现场 18 条图像 400 里 **13 条在微信渠道**，那条路的图从来不是 agent 读出来的，是渲染层注入的历史块，组包时才第一次见到字节。拆成 `JudgeContainer(head, tail, totalLength, mediaType)` 共用判据 + `HasCompleteContainerInBase64` 入口（只解头部 16 字符与尾部一个窗口，不解全量），接进 `ProviderContentHelpers.IsSendableImageBlock` 的 base64 分支。**S-264 的第五档，不是重复需求**：S-264 修「认不出是什么格式」，本条修「认得出、但文件没写完」—— 签名在文件开头，截断在文件末尾，前者的判据天生够不着后者。现场（下载一半的截图 / 中断的保存 / 拷一半的 U 盘文件）头 8 字节完全合法 ⇒ 过完四档一路内联 ⇒ 400 `invalid image` ⇒ 坏块留历史每轮重发，与 S-246 同一现场、换了触发条件。**不做解码**（PNG 要 inflate、JPEG 要熵解码，AOT 体积与攻击面不划算），改看**容器尾部结束标记**：PNG 的 IEND 定值 / JPEG 的 EOI / GIF 的 trailer / WebP 的 RIFF 声明长度，只读头 + 尾 64 字节，常数级 I/O。判据刻意宽松（漏检代价是一次 400 有 S-262 兜底，误杀代价是模型彻底看不到好图） | [S-266](requirements/S-266.md) |
| S-267 | 截图成功但页面是白的 —— 工具报告成功，实际什么都没画 | **已交付（刀 1g，2026-10-29 10:40）**，真机待验。用 `file://` 打开未构建的 Vite 外壳时，`.tsx` 不转译 ⇒ 页面全白，但 `BrowserNavigate` 报 `success: true`、`BrowserGetContent` 拿回正确标题、`BrowserScreenshot` 返回干净的纯白 PNG，日志里的 `ERR_ABORTED` 只落在 subresource 上、`did-fail-load` 不触发 ⇒ **agent 拿到白图以为看到了，照着白图去改壳子，全程零报错**。判据两个条件同时成立才警告（视口抽样近全白 **且** DOM 几乎没元素、无可见文本），宁可漏报不许误报；**不改 `isError`** —— 截图确实成功了，模型需要的是一条「你看到的是空的」，不是一次假失败 | [S-267](requirements/S-267.md) |

### 2.5 移交下迭代（2 条，不占承接、不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-265 | 裸 body 400 —— 上游只回 `{"model":"xxx"}`，30~52 秒慢拒绝，归因不明 | **待查，下一迭代**（2026-10-29 09:32 登记）。家里电脑真实日志里 14 条，全在会话 `Uy5QPV02…`、全打同一渠道。**与 S-264 / S-261 不是同一个 bug**，别合并。S-262 已能保证它不钉死会话（替换工具结果重发一次 + 指纹去重后抛），代价是每次多烧一次 30~52 秒请求 —— 可接受，不是缺陷 | [S-265](requirements/S-265.md) |
| S-268 | `DesktopScreenshot` 的 `path` 参数完全无效 | **待开工，下一迭代**（2026-10-29 10:40 登记）。与 S-267 同一类：**工具报告成功，实际没做成**。`ExecuteScreenshotAsync` 的请求体是 `CreateJsonObject(_ => { })` 空对象，除了 `delayMs` 一个字段都没读，`path` 从未被解析；而 `CaptureAppWindow` 认真解析并落盘。两个工具调用姿势长得一样、行为差一半 ⇒ 模型照搬 `CaptureAppWindow` 的习惯传 `path`、以为存了、下一轮去 Read 一个不存在的文件。**比直接报错更糟：报错模型会换招，假成功让它继续往下走。** 建议补 `path` 支持（照抄既有实现），不是只在描述里写「不支持」 | [S-268](requirements/S-268.md) |

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
| 4 | S-243 **落地** | 照第 0 刀结论写；**不引入原生 WASAPI**，不通则麦克风先交付、系统音挂账 |
| 5 | S-244 | 依赖 S-240，验证依赖 S-241；收口整条基座，用假插件跑通五条 |
| 6 | S-247 | 内存治理第一步「看得见」；**消费形态已拍**：状态面板常驻数字 + 超阈值写日志，轮询 5 s |
| 7 | S-260 | 随 S-247 同批；**已拍**：全局上限 2、满了拒绝新开并结构化告知 agent、**不做 LRU** |
| 8 | S-248 | 纯渲染形态改造，与后端无关，独立一刀。**已拍**：`text` 档完全不渲染工具卡片、折叠保留、错误行红色 |
| 9 | S-256 | 放最后是因为它牵动流式渲染主链路。**已拍**：允许改 `tests/streaming-render-pool/program.ts:57,68` 的「不设步长上限」契约，**且必须同刀修根因 B**（tail 永不 settle） |

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
| 3 | S-242 | 待开工 |
| 4 | S-243 落地 | 待开工 |
| 5 | S-244 | 待开工 |
| 6 | S-247 | 待开工 |
| 7 | S-260 | 待开工 |
| 8 | S-248 | 待开工 |
| 9 | S-256 | 待开工 |

**不占刀序**：S-233（挂账，重开前先补 §三 那两处判据盲区）、S-230（阻塞在契约，契约不到不写请求代码）、Goal `KeyNotFoundException`（当前 HEAD 89/89 不复现，**已拍本迭代不做**）。

**验收总纲（插件线）**：用一个假插件（一个按钮 + 一次资产下载 + 一段录音）跑通 S-240 ~ S-244 五条，再交给插件项目。基座不依赖语音，可独立验。
