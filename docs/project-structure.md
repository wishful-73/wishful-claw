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
├── scripts/                              # 构建 / 打包 / 部署 / 校验脚本（deploy.mjs 不入库，见发布文档）
├── site/                                 # 站点侧，与桌面端产品代码分开
│   ├── website/                          #   官网（React + Vite，独立构建与发布）
│   └── feedback/                         #   用户反馈服务（独立 Node 应用 + 自有 SQLite）
├── tests/                                # 各专题的独立回归（node 直跑，不进 vitest）
└── README.md
```

## 7 层（`src/runtime/`）

```
src/runtime/
├── WishfulClaw.sln
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
│   ├── Compression/                      #   上下文压缩（摘要生成 / 裁剪策略 / 触发判定）
│   ├── Desktop/                          #   桌面与沙箱（窗口定位 / 提权申请）
│   ├── Executors/                        #   工具运行器簇，一个工具一个 AgentRuntime* 类
│   ├── Goal/                             #   Goal 模式（Orchestrator 状态机 / Plan 跟踪 / 进度工具）
│   ├── Images/                           #   图像输入（贴图校验 / 视觉记忆）
│   ├── Llm/                              #   模型调用层（Provider 实现 / 请求编码 / 提示缓存）
│   ├── Models/                           #   本层数据模型（会话 / 工具 / 流式事件 / 模块端点）
│   ├── Modules/                          #   业务模块（Git / Skills / Extensions / Channels / Video / Media / OpenAIAudio）
│   ├── Protocol/                         #   Agent 侧线路协议（流式分包 / 会话编解码 / 边界 / UA / 请求体裁剪）
│   ├── Results/                          #   结果类型（AOT 友好的 Agent / 全局任务 / 项目结果）
│   ├── Sessions/                         #   会话状态（多会话管理 / 生命周期）
│   ├── Spill/                            #   大内容落盘（SpillStore）
│   ├── SubAgents/                        #   子代理（注册表 / 运行器 / 后台调度）
│   └── Tools/                            #   工具实现（AgentChanges / FileTools / MemoryTools / Providers / SearchTools / ShellTools）
└── WishfulClaw.Worker/                   # 7. 进程入口（薄层 IPC 宿主）
    └── Modules/                          #   薄端点（Config / Memory + Entries / Goal / Provider / System）
```

**`WishfulClaw.Agent/` 根目录**只剩三簇：Agent Loop（`AgentLoop` 的多个 partial + 结束原因 + 会话编解码）、工具调用与分派（`ToolCallProcessor` 的多个 partial + 超时 / 路由 / 配对 / 可见性），外加两个与这两簇同生命周期的单文件（运行上下文策略 / 记忆写入队列）。同属一个 partial class 的文件不往子目录里拆 —— 它们挨在一起本身就是结构信息；模型 Provider 已不在根目录，见 `Llm/`。

> ⚠️ 别混：`Agent/Tools/Providers/` 是**工具**提供者（AskUser / Browser / Cron / Desktop…），与模型 Provider 不是一回事。CodeGraph 已剥离为独立仓库的 MCP 插件（S-303），不在这个目录里。

## 自己查实际结构

```powershell
# 某层有哪些文件
Get-ChildItem src/runtime/WishfulClaw.<层> -Recurse -Filter *.cs |
  Where-Object { $_.FullName -notmatch '\\obj\\' }

# 某层有哪些子目录
Get-ChildItem src/runtime/WishfulClaw.<层> -Directory |
  Where-Object { $_.Name -notin 'bin','obj','tmp' }
```