# 追加计划合规报告：服务商页 Tab 化与模型管理路由收口

日期：2026-09-08
审查对象：`plan-provider-tabs-addendum.md`、`exploration-provider-tabs-addendum.md`

## 结论

PASS。上一轮发现的 5 项阻断问题已全部修订闭合，当前计划可进入用户确认环节；尚未执行业务代码修改。

## 已核验事项

- 明确 ProviderPanel Tab 容器维护唯一 `selectedProviderId`，并规定内置/自定义 Provider 到模型 source key 的映射、全部筛选保持和删除回退行为。
- 明确 `normalizeSettingsTab(raw)` 的实现与使用入口：`openSettings()`、`setSettingsTab()`、`parseSettingsRoute()`；历史 `modelManagement` 和未知值回退 `provider`。
- 明确 P0 脏工作区保护：保留 `ProviderTestService.cs` 与 `ProviderHeaderRegressionTests/Program.cs` 的既有未提交改动，禁止 reset/checkout/stash/覆盖，禁止 `git add -A`，按白名单逐步提交并复核。
- 明确 `ModelManagementPanel.tsx` 超过 500 行，按职责拆分为容器、筛选/source 映射、列表行、表单/对话框等 kebab-case 组件，并要求实现文件不超过 500 行。
- 明确 Tab 无障碍契约、单一滚动容器、800×600 布局检查、模型与服务商联动场景和旧状态回退验证。
- 明确实际验证命令：TypeScript 三配置、`.NET solution build`（DOTNET_ROOT 指向 `D:\claw\dotnet-sdk`）、已有 provider preset/ProviderHeader 回归、`npm run build`、`git diff --check`，以及必需截图证据或 PARTIAL 原因。
- 补充 OpenCowork 直接 Tab 组合参考：`D:\claw\OpenCowork\src\renderer\src\components\settings\panels\ProviderWorkbenchPanel.tsx:7-45`。

## 当前边界

- 当前分支已有服务商预设同步和 OpenCode Go 相关提交；本追加项不重复搬运、不改 runtime 请求头逻辑。
- 当前工作区两处 runtime/test 未提交改动不属于本追加计划范围。
- P1~P5 尚未执行，代码复选框保持未完成，等待用户确认后进入执行态。
