# Wishful Claw — 开发说明

> 本文是给**开发者 / AI 编程助手**看的仓库说明（架构、构建、技术选型、参考来源）。
> 只想知道这个软件能做什么、怎么用：请看 [《使用指引》](user-guide.md) 或[根 README](../README.md)。
> 参与开发的操作流程（分支、提交节奏、迭代收尾、发布）见 [dev-workflow.md](dev-workflow.md)，构建与打包细节见 [build-guide.md](build-guide.md)。

<p align="center">
  <img src="https://img.shields.io/badge/.NET-11-blue" alt=".NET">
  <img src="https://img.shields.io/badge/Electron-43-blue" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-blue" alt="React">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue" alt="License">
</p>

## 🚀 Why Wishful Claw?

市面上的 Agent 编程工具各有短板：记忆差、人格粗糙、工具链不全。Wishful Claw 参考多个优秀开源项目的设计，从零构建一个**真正适合自己**的 Agent：

- **有记忆** — 对话前自动检索相关记忆注入，Agent 也能主动读写记忆。关掉重开，记忆还在
- **有人格** — 6 套内置人格预设，切换后输出风格截然不同。人格只在输出层生效，不干扰 Agent 决策
- **能调工具** — 文件读写、Shell 执行、代码搜索、浏览器操作，Agent 在你的工作区里直接干活
- **能跑 Goal** — 自主编排迭代，plan → execute → verify → continue/adjust 状态机，Agent 自己跑完整个任务

## ✨ 实现要点

### 🧠 记忆系统（Hot + SQLite FTS5）

| 层 | 载体 | 说明 |
|----|------|------|
| **Hot** | `MEMORY.md` 文件 | 活跃记忆，`##` 分段管理，Agent 通过工具实时读写 |
| **持久** | SQLite `memory_entries` 表 + FTS5 | 全文搜索（trigram 分词），Agent 通过工具追加/搜索/更新 |

- **TryInjectRecall** — Agent Loop 开始前自动检索相关记忆注入对话，标注 `untrusted reference data` 防 prompt injection
- **记忆工具** — `memory_append` / `memory_search` / `memory_update` / `memory_hot_read` / `memory_hot_write`
- **ContextBudgetPlanner** — Token × 4 + 字符双限制，自动截断
- **scope 隔离** — 全局 (`~/.wishful-claw/`) + 项目级 (`{工作区}/.wishful-claw/`)

### 🎭 人格系统

- **Identity + Soul 双层** — 身份定义"我是谁"，灵魂定义"我怎么说话"
- **PromptBuilder 分段组装** — Base Instruction + Profile Overlay + Context Files + Character Budget
- **会话级切换** — 不同会话可以绑定不同人格
- **AI 辅助创建** — 描述你想要的人格，自动生成 Identity / Soul 文件

### 🧰 工具链

工具经 `IToolProvider` 显式注册，分类真源见 `src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs`；可见性由注册期声明的「范围:级别」决定（`ToolPreset` + `AgentRunContextPolicy`），不再写死白名单。

| 类别 | 工具 |
|------|------|
| 文件 | Read / Write / Edit / LS / Glob |
| 代码 | Grep（全文搜索）、CodeGraph 代码图谱 |
| 终端 | Bash（命令执行） |
| 记忆 | memory_append / memory_search / memory_update / memory_hot_read / memory_hot_write |
| 子 Agent | Task 工具，嵌套上限 2 层 |
| 浏览器 | 内置 webview 浏览器（Navigate / Snapshot / Click / Type） |
| Goal | create_goal / update_goal / get_goal / list_goals / get_goal_history |
| 计划 | EnterPlanMode / SubmitPlanReview / ExitPlanMode / UpdatePlanStep |

### 📦 数据持久化

- **SQLite**（`index.db`，全局唯一）— 项目注册、会话与消息、子 Agent 运行记录、计划/Goal/任务、定时任务、SSH 连接、记忆条目 + FTS5 索引、上下文压缩快照、请求级用量日志（`request_usage_logs`）。逐表写入，重启不丢
- **Markdown 文件** — 人格（`IDENTITY.md` / `SOUL.md` / `USER.md`）与 Hot 记忆（`MEMORY.md`）纯文件存储，人可读、可编辑、Git 友好
- **JSON 配置** — 应用配置、服务商配置与全局渠道设置经 Infrastructure/Storage 的 `ConfigStore` / `ProviderStore` 读写

目录归属与表结构详见 [data-storage.md](data-storage.md)。

### 📊 缓存命中率与请求级用量

- 后端 SessionConversation 以原子计数器累计 cache hit / miss tokens，会话级全局展示命中率
- `request_usage_logs` 表按**一次 HTTP 尝试一行**记录请求级用量（含失败尝试与重试次数），成本在写入时按配置价格结算，供设置页「用量统计」面板与 `db/usage-*` 查询端点消费

## 🏗️ Architecture

```
Renderer (React 19)  ←→  Preload (contextBridge)  ←→  Main Process  ←→  Native Worker (.NET 11)
     │                                                      │                    │
  UI / 状态管理 / 工具调用展示                          IPC 桥接 / 窗口管理     7 层架构（见下方）
  SubAgentCard / 记忆面板 / 人格切换                     Worker 进程生命周期     Agent Loop / Provider 流式
                                                                               SQLite + FTS5 索引
                                                                               工具执行 / PromptBuilder
                                                                               缓存计数器 / 上下文压缩
```

### 7 层架构

```
┌──────────────────────────────────────────────────────────────────┐
│  Contracts   — 接口契约（纯接口，无实现）                         │
├──────────────────────────────────────────────────────────────────┤
│  Core        — Agent 通用框架（Protocol + Tools 基类）            │
├──────────────────────────────────────────────────────────────────┤
│  Infrastructure — 基础设施（Db / Storage / Http）                 │
├──────────────────────────────────────────────────────────────────┤
│  Workspace   — 记忆系统（Memory 读写/检索/FTS5）                  │
├──────────────────────────────────────────────────────────────────┤
│  Persona     — 人格系统（PromptBuilder / Generator / Store）      │
├──────────────────────────────────────────────────────────────────┤
│  Agent       — Agent 运行时（Loop / Provider / Tools / Modules）  │
├──────────────────────────────────────────────────────────────────┤
│  Worker      — 进程入口（薄层 IPC 宿主）                          │
└──────────────────────────────────────────────────────────────────┘
```

**核心原则**：

- **分层严格分离** — 各层通过 Contracts 接口交互，依赖方向严格自上而下，禁止逆向依赖
- **Agent Runtime 和 Workspace 严格分离** — Agent 不直接操作记忆，通过工具调用读写
- **Infrastructure 下沉** — Db/Storage/Http 等通用能力下沉到独立层，Worker 保持薄层
- **记忆必须被用上** — 不靠 System Prompt 全量塞入，Agent 通过工具主动检索读取和实时写入
- **人格在输出时体现** — 不介入 Agent Loop 决策，只在最终输出给用户时加工

各目录职责与结构见 [project-structure.md](project-structure.md)，数据落盘结构见 [data-storage.md](data-storage.md)。

## 🛠️ Quick Start

**前置条件：** Node.js ≥ 18, npm ≥ 9, .NET SDK 11（AOT 发布需 preview 版，装系统默认位置即可）

```bash
cd wishful-claw
npm install
npm run dev
```

### Key Commands

| Command | Description |
| ------- | ----------- |
| `npm run dev` | 启动 Electron + Vite 热重载 |
| `npm run dev:full` | 先编译 .NET Worker 再启动前端 |
| `npm run build` | TypeScript 检查 + 生产构建 |
| `npm run typecheck` | TypeScript 类型检查（main + renderer） |
| `npm run build:worker` | 编译 .NET Worker |
| `npm run pack:installer:full` | AOT Worker + 前端 + electron-builder NSIS 安装包 |

> **数据目录：** 生产 `~/.wishful-claw/`，开发态 `~/.wishful-claw-dev/` — SQLite 数据库、全局记忆/人格文件、日志

### 编译验证口径

- **C#**：`dotnet build` 零错误零警告（AOT 同理，见 `scripts/publish-aot-worker.mjs`）
- **TypeScript**：三个配置全绿，且必须带 `-p`
  - `npx tsc --noEmit -p tsconfig.web.json`（渲染进程）
  - `npx tsc --noEmit -p tsconfig.node.json`（主进程）
  - `npx tsc --noEmit -p tsconfig.json`（根配置）
- **AOT 约束**：禁反射与匿名类型序列化，新增序列化类型必须注册进对应 `JsonSerializerContext`，详见 [AGENTS.md](../AGENTS.md)

## 💻 Tech Stack

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Zustand + Tailwind CSS 4 |
| 桌面壳 | Electron 43 + electron-vite |
| 后端 | .NET 11 (C#) + Native AOT |
| 通信 | MessagePack IPC（`@msgpack/msgpack` ↔ C# 侧 Protocol） |
| 数据库 | SQLite（`Microsoft.Data.Sqlite` + FTS5） |
| 记忆 | Markdown 文件 + FTS5 全文搜索 |
| 编辑器 | Monaco Editor |

## 📚 Reference Projects

| 项目 | 参考内容 |
|------|---------|
| [OpenCowork](https://github.com/AIDotNet/OpenCowork) | Agent Loop、工具链、Provider、流式协议（迁移+重构） |
| [KodaClaw](https://github.com/nekonaka/koda-claw) | 记忆系统、人格系统、PromptBuilder（借鉴思路） |
| [OpenClaw.net](https://github.com/nekonaka/openclaw.net) | 记忆主动回忆、记忆工具、上下文预算（借鉴思路） |
| [DeepSeek-Reasonix](https://github.com/deepseek-ai/DeepSeek-Reasonix) | 缓存命中率统计、工具注册发现、工具注入体系（借鉴思路） |
| [OpenAI Codex](https://github.com/openai/codex) | Goal 模式状态机、自检评估机制（借鉴思路） |

> OpenCowork 的代码经迁移和重构后纳入 WishfulClaw 架构；其余项目主要借鉴设计思路和架构理念，代码由 WishfulClaw 自行实现。

## 📜 License

本项目采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源，Copyright 2026 **Wishful 心相团队**。

本项目大量参考与借鉴了 [OpenCowork](https://github.com/AIDotNet/OpenCowork)（Copyright 2026 AIDotNet，Apache 2.0）：Agent Loop、工具链、Provider、流式协议与 Worker 运行时等部分代码源自 OpenCowork，经迁移、拆分、适配与重构后纳入 WishfulClaw 架构。OpenCowork 的原始版权声明已在迁移文件头保留，完整第三方归属声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
