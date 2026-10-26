# S-219 代码审查（阶段五）

> **补写于 2026-10-23。** 审查在当日全量轮完成，结论存于 `../review_report.md` 第二节（编号 7-15）；本文件是该需求切面。
> 审查对象：提交 `7af2f77c`（`ToolHelpers.cs` +85）+ 工作区的三处调用方改动（尚未提交）。
> **结论计数**：❌ 2 / ⚠️ 2 / ✅ 5

**阻断判定**：❌ 2 ⇒ 阻断验证态，必须修复。

---

## 一、审查结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 7 | 「读 → 改 → 写」整段是否进锁 | ❌ | 锁只包住 `WriteAndFlushAsync`（`ToolHelpers.cs:169-181`），`FileEditTool.cs:55` 的 `ReadAllTextAsync` 在锁外，`:85` 才进锁。并发 4 个 Edit 各自读同一份旧内容 → 串行覆盖 → 后写胜出、前 3 处改动静默消失。与 `S-219.md:84`、`:90`、`:115` 三处原文直接冲突 |
| 8 | 同缺陷是否还有第二处 | ❌ | `MemoryHotWriteTool.cs:50` 读 → `:63` / `:71` 写，读在锁外；`AgentRuntimeNotebookEditExecutor.cs:32` 读 → `:99` 写，同样在锁外。§3.2 列的四个工具里，三个是读改写 |
| 9 | 锁 key 是否按 `OrdinalIgnoreCase` 归一 | ✅ | `ToolHelpers.cs:143-144` 用 `StringComparer.OrdinalIgnoreCase` 构造 `ConcurrentDictionary`；`:171` 先 `Path.GetFullPath` 再取锁 |
| 10 | 路径归一的边界 | ⚠️ | `Path.GetFullPath` 只做字符串级归一，符号链接、8.3 短名、尾随点与空格仍会拿到不同 key。沙箱内正常路径不受影响 |
| 11 | 退避重试是否有上限 | ✅ | `:199-206`：`attempt < 4` 走 50/100/200/400 ms，第 5 次命中转 `IOException(BuildSharingViolationMessage(...))` |
| 12 | 错误码判定 | ✅ | `:244-248` `HResult & 0xFFFF` ∈ {32, 33}，覆盖 `ERROR_SHARING_VIOLATION` 与 `ERROR_LOCK_VIOLATION` |
| 13 | 是否误放宽 `FileShare.Read` | ✅ | `:224-230` 仍是 `FileShare.Read`，`:220-223` 写明放宽会导致静默丢改动的理由（防后人顺手改） |
| 14 | 取消与资源释放 | ✅ | `WaitAsync(cancellationToken)` 在 `try` 之前（`:172`），取消不漏 release；`finally` 无条件 `Release()`（`:177-180`）；`Task.Delay` 带 token（`:201`） |
| 15 | 新错误文案与工具层口径 | ⚠️ | `:250-253` 返回中文，同层其它错误串是英文（`FileEditTool.cs:65`）。工具结果直接进模型上下文，中英混排影响模型对失败原因的识别一致度 |

## 二、修复结果

| ❌ | 修复 | 落点 |
|---|---|---|
| 7 | `WithWriteGateAsync`（无返回值 + 泛型两个重载，泛型委托给无返回值版，锁只实现一次）；`WriteAndFlushAsync` 改为其薄封装，外部签名不变 | `ToolHelpers.cs` |
| 7 | 读 → 匹配 → 替换 → 写 → `RecordChange` 整段入锁 | `FileEditTool.cs` |
| 8 | 建文件 → 读 → 归一 → 删除/upsert → 写 全段入锁 | `MemoryHotWriteTool.cs` |
| 8 | 读 JSON → 改写 cell → 写回 全段入锁 | `AgentRuntimeNotebookEditExecutor.cs` |

**关键约束**：`WriteWithSharingRetryAsync` 由 `private` 提为 `internal` 供锁内落盘 —— **锁内不得再调 `WriteAndFlushAsync`**，否则同路径自锁死。这条已写进代码注释。

**未修（故意留着）**：⚠️10（路径归一不处理短名/符号链接）、⚠️15（中英混排）—— 均不阻断，属健壮性与口径问题，已在需求正文登记。

**复跑**：`dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误；`npm test` 78/78。
