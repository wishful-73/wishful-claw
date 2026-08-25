# CodeGraph 项目档案页迁移 — 独立代码审查报告

审查态（只读）。对照 Plan（c7838e9 / 2317089 / ae51678 / 3f90d0c / 09ecb71 / 084516f / 59e307a）逐项核查。

## 结论摘要

| 项 | 结果 |
|---|---|
| 1. 分层约定 | ✅ |
| 2. AOT 规范 | ✅ |
| 3a. dataRoot 注入链路完整性 | ❌（prompt-context RPC 未 RegisterDataRoot） |
| 3b. ListProjects 集中式 | ⚠️ |
| 3c. RegisterDataRoot sticky 语义 | ⚠️ |
| 3d. SSH `~` 在 Windows worker | ❌ |
| 3e. misc-handlers.ts mutate args.params | ✅（无泄漏） |
| 4. 错误处理 | ⚠️ |
| 5. UI 字段对齐 | ⚠️ |

**❌ 数量：2**（3a + 3d）。另有 4 个 ⚠️ 需决策或加固。建议：修掉 3a 和 3d 后再合并；3b / 3c / 4 / 5 可作为 follow-up。

---

## 1. 分层约定（对照 AGENTS.md）

**✅ 通过。**

- AGENTS.md 明确 `src/runtime/WishfulClaw.CodeGraph` 是 vendored 层，"不参与 7 层依赖"（AGENTS.md §"项目结构（7 层架构）"）。
- 新增 `Support/CodeGraphDataDir.cs`（32–56 行）和 `Support/CodeGraphDataRootRegistry.cs`（22–48 行）都位于 CodeGraph 项目内，未跨越 Contracts/Core/Infrastructure/Workspace/Persona/Agent/Worker 边界。
- dataRoot 注入只在 main 层：`src/main/ipc/codegraph-handlers.ts:120`（agent 反向链）+ `src/main/ipc/misc-handlers.ts:57–68`（renderer 链）。Worker 侧只通过 `RegisterDataRoot(args)`（`CodeGraphToolHandler.cs:1054–1066`）读 RPC 参数，不反向依赖 main。
- SSH 的显式 dataRoot 由 renderer 侧构造（`codegraph-project-index.tsx:74–75`），main 层透传，符合 "dataRoot 只在 main 层注入" 约定。

---

## 2. AOT 规范：无反射序列化、JsonTypeInfo 显式传递

**✅ 通过。**

- `CodeGraphJsonContext.cs:12–14` 声明 `[JsonSourceGenerationOptions(GenerationMode = Metadata, PropertyNamingPolicy = CamelCase, DefaultIgnoreCondition = WhenWritingNull)]`。
- 所有 RPC 出口显式传 `CodeGraphJsonContext.Default.<TypeName>`：
  - `IndexStatusRpc`（Data.cs:399）、`StatsRpc`（:405）、`AnalyticsRpc`（:411）、`QueryNeighborsRpc`（:417）、`FilesTreeRpc`（:423）、`FileSymbolsRpc`（:429）
  - `IndexRpc`（Handler.cs:699）、`SyncRpc`（:706）、`ToolsListRpc`（:751）、`InstructionsRpc`（:761）、`Tool`（:1149）
  - 事件 `CodeGraphIndexComplete`（:532 / :624 / :1163）、`CodeGraphIndexProgressEvent`（:614 / :1256）
  - Admin：`ListProjectsRpc`（AdminTools.cs:121）、`RemoveProjectRpc`（:137）
  - PromptHook：`PromptContextRpc`（PromptHook.cs:228）
- `CodeGraphStore.cs:282 / :302` 用 `CodeGraphJsonContext.Default.ListString` 做 DB 内 JSON 列编解码。
- 未发现 `JsonSerializer.Serialize/Deserialize` 裸调用（无 typeInfo 参数）在 CodeGraph 项目内。

---

## 3. 正确性重点

### 3a. dataRoot 注入链路完整性

**❌ 存在缺口：`codegraph/prompt-context` RPC 未 RegisterDataRoot。**

所有 `codegraph/*` 调用路径逐一核查：

| 路径 | 入口 | dataRoot 到位？ |
|---|---|---|
| Agent 反向链（`codegraph_<action>`） | `codegraph-handlers.ts:95–137` `handleCodeGraphTool` → `resolveCodeGraphDataRoot`（:120）→ 写入 `input.dataRoot`（:129）→ worker `request`（:132） | ✅ main 注入 |
| Worker 各 tool RPC（explore/search/status/node/callers/callees/impact/files/index/sync/tools-list/instructions） | `CodeGraphToolHandler.cs:647–761` 每个 Rpc 首行 `RegisterDataRoot(args)` | ✅ worker 侧注册 |
| Worker 结构化读 RPC（index-status/stats/analytics/query-neighbors/files-tree/file-symbols） | `Data.cs:398–429` 每个 Rpc 首行 `RegisterDataRoot(args)` | ✅ |
| Admin `RemoveProjectRpc` | `AdminTools.cs:123–138` 显式读 dataRoot 并 `Register`（:130） | ✅ |
| Admin `ListProjectsRpc` | `AdminTools.cs:120–121` 直接 `ListProjects()`，无注册（见 3b） | ⚠️ 见下 |
| Renderer 通用链 `worker:request` | `misc-handlers.ts:52–71`，`codegraph/` 前缀分支注入 `params.dataRoot`（:57–68） | ✅ |
| `codegraph-project-index.tsx` 的 `codegraph/index-status` / `codegraph/index` / `codegraph/sync` | 走 `agentBridge.request`（:101 / :140）→ `agent-bridge.ts:49` → `ipcClient.invoke('worker:request', ...)` → misc-handlers 注入 | ✅ |
| `dynamic-context.ts:59–63` 的 `codegraph/prompt-context` | 走 `agentBridge.request` → misc-handlers 注入 `dataRoot` 到 `params`，**但** `PromptContextRpc`（`PromptHook.cs:227–228`）**未调用 `RegisterDataRoot(args)`**，直接进 `PromptContext(args)` → `PlanFrontload(cwd, prompt)`（:69）→ `CodeGraphEngine.IsInitialized` / `CodeGraphDataDir.IsInitialized` 扫描 | ❌ |
| `codegraph/prompt-context` 内部 `Explore(BuildExploreArgs(...))`（PromptHook.cs:113） | `BuildExploreArgs`（:212–225）只写 `workingFolder` + `query`，**不写 `dataRoot`**，因此即便外层注册了，内部 `Explore` 也不会再次注册 | ⚠️ 次级 |

**影响**：session 重启后首次 prompt-hook 调用，`PlanFrontload` 用 `CodeGraphDataDir.IsInitialized` 扫"已索引项目"时，registry 尚未注册项目本地 dataRoot，会漏掉本地索引的项目 → hook 返回 `noop-no-index`（PromptHook.cs:72），即"索引了但 hook 以为没索引"。后续同 root 调用因 sticky 注册会正常。

**修复建议**：在 `PromptContextRpc` 首行加 `RegisterDataRoot(args)`，与其它 Rpc 保持一致。

### 3b. `CodeGraphDataDir.CodeGraphBaseDir()` 无参调用点

**⚠️ 可接受但需决策。**

- 无参 `CodeGraphBaseDir()` 调用点：`AdminTools.cs:30`（`ListProjects`）、`:103`（`RemoveProject` 按 hash 回退）。
- `ListProjects()` 只枚举 `~/.wishful-claw/codegraph/<hash>/`，**不会**枚举项目本地 `.wishful-claw/codegraph/` 目录。迁移后项目本地索引的项目会从 list-projects 消失。
- `RemoveProject` 按 hash 回退路径同理，但主路径（`workingFolder`）走 `CodeGraphDataDir.Remove(workingFolder)`（:91），该函数走 `CodeGraphDir` → registry，正确命中项目本地目录。

**判断**：若 `ListProjects` 是给旧集中式存储的兼容入口、未来由项目档案页替代，则 ⚠️ 可接受；若仍作为"已索引项目列表"使用，则 ❌ 需改为枚举 registry + 集中式两侧。

### 3c. RegisterDataRoot sticky 语义

**⚠️ 理论风险，当前代码实际无触发路径。**

- `CodeGraphDataRootRegistry.Register`（`CodeGraphDataRootRegistry.cs:28–38`）是"后写覆盖"语义：同 key 先集中式再项目本地会覆盖。
- `CodeGraphToolHandler.EnsureHandle`（Handler.cs:142–148）用 `Path.GetFullPath(root)` 做缓存 key，与 registry key 一致。
- 风险场景：同 root 先以集中式打开引擎（缓存命中），再以项目本地 dataRoot 调用 → 缓存返回旧引擎，DB 路径不一致。
- **当前代码实际无触发路径**：main 层 `resolveCodeGraphDataRoot`（codegraph-handlers.ts:147–168 / misc-handlers.ts:57–68）在**每次** `codegraph/*` RPC 都注入 dataRoot；worker 侧 `RegisterDataRoot` 在每次 Rpc 首行执行，先于 `EnsureHandle`。因此"先集中式打开"只可能发生在 dataRoot 缺失时（SSH 未显式传、workingFolder 不存在），此时 registry 未写入，`EnsureHandle` 用集中式默认，后续同 root 带 dataRoot 会覆盖注册但**缓存已命中旧引擎**。
- 结论：若 session 生命周期内同 root 先被"无 dataRoot"调用（例如 agent 反向链的 workingFolder 不存在、或 SSH 项目未传 dataRoot），后续带 dataRoot 的调用会用错 DB。**建议**：在 `EnsureHandle` 前做"registry 变更后清缓存"检查，或让 `RegisterDataRoot` 在同 key 值变更时 `DropEngine(root)`。

### 3d. SSH `~` 在 Windows worker 侧 `Path.GetFullPath`

**❌ 明确 bug。**

- Renderer 侧（`codegraph-project-index.tsx:74–75`）构造 `~/.wishful-claw/projects/${activeProjectId}/codegraph`。
- 该字符串经 misc-handlers.ts:67 写入 `params.dataRoot`，原样传到 worker。
- Worker 侧 `RegisterDataRoot` → `CodeGraphDataRootRegistry.Register(root, dr.GetString())` → `Register` 内 `Path.GetFullPath(dataRoot.Trim())`（Registry.cs:36）。
- Windows 上 `Path.GetFullPath("~/.wishful-claw/...")` **不会**展开 `~`，会把 `~` 当作当前目录下的字面子目录（等价于 `<cwd>/~/.wishful-claw/...`）。
- 同理 `CodeGraphDataDir.HashRoot`（DataDir.cs:102）对 projectRoot 也走 `Path.GetFullPath`，但 projectRoot 通常不是 `~` 开头，故主要影响 dataRoot。

**修复建议**：在 main 层 `resolveCodeGraphDataRoot` 返回前，或 worker 侧 `RegisterDataRoot` 内，对 `~` 前缀做 `Environment.GetFolderPath(UserProfile)` 展开。

### 3e. misc-handlers.ts mutate `args.params` 副作用

**✅ 无泄漏。**

- `misc-handlers.ts:56` 把 `args.params ?? {}` 强转为 `Record<string, unknown>` 并赋值给局部 `params`。
- `:67` 直接 `params.dataRoot = dataRoot` 修改该对象。
- `:70` 用 `args.params ?? {}`（原始引用）传给 `worker.request`。
- MessagePack 反序列化在 main 层产生新对象，与 renderer 无共享引用；handler 内部不再复用该对象。因此 mutation 不泄漏到 renderer，也不影响同一次 handler 内的其它字段。
- 风格上可改为 `{ ...(args.params ?? {}), dataRoot }` 更清晰，但功能正确。

---

## 4. 错误处理

**⚠️ 覆盖基本，三处可加固。**

- **worker 不可用**：`codegraph-handlers.ts:131–137` 用 try/catch 包 `getNativeWorker().request`，失败返回 `not_indexed` 形状（`codeGraphNotReadyResult`，:54–61）。`codegraph-project-index.tsx:156–159` toast 错误。✅
- **目录不可写**：`resolveCodeGraphDataRoot`（codegraph-handlers.ts:161–163）只检查 `workingFolder` 存在且是目录，不检查可写性。不可写时 dataRoot 仍会被注入，worker 侧 `CodeGraphStoreFactory.Open` 抛异常 → `IndexRpc` catch → `IndexFail(..., Internal)`（Handler.cs:551–554）。功能正确但错误信息不指向"目录不可写"。⚠️
- **并发索引**：
  - 单进程内：`EngineHandle.Gate`（Handler.cs:142–148 的 `Lazy<EngineHandle>` + `SemaphoreSlim`）序列化所有 writer 操作；`AutoIndexTasks`（:857–890）是 per-root single-flight。✅
  - 但 `AutoIndexFirstUse`（:862–900）与显式 `IndexRpc` 可能竞态：agent 首次调用 explore 触发 auto-index 后台任务，同时用户点击 Index → 两者都 `EnsureHandle` 后 `Gate.WaitAsync`，后者排队等前者，功能正确但用户体验上"点了 Index 要等 auto-index 先跑完"。⚠️
  - 跨进程：`CodeGraphProcessLock.Acquire(GraphDbPath(...))`（Engine.cs:223 / :462）处理。✅

---

## 5. UI：`codegraph-project-index.tsx` 渲染分支 vs index-status DTO

**⚠️ 字段基本对齐，一处潜在 Invalid Date。**

Worker `CodeGraphIndexStatus` 记录（Data.cs:442–458）字段（PascalCase → camelCase）：
`success, indexed, state, indexing, fileCount, nodeCount, edgeCount, pendingReferenceCount, dbSizeBytes, backend, journalMode, stale, indexedWithVersion, lastIndexedAt, error, errorKind`

UI `CodeGraphIndexStatus` 接口（codegraph-project-index.tsx:32–42）声明：
`success, indexed, state, indexing, fileCount, nodeCount, edgeCount, dbSizeBytes, lastIndexedAt` — 全部 camelCase，与 DTO 对齐 ✅。

渲染分支核查：
- `status?.state && status.state !== 'not_indexed'`（:204 / :266）→ 依赖 `state` 字段 ✅
- `status.fileCount / nodeCount / edgeCount`（:280–282）✅
- `status.dbSizeBytes`（:285）✅
- `status.lastIndexedAt`（:286–288）→ `new Date(status.lastIndexedAt)`。**⚠️** DTO 的 `LastIndexedAt` 是 `long?`（Data.cs:447），可能为 null；UI 接口声明 `number | null`，但 `if (status.lastIndexedAt)` 只挡 falsy（0 会被误挡，null 会通过 `new Date(null)` → `Invalid Date`）。建议改 `typeof status.lastIndexedAt === 'number'`。
- `status?.success` 用于 sync 按钮 disabled（:212）✅
- `CodeGraphIndexProgress` 接口（:22–29）字段 `indexId/phase/filesDone/filesTotal/nodeCount/edgeCount` 与 worker `CodeGraphIndexProgressEvent`（ToolResult.cs:92–99）完全对齐 ✅
- `index-complete` 事件在 main 层被改写为 `{ ...params, done: true }`（codegraph-handlers.ts:40）广播到 `INDEX_PROGRESS`，但 UI 的 progress reducer（:78–90）只按 `indexId` 存在性接收，`done` 字段未被消费——进度条不会自动归零。⚠️（小 UX 瑕疵，59e307a 已修字段对齐，但 done 未处理）

---

## ❌ 汇总（2 项）

1. **3a** — `PromptContextRpc` 未 `RegisterDataRoot(args)`，首次 prompt-hook 调用漏掉项目本地索引。
2. **3d** — SSH `~` 路径在 Windows worker 侧 `Path.GetFullPath` 不展开，dataRoot 落到错误目录。

## 建议修复优先级

1. **P0**：`PromptHook.cs:227` 加 `RegisterDataRoot(args)`；`resolveCodeGraphDataRoot` 或 `RegisterDataRoot` 内展开 `~`。
2. **P1**：`EnsureHandle` 感知 registry 变更（同 key 值不同则 DropEngine）。
3. **P2**：`codegraph-project-index.tsx:286` 用 `typeof` 判 `lastIndexedAt`；`ListProjects` 明确废弃或补枚举项目本地。
