# S-223 代码审查切面（阶段五）

**审查日期**：2026-10-23
**审查对象**：`dev/v3-iter-1` 工作区未提交改动 —— 32 个文件（C# 16、TS 14、文档 4、其他 3）
**审查方式**：只读代码 + 可执行判据 + 独立跑门禁；发现问题当场修，修完复跑
**需求正文**：[`../requirements/S-223.md`](../requirements/S-223.md)
**计划**：[`./plan.md`](./plan.md)

**结论计数**：❌ 2（已修，归零）/ ⚠️ 6 / ✅ 15

> 本文件是单需求切面，编号 **1-23 仅在本文件内唯一**。
> 跨需求总表见 [`../review_report.md`](../review_report.md)。

## 阻断

首轮 ❌ 2 项**均已修并复验**，修复后本需求 ❌ 0，可进入阶段六。

两条都是「门禁抓不到、只能靠眼睛」的类型，正好落在阶段三审查预测的位置上。

---

## 一、硬缺陷（已修）

| # | 问题 | 结论 | 证据与处置 |
|---|---|---|---|
| 1 | `GlobalTaskToolsProvider.cs:108` 只补了 `$`，**没替换字面量** | ❌ → ✅ | 首轮改动把 `` "`.wishful-claw/notes/`…" `` 变成 `` $"`.wishful-claw/notes/`…" ``，编译通过、`grep` 也看不到 `.wishful-claw` 以外的异常，但模型拿到的仍是写死的生产目录名。**与阶段三第三轮 ❌F 预测的情形一字不差**。已改为 `` $"`{WishfulClawDataDir.ProjectDirName}/notes/`…" ``，逐行回读确认 |
| 2 | `project-archive-helpers.ts:42` 换 import 没换常量 | ❌ → ✅ | `WISHFUL_CLAW_DIR = WISHFUL_CLAW_DATA_DIR_NAME` 的右值未改，`@shared/data-dir` 的 import 已被移除 ⇒ `TS2304: Cannot find name`。由 `tsc -p tsconfig.web.json` 抓出。已改为 `PROJECT_DATA_DIR_NAME` |

## 二、隐患（已修）

| # | 问题 | 结论 | 证据与处置 |
|---|---|---|---|
| 3 | worker 注入用的是裸字符串 `WISHFULCLAW_PROJECT_DIR` | ⚠️ → ✅ | 与 `WISHFULCLAW_PROJECT_DIR_ENV` 常量两处维护，改常量时会漏。已改为计算属性 `[WISHFULCLAW_PROJECT_DIR_ENV]: …`，并补 import |

## 三、设计取舍与已知边界

| # | 检查项 | 结论 | 说明 |
|---|---|---|---|
| 4 | `ProjectDirName` 每次访问都读环境变量，不缓存 | ⚠️ | 它被 `Path.Combine` 的热路径反复调用（记忆读写、计划文件、目标文件、人格目录）。实测成本是一次进程环境块字典查找，与路径拼接同量级；不缓存是刻意的——缓存要么加失效逻辑，要么在单测里留下跨用例污染。记观察项，不修 |
| 5 | `ProjectRoot` 不额外做 `Path.GetFullPath` | ⚠️ | 与改前一致（原 10 处也是直接 `Path.Combine`）。唯一需要归一的是 `MemoryPathResolver.cs:65`，那个调用点自己保留了 `GetFullPath` |
| 6 | SSH 远程项目读不到历史记忆 | ⚠️ 已登记 | dev 实例连 SSH 项目会去找远端 `.wishful-claw-dev/`（远端只有生产的 `.wishful-claw/`）。**不污染生产**，代价仅是 dev 连远端时读空。已写进 `docs/data-storage.md`「SSH 远程项目的边界」 |
| 7 | 三个辅助窗口不带 `additionalArguments` | ⚠️ 已注释 | 快速启动、剪贴板增强与主窗共用同一 preload，只有主窗注入该参数 ⇒ 它们读到 `undefined`，由 `project-data-dir.ts` 单点兜底成生产名。当前这三个窗口不 import 项目路径模块，无实际影响；将来若它们渲染项目数据会读到生产目录，已在模块头注释点名 |
| 8 | 环境变量值的空格安全 | ✅ | `additionalArguments` 每项作为独立 argv 传递，不经 shell；preload 用 `startsWith` 匹配单个 arg，值含空格仍在一个 arg 内 |
| 9 | `main/index.ts` 顶层读取 `app.isPackaged` 的时机 | ✅ | 模块顶层时 `app` 已 import 完毕，`isPackaged` 在 `whenReady` 之前读取合法（既有 `resolveDataDir()` 同一写法） |
| 10 | 环境变量被外部预设时的行为 | ✅ | 顶层回写是「读一次、写回同值」，重复启动不会叠加后缀 |

## 四、判据与门禁（✅ 实测）

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 11 | C# 非注释 `.wishful-claw` 字面量 | ✅ | 恰好 **1** 条（`WishfulClawPaths.cs:5` 常量定义）。改前 8 条 |
| 12 | `WishfulClawPaths.DataDirName` 引用 | ✅ | 恰好 **3** 处：`CodeGraphDataDir.cs:56`（全局）、`WishfulClawDataDir.cs:17`（`Root`）、`:39`（`ProjectDirName` 回退）。**没有多减**，`Root` 未被误改 |
| 13 | 7 处提示词/工具文案是否都是占位而非字面量 | ✅ | 7 行逐行回读：`PromptBuilder.cs:339`、`ProjectToolsProvider.cs:32`、`PlanToolProvider.cs:65`（`{{planId}}` 已转义）、`GlobalTaskToolsProvider.cs:108`、`AgentRuntimeGlobalTaskExecutor.cs:226`、`AgentRuntimeProjectExecutor.cs:599/607` |
| 14 | 「打包版零变化」有无机器锚点 | ✅ | `test:project-dir` 第 1、5 例断言 `projectDataDirName(false)` 与 `pickProjectDirName(undefined, true)` 均为 `.wishful-claw` |
| 15 | 是否为 `resolveProjectDirName` 写了会崩的单测 | ✅ | 没有。单测只打 `shared/project-dir.ts` 的纯函数，未 import 含 electron 的 main 模块 |
| 16 | `resolveGeneratedImagesDir` 生产调用方是否都补了第三实参 | ✅ | 全仓实测 2 个生产调用点：`misc-handlers.ts:316`（已补 `resolveProjectDirName()`）、`image-persist.ts:76`（空 scope，走全局分支，第三参数无关） |
| 17 | `ProjectArchivePage.tsx` 的全局/项目级是否分家 | ✅ | `:82`（`~/` 全局）用 `WISHFUL_CLAW_DATA_DIR_NAME`，`:86`（`{workingFolder}` 项目级）用 `WISHFUL_CLAW_DIR`（= `PROJECT_DATA_DIR_NAME`） |
| 18 | 500 行硬线 | ✅ | 四个越线文件均带豁免头，行数实测一致：`AgentRuntimeProjectExecutor.cs` 613、`native-worker.ts` 594、`AgentRuntimePlanExecutor.cs` 562、`AgentRuntimeGlobalTaskExecutor.cs` 550。改后仍越线的只有这四个 |
| 19 | 越线但没写豁免头的文件 | ✅ | `main/index.ts` 490、`PromptBuilder.cs` 477，均未越线 |
| 20 | `npm run typecheck`（node + web） | ✅ | 两份配置各 0 错 |
| 21 | `dotnet build src\runtime\WishfulClaw.sln` | ✅ | 0 警告 0 错误 |
| 22 | `npm test` | ✅ | **80/80** 通过（含新增 `test:project-dir`，基线 79 → 80） |
| 23 | `.gitignore` | ✅ | 已补 `.wishful-claw-dev/*`；**未**自动改用户项目 |

## 五、文档一致性

| 项 | 结论 | 说明 |
|---|---|---|
| `docs/data-storage.md` | ✅ | 项目级小节补「按运行态区分」+ 环境变量说明 + SSH 边界；树形图与数据流图各标 `-dev` 注 |
| `docs/development.md:135` | ✅ | 从「全局目录」扩到「全局 + 项目级同源区分」 |
| `README.md:107` | ✅ | 生产口径不动，末尾补「开发实例用 `.wishful-claw-dev/`」 |
| `AGENTS.md:142` | ✅ 有意不动 | 写的是生产口径，面向 agent 的协作约定，不需要 `-dev` |
| 陈旧注释 | ✅ | `WishfulClawDataDir.cs`（`EnsureProjectRoot` doc）、`PersonaStore.cs:9`、`PromptBuilder.cs:242`、`MemoryPathResolver.cs:9/:52` 已订正；纯说明 `~/.wishful-claw/` 的注释按计划一律不动 |

## 六、遗留

1. **真机验证未做**（阶段六清单）：dev 实例是否真的落 `.wishful-claw-dev/`，以及生产目录 mtime 是否零变化。
2. `ProjectDirName` 不缓存属有意简化，若后续在超高频路径（如每次工具调用解析沙箱根）观察到开销，再补一次进程内缓存。
3. 辅助窗口若将来渲染项目级数据，需要给它们单独传 `additionalArguments`，否则会读生产目录。
