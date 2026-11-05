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
