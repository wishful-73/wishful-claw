# v3-iter-7 需求清单

> 拆分于 2026-11-04 17:1x。来源 = v3-iter-6 收尾移交 + 该迭代「已实施待真机验收」六条。
> 本文件只列清单与依据，刀序见 [plan.md](plan.md)。

## 一、本迭代实施（7 条）

| 编号 | 标题 | 现状 / 依据 | 正文 |
|---|---|---|---|
| S-305 | 插件卡片渲染通道是死的 | 6 种渲染器 + iframe 沙箱 + 高度协商**全部完工**，总闸没合：`parseExtensionToolResult`（`extension-result.ts:4-6`）无条件 `return null`；`__wishfulClawExtensionResult` 全仓只在类型定义里出现一次、主进程零产出 ⇒ 插件卡片一张都出不来。老大 2026-11-03 09:12「登记一个需求，这个需求暂时不在本迭代处理」，并定「CodeGraph 先走普通工具卡片」（MCP `content:[{type:'text'}]`，零改动） | [../iter-v3-6/requirements/S-305.md](../iter-v3-6/requirements/S-305.md) |
| S-313 | 把「开发工作流 + 迭代文档 + 计划」做成产品能力，产出落项目 `.wishful-claw/` | 五项已定：①目录名 `.wishful-claw/workflow/`（`plans` / `goals` 已被占用）②注入**指针式**，新建项目复制一份模板、系统提示只提一句路径，**读不读由 AGENTS.md 决定**，软件侧零开关零 UI ③本仓 `docs/` 一字不动 ④本期只做核心三件 ⑤热记忆同构改造（§6.6） | [requirements/S-313.md](requirements/S-313.md) |
| S-314 | 热记忆变更后系统提示不重建，提示里长期是过期快照 | 三条实测证据：`SystemPromptCache.cs:46-47` 注释承诺刷新，但 `GetPersonaFingerprint`（`:83-124`）只扫 personas 目录 ⇒ MEMORY.md 没进 cacheKey；`Invalidate` / `Clear` 全仓 0 调用 ⇒ 实际是「worker 重启才重建」。根因结构性：「内容新」与「前缀缓存命中」在「塞全文」这个结构下天然互斥 | [requirements/S-314.md](requirements/S-314.md) |
| S-315 | 连续工具调用时，工具 run 折叠块每个工具都开合一次 | 老大 11-05 08:35 报「一个工具调用就展开，这个工具结束就收起，下一个继续展开，频率太高」。根因：`deriveToolRunCollapsed`（`render-density.ts:102-110`）拿 `activeCount > 0` 一个三目当开关，而 `compact`（**默认档**）两值恰好是 `false` / `true` ⇒ 每完成一个工具就收一次。**只有默认档抖**，`text` 恒收、`detail` 恒展 | [requirements/S-315.md](requirements/S-315.md) |
| S-316 | 内置服务商请求头仍是 C# 硬编码，没走 `requestOverrides.headers` | 老大 11-05 10:30「内置的服务商很多还是代码上硬编码，而不是通过自定义请求头数据的形式配置」。数据化通道**早就在**（`requestOverrides.headers` + `{{sessionId}}` / `{{model}}` 模板 + `Remove` 后 `Add` 覆盖 + 空值跳过），但 42 个预设只有 3 个用上；`ProviderHttpHeaders.cs` 里还写死 5 组头。顺带查出 `ApplyOAuthAccount`（`:120-140`）在 `ApplyHttpHeaderOverrides` **之后**执行且无 `Contains` 检查 ⇒ 用户配同名头会被**追加成双值** | [requirements/S-316.md](requirements/S-316.md) |
| S-317 | 请求头编辑器没有「编辑态 / 已保存态」 | 老大 11-05 10:30「编辑了请求头以后不知道是否保存了」。现状每敲一个字符 → `patchRow` → `commit` → `updateProvider` 即落库，界面零反馈；校验失败还「跳过非法行、把其余行照常提交」。同面板 API Key 有 `onBlur` + toast 反馈，请求头什么都没有 | [requirements/S-317.md](requirements/S-317.md) |
| S-319 | 空白 thinking 打断工具链，连续工具调用被切成多个折叠块 | 老大 11-05 10:46 报「连续 3 个工具调用出现了三个折叠」。**与 S-315 不是同一处**：S-315 管「run 算出后收不收」，本条管「run 算的时候切不切」。根因：模型在没有思考内容的轮次返回 `reasoning_content = " "`（纯空格，非空串），四处源头判据 `IsNullOrEmpty` / `Length > 0` 全部放行 ⇒ 渲染层建一个**看不见**的 thinking 块（`ThinkingBlock.tsx:67` trim 后 `return null`）⇒ `execution-outline.ts:207` 拿它当「下一段思考来了」把工具 run 封口。实测：截图那条消息 272 个 thinking 里 **181 个空白（66.5%）**，787 个 part 被切成 **292 个 run**；最近 200 条消息 1106/4073（27.2%）。**入库逻辑不改**：空白块与加密思考（`thinking: ''` + `encryptedContent`）长得一样但性质相反，按内容过滤入库会误杀需回传的加密思考 —— 在源头掐掉则两者互不干扰 | [requirements/S-319.md](requirements/S-319.md) |

## 一·B、移交 v3-iter-8 单独处理（1 条）

| 编号 | 标题 | 移交依据 | 正文 |
|---|---|---|---|
| S-318 | **公开版剔除「订阅额度 OAuth 冒充」（5 个 preset）** —— 合规清理 | 老大 11-05 09:47「workbuddy 是一个风险点，如果去抖音推广大家使用……会被腾讯直接告」+ 09:5x「页面 ai 授权服务商也需要删掉才对啊」+ 10:12「统一都需要处理。不过可以丢到下个迭代单独处理」。**5 个 preset**：`workbuddy` / `workbuddy-ai` / `codex-oauth` / `copilot-oauth` / `moonshot-coding`，全是「用订阅额度冒充官方客户端」（`codex_cli_rs/0.144.5` UA + `chatgpt.com/backend-api`、`GitHubCopilotChat/0.26.7` + `copilot_internal/v2/token`、`KimiCLI/1.49.0` + 客户端白名单）。**保留 `moonshot`（API Key 版，同文件 `:123`）**。命中三个坑：①「授权 AI 服务商」整页只收 `server_poll` ⇒ 可整页删 ②`reconcileProviders:224-229` 对同 preset 第二三条记录原样保留 ⇒ 僵尸服务商，需显式剔除名单 ③`lib/auth/provider-auth.ts` **不是纯 OAuth**，含多账号轮转，被 pet / translate-store 用 ⇒ 不能整目录删 | [requirements/S-318.md](requirements/S-318.md) |

## 二、承接上一迭代的真机验收（6 条，**已实施未验收**）

| 编号 | 已实施的改动 | 验收点（本迭代刀 0 结账） | 正文 |
|---|---|---|---|
| S-303 | CodeGraph 剥离为可选插件，主仓只留插件配置与下载通道 | **装 / 停 / 卸 / 重装** 4 步：装后 agent 能查符号；停用后工具消失但配置留存；卸载后无残留；重装能回到已启用 | [../iter-v3-6/requirements/S-303.md](../iter-v3-6/requirements/S-303.md) |
| S-308 | 子 agent 停止：`toolUseId → CTS` 注册表 + `SubAgentStop` 工具 + UI 入口 | **跨 run 停止**（background 子 agent 活得比父 run 长时仍能停）+ **派停 20 次 CTS 不泄漏**（`ObjectDisposedException` 是本条唯一技术风险） | [../iter-v3-6/requirements/S-308.md](../iter-v3-6/requirements/S-308.md) |
| S-309 | 工具调用超时收口在调用方 `DispatchWithTimeoutAsync` 竞速 | §4.3 **UI 弱提示**（`ToolCallTimeout.ShortReason()` `ToolCallTimeout.cs:237` 全仓无调用点，死代码）+ §4.4「卡住时仍能收消息」+ §4.2.4「ask-user 超时后用户再答，答案被丢弃」 | [../iter-v3-6/requirements/S-309.md](../iter-v3-6/requirements/S-309.md) |
| S-310 | 子 agent 卡片 header 整行点击只切展开，另给「查看详情」纯文字入口 | 点 header 只展开、不弹右侧面板；点「查看详情」才开面板；中英文案同步 | [../iter-v3-6/requirements/S-310.md](../iter-v3-6/requirements/S-310.md) |
| S-311 | 子 agent 运行期进度经 `SubAgentRunCollector.ProgressChanged` 实时上报 | 运行中（非结束）状态工具即报非 0 的 calls / iterations；前台、后台、goal 三条路径都覆盖 | [../iter-v3-6/requirements/S-311.md](../iter-v3-6/requirements/S-311.md) |
| S-312 | 视口低于 `MIN_REAL_VIEWPORT_WIDTH = 480` 时跳过窄窗判定 | 左栏展开 ⇒ 切走 ⇒ 切回，左栏不再自己收起；真实拖窄到 480 以上仍然正常收起 | [../iter-v3-6/requirements/S-312.md](../iter-v3-6/requirements/S-312.md) |

## 二·B、刀 0 结账状态（2026-11-05 收尾时点，**如实记账**）

刀 0 的定位是「结账」，所以这里不谈「应该验过」，只写实际发生了什么：

| 编号 | 收尾时状态 |
|---|---|
| S-303 | 装 / 启用 / 停用在 dev 上走过（CodeGraph 已实测过安装与下载进度）；**「卸载 → 无残留 → 重装回到已启用」三步没有照清单独立走完** |
| S-308 | 子 agent 停止按钮在 dev 上用过；**「跨 run 停止」与「派停 20 次 CTS 不泄漏」两项压测没有做** |
| S-309 | §4.3 三条全部落地（11-04 17:30 前两条、`1895a83a` 第三条停止按钮三态），dev 实测过；§4.4 经查证**不成立**（`LocalIpcWorkerServer` 并发派发，工具卡住不阻塞其它请求）；§4.2.4 未动 |
| S-310 | 未单独走查（卡片 header 点击与「查看详情」入口） |
| S-311 | 未单独走查（子 agent 运行期非 0 进度） |
| S-312 | 未单独走查（左栏切走切回不自收） |

结论：**六条没有一条是照验收清单逐条打勾走完的**，但六条对应代码路径在 dev 实例上持续使用了一整个迭代（S-315 / S-317 / S-319 这几条观感缺陷恰恰是老大在这个使用过程里发现的）。按老大口径「dev 实例上反复跑过的即实测通过」收口，**不写成「已验收」**。发布后若复现，按 bug 新开单，不在这张表上续。

## 三、挂账 / 阻塞（四条，不占刀序）

| 编号 | 标题 | 状态 | 明细 |
|---|---|---|---|
| S-233 | 聊天窗抖动复发（非「组件回收高度」路径） | **继续挂账** | 频率低、**只在新版本第一个会话偶发**；老大 2026-10-31 定「先登记等以后模型牛掰了再试试能解决不」 | [../iter-v3-2/requirements/S-233.md](../iter-v3-2/requirements/S-233.md) |
| S-230 | Qoder 账号接入 | **阻塞在契约** | 全树搜 `qoder` 零命中，契约不到不写任何请求代码 | [../iter-v3-2/requirements/S-230.md](../iter-v3-2/requirements/S-230.md) |
| S-273 段 B | 第三方窗口的元素树（`EnumChildWindows`） | **待拍板** | 段 A（自家窗口走 CDP）已随 v3-iter-5 交付。段 B 只覆盖 Win32 控件，Chromium 系第三方窗口拿不到 ⇒ 收益存疑，拍板前不动 | [../iter-v3-4/requirements/S-273.md](../iter-v3-4/requirements/S-273.md) |
| S-320 | .NET 11 SDK 升级（消 NU1903 / ILCompiler Brotli 漏洞告警） | **挂账，等 .NET 11 正式版** | 老大 11-05 11:22「这个是不是有新版本了」→ 随后定「登记到文档，以后处理」。**不是我们的 bug，实际暴露面为零**：公告 `GHSA-p3jp-9v83-76w9`（CVE-2026-111497，Brotli 解码器越界写，CVSS 8.1）受影响区间 `>= 11.0.0-preview.1, < 11.0.0-rc.3.26522.148`，我们 `11.0.0-preview.7.26381.103` 在区间内；但公告明说「装了受影响的包不等于暴露」，而全仓 542 个 `.cs` 里 `Brotli` / `Accept-Encoding` / `AddRequestDecompression` **全 0 命中**，唯一 `new HttpClient`（`Infrastructure/Http/WorkerHttpClientFactory.cs:44`）在 `:36` 显式 `AutomaticDecompression = DecompressionMethods.None` ⇒ 既不发 `br` 也不解压。**消不掉的原因**：ILCompiler 是 `<PublishAot>true</PublishAot>` 隐式带入、版本跟 `src/runtime/global.json` 的 SDK 走，只能升 SDK；**不升 rc.3**，等 GA 一次性升（rc.3 之后 GA 还得再升一次）。**不 `NoWarn` 压告警** | [requirements/S-320.md](requirements/S-320.md) |

## 四、候选池（老大提过但暂不做）

| 编号 | 标题 | 为什么现在不做 |
|---|---|---|
| S-232 | 安全加固 | 老大 2026-10-27 裁定「无限期搁置」 | [../iter-v3-2/requirements/S-232.md](../iter-v3-2/requirements/S-232.md) |

## 五、本轮核对掉的（**防重复登记**，不立项）

拆分时把上一迭代文档里的过期结论逐条核了一遍，四条要更正：

1. **「官网反馈看板『已做 / 待办』标记无限期搁置」—— 作废。** 这条记在 v3-iter-6 raw §四，但 S-226 早已上线并投入实际使用：2026-11-04 16:5x 把反馈 #5 从「待办」改「已做」，公开列表随即变化。候选池里不该再有它。

2. **S-207 不进挂账。** 单据状态是「**已完成（阶段五审查修复 + 真机验证通过，2026-10-20）**」，热记忆里「从未排查」那条记错了。真正的报错 `Sandbox elevation tool execution failed: CannotWritePropertyWithinArray, None` 是 10-16 实施期的一次工具执行错误，后续真机已通过。

3. **「内置浏览器清除缓存」不要再登记。** v3-iter-6 raw §3.5 已逐行确认**功能已实现，不是欠账**（当时是按 S-281 那类错法的教训重查的：没打开文件确认闸在哪一层就下结论）。

4. **S-265 / S-277 / 原拟 S-299 已撤销，编号不重用。** 撤销理由在 v3-iter-6 raw §3.7 / §3.8 / §3.6，重开需满足各自列出的前置条件，不要凭印象重新立单。
