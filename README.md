<p align="center">
  <h1 align="center">Wishful Claw</h1>
  <p align="center">
    <strong>Agent 编程软件 — 融合记忆系统与人格系统的桌面 AI 助手</strong><br>
    Agent 有记忆、有人格、能调工具，真正成为你的编程伙伴。
  </p>
</p>

<p align="center">
  <a href="#-why-wishful-claw">Why</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-reference-projects">References</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.2.23-orange" alt="Version">
  <img src="https://img.shields.io/badge/.NET-10-blue" alt=".NET">
  <img src="https://img.shields.io/badge/Electron-35-blue" alt="Electron">
  <img src="https://img.shields.io/badge/React-19-blue" alt="React">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue" alt="License">
</p>

---

## 🚀 Why Wishful Claw?

市面上的 Agent 编程工具各有短板：记忆差、人格粗糙、工具链不全。Wishful Claw 参考多个优秀开源项目的设计，从零构建一个**真正适合自己**的 Agent：

- **有记忆** — 对话前自动检索相关记忆注入，Agent 也能主动读写记忆。关掉重开，记忆还在
- **有人格** — 6 套内置人格预设，切换后输出风格截然不同。人格只在输出层生效，不干扰 Agent 决策
- **能调工具** — 文件读写、Shell 执行、代码搜索、浏览器操作，Agent 在你的工作区里直接干活
- **能跑 Goal** — 自主编排迭代，plan → execute → verify → continue/adjust 状态机，Agent 自己跑完整个任务

## ✨ Key Features

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
- **6 套内置预设** — 桃子、老郑、贾维斯、小爪、婷姐、阿明
- **PromptBuilder 分段组装** — Base Instruction + Profile Overlay + Context Files + Character Budget
- **会话级切换** — 不同会话可以绑定不同人格
- **AI 辅助创建** — 描述你想要的人格，自动生成 Identity / Soul 文件

### 🧰 工具链

| 类别 | 工具 |
|------|------|
| 文件 | Read / Write / Edit / LS / Glob |
| 代码 | Grep（全文搜索） |
| 终端 | Bash（命令执行） |
| 记忆 | memory_append / memory_search / memory_update / memory_hot_read / memory_hot_write |
| 子 Agent | Task 工具，嵌套上限 2 层 |
| 浏览器 | 内置 webview 浏览器（Navigate / Snapshot / Click / Type） |
| Goal | create_goal / update_goal / get_goal / list_goals / get_goal_history |
| 计划 | EnterPlanMode / SubmitPlanReview / ExitPlanMode / UpdatePlanStep |

### 📦 数据持久化

- **SQLite** — 项目注册、会话历史、消息记录、记忆条目、FTS5 搜索索引，实时写入，重启不丢
- **Markdown 文件** — 人格数据（Identity/Soul）和 Hot 记忆（MEMORY.md）纯文件存储，人可读、可编辑、Git 友好

### 📊 缓存命中率统计

- 后端 SessionConversation 中以原子计数器累计 cache hit / miss tokens，会话级全局累计命中率展示
- 每个 usage 事件携带 `usageSource`（executor / planner / subagent / compaction），为后续分拆统计预留

## 🏗️ Architecture

```
Renderer (React 19)  ←→  Preload (contextBridge)  ←→  Main Process  ←→  Native Worker (.NET 10)
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

- **分层严格分离** — 各层通过 Contracts 接口交互，依赖方向严格自上而下
- **Agent Runtime 和 Workspace 严格分离** — Agent 不直接操作记忆，通过工具调用读写
- **Infrastructure 下沉** — Db/Storage/Http 等通用能力下沉到独立层，Worker 保持薄层
- **记忆必须被用上** — 不靠 System Prompt 全量塞入，Agent 通过工具主动检索读取和实时写入
- **人格在输出时体现** — 不介入 Agent Loop 决策，只在最终输出给用户时加工

## 🛠️ Quick Start

**前置条件：** Node.js ≥ 18, npm ≥ 9, .NET SDK 10

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

> **数据目录：** `~/.wishful-claw/` — SQLite 数据库 + 全局记忆/人格文件

## 💻 Tech Stack

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Zustand + Tailwind CSS |
| 桌面壳 | Electron 35 + electron-vite |
| 后端 | .NET 10 (C#) + Native AOT |
| 通信 | MessagePack (IPC) |
| 数据库 | SQLite (Microsoft.Data.Sqlite) |
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

## 📈 Development Progress

### MVP v1（已完成，v0.1.0 ~ v0.15.0）

核心链路全部完成：Agent Loop + 工具链 + 记忆系统 + 人格系统 + 子 Agent + Skill 市场 + SSH 远程执行 + 终端面板 + 右侧面板 + 渠道系统。

### MVP v2 — 架构重构与功能增强（进行中，v0.2.1 ~ v0.2.16）

| 阶段 | 内容 |
|------|------|
| 架构重构 | 7 层分层架构（Contracts → Core → Infrastructure → Workspace → Persona → Agent → Worker），Worker 瘦身至薄层 |
| AOT 编译 | SqlSugar → Microsoft.Data.Sqlite 迁移，全链路反射消除，Native AOT 打包 |
| Goal 模式 | GoalOrchestrator 编排层 + plan→execute→verify 状态机 + 自检评估 + 可中断 + 前端进度面板 |
| 计划模式 | explore→plan→confirm→execute→verify 人机协同执行引擎 + 计划文件落盘 + SubmitPlanReview |
| Provider | Anthropic / OpenAI Chat / OpenAI Responses / Gemini / Vertex AI |
| 渠道系统 | 飞书/微信扫码绑定 + auto-reply hook + 全局渠道设置 |
| SSH 远程 | Agent SSH 长连接远程执行 + 终端面板实时旁观 |
| 体验优化 | 快捷键系统 + 快速启动器 + 剪贴板增强 + 开机启动 + 历史消息反向分页 + 左侧面板搜索 |

## 📜 License

本项目采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源，Copyright 2026 **Wishful 心相团队**。

本项目是 [OpenCowork](https://github.com/AIDotNet/OpenCowork)（Copyright 2026 AIDotNet，Apache 2.0）的衍生作品：Agent Loop、工具链、Provider、流式协议与 Worker 运行时等大量代码源自 OpenCowork，经迁移、拆分、适配与重构后纳入 WishfulClaw 架构。OpenCowork 的原始版权声明已在迁移文件头保留，完整第三方归属声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

---

<div align="center">

自用项目，慢慢打磨。

</div>
