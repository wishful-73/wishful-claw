# Wishful Claw - Agents 指南

本文档供 AI 编程助手阅读，帮助理解项目结构和开发约定。

## 项目概述

Wishful Claw 是一个 Agent 编程软件，参考四个开源项目：

- **OpenCowork** —— Agent Loop、工具链、Provider、流式协议。以该项目为基底迁移代码，经过拆分、适配和命名空间重组后纳入 WishfulClaw 架构。
- **KodaClaw** —— 记忆系统、人格系统、PromptBuilder。借鉴设计思路，代码自行实现。
- **OpenClaw.net** —— 记忆主动回忆、记忆工具、上下文预算。借鉴设计思路，代码自行实现。
- **DeepSeek-Reasonix** —— 缓存命中率统计、工具注册发现、工具注入体系（ToolDiscovery/InjectionStrategy）。借鉴设计思路，代码自行实现。
- **OpenAI Codex** —— Goal 模式状态机（plan → execute → verify → continue/adjust）、自检评估机制。借鉴设计思路，代码自行实现。

OpenCowork 的代码经迁移和重构后已成为 WishfulClaw 的一部分；其余四个项目主要借鉴设计思路和架构理念，代码由 WishfulClaw 自行实现。

## 技术栈

- **前端**：TypeScript + React 19 + Electron 35
- **后端**：C# + .NET 11（preview SDK 11.0.100-preview.7；本机便携版位于 `D:\claw\dotnet-sdk`，构建/启动 Debug Worker 时需设 `DOTNET_ROOT` 指向它；打包产物为 AOT self-contained，不依赖运行时）
- **通信**：IPC + MessagePack

## 项目结构（7 层架构）

7 个项目已落地（Contracts / Core / Infrastructure / Workspace / Persona / Agent / Worker）；另有 `src/runtime/WishfulClaw.CodeGraph` vendored 项目（不参与 7 层依赖链，仅被 Worker 引用）。

- **目录地图**（哪层有哪些子目录、东西在哪）：[`docs/project-structure.md`](docs/project-structure.md)。那份文档**只写到「层 → 子目录 → 一句话职责」**，不列文件名与文件数 —— 统计写死必然过期，要看实际结构直接查代码树，别在这里再抄一份
- **依赖规则与各层职责禁忌**（什么能依赖什么、该放什么）：见下面「分层约定」

## 分层约定

### 1. Contracts 层（WishfulClaw.Contracts）

纯接口和数据契约，无实现。

- **不依赖**任何其他项目
- 被 Core / Infrastructure / Workspace / Persona / Agent / Worker 共同引用
- 保持轻量，不放业务逻辑

### 2. Core 层（WishfulClaw.Core）

Agent 通用框架，不含任何业务逻辑。

- **依赖** Contracts
- **不依赖** Infrastructure / Workspace / Persona / Agent / Worker
- 包含：Protocol（MessagePack 通信）、Tools（工具框架基类）
- 定义接口在 Contracts 中，由 Infrastructure / Agent / Worker 实现

### 3. Infrastructure 层（WishfulClaw.Infrastructure）

基础设施层，提供数据库、配置存储、HTTP 客户端等通用能力。

- **依赖** Contracts + Core
- **不依赖** Workspace / Persona / Agent / Worker
- 包含：
  - **Db**：DbClient + Entities + Db*Tools — SQLite 持久化
  - **Storage**：ConfigStore + ProviderStore + JsonFileNodeCache — JSON 配置文件读写
  - **Http**：WorkerHttpClientFactory — HTTP 客户端工厂
- 目的：解耦 Worker 对基础设施的直接依赖，使 Tools / Modules 能迁出到 Agent 层

### 4. Workspace 层（WishfulClaw.Workspace）

记忆系统业务层。

- **依赖** Contracts + Infrastructure
- **不依赖** Persona / Agent / Worker
- 包含：Memory（读写/检索/分层流转/巩固/语义降级/FTS5）

### 5. Persona 层（WishfulClaw.Persona）

人格系统。

- **依赖** Contracts + Core + Infrastructure + Workspace
- **不依赖** Agent / Worker
- 包含：PromptBuilder / PersonaGenerator / PersonaStore / PersonaPresetService

### 6. Agent 层（WishfulClaw.Agent）

Agent 运行时核心业务逻辑。

- **依赖** Contracts + Core + Infrastructure + Persona
- **不依赖** Worker
- 包含：AgentLoop / Provider 实现 / 工具执行器 / 上下文压缩 / SubAgent / SessionConversation / Tools（FileTools / SearchTools / ShellTools / MemoryTools / Providers / AgentChanges）

### 7. Worker 层（WishfulClaw.Worker）

进程入口，薄层 IPC 宿主。

- **依赖** Agent + Persona + Workspace + Core + Contracts + Infrastructure
- 负责模块注册、依赖注入、进程生命周期
- 被 Electron Main 进程拉起
- 只保留进程入口与模块注册（Program / WorkerHost / WorkerModuleCatalog），其余已迁入 Agent / Infrastructure

### 依赖方向（严格单向）

```
Contracts
  ↑
Core
  ↑
Infrastructure
  ↑
Workspace
  ↑
Persona
  ↑
Agent
  ↑
Worker
```

> 禁止逆向依赖。下层项目不得引用上层项目。

## 核心设计原则

1. **分层严格分离**——各层通过 Contracts 中的接口交互，依赖方向严格自上而下
2. **Agent Runtime 和 Workspace 严格分离**——Agent 不直接操作记忆，通过工具调用读写
3. **记忆必须被用上**——不靠 System Prompt 全量塞入，Agent 通过工具主动检索读取和实时写入
4. **人格在输出时体现**——不介入 Agent Loop 决策，只在最终输出给用户时加工
5. **工具 Executor 模式**——每个工具自注册、自包含，加工具只需新建一个 Executor 文件
6. **Infrastructure 下沉**——Db/Storage/Http 等通用能力下沉到独立层，Worker 保持薄层

## 参考源码

> 以下是 WishfulClaw 的设计思路来源。OpenCowork 的代码经迁移和重构后纳入 WishfulClaw 架构（迁移文件头部均保留原始版权声明），其余项目主要借鉴设计思路，代码由 WishfulClaw 自行实现。

| 项目 | 仓库地址 | 参考内容 | 本地副本 |
|------|---------|---------|---------|
| OpenCowork | https://github.com/AIDotNet/OpenCowork | Agent Loop、工具链、Provider、流式协议（迁移+重构） | `D:\claw\OpenCowork` |
| KodaClaw | https://github.com/nekonaka/koda-claw | 记忆系统、人格系统、PromptBuilder（借鉴思路） | `D:\claw\koda-claw` |
| OpenClaw.net | https://github.com/nekonaka/openclaw.net | 记忆主动回忆、记忆工具、上下文预算（借鉴思路） | `D:\claw\openclaw.net` |
| DeepSeek-Reasonix | https://github.com/deepseek-ai/DeepSeek-Reasonix | 缓存命中率统计、工具注册发现、工具注入体系（借鉴思路） | `D:\claw\DeepSeek-Reasonix` |
| OpenAI Codex | https://github.com/openai/codex | Goal 模式状态机、自检评估机制（借鉴思路） | — |

## 开发约定

- C# 文件名使用 PascalCase
- TypeScript 文件名使用 kebab-case
- 接口前缀 `I`（C# 遵循 .NET 惯例）
- 新增模块时在 Worker/Modules 下注册
- 新增工具时实现工具基类并在对应 Module 中注册
- 记忆和人格的配置文件使用 Markdown 格式（.wishful-claw/ 目录下）

### 提示词写作

> 完整约定见 `docs/prompt-authoring.md`，此处只列必须记住的硬规则。

系统提示词**每一轮重发**，是 prompt cache 的前缀，所以每一行都在持续付费：

1. **提示词一律英文，注释一律中文**。唯一例外是被引用的用户可见字面量（语言名、人格说话示例、报错文案）。
2. **结构是分节的行为规则（`## 小节` + 一句可执行规则），不是自我介绍**。
3. **加一行之前先过四关**：① 说得出没有它模型会做错哪件具体事；② 形容词换成阈值或例子；
   ③ 能变成事实／工具描述／代码强制的，就不要写成规则；④ 对着真实的失败写。
4. **事实类陈述必须与运行行为一致**（操作系统、shell、路径）—— 假事实比不写更糟。
5. 提示词文本放在模板或常量里，不散落在执行逻辑的字符串拼接中。

### AOT 编译规范

> 项目使用 Native AOT 编译（`PublishAot=true`），AOT 编译禁用反射和动态代码生成。以下规范必须遵守：

1. **禁止 `Activator.CreateInstance` 反射创建实例**：改用 `new` 直接构造，或通过 `IToolProvider[]` 等显式列表注册
2. **禁止 `Assembly.GetTypes()` 等反射扫描**：改用显式类型列表或手动注册
3. **禁止匿名类型 JSON 序列化**：`new { ... }` 不能用于 `JsonSerializer.Serialize` 或 `WorkerResponse.Json`，必须使用具名 `record` 或 `class`
4. **`WorkerResponse.Json` 必须显式传 `JsonTypeInfo`**：`WorkerResponse.Json(value, SomeContext.Default.SomeType)`，不能依赖泛型推断
5. **所有 `JsonSerializer.Serialize`/`SerializeToElement` 调用必须使用已注册的 `JsonTypeInfo`**：新增的序列化类型必须添加到对应的 `JsonSerializerContext`（`WishfulClawJsonContext`/`AgentRuntimeJsonContext`/`InfrastructureJsonContext`）
6. **`JsonSerializerOptions` 必须通过 `WorkerJsonHelper.ConfigureAotResolver` 配置**：不能直接 `new JsonSerializerOptions()` 独立使用，必须继承 `WorkerJsonHelper.JsonOptions`
7. **禁止 `System.Reflection` 命名空间**：除非有明确且必要的理由（如读取自定义特性），否则不得使用反射 API
8. **新增 `JsonSerializerContext` 时必须注册所有序列化类型**：包括 `List<T>` 泛型版本（如 `[JsonSerializable(typeof(List<ProjectRow>))]`）
9. **`JsonArray.Add<T>(T)` 改用非泛型 `Add(JsonNode)`**：避免 IL3050/IL2026 AOT 警告
10. **新增 AOT 编译后，必须验证 `dotnet build` 0 错误 + `AOT 0 警告`**：在 `scripts/publish-aot-worker.mjs` 中编译验证

### 大文件拆分

1. 按职责拆分为多个文件，每个文件 200~500 行为宜
2. **超过 500 行必须拆分** —— 这是硬线，代码审查按此判 ❌
3. 拆分的目的是出问题时方便排查定位——按职责边界拆，让人一看文件名就知道该去哪找问题
4. C# 用 partial class，TypeScript 用 export/import 模块化
5. **只有以下三类可以超 500 行**，且必须在**文件头注释写明豁免理由与当前行数** —— 否则审查分不清「有意豁免」和「忘了拆」，一律按 ❌ 处理：
   - 单一数据对象（如 provider preset 列表、模型配置表）——内容是同质数据，拆了反而难查找
   - 高度内聚的 store / hook ——逻辑紧密耦合，拆开会割裂上下文
   - 拆分后需要大量 props 透传或 state 搬运的组件——拆出去增加了间接层，排查更难
6. 拆分后保持逻辑等价，不改变行为，只改组织结构

### 耦合文件拆分

1. **逻辑不相关的代码不放在同一个文件**：即使参考项目把它们放在一起，搬入时也要拆分到各自的文件中
2. **判断标准**：如果两个类/方法之间没有调用关系或数据依赖，只是参考方随手放在一起，就必须拆开
3. **拆分到正确的目录**：拆出来的文件放到 [`docs/project-structure.md`](docs/project-structure.md) 里对应的子目录

### AI 排查规范

> 以下规范针对 AI 编程助手排查问题时的操作流程，非人类开发者的代码规范。

大文件拆分后，相关逻辑分散在多个独立文件中（如 InputArea 拆出了 `use-input-area-effects.ts`、`use-input-area-selectors.ts` 等），AI 排查问题时应：

1. **先扫主文件，再扫周边**：找到主文件后，查看其所有 import 语句，逐一排查从其他文件引入的逻辑
2. **不要只盯着主文件**：拆分出去的独立文件可能包含关键副作用（如 `use-input-area-effects.ts` 中的 `useEffect`），这些 effect 在排查时容易被忽略
3. **关注 hooks/effects 文件名**：文件名包含 `effects`、`selectors`、`controls` 等字样的，通常是独立的行为逻辑，必须主动查看

### 迭代交付标准

每个迭代交付时，功能必须**完整可用**，不能是半成品：

- 有入口（能从导航/菜单进入）
- 有反馈（操作后有可见响应）
- 有闭环（功能流程走得通，不是断头路）
- 编译通过 + 能启动 + 核心流程能跑

## 编译验证

每次写完代码必须确保零报错：

- **C#**：`dotnet build`（可加 `-o` 临时输出路径避免文件锁定）
- **TypeScript**：`npm run typecheck` 零错误即可 —— 它 = `typecheck:node` + `typecheck:web`，两条命令都带 `-p` 与 `--composite false`（参数写在 `package.json` 里，不要手敲一套）
- **根 `tsconfig.json` 不要单独跑**：它是 references-only 壳（`"files": []` + `references`），对它执行 `tsc -p tsconfig.json` **不检查任何文件**，跑出来的"0 错误"是假的。真正检查内容的只有 `tsconfig.node.json` 与 `tsconfig.web.json`
- **不允许用 `@ts-ignore` 偷懒**（可选依赖除外）

## 协作纪律（硬规则）

Agent 的工作分两种状态，边界由老大的话决定，不由 agent 推断：

**讨论态**（触发特征：老大说"先聊聊 / 先分析 / 讨论 / 先确定再进文档"，或**开工前**在聊天中补充需求细节、报告问题）
- 允许：读代码、查资料、出分析和方案、给 diff 预览
- 禁止：Edit/Write 改代码文件、git commit
- 老大补充口径、修正细节 ≠ 拍板开工。"做不做"和"怎么做"都聊完、老大明确说"改吧 / 动手 / 按这个推进"，才切实施态
- 判断拿不准是讨论还是开工，按讨论处理，回复里问一句

**实施态**（触发特征：老大对方案明确拍板）
- 按 dev-workflow 六阶段执行，测通即提交的自动规则**只在实施态内生效**
- 实施中发现方案有误，停下来报告等拍板，不得边讨论边改
- 实施态内老大对**当前需求**补充口径、修正细节 ⇒ 照做，**不退回讨论态**（上一条说的是"补充细节不算开工"，不是"补充细节就停工"）；他给的是**新需求 / 新规则** ⇒ 先登记，按新需求另起一刀

> 背景：2026-09-13 R-10.2 讨论中，agent 把老大补充口径当成开工许可，未确认就改码并直接提交。防的是抢跑，不是效率——讨论态多问一句的成本，远低于方向错了返工。

## Git 提交规范

**核心原则：一个需求一个 commit，迭代收尾再统一一次修复调整 commit。**

即 **一个迭代的历史提交数 = 需求数 + 1**（老大明确要求把两个需求合成一刀时，按合并后的刀数算）。例：迭代 28 共 7 项需求 → 7 个需求提交 + 1 个 `fix(迭代28): 审查与验证修复调整` = 8 个提交。历史里不出现步骤级提交（本项目已累积 1300+ 提交，主因就是按步骤刷提交）。

- **需求是提交单位**：一个需求所有步骤的代码，连同它的 plan 勾选与规划/审查/验证文档，一起进这一个 commit。中间反复修改、调试不产生 commit
- **步骤不提交**：步骤只跑 Mini 验证并勾 [✓]，提交时机是本需求整体测通之后
- **规划/审查/验证阶段不单独提交**：这些文档并入所属需求的 commit；审查与验证发现的问题全部攒进收尾那次修复调整 commit
- **不要碎片化提交**：改一点就 commit 会导致 git history 噪音大、回滚时分不清哪版是好的
- **大需求可临时多提交几刀做保险，但进下一个需求前必须折叠**：`git reset --soft HEAD~K` 后重新提交成该需求的单个 commit。历史里留下的必须是一需求一刀
- **提交前必须测通（由 agent 自判，不逐需求停下等老大 OK）**：编译零错误 + 能启动 + 该需求核心流程跑得通 + 各步骤 Mini 验证已过，即可 commit
- **老大唯一的裁定点是迭代收尾**：即他手动说"进行 xxx 迭代收尾"、把分支合并 main 的那一刻。Plan 内的需求提交与验证结论不构成停等门，照实报告即可
- **迭代内一律不 push**：本地 commit 就是防误操作的检查点，一个迭代从开工到收尾之间可以一次都不推
- **只在迭代收尾 push**：老大确认收尾、合并 `main` + 打 tag 时，一次性 `push main + tags`（提交和推送是两回事）
- **Push 优先直连，一次不通立即转代理**：直连失败会硬等 20s+，不要反复重试直连；代理写法 `git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin <branch>`

> 各阶段的具体提交动作见 `docs/dev-workflow.md`「提交节奏 / 防误操作规则」，两份口径必须一致。

### 知识库（Obsidian）

- **路径**：`D:\koda\Obsidian\05-WishfulClaw`（2026-09-14 由 `02-AI教学\wishfulclaw` 迁入并更名，旧路径已废弃；路径不存在则跳过并告知老大）
- **维护与回写**：知识库由老大维护（Bug 与优化建议），**回写归档由开发 agent 负责**——老大看不到源码，条目到底落没落地只有 agent 核得准
- **回写是 agent 的职责，不必反复请示**：核对时发现「已排某迭代 / 实际已落地」的滞后条目，直接按代码事实归档，改完照实报告即可
- **归档口径**：`issues/bugs.md` / `issues/改进.md` **只留尚未处理**的条目；已落地的**移进 `issues/历史记录.md`**（表按日期倒序，新归档行插在表头分隔行之后），并在两文件头部「更新：」行写明本次增删
- **备注留代码证据**：归档条目的备注写清落在哪个迭代 / Plan + 代码证据（文件:行）
- **滞后是常态**（老大只往里追加，不删）：核对完成度以**代码与 `docs/progress/`** 为准，不以知识库的旧标注为准
- **归档≠改需求**：只做「移动 + 补证据 + 更新头行」，不改写老大写的需求描述本身

### 迭代开工

- **规划新迭代前，先检查知识库最新内容**（路径与回写规则见上节「知识库」）
- **迭代范围必须先与老大确认**：`docs/iteration-plan.md` 是规划草案不是最终需求，不得按默认规划直接开工，以老大确认的范围为准

### 分支管理

- **新分支必须从最新的 main 拆出**：开始新迭代前，先确保上一个迭代分支已合并到 main 并打 tag，然后从更新后的 main 创建新分支
- **禁止从旧分支拆分支**：如果上一个分支未合并 main，新分支会缺少前序迭代的代码变更，导致编译错误或功能缺失
- **标准流程**：`git checkout main` → `git pull origin main` → `git checkout -b dev/v2-iter-{N}` → 开发（**只 commit，不 push**）→ 确认收尾 → 合并 main → 打 tag → `push main + tags` → 删除分支 → 下一个迭代从 main 重新拆出

### 迭代收尾与发布

**完整流程见 `docs/release-workflow.md`**（触发条件 / 版本规则 / 版本号改动清单 / git 收尾步骤 / 进度文档 / GitHub Release 发布 / 发布后核验，全在那份文档；本节不再维护副本）。

- **迭代是否完结由用户确认，且由用户手动发起**（原话口径："进行 xxx 迭代收尾"）。Agent 不得自行判定迭代完成，也不得提前催收尾
- **版本规则**：`v2-iter-{N}` 是 MVP v2 阶段迭代编号，不是产品主版本号。正式版发布前，产品版本统一 `0.2.{N}`，Git tag `v0.2.{N}`
- **收尾主线**：升版本号 → 合并 main（`--no-ff`）→ 打 tag → 推送 → 删除迭代分支 → 更新进度文档 → 发布 GitHub Release
- **收尾完成后当前会话结束**：下个会话直接从 main 拉最新代码开始新迭代，不需要关心旧分支
- **网络**：优先直连，失败再走代理 `127.0.0.1:7897`（Clash Verge 平时关着，直连完全不通时可自行启动）

## 异常日志

项目运行时的所有异常（主进程、渲染进程、Worker、IPC 通道）会自动写入日志文件。

**日志位置**：`~/.wishful-claw/logs/` 目录下，按日期命名，如 `2026-08-05.log`

日志统一写在用户主目录下的 `.wishful-claw/logs/`，与 `config.json`、`index.db` 等配置文件同级：
- Windows：`C:\\Users\\<用户名>\\.wishful-claw\\logs\\`
- macOS：`~/.wishful-claw/logs/`
- Linux：`~/.wishful-claw/logs/`

**排查方式**：Agent 排查问题时，优先读取当天日志文件中的 `[ERROR]` 级别条目，获取完整堆栈信息，而非依赖用户口述错误。

日志格式：

```
[2026-07-22T12:30:45.123Z] [ERROR] [renderer] Uncaught TypeError: Cannot read property 'x' of undefined
  at handleClick (ChatPage.tsx:45:12)
  ...
[2026-07-22T12:30:46.000Z] [ERROR] [ipc] Handler error for 'fs:read-file': ENOENT: no such file...
```

来源标记：`[main]` 主进程、`[renderer]` 渲染进程、`[worker]` Worker 子进程、`[ipc]` IPC 通道。
