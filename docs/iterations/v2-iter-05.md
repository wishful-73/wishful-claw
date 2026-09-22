# v2-iter-5：渠道配置测试与完善


**目标**：OpenAI 兼容 + Anthropic 全链路验证通过，清理不兼容或过时的预设。

| 步骤 | 内容 |
|------|------|
| 1 | OpenAI 兼容渠道验证：API Key + Base URL 配置 → 连通性测试 → 模型列表拉取 → 实际对话 |
| 2 | Anthropic 渠道验证：同上全链路 |
| 3 | 中转商渠道验证：验证 stream_options.include_usage 是否返回 token 统计 |
| 4 | 不兼容或过时预设清理 |
| 5 | 修复测试中发现的问题 |

**验证标准**：至少 2 种渠道（OpenAI 兼容 + Anthropic）配置 → 连通性测试 → 模型列表 → 实际对话，全链路通过。

**分支**：`dev/v2-iter-5`　**Tag**：`v2.5.0`
