# iter-v2-30 探索结论

> 2026-09-16 建档。本文件记录各需求的**只读核验**结论（不改产品代码）。
> 需求范围见 `raw-requirements.md`（S-26 ~ S-32，共 7 项；老大 2026-09-16 拍板「30 迭代就做这些了」）。
> 勘测行号均为 2026-09-16 实读。

---

## S-26 工具输出落盘（spill）

### 结论先行

**这是单点改造，不是大工程。** 统一出口存在，且出口处**已有一版截断实现**，spill 只需把它从「丢弃中间」升级为「中间落盘 + 给定位符」。

### 一、核心侧统一出口 —— **已确认存在**

`src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:545`：

```cs
var truncatedOutput = ApplyToolOutputLimit(toolCall, toolOutput);
...
return new AgentRuntimeToolResult(
    toolCall.Id,
    AgentRuntimeProviderSupport.CreateStringElement(truncatedOutput),
    isToolError ? true : null);
```

- `ApplyToolOutputLimit` 是 `internal static`，定义在 `ToolCallProcessor.cs:82-94`
- 它在**所有工具执行完成后、结果进入 `AgentRuntimeToolResult` 之前**统一调用
- ⇒ **改这一个函数 = 覆盖全部工具**（无需逐工具改）。这正是 `raw-requirements.md` 里挂着的「头号待确认项」，答案为「**有**」。

### 二、出口处已有截断实现（spill 的骨架）

`ToolCallProcessor.cs:17-43`：

| 现有实现 | 值 / 行为 |
|---|---|
| 阈值 | `MaxToolOutputBytes = 32 * 1024`（32KB），注释写明对齐 Reasonix 的 `maxToolOutputBytes` |
| 超限处理 | **取首尾各一半**（`keepBytes = MaxToolOutputBytes / 2`） |
| 通知文案 | `[truncated {omitted} of {total} UTF-8 bytes — rerun with narrower args to see the middle]` |
| UTF-8 安全 | `FindUtf8PrefixLength`（`:45-57`）/ `FindUtf8SuffixStart`（`:59-80`）—— 按 Rune 边界切，不破多字节字符 |
| 例外 | `use_capability` 的 `action=list` / `inspect` 直接返回原文（`:84-91`），不截断 |

**与参考侧 `output-retention` 的对照**：参考侧的核心也是「首尾预览」——**思路一致**，我们这边已经实现了一半。

### 三、sessionId 可得（spill 需要 owner.sessionId）

`AgentRuntimeRunState.cs:21-29`：

```cs
public AgentRuntimeRunState(string runId, string sessionId) { ...; SessionId = sessionId; }
public string SessionId { get; }
```

- `SessionId` 已是**公开只读属性**
- 调用侧 `ToolCallProcessor.ExecuteAsync(...)`（`:99-103`）**已经持有 `state`**（`AgentRuntimeRunState`）
- ⇒ 改造只需给 `ApplyToolOutputLimit` **加一个 `sessionId` 形参**，调用点 `:545` 传 `state.SessionId` 即可（单点签名变更 + 单点调用点）

### 四、改造点（差异对照）

| 维度 | 现状（truncate） | 目标（spill） |
|---|---|---|
| 中间部分 | **丢弃** | **落盘**保留 |
| 模型看到 | 首尾预览 + 「rerun with narrower args」 | 有界首尾预览 + **定位符** + 「用 `Read`(offset/limit) 或 `Grep` 取回」 |
| 落盘位置 | 无 | 会话作用域私有目录 |
| 安全 | 无文件写 | root 0700 / `open(path,'wx',0o600)` 独占（防符号链接竞态） |

### 五、三条硬不变式的落点

| # | 不变式 | 落点 |
|---|---|---|
| a | 替换内容永不超上限（先给通知预留字节，放不下就退回原文） | `TruncateToolOutput` 的字节预算分配（现有 `keepBytes = Max/2` 已是雏形） |
| b | 失败退回原状（绝不把成功调用变 `isError`、绝不隐藏内联结果） | 落盘失败时 `return` 现有截断结果；**不改 `IsError`**（`:558-561` 的 `isToolError` 不受影响） |
| c | 跳过 `read`，防 `read → spill → read` 死循环 | **当前无此逻辑，须新增**（按工具名判断，需先确认「读取类工具」完整名单） |

### 六、待定口径

1. **落盘根目录**：Worker 侧数据目录的哪个子路径（需查现有数据目录约定）
2. **`maxInlineBytes` 默认值**：沿用现有 32KB，还是新设（现在是常量，要不要暴露设置项）
3. **「读取类工具」名单**：不变式 c 要跳过哪些（`Read`？`Glob`/`Grep` 也算吗）
4. **清理策略**：会话删除 / 保留期 —— 参考侧 seam **不定义**逐会话清理，本迭代是否要做
5. **`use_capability` 的 list/inspect 例外**是否保留（现状是不截断，spill 是否一并跳过）

### 七、风险

- **低**。单点改造 + 已有骨架 + 有现成回归测试（`tests/WishfulClaw.GoalRegressionTests/Program.Lifecycle.cs:493/505/523` 已在断言 `ApplyToolOutputLimit` 行为）⇒ 改完可直接扩充该套断言。
- 唯一需要新写的是**落盘 IO + 目录安全**（参考侧有 `spill-local/src/store.ts` 可对照）。
