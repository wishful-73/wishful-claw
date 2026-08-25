# v2-iter-22 最终实现审查报告

日期：2026-08-25

分支：`dev/v2-iter-22`

代码提交：`5fc6788a feat(v2-iter-22): finalize cron automation`

## 结论

最终审查结论：**0 个阻断项**。

本报告审查最终实现，不替代 `compliance_report.md` 的历史规划审查用途。技术实现、数据迁移、并发边界、AOT、IPC、隔离冒烟和 UI 状态链已审查并修正；迭代是否最终 PASS/完结仍由用户裁定。

## 审查范围

- Main Cron 调度、启动恢复、Renderer→Main MessagePack handlers、运行互斥和完成归档。
- Renderer Cron runtime、事件状态、Automation 列表/日历/表单共享数据链。
- SQLite DDL、旧库迁移、CRUD、mark-fired 与 mark-run-finished。
- Worker AOT 项目引用和 JSON/SQL 边界。
- `WISHFULCLAW_DATA_DIR` 对受控冒烟所需数据、配置、日志和 Electron userData 的隔离。
- 渠道主动消息参数、失败隔离与敏感日志边界。

## 已发现并修复的问题

| ID | 严重度 | 问题 | 修复 |
|---|---|---|---|
| B1 | 阻断 | Main 发送 `cron:fired`，Renderer 监听 `cron:fire`，触发事件无法到达 | 统一为 `cron:fire`，同步频道常量、白名单、发送端与监听端 |
| B2 | 误报/正确性 | Renderer 的 prompt 缺失判定会对合法 payload 误报 | 统一按 Cron payload 的实际字段和默认 prompt 处理 |
| B3 | 阻断 | 同一任务可能被定时器和 run-now 重复触发 | Main 增加运行锁，运行中禁止 update/toggle/delete/run-now |
| B4 | 阻断 | `deleteAfterRun` 在触发、状态持久化和归档之间存在竞态 | 一次性任务先停止调度，执行/通知/状态持久化完成后由 Main 软归档 |
| B5 | 阻断 | Renderer 直接调用的 `cron:add/update/delete/toggle/list/run-now/run-complete` 未在 Main 注册 MessagePack handlers | 新增 `registerCronHandlers()` 并在 Main 启动时注册全部 Cron UI handlers |
| B6 | 高 | 测试实例会读取真实 Home SQLite、Provider、settings、渠道配置和 MCP，并受已安装版 Electron 单实例锁影响 | 增加 `WISHFULCLAW_DATA_DIR`；隔离 SQLite、Provider、settings、渠道配置、MCP、日志与 Electron `userData`，且在请求单实例锁前设置路径 |
| B7 | 高 | 超过约 24.8 天的 `at` 任务触发 Node timeout 溢出，可能立即执行 | 使用不超过 `2_147_000_000` ms 的分段 `setTimeout`，到点后才真正触发 |
| B8 | 高 | `mark-fired` 异步写入与 run-complete 归档竞态，软归档先发生时 `fire_count` 丢失 | `db/crons-mark-fired` 增加可选 `disable`，单条 SQL 原子更新 fire count、last fired 和一次性禁用；Main await 成功后才发给 Renderer |
| B9 | 中 | 仅凭 jobId 接受 run-complete，旧或错配完成消息可能释放新一轮运行锁 | 每次触发生成唯一 `fireId`，Renderer 原样回传，Main 严格配对后才释放锁/归档；Renderer 崩溃时由现有 `render-process-gone` 生命周期释放锁 |
| B10 | 中 | 运行态 UI 仍允许 Switch、编辑和删除，与 Main 保护不一致 | 运行中的任务统一禁用 Switch、编辑和删除按钮 |
| B11 | 基线 | Worker solution/AOT 因 CodeGraph 项目引用缺失断链 | Worker csproj 补回 CodeGraph 项目引用，全量 solution 与 Native AOT 恢复通过 |
| B12 | 卫生 | 本轮编辑引入多个 UTF-8 BOM | 提交前移除本轮引入的 BOM；未扩大清理仓库历史 BOM |

## 并发与生命周期复核

- `runningJobIds` 当前保存 `jobId → fireId`，旧 completion 不能释放新一轮运行。
- DB `mark-fired` 失败时释放运行锁且不发送 `cron:fire`，避免“执行了但计数未持久化”。
- `at` 到点触发时原子禁用，手动 run-now 不消费原计划。
- `deleteAfterRun` 归档发生在 Renderer 完成执行、通知和最终状态持久化之后。
- Renderer 不可用时 Main 释放运行锁并记录警告；一次性任务已在 DB 中禁用，保留历史供诊断，不会自动重复执行。
- Renderer 进程崩溃时清理运行锁；一次性任务 timer 已消费且 DB 已禁用，周期任务可在 Renderer 恢复后继续后续 tick。

## 数据与 AOT 复核

- Cron SQL 全部参数化。
- `mark-fired` 使用单条 UPDATE 原子递增 `fire_count`、更新 `last_fired_at/updated_at` 并按需禁用。
- 更新条件保留 `deleted_at IS NULL`，避免修改已归档任务。
- 旧库迁移先补列再建依赖索引，兼容精简历史表。
- Worker、Infrastructure、Agent、CodeGraph 引用链在 solution build 和 Native AOT 中通过。

## UI 与日历复核

- Automation 列表、详情、表单和日历都从 `cron:list`/SQLite 加载，不存在第二套任务持久化。
- Main 返回调度器维护的真实 `nextRunAt`；日历只展示下一次 occurrence，符合预览视图边界。
- 日历月份导航、运行/错误态、选择任务并跳回列表详情均已接入。
- `CronJobView` 包含 `lastError`，错误过滤、列表详情和日历状态判定一致。

## 独立复核意见处理

- 已采纳：`fireId` 严格完成配对、Renderer 崩溃清锁、本轮 BOM 清理。
- 已核实为误报：`CronJobView.lastError` 缺失；最终接口和 mapper 已包含该字段。
- 未采纳：把日历日期边界改为 UTC。`nextRunAt` 是 epoch 毫秒，当前以本地日历日边界和本地时间展示，符合 UI 本地日期语义。
- 未扩大范围：全仓其他 Home 路径属于技能、媒体、人格等非本次 Cron 冒烟启动链；本次受控日志证明未触发真实 Home MCP 或外部渠道。后续若要做全应用可移植数据根，可单独规划。

## 最终结论

- 阻断项：0
- 高风险未修复项：0
- 非阻断说明：真实微信/飞书在线发送未在无人值守隔离冒烟中执行，避免触发真实外部服务；渠道发送代码边界、参数校验和失败隔离已通过源码与编译审查。
