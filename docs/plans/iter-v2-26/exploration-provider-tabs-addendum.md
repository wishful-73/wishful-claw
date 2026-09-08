# 追加项探索：服务商页 Tab 化与模型管理路由收口

日期：2026-09-08

## 现状证据

- `src/renderer/src/components/settings/SettingsPage.tsx` 的 AI 服务商菜单同时包含 `provider` 与 `modelManagement` 两个独立入口；内容区分别渲染 `ProviderPanel` 与 `ModelManagementPanel`。
- `src/renderer/src/components/settings/ProviderPanel.tsx` 已提供服务商列表、添加/删除服务商和右侧 `ProviderConfigPanel`，适合承载顶部 Tab。
- `src/renderer/src/components/settings/model-management/ModelManagementPanel.tsx` 及其辅助模块承载模型聚合、搜索、筛选、模型编辑等能力，应优先复用/拆出可组合内容，不复制逻辑。
- OpenCowork 参考 `D:\claw\OpenCowork\src\renderer\src\components\settings\ProviderPanel.tsx`：服务商与模型管理在同一服务商页面内组织。
- OpenCowork 的直接 Tab 组合参考为 `D:\claw\OpenCowork\src\renderer\src\components\settings\panels\ProviderWorkbenchPanel.tsx:7-45`，采用 `providers/catalog` 两个 view；本项目保留当前服务商选择并避免切换时无意丢失状态。
- 当前分支已有服务商预设同步提交 `9f2e4cf`；本追加项不重复修改预设数据。
- 工作区已有未提交改动：`src/runtime/WishfulClaw.Agent/ProviderTestService.cs`、`tests/WishfulClaw.ProviderHeaderRegressionTests/Program.cs`，执行前必须保留。

## 执行结果（2026-09-09）

- P1 已完成：`SettingsTab` canonical 定义保留在 `stores/ui-types.ts`；独立模型菜单/内容入口只存在于改动前的 `SettingsPage.tsx`，设置路由当前仍是无 URL 持久化占位；兼容归一统一由 `normalizeSettingsTab` 提供。
- P2 已完成：`ModelManagementPanel.tsx` 拆为容器、`model-management-header.tsx`、`model-management-row.tsx`；模型 source key 统一使用 `builtin:<builtinId>` / `provider:<id>`，store、IPC、CRUD 和筛选逻辑保持原契约。
- P3 已完成：`ProviderPanel.tsx` 持有 `selectedProviderId` 对应的本地选择状态、Tab 状态和模型 source filter；Tab 使用 `tablist/tab/tabpanel`、`aria-selected`/`aria-controls`，左右键切换并将焦点移到下一 Tab；模型列表使用单一纵向滚动容器。
- P4 已完成：SettingsPage 删除独立模型菜单与内容分支；`openSettings`、`setSettingsTab`、`openSettingsPage` 和 `parseSettingsRoute` 均经 `normalizeSettingsTab`，历史 `modelManagement` 与未知值回退 `provider`。`tests/settings-tabs/program.ts` 覆盖 14 个合法值保留、旧值/未知值/非字符串回退，共 18 项断言。
- 自动验证已完成：三套 TypeScript、`npm run build`、`npm run test:settings-tabs`（18 项）通过；现有 `npm run test:provider-presets`（330 项）与 ProviderHeader 回归通过；C# solution 构建 0 警告/0 错误。
- P5 实机项未完成：本次运行未启动交互式 Electron 开发窗口，未生成 `docs/plans/iter-v2-26/evidence/provider-tabs.png`，故 800×600 键盘/布局走查及真实 CRUD 交互仍待用户验证，不以静态代码检查替代截图证据。

## 风险与待确认点

- `SettingsTab` 类型、默认设置页 tab、深链接/返回逻辑可能引用 `modelManagement`，需全局清点后再删除。
- 模型管理依赖的 store 与 IPC 不应随 UI 路由删除；目标是删除独立入口，保留能力。
- ProviderPanel 目前已有大量配置逻辑，需优先提取模型管理视图或使用组合组件，避免继续扩大单文件。
- 需要验证服务商 Tab 切换、服务商选择、模型增删改/搜索筛选以及旧设置状态迁移。
