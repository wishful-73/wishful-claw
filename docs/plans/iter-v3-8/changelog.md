# v3-iter-8 changelog

> 裁定与口径变更流水，按日期追加。跨需求，不塞进任何单需求文档。

## 2026-11-05

- **14:49 老大「开新迭代」** ⇒ 从最新 `main`（`86166fd4`，= v1.0.7 发布记录）拆 `dev/v3-iter-8`，建 `docs/plans/iter-v3-8/`。产品版本目标 `1.0.8`，tag `v1.0.8`。执行期只 commit、不 push。
- **拆分结论：本迭代只有 S-318 一条实施项。** 核对方式：v3-iter-6 raw 的九条全部已实施 / 已撤销（S-277 / S-265 撤、S-295 交付「不建议迁」）；v3-iter-7 raw 的七条全部已实施并随 v1.0.7 发布；`grep iter-8` 全 docs 只有 S-318 一处移交记录。**不为了凑刀数把存量里状态不明的需求拉进来** —— 那批需求单本就没写状态行，未经复核不进待办池。
- **14:56 登记 S-321（死代码清理），插为刀 0。** 老大 14:53 反问「宠物不要，翻译是什么？」⇒ 核实后**宠物 1261 行和翻译约 790 行全是死代码**：`src/main` 对 `pet` 零命中、渲染层零组件 import `lib/pet/*`、`useTranslateStore` 零消费者，另 12 条通道白名单指向不存在的 handler。
- **为什么必须排在 S-318 之前**：S-318 刀 2 我原本写「`lib/auth/` 不能整目录删，宠物和翻译在用多账号轮转」—— **这条理由的前提是错的**。五处外部 import 全部只用了 `ensureProviderAuthReady` 一个函数，删掉消费者之后 `pickUsableAccount` 那套多账号轮转也失去全部消费者 ⇒ 刀 2 可以从「摘半截、留轮转」简化成「整目录清」。**先删死代码，再删 OAuth；顺序反了就得为不存在的东西写兼容。**
- **教训记下来**：我把「有 import」当成了「是活功能」，没往上追一层「谁在用它」。以后判断某模块能不能删，**判据是调用链顶端有没有 UI 或主进程入口，不是有没有 import**。
- **S-318 为什么单独占一个迭代**：工作量本身就够。A 段 17 个文件 + B 段 3 个 preset 与 4 个 `lib/auth` 文件 + 僵尸记录剔除 + 构建期硬拦截 + 八条验收。而且它是**减法**，跟功能改动混在一起会让回滚边界变糊（出问题要能整刀撤掉）。
- **顺手订正三处文档欠账**：S-316 / S-317 状态行还写「待开工」、S-305 还写「待真机验收」，实际都已实施并随 v1.0.7 发布。已就地改掉，记在 [raw-requirements.md](raw-requirements.md) §四。
- **口径重申**：本迭代官网零改动 ⇒ 发版只走 `installer`；**v1.0.8 之前抖音推广别拍设置页的 AI 服务商列表**（那一屏有「WorkBuddy 已连接」）。
- **15:00 ~ 15:04 登记内存三条（后于 15:14 拆为 S-322 / S-323 / S-324），排刀 6~8。** 老大让我看私有仓 `D:\claw\wishful-work` 的内存专项能不能借鉴，15:04「登记吧」。
- **这条的起因是「我过去几轮方向偏了」**：我一直把 worker 的 1 GB+ 当渲染层问题治，做了极简模式、虚拟列表、剥 base64、拆表。私有仓的反向实测把这个前提打掉了 —— **renderer 可回落到 252 MB，worker 5 分钟涨 1.9 GB 不回落**。主仓自己的日志也早就写着答案，只是我没去读：`2026-11-05.log` 里 51 条 `memory high role=worker managed=1060.8→1062.9MB`，而同一时刻 `renderer ws=256.2MB`。
- **教训**：诊断内存先分清「谁的」。`memory-monitor.ts` 早就在按 role 分项落日志了，我要做的只是**去读它**，而不是另建一套探针猜。以后遇到「内存高」，第一动作是 `Select-String logs\*-*.log 'memory high'`，不是加新代码。
- **主仓为什么会有这个 bug**：`SessionConversationManager` 类注释写「entries are removed on session switch」，我信了这句话。实测 `Remove` 只在删会话 / subagent / goal 三处调用，**切换会话从不释放**。⇒ 又一条同 S-321 的教训：**注释不是证据，调用点才是。**
- **内存三条为什么排 6~8 而不提前**：内存是体验问题，合规是法律问题，后者优先；且这三条改动文件与刀 0~5 完全不重叠，回滚边界独立，晚做不影响前面任何一刀。
- **15:14 把内存三条从一张合单拆成三个独立编号** —— 老大：「你刚刚直接登记三个也行啊 突然搞个abc干啥」。原先 S-322 里写「A 段 / B 段 / C 段」，看着像子项，实际是三处**文件不重叠、可各自独立回滚**的改动 ⇒ 拆为 **S-322（会话驻留淘汰，刀 8）/ S-323（`request_debug` 白推，刀 7）/ S-324（base64 前缀重复复制，刀 6）**。
- **刀序随之重排为 6/7/8（S-324 → S-323 → S-322）**，理由两条：① 最安全的先做（S-324 判据不变），先建立「改动不改行为」的信心 ② 治根的 S-322 风险最高（淘汰错＝用户上下文没了）⇒ 放最后动。原「6a 在最前」的意图保留，只是编号理顺了。
- **为什么该拆**：一个需求单对应一次可独立验收、可独立回滚的改动，是这轮迭代一路在守的口径（S-316 / S-317 / S-305 的账就是合单写法留下的）。合单里写 A/B/C，日后溯源要翻整篇找段落，**编号是唯一的检索键**。
- **教训**：登记时图省事合并，等于把「未来溯源成本」记在自己账上。**凡是能各自独立回滚的，就该各自编号。**
- **15:26 老大纠正我对病灶的定性（我把理由写错了，判据结论不变）。** 我说的是「借厂商账号的订阅额度」—— 错了。老大原话：「workbuddy也是拿自己的账号额度，只是说是冒充workbuddy客户端去请求他们的模型」。⇒ **这 5 个用的都是用户自己的账号、自己付的套餐，额度归属没问题；错的是「授权通道」** —— 厂商把 OAuth 登录（扫码 `server_poll` / 设备码 `device_code`）只内置于官方客户端，我们冒充 `WorkBuddy/5.5.6` 走进去，等于绕开「只允许官方客户端使用」的限制。
- **两种仿冒 UA 的区别（写进 S-318 §3B.0 附）**：`qwen-coding` 仿 `claude-cli` 是过端点白名单（DashScope Coding Plan 本身是明码售卖给 CLI/IDE 的产品，API Key 用户自建）⇒ 正常接入；WorkBuddy 这类仿 UA 是**骗过「只给官方客户端签 token」的授权流程** ⇒ 绕开产品授权。**差别在通道是否对外，不在 UA，也不在额度归属。**
- **判据的代码特征因此仍是 `authMode: 'oauth'` + `requiresApiKey: false`** —— OAuth 正是「客户端内置授权通道」的实现形式，结论不变（还是这 5 个）。
- **15:19 老大补边界：「318 正常通过apikey请求的不删哈」。** 15:20 按 `export const xxxPreset` 切块扫全部 48 个 builtin preset（`authMode` / `requiresApiKey` / `userAgent` / `serverPollOAuth` / `defaultBaseUrl`），确认**只有 5 个**同时命中，与登记一致：`workbuddy` / `workbuddy-ai` / `codex-oauth` / `copilot-oauth` / `moonshot-coding`。**其余 43 个走用户自己的 API Key，一个字段都不改。**
- **15:23 老大纠正判据表述：「ua冒名很正常，有些服务商限定了只允许哪些cli调用」。** UA 仿客户端是厂商端点白名单下的正常接入手段，**不是合规指标**。`qwen-coding` 仿 `claude-cli` ⇒ 保留不动。
- **扫描顺带堵住两个误删口子**：① `ollama` / `lmstudio` 也是 `requiresApiKey: false`，但走 localhost、无冒充 ⇒ **别只看这一个字段就开删** ② `qwen-coding` / `minimax-coding` / `baidu-coding` / `bigmodel-coding` / `xiaomi-coding` / `stepfun-plan` 打的是厂商 coding / plan 端点，看着像「套餐」，实际凭用户自己的 Key ⇒ 留。
- **顺带订正 S-318 §3B.2 的原判**：原文写「`lib/auth/` 不能整目录删，宠物和翻译在用多账号轮转」⇒ 15:21 全仓 grep 复核，`lib/auth` 之外的 import 只有 5 条，全部落在 S-321 死代码（`translate-store` + `lib/pet` ×3）与 A 段整页删（`ProviderAuthPanel` ×3）里 ⇒ **该目录零 API Key 路径引用，刀 0 之后可整目录删**。原判是「看 import 就下结论」的又一次翻版。
- **两边已漂移，禁止整文件覆盖**：私有仓从主仓全量搬出后，主仓仍有改动（S-284 等）。S-322 的每条改动都必须按需求单 §三 的实读行号逐点改 —— `ProviderContentHelpers.cs` 私有仓已到 479 行以上，主仓结构未必一致。
- **顺手记一条异常信号**：`2026-11-05.log` 里出现 `role=main type=wishful-claw-shell.exe`，那是私有仓 Tauri 壳的 T-044 bug（dev 壳读到正式库）污染进来的。**主仓日志里出现非 `wishful-claw.exe` 的 `role=main` 可以当异常信号用。**
- **内存三条全部落地（刀 6 → 7 → 8，`ebfdad75` / `48223ea5` / `11994318`），刀序按登记时的「最安全先做」执行完毕。**
- **刀 6 = S-324**：`ProviderContentHelpers` 加 `StripDataUrlPrefixSpan`（零分配 span 版），`DetectImageMediaTypeFromBase64` 与 `ImageFileProbe.HasCompleteContainerInBase64` 不再整串复制 + 双次 `Replace`。判据逐字不变，`ImageMediaGateRegressionTests` 扩到 53 条（新增 15 条 span/string 逐字节比对）。
- **刀 7 = S-323**：新增 `RequestDebugBodyTrimmer` —— **不做字符串截断**（截断会把 JSON 变非法，调试面板 `JSON.parse` 直接失败，等于用「看不见」换「不卡」），改结构化裁剪：解析 → 超长字符串值换占位 → 重新序列化。阈值全部对齐渲染层自身上限而非拍脑袋：body ≤ 8 KB 不裁（= `MAX_PERSISTED_DEBUG_BODY_CHARS`）、单值 ≤ 1,024 字符、数组 ≤ 64 项、非法 JSON 退回硬截断。实测 **11,983,135 → 2,695 字符，24 ms**，与需求单里记的渲染层驻留量 2,695 一字不差。三个 provider 全接入，**只改 `DebugInfo` 入参，实际 HTTP 请求仍用原 body**。
- **刀 8 = S-322（治根那一条）**：`SessionConversation` 记最后访问时刻（单调 `TickCount64`，系统时间校正与休眠唤醒都骗不过它），`GetOrCreate` / `TryGet` 都 `Touch()` 后跑两条闸 —— 闲置 2h 淘汰 + 常驻上限 8 条按最久未访问砍。触发本轮 `GetOrCreate` 的 key 永不作废。淘汰只是移除引用，下次取会话得到空会话，正好命中 `AgentLoop` 已有的「`MessageCount == 0` ⇒ 从 DB 懒恢复」，所以淘汰本身是安全的。淘汰打 `WorkerLog.Info`（`reason=idle|capacity` + `idleMinutes` + `messages` + `resident` + `key`），真机验收直接看日志。
- **一处刻意的取舍**：`TryGet` 也 `Touch()`。否则「用得很频繁但只走 `TryGet`」的会话会一直显得闲置，被砍在调用方脚下 —— 这种 bug 只在埋点日志里看得出来，写进回归里钉住。
- **一处没做的复杂度**：容量淘汰理论上会误伤「正在跑、但本轮之后已有 8 个会话被访问」的会话。桌面场景并发活跃会话数远低于 8，因此**不引入租约计数**（那要改 `AgentLoop` 等全部调用点）；风险与前提写在提交信息里，真出问题再补。
- **门禁基线（本迭代最新）**：`npm run typecheck` 三配置 0 错；`npm test` **127/127**（新增 RequestDebugTrim 24 断言 + SessionEviction 18 断言）；`dotnet build` runtime sln 0 错 2 警告（仅 NU1903 ILCompiler，已挂账 S-320）、tests sln 0 警告 0 错误。
- **欠账**：S-322 验收 #1 的「`managed` 必须回落」是运行时行为，只能真机看 —— 留给 dev 实例实测，代码侧断言只能证明「淘汰确实发生、重建确实为空」。

## 2026-11-05 16:40 · 分层体检登记（老大「先登记」）

- **只登记，未动一行代码。** 新开三条：**S-325 / S-326 / S-327**，均已写需求单，已挂进 `plan.md` §二·补 与 `raw-requirements.md` §五。
- **体检结论先说好的那半**：七层**依赖方向零违规**。`src/runtime` 七个子项目的 `ProjectReference` 矩阵里没有一条逆向依赖 —— `Agent` 不引 `Worker`、`Workspace` 不引 `Persona`、`Core` 只引 `Contracts`。违规全部落在「层内该放什么」和「章程过期」两类，一条都不是接线接错了。
- **S-325 是事实性错误，不需要裁定**：`WishfulClaw.CodeGraph` 早在 S-303 就剥离成独立仓 + MCP 插件了，但 `AGENTS.md:25`、`docs/project-structure.md:30-31`、`:56` 三处还当它是 vendored 项目写。这两份文档是「东西在哪」的索引 —— 照它去找一个不存在的目录，白花时间之后会开始怀疑整份文档。**顺带两条零风险清理**：`AGENTS.md:81` 的 Agent 依赖清单漏 `Workspace`（9 个文件实际 `using WishfulClaw.Workspace.Memory`，靠 `Persona → Workspace` 传递才编过；按方向图这条边**合法**，但隐式传递有实害 —— Persona 哪天不引 Workspace，Agent 会莫名其妙编不过，而改 Persona 的人不会想到会连坐）；`Infrastructure/Memory/` 和 `Agent/tmp/agent-verify-*` 是空目录残留。
- **⚠️ S-325 里专门标了一条防误删**：`src/main/lib/codegraph-assets.ts`、`src/main/ipc/codegraph-handlers.ts` 里那些 `CodeGraph` 字样**不是残留**，是 S-303 剥离后的正常形态（插件资产按需下载引擎与语言包）。改章程时容易顺手把它们也清了。
- **S-326 是裁定项，不能自己拍**：两处章程与实现正面冲突。**A1** `AGENTS.md:92` 写 Worker「只保留进程入口与模块注册，其余已迁入 Agent/Infrastructure」，实际 `MemoryModule` 两文件 512 行是真实现（文件读取 + SQLite 分页 + 业务常量 500，注释里还写着这个 500 是因为渲染层同步窗口 —— 已经业务耦合了）；而 `docs/project-structure.md:51` 同一件事写的是「注册**与实现**」，**两份文档互相打架**。**A2** `AGENTS.md:56` 把 33 个 `Db*Tools` 算作 Infrastructure 职责，`:59` 又说这层的目的是「使 Tools / Modules 能迁出到 Agent 层」—— 同一节自相矛盾，所以它既没迁也没人说不该在这。
- **S-326 我的判断是选 A（改章程）**，理由不是「不想搬」：`Db*Tools` 那 8,204 行与 Entity / Schema 强耦合，搬进 Agent 会让 Agent 从「依赖 Infrastructure 的抽象」退化成「直接压在 33 个具体类和表结构上」——**耦合是加深，不是减弱**。真正该做的是把判据写清楚：**与 schema 强耦合 ⇒ 留 Infrastructure；纯业务语义、只经抽象访问 ⇒ 放 Agent**。有了判据，以后新加表工具至少有人能问一句「这个是不是该放 Agent」。
- **S-327 值得真动，但必须独立迭代**：Agent 根目录平铺 140 个 `.cs`，`AGENTS.md:54` 只承认 6 类，而 `AgentRuntime*` 执行器 52 个 + 其它杂项 17 个（共 49%）它完全没提。最要命的是命名高度相似 —— `TaskExecutor` / `TaskExecutor.Codec` / `TaskExecutor.Db`、`GoalExecutor.Mutation` / `GoalExecutorJson` / `GoalOrchestratorModels` 散在四处，每次改这块都要在一屏 140 个文件里按前缀扫。
- **⚠️ S-327 里钉了一个踩过的坑**：模型 Provider 的新目录**不能叫 `Providers/`** —— `Agent/Tools/Providers/` 已经存在（25 个**工具提供者**：AskUser / Browser / Cron / Desktop / Ssh / Web / Widget…），`docs/project-structure.md:56` 专门写过一句「⚠️ 别混」，说明这坑踩过一次。建议叫 `Llm/`。
- **为什么不塞本迭代**：140 个文件改 `namespace` 会污染 `git blame`，跟刀 6~8 的内存修复混在一个迭代里，出问题时无法判断是哪一刀引入的。结构重构应当是独立迭代的唯一主题，崩了能整体回滚。
- **顺手修的排版瑕疵**：`plan.md` 的刀 6~8 三行原先被两个引用块打断在表头之外，GFM 渲染时会把「刀」那一行当成新表格的表头 ⇒ 补了一次表头。改的是渲染结果，不动语义。

## 2026-11-06

- **09:0x 老大「328 你要是觉得过于复杂了，可以拆分成多个需求」** ⇒ S-328（Agent 层手写 SQL）拆成六个独立编号：**S-333（projects）/ S-334（goal_* 三表）/ S-335（sub_agent_runs）/ S-337（sessions）/ S-338（messages）+ 收尾 S-336（判据落章程 + 端点薄化）**，刀序 23~29。刀 23 用最小的 `sub_agent_runs`（3 处）立样板，后面五个照抄 —— 反过来的话样板会长出五样。
- **拆分时连带纠了三处口径错，都是我自己登记时的**：① S-328 登记报「7 张表 12 处 / 5 文件」，实测 **9 张表 30 处 / 9 文件**（漏了 `projects` 和 `messages`）；② 第一次机器扫用的是不区分大小写的 `-match`，把 `multi-select questions` 当成命中 —— **PowerShell 的 `-match` 默认不区分大小写，核代码必须 `-cmatch` 或 `Select-String -CaseSensitive`**；③ S-329 登记报「12 个超 500 行无标记」，实测 **6 个**，因为扫描只认中文写法，漏了三个大文件里的英文 `500-line exemption`。
- **教训**：审计类登记的「数字」必须是可以复跑出来的命令结果，不能是眼看的印象。这一轮三处错全是「扫了一半就下结论」。
- **刀 20~22 全部作废**（原计划真拆三个超大文件）。复核后三个豁免**全部成立**：`ContextCompression`（1120 行，管线不变量 + 叶子已拆）、`AgentLoop`（931，步骤间是顺序不是接口 + 已拆 6 个 partial）、`ToolDispatchRouter`（635，分支顺序即路由契约）。三者都是 `AGENTS.md:193`「拆得动但代价显著大于收益」的原型 —— 继续拆只剩「顺序骨架」，那正是最不该拆的部分。**留这条记录是为了下次别再把它当欠账捡起来。**
- **刀 23~29 全部落地**（`0938f296` / `b1e96a3e` / `7b989c9f` / `17fa7b1f` / `6c384423` / `c6ae3c14` / `5a42b176`）。**全 Agent 层 SQL 字面量归零**（9 张表 30 处清完），判据写进 `AGENTS.md` §6 并附可机器复核的命令。S-336 明写了**未薄化的 12 个 `Db*Tools` 文件** —— §3.3 允许分批，停了要登记剩余项，不是遗漏。
- **S-336 里三处「有意不合并」都写了注释**：`tasks.Update` 按 id 查而 `DbTaskStore.GetById` 强制带 session 过滤（合并等于拆掉 S-328 立的防线）；`plans.List` 是全表列表、Store 无对应语义；`plans.Update` 含正文而 `UpdateStatus` 刻意只改 title+status（全行更新会覆盖库里正文）。
- **09:5x 欠账普查（老大「再找找还有没有欠账」）⇒ 登记 S-339 ~ S-344 六条**，全量只读扫 `src` / `tests` / `docs` / `website`。复核通过**不算欠账**的四项：超 500 行无标记 0、renderer `console.log`/`debugger` 0、Agent 层 SQL 0、iter-v3-8 文档失效路径 0。
- **10:1x 老大纠正归属：「都归属本迭代哦，本迭代是昨天下午才剥离的。你怎么老是想让我开下一个迭代呀」** ⇒ 原议「下迭代」的四条全部提前，刀 30~35 六条今天全做完。
- **这条纠正值得记**：我不是在省事，是在**用「下迭代」给自己留退路**。迭代才开一天，登记时把四条不属于本迭代主题的杂项推出去看着合理，实际是让欠账在文档里过夜。**主题是给判断优先级用的，不是给推迟找借口的。**
- **刀 30 = S-339**（`78663ed2`）：`git rm` 掉与 `ErrorBoundary.tsx` 大小写重名的零引用文件。两份同名文件同在 git 索引，NTFS 上能共存，**ext4/APFS 检出直接冲突** —— 一分钟的活，拖着就是跨平台隐患。
- **刀 31 = S-343**（纯文档）：`iter-v3-1/plan-s224/review_report.md` 后半 3,928 B 按 CP936 重解。**切分点是 18726 不是 18725** —— 单据里那个数字来自 .NET 异常消息，报的是 UTF-16 码元位置而非字节偏移。**查编码一律用 `UTF8Encoding($false,$true)` 严格解码**，不看 `Get-Content` 的肉眼输出（正常中文段也会显示成问号，那是显示层假象，很容易误判成「整份乱码不可恢复」）。
- **刀 32 = S-344**（`e63b01af`）：主进程 58 处 `console.log` 改走 `logInfo`/`logDebug`。`index.ts:172` **有意保留** —— 那是 renderer `console-message` 的透传桥，改掉会丢来源标签，落盘由紧邻的 `logWarn` 负责。`native-worker` 的 `exited` 原本 `console.log` + `logInfo` 双写，去掉重复那半。
- **刀 33 = S-341**（`096a94f0`）：删 `ProjectTerminalDock` 空壳 + 两处 `terminalDockOpen = false` 死分支。删前核实过「不是功能缺失」—— 开关是常量、按钮都不存在，用户不可能「点了没反应」。
- **刀 34 = S-340**（五刀：`01f9e304` / `ece70216` / `5731c636` / `a941c9e2` / `7f9093ec`）：死代码 **实测净减 2,346 行**（登记写 2,460 是高估）。一组一刀、每组单跑 typecheck。**组 C 的判断是非平凡的**：`agent-history-store.ts` 里函数看着像活的，核实后确认 `agent-history:*` 通道已由 `worker-forward-handlers.ts` 转发给 C# worker（`DbSubAgentTools` 读 `subAgentHistory` 表），这份文件存储是旧实现 ⇒ 才敢删。
- **判据要记死**：判断文件能不能删，是看「调用链顶端有没有 UI 或主进程入口」，**不是看有没有 import**。这条是 S-321 踩出来的，S-340 全程照它执行。
- **刀 35 = S-342**（`6b501efb`）：两个空壳**处置方向相反**。`selectSessionScopedAgentState` 补真实现（`hasOrchestrationData` 恒 `false` 会让「只有 sub-agent、没有 team」的会话编排时间轴永不渲染，是真 bug；`SubAgentCard` 因为自带四级 `??` 回落所以卡片一直正常，正因如此没人发现）；`clearSessionPromptSnapshot` + 类型 + 16 处调用**全删**（store 里根本没有 `promptSnapshot` 字段，类型注释自己写着「placeholder, 迭代七完善」，从没实现过）。
- **S-342 的技术硬点**：zustand 选择器用 `Object.is` 比对返回值，**每次返新对象会让订阅方无限重渲染**。实现里按 `sessionId` 缓存，key 含「三张表的源引用 + 工具调用 buckets 引用 + 运行状态」，任一变化才重建。会话数上限 32，超了整表清空。
- **门禁（刀 23~35 全过后实跑）**：`npm run typecheck` 三配置 **0 错**；`npm test` **127/127**；`npm run build` 通过；`dotnet build` runtime sln `-t:Rebuild` **2 警告（均 NU1903，S-320 挂账）/ 0 错误**、tests sln **0/0**。
- **21:0x dev 实例测试 + 审查上报五条 ⇒ 登记 S-348 ~ S-350 三条**（刀 39~41），逐条核实**全部属实**。按「文件不重叠 + 回滚边界独立」归并 —— dev 的第 3 条与第 5 条本是同一件事的两面。
- **S-348 的转述没点到病根，我改了处置方向**。dev 说「`buildSummary` 8 个分支缺 1 个」，属实；但病根是末行 `return name` 这个**兜底本身** —— `BrowserToolCard.tsx:105` 是 `primary: summary || title`，只要兜底返回非空就短路，补第 8 个分支只能挡住 `BrowserSetDevice` 这一个工具。**S-270 修过同一个病的另一侧**（`title` 的 `fallbackTitle` 末行 `return name`，注释还留在 `:86` 解释这件事），当时没顺手把 `buildSummary` 这侧一起收了。所以刀 39 是把兜底改空串 + 加测试按 8 个工具常量逐个过，加第 9 个漏分支直接红。
- **S-350 的「零引用死导出」我没删，改成「用起来」**。dev 建议删 `resetSessionScopedAgentStateCache`，而它的注释原本就写着「仅供测试与诊断」—— 同一单里又要补这个文件的测试，补了它就兑现了，删了下次写测试还得补回来。
- **刀 39 = S-348**（`095352ce`）：兜底改空串 + `BROWSER_CLICK` 末位 `|| name` → `|| ''` + 补 `BROWSER_SET_DEVICE_TOOL_NAME` 的摘要与字段分支 + i18n 中英各 4 键 + 新增 `tests/browser-summary-fallback` 8 条。
- **刀 40 = S-349**（`29be0c97`）：两处「选择器还是桩」的假注释改写，**代码一行未动**（`git diff -U0` 确认 6 增 2 删全为注释）。当时的推论「这两处代码不依赖它所以不用动」是对的，**但推不出「注释也不用动」** —— 注释写的前提（它是桩）没了，注释就是假话。
- **刀 41 = S-350**（`a0bec68f`）：删 `_options` 假参数 + 4 处传参；新增 `tests/session-scoped-agent-state` 12 条。**假参数比没参数更坏** —— 后来人会照「传了 `coarse` 所以视图被裁剪、比较便宜」的假设去做优化。缓存测试是硬需求：zustand 用 `Object.is` 比对选择器返回值，守这条线的只有 6 个 `===`，之前 0 覆盖。每个用例都从 `fresh()` 起手，避免模块级单例缓存串味导致假通过。
- **门禁（刀 39~41 全过后实跑）**：`npm run typecheck` 三配置 **0 错**；`npm test` **129/129**（127 → 128 → 129，两刀各加一组）；全仓 `mode: 'coarse'` **0 处**、`is still a stub` **0 处**。

## 2026-11-06 · 补记 08:3x 那批与刀 36~38（本条为事后对账补写）

> 上面 2026-11-06 段只记了有裁定的那几笔，08:3x 的三条纯执行和刀 36~38 漏记了。补在此处，不回溯改写原文。

- **08:3x 三条纯执行**（`c471d849` 08:32 / `afdc8335` 08:37 / 08:40）：**S-332** renderer 层 `console.log` 归零（8 处 / 6 文件，+3 −22）；**S-330** 删四具遗骸 + 拔掉 `RuntimeStatusPanel` 这个用户能点开、点开一片英文的空壳（8 文件，+10 −94）；**S-331** 纯文档订正 4 处失效路径（`S-322.md:59` / `S-324.md:20` 等，两处是 S-327 搬迁的副作用），**按提交纪律攒着未单独提交**，与其它非代码改动一起进收尾——同批还自纠一处：`S-324.md:20` 写的 `:44-49` 是登记时行号，S-324 自己加的注释把方法顶到了 `:50`。
- **刀 36 = S-345**（`6da8fe02`）：`isBrowserToolName` 是**恒假桩**（`return false` 的空壳），三处下游（浏览器图卡 / `BrowserToolCard` / 时间轴 `browser` 分类）全部静默失效。改 `Set` + `has`。**这是「接口在、调用方在、实现是空的」这个病的第三次**（前两次 S-342 两个空壳），判据同一条：**有 import、有调用点，都不等于有行为**。
- **刀 37 = S-346**（`389bf5c0`）：图片生成的重试按钮**点了没反应**，`resolveImageGenerateRetry` 是恒 `null` 空实现。**处置从「修」翻成「全删」** —— 核实 C# 侧 `awaiting_retry` 零命中、`AgentRuntimeImageGenerateExecutor.cs` 是一次性 reverse-request，**压根没有「分批 + 第 N 张失败 + 等用户确认」这个概念**，所以不是实现缺失，是 UI 在等一个后端永远不会产出的状态。删按钮 + 前后端全链路（−130 行），不是补一个能点的按钮。
- **刀 38 = S-347**（`43b4e656`）：S-340 漏网的一批 —— `teams/team-native-control.ts` 整文件、`ChannelPanel` / `createPlanModeInlineToolHandlers` 两个死导出、`right-panel-tab-factories.ts` 五行空行残留，净减 33 行。**漏的原因是 S-340 用 basename 扫引用，而这三处的引用形态（动态注册表、`PluginPanel` 内联分支）没被那一版正则覆盖** ⇒ 扫死代码的脚本本身也要复核，不能一次跑完就当清零。

## 2026-11-09 · 文档普查收口（三条待裁定全部落地）

- **背景**：11-08 全量文档普查留下三条「待裁定」，11-09 08:40 逐条结清。老大口径：「空占位需要问我才能处理？目前还没有开新迭代的都在本迭代处理」——**我原本把 `scopeFilter` 写成「挂账到下个迭代」是错的**，本迭代还开着就不该往后续迭代推。
- **样式文件整类豁免（章程新增第 9 条）**：老大原话「样式不用强拆，这种豁免就行，我定义 500 行的目的是为了减轻 agent 读代码的压力，而不是单纯为了 500 行拆而拆」。`AGENTS.md` §大文件拆分 新增第 9 条 —— `.css` / `.scss` / `.less` 整类豁免、不逐条论证、审查不判 ❌；与第 8 条 locale JSON 的区别是**样式支持注释，仍要留一行标记**（否则下一轮又被当新发现）。全仓只有 `assets/main.css` 一个样式文件超线，头注释已补。
- **连带订正 `docs/design-system.md` 21 处行号**：给 `main.css` 加 2 行头注释会把后面所有行号顶掉，`design-system.md` 里 21 处 `main.css:NNN` 全部 +2。逐处抽查过 `--app-font-size` / `--app-font-family` / `--tree-row-height` / `scrollbar 5px` / composer 三档圆角 / `focus-within` 描边+阴影，都精确落在对应规则上。**这类「加注释顶行号」的副作用以后要连带检查引用方。**
- **删 `ui-store` 两个空占位**：`applyRouteFromLocation` / `applyChatRouteFromLocation`，实现 2 处（`ui-store.ts:524-529`）+ 接口声明 2 行（`ui-store-interface.ts:286-287`）。删前全仓复扫（含 `tests`）确认**只有声明和实现，零调用点**。与 S-340 / S-341 同类 —— 那两轮扫的是「文件级死代码」，漏了「store 里的方法级空壳」。
- **`MemoryFtsService.scopeFilter` 参数化**：`$" AND scope = '{EscapeSql(scope)}'"` → `" AND scope = @scope"` + `new SqliteParameter("@scope", scope)`，与 `DbMemoryTools.BuildScopeClause` 同构；`EscapeSql` 随之零引用、已删。FTS / LIKE 两条通道共用同一批参数实例（**两段互斥执行，前者的 reader 进入后者前已 `Dispose`**，这是复用安全的前提）。**补回归**：`MemoryRecallRegressionTests.RunTimeFilterSuite` 加一条「含撇号的 `scope`（`o'brien`）不炸且筛空」—— 拼串时代这条靠 `EscapeSql` 兜，现在靠参数兜，正是这次改动的原始动机。
- **门禁（三条全过后实跑）**：`npm run typecheck` 三配置 **0 错**；`npm test` **129/129**；`MemoryRecallRegressionTests` **78/78**（77 → 78）；`dotnet build` runtime sln `-t:Rebuild` **2 警告（均 NU1903，S-320 挂账）/ 0 错误**、tests sln **0/0**；`npx electron-vite build` 通过（验证 `@import` 前加注释不影响 Tailwind v4）。

## 2026-11-09 · 指导文档三处口径订正（承接上一条普查）

> 上一条把「三条待裁定」结了；本条记的是同一轮里**复核指导文档时查出来的三处口径不一致**，全部只改文档、零代码。

- **豁免标记「中英两种写法都认」进章程**：全仓复扫 61 个超 500 行文件，58 个有标记、3 个被判「无标记」——**实为英文写法**（`AgentLoop.cs` 932 行 / `ToolDispatchRouter.cs` 636 行 / `ContextCompression.cs` 1121 行，标记是 `// 500-line exemption (…)`）。三文件理由经复核**成立**（S-329 §三已裁定「豁免成立、不该拆」）。**过程中自纠一次**：我先把三个英文标记迁成中文，随即 `git checkout --` 撤回 —— 违背 S-329 §4.2 既有裁定「改注释会污染 `git blame`，不强制迁移」。正解写进 `AGENTS.md` 第 5 条：①中英两种写法都认，复扫必须两种都扫；②英文**不强制迁移**；③**标记必须落在文件头前 25 行内**，写在中间等于没有。`S-329.md` §4.3 由「一个建议」改为 ✅ 已落地。
- **`manual-acceptance.md` 刀数口径订正**：原文写「本迭代落地 刀 0 ~ 刀 41」，读起来像 42 刀全落地。实际**刀 20~22 作废**（原计划真拆三个超大文件，复核后豁免全部成立）。改为「42 个编号，20~22 作废，**实落 39 刀**」，与 `plan.md` §五 的「39 刀收口成一份」对齐。**两个数字必须一致，否则验收清单和发布记录各说一套。**
- **`roadmap-post-1.0.md` 一处行号漂移 + 一条结论已失效**：`requiresDownload` 那条原写「声明于 `types.ts:61`、唯一消费点 `AppPluginPanel.tsx:174`、零下载实现」。实核 —— 声明在 **71**、codegraph 已改 `true`（**132**）、消费点搬到 **`meta.tsx:109`**，**这条缺口早被「插件资产按需下载」兑现了**。按「历史登记不改写」处理：保留原结论，后缀 **2026-11-09 订正**注记。同文件另外两处反引号路径（`src/main/index.ts:137`、`app-plugin/types.ts:39`）实测**行号完全对得上**，未动。
- **复核后不改的两处（结论要记下来，避免下轮又翻一遍）**：①`in-app-update-plan.md` 正文 20 余处 `src/` 路径指向 `0.2.23` 时点的计划位置，多处已不存在 —— 但**这是历史实施计划，不是现状索引**，头部横幅已写明「要查实现在代码里查，别拿这份当索引」。**把历史计划改成现状路径等于歪曲当时的方案**，故正文不动。②同文件与 `roadmap-post-1.0.md` 的 `src/Astra.Clients/Adapters/WorkBuddyClientAdapter.cs`、`src/credential.ts` 等是**外部仓库**（Astra-Gate / waygate-qoder）的路径，不是本仓欠账。
- **v2 代际旧口径零残留**：全文检索 `v2-iter-3x` / `v2-iter-40`，命中全部落在**历史档案**（`docs/progress/*`、各 `iter-v2-*` 的 plan / raw-requirements / S-xxx 单据）；指导文档里唯一一处是 `release-workflow.md:69` 的代际映射说明，口径正确（`v3-iter-1` ↔ `1.0.1`，`v1.0.0` = v2 末版）。
- **`plan.md` 刀序表复核完整**：0 ~ 41 全在表内（36~41 写成 `| ✅ **N** |` 形状，第一版扫描正则漏配，误以为缺号）。**20~22 是作废行，不是缺号。**
- **写文档的一条教训**：用 PowerShell 双引号 here-string 写 Markdown 时，反引号是转义字符 —— `` `r `` / `` `v `` / `` `t `` 会变成 CR / VT / TAB，把整段代码标记写坏。**含反引号的文档内容一律走编辑工具写，不走 here-string。**

## 2026-11-09 · S-351 浏览器截图重开会话后只剩原文 JSON

> 老大下午测试前先报的一条：`BrowserScreenshot` 的卡片「页面看不到预览图，卡片点开是一坨 JSON」。

- **根因是一句话 `Array.isArray(output)`**：库里 `message_parts` 的 `tool_use.output` 是 **JSON 字符串**（后端 DTO 的 `output` 是 `string`，块数组被 stringify 进库），实时链路里却是**内联数组**。卡片一律只认数组 ⇒ 同一张截图「执行中有预览、重开会话后只剩原文 JSON」。**这不是新病，是 S-294 修了四分之一** —— 当年只修桌面 / 窗口截图（`splitDesktopToolBlocks` 自己 decode），浏览器截图卡 `BrowserToolCard.tsx:64`、图片插件卡 `ImagePluginToolCard.tsx:104`、通用 `text-output.tsx:27` 三条全漏着。
- **没有逐张卡片补 decode。** 那样每加一张卡就得再抄一遍判据，就是这次漏掉三条的原因。改在渲染态**统一出口** `buildToolCallRenderState` 归一，四个 `tool-block-renderer.tsx` 调用点共用 —— 历史与实时两条来源一起覆盖。
- **判据刻意收窄到「解出来是数组且含 `image` 块」**：`[1,2,3]` 这种普通文本输出恰好是合法 JSON 数组，无脑当块数组会让卡片把原文藏起来、变成一张空白卡 —— 那比原来的 JSON 更难查。收窄到含图既够用又不可误伤。
- **不修落库、不修后端 DTO**：`output` 变 `object` 要动 wire 格式（模型请求侧同用这份数据），而且库里已有的老数据仍是字符串，照样得在读取侧兜 —— 两处都要改一处的活，只做一处不成立。
- **回归防线 `tests/tool-output-revive` 17 条**：内联数组同引用直过 / 含图 JSON 字符串解回数组且 `filePath` 带出 / 无图字符串原样返回（这是防误伤的那条）/ 坏 JSON 与 TOON 文本不抛 / 解码器失效时不得凭空出图。
- **解码器走参数注入**，理由同 `desktop-tool-blocks.ts` 头部注释：`tool-result-format` 顶部 import 了 zustand 的 settings-store，直接拖进纯函数会让 node 里跑不了回归。