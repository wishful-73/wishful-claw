# 规划合规审查报告：CodeGraph 索引入口迁移至项目档案页 + 索引存储项目本地化

> 审查对象：`docs/plans/iter-v2-21/plan-codegraph-project-archive.md`
> 审查依据：`AGENTS.md`（7 层架构、AOT 规范、目录结构、大文件拆分、迭代交付标准）
> 审查方式：只读静态审查，未执行构建。

## 逐项检查

### 1. 步骤是否完整覆盖任务目标
✅ 5 步（后端 dataRoot 重载 → main IPC 注入 → 前端项目档案页区块 → 插件面板精简 → 整体验证）完整覆盖四大目标：入口迁到项目档案页、索引存储改到项目本地 `.wishful-claw/codegraph/`（含 SSH 回退）、插件面板保留精简版（仅资产诊断）、未启用时置灰 + 引导。存量 DB 不迁移的策略也在"老大已确认的决策"中明确，与目标一致。

### 2. 每步是否有明确验证检查点
⚠️ 步骤 1–4 各自有验证（`dotnet build`、TS node/web 零错误），步骤 5 有端到端启动验证 + `verification_report` 输出；但步骤 5 未显式包含 AGENTS.md 强制要求的"AOT 0 警告"验证（仅写了 `dotnet build` 0 错误），建议在步骤 5 追加 `scripts/publish-aot-worker.mjs` 或等价 AOT 编译验证，确保 `AOT 0 警告`。

### 3. 文件路径是否符合 AGENTS.md 项目结构
✅ 全部命中现有目录与命名约定：`src/runtime/WishfulClaw.CodeGraph/Support/CodeGraphDataDir.cs`、`CodeGraphEngine.cs`、`Mcp/CodeGraphToolHandler.cs` 属 vendored CodeGraph 项目；`src/main/ipc/codegraph-handlers.ts` 在 main IPC 层；`src/renderer/src/components/chat/ProjectArchivePage.tsx`、`codegraph-index-progress.tsx`（新建，kebab-case 合规）、`src/renderer/src/components/settings/AppPluginPanel.tsx`、`src/renderer/src/locales/{zh,en}/{chat,settings}.json` 均在规范目录。C# PascalCase、TS kebab-case 命名一致。

### 4. 分层依赖是否正确
✅ 依赖方向单向合规：dataRoot 在 main IPC 层（`codegraph-handlers.ts`）解析并注入 `input.dataRoot`，再透传给 Worker 侧 vendored CodeGraph；renderer 只传 `projectId` 或不传，不感知存储细节，符合"renderer 不感知存储细节"决策。WishfulClaw.CodeGraph 属 vendored 项目，AGENTS.md 明确其"不参与 7 层依赖链，仅被 Worker 引用"，本 plan 只改 CodeGraph 项目内部（Support/Engine/Mcp）与 main IPC，未引入对 Contracts/Core/Infrastructure 等 7 层的逆向依赖，也未让下层引用上层。

### 5. 是否遵守 AOT 规范
⚠️ plan 本身未引入反射序列化、`Activator.CreateInstance`、`Assembly.GetTypes()`、匿名类型序列化、独立 `JsonSerializerOptions` 等 AOT 禁区；dataRoot 作为可选字段透传，由 vendored CodeGraph 既有序列化路径处理，风险可控。但 plan 未显式要求对新增/修改的序列化类型补充 `JsonTypeInfo` 注册，也未在步骤 5 强制 AOT 编译验证（见检查项 2 的 ⚠️），存在执行时遗漏 AOT 注册的风险。

## 结论

❌ 项数量：**0**（可通过）。

存在 2 处 ⚠️，均为"步骤 5 应显式追加 AOT 0 警告验证 + 序列化类型注册检查"的同一类建议，建议在正式执行前补入步骤 5 验证清单，其余无阻塞项。
