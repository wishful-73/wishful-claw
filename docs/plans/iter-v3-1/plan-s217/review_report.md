# S-217 代码审查（阶段五）

> **补写于 2026-10-23。** 审查本身在当日全量轮已完成，结论存于 `../review_report.md` 第三节（编号 16-22）；本文件是**该需求的切面**，便于按需求追溯。
> 审查对象：提交 `5b92bed3`（`build/installer.nsh`，16 行）。
> **结论计数**：❌ 0 / ⚠️ 3 / ✅ 4

**阻断判定**：无 ❌ ⇒ 不阻断进入验证态。

---

## 一、审查结论

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 16 | 钩子是否只在「已有一处安装」时生效 | ✅ | `build/installer.nsh:9-15`：仅 `1/0`、`0/1` 组合置位；`0/0`（首次）与 `1/1`（已双装）都不动 |
| 17 | 首次安装行为是否不变 | ✅ | `assistedInstaller.nsh:108-109` 在 `.onInit` 先把两个变量置 `0` ⇒ 钩子不命中 ⇒ 范围页照常出现 |
| 18 | 是否走模板既有分支、路径是否沿用 | ✅ | 置位后命中 `multiUserUi.nsh:45-57`（per-machine）/ `:59-65`（per-user），与命令行 `/allusers` 同一代码路径；`$INSTDIR` 由 `multiUser.nsh:26-28` / `:75-77` 读 `InstallLocation` 回填 |
| 19 | 是否需要配 `nsis.include` | ✅ | `NsisTarget.js:600` 第二参为默认值；`electron-builder.yml` 未改 `directories`，默认 `build` |
| 20 | 变量声明对构建配置的依赖 | ⚠️ | `hasPer*Installation` 只在 `!ifndef INSTALL_MODE_PER_ALL_USERS` 且 `!ifndef ONE_CLICK` 下声明（`multiUser.nsh:14-18`）。当前配置成立；一旦改 `perMachine: true` 或 `oneClick: true`，引用未声明变量 → **makensis 编译失败**。建议整段包 `!ifdef` |
| 21 | 已双装机器的行为 | ⚠️ | 两侧注册表都有记录时钩子不置位，范围页照旧弹出，用户仍可再造一份。`S-217.md §8` 原写「双装：不再产生第二份」与边界不符，已在需求文档改为「仅覆盖单侧安装」 |
| 22 | 是否验证过宏被真正插入 | ⚠️ | 只有 makensis 语法编译，没有一次真实 `electron-builder --win`。`!ifmacrodef customInstallmode`（模板，小写 m）与 `!macro customInstallMode`（本文件）的差异依赖 NSIS 宏名不区分大小写，**未被打包验证** |

## 二、处置

| # | 处置 | 状态 |
|---|---|---|
| 20 | 不改代码，记入真机验证清单（改构建配置时需同步检查） | 保留为 ⚠️ |
| 21 | 已改需求文档验收表措辞，避免过度承诺 | 已修 |
| 22 | 归入真机打包验证（依赖代理下载 electron 43.2.0） | 待真机 |

**本条需求无 ❌，审查修复不涉及生产代码** —— 与 S-219 / S-218 不同，S-217 的结论是「逻辑正确，卡在验证手段」。
