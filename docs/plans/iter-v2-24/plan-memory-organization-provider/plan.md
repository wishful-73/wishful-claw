# Plan: 独立记忆整理模型配置与 nightly 启动行为修复

日期：2026-09-02
所属迭代：v2-iter-24

## 目标

让所有记忆整理请求严格使用记忆设置中保存的整理 Provider、整理 Model、思考模式与 reasoning effort；禁止复用全局活动 Provider/Model。同时修正 `nightly + 00:00` 在正常启动时立即触发 catch-up 的行为，使其只等待定时点触发。

## 用户已确认的边界

- 产品已有记忆设置页面，本 Plan 在该页面接入独立整理模型设置。
- 整理 Provider、Model、思考模式必须独立保存，不能继续复用全局 active/fast Provider/Model。
- Provider/Model 选择方式参考自动化定时任务创建：Provider 与启用 Model 必须归属一致；思考模式支持默认/开启/关闭，开启时保存 reasoning effort。
- 当前 `nightlyTime=00:00`；正常启动软件不能立即执行记忆整理。
- 不处理无关的 ProviderRetryPolicy 重试策略调整。
- 保留工作区现有其他未提交修改，不执行 reset/checkout 覆盖。

## 步骤清单

- [x] 步骤1：新增独立整理模型/思考设置字段与存量迁移；默认值保持无隐式 Provider/Model 回退。验证：TypeScript 类型检查通过，persist partialize 和 migrate 覆盖字段。
- [x] 步骤2：在 MemorySettingsPanel 接入 Provider→Model 选择与思考模式/effort 控件。验证：只展示可用 Provider/启用 Model，切换 Provider 自动选该 Provider 的默认/首个启用 Model，设置更新可持久化。
- [x] 步骤3：改写 resolveAutomationProvider 为读取独立整理设置并构造 ProviderConfig。验证：静态检查确认不读取 activeProviderId/activeModelId/activeFastProviderId/activeFastModelId；所选 Provider/Model 无效时返回 null，不跨 Provider 回退。
- [x] 步骤4：修正 nightly scheduler 的启动检查。验证：nightly 启动不调用 catchup；startup 模式仍保留启动延迟/节流；nightly timer 仍安排下一次本地时间触发，设置变更和退出清理不回归。
- [x] 步骤5：执行 TypeScript 三配置、生产构建和必要的 C# 构建/现有回归。验证：按 AGENTS.md 命令获得 0 错误；记录无法执行的真实运行时验证。
- [x] 步骤6：独立代码审查并输出 review_report.md、verification_report.md。验证：检查 diff 范围、无敏感信息、无全局模型回退；最终 PASS/FAIL/PARTIAL 由用户裁定。

## 涉及文件

### 预计修改

- `src/renderer/src/stores/settings-store-types.ts` — 独立整理 ModelBinding/ThinkingMode 类型与默认辅助类型。
- `src/renderer/src/stores/settings-store.ts` — 新字段、默认值、persist partialize、版本升级。
- `src/renderer/src/stores/settings-store-migrate.ts` — 旧配置兼容与新增字段规范化。
- `src/renderer/src/components/settings/MemorySettingsPanel.tsx` — Provider/Model/思考模式/effort UI。
- `src/renderer/src/lib/agent/memory-automation-utils.ts` — 独立整理 ProviderConfig 解析。
- `src/main/ipc/memory-organization-scheduler.ts` — 移除 nightly 启动 catch-up，保留定时触发。
- `src/renderer/src/locales/zh/settings.json`、`src/renderer/src/locales/en/settings.json` — 新设置文案。
- 如编译需要，补充现有共享类型/测试文件，但不改变其他功能。

### 预计新增

- `docs/plans/iter-v2-24/plan-memory-organization-provider/exploration_findings.md`
- `docs/plans/iter-v2-24/plan-memory-organization-provider/compliance_report.md`
- `docs/plans/iter-v2-24/plan-memory-organization-provider/review_report.md`
- `docs/plans/iter-v2-24/plan-memory-organization-provider/verification_report.md`

## 参考实现

- `src/renderer/src/components/automation/AutomationModelSelector.tsx` — Provider/Model 归属与启用模型筛选。
- `src/renderer/src/components/automation/AutomationTaskFormDialog.tsx` — `default/enabled/disabled` 思考模式与 reasoning effort 选择。
- `src/renderer/src/lib/tools/cron-runtime.ts` — 将模型 thinkingConfig、thinkingEnabled、reasoningEffort 组装到 ProviderConfig。

## 分层与安全检查点

- 只在 renderer settings/agent 和 main scheduler 修改，不引入 C# 反向依赖或新增 Worker 协议。
- 不记录、不输出、不提交 Provider API key。
- 选择配置只保存 Provider ID、Model ID、思考模式和 effort，不保存 secret。
- 无效独立配置只导致记忆整理 LLM 阶段报告 `missing_provider`；不得退回全局活动模型。
- `runSidecarTextRequest` 继续复用现有 ProviderConfig 与 `agent/run` 协议。

## 验证命令

```text
npx tsc --noEmit -p tsconfig.web.json
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.json
dotnet build src/runtime/WishfulClaw.sln --no-restore
npm run build
git diff --check
```

真实 Electron 设置持久化、手动整理所用 Provider/Model/思考模式、nightly 到点触发及重启不 catch-up 需要运行时人工验收；Agent 不自行把该部分裁定为 PASS。
