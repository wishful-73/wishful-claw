# Plan: S-219 文件写入工具并发冲突

> **补写于 2026-10-23。** 阶段二产物事后补齐（首轮跳流程）。步骤与检查点按实际实施还原，**并保留了首版规划的偏差** —— 这条需求的价值就在这里，不能补成「当时就想对了」。
> 实施提交：`7af2f77c`（`fix(tools)`，`ToolHelpers.cs` +85）；阶段五修复见阶段六前后那次 `fix(迭代1)` 提交。
> 需求正文见 `../requirements/S-219.md`；根因三层与验收表在其 §3、§4、§8，本文不复述。

## 目标

同一 assistant turn 内并发写**同一个文件**时，不再返回 `IO_SharingViolation_File`；且并发 `Edit` 的改动必须**全部累加、不静默丢失**。

## 步骤清单

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | 只读勘察：定位唯一写入出口与全部调用方 | `ToolHelpers.cs:141-168` 是唯一实现；四个调用方（`FileEditTool` / `FileWriteTool` / `MemoryHotWriteTool` / `AgentRuntimeNotebookEditExecutor`）全部经它 | [✓] |
| 2 | 判定「`FileShare.Read` 不是 bug，不动」 | 全仓无 `SharingViolation` 处理；放宽会把「明确报错」变成「静默丢改动」 | [✓] |
| 3 | ① 按路径串行化：`ConcurrentDictionary<string, SemaphoreSlim>`，key = `Path.GetFullPath`，`OrdinalIgnoreCase` | `A.md` / `a.md` 取到同一把锁；写不同文件不互相阻塞 | [✓] |
| 4 | ② 共享冲突退避重试：`HResult & 0xFFFF ∈ {32,33}`，50/100/200/400 ms，最多 4 次 | 第 5 次命中转可读 `IOException`，不无限重试 | [✓] |
| 5 | ③ 错误文案可读化 | 重试耗尽返回「文件被其它程序占用……」，非 raw `IOException` message | [✓] |
| 6 | 守住 BOM 与行尾逻辑 | `IsBomSensitiveScript` / `HasUtf8BomAsync` / 行尾归一化逐行未改，`FileEditTool.cs:80-83` 原样 | [✓] |
| 7 | 编译门禁 | `dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误 | [✓] |
| 8 | **读 → 改 → 写 整段入锁**（三处读改写调用方） | 并发 4 个 `Edit` 打同一文件，改动全部累加 | [✓] **首版漏做，阶段五 ❌ 后补** |
| 9 | 并发 4 个 `Edit` 真机验收 | 与串行执行结果完全一致 | [ ] |

## 首版规划的偏差（必须记下）

**§5 修复方向写的是「把读 → 改 → 写整段包进同一把锁」，§5 锁的范围也写明「从 `ReadAllTextAsync` 之前拿到」** —— 判断是对的。

但**步骤表只写到第 7 步「`WriteAndFlushAsync` 入口加锁」**，没有一步落到 `FileEditTool` / 记忆热写 / Notebook 三个读改写调用方身上。于是实施时锁被加在了 `WriteAndFlushAsync` 内部，读在锁外，两个并发 `Edit` 各读同一份旧内容、再串行整文件覆盖。

**结果比修之前更糟**：原来第二个写者报错，用户知道要重试；加锁后两个都「成功」，只是丢了一处改动 —— **静默数据丢失**。

这条偏差的性质是：**方案对、步骤表没承接下来**。规划阶段把「在哪加锁」当成了实现细节，没列成可勾选的步骤，就没有人认领它。阶段三合规检查若抓到，可以零成本拦下。

## 涉及文件

### 修改

- `src/runtime/WishfulClaw.Agent/Tools/ToolHelpers.cs` — `WriteGates` 锁表、`WriteAndFlushAsync` 取锁、`WriteWithSharingRetryAsync` 退避、`WriteOnceAsync` 原逻辑迁入、`IsSharingViolation` / `BuildSharingViolationMessage`；阶段五再加 `WithWriteGateAsync`（无返回值 + 泛型两个重载）
- `src/runtime/WishfulClaw.Agent/Tools/FileTools/FileEditTool.cs` — 读 → 替换 → 写 → `RecordChange` 整段入锁（阶段五）
- `src/runtime/WishfulClaw.Agent/Tools/MemoryTools/MemoryHotWriteTool.cs` — 建文件 → 读 → 归一 → 删除/upsert → 写全段入锁（阶段五）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeNotebookEditExecutor.cs` — 读 JSON → 改写 cell → 写回全段入锁（阶段五）

### 不改

- `src/runtime/WishfulClaw.Agent/Tools/FileTools/FileWriteTool.cs` — 纯覆盖写，无读改写，锁住写入即可

## 参考源码

无。问题出在自身代码，不涉及参考项目。

## 规模

| 文件 | 行数 | 状态 |
|---|---|---|
| `ToolHelpers.cs` | 342 | 未越 500 线 |
| `FileEditTool.cs` | 134 | 未越 |
| `MemoryHotWriteTool.cs` | 227 | 未越 |
