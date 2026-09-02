# Plan: 会话当前上下文 Manifest 与不可失效压缩快照

> 迭代：v2-iter-24
>
> 日期：2026-09-02
>
> 状态：规划验证通过（PASS，阻断项 0），等待用户确认后进入执行态

## 目标

修复会话压缩后恢复回 `source=full`、使压缩前历史重新进入模型上下文的问题。

将会话的当前上下文恢复基线改为由 `sessions` 显式指向的 snapshot manifest：

- 压缩 snapshot 成功持久化后，作为不可变的模型上下文基线；
- 普通消息新增、upsert、展示 artifact、compression status、usage/meta 修复不能删除或使当前 snapshot 失效；
- 恢复先读取 session 当前指针，再加载指定 snapshot，并只追加 snapshot cursor 之后的新消息；
- 旧消息表继续保留，前端最近 5 轮仍然只是展示分页，不参与普通 `agent/run` 的上下文发送；
- 只有显式整体重置、整体替换、会话删除/清理等“改变会话身份或上下文根”的操作，才允许解除当前指针；解除时优先保留旧 snapshot 作为历史诊断数据，不在普通路径物理删除。

## 已确认根因与现状

- `session_compaction_snapshots` 当前以 `session_id` 为主键，只保留一行；恢复通过 sessionId 查找 snapshot。
- `DbCompactionSnapshotStore.InvalidateIfUpsertCovered` 会在覆盖 cursor 内的 message upsert 时删除 snapshot。
- `DbMessageToolsMutations` 的 upsert/content-meta mutation 会调用该失效路径。
- 前端压缩 artifact/status 的异步 upsert 与 snapshot 持久化存在时序交叉，可能触发上述删除路径。
- `SessionRestoreTools` 找不到有效 snapshot 时静默 fallback 到 messages 全量恢复。
- 2026-09-02 日志确认：08:55:57 snapshot persisted，10:32:14 同一 session source=full messages=68；日志未记录具体删除者，不能把某一次 artifact upsert单独宣称为最终已证实原因，但当前失效设计已经足以允许该结果。

## 核心设计决策

### 1. Snapshot 是不可变上下文基线

snapshot 成功写入后，不再因为消息表的普通 mutation 做覆盖范围反校验，也不再自动删除。snapshot 中的 `wire_conversation`、压缩产物和 `through_*` 游标共同构成一次已提交的上下文版本。

普通 message mutation 的职责仅是维护历史展示数据；它不能否决已经提交给模型的上下文基线。

### 2. Session 保存当前恢复指针

在 `sessions` 增加 `current_snapshot_id TEXT NULL` 和 `context_revision INTEGER NOT NULL DEFAULT 0`。`current_snapshot_id` 是当前上下文 manifest 的唯一恢复入口，不承载大型 JSON；`context_revision` 只用于压缩提交的乐观并发控制，不随普通消息写入递增。

最终 schema 固定为：

- `session_compaction_snapshots.snapshot_id TEXT PRIMARY KEY NOT NULL`；
- `session_compaction_snapshots.session_id TEXT NOT NULL`，建立 `(session_id, created_at DESC)` 索引；
- 保留现有 version、trigger、wire_conversation、compact_artifacts、summary、through cursor、统计和时间字段；
- `sessions.current_snapshot_id` 不强制 SQLite 外键，以便迁移和诊断阶段保留 dangling pointer；恢复时显式检查指针目标的 session_id；
- snapshot 只 INSERT，不 UPDATE；旧 snapshot 只读保留，显式清理端点才可物理删除。

不保留“每 session 一行 snapshot”或 schema 二选一。旧库迁移固定采用“新表复制 + 原子表名切换”，不在同名旧表上依赖 `CREATE TABLE IF NOT EXISTS`：

1. 在 `DbClient.Initialize` 的 schema 版本检查中，通过 `sqlite_master` 读取 `session_compaction_snapshots` 的列集合和主键定义；若已存在 `snapshot_id` 主键且包含最终字段，则只执行缺失索引/列的幂等检查；若存在旧的 `session_id` 主键表，则进入迁移事务。
2. 事务内先 `ALTER TABLE session_compaction_snapshots RENAME TO session_compaction_snapshots_legacy_v1`；创建最终 `session_compaction_snapshots` 表（`snapshot_id` 主键、`session_id`、现有 payload/cursor/统计字段）和 `(session_id, created_at DESC)` 索引。不得让旧表名继续被 `IF NOT EXISTS` 误判为已完成。
3. 从 legacy 表逐行复制全部字段：`snapshot_id = 'legacy-' || session_id || '-v1'`；使用 `INSERT OR IGNORE`，并校验 `session_id`、payload、cursor、统计字段均已复制。旧表中重复 session 行若存在，按 `updated_at DESC, rowid DESC` 选择一行并记录迁移告警，不静默覆盖新指针。
4. 对每个复制成功且存在对应 `sessions` 行的 snapshot，仅在 `sessions.current_snapshot_id IS NULL` 时执行条件回填；已有非空指针绝不覆盖。不存在对应 session 的行保留在最终表，标记为 orphan（通过诊断查询识别），不回填任何指针。
5. 创建/确认最终索引和迁移标记后，在同一事务内 `DROP TABLE session_compaction_snapshots_legacy_v1`；旧表不作为运行时备份，但删除前必须完成逐行计数和关键字段校验。若任一校验失败，事务整体 rollback，SQLite 恢复原旧表名和数据，下一次初始化可重试。
6. 使用 schema/migration marker 或最终列/主键检测保证二次初始化不再 rename 已迁移表；二次初始化不得新增 snapshot、不得覆盖已有指针、不得改变 payload/cursor/统计。迁移期间禁止并发 Agent DB 操作，由初始化锁保证单实例执行。

### 3. Snapshot 写入和指针切换必须原子

成功压缩的事务顺序固定为：

1. 压缩调用方先等待当前已完成消息/工具结果落库；
2. 进入 DB 事务后读取 `sessions.context_revision` 和当前 `current_snapshot_id`；
3. 查询该 session 当前数据库消息边界；
4. 生成唯一 `snapshot_id`，INSERT 完整 snapshot payload；
5. 在事务内重新读取并验证新 snapshot 可解析、sessionId 一致、cursor 合法；
6. 使用条件更新 `sessions SET current_snapshot_id = @newId, context_revision = context_revision + 1 WHERE id = @sid AND context_revision = @expectedRevision`；
7. 条件更新影响行数不是 1 时回滚新 snapshot，并返回 `snapshot_commit_conflict`，旧指针保持不变；
8. 事务提交后，新 snapshot 成为恢复权威；旧 snapshot 保留，不在提交前删除。

SQLite 事务内通过 `BEGIN IMMEDIATE`/现有事务封装获取写锁，条件 revision 作为第二道保护；同 session 两个压缩任务最多一个能切换指针。若数据库在提交前失败，事务回滚；若未来出现孤儿 snapshot，只能由显式 orphan cleanup 诊断端点清理，不能影响当前指针。

失败时不更新 session 指针，不影响旧 snapshot，不把本次压缩结果报告为已提交恢复基线。

### 4. 恢复策略

`SessionRestoreTools`：

1. 先读取 session 行及 `current_snapshot_id`；
2. 指针为空：兼容旧库，执行一次全量 messages restore，并记录 `source=full reason=no-current-snapshot`；
3. 指针存在：按 snapshot_id 读取，不按“最新 updated_at”猜测；
4. 校验 snapshot 所属 session、版本、payload、cursor；
5. 使用 snapshot 的 `wire_conversation` 作为前缀；
6. 仅查询 cursor 之后的 messages 并追加；
7. 初始化 `SessionConversation`，日志记录 snapshot_id、cursor、增量数量和 `source=snapshot`。

对于 snapshot 损坏/版本不支持/游标无法解析：

- 保留 snapshot 和 session 指针，不自动删除；
- 统一返回具名 `SessionRestoreFailure`：`sessionId`、`snapshotId`、`reason`（`snapshot_not_found` / `unsupported_version` / `corrupt_payload` / `invalid_cursor` / `session_mismatch`）、`recoverable`、`requiresUserAction`；
- `SessionRestoreTools` 和 lazy restore 使用同一结果语义；指针存在但 snapshot 不可用时，AgentLoop 将恢复状态标记为 failed，不初始化可发送的 full conversation，不调用 provider；
- 只有 `current_snapshot_id IS NULL` 的旧会话允许兼容 full restore，结果明确标记 `source=full reason=no-current-snapshot`；
- 用户通过显式“修复上下文”操作选择：保留当前指针并重试读取、显式解除指针后 full restore、或生成新 snapshot；普通 agent/run 不得隐式执行这些动作。

这样“指针存在但损坏”和“旧库无指针”不会再混淆，也不会因保护性校验失败把压缩前 682K 历史静默送入 provider。

### 5. 删除边界

不再允许以下普通操作自动删除/失效当前 snapshot：

- 新增消息；
- 已有消息的普通 upsert；
- assistant/tool result 流式补全；
- compression status、compact artifact、summary 展示数据更新；
- usage/timing/meta 展示字段修复；
- 前端加载历史、重新分页、上下文摘要展示。

以下操作属于显式改变上下文根，可解除 session 当前指针：

- reset/clear conversation；
- replaceSessionMessages 整体替换历史；
- fork/duplicate 新建 session 时不继承原指针；
- 删除 session、删除全部 session、项目级联删除。

解除指针与整体历史操作必须在同一事务完成。物理删除 snapshot 不作为普通恢复副作用；如需要清理，由显式清理端点单独执行并记录日志。

### 6. 上下文查看

前端“上下文查看”不能把当前内存展示列表作为权威。增加只读后端 manifest 查询入口 `db/session-context-manifest`，返回专用 `SessionContextManifestRow`，不复用包含完整 `WireConversation` 的 `CompactionSnapshotRow`。

`SessionContextManifestRow` 固定只包含：

- `sessionId`、`currentSnapshotId`、`contextRevision`；
- `hasSnapshot`、snapshot version、createdAt/updatedAt；
- through cursor；
- original/new/messagesSummarized、summarizerFailed；
- `prefixMessageCount`、`incrementalMessageCount`；
- `restoreSource`（`snapshot` / `full` / `blocked`）、`restoreReason`；
- `failure`（具名错误码和是否需要用户操作），不包含 `wire_conversation`、完整 `compact_artifacts` 或摘要原文。

需要诊断 payload 时必须是单独的显式开发者/修复端点，不在本 Plan 的普通上下文查看入口开放。

上下文查看可以继续复用现有摘要展示 UI，但数据来源改为 manifest 查询；不把完整 wire conversation 默认塞进会话列表或普通 agent 请求。

## 步骤清单

- [ ] 步骤 1：更新 snapshot/session 数据契约和幂等迁移
  - 修改 `DbClient.cs` DDL/EnsureColumn 迁移，增加 `sessions.current_snapshot_id`、`sessions.context_revision`，创建最终独立不可变 snapshot 表及 `(session_id, created_at DESC)` 索引。
  - 修改 `Entities/SessionEntity.cs`、`Entities/CompactionSnapshotEntity.cs`、`EntityMappers.cs`、`InfrastructureJsonContext.cs` 和 session row 映射，固定 `SnapshotId` / `CurrentSnapshotId` / `ContextRevision` 字段。
  - 旧库迁移必须在事务中创建新表、按 `legacy-{sessionId}-v1` 生成确定性 ID、完整复制旧行、仅条件回填 NULL 指针；无对应 session 的 orphan snapshot 保留并可诊断；重复初始化不得新增重复行、不得覆盖已有指针、不得丢失 payload/cursor/统计。
  - 更新 `docs/plans/iter-v2-23/snapshot-contract.md`，删除“覆盖区普通修改即失效”旧条款，改为不可变 snapshot + session 指针契约。
  - Mini 验证：新库可创建；旧库初始化两次结果一致；旧 payload/cursor/统计逐列保留；AOT JSON 注册完整。

- [ ] 步骤 2：实现不可变 snapshot 写入与 session 指针原子切换
  - 修改 `DbCompactionSnapshotStore.cs`、`DbCompactionSnapshotTools.cs`、`ContextCompression.Persistence.cs`。
  - snapshot 只允许 insert-new；同事务执行条件 revision 指针切换；禁止先删旧 snapshot，禁止普通 upsert 覆盖当前 snapshot。
  - 明确 `snapshot_commit_conflict`、数据库异常和 JSON 校验失败的结果；事务回滚时旧指针/旧 payload 必须不变，孤儿 snapshot 只能由显式诊断清理处理。
  - Mini 验证：新 snapshot 写入成功后 session 指针指向新 ID；写入失败仍能读取旧 snapshot；两个并发压缩只有一个 revision 成功；重复普通消息 upsert 不改变指针和旧 payload。

- [ ] 步骤 3：移除普通消息 mutation 的 snapshot 失效权
  - 修改 `DbMessageToolsMutations.cs` 及所有调用 `InvalidateIfCovered` / `InvalidateIfUpsertCovered` 的路径；普通消息路径不再调用任何 snapshot 删除/失效 API。
  - 逐项核对 `DbSessionTools.cs`、`DbPluginSessionTools.cs`、`DbProjectTools.cs`、消息 clear/reset/replace/delete、fork/duplicate 的 pointer 行为：普通 upsert/artifact/status/usage/meta 修复保持 pointer；reset/replace/delete/clear 在同一事务解除 pointer；显式 orphan/history cleanup 才允许物理删除并记录日志。
  - 核对前端 `dbUpsertMessage`、`reconcileLoadedMessages`、压缩 artifact/status 写回，确保其写入不会触发上下文基线变化。
  - Mini 验证：覆盖区 content/meta/usage/status upsert 前后，current_snapshot_id、snapshot payload 和 cursor 不变；显式 reset/delete 后 pointer 为空，snapshot 行仍按保留策略可诊断。

- [ ] 步骤 4：按 current_snapshot_id 改造恢复并阻断损坏指针
  - 修改 `SessionRestoreTools.cs`、相关 `DbSessionTools.cs`/snapshot query DTO、`AgentLoop` 恢复状态处理。
  - 首次恢复读取 session manifest；按指定 snapshot_id 加载并追加 cursor 后增量；无指针旧库只走兼容 full restore。
  - 新增具名 `SessionRestoreFailure`/错误码结果，并让显式 restore 与 lazy restore 共享相同分支；指针存在但 snapshot 不可用时不初始化 full conversation、不调用 provider，向前端返回可操作错误。
  - 日志增加 `snapshot_id`、`source`、`reason`、`incremental_count`，禁止摘要全文和敏感参数。
  - Mini 验证：压缩→重启→恢复的 provider wire conversation 不含 cursor 前压缩前历史；新增消息只出现一次；损坏/版本错误指针不会产生 provider 请求。

- [ ] 步骤 5：接入上下文查看 manifest
  - 修改后端 `DbCompactionSnapshotTools`/`DbModule`、主进程 IPC/shared 类型和前端上下文查看数据适配。
  - UI 显示当前 snapshot ID、覆盖边界、前缀/增量统计和恢复来源；继续保持最近 5 轮仅为展示分页。
  - Mini 验证：UI 展示与后端当前指针一致，普通加载更多不会触发恢复或发送历史。

- [ ] 步骤 6：重写回归测试并完成完整验证
  - 重写 `tests/WishfulClaw.CompactionSnapshotRegressionTests/Program.cs` 中与旧契约相反的断言：删除“覆盖区普通 content/meta upsert 会 invalidated snapshot”和“同 session 单行 snapshot upsert 覆盖旧行”的旧测试，替换为 pointer/snapshot 多版本不变性断言。
  - 覆盖测试矩阵：幂等旧库迁移；新 snapshot insert + 条件 pointer 切换；写入/指针更新失败保留旧指针；并发压缩 revision 冲突；普通新增、content/meta/usage/status/artifact 修复 pointer/payload/cursor 不变；reset/replace/delete/clear 仅解除 pointer；重启 snapshot+cursor 后增量恢复且不重复；无指针才允许兼容 full；指针损坏/版本不支持/游标异常时 snapshot 保留、返回 `SessionRestoreFailure` 且 provider 调用计数为 0；manifest 查询不返回 wire payload；加载更多不触发恢复。
  - 运行：
    - `dotnet build src/runtime/WishfulClaw.sln`
    - `node scripts/publish-aot-worker.mjs`（检查 Native AOT 0 warning/0 error；如脚本支持独立输出则使用隔离输出，不能强杀运行中 Worker）
    - `npx tsc --noEmit -p tsconfig.web.json`
    - `npx tsc --noEmit -p tsconfig.node.json`
    - `npx tsc --noEmit -p tsconfig.json`
    - 相关 CompactionSnapshot 回归测试
    - `git diff --check`
  - 验证检查点：C#/TS/AOT 零错误零警告，回归测试通过，日志能证明 snapshot restore 而非压缩前 full restore；损坏指针不会触发 provider 请求。

## 涉及文件和模块

### 后端基础设施

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — DDL 与迁移
- `src/runtime/WishfulClaw.Infrastructure/Db/DbClientChannelSessionMigrations.cs` — session 迁移辅助（如适用）
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/SessionEntity.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/CompactionSnapshotEntity.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/EntityMappers.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/InfrastructureJsonContext.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbSessionTools.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbCompactionSnapshotStore.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbCompactionSnapshotTools.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbMessageToolsMutations.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbModule.cs`

### Agent 恢复与压缩

- `src/runtime/WishfulClaw.Agent/SessionRestoreTools.cs`
- `src/runtime/WishfulClaw.Agent/ContextCompression.Persistence.cs`
- `src/runtime/WishfulClaw.Agent/AgentLoop.ContextCompression.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeContextCompressionTools.cs`

### 上下文查看与前端持久化

- `src/runtime/WishfulClaw.Infrastructure/Db/DbCompactionSnapshotTools.cs` — 新增不含 wire payload 的 `SessionContextManifestRow` 查询结果
- `src/runtime/WishfulClaw.Infrastructure/Db/DbModule.cs` — 注册 manifest 查询端点
- `src/main/ipc/` 与 `src/shared/` — IPC channel、请求/响应类型和 AOT/MessagePack 边界适配（按现有 db 端点模式定位）
- `src/renderer/src/stores/chat-store/db-helpers.ts` — manifest 查询 helper
- `src/renderer/src/stores/chat-store/index.ts` — 上下文查看状态接入；修改时避开现有压缩显示差异
- `src/renderer/src/components/chat/ContextCompressionMessage.tsx`
- `src/renderer/src/components/chat/CompressionStatusMessage.tsx`
- `src/renderer/src/components/chat/CompactBoundaryMessage.tsx`
- `src/renderer/src/components/chat/InputArea/context-ring.tsx`
- 以上 UI 只展示 manifest 摘要、cursor 和统计，不把完整 wire conversation 放入 session 列表或普通 agent 请求。

### 测试与文档

- `tests/WishfulClaw.CompactionSnapshotRegressionTests/Program.cs`
- `docs/plans/iter-v2-23/snapshot-contract.md` — 必须同步更新旧的“覆盖区修改即失效”条款
- `docs/PROGRESS.md` — Plan 完成/验证后更新
- `docs/plans/iter-v2-24/plan-context-manifest/` — 规划验证、审查和验证报告

## 分层与兼容约束

- Contracts 不引用 Infrastructure/Agent；数据库实体、迁移和查询保持在 Infrastructure。
- Agent 只通过 Infrastructure 提供的 Db 工具/服务读取和提交 snapshot，不让 Worker 直接实现业务规则。
- 所有新增 JSON DTO 使用具名 record/class，并注册到对应 `JsonSerializerContext`；不使用反射、匿名类型或未注册序列化。
- 不把完整 wire conversation 放入 sessions 列表响应或前端普通 session 状态。
- 旧 session 无 current_snapshot_id 时允许一次兼容 full restore；兼容恢复必须有明确日志，不得在成功 snapshot 已有指针时静默回退。
- 保留现有消息历史；本 Plan 不删除压缩前消息。
- 本次不顺带修改 ProviderRetryPolicy 的 context overflow 重试策略，另立后续修复单元。

## 验收标准

1. 成功持久化的 snapshot 有稳定 ID，并由 `sessions.current_snapshot_id` 指向。
2. 普通消息 upsert、artifact/status/usage/meta 修复不删除、不失效、不改写当前 snapshot。
3. 新 snapshot 通过“先写入、再原子切指针”提交；失败保留旧指针和旧 snapshot。
4. 重启恢复默认使用当前指针 snapshot + cursor 后增量，不把 cursor 前压缩前历史重新送入 provider。
5. 无指针旧库只兼容 full restore，并可从日志区分原因。
6. 显式 reset/replace/delete 能解除当前指针；普通消息 mutation 不具备删除 snapshot 权限。
7. 上下文查看展示后端 manifest，不把最近 5 轮或前端分页状态当作恢复权威。
8. snapshot 损坏/版本不支持时保留现场并返回具名恢复错误；指针存在时不得静默 full restore，不得调用 provider。
9. `db/session-context-manifest` 只返回专用 manifest DTO，不返回完整 wire conversation 或 compact artifacts payload。
10. C# solution build、Native AOT publish 0 warning/0 error、三套 TypeScript tsc、相关回归测试和 `git diff --check` 通过。

## Git 与工作区隔离

- 基线检查点：`e9fbcd2 chore: checkpoint current workspace`。
- 当前分支：`dev/v2-iter-24`。
- 执行前必须再次确认工作区干净；本 Plan 之后的步骤按功能单元验证后分别 commit，不在 Plan 执行期间 push。
- 现有未提交改动已由 `e9fbcd2` 保存；后续只修改本 Plan 明确列出的文件。
- Plan 完成并通过用户验收后，按 docs 工作流一次性 push；验证结果交由用户裁定 PASS/FAIL/PARTIAL。
