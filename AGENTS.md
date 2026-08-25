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

> 当前状态：7 项目已落地（Contracts / Core / Infrastructure / Workspace / Persona / Agent / Worker）；另有 `src/runtime/WishfulClaw.CodeGraph` vendored 项目（不参与 7 层依赖链，仅被 Worker 引用）。

```
src/
├── main/           # Electron Main 进程（窗口管理、IPC 桥接、Worker 生命周期）
├── renderer/       # React 前端（UI / 交互 / 状态管理）
├── preload/        # Electron Preload（安全桥接）
├── shared/         # 前后端共享类型定义（TS）
└── runtime/                              # .NET 后端工程
    ├── WishfulClaw.sln
    ├── WishfulClaw.CodeGraph/            # 0. CodeGraph 引擎（vendored自 github.com/AIDotNet/CodeGraph；代码图谱索引/检索，全局命名空间 + internal，194 个 .cs；不参与 7 层依赖链，仅被 Worker 引用）
    ├── WishfulClaw.Contracts/            # 1. 接口契约（纯接口，无实现）
    │   └── IWorkerModule / IWorkerModuleContext / IWorkerRequestContext / WorkerResponse
    │
    ├── WishfulClaw.Core/                 # 2. Agent 通用框架（不含业务逻辑）
    │   ├── Protocol/                     #   通信协议（MessagePack 编解码、流式事件、Worker 分发）
    │   └── Tools/                        #   工具框架（IToolExecutor / IToolProvider / ToolRegistry / ToolSchemaBuilder）
    │
    ├── WishfulClaw.Infrastructure/       # 3. 基础设施（Db / Storage / Http）
    │   ├── Db/                           #   DbClient + Entities + Db*Tools（SQLite 持久化）
    │   ├── Storage/                      #   ConfigStore + ProviderStore + JsonFileNodeCache（JSON 配置读写）
    │   └── Http/                         #   WorkerHttpClientFactory（HTTP 客户端工厂）
    │
    ├── WishfulClaw.Workspace/            # 4. 记忆系统（业务层）
    │   └── Memory/                       #   记忆读写/检索/分层流转/巩固/语义降级/FTS5 + MemoryFtsService
    │
    ├── WishfulClaw.Persona/              # 5. 人格系统
    │   ├── PromptBuilder.cs              #   分段组装 System Prompt + 字符预算
    │   ├── PersonaGenerator.cs           #   人格生成
    │   ├── PersonaStore.cs               #   人格持久化
    │   └── PersonaPresetService.cs       #   预设管理
    │
    ├── WishfulClaw.Agent/                # 6. Agent 运行时（核心业务逻辑）
    │   ├── AgentLoop*.cs                 #   Agent Loop 循环主体（partial class 拆分）
    │   ├── SessionConversation.cs        #   per-session 会话状态管理（增量追加 + prefix cache 优化 + 缓存计数器）
    │   ├── ContextCompression.cs         #   LLM 总结式上下文压缩
    │   ├── ToolCallProcessor.cs          #   工具调用处理
    │   ├── ToolDispatchRouter.cs         #   工具分派路由
    │   ├── SubAgent*.cs                  #   子 Agent 生命周期管理
    │   ├── Providers/                    #   模型 Provider（Anthropic / OpenAI Chat / Gemini / Vertex AI）
    │   │   ├── AnthropicMessages*.cs
    │   │   ├── OpenAIChat*.cs
    │   │   └── ...
    │   ├── Tools/                        #   工具实现（FileTools / SearchTools / ShellTools / MemoryTools / Providers / AgentChanges）
    │   ├── Modules/                      #   业务模块（Git / Skills / Extensions / Channels / Video / Media / OpenAIAudio / ProviderTest / WebFetch）
    │   ├── *Executor.cs                  #   工具执行器（AskUser / Browser / ImageGenerate / SSH / Task / WebFetch / WebSearch ...）
    │   ├── ConversationCodec.cs          #   对话编解码
    │   └── StreamEventModels.cs          #   流式事件模型
    │
    └── WishfulClaw.Worker/               # 7. 进程入口（薄层 IPC 宿主）
        ├── Program.cs                    #   入口（含 CodeGraphNativeLibraryResolver.Install）
        ├── WorkerHost*.cs                #   宿主构建 + 模块装载
        └── WorkerModuleCatalog.cs        #   模块注册（含 CodeGraphModule，引用 Agent / Infrastructure / WishfulClaw.CodeGraph 中的实现）
```

### 各项目文件数（当前实际）

| 项目 | 文件数 | 职责 |
|------|--------|------|
| Contracts | 4 | 纯接口契约 |
| Core | 19 | Agent 通用框架（Protocol + Tools） |
| Infrastructure | 23 | 基础设施（Db / Storage / Http + Db Tools） |
| Workspace | 12 | 记忆系统（含 MemoryFtsService） |
| Persona | 9 | 人格系统 |
| Agent | 141 | Agent 运行时（Loop / Provider / Executor / Compression / SubAgent / Tools / Modules） |
| Worker | 12 | IPC 宿主（Program + Host + Catalog + 5 核心 Module） |
| CodeGraph | 194 | 代码图谱引擎（vendored，索引/同步/探索/检索，经 Worker 注册 `codegraph/*` 方法） |

> 统计不含 obj/ 目录下的自动生成文件。

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

- **依赖** Contracts + Core + Workspace
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
- 当前仅保留 Program.cs + WorkerHost + WorkerModuleCatalog（12 文件），其余已迁入 Agent / Infrastructure

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

> 以下是 WishfulClaw 的设计思路来源。OpenCowork 的代码经迁移和重构后纳入 WishfulClaw 架构（迁移文件头部均保留原始版权声明），其余项目主要借鉴设计思路，代码由 WishfulClaw 自行实现。本地副本路径见 `docs/new-session-prompt.md`。

| 项目 | 仓库地址 | 参考内容 |
|------|---------|---------|
| OpenCowork | https://github.com/AIDotNet/OpenCowork | Agent Loop、工具链、Provider、流式协议（迁移+重构） |
| KodaClaw | https://github.com/nekonaka/koda-claw | 记忆系统、人格系统、PromptBuilder（借鉴思路） |
| OpenClaw.net | https://github.com/nekonaka/openclaw.net | 记忆主动回忆、记忆工具、上下文预算（借鉴思路） |
| DeepSeek-Reasonix | https://github.com/deepseek-ai/DeepSeek-Reasonix | 缓存命中率统计、工具注册发现、工具注入体系（借鉴思路） |
| OpenAI Codex | https://github.com/openai/codex | Goal 模式状态机、自检评估机制（借鉴思路） |

## 开发约定

- C# 文件名使用 PascalCase
- TypeScript 文件名使用 kebab-case
- 接口前缀 `I`（C# 遵循 .NET 惯例）
- 新增模块时在 Worker/Modules 下注册
- 新增工具时实现工具基类并在对应 Module 中注册
- 记忆和人格的配置文件使用 Markdown 格式（.wishful-claw/ 目录下）

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

1. 按职责拆分为多个文件，每个文件 200~500 行为宜，前提是不影响逻辑内聚性，可以适当超出
2. 超过 500 行必须拆分
3. 拆分的目的是出问题时方便排查定位——按职责边界拆，让人一看文件名就知道该去哪找问题
4. C# 用 partial class，TypeScript 用 export/import 模块化
5. 以下情况不需要强行拆分：
   - 单一数据对象（如 provider preset 列表、模型配置表）——内容是同质数据，拆了反而难查找
   - 高度内聚的 store / hook ——逻辑紧密耦合，拆开会割裂上下文
   - 拆分后需要大量 props 透传或 state 搬运的组件——拆出去增加了间接层，排查更难
6. 拆分后保持逻辑等价，不改变行为，只改组织结构

### 耦合文件拆分

1. **逻辑不相关的代码不放在同一个文件**：即使参考项目把它们放在一起，搬入时也要拆分到各自的文件中
2. **判断标准**：如果两个类/方法之间没有调用关系或数据依赖，只是参考方随手放在一起，就必须拆开
3. **拆分到正确的目录**：拆出来的文件放到 AGENTS.md 项目结构中对应的目录

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
- **TypeScript**：三个配置必须全部零错误（缺一不可）：
  - `npx tsc --noEmit -p tsconfig.web.json`（渲染进程）
  - `npx tsc --noEmit -p tsconfig.node.json`（主进程）
  - `npx tsc --noEmit -p tsconfig.json`（根配置）
  - 必须带 `-p`！不带 `-p` 只走 references 不检查文件内容，等于没验证
- **不允许用 `@ts-ignore` 偷懒**（可选依赖除外）

## Git 提交规范

**核心原则：功能单元测试通过后才 commit，不要改一点就提交。**

- **功能单元**：一组相关改动完成、用户测试通过后，产生一个 commit。中间反复修改、调试不产生 commit
- **不要碎片化提交**：改一点就 commit 会导致 git history 噪音大、回滚时分不清哪版是好的
- **多组改动可以攒在一起**：如果多组改动属于同一个功能单元，测试通过后一次提交
- **提交前必须测试**：编译通过 + 能启动 + 核心流程能跑，用户确认 OK 后才 commit
- **Plan 执行期间只 commit 不 push**：每个功能单元 commit 后不 push，本地 commit 就是防误操作的检查点
- **Plan 完成后才 push**：一个 Plan 的所有功能单元都完成并通过验证后，一次性 push
- **Push 需要代理**：`git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin <branch>`

### 分支管理

- **新分支必须从最新的 main 拆出**：开始新迭代前，先确保上一个迭代分支已合并到 main 并打 tag，然后从更新后的 main 创建新分支
- **禁止从旧分支拆分支**：如果上一个分支未合并 main，新分支会缺少前序迭代的代码变更，导致编译错误或功能缺失
- **标准流程**：`git checkout main` → `git pull origin main` → `git checkout -b dev/v2-iter-{N}` → 开发 → commit → push → 合并 main → 打 tag → 删除分支 → 下一个迭代从 main 重新拆出

### 迭代完结收尾

**迭代是否完结由用户确认，Agent 不得自行判定。**

**版本规则**：`v2-iter-{N}` 仅表示 MVP v2 阶段的迭代编号，不是产品主版本号。正式版发布前，产品版本统一为 `0.2.{N}`，Git tag 为 `v0.2.{N}`。每次迭代收尾必须先将 `package.json` 版本更新为 `0.2.{N}`；应用 UI 从 `package.json` 读取版本号，README 版本徽章同步更新。

用户确认完结后，Agent 必须执行以下收尾步骤，确保 main 是最新的，下个会话可以直接从 main 开始新迭代：

```bash
# 0. 更新产品版本（package.json = 0.2.{N}，README 徽章同步）

# 1. 合并到 main
 git checkout main
git merge dev/v2-iter-{N} --no-ff -m "merge: v2-iter-{N} - {迭代名称}"

# 2. 打 tag
git tag -a v0.2.{N} -m "v2-iter-{N}: {迭代名称} - 验证通过"

# 3. 推送远程（需要代理）
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin v0.2.{N}

# 4. 删除本地迭代分支
git branch -d dev/v2-iter-{N}

# 5. 删除远程迭代分支（如果之前 push 过）
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin --delete dev/v2-iter-{N}
```

6. 更新 `docs/new-session-prompt.md` — 新会话提示词中的迭代表格状态、最新 tag、当前状态、候选迭代、会话开始指令等。

7. 更新 `docs/PROGRESS.md`（状态 + VERDICT + Commit ID + Tag + 日期）。

8. 发布到 GitHub Release（见下节）。

**关键要求**：收尾完成后，当前会话结束。下个会话直接从 main 拉取最新代码开始新迭代，不需要关心旧分支。

### 发布到 GitHub

仓库地址：https://github.com/wishful-73/wishful-claw（旧地址 `731471991/wishful-claw` 已迁移，若 remote 仍指向旧地址需先 `git remote set-url origin` 更新）。

收尾的最后一步是发布版本：

1. **推送 main 和 tag**：`git -c http.proxy=... push origin main` + `push origin v0.2.{N}`（走代理，见上文步骤 3）
2. **创建 GitHub Release**：使用本地便携版 gh CLI（固定路径 `D:\claw\tools\gh\bin\gh.exe`，须保留勿删，登录凭据存于系统 keyring）：

   ```bash
   # 用 git log 提取本迭代变更，按功能单元汇总成 notes 后：
   HTTPS_PROXY=http://127.0.0.1:7897 /d/claw/tools/gh/bin/gh.exe release create v0.2.{N} \
     --repo wishful-73/wishful-claw --title "v0.2.{N}" --notes-file <notes文件>
   ```

   - notes 按本迭代的功能单元汇总，用 `git log v0.2.{N-1}..v0.2.{N} --oneline` 提取
   - gh 不在 PATH 中，必须用绝对路径调用；gh.exe 不可用时用浏览器登录 GitHub 手动创建（Releases → Draft a new release → 选择 tag → 填写 notes → Publish）
3. **打包安装包并上传**（Windows NSIS 安装器，需上传到 Release Assets）：

   ```bash
   npm run pack:installer:full   # AOT Worker + 前端 + electron-builder NSIS
   # 产物： release/wishful-claw-{N}-setup.exe
   HTTPS_PROXY=http://127.0.0.1:7897 /d/claw/tools/gh/bin/gh.exe release upload v0.2.{N} \
     --repo wishful-73/wishful-claw "release/wishful-claw-0.2.17-setup.exe"
   ```

   - 打包前确认无残留 WishfulClaw/electron 测试进程（`tasklist` 检查），否则旧 `release/win-unpacked/` 被锁报 EBUSY
   - 若 `win-unpacked/app.asar` 被锁（杀软/索引句柄）且杀进程无效，改用新输出目录绕开：`npx electron-builder --win -c.directories.output=release/v0.2.{N}`
   - 上传后核验 Release 页面出现 setup.exe
4. **发布后核验**：确认 GitHub 上 main 分支、tag、Release（含安装包）三者均到位

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
