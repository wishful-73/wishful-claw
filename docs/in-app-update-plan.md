# Wishful Claw 软件内自动更新实施计划

> 编制日期：2026-08-31  
> 当前版本：`0.2.23`  
> 目标：让安装版 Wishful Claw 可以在软件内检查更新、下载更新、显示进度，并在用户确认后自动安装和重启。

## 1. 背景与结论

Wishful Claw 当前已经具备 Windows NSIS 安装包流程，但还没有软件内更新链路：

- `package.json` 当前版本为 `0.2.23`。
- `electron-builder.yml` 配置了 Windows NSIS，但没有 `publish` 配置。
- 依赖中没有 `electron-updater`。
- Main 进程没有 updater 模块，也没有 `update:check/download/status/install` IPC。
- Renderer 侧只有版本号展示，没有更新状态、下载进度或安装确认流程。
- 当前发布流程通过 GitHub Release 创建安装包，但没有把更新元数据作为发布验收项固定下来。

OpenCowork 的现行实现采用 Electron 官方生态中较稳妥的分层方式：

1. `electron-builder` 发布到 GitHub Releases。
2. Main 进程使用 `electron-updater` 负责检查、下载、错误处理和安装。
3. `autoDownload = false`，发现新版本后等待用户确认下载。
4. `autoInstallOnAppQuit = false`，下载完成后等待用户确认安装。
5. 通过 IPC 把 `update:available`、下载进度、下载完成和错误事件发送给 Renderer。
6. Renderer 提供更新弹窗、进度显示、打开发布页、立即安装和稍后处理。
7. 对安装包、绿色压缩包、兼容构建分别处理，绿色包和兼容包不执行自动安装。

本计划采用 OpenCowork 的核心策略，但按 Wishful Claw 的单窗口、Windows NSIS、Native AOT Worker 和现有 MessagePack IPC 结构重新实现。

## 2. 目标与非目标

### 2.1 本期目标

- 支持 Windows x64 NSIS 安装版的软件内更新。
- 应用启动后后台检查更新，不阻塞主界面。
- 设置页提供“检查更新”入口。
- 发现新版本后显示版本号和 Release Notes。
- 用户确认后开始下载，显示下载进度。
- 下载完成后显示“立即重启安装”和“稍后安装”。
- 安装前保留用户数据、配置、数据库、记忆和工作区文件。
- 网络错误、元数据缺失、校验失败、下载失败和安装失败均有可见提示并写入日志。
- 下载和安装操作具备幂等保护，避免重复请求和重复重启。
- 发布流程明确要求同时上传安装包和 `latest.yml`/校验元数据。

### 2.2 本期不做

- 不实现应用内热更新，不替换当前进程中的 JS 或 Worker 文件。
- 不实现 Windows 绿色压缩包的自动替换；绿色版只提供打开 Release 页面手动更新。
- 不实现增量更新服务器，先使用 GitHub Releases 的官方元数据和差分能力。
- 不在本期引入自建更新服务或对象存储镜像。
- 不把更新逻辑放进 C# Worker；更新属于 Electron 应用生命周期能力。
- 不在没有证书的情况下伪造代码签名或绕过系统安全提示。

## 3. 推荐产品策略

### 3.1 发行渠道

首期只把“正式 NSIS 安装版”作为自动更新渠道：

| 构建类型 | 更新方式 | 说明 |
|---|---|---|
| Windows NSIS 安装版 | 软件内检查、下载、重启安装 | 本期主要目标 |
| Windows 绿色压缩包 | 软件内提示新版本，打开 Release 页面 | 不能安全地覆盖正在运行的目录 |
| Debug/Vite 开发环境 | 默认不检查；可提供开发配置用于手工测试 | 防止开发环境误触发生产更新 |
| 未来 macOS/Linux | 单独评估签名、zip/AppImage/deb 和平台元数据 | 不纳入本期验收 |

建议通过打包时的 `extraMetadata` 写入发行渠道标记，例如：

```json
{
  "wishfulClawDistribution": "installer"
}
```

绿色包可标记为 `green`。Main 进程读取标记后决定是否允许自动安装。

### 3.2 用户体验

- 启动检查静默执行：无更新不弹窗，网络短暂失败不打扰用户。
- 有更新时显示非阻塞通知或更新对话框，不强制打断当前会话。
- 用户点击“立即更新”后才下载。
- 下载过程中允许继续使用软件，但在安装前必须提示关闭/重启。
- 已下载但用户选择稍后的更新，在当前进程生命周期内保留“准备安装”状态。
- 应用重启后如果更新已经安装成功，下一次启动只显示当前版本，不重复提示旧版本。
- 绿色包只显示“打开下载页”，不显示“立即安装”。

## 4. 技术架构

```text
启动 / 设置页按钮
        |
        v
Renderer 更新状态机
  idle -> checking -> available -> downloading -> downloaded -> installing
    ^          |             |          |             |
    |          +-------------+----------+-------------+
    |                    update:error
    +--------------------------------------------------+
        |
        | MessagePack IPC
        v
Main updater IPC 边界
  update:check
  update:download
  update:status
  update:install
        |
        v
Main updater service
  electron-updater
  GitHub Releases provider
  下载缓存 / sha512 校验 / 安装重启
        |
        v
GitHub Release
  installer.exe
  latest.yml
  *.blockmap（如 electron-builder 生成）
  Release Notes
```

### 4.1 Main 进程职责

新增 `src/main/updater.ts`，负责：

- 延迟加载 `electron-updater`，避免开发启动阶段增加主进程初始化失败面。
- 配置 `autoDownload = false`。
- 配置 `autoInstallOnAppQuit = false`。
- 配置正式版不接受 prerelease。
- 启动时调用一次 `checkForUpdates()`。
- 暴露检查、下载、状态、安装四个请求方法。
- 对检查和下载请求做 Promise single-flight，避免并发重复下载。
- 将更新事件转换为现有 `safeSendMessagePackToWindow` 可发送的 payload。
- 通过 `BrowserWindow.setProgressBar()` 同步下载进度。
- 下载完成后记录版本，等待 Renderer 调用安装。
- 调用 `autoUpdater.quitAndInstall(false, true)` 前设置 `isQuiting = true`，避免被现有“关闭窗口隐藏到托盘”逻辑拦截。
- 将非瞬时错误写入现有日志系统，网络瞬断只做低噪声处理。

### 4.2 IPC 设计

在 `src/main/index.ts` 注册轻量 IPC handler，建议使用现有 `registerMessagePackHandler`：

| IPC | 请求 | 返回 |
|---|---|---|
| `update:check` | 无 | 当前版本、最新版本、是否可更新、发行渠道、是否支持自动安装、Release URL |
| `update:download` | 无 | `{ success: true }` 或错误信息 |
| `update:status` | 无 | 已下载版本、发行渠道、是否支持自动安装、Release URL |
| `update:install` | 无 | `{ success: true }` 或错误信息 |

Main → Renderer 事件：

| 事件 | Payload |
|---|---|
| `update:available` | `currentVersion`、`newVersion`、`releaseNotes`、发行渠道、是否支持自动安装、Release URL |
| `update:download-progress` | `percent` |
| `update:downloaded` | `version` |
| `update:error` | `error` |

所有 payload 必须使用具名 TypeScript 类型，不使用匿名对象作为跨 IPC 的长期契约。

### 4.3 Renderer 更新状态

建议新增独立 hook 或 store，不把所有状态继续堆在 `App.tsx`：

```text
UpdateState
- phase: idle | checking | available | downloading | downloaded | installing | error
- currentVersion: string
- availableVersion: string | null
- downloadedVersion: string | null
- progress: number | null
- releaseNotes: string
- error: string | null
- distribution: installer | green | compat
- supportsAutoInstall: boolean
- releaseUrl: string
```

推荐实现：

- `src/renderer/src/hooks/use-app-updater.ts`：注册 IPC 事件、触发操作、维护状态。
- `src/renderer/src/components/updater/UpdateDialog.tsx`：更新弹窗和动作按钮。
- `src/renderer/src/components/updater/UpdateReleaseNotes.tsx`：安全渲染 Release Notes。
- `src/renderer/src/lib/updater/types.ts`：共享 Renderer 更新类型和版本比较函数。

如果现有 `App.tsx` 已经有部分更新状态代码，应先抽取和复用，不重复建立第二套更新通道。

## 5. 详细实施阶段

### 阶段 1：依赖与发布配置

修改：

- `package.json`
  - 增加 `electron-updater`。
  - 增加 `publish` 或在 `electron-builder.yml` 中配置 GitHub provider。
- lockfile
  - 使用项目当前包管理工具更新锁文件。
- `electron-builder.yml`
  - 配置 GitHub owner/repo。
  - 确认 `electron-updater` 被打包进运行时依赖；如果 Vite external，则加入 files 白名单。
  - 固化 NSIS artifact 命名，确保与 `latest.yml` 内文件名一致。
  - 配置正式安装版发行渠道标记。
- 新增 `dev-app-update.yml`
  - 仅用于开发环境手工测试，不提交任何 Token 或私密配置。

验收：

- `electron-builder --win` 能生成 NSIS 安装包。
- 发布构建能生成与安装包同批次的 `latest.yml` 和 sha512 信息。
- Release 不是 Draft，且安装包名称与元数据完全一致。

### 阶段 2：Main updater service

新增/修改：

- `src/main/updater.ts`
- `src/main/index.ts`
- `src/main/lib/distribution.ts`（如需要发行渠道判定）
- `src/renderer/src/lib/ipc/channels.ts`
- `src/renderer/src/lib/ipc/messagepack-channel-routing.ts`

实现要点：

1. Main 进程启动完成、窗口创建并完成必要代理配置后启动 updater。
2. updater 初始化只执行一次。
3. 启动检查失败不阻塞应用启动。
4. 手动检查期间重复点击返回同一 Promise 或明确的“检查中”状态。
5. 下载必须先经过一次有效检查；未检查时下载返回可理解错误。
6. 下载事件只在当前窗口存在时发送，窗口销毁时安全忽略。
7. 安装调用前设置退出标志，兼容托盘关闭拦截逻辑。
8. 只允许安装比当前版本更新的版本，避免降级和循环更新。
9. 记录关键事件：检查开始、发现版本、开始下载、进度、下载完成、安装请求、错误。

### 阶段 3：Renderer 更新 UI

新增/修改：

- `src/renderer/src/hooks/use-app-updater.ts`
- `src/renderer/src/components/updater/UpdateDialog.tsx`
- `src/renderer/src/components/updater/UpdateReleaseNotes.tsx`
- `src/renderer/src/components/settings/SettingsPage.tsx`
- `src/renderer/src/components/settings/GeneralPanel.tsx` 或专门的 About/Update 区域
- `src/renderer/src/locales/zh/settings.json`
- `src/renderer/src/locales/en/settings.json`
- 其他已支持语言的 settings 翻译文件

UI 最小闭环：

1. 设置页显示当前版本。
2. 提供“检查更新”按钮。
3. 检查中显示 loading，按钮防重复点击。
4. 无更新显示当前已是最新版本。
5. 有更新显示新版本和 Release Notes。
6. 安装版显示“立即下载”；绿色版显示“打开下载页”。
7. 下载显示百分比。
8. 下载完成显示“立即重启安装”和“稍后”。
9. 安装失败显示错误，并恢复可操作状态。
10. 网络失败不丢失已有更新信息，允许再次检查。

### 阶段 4：与现有生命周期和数据保护对接

重点检查：

- `src/main/index.ts` 当前的 close/minimize-to-tray 行为。
- `isQuiting` 的设置位置，确保 `quitAndInstall` 不被隐藏窗口逻辑拦截。
- Worker 停止和 IPC 清理顺序，确认自动重启不会留下锁文件或孤儿 Worker。
- `src/main/lib/logger.ts` 的日志格式和 updater 错误等级。
- `src/main/lib/settings-store.ts`，为 `autoUpdateEnabled` 提供持久化设置。
- 现有系统代理配置是否能被 `electron-updater` 使用；必要时为 updater 的请求配置代理或明确记录限制。

建议增加设置项：

- `autoUpdateEnabled: boolean`，默认 `true`。
- 关闭后仍允许用户通过设置页手动检查，但不自动下载。
- “自动检查更新”与“自动下载安装”不要混为一个开关；首期可只提供“启动时检查”开关，下载始终用户确认。

### 阶段 5：发布流水线和文档

修改：

- `scripts/` 下新增或扩展发布校验脚本。
- `docs/build-guide.md` 增加更新元数据说明。
- `docs/smoke-test-checklist.md` 增加安装版升级测试。
- `AGENTS.md` 中的发布流程补充元数据和更新验收要求。
- GitHub Actions 或现有发布脚本增加 Release 资产完整性检查。

发布检查必须验证：

- 版本号来自 `package.json`，且没有滞留旧版本。
- NSIS 安装包和 `latest.yml` 来自同一次构建。
- `latest.yml` 中的 URL/文件名与实际上传资产一致。
- sha512 校验值与实际文件一致。
- Release 已发布，不是 Draft。
- 安装包上传后可被 Electron updater 访问。
- 更新后的用户数据目录仍保留。

## 6. 文件级变更清单

### 新建

- `src/main/updater.ts`
- `src/main/lib/distribution.ts`（如果发行渠道判定独立出来）
- `src/renderer/src/hooks/use-app-updater.ts`
- `src/renderer/src/components/updater/UpdateDialog.tsx`
- `src/renderer/src/components/updater/UpdateReleaseNotes.tsx`
- `src/renderer/src/lib/updater/types.ts`
- `dev-app-update.yml`
- `docs/in-app-update-plan.md`（本文档）

### 修改

- `package.json`
- lockfile
- `electron-builder.yml`
- `src/main/index.ts`
- `src/renderer/src/App.tsx`（仅保留挂载和全局通知，避免重复状态）
- `src/renderer/src/lib/ipc/channels.ts`
- `src/renderer/src/lib/ipc/messagepack-channel-routing.ts`
- `src/renderer/src/components/settings/SettingsPage.tsx`
- `src/renderer/src/components/settings/GeneralPanel.tsx` 或 About 区域
- `src/renderer/src/locales/zh/settings.json`
- `src/renderer/src/locales/en/settings.json`
- `docs/build-guide.md`
- `docs/smoke-test-checklist.md`
- `AGENTS.md`

### 不应修改

- C# Worker 的 Agent Loop、Provider、Memory、Persona 业务代码。
- 用户数据库 schema，除非后续确认需要持久化更新历史。
- 用户的 `~/.wishful-claw/` 配置、日志和数据库数据。

## 7. 版本与发布约束

### 7.1 版本比较

- 使用 SemVer 规则比较版本，不用字符串比较。
- 统一去掉可选的 `v` 前缀。
- 正式渠道默认不接受 prerelease。
- 不允许当前版本等于或高于候选版本时弹出更新通知。
- 版本号必须与 `app.getVersion()` 和 `package.json` 一致。

### 7.2 GitHub Release 资产

Windows NSIS 自动更新至少需要同一版本发布中的：

- `WishfulClaw-{version}-setup.exe`
- `latest.yml`
- 如 electron-builder 生成，则同时保留对应 `.blockmap`

不能手工拼接不同版本的安装包和 `latest.yml`。否则会出现下载地址错误或 sha512 校验失败。

### 7.3 签名策略

首期先实现功能链路，但发布策略应预留签名：

- Windows 后续接入 Authenticode 签名，减少 SmartScreen 和升级信任问题。
- macOS 后续必须接入 Developer ID 签名、Notarization，并同时产出 zip，否则不应宣称 macOS 自动更新可用。
- 未签名构建或绿色包明确显示手动下载提示。

## 8. 测试计划

### 8.1 单元/静态检查

- 三套 TypeScript 检查：
  - `npx tsc --noEmit -p tsconfig.web.json`
  - `npx tsc --noEmit -p tsconfig.node.json`
  - `npx tsc --noEmit -p tsconfig.json`
- `npm run build`。
- `electron-builder` 配置校验。
- 版本比较函数测试：相等、普通升级、跨主版本、prerelease、`v` 前缀。
- 更新状态机测试：重复事件、重复下载、下载失败后重试、安装失败恢复。

### 8.2 Windows 安装版冒烟测试

| 场景 | 预期 |
|---|---|
| 当前版本已是最新 | 后台无打扰，手动检查显示最新 |
| 有新版本 | 弹出更新提示，显示版本和 Release Notes |
| 用户取消下载 | 保持旧版本，可再次操作 |
| 下载中 | 显示准确进度，不重复发起下载 |
| 下载完成 | 显示立即安装/稍后 |
| 立即安装 | 主窗口退出，安装器运行，应用自动重启 |
| 点击稍后 | 应用继续使用，不强制重启 |
| 网络超时 | 显示可理解错误，可再次检查 |
| `latest.yml` 缺失 | 明确提示发布元数据缺失 |
| sha512 不匹配 | 拒绝安装并显示失败，不破坏当前版本 |
| 应用有未完成 Agent/Worker | 安装前正常停止 Worker，重启后数据完整 |
| 托盘模式 | 更新安装不会被 close 事件拦截 |
| 绿色包 | 打开 Release 页面，不调用自动安装 |
| 设置关闭自动检查 | 不执行启动检查，但手动检查仍可用（如果产品决策保留） |

### 8.3 发布后验证

- 从旧版本安装包启动。
- 发布新版本到非 Draft GitHub Release。
- 旧版本检查到新版本。
- 在下载完成后核对安装包版本。
- 重启后确认 `package.json`/`app.getVersion()` 为新版本。
- 确认 `~/.wishful-claw/` 下配置、数据库、记忆、日志和工作区关联数据仍存在。
- 查看 Renderer、Main、Worker 日志中无持续性错误。

## 9. 风险与处理

### 风险 1：GitHub 在部分网络环境不可达

首期仍使用 GitHub Releases，原因是当前发布体系已经以 GitHub 为中心，接入成本最低。需要：

- 所有网络错误可重试。
- 支持系统代理或项目已有代理设置。
- 后续可增加 Generic Provider 镜像，并保留 GitHub fallback。

### 风险 2：元数据和安装包不同步

这是最容易导致“检查到更新但下载失败”的问题。必须禁止手动分别上传文件；发布脚本应从同一次构建目录读取并校验 `latest.yml`、安装包和 sha512。

### 风险 3：Windows 未签名导致安全拦截

签名不是本期软件内更新逻辑的前置条件，但会显著影响真实用户的安装体验。应将证书接入作为后续发布基础设施任务，不在代码中绕过系统校验。

### 风险 4：托盘关闭逻辑拦截安装

当前主进程关闭窗口时默认隐藏到托盘。安装前必须设置退出标志，并覆盖测试“安装调用 → Worker 停止 → 应用退出 → 安装器启动 → 应用重启”整条链路。

### 风险 5：Renderer 重复注册事件

更新事件监听必须集中在单个 hook 或 App 根级 effect 中，并且 effect cleanup 必须注销所有监听器。开发态 HMR 也要避免重复订阅。

## 10. 建议实施顺序

1. 先接入依赖、发布配置和本地开发更新配置。
2. 再实现 Main updater 和四个 IPC。
3. 用一个测试 Release 验证 Windows 安装版能发现并下载更新。
4. 再实现 Renderer 更新对话框和设置页入口。
5. 接入 Worker/托盘退出生命周期。
6. 补齐错误处理、日志、设置项和多语言。
7. 最后补发布脚本、冒烟测试和文档。

每个阶段都应保持可回滚；在 Windows 安装升级链路完成前，不提交正式版本发布或 tag。

## 11. 完成判定

只有以下条件全部满足，才算软件内更新功能完成：

- 正式 Windows NSIS 安装版可以检查到新版本。
- 用户可以在软件内确认下载并看到进度。
- 下载完成后可以在软件内确认安装和重启。
- 安装失败不会破坏当前版本或用户数据。
- 绿色版/兼容版不会误调用自动安装。
- GitHub Release 包含正确且同批次的安装包、`latest.yml` 和校验信息。
- 三套 TypeScript 检查、构建和升级冒烟测试通过。
- 更新入口可以从设置页进入，流程不是只有后台 IPC 而没有用户闭环。
- 日志中能区分检查失败、下载失败、校验失败和安装失败。

## 12. 参考实现

本计划参考：

- 本地 OpenCowork 副本：`D:\claw\OpenCowork\src\main\updater.ts`
- 本地 OpenCowork 副本：`D:\claw\OpenCowork\src\main\distribution.ts`
- 本地 OpenCowork 副本：`D:\claw\OpenCowork\src\main\index.ts` 中的 updater IPC 注册
- 本地 OpenCowork 副本：`D:\claw\OpenCowork\src\renderer\src\App.tsx` 中的更新事件和 UI 状态处理
- 本地 OpenCowork 副本：`D:\claw\OpenCowork\electron-builder.yml`
- 本地 OpenCowork 副本：`D:\claw\OpenCowork\dev-app-update.yml`
- 当前 OpenCowork 官方仓库的 `electron-builder.yml` 与 updater 依赖配置
- electron-builder 官方自动更新故障排查说明

> 本文档只输出实施计划，不包含本功能代码改动。后续开始实施前，应先确认发布仓库、是否接入 Windows 签名、以及“自动检查”设置项的产品命名。
