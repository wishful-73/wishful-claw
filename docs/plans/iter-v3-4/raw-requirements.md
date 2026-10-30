# v3-iter-4 需求清单

> **迭代状态：已建立**（2026-10-28 17:24 拆分支）。
> 分支 `dev/v3-iter-4`（base = `58136a9f`，从最新 `main` 拆，**未从旧迭代分支拆**）、产品版本 `1.0.4`、tag `v1.0.4`。
> [plan.md](plan.md) 有承接索引与刀序；**阶段一勘察已完成（2026-10-28 17:57）**，刀序已确认。
> 追加（2026-10-28 20:40）：**登记 S-261**，承接条数 **9 → 10**（见 §1.2），插入为刀 1b。
> 追加（2026-10-29 08:24）：**登记 S-262**，承接条数 **10 → 11**（见 §1.2），插入为刀 1c。
> 追加（2026-10-29 09:07）：**登记 S-263**，承接条数 **11 → 12**（见 §1.2），插入为刀 1d。
> 追加（2026-10-29 09:32）：**登记 S-264**，承接条数 **12 → 13**（见 §1.2），插入为刀 1e，**发布前必须做完**；同批**登记 S-265**，**移交下迭代**（见 §1.3），不占承接。
> 追加（2026-10-29 09:50）：**登记 S-266**，承接条数 **13 → 14**（见 §1.2），插入为刀 1f。S-264 的第五档 —— 前者修「认不出是什么格式」，本条修「认得出、但文件没写完」。
> 追加（2026-10-29 10:40）：**登记 S-267**，承接条数 **14 → 15**（见 §1.2），随刀 1g 交付；同批**登记 S-268**，**移交下迭代**（见 §1.3），不占承接。
> 追加（2026-10-29 11:02）：**登记 S-269**（摘要请求 429 重试窗口错配），承接条数 **15 → 16**（见 §1.2），插入为刀 3b。根因已由生产实例日志坐实，**本迭代做**。
> 追加（2026-10-29 13:56）：**登记 S-270**（新工具在聊天窗显示英文名），承接条数 **16 → 17**（见 §1.2），插入为刀 10 —— 14:03 老大拍板「这些需要进本迭代」。
> 追加（2026-10-29 15:40）：**登记 S-271**（失败的工具调用会从折叠块里跳出来），承接条数 **17 → 18**（见 §1.2），插入为刀 11。
> 追加（2026-10-29 15:53）：**登记 S-272**（桌面坐标算不出来），承接条数 **18 → 19**（见 §1.2），**第一段随刀 12 交付，第二段移交 v3-iter-5**；同批**登记 S-273**（UI Automation 元素点击），**移交下迭代**（见 §1.3），不占承接。
> 追加（2026-10-29 18:15）：**登记 S-275 / S-276**（压缩对图片无效 / 最近 N 轮把压缩摘要当用户轮），承接条数 **19 → 21**（见 §1.2），分别为刀 16、刀 17。**此处补记 —— 当时漏写了顶部追加行。**
> 追加（2026-10-30 11:29）：**登记 S-283**（截图落盘返回路径），承接条数 **21 → 22**（见 §1.2），插入为刀 15，**是 S-275 的硬前置** —— 压缩占位文案里那句「可重新 Read 查看」要靠它才成立。
> 追加（2026-10-30 11:05）：**登记 S-281 / S-282**（主窗口根容器全窗 `backdrop-blur-xl` 纯烧管线 / `WISHFULCLAW_DATA_DIR` 指向新目录时首次启动静默退出），**全部移交 v3-iter-5**（见 §1.3），不占承接、不占刀序。
> 追加（2026-10-30 14:32）：**登记 S-284**（图片块补 `filePath`），承接条数 **22 → 23**（见 §1.2），插入为刀 18；同批**登记 S-285**（助手消息块拆 `message_parts` 表），**移交 v3-iter-5**（见 §1.3），不占承接。
> 追加（2026-10-30 15:10）：**登记 S-286 / S-288**（截图尺寸摘要取自 base64 / 聊天窗图片不能放大），**全部移交 v3-iter-5**（见 §1.3）。**S-287 空号** —— 同一次反馈里的「保存图片失败」经查是沙箱按设计拒绝，老大 15:20 定「不需要登记」，不立项、不回填编号。
> 追加（2026-10-30 19:30）：**登记 S-290**（截图经能力代理调用时 image 块被 32 KB 截断），**移交 v3-iter-5**（见 §1.3），不占承接、不占刀序。来源是验 S-283 / S-284 时看 dev 日志撞见 `tool=use_capability originalBytes=712499 truncatedBytes=32768` —— 落库出口（`ToolCallProcessor.cs:389`）与送模型出口（`:412`）不是同一份内容。**不是回归**：截断逻辑早于 S-283，是 S-283 方案 A「本轮 image 块照旧保留」的假设让它第一次显形。老大 19:30 定「当前迭代越弄越久，有种尾大不掉的感觉」，故不修、只登记。
> ⚠️ **本节条数与 plan.md 对齐后的口径**：S-274 原被误列入 §1.3 移交表，实际是**本迭代刀 13 交付**，已移回 §1.2。故 §一 共 **二十四条** = 插件基座 5 + 资源治理 4 + 本迭代新登记 15。

## 一、承接需求（二十四条）

来源：v3-iter-3（1.0.3）收尾时老大 2026-10-28 09:44 定「没有做的需求都移入下个迭代」。

### 1.0 主线：插件基座（S-240 ~ S-244，五条）

> 上位登记：`docs/roadmap-post-1.0.md` · `R-4`。**本仓只做基座；转写 / 说话人识别 / 会议界面属另一个项目。**

| 编号 | 标题 | 依赖 | 明细 |
|---|---|---|---|
| S-240 | 插件基座（1/5）· 清单扩展与导轨入口 | —— 地基 | [S-240](../iter-v3-3/requirements/S-240.md) |
| S-241 | 插件基座（2/5）· 视图独立窗口与生命周期 | S-240 | [S-241](../iter-v3-3/requirements/S-241.md) |
| S-242 | 插件基座（3/5）· 资产下载器 | S-240 | [S-242](../iter-v3-3/requirements/S-242.md) |
| S-243 | 插件基座（4/5）· 录音采集能力 | **无依赖，可并行** | [S-243](../iter-v3-3/requirements/S-243.md) |
| S-244 | 插件基座（5/5）· 安装确认与卸载清理 | S-240（验证依赖 S-241） | [S-244](../iter-v3-3/requirements/S-244.md) |

**验收总纲**：用**一个假插件**（一个按钮 + 一次资产下载 + 一段录音）跑通这五条，再交给插件项目。基座**不依赖语音**，可独立验。

**开工注意**：S-243 的 Windows loopback 是最大不确定项 ⇒ **先测再写**（刀序第 0 刀只探路不改码），不通就改 WASAPI loopback 原生模块。

### 1.1 资源治理与渲染形态（四条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-247 | 内存占用异常偏高，但当时并无实际负载 | 待开工。**无根因、无量化口径** —— 全仓零内存采样，`worker/memory` 端点存在但零调用。第一阶段交付「看得见」 | [S-247](../iter-v3-3/requirements/S-247.md) |
| S-248 | 纯文本档换形态 —— 过程层降级为行式文本 | 待开工。**S-225 的返工补丁**：S-225 的 8 个 policy 字段全是布尔，`text` 档只是「默认折叠、形态仍是卡片」；本条补「渲染形态」这根轴 | [S-248](../iter-v3-3/requirements/S-248.md) |
| S-256 | 模型输出超长文本时整页像截图一样静止 | 待开工。症状与 iter-v2-36 **S-149** 逐字重合，S-149 §7.4 当年写明「未做、等口径」。**开工前要先拍 A/B 口径** | [S-256](../iter-v3-3/requirements/S-256.md) |
| S-260 | 内置浏览器保活池 —— 上限 2 个会话，满了要明确告诉 agent | 待开工。随 S-247 内存治理同批 | [S-260](../iter-v3-3/requirements/S-260.md) |

### 1.2 本迭代新登记（十五条）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-261 | 图像块 400 之后自愈缺失 —— 单张脏图卡死整个会话 | 2026-10-28 20:40 登记。**S-246 下半段，不是重复需求**。S-246 只交付输入端闸门；「脏块已进历史」的自愈路径在它 §7 被标「退化为兜底」而没做。根因 A：marker 表缺上游原文 `unsupported image`；根因 B：`source.type==='url'` 的 image 块绕过 S-246 白名单闸。**红线：S-236 判据 10 的两道闸不许动** | [S-261](requirements/S-261.md) |
| S-262 | 400 请求级拒绝 —— 把失败变成 agent 的观察，而不是会话的死刑 | 2026-10-29 08:24 登记。**通用兜底，不是 S-261 的重复**：S-261 只管 image 块。收到 400 时把**本轮最后一条工具结果**替换成拒绝说明（`ToolUseId` 原样保留）再重发，同时 emit 事件告知模型与用户。三道安全阀：上限 2 / 报文指纹去重 / 必须有可替换对象。**口径变更**：S-236 判据 10 改为「不许静默吞掉无关 400」，`AgentLoop.cs:464` 两行不动 | [S-262](requirements/S-262.md) |
| S-263 | 侧栏一收起就白屏 —— hooks 被追加在 early return 之后 | 2026-10-29 09:07 登记，来源是 dev 日志实证（`09:01:33` `Rendered fewer hooks than expected`）。**S-240 的回归缺陷，不是新需求**：`WorkspaceSidebar.tsx` 的 `if (!leftSidebarOpen) return null` 排在 S-240 新增的两个 hook 之前 ⇒ 收起时少跑 hook ⇒ 整棵侧栏被 ErrorBoundary 兜走。修法：early return 后移到全部 hook 之后 + 原位警告注释 + 补 500 行豁免头 | [S-263](requirements/S-263.md) |
| S-264 | 脏图源头治理 —— 宁可标读图失败，也不把脏图送上上游 | 2026-10-29 09:32 登记。老大原话「读图工具如果读到没有图，可以直接标读图失败么？而不是把脏图丢上去」。**S-236 / S-246 / S-261 的收口**：前三者修「撞了 400 之后怎么收场」，本条改「别让脏图出门」。勘察坐实魔数判据全写好了、结论被三处丢掉，漏水口是 `ProviderContentHelpers.ResolveSupportedImageMediaType:201-208` 嗅探认不出时**回落信任声明**。**三层一起改**（工具层签名校验 / 组包层去回落 / 脏图不写 `ImageVisionMemory`），因为真实日志 18 条图像 400 里 10 条在微信渠道会话、不经过 `FileReadTool`。判据拆四档，只有「认不出」才标失败 | [S-264](requirements/S-264.md) |
| S-266 | 没写完的图 —— 签名合法但容器不完整，照样内联出门 | 2026-10-29 09:50 登记。**S-264 的第五档，不是重复需求**：S-264 修「认不出是什么格式」，本条修「认得出、但文件没写完」—— 签名在文件开头、截断在文件末尾，前者的判据天生够不着后者。**不做解码**（四套解码器对 AOT 体积与攻击面不划算），改看容器尾部结束标记（PNG IEND / JPEG EOI / GIF trailer / WebP RIFF 长度），只读头 + 尾 64 字节。判据刻意宽松：漏检代价是一次 400（S-262 兜底），误杀代价是模型彻底看不到好图 | [S-266](requirements/S-266.md) |
| S-267 | 截图成功但页面是白的 —— 工具报告成功，实际什么都没画 | 2026-10-29 10:40 登记，来源 dev 第 6 轮审查。`file://` 打开未构建的 Vite 外壳时 `.tsx` 不转译 ⇒ 页面全白，但 `BrowserNavigate` 报成功、`BrowserGetContent` 拿回正确标题、`BrowserScreenshot` 返回干净纯白 PNG，`did-fail-load` 不触发 ⇒ **agent 照白图去改壳子，全程零报错**。与 S-264 / S-266 同病根（坏数据包装成好东西发出去），只是数据是我们自己造的。判据两个条件同时成立才警告（视口抽样近全白 **且** DOM 几乎没元素、无可见文本），**不改 `isError`** | [S-267](requirements/S-267.md) |
| S-269 | 摘要请求被 429 拒绝，6 秒内重试三次全撞墙 —— 降级成「摘要器不可用」 | 2026-10-29 11:02 登记，**已交付（刀 3b，11:20）**，真机待验。生产实例日志坐实：五波失败全是 `ttft_admission_refused ... retry shortly (after 3~39 s)`，而上游要求等 3~39 秒时我们只在 1.5s / 3s 后重试，三次全落在同一拒绝窗口里。**摘要请求是整条 provider 链里唯一绕开 `ProviderRetryPolicy` 的地方**（自建静态 `HttpClient` + 自建退避 + 丢掉 `Retry-After` 头），而 `ProviderHttpException` / `IsRetryableStatus` 早就写好。修法五条：改抛 `ProviderHttpException` / 复用 `ComputeDelayMs`（加 `maxBackoffMs` 参数，别让 29 秒被压成 15 秒）/ 429 不砍输入预算 / 降级文案分档 / 原因透传。**不含水印改动**（§三 更正：truncate 路径也 Reset 水印，三波重触发是会话自然长回阈值） | [S-269](requirements/S-269.md) |
| S-270 | 新工具在聊天窗显示英文名 —— 中文标签表停在 OpenCowork 迁移期 | 2026-10-29 13:56 登记，**已交付（刀 10，14:20）**。`permission.toolLabels` 只有 23 条、全是迁移期那批；渲染点 `t(key, { defaultValue: name })` 缺 key 静默回退英文原名，机制上没有防漏；`FileChangeCard` 与 `ProcessTextLine` 干脆不查表。三件套：补到 **124 条**（zh/en 对齐，含 C# 侧 61 个第一方工具）+ 统一出口 `resolveToolDisplayName`（别名归一 / MCP / codegraph 前缀族 / 兜底「工具 · 原名」）+ `test:tool-labels-coverage`。**刀 10 补正之二（16:53）**：输入框状态栏两处只调了 `resolveProxyStatusName()`（只拆 `use_capability`、非代理工具原样返回）⇒ 平时跑工具露英文名，补 `resolveStatusToolName()` 接上统一出口。见 [requirements/S-270.md](requirements/S-270.md) |
| S-271 | 失败的工具调用会从折叠块里跳出来 —— 三处判据不同步 | 2026-10-29 15:00 登记、15:40 老大拍板进本迭代，**已交付（刀 11，16:10）**。实为 S-225 §8「档位不得藏错误」的刻意口径 + 三条判据不同步叠加，**不是偶然**。方案 A：`hasError` 不再单独决定 `force`，`ToolExecutionRun` 加 `failedCount`，折叠头出红色「M 个失败」徽章。见 [requirements/S-271.md](requirements/S-271.md) |
| S-272 | 桌面坐标算不出来 —— 截图不给参照系，模型只能对着图瞎猜 | 2026-10-29 15:53 登记，**第一段随刀 12 交付**（元数据补全 + DPI 判定修复），**第二段移交 v3-iter-5**（相对坐标 / 网格 / 窗口枚举）。老大原话「它不知道怎么去点击坐标」。四层原因：截图不含窗口矩形；`originX/originY` 主进程算了但 C# 编码丢掉；工具描述不说是哪个坐标系；`isPointInsideDesktop` 拿 DIP 边界校验物理像素坐标 ⇒ 高 DPI 屏右半边点不动。见 [requirements/S-272.md](requirements/S-272.md) |
| S-275 | 压缩对图片工具结果无效 —— 24 万字符 base64 钉在保留尾部，压完 3 分钟又超 | 2026-10-29 18:10 登记，**已交付（刀 16，2026-10-30 12:40）**，真机 4 条待验（见 `S-275.md` §十）。会话 `9yXnLPAM…` 50 分钟连压 9 次，`DIAG` 行 16 条非 skip、峰值 `inputTokens=503539`。根因：`ContextCompression.cs:557-583` `TailStart` 的 `minKeep = 2` 让尾部两条**不参与** 16384 token 预算判断，而一次 Read 截图正好产生 `tool_use` + `tool_result` 两条 ⇒ 243496 字符的 base64 原样钉在 wire 尾部。建议方案 A：压缩前把超预算的 `image` block 占位化成 `[图片已省略：xxx.png 1680×1120，可重新 Read]`。见 [S-275](requirements/S-275.md) |
| S-276 | 聊天窗「最近 N 轮」把压缩摘要当成用户轮 —— 打开会话满屏「任务暂告一段落」 | **已交付（2026-10-30 12:00，刀 17）**，2026-10-29 18:05 登记。库里 141 条消息全在（真实用户 51 / 摘要 20 / 助手 50 / 边界 20），但四处判据都用 `role = 'user'` 数轮次：`session-slice.ts:77-90`、`DbMessageToolsQueries.cs` 的 `totalTurns` / 窗口起点两分支 / `hasMore`。实测首次加载 `turns=5` ⇒ 拉回 10 条**全是压缩卡、真实用户 0 条**。修法：渲染层 `isRealUserTurn` + worker `RealUserTurnPredicate` 同口径（`role=user` 且无 `meta.compactSummary`），压缩卡照常返回但不占名额。见 [S-276](requirements/S-276.md) |
| S-283 | 桌面截图 / 窗口截图落盘返回路径 —— 图不再只活在内存里 | 2026-10-30 11:29 登记，11:36 老大拍板进本迭代，**已交付（刀 15，commit `3b6e02a9`）**，真机 4 条待验。方案 A：**落盘 + 路径写进文字行 + image block 照旧保留** —— 本轮**不省上下文**，省靠 S-275；本条只是把「以后能省」的前提铺好 | [S-283](requirements/S-283.md) |
| S-274 | 长文本流式时渲染进程涨到 4.3 GB 并崩溃 —— scrollTop 被 clamp 绕过「已钉底」守卫 | 2026-10-29 17:50 登记，**已交付（刀 13 + 刀 14 续，commit `e174bd6d`）**。来源 dev 实例日志 `~/.wishful-claw-dev/logs/2026-10-29.log`（生产实例日志与之分家）：17:20:45 `memory type=Tab ws=4360MB peak=4833MB`，17:20~17:34 连报 6 次 `Maximum update depth exceeded`。根因两层：①跟随目标 `realBottom + gapTarget - clientHeight` 的 gapTarget 是提前量（最多 240px），大于容器底部 padding ⇒ 尾部行未挂载那帧 `scrollHeight` 撑不住 ⇒ 浏览器 clamp 写入值（写 1000 读回 760）⇒ `Math.abs(scrollTop - bottom) <= 1` 守卫永远不成立 ⇒ 自激；②刀 14 查出**真正的放大器** —— 流式中尾部行每帧都在长 ⇒ `measureVisibleMessageHeights()` 每帧返回 `changed` ⇒ `assistantRailMeasureVersion` 每帧 +1 ⇒ 进了 `useMessageListData` 依赖 ⇒ **整条消息列表每帧重算 + 重渲染**。修法：`clampScrollTop` 四处写入点先夹 + 守卫改对夹取后的值比较；rail 重测加 150 ms 节流、程序化滚动窗口内跳过、定时器随卸载清理。**实测 3.85 GB → 1.3 GB**（余下归 dev 加载方式，见 plan.md §2.6）。闸 103 → 110 条 | [S-274](requirements/S-274.md) |
| S-284 | 图片块补 `filePath`，让「已落盘的那份」真正被剥掉 | 2026-10-30 14:32 登记（老大「剥 base64 先做」），**已交付（刀 18，commit `3d948561`）**，真机 3 条待验。老大原话「这里的方案是什么呢？换地址？」——「换地址」就是本条。**S-283 的收尾刀**：那条只把路径写进文字行，image block 的 `source` 里没有 ⇒ 剥离器条件（`source.filePath` 非空）永远不满足。根因两头都铺好、中间少一个字段。四条改动：C# 两个 `Create*Content` 补 `filePath`（`data` 一个字节不动）/ `stripStringifiedJson` 认字符串化 JSON / `resolveImageBlockSource` 加 `filePath` 兜底成 `oc-media://` / 四处内联拼装收敛。**真库实测 14.34 MB → 1.41 MB（−90.2%）**，32 个 image 块全部剥净。**存量旧数据剥不掉**（没有 `filePath`），属范围外 | [S-284](requirements/S-284.md) |

### 1.3 移交下迭代（十四条，不占承接、不占刀序；S-272 第二段见 §1.2）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-265 | 裸 body 400 —— 上游只回 `{"model":"xxx"}`，30~52 秒慢拒绝，归因不明 | 2026-10-29 09:32 登记。家里电脑真实日志 14 条，全在会话 `Uy5QPV02…`、全打同一渠道 `zuLcBxL9…`。报文只有 model 名、无 `error` 结构 ⇒ 无法定位字段。**与 S-264 / S-261 不是同一个 bug**。S-262 已保证不钉死会话，代价是每次多烧一次 30~52 秒请求。下一迭代先做取证（对照上下文 token 上限 + 直连上游看是否渠道丢信息）再定性 | [S-265](requirements/S-265.md) |
| S-268 | `DesktopScreenshot` 的 `path` 参数完全无效 | 2026-10-29 10:40 登记，来源 dev 第 6 轮审查。`ExecuteScreenshotAsync` 的请求体是空对象，除 `delayMs` 一个字段都没读 ⇒ `path` 从未被解析；而 `CaptureAppWindow` 认真解析并落盘。两个工具调用姿势一样、行为差一半 ⇒ 模型以为存了、下一轮 Read 一个不存在的文件。**比报错更糟：假成功让它继续往下走** | [S-268](requirements/S-268.md) |
| S-273 | 桌面操作别算坐标了 —— 用 UI Automation 直接找元素 | 2026-10-29 15:53 登记。**S-272 的换路径版**：前者把「看图算坐标」的误差压小，本条干脆不算 —— `DesktopQueryElements` 读元素树（`name` / `controlType` / `rect`），`DesktopClick({ window, element })` 取矩形中心点。Chromium / Electron 会把 DOM 可访问性树暴露给 Windows UIA，**我们自己的页面完全可点**。只作增强路径，不替代坐标路径（第三方原生应用覆盖度参差）。开工前四件待查：主进程有没有 `setAccessibilitySupportEnabled`、DOM 到 UIA `Name` 的映射、AOT 下 `IUIAutomation` 互操作、混合 DPI 下 `BoundingRectangle` 的坐标系 | [S-273](requirements/S-273.md) |
| S-277 | 压缩产物在 `messages` 表永久累积 —— 一个会话一天攒 20 张「任务暂告一段落」 | 2026-10-29 18:15 登记，**下一迭代**（v3-iter-5）。同一会话实测 21 个快照 / 20 对消息行，占全部消息 14%。wire 侧是对的（旧摘要一律折进折叠区，one-summary invariant），错的是持久化与渲染从不清理。三个方案待拍：A 加 `superseded_by` 只展开最新一对（可与 S-276 的 `is_artifact` 列合并成一次迁移）/ B 删旧行（破坏溯源）/ C 纯渲染端合并（零迁移，但窗口仍被占名额）。见 [S-277](requirements/S-277.md) |
| S-278 | 全局会话发给项目会话的消息是裸文本 —— 希望识别出来渲染成组件 | 2026-10-30 08:19 登记，**下一迭代**（v3-iter-5）。项目会话里看到的是一条 `role=user` 纯文本，正文是 `[GLOBAL AGENT WORK REQUEST] dispatch_id=…` + 一段给模型看的英文协议说明，**用户全看得见**。根因：`project/send-session-message` 走 `chatStore.sendMessage()` 完全模拟用户输入（文件头注释自述 *fully simulating a user action*），只传 `content`、无 meta，渲染端只能嗅探正文前缀；dispatch 记录与这条消息**没有 id 级关联**。附带：同一段协议文本有两份实现（C# `AgentRuntimeGlobalTaskExecutor.cs:233-235` vs 渲染端 `task-board-store.ts` `buildWorkRequestContent`，注释自称 mirrors），**措辞已漂移**。推荐方案 A：meta 带 `dispatchId`/`globalTaskId`/`kind`/任务标题，协议说明移出消息正文。见 [S-278](requirements/S-278.md) |
| S-279 | 普通消息（`send_session_message`）发出去就没法回 —— 需要轻量回执 | 2026-10-30 08:19 登记，**下一迭代**（v3-iter-5）。`send_work_request` 有 dispatch 记录能回执，`send_session_message` **裸 content 无任何标识**（`AgentRuntimeProjectExecutor.cs:274-328`），而 `reply_global_dispatch` 的 `dispatchId` 是必填 ⇒ 普通问答回不了。现有 `followUp` 是反方向定时追问（`delayMs>=1000`），救不了。方案：普通消息也建轻量 dispatch（`kind=message`，建议 `gm_` 前缀），复用同一个回执工具（**不拆两个**，S-270 的教训是出口越少越好），默认 `hidden_from_board`。见 [S-279](requirements/S-279.md) |
| S-280 | 全局任务的回执不能只靠 agent 自觉 —— 需要确定性的归档机制 | 2026-10-30 08:19 登记，**下一迭代**（v3-iter-5）。`reply_global_dispatch` 是可选工具，模型会漏：①协议说明写在消息正文里，长会话一压缩就没了（正被 S-275/S-276 放大）；②活干长了收尾忘了；③不觉得这算「汇报」；④这轮压根不是在做这件事。**把状态正确押在模型自觉上本身就是设计缺陷**（同 S-267/S-268 病根）。方案三层：投递态 → `loop_start`/`loop_end` 事件驱动执行态 → 归档分**显式 / 隐式**。三条硬规矩：显式覆盖隐式、隐式必须标明「未显式回复」不许伪装成完成、自动归档只写 dispatch 记录不塞消息。核心难点是「这一轮是不是在干这个 dispatch」—— 推荐借 S-278 的 meta 做强判据，先落地可用中判据 + 三条收窄。见 [S-280](requirements/S-280.md) |
| S-281 | 主窗口根容器挂了一层全窗口 `backdrop-blur-xl`，而窗口不透明 —— 纯烧管线，零视觉效果 | 2026-10-30 11:05 登记，**下一迭代**（v3-iter-5）。`main.tsx:196` 与 `:302` 两处根容器 `rounded-2xl bg-background/95 backdrop-blur-xl`，24px 模糊铺满整窗；而全仓 `transparent: true` 只有 `quick-launcher/window.ts:146` 与 `clipboard-enhancer.ts:588`，**主窗口不透明** ⇒ 模糊采样的背后就是自己的背景色 ⇒ 肉眼零差别，但 Chromium 每帧照走整屏模糊 pass。**不是内存暴涨的原因**（已定性为 dev 加载方式），吃的是 CPU/GPU，是流式卡顿的放大器。修法 A：删 `backdrop-blur-xl` + `bg-background/95` 改 `bg-background`；B（真要毛玻璃）走主进程 `backgroundMaterial: 'mica'`。附带全仓另 20 处 `backdrop-blur` 需逐一确认 | [S-281](requirements/S-281.md) |
| S-282 | `WISHFULCLAW_DATA_DIR` 指向全新目录时首次启动静默退出 —— userData 子目录没人建，Chromium 建不了单例锁 | 2026-10-30 11:05 登记，**下一迭代**（v3-iter-5）。**阻断级，排查时连踩两次的实测**。`index.ts:257` `app.setPath('userData', resolveDataPath('electron-user-data'))`，而 `resolveDataPath` 只拼不建 ⇒ 建 `SingletonLock` 时父目录不存在 ⇒ `process_singleton_win.cc:446 Lock file can not be created! Error code: 3` ⇒ 进程直接退出，**没有窗口、没有对话框、日志都没建出来**。一直没暴露是因为 dev 数据目录是历史积累的。影响面：S-223 工作区隔离、多实例并行、用户手工迁移全部起不来。修法：`setPath` 前 `mkdirSync(userDataPath, { recursive: true })`（必须在 `requestSingleInstanceLock()` 之前）；建目录放调用点、别塞进 `resolveDataDir` | [S-282](requirements/S-282.md) |
| S-285 | 助手消息块结构拆出 `message_parts` 表 —— 工具调用改追加写 | 2026-10-30 14:32 登记，**下一迭代**（v3-iter-5）。老大原话「再加一个表，新的助手消息都是另一个表？」，并明确「**最好能兼容老数据**」。根因：工具调用语义上是**追加**的，而 `messages.meta` 是**整行覆盖** —— 一条 148 次工具调用的消息 = 148 次 upsert × 14.5 MB = 2.07 GB 的 stringify + IPC 分配。**S-284 剥完 base64 后仍有 1,257 KB**，所以本条不是锦上添花。方案零迁移：老消息走原路径逐字节不变，新消息只追加 `message_parts`；读时按 `message_id` 分支合并，对外形状不变、渲染层零改动。**前置 S-284（已交付）** | [S-285](requirements/S-285.md) |
| S-286 | 桌面截图的尺寸摘要取自 base64 —— 极简档过程行显示 `8×5` | 2026-10-30 15:09 登记，**下一迭代**（v3-iter-5）。老大原话「截图这个 8×5 是什么意思呢，感觉也是有问题的」。**真 bug，已实测复现**：`tool-call-summary.ts:255` 对 `outputText` 跑 `/(\d+)\s*[x×]\s*(\d+)/` 取第一个命中，而桌面截图的 `output` 是**字符串化的 content 数组**，image 块（含 658 KB base64）排最前 ⇒ 正则先撞 base64 随机字节。实测那张 `3ad69753123f60ce.png`（493,695 B）转 base64 后首个命中**恰好就是 `8x5`**；真实尺寸 2520×1680。落库副本（S-284 剥过 `data`）重开显示正常 ⇒ 只错在当轮。修法：正则锚定 `Captured desktop screenshot (\d+)x(\d+)`，另给「大结构化串不参与摘要正则」的零解析短路 | [S-286](requirements/S-286.md) |
| S-288 | 聊天窗图片点开只能「装进窗口」，不能放大看细节 | 2026-10-30 15:09 登记，**下一迭代**（v3-iter-5）。老大原话「图片预览**限制了高宽**，我点开图片查看**看不到放大版本**」。项目里有三套图片查看：聊天窗 `ImagePreview.tsx` 浮层只有 `h-full w-full object-contain`（**无缩放 / 无拖拽 / 无 1:1**），而右侧预览面板与 `LocalImagePreviewDialog` 都走 `ImageViewer`（`clampScale` 0.25~5、旋转、复制、拖拽）。`LocalImagePreviewDialog.tsx:5` 的注释早写着目标「保证缩放 / 旋转 / 复制 / 拖拽一套能力完全一致」—— **第三处没落到**。2520×1680 的截图在 1080p 屏上被压到 ≈1000×667，`Click to enlarge` 名不副实。修法：浮层换 `ImageViewer`（无 `filePath` 的来源退回现浮层） | [S-288](requirements/S-288.md) |
| S-289 | 用量统计折线图未 hover 时圆点太大太抢戏 —— 不交互时不该有圆点 | 2026-10-30 16:55 登记，**下一迭代**（v3-iter-5）。老大原话「曲线图未选中时，也就是鼠标没有移上去之前的**圆点太大了，有点抢戏**，**未 hover 时没有圆点都是可以的**」。`line-chart.tsx:79-95` 无条件给「每个系列 × 每个时间桶」渲染 `<circle>`，非 hover 也画（`r=2.5` / `opacity=0.72`），直径正好等于折线的 `strokeWidth=2.5`，默认 24 小时视图 + 3 个模型就是 72 个点。每点的 `<title>` 冗余 —— `ChartTooltip` 是列级的，hover 时已给出该列全部系列。方案 A：未 hover 只画 `path`，hover 只画该列圆点（高亮样式原样保留），代码量反而减少 | [S-289](requirements/S-289.md) |
| S-290 | 截图经能力代理调用时 image 块被 32 KB 截断 —— S-283「本轮看得见图」的前提落空 | 2026-10-30 19:30 老大定**下一迭代**（v3-iter-5）。验 S-283/S-284 时看日志撞见 `tool=use_capability originalBytes=712499 truncatedBytes=32768`。**落库与送模型走了两个出口**：`ToolCallProcessor.cs:389` 落库用完整 `toolOutput`（S-284 正常剥 `data`，meta 10.9 KB），`:412` 送模型用 `truncatedOutput` ⇒ 模型拿到的不是 image 块而是一段砍断的 JSON 文本（PNG 只到 16 KB）。`OutputLimit.cs:89/95` 的豁免名单只有 `use_capability` 的 `list`/`inspect` 与 `Read`，截图两头不沾。功能靠下一轮 `Read` 盘上那份兜住（`Read` 走 `toolContentBlocks`），代价是每次多一次往返。方案 A：按「输出里有没有带 `filePath` 的 image 块」短路豁免，判内容不判工具名。**不是回归，是老缺陷**，S-283 方案 A 的假设让它显形。**另一条更危险的分支**：`SpillToolOutput` 失败会退到 `TruncateToolOutput`（`OutputLimit.cs:131`），那条路只给「rerun with narrower args」、不给路径 ⇒ 模型拿着残图无从自救，属静默错误（诱因：磁盘满 / 权限 / spill 目录被清）。方案 A 短路排在 spill 之前，顺带消掉 | [S-290](requirements/S-290.md) |

## 二、挂账与阻塞（两条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **挂账**。缺陷**确定成立**、触发频率低，老大定「先登记、等模型能力足够再攻」。重开前**先补两处判据盲区**（见 plan.md §三） | [S-233](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约**，全树搜 `qoder` 零命中。契约不到不写任何请求代码 | [S-230](../iter-v3-2/requirements/S-230.md) |

## 三、历史未闭环项（2026-10-28 17:44 探查后订正）

| # | 现象 | 订正后状态 |
|---|---|---|
| 1 | `Sandbox elevation tool execution failed: CannotWritePropertyWithinArray, None` | **早已修复，无需再做**。`b6a95eca`（2026-10-20）已修，`S-207.md:3` 状态行为「已完成（阶段五审查修复 + 真机验证通过）」，根因见 `S-207.md:349-350`（`BuildRequest` 漏写 `WriteStartObject/WriteEndObject`）。⚠️ **v3-iter-3 收尾时把它列进「未排查」是误记。** 旁证：`src/runtime` 全量扫描同类写法 0 残留 |
| 2 | Goal 回归 `KeyNotFoundException` | **需一次运行时抓栈才能定案**。Goal 目录内 `GetProperty` / 字典读索引器**均无直接抛点**（全走 `TryGetProperty`），嫌疑收敛到 Goal 之外被它调用的层（DB 行解码 / Worker 响应解码 / 反向请求响应解码）。另：2026-10-28 17:31 复跑 `npm test` **89/89 全过**（含 Goal 335 断言）⇒ 当前 HEAD 不复现 |


## 四、门禁基线

沿用 v3-iter-3 收尾实测值（`typecheck` 三配置 0 错 / `npm test` 89/89 / `dotnet build sln` 0 警告 0 错误 / 官网 build 0 错）。

**迭代内实测推进**：勘察复跑 89/89（未漂）→ 刀 1 后 **90/90** → 刀 1c 后 **91/91** → 刀 1e / 1f / 1g 后仍 **91/91**（只加断言不加套件数）→ 刀 2 后 **92/92**（新增 `plugin-view-rules`）→ 刀 3b ~ 14 逐刀推进至 **100/100** → 刀 15 后 **101/101** → 刀 16 后 **102/102** → 刀 17 后 **104/104**（一次加两套：`real-user-turn` + C# `RealUserTurn`）→ 刀 18 只加断言，仍 **104/104**。

⇒ **本迭代门禁基线最终值**：`npm run typecheck`（node + web）0 错 · `npm test` **104/104** · `dotnet build tests\WishfulClaw.Tests.sln` 0 警告 0 错误。**2026-10-30 16:48 收尾复核**：`npm run typecheck` 两配置 exit 0、0 错。详见 plan.md §五。
