# S-223 阶段三合规审查报告

> 审查对象：`docs/plans/iter-v3-1/plan-s223/plan.md`、`docs/plans/iter-v3-1/requirements/S-223.md`
> 依据：`AGENTS.md`、`docs/dev-workflow.md`、`docs/data-storage.md`
> 审查方式：**只读**。所有数字均在 2026-10-23 用源码 grep / `[IO.File]::ReadAllLines().Count` / csproj 实读复核，未采信文档自述。

## 一、结论

**❌ 4 条 / ⚠️ 8 条 / ✅ 12 条。**

❌ > 0 ⇒ **禁止进入阶段四**。4 条必修项都能在阶段二用 5~15 行文字改完（其中 2 条要把新增改点补进「步骤清单 / 涉及文件」，2 条是改判据与文案口径），不需要重做方案骨架。

方向与分层没问题：单一判定源、纯函数注入、`ProjectDirName` 放 Infrastructure、CodeGraph 全局路径不动、`generated-image-dir` 保持无 electron 依赖，这些都经源码核实成立。问题集中在**「项目级路径」的第二类载体 —— 提示词 / 工具描述里的路径文案**，以及**两条验证判据写错**（一条会诱导误改全局 Root，一条会让 dev 的项目图继续写生产目录）。

另外顺带纠正一个计数口径：任务描述里的「19 处 DataDirName 替换」应理解为「需求 §3.3 列举的 19 个引用位置（11 处 C# + 8 处 TS 文件级）」；**真正要改的是 16 处（C# 11 + TS 5）**，其余 3 处 C# / 4 处 TS 明确不改。

## 二、❌ 必修项

### ❌ 1. `generated-image-dir.ts` 加可选参数，但没把调用方列进来 —— dev 的项目生成图会继续写生产目录

**问题**：步骤 5 只写「加可选参数 `projectDirName?: string`（默认 `WISHFUL_CLAW_DATA_DIR_NAME`），由调用方传入」，而「三、涉及文件」里没有主进程调用方。实际调用方存在且会带着 `scope: 'project'` 进来，不传新参数就静默回退到裸名 —— **dev 实例截图/生成图仍落 `{workingFolder}/.wishful-claw/image`**，与需求 §2「生成图」直接冲突，验收 1/3 必然不达标。

**证据**：
- `src/main/lib/generated-image-dir.ts:61` — `return join(workingFolder, WISHFUL_CLAW_DATA_DIR_NAME, GENERATED_IMAGES_SUBDIR)`
- `src/main/ipc/misc-handlers.ts:310-320` — IPC `image:persist-generated` 把 `scope / workingFolder / projectId / sshConnectionId` 原样透传，末尾参数是 `resolveDataDir()`（全局根），**没有第三参**
- `src/main/lib/image-persist.ts:76` — 兜底路径 `resolveGeneratedImagesDir({}, resolveDataDir())`（空 scope → 全局，不受影响，可不动）

**建议改法**：
- 「三、涉及文件」增 `src/main/ipc/misc-handlers.ts` — 改（`:316-320` 第三个实参补 `projectDataDirName(!app.isPackaged)`）；
- 步骤 5 的验证里加一条：「`grep -n "resolveGeneratedImagesDir(" src/main` 中，凡带 `scope: 'project'` 的实参位置都已补第三参」；
- 同时明确 `image-persist.ts:76` 不改（空 scope 走全局，与 dev 已隔离的 dataRoot 一致）。

### ❌ 2. 项目级路径文案只改 TS 一半：`task-board-store.ts:104` 改了，镜像的 C# 原文没改

**问题**：`task-board-store.ts:104` 被列进 5 处必改，但它是 C# 侧 `AgentRuntimeGlobalTaskExecutor.cs:226` 的**显式镜像**（`task-board-store.ts:97` 注释原话：「mirrors `AgentRuntimeGlobalTaskExecutor.SendWorkRequestAsync`」）。只改一边，结果是同一条「全局 agent 派活」消息，从任务板发出说 `.wishful-claw-dev/notes/`，从 C# 通道发出说 `.wishful-claw/notes/` —— dev 实例里模型按后者把 notes 写进生产目录，正是本需求要消灭的污染。同类还有 `GlobalTaskToolsProvider.cs:108`（`send_work_request` 工具描述）与 `PromptBuilder.cs:339`（项目上下文系统提示词），它们让模型写 `notes/` 的行为场所与 `task-board-store` 完全同类。

**证据**：
- `src/renderer/src/stores/task-board-store.ts:97,104`（镜像注释 + 待改行）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalTaskExecutor.cs:226` — `` "for it belong in `.wishful-claw/notes/`, not loose in the project tree. When you finish, " `` （与 TS 逐字同源）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/GlobalTaskToolsProvider.cs:108` — `` "`.wishful-claw/notes/` in its project, not loose in the project tree." ``
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs:339` — `` "- Scratch notes, briefs and other temporary documents belong in `.wishful-claw/notes/`, not loose in the project tree." ``

**建议改法**：二选一，必须写死在计划里，不能留空。
- **推荐**：三处 C# 一律插值 `WishfulClawDataDir.ProjectDirName`（都是插值字符串，改 3 行），与 TS 对齐；这才能让「dev 的临时文档也进 `-dev`」闭环。
- 次选：本次**不动** `task-board-store.ts:104`（把 TS 5 处降为 4 处），并在「五、风险与边界」写明「提示词/工具描述文案不在本需求范围，dev 下 notes 仍写裸名，另记」。**但这一选项下必须删掉 `-dev` 的文案改动**，否则口径必分裂。

### ❌ 3. `AgentRuntimeProjectExecutor.cs:599/607` 让模型写裸 `.wishful-claw/project-status.md`，与 `:141` 改后的读路径打架

**问题**：`:141` 是项目级真实读写（改成 `{workingFolder}/{ProjectDirName}/project-status.md`），而同一个类的 `GenerateStatusUpdateTemplate` 生成给模型的模板消息仍写死裸名，且 `:607` 直接拼了 `{workingFolder}`。dev 实例下：`get_project_details` 找不到状态文件 → 发模板 → 模型照模板写到 `.wishful-claw/project-status.md` → 下次仍找不到 → **反复重发**（`ProjectToolsProvider.cs:32` 的工具描述也写「Reads .wishful-claw/project-status.md」，会强化这个错误路径）。这不是文案洁癖，是 dev 下的功能缺陷。

**证据**：
- `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:141` — `var statusFilePath = Path.Combine(project.WorkingFolder, WishfulClawPaths.DataDirName, "project-status.md");`（计划已列）
- 同文件 `:599` — `` $"and write a clean summary to `.wishful-claw/project-status.md` in the working directory.\n\n" ``
- 同文件 `:607` — `` $"at `{workingFolder}/.wishful-claw/project-status.md`." `` ← **显式拼 `workingFolder` 的项目级路径**，按判定标准属必改
- `src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs:32` — 描述里同裸名

**建议改法**：
- 步骤 3 表格增 2 行：`AgentRuntimeProjectExecutor.cs` 的 `:599` / `:607` → 用 `WishfulClawDataDir.ProjectDirName` 插值（`:607` 改成 `` $"at `{workingFolder}/{WishfulClawDataDir.ProjectDirName}/project-status.md`." ``）；
- `ProjectToolsProvider.cs:32` 的 `SetDescription` 是占位符注册（无插值上下文），改成中性表述（`project-status.md under the project's Wishful Claw data dir`）或与 `PlanToolProvider.cs:65` 一并在计划里显式标注「不改，理由：描述不含具体目录名」——二者选一，别留白。

### ❌ 4. 步骤 3 的验证判据「只剩 2 处」是错的（实际 3 处），照做会诱导把全局 `Root` 改成 `ProjectDirName`

**问题**：改完后 `grep -n "WishfulClawPaths\.DataDirName"` 命中 **3 处**，不是 2 处；计划点名的「常量定义」在 `WishfulClawPaths.cs:5` 写作 `public const string DataDirName`，**根本不含 `WishfulClawPaths.` 前缀，不被该模式匹配**。判据缺口最危险的地方：执行者为了「凑到 2 处」，最自然的动作就是把 `WishfulClawDataDir.cs:17`（`Root`，拼 `UserProfile`）也换掉 → 直接产出 `~/.wishful-claw-dev-dev`，即计划自己写的风险 4。

**证据**（当前源码，改前 12 处命中，改后按计划应为 3 处）：
```
src\runtime\WishfulClaw.Infrastructure\Storage\WishfulClawDataDir.cs:17   ← 全局 Root，必须保持 DataDirName
src\runtime\WishfulClaw.Infrastructure\Storage\WishfulClawDataDir.cs:44   ← EnsureProjectRoot，会被改成 ProjectRoot()
src\runtime\WishfulClaw.CodeGraph\Support\CodeGraphDataDir.cs:56          ← 全局（home），必须保持 DataDirName
+ 步骤 2 新增的 ProjectDirName 回退值处（`? configured : WishfulClawPaths.DataDirName`）
```
即改后 = `:17` + `:56` + 新回退值 = **3 处**。

**建议改法**：把判据改写成可判真伪的形式：
> 验证：`Select-String -Pattern "WishfulClawPaths\.DataDirName"` 命中 **恰好 3 处**，且必须是 ① `WishfulClawDataDir.cs` 的 `Root`（`UserProfile` 分支）② `WishfulClawDataDir.cs` 的 `ProjectDirName` 回退值 ③ `CodeGraphDataDir.cs:56`；`WishfulClawPaths.cs:5` 的常量定义保持 `DataDirName = ".wishful-claw"` 不变。任何一处出现在 `workingFolder` 拼接里 = 漏改，任何一处 `Root`/`CodeGraphDataDir` 被换成 `ProjectDirName` = 多改（`-dev-dev`）。

## 三、⚠️ 建议项

1. **⚠️ 大文件规则：§六「无文件超 500 行」与实测不符，且 3 个超限文件都没有豁免头。**
   实测（`[IO.File]::ReadAllLines().Count`，UTF-8 无 BOM 可靠）：`AgentRuntimePlanExecutor.cs` **557**、`AgentRuntimeProjectExecutor.cs` **609**、`src/main/lib/native-worker.ts` **588**。计划写「最大 native-worker.ts 当前 540+ 需实测确认豁免头」，三个数都不对，且「无文件超 500 行」是假命题。`AGENTS.md` §大文件拆分第 5 条：超 500 行必须要么拆分，要么在**文件头注明豁免理由与当前行数**，否则审查按 ❌ 处理（仓库先例：`src/main/channels/providers/qq/qq-service.ts:7`、`src/main/ipc/terminal-handlers.ts:9`）。
   建议：修 §六 数字，并在本刀顺手给这 3 个文件头补豁免注（各 2~3 行注释，成本极低），否则阶段五审查大概率按 ❌ 记你账上。`ProjectArchivePage.tsx` 445 行、`PersonaStore.cs` 344 行、`PathBoundary.cs` 297 行都安全。

2. **⚠️ 判定源其实不是「只有主进程一处」**，与需求 §4.1 与风险 1 的处置自相矛盾。
   main 用 `!app.isPackaged`（`src/main/lib/data-dir.ts:14`），renderer 用 `import.meta.env?.DEV`。`npm start` = `electron-vite preview` 时两者分叉：主进程 `isPackaged=false` → worker 写 `-dev`；renderer 是生产构建 `DEV=false` → 档案页读写 `.wishful-claw`。建议：主进程启动时把结果写进 `process.env.WISHFULCLAW_PROJECT_DIR`，renderer 复用同一来源（已有先例：`project-archive-helpers.ts:82-85` 的 `getHomeDir()` 就是读 `window.electron?.process?.env`）；若决定接受 `preview` 场景分叉，请在「五、风险与边界」显式记一条。

3. **⚠️ 主进程侧不认 `WISHFULCLAW_PROJECT_DIR` 手工覆盖，与 C# 侧不对称。**
   C# 侧 `ProjectDirName` 优先读环境变量（风险 5 的处置依赖这一点），而 main 侧算的是 `projectDataDirName(!app.isPackaged)`，忽略 env。冒烟/隔离跑用 `WISHFULCLAW_DATA_DIR=...`（`data-dir.ts:11-12` 支持）时，全局隔离了、项目级没隔离。建议 main 侧同构：`process.env[WISHFULCLAW_PROJECT_DIR_ENV]?.trim() || projectDataDirName(!app.isPackaged)`。

4. **⚠️ 与既有决策冲突没有登记。** `docs/plans/iter-v2-27/plan.md:78`（「项目级永不加 dev 后缀 —— 改名等于污染别人的工作区」）、`:289`、`:346`（K3.5「dev 实例工作区必须仍是 `.wishful-claw/`」）、`:350` 是老口径。历史计划文档当然不改，但本 plan 应加一段「本需求推翻 iter-v2-27 K3.5」，否则后续迭代一致性审查会反复拿 K3.5 来打这一刀。

5. **⚠️ 文档同步面偏窄。** 除 `docs/data-storage.md`（113 行，`### 项目工作区` 节）与 `docs/development.md:135`（`> **数据目录：** 生产 ~/.wishful-claw/，开发态 ~/.wishful-claw-dev/`）外，真源候选还有：`README.md:107`（「项目级数据在 `{项目目录}/.wishful-claw/`」，对终端用户仍成立，建议加注「开发版落 `-dev`」）、`AGENTS.md:142`（「`.wishful-claw/` 目录下」）。至少要在步骤 8 写一句「README / AGENTS.md 为何不改」，别留空。
   另外 `docs/development.md` 里的环境变量表（若有）建议补 `WISHFULCLAW_PROJECT_DIR`。

6. **⚠️ `ProjectArchivePage.tsx:82` 的 import 变更没写。** 该文件当前只从 `./project-archive-helpers` 取 `WISHFUL_CLAW_DIR`（`:29`），改为全局常量需新增 `import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'`（或从 helpers 再导出一个 `GLOBAL_WISHFUL_CLAW_DIR`，更不易再被误用）。步骤 6 建议显式点出，并在改后 grep 复核 `:82` 用全局常量、`:85` 用 `WISHFUL_CLAW_DIR`。

7. **⚠️ 真机验证缺 codegraph 落点。** 需求 §2 明列 codegraph 索引，步骤 10 只写「记忆 / 计划任一」。建议加一条：项目档案页触发一次索引，确认 `{工作Folder}/.wishful-claw-dev/codegraph/graph.db` 出现、`.wishful-claw/codegraph` 未新建；顺带验 `~/.wishful-claw-dev/codegraph` 未出现 `-dev-dev`。

8. **⚠️ 验收 6（全局路径未受影响）没有对应的可执行检查点。** 步骤 3 的 grep 只覆盖 C#；TS 侧「不改的 4 处」（`codegraph-handlers.ts:159-160`、`codegraph-project-index.tsx:85`、`codegraph-availability.ts:40`、`SkillsMenu.tsx:371/417`）没有任何验证。建议加一条「改后 `git diff` 逐文件核对这 4 处零改动」+ `npm run test:codegraph-availability`（该测试断言 `${WISHFUL_CLAW_DATA_DIR_NAME}/projects/...`，见 `tests/codegraph-availability/program.ts:36,155`，能顺带兜住）。

## 四、✅ 通过项

1. **C# 项目级清单准确（11 处，无漏无多）。** 全仓 `DataDirName` 命中 12 行：11 行拼 `workingFolder`（全在清单内）+ 1 行拼 `UserProfile`（`WishfulClawDataDir.cs:17`）。`CodeGraphDataDir.cs:56` 拼 `home`，正确划为不改。
2. **TS 项目级清单准确（5 处）。** 全仓 `WISHFUL_CLAW_DATA_DIR_NAME` 命中 11 行 / 8 文件，5 行属项目级（`codegraph-handlers.ts:171`、`generated-image-dir.ts:61`、`memory-files.ts:10`、`project-archive-helpers.ts:42`、`task-board-store.ts:104`），其余 6 行为 `~/` 或 `dataRoot` 相对路径（全局，dev 已由 `resolveDataDir()` 隔离）。
3. **分层依赖成立。** 实读 csproj：Workspace → Contracts+Infrastructure；Persona → Contracts+Core+Workspace+Infrastructure；Agent → Contracts+Core+Persona+Infrastructure。10 处调用方全部能触及 Infrastructure。
4. **CodeGraph 确实不引用 Infrastructure**（`WishfulClaw.CodeGraph.csproj` 仅 Contracts + Core），所以把解析入口放 `WishfulClawDataDir` 不会破坏依赖方向；计划把唯一那处 CodeGraph 引用划为不改，方向正确。
5. **`ProjectDirName` 不放在 `shared/project-dir.ts` 里读 `import.meta.env` 的论证成立。** `tsconfig.node.json` 与 `tsconfig.web.json` 都 include `src/shared/**/*`，`import.meta.env` 在 node 配置下无类型；纯函数 + 传参是正解。`@shared` 别名两边都通（`tsconfig.web.json:18`、`electron.vite.config.ts:27`）。
6. **`ProjectArchivePage.tsx:82` 判断正确。** `:82` = `joinFsPath(home, WISHFUL_CLAW_DIR, 'projects', id)`（SSH 全局镜像，`:76-77` 注释也写明），`:85` = `joinFsPath(workingFolder, WISHFUL_CLAW_DIR)`（项目级）。只换常量值必错，`:82` 必须显式回全局常量 —— 计划把这一条写进「风险 1」并要求审查复核，处置正确。
7. **`generated-image-dir.ts` 加可选参数不破坏现有断言。** `tests/generated-image-dir/program.ts` 全部调用都是 1~2 实参（`:39-185`），默认值保持 `WISHFUL_CLAW_DATA_DIR_NAME` 时 `:54-60`（`join(WORKING_FOLDER,'.wishful-claw','image')`）与 `:182-184`（落点与 dataRoot 无关）继续成立；该测试经 esbuild 直接 bundle 源码且**无 `@shared` 别名**，说明模块确实只依赖相对 import，保持无 electron 依赖的方案可行。
8. **`codegraph-handlers.ts:171` 划为改、`:159-160` 划为不改，正确。** `:159-160` 是 SSH 覆盖路径的 `~/` 前缀规范化（与 `resolveDataPath` 同源，global），`:171` 是项目本地 codegraph 根（真正写盘）。
9. **`.gitignore` 补 `.wishful-claw-dev/` 必要且安全**：当前只有 `.wishful-claw/*`（行尾附近），`-dev` 未被覆盖；补目录级忽略不影响既有条目。
10. **`npm test` 基线 79/79 属实**（`docs/plans/iter-v3-1/plan-s222/verification_report.md:17`），步骤 9 的「不得倒退」是可执行判据。
11. **验收标准 6 条 → 步骤映射基本闭合**：1/3/4 → 步骤 10；2 → 步骤 4/5/6（代码核对）；5 → 步骤 9；6 → 步骤 3 grep（但见 ⚠️ 8）。11 个步骤除步骤 11（提交）与步骤 7（gitignore 目视）外都自带验证方式，无「裸步骤」。
12. **不做迁移 / 不动 `out/` / 不自动改用户 `.gitignore` 三条边界**与需求 §5、老大原话一致，`EnsureProjectRoot` 复用现有 `HideOnWindows` 让 `-dev` 目录同样隐藏，行为连贯。

## 五、我亲自核对的证据

### 5.1 C#：项目级 vs 全局（全仓 `src` + `tests`，排除 obj/bin 后的有效命中）

```
Select-String -Path (Get-ChildItem -Recurse -Include *.cs -File src,tests) -Pattern "DataDirName"
```
| 文件:行 | 拼接基准 | 判定 |
|---|---|---|
| `WishfulClaw.Agent/Goal/GoalFileTools.cs:18,23,28` | workingFolder | 改（3 处） |
| `WishfulClaw.Agent/Goal/GoalPlanTracker.cs:28` | workingFolder | 改 |
| `WishfulClaw.Agent/AgentRuntimePlanExecutor.cs:158` | workingFolder | 改 |
| `WishfulClaw.Agent/AgentRuntimePlanExecutor.Helpers.cs:26` | workingFolder | 改 |
| `WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:141` | project.WorkingFolder | 改 |
| `WishfulClaw.Agent/SystemPromptCache.cs:94` | workingFolder | 改 |
| `WishfulClaw.Persona/PersonaStore.cs:34` | workingFolder | 改 |
| `WishfulClaw.Workspace/Memory/MemoryPathResolver.cs:65` | workingFolder | 改 |
| `WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs:44` | workingFolder | 改（步骤 2） |
| `WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs:17` | UserProfile | **不改** |
| `WishfulClaw.CodeGraph/Support/CodeGraphDataDir.cs:56` | home | **不改** |
| `WishfulClaw.Contracts/WishfulClawPaths.cs:5` | 常量定义 | **保留** |

⇒ 与需求 §3.3 的 11 + 2 + 1 完全吻合。**但**额外搜 `.wishful-claw` 字面量发现项目级路径文案 7 处未进清单（见 ❌ 2 / ❌ 3）：
`AgentRuntimeProjectExecutor.cs:599,607`、`PromptBuilder.cs:339`、`AgentRuntimeGlobalTaskExecutor.cs:226`、`GlobalTaskToolsProvider.cs:108`、`PlanToolProvider.cs:65`、`ProjectToolsProvider.cs:32`。

### 5.2 TS：全仓 `WISHFUL_CLAW_DATA_DIR_NAME`（src + tests + scripts）

11 命中 / 8 文件：`codegraph-handlers.ts:8,159,160,171`、`data-dir.ts:5,15,16`、`generated-image-dir.ts:15,61`、`codegraph-project-index.tsx:17,85`、`project-archive-helpers.ts:3,42`、`SkillsMenu.tsx:46,371,417`、`codegraph-availability.ts:11,40`、`memory-files.ts:3,10`、`task-board-store.ts:24,104`、`shared/data-dir.ts:1`、`tests/codegraph-availability/program.ts:6,36,155`。
`WISHFUL_CLAW_DIR` 另命中：`project-archive-helpers.ts:42`（定义）、`ProjectArchivePage.tsx:29,82,85`、`main/ipc/extension-plugin-sync.ts:18-19,71`（`resolveDataDir()` → 全局，不改）。
`PROJECT_MEMORY_DIRNAME`：`memory-files.ts:10`（定义）、`:225`（`joinFsPath(projectRootPath, PROJECT_MEMORY_DIRNAME, ...)` 项目级）。
⇒ TS 5 处必改 + 4 处（8 行）不改，与文档一致。

### 5.3 csproj 依赖（逐文件实读）

```
WishfulClaw.Agent.csproj          → Contracts, Core, Persona, Infrastructure
WishfulClaw.Persona.csproj        → Contracts, Core, Workspace, Infrastructure
WishfulClaw.Workspace.csproj      → Contracts, Infrastructure
WishfulClaw.Infrastructure.csproj → Contracts, Core
WishfulClaw.CodeGraph.csproj      → Contracts, Core      ← 无 Infrastructure
WishfulClaw.Worker.csproj         → 全部（含 CodeGraph）
```

### 5.4 行数实测（`[IO.File]::ReadAllLines($p).Count`）

| 文件 | 行数 | 结论 |
|---|---|---|
| `WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | **609** | 超 500，**无豁免头** |
| `src/main/lib/native-worker.ts` | **588** | 超 500，**无豁免头** |
| `WishfulClaw.Agent/AgentRuntimePlanExecutor.cs` | **557** | 超 500，**无豁免头** |
| `ProjectArchivePage.tsx` | 445 | 安全 |
| `PersonaStore.cs` | 344 | 安全 |
| `PathBoundary.cs` | 297 | 安全（不改） |
| `task-board-store.ts` | 296 | 安全 |
| `memory-files.ts` | 296 | 安全 |
| `GoalPlanTracker.cs` | 201 | 安全 |
| `tests/generated-image-dir/program.ts` | 187 | 安全 |
| `codegraph-handlers.ts` | 181 | 安全 |
| `GoalFileTools.cs` | 140 | 安全 |
| `project-archive-helpers.ts` | 133 | 安全 |
| `AgentRuntimePlanExecutor.Helpers.cs` | 126 | 安全 |
| `SystemPromptCache.cs` | 125 | 安全 |
| `docs/data-storage.md` | 113 | 安全 |
| `MemoryPathResolver.cs` | 82 | 安全 |
| `WishfulClawDataDir.cs` | 70 | 安全 |
| `generated-image-dir.ts` | 66 | 安全 |
| `WishfulClawPaths.cs` | 7 | 安全 |

### 5.5 其他核对

- `src/shared/data-dir.ts` 现有 3 个导出（`WISHFUL_CLAW_DATA_DIR_NAME` / `WISHFULCLAW_DATA_DIR_ENV` / 两个显示名），计划新建 `src/shared/project-dir.ts` 不冲突。
- `src/preload/index.ts` / `index.d.ts` **没有** 任何 `isDev` / `isPackaged` 暴露（无命中），renderer 确实拿不到主进程判定 ⇒ 计划选 `import.meta.env?.DEV` 属现有条件下的合理退路（先例 `streaming-perf.ts:45`），但见 ⚠️ 2 的分叉风险。
- `EnsureProjectRoot` 唯一调用方 `AgentLoop.cs:195`，改内部实现不影响签名。
- C# 测试无任何对「项目级 `.wishful-claw`」的硬断言：`tests/TestSupport/TestOutputRoot.cs:32` 是仓库内测试产物目录，`tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs:98-113` 的 `prodLike/devLike/ghostRoot` 都是**全局数据根**（配合 `WISHFULCLAW_DATA_DIR`），本改动不会打破。
- `.gitignore` 现状含 `.wishful-claw/*`、`logs/`、`out/`、`release/`，无 `.wishful-claw-dev`。
- 既有事项：`docs/plans/iter-v2-27/plan.md:78,289,346,350` 的老口径（项目级永不加 `-dev`）与本需求相反。

---

# 【复审】（第二轮 · 2026-10-23 17:20）

> 首轮正文以上原文保留，**一字未改**。本节只写对首轮 4 条 ❌ 的验收、对 4 个重点判据的亲自复核、以及新版 plan 新引入的问题。
> 复核方式：仍为**只读**。所有计数用 `Get-ChildItem -Recurse -Filter *.cs` + `Select-String`（已确认真递归、已排除 `obj` / `bin`）、行数用 `[IO.File]::ReadAllLines($p).Count`，未采信 plan 任何自述数字。

## 【复审】结论

**❌ 4 条 / ⚠️ 9 条 / ✅ 13 条。❌ > 0 ⇒ 禁止进入阶段四。**

首轮 4 条 ❌ **内容上全部收口**（没有出现「表里写了但正文没落」的情况）：7 处裸字符串逐条对到源码行，判据「恰好 3 处」实测成立，调用方与 599/607 都进了步骤表。方向与分层仍然成立，preload 单通道方案在 Electron 43.2.0 + `sandbox: false` 下可落地。

但这一版在**扩面过程中新增了 4 个必修项**，全部集中在「步骤 4 / 步骤 9 的实施细节」：

1. 步骤 4 的 3 处引用写错（`PromptBuilder.cs` 行号 333-337 → 实际 339；3 个 Provider 文件路径缺 `Tools/Providers/` 子目录）；
2. 步骤 4 的统一改法「字面量 → 插值，加表达式即可」对 `PlanToolProvider.cs:65` **不成立**（该串含字面 `{planId}`，直接改 `$"..."` 会编译错）；
3. 步骤 9 的「本次要改的 3 个越线文件」漏了第 4 个：步骤 4 新纳入的 `AgentRuntimeGlobalTaskExecutor.cs` 实测 **545 行**，同样超 500 且无豁免头；
4. 步骤 6 没说 `misc-handlers.ts` 的 `projectDirName` **值从哪来** —— 照 plan「从 `main/index.ts` 导出常量复用」会造出循环 import，照首轮的 `projectDataDirName(!app.isPackaged)` 又会丢掉 `WISHFULCLAW_PROJECT_DIR` 覆盖（即 §五 风险 3 的收口失效）。

这 4 条都是 5~15 行文字/清单改动能收口的，不需要重做骨架。

## 【复审】首轮 4 条 ❌ 的验收

| 编号 | 首轮问题 | 是否真收口 | 证据（我亲自核到的源码与 plan 落点） |
|---|---|---|---|
| ❌1 | `generated-image-dir.ts` 加可选参数但调用方未列 | **是（按首轮要求已收口）**，但引出一个新的值来源缺口，见复审 ❌A | plan 步骤 6 已写「调用方必须同改：`src/main/ipc/misc-handlers.ts` 的 `resolveGeneratedImagesDir(...)` 漏传第三个参数 ⇒ `scope:'project'` 静默回退裸名」，§三 也列了 `misc-handlers.ts — 改（补第三实参）`；调用点实测确为 `misc-handlers.ts:316-324`（第二实参 `resolveDataDir()`，无第三参），全仓 `resolveGeneratedImagesDir` 的**唯一**生产调用方就是它（`:6` import、`:316` 调用），`image-persist.ts:76` 只传 `{}`（全局），与 plan「不改」一致 |
| ❌2 | 项目级文案只改 TS 一半（`task-board-store.ts:104` 改了、C# 镜像没改） | **是** | plan 步骤 4 表已含 `AgentRuntimeGlobalTaskExecutor.cs:226`、`GlobalTaskToolsProvider.cs:108`、`PromptBuilder.cs`；三行源码逐一核到：`:226` = `"for it belong in \`.wishful-claw/notes/\`, not loose in the project tree. When you finish, " +`、`:108` = `"\`.wishful-claw/notes/\` in its project, not loose in the project tree.",`、`PromptBuilder.cs:339` = `- Scratch notes, briefs and other temporary documents belong in \`.wishful-claw/notes/\`, not loose in the project tree.`。TS 镜像 `task-board-store.ts:104` 已在步骤 7 同刀改，`:97` 的「mirrors ...」注释仍在，两侧对齐成立 |
| ❌3 | `:599` / `:607` 让模型写裸 `.wishful-claw/project-status.md`，与 `:141` 打架 | **是** | plan 步骤 4 表含 `AgentRuntimeProjectExecutor.cs` `599` 与 `607`，两行实测：`:599` = `$"and write a clean summary to \`.wishful-claw/project-status.md\` in the working directory.\n\n" +`、`:607` = `$"at \`{workingFolder}/.wishful-claw/project-status.md\`.";`（正是显式拼 `workingFolder` 的那一处）；`:141` 的读路径仍在步骤 3 表内，读写同刀。另外 `ProjectToolsProvider.cs:32` 与 `PlanToolProvider.cs:65` 也一并进了步骤 4 表，没有留白 |
| ❌4 | 判据「只剩 2 处」错，照做会诱导改全局 `Root` | **是，判据已可判真伪** | plan 步骤 3 改为「恰好 3 处」并显式说明「`WishfulClawPaths.cs:5` 是 `public const string DataDirName`，不含 `WishfulClawPaths.` 前缀，不被该模式匹配」。**实测成立**，见下面「我亲自核对的证据」第 1 条：改前 13 命中 = 11 项目级 + `Root`(`:17`) + `CodeGraphDataDir.cs:56`；11 处换成 `ProjectDirName` 后剩 2 处，加步骤 2 新增的回退值 = **3 处**，且三处正是 plan 列的三处 |

## 【复审】❌ 必修项

### ❌ A. 步骤 6 没说 `misc-handlers.ts` 的 `projectDirName` 值从哪来 —— 两条路都是坑（循环 import / 丢掉 env 覆盖）

**问题**：plan §一 定的是「主进程算一次、三路分发」，步骤 6 第一句写「`src/main/index.ts` 模块顶层……**导出常量**供 workerEnv 与 additionalArguments 复用」，但对**第三个消费方**（`misc-handlers.ts` 的项目生成图）只写「补 `projectDirName` 实参」，没写这个实参取什么。执行者只有两种自然选择，两种都错：

- 从 `../index` import ⇒ **循环 import**：`src/main/index.ts:8` 已经 `import { latchNativeWorkerShutdown } from './lib/native-worker'`、`:52` `import { registerMiscHandlers } from './ipc/misc-handlers'`；全仓 `src/main` 下**没有任何一处** `from '../index'` / `from './index'`（实测 0 命中），这条惯例不能破。
- 就地写 `projectDataDirName(!app.isPackaged)` ⇒ **丢掉 env 覆盖**：`misc-handlers.ts:1` 现在只 `import { BrowserWindow, Notification, dialog, shell, webContents } from 'electron'`，连 `app` 都没导入；而 `codegraph-handlers.ts:171` 用的是 plan 的 `<值>`（含 env 覆盖）。结果：手工 `WISHFULCLAW_PROJECT_DIR=xxx` 冒烟时，codegraph 走 `xxx`、生成图走 `-dev` ⇒ §五 风险 3 的收口（「main 侧同构认 env」）在这一处漏掉。

**建议改法**（一处改、三处用）：
- 在 `src/main/lib/data-dir.ts`（已有 `resolveDataDir` / `resolveDataPath`，是 main 侧唯一数据目录真源）新增
  ```ts
  export function resolveProjectDirName(): string {
    const configured = process.env[WISHFULCLAW_PROJECT_DIR_ENV]?.trim()
    return configured || projectDataDirName(!app.isPackaged)
  }
  ```
  并在模块顶层回写 `process.env[WISHFULCLAW_PROJECT_DIR_ENV] = value`（子进程继承，`native-worker.ts:184` 的 `...process.env` 自动带走，步骤 5 因此可以退化成「验证继承生效」）。
- 步骤 6 改成「`index.ts` / `misc-handlers.ts` / `native-worker.ts` 一律 `import { resolveProjectDirName } from './lib/data-dir'`（或 `../lib/data-dir`），**不从 `main/index.ts` 导出**」。
- 验证加一条：`Select-String -Pattern "projectDataDirName\(|resolveProjectDirName\(" src/main` 中，生产代码只允许出现在 `lib/data-dir.ts` 一处。

### ❌ B. 步骤 4 的 3 处引用与源码不符（1 个行号 + 3 个路径）

**问题**：步骤 4 表拿来实现是要「照着定位要改的字面量」的，这几处照着找会落空或找错行：

| 项 | plan 写的 | 源码实测 |
|---|---|---|
| `PromptBuilder.cs` 行号 | `333-337` | **339**（`:335` 是 `return $"""`，`:336` `## Project`，`:337` `- Working Folder:`，`:338` `All relative paths...`，**`:339` 才是 Scratch notes 那条**，`:340` 闭合 `"""`）。首轮报告写的 339 是对的，本版反而改错 |
| `ProjectToolsProvider.cs` 路径 | `WishfulClaw.Agent/ProjectToolsProvider.cs` | `WishfulClaw.Agent/**Tools/Providers/**ProjectToolsProvider.cs` |
| `PlanToolProvider.cs` 路径 | `WishfulClaw.Agent/PlanToolProvider.cs` | `WishfulClaw.Agent/**Tools/Providers/**PlanToolProvider.cs` |
| `GlobalTaskToolsProvider.cs` 路径 | `WishfulClaw.Agent/GlobalTaskToolsProvider.cs` | `WishfulClaw.Agent/**Tools/Providers/**GlobalTaskToolsProvider.cs` |

§三「涉及文件」里 `WishfulClaw.Agent/ProjectToolsProvider.cs / PlanToolProvider.cs / GlobalTaskToolsProvider.cs` 也是同样的短路径，同样要修。**建议**：表里改 `333-337` → `339`，三处路径补 `Tools/Providers/`，并在步骤 4 表头注明「行号为 2026-10-23 实测，改前请再 grep 一次」。

### ❌ C. 步骤 4 的统一改法「字面量 → 插值，加表达式即可」对 `PlanToolProvider.cs:65` 不成立（含字面 `{planId}`）

**问题**：步骤 4 写「改法：字面量 → 插值 `{WishfulClawDataDir.ProjectDirName}`（这些串本身已是 `$"…"` 或 `$"""…"""`，加表达式即可）」。但 `PlanToolProvider.cs:65` 的原文是**普通字符串字面量**且**自带一对花括号**：

```csharp
"The plan state file (.wishful-claw/plans/{planId}.state.json) is updated in real-time and can be read by external tools.",
```

直接改成 `$"The plan state file ({WishfulClawDataDir.ProjectDirName}/plans/{planId}.state.json)…"` ⇒ `{planId}` 被当成插值表达式，编译期报 CS0103（当前作用域没有 `planId`）。执行者最省事的「修法」往往是顺手把 `{planId}` 改成别的写法或干脆改成中性描述 —— 那是**未经批准的口径变更**。

七处里只有这一处有花括号（其余六处我逐行确认无 `{`/`}`），所以这是单点问题、单点补一句就够。

**建议改法**：步骤 4 加一行「`PlanToolProvider.cs:65` 的 `{planId}` 是**给模型看的占位符字面量**，转插值时必须写成 `{{planId}}`，改后编译通过且渲染出来仍是 `{planId}`（收尾用真机或单测对这个串断言一次）」。
另外顺带提醒：`ProjectToolsProvider.cs:32` / `GlobalTaskToolsProvider.cs:108` / `AgentRuntimeGlobalTaskExecutor.cs:226` 三处是「普通字面量 + `+` 拼接」，转成 `$"…"` 时同样要检查该行有没有 `{`（实测三处都没有，安全）。

### ❌ D. 步骤 9 / §六 的越线文件漏 1 个：`AgentRuntimeGlobalTaskExecutor.cs` 实测 545 行

**问题**：步骤 9 标题写「本次要改的 **3 个**文件超 500 行硬线」，§六 也写「越线文件 3 个（609 / 588 / 557 行）」。但这一版步骤 4 新纳入的 `AgentRuntimeGlobalTaskExecutor.cs` 实测 **545 行**，同样超线、同样**没有**豁免头（文件头 12 行只有 `using` 与 `namespace`）。三个老数字我复核是对的（609/588/557 精确命中），漏的是**新加入的那一个**。

**建议改法**：
- 步骤 9 表加一行 `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalTaskExecutor.cs | 545`；§六 改「越线文件 4 个（609 / 588 / 557 / 545）」；
- 理由可照仓库先例写（`src/main/channels/providers/qq/qq-service.ts:7` 的中文版或 `src/main/ipc/terminal-handlers.ts:9` 的英文版），例如「一个 executor 类 = 一张工具表的全部分支（list/create/update/dispatch），拆开要把 DB 句柄与 dispatch 投递通道外提」；
- 注意三个 C# 里 `AgentRuntimePlanExecutor.cs` 头部**已有** Apache 版权块（`:1-7`），豁免注释要接在版权块**之后**，不能顶掉 `/* Ported from OpenCowork… */`（先例 `qq-service.ts` 就是这么放的）。

## 【复审】⚠️ 建议项

1. **⚠️ 步骤 4 的 7 处里有 5 个文件缺 `using WishfulClaw.Infrastructure.Storage;`，plan 没写。**
   实测 usings：`AgentRuntimeProjectExecutor.cs` **有**；`PromptBuilder.cs`、`ProjectToolsProvider.cs`、`PlanToolProvider.cs`、`GlobalTaskToolsProvider.cs`、`AgentRuntimeGlobalTaskExecutor.cs` **都没有**（它们现在连 `WishfulClaw.Infrastructure.Storage` 都没引，`GlobalTaskToolsProvider` 甚至只有一个 `using WishfulClaw.Core.Tools;`）。插值里写 `WishfulClawDataDir.ProjectDirName` 会编译不过。**这是编译器能拦住的错**，所以不算必修，但建议步骤 4 直接写「5 个文件补 `using WishfulClaw.Infrastructure.Storage;`（Agent 与 Persona 均已引用 Infrastructure，无需改 csproj）」。
2. **⚠️ 步骤 4 的验证判据会被注释淹没，不可机械判真伪。**
   plan 写「`Select-String -Pattern '\.wishful-claw'` 在 `src/runtime` 下只剩 `WishfulClawPaths.cs:5` 一处 + 注释」。实测当前 `src/runtime` 命中 **40+ 行**，其中 **30+ 行是注释**（`SubAgentDefinition.cs:9,45`、`SubAgentRegistry.cs:8`、`GoalFileTools.cs:8`、`GoalPlanTracker.cs:12`、`SeedanceVideoTools.cs:143`、`PathBoundary.cs:22,184,185`、`CodeGraphEngine.cs:11`、`CodeGraphToolHandler.cs:1039`、`CodeGraphDataDir.cs:9,12,27,30`、`CodeGraphDataRootRegistry.cs:6,7,8`、`DbClient.cs:11,21`、`ConfigStore.cs:17`、`ProviderStore.cs:11`、`WishfulClawDataDir.cs:30,34`、`PersonaModels.cs:9`、`PersonaStore.cs:8,9`、`PromptBuilder.cs:234,241`、`MemoryPathResolver.cs:8,9,10,15,28,33,52`）。「+ 注释」这种口径等于没判据。建议把命令钉成可直接跑的形式：
   ```powershell
   Get-ChildItem -Recurse -Filter *.cs src\runtime | Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' } |
     Select-String -Pattern '\.wishful-claw' | Where-Object { $_.Line -notmatch '^\s*(//|///|\*|/\*)' }
   ```
   **改后应恰好 1 行**：`WishfulClawPaths.cs:5`（常量定义）。
3. **⚠️ 改完之后一批「项目级语义」的注释会变成假事实，plan 没安排。**
   尤其 `WishfulClawDataDir.cs:30`（`/// The project-local data directory — <c>{workingFolder}/.wishful-claw</c> —`）、`:34`、`PersonaStore.cs:9`（`project library ({workingFolder}/.wishful-claw/personas/)`）、`MemoryPathResolver.cs:9`、`PromptBuilder.cs:241`（`// Local project: memory stored under {workingFolder}/.wishful-claw/`）、`CodeGraphToolHandler.cs:1039`、`CodeGraphDataRootRegistry.cs:6-7`。建议「顺手改 3~4 处最贴近改动的」或至少在步骤 4 写一句「注释里的裸名本刀不改，理由：描述的是目录名族而非具体实例」，别留白 —— 否则下一轮审查会拿这些行来打。
4. **⚠️ preload 的 `--wishful-project-dir` 只加主窗，plan 没写这个边界；建议 preload 侧给显式默认。**
   实测共用同一份 preload 的窗口有 4 个：`src/main/index.ts:110`（主窗，`index.html`）、`quick-launcher.ts:1709`（`file-search.html`）、`quick-launcher.ts:2139`（`launcher.html`）、`clipboard-enhancer.ts:585`（`clipboard.html`）。后三个**不会**拿到 `additionalArguments` ⇒ `process.argv` 里没有该参数 ⇒ 若将来有任何模块在那些入口 import `renderer/src/lib/project-data-dir.ts`，`PROJECT_DATA_DIR_NAME` 就是 `undefined`，而 `joinFsPath()` 对 `undefined` 直接 `segment.replace` 抛 TypeError（`memory-files.ts:205-207`）。当前三个入口确实不 import 这三个模块（已 grep 确认），所以**今天不会崩**；建议步骤 7 写一句「additionalArguments 只加主窗」，并把 renderer 侧写成惰性取值或 `?? '.wishful-claw'` 的显式兜底。
5. **⚠️ `src/preload/index.d.ts` 已经和运行时 `api` 脱节，「补类型」时不要顺手对齐。**
   实读：`index.d.ts:6-31` 声明了 `fetchImageBase64` / `downloadImage` / `teamRuntime*`(6 个) / `shell`，而 `src/preload/index.ts:35-82` 的 `api` 对象里**一个都没有**（只有 `ping`/`invoke`/`workerRequest`/`workerRequestWithId`/`cancelWorkerRequest`/`on`/`onAgentStream`/`openFolderDialog`/`log`/`readLogs`）。也就是说 `ImagePreview.tsx:184,235`、`lib/agent/teams/runtime-client.ts:24-58` 这些调用点**现在**就是 `undefined is not a function`（167 处 `window.api` 调用里的一部分）。这是既有问题、不在本刀范围；但步骤 7 只加 `projectDirName` 一行是对的，**别在本刀「顺便修正类型」** —— 那会把改动面从 1 行扩成十几个 IPC 通道。
6. **⚠️ `PROJECT_MEMORY_DIRNAME` 同时服务 SSH 远程项目，改成 `-dev` 会连带改变 dev 实例「读远端记忆」的行为，plan 与需求都没登记。**
   链路：`memory-snapshot.ts:78` `projectRootPath = options.workingFolder` → `memory-files.ts:225` `joinFsPath(projectRootPath, PROJECT_MEMORY_DIRNAME, ...)` → `memory-files.ts:278` `readTextFile(ipc, path, sshConnectionId)`（SSH 时走 `IPC.SSH_FS_READ_FILE`，读的是**远端** `{remote}/.wishful-claw/MEMORY.md`）。改常量后 dev 实例读的是远端 `{remote}/.wishful-claw-dev/MEMORY.md` ⇒ 远端只有打包版写的 `.wishful-claw/` ⇒ dev 实例「看不见远端项目的真实记忆」。需求 §2 讲的是本地项目污染，SSH 远端不在原话里。**建议 §五 加一条**：SSH 远程项目记忆跟 `-dev` 走（接受 dev 看不到远端生产记忆）**或**该分支显式固定裸名 —— 二者选一写死。
7. **⚠️ §六「改动 22 个文件」与 §三 自列的 34 个不符。**
   数一遍 §三：C# 15（含 `WishfulClawPaths` / `WishfulClawDataDir` / 4 个 Provider/Executor 文案文件）、TS 13（2 新建 + 11 改）、其它 6（`.gitignore` + 4 文档 + `tests/generated-image-dir/program.ts`）= **34**。行数「约 40 行」也偏低（步骤 2 的代码块 6 行、5 个 using、11 处替换、7 处文案、TS 两个新模块约 20 行、文档 4 处段落，估 55~65 行）。这属**摘要口径**，不影响实施，但会让阶段五/六的「改动面复核」对不上账。
8. **⚠️ 验收 2（打包版零变化）没有可执行检查点。**
   需求 §7 第 2 条写「代码核对（注入值为常量）」，plan 落到步骤 6 只剩 `typecheck:node`，步骤 11 门禁也不含打包产物校验。建议加 3 行纯函数单测（可挂在 `tests/generated-image-dir` 或新建 `tests/project-dir`）：`projectDataDirName(true) === '.wishful-claw'`、`projectDataDirName(false) === '.wishful-claw-dev'`；顺带断言 env 覆盖优先级。这样 6 条验收里**每一条**都有机器可跑的锚点。
9. **⚠️ 首轮报告 §二❌4 的「改前 12 处命中」实测是 13 处（原文按要求保留，此处在复审补记）。**
   13 = 11 项目级（`AgentRuntimePlanExecutor.cs:158`、`AgentRuntimePlanExecutor.Helpers.cs:26`、`AgentRuntimeProjectExecutor.cs:141`、`SystemPromptCache.cs:94`、`GoalFileTools.cs:18/23/28`、`GoalPlanTracker.cs:28`、`WishfulClawDataDir.cs:44`、`PersonaStore.cs:34`、`MemoryPathResolver.cs:65`）+ 2 全局（`WishfulClawDataDir.cs:17`、`CodeGraphDataDir.cs:56`）。**「改后 3 处」的结论不受影响**（11 → `ProjectDirName` 后剩 2，加步骤 2 新回退值 = 3）。

## 【复审】✅ 通过项

1. **步骤 3「恰好 3 处」判据实测成立**，且三处归属与 plan 完全一致：① `WishfulClawDataDir.cs:17`（`Root` getter，拼 `Environment.SpecialFolder.UserProfile`）② 步骤 2 新增 `ProjectDirName` 的回退值 `? configured : WishfulClawPaths.DataDirName` ③ `CodeGraphDataDir.cs:56`（`Path.Combine(home, WishfulClawPaths.DataDirName, "codegraph")`）。全仓 `src` + `tests` 共 13 命中、全部在 `src` 内无测试引用，`WishfulClawPaths.cs:5` 写作 `public const string DataDirName = ".wishful-claw";`、**不含前缀**，确实不被该 pattern 匹配 —— plan 这段说明是真读过源码写的，不是抄结论。
2. **步骤 4 的 7 处裸字符串一处不漏、行号全对**：`AgentRuntimeGlobalTaskExecutor.cs:226`、`GlobalTaskToolsProvider.cs:108`、`PlanToolProvider.cs:65`、`ProjectToolsProvider.cs:32`、`AgentRuntimeProjectExecutor.cs:599`、`:607`、`PromptBuilder.cs:339`。而且**没有把不该改的混进来**：递归扫 `src/runtime` 后，除这 7 行外剩下的非注释命中只有 `WishfulClawPaths.cs:5`（常量定义）；其余 30+ 行全是注释。`PlanToolProvider.cs:65` 也在表内（首轮建议「改或显式标注不改」二选一，本版选了改，口径统一）。
3. **TS 侧确无第二处需改的裸名**：全仓 `src` 的 `.ts/.tsx` 里，非注释的 `.wishful-claw` 命中**只有 1 行** —— `src/shared/data-dir.ts:1`（常量定义）。步骤 7 的 4 处「不改」判定（`codegraph-project-index.tsx:85`、`codegraph-availability.ts:40`、`SkillsMenu.tsx:371/417`、`codegraph-handlers.ts:159-160`）站得住。
4. **§一 的 `additionalArguments` 方案在 Electron 43.2.0 下成立**：`node_modules/electron/package.json` 版本 **43.2.0**；`electron.d.ts` 里 `additionalArguments?: string[]` 的注释原文是「appended to `process.argv` in the renderer process of this app. Useful for passing small bits of data down to renderer process preload scripts」；主窗 `webPreferences`（`index.ts:109-112`）是 `{ preload, sandbox: false, webviewTag: true }` —— **`sandbox: false`** 下 preload 拿到的是完整 node 环境（`process.argv` 可读），方案可落地。
5. **preload 只有一份 `window.api` 类型声明，没有第二份**：全 `src` grep `interface Window` / `declare global` 只命中 `preload/index.d.ts:3-6`（api 部分）与 `renderer/src/lib/monaco/setup.ts:32`、`renderer/src/lib/streaming-perf.ts:238`（各加自己的无关字段，不碰 api）。`tsconfig.web.json` include 了 `src/preload/*.d.ts` ⇒ renderer 侧类型可见。**「加字段 + 补类型」机械可行**（唯一梗见 ⚠️5 的既有脱节）。
6. **`src/shared/project-dir.ts` 放 shared 不会造成两份 tsconfig 冲突**：`tsconfig.node.json` 与 `tsconfig.web.json` 都 include `src/shared/**/*`，但该文件按 plan 只写 `import { WISHFUL_CLAW_DATA_DIR_NAME } from './data-dir'` + 一个纯函数，**不读 `import.meta.env`、不碰 DOM**，两边编译结果一致；`@shared` 别名在 `tsconfig.web.json:18-21` 与 `electron.vite.config.ts:24-28` 都有（main/preload 侧按惯例用相对路径 `../shared/...`，与 `data-dir.ts:4-7` 一致）。
7. **步骤 9 的三个行数全对**（`[IO.File]::ReadAllLines().Count` 实测）：`AgentRuntimeProjectExecutor.cs` **609**、`src/main/lib/native-worker.ts` **588**、`AgentRuntimePlanExecutor.cs` **557**；三者文件头 12 行内**均无**豁免注释（`AgentRuntimePlanExecutor.cs:1-7` 只有 Apache 版权块，豁免注释要接在其后，见 ❌D 的提醒）。
8. **除那 4 个（3 老 + 1 漏，见 ❌D）之外，本次要改的 28 个文件都没有超 500 行**：`main/index.ts` 479、`PromptBuilder.cs` 475、`ProjectArchivePage.tsx` 445、`PersonaStore.cs` 344、`misc-handlers.ts` 336、`task-board-store.ts` 296、`memory-files.ts` 296、`ProjectToolsProvider.cs` 221、`GoalPlanTracker.cs` 201、`codegraph-handlers.ts` 181、`GoalFileTools.cs` 140、`project-archive-helpers.ts` 133、`AgentRuntimePlanExecutor.Helpers.cs` 126、`SystemPromptCache.cs` 125、`preload/index.ts` 96、`MemoryPathResolver.cs` 82、`PlanToolProvider.cs` 71、`WishfulClawDataDir.cs` 70、`generated-image-dir.ts` 66、`preload/index.d.ts` 35、`shared/data-dir.ts` 4、`WishfulClawPaths.cs` 7 等。注意 `PromptBuilder.cs` 475、`main/index.ts` 479 已贴近硬线，**这刀不能再往上加逻辑**。
9. **新增的 renderer 顶层 `window.api` 读取不会打断 `npm test`**：全 `tests/**` 无任何一处 import `memory-files` / `project-archive-helpers` / `task-board-store`（grep 0 命中），node 侧 test 不会被 `window is not defined` 打死。
10. **`.gitignore` 判定准确**：现仅 `:74` 一行 `.wishful-claw/*`，`.wishful-claw-dev/` 完全没被覆盖，补一行必要且不影响既有条目（仓库内 `test:clean` 用的是 `.wishful-claw/tmp`，不受影响）。
11. **文档 4 处行号全对**：`docs/development.md:135`（「生产 `~/.wishful-claw/`，开发态 `~/.wishful-claw-dev/`」）、`README.md:107`（「项目级数据在 `{项目目录}/.wishful-claw/`」）、`AGENTS.md:142`（「`.wishful-claw/` 目录下」）、`docs/data-storage.md:28,33,66,74`（项目工作区节 + 记忆双路径）。步骤 10 对这 4 处的处置（改 2、写清为何不区分 2）合理。
12. **步骤 1 与现状不冲突**：`WishfulClawPaths.cs` 现 7 行，`DataDirName`（`:5`）与 `DataDirEnvVar`（`:6`）并列，新增 `ProjectDirEnvVar` 是纯追加；`EnsureProjectRoot`（`WishfulClawDataDir.cs:42-48`）改内部实现不影响签名，全仓唯一调用方是 `AgentLoop.cs:195`（实测），不波及别处。
13. **验收 6 条 → 可执行动作基本闭合**（5/6 有机器锚点）：①③④ → 步骤 12 的 ①写项目记忆 ②codegraph 索引 ③生成图 ④派全局任务 + 目录对比；⑤ → 步骤 11 门禁（`typecheck` 双配置 / `dotnet build` / `npm test` 79/79 基线确在 `plan-s222/verification_report.md:17` 有据）；⑥ → 步骤 12 的 mtime 对比 + 步骤 3 的 grep。**唯一缺口是验收 2（打包版零变化），见 ⚠️8。**

## 【复审】我亲自核对的证据

### 1. `WishfulClawPaths.DataDirName` 现状逐行（递归、已排除 obj/bin，`src` + `tests`）

`Get-ChildItem -Recurse -Filter *.cs src,tests | Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' } | Select-String 'WishfulClawPaths\.DataDirName'` ⇒ **13 命中，全在 `src`，`tests` 0 命中**：

| # | 文件:行 | 所属方法/属性 | 拼接基准 | 改后应变成 |
|---|---|---|---|---|
| 1 | `AgentRuntimePlanExecutor.cs:158` | `SendPlan…`/plan dir 解析 | `workingFolder` | `ProjectDirName`（步骤 3） |
| 2 | `AgentRuntimePlanExecutor.Helpers.cs:26` | plan 文件路径 helper | `workingFolder` | `ProjectDirName`（步骤 3） |
| 3 | `AgentRuntimeProjectExecutor.cs:141` | `get_project_details` 读状态文件 | `project.WorkingFolder` | `ProjectDirName`（步骤 3） |
| 4 | `SystemPromptCache.cs:94` | persona 目录（三元的一支） | `workingFolder` | `ProjectDirName`（步骤 3） |
| 5 | `GoalFileTools.cs:18` | `goals/{id}.md` | `workingFolder` | `ProjectDirName`（步骤 3） |
| 6 | `GoalFileTools.cs:23` | `goals/{id}.state.json` | `workingFolder` | `ProjectDirName`（步骤 3） |
| 7 | `GoalFileTools.cs:28` | `goals/` 目录 | `workingFolder` | `ProjectDirName`（步骤 3） |
| 8 | `GoalPlanTracker.cs:28` | `goals/{id}/plans/` | `workingFolder` | `ProjectDirName`（步骤 3） |
| 9 | `WishfulClawDataDir.cs:44` | `EnsureProjectRoot` | `workingFolder` | `ProjectRoot(workingFolder)`（步骤 2） |
| 10 | `PersonaStore.cs:34` | `GetPersonasDirectory` 一元 | `workingFolder` | `ProjectDirName`（步骤 3） |
| 11 | `MemoryPathResolver.cs:65` | `ResolveRoot` 本地项目分支 | `Path.GetFullPath(workingFolder)` | `ProjectDirName`（步骤 3） |
| 12 | `WishfulClawDataDir.cs:17` | `Root` getter | `Environment.SpecialFolder.UserProfile` | **保持 `DataDirName`** |
| 13 | `CodeGraphDataDir.cs:56` | `Resolve…`（home 分支） | `home` | **保持 `DataDirName`** |

⇒ 11 处改 + 2 处留 + 步骤 2 新增 1 处回退 = **改后恰好 3 处**，与 plan 步骤 3 判据逐字吻合。**判据成立**。

### 2. `src/runtime` 裸字符串递归扫描（含注释判别）

见 ⚠️2 的全量清单：非注释命中恰好 7 行（就是步骤 4 表里的 7 行）+ `WishfulClawPaths.cs:5`；注释命中 30+ 行，且**没有**任何「其实属于全局目录却被误列进 7 处」的情况（`PathBoundary.cs:22/184/185`、`CodeGraphDataDir.cs:9/12/27/30`、`CodeGraphDataRootRegistry.cs:6-8`、`MemoryPathResolver.cs:8-10/15/28/33/52` 全属注释里的全局说明，未入表，正确）。

### 3. preload / 窗口面

- `src/preload/index.ts`：`api` 对象 `:35-82`（plan 写「`:35` 加字段」精确）；`contextBridge.exposeInMainWorld('api', api)` 在 `:87`。
- `src/preload/index.d.ts`：`:3-33` 手写 `declare global { interface Window { electron: ElectronAPI; api: {...} } }`，**不 import shared 类型**（只 `import { ElectronAPI }`）。
- 共用同一 preload 的窗口 4 个（见 ⚠️4）；只有主窗（`index.ts:93` 的 `new BrowserWindow`，preload 在 `:110`）会拿到 `additionalArguments`。

### 4. main 侧 import 图（判 ❌A 的依据）

- `src/main/index.ts:8` → `./lib/native-worker`；`:52` → `./ipc/misc-handlers`；`:271` → `registerMiscHandlers(() => mainWindow)`。
- 全 `src/main` 搜 `from '../index'` / `from './index'` ⇒ **0 命中**（没有文件反向依赖入口）。
- `src/main/ipc/misc-handlers.ts:1` 的 electron 导入**不含 `app`**；`:5` 已有 `import { resolveDataDir } from '../lib/data-dir'`（所以把同一真源放 `lib/data-dir.ts` 最自然）。
- `src/main/lib/native-worker.ts:182-187`：`const resolvedDataDir = resolveDataDir()` / `const workerEnv: NodeJS.ProcessEnv = { ...process.env, WISHFULCLAW_DATA_DIR: …, CODEGRAPH_HOME: … }` —— plan 步骤 5 引用的 `:183-187` 精确；且因 `...process.env` 在前，主进程回写 `process.env` 后**自动继承**。

### 5. 行数实测（`[IO.File]::ReadAllLines().Count`）

| 文件 | 行数 | 豁免头 | 结论 |
|---|---|---|---|
| `AgentRuntimeProjectExecutor.cs` | 609 | 无 | 步骤 9 ✓ |
| `src/main/lib/native-worker.ts` | 588 | 无 | 步骤 9 ✓ |
| `AgentRuntimePlanExecutor.cs` | 557 | 无（仅版权块 `:1-7`） | 步骤 9 ✓ |
| **`AgentRuntimeGlobalTaskExecutor.cs`** | **545** | **无** | **步骤 9 漏项（❌D）** |
| `src/main/index.ts` | 479 | — | 贴近硬线 |
| `PromptBuilder.cs` | 475 | — | 贴近硬线 |
| `ProjectArchivePage.tsx` | 445 | — | 安全 |
| 其余 24 个待改文件 | ≤ 344 | — | 安全 |

### 6. 需求 §7 六条验收 → 可执行动作映射

| # | 验收 | plan 落点 | 可执行？ |
|---|---|---|---|
| 1 | dev 实例项目下生成 `-dev`、无 `.wishful-claw/` | 步骤 12 ①~④ + 目录对比 | ✓ |
| 2 | 打包版零变化 | 无（只有步骤 6 的 typecheck） | **✗（⚠️8）** |
| 3 | 项目级记忆落 `-dev` | 步骤 12 ① | ✓ |
| 4 | 全局记忆仍在 `~/.wishful-claw-dev/` | 步骤 12 末条（mtime） | ✓ |
| 5 | 门禁全绿 | 步骤 11 | ✓ |
| 6 | 全局路径未受影响 | 步骤 12 mtime + 步骤 3 grep | ✓ |

---

# 【第三轮复审】（第三轮 · 收敛轮 · 2026-10-23 17:30）

> 前两节原文**一字未改**。本轮只做三件事：①验收复审 4 条 ❌（A~D）与 5 条 ⚠️ 是否**真的**落到具体步骤与源码行上；②抓本版**新引入**的问题（步骤 11 的 `tests/project-dir`）；③回答「现在能不能直接开工」。
> 复核方式：只读 + 逐行读源码，未采信 plan 与报告的任何自述。行数用 `[IO.File]::ReadAllLines().Count`；检索用 `Get-ChildItem -Recurse -Include *.cs,*.ts,*.tsx` + `Select-String`（已排除 `obj` / `bin`）；测试基线直接按 `scripts/run-tests.mjs:32-36` 的收录规则现算。

## 【第三轮复审】结论

**❌ 4 条 / ⚠️ 7 条 / ✅ 12 条。❌ > 0 ⇒ 禁止进入阶段四。**

与复审相比：复审的 4 条 ❌ 里 **3 条真收口**（B / C 的主体 / D），**A 收口且落点经得起查**；⚠️1、⚠️2（index.d.ts 不顺带对齐）、⚠️5（验收 2 锚点）收口。**但复审 ⚠️3（SSH 分流）没真收口**，且这一版为了收口它而写进步骤 7 的「调用点」根本不存在（见 ❌G）。另外两处新问题：步骤 11 新增的 `tests/project-dir` 第三个用例按 node 测试跑必然 TypeError（❌E）；步骤 4 对 7 处字面量类型的描述与源码不符，照着改会**静默**产出错提示词且门禁全绿（❌F）。步骤 4 的验证判据仍是复审 ⚠️2 明确否掉的那条「+ 注释」，且被 §七 从对照表里删掉了（❌H）。

4 条 ❌ 全是 plan 文本级修（合计约 25~40 行文字，其中 ❌G 要做一次二选一的口径裁定、❌E 要选一种测试注入方式），**不需要重做骨架**。骨架本身这轮更结实了：§六 的 36 个文件与 §三 实列一致、四个越线行数全中、判据「恰好 3 处」实测成立、`resolveProjectDirName()` 放 `main/lib/data-dir.ts` 的时序与一致性经核无问题。

## 【第三轮复审】复审 4 条 ❌ 与 5 条 ⚠️ 的验收

| 编号 | 问题 | 是否真收口 | 证据（我亲自核到的源码行 / 实测） |
|---|---|---|---|
| ❌A | `misc-handlers.ts` 的 `projectDirName` 值来源（循环 import / 丢 env 覆盖） | **是** | `data-dir.ts` 现 22 行（`resolveDataDir` `:10-18` + `resolveDataPath` `:20-22`），加 `resolveProjectDirName()` 约 +7 行 → ~29 行，仍是「一个低层工具模块」的量级，合理。①无循环 import：`src/main` 全仓 `from '../index'` / `from './index'` **0 命中**；`data-dir.ts` 只引 `electron`/`os`/`path`/`shared/data-dir`，新增 `shared/project-dir` 后链路是 `data-dir → shared/project-dir → shared/data-dir`，单向无环。②时序无风险：`app.isPackaged` 在 `app.whenReady()` 之前就能读，仓库**已有先例** —— `src/main/ipc/extension-plugin-sync.ts:18` 就是模块顶层 `const WISHFUL_CLAW_DIR = resolveDataDir()`（同一个 `app` 依赖）。真正的消费方全是运行期调用：`misc-handlers.ts:323`（IPC handler 内）、`codegraph-handlers.ts:171`（handler 内）、`native-worker.ts:182`（spawn 前）。③三处值一致：三处都走 `resolveProjectDirName()` 或靠 `native-worker.ts:184` 的 `...process.env` 继承（`index.ts` 顶层回写后同一字符串），且「env 已设 → `\|\|` 短路」与「env 未设 → `!app.isPackaged`」两个分支回写前后取值恒定，不存在自相矛盾 |
| ❌B | `PromptBuilder.cs` 行号写成 333-337（实 339）；三个 Provider 缺 `Tools/Providers/` | **是** | `PromptBuilder.cs:335` = `return $"""`，`:336` `## Project`，`:337` `- Working Folder:`，`:338` `All relative paths…`，**`:339`** = `- Scratch notes, briefs and other temporary documents belong in \`.wishful-claw/notes/\`…`，`:340` = `"""`。plan 步骤 4 表与 §三 现在都写 `:339`；三个 Provider 在 `WishfulClaw.Agent/Tools/Providers/`（实测 `ProjectToolsProvider.cs` 221 行 / `PlanToolProvider.cs` 71 行 / `GlobalTaskToolsProvider.cs` 148 行），plan 路径已带子目录 |
| ❌C | `PlanToolProvider.cs:65` 含字面 `{planId}`，转插值会 CS0103 | **半收口**（`{{planId}}` 的写法对，但前提「已是插值串」写错了 → 见 ❌F） | 实读 `:64-65`：`"Update the status of a step in the current plan. …" +` / `"The plan state file (.wishful-claw/plans/{planId}.state.json) …"` —— **普通 `""` 字面量，没有 `$`**。C# 里 `$"…{{planId}}…"` 渲染为 `{planId}` ✓，所以「必须写成 `{{planId}}`」在「已转成 `$""`」的前提下是正确的；但若照步骤 4 括号里那句「本身就已是 `$"…"`」而只塞表达式，则 `{{planId}}` 会原样输出双花括号、`{WishfulClawDataDir.ProjectDirName}` 会原样输出这串表达式文本 |
| ❌D | 漏一个越线文件 `AgentRuntimeGlobalTaskExecutor.cs` 545 行 | **是** | `[IO.File]::ReadAllLines().Count` 实测 **545**；文件头 `:1-4` 只有 `using`、`:6` `namespace`，**确无**豁免注释。步骤 9 已把它列为第 4 个，§六 的「609 / 588 / 557 / 545」四个数我逐个复测全中 |
| ⚠️1 | 5 个 C# 文件缺 `using WishfulClaw.Infrastructure.Storage;` | **是** | 实测 `Select-String 'using WishfulClaw.Infrastructure.Storage;'`：`PromptBuilder.cs` **0**、`ProjectToolsProvider.cs` **0**、`PlanToolProvider.cs` **0**、`GlobalTaskToolsProvider.cs` **0**、`AgentRuntimeGlobalTaskExecutor.cs` **0**；对照组 `AgentRuntimeProjectExecutor.cs:7` **有**。步骤 4 末条已写「5 个文件补 using」 |
| ⚠️2 | preload `index.d.ts` 已与运行时 `api` 脱节 | **是（按建议：本刀不顺带对齐）** | §七 明写「明确不顺带对齐，本刀不动」，步骤 7 只要求加 `projectDirName` 一行。口径清晰，不会再被误扩面 |
| ⚠️3 | `PROJECT_MEMORY_DIRNAME` 兼服务 SSH 远程项目 | **否**（写进去的「调用点」不存在，且漏 4 个真调用点）→ **❌G** | plan 步骤 7 写「调用点 `memory-snapshot.ts:78-79`」——`memory-snapshot.ts` 全文 **0 次**调用 `getProjectMemoryCandidatePaths`；`:78-79` 是 `projectRootPath` / `projectSshConnectionId` 的**赋值**处。真链路是 `memory-snapshot.ts:105/116/127/138` → `memory-files.ts:271 resolveProjectMemoryTextFile` → `:277 getProjectMemoryCandidatePaths`，且另有 4 个调用点（详见 ❌G 与证据 3） |
| ⚠️4 | §六「22 个文件」与 §三 不符、行数偏低 | **是（口径已自洽）** | 我逐条数 §三：C# 15 改 + TS 15（2 新建 + 13 改）+ 其他 6 = **36**，与 §六 的「36 个文件」一致；「55~65 行」也合理（11 处替换 + 7 处文案 + SSH 分流 + 4 个豁免头 + 2 个 30 行模块 + 4 处文档）。**遗留**：§三 漏列步骤 11 的两个文件，实际应为 38 → 见 ⚠️ 1 |
| ⚠️5 | 验收 2（打包版零变化）无可执行检查点 | **是** | 步骤 11 的用例 1 `projectDataDirName(false) === '.wishful-claw'` 是纯函数、不碰 electron，机器锚点成立；步骤 12 末条的真机目录对比补上了另一半。（该套件的**第三个**用例另有毛病，是另一件事 → ❌E） |

## 【第三轮复审】能否开工的判定

**不能直接开工，4 个地方会让实施者停下来猜或悄悄改错。** 逐项回答：

| 可能卡住的点 | 判定 | 说明 |
|---|---|---|
| `resolveProjectDirName()` 放 `data-dir.ts` 会不会有时序 / 循环 / 三处不一致 | **不会，可开工** | 见 ❌A 验收行：22 行 → ~29 行；`app.isPackaged` 在被 `whenReady` 前读有仓库先例；三消费方全在运行期取值 |
| `PlanToolProvider.cs:65` 的 `{{planId}}` 怎么写 | **要停下来想**（❌F） | 写法对，但「已是插值串」是假的；4 处普通字面量必须先补 `$`，否则静默错 |
| SSH 分流怎么改 | **要停下来想**（❌G） | 指定的调用点不存在；真链路要动 `resolveProjectMemoryTextFile` 签名 + 5 个调用点；另有 4 个调用点没有口径（其中 `resolveProjectSummaryPath` 拿不到 ssh 信息） |
| 步骤 11 的第三个用例怎么跑 | **要停下来想**（❌E） | `data-dir.ts` 引 `electron`，node 测试里 `app` 是 `undefined`；仓库没有现成的 electron 桩先例 |
| 步骤 4 改完怎么验 | **要停下来想**（❌H） | 「只剩 1 处 + 注释」不可判真伪（现网 40+ 命中 / 30+ 注释） |
| 步骤 2/3 的替换清单与「恰好 3 处」判据 | **可开工** | 13 命中 / 11 改 / 2 留 + 1 新回退值 = 改后 3 处，逐条对得上 |
| 4 个越线文件补豁免头 | **可开工** | 四个行数实测全中；只需注意 PlanExecutor 的版权块位置（⚠️ 7） |
| 步骤 7 三个 renderer 模块与 preload 通道 | **可开工** | `WISHFUL_CLAW_DIR` 只有 `ProjectArchivePage:82/:85` 两个消费点；tests 侧 0 依赖 |
| 测试套件怎么挂 | **可开工** | `run-tests.mjs:32-36` 按 `test:*` 前缀自动收录；目录名不需要匹配 C# 正则；79 → 80 套 |

## 【第三轮复审】❌ 必修项

### ❌ E（本版新引入）步骤 11 的第三个用例按现在的写法跑不起来 —— `resolveProjectDirName` 的「空白值回退」在 node 测试里必然 TypeError

**问题**：步骤 11 要求 `tests/project-dir/program.ts` 覆盖「`resolveProjectDirName` 在 `WISHFULCLAW_PROJECT_DIR` 有值时以其为准、**空白值回退**」。但该函数住在 `src/main/lib/data-dir.ts`，而那个文件第一行就是 `import { app } from 'electron'`（`data-dir.ts:1`）。npm 的 `electron` 包 `main` 指向 `index.js`，其最后一行是 `module.exports = getElectronPath();` —— 导出的是**一个字符串路径**，不是 Electron 运行时的 `app` 对象。esbuild 打成 CJS 后 `app === undefined`。

- 「有值」那一例能过，纯粹因为 `configured || projectDataDirName(!app.isPackaged)` 短路，**根本没走到右半边**；
- 「空白值回退」必须求值 `!app.isPackaged` ⇒ `Cannot read properties of undefined (reading 'isPackaged')`。

而且仓库里**没有可照抄的做法**：全 `tests/**` 无一处 `import … from 'electron'`（实测 0 命中），`package.json` 里也**没有** `--alias:electron` / `--external:electron`（实测 0 命中）。执行者写到这儿只能停下来自行设计桩——正是「要停下来猜」。

**建议改法（三选一，写死在步骤 11）**：
- **推荐 c**：把判定拆成纯函数。`shared/project-dir.ts` 里放 `pickProjectDirName(envValue: string | undefined, isPackaged: boolean)`；`main/lib/data-dir.ts` 的 `resolveProjectDirName()` 只做「读 env → 调纯函数」。测试只测纯函数 ⇒ `tests/project-dir` 完全不依赖 `src/main`，三个用例（`false`/`true`/env 有值与空白）全都能跑。
  ```ts
  // src/shared/project-dir.ts
  export function pickProjectDirName(envValue: string | undefined, isPackaged: boolean): string {
    const configured = envValue?.trim()
    return configured || projectDataDirName(!isPackaged)
  }
  ```
- **a**：`export function resolveProjectDirName(isPackaged = !app.isPackaged)`，测试显式传 `true`/`false`。
- **b**：esbuild 加 `--alias:electron=./tests/project-dir/stubs/electron.ts`（先例：`test:send-model-resolution` 用 `--alias:@renderer/stores/*=./tests/send-model-resolution/stubs/*`）。

**验证判据**：`npm run test:project-dir` 全绿，且该套件的 `program.ts` **不 import 任何 `src/main/**`**（推荐 c 下可用 grep 断言）。

### ❌ F（本版新引入）步骤 4「这些串本身已是 `$"…"`」与源码不符：7 处里 4 处是普通字面量，照字面执行会**静默**写错提示词

**问题**：步骤 4 的改法是「字面量 → 插值 `{WishfulClawDataDir.ProjectDirName}`（**这些串本身已是 `$"…"` 或 `$"""…"""`，加表达式即可**）」。逐行实测，只有 3 处已经是插值：

| 位置 | 现状 | 需不需要补 `$` |
|---|---|---|
| `AgentRuntimeProjectExecutor.cs:599` | `$"and write a clean summary to \`.wishful-claw/project-status.md\`…" +` | 不需要 |
| `AgentRuntimeProjectExecutor.cs:607` | `$"at \`{workingFolder}/.wishful-claw/project-status.md\`.";` | 不需要 |
| `PromptBuilder.cs:339` | 在 `$"""` 块内（`:335` 开） | 不需要（`{{` 转义规则同样适用） |
| `ProjectToolsProvider.cs:32` | `"Get project details (…). Reads .wishful-claw/project-status.md …"` | **需要** |
| `GlobalTaskToolsProvider.cs:108` | `"…" +`（跨行 `+` 拼接的一行） | **需要** |
| `AgentRuntimeGlobalTaskExecutor.cs:226` | `"for it belong in \`.wishful-claw/notes/\`…" +` | **需要** |
| `PlanToolProvider.cs:65` | 普通字面量 + `{planId}` | **需要**，且同时 `{{planId}}` |

**后果（这是它算 ❌ 而不是 ⚠️ 的原因）**：往 `""` 里塞 `{WishfulClawDataDir.ProjectDirName}` **编译通过**，步骤 4 自己的 grep 判据也**全绿**（`.wishful-claw` 确实消失了），但模型收到的系统提示/工具描述是 `{WishfulClawDataDir.ProjectDirName}/notes/` 这种字面垃圾——`dotnet build` 0 错、`npm test` 79/79、grep 全过，**现有门禁一条都拦不住**，而它恰好落在「让模型写错目录」这个本需求的核心目标上。`PlanToolProvider.cs:65` 更拧：在普通串里写 `{{planId}}` 会渲染成双花括号，plan 里「`{{planId}}` + 已转成 `$""`」这两句必须绑在一起说。

**建议改法**：把括号那句改成——
> 7 处里 3 处已是插值（`ProjectExecutor:599`/`:607` 的 `$"`、`PromptBuilder:339` 的 `$"""`），**4 处是普通 `""`（`ProjectToolsProvider:32`、`GlobalTaskToolsProvider:108`、`AgentRuntimeGlobalTaskExecutor:226`、`PlanToolProvider:65`）必须先补 `$`**；`:108`/`:226` 是跨行 `+` 拼接，只给含目录名的那一行加 `$` 即可。`PlanToolProvider:65` 补 `$` 的同一笔里把 `{planId}` 写成 `{{planId}}`。

**验证判据**（配合 ❌H，二者一起才能闭环）：`Select-String -Pattern '\$"' -Path <那 4 个文件>` 确认目标行带 `$`；或者更稳——真机触发一次 `UpdatePlanStep`，确认模型收到的描述里是 `.wishful-claw-dev/plans/{planId}.state.json` 而不是表达式文本。

### ❌ G（复审 ⚠️3 未真收口）SSH 分流：写的调用点不存在，真链路没写，另有 4 个调用点漏网

**问题**：步骤 7 的原话是「给 `getProjectMemoryCandidatePaths` 加可选第三参 `dirName = PROJECT_MEMORY_DIRNAME`；**调用点 `memory-snapshot.ts:78-79`**（`buildLayeredMemorySnapshot` 已持有 `sshConnectionId` 与 `workingFolder`）按 `projectSshConnectionId ? WISHFUL_CLAW_DATA_DIR_NAME : PROJECT_DATA_DIR_NAME` 传入」。三处硬伤：

1. **`memory-snapshot.ts` 根本没调用 `getProjectMemoryCandidatePaths`**（实测 0 命中）。`：78-79` 是 `const projectRootPath = …` / `const projectSshConnectionId = …` 的赋值行。
2. **真链路比 plan 写的深一层**：`memory-snapshot.ts:105/116/127/138` 调 `resolveProjectMemoryTextFile(ipc, projectRootPath, projectSshConnectionId, 'SOUL.md' | 'USER.md' | 'MEMORY.md' | 'memory_summary.md')` → `memory-files.ts:271`（定义）→ `:277` 才落到 `getProjectMemoryCandidatePaths`。要把 `dirName` 传下去，**必须给 `resolveProjectMemoryTextFile` 加参数**（`...segments` 是 rest，只能插在 `sshConnectionId` 之后），其 **5 个调用点**全要改：`memory-snapshot.ts:105/116/127/138` + `memory-files.ts:170`（`loadProjectDailyMemoryEntries`）。
3. **还有 4 个调用点 plan 一个字没提**，且其中 3 个手上就有 ssh 信息却没被要求分流：
   - `memory-automation-utils.ts:439`（`rootPath: getProjectMemoryCandidatePaths(args.snapshot.projectRootPath).preferredPath`，同对象 `:438` 就有 `sshConnectionId`、`:440` 还有 `transport: … ? 'ssh' : 'local'`）
   - `memory-organization.ts:156`（项目循环，`:158` 就有 `project.sshConnectionId`）
   - `memory-organization.ts:244`（`:246` 有 `args.sshConnectionId`）
   - `memory-automation-utils.ts:594`（`resolveProjectSummaryPath(projectRootPath)`，**函数签名里根本没有 ssh 上下文**）

**后果**：按 plan 照做的人，要么在 `memory-snapshot.ts:78-79` 找不到调用点而停下，要么只改 `memory-snapshot` 一处 —— 之后 dev 实例在 SSH 项目上做记忆整理/摘要（`memory-organization` / `memory-automation-utils`）时，rootPath 仍会指向远端 `.wishful-claw-dev/`（远端不存在），**静默读空且不报错**，比不改更难查。

**建议改法（口径写死，别留二选一）**：
- `resolveProjectMemoryTextFile(ipc, projectRootPath, sshConnectionId, dirName, ...segments)`，同步改 5 个调用点；
- `memory-snapshot.ts` 的 4 处 + `loadProjectDailyMemoryEntries` 传 `projectSshConnectionId ? WISHFUL_CLAW_DATA_DIR_NAME : PROJECT_DATA_DIR_NAME`；
- `memory-automation-utils.ts:439`、`memory-organization.ts:156/244` 三处同样按各自手上的 `sshConnectionId` 分流；
- `memory-automation-utils.ts:594`（`resolveProjectSummaryPath`）无 ssh 上下文：**明写处置**（「本刀给它加可选 `dirName` 参数并由调用方传；该函数只服务本地项目」或「已知限制，本刀不动，记档」），别留白；
- §三 的 TS 清单相应补 `memory-automation-utils.ts` / `memory-organization.ts`（若按上面的口径改）。

### ❌ H 步骤 4 的验证判据仍是复审 ⚠️2 已经否掉的「只剩 1 处 + 注释」，且被 §七 从对照表里删掉了

**问题**：步骤 4 末条现在写「`Select-String -Pattern '\.wishful-claw'` 在 `src/runtime` 下只剩 `WishfulClawPaths.cs:5` 一处（常量定义）+ 注释」。这句话**不是判据**：实测同一条命令带注释是 40+ 行命中，其中 30+ 行是注释（`PathBoundary.cs:22,184,185`、`CodeGraphDataDir.cs:9,12,27,30`、`MemoryPathResolver.cs:8,9,10,15,28,33,52`、`PromptBuilder.cs:234,241` …）。执行者没法机械判断「注释里有没夹着一行漏改的代码」，审查也没法照这条打勾 —— 属「验收无法验证」。

复审 ⚠️2 已经给了一行可直接跑的命令，这一版**没采纳**；更麻烦的是 §七 的复审对照表只列了 5 条 ⚠️（且重编号：plan 的 ⚠️2/3/4/5 分别对应报告的 ⚠️5/6/7/8），**报告的 ⚠️2、⚠️3、⚠️4、⚠️9 在表里根本不存在**，等于静默删除。

**建议改法**：把判据换成可直接跑、结果唯一的版本（改后应**恰好 1 行**）——
```powershell
Get-ChildItem -Recurse -Filter *.cs src\runtime | Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' } |
  Select-String -Pattern '\.wishful-claw' | Where-Object { $_.Line -notmatch '^\s*(//|///|\*|/\*)' }
```
并把 §七 的复审表按报告原编号 1:1 补全 9 条（⚠️2 用上面这条、⚠️3 注释陈旧 = ⚠️5 处置、⚠️4 preload 只加主窗 = 步骤 7 多窗口边界段、⚠️9 计数补记 = 无需动作但要标注）。

## 【第三轮复审】⚠️ 建议项

1. **⚠️ §三 漏列步骤 11 的两个文件，两个小节标题自带数字也不对。**
   §三 实列 = C# 15 改 + TS 15（2 新建 + 13 改）+ 其他 6 = **36**，与 §六 的 36 一致 ✓；但步骤 11 要新建 `tests/project-dir/program.ts`、要改 `package.json`（挂 `test:project-dir`），这两个都不在 §三 ⇒ 实际改动面是 **38**。另外 §三 的两个小标题：`C#（12 改 + 1 备查）` 实际列了 15 个改动文件；`TS（2 新建 + 12 改）` 实际列了 2 新建 + 13 改。建议：补两行 + 标题改成 15 / 2+13，§六 写 38。

2. **⚠️ 步骤 5 的注入值写成「`<main 已算出的值>`」，等于把选择权丢给执行者。**
   要么明写 `import { resolveProjectDirName } from './data-dir'` 后 `[WISHFULCLAW_PROJECT_DIR_ENV]: resolveProjectDirName()`（推荐：与步骤 6 的另外两处同源），要么明写「不必新增键，`native-worker.ts:184` 的 `...process.env` 已继承 `index.ts` 的回写」。别写成占位符。

3. **⚠️ §六「`main/index.ts` 479（实测，改后不会再涨）」是错的。**
   步骤 6 至少要往 `index.ts` 加 3 行（`resolveProjectDirName()` 取值 + `process.env` 回写 + `additionalArguments`），实测 479 → 约 482~484，**仍在 500 以内**，但这句话本身会给阶段五留一个「说好的不涨」的把柄。改成「479，本刀 +3~4 行，改后约 483，仍低于硬线」。

4. **⚠️ §七 的复审对照表不是「逐条」。** 见 ❌H 末段：9 条 ⚠️ 只映了 5 条且重编号。建议按报告原编号 1:1 对齐（这属记账，不影响实施，但阶段五一定会拿它核）。

5. **⚠️ 改完之后一批「项目级语义」的注释会变成假事实，本版仍未处置（复审 ⚠️3 被静默丢弃）。**
   最贴近改动的几处：`WishfulClawDataDir.cs:30`（`/// The project-local data directory — <c>{workingFolder}/.wishful-claw</c>`）、`:33-34`、`PersonaStore.cs:9`、`MemoryPathResolver.cs:9`、`PromptBuilder.cs:241`、`CodeGraphDataRootRegistry.cs:6-7`。建议步骤 4 补一句「注释里的裸名本刀不改，理由：描述的是目录名族而非具体实例」，或顺手改 3~4 处最贴近的 —— 二者选一，别留白。

6. **⚠️ 豁免头里的「当前行数」是改前还是改后，没写清。**
   `AGENTS.md:178` 要求「写明豁免理由与**当前行数**」。这四个文件改后行数都会变（`609→613` 左右、`588→592`、`557→561`、`545→549`，取决于注释行数）。建议步骤 9 写明「写**改后**行数并标注测量日期」，否则阶段五按 `ReadAllLines` 复核会再次对不上账。

7. **⚠️ 步骤 9 没继承 ❌D 那条提醒：`AgentRuntimePlanExecutor.cs` 头部 `:1-7` 是 Apache 版权块，豁免注释必须接在其后。**
   实测该文件 `:1-7` = `/* Ported from OpenCowork. … */`，`:8` 才是第一条 `using`。若按「文件首行注释」机械执行会顶掉版权块。仓库先例 `src/main/channels/providers/qq/qq-service.ts:7` 就是把豁免注释放在版权块之后。建议步骤 9 补一句。

## 【第三轮复审】我亲自核对的证据

### 1. 行数实测（`[IO.File]::ReadAllLines((Resolve-Path $p)).Count`，本轮现跑）

| 文件 | 行数 | 判定 |
|---|---|---|
| `AgentRuntimeProjectExecutor.cs` | **609** | 越线，无豁免头（`:1` 即 `using`）✓ 与 §六 一致 |
| `src/main/lib/native-worker.ts` | **588** | 越线，无豁免头 ✓ |
| `AgentRuntimePlanExecutor.cs` | **557** | 越线，`:1-7` 仅版权块 ✓ |
| `AgentRuntimeGlobalTaskExecutor.cs` | **545** | 越线，`:1-4` 仅 using ✓（❌D 已补） |
| `src/main/index.ts` | **479** | 未越线（但会 +3~4 行 → 约 483，见 ⚠️ 3） |
| `PromptBuilder.cs` | **475** | 未越线（+1 个 using → 476） |
| `ProjectToolsProvider.cs` / `GlobalTaskToolsProvider.cs` / `ProjectArchivePage.tsx` | 221 / 148 / 445 | 安全 |
| `PersonaStore.cs` / `GoalPlanTracker.cs` / `GoalFileTools.cs` | 344 / 201 / 140 | 安全 |
| `misc-handlers.ts` / `codegraph-handlers.ts` / `memory-files.ts` / `memory-snapshot.ts` | 336 / 181 / 296 / 279 | 安全 |
| `src/main/lib/data-dir.ts` / `generated-image-dir.ts` / `preload/index.ts` / `preload/index.d.ts` | 22 / 66 / 96 / 35 | 安全（`data-dir.ts` +7 行 → 29，仍合理） |
| `WishfulClawDataDir.cs` / `WishfulClawPaths.cs` / `CodeGraphDataDir.cs` | 70 / 7 / 116 | 安全 |

⇒ **§六 的「越线文件 4 个（609 / 588 / 557 / 545）」四个数逐一实测全中** ✓

### 2. §三 文件逐条清点（数了两遍）

- **C#（15 改 + 1 备查）**：`WishfulClawPaths.cs`、`WishfulClawDataDir.cs`、`MemoryPathResolver.cs`、`SystemPromptCache.cs`、`GoalFileTools.cs`、`GoalPlanTracker.cs`、`AgentRuntimePlanExecutor.cs`、`AgentRuntimePlanExecutor.Helpers.cs`、`AgentRuntimeProjectExecutor.cs`、`AgentRuntimeGlobalTaskExecutor.cs`、`PersonaStore.cs`、`PromptBuilder.cs`、`Tools/Providers/{Project,Plan,GlobalTask}ToolsProvider.cs`（3）；备查 `CodeGraphDataDir.cs`（不改）。
- **TS（2 新建 + 13 改）**：新建 `shared/project-dir.ts`、`renderer/src/lib/project-data-dir.ts`；改 `main/lib/data-dir.ts`、`main/index.ts`、`main/lib/native-worker.ts`、`main/lib/generated-image-dir.ts`、`main/ipc/misc-handlers.ts`、`main/ipc/codegraph-handlers.ts`、`preload/index.ts`、`preload/index.d.ts`、`memory-files.ts`、`memory-snapshot.ts`、`project-archive-helpers.ts`、`ProjectArchivePage.tsx`、`task-board-store.ts`。
- **其他（6）**：`.gitignore`、`docs/data-storage.md`、`docs/development.md`、`README.md`、`AGENTS.md`、`tests/generated-image-dir/program.ts`。
- **合计 36 = §六 的 36** ✓；**缺**步骤 11 的 `tests/project-dir/program.ts` + `package.json` ⇒ 实际 38 → ⚠️ 1。

### 3. `getProjectMemoryCandidatePaths` 的全部调用点（递归 `src`，PowerShell 实跑）

定义：`src/renderer/src/lib/agent/memory-files.ts:220-227`（`:225` 用 `PROJECT_MEMORY_DIRNAME`）

| # | 调用点 | 手上的 ssh 信息 | plan 是否提及 |
|---|---|---|---|
| 1 | `memory-files.ts:277`（`resolveProjectMemoryTextFile` 内，定义在 `:271`） | 由第 3 参 `sshConnectionId` 传入 | 未直接提（只提了它的上游） |
| 2 | `memory-automation-utils.ts:439` | 同对象 `:438` `sshConnectionId` | **未提** |
| 3 | `memory-automation-utils.ts:594`（`resolveProjectSummaryPath`） | **无** | **未提** |
| 4 | `memory-organization.ts:156` | 同对象 `:158` `project.sshConnectionId` | **未提** |
| 5 | `memory-organization.ts:244` | `:246` `args.sshConnectionId` | **未提** |

另：`loadProjectDailyMemoryEntries`（`memory-files.ts:161-176`）经 `resolveProjectMemoryTextFile` 读 `memory/{date}.md`，同样受影响。
`memory-snapshot.ts` 全文对 `getProjectMemoryCandidatePaths` **0 命中**；其 `:78-79` 是 `projectRootPath` / `projectSshConnectionId` 赋值，`:105/116/127/138` 才是四次 `resolveProjectMemoryTextFile` 调用。⇒ ❌G 立得住。

### 4. 步骤 4 七处的字面量类型（逐行实读）

| 位置 | 首字符 | 类型 |
|---|---|---|
| `AgentRuntimeProjectExecutor.cs:599` | `$"` | 插值（同行 `:598` 还有 `{projectName}`） |
| `AgentRuntimeProjectExecutor.cs:607` | `$"` | 插值（`{workingFolder}`） |
| `PromptBuilder.cs:339` | 在 `:335` 的 `$"""` 块内 | 原始插值串 |
| `ProjectToolsProvider.cs:32` | `"` | **普通字面量** |
| `GlobalTaskToolsProvider.cs:108` | `"` + 上一行 `+` | **普通字面量（跨行拼接）** |
| `AgentRuntimeGlobalTaskExecutor.cs:226` | `"` + 上一行 `+` | **普通字面量（跨行拼接）** |
| `PlanToolProvider.cs:65` | `"`（`:64` 也是普通串 + `+`） | **普通字面量 + `{planId}` 字面花括号** |

### 5. 非注释命中的全量复核（改前基线，改后据此判「恰好 N 行」）

- `src` 下 `*.cs`：`.wishful-claw` 非注释命中 **7 行**（= 步骤 4 表里的 7 行）+ `WishfulClawPaths.cs:5`（常量定义）—— 与 plan **无漏无多** ✓
- `src` 下 `*.ts/tsx`：`.wishful-claw` 非注释命中 **仅 1 行** —— `src/shared/data-dir.ts:1`（常量定义）✓ 步骤 7 的 4 处「不改」站得住
- `src` 下 `*.cs` 的 `WishfulClawPaths.DataDirName`：**13 命中**（11 项目级 + `WishfulClawDataDir.cs:17` + `CodeGraphDataDir.cs:56`）⇒ 改后 = `:17` + `:56` + 步骤 2 新回退值 = **恰好 3 处** ✓ 与步骤 3 判据逐字吻合
- 带注释重跑 `.wishful-claw`（`src/runtime`）：**40+ 行**，其中 30+ 行是注释 ⇒ 步骤 4 的「+ 注释」不可判真伪（❌H）

### 6. 测试套件基线与组织方式（按 `scripts/run-tests.mjs` 现算）

- `run-tests.mjs:32-34`：TS 套件 = `package.json` 里 `test:*` 前缀且非 `test:clean` 的脚本名 ⇒ 实测 **61**
- `run-tests.mjs:36-40`：C# 套件 = `tests/` 下匹配 `^WishfulClaw\..+RegressionTests$` 的目录 ⇒ 实测 **18**
- **合计 79** ⇒ 步骤 11 的「`npm test` 基线 79/79」「新增套件后应为 80 套」**数字正确** ✓；且 `tests/project-dir` 这个目录名**不需要**匹配 C# 正则，`test:project-dir` 会被自动收录 ✓
- 现有 TS 套件一律是 `esbuild tests/<name>/program.ts --bundle --platform=node --format=cjs [--alias:…] --outfile=tests/<name>/out/program.cjs && node …`，`program.ts` 里是 `assert/strict` + 自己数 checks + 末行 `console.log('…: N checks passed')`（见 `tests/generated-image-dir/program.ts:17-27,187`）⇒ 步骤 11 的「约 30 行 program.ts」与仓库写法一致 ✓
- 依赖侧：`tests/**` 里 import 本次要动的 main 模块的**只有** `tests/generated-image-dir/program.ts:20`（`resolveGeneratedImagesDir`，且该模块无 electron 依赖）；`memory-files` / `memory-snapshot` / `project-archive-helpers` / `task-board-store` / `lib/data-dir` 在 `tests/**` **0 命中** ⇒ 步骤 7 加 `window.api` 字段不会打断 `npm test` ✓

### 7. `main` 侧 import 图与时序（判 ❌A 的依据）

- `src/main/index.ts:8` → `./lib/native-worker`；`:10` → `./lib/data-dir`（**已存在**）；`:52` → `./ipc/misc-handlers`.
- 全 `src/main` 搜 `from '../index'` / `from './index'` ⇒ **0 命中** ✓ 无循环 import 风险。
- `app.isPackaged` 在 ready 前可读的仓库先例：`src/main/ipc/extension-plugin-sync.ts:18`（模块顶层 `const WISHFUL_CLAW_DIR = resolveDataDir()`）。
- 三个消费点全是运行期调用：`native-worker.ts:182-187`（`const resolvedDataDir = resolveDataDir()` → `workerEnv = { ...process.env, WISHFULCLAW_DATA_DIR, CODEGRAPH_HOME }`，**`...process.env` 在前** ⇒ index 回写后自动继承）、`misc-handlers.ts:316-324`（handler 内，第二实参 `resolveDataDir()`，**无第三参** ← 首轮 ❌1 属实）、`codegraph-handlers.ts:171`（handler 内 `join(workingFolder, WISHFUL_CLAW_DATA_DIR_NAME, 'codegraph')`）。
- `misc-handlers.ts:1` 的 electron 导入**不含 `app`**，`:5` 已有 `import { resolveDataDir } from '../lib/data-dir'` ⇒ 把 `resolveProjectDirName()` 放 `data-dir.ts` 最自然 ✓

### 8. 其它逐条核对

- `generated-image-dir.ts:51-62`：SSH 分支（`:55-59`）返回 `{dataRoot}/projects/{projectId}/image`，**不碰 `projectDirName`** ⇒ 步骤 6 只需给本地分支加参数、无需 SSH 特判 ✓（`image-persist.ts:76` 确为空 scope → 全局，不改 ✓）
- `project-archive-helpers.ts:42` `WISHFUL_CLAW_DIR = WISHFUL_CLAW_DATA_DIR_NAME`，全仓消费者**只有** `ProjectArchivePage.tsx:82`（ssh：`home + WISHFUL_CLAW_DIR + 'projects' + id`）与 `:85`（本地：`workingFolder + WISHFUL_CLAW_DIR`）；`main/ipc/extension-plugin-sync.ts:18-19,71` 是同名**局部变量**（`resolveDataDir()`，全局），与本次无关 ✓ 步骤 7 的「`:82` 回全局常量 + 新增 `import { WISHFUL_CLAW_DATA_DIR_NAME } from '@shared/data-dir'`」可行
- `MemoryPathResolver.cs:29-50`：SSH 分支落 `GlobalRoot + projects/{projectId}`（本地全局），`:65` 才是本地项目级 ⇒ plan「C# 侧 SSH 无需同样处理」成立 ✓
- `WishfulClawDataDir.cs`：`Root` `:7-19`（`:17` 拼 `UserProfile`）、`EnsureProjectRoot` `:42-48`（`:44` 拼 `workingFolder`）⇒ 步骤 2 的「只改 `:44`、绝不动 `:17`」对得上 ✓
- `PromptBuilder.cs:1-6` 的 using 只有 `System.IO/Text/Text.Json/Core.Protocol/Core.Tools/Workspace.Memory` ⇒ 确需补 `WishfulClaw.Infrastructure.Storage` ✓
- `docs/data-storage.md:26-33,66,74`、`docs/development.md:135`、`README.md:107`、`AGENTS.md:142` 四处行号与内容仍与步骤 10 的描述一致 ✓
- `AGENTS.md:172-181` 大文件规则原文：「超过 500 行必须拆分…只有以下三类可以超 500 行，且必须在**文件头注释写明豁免理由与当前行数**…一律按 ❌ 处理」⇒ 步骤 9 的处置方式合规（口径问题见 ⚠️ 6）

---

# 【第四轮复审】（第四轮 · 收敛轮 · 2026-10-23 17:40）

> 前三节原文**一字未改**。本轮只做三件事：①验收第三轮 4 条 ❌（E~H）与 7 条 ⚠️ 是否真落到具体步骤与源码行；②抓本版（§一、步骤 4/5/6/7/9/10/11、§三/§六/§七）新引入的问题；③回答「现在能不能开工」。
> 复核方式：只读 + 逐行读源码。行数用 `[IO.File]::ReadAllLines().Count`；检索用 `Get-ChildItem -Recurse` + `Select-String`（已排除 `obj`/`bin`）；判据类任务**亲手跑命令**（步骤 4 的 PowerShell 判据在临时副本上模拟了「已改完 / 漏 1 处 / obj 残留」三种状态）；`npm run typecheck` 本轮实跑。

## 【第四轮复审】结论

**❌ 2 条 / ⚠️ 9 条 / ✅ 8 条。❌ > 0 ⇒ 暂不能进入阶段四。**

但两条 ❌ 都是**纯文字级**（合计约 6 行），且都不动骨架：

1. **❌ E 半收口**：§一 已把判定拆成纯函数 `pickProjectDirName(env, isPackaged)`，拆法我核过、成立；但**步骤 11 的第 3 个用例仍点名 `resolveProjectDirName`**（那是住在 `main/lib/data-dir.ts`、会碰 `electron` 的那层壳），与 §一「单测只打 `shared/project-dir.ts`」自相矛盾。照步骤 11 字面写 = 上一轮 ❌E 的同一个 TypeError 再演一遍。
2. **❌ I（本版新引入）**：步骤 12 的验收编号错位 —— 写成「四项产物…（对应验收 1~4）」「未新建 `.wishful-claw/`（验收 5）」「全局仍为 `~/.wishful-claw-dev/`（验收 6）」，而需求 §7 的 1~6 是：1 dev 项目下生成 `-dev` 且无 `.wishful-claw/`、2 打包版零变化、3 项目级记忆落 `-dev`、4 全局记忆仍在 `~/.wishful-claw-dev/`、5 门禁、6 全局路径未受影响。动作都在，**标签全错**（2/4/5 被顶掉），阶段六验证报告会挂错号。

骨架这轮**更结实了**：§三 数字（15+1 / 2+12 / 8 = 37）与 §六 的 37 逐条对得上；`shared/project-dir.ts` 的双 tsconfig 收录经核不报错（`shared/data-dir.ts` 就是同款先例，本轮 `npm run typecheck` 实跑 0 错）；步骤 3 的「恰好 3 处」仍成立于源码（13 命中 − 11 改 + 1 新回退值）；步骤 4 的新判据**我亲手跑过，改完确实恰好 1 条**；SSH「不污染生产」的断言经核成立（所有远端项目记忆写入都走 `writeTargetContent → SSH_FS_WRITE_FILE`，路径来自同一个候选目录名）。

## 【第四轮复审】第三轮 4 条 ❌ 与 7 条 ⚠️ 的验收

| 编号 | 问题 | 是否真收口 | 证据（我亲自核到的源码行 / 实测） |
|---|---|---|---|
| ❌E | `tests/project-dir` 第三例必崩（`data-dir.ts:1` 引 electron） | **半收口**：拆法对，步骤 11 的措辞没跟上 → **❌ 必修 1** | ①`src/main/lib/data-dir.ts:1` = `import { app } from 'electron'`；`node_modules/electron/index.js` 末行 = `module.exports = getElectronPath();`（导出字符串）⇒ node 下 `app === undefined`，`!app.isPackaged` 必 TypeError，事实无误。②拆法能避开：`src/shared/project-dir.ts` 只 import `./data-dir`（纯常量），`pickProjectDirName` 收 `(envValue, isPackaged)` 两个入参，无 `electron`/`process` 依赖 ⇒ 可在 plain node 里跑。③**双 tsconfig 收录不报错**：`tsconfig.node.json` include 含 `src/shared/**/*`、`tsconfig.web.json` include 也含 `src/shared/**/*`，但两个 typecheck 脚本都是 `tsc --noEmit -p … --composite false`（不是 `tsc -b`），重叠文件不会触发 TS6307；且 `src/shared/data-dir.ts` 本来就是双收录先例，我本轮实跑 `npm run typecheck`（node+web）**0 错**。④**残留**：步骤 11 第 3 例原文仍是「`resolveProjectDirName` 在 `WISHFULCLAW_PROJECT_DIR` 有值时以其为准、空白值回退」，照抄会 import `src/main/lib/data-dir` → 重演 TypeError |
| ❌F | 7 处文案「已是插值」的表述与源码不符 | **是** | 逐行实读 7 行（行号 / 首字符）：`AgentRuntimeProjectExecutor.cs:599` = `$"…`、`:607` = `$"…`；`PromptBuilder.cs:339` 落在 `:335` 开的 `$"""` 块内（`:337` 已有 `{workingFolder}`）；`ProjectToolsProvider.cs:32` = `"…`（**单行独立实参**，不是多行拼接）；`GlobalTaskToolsProvider.cs:108` = `"…`（`:103` 起的多行拼接**末段**，行尾 `,`）；`AgentRuntimeGlobalTaskExecutor.cs:226` = `"…`（`:224` 起的多行拼接中段，行尾 `" +`）；`PlanToolProvider.cs:65` = `"…`（`:64` 起的拼接末段，含字面 `{planId}`）。⇒ A 类 3 / B 类 4，**分类正确**；「只给含目标字面量的那一行加 `$`」**位置正确**（这 4 行各自独立成串，加 `$` 不会波及其他行）。`PlanToolProvider:65` 的 `{{planId}}` 提醒正确且必需 |
| ❌G | SSH 分流：调用点不存在、真链路深一层 | **是（改为已知边界登记）**，且**三条理由我全部核过，站得住** | ①**5 个调用点实测仍在**：`memory-files.ts:277`（`resolveProjectMemoryTextFile` 内）、`memory-automation-utils.ts:439`、`:594`、`memory-organization.ts:156`、`:244` —— 与 plan 列表逐条对上。②**「不污染生产」成立**：远端项目记忆的**写**只走 `memory-automation-internal.ts:117-127` `writeTargetContent` → `IPC.SSH_FS_WRITE_FILE`（`path: descriptor.path`），而 `descriptor.path` 由 `root.rootPath` / `getProjectMemoryCandidatePaths(...).preferredPath` 派生（`memory-automation-utils.ts:439`、`memory-organization.ts:156/244`、`memory-automation-internal.ts:95-101`），改后自然变成远端 `.wishful-claw-dev/`；**读**同样走这条候选路径，远端不存在 ⇒ `isMissingFileErrorMessage` 吞掉 ENOENT，静默读空（不抛错、更不会回落到 `.wishful-claw/`）。全仓 renderer 里没有任何绕开该常量的远端 `.wishful-claw` 写入。③C# 侧无关：`MemoryPathResolver.cs:29-50` 的 SSH 分支落 `GlobalRoot + projects/{projectId}`（本地全局），`:65` 才是本地项目级 ✓。④第三条理由里的 `resolveProjectSummaryPath`（`memory-automation-utils.ts:593-595`）全仓**0 个调用方**（只有定义），「要改签名」在技术上成立但本来就是个死导出，不构成阻塞 |
| ❌H | 步骤 4 判据不可判真伪 | **是**（判据可执行、结果唯一） | 我按 plan 的原文跑：`Get-ChildItem -Recurse -Filter *.cs src\runtime \| Select-String -Pattern '\.wishful-claw' \| Where-Object { $_.Line -notmatch '^\s*//\|^\s*///' } \| Measure-Object` ⇒ **改前 8 条**（= 7 处目标行 + `WishfulClawPaths.cs:5`）。再把 `src\runtime` 全部 .cs（565 个，已排除 obj/bin）拷到临时目录，按 plan 的 A/B 改法把 7 行改成 `{WishfulClawDataDir.ProjectDirName}` ⇒ **恰好 1 条，且就是 `WishfulClawPaths.cs:5`**；故意留 1 处没改（`GlobalTaskToolsProvider.cs:108`）⇒ **2 条**，判据能抓漏改。⇒ 「应恰好 1 条」不是巧合，是 0 漏 0 多的稳定结果 |
| ⚠️1（三轮）| §三 漏列 `tests/project-dir` / `package.json`，小标题数字不对 | **是** | §三 现列 C# 15 改 + 1 备查、TS 2 新建 + 12 改（14 个文件）、其他 8 项（`.gitignore`、4 份文档、`tests/generated-image-dir/program.ts`、`tests/project-dir/program.ts`、`package.json`）⇒ 15+14+8 = **37**，与 §六 的「37 个文件」逐字吻合；两个小标题的 15 / 2+12 我逐条数过，与列表一致。**注意**：三轮的 13 改已因 SSH 不再改 `memory-snapshot.ts` 而正确降为 12 改 |
| ⚠️2（三轮）| 步骤 5 写 `<main 已算出的值>` 占位符 | **是** | 步骤 5 现写 `[WISHFULCLAW_PROJECT_DIR_ENV]: resolveProjectDirName()`，与步骤 6 的另外两处同源；`native-worker.ts:183-187` 的 `workerEnv` 里 `...process.env` 在前（我实读 `:181-188`），主进程回写后天然继承，两条路不冲突 |
| ⚠️3（三轮）| §六「`main/index.ts` 479 改后不涨」为假 | **半收口**：`index.ts` 改对了（「改后约 483」），但同句里的 `PromptBuilder.cs 475（只改一行，不涨）` 仍错 → **⚠️ 3** | `PromptBuilder.cs` 实读 `:1-6` 只有 6 个 using，**确实没有** `WishfulClaw.Infrastructure.Storage`；步骤 4 要求补 using ⇒ 475 → **476**，不是「不涨」 |
| ⚠️4（三轮）| §七 复审表只映 5 条且重编号 | **是** | §七 复审表现在 13 行 = ❌A~D + ⚠️1~9，按原编号 1:1 对齐，每条都有落点 |
| ⚠️5（三轮）| 项目级语义注释会变假事实 | **是** | 步骤 10 新增「注释订正」，点名 `WishfulClawDataDir.cs:30/:34`、`PersonaStore.cs:9`、`PromptBuilder.cs:241`、`MemoryPathResolver.cs:9` 四处，并规定「纯说明 `~/.wishful-claw/` 全局的注释一律不动」。四处行号我逐行核过：`WishfulClawDataDir.cs:30` = `/// The project-local data directory — <c>{workingFolder}/.wishful-claw</c>…`、`:34` = `/// <c>.wishful-claw</c> among their sources…`、`PersonaStore.cs:9` = `/// or project library ({workingFolder}/.wishful-claw/personas/).`、`PromptBuilder.cs:241` = `// Local project: memory stored under {workingFolder}/.wishful-claw/`、`MemoryPathResolver.cs:9` = `/// Local project scope: {workingFolder}/.wishful-claw/` —— 全中 |
| ⚠️6（三轮）| 豁免头行数写改前还是改后没写清 | **半收口** → **⚠️ 6** | 步骤 9 现在明写「改前实测行数」，口径清楚了；但 `AGENTS.md`（我实读 §大文件拆分 第 5 条）要求「必须在**文件头注释写明豁免理由与当前行数**」—— 改完再读，`当前行数` 是 613/592/561/549，不是 609/588/557/545。写「改前」会让阶段五按 `ReadAllLines` 复核时对不上账 |
| ⚠️7（三轮）| `AgentRuntimePlanExecutor.cs` 的 Apache 版权块在豁免注释之前 | **未收口** → **⚠️ 6**（并入） | `AgentRuntimePlanExecutor.cs:1-7` 实读是 `/* Ported from OpenCowork … */`，`:8` 才是第一条 `using`；步骤 9 的验证句现写「四份文件**首行**即豁免注释」，没提版权块。仓库先例 `src/main/channels/providers/qq/qq-service.ts:7` 是把豁免段写在版权块**内部/之后** |

## 【第四轮复审】能否开工

**不能直接开工 —— 只剩 2 处文字级必修（约 6 行），改完即 ✅0。** 逐项判定：

| 环节 | 判定 | 说明 |
|---|---|---|
| §一 判定源 / `pickProjectDirName` 拆法 / 双 tsconfig | **可开工** ✅ | 拆法成立；`shared/` 双收录不报错（`--composite false` + `shared/data-dir.ts` 先例 + 本轮 typecheck 0 错） |
| 步骤 1 / 2 / 3（C# 契约、解析入口、11 处替换 + 「恰好 3 处」） | **可开工** ✅ | 13 命中 − 11 改 + 1 新回退值 = 3；`Root :17`、`EnsureProjectRoot :44`、`MemoryPathResolver :65`、`CodeGraphDataDir :56` 行号全对 |
| 步骤 4（7 处文案 A/B 分类、`$` 位置、`{{planId}}`、using、判据） | **可开工** ✅ | 3 插值 / 4 普通、加 `$` 位置全对；判据实跑「改完恰好 1 条、漏改 2 条」。仅措辞小瑕（⚠️8/⚠️9） |
| 步骤 5 / 6（worker 注入、`resolveProjectDirName`、`additionalArguments`、两处项目级路径、`misc-handlers` 第三实参） | **可开工** ✅ | `main/index.ts:109-113` 是 `webPreferences`（`:110` preload）✓；`codegraph-handlers.ts:171` ✓；`misc-handlers.ts:316-324` 确实只传两个实参 ✓；`data-dir.ts` 已是 `misc/codegraph/native-worker` 的公共依赖，无环 |
| 步骤 7（preload 通道、三处 renderer、`:82` 回全局） | **可开工**（有一处自相矛盾，不阻断） | `ProjectArchivePage.tsx:82` / `:85` 两种用途实读确认；`project-archive-helpers.ts:42` 的消费者只有这两个 ✓；`window.api` 字段与类型写法的矛盾见 ⚠️4 |
| 步骤 8 / 10 / 13（gitignore、文档、提交） | **可开工** | `docs/development.md:135`、`README.md:107` 内容与 plan 描述一致；但 `AGENTS.md:142` / `README.md:107` 的**具体文案**描述有误（⚠️1） |
| 步骤 9（4 个豁免头） | **可开工**（口径要补一句） | 四个行数实测全中；「改前/当前」与版权块位置见 ⚠️6 |
| 步骤 11（门禁 + `tests/project-dir`） | **要停下来判断**（❌1） | 第 3 例函数名指错，与 §一 打对台；脚本行与 import 路径未给（⚠️2，可照先例推） |
| 步骤 12（真机） | **能执行，但编号错位**（❌2） | 四项动作齐全，标签要按需求 §7 重排 |

## 【第四轮复审】❌ 必修项

### ❌ 1（❌E 的残留）步骤 11 第 3 个用例点名 `resolveProjectDirName`，与 §一「单测只打纯函数」自相矛盾

**位置**：`plan.md:194` —— 「3. `resolveProjectDirName` 在 `WISHFULCLAW_PROJECT_DIR` 有值时以其为准、空白值回退」。

**为什么算 ❌**：`resolveProjectDirName()` 住在 `src/main/lib/data-dir.ts`，`:1` 就是 `import { app } from 'electron'`；npm 的 electron 包在 node 下导出的是**字符串路径**，`app === undefined`。实施者若照这行写测试：

```ts
import { resolveProjectDirName } from '../../src/main/lib/data-dir'
// WISHFULCLAW_PROJECT_DIR 为空时的分支 → 求值 !app.isPackaged
// → TypeError: Cannot read properties of undefined (reading 'isPackaged')
```

而 §一（`plan.md:47`）明确说「单测只打 `shared/project-dir.ts`」。同一份 plan 里两个说法打架，实施者必须自己拍板 —— 正是「要停下来猜」。**这也正是上一轮 ❌E 的原症状，只是 §一 改了、步骤 11 忘了改。**

**改成（照抄即可）**：

> 3. `pickProjectDirName` 两例：①`pickProjectDirName('D:/x/.wishful-claw-dev', true) === '.wishful-claw-dev'`（env 覆盖优先于 `isPackaged`）；②`pickProjectDirName('   ', false) === '.wishful-claw'`（空白值回退到「非打包 = 生产名」，注意此例要断言**不**变成 `-dev`）。
> **不得** import `src/main/**`（`data-dir.ts` 带 `electron`，node 下 `app === undefined`）；套件只 import `src/shared/project-dir.ts`。

### ❌ 2（本版新引入）步骤 12 的验收编号与需求 §7 对不上

**位置**：`plan.md:201-203`。

**实测对照**（需求 `requirements/S-223.md` §7 六条）：

| 需求 §7 | 内容 | plan 步骤 12 现在挂的号 |
|---|---|---|
| 1 | dev 实例项目下生成 `-dev`，**没有**新建 `.wishful-claw/` | 被写成「验收 1~4」之一 +「验收 5」 |
| 2 | 打包版零变化 | **一个号都没挂**（实际由步骤 11 用例 1 承担） |
| 3 | 项目级记忆（`MEMORY.md`/`memory/*`）落 `-dev` | 被写成「验收 1~4」之一 |
| 4 | 全局记忆仍在 `~/.wishful-claw-dev/` | 被写成「验收 6」 |
| 5 | 门禁（typecheck / dotnet build / npm test） | 被写成「验收 5」=「未新建 `.wishful-claw/`」 |
| 6 | 全局路径未受影响（不出 `-dev-dev`） | 被写成「验收 6」= 全局记忆 |

⇒ 「验收 2 / 4 / 5」三个号全被顶掉，阶段六验证报告按这个编号写必然挂错。

**改成**：
> - 四项产物（①项目记忆 ②codegraph 索引 ③生成图 ④派活消息里的目录名）全部落在 `.wishful-claw-dev/` ⇒ **验收 1 + 3**
> - 项目下**未新建** `.wishful-claw/` ⇒ **验收 1**
> - 全局仍为 `~/.wishful-claw-dev/`（`dir ~/.wishful-claw-dev` 的 mtime 有变化，`~/.wishful-claw` 无变化）⇒ **验收 4**
> - 打包版零变化 ⇒ **验收 2**（步骤 11 用例 1 的机器锚点 + 本步目录对比）
> - 全部门禁 ⇒ **验收 5**（步骤 11）
> - 全局路径无 `-dev-dev` ⇒ **验收 6**（步骤 3 grep「恰好 3 处」+ 本步目录对比）

## 【第四轮复审】⚠️ 建议项

1. **⚠️ 步骤 10 对两处文档的描述与原文不符。** `plan.md:181` 写「`README.md:107`、`AGENTS.md:142`：这两处也写着 `.wishful-claw/notes/`」。实读：`README.md:107` = 「全部数据存在你自己的电脑上：`~/.wishful-claw/`…，项目级数据在 `{项目目录}/.wishful-claw/`」；`AGENTS.md:142` = 「- 记忆和人格的配置文件使用 Markdown 格式（.wishful-claw/ 目录下）」——**都没有 `notes/`**。动作（「写清为何不区分」）仍然成立，但描述要改，否则实施者会满文件找 `notes/`。
2. **⚠️ 步骤 11 没给落地细节。** 建议直接写死：`tests/project-dir/program.ts` 里 `import { projectDataDirName, pickProjectDirName } from '../../src/shared/project-dir'`（相对路径，esbuild 直接打包，**不需要** `--alias`；先例 `tests/generated-image-dir/program.ts:20` 就是 `'../../src/main/lib/generated-image-dir'`），脚本行为
   `"test:project-dir": "esbuild tests/project-dir/program.ts --bundle --platform=node --format=cjs --outfile=tests/project-dir/out/program.cjs && node tests/project-dir/out/program.cjs"`，末行 `console.log('project-dir: N checks passed')`（`scripts/run-tests.mjs:26` 按 `passed[:\\s]+(\\d+)` 抓计数）。
3. **⚠️ §六「`PromptBuilder.cs` 475（只改一行，不涨）」仍不准。** 步骤 4 要求补 `using WishfulClaw.Infrastructure.Storage;`（实读 `:1-6` 确无），⇒ **476**。改成「475 → 476，仍低于硬线」。
4. **⚠️ `PROJECT_DATA_DIR_NAME` 的兜底与类型自相矛盾。** 步骤 7 正文写 `export const PROJECT_DATA_DIR_NAME = window.api.projectDirName`（无兜底），多窗口段又写「模块里 `?? WISHFUL_CLAW_DATA_DIR_NAME` 兜底」。若不兜底且 `index.d.ts` 声明为 `string | undefined`，则 `memory-files.ts:10` 的 `PROJECT_MEMORY_DIRNAME` 会是 `string | undefined`，传进 `joinFsPath(projectRootPath, PROJECT_MEMORY_DIRNAME, ...segments)`（`memory-files.ts:225`，形参 `...segments: string[]`）**直接 typecheck 不过**。建议写死：preload 侧 `projectDirName: <解析结果> ?? WISHFUL_CLAW_DATA_DIR_NAME`、`index.d.ts` 声明为 `projectDirName: string`、模块 `export const PROJECT_DATA_DIR_NAME = window.api.projectDirName`。
5. **⚠️ `resolveProjectDirName()` 的注释口径与实现不一致。** §一（`plan.md:47`）说它是「取 env + 取 `app.isPackaged` + **调纯函数**」的壳，步骤 6（`plan.md:132`）却写成内联 `process.env[...]?.trim() || projectDataDirName(!app.isPackaged)` —— 同一规则两份实现，步骤 11 的纯函数锚点覆盖不到 main 侧那条。建议步骤 6 改为 `return pickProjectDirName(process.env[WISHFULCLAW_PROJECT_DIR_ENV], app.isPackaged)`。
6. **⚠️ 步骤 9 的豁免头口径要补两句。** ①`AGENTS.md` 要的是「**当前**行数」，而改完 `ReadAllLines` 是 613 / 592 / 561 / 549；建议写「改前 609 / 改后 613（2026-10-23 实测）」或干脆只写改后。②「四份文件首行即豁免注释」对 `AgentRuntimePlanExecutor.cs` 不成立（`:1-7` 是 Apache 版权块），按 `qq-service.ts:7` 的先例写成「豁免段接在版权块之后（`PlanExecutor` 在 `:8` 之前）」。
7. **⚠️ §七「第三轮复审」表只映了 4 条 ❌。** 第三轮报告另有 7 条 ⚠️（§三 漏列 / 步骤 5 占位符 / §六 479 / §七 复审表 / 注释陈旧 / 豁免头行数 / 版权块），其中 5 条已在正文修好、2 条半收口（⚠️3、⚠️6）。既然 ❌H 要求「按原编号 1:1 补齐」，这把尺子对第三轮也该用一遍，否则阶段五会重复追问。
8. **⚠️ 步骤 4「B 类这 4 处都是 `"…" + "…"` 多行拼接」不准确。** `ProjectToolsProvider.cs:32` 是**单行独立实参**（`registry.Register(new ToolDefinitionPlaceholder("get_project_details", "…", …))`），不在 `+` 拼接里；其余 3 处（`:108` 拼接末段、`:226` 拼接中段、`:65` 拼接末段）确实是多行拼接。动作（只给该行加 `$`）不受影响，改词即可。
9. **⚠️ 步骤 4 判据建议排除 `obj` / `bin`。** 我实跑时 `src/runtime/**` 下有 138 个 obj/bin 里的 .cs（当前 0 个含 `.wishful-claw`，所以本次结果干净），但 `Get-ChildItem -Recurse` 会扫进去；加 `| Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' }` 更稳，也避免 `dotnet build` 后生成物干扰。

## 【第四轮复审】我亲自核对的证据

### 1. 步骤 4 判据实跑（三次，`Get-ChildItem -Recurse -Filter *.cs src\runtime`）

| 状态 | 结果 |
|---|---|
| 原始仓库（改前） | **8 条** = 7 处目标行（`PromptBuilder:339`、`ProjectToolsProvider:32`、`PlanToolProvider:65`、`GlobalTaskToolsProvider:108`、`AgentRuntimeGlobalTaskExecutor:226`、`AgentRuntimeProjectExecutor:599/:607`）+ `WishfulClawPaths.cs:5` |
| 临时副本按 A/B 改法改完 7 行 | **恰好 1 条** = `WishfulClawPaths.cs:5: public const string DataDirName = ".wishful-claw";` |
| 临时副本故意漏改 `GlobalTaskToolsProvider.cs:108` | **2 条**（漏改处 + 常量定义）⇒ 判据能抓漏 |
| 额外：往 `obj/` 塞一份含该字面量的生成 .cs | **3 条** ⇒ 命令不排除 obj/bin 时存在误报通道（⚠️9） |

（模拟用临时目录 + 565 个 .cs 的完整拷贝，跑完已删除，仓库无残留。）

### 2. 7 处文案的逐行类型（本轮重读，与 ❌F 的表格逐条吻合）

| 位置 | 行内容首字符 / 结构 |
|---|---|
| `AgentRuntimeProjectExecutor.cs:599` | `$"and write a clean summary to \`.wishful-claw/project-status.md\`…" +` |
| `AgentRuntimeProjectExecutor.cs:607` | `$"at \`{workingFolder}/.wishful-claw/project-status.md\`.";` |
| `PromptBuilder.cs:339` | 位于 `:335` 的 `return $"""` 块内（`:340` 收 `"""`） |
| `ProjectToolsProvider.cs:32` | `"...Reads .wishful-claw/project-status.md…",`（单行实参，`:30-32`） |
| `GlobalTaskToolsProvider.cs:108` | `"\`.wishful-claw/notes/\` in its project, not loose in the project tree.",`（`:103` 起拼接的末段） |
| `AgentRuntimeGlobalTaskExecutor.cs:226` | `"for it belong in \`.wishful-claw/notes/\`, … When you finish, " +`（`:224` 起拼接的中段） |
| `PlanToolProvider.cs:65` | `"The plan state file (.wishful-claw/plans/{planId}.state.json) …",`（`:64` 起拼接的末段） |

### 3. 源码事实（本轮实读，用于判 E/G/H）

- `src/main/lib/data-dir.ts`（22 行）：`:1` `import { app } from 'electron'`；`resolveDataDir` `:10-18`；`resolveDataPath` `:20-22`。
- `node_modules/electron/index.js` 末行 `module.exports = getElectronPath();`（导出字符串）。
- `tsconfig.node.json` include = `electron.vite.config.*`, `src/main/**/*`, `src/preload/**/*`, `src/shared/**/*`；`tsconfig.web.json` include = `renderer/src/env.d.ts`, `src/renderer/src/**/*`, `src/preload/*.d.ts`, `src/shared/**/*`；两者 `composite: true`，但脚本是 `tsc --noEmit -p … --composite false`。
- `npm run typecheck`（node + web）本轮实跑：**0 输出、exit 0**。
- `src/main/index.ts`（479 行）：`:109` `webPreferences: {`、`:110` `preload: …`、`:111` sandbox、`:112` webviewTag、`:113` `}`；`:8` → `./lib/native-worker`、`:10` → `./lib/data-dir`。
- `src/main/lib/native-worker.ts:181-187`：`const resolvedDataDir = resolveDataDir()` / `workerEnv = { ...process.env, WISHFULCLAW_DATA_DIR, CODEGRAPH_HOME }`（`...process.env` 在前）。
- `src/main/ipc/codegraph-handlers.ts:7` 已 import `resolveDataPath`（同一模块），`:171` = `join(workingFolder, WISHFUL_CLAW_DATA_DIR_NAME, 'codegraph')`；`:159-160` 是 `~/` / 裸名前缀规范化（不改）。
- `src/main/ipc/misc-handlers.ts:5` = `import { resolveDataDir } from '../lib/data-dir'`；`:316-324` 的 `resolveGeneratedImagesDir({…}, resolveDataDir())` **只有两个实参**。
- `src/main/lib/generated-image-dir.ts`：`:61` 本地分支 `join(workingFolder, WISHFUL_CLAW_DATA_DIR_NAME, GENERATED_IMAGES_SUBDIR)`；SSH 分支 `:55-59` 走 `{dataRoot}/projects/{projectId}/image`。
- 远端写入通道：`memory-automation-internal.ts:111-131` `writeTargetContent` → `connectionId ? IPC.SSH_FS_WRITE_FILE : IPC.FS_WRITE_FILE`，`path: descriptor.path`；`descriptor.path` 出自 `readRootFile`（`:95-109`，`root.rootPath`）。
- `getProjectMemoryCandidatePaths` 的 5 个调用点：`memory-files.ts:277`、`memory-automation-utils.ts:439`、`:594`、`memory-organization.ts:156`、`:244`；`resolveProjectSummaryPath` **0 个外部调用方**。
- `MemoryPathResolver.cs`：SSH 分支 `:29-50` 落 `GlobalRoot/projects/{projectId}`，本地分支 `:65` 用 `WishfulClawPaths.DataDirName`。
- `WishfulClawDataDir.cs`：`Root` 的 `:17` = `WishfulClawPaths.DataDirName);`（全局），`EnsureProjectRoot` 的 `:44` = `Path.Combine(workingFolder, WishfulClawPaths.DataDirName)`（项目级）⇒ 步骤 2「只改 :44、不动 :17」对得上。
- `WishfulClawPaths.cs` 全文 7 行，`:5` = `public const string DataDirName = ".wishful-claw";`（不含 `WishfulClawPaths.` 前缀，不被步骤 3 判据匹配）。

### 4. 行数与规模（`[IO.File]::ReadAllLines().Count`，本轮现跑）

`AgentRuntimeProjectExecutor.cs` **609**、`src/main/lib/native-worker.ts` **588**、`AgentRuntimePlanExecutor.cs` **557**、`AgentRuntimeGlobalTaskExecutor.cs` **545**、`src/main/index.ts` **479**、`PromptBuilder.cs` **475**、`data-dir.ts` **22**、`preload/index.ts` **96**、`preload/index.d.ts` **35**、`misc-handlers.ts` **336**、`codegraph-handlers.ts` **181**、`memory-files.ts` **296**、`project-archive-helpers.ts` **133**、`ProjectArchivePage.tsx` **445** ⇒ §六 的「609 / 588 / 557 / 545」四个数全中；479 / 475 两张「贴近硬线」的牌仍成立（`PromptBuilder` 改后 476，见 ⚠️3）。

### 5. §三 逐条清点（数了两遍）

- **C# 15 改**：`WishfulClawPaths.cs`、`WishfulClawDataDir.cs`、`MemoryPathResolver.cs`、`SystemPromptCache.cs`、`GoalFileTools.cs`、`GoalPlanTracker.cs`、`AgentRuntimePlanExecutor.cs`、`AgentRuntimePlanExecutor.Helpers.cs`、`AgentRuntimeProjectExecutor.cs`、`AgentRuntimeGlobalTaskExecutor.cs`、`PersonaStore.cs`、`PromptBuilder.cs`、`Tools/Providers/{Project,Plan,GlobalTask}ToolsProvider.cs`（3）= 15；备查 `CodeGraphDataDir.cs`（不改）。**15 个路径我逐个 `Test-Path`，全部存在，无笔误。**
- **TS 2 新建 + 12 改 = 14**：新建 `shared/project-dir.ts`、`renderer/src/lib/project-data-dir.ts`（后者确认**当前不存在**）；改 `main/lib/data-dir.ts`、`main/index.ts`、`main/lib/native-worker.ts`、`main/lib/generated-image-dir.ts`、`main/ipc/misc-handlers.ts`、`main/ipc/codegraph-handlers.ts`、`preload/index.ts`、`preload/index.d.ts`、`memory-files.ts`、`project-archive-helpers.ts`、`ProjectArchivePage.tsx`、`task-board-store.ts` = 12 ✓。
- **其他 8**：`.gitignore`、`docs/data-storage.md`、`docs/development.md`、`README.md`、`AGENTS.md`、`tests/generated-image-dir/program.ts`、`tests/project-dir/program.ts`、`package.json` ✓（`docs/data-storage.md`、`website/` 目录均存在）。
- **合计 15 + 14 + 8 = 37 = §六「37 个文件」** ✓。

### 6. 测试基线（按 `scripts/run-tests.mjs:32-40` 现算）

`package.json` 里 `test:*` 且非 `test:clean` 的脚本 = **61**；`tests/` 下匹配 `^WishfulClaw\..+RegressionTests$` 的目录 = **18** ⇒ **79**，与步骤 11 的「基线 79/79、新增后 80 套」一致；`tests/project-dir` 不匹配 C# 正则，只经 `test:project-dir` 被收录 ✓。

### 7. 其它核对

- `tests/**` 下 `from 'electron'` **0 命中**、`package.json` 里 `alias:electron` / `external:electron` **0 命中** ⇒ ❌E 的前半段事实成立。
- `tests/**` 对 `memory-files` / `memory-snapshot` / `project-archive-helpers` / `task-board-store` / `lib/data-dir` **0 命中** ⇒ 步骤 7 加 `window.api` 字段不会打断 `npm test`。
- `tests/generated-image-dir/program.ts:21` import `resolveGeneratedImagesDir`，全文件断言均为 1~2 实参（`:54` 用 `join(WORKING_FOLDER, '.wishful-claw', 'image')`）⇒ 步骤 6 的「默认参数保全现有断言」成立。
- `tests/**/*.cs` 里出现 `.wishful-claw` 的只有 `tests/TestSupport/TestOutputRoot.cs:32`（仓库根 `.wishful-claw/tmp`）与 `WishfulClaw.GoalRegressionTests/Program.Sandbox.cs:98-113`（**数据根** `-dev`/生产 对照），都不走 `workingFolder`，且不设新环境变量 ⇒ 默认值不变，C# 18 套不受影响。
- `docs/development.md:135`、`README.md:107` 内容确认；`AGENTS.md:142` 是「（.wishful-claw/ 目录下）」而非 `notes/` —— 见 ⚠️1。
- `AGENTS.md:178` 原文：「只有以下三类可以超 500 行，且必须在**文件头注释写明豁免理由与当前行数**」；先例 `qq-service.ts:7` 的豁免段在版权块内、`:1` 起是版权块 ⇒ 步骤 9 的「首行」措辞与先例不符（⚠️6）。
- `src/runtime` 下 `.wishful-claw` 的**非注释**命中 = 8 行（7 + 常量），与需求 §3.3 的「11 处 C# 项目级引用」不冲突（后者是 `WishfulClawPaths.DataDirName`，13 命中 − 2 全局 = 11）。

---

# 【第五轮复审】（第五轮 · 收敛轮 · 2026-10-23 17:52）

> 前四节原文**一字未改**（追加前后 prefix 哈希一致，见末节）。本轮只做三件事：①验收第四轮 2 条 ❌ 与 **9** 条 ⚠️（第四轮报告实际给了 9 条，不是 7 条，我按原编号 1~9 全验，不挑着看）；②回答「没参与过前四轮的工程师能不能一次干对」；③核 §六「37 个文件」。
> 复核方式：只读 + 逐行读 `plan.md`（现 347 行）与源码；`node --experimental-strip-types` 做了真实探针（临时目录，仓库零改动、已删）；行数用 `[IO.File]::ReadAllLines().Count`；计数用 `Get-ChildItem -Recurse` + `Select-String`（已排除 `obj`/`bin`）。

## 【第五轮复审】结论

**❌ 2 条 / ⚠️ 8 条 / ✅ 11 条。❌ > 0 ⇒ 还不能进入阶段四。**

第四轮的 2 条 ❌ **都真收口了**：步骤 11 的函数名全换成纯函数（无残留引用）、步骤 12 的编号按需求 §7 重排且六条全挂上。但**步骤 11 这一刀自己又炸出两个新的**，都在同一节：

1. `plan.md:206` 的第 3 例三句断言里**两句反了**，还与同一步骤第 1 例**自相矛盾**（❌1）；
2. `plan.md:208` 的脚本行 `node --experimental-strip-types …` **实跑报 `ERR_MODULE_NOT_FOUND`**，且与仓库 61 个 `test:*` 脚本零先例（❌2）。

其余骨架这轮可以确认站住了：§三 逐条数下来 15 + 14 + 8 = **37**，与 §六 逐字吻合；步骤 3 的 13 处 `WishfulClawPaths.DataDirName` 命中我逐行列了，与表格 100% 对上；步骤 4 的 8 条非注释命中实跑仍是 8（按 A/B 改完应为 1）；四个越线文件行数 609 / 588 / 557 / 545 复测全中；需求 §7 六条验收在步骤 11 / 12 里**一条不落**。

## 【第五轮复审】第四轮 2 条 ❌ 与 7 条 ⚠️ 的验收

（说明：第四轮报告实际是 ❌2 + **⚠️9**，编号 1~9；下表按原编号逐条验，一条不落。）

| 编号 | 问题 | 是否真收口 | 证据（我亲自读到的行 / 实跑结果） |
|---|---|---|---|
| 四轮 ❌1 | 步骤 11 第 3 例仍点名 `resolveProjectDirName` | **✅ 收口**（但同节新炸出本轮的 ❌1 / ❌2） | `plan.md:203` 现为 `import { projectDataDirName, pickProjectDirName } from '../../src/shared/project-dir'`；`:204-206` 三例全打纯函数；`:207` 明写「绝不能在这里调 `resolveProjectDirName`」。全文只剩 `:207` 这一处提到该名字，且是**禁止语句**，不是引用 ⇒ 无残留调用 |
| 四轮 ❌2 | 步骤 12 验收编号与需求 §7 错位 | **✅ 收口** | 需求 §7 六条 ↔ `plan.md:215`(→1)、`:216`(→3)、`:217`(→4)、`:218`(→6)、`:219`(→2 + 5 显式转步骤 11)。六条全覆盖，没有顶号，也没有漏号 |
| ⚠️1 | 步骤 10 对 README / AGENTS 的描述与原文不符（说有 `notes/`） | **✅ 收口** | 实读 `README.md:107` =「全部数据存在你自己的电脑上：`~/.wishful-claw/`…项目级数据在 `{项目目录}/.wishful-claw/`」、`AGENTS.md:142` =「记忆和人格的配置文件使用 Markdown 格式（.wishful-claw/ 目录下）」；`plan.md:193` 引的两句与原文**逐字一致**，且「两处有意不区分」的裁定写清了 |
| ⚠️2 | 步骤 11 缺落地细节 | **半收口 + 新错 ⇒ 并入 ❌2** | import 写法已给（`:203`）✓；但脚本行 `:208` 写成 `node --experimental-strip-types`（实跑挂，见 ❌2），且套件计数行 `console.log('…: N checks passed')` 仍未写 |
| ⚠️3 | §六 `PromptBuilder.cs` 475「只改一行不涨」为假 | **半收口 ⇒ 本轮 ⚠️3** | §六 `:287` 已改成「475 → 改后 476（补一行 `using`，仍未越线）」✓；但**步骤 9 正文 `:185` 仍写「`PromptBuilder.cs` 475（实测，改后不会再涨）」** ⇒ 同一份 plan 两处对同一件事说法不一致。实读 `PromptBuilder.cs:1-6` 确无 Infrastructure using ⇒ 必补 ⇒ 476 |
| ⚠️4 | `PROJECT_DATA_DIR_NAME` 有无 `??` 兜底自相矛盾 | **✅ 收口** | 三处口径现已一致：①`:150` preload「解析不到就是 `undefined`，不要在这里兜底」；②`:150` d.ts「声明为 `projectDirName?: string`」；③`:151-155` 模块 `export const PROJECT_DATA_DIR_NAME: string = window.api?.projectDirName ?? WISHFUL_CLAW_DATA_DIR_NAME`（兜底**仅此一处**、显式 `: string`）；`:167` 多窗口段说的「模块里 `?? …` 兜底」与 ③ 同指一处。类型链闭合，`memory-files.ts` 那条 `joinFsPath` 不会再报错 |
| ⚠️5 | `resolveProjectDirName()` 注释说「调纯函数」、步骤 6 却内联 `\|\|` | **✅ 收口** | `plan.md:134-138` 现给薄壳实现体 `return pickProjectDirName(process.env[WISHFULCLAW_PROJECT_DIR_ENV], app.isPackaged)`，并明写「不要在别处内联 `\|\|`，否则纯函数单测覆盖不到 main 侧的取值语义」，与 §一 `:47` 口径一致。（该代码块缺 import，见本轮 ⚠️1） |
| ⚠️6 | 豁免头「改前 / 当前行数」口径与版权块位置 | **✅ 收口** | `:186`「豁免注释放文件第一行（在版权块、`using` 之前；若首行是版权注释则紧随其后）」；`:187`「注释里写的是**注入豁免头之后重新数一遍**的行数…不要写上表的改前值」。`AGENTS.md:178` 原文确要「写明豁免理由与**当前行数**」。（验证句 `:188` 仍有「首行」措辞残留，见本轮 ⚠️4） |
| ⚠️7 | §七「第三轮复审」表只映 4 条 ❌ | **✅ 收口** | §七 `:326-340` 现为 11 行 = ❌E~H 4 条 + ⚠️1~7 7 条，按原编号 1:1 |
| ⚠️8 | 步骤 4「B 类 4 处都是多行拼接」不准确 | **未收口 ⇒ 本轮 ⚠️5** | `plan.md:118` 一字未动，仍写「这 4 处都是 `"…" + "…"` 多行拼接」；实读 `ProjectToolsProvider.cs:32` 是**单行独立实参**（`"Get project details … statusUpdateTemplate …"`，前后无 `+`），另外 3 处才在拼接里 |
| ⚠️9 | 步骤 4 判据建议排除 `obj` / `bin` | **未收口 ⇒ 本轮 ⚠️6** | `plan.md:123` 的命令仍是 `Get-ChildItem -Recurse -Filter *.cs src\runtime \| Select-String …`，无 `obj`/`bin` 过滤。今日实测：`obj/bin` 里含 `.wishful-claw` 的 .cs = **0**，按原文跑 = **8** ⇒ 本次无害；但 `dotnet build` 后存在误报通道 |

## 【第五轮复审】能否一次干对

**不能 —— 卡点只有两处，都在步骤 11；其余 12 个步骤我逐条核过行号与源码事实，照做即可。**

**会卡住的地方（两处，均需补字）：**

1. **步骤 11 第 3 例（`plan.md:206`）**：三句断言里两句与 §一 的定义互斥，且与同步骤第 1 例互斥。他会停下来问「到底该改断言，还是改实现？」——这正是最危险的类型：按断言改实现 = 打包版落 `-dev`，验收 2 反着做，而门禁全绿。
   该补：按 §一 校准后的三句断言（❌1 末尾给了照抄行）。
2. **步骤 11 脚本行（`plan.md:208`）**：照抄必报 `ERR_MODULE_NOT_FOUND`（我实跑复现），且「照同名脚本现有写法」是**空指**——仓库没有任何脚本这么写。他会停下来问「到底用 esbuild 还是 node strip-types？import 要不要带 `.ts` 扩展名？」
   该补：确切的 `test:project-dir` 脚本行（esbuild 版，❌2 末尾给了照抄行）。

**已确认可直接开工的部分（逐条核过，不再复述细节，见末节证据）：**

| 环节 | 判定 |
|---|---|
| §一 判定源 / 纯函数拆法 / 三路分发 | 可开工 ✅（`data-dir.ts:1` 确 import electron，拆法必要且成立） |
| 步骤 1 / 2 / 3 | 可开工 ✅（13 处命中逐行对表；`Root:17` 与 `CodeGraphDataDir:56` 划为不改正确） |
| 步骤 4 | 可开工 ✅（7 行类型 A3 / B4 正确；`{{planId}}` 提醒必需；判据实跑 8→1） |
| 步骤 5 / 6 | 可开工 ✅（薄壳给定；`:171`、`:61`、`misc-handlers:316-324` 行号与实参个数全对） |
| 步骤 7 | 可开工 ✅（preload `api` 对象 `:35-82`、`:87 exposeInMainWorld('api', api)`、`sandbox: false` 均实读确认） |
| 步骤 8 / 9 / 10 / 13 | 可开工 ✅（`.gitignore:74` 现为 `.wishful-claw/*`；四个行数复测全中；文档四处原文对上） |
| 步骤 11 | **要停下来判断**（❌1 / ❌2） |
| 步骤 12 | 可开工 ✅（编号已对齐需求 §7） |

## 【第五轮复审】❌ 必修项

### ❌ 1（本轮新引入，最高危）步骤 11 第 3 例的断言与 §一 的实现互斥，三句里两句反了

**位置**：`plan.md:206` —— 「3. `pickProjectDirName('x-custom', false)` === `'x-custom'`；`pickProjectDirName('  ', false)` === `.wishful-claw`；`pickProjectDirName(undefined, true)` === `.wishful-claw-dev`」。

按 §一 `plan.md:36-44` 的定义：

```
projectDataDirName(isDev)            = isDev ? `${NAME}-dev` : NAME
pickProjectDirName(env, isPackaged)  = env?.trim() || projectDataDirName(!isPackaged)
```

逐句对照：

| plan `:206` 写的 | 按定义的实际值 | 判定 |
|---|---|---|
| `pickProjectDirName('x-custom', false)` === `'x-custom'` | `'x-custom'`（env 覆盖，与 `isPackaged` 无关） | ✅ |
| `pickProjectDirName('  ', false)` === `.wishful-claw` | **`.wishful-claw-dev`**（空白回退 → `!false = true` → dev 名） | ❌ 反了 |
| `pickProjectDirName(undefined, true)` === `.wishful-claw-dev` | **`.wishful-claw`**（`!true = false` → 生产名） | ❌ 反了 |

而且与**同一步骤第 1 例直接对撞**：`:204` 说 `projectDataDirName(false) === '.wishful-claw'`，`:206` 却要求 `pickProjectDirName(undefined, true) === '.wishful-claw-dev'` —— 后者展开正是 `projectDataDirName(false)`。同一份 plan、相邻两行，对同一个函数调用给了两个互斥的期望值。

**为什么是 ❌ 而不是 ⚠️**：实施者有两条「讲得通」的修法 —— 改断言（对）或改实现（灾难）。后者一旦发生，`app.isPackaged === true` 的打包版会落 `.wishful-claw-dev`，**需求验收 2「打包版零变化」被反着做掉**，而门禁一条都不会响（测试自洽、typecheck 绿、真机只测 dev 实例、C# 侧仍是 `.wishful-claw` 不报错）。「需要停下来问」+「会导致实施出错」双料。

**改法（照抄）**：

> 3. `pickProjectDirName` 三句：
>    - `pickProjectDirName('x-custom', false) === 'x-custom'`（env 覆盖优先于 `isPackaged`）
>    - `pickProjectDirName('   ', true) === '.wishful-claw'`（空白值回退到「打包 = 生产名」，断言**不**带 `-dev`）
>    - `pickProjectDirName(undefined, false) === '.wishful-claw-dev'`（未打包 = dev 名）
>    可与第 1 / 2 例互为镜像再补一句 `pickProjectDirName(undefined, true) === '.wishful-claw'`（打包版零变化的第二个锚点）。

### ❌ 2 步骤 11 的脚本行实跑必挂，且「照现有写法」是空指

**位置**：`plan.md:208` —— `"test:project-dir": "node --experimental-strip-types tests/project-dir/program.ts"`（附注「照同名脚本现有写法」）。

**证据**：

- 全仓 `experimental-strip-types` **0 命中**；`package.json` 里 62 个 `test:*`（含 `test:clean`）**没有一个**这么写，TS 套件一律 `esbuild tests/<name>/program.ts --bundle --platform=node --format=cjs --outfile=… && node …`（`package.json:73` 的 `test:generated-image-dir` 即此形）⇒「照同名脚本现有写法」不成立。
- **真实探针**（node v24.14.1；`package.json` 无 `type` 字段；临时目录，跑完已删，仓库零改动）：
  - `import { X } from './mod'`（无扩展名）+ `--experimental-strip-types` ⇒ `Error [ERR_MODULE_NOT_FOUND]: Cannot find module …/mod`，exit 1；
  - `import { X } from './mod.ts'`（带扩展名）⇒ 通过（另带 `MODULE_TYPELESS_PACKAGE_JSON` 警告）。
  而 plan 自己给的 import 是 `'../../src/shared/project-dir'`（无扩展名），且 `shared/project-dir.ts` 内部又 `import … from './data-dir'`（同样无扩展名）⇒ **两处都会挂**，即使只改第一处也不够。
- 退路也不通：改成带 `.ts` 扩展名会撞 `allowImportingTsExtensions` 未开，`npm run typecheck` 另报错。

**改法（照抄）**：

> `"test:project-dir": "esbuild tests/project-dir/program.ts --bundle --platform=node --format=cjs --outfile=tests/project-dir/out/program.cjs && node tests/project-dir/out/program.cjs"`
>
> 套件末行照现有约定打计数行（`tests/generated-image-dir/program.ts:187` 同款）：`console.log(\`project-dir: ${checks} checks passed\`)` —— `scripts/run-tests.mjs:49` 按 `passed[:\s]+(\d+)` 抓这个数，没有它汇总里只剩「ok」不带断言数。

## 【第五轮复审】⚠️ 建议项

1. **⚠️1 步骤 6 的代码块不完整：缺 import。** `plan.md:135-137` 给了 `resolveProjectDirName()` 的实现体，但没写它需要的两行 import（`import { pickProjectDirName, WISHFULCLAW_PROJECT_DIR_ENV } from '../../shared/project-dir'`）。`src/main/lib/data-dir.ts` 现有 import 只到 `'../../shared/data-dir'`（`:4-7`），而全仓还有另一个同名 `src/shared/data-dir.ts`，相对路径容易写错一个 `../`。虽然 TS 必拦、修法唯一（故只算 ⚠️），但写进 plan 更省一次编译往返。同类：步骤 7 的 `memory-files.ts` / `project-archive-helpers.ts` / `task-board-store.ts` 三处改常量都要新增 `import { PROJECT_DATA_DIR_NAME } from '…/lib/project-data-dir'`，路径也没给。
2. **⚠️2 验收 5 的「0 警告」全程没有判据。** 需求 §7-5 写「`dotnet build` **0 警告 0 错误**」；步骤 1 只写「0 错误」，步骤 11 只写「全绿」。建议步骤 11 明确「`dotnet build` 输出 0 Warning(s) 0 Error(s)」，否则阶段六没法判这条。
3. **⚠️3 行数两处打架（第四轮 ⚠️3 只改了 §六）。** `plan.md:185`「`PromptBuilder.cs` 475（实测，**改后不会再涨**）」vs `:287`「475 → 改后 476（补一行 `using`）」。实读 `:1-6` 只有 6 个 using、确无 Infrastructure ⇒ 476。改 `:185` 那句即可。
4. **⚠️4 步骤 9 验证句与正文措辞冲突。** `:186` 说「若首行是版权注释则紧随其后」，`:188` 验证句仍说「四份文件**首行**即豁免注释」。`AgentRuntimePlanExecutor.cs:1-7` 是 `/* Ported from OpenCowork … */`，`:8` 才是第一条 `using` ⇒ 按 `:188` 去验会误判。建议改写「`PlanExecutor` 的豁免段在版权块之后、`:8` 之前，其余三份在首行」。
5. **⚠️5（第四轮 ⚠️8 未收口）步骤 4 的「多行拼接」描述仍不准。** `:118` 说 4 处都是 `"…" + "…"` 拼接；实读 `ProjectToolsProvider.cs:32` 是单行独立实参。动作（只给该行加 `$`）不受影响，改词即可。
6. **⚠️6（第四轮 ⚠️9 未收口）步骤 4 判据建议排除 `obj` / `bin`。** `:123` 的命令仍会递归扫 `obj/`、`bin/`。今日实测这两处 0 命中、按原文跑=8 正确，所以本次不阻断；但 `dotnet build` 之后存在误报通道，加 `| Where-Object { $_.FullName -notmatch '\\(obj|bin)\\' }` 更稳。
7. **⚠️7 §七「第四轮复审」表只映 2 条 ❌，9 条 ⚠️ 一条未映。** 这正是上一轮对第三轮提的同一把尺子（第四轮 ⚠️7）。既然 ❌H 定了「按原编号 1:1 补齐」，第四轮也该享同一待遇，否则阶段五会第三次追问同样三条（⚠️3 / ⚠️5 / ⚠️6 至今在正文里能看见残留）。
8. **⚠️8 §六「37 个文件」不含步骤 13 要随刀入库的文档产物。** 37 只覆盖代码与既有文档的改动；而步骤 13 还要求把 `docs/plans/iter-v3-1/plan-s223/`、`requirements/S-223.md`、索引一起提交。建议 §六 补半句「另有 plan-s223 / requirements 等 3 项文档产物随刀入库，不计入 37」，免得阶段六核对 `git status` 时以为数错了。

## 【第五轮复审】我亲自核对的证据

### 1. `plan.md` 结构与四张表

现 347 行（任务描述里的「318 行左右」是旧版残值，不是问题）。§七 四张表齐：首轮 4❌+8⚠️ / 复审 4❌+9⚠️ / 第三轮 4❌+7⚠️ / 第四轮 **2❌+0⚠️**（后者即本轮 ⚠️7）。

### 2. 步骤 3 的「恰好 3 处」逐行验证（改前实跑，排除 obj/bin）

```
AgentRuntimePlanExecutor.cs:158          PlanExecutor      改
AgentRuntimePlanExecutor.Helpers.cs:26   Helpers           改
AgentRuntimeProjectExecutor.cs:141       ProjectExecutor   改
SystemPromptCache.cs:94                                   改
GoalFileTools.cs:18 / :23 / :28                           改
GoalPlanTracker.cs:28                                     改
CodeGraphDataDir.cs:56                   ← 全局(home)，不改
WishfulClawDataDir.cs:17                 ← 全局(UserProfile)，不改
WishfulClawDataDir.cs:44                                  改（步骤 2 → ProjectRoot）
PersonaStore.cs:34                                        改
MemoryPathResolver.cs:65                                  改
```

共 **13 命中**，与 plan「11 处改 + 2 处全局」完全对上；表格里每个文件的行号（65 / 94 / 34 / 18·23·28 / 28 / 158 / 26 / 141）**逐条命中，无一处偏移**。改后 = `:17` + `:56` + 步骤 2 新增回退值 = **3 处** ✓。`WishfulClawPaths.cs:5` 是 `public const string DataDirName = ".wishful-claw";`，不含 `WishfulClawPaths.` 前缀，确不被判据匹配 ✓。

### 3. 步骤 4 的判据实跑（按 plan 原文，不额外加工）

| 状态 | 结果 |
|---|---|
| 现仓库，非注释命中 | **8 条** = 7 处目标行 + `WishfulClawPaths.cs:5`，与 plan 的 A3/B4 分类逐行吻合（`:599` `$"…`、`:607` `$"…`、`PromptBuilder:339` 在 `$"""` 块内、其余 4 处普通字面量） |
| `obj` / `bin` 里含该字面量的 .cs | **0** ⇒ 原文命令今日不受污染（误报通道仍在，见 ⚠️6） |

7 行原文我逐行打印过，`PlanToolProvider.cs:65` 确含字面 `{planId}`（加 `$` 必须写 `{{planId}}`），另外 6 行无花括号 ✓。

### 4. 行数（`[IO.File]::ReadAllLines().Count`，本轮现跑）

`AgentRuntimeProjectExecutor.cs` **609**、`native-worker.ts` **588**、`AgentRuntimePlanExecutor.cs` **557**、`AgentRuntimeGlobalTaskExecutor.cs` **545**、`main/index.ts` **479**、`PromptBuilder.cs` **475**、`preload/index.ts` **96`、`data-dir.ts` **22** ⇒ 步骤 9 的四个「改前实测行数」与 §六 的 479 / 475 全部**复测命中**。

### 5. `node --experimental-strip-types` 探针（判 ❌2 的关键）

见 ❌2 证据段：无扩展名 import 直接 `ERR_MODULE_NOT_FOUND`；带 `.ts` 才过。node v24.14.1，仓库 `package.json` 无 `type` 字段。探针目录在 `%TEMP%`，跑完即删，**仓库零改动**。

### 6. 主进程 / preload 行号与能力

- `src/main/lib/data-dir.ts`（22 行）：`:1 import { app } from 'electron'`、`:4-7` 从 `'../../shared/data-dir'` 取两个常量、`:10-18 resolveDataDir`、`:20-22 resolveDataPath` ⇒ 步骤 6 的薄壳落点与 import 补法（⚠️1）都对得上。
- `src/main/index.ts`：`:109 webPreferences`、`:110 preload`、`:111 sandbox: false`、`:112 webviewTag`、`:113 }` ⇒ plan 的 `:109` 行号准确；**`sandbox: false`** 意味着 preload 有完整 `process`，`process.argv` 方案成立。`:10` 已 `import { resolveDataPath } from './lib/data-dir'` ⇒ 加 `resolveProjectDirName` 是同模块加一项。
- `src/preload/index.ts`：`const api = {` 在 **`:35`**、对象闭合在 **`:82`**、`:87 contextBridge.exposeInMainWorld('api', api)` ⇒ 步骤 7 的「api 对象（`:35-82`）」**行号精确**。全文件 `process.argv` **0 命中**（本次新引入，无历史包袱）。
- `src/preload/index.d.ts`：`declare global { interface Window { api: { … } } }`，加 `projectDirName?: string` 可行 ✓。
- `src/main/ipc/misc-handlers.ts`：`:316 resolveGeneratedImagesDir(`、`:317-322` 输入对象、`:323 resolveDataDir()` ⇒ **只两个实参**，第三实参确实漏 ✓。
- `src/main/lib/generated-image-dir.ts`：`:48-50` 签名 `(input: GeneratedImageScope = {}, dataRoot: string)`、`:61` `join(workingFolder, WISHFUL_CLAW_DATA_DIR_NAME, GENERATED_IMAGES_SUBDIR)` ⇒ 加第三可选参（默认裸名）可行、SSH 分支 `:56` 不受影响 ✓。
- `src/shared/project-dir.ts`、`src/renderer/src/lib/project-data-dir.ts`：`Test-Path` **均 False** ⇒ 「2 新建」属实 ✓。

### 7. §三 / §六 计数（任务第 3 问：是不是 37）

- **C# 15 改**：`WishfulClawPaths.cs`、`WishfulClawDataDir.cs`、`MemoryPathResolver.cs`、`SystemPromptCache.cs`、`GoalFileTools.cs`、`GoalPlanTracker.cs`、`AgentRuntimePlanExecutor.cs`、`AgentRuntimePlanExecutor.Helpers.cs`、`AgentRuntimeProjectExecutor.cs`、`AgentRuntimeGlobalTaskExecutor.cs`、`PersonaStore.cs`、`PromptBuilder.cs`、`Tools/Providers/{Project,Plan,GlobalTask}ToolsProvider.cs`(3) = **15**；另 `CodeGraphDataDir.cs` 是**备查（不改）**，不计入。
- **TS 2 新建 + 12 改 = 14**：新建 `shared/project-dir.ts`、`renderer/src/lib/project-data-dir.ts`；改 `main/lib/data-dir.ts`、`main/index.ts`、`main/lib/native-worker.ts`、`main/lib/generated-image-dir.ts`、`main/ipc/misc-handlers.ts`、`main/ipc/codegraph-handlers.ts`、`preload/index.ts`、`preload/index.d.ts`、`memory-files.ts`、`project-archive-helpers.ts`、`ProjectArchivePage.tsx`、`task-board-store.ts` = **12**。
- **其他 8**：`.gitignore`、`docs/data-storage.md`、`docs/development.md`、`README.md`、`AGENTS.md`、`tests/generated-image-dir/program.ts`、`tests/project-dir/program.ts`、`package.json` = **8**。

⇒ **15 + 14 + 8 = 37**，与 §六「改动 37 个文件」**逐字吻合，多了少了各 0**。唯一要留意的是「15 改 + 1 备查」若把备查也数进去会得 38 —— plan 已明确标注「列此备查」，口径没问题（§六 另缺文档产物的说明，见 ⚠️8）。

### 8. 文档 / `.gitignore` 原文

- `README.md:107` =「全部数据存在你自己的电脑上：`~/.wishful-claw/`…，项目级数据在 `{项目目录}/.wishful-claw/`」
- `AGENTS.md:142` =「- 记忆和人格的配置文件使用 Markdown 格式（.wishful-claw/ 目录下）」
- `.gitignore:74` = `.wishful-claw/*`（全仓 `wishful` 只此一条）⇒ 步骤 8 的「现有只有 `.wishful-claw/*`」属实
- `AGENTS.md:178` =「只有以下三类可以超 500 行，且必须在**文件头注释写明豁免理由与当前行数**」⇒ 步骤 9 的「注入后重数」口径正解
- `docs/data-storage.md:26` 起为 `### 项目工作区`，正文「项目级文件放在工作区路径下 `.wishful-claw/`」⇒ 步骤 10 的改点存在

### 9. 需求 §7 六条 ↔ 步骤 11 / 12

| 需求 §7 | 落地位置 | 判定 |
|---|---|---|
| 1 dev 生成 `-dev` 且不新建 `.wishful-claw/` | 步骤 12 `:215` | ✅ |
| 2 打包版零变化 | 步骤 11 用例 1（`:204`）+ 步骤 12 `:219` 指向 | ✅ |
| 3 项目记忆落 `-dev` | 步骤 12 `:216` | ✅ |
| 4 全局记忆仍在 `~/.wishful-claw-dev/` | 步骤 12 `:217`（含 `~/.wishful-claw` mtime 不变） | ✅ |
| 5 门禁（typecheck / dotnet build / npm test） | 步骤 11 `:209-210`（`0 警告` 缺，见 ⚠️2） | ✅（⚠️2） |
| 6 全局路径未受影响（无 `-dev-dev`） | 步骤 12 `:218` | ✅ |

六条全覆盖、无顶号 ⇒ 第四轮 ❌2 确已收口。

### 10. 行尾与 BOM（追加前后）

- 追加前：113758 字节、无 BOM、SHA256 `a15d8189…f911d1`。
- 追加方式：`[IO.File]::AppendAllText(…, UTF8Encoding($false))`，**新内容全部 CRLF**，前四节一个字节未动（prefix 前缀校验见下）。文件里原有 **176 处裸 LF** 是前几轮留下的，按「前四节原文一字不改」要求本轮未去动它。

---

## 【第六轮终审】结论

**❌ 0 条 / ⚠️ 1 条 / ✅ 5 条。❌ = 0 ⇒ 可以进入阶段四。**

第五轮的 2 条 ❌ 都真收口了，且这一刀**没有引入新错**（我逐条复算了步骤 11 的三句断言、实跑了步骤 4 的判据命令、实测了 esbuild 的 out 目录行为）。剩下 1 条 ⚠️ 是「单测套件少了计数行」，只影响 `npm test` 汇总里显示的断言数，不影响通过与否，不阻断。本轮不再就「措辞可以更好 / 可以更严谨」给 ❌。

## 【第六轮终审】第五轮 2 条 ❌ 与 3 条 ⚠️ 的验收

（下文 `plan.md` 行号按现行文件 360 行、裸 LF、无 BOM 计，与编辑器和 `ReadAllLines` 一致。）

| 编号 | 问题 | 是否真收口 | 证据 |
|---|---|---|---|
| 五轮 ❌1 | 步骤 11 第 3 例断言写反、与第 1/2 例自相矛盾 | **✅ 真收口** | `plan.md:213-216` 现为：`('x-custom', false)==='x-custom'` / `('  ', false)==='.wishful-claw-dev'` / `(undefined, true)==='.wishful-claw'`。按 §一 `:36-44` 的定义（`projectDataDirName(isDev) = isDev ? NAME-dev : NAME`；`pickProjectDirName(env, isPackaged) = env?.trim() ?: projectDataDirName(!isPackaged)`）**逐例演算三句全对**：① `'x-custom'.trim()` 真 ⇒ `'x-custom'`；② `'  '.trim()` 空 ⇒ `!false=true` ⇒ `.wishful-claw-dev`；③ `undefined` 空 ⇒ `!true=false` ⇒ `.wishful-claw`。与 `:211` `projectDataDirName(false)==='.wishful-claw'`、`:212` `projectDataDirName(true)==='.wishful-claw-dev'` **不再互斥**（③ 展开即 ①，一致）。`:213` 还留了「内部是 `!isPackaged`，别把断言写反」的护栏 |
| 五轮 ❌2 | 步骤 11 脚本行实跑必挂（`--experimental-strip-types`） | **✅ 真收口** | `plan.md:220` 现为 `"test:project-dir": "esbuild tests/project-dir/program.ts --bundle --platform=node --format=cjs --alias:@renderer=./src/renderer/src --outfile=tests/project-dir/out/program.cjs && node tests/project-dir/out/program.cjs"`。与 `package.json` 现有 61 个被收录的 TS 套件**同一形状**（`test:generated-image-dir` 逐字同名，只差路径；`&&`+`--outfile=…/out/program.cjs`+`node …` 齐全）。三件附加事我全实测：① **out 目录不用预建** —— esbuild 自动建多级目录（我把 `tests/generated-image-dir/program.ts` 打到 `D:\_probe_s223\deep\out\program.cjs`，exit 0、目录自动生成、`node` 跑出 `generated-image-dir: 23 checks passed`，探针已删、`git status` 无新增）；② **不用改 `.gitignore`** —— `.gitignore:51` 的 `out/` 无前导斜杠、任意深度生效，`git check-ignore -v tests/generated-image-dir/out/program.cjs` 返回 `.gitignore:51:out/`，且 `git ls-files tests/generated-image-dir/out` 为空（现有套件也不入库）；③ **会被 `npm test` 自动收录** —— `scripts/run-tests.mjs:29` 是 `.filter(k => k.startsWith('test:') && k !== 'test:clean')`，`test:project-dir` 必命中；C# 侧 `:32` 的正则 `/^WishfulClaw\..+RegressionTests$/` 不匹配 `project-dir`，不会重复计 |
| 五轮 ⚠️3 | 行数口径两处打架（`PromptBuilder.cs` 475「改后不会再涨」 vs 「475 → 476」） | **✅ 收口** | `plan.md:192` 已改为「`main/index.ts` 479 → 约 483、`PromptBuilder.cs` 475 → 476（补一行 `using`）」，与 §六 `:300` 同口径。行数复测：`main/index.ts` = **479**、`PromptBuilder.cs` = **475**（`[IO.File]::ReadAllLines().Count`），且 `PromptBuilder.cs:1-6` 六个 using 里确无 `WishfulClaw.Infrastructure.Storage` ⇒ 必补一行 ⇒ 476 成立 |
| 五轮 ⚠️8（四轮 ⚠️8 顺延） | 步骤 4「B 类 4 处都是多行拼接」不准 | **✅ 收口（且分类核对为真）** | `plan.md:118` 现写「其中 **3 处是 `"…" + "…"` 多行拼接**（`GlobalTaskToolsProvider:104-108`、`AgentRuntimeGlobalTaskExecutor:220-231`、`PlanToolProvider:64-65`）… **`ProjectToolsProvider.cs:32` 是单行完整字符串**」。**我逐处读了源码，分类正确**：`ProjectToolsProvider.cs:32` 是 `"Get project details (…)…send_session_message.",` 独立实参、前后无 `+`；`GlobalTaskToolsProvider.cs:102-108` 是 7 行 `+` 链、目标在 `:108`；`AgentRuntimeGlobalTaskExecutor.cs:221-230` 是 `+` 链、目标在 `:226`；`PlanToolProvider.cs:64-65` 是 2 行 `+` 拼接、目标在 `:65`。⇒ **3 拼接 + 1 单行**，与 plan 所述完全一致；「只给含目标字面量的那一行加 `$`」这条动作对 4 处都成立 |
| 五轮 ⚠️9（四轮 ⚠️9 顺延） | 步骤 4 判据未排除 `obj` / `bin` | **✅ 收口（实跑=8）** | `plan.md:125-128` 已插入 `Where-Object { $_.FullName -notmatch '\\obj\\|\\bin\\' }`。**我按改后原文逐字跑了一遍（改前状态）**：输出恰好 **8 条** = `AgentRuntimeGlobalTaskExecutor.cs:226`、`AgentRuntimeProjectExecutor.cs:599`、`AgentRuntimeProjectExecutor.cs:607`、`GlobalTaskToolsProvider.cs:108`、`PlanToolProvider.cs:65`、`ProjectToolsProvider.cs:32`、`WishfulClawPaths.cs:5`、`PromptBuilder.cs:339`，与 `:130` 写的「改前 8 条（7 处文案 + 常量定义）」**逐行对上**；不加过滤再跑也是 8（`obj`/`bin` 里今日 0 命中），所以这条过滤是纯防御性、不改变本次结论 |

## 【第六轮终审】能否开工

**可以开工 —— 一个没参与过讨论的工程师，只拿这份 plan + 源码，能从步骤 1 一路做到步骤 13，不需要停下来问任何人。**

理由（只列关键，其余 12 个步骤与第五轮判定一致、本轮未动）：

1. 唯一两处曾「必须停下来问」的点（步骤 11 的断言方向、步骤 11 的脚本行）**都已闭合**，且闭合后的写法是**照抄即正确**的：断言方向可由 §一 纯函数定义一眼验算；脚本行与仓库现有 61 个套件同形，esbuild 自动建 `out/`、`out/` 已被 `.gitignore:51` 忽略。
2. 曾最容易「按断言改实现」造成灾难（打包版落 `-dev`）的通道**已封死**：`plan.md:211` 钉了 `projectDataDirName(false)==='.wishful-claw'` 作验收 2 的机器锚点，`:216` 的 `(undefined, true)==='.wishful-claw'` 与之互为镜像。
3. 剩余未动项全是「实施时顺手定也无所谓 / 门禁会拦」的级别：单测计数行（不影响通过）、几行 import（TS 必拦）、§七 收口表（纯文档留痕）。

## 【第六轮终审】❌ 必修项

无。

## 【第六轮终审】⚠️ 建议项

1. **⚠️1（第五轮 ⚠️2 的后半条，唯一仍开的建议）步骤 11 没写单测的计数行。** `scripts/run-tests.mjs:49` 用 `/passed[:\s]+(\d+)/i` 抓各套件自报的断言数，现有套件末行都是 `console.log(\`generated-image-dir: ${checks} checks passed\`)`（`tests/generated-image-dir/program.ts:187`）。plan 的步骤 11 只要求「约 30 行」，没写这行 ⇒ 实施者很可能不写 ⇒ `npm test` 汇总里该套件只显示 `ok`、不带断言数。**不阻断**（套件通过与否由 exit code 判），但建议在 `plan.md:210` 补半句：「末行照现有约定打 ``console.log(`project-dir: ${checks} checks passed`)``」。

**以下为「延续项」（第五轮已登记、本轮仍未动，不重复计分、不阻断）**：

- 延续：步骤 6 的 `resolveProjectDirName()` 代码块缺两行 import；步骤 7 三处改常量所需的新 import 路径未给（TS 编译必拦，修法唯一）。
- 延续：步骤 9 验证句 `plan.md:195`「四份文件**首行**即豁免注释」与 `:193`「若首行是版权注释则紧随其后」冲突（`AgentRuntimePlanExecutor.cs:1-7` 是版权块、`:8` 才是首条 using）；按 `:195` 去验会误判。
- 延续：验收 5「0 警告」仍无判据（步骤 1 只写「0 错误」，步骤 11 只写「全绿」）。
- 延续：§七 无【第五轮】收口表，第四轮表仍只映 2 条 ❌、9 条 ⚠️ 未映。
- 附注（非缺陷）：`plan.md:218`「62 个现有 `test:*`」—— 实际被 `run-tests.mjs` 收录的是 **61** 个（62 含 `test:clean`）。基线 **79 = 61 TS + 18 C#** 是对的，`:223`「79 → 80 套」也对得上，不影响实施。

## 【第六轮终审】我亲自核对的证据

### 1. §一 定义 ↔ 步骤 11 三例的逐例演算（本轮 ❌1 的判定依据）

| 断言（`plan.md:214-216`） | 按 `:41-44` 展开 | 实际值 | 与 `:211`/`:212` 是否相容 |
|---|---|---|---|
| `pickProjectDirName('x-custom', false)` | `'x-custom'.trim()` 真 ⇒ 原值 | `'x-custom'` | ✅（env 覆盖与 `isPackaged` 无关） |
| `pickProjectDirName('  ', false)` | `'  '.trim()` 空 ⇒ `projectDataDirName(!false=true)` | `.wishful-claw-dev` | ✅ 与 `:212` 一致 |
| `pickProjectDirName(undefined, true)` | `undefined?.trim()` 空 ⇒ `projectDataDirName(!true=false)` | `.wishful-claw` | ✅ 与 `:211` 一致 |

`src/shared/data-dir.ts` 首行实读 = `export const WISHFUL_CLAW_DATA_DIR_NAME = '.wishful-claw'` ⇒ 上面 `.wishful-claw` / `.wishful-claw-dev` 字面量全对。

### 2. 套件计数与收录规则（本轮 ❌2 的判定依据）

- `package.json` 里 `test:*` = **62**，其中 `test:clean` 被 `scripts/run-tests.mjs:29` 排除 ⇒ 实收 **61** 个 TS 套件。
- `tests/` 下匹配 `/^WishfulClaw\..+RegressionTests$/` 的目录 = **18** ⇒ 现基线 **61 + 18 = 79**，新增一个 ⇒ **80**，与 `plan.md:223` 完全一致。
- 脚本形状对照：`test:generated-image-dir` = `esbuild tests/generated-image-dir/program.ts --bundle --platform=node --format=cjs --outfile=tests/generated-image-dir/out/program.cjs && node tests/generated-image-dir/out/program.cjs` ⇒ `plan.md:220` 是同一模板（多一个 `--alias:@renderer=…`，多数现有套件也带，无害）。`--experimental-strip-types` 全仓 0 命中，`:218` 的禁令正确。

### 3. esbuild 探针（out 目录是否需预建）

```
node_modules\.bin\esbuild.cmd tests/generated-image-dir/program.ts --bundle --platform=node --format=cjs --outfile=D:\_probe_s223\deep\out\program.cjs
→ esbuild exit=0 ；D:\_probe_s223\deep\out\program.cjs 存在 ；node 运行 → "generated-image-dir: 23 checks passed" ，exit=0
（探针目录已删除，git status 未多出任何文件）
```
⇒ 多级 `out/` 由 esbuild 自动创建，**无需预建**；且该文件 import 的是无扩展名相对路径 `'../../src/main/lib/generated-image-dir'`，bundle 正常 ⇒ `plan.md:210`「无扩展名没问题，esbuild 会解析」成立。

### 4. `.gitignore` 与 ignore 生效性

- `.gitignore:51` = `out/`（无前导斜杠）。
- `git check-ignore -v tests/generated-image-dir/out/program.cjs` → `.gitignore:51:out/	tests/generated-image-dir/out/program.cjs`（exit 0）。
- `git ls-files tests/generated-image-dir/out` → 空 ⇒ 现有套件产出物从不上库。⇒ `tests/project-dir/out/` 同样自动忽略，**不必改 `.gitignore`**。

### 5. 步骤 4 判据实跑（改前状态，按 `plan.md:125-128` 原文）

```
src\runtime\WishfulClaw.Agent\AgentRuntimeGlobalTaskExecutor.cs:226
src\runtime\WishfulClaw.Agent\AgentRuntimeProjectExecutor.cs:599
src\runtime\WishfulClaw.Agent\AgentRuntimeProjectExecutor.cs:607
src\runtime\WishfulClaw.Agent\Tools\Providers\GlobalTaskToolsProvider.cs:108
src\runtime\WishfulClaw.Agent\Tools\Providers\PlanToolProvider.cs:65
src\runtime\WishfulClaw.Agent\Tools\Providers\ProjectToolsProvider.cs:32
src\runtime\WishfulClaw.Contracts\WishfulClawPaths.cs:5
src\runtime\WishfulClaw.Persona\PromptBuilder.cs:339
count=8
```
去掉 `obj`/`bin` 过滤再跑，仍是 **8**（`obj`/`bin` 内 0 命中）⇒ 过滤不改变本次判定，只为 `dotnet build` 之后的误报通道兜底。

### 6. 7 处文案的类型（A/B 分类）逐行实读

- A 类 · 已插值（3 处）✅：`AgentRuntimeProjectExecutor.cs:599` `$"and write a clean summary to \`.wishful-claw/project-status.md\`…" +`、`:607` `$"at \`{workingFolder}/.wishful-claw/project-status.md\`.";`、`PromptBuilder.cs:339`（在 `:335` `$"""` 起的插值块内，`:340` 收口）。
- B 类 · 普通字面量（4 处）✅：`ProjectToolsProvider.cs:32`（单行独立实参）；`GlobalTaskToolsProvider.cs:108`（`:102-108` 拼接链末段）；`AgentRuntimeGlobalTaskExecutor.cs:226`（`:221-230` 拼接链中段；注意同链 `:222/:223/:229` 已是 `$"`，只加 `:226` 不会破坏花括号转义）；`PlanToolProvider.cs:65`（`:64-65` 两行拼接）。
- 花括号复核 ✅：这 7 行里只有 `PlanToolProvider.cs:65` 含字面 `{planId}`，其余 6 行确实无 `{` ⇒ `plan.md:119` 的「仅此一处」成立。

### 7. 行数复测（`[IO.File]::ReadAllLines().Count`）

`AgentRuntimeProjectExecutor.cs` 609 / `native-worker.ts` 588 / `AgentRuntimePlanExecutor.cs` 557 / `AgentRuntimeGlobalTaskExecutor.cs` 545 / `main/index.ts` 479 / `PromptBuilder.cs` 475 ⇒ 步骤 9 `:187-190` 四个改前值、`:192` 的 479/475 全部命中。

### 8. 文件形态

- `plan.md`：360 行、无 BOM、裸 LF（360 个 `\n`、0 个 `\r`）。
- `compliance_report.md`：无 BOM；追加段全部 CRLF；**前五节一个字节未动**（沿用上几版处理方式，未去动历史遗留的裸 LF）。
