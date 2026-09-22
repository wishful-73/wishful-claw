# v2-iter-1：Runtime 分层架构重构


**目标**：Worker 项目从 192 文件/29k 行的巨型项目拆分为 `WishfulClaw.Agent` + `WishfulClaw.Persona`，Worker 回归薄层 IPC 宿主。为后续所有功能开发打基础。

| 步骤 | 内容 |
|------|------|
| 1 | 创建 `WishfulClaw.Agent` 项目，将 AgentRuntime（60 文件）迁入：AgentLoop、所有 Executor、Provider、ConversationCodec、ContextCompression、ToolCallProcessor、SubAgent |
| 2 | 创建 `WishfulClaw.Persona` 项目，将 Persona（9 文件）迁入：PromptBuilder、PersonaGenerator、PersonaStore |
| 3 | Core 上提：ToolSchemaBuilder、ToolDefinitionPlaceholder、ToolModuleState 从 Worker 移到 Core |
| 4 | Worker 精简：仅保留 IPC 宿主 + Module 装载 + Program.cs |
| 5 | Contracts 精简：只留接口，JSON 序列化实现移到 Core 或 Worker |
| 6 | 更新 sln 引用关系，确保分层依赖正确（Agent → Core + Contracts；Persona → Core + Contracts；Worker → Agent + Persona + Core + Contracts） |
| 7 | 双编译验证：`dotnet build` + `npx tsc --noEmit -p tsconfig.web.json` 零错误 |

**验证标准**：编译通过，应用启动正常，核心对话 + 工具调用 + 记忆 + 人格全链路功能不回归。

**分支**：`dev/v2-iter-1`　**Tag**：`v2.1.0`　**状态**：✅ 已完成
