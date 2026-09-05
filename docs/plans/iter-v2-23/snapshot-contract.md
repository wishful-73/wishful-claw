# v2-iter-23 压缩快照存储与恢复契约

> 状态：步骤 3 定案稿
>
> 日期：2026-08-27
>
> 前置契约：`compression-contract.md`
>
> 本文确定快照存储位置、恢复游标、格式版本、失效规则和写入失败策略。具体 DDL/CRUD 在 Plan 23-2 实现。

## 一、存储决策

采用独立表 `session_compaction_snapshots`，以 `snapshot_id` 为主键保存不可变快照版本；`sessions.current_snapshot_id` 指向当前恢复基线。

不直接把大型 `compact_context` JSON 放进 `sessions` 表，原因：

- `sessions` 是高频列表/更新表，常规查询不应携带大型上下文 JSON；
- 独立表可以单独做 AOT DTO、迁移、损坏数据回退和删除；
- `sessions` 的标题、模型、人格等普通 patch 不会误覆盖快照；
- snapshot payload 需要独立保存，且旧版本保留用于诊断和并发失败保护；
- 当前恢复权威由 `sessions.current_snapshot_id` 明确指定，不按更新时间猜测。

## 二、表结构

暂定 DDL：

```sql
CREATE TABLE IF NOT EXISTS session_compaction_snapshots (
    session_id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL,
    trigger TEXT NOT NULL,
    wire_conversation TEXT NOT NULL,
    compact_artifacts TEXT NOT NULL,
    summary_message TEXT,
    summary_text TEXT,
    through_created_at INTEGER NOT NULL,
    through_sort_order INTEGER NOT NULL,
    original_count INTEGER NOT NULL,
    new_count INTEGER NOT NULL,
    messages_summarized INTEGER NOT NULL,
    summarizer_failed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

建议索引：

```sql
CREATE INDEX IF NOT EXISTS idx_session_compaction_updated
ON session_compaction_snapshots(updated_at DESC);
```

字段说明：

| 字段 | 说明 |
|---|---|
| `session_id` | 一会话一条最新快照 |
| `version` | 快照格式版本；初始值 `1` |
| `trigger` | `auto` / `manual` |
| `wire_conversation` | 完整压缩后的模型上下文 JSON 数组 |
| `compact_artifacts` | boundary + summary 等聊天展示消息 JSON 数组 |
| `summary_message` | 摘要消息 JSON；便于直接读取和诊断 |
| `summary_text` | 去掉包装后的摘要正文；便于 UI/诊断/未来搜索 |
| `through_created_at` | 快照覆盖到的 DB 消息时间边界 |
| `through_sort_order` | 同时间戳下的顺序边界 |
| `original_count/new_count` | 压缩前后消息数量 |
| `messages_summarized` | 被折叠/摘要的消息数 |
| `summarizer_failed` | 是否使用机械降级摘要或无 LLM 摘要 |
| `created_at/updated_at` | 首次/最近写入时间 |

## 三、恢复边界决策

### 3.1 当前采用的边界

使用快照行自身的提交时刻：

```text
snapshot.created_at
```

恢复增量查询：

```sql
SELECT * FROM messages
WHERE session_id = @sessionId
  AND created_at > @snapshotCreatedAt
ORDER BY created_at ASC, sort_order ASC;
```

理由：

- `messages.created_at` 是写入时的墙钟，写进不可变快照后任何代码路径都不会再改它，天然满足"赋值后不变、可比较"；
- `sort_order` 是 Renderer 内存里 transcript 数组的下标（`messages.indexOf(msg)`），普通消息保存就会重写它：压缩完成时向 transcript 中间插入 boundary + summary 会让其后所有行的下标位移，紧接着只为刷新 `usage.contextTokens` 的一次 re-upsert 会把已被覆盖的锚点行下标从 48 改写成 46。用它做判据会周期性误报，见 `docs/reviews/2026-09-04-invalid-cursor-snapshot-anchor.md`；
- 因此 `sort_order` 只允许出现在 `ORDER BY created_at, sort_order` 里作排序辅助，不参与任何"这行是否已被覆盖"的判断；
- `through_created_at` / `through_sort_order` 继续写入，但降级为诊断字段，用于展示"提交时刻覆盖到了哪一行"，不参与读取校验。

### 3.2 边界限制与保护

- 快照写入前，先等本轮已完成消息/工具结果落库，再在同一事务内取该 session 的最大 `(created_at, sort_order)` 作为诊断边界；
- 快照行的 `created_at` 写入 `MAX(now, 诊断边界.created_at + 1)`，保证划界线严格晚于所有已被覆盖的行——否则与提交落在同一毫秒的那一轮会被 `>` 判为未覆盖，但又在快照前缀里，恢复时静默丢失（跳过总结/降级快照这类几乎零耗时的提交最容易撞上这个窗口）；
- 已被快照覆盖的消息继续被追加时接受降级：该 turn 的 `created_at` 早于提交时刻，恢复时被排除，其内容已在快照前缀里；
- 时钟回拨会让回拨后新写的消息落进"已覆盖"区间而被排除，这是本方案的已知残留。

若将来实测证明墙钟划界仍不足以覆盖某个并发场景，再单独迁移到不可变 `message_sequence`；本迭代不预先扩大 schema，也不使用 `rowid`（实测同一会话内 `rowid` 与展示顺序存在 3 处倒置）。

## 四、快照写入时序

成功压缩后的持久化顺序：

```text
1. 生成压缩结果
2. 保留旧快照不动
3. 确保当前已完成消息/工具结果落库
4. 查询该 session 当前最大 (created_at, sort_order)
5. 在单事务中 upsert 新快照
6. 事务成功后，新快照成为恢复权威
7. 向聊天窗确认 compressed + 上下文摘要
```

禁止先删除旧快照再写新快照。

## 五、快照写入失败策略

快照写入失败时：

- 本次候选压缩结果不提交到内存 `SessionConversation`，不更新 compaction watermark；
- 自动压缩发送 `failed` 终态，手动压缩返回 `failed`，均不发送或应用本次 compact artifacts；
- 不覆盖或删除旧的有效快照；
- 记录包含 sessionId、trigger、异常类型的错误日志，不记录摘要全文或敏感参数；
- 当前会话继续使用压缩前的完整内存 conversation；
- 下次恢复使用仍然有效的旧快照 + 旧快照后的 DB 增量；不存在旧快照时全量恢复；
- 下次成功压缩再原子替换快照。

理由：只有快照持久化成功后，内存 conversation、聊天 artifacts、stream event 和 SQLite 恢复状态才共同提交为一次成功压缩。写入失败时保留压缩前内存状态和旧快照，可避免对外宣称一个无法由本次快照恢复的成功结果。

## 六、快照读取与回退

恢复流程：

```text
读取 snapshot
  ├─ 会话无指针（current_snapshot_id 为空）
  │    └─ 全量 messages 恢复，reason=no-current-snapshot
  ├─ 指针指向的行不存在      → snapshot_not_found   → 阻断
  ├─ session_id 不匹配      → session_mismatch     → 阻断
  ├─ version 不支持         → unsupported_version  → 阻断
  ├─ JSON 损坏/结构非法      → corrupt_payload      → 阻断
  └─ 有效
       ├─ 反序列化 wire_conversation 作为前缀
       ├─ 查询 created_at > snapshot.created_at 的增量 messages
       ├─ 过滤快照前缀已含 id 的行与 chat-only artifact 行
       ├─ 解析并 append
       └─ Initialize SessionConversation
```

阻断只留给真损坏：四类原因返回具名 `SessionRestoreFailure`，agent run 抛 `InvalidOperationException` 并在日志留下 `reason`。历史上还有第五类 `invalid_cursor`，它把 `(through_created_at, through_sort_order)` 当作行身份判断，而 `sort_order` 是会被普通保存重写的 transcript 下标，因而会永久锁死会话，已随 §3.1 的边界改造一并删除。

真损坏会话的出口是显式上下文操作：清空会话消息、reset conversation、或显式清理端点 `db/compaction-snapshots-delete` 都会解除指针，下一次恢复回到全量历史。

打开会话本身不读快照、不阻断——恢复发生在 agent run 首轮 lazy restore 或 `agent/restore-session`。

损坏快照默认保留以便诊断，不在启动/恢复路径自动删除，避免启动过程产生隐藏写入。

## 七、失效规则

### 7.1 必须删除快照

以下操作使快照整体失效并删除：

- 清空会话消息；
- reset conversation；
- 删除 session；
- 清空全部 session；
- 删除项目并级联删除 session；
- replaceSessionMessages 用一套新历史整体替换会话；
- 导入/恢复会话时整体替换原消息历史。

### 7.2 条件失效

以下操作需要判断修改位置：

- 删除消息；
- delete last；
- truncate from；
- retry/rewind；
- 编辑历史消息内容或 meta；
- 重新排列已有消息 sort order。

规则：

```text
修改位置 <= 快照游标
  → 快照包含已被修改/删除的内容
  → 删除快照

修改位置 > 快照游标
  → 快照本体仍有效
  → 保留快照，恢复时只读取剩余增量消息
```

如果无法可靠判断修改位置，采用安全策略：删除快照。

### 7.3 fork / duplicate

- 新 session 不直接继承原 session 的快照；
- 原快照中的消息 id、display anchor 和游标属于原 session，直接复制会产生陈旧引用；
- fork/duplicate 后的新 session 使用其实际复制的 messages 全量恢复；
- 新 session 后续发生第一次压缩时生成自己的快照；
- 原 session 快照保持不变。

### 7.4 不使快照失效的操作

以下操作不改变消息历史语义，不使快照失效：

- 修改 session 标题、图标、pinned；
- 切换 Provider/Model/Persona；
- 打开/关闭右侧面板或终端；
- 前端点击加载更多历史；
- 更新 usage/timing 等不影响模型输入的展示字段。

如果更新 message meta 会改变 tool_use/tool_result 或模型输入内容，则按条件失效处理。

## 八、降级压缩快照

- LLM 摘要成功：`summarizer_failed = 0`；
- MechanicalFoldDigest 产生明确降级摘要：快照有效，`summarizer_failed = 1`；
- 纯 `TruncateMessages` 没有真实摘要正文：仍保存实际 wire conversation 以保持恢复一致，同时创建降级 summary artifact，说明旧消息被截断且摘要不可用；`summarizer_failed = 1`；
- 完全未缩减：不写新快照，返回 skipped/failed 状态。

## 九、版本规则

初始快照版本：

```text
version = 1
```

读取端只接受明确支持的版本。新增字段尽量保持向后兼容；改变 wire conversation 或游标核心语义时必须升级版本。

版本不支持时回退全量恢复，不尝试猜测转换。

## 十、并发与事务边界

- 同一 session 已有单活跃 Agent run 约束；快照写入继续按 session 串行化；
- 手动压缩时若 session 正在运行，调用层返回 blocked，不与自动压缩并发；
- 同一 session 的快照 upsert 使用事务和唯一主键；
- 新快照只在完整 JSON、游标和元数据全部准备好后一次写入；
- 快照删除与破坏性 message mutation 应在同一 DB 事务中执行，避免历史已变但快照仍存在。

## 十一、步骤 3 验证结论

- 存储位置：独立 `session_compaction_snapshots`，每 session 最新一条；
- 恢复游标：`created_at + sort_order` 二元边界，保存前先 flush 当前消息；
- 格式版本：初始 version 1，未知版本回退全量恢复；
- 写入失败：保留内存压缩和旧快照，记录错误，不阻断当前会话；
- 清空/删除/整体替换：删除快照；
- 历史删除/截断/重试：修改到快照覆盖区则删除，纯增量区修改则保留；
- fork/duplicate：不继承快照；
- 损坏快照：记录日志并全量恢复，不在启动路径自动删除；
- 降级压缩：保存实际 wire conversation 并标记 `summarizer_failed`。
