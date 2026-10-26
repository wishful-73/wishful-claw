# Plan: S-217 更新安装沿用历史安装范围与安装路径

> **补写于 2026-10-23。** 阶段二产物事后补齐（首轮跳流程），步骤与检查点按实际实施还原；需求正文见 `../requirements/S-217.md`，模板链路证据全在其 §3，本文不复述。
> 实施提交：`5b92bed3`（`fix(installer)`），1 个生产文件、16 行。

## 目标

更新安装（含手动重装）不再暴露「为所有用户 / 仅当前用户」选择页，安装路径沿用注册表里的历史 `InstallLocation`；**首次安装**与**已双装**两种情形行为不变。

## 步骤清单

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | 只读勘察模板读写链路：`.onInit` → `initMultiUser` → `setInstallModePer*` → 各页面 | `installer.nsi:77` 早于所有页面执行；`multiUser.nsh:26-28`（per-user）/ `:75-90`（per-machine）已在 setter 内 `StrCpy $INSTDIR` | [✓] |
| 2 | 三种子现象分别定性：A 范围页跳不过 / B 改选换家 + 双装 / C 未确认 | A、B 有完整代码链路；C 静态排除五项后（§3.5）无断裂点，判「需真机实测」 | [✓] |
| 3 | 方案选型：`customInstallMode` 钩子（方案 A），只在单侧安装时置 `$isForce*Install` | 仅 `1/0`、`0/1` 两种组合置位；`0/0` 与 `1/1` 不动 | [✓] |
| 4 | 落 `build/installer.nsh` | 实测 16 行；宏体只读 `$hasPer*Installation`、只写 `$isForce*Install`，不改 `$INSTDIR` | [✓] |
| 5 | 确认是否需要配 `nsis.include` | `NsisTarget.js:600` 第二参为默认值，回落 `buildResourcesDir`；`electron-builder.yml` 未改 `directories`，默认即 `build` ⇒ 自动发现 | [✓] |
| 6 | 三项静态验证 | ① makensis 3.0.4.1 `/WX` 编译 exit=0；② 自定义 include 拼在模板全文之前，`!ifmacrodef` 能命中；③ 四个变量均有声明 | [✓] |
| 7 | 完整打包 `electron-builder --win` | 卡在下载 electron 43.2.0（本机 Cache 只有 v36.9.5，代理未开） | [ ] |
| 8 | 真机六场景验收（基线复现 / A 修复 / 反向 / 首次安装 / 双装 / 数据安全） | 判据见 `S-217.md §8` | [ ] |

**步骤 7 是步骤 8 的前置**：没打出包含 `build/installer.nsh` 的安装包，静态验证无法证明宏在真实安装器里被插入执行。

## 涉及文件

### 新增

- `build/installer.nsh` — `customInstallMode` 宏（16 行）

### 改动

- `electron-builder.yml` — **未改**。不需要 `nsis.include`，理由见步骤 5。

## 参考源码

`node_modules/app-builder-lib/templates/nsis/`（electron-builder **26.15.3**）：

- `installer.nsi:77` — `.onInit` 调 `initMultiUser` 的时机
- `assistedInstaller.nsh:18-20` — 无条件插入 `PAGE_INSTALL_MODE`
- `assistedInstaller.nsh:25-26` — 目录页的 `skipPageIfUpdated`（范围页没有对应宏）
- `assistedInstaller.nsh:112-120`、`:135-152` — 读双侧注册表 + 三分支
- `multiUser.nsh:26-28`、`:75-90` — `$INSTDIR` 回填
- `multiUserUi.nsh:41-43` — `customInstallMode` 钩子口；`:45-65` — 置位后走的既有分支
- `nsisScriptGenerator.js:32-36` — `isUpdated` 判据（`--updated`）

## 分层说明

NSIS 模板属构建期资源，不涉及运行时分层（Core / Workspace / Worker / Contracts 皆不触碰）。改动只有一处，且只把注册表结论接到模板既有分支的入口变量上，不新开分支。

## 真机前置

打包需连代理 `127.0.0.1:7897` 下载 electron 43.2.0 二进制。
