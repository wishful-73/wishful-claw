# S-223 验证报告（阶段六）

**验证日期**：2026-10-23
**需求**：[`../requirements/S-223.md`](../requirements/S-223.md)
**计划**：[`./plan.md`](./plan.md)
**审查**：[`./review_report.md`](./review_report.md)

## 一、编译与自动化门禁（PASS）

| 项 | 命令 | 结果 |
|---|---|---|
| TS 主进程 | `npx tsc --noEmit -p tsconfig.node.json` | **0 错** |
| TS 渲染进程 | `npx tsc --noEmit -p tsconfig.web.json` | **0 错** |
| C# 全量 | `dotnet build src\runtime\WishfulClaw.sln` | **0 警告 0 错误** |
| 新增单测 | `npm run test:project-dir` | **5 checks passed** |
| 全量单测 | `npm test` | **80/80 通过**（基线 79 → 80，含新增套件） |

新增套件 `tests/project-dir/program.ts` 钉死四件事：

1. `projectDataDirName(false)` === `.wishful-claw` —— 打包版零变化的机器锚点
2. `projectDataDirName(true)` === `.wishful-claw-dev` —— dev 实例另起一份
3. `pickProjectDirName('x-custom', false)` === `x-custom` —— 环境变量优先
4. `pickProjectDirName('  ', false)` === `.wishful-claw-dev` —— 空白 env 等同没设
5. `pickProjectDirName(undefined, true)` === `.wishful-claw` —— 无 env 且打包走生产

## 二、静态判据（PASS）

| 判据 | 期望 | 实测 |
|---|---|---|
| C# 非注释 `.wishful-claw` 字面量 | 恰好 1 条 | ✅ 1 条（`WishfulClawPaths.cs:5`） |
| `WishfulClawPaths.DataDirName` 引用 | 恰好 3 处 | ✅ 3 处（`CodeGraphDataDir.cs:56` / `WishfulClawDataDir.cs:17` / `:39`） |
| 7 处提示词文案 | 全为 `{WishfulClawDataDir.ProjectDirName}` 占位 | ✅ 逐行回读确认 |
| 越线文件豁免头 | 4 个，行数一致 | ✅ 613 / 594 / 562 / 550 |

## 三、真机验证清单（待老大跑）

需求 §7 原编号挂靠，1/3/4/6 需真机，2/5 已由上方门禁覆盖。

| # | 验收项 | 操作 | 判据 |
|---|---|---|---|
| 1 | dev 实例落 `-dev` | dev 实例打开一个项目，依次触发：写项目记忆、跑一次 codegraph 索引、生成一张图、派一次全局任务 | 项目下生成 `.wishful-claw-dev/`，四项产物全在其中，且**未新建** `.wishful-claw/` |
| 2 | 打包版零变化 | — | 已由 `test:project-dir` 第 1、5 例覆盖，**不上真机** |
| 3 | 项目级记忆落点 | 同上第 1 项后看项目目录 | `MEMORY.md` 与 `memory/` 在 `.wishful-claw-dev/` 内可见 |
| 4 | 全局目录不受影响 | 对比 `~/.wishful-claw/` 的 mtime | 全局记忆仍在 `~/.wishful-claw-dev/`（dev 实例），`~/.wishful-claw` 的 mtime 无变化 |
| 5 | 门禁 | — | 已由第一节覆盖，**不上真机** |
| 6 | 全局 codegraph 路径无拼接错误 | 看 dev 实例的 codegraph 落点 | 不出现 `-dev-dev` 之类重复后缀 |

## 四、已知边界（非缺陷）

1. **SSH 远程项目**：dev 实例连远端会找 `.wishful-claw-dev/`，远端只有生产的 `.wishful-claw/` ⇒ 读不到远端历史记忆；写入落远端 `-dev`，不碰生产。已登记 `docs/data-storage.md`。
2. **辅助窗口**：快速启动与剪贴板增强不带 `additionalArguments`，`window.api.projectDirName` 为 `undefined`，由 `project-data-dir.ts` 兜底为生产名。当前不 import 项目路径模块，无实际影响。
3. **不迁移历史数据**：dev 实例首次运行不会把生产 `.wishful-claw/` 的内容搬过去，这是老大明确的要求。

## 五、待办

- 真机四项（上表 1/3/4/6）由老大跑，跑完把结果补进本文件第三节。
