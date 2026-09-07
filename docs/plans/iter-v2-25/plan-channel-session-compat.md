# Plan：所有内置渠道会话兼容

## 目标

让所有内置渠道会话具备可执行的专用 Agent 上下文：明确渠道输出限制，保留查询/浏览/文件等可用工具，筛除依赖桌面渲染的工具，并将用户交互工具降级为渠道文本问答。

## 步骤清单

- [ ] 步骤 1：定义渠道会话识别与工具可用性策略；检查点：同一策略可由 PromptBuilder 和工具注册共同使用。
- [ ] 步骤 2：注入渠道专用内置提示词；检查点：渠道会话提示当前渠道、推荐工具和纯文本交互方式，普通桌面会话提示词不变。
- [ ] 步骤 3：筛选渠道可用内置工具；检查点：保留搜索/浏览/Web/文件/记忆/项目查询/渠道发送，排除桌面 UI、Widget、Notebook 等工具。
- [x] 步骤 4：确认 AskUser 的渠道降级策略；检查点：不新增协议，依靠 Agent 普通文本提问与同一渠道会话的后续消息完成交互。
- [ ] 步骤 5：增加回归覆盖并构建；检查点：C# solution、TypeScript 三套配置和渠道工具筛选测试通过。

## 涉及文件

- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs`
- `src/runtime/WishfulClaw.Agent/Tools/Providers/*`
- `src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeAskUserExecutor.cs`
- `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs`
- 现有渠道 reverse-request 与回归测试文件

## 约束

- 不新增大批量渠道 API 工具，优先复用现有工具。
- Agent 层不依赖 Main；渠道发送继续经 reverse-request/既有协议。
- AOT 禁止反射和未注册 JSON 类型。
- 保留当前工作区已有未提交改动，不 reset、不覆盖。

## 验证

- `npx tsc --noEmit -p tsconfig.web.json`
- `npx tsc --noEmit -p tsconfig.node.json`
- `npx tsc --noEmit -p tsconfig.json`
- `dotnet build src/runtime/WishfulClaw.sln`
- 相关渠道工具/Prompt 回归测试
