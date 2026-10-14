# S-200 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`）。
> 审查对象：提交 **`ce182e52`**（S-200 首刀，6 文件 = 3 个 C# 工具源 + 新回归套件 + `tests/WishfulClaw.Tests.sln`）。
> **形态说明**：本刀审查对象是**已提交**状态（前几刀审的是未提交工作区）—— S-200 首刀先落盘、审查随后。
> 规划依据：[`../requirements/S-200.md`](../requirements/S-200.md)（§三 修法 / §四 验收判据）+ [`plan.md`](plan.md)。
> 审查方式：**只读**（`git show` / `Read` / `git grep`），未改任何文件、未提交、未跑门禁；四道门禁由主会话现场跑过（`typecheck` 0 错 / `npm test` 72-72 / `dotnet build` 0 警告 0 错误 / 官网 build 0 错）。
> 出报告：2026-10-14。
> **结论：⚠️ PARTIAL（无阻断）** —— 三条分支行为与需求逐字符合、目录模式一字未动、35 条断言无恒真；1 处 ❌（`InputSchema` 里 `path` 的描述漏改，与已改的 `Description` 自相矛盾）+ 4 条 ⚠️。

---

## 摘要

现象（`path` 指向真实文件 ⇒ 三工具报不成立的 `Directory not found`）**确实被消掉**：存在文件 / 真不存在 / 目录三条分支全部走对文案，且 `ResolveSearchPath` 未动、沙箱判定未动、目录模式输出字节不变（`searchBase` 在目录模式恒等于 `root`）。唯一 ❌ 是**实施漏项**而非设计错：`plan.md` §3.5 明文要求同步改 `GrepTool` 的 `InputSchema` 里 `path` 的 `description`，初版只改了 `Description` ⇒ 模型会同时读到「path 可以是单文件」与「Root directory to search from」两句打架的话（两处都会进请求）。测试侧另发现**断言强度不足**：`#1/#2/#5` 原只用 `Contains` 锁路径前缀，实现若退化成输出**绝对路径**仍会全绿 —— 而 `searchBase` 的全部意义正是「前缀是文件名 / 以 root 为基准」。两条均已在本刀后续修订中处理（见 §四）。

---

## 一、❌ 必须修（1 条）

| # | 位置 | 现象 | 证据 | 处置 |
|---|---|---|---|---|
| ❌-1 | `GrepTool.cs:32` | `Description`（`:27`）已加「path may be a single file」，但同一工具 `InputSchema` 里 `path` 仍是 `Root directory to search from. Defaults to working folder.` —— `plan.md` §3.5 第一句要求的就是改它 | 两句**都会进请求**：`AnthropicMessagesInputWriter.cs:422`（`def.Description`）+ `:424`（`def.InputSchema`），同款并发点还有 `OpenAIChatRequestBuilder.cs:368/370`、`OpenAIResponsesInputWriter.cs:429/431`、`AgentRuntimeUseCapabilityEncoding.cs:142/144`、`ToolModule.cs:97/102`。`git grep "Root directory to search from"` 仅 `GrepTool.cs:32` + `GlobTool.cs:57`（Glob 那处**不该改**，它确实只吃目录） | **已修**（`bae36640`），按 `plan.md` §3.5 原文补齐 |

## 二、⚠️ 建议（4 条）

| # | 位置 | 内容 | 处置 |
|---|---|---|---|
| ⚠️-1 | `tests/.../Program.cs:60/66/82` | 三处路径断言用 `Contains`，**无法区分相对路径与绝对路径**（绝对路径含同子串 ⇒ 恒真） | **本刀内已修**（`bae36640`）：`#1/#2` 改 `StartsWith`，新增两条「不含绝对路径」否定断言 + `Abs` 归一助手；并做**证伪测试**（见 §四） |
| ⚠️-2 | `FileEditTool.cs:48-50` | 本现象的「文件侧孪生」漏网点：`if (!File.Exists(path)) return "File not found: {path}"` —— 把**真实存在的目录**传给 `Edit` 会得到「路径不存在」式话术。`FileReadTool.cs:80-86` 已有正确先例（`Read expected a file but found a directory. Use LS for: …`）⇒ 该模式在本仓是**未铺开**，不是有意不做 | **另立一条**（属「错误文案统一化」，越过本刀爆炸半径）；**登记建议待老大点头**，本刀不动 |
| ⚠️-3 | `requirements/S-200.md` §3.4 | 依据句「保留 `Path not found` 这个**已经在别处用过**的措辞」与事实不符：`git grep "Path not found" ce182e52~1` **零命中**（父提交全仓没有这句话） | **文档订正**（不提交，攒收尾刀）：措辞本身没问题，改为「与既有 `File not found:` 同族」 |
| ⚠️-4 | `GrepTool.cs:51` | `Cannot grep a binary file: {root}` 是全仓唯一**没有下一步动作**的错误句（对照 `Not a directory…pass the directory, or use Read / Grep…`） | **不改**：需求 §3.1 只要求「明确文案」，补「为什么」属措辞锦上添花，不在本刀范围 |

## 三、✅ 已核对无碍（逐条给验证方式）

1. **三条分支全部走对**：存在文件 ⇒ `GrepTool.cs:43-52` 单文件模式 / `GlobTool.cs:83-93`、`FileListTool.cs:83-93` 报 `Not a directory: {root} is a file. …`（与需求 §3.2/§3.3 **逐字相同**）；真不存在 ⇒ `GrepTool.cs:46`、`GlobTool.cs:99`、`FileListTool.cs:99` 三处统一 `Path not found: {root}`；目录 ⇒ 原样。
2. **漏网点全仓扫描**：`git grep "Directory not found"` ⇒ 仅剩 `docs/plans/iter-v2-38/changelog.md:127`（历史记录）与新测试的注释/否定断言，**零代码命中**；`git grep ResolveSearchPath` ⇒ 仅 `ToolHelpers.cs:82` + 这 3 个消费者，无第四个调用方；`ToolHelpers.cs` **不在本刀 diff 内**。
3. **单文件模式边界**：盘根文件（`D:\x.txt`）⇒ `GetDirectoryName` 给 `D:\`、`GetRelativePath` 给 `x.txt`；`?? root` 是不可达的防御兜底（非缺陷）；`limit` 截断 / `MaxResultChars` 与目录模式同源；`exclude_dirs` / `node_modules` 在单文件下**被跳过是对的**（显式指名的文件优先）。
4. **`stats` 恒 0 不污染「无命中」文案**：`ShouldReportPatternRejected`（`:290-293`）需 `candidates > 0` ⇒ 单文件下 `0/0` 为 false ⇒ 落到 `:151` 的裸 `No matches found.`（不是 `:147` 那句带统计后缀的）。`#3` 用 `== "No matches found."` **精确相等**锁死。
5. **目录模式回归**：`searchBase` 在目录模式恒等于 `root` ⇒ 输出不变；`file_pattern` 匹配（`:207`）与二进制守卫（`:218`）**先后顺序未动**（`plan.md` §3.3 要求），`GrepPatternRegressionTests` 的 `PatternRejected` 计数语义不受影响。
6. **测试有效性**：35 条断言逐条数过；无「断言内容等于实现硬编码字面量」的自证式断言；`#3/#4/#7` 等正向断言在**回退到旧实现时确实会红**（旧文案 ⇒ `!Contains("Path not found")` 红 / `IsError` 红 / `Contains("binary")` 红）；所有「无 `Directory not found`」的否定断言都配了正向断言，不存在只靠否定句的假绿。
7. **渲染端兼容**：`ToolCallCard/search-utils.ts:46` 的 `parseLegacyGrepMatch` 正则对单文件新前缀 `top.json:1: …` 同样成立；`git grep "not found" -- src/renderer/src`、`git grep "Directory not found" -- src/renderer src/main` **零命中**。
8. **文案一致性**：三句全英文、无中英混排；两条 `Not a directory` 都带「给模型的下一步」引导语。
9. **测试接入**：目录名匹配 `scripts/run-tests.mjs:36` 的 `^WishfulClaw\..+RegressionTests$`；exe 路径 `<name>/bin/Debug/net11.0/<name>.exe` 与 `run-tests.mjs:91` 吻合；csproj 除 `RootNamespace` 外与 `WishfulClaw.SandboxPathRegressionTests.csproj` 逐行一致；`tests/` 下 C# 套件 17 → **18** ✓。
10. **sln 改动干净**：新增 GUID 共 13 处（1 Project + 12 配置行），全文件 GUID **无重复**，无 `NestedProjects` 需同步，只 +14 行。
11. **编码/BOM/行尾无扰动**：三个 C# 文件的**首个 hunk 分别在 `:24` / `:80` / `:80`**，第 1 行未被触碰 ⇒ 未发生 BOM 丢失或全文件改写；`GlobTool.cs` / `FileListTool.cs` 的「每行一空行」是**父提交原有**风格，非本刀引入。
12. **`IsBinaryExtension` 等价抽取**：18 项扩展名与旧内联清单**逐项相同**、`ToLowerInvariant()` + 序数比较不变；实现取 `private`（`plan.md` §3.3 写的是 `internal`）⇒ **更好的封装**，无其他消费者，不需要 `InternalsVisibleTo`。
13. **无越界**：`git show ce182e52 --stat` = 3 C# 源 + 新 `Program.cs` + 新 csproj + sln，**无文档改动**（符合「文档攒收尾刀」）、无协议 / DB / i18n / 渲染端 / 迁移改动。
14. **未发现的安全面**：无输入拼进 shell / SQL、无路径穿越新增（`ResolveSearchPath` 与沙箱判定未动）、无资源泄漏、无并发 / 取消路径变化（`OperationCanceledException` 仍在 `:179` 单列 rethrow）。

## 四、处置与提交

| 发现 | 处置 | 落点 |
|---|---|---|
| ❌-1 | 按 `plan.md` §3.5 原文补齐 `InputSchema` 里 `path` 的描述 | 提交 **`bae36640`** |
| ⚠️-1 | `#1/#2` 改 `StartsWith`；`#1/#5` 各加一条「不含绝对路径」否定断言；新增 `Abs` 归一助手（35 → **37** 断言） | 提交 **`bae36640`** |
| ⚠️-2 | 不修，**建议另立一条**（`Edit` / `SaveImage` 的 `not found` 前置类型判别） | 等老大裁定 |
| ⚠️-3 | 需求文档依据句订正 | 工作区（不提交，攒收尾刀） |
| ⚠️-4 | 不改 | — |

**证伪测试（「先测再定规矩」）**：新断言写完当场验它**真的会红**，免得留下恒真断言 ——

1. `searchBase` 临时改回 `root` ⇒ `#1`（`StartsWith`）/ `#2` 变红：`passed: 35, failed: 2`；
2. 命中行临时改用绝对路径（`relativePath = file`）⇒ `#1` 两条 / `#2` / `#5` 全红：`passed: 33, failed: 4`。

两处临时改动均已还原（`git grep FALSIFY` 无残留），还原后 `npm test` 72/72、`SearchToolTarget` 37 断言全过。
