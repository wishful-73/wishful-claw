# 迭代三：Agent Loop + 对话


**目标**：能跟模型对话，流式输出。

| 步骤 | 内容 |
|------|------|
| 1 | 从 OpenCowork 搬入 Agent Loop 核心逻辑，拆分单文件为多个（AgentLoop / StreamParser / IterationManager） |
| 2 | 从 OpenCowork 搬入 Provider 实现，先跑通 openai-chat 和 anthropic 两种 |
| 3 | 实现流式输出（模型响应 → MessagePack 事件 → 前端渲染） |
| 4 | 实现取消机制（用户中断对话） |
| 5 | 实现上下文压缩（token 超阈值时触发） |
| 6 | 前端对话界面（从 OpenCowork 搬，保留聊天 UI + 流式渲染） |

**验证标准**：选择已配置的 Provider 和模型 → 输入消息 → 流式看到模型回复 → 能中途取消。
