# Exploration Findings: 独立记忆整理模型配置与 nightly 启动行为

日期：2026-09-02
状态：探索完成，未修改业务代码

## 当前状态

本项目在 v2-iter-24 分支上开发，工作区存在大量其他用户/Agent 未提交修改。本 Plan 只覆盖记忆整理的设置、Provider/Model/思考模式解析和 main scheduler 启动行为。

既有每日记忆整理实现位于 renderer，main 只负责通知 renderer：

```text
main/index.ts
  → installMemoryOrganizationScheduler()
  → renderer IPC memory-organization:run
  → App.tsx initializeMemoryOrganizationRuntime()
  → memory-organization.ts runMemoryOrganization()
  → memory-automation-internal.ts runOrganizationPass()
  → agent-bridge-streaming.ts runSidecarTextRequest()
  → agentBridge.runAgent()
```

## 已核实问题

### 1. 整理 Provider/Model 仍复用全局活动选择

`src/renderer/src/lib/agent/memory-automation-utils.ts:234-276` 的 `resolveAutomationProvider()` 当前优先读取 provider store 的 fast selection；fast selection 为空时回退 active provider，随后在 active provider 上读取 active model/default model。它还使用通用 `settings.thinkingEnabled` 和 `settings.temperature`。

`memory-organization.ts:469-520` 直接调用该解析函数。因此 nightly、startup、catchup、manual 整理都无法保证使用“记忆设置中保存的整理 Provider、整理 Model、思考模式”。

目标设计应把整理配置保存为独立 ModelBinding（providerId + modelId），并独立保存 thinking mode 与 reasoning effort；解析时只按这组设置读取 provider store，不回退到 activeProviderId、activeModelId、activeFastProviderId 或 activeFastModelId。

### 2. 自动化定时任务已有可复用模型选择模式

`src/renderer/src/components/automation/AutomationModelSelector.tsx:21-90`：

- 仅展示 `isProviderAvailableForModelSelection(provider)` 且存在启用模型的 Provider。
- Provider 改变时从该 Provider 的 defaultModel 或第一个启用模型选择 Model。
- Model 只能从当前 Provider 的启用模型选择，保证 Provider/Model 归属一致。

`AutomationTaskFormDialog.tsx:42-50, 131-169, 231-264, 307-313, 408-438`：

- 定时任务独立保存 providerId/modelId。
- thinking mode 为 `default | enabled | disabled`。
- 开启思考时可保存模型声明的 `reasoningEffort`。
- 运行时 `cron-runtime.ts:77-127` 将模型配置、thinkingConfig、thinkingEnabled、reasoningEffort 一并构造为 ProviderConfig。

记忆设置应复用上述 Provider→Model 归属和思考模式语义，但不能直接复用 AutomationModelSelector 的“空值自动回填全局 activeProvider/activeModel”行为，因为记忆整理配置必须独立且可验证。

### 3. nightly 正常启动不应立即 catch-up

`src/main/ipc/memory-organization-scheduler.ts:84-109` 的 `runStartupCheck()`：

- `schedule=startup` 时按 20 小时节流后触发 startup。
- `schedule=nightly` 时若 watermark 不是当天就直接 `fireOrganization('catchup')`。

`installMemoryOrganizationScheduler():172-194` 在启动时同时安排 startup check、nightly timer 和轮询。日志中的 `trigger=catchup` 来自这段启动检查，不是 renderer App.tsx 自己主动发起。

用户明确要求：当前设置为 nightly + 00:00，正常启动软件不应立即整理。因此应删除/停用 nightly 的启动 catch-up 分支；nightly 只等待当天尚未经过的定时点，若启动时已过当天时刻则安排下一天。startup 模式仍保留现有启动延迟和节流行为。

### 4. 设置变更通知目前只覆盖开关和调度时间

`src/renderer/src/App.tsx:126-135` 的订阅只监视：

- `memoryOrganizationEnabled`
- `memoryOrganizationSchedule`
- `memoryOrganizationNightlyTime`

独立 Provider/Model/思考模式属于 renderer 请求解析配置，不需要 main scheduler 读取；设置保存后下一次整理读取 Zustand 持久化状态即可。但如需 UI 即时提示/运行态日志，应避免把 Provider secret 写入 main 日志。

### 5. ProviderConfig 已支持整理请求所需字段

`src/renderer/src/lib/api/types.ts:444-486` 已有：`providerId`、`model`、`thinkingEnabled`、`thinkingConfig`、`reasoningEffort`、超时/重试、requestOverrides 等字段。`runSidecarTextRequest()` 会将该 ProviderConfig 传入 sidecar `agent/run`，不需要新增 Worker 协议字段。

## 相关文件

- `src/renderer/src/stores/settings-store-types.ts` — 设置类型与 ModelBinding
- `src/renderer/src/stores/settings-store.ts` — 默认值、persist partialize、schema version
- `src/renderer/src/stores/settings-store-migrate.ts` — 存量配置迁移
- `src/renderer/src/components/settings/MemorySettingsPanel.tsx` — 记忆设置 UI
- `src/renderer/src/lib/agent/memory-automation-utils.ts` — 当前 Provider 解析
- `src/renderer/src/lib/agent/memory-organization.ts` — 整理总编排
- `src/renderer/src/lib/agent/memory-automation-internal.ts` — 整理 LLM 请求
- `src/renderer/src/lib/ipc/agent-bridge-streaming.ts` — sidecar text request
- `src/main/ipc/memory-organization-scheduler.ts` — startup/nightly 调度
- `src/renderer/src/components/automation/AutomationModelSelector.tsx` — Provider/Model 选择参考
- `src/renderer/src/components/automation/AutomationTaskFormDialog.tsx` — 思考模式与 reasoning effort 参考
- `src/renderer/src/lib/tools/cron-runtime.ts` — 定时任务 ProviderConfig 构造参考

## 风险与边界

1. 不能修成“Provider/Model 归属校验后继续复用全局活动模型”；必须新增独立持久化选择。
2. 没有独立整理配置时，整理应报告缺少配置/Provider，而不是隐式切换到全局活动模型。
3. Provider 被删除、禁用、无 API Key 或所选 Model 被删除/禁用时，应安全地视为不可用并报告 `missing_provider`，不自动跳到全局活动模型。
4. 不触碰本轮次级的 ProviderRetryPolicy 默认重试策略，除非编译验证暴露直接关联问题。
5. 不修改其他用户未提交文件；不读取或输出 Provider API key。
6. 真实 Electron 定时运行和设置 UI 人工验证仍需要用户在验证阶段执行或确认。
