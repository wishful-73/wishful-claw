# 渠道会话兼容处理：探索结论

## 目标

为所有内置渠道会话提供专用的 Agent 运行上下文：提示词明确当前处于渠道会话，并推荐可在渠道中呈现/发送的工具；新增统一的渠道专用工具入口，避免依赖桌面渲染组件。

## 当前实现

- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs`
  - 已按 `sessionMode` 注入 goal/global 提示词。
  - 尚未按渠道会话注入渠道上下文、输出媒介能力和工具使用建议。
- `src/runtime/WishfulClaw.Agent/Tools/Providers/ChannelPluginToolProvider.cs`
  - 已注册飞书、微信少量图片/文件/成员/多维表格工具。
  - 工具定义按具体渠道名称注册，没有统一的“当前渠道会话发送”工具。
- `src/runtime/WishfulClaw.Agent/AgentRuntimeChannelPluginExecutor.cs`
  - 已通过 reverse-request 路由飞书/微信工具到 Main。
  - 当前渠道工具集合仅覆盖 Feishu/Weixin，其他内置渠道需按现有插件协议扩展。
- `src/main/channels`
  - 渠道服务按 `pluginId` 和 `chatId` 接收事件并发送回复；已有各 Provider 的发送能力，但能力没有统一暴露给 Agent 工具层。

## 需要补齐

1. 定义稳定的渠道会话上下文参数：渠道插件类型/实例、外部聊天 ID、回复能力和当前消息信息，避免只依赖 `sessionMode`。
2. PromptBuilder 增加渠道专用提示词段：说明当前输出会投递到渠道，推荐 Browser/WebFetch/Search 与渠道发送工具，说明图片/文件/卡片/富渲染内容应转为渠道可承载的发送动作。
3. 新增统一渠道工具模型和显式注册/路由，至少覆盖发送文本、图片、文件；按插件能力返回不支持结果，不伪造渲染效果。
4. 兼容已有 Feishu/Weixin 专用工具，并补齐所有内置渠道的路由适配或明确能力降级。
5. 增加工具路由与提示词回归测试，并执行三套 TS 检查、C# build。

## 风险

- 各渠道的 API 能力不同，不能把卡片、交互按钮等桌面/渲染器组件直接当作已发送成功。
- Agent 层不能反向依赖 Main；应通过已有 reverse-request/Contracts 协议扩展。
- 工作区当前存在用户未提交的 iter-25 改动，执行时必须保留并避免覆盖。
