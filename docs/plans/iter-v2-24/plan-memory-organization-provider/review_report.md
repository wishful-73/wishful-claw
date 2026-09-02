# Review Report: 独立记忆整理模型配置与 nightly 启动行为

日期：2026-09-02
审查范围：本 Plan 相关设置、Provider 解析、文本模型筛选、scheduler 与文案改动。

## 结论

代码审查结论：PASS（静态审查）。

最终 Plan 裁定仍需用户在运行时验收后确认；Agent 不将未执行的 Electron/UI/定时运行验收标记为 PASS。

## 已确认事项

1. 设置层新增并持久化 `memoryOrganizationModel`、`memoryOrganizationThinkingMode`、`memoryOrganizationReasoningEffort`，schema version 从 34 升至 35；默认值为空绑定、`default`、空 effort。
2. 迁移逻辑会清理空白/非法 Provider ID、Model ID、thinking mode 和 reasoning effort，不从全局 active/fast 选择补值。
3. MemorySettingsPanel 仅展示 enabled、认证就绪且有可用文本模型的 Provider；Model 必须属于所选 Provider、enabled、未被标记为非 chat 类别，并排除图片/视频协议。
4. Provider 切换会选择该 Provider 的 defaultModel 或首个可用文本模型，并重置思考模式/effort；Model 切换同样重置思考设置。
5. 思考模式与 reasoning effort 分离展示：模型声明 thinkingConfig 时显示 default/enabled/disabled；仅在 enabled 且存在有效 effort levels 时显示 effort 控件。
6. `resolveAutomationProvider()` 只读取记忆整理独立设置，校验绑定、Provider 归属、enabled、认证状态及模型可用性；无效配置返回 null，不回退全局 active/fast Provider/Model。
7. `ProviderConfig` 传递模型协议、请求参数、thinkingConfig、显式 thinkingEnabled、reasoningEffort、缓存、代理、超时和重试等现有字段；没有新增 Worker 协议或 C# 反向依赖。
8. `hasUsableProvider()` 与解析端共同阻止图片/视频/非 chat 模型进入文本整理请求。
9. nightly 正常启动只等待本地配置时间点，不再调用 `fireOrganization('catchup')`；startup 延迟/20 小时节流逻辑保留，timer、轮询和清理路径未被移除。
10. 静态搜索确认 `memory-automation-utils.ts` 不再包含 `activeProviderId`、`activeModelId`、`activeFastProviderId`、`activeFastModelId`、`getActiveProvider` 或 `getFastProviderConfig`。
11. 未发现本 Plan 新增的 Provider API key 输出、硬编码 secret 或 secret 持久化；配置只保存 Provider/Model ID、模式和 effort。

## 额外回归审查：压缩摘要 UI

- `ContextCompressionMessage.tsx` 折叠状态下不再渲染摘要 preview button/span，只保留可展开的“上下文已压缩”分隔线；点击后才渲染完整摘要 Markdown。
- `getCompactSummaryDisplayText()` 仅在显示层剥离 `<compaction-summary>` 包装标签、固定英文引导语及已有的摘要标题/导语块，不修改持久化消息或 Worker 协议。
- 内联压缩摘要仍统一通过 `ContextCompressionMessage` 渲染，未发现绕过该组件直接显示摘要正文的路径。

## 风险与未覆盖项

- 当前未执行真实 Electron 设置页交互、重启后持久化、手动整理请求抓包/日志核对、nightly 到点触发与重启不 catch-up、startup 水位触发，以及压缩摘要折叠/展开显示等运行时验收。
- 已观察到 `input = 594,871 tokens` 超过模型 `524,288 tokens` 上限 `70,583 tokens`（约 13.5%）；HTTP 400 `ContextWindowExceededError` 属于确定性不可重试错误，继续多次重试通常无意义。ProviderRetryPolicy 重试分类属于本 Plan 明确排除的相邻问题，本次未修改。
- 独立子 Agent 审查因其 Provider 返回 HTTP 404 `model route not found` 未能完成；本报告由主 Agent 根据代码、静态搜索和构建证据完成，不复用该失败调用的结论。
- 工作区包含大量与本 Plan 无关的用户未提交改动；本次没有 reset、checkout、提交或 push。

## 建议的人工验收

1. 在设置页保存独立 Provider/Model、思考模式和 effort，重启后确认保持。
2. 手动整理后确认请求使用独立模型；改变全局 active 模型后再次整理，确认不受影响。
3. 选择 nightly，重启且水位过期，确认不会立即整理；到达本地 nightly 时间后确认触发。
4. 选择 startup，确认启动延迟后仍按 20 小时水位节流触发。
