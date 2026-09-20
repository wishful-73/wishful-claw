# 项目结构

> 本文是**目录地图**，回答「东西在哪」；回答「什么能依赖什么」的是 [AGENTS.md「分层约定」](../AGENTS.md)。
>
> **只写到「层 → 子目录 → 一句话职责」这一级**，不列文件名、不列文件数 —— 那些每加一次需求就会变，写死必然过期。
> 旧版本烂掉的原因就是这个：它停在 4 层架构时代，7 层里只写了 4 层，而读它的人不需要改它、改代码的人不读它。

## 顶层

```
wishful-claw/
├── package.json                          # Electron + 前端工程根
├── electron.vite.config.ts
├── src/
│   ├── main/                             # Electron Main 进程（TS）
│   ├── renderer/                         # React 前端（TS）
│   ├── preload/                          # Preload（TS）
│   ├── shared/                           # 前后端共享类型（TS）
│   └── runtime/                          # .NET 后端工程
├── docs/
├── scripts/
└── README.md
```

## 7 层（`src/runtime/`）

```
src/runtime/
├── WishfulClaw.sln
├── WishfulClaw.CodeGraph/                # 0. CodeGraph 引擎（vendored 自 github.com/AIDotNet/CodeGraph；
│                                         #    不参与 7 层依赖链，仅被 Worker 引用）
├── WishfulClaw.Contracts/                # 1. 接口契约（纯接口，无实现）
├── WishfulClaw.Core/                     # 2. Agent 通用框架（不含业务逻辑）
│   ├── Protocol/                         #   通信协议（MessagePack 编解码、流式事件、Worker 分发）
│   └── Tools/                            #   工具框架（IToolExecutor / IToolProvider / ToolRegistry）
├── WishfulClaw.Infrastructure/           # 3. 基础设施
│   ├── Db/                               #   SQLite 持久化（DbClient / Entities / Db*Tools）
│   ├── Storage/                          #   JSON 配置读写（ConfigStore / ProviderStore / JsonFileNodeCache）
│   └── Http/                             #   HTTP 客户端工厂（WorkerHttpClientFactory）
├── WishfulClaw.Workspace/                # 4. 记忆系统（业务层）
│   └── Memory/                           #   记忆读写 / 检索 / 分层流转 / 巩固 / 语义降级 / FTS5
├── WishfulClaw.Persona/                  # 5. 人格系统（PromptBuilder / 人格生成与持久化 / 预设管理）
│   └── Resources/Personas/               #   预置人格文档（每个子目录一套）
├── WishfulClaw.Agent/                    # 6. Agent 运行时（核心业务逻辑）
│   ├── Goal/                             #   Goal 模式（Orchestrator 状态机 / Plan 跟踪 / 进度工具）
│   ├── Models/                           #   本层数据模型（会话 / 工具 / 流式事件 / 模块端点）
│   ├── Spill/                            #   大内容落盘（SpillStore）
│   ├── Modules/                          #   业务模块（Git / Skills / Extensions / Channels / Video / Media / OpenAIAudio）
│   └── Tools/                            #   工具实现（AgentChanges / FileTools / MemoryTools / Providers / SearchTools / ShellTools）
└── WishfulClaw.Worker/                   # 7. 进程入口（薄层 IPC 宿主）
    └── Modules/                          #   模块注册与实现（Config / Memory / Goal / Provider / System / AgentChanges）
```

**`WishfulClaw.Agent/` 根目录**（不属于上面任何子目录的那些）平铺着：Agent Loop（partial 拆分）、上下文压缩、工具调用与分派、子 Agent、会话状态，以及**模型 Provider 实现**（Anthropic Messages / OpenAI Chat / OpenAI Responses）。

> ⚠️ 别混：`Agent/Tools/Providers/` 是**工具**提供者（AskUser / Browser / Cron / CodeGraph…），与模型 Provider 不是一回事。

## 自己查实际结构

```powershell
# 某层有哪些文件
Get-ChildItem src/runtime/WishfulClaw.<层> -Recurse -Filter *.cs |
  Where-Object { $_.FullName -notmatch '\\obj\\' }

# 某层有哪些子目录
Get-ChildItem src/runtime/WishfulClaw.<层> -Directory |
  Where-Object { $_.Name -notin 'bin','obj','tmp' }
```
