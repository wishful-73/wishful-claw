# v3-iter-7：零件全在，线没接 —— 把已经造好的接通

- 状态：已完成，已合并 main
- 分支：dev/v3-iter-7（已删除）
- Plan: docs/plans/iter-v3-7/plan.md
- VERDICT: PASS（自动化回归全绿；刀 0 六条未照清单逐条走完，「如实记账」写在 raw-requirements.md §二·B）
- 产品版本: 1.0.7
- Tag: v1.0.7
- 日期: 2026-11-05
- 迭代定位：**上一迭代修的是「把正确性押在某个不会报错的地方」，这一迭代处理同一病灶的前一步 —— 东西已经造好了，但没人把它接上去。** 三条实施项都不是「写新东西」：6 种插件卡片渲染器全部完工却卡在最后一道无条件 `return null` 的总闸上；开发工作流在本仓跑了 60 个迭代，产品侧新建项目却不落任何模板；`SystemPromptCache` 的 `Invalidate` / `Clear` 全仓 0 调用点，热记忆在提示里永远是 worker 启动那一刻的快照。所以本迭代的验证重点不是功能覆盖，是**接通之后真的走了一遍**。

## 范围与功能单元（交付 7 条 + 补刀 2 次 / 移交 1 条 / 挂账 4 条）

### 三条实施项（刀 1 ~ 刀 3）

- **S-305 插件卡片渲染通道是死的（刀 1，commit `032298b7`）** —— 6 种渲染器（card / table / form / chart / html / component）+ iframe 沙箱 + 高度协商全部完工，唯独总闸 `parseExtensionToolResult` 无条件 `return null`，一张卡片都出不来。裁定「主进程统一包装、插件只在响应体顶层声明 `ui`（含 `kind`）」，`ui.kind` 认不出时丢 `ui` 保其余字段、退化成纯文本 —— 宁可不渲染，不出空白卡片。新增 `tests/extension-tool-result` 钉死认/不认边界。
- **S-313（a）工作流目录 + 模板 + 指针式注入（刀 2，commit `ae7c9b8a`）** —— 新建项目落 `.wishful-claw/workflow/`（规范正文 + 迭代目录 + 需求单 + 三套模板），系统提示只留一行指针，**读不读由 `AGENTS.md` 决定**，软件侧零开关零 UI。这一刀不动提示前缀，纯新增文件 + 一行指针。迁移坑先解开：`.gitignore` 把 `.wishful-claw/*` 整体忽略 ⇒ 开白名单只放行 `workflow/`。
- **S-313（b）+ S-314 热记忆指针化（刀 3，commit `1ab9984b`）** —— 把 `MEMORY.md` 全文从提示前缀里挪走、换成指针，`Invalidate` / `Clear` 从死代码变成真调用点。**必须与刀 2 分开**：刀 2 是「加一个文件」，刀 3 动的是 prompt 最前面那 6,000 字符预算，缓存命中率直接受影响，合成一刀就分不清效果来自哪。留「热记忆全文注入」回退开关（`memoryFullInjection`），可独立回滚。

### 观感与请求头（刀 4 ~ 刀 7）

- **S-315 工具 run 折叠块每个工具都开合一次（刀 4，commit `13154237`）** —— 根因不是动画、不是重渲染，是**判据选错了变量**：`deriveToolRunCollapsed` 用 `activeCount > 0` 当开关，而 `compact`（**默认档**）两值恰好是 `false` / `true` ⇒ 连续调用时 `1 → 0 → 1` 跳，每个工具开始展一次、结束收一次。判据换成 `sealed`：收起要**同时**满足「run 已封口」+「run 内无执行中工具」。**没有用「加个冷却时间」** —— 那只是把抖动拍扁成延迟。顺带拆文件：主文件到 520 行顶穿硬线，分类判据整块搬到 `execution-outline.classify.ts`（251 行），主文件回落 317 行。
- **S-316 内置服务商请求头搬进 `requestOverrides.headers`（刀 5，commit `a478ffd6`）** —— 数据化通道（模板 + 覆盖语义 + 空值跳过）**早就在**，问题只是 42 个预设只有 3 个用上。搬 `x-opencode-session` / `OpenAI-Organization` / `OpenAI-Project`；**不搬**动态身份头（`X-User-Id` 等，值来自登录态，放开等于让用户按别人账号作答）、`User-Agent`、协议必需头。**C# 兜底路径不删**（老用户升级即丢头），靠 `Contains` 检查顺带修掉 `ApplyOAuthAccount` 跑在覆盖之后导致的**双值**缺陷。实施中才发现的坑：`Dictionary.ContainsKey` 大小写敏感、`HttpRequestHeaders.Contains` 不敏感 ⇒ 新增 `HasHeaderKey` 收口，否则 debug 视图两行、真实请求一行，破坏「debug 就是实发头」这条承诺。
- **S-317 请求头编辑器两态（刀 6 `6e660276` + 补刀 `2364a78b`）** —— 原来是每敲一个字符就落库、界面零反馈，校验失败还「跳过非法行、存其余」。改成「编辑 → 保存」两态，`errors` 与 `dirty` **派生**而非 state（行改对了状态自然跟上，没有「错误表落后于行」的窗口），`onChange` 从校验路径摘出来 ⇒ 「校验失败还偷偷提交」不可能复发。老大 14:06 追加口径「默认不要是输入框，双击或点编辑才变」⇒ 补刀把默认态改成纯文字，进编辑三条路（双击 / 铅笔 / 键盘），顺手修掉三项：编辑态铅笔占位（删除按钮不横移）、没改内容时取消按钮点不动、「只填值不填名称」被静默丢弃。
- **S-319 空白 thinking 打断工具链（刀 7，commit `5f3a927a`）** —— S-315 落地后老大仍看到「三个工具三个块」，**不是同一处**：S-315 管「run 算出后收不收」，本条管「run 算的时候切不切」。模型在不需要思考的轮次返回 `reasoning_content = " "`（纯空格，不是空串），四处源头判据全判空串 ⇒ 建一个看不见的 thinking 块 ⇒ 被当成封口信号。实测那条消息 272 个 thinking 里 **181 个空白（66.5%）**，787 个 part 切成 **292 个 run**。「空思考不入库」这条路**被否决**：空白 thinking 与加密思考（`thinking: ''` + `encryptedContent`）长得一样、性质相反，按内容过滤入库必然误杀需回传的加密思考 ⇒ **入库逻辑一个字不改**，只在源头掐掉。分段判据本身没动（老大定「思考是应该打断工具链的」）。

### 补刀两次（刀 4 / 刀 6 的实施缺陷，不新开需求单）

- **S-315 修正（commit `c2b8a89a`）** —— 老大 11:22 复测报「报错的工具最后还展开了、折叠块没折叠」。刀 4 把「`Task` 卡前」与「`boundaryAfter*` 强制分段」判成 `sealed=false`，可这两处的语义是**把工具串切开**、不是留在原地 —— 切开即「这一段到此为止」，判 `false` 等于宣告该段永不封口。两处改正后，**只有「流未结束时的兜底收尾」判 `false`**。
- **S-317 补刀（commit `2364a78b`）** —— 见上，老大 14:06 口径。

### 刀 0 结账（**如实记账**，不写成「已验收」）

上一迭代六条「已实施待真机验收」：S-303 / S-308 / S-309 / S-310 / S-311 / S-312。**没有一条是照清单逐条打勾走完的**，但六条对应代码路径在 dev 实例上持续用了一整个迭代（S-315 / S-317 / S-319 三条观感缺陷恰恰是老大在这个使用过程里发现的）。按老大口径「dev 实例上反复跑过的即实测通过」收口，逐条状态见 [../plans/iter-v3-7/raw-requirements.md](../plans/iter-v3-7/raw-requirements.md) §二·B。其中 S-309 §4.3 三条在迭代内补齐（实时耗时 + 「可能已卡住」+ 停止按钮三态，commit `1895a83a`），§4.4「卡住时仍能收消息」经查证**不成立**（`LocalIpcWorkerServer` 并发派发，工具卡住不阻塞其它请求）。

### 移交与挂账

- **S-318 公开版剔除「订阅额度 OAuth 冒充」（5 个 preset）—— 移交 v3-iter-8** —— 老大 09:47 提出合规风险（「workbuddy 是一个风险点，如果去抖音推广……会被腾讯直接告」），10:12 拍板「统一都需要处理，丢到下个迭代单独处理」。范围 = `workbuddy` / `workbuddy-ai` / `codex-oauth` / `copilot-oauth` / `moonshot-coding`，**保留 `moonshot`（API Key 版）**。三个坑：授权页整页可删（只收 `server_poll`）、`reconcileProviders` 会留僵尸服务商（需显式剔除名单）、`lib/auth/provider-auth.ts` 不是纯 OAuth（含多账号轮转，pet / translate 在用，不能整目录删）。
- **挂账四条不占刀序**：S-320（.NET 11 GA 一次性升 ILCompiler，消 NU1903；**实际暴露面为零**，不 `NoWarn` 压告警）、S-233（聊天窗抖动另一条路径）、S-230（Qoder 缺契约）、S-273 段 B（第三方窗口元素树）。候选池 S-232（安全加固，无限期搁置）。

## 工程收口

- **门禁三条**：`npm run typecheck`（node + web + test 三配置串行）、`npm test`、`dotnet build` 两套 sln `-t:Rebuild`。
- **`src/runtime/WishfulClaw.sln` 在干净环境是 2 警告**，两条都是已挂账的 `NU1903`（同一个 `Microsoft.DotNet.ILCompiler` 预发布包，被两个工程各报一次）。`obj/` 缓存口径下是 0 警告 —— **增量构建不是可信口径**，验收一律 Rebuild。
- **测试套件 122 → 125**（`extension-tool-result` 新增；`tool-run-folding` 加 S-315 两条判据、S-319 三条判据）。
- **新增判据一律做反向验证**：S-315 把 `:222` 改回 `false` 即报 `actual: false, expected: true`；S-319 把判据退回 `seg.thinking` 即报 `actual: 3, expected: 0`（精确复现现场那三块）。
- **格式**：新增与大改文件全部 CRLF / UTF-8 无 BOM / 裸 LF = 0。
- **官网本迭代零改动** ⇒ 发版只走 `installer`，不重发站点。

## 验证

- `npm run typecheck`（node + web + test 三配置）**0 错误**
- `npm test` **125/125**
- `dotnet build src/runtime/WishfulClaw.sln -t:Rebuild` **0 错误 / 2 警告**（均为已挂账 S-320）
- `dotnet build tests/WishfulClaw.Tests.sln -t:Rebuild` **0 警告 0 错误**
- 真机口径（老大定）：dev 实例上反复跑过的即实测通过，不列打勾清单。已过：S-305（下载与启用流程）/ S-313 / S-314 / S-315（含 11:22 复测后的修正）/ S-316 / S-317 / S-319。刀 0 六条见上。

## 遗留

- **S-318 公开版合规清理** —— 移交 v3-iter-8 单独做。`reconcileProviders` 的僵尸记录要显式剔除名单，别指望「preset 不存在」的隐式行为；`lib/auth/` 不能整目录删。
- **S-320 NU1903** —— 等 .NET 11 GA 一次性升 `global.json`，两条 sln 一起重验，重点第 5 步 AOT 发布后真机跑一轮（换编译器版本最容易在裁剪 / 反射缺失上出幺蛾子）。
- **刀 0 六条未照清单逐条走完** —— 发布后若复现，按 bug 新开单，不在这张表上续。
- **S-233 / S-230 / S-273 段 B** —— 继续挂账。

## 发布

> 打包与双面核验结果见 main 上的「发布记录」提交，本文档只记迭代内容。
