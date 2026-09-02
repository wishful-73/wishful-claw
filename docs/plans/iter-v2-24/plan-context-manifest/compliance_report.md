# 规划合规审查报告：会话当前上下文 Manifest 与不可失效压缩快照

审查日期：2026-09-02  
审查范围：`plan.md`、`AGENTS.md`、`docs/dev-workflow.md`、`docs/data-storage.md`、`docs/iteration-plan.md`，以及当前运行时代码、DTO、回归测试和 AOT 脚本引用。  
审查方式：只读核对；未修改业务代码。本报告是本次唯一覆盖更新的文件。

## 总体结论

**PASS（阻断项 0）**。

`plan.md` 已形成唯一且可执行的目标契约：`sessions.current_snapshot_id` 指向不可变的多版本 snapshot；恢复严格按指针和 cursor 读取；普通 mutation 不拥有 snapshot 否决权；显式上下文根操作才可解除指针；指针损坏时返回具名 `SessionRestoreFailure` 并阻断 AgentLoop/provider；上下文查看使用无 payload 的专用 manifest DTO；旧测试重写、Native AOT publish 和迭代归属均有明确条款与验证要求。

当前代码仍处于旧契约（旧一行-per-session 表、覆盖式 Upsert、损坏 snapshot 静默 full fallback），这些是计划步骤要修复的基线事实，不是规划遗漏。执行前不得把当前代码状态误报为已满足本 Plan。

## 阻断项

**0 项。** 未发现会阻止进入用户确认环节的规划缺口。

## 逐项审查

### 1. 最终 schema 唯一明确：PASS

- `plan.md:38-48` 固定 `sessions.current_snapshot_id TEXT NULL`、`context_revision INTEGER NOT NULL DEFAULT 0`，以及 `session_compaction_snapshots.snapshot_id TEXT PRIMARY KEY NOT NULL`、`session_id TEXT NOT NULL`、`(session_id, created_at DESC)` 索引、无强制外键、insert-only 和旧版本保留策略。
- `plan.md:50-57` 明确禁止在同名旧表上依赖 `CREATE TABLE IF NOT EXISTS`，要求通过 `sqlite_master` 识别列集合/主键，旧表 rename 为 `session_compaction_snapshots_legacy_v1`，新表创建后复制并原子切换。
- 该设计符合 SQLite 全局会话/消息存储边界（`docs/data-storage.md:48-58`），未将 snapshot 混入 Markdown 记忆存储。

当前实现反证（执行目标而非规划缺陷）：`DbClient.cs:301-319` 仍创建 `session_id` 主键旧表，`DbClient.cs:95-120` 的 sessions DDL 尚无新字段。

### 2. 旧同名表迁移、rename/rebuild、索引、复制、指针回填、orphan、legacy、失败回滚、幂等：PASS

- 识别：`plan.md:52` 要求读取 `sqlite_master` 的列集合和主键定义，并区分最终 schema 与旧 `session_id` 主键 schema。
- rename/rebuild：`plan.md:53` 固定在迁移事务中 rename 旧同名表、创建最终表和 `(session_id, created_at DESC)` 索引，避免旧表名被 `IF NOT EXISTS` 误判。
- 复制与重复行：`plan.md:54` 要求逐行复制全部字段，确定性生成 `legacy-{session_id}-v1`，`INSERT OR IGNORE`；重复 session 行按 `updated_at DESC, rowid DESC` 选择并记录告警。
- 指针回填：`plan.md:55` 仅对存在 session 且 `current_snapshot_id IS NULL` 的行回填，绝不覆盖已有非空指针。
- orphan：`plan.md:55` 明确无对应 session 的 snapshot 保留在最终表，通过诊断查询识别，不回填指针。
- legacy 处置与校验：`plan.md:56` 要求删除 legacy 表前逐行计数和关键字段校验；迁移完成后旧表不作为运行时备份。
- 失败回滚：`plan.md:56` 明确任一校验失败则整体 rollback，旧表名和数据恢复，下一次初始化可重试。
- 二次初始化幂等：`plan.md:57` 要求 schema/migration marker 或最终列/主键检测，二次初始化不 rename、不新增 snapshot、不覆盖指针、不改变 payload/cursor/统计；初始化锁禁止并发 DB 操作。

因此原报告针对这些项目保留的 P0 已关闭。执行时仍须将上述条款落实为真实 SQL 和可重复测试；这是实施验收要求，不是当前计划阻断。

### 3. snapshot 写入、指针切换、失败回滚与并发：PASS

- `plan.md:59-74` 固定“等待消息落库 → 事务读取 revision/指针和消息边界 → INSERT 新 snapshot → 事务内解析/校验 → 条件更新指针 → revision 冲突回滚”的顺序。
- `plan.md:68-70` 要求条件更新影响行数必须为 1，否则返回 `snapshot_commit_conflict`，新 snapshot 回滚，旧指针和旧 payload 保持不变。
- `plan.md:72` 明确 `BEGIN IMMEDIATE`/现有事务封装与 revision 双重保护，同 session 并发压缩最多一个成功切换。
- `plan.md:74` 明确失败不得更新指针，也不得将压缩结果报告为已提交基线；孤儿 snapshot 只能由显式 orphan cleanup 处理。

当前旧实现仍是 `DbCompactionSnapshotStore.cs:107-155` 的按 session Upsert 和 `:127-139` 的 `ON CONFLICT(session_id) DO UPDATE`，属于计划步骤 2 的待改造事实。

### 4. 恢复、压缩后上下文窗口保护、SessionRestoreFailure 与 provider 阻断：PASS

- `plan.md:76-96` 要求先读 session 指针；有指针时按指定 snapshot ID 读取并校验 session/version/payload/cursor，只追加 cursor 之后的消息；无指针才允许兼容 full restore，并记录 `source=full reason=no-current-snapshot`。
- `plan.md:88-94` 固定具名 `SessionRestoreFailure` 及错误码：`snapshot_not_found`、`unsupported_version`、`corrupt_payload`、`invalid_cursor`、`session_mismatch`，并规定保留现场、共享显式/lazy restore 语义。
- `plan.md:92` 明确指针存在但 snapshot 不可用时 AgentLoop 标记 failed，不初始化可发送的 full conversation，不调用 provider；`plan.md:160-162` 将 provider 调用计数为 0 和压缩→重启→cursor 后增量恢复列入测试。
- `plan.md:96` 明确目标是防止压缩前历史静默重新进入 provider；`plan.md:231-233` 也禁止有指针时静默回退，并将 ProviderRetryPolicy context-overflow 策略留给后续单元，边界清楚。

当前代码仍违反目标：`SessionRestoreTools.cs:30-34` 写明 snapshot 问题 fallback full，`:124-137` 捕获读取异常后 fallback，`:190-214` 只按 `snapshot is null` 走全量；这正是步骤 4 要消除的旧行为，不构成计划缺口。

### 5. 普通 mutation、显式清理与指针边界：PASS

- `plan.md:98-116` 逐项列出普通新增、普通 upsert、流式补全、compression status/artifact/summary、usage/timing/meta 修复、分页和展示均不得删除/失效 snapshot。
- reset/clear、整体 replace、session delete、全量 delete、项目级联删除才可解除 pointer；fork/duplicate 不继承原 pointer；解除 pointer 与整体历史操作同事务完成。
- 物理删除仅允许显式 orphan/history cleanup 端点，并要求日志记录；普通恢复副作用不得删除 snapshot。
- `plan.md:151-155` 要求逐一核对 `DbSessionTools`、`DbPluginSessionTools`、`DbProjectTools`、clear/reset/replace/delete/fork 以及前端 artifact/status 写回路径。

边界与 v2-iter-24 总目标一致：`docs/iteration-plan.md:903-918` 将该 manifest 方案列为可靠性前置，且没有把会话 Todo/全局任务混入本 Plan。

### 6. Manifest DTO 无 payload：PASS

- `plan.md:118-134` 固定只读 `db/session-context-manifest` 入口和专用 `SessionContextManifestRow`，字段仅含 ID、revision、状态、版本/时间、cursor、统计、restore source/reason/failure。
- 同段明确禁止 `wire_conversation`、完整 `compact_artifacts` 和摘要原文；诊断 payload 必须是另行显式开发者/修复端点。
- `plan.md:207-216` 将 DTO 查询放在 Infrastructure、IPC/shared 和 renderer 适配边界内，符合 `AGENTS.md:95-177` 的单向分层及 `AGENTS.md:209-222` 的 AOT DTO 约束。

当前旧 DTO 仍包含 payload：`CompactionSnapshotEntity.cs:49-65` 的 `CompactionSnapshotRow` 含 `WireConversation`/`CompactArtifacts`；这是计划步骤 5 要新增专用 DTO 并避免复用的基线事实。

### 7. 旧测试重写、AOT publish 与验证完整性：PASS

- `plan.md:169-180` 明确删除与新契约相反的旧 invalidation/单行覆盖断言，改写为迁移幂等、insert+pointer 原子切换、普通 mutation 不变、显式清理、重启增量、损坏指针 provider=0、manifest 无 payload 和加载更多不触发恢复矩阵。
- `plan.md:172-179` 明确运行 solution build、`node scripts/publish-aot-worker.mjs`、三套 TypeScript tsc、相关回归测试和 `git diff --check`。
- 这符合 `AGENTS.md:209-222` 的 Native AOT 0 warning/0 error 与 JSON source-generation 要求，也符合 `docs/dev-workflow.md:217-240`、`:316-329` 的规划验证/验证态证据规则。
- 当前旧测试仍有相反断言，例如 `tests/.../Program.cs:165-181`（单行覆盖）、`:318-328`、`:347-354`、`:416-448`（普通 mutation 失效）；计划已明确要求重写，不视为规划遗漏。

### 8. 迭代归属与范围：PASS

- `docs/iteration-plan.md:903-907` 明确 v2-iter-24 目标包含压缩恢复可靠性，并要求先完成 `plan-context-manifest` 可靠性前置。
- `plan.md:1-7`、`:9-19`、`:225-233` 与该归属一致；没有把正式版发布、ProviderRetryPolicy 改造或不相关功能偷偷纳入本 Plan。
- `docs/iteration-plan.md:922-928` 将完整回归与 Release Candidate 归入 v2-iter-25，`plan.md` 仅纳入本功能所需 build/AOT/回归证据，边界合理。

## 建议项（非阻断）

1. **S-1：为异常 schema 增加明确失败策略。** `plan.md:52` 已定义最终 schema 与旧 `session_id` 主键 schema，但可在执行细化中补充“既非最终也非已知 legacy schema 时停止初始化并报告 migration incompatibility，禁止猜测复制”。这样能避免未知数据库被误迁移。
2. **S-2：固定迁移校验字段清单与计数口径。** `plan.md:54-56` 已要求逐列/逐行校验，建议执行步骤明确源/目标 row count、每个 payload/cursor/统计列的 NULL/长度或哈希校验，以及重复 session 行告警格式。
3. **S-3：明确空 session 与指针一致性测试。** 计划已有“无消息不能写 snapshot”的现状约束，但建议在步骤 1/2 测试中补充空 session、dangling pointer、orphan 与 pointer 指向其他 session 的组合案例。
4. **S-4：将恢复失败的 IPC/前端响应字段落到具体类型文件。** `plan.md:91-94` 已固定错误语义，`plan.md:209` 采用按现有端点定位；执行前可进一步列出 shared/main 的具体 DTO 文件，降低实现定位成本。
5. **S-5：验证 AOT 输出隔离与运行中 Worker 保护。** `plan.md:174` 已要求隔离输出且不能强杀运行中 Worker；建议将 publish 产物目录和进程检查作为验证报告的固定证据字段。

## 最终裁定

- 总体：**PASS**
- 阻断项：**0**
- 建议项：**5**
- 允许进入用户确认环节：**是**
- 允许直接进入执行态：**否**；仍须遵守 `docs/dev-workflow.md:84-101`，先由用户确认规划方向。

本次只覆盖更新了 `docs/plans/iter-v2-24/plan-context-manifest/compliance_report.md`，未修改任何业务代码、计划主文档或测试实现。