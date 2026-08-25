# v2-iter-21 插件管理迁移：探索报告

## 任务范围

将 `D:\claw\OpenCowork` 设置页「扩展与集成」中的扩展/插件管理能力迁移到 Wishful Claw，并修复内置 Browser 工具的加载注册链路。该功能作为 v2-iter-21 的追加功能单元，不覆盖当前工作区已有的 8 个未提交修复文件。

## 当前工作区状态

- 分支：`dev/v2-iter-21`
- 工作区已有 8 个未提交修改文件，属于本轮既有修复，必须保留。
- `WishfulClaw.Worker.WorkerModuleCatalog` 已显式注册 `ExtensionModule`。
- TypeScript/C# 基线验证此前已通过；完整 solution build 曾受运行中的 Worker DLL 文件锁影响。

## 参考项目关键实现

### 设置页入口

OpenCowork 的设置导航在：

- `D:\claw\OpenCowork\src\renderer\src\components\settings\settings-nav.ts`
- `D:\claw\OpenCowork\src\renderer\src\components\settings\SettingsPage.tsx`

`settings-nav.ts` 在 `extensions` 分组注册：

- `plugin`：应用内置插件管理（含 Browser）
- `mcp`：MCP
- `extension`：扩展安装/启用/配置/移除
- `channel`：渠道插件

`SettingsPage.tsx` 通过 `panelMap` 绑定 `ExtensionPanel`、`AppPluginPanel`、`PluginPanel`，并按 `layout: scroll/full` 承载面板。

### 扩展管理 UI

核心文件：

- `D:\claw\OpenCowork\src\renderer\src\components\settings\ExtensionPanel.tsx`
- `D:\claw\OpenCowork\src\renderer\src\stores\extension-store.ts`
- `D:\claw\OpenCowork\src\renderer\src\lib\extensions\extension-tools.ts`
- `D:\claw\OpenCowork\src\shared\extension-types.ts`

已覆盖的闭环：

1. 设置页加载扩展列表。
2. 选择目录安装扩展。
3. 卡片显示名称、版本、启用状态和资源数量。
4. 启用/禁用扩展，并刷新扩展工具与聚合资源同步。
5. 详情对话框编辑配置、显示权限/工具/资源。
6. 打开扩展目录、移除扩展。
7. 失败时 toast 错误，资源同步有 warning。
8. `extension-store` 使用 IPC 调用并持久化项目级激活状态。

### Browser 工具链路

OpenCowork 的 Browser 工具主要由以下链路组成：

```text
Agent Browser tool definition
  -> Native Worker AgentRuntimeBrowserExecutor
  -> reverse request: browser/tool-request
  -> Main native-agent-runtime handler
  -> renderer-tool-bridge
  -> browser-native-ui
  -> BrowserPanel/webview
  -> MessagePack response
```

关键参考文件：

- `src/runtime/WishfulClaw.Agent/AgentRuntimeBrowserExecutor.cs`（目标项目已存在）
- `src/renderer/src/lib/ipc/renderer-tool-bridge.ts`
- `src/renderer/src/lib/tools/browser-native-ui.ts`
- `src/renderer/src/lib/tools/browser-tool.ts`
- `src/renderer/src/lib/app-plugin/browser-access.ts`
- OpenCowork 另有 `src/main/ipc/browser-handlers.ts`，提供浏览器 Cookie/仿真状态等辅助 IPC。

## Wishful Claw 当前实现与缺口

### 已存在

- `src/runtime/WishfulClaw.Agent/Modules/Extensions/ExtensionModule.cs`：显式注册 extension/list、install、update、remove、asset、storage、execute-tool。
- `src/runtime/WishfulClaw.Worker/WorkerModuleCatalog.cs`：显式 `new ExtensionModule()`。
- `src/main/ipc/extension-handlers.ts`：Extension IPC handler 和资源同步逻辑已存在。
- `src/renderer/src/stores/extension-store.ts`：与参考项目基本同构，已具备加载/安装/更新/移除/目录打开/激活状态持久化。
- `src/shared/extension-types.ts`：扩展 manifest、工具、资源类型已存在。
- `src/renderer/src/lib/extensions/extension-tools.ts`：文件存在，但当前 `refreshExtensionTools()` 是 TODO，工具未真正注册。
- `src/renderer/src/renderer-tool-bridge.ts`、`browser-native-ui.ts`：Browser reverse-request 执行链已存在。
- `src/renderer/src/components/settings/AppPluginPanel.tsx`：内置 Image/Browser/CodeGraph 等插件配置 UI 已存在，可作为 Browser 管理 UI 的基础。
- `src/renderer/src/components/settings/PluginPanel.tsx`：当前实际是渠道管理，不应被扩展管理覆盖。

### 已确认问题

1. `src/renderer/src/components/settings/SettingsPage.tsx` 没有「扩展与集成」独立分组，也没有 `ExtensionPanel` 入口；当前 `PluginPanel` 入口实际承载渠道配置。
2. `src/renderer/src/lib/extensions/extension-tools.ts` 的刷新函数为空，扩展 manifest 中声明的 Agent 工具无法在 renderer tool registry 中形成完整闭环；这是扩展加载方式的明确断点。
3. `src/renderer/src/App.tsx` 启动时直接无条件执行 `registerBrowserTool()`。
4. `src/renderer/src/stores/app-plugin-store.ts` 已经提供 Browser enabled 状态和 `initAppPluginStore()`，但 App 启动没有调用 `initAppPluginStore()`，也没有调用 `updateAppPluginToolRegistration()`。
5. 因此 Browser 设置开关与实际工具注册状态脱钩：开关关闭时 Browser 工具仍可能留在 renderer registry；启动时持久化状态尚未 hydration 就进行无条件注册，存在加载时序问题。
6. `Browser tool` 的 Worker reverse-request 主链路存在；问题不是缺少 Worker 注册，而是 renderer 注册生命周期和持久化状态未接入。
7. `browser:*` 辅助 IPC（Cookie/仿真状态）在参考项目存在，Wishful Claw 当前未发现对应 main handler。是否迁移取决于现有 Browser 设置 UI 的实际需求；本次最小闭环优先修复工具注册，不扩大到浏览器 profile/cookie 体系，除非现有 UI 已调用这些通道。

## 设计边界

- 严格遵守 `Contracts -> Core -> Infrastructure -> Workspace -> Persona -> Agent -> Worker`。
- 插件/扩展注册使用已有显式列表和 registry，不使用反射扫描或动态 `Activator`。
- 不把渠道插件 `PluginPanel` 与应用扩展 `ExtensionPanel` 混用。
- 不覆盖既有 8 个未提交文件。
- 先实现最小完整功能：入口、列表、启用/禁用、安装/移除、配置/错误反馈、工具加载闭环。
- Browser 设置保留现有 `AppPluginPanel`，仅将其注册生命周期接入 store hydration 和开关变更。

## 风险

- OpenCowork `ExtensionPanel.tsx` 约 665 行，迁移时需确认目标 UI 组件/i18n 已兼容，必要时拆分而不是整文件盲搬。
- 扩展工具的实际执行仍由 Native Worker 的 `extension/execute-tool` 完成；renderer 注册的 handler 只能作为工具定义/入口，不能复制后端执行逻辑。
- `refreshExtensionTools()` 若在动态工具目录刷新时重复注册，必须先注销旧名称并处理并发刷新。
- Browser 工具注册必须在 app-plugin store hydration 后同步，否则会出现启动竞态。
- 完整 solution build 可能继续受运行中 Worker 文件锁影响，应优先单独 build Agent/Worker 或使用已有安全输出策略，不结束用户进程。
