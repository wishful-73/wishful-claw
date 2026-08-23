# 代码审查报告 5：工具执行器

> 审查范围：`ToolCallProcessor.cs`、`ToolDispatchRouter.cs`、`Tools/ToolHelpers.cs`、`Tools/FileTools/*`、`Tools/SearchTools/GrepTool+GlobTool`、`Tools/ShellTools/*`
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 调用链交叉验证
> 说明：全项目持续审查第 5 部分，只记录问题，不附带修复。

---

## §1 高优先级

### TL-1 Grep/Glob 不跳过 node_modules/.git/obj 等目录

**位置**：`GrepTool.cs:337-375 EnumerateSearchableFiles`、`GlobTool.cs:183-209 EnumerateFiles`

**问题**：
- 两者都用 `Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories)` 全量递归，只有二进制扩展名过滤，**没有任何目录排除**。
- 在含 node_modules 的前端项目里执行 `Grep pattern=*` 或 `Glob **/*.ts`：node_modules 动辄 30 万+ 文件，全部被枚举、逐个 `File.ReadAllTextAsync`（Grep），单次工具调用可达分钟级，且 500 条匹配上限几乎全被第三方代码占满，用户代码反而搜不到。
- `.git`（pack 文件是二进制会被跳过，但大量文本对象）、`bin/obj`（已编译输出）同样被爬。
- 对比：项目自己的 quick-launcher 扫描都有 SKIP_FOLDERS 机制；主 agent 系统提示还引导"优先用 Grep 而非 shell grep"，结果内置 Grep 更慢。

**建议**：加默认排除目录集（node_modules/.git/dist/out/bin/obj/vendor 等）+ 可选参数覆盖；Grep 逐文件读取前先查文件大小上限。

---

## §2 中优先级

### TL-2 ShellExecuteTool.Running 字典是死代码，进程无法中止

**位置**：`ShellExecuteTool.cs:24`、`ShellTypes.cs:14-33 RunningProcess`

**问题**：
- `Running`（ConcurrentDictionary<string, RunningProcess>）声明后**从未写入或读取**——全仓无 `Running[`、`Running.TryRemove`、注册调用。
- `RunningProcess.Abort(reason)`（kill 整棵进程树）没有任何调用方。
- 后果：超长命令（最长允许 1 小时）一旦启动，唯一取消途径是用户停止整个 agent run（走 CancellationToken → linkedCts → KillProcessTree，这条路径存在）；但"停止单个后台进程"或 Monitor 工具承诺的"跟踪已启动进程"没有实现基础。`Monitor` 工具在 CodeCompatibleToolProvider 注册，描述称"Monitor the output of a previously started long-running process"，实际无进程注册表可查。

**建议**：要么在 RunProcessAsync 里注册/清理 Running 并让 Monitor/abort 走它，要么删掉死代码并修正 Monitor 工具描述。

### TL-3 FileEditTool 行尾归一化会改写整个文件的行尾风格

**位置**：`FileEditTool.cs:54-79`

**问题**：
- 匹配前把全文和 old_string 都归一化为 `\n`，替换后若原文件**任意位置**含 `\r\n`，则把**整个文件**重写为 CRLF。
- 混合行尾文件（部分 LF 部分 CRLF）被整体统一；原本纯 LF 的文件若注释里恰好有 CRLF 字符串也会被整体转成 CRLF。
- 另外读入用 `File.ReadAllTextAsync`（剥 BOM），写回 `WriteAndFlushAsync`（无 BOM UTF-8）——带 BOM 文件被 Edit 后 BOM 丢失。对代码文件通常无害，但对要求 BOM 的场景（如某些 Windows 工具链）是静默变更。
- diff/变更跟踪记录的 beforeText 是原始内容、afterText 是归一化后内容，撤销（undo）会把整个文件行尾一起回滚——行为正确但 diff 噪音巨大。

**建议**：只对匹配窗口做行尾归一化，替换后按原文件行尾风格还原未触及区域；或至少检测"归一化改变了未触及部分"时告警。

### TL-4 FileReadTool 全量读文件后才切片，无大小护栏

**位置**：`FileReadTool.cs:95-107`

**问题**：
- `File.ReadAllTextAsync(path)` 先读整个文件，再 `Split('\n')` 取 offset/limit 窗口。
- 读取一个 2GB 日志/数据文件（limit=100 行）也会全量载入内存 + 全量字符串分割，Worker 进程内存暴涨。
- 二进制文件无扩展名判断（Grep 有扩展名黑名单，Read 没有），`Read` 一个 .exe 会把乱码灌进上下文（虽有 32KB 工具输出截断兜底，但读入阶段内存已付出）。

**建议**：流式逐行读取到 offset+limit 即停；文件超阈值时提示用 offset/limit 或拒绝。

### TL-5 IsJsonError 把 "error": null 误判为错误

**位置**：`ToolDispatchRouter.cs:494-505`

**问题**：
- `TryGetProperty("error", out _)` 只检查键存在，不检查值。工具返回 `{"error": null, "data": ...}`（不少 API 用这种"无错误"约定）会被判为 `isToolError=true`，LLM 收到带 isError 标记的成功结果，可能触发无谓重试。
- 影响 WebSearch/WebFetch/Goal/MCP/Extension 等所有走 `IsJsonError(toolOutput)` 的执行器。

**建议**：检查 `error` 值非 null 且非空字符串才算错误。

### TL-6 NotebookEdit 不在 default 模式审批清单里

**位置**：`ToolCallProcessor.cs:418-426 DefaultModeApprovalTools`

**问题**：
- default 权限模式的审批清单覆盖 Write/Edit/Bash/PowerShell/Monitor/Desktop*，但 **NotebookEdit 会改写 .ipynb 文件**，不在清单内——default 模式下 agent 改 notebook 无需用户确认，与"写类操作需确认"的承诺不一致。
- `Monitor` 在清单里但它是只读观察工具，反而多拦一道（轻微过拦，方向相反）。

**建议**：把 NotebookEdit 加入清单；复核 Monitor 是否该移出。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| TL-7 | `GlobTool.cs:213-261 MatchesGlob` | `**` 只支持按第一个 `**` 切成前后缀两段；`src/**/test/**/*.cs` 这类多 `**` 模式落入 SimpleWildcardMatch，`**` 被当普通字符处理，匹配结果错误（漏配或误配） |
| TL-8 | `ToolDispatchRouter.cs` 全文件 | 500+ 行 if-else 链，每个分支的 try-catch 结构完全重复；新增执行器要改核心路由文件，违背"工具自注册"原则。可表驱动（name→handler 字典）消除 |
| TL-9 | `FileEditTool.cs:121-124 EscapeJson` | 手写转义不处理控制字符（<0x20），路径含控制字符时产出非法 JSON；对比 ShellOutputFormatter.EscapeJson 有完整处理，两处实现不一致 |
| TL-10 | `GrepTool.cs:163` | 每个候选文件全量 ReadAllText 后才按行匹配；大文件（min.js、lock 文件）全部载入。配合 TL-1 放大性能问题 |
| TL-11 | `ShellExecuteTool.cs:201` | isError 判定 = exitCode≠0 且 stdout/stderr 全空——失败但带 stderr 输出的命令不标错误。LLM 可从内容推断，属有意放宽，但与"exit code 即真相"的直觉不符，建议至少在结果里保留显式 ok/fail 字段（已有 exitCode，可接受） |
| TL-12 | `ToolHelpers.cs:102-120 WriteAndFlushAsync` | `fs.Flush(true)` 同步 flush-to-disk 在网络盘/机械盘上可能秒级阻塞工具并发槽位；可接受但值得知晓 |

---

## 附：确认无误的设计点

- ToolCallProcessor 的 32KB 头尾截断是 UTF-8 安全实现（代理对处理正确），且 use_capability list/inspect 豁免截断保 schema 完整
- 每轮超限的工具调用生成显式 error 结果 + 事件，LLM 可感知重试，不静默丢弃
- 双信号量（常规工具 vs Task）防止互相饥饿
- 审批拒绝路径完整：pending_approval 状态 → reverse-request → 拒绝后回写 rejected 状态 + 错误结果
- Shell 超时 kill 进程树后还等待 stdout/stderr 排干再返回，避免管道断裂丢输出
- cmd.exe 用系统码页、PowerShell 强制 UTF-8 的编码策略有明确注释和权衡说明
