# S-181 验证报告（阶段六：验证态）

**结论：PASS**（5 项验证全部执行并留存工具证据；前端 typecheck / 后端编译 / 全量回归 / 新套件单跑 / 覆盖核对 全绿）

> 被验改动：S-181「`JsonHelpers.GetBool` 宽松解析字符串化布尔」
> 分支：`dev/v2-iter-38`（工作区，未提交）
> 环境：Windows + PowerShell；`dotnet` = `C:\Program Files\dotnet\dotnet.exe`（未设 `DOTNET_ROOT`）
> 时间：2026-10-09 14:5x
> 验证人：独立验证 agent

---

## 结论速览

| # | 命令 | 预期 | 实测 | 耗时 | 退出码 |
|---|---|---|---|---|---|
| 1 | `npm run typecheck`（node + web 两配置） | 0 错 | **0 错** | ~21.7s | 0 |
| 2 | `& 'C:\Program Files\dotnet\dotnet.exe' build src/runtime/WishfulClaw.sln --nologo -v q` | 0 错 0 警 | **0 错 0 警** | 1.10s | 0 |
| 3 | `npm test` | 68/68 | **68/68 通过** | ~39.6s | 0 |
| 4 | 单跑 `tests/WishfulClaw.JsonHelpersRegressionTests/bin/Debug/net11.0/WishfulClaw.JsonHelpersRegressionTests.exe` | exit 0 + 断言计数 | **exit 0，"passed: 24"** | <1s | 0 |
| 5 | 覆盖核对（字符串 true/false、空白、大小写、不扩大） | 齐全 | **齐全** | — | — |

**编译环境**：验证前检查 `Get-CimInstance Win32_Process`，仅有**打包版** Worker 进程在跑（`C:\Program Files\WishfulClaw\resources\worker\WishfulClaw.Worker.exe`，PID 15344）—— **未触碰**。无 `bin\Debug` 下的开发实例 → 未出现 `MSB3021` / `MSB3027`，未杀任何进程、未用 `-o` / `BaseOutputPath` 外置输出。

---

## 逐项实测

### 1. `npm run typecheck` —— 0 错 ✅

```
> wishful-claw@0.2.37 typecheck
> npm run typecheck:node && npm run typecheck:web
> tsc --noEmit -p tsconfig.node.json --composite false
> tsc --noEmit -p tsconfig.web.json --composite false
```
两个配置（node + web）均无任何输出（即无错误），退出码 0。耗时 ~21.7s。

### 2. `dotnet build src/runtime/WishfulClaw.sln --nologo -v q` —— 0 错 0 警 ✅

```
已成功生成。
    0 个警告
    0 个错误
已用时间 00:00:01.10
```
退出码 0。

### 3. `npm test` —— 68/68 通过 ✅

关键输出（截取）：

```
== 编译 tests/WishfulClaw.Tests.sln ==
  ok   编译通过                                    3.5s

== TypeScript（51）==
  ...（51 个 TS 套件全 ok）...

== C# 回归套件（17）==
  ok   AgentTimeline                                   1.5s
  ok   ChannelShellApproval                            0.2s
  ok   ChannelToolVisibility                           0.2s
  ok   CompactionSnapshot                             14.7s  11 assertions
  ok   Cron                                            0.9s  42 assertions
  ok   Goal                                            0.7s  335 assertions
  ok   GrepPattern                                     0.1s  21 assertions
  ok   JsonHelpers                                     0.1s  24 assertions
  ok   MemoryRecall                                    0.2s  49 assertions
  ok   ProviderHeader                                  4.1s
  ok   ReadImage                                       0.1s  33 assertions
  ok   ReadVideo                                       0.2s  76 assertions
  ok   SandboxPath                                     0.1s  14 assertions
  ok   SessionTaskCascade                              0.4s  229 assertions
  ok   StreamSegment                                   0.1s
  ok   TerminalTool                                    0.1s
  ok   ToolConcurrency                                 0.5s

== 汇总 ==
  68/68 通过
```
退出码 0，全程 ~39.6s。

- **套件数 67 → 68**：新增 C# 套件 `JsonHelpers` 被 `scripts/run-tests.mjs:32-36` 按目录名正则 `^WishfulClaw\..+RegressionTests$` 自动发现，**未改 `run-tests.mjs`**。
- 新套件在汇总行显示 **`24 assertions`**（命中 `run-tests.mjs:49` 的 `/passed[:\s]+(\d+)/i`）。

### 4. 单跑新套件 exe ✅

```
True
JsonHelpers regression checks passed: 24

EXITCODE=0
```
- `Test-Path` = `True`（exe 存在）；输出 `JsonHelpers regression checks passed: 24`；退出码 **0**。
- 时效性核对：exe 生成时间 `2026年10月9日 14:49:42`，晚于 `Program.cs` 修改时间 `14:46:35` ⇒ 跑的是当前代码，非旧产物。

### 5. 覆盖核对 ✅

实读 `tests/WishfulClaw.JsonHelpersRegressionTests/Program.cs`（24 条断言，`Main` 失败返回 1、成功返回 0），任务点名项逐一命中：

| 要求覆盖 | 用例（行号） | 结论 |
|---|---|---|
| 字符串 `"true"` / `"false"` | `:32`（`"true"`→true）、`:33`（`"false"`→false） | ✅ 主修 |
| 首尾空白 | `:36`（`" true "`→true）、`:37`（`"\tfalse\n"`→false）、`:42`（`" True "`） | ✅ |
| 大小写 | `:40`（`"TRUE"`→true）、`:41`（`"False"`→false）、`:42` | ✅ |
| 不扩大：`"yes"` | `:45`（fb=false → false，回落） | ✅ |
| 不扩大：`"1"` | `:46`（fb=true → true，回落） | ✅ |
| 不扩大：`"on"` | `:47`（fb=true → true，回落） | ✅ |
| 不扩大：空串 / 纯空白 | `:48`（`""`）、`:49`（`"   "`）均回落 | ✅ |
| 不扩大：数字 | `:52`（`{"a":1}`）回落 | ✅ |
| 不扩大：null | `:53`（`{"a":null}`）回落 | ✅ |
| 不扩大：对象 / 数组 | `:54`（`{}`）、`:55`（`[]`）回落 | ✅ |
| 属性缺失 | `:58`（fb=true 保 true）、`:59`（fb=false 保 false） | ✅ |
| 非 object | `:60`（数组 `[1,2]`）、`:61`（字符串 `"text"`）回落 | ✅ |
| 原生布尔不回归 | `:28`（`true`）、`:29`（`false`） | ✅ |
| 显式值忽略 fallback | `:64`、`:65` | ✅ |

- 断言计数核对：源码 `AssertTrue(` / `AssertFalse(` 匹配 26 处 = **24 处调用 + 2 处方法定义**，与运行输出 `24` 一致。
- 覆盖无缺口：任务点名的「不扩大」全部有反向（期望与 fallback 相反）用例，回落被证伪式验证。

---

## 结论

**PASS。** 5 项验证命令全部实际执行并留存输出：前端 typecheck 0 错、后端 `src/runtime` 0 错 0 警、`npm test` 68/68（新套件 `JsonHelpers` 24 断言）、单跑 exe 退出码 0、覆盖项齐全。编译环境干净（仅打包版进程在跑，未触碰、未锁），无编造结果、无跳过项。

*本报告为阶段六验证态产物；依据规范随 S-181 收尾一并入库。*
