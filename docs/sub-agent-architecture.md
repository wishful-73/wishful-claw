# 子 Agent 架构设计

> 日期：2026-07-27  
> 迭代：iter-11  
> 状态：方案已确认，待实现  
> 修订：2026-07-27 补充主会话上下文保持机制（3.4 节）

## 1. 背景与目标

### 1.1 问题

当前主 Agent 直接调用工具（Read/Edit/Bash 等），所有工具调用渲染为 ToolCallCard 直接展示在聊天页面。存在两个问题：

- **主会话上下文被工具调用细节污染**，用户难以追踪重点信息
- **聊天页面信息过载**，大量工具预览（文件内容、命令输出）挤占视觉空间

### 1.2 目标

参考灵犀的工作台模式，将工具执行从主会话迁移到子 Agent：

- 用户发送消息后，主 Agent 判断需要工具时创建子 Agent 执行
- 子 Agent 独立 LLM 调用，有自己的迭代循环，多轮执行直到完成/卡住/需要用户帮助
- **执行中**：聊天页面默认展开，渲染每步简短中文描述（如"查看 agents.md 文件"），不预览；右侧工作台显示完整详情含预览；用户可在聊天左侧交互审批
- **执行结束后**：聊天页面折叠成纯文字汇总标题，可展开看步骤列表；右侧面板保留完整输出
- 一个主会话同时只有一个运行中的子 Agent
- 主会话上下文只保留重点信息，不被工具调用细节污染
- **主会话必须保持知情**：主 Agent 像产品经理，子 Agent 像程序员。子 Agent 执行结束后，主 Agent 必须知道做了什么、发现了什么、结果如何，能回答用户后续追问

### 1.3 设计原则

- **通过系统提示词引导**主 Agent 使用子 Agent，不硬性拦截直接工具调用
- 简单一次性操作（如读单个文件）主 Agent 可直接调用，多步骤任务走子 Agent
- 右侧面板直接复用现有 `SubAgentsPanel` + `SubAgentExecutionDetail` 组件

## 2. 现状分析

### 2.1 已有基础设施

wishful-claw 已有相当完整的子 Agent 基础设施：

| 层 | 组件 | 路径 | 状态 |
|---|------|------|------|
| Worker (C#) | SubAgentExecutor | `SubAgents/SubAgentExecutor.cs` | 已实现，创建子 AgentLoop，独立迭代 |
| Worker (C#) | SubAgentRunCollector | `SubAgents/SubAgentRunCollector.cs` | 已实现，但只收集最终文本，不转发事件 |
| Worker (C#) | ToolCallProcessor | `ToolCallProcessor.cs` | 已实现，Task 工具识别和并发控制 |
| 前端 Store | sub-agent-slice | `stores/agent-store/slices/sub-agent-slice.ts` | 已实现，处理 8 种子 Agent 事件 |
| 前端 Store | adapt-sub-agent-event | `stores/chat-store/adapt-sub-agent-event.ts` | 已实现，事件适配 |
| 前端 UI | SubAgentCard | `components/chat/SubAgentCard.tsx` | 已实现，静态卡片，无实时步骤 |
| 前端 UI | SubAgentsPanel | `components/layout/SubAgentsPanel.tsx` | 已实现，右侧面板子 Agent 列表 |
| 前端 UI | SubAgentExecutionDetail | `components/layout/SubAgentExecutionDetail.tsx` | 已实现，含 transcript、工具调用展开 |
| 前端数据 | sub-agent-run-data | `components/layout/sub-agent-run-data.ts` | 已实现，历史合并、过滤、摘要 |

### 2.2 核心差距

#### 差距一：子 Agent 事件被完全抑制（最关键）

`SubAgentExecutor.cs` 第 83 行：

```csharp
childState.SuppressTransportEvents = true;
```

子 Agent 的所有中间事件（工具调用、文本输出、思考过程）都不会到达前端。Worker 只发了两个事件：

- `sub_agent_start` — 开始
- `sub_agent_end` — 结束

前端 store 已写好 `sub_agent_tool_call`、`sub_agent_text_delta`、`sub_agent_iteration` 等处理器，但**从未被触发过**。

#### 差距二：聊天中缺少实时步骤描述

当前 `SubAgentCard` 是一个静态卡片（显示名称、描述、状态），不会实时展示子 Agent 的每一步操作。用户需要的是执行中默认展开、渲染每步简短中文描述、结束后折叠成汇总。

#### 差距三：主 Agent 行为引导

当前主 Agent 直接调用 Read/Write/Edit/Bash 等工具，渲染为 ToolCallCard。需要通过系统提示词引导主 Agent 在多步骤任务时优先使用 Task 工具创建子 Agent。

## 3. 实现方案

分三层推进，每层可独立验证。

### 3.1 第一层：Worker — 转发子 Agent 事件

**目标**：将子 Agent 的关键事件包装为 `sub_agent_*` 前缀事件，转发到父 stream，使前端 store 中已有的处理器被触发。

**修改文件**：

- `src/runtime/WishfulClaw.Agent/SubAgents/SubAgentExecutor.cs`
- `src/runtime/WishfulClaw.Agent/SubAgents/SubAgentRunCollector.cs`
- `src/runtime/WishfulClaw.Agent/Executors/AgentRuntimeRunState.cs`（可能需要调整事件转发机制）

**事件映射**：

| 子 Agent 内部事件 | 转发为 | 用途 |
|---|---|---|
| `tool_call_start` | `sub_agent_tool_call` | 聊天显示"查看 xxx 文件" |
| `tool_call_result` | `sub_agent_tool_call`（更新） | 标记步骤完成 |
| `tool_call_approval_needed` | `sub_agent_tool_call`（待审批） | 用户可交互审批 |
| `text_delta` | `sub_agent_text_delta` | 右侧面板实时文本 |
| `thinking_delta` | `sub_agent_text_delta`（思考） | 右侧面板思考过程 |
| `iteration_start` | `sub_agent_iteration` | 迭代计数 |

**实现思路**：

`SubAgentRunCollector` 除了收集文本外，增加一个回调机制（`Action<AgentRuntimeStreamEvent>`），在 `ObserveAsync` 中将需要转发的事件通过回调传给 `SubAgentExecutor`，由后者包装为 `sub_agent_*` 事件并 `EmitAsync` 到父 stream。

关键约束：
- 子 Agent 的事件不能直接透传（会污染父 stream 的事件流），必须加 `sub_agent_` 前缀包装
- `SuppressTransportEvents = true` 保持不变，防止子 Agent 事件直接到达前端
- 转发逻辑在 collector 层面做，不影响 `AgentLoop` 本身

**验证方式**：

子 Agent 执行时，前端 `SubAgentExecutionDetail` 能实时显示 transcript、工具调用、文本输出。

### 3.2 第二层：前端 UI — 简短步骤描述 + 展开/折叠

**目标**：改造 `SubAgentCard`，实现执行中展开渲染步骤、结束后折叠成汇总。

**修改文件**：

- `src/renderer/src/components/chat/SubAgentCard.tsx`
- 可能新增 `src/renderer/src/lib/agent/sub-agents/step-descriptions.ts`（简短描述生成）

#### 3.2.1 展开/折叠行为

| 阶段 | 展开状态 | 显示内容 |
|------|---------|---------|
| 执行中 | 默认展开 | 步骤列表（每步一行简短中文描述 + 状态图标） |
| 执行结束 | 自动折叠 | 汇总标题（如"完成 5 次工具调用"），可点击展开看步骤列表 |

#### 3.2.2 简短描述生成规则

自动从工具调用生成，不需要 LLM 额外输出。语言为**中文**。

| 工具 | 参数 | 生成描述 |
|------|------|---------|
| Read | `file_path: "agents.md"` | 查看 agents.md 文件 |
| Edit | `file_path: "agents.md"` | 修改 agents.md 文件 |
| Write | `file_path: "config.json"` | 写入 config.json 文件 |
| Bash | `command: "git status"` | 执行命令: git status |
| Glob | `pattern: "*.ts"` | 搜索 *.ts 文件 |
| Grep | `pattern: "TODO"` | 搜索包含 TODO 的内容 |
| Task | `description: "verify build"` | 启动子任务: verify build |
| WebFetch | `url: "https://..."` | 访问网页 |
| 其他 | — | {工具中文名}: {首个参数值摘要} |

规则补充：
- 文件路径只取文件名，不显示完整路径（太长截断）
- Bash 命令截断到第一个 `&&` 或 `|` 之前的部分
- 描述最大长度 40 字符，超出截断加 `...`

#### 3.2.3 审批交互

子 Agent 执行中如果遇到需要审批的工具调用，审批 UI **在聊天左侧**（SubAgentCard 展开区域内）操作，不只在右侧面板。

SubAgentCard 步骤列表中，遇到 `pending_approval` 状态的工具调用时，渲染审批按钮（同意/拒绝），用户点击后通过 IPC 发送到 Worker。

### 3.3 第三层：主 Agent 行为引导

**目标**：调整主 Agent 的系统提示词，引导它在多步骤任务时优先使用 Task 工具创建子 Agent。

**修改文件**：

- `src/runtime/WishfulClaw.Agent/` 下的系统提示词构建逻辑
- 或 `src/renderer/src/lib/agent/system-prompt.ts`

**引导策略**：

- 不硬性拦截直接工具调用（简单操作如读单个文件可以直接调用）
- 系统提示词中明确：涉及 2 个以上工具调用的任务，应使用 Task 工具创建子 Agent
- 子 Agent 的结果不直接暴露给用户，主 Agent 需要总结后回复用户
- 一个主会话同时只有一个运行中的子 Agent（已有的并发控制 `maxConcurrentSubAgents` 保持为 1）

**不修改的部分**：

- Task 工具的定义和 schema 不变
- 子 Agent 的工具集继承机制不变
- 子 Agent 的深度限制（MaxSubAgentDepth = 2）不变

### 3.4 主会话上下文保持机制

**目标**：子 Agent 执行结束后，主 Agent 必须知道做了什么、发现了什么、结果如何，能回答用户后续追问。主 Agent 像产品经理，子 Agent 像程序员——任务完成后产品经理必须了解结果和关键细节。

**问题**：当前 `SubAgentRunCollector` 只收集子 Agent 的最终文本输出作为 `tool_result` 返回。如果子 Agent 读了 5 个文件然后写了句“已完成修改”，主 Agent 就无法回答“刚才看了什么文件”“改了哪里”这类追问。

**解决方案**：两层保证。

#### 3.4.1 工具调用摘要进入主 Agent 上下文

子 Agent 执行结束后，`tool_result` 不只返回最终文本报告，还附加一个结构化的工具调用摘要——调用了哪些工具、关键参数、成功/失败。

返回给主 Agent 的 `tool_result` 格式示例：

```
已修改 agents.md，添加了代码拆分规则。

工具调用摘要：
1. Read("agents.md") → 成功
2. Edit("agents.md", 添加拆分规则段落) → 成功
3. Read("agents.md") → 成功（验证修改）
```

主 Agent 上下文中有这份摘要，就能回答“刚才看了什么文件”“改了哪里”这类追问。完整工具输出不进上下文（太长），放在右侧面板供用户查看。

**修改文件**：

- `src/runtime/WishfulClaw.Agent/SubAgents/SubAgentRunCollector.cs` — 收集工具调用摘要（工具名 + 关键参数 + 状态）
- `src/runtime/WishfulClaw.Agent/SubAgents/SubAgentExecutor.cs` — 在 `GetFinalOutput()` 或 `BuildResultJson` 中拼接摘要

**实现思路**：

`SubAgentRunCollector` 已在 `ObserveAsync` 中收集 `tool_call_start` 事件计数，只需额外收集工具名和关键参数。在最终输出时，将文本报告 + 工具调用摘要拼接为 `tool_result` 返回给主 Agent。

摘要格式：
- 每个工具调用一行：`序号. 工具名(关键参数) → 状态`
- 参数只取第一个关键参数（文件名/命令/搜索模式），截断到 40 字符
- 失败的工具调用附加错误信息

#### 3.4.2 强化子 Agent 系统提示词中的报告要求

当前子 Agent 的系统提示词已有一句“End every run with a self-contained report”，但不够强。需要改为明确要求：

> 你的最终报告必须包含：做了什么、发现了什么关键信息、修改了什么、遇到了什么问题。产品经理（主 Agent）需要凭这份报告回答用户的后续追问，所以报告必须自包含所有关键细节，不能只说“已完成”。

**修改文件**：

- `src/runtime/WishfulClaw.Agent/SubAgents/SubAgentExecutor.cs` — `BuildChildParameters` 中注入子 Agent 的 system-reminder
- 或 `src/renderer/src/lib/agent/system-prompt.ts` — 默认系统提示词

#### 3.4.3 信息分层

| 信息层 | 位置 | 内容 |
|--------|------|------|
| 主 Agent 上下文 | tool_result | 最终文本报告 + 工具调用摘要（工具名 + 关键参数 + 状态） |
| 聊天页面 | SubAgentCard | 步骤列表（中文简短描述） + 汇总标题 |
| 右侧面板 | SubAgentExecutionDetail | 完整 transcript（所有工具调用 + 完整输出 + 思考过程） |

主 Agent 上下文只包含摘要和报告，不包含完整工具输出——这样既保证主 Agent “知情”，又不会因工具输出过长而消耗上下文。如果用户追问细节，主 Agent 可以再次创建子 Agent 查阅，或引导用户查看右侧面板。

## 4. 实施顺序与验证

| 阶段 | 内容 | 验证标准 |
|------|------|---------|
| 1 | Worker 事件转发 | 子 Agent 执行时，右侧面板 `SubAgentExecutionDetail` 实时显示 transcript 和工具调用 |
| 2 | 主会话上下文保持 | 子 Agent 执行结束后，主 Agent 上下文包含工具调用摘要 + 详细报告；追问“刚才看了什么文件”能回答 |
| 3 | 前端步骤描述 | 聊天页面 SubAgentCard 执行中展开显示中文步骤，结束后折叠为汇总 |
| 4 | 审批交互 | 子 Agent 遇到待审批工具时，聊天左侧可操作审批 |
| 5 | 系统提示词引导 | 主 Agent 在多步骤任务时主动创建子 Agent，简单任务仍直接调用工具 |

每个阶段完成后独立提交，便于回滚。

## 5. 不在本次范围内

以下事项不在本次子 Agent 架构改造范围内：

- 并行子 Agent（当前设计为一个主会话同时只有一个运行中的子 Agent）
- 子 Agent 的持久化历史回放（已有 `buildMessageSubAgents` 从历史消息重建，不在本次增强）
- 子 Agent 的报告合成（`reportStatus: 'fallback'` 逻辑保持不变）
- OpenCowork 的 Team/Orchestration 机制（wishful-claw 不需要）
