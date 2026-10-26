# Plan: S-223 dev 实例的项目级数据目录与生产隔离

> 需求正文：`../requirements/S-223.md`
> 依据：`../plan.md`（迭代目标）、`dev-workflow.md`（六阶段）、`AGENTS.md`（分层与大文件规则）
> 阶段三审查：`./compliance_report.md`（首轮 ❌4 / ⚠️8，本版已全部收口，见 §七）

## 目标

dev 实例写项目级数据时落到 `{工作区}/.wishful-claw-dev/`，打包版仍为 `{工作区}/.wishful-claw/`。全局目录口径不动，历史数据不迁移。

**范围界定**：只动「拼 `workingFolder`」的路径。拼 `UserProfile` / `home` / `dataRoot` 的一律不动。

## 一、判定源的单一真源

**问题**：`app.isPackaged` 只在 Electron 主进程存在；C# worker 与 renderer 都看不到。

**首轮审查抓到的坑**：若 renderer 自己用 `import.meta.env?.DEV` 判定，`npm start`（`electron-vite preview`，跑构建产物但未打包）会导致 **main 判 dev、renderer 判 prod** —— 项目被反向污染。renderer **不得自行判定**。

**做法**：主进程算一次，三路分发，全部携带同一个字符串。

```
Electron 主进程  projectDirName = env[WISHFULCLAW_PROJECT_DIR] ?? projectDataDirName(!app.isPackaged)
   ├─ C# worker  ← workerEnv 注入 WISHFULCLAW_PROJECT_DIR（native-worker.ts）
   ├─ renderer   ← BrowserWindow.additionalArguments 传 --wishful-project-dir=…，preload 解析后暴露
   └─ main 自身  ← 同一变量直接复用，不重算
```

**新增 `src/shared/project-dir.ts`（约 22 行，纯函数，无 electron 依赖）**

```ts
import { WISHFUL_CLAW_DATA_DIR_NAME } from './data-dir'

export const WISHFULCLAW_PROJECT_DIR_ENV = 'WISHFULCLAW_PROJECT_DIR'

/** 项目级数据目录名：dev 与生产各一份，全局目录不走这里。 */
export function projectDataDirName(isDev: boolean): string {
  return isDev ? `${WISHFUL_CLAW_DATA_DIR_NAME}-dev` : WISHFUL_CLAW_DATA_DIR_NAME
}

/** 判定逻辑本身（不碰 electron / process），供单测直接调。 */
export function pickProjectDirName(envValue: string | undefined, isPackaged: boolean): string {
  const configured = envValue?.trim()
  return configured ? configured : projectDataDirName(!isPackaged)
}
```

**为什么判定逻辑必须拆成 `pickProjectDirName(env, isPackaged)`**（复审 ❌E）：`main/lib/data-dir.ts:1` 有 `import { app } from 'electron'`，而 npm 的 electron 包 `index.js` 末行是 `module.exports = getElectronPath()`（导出**字符串**），node 环境下 `app === undefined` ⇒ 测试里 `!app.isPackaged` 直接 TypeError。全 `tests/**` 无一处 import electron，也没有 `--alias:electron` 注入，没有先例可抄。所以 `resolveProjectDirName()` 只做「取 env + 取 app.isPackaged + 调纯函数」这一层壳，单测只打 `shared/project-dir.ts`。

| 端 | 值来源 | 实现落点 |
|---|---|---|
| main | `process.env` 覆盖优先，否则 `!app.isPackaged` | **`main/lib/data-dir.ts` 新增 `resolveProjectDirName()`（唯一取值入口）**；`main/index.ts` 模块顶层调一次并回写 `process.env`，供子进程继承 |
| preload | `process.argv` 里的 `--wishful-project-dir=` | `preload/index.ts` 的 `api` 对象加字段 |
| renderer | 读 preload 暴露的值，**不读 `import.meta.env`** | 新增 `renderer/src/lib/project-data-dir.ts` |
| C# | `Environment.GetEnvironmentVariable(...)`，缺省回退 `.wishful-claw` | `WishfulClawDataDir.ProjectDirName` |

**为什么取值入口放 `main/lib/data-dir.ts` 而不是 `main/index.ts`**（复审 ❌A）：`main/index.ts` 自身 import 了 `native-worker` 与 `misc-handlers`（`:8` / `:52`），反向再让它们 `from '../index'` 就是循环 import；实测全 `src/main` 无一处 `from '../index'`。而 `data-dir.ts` 是既有的低层模块（`resolveDataDir()` 就在里面），`misc-handlers.ts`、`native-worker.ts`、`codegraph-handlers.ts` 共用同一个 `resolveProjectDirName()`，保证「环境变量覆盖」这条语义三处一致。

**为什么不把 `isDev` 判断塞进 `shared/project-dir.ts`**：该文件被 `tsconfig.node.json` 与 `tsconfig.web.json` 同时收录，`import.meta.env` 在 node 配置下没有类型。纯函数 + 调用方传参，两端都干净。

## 二、步骤清单

### 步骤 1：C# 契约层加环境变量名
- `src/runtime/WishfulClaw.Contracts/WishfulClawPaths.cs` 新增 `public const string ProjectDirEnvVar = "WISHFULCLAW_PROJECT_DIR";`
- **`DataDirName` 常量保留不动** —— 全局路径、回退值、生产目录名都依赖它
- 验证：`dotnet build src\runtime\WishfulClaw.sln` 0 错误

### 步骤 2：Infrastructure 加解析入口
- `WishfulClawDataDir.cs` 新增：
  ```csharp
  public static string ProjectDirName =>
      Environment.GetEnvironmentVariable(WishfulClawPaths.ProjectDirEnvVar)?.Trim()
      is { Length: > 0 } configured ? configured : WishfulClawPaths.DataDirName;

  public static string ProjectRoot(string workingFolder) => Path.Combine(workingFolder, ProjectDirName);
  ```
- `EnsureProjectRoot`（`:44`）改用 `ProjectRoot(workingFolder)`
- **绝对不改** `Root`（`:17`，拼 `UserProfile`，全局）
- 验证：编译 0 错误；`ProjectDirName` 在无环境变量时返回 `.wishful-claw`

### 步骤 3：替换 C# 项目级常量引用（11 处）
`WishfulClawPaths.DataDirName` → `WishfulClawDataDir.ProjectDirName`（**只改拼 `workingFolder` 的**）：

| 文件 | 行 |
|---|---|
| `WishfulClaw.Workspace/Memory/MemoryPathResolver.cs` | 65 |
| `WishfulClaw.Agent/SystemPromptCache.cs` | 94 |
| `WishfulClaw.Persona/PersonaStore.cs` | 34 |
| `WishfulClaw.Agent/Goal/GoalFileTools.cs` | 18 / 23 / 28 |
| `WishfulClaw.Agent/Goal/GoalPlanTracker.cs` | 28 |
| `WishfulClaw.Agent/AgentRuntimePlanExecutor.cs` | 158 |
| `WishfulClaw.Agent/AgentRuntimePlanExecutor.Helpers.cs` | 26 |
| `WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | 141 |

- **不改** `CodeGraph/Support/CodeGraphDataDir.cs:56`（拼 `home`，全局）
- 依赖已核：Workspace / Persona / Agent 均引用 Infrastructure；**CodeGraph 不引用**，故它那处保持原常量正好，不需要动
- **验证判据（首轮审查纠错：不是 2 处，是 3 处）**：
  `Select-String -Pattern "WishfulClawPaths\.DataDirName"` 改后命中 **恰好 3 处** ——
  ① `WishfulClawDataDir.cs` 的 `Root`（`:17`）
  ② `WishfulClawDataDir.cs` 的 `ProjectDirName` 回退值（步骤 2 新增）
  ③ `CodeGraphDataDir.cs:56`
  **注意**：`WishfulClawPaths.cs:5` 的常量定义本身是 `public const string DataDirName = ...`，**不含 `WishfulClawPaths.` 前缀，不被该模式匹配**。目标是 3 处，不是 2 处；多减一处说明误改了 `Root`（风险 4）。

### 步骤 4：C# 提示词 / 工具描述里的裸字符串（7 处，首轮审查补漏）
项目级目录名**不只出现在代码里，还硬编码在给模型的文案里**。只改步骤 3 会导致模型被指示去写生产目录：

| 文件 | 行 | 语境 |
|---|---|---|
| `WishfulClaw.Persona/PromptBuilder.cs` | **339** | 系统提示词 `$"""…- Scratch notes … `.wishful-claw/notes/`…"""` |
| `WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs` | 32 | 工具描述（读 `project-status.md`） |
| `WishfulClaw.Agent/Tools/Providers/PlanToolProvider.cs` | 65 | 工具描述（plan state 文件） |
| `WishfulClaw.Agent/Tools/Providers/GlobalTaskToolsProvider.cs` | 108 | 工具描述（notes 目录） |
| `WishfulClaw.Agent/AgentRuntimeGlobalTaskExecutor.cs` | 226 | 派活消息文案（与 renderer `task-board-store.ts:104` **互为镜像**） |
| `WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | 599 | 收尾指令（`write … to .wishful-claw/project-status.md`） |
| `WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | 607 | 显式拼 `{workingFolder}/.wishful-claw/…`，**必须与 `:141` 改后的读路径一致**，否则 dev 下读到旧路径、反复重发模板 |

- **改法按字符串类型分两类**（复审 ❌F，照「加表达式即可」做会编译通过、grep 也全绿，但模型收到的是字面 `{WishfulClawDataDir.ProjectDirName}/notes/`，现有门禁一条都拦不住）：
  - **A 类 · 已是插值串（3 处）**：`AgentRuntimeProjectExecutor.cs:599`（`$"…"`）、`:607`（`$"…"`）、`PromptBuilder.cs:339`（`$"""…"""`）⇒ 直接把字面量换成 `{WishfulClawDataDir.ProjectDirName}`
  - **B 类 · 普通字面量（4 处）**：`ProjectToolsProvider.cs:32`、`GlobalTaskToolsProvider.cs:108`、`AgentRuntimeGlobalTaskExecutor.cs:226`、`PlanToolProvider.cs:65` ⇒ **先在该行字符串前补 `$`**，再替换。其中 **3 处是 `"…" + "…"` 多行拼接**（`GlobalTaskToolsProvider:104-108`、`AgentRuntimeGlobalTaskExecutor:220-231`、`PlanToolProvider:64-65`），**只给含目标字面量的那一行加 `$`**，不要动相邻行；**`ProjectToolsProvider.cs:32` 是单行完整字符串**，整行加 `$` 即可
- **`PlanToolProvider.cs:65` 花括号陷阱**（复审 ❌C，与 B 类叠加）：原串含字面 `{planId}`，加了 `$` 之后它会被当变量解析 → `CS0103: 当前上下文中不存在名称 planId`。必须写成 `{{planId}}`。**7 处里仅此一处有 `{`**，其余 6 处已逐行确认无花括号
- **验收这类改动只能靠眼睛**：编译和 grep 都拦不住 B 类漏加 `$`。改完必须逐行回读这 7 行，确认**每一行**出现的都是 `{WishfulClawDataDir.ProjectDirName}` 占位而非字面量
- **`using` 补全**（复审 ⚠️）：`PromptBuilder.cs`、三个 Provider、`AgentRuntimeGlobalTaskExecutor.cs` 都缺 `using WishfulClaw.Infrastructure.Storage;`（实测各 0 命中，对照组 `AgentRuntimeProjectExecutor.cs:7` 有），改完需补上
- 与 TS 镜像必须同刀改：`task-board-store.ts:104` 改而 `AgentRuntimeGlobalTaskExecutor.cs:226` 不改 ⇒ 同一条派活消息两条投递路径说不同目录名
- **验证（可执行，不含「+ 注释」这种不可判的措辞）**：
  ```powershell
  Get-ChildItem -Recurse -Filter *.cs src\runtime |
    Where-Object { $_.FullName -notmatch '\\obj\\|\\bin\\' } |
    Select-String -Pattern '\.wishful-claw' |
    Where-Object { $_.Line -notmatch '^\s*//|^\s*///' }
  ```
  ⇒ **应恰好 1 条**（`WishfulClawPaths.cs:5` 常量定义）。注意三件事：① 必须 `Get-ChildItem -Recurse`，`Select-String -Path src\runtime\**\*.cs` 不递归、会静默返回空；② 必须排掉 `obj` / `bin`（生成物里有副本，不排会误报成 3 条）；③ 改前跑同一命令应是 **8 条**（7 处文案 + 常量定义）
- 另需编译 0 错误 + 逐行回读上表 7 行

### 步骤 5：worker 注入环境变量
- `src/main/lib/native-worker.ts` 的 `workerEnv`（`:183-187`）新增 `[WISHFULCLAW_PROJECT_DIR_ENV]: resolveProjectDirName()`
  - 该对象里 `...process.env` 在前 ⇒ 即便 index 已回写 env，这里显式再取一次也不会不一致（同函数同源）
- 验证：`npm run typecheck:node` 0 错；核对该值与 `resolveDataDir()` 的 dev 判定同源（都由 `app.isPackaged` 派生，且都能被 `WISHFULCLAW_PROJECT_DIR` 覆盖）

### 步骤 6：main 侧判定 + 两处项目级路径 + 一处调用方
- `src/main/lib/data-dir.ts` 新增 `resolveProjectDirName()`，**实现体必须是薄壳、只做三件事**（不要在别处内联 `||`，否则纯函数单测覆盖不到 main 侧的取值语义）：

  ```ts
  export function resolveProjectDirName(): string {
    return pickProjectDirName(process.env[WISHFULCLAW_PROJECT_DIR_ENV], app.isPackaged)
  }
  ```
- `src/main/index.ts` 模块顶层：调用 `resolveProjectDirName()` 并**回写 `process.env`**（子进程继承），再用于 `additionalArguments`
- `src/main/index.ts` BrowserWindow `webPreferences`（`:109`）新增 `additionalArguments: [`--wishful-project-dir=<值>`]`
- `src/main/ipc/codegraph-handlers.ts:171` → `join(workingFolder, resolveProjectDirName(), 'codegraph')`
- `src/main/lib/generated-image-dir.ts:61` → **加可选参数** `projectDirName?: string`（默认 `WISHFUL_CLAW_DATA_DIR_NAME`）
  - **保持模块纯净**：该模块被 `tests/generated-image-dir` 直接 import，绝不能引入 `electron` / `app`
  - **调用方必须同改**（首轮审查补漏）：`src/main/ipc/misc-handlers.ts:316-324` 的 `resolveGeneratedImagesDir({ scope: args.scope, … }, resolveDataDir())` 漏传第三个参数 ⇒ `scope:'project'` 静默回退裸名，dev 的项目生成图仍写 `{workingFolder}/.wishful-claw/image`，验收 1/3 直接不达标。补 `resolveProjectDirName()` 作第三实参。
  - `image-persist.ts:76` 是空 scope（全局），不改
- **不改** `codegraph-handlers.ts:159-160`（`~/` 前缀，全局路径规范化用）
- 验证：`npm run typecheck:node` 0 错；`npm run test:generated-image-dir` 现有断言全绿

### 步骤 7：renderer 三处 + preload 通道
- `src/preload/index.ts`：解析 `process.argv` 的 `--wishful-project-dir=`，在 `api` 对象（`:35-82`）加 `projectDirName`（**解析不到就是 `undefined`，不要在这里兜底**）；`src/preload/index.d.ts` 补类型，**声明为 `projectDirName?: string`**（手写 `declare global`，不 import shared 类型；全仓只有这一份 `window.api` 声明，`monaco/setup.ts:32`、`streaming-perf.ts:238` 只加无关字段）
- 新增 `src/renderer/src/lib/project-data-dir.ts`：**兜底只在这一处**，保证下游拿到的永远是 `string`（否则 `joinFsPath(…, PROJECT_DATA_DIR_NAME)` 会让 web tsconfig 报类型错）：
  ```ts
  import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'
  export const PROJECT_DATA_DIR_NAME: string = window.api?.projectDirName ?? WISHFUL_CLAW_DATA_DIR_NAME
  ```
- `renderer/src/lib/agent/memory-files.ts:10` → `PROJECT_MEMORY_DIRNAME = PROJECT_DATA_DIR_NAME`
- `renderer/src/components/chat/project-archive-helpers.ts:42` → `WISHFUL_CLAW_DIR = PROJECT_DATA_DIR_NAME`
- **`ProjectArchivePage.tsx:82` 必须改回全局常量**：`joinFsPath(home, WISHFUL_CLAW_DIR, 'projects', id)` 属于 `~/` 全局路径，不能跟着项目级走。需**新增一个 import**（`WISHFUL_CLAW_DATA_DIR_NAME` from `@shared/data-dir`）并直接用它，不再借 `WISHFUL_CLAW_DIR`
- `renderer/src/stores/task-board-store.ts:104` → 文案用 `PROJECT_DATA_DIR_NAME`（与步骤 4 的 C# 镜像同刀）
- **SSH 远程项目 ⇒ 登记为已知边界，本轮不改**（复审 ⚠️3 / 第三轮 ❌G）：
  - 事实：`getProjectMemoryCandidatePaths`（`memory-files.ts:220-227`）拼的 `projectRootPath` 对 SSH 项目是**远端主机路径**，远端只有 `.wishful-claw/`。改后 dev 实例连 SSH 项目会去读远端 `.wishful-claw-dev/`（不存在）⇒ **读不到远端历史记忆**
  - 实测 5 个调用点：`memory-files.ts:277`（`resolveProjectMemoryTextFile`，有 `sshConnectionId` 形参 ✓）、`memory-automation-utils.ts:439`（`args.sshConnectionId` 同作用域 ✓）、`:594`（`resolveProjectSummaryPath`，**无 ssh 上下文** ✗）、`memory-organization.ts:156`（`project.sshConnectionId` ✓）、`:244`（`args.sshConnectionId` ✓）
  - **裁定：不做分流**。理由三条 —— ① 需求本体是本地工作区隔离，老大原话是「项目下记忆不要冲突」，SSH 远端不在其内；② 该场景**不污染生产**（dev 实例只会另起远端 `-dev` 目录，生产的 `.wishful-claw` 一个字节不动），代价仅是「dev 连远端时读空」，而 dev 本来就用于本地临时测试；③ 强行分流要改 5 个调用点，其中 `resolveProjectSummaryPath:594` 拿不到 ssh 上下文，需要一路改签名上传，改动面比需求本体还大
  - 因此 `getProjectMemoryCandidatePaths` **签名不变**，`PROJECT_MEMORY_DIRNAME` 直接换成 `PROJECT_DATA_DIR_NAME`；该边界写进 `docs/data-storage.md` 与需求 §边界
  - 与 C# 侧对齐：`MemoryPathResolver` 的 SSH 分支本来就落本地全局 `~/.wishful-claw/projects/{projectId}/`（`:10/:28`），不走远端，所以 C# 侧无关
- **不改** `codegraph-project-index.tsx:85` / `codegraph-availability.ts:40` / `SkillsMenu.tsx:371,417`（三者全是全局 `dataRoot` / `~/` 路径）
- **多窗口边界**：共 4 个窗口共用同一 preload（`main/index.ts:110`、`quick-launcher.ts:1709/2139`、`clipboard-enhancer.ts:585`），只有主窗带 `additionalArguments`。三个辅助窗口当前不 import 项目路径模块，故 `projectDirName` 会保持 undefined —— 模块里 `?? WISHFUL_CLAW_DATA_DIR_NAME` 兜底，不抛错
- 验证：`npm run typecheck:web` 0 错；`npm run test:codegraph-availability` 全绿（它只测全局解析）；`npm test` 无一用例 import 这三个 renderer 模块，加 `window.api` 字段不会打断

### 步骤 8：忽略规则
- 仓库 `.gitignore` 增 `.wishful-claw-dev/`（现有只有 `.wishful-claw/*`）
- **不自动改用户项目的 .gitignore**（用户明确否掉）
- 验证：`git status` 不出现该目录

### 步骤 9：四个越线文件补豁免头
本次要改的 4 个文件超 500 行硬线且**当前无豁免头**，按 `AGENTS.md` §大文件拆分 补（文件首行注释，写明理由 + 实测行数）：

| 文件 | 改前实测行数 |
|---|---|
| `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | 609 |
| `src/main/lib/native-worker.ts` | 588 |
| `src/runtime/WishfulClaw.Agent/AgentRuntimePlanExecutor.cs` | 557 |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalTaskExecutor.cs` | **545**（复审 ❌D 补，步骤 4 新纳入） |

- 其余待改文件均未越线，最贴近的是 `main/index.ts` 479 → 约 483、`PromptBuilder.cs` 475 → 476（补一行 `using`）
- **豁免注释放文件第一行**（在版权块、`using` 之前；若首行是版权注释则紧随其后）
- **行数口径**：`AGENTS.md` 要求写「当前行数」，所以注释里写的是**注入豁免头之后重新数一遍**的行数（约等于上表 +1），不要写上表的改前值，否则下次核对会差一行
- 验证：四份文件首行即豁免注释；行数用 `[IO.File]::ReadAllLines(path).Count` 数（**不用 `Get-Content .Count`，UTF-8 无 BOM 会数错**）

### 步骤 10：文档同步与注释订正
- `docs/data-storage.md`：补「项目级目录名按运行态区分」与 `WISHFULCLAW_PROJECT_DIR`；写明 **SSH 远程项目的已知边界**（dev 实例连远端会另起 `-dev` 目录、读不到历史记忆，不污染生产）
- `docs/development.md:135`：从「全局目录」扩到「全局 + 项目级」
- `README.md:107`（原句「项目级数据在 `{项目目录}/.wishful-claw/`」）、`AGENTS.md:142`（原句「记忆和人格的配置文件使用 Markdown 格式（.wishful-claw/ 目录下）」）：**这两处写的是生产口径，不要改成 `-dev`**。README 面向用户（用户装的是打包版），AGENTS 是给 agent 的协作约定。正确做法是在 README 该条后补半句「开发实例用 `.wishful-claw-dev/`」，AGENTS 处不动 —— 并在 §七 记明「两处是有意不区分」，避免下次被当成漏改
- **注释订正**（复审 ⚠️9）：只改「与改后实现直接矛盾」的，不强求全量对齐 ——
  - `WishfulClawDataDir.cs:30/:34`（描述 `{workingFolder}/.wishful-claw` 是唯一项目目录）
  - `PersonaStore.cs:9`（`or project library ({workingFolder}/.wishful-claw/personas/)`）
  - `PromptBuilder.cs:241`（`Local project: memory stored under {workingFolder}/.wishful-claw/`）
  - `MemoryPathResolver.cs:9`（同上）
  - 纯说明 `~/.wishful-claw/` 全局的注释一律不动
- 验证：四处文档表述与代码一致，无第三套说法；被改注释与实现读起来不打架

### 步骤 11：门禁
- 新增 `tests/project-dir/program.ts`（约 30 行），写法照现有 62 个 TS 套件：`import { projectDataDirName, pickProjectDirName } from '../../src/shared/project-dir'`（无扩展名没问题，esbuild 会解析）。只打 **`shared/project-dir.ts` 的纯函数**：
  1. `projectDataDirName(false)` === `.wishful-claw`（**验收 2「打包版零变化」的机器锚点**）
  2. `projectDataDirName(true)` === `.wishful-claw-dev`
  3. `pickProjectDirName` 三例（**注意内部是 `!isPackaged`，别把断言写反**）：
     - `pickProjectDirName('x-custom', false)` === `'x-custom'`（环境变量优先）
     - `pickProjectDirName('  ', false)` === `.wishful-claw-dev`（空白回退 ⇒ `isPackaged=false` 走 dev）
     - `pickProjectDirName(undefined, true)` === `.wishful-claw`（回退 ⇒ `isPackaged=true` 走生产）
  - **绝不能在这里调 `resolveProjectDirName`**（它住 `main/lib/data-dir.ts:1`，`import { app } from 'electron'`，node 下 `app === undefined` 直接 TypeError）
- `package.json` `scripts` 增（照 62 个现有 `test:*` 的写法，**不要用 `--experimental-strip-types`**，仓库零先例且无扩展名 import 会 `ERR_MODULE_NOT_FOUND`）：
  ```
  "test:project-dir": "esbuild tests/project-dir/program.ts --bundle --platform=node --format=cjs --alias:@renderer=./src/renderer/src --outfile=tests/project-dir/out/program.cjs && node tests/project-dir/out/program.cjs"
  ```
- `npm run typecheck`（node + web）、`dotnet build src\runtime\WishfulClaw.sln`、`npm test`、`cd website; npm run build`
- 验证：全绿；`npm test` 基线 79 不得倒退（新增套件后 **80 套**）；`test:project-dir` 全通过

### 步骤 12：真机（按需求 §7 原编号挂靠）
- dev 实例打开一个项目，依次触发：①写项目记忆 ②跑一次 codegraph 索引 ③生成一张图 ④派一次全局任务
- 验证：
  - **验收 1**：项目下生成 `.wishful-claw-dev/`，且**未新建** `.wishful-claw/`（四项产物全落在 `-dev` 下）
  - **验收 3**：项目级记忆（`MEMORY.md` / `memory/*`）在 `-dev` 目录里可见
  - **验收 4**：全局记忆仍在 `~/.wishful-claw-dev/`（`~/.wishful-claw` 的 mtime 无变化）
  - **验收 6**：`~/.wishful-claw/codegraph` 路径未出现 `-dev-dev` 之类拼接错误
- **验收 2**（打包版零变化）与 **验收 5**（门禁）在步骤 11，不上真机

### 步骤 13：提交
- 一次提交，消息 `feat(runtime): dev 实例项目级数据目录与生产隔离（S-223）`
- 文档产物（plan-s223/ + requirements/S-223.md + 索引）随本刀入库

## 三、涉及文件

**C#（15 改 + 1 备查）**
- `WishfulClaw.Contracts/WishfulClawPaths.cs` — 改（步骤 1）
- `WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs` — 改（步骤 2）
- `WishfulClaw.Workspace/Memory/MemoryPathResolver.cs` — 改
- `WishfulClaw.Agent/SystemPromptCache.cs` — 改
- `WishfulClaw.Agent/Goal/GoalFileTools.cs` — 改
- `WishfulClaw.Agent/Goal/GoalPlanTracker.cs` — 改
- `WishfulClaw.Agent/AgentRuntimePlanExecutor.cs` — 改（含豁免头 557 行）
- `WishfulClaw.Agent/AgentRuntimePlanExecutor.Helpers.cs` — 改
- `WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` — 改（含豁免头 609 行、含 599/607 文案）
- `WishfulClaw.Agent/AgentRuntimeGlobalTaskExecutor.cs` — 改（步骤 4 文案 + 豁免头 545 行）
- `WishfulClaw.Persona/PersonaStore.cs` — 改
- `WishfulClaw.Persona/PromptBuilder.cs` — 改（步骤 4，提示词 `:339`）
- `WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs` / `PlanToolProvider.cs` / `GlobalTaskToolsProvider.cs` — 改（步骤 4，工具描述）
- `WishfulClaw.CodeGraph/Support/CodeGraphDataDir.cs` — **不改**（列此备查）

**TS（2 新建 + 12 改）**
- `src/shared/project-dir.ts` — **新建**
- `src/main/lib/data-dir.ts` — 改（新增 `resolveProjectDirName()`，唯一取值入口）
- `src/main/index.ts` — 改（回写 env + additionalArguments）
- `src/main/lib/native-worker.ts` — 改（注入 + 豁免头 588 行）
- `src/main/lib/generated-image-dir.ts` — 改（加可选参数）
- `src/main/ipc/misc-handlers.ts` — 改（补第三实参）
- `src/main/ipc/codegraph-handlers.ts` — 改（仅 `:171`）
- `src/preload/index.ts` / `src/preload/index.d.ts` — 改（解析 argv + 暴露 + 类型）
- `src/renderer/src/lib/project-data-dir.ts` — **新建**
- `src/renderer/src/lib/agent/memory-files.ts` — 改（仅 `:10` 常量）
- `src/renderer/src/components/chat/project-archive-helpers.ts` — 改
- `src/renderer/src/components/chat/ProjectArchivePage.tsx` — 改（`:82` 回全局常量 + 新增 import）
- `src/renderer/src/stores/task-board-store.ts` — 改

**其他（8）**
- `.gitignore` — 改
- `docs/data-storage.md` / `docs/development.md` / `README.md` / `AGENTS.md` — 改
- `tests/generated-image-dir/program.ts` — 加 dev 用例（现有断言不动，现有 187 行断言全为 1~2 实参，默认值可保全）
- `tests/project-dir/program.ts` — **新建**（纯函数单测，步骤 11）
- `package.json` — 改（挂 `test:project-dir` 脚本；`tests/project-dir` 目录名不匹配 C# 测试正则，`test:*` 会被 `scripts/run-tests.mjs:32-36` 自动收录，基线 79 → 80 套）

## 四、参考源码

无。本需求是自有目录约定的运行态区分，不参考外部项目。

## 五、风险与边界

| # | 风险 | 处置 |
|---|---|---|
| 1 | `WISHFUL_CLAW_DIR` 被全局 / 项目级两种用途共用（`ProjectArchivePage.tsx:82` vs `:85`） | 步骤 7 明写：`:82` 回全局常量并新增 import，审查重点核对 |
| 2 | `generated-image-dir.ts` 引入 electron 依赖导致测试崩 | 可选参数注入，模块保持纯函数；调用方 `misc-handlers.ts` 必须补实参 |
| 3 | 环境变量缺失时静默回退 ⇒ dev 又污染生产 | 回退是打包版正常路径（生产就该是 `.wishful-claw`）；步骤 12 真机确认 dev 落 `-dev` |
| 4 | 误改全局路径 ⇒ `~/.wishful-claw-dev-dev` | 步骤 2 明写不改 `Root`；步骤 3 判据钉死「恰好 3 处」；步骤 5/6/7 列出不改的 4 处 |
| 5 | `npm start`（preview）main/renderer 判定分叉 | 步骤 7：renderer 不自己判定，只读 preload 传下来的值 |
| 6 | C# 文案与 TS 文案不同步 ⇒ 模型写错目录 | 步骤 4 与步骤 7 的 `task-board-store.ts` 同刀改；验证用 grep 兜底 |
| 7 | dev 目录出现在用户项目 `git status` | 范围外（用户明确不做自动追加）；本仓库 `.gitignore` 已补 |
| 8 | 推翻 iter-v2-27 K3.5「项目级目录名固定」的老口径 | 本需求即为修订该口径，`requirements/S-223.md` §1 记录出处与理由，实施后在 `docs/data-storage.md` 标明 |

## 六、规模（实测）

- 新增约 35 行（`shared/project-dir.ts` 两个纯函数 + `resolveProjectDirName` 壳 + preload 字段与类型 + 单测）
- 改动 **37 个文件**、约 60~70 行（含 7 处文案插值、1 处调用方实参、4 个豁免头）
- **越线文件 4 个**（609 / 588 / 557 / 545 行），步骤 9 补豁免头，不拆
- 待改文件里最贴近硬线但未越线的：`main/index.ts` 479 → 改后约 483、`PromptBuilder.cs` 475 → 改后 476（补一行 `using`，仍未越线）

## 七、审查收口对照

**首轮**（`compliance_report.md`【首轮】）

| 编号 | 问题 | 本版落点 |
|---|---|---|
| ❌1 | `generated-image-dir.ts` 调用方未列 | 步骤 6 补 `misc-handlers.ts:316-324` 实参；§三 列入 |
| ❌2 | 项目级文案只改 TS 一半 | 步骤 4 补 C# 三处镜像（226 / 108 / 339） |
| ❌3 | `project-status.md` 写读路径打架 | 步骤 4 补 599 / 607，与 `:141` 对齐 |
| ❌4 | 步骤 3 判据「剩 2 处」错 | 步骤 3 改为「恰好 3 处」并说明常量定义不被匹配 |
| ⚠️1 | 三个越线文件无豁免头 | 步骤 9 |
| ⚠️2 | 判定源实为两处（preview 分叉） | §一 改为 preload 单通道，renderer 不自行判定 |
| ⚠️3 | main 侧不认环境变量覆盖 | 步骤 6：`resolveProjectDirName()` 统一取值 |
| ⚠️4 | 未登记推翻 K3.5 老口径 | 风险 8 + 需求 §1 |
| ⚠️5 | 文档只同步 2 份 | 步骤 10 补 `README.md:107` / `AGENTS.md:142` |
| ⚠️6 | `ProjectArchivePage.tsx:82` 未写新增 import | 步骤 7 明写 |
| ⚠️7 | 真机缺 codegraph 落点 | 步骤 12 补第 ② 项 |
| ⚠️8 | 验收 6 无可执行检查点 | 步骤 12 补 mtime 对比 |

**复审**（`compliance_report.md`【复审】，9 条 ⚠️ 逐条映）

| 编号 | 问题 | 本版落点 |
|---|---|---|
| ❌A | `misc-handlers` 的取值来源会循环 import | §一 新增 `main/lib/data-dir.ts` 的 `resolveProjectDirName()` 作唯一入口；步骤 6 改用 |
| ❌B | `PromptBuilder.cs` 行号写成 333-337（实 339）；三个 Provider 缺 `Tools/Providers/` | 步骤 4 表与 §三 已订正 |
| ❌C | `PlanToolProvider.cs:65` 含字面 `{planId}`，转插值会 CS0103 | 步骤 4 明写须写 `{{planId}}` |
| ❌D | 漏一个越线文件：`AgentRuntimeGlobalTaskExecutor.cs` 545 行 | 步骤 9 改为四个文件 |
| ⚠️1 | 5 个 C# 文件缺 `using WishfulClaw.Infrastructure.Storage;` | 步骤 4 末条 |
| ⚠️2 | preload `index.d.ts` 已与运行时不符（既有问题） | 明确**不顺带对齐**，本刀不动 |
| ⚠️3 | `PROJECT_MEMORY_DIRNAME` 兼服务 SSH 远程项目 | 步骤 7 改为**已知边界登记**（5 个调用点实测 + 三条理由），签名不变 |
| ⚠️4 | §六 文件数 22 与 §三 34 不符、行数偏低 | §六 重算为 37 个文件 / 60~70 行 |
| ⚠️5 | 验收 2（打包版零变化）无可执行检查点 | 步骤 11 增 `test:project-dir`；步骤 12 末条真机目录对比 |
| ⚠️6 | §三 漏 `tests/project-dir/program.ts` 与 `package.json` | §三「其他」段补列，计 8 项 |
| ⚠️7 | 步骤 5 写 `<main 已算出的值>` 含义模糊 | 步骤 5 已点名 `resolveProjectDirName()` |
| ⚠️8 | §六「`main/index.ts` 479 改后不会再涨」为假 | 改为「改后约 483」，仍未越线 |
| ⚠️9 | 陈旧注释无处置；豁免头「当前行数」未说改前/改后 | 步骤 10 增注释订正条；步骤 9 明确写**改前实测行数** |

**第三轮复审**（`compliance_report.md`【第三轮复审】）

| 编号 | 问题 | 本版落点 |
|---|---|---|
| ❌E | `tests/project-dir` 第三例必崩：`data-dir.ts:1` import electron，node 下 `app === undefined` | §一 拆出纯函数 `pickProjectDirName(env, isPackaged)`，单测只打纯函数 |
| ❌F | 7 处里 4 处是普通 `""` 不是插值，照「加表达式即可」改会编译过、模型收到字面量 | 步骤 4 改为 A 类（3 处已插值）/ B 类（4 处先补 `$`）分类改 + 逐行回读要求 |
| ❌G | plan 写的 `memory-snapshot.ts:78-79` 调用点不存在；真链路另有 4 个调用点 | 步骤 7 改为 5 个调用点实测 + 已知边界登记，不动签名 |
| ❌H | 步骤 4 判据「只剩 1 处 + 注释」不可判真伪；§七 复审 9 条只映 5 条 | 步骤 4 改为逐行回读 + 可执行 PowerShell 一行式；§七 补齐 9 条 |
| ⚠️1 | 步骤 10 误称 `README.md:107` / `AGENTS.md:142` 写着 `.wishful-claw/notes/`（原文无 `notes/`） | 步骤 10 按原文订正，并明确「两处有意不区分」 |
| ⚠️2 | 步骤 11 缺 import 路径与 script 行 | 步骤 11 补 import 写法 + `package.json` 脚本行 + 「不得调 `resolveProjectDirName`」 |
| ⚠️3 | §六「`PromptBuilder.cs` 475 只改一行不涨」为假 | 改为「475 → 476（补一行 `using`）」 |
| ⚠️4 | `PROJECT_DATA_DIR_NAME` 有无 `??` 兜底两处自相矛盾；d.ts 类型影响 `joinFsPath` typecheck | 步骤 7 定死：preload 不兜底、d.ts 声明 `?string`、**只在 `project-data-dir.ts` 兜底一次**并标注 `: string` |
| ⚠️5 | `resolveProjectDirName()` 注释说「调纯函数」、步骤 6 却内联 `\|\|` ⇒ 纯函数单测漏 main 侧语义 | 步骤 6 给出薄壳实现体，禁止别处内联 |
| ⚠️6 | 豁免头「改前行数」与 `AGENTS.md`「当前行数」相抵；`PlanExecutor:1-7` 版权块位置未说 | 步骤 9 明确放第一行 + 写注入后重数的行数 |
| ⚠️7 | §七 第三轮只映 4 条 ❌ | 本表补 7 条 ⚠️ |

**第四轮复审**（`compliance_report.md`【第四轮复审】）

| 编号 | 问题 | 本版落点 |
|---|---|---|
| ❌1 | 步骤 11 第 3 例仍点名 `resolveProjectDirName`（引 electron，node 下必崩） | 步骤 11 改为三例全打 `pickProjectDirName`，并显式写「绝不能调 `resolveProjectDirName`」 |
| ❌2 | 步骤 12 验收编号错位（需求 §7 是 1 项目隔离 / 2 打包零变化 / 3 项目记忆 / 4 全局记忆 / 5 门禁 / 6 全局路径） | 步骤 12 按原编号重排；验收 2 与 5 明确归属步骤 11 |
