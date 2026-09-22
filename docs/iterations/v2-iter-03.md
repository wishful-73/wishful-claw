# v2-iter-3：Infrastructure 层拆分


**目标**：新建 `WishfulClaw.Infrastructure` 项目，将 Db/Storage/Http 基础设施从 Worker 和 Agent 下沉，使 Worker 能进一步拆分 Tools 等模块。Worker 文件数从 113 降至 ~30。

| 步骤 | 内容 |
|------|------|
| 1 | 创建 `WishfulClaw.Infrastructure` 项目，配置 csproj 引用 Contracts + Core |
| 2 | 搬入 Db — `DbClient.cs` + `Entities/` 从 Worker/Modules/Db 迁入 Infrastructure/Db |
| 3 | 搬入 Storage — `ConfigStore.cs` + `ProviderStore.cs` + `JsonFileNodeCache.cs` 从 Worker 迁入 Infrastructure/Storage |
| 4 | 搬入 Http — `WorkerHttpClientFactory.cs` 从 Agent 迁入 Infrastructure/Http |
| 5 | 更新引用关系 — Agent 引用 Infrastructure；Worker 引用 Infrastructure；Worker 中的 Db Module 改为调用 Infrastructure |
| 6 | Worker 模块瘦身 — 将 FileTools / SearchTools / ShellTools / Providers 等工具实现迁出 Worker（迁入 Agent 或独立项目） |
| 7 | 更新 sln 引用关系，确保分层依赖正确（Contracts → Core → Infrastructure → Workspace → Persona → Agent → Worker） |
| 8 | 双编译验证：`dotnet build` + `npx tsc --noEmit -p tsconfig.web.json` 零错误 |
| 9 | 功能回归验证 — 核心对话 + 工具调用 + 记忆 + 人格 + DB 读写全链路不回归 |

**验证标准**：编译通过，应用启动正常，全链路功能不回归。Worker 文件数降至 ~30。Infrastructure 层独立可引用。

**分支**：`dev/v2-iter-3`　**Tag**：`v2.3.0`
