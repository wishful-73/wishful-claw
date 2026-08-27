# Wishful Claw 项目规划文档

## 一、项目概述

Wishful Claw 是一个 Agent 编程软件项目，目标是打造一个适合自己的"贾维斯"。项目从零构建，参考五个开源 Agent 项目的优点，融合为一体。

- **项目路径**：`D:\claw\wishful-claw`
- **GitHub**：https://github.com/wishful-73/wishful-claw
- **技术栈**：React 19 + Electron 35 + .NET 11 preview Native AOT + MessagePack

## 二、项目背景

开发者是资深工程师，在 AI 浪潮中广泛体验和改造过多个 Agent 工具，对各类工具的优缺点有深入理解，具备源码级改造能力。

### 工具探索历程

| 工具 | 类型 | 优点 | 痛点 | 参与程度 |
|------|------|------|------|---------|
| OpenClaw | Agent 编程工具 | 功能强 | 记忆差、不够智能 | 最早体验者 |
| KodaClaw | 国产大牛自写 Agent | 记忆系统好、人格系统好 | 工具不全、模型支持有限、作者更新慢 | 深度改源码、多样化部署 |
| Koda-agent | KodaClaw 系列 Rust 版 CLI | 纯编程辅助 | 功能有限 | 改造加功能 |
| Reasonix | 开源 Agent | 打磨好、bug 少、缓存命中率高、工具注册机制完善 | 功能单一、无人格 | 拉源码改造，目前常用（缓存命中率 / 工具注入参考） |
| OpenCowork | 开源 Agent | 功能全面、模型支持全、更新快 | 人格差、记忆粗糙、bug 多 | 拉源码改造，目前常用 |

### 决策结论

- **基底选择：OpenCowork**——更新快、功能全、作者是 token 中转商、生态活跃
- **Reasonix 局部参考**——缓存命中率统计、工具注册发现、工具注入体系设计思路可借鉴，代码自行实现
- **KodaClaw 只参考设计思路**——作者更新慢，不参考代码维护性

## 三、三种形态

项目规划三种独立形态，各自独立设计，不共享同一套代码：

| 形态 | 描述 | 工具调用 | 优先级 |
|------|------|---------|--------|
| 桌面应用 | 完整 Agent 编程软件 | 有，本地工具链 | 第一优先 |
| App 聊天 | 轻量纯聊天，接入全能 App | 不需要 | 第二 |
| 服务器版 | 服务化管理 | 有，形态和方向与桌面不同 | 可选 |

### 人格系统定位

人格系统在**最终输出给用户时体现**，不介入 Agent Loop 决策。Agent 的"大脑"不受人格干扰，但"嘴巴"有人格。

## 四、参考项目与源码地址

| 项目 | 本地路径 | 参考内容 |
|------|---------|---------|
| 项目 | 本地路径 | 参考内容 |
|------|---------|---------|
| OpenCowork | `D:\claw\OpenCowork` | Agent Loop、工具链（30+ Executor）、模型 Provider（5 种）、架构（Electron + .NET Sidecar）、MessagePack 流式协议、模块化注册（IWorkerModule） |
| KodaClaw（含 SDK） | `D:\claw\koda-claw\koda-claw` | 记忆系统设计（文件驱动分层流转、HEARTBEAT 语义降级）、人格系统设计（Identity + Soul 双层、PersonaPreset 预设、PromptBuilder 分段组装） |
| OpenClaw.net | `D:\claw\openclaw.net` | 记忆主动回忆机制（TryInjectRecallAsync）、记忆工具化（memory/memory_search 工具）、上下文预算（ContextBudgetPlanner）、循环终止检测、工具治理体系 |
| DeepSeek-Reasonix | `D:\claw\DeepSeek-Reasonix` | 缓存命中率统计（prefix cache 分析）、工具注册发现（ToolRegistry/ToolDiscovery）、工具注入体系（InjectionStrategy） |
| OpenAI Codex | — | Goal 模式状态机（plan → execute → verify → continue/adjust）、自检评估机制（参考开源仓库 `github.com/openai/codex`） |

## 五、架构设计

### 整体架构（桌面应用）

```
┌─────────────────────────────────────────────┐
│              Electron (壳)                    │
│  ┌─────────────┐  ┌──────────────────────┐   │
│  │  Main 进程    │  │  Renderer (React)    │   │
│  │  窗口/IPC     │  │  UI / 交互 / 状态     │   │
│  └──────┬───────┘  └──────────┬───────────┘   │
│         │   IPC (msgpack)     │               │
│         └──────────┬──────────┘               │
├─────────────────────┼─────────────────────────┤
│                     ▼                          │
│  ┌──────────────────────────────────────────┐ │
│  │     .NET 10 Sidecar (子进程)              │ │
│  │                                          │ │
│  │  ┌─────────────────┐  ┌───────────────┐  │ │
│  │  │ Agent Runtime    │  │ Workspace     │  │ │
│  │  │ (从 OpenCowork)  │  │ (新写)        │  │ │
│  │  │                  │  │               │  │ │
│  │  │ - Agent Loop     │  │ - Memory/     │  │ │
│  │  │ - Provider/ (5种)│  │   记忆系统     │  │ │
│  │  │ - ToolExecutor/  │  │ - Persona/    │  │ │
│  │  │   (30+ 工具)     │  │   人格系统     │  │ │
│  │  │ - StreamProtocol/│  │ - Files/      │  │ │
│  │  │   (MessagePack)  │  │   工作区文件   │  │ │
│  │  └─────────────────┘  └───────────────┘  │ │
│  │                                          │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │ Modules (模块化注册 IWorkerModule)   │ │ │
│  │  │ AgentRuntimeModule / WorkspaceModule│ │ │
│  │  │ FileModule / ShellModule / ...      │ │ │
│  │  └─────────────────────────────────────┘ │ │
│  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

### 核心原则

**Agent Runtime 和 Workspace 严格分离，通过接口交互。**

- Agent Loop 调模型前，从 Workspace 拿 System Prompt（含人格）
- Agent Loop 开始前，自动检索相关记忆注入对话上下文（参考 OpenClaw.net）
- 模型回答后，结果交给 Workspace 做记忆处理
- 两边互不依赖实现细节

## 六、记忆系统设计

### 核心原则

**记忆必须被用上。** 不靠 System Prompt 全量塞入，而是 Agent 通过工具主动检索读取和实时写入。

### 三项目记忆对比

| 维度 | OpenCowork | KodaClaw | OpenClaw.net |
|------|-----------|---------|-------------|
| 记忆读取 | 全量塞 System Prompt | 文件加载到 Prompt | 主动回忆注入 + 工具检索 |
| 记忆写入 | 对话后批量总结 | Agent 实时写入 | 工具实时读写 + FTS 搜索 |
| 记忆结构 | 全局+项目双层 | 文件分层流转 | 分形树 + 笔记 + FTS |
| 记忆归档 | 无 | sessions→topics→dormant→archive | 按日期归档 + 过期清理 |
| 上下文预算 | 无 | 字符预算截断 | Token + 字符双限制 |
| 用户感知 | 黑箱，不知道有没有用上 | Agent 主动维护，可感知 | 工具调用，可感知 |

### 记忆设计方向

| 环节 | 方案 | 参考 |
|------|------|------|
| **记忆读取** | Loop 开始前自动检索注入 + Agent 通过工具按需检索 | OpenClaw.net（TryInjectRecallAsync） |
| **记忆写入** | Agent 在对话中通过工具实时写入 | KodaClaw + OpenClaw.net |
| **System Prompt** | 只放记忆索引/摘要，详细信息靠工具按需读取 | KodaClaw（PromptBuilder） |
| **记忆结构** | 全局 + 项目双层，文件驱动 | OpenCowork 双层 + KodaClaw 文件驱动 |
| **记忆生命周期** | 分层流转 + 语义降级 | KodaClaw（sessions→topics→dormant→archive + HEARTBEAT） |
| **上下文预算** | Token + 字符双限制，自动截断 | OpenClaw.net（ContextBudgetPlanner） |
| **记忆搜索** | FTS 全文搜索 | OpenClaw.net（SQLite FTS） |

### 记忆工作流

```
用户发消息
  ↓
Agent Loop 开始前
  ↓
TryInjectRecall(userMessage)  ← 自动检索相关记忆，注入对话上下文
  ↓
Agent Loop 运行（模型调用 → 工具执行 → 循环决策）
  ↓  ↑
  │  └─ Agent 通过 memory_search 工具按需检索更多记忆
  │  └─ Agent 通过 memory_write 工具实时写入新记忆
  ↓
Loop 结束
  ↓
记忆巩固（分层流转 / 语义降级）
```

## 七、人格系统设计

### 参考来源：KodaClaw

| 层 | 作用 | 说明 |
|----|------|------|
| **Identity（身份）** | 我是谁 | `IDENTITY.md`，Agent 的基本身份定义 |
| **Soul（灵魂）** | 我怎么说话 | `SOUL.md`，性格、沟通风格、行为准则 |

### 人格预设

参考 KodaClaw 的 PersonaPreset 机制，内置多种人格供切换：

| 预设 | 定位 |
|------|------|
| 极简执行者 | 只给结论，不废话 |
| 深度分析师 | 展示推理，不急下结论 |
| 创意伙伴 | 发散思维，不怕天马行空 |
| 耐心向导 | 用例子解释，确认理解 |
| 务实顾问 | 一切落到可执行的下一步 |
| 均衡默认 | 适合所有人的安全起点 |

### PromptBuilder 分段组装

参考 KodaClaw 的 PromptBuilder，System Prompt 模块化组装：

- Base Instruction（基础指令）
- Profile Overlay（场景覆盖指令）
- Context Files（IDENTITY.md / SOUL.md / USER.md / 记忆索引）
- Character Budget（字符预算，超限自动截断）

### 人格应用时机

人格系统在**最终输出给用户时体现**，不介入 Agent Loop 中的模型决策、工具调用、中间推理环节。

## 八、Agent Loop 设计

### 参考来源：OpenCowork

Agent Loop 核心在 `OpenAIChatRuntime.ExecuteLoopAsync`（3828 行），核心结构：

```
for (iteration = 1; ; iteration++)
{
    1. 检查取消
    2. 检查上下文压缩（token 超阈值时自动压缩）
    3. 调用模型 API（流式）
    4. 解析模型返回（文本/thinking/工具调用）
    5. 执行工具调用
    6. 工具结果喂回模型 → 继续循环
    7. 模型无工具调用 → loop_end
}
```

### 改进点

| 改进 | 来源 | 说明 |
|------|------|------|
| Loop 开始前注入记忆 | OpenClaw.net | `TryInjectRecallAsync`，自动检索相关记忆 |
| 循环终止检测 | OpenClaw.net | 工具信号 + 关键词兜底 |
| 拆分文件 | 自身改进 | OpenCowork 的 3828 行单文件要拆开 |
| System Prompt 在 Sidecar 构建 | 自身改进 | OpenCowork 在前端构建，需改到后端 |

## 九、工具链设计

### 参考来源：OpenCowork

OpenCowork 内置 30+ 工具，采用 Executor 模式，每个工具自注册、自包含：

| 类别 | 工具 |
|------|------|
| 核心 | Task、Todo、Plan、Goal |
| 文件 | Fs（读写）、Search（grep/glob） |
| 代码 | CodeGraph、CodeCompatible |
| 终端 | Shell、Terminal |
| 浏览器 | Browser、WebSearch、WebFetch |
| AI | ImageGenerate、Translation |
| 协作 | Team、SubAgent、Plugin、ChannelPlugin |
| 扩展 | Mcp、Extension、Skill |
| 系统 | Desktop、Notify、AskUser、Cron、Memory、Widget |

第一版按需挑选，不需要全部搬过来。

## 十、模型 Provider 设计

### 参考来源：OpenCowork

5 种 Provider 完整实现，直接使用：

- `openai-chat`
- `openai-responses`
- `anthropic`
- `gemini`
- `vertex-ai`

## 十一、三项目架构可取之处汇总

### OpenCowork 可取

- Electron Main / Renderer / Sidecar 三层分离
- 工具 Executor 模式（自注册、自包含）
- 模块化注册（IWorkerModule）
- MessagePack 流式协议
- 并发控制（信号量）

### OpenCowork 避坑

- OpenAIChatRuntime 3828 行单文件 → 拆分
- System Prompt 在前端构建 → 改到 Sidecar
- 数据库层分散（Main + Sidecar 两边都有）→ 统一
- 频道接入和核心耦合 → 剥离

### KodaClaw 可取

- SDK + 产品分层（Agent Loop 和业务逻辑解耦）
- 工作区文件驱动设计（可读、可调试、Git 友好）
- 记忆分层流转 + 语义降级（HEARTBEAT）
- PromptBuilder 分段组装 + 字符预算
- 人格双层设计（Identity + Soul）
- PromptProfile 场景化
- 崩溃恢复（断点 + 快照 + Fork）

### KodaClaw 避坑

- SDK 和产品耦合 → 记忆/人格模块要独立
- ModelHub 形同虚设 → 模型管理用 OpenCowork 的
- 频道接入过度设计 → 不需要

### OpenClaw.net 可取

- 记忆主动回忆机制（TryInjectRecallAsync）
- 记忆工具化（memory / memory_search / fractal_memory_*）
- 上下文预算规划（ContextBudgetPlanner，Token + 字符双限制）
- 循环终止检测（工具信号 + 关键词兜底）
- 工具治理体系（治理 + 钩子 + 审批 + 沙箱 + 熔断）
- 多种执行后端（本地 + Docker + SSH + 开放沙箱）
- 记忆保留归档（按日期 + 过期清理）

## 十二、开发模式

- 两台电脑分别跑 Reasonix 和 OpenCowork，用 AI 驱动开发
- 三线并行：工作项目（wishful-claw）+ 开发自己的 App + 工作相关项目
- 当前处于规划阶段，逐步推进

## 十三、版本规划

| 版本 | 形态 | 目标 |
|------|------|------|
| V1 | 纯桌面应用 | 核心链路跑通，自己用 |
| V2 | 轻量纯聊天，接入全能 App | Agent 能力进入移动端 |
| V3 | 服务器版 | 待定（可选） |

三种形态独立设计，不共享同一套代码。
