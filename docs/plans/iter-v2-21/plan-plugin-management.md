# Plan：v2-iter-21 插件管理与 Browser 加载闭环

## 目标

在 Wishful Claw 设置页增加「扩展与集成」分组，迁移 OpenCowork 的应用扩展管理 UI；补齐扩展工具刷新注册；将 Browser 工具注册改为受持久化插件开关控制，确保 Browser 的 Worker → Main → Renderer → webview 链路在启动和切换时稳定可用。

## 范围

### 必做

- 应用扩展管理入口和 `ExtensionPanel`。
- 扩展列表、安装目录、启用/禁用、配置保存、打开目录、移除、toast 反馈。
- 复用现有 `ExtensionModule`、IPC、`extension-store`、资源同步和 shared manifest 类型。
- 实现 `refreshExtensionTools()`，将当前项目有效扩展工具显式注册到 renderer tool registry，并在刷新前注销旧工具。
- Browser 插件状态持久化 hydration 后再注册。
- Browser 插件开关变化时同步 `registerBrowserTool` / `unregisterBrowserTool`。
- 保留现有渠道 `PluginPanel`，在设置导航中与扩展管理明确区分。

### 暂不做

- 不迁移 OpenCowork 的 CLI、宠物、CodeGraph 全套能力。
- 不新增反射扫描、动态程序集发现或 AOT 不兼容注册机制。
- 不重构现有 Browser webview 执行脚本。
- 不扩展 Cookie/profile 仿真设置，除非编译或现有 UI 证明已有调用缺失通道。
- 不修改本轮既有 8 个未提交修复文件。
- 不 commit、merge、tag 或发布；等用户确认功能和验证结果。

## 执行步骤与检查点

### 步骤 1：设置导航与扩展管理 UI

状态：✅ 已完成（渲染端编译通过；人工入口验证待执行）

涉及：

- `src/renderer/src/components/settings/SettingsPage.tsx`
- 新建 `src/renderer/src/components/settings/ExtensionPanel.tsx`
- 必要时 `src/renderer/src/components/settings/settings-nav.ts` 或 `ui-store` 类型
- `src/renderer/src/locales/zh/settings.json`
- `src/renderer/src/locales/en/settings.json`
- 必要的共享设置原语

内容：

- 新增「扩展与集成」分组。
- 将应用插件、扩展、MCP、渠道分开显示；渠道继续指向现有 `PluginPanel`。
- 迁移 OpenCowork `ExtensionPanel` 的最小完整闭环，适配 Wishful Claw 的 import alias、组件和 i18n。
- 安装、启用/禁用、保存配置、打开目录、移除都提供反馈。

Mini 验证：

- `tsc --noEmit -p tsconfig.web.json`。
- 手工确认设置入口可进入，扩展列表和空状态可渲染。

### 步骤 2：扩展工具注册闭环

状态：✅ 已完成（Native Worker 执行边界已核对；三配置 TS 通过）

涉及：

- `src/renderer/src/lib/extensions/extension-tools.ts`
- `src/renderer/src/lib/tools/dynamic-tool-catalog.ts`
- 必要时 `src/renderer/src/lib/tools/tool-cache.ts` 或工具类型适配

内容：

- 复用 OpenCowork 的 `extension__{extensionId}__{toolName}` 命名规则和 schema 归一化。
- 仅为 enabled 且当前项目 active 的扩展注册工具。
- 刷新前注销旧扩展工具，避免重复注册和删除后残留。
- 保留 Native Worker 执行边界，不在 renderer 重复实现 HTTP/JS 执行。

Mini 验证：

- TypeScript 三配置零错误。
- 扩展列表变化后 registry 工具数量和名称无旧残留（可用现有测试/日志或手工验证）。

### 步骤 3：Browser 注册生命周期修复

状态：✅ 已完成（hydration 后同步 + store 变化订阅；人工 Browser 冒烟待执行）

涉及：

- `src/renderer/src/App.tsx`
- `src/renderer/src/lib/app-plugin/index.ts`
- `src/renderer/src/stores/app-plugin-store.ts`
- 必要时 `src/renderer/src/components/settings/AppPluginPanel.tsx`

内容：

- 移除 App 启动时无条件 `registerBrowserTool()`。
- 在 app-plugin store hydration 完成后调用 `updateAppPluginToolRegistration()`。
- 监听 Browser 插件状态变化，启用/禁用时即时注册/注销。
- 确保初始持久化状态已读取后再决定 Browser 工具是否可用。
- 保留现有 Browser reverse-request 链和 webview 操作实现。

Mini 验证：

- 三个 TypeScript 配置零错误。
- 手工：关闭 Browser 开关后工具不可用；重新打开后工具可用；重启应用后状态一致。
- BrowserNavigate → BrowserSnapshot/BrowserGetContent 主流程可运行。

### 步骤 4：审查与文档验证

状态：✅ 已完成（自动验证 PASS；人工验证与用户 VERDICT 待执行）

涉及：

- `docs/plans/iter-v2-21/plan-plugin-management.md`
- `docs/plans/iter-v2-21/review_report-plugin-management.md`
- `docs/plans/iter-v2-21/verification_report-plugin-management.md`
- `docs/PROGRESS.md`

内容：

- 检查分层、AOT、错误反馈、未提交文件保护。
- 执行 TypeScript 三配置、Agent/Worker C# build、`git diff --check`。
- 若环境允许，执行 AOT publish；若受文件锁/环境限制，报告明确区分代码问题和环境问题。
- 更新迭代 21 进度，但不自行判定迭代完结。

## 预期文件范围

新增：

- `src/renderer/src/components/settings/ExtensionPanel.tsx`
- 迭代文档/探索/审查/验证报告

修改候选：

- `src/renderer/src/components/settings/SettingsPage.tsx`
- `src/renderer/src/components/settings/settings-nav.ts`（若目标当前导航结构需要）
- `src/renderer/src/lib/extensions/extension-tools.ts`
- `src/renderer/src/lib/app-plugin/index.ts`
- `src/renderer/src/stores/app-plugin-store.ts`
- `src/renderer/src/App.tsx`
- `src/renderer/src/locales/zh/settings.json`
- `src/renderer/src/locales/en/settings.json`

明确保护：

- `src/renderer/src/components/chat/ModelSwitcher.tsx`
- `src/renderer/src/stores/chat-store/db-helpers.ts`
- `src/renderer/src/stores/chat-store/index.ts`
- `src/renderer/src/stores/provider-store-helpers.ts`
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs`
- `src/runtime/WishfulClaw.Agent/ProviderTestService.cs`
- `src/runtime/WishfulClaw.Agent/SessionConversation.cs`
- `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`

## 参考源码

- `D:\claw\OpenCowork\src\renderer\src\components\settings\ExtensionPanel.tsx`
- `D:\claw\OpenCowork\src\renderer\src\components\settings\AppPluginPanel.tsx`
- `D:\claw\OpenCowork\src\renderer\src\stores\extension-store.ts`
- `D:\claw\OpenCowork\src\renderer\src\lib\extensions\extension-tools.ts`
- `D:\claw\OpenCowork\src\renderer\src\lib\app-plugin\index.ts`
- `D:\claw\OpenCowork\src\renderer\src\lib\tools\browser-native-ui.ts`
- `D:\claw\OpenCowork\src\main\ipc\browser-handlers.ts`

## 规划结论

本计划把迁移拆成三个可独立编译/检查的功能步骤：先入口与 UI，再扩展工具注册，最后 Browser 生命周期修复。当前已具备后端模块和 IPC 基础，不需要调整 7 层 .NET 依赖或 Worker 显式模块目录。
