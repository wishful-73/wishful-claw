# 代码审查报告 8a：Infrastructure Db + Storage

> 审查范围：`Db/DbClient.cs`（初始化/迁移/单例）、`Db/DbService.cs`、`Db/EntityMappers.cs`（抽样）、`Storage/ConfigStore.cs`、`Storage/ProviderStore.cs`、`Http/WorkerHttpClientFactory.cs`
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 并发路径交叉验证
> 说明：全项目持续审查第 8a 部分，只记录问题，不附带修复。

---

## §1 高优先级

### DB-1 DbClient 初始化无锁，并发首次访问可重复初始化

**位置**：`DbClient.cs:341-370 GetClient/EnsureInitialized`、`DbClient.cs:14-16`

**问题**：
- `_db`/`_initialized` 是普通静态字段，`GetClient` 的检查-初始化序列（`if (_db is null || !_initialized) Initialize(...)`）**没有任何锁或 Lazy<T>**。
- Worker 启动后多个模块并发处理首批 IPC 请求（GoalModule 恢复、DbModule 查询、Skills 扫描同时打过来）时，多个线程可同时进入 `Initialize`：
  - `CREATE TABLE IF NOT EXISTS` 幂等，表创建本身不坏；
  - 但 `_db = new DbService(...)` 被覆盖、`SweepInterruptedGoals`/`NormalizeGoalStatuses` 等迁移**并发执行**——两个线程同时 UPDATE 同一批行、同时创建 FTS 触发器，SQLite 写锁下表现为 `SQLITE_BUSY`（busy_timeout=5000 内可解）或迁移重复执行的日志噪音；
  - 最坏情况：线程 A 拿到旧 `_db` 引用后线程 B 覆盖 `_db`，A 后续操作走旧实例（同文件，功能上无害但语义混乱）。
- `Initialize` 内部 `_initialized = false` 只在 catch 设置，成功路径设 true——但检查与设置之间无内存屏障，理论上的可见性问题在 x86 上不触发，ARM 上可能。

**建议**：`Lazy<DbService>` + `LazyThreadSafetyMode.ExecutionAndPublication`，或显式 `lock` 包裹 Initialize；`EnsureInitialized(parameters)` 的 dbPath 参数化与单例语义本就矛盾（第二个不同 dbPath 的调用会被忽略），应一并明确。

---

## §2 中优先级

### DB-2 DbService 每次操作开新连接，PRAGMA 每次重设

**位置**：`DbService.cs:23-38 CreateConnection`

**问题**：
- `Query/Execute/QueryScalar` 每次调用 `CreateConnection()` → 新建 SqliteConnection + Open + 4 条 PRAGMA。
- Microsoft.Data.Sqlite 有连接池（连接字符串默认 `Pooling=True`），Open/Close 是池化借还，成本可接受；但 **PRAGMA 4 条语句每次都执行**——`journal_mode = WAL` 是持久属性（写库文件），重复设置无害但每次多一次写锁往返；`busy_timeout`/`foreign_keys` 是 per-connection 属性必须重设。
- 高频路径（每条消息落库、每个 goal 状态更新）每次多 4 条语句的解析开销。量级不大（微秒级），但设计上应把 `journal_mode` 移到 Initialize 一次性设置，连接串加 `Default Timeout` 替代 busy_timeout PRAGMA。
- 更值得注意的：**连接池 + WAL 下并发写仍会 SQLITE_BUSY**，busy_timeout=5000 在长事务（ExecuteInTransaction 内做文件 I/O 之类）时可能不够。当前代码事务内无 I/O（好），风险为低。

### DB-3 QueryScalar 的 Convert.ChangeType 装箱转换对 nullable 支持脆弱

**位置**：`DbService.cs:86-107`

**问题**：
- `QueryScalar<long?>`（DbGoalPlanTaskRoundTools.cs:139 在用）走 `Convert.ChangeType(result, typeof(long?))`——`Convert.ChangeType` 对 Nullable<T> 目标类型**直接抛 InvalidCastException**（它只处理非 nullable 基础类型）。
- 实际没炸是因为调用处 `QueryScalar<long?>` 查 `SELECT id ... LIMIT 1`，空结果走 `result == null` 分支返回 `default!`（null）；非空结果时 `Convert.ChangeType(long, typeof(long?))` **会抛**——等等，验证：.NET 的 Convert.ChangeType 对 Nullable 目标确实抛 InvalidCastException。但该代码在生产已运行（StartRound 幂等复用路径），说明实际走通了……重新核对：`typeof(long?)` 传入 ChangeType 抛异常，除非 result 本身是 long 且运行时走了别的分支。此处标注为**疑似 bug，需运行时验证**：若 StartRound 的复用分支从未被触发过（iter-19 修复前复用条件苛刻），则该路径从未执行，bug 潜伏。
- 同款 `default!` 返回 null 给值类型泛型参数是谎言，调用方 `existingId is > 0` 判断恰好兼容 null，属侥幸配合。

**建议**：QueryScalar 特判 Nullable<T> 取 UnderlyingSystemType；或提供 `QueryScalarOrNull<long>` 显式版本。

### DB-4 ConfigStore/ProviderStore 的 WriteRoot 非原子可见性

**位置**：`ConfigStore.cs:173-182`、`ProviderStore.cs:179/207`

**问题**：
- 写入用 temp 文件 + `File.Move(overwrite: true)`——单文件原子替换，正确。
- 但 `File.WriteAllText(tempPath)` 后**没有 File.Flush / Flush-to-disk**：进程崩溃时 Move 可能已完成而 temp 内容仍在 OS 页缓存，断电场景（非普通崩溃）下目标文件可能是零长度或截断。对配置文件，普通崩溃（进程死、OS 活）安全，断电/蓝屏有损坏窗口。
- `File.Move(overwrite: true)` 在 Windows 上若目标被其他进程打开（杀软扫描配置文件）抛 IOException，lock 内未捕获 → 整个 config:set 请求失败。可接受但值得重试一次。
- Cache.Store 在 Move 成功后更新内存缓存——若 Move 抛异常，缓存与磁盘一致（都旧），正确。

### DB-5 ProviderStore 双文件（index + provider）写入无跨文件一致性

**位置**：`ProviderStore.cs:179, 207`

**问题**：
- 索引文件和 provider 详情文件分开写，两次 WriteRoot 之间崩溃 → 索引指向不存在/旧版 provider 文件。启动时读取应有容错（未验证读取侧，标注待查）。
- 两个文件各自 lock(Sync) 内写（若共用同一 Sync 对象则原子，需确认两文件是否同一把锁——grep 显示两处 lock(Sync) 在同一类里，大概率同一把，则窗口只是"两个 Move 之间"，进程崩溃窗口极小）。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| DB-6 | `DbService.cs:180-190` | 注释残留：一段 "DataTable (for backward compatibility)" 的 summary 后跟了另一段 ExecuteReader 的 summary——前一段是删除 DataTable 方法后的孤儿注释 |
| DB-7 | `DbService.cs:191-196 ExecuteReader` | 返回未 dispose 的 reader + 依赖 CommandBehavior.CloseConnection——调用方（MemoryFtsService）若忘记 dispose 则连接泄漏；建议改为接收 mapper delegate 的版本，消灭裸 reader 出口 |
| DB-8 | `DbClient.cs:297-318 EnsureColumn` 系列 | 20+ 行 EnsureColumn 逐列调用，每次都查 PRAGMA table_info——启动时 20+ 次查询，量小但可合并为一次 table_info 读取后内存判断 |
| DB-9 | `DbClient.cs:395-404 NormalizeGoalStatuses` | 迁移把 'paused' 归一化为 'active'——与 GoalOrchestratorLifecycle.cs:404 的恢复时 paused→active 呼应，说明 paused 状态在 DB 层已被放弃，但前端 i18n/类型仍保留 paused（死状态），应统一清理 |
| DB-10 | `ConfigStore.cs:192-195 CloneElement` | `JsonNode.Parse(element.GetRawText())` 每次读配置都全量序列化+反序列化——配置文件小无碍，但 ReadRoot 每次写操作也调用（先读后改），高频写场景是双倍开销 |
| DB-11 | `WorkerHttpClientFactory.cs:35` | `AutomaticDecompression = DecompressionMethods.None`——不自动解压 gzip/br。对 provider API（请求都无压缩头）正确；但 WebFetch 工具若复用此工厂（未复用，它有自己的 CreateHttpClient），行为正确。仅提示：未来有人复用此工厂做网页抓取时会拿到乱码 |
| DB-12 | `DbService.cs:160-167 ExecuteReturnIdentity` | 同一 command 对象先 ExecuteNonQuery 再改 CommandText 查 last_insert_rowid——SQLite 同连接内正确，但依赖"未重置参数集合"的实现细节，参数残留会抛错（当前无参数化调用方，潜伏） |

---

## 附：确认无误的设计点

- DbService 全程显式 mapper delegate，零反射，符合 AOT 规范
- 事务封装（ExecuteInTransaction）rollback 路径正确，异常透传
- FTS5 external content + 触发器同步的 DDL 完整（ai/ad/au_del/au_ins 四触发器），contentless 更新路径正确
- ConfigStore 的 temp+Move 原子替换模式方向正确（断电窗口见 DB-4，进程级崩溃安全）
- SweepInterruptedGoals / NormalizeGoal* 迁移在表创建后按序执行，幂等
- busy_timeout=5000 + WAL + synchronous=NORMAL 的组合是 SQLite 桌面应用标准配置
