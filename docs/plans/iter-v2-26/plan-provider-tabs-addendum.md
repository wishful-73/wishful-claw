# v2-iter-26 追加计划：AI 服务商页 Tab 化与独立模型管理路由收口

状态：P1～P4 已完成；P5 自动验证已完成，实机截图与交互走查待用户验证（PARTIAL）

## 目标

修复设置页信息架构：移除独立的模型管理导航/路由，将模型管理作为 AI 服务商页右上角 Tab，与服务商配置并列；保留现有模型管理能力、服务商同步成果和数据/IPC 契约。

## 范围与约束

- 追加到 `v2-iter-26`，不新建迭代。
- 不改当前工作区未提交的 OpenCode Go 相关文件。
- 不删除模型 store、IPC、类型或 Provider 配置能力；只收口 UI 入口与组合方式。
- 参考 OpenCowork：`D:\claw\OpenCowork\src\renderer\src\components\settings\ProviderPanel.tsx`，吸收其“服务商页内组织模型能力”的结构，不直接复制大文件。

## 执行前置：P0 工作区与状态保护

- 执行前记录 `git status --short` 及两处既有未提交文件的 `git diff`：`src/runtime/WishfulClaw.Agent/ProviderTestService.cs`、`tests/WishfulClaw.ProviderHeaderRegressionTests/Program.cs`。
- 本追加项允许修改范围仅为 Renderer 设置页、对应 locale、追加计划文档和证据；禁止 `git add -A`，每步提交前用 `git diff --name-only` 校验白名单，提交后复核上述两处 diff 与基线一致。
- 不对既有 OpenCode Go 改动执行 reset、checkout、stash 或覆盖。

## 步骤清单

- [x] P1：清点并冻结独立模型管理路由引用。统一确认 `ui-types.ts` 为 canonical `SettingsTab`，检查 `ui-store`、`settings-route`、默认 tab、导航和本地化键；引用清单追加写入 `exploration-provider-tabs-addendum.md`。确定 `normalizeSettingsTab(raw)` 兼容策略：`modelManagement` 与未知值回退 `provider`，其他合法值原样保留。验证：`rg -n 'modelManagement|ModelManagementPanel|SettingsTab' src/renderer/src`，列出允许保留的兼容引用；三套 TypeScript 基线记录。
- [x] P2：按职责拆分并提取可组合的模型管理内容。`ModelManagementPanel.tsx` 当前超过 500 行，必须拆分为页面容器、筛选/source 映射、模型列表行、模型表单/对话框等 kebab-case 组件；页面壳负责背景与滚动，ProviderPanel 负责外层 Tab 容器。保持 store、IPC、模型 CRUD、搜索筛选行为不变。明确 Provider source 映射：内置为 `builtin:${builtinId}`，自定义为 `provider:${id}`。验证：新增实现文件均不超过 500 行；三套 TypeScript、`git diff --check`。
- [x] P3：在 `ProviderPanel` 右上角加入 Tab。维护唯一的 `selectedProviderId` 于 ProviderPanel Tab 容器；模型 Tab 初次进入跟随当前服务商，映射为 `builtin:${builtinId}` / `provider:${id}`，用户主动选“全部”后保持该选择；删除当前服务商时 Provider 与模型 filter 一起回退到新选中服务商或 `__all__`。Tab 使用 `role=tablist/tab/tabpanel`、`aria-selected`、`aria-controls`，Tab 键进入、左右箭头切换、Enter/Space 激活；配置与模型内容共享明确的单一滚动容器，避免嵌套裁剪。补齐中英文仅新增 Tab 文案。验证：三套 TypeScript、`npm run build`；800×600 下无横向溢出；键盘和联动场景逐项记录。
- [x] P4：移除独立模型管理入口并处理兼容状态。删除 SettingsPage 的独立菜单项、内容分支和不再需要的 import；新增并在 `openSettings()`、`setSettingsTab()`、`parseSettingsRoute()` 入口使用 `normalizeSettingsTab(raw)`，将历史 `modelManagement`/未知值回退到 `provider`，合法其他 tab 原样保留；当前无持久化 URL 路由时在注释/报告中明确。验证：注入旧值后渲染 ProviderPanel、无空白页；`rg` 确认独立导航/渲染入口消失（只允许兼容函数/测试/文档保留）；三套 TypeScript、`npm run build`、`git diff --check`。
- [ ] P5：回归验证与必需证据。覆盖服务商添加/删除/选择、模型增删改/启停/搜索筛选、Tab 切换、旧状态回退；开发态窗口 800×600 完成键盘/布局走查并截图写入 `docs/plans/iter-v2-26/evidence/provider-tabs.png`，无法取证则报告 PARTIAL 及原因。执行命令并记录退出码：`npx tsc --noEmit -p tsconfig.web.json`、`npx tsc --noEmit -p tsconfig.node.json`、`npx tsc --noEmit -p tsconfig.json`、`set DOTNET_ROOT=D:\claw\dotnet-sdk && dotnet build src/runtime/WishfulClaw.sln`、现有 provider preset/ProviderHeader 回归测试、`npm run build`、`git diff --check`；每步提交前后复核 P0 保护文件。
  - 自动部分已完成：三套 TypeScript、`npm run build`、`npm run test:settings-tabs`（18 项）、`npm run test:provider-presets`（330 项）、ProviderHeader 回归、C# solution 构建均通过；实机 Electron 交互和 `provider-tabs.png` 未取证，本追加项当前按 PARTIAL 交付。

## 涉及文件（待 P1 清点后最终确认）

- `src/renderer/src/components/settings/SettingsPage.tsx`
- `src/renderer/src/components/settings/ProviderPanel.tsx`
- `src/renderer/src/components/settings/model-management/ModelManagementPanel.tsx` 及必要的拆分组件
- `src/renderer/src/stores/ui-types.ts`、`ui-store.ts`、`ui-store-interface.ts`
- `src/renderer/src/lib/settings-route.ts`
- `src/renderer/src/locales/zh/settings.json`
- `src/renderer/src/locales/en/settings.json`
- `docs/plans/iter-v2-26/exploration-provider-tabs-addendum.md`
- `docs/plans/iter-v2-26/evidence/provider-tabs.png`（若能完成实机取证）

## 验收标准

- 设置页不再有独立“模型管理”路由或左侧菜单项。
- AI 服务商页右上角可切换服务商配置/模型管理 Tab。
- 模型管理现有能力不回归，且默认作用于当前选中的服务商或明确的全部服务商筛选。
- 历史 `modelManagement` 状态不会导致空白页。
- 不影响已完成的 17 个 OpenCowork 服务商预设同步及当前未提交的 OpenCode Go 改动。
