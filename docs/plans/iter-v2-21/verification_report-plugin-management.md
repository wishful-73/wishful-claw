# 验证报告：v2-iter-21 插件管理与 Browser 加载闭环

验证日期：2026-08-24

## 自动验证

- `npx tsc --noEmit -p tsconfig.web.json`：PASS
- `npx tsc --noEmit -p tsconfig.node.json`：PASS
- `npx tsc --noEmit -p tsconfig.json`：PASS
- `dotnet build src/runtime/WishfulClaw.sln --no-restore`：PASS，0 警告，0 错误
- `git diff --check`：PASS

## 静态链路核验

- SettingsPage：`plugin` → `AppPluginPanel`；`extension` → `ExtensionPanel`；`channel` → 原有渠道 `PluginPanel`。
- App 启动：`initAppPluginStore` → hydration 后 `updateAppPluginToolRegistration`；store 变化触发即时同步。
- Extension 启动：`initExtensionStore` 等待 hydration 并加载 IPC 扩展列表，完成后刷新当前项目有效扩展工具名。
- Worker 执行：`extension__*` 由 `ToolDispatchRouter` 路由到 Native Worker 扩展执行器，renderer 不注册同名假执行器。
- Browser 主链保持现有 reverse-request/webview 实现，本次只修正工具注册生命周期。

## 尚未完成的人工验证

需要用户启动应用后确认：

1. 设置页能进入“扩展与集成”及“自定义扩展”。
2. 无扩展时空状态正常；选择目录安装后列表刷新。
3. 扩展启用/禁用、配置保存、打开目录、移除均有可见反馈。
4. Browser 关闭开关后工具不可用，重新打开后恢复；重启应用后状态保持。
5. BrowserNavigate → BrowserSnapshot/BrowserGetContent 主流程可运行。

## 结论

自动验证 PASS；运行时人工验证待用户执行，VERDICT 不由 Agent 自行判定。
