# Wishful Claw 迭代计划

基于 MVP 边界，拆分为多个迭代，每个迭代独立可验证。

## 迭代拆分规则

**迭代是版本里程碑，不是单次会话的工作量。** 每个迭代在执行前，必须先拆分为多个 Plan，每个 Plan 是一次会话能吃透的工作单元。不要在一个会话里试图做完整个迭代。

```
迭代（v0.N.0）  — 版本里程碑，定义目标 + 验证标准
  └─ Plan      — 单次会话工作单元，一次会话走完探索→规划→执行→验证
       └─ 步骤  — Plan 内的具体操作，每步 commit + push
```

**Plan 拆分原则**：
- 每个 Plan 有独立的验证检查点（能独立编译/运行/测试）
- 每个 Plan 是一次会话能完成的量（不要贪多）
- Plan 之间有明确的依赖顺序
- 拆分在迭代开始时做，写入 `docs/plans/iter-{N}/plan-{M}.md`

执行迭代时，先在 `docs/plans/iter-{N}/` 下创建 Plan 文件，自行拆分后再逐个执行。

## 迭代完结规则

**迭代是否完结由用户确认，Agent 不得自行判定。**

当迭代内所有 Plan 都完成后，Agent 输出迭代总结（做了什么、验证结果、遗留问题），然后**停下来等用户确认**。

**用户确认完结后，Agent 执行收尾**（详见 `AGENTS.md` 迭代完结收尾小节）。`v2-iter-{N}` 只是迭代编号；正式版发布前，产品版本为 `0.2.{N}`，tag 为 `v0.2.{N}`：
```bash
# 0. 更新 package.json 版本为 0.2.{N}，同步 README 版本徽章

# 1. 合并到 main
git checkout main
git merge dev/v2-iter-{N} --no-ff -m "merge: v2-iter-{N} - {迭代名称}"

# 2. 打 tag
git tag -a v0.2.{N} -m "v2-iter-{N}: {迭代名称} - 验证通过"

# 3. 推送远程（需要代理）
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin main
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin v0.2.{N}

# 4. 删除本地迭代分支
git branch -d dev/v2-iter-{N}

# 5. 删除远程迭代分支（如果之前 push 过）
git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin --delete dev/v2-iter-{N}
```

收尾完成后更新 `docs/PROGRESS.md`（状态 + VERDICT + Commit ID + Tag + 日期）。

**关键要求**：收尾完成后，当前会话结束。下个会话直接从 main 拉取最新代码开始新迭代，不需要关心旧分支。

**用户确认未完结**：根据用户反馈继续补充，开启新的 Plan

---

## 已完成迭代（一~八）

### 迭代一：项目骨架

**目标**：Electron + .NET 工程跑起来，前后端能通信。

| 步骤 | 内容 |
|------|------|
| 1 | 搭建 Electron + React 前端工程（参考 OpenCowork 的 package.json / electron.vite.config.ts） |
| 2 | 搭建 .NET 解决方案（WishfulClaw.sln + 4 个项目：Core / Workspace / Worker / Contracts） |
| 3 | 实现 Worker 进程入口（Program.cs），能启动并监听 IPC |
| 4 | 实现 MessagePack 通信协议（从 OpenCowork 搬 Protocol 模块） |
| 5 | Electron Main 进程能拉起 Worker，建立 IPC 通道 |
| 6 | 前端能发一条消息到 Worker，Worker 能回一条 |

**验证标准**：前端发 "ping"，后端回 "pong"，MessagePack 编解码正常。

---

### 迭代二：AI 服务商 + 模型管理

**目标**：能配置 Provider，选择模型，为后续对话做准备。

| 步骤 | 内容 |
|------|------|
| 1 | 从 OpenCowork 搬入 Provider 配置框架（API Key 管理、Base URL、模型列表、配置字段等，直接用） |
| 2 | 清理 routin.ai 相关私货（预设端点、模型预设、token 中转硬编码），其余全部保留 |
| 3 | 实现模型配置存储（Provider 列表、模型列表、默认模型，存 SQLite） |
| 4 | 前端 Provider 设置页面（直接用 OpenCowork 的，只删 routin.ai 相关内容） |
| 5 | 实现模型连通性测试（配置后能验证 API 是否可用） |

**验证标准**：添加一个 OpenAI 兼容 Provider → 填 API Key 和 Base URL → 测试连通性通过 → 能看到可用模型列表。

---

### 迭代三：Agent Loop + 对话

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

---

### 迭代四：工具链（最小集）

**目标**：Agent 能调工具操作文件和执行命令。

| 步骤 | 内容 |
|------|------|
| 1 | 从 OpenCowork 搬入工具框架（ITool 基类、注册机制、Executor 模式） |
| 2 | 从 OpenCowork 搬入文件读写工具（FsRead / FsWrite / FsEdit） |
| 3 | 从 OpenCowork 搬入 Shell 执行工具（ShellRun / ShellKill） |
| 4 | 从 OpenCowork 搬入代码搜索工具（Grep / Glob） |
| 5 | 工具结果回传 Agent Loop，喂回模型继续循环 |
| 6 | 前端工具调用展示（从 OpenCowork 搬工具调用 UI） |

**验证标准**：让 Agent "读取某文件内容并总结"，Agent 能调 FsRead 拿到内容并回复。

---

### 迭代五：项目注册 + 会话历史

**目标**：能管理项目，对话有历史记录。

| 步骤 | 内容 |
|------|------|
| 1 | SQLite 扩表（projects / sessions / messages） |
| 2 | 实现项目注册（创建项目、指定工作区路径、切换项目） |
| 3 | 实现会话管理（创建会话、按项目关联、会话列表） |
| 4 | 实现消息持久化（对话实时写 SQLite，重开后能看历史） |
| 5 | 前端项目管理页面 + 会话列表（从 OpenCowork 搬并精简） |

**验证标准**：创建项目 → 开始对话 → 关闭应用 → 重开 → 能看到项目和历史对话。

---

### 迭代六：人格系统

**目标**：不同人格，输出风格不同。

| 步骤 | 内容 |
|------|------|
| 1 | 实现 Identity / Soul 文件读写（全局 + 项目级） |
| 2 | 实现 PersonaPreset 预设管理（内置 6 种 + 自定义） |
| 3 | 实现 PromptBuilder（分段组装 System Prompt + 字符预算） |
| 4 | System Prompt 构建从前端移到后端（runtime 侧组装） |
| 5 | 实现人格在最终输出时体现（输出层加工，不介入 Loop 决策） |
| 6 | 前端人格切换面板（选择/预览/自定义人格） |

**验证标准**：切换"极简执行者"和"深度分析师"两种人格，同一个问题得到风格明显不同的回答。

> **执行记录**：迭代六实际做了人格系统（原计划为记忆系统，执行顺序与迭代七对调）。8 个 Plan 全部完成。PromptBuilder 分段组装 System Prompt + 字符预算截断 + InjectSystemPrompt。Base Instruction 在迭代八中改为运行环境介绍而非身份定义。

---

### 迭代七：记忆系统

**目标**：记忆用上了，不是黑箱。

| 步骤 | 内容 |
|------|------|
| 1 | 实现工作区文件结构（~/.wishful-claw/ 全局 + .wishful-claw/ 项目级） |
| 2 | 实现 FTS5 搜索索引（记忆文件变更时同步更新索引） |
| 3 | 实现记忆主动回忆（TryInjectRecall：Loop 开始前自动检索注入） |
| 4 | 实现记忆工具（memory_read / memory_write / memory_search） |
| 5 | 实现记忆分层流转（sessions → topics → dormant → archive） |
| 6 | 实现记忆巩固 + HEARTBEAT 语义降级 |
| 7 | 前端记忆面板（可视化记忆文件、状态、搜索） |

**验证标准**：对话中告诉 Agent "记住我是前端工程师" → 关闭重开 → 新对话中 Agent 知道你是前端工程师（通过主动回忆注入，不是用户重新说）。

> **执行记录**：迭代七实际做了记忆系统（与迭代六对调）。8 个 Plan 全部完成。三层架构 Hot/Warm/Cold + FTS5。scope 隔离设计（global / project:{workingFolder}）。TryInjectRecall 注入为 User Message，标注 untrusted reference data。

---

### 迭代八：集成验证

**目标**：整体跑通，日常可用。

| 步骤 | 内容 |
|------|------|
| 1 | 全链路联调（项目 → 对话 → 工具 → 记忆 → 人格） |
| 2 | 错误处理和边界情况（网络断开、Provider 超时、文件不存在等） |
| 3 | 性能优化（大文件读取、长对话压缩、FTS 索引更新频率） |
| 4 | OpenCowork 前端减法（砍掉所有不需要的页面和组件） |
| 5 | 打包测试（electron-builder 打包 Windows 可执行文件） |

**验证标准**：日常使用一周，记忆持续有效，人格稳定，工具正常，无崩溃。

> **执行记录**：记忆系统全链路修复（FTS5外部内容表、触发器语法、参数绑定）、Worker进程防崩溃、日志等级控制、记忆工具预览UI、消息时间戳、历史消息加载修复、Agent Loop迭代限制去除、Base Instruction人格冲突修复。代码已合并到 main，旧开发分支已清理。打包测试未执行。

---

## 后续迭代（九~十五）

### 迭代九：输入框修复 + 提示词优化器 ✅ 已完成

**目标**：修复输入框底部 token 统计全为 0 的问题；实现提示词优化器功能。

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 提示词优化器实现 — 从 OpenCowork 移植 `optimizer.ts`，复用已有 `streamSidecarProviderTurn` + `usePromptOptimizer` hook | ✅ 完成 |
| 2 | Token 统计修复 — 前端 usage 数据链路排查修复 | ✅ 完成 |
| 3 | AGENTS.md 路径修正 — 参考项目路径从 `D:\gy\*` 更新为 `D:\claw\*` | ✅ 完成 |

> 执行记录：在 dev/iter-11 分支上完成，尚未合并 main。

---

### 迭代十：子 Agent（Sub-Agent）✅ 已完成

**目标**：实现子 Agent 的创建、执行、事件流和前端渲染。

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 后端子 Agent 生命周期管理 — `SubAgentExecutor.cs`，独立 runId，子 `AgentRuntimeRunState` | ✅ 完成 |
| 2 | Task 工具实现 — `TaskTool.cs` 定义 + `ToolCallProcessor` 拦截 → `SubAgentExecutor.ExecuteAsync` | ✅ 完成 |
| 3 | 子 Agent 事件流 — `sub_agent_start` / `sub_agent_end` 事件，`StreamEventModels` 扩展字段 | ✅ 完成 |
| 4 | 前端事件适配和渲染 — `handleEnvelope` 路由 `sub_agent_*` → `handleSubAgentEvent`，`SubAgentCard` 已有 | ✅ 完成 |
| 5 | 子 Agent 取消机制 — 父 CancellationToken → 子 state.Cancel | ✅ 完成 |
| 6 | 子 Agent 定义加载 — `~/.wishful-claw/agents/*.md` YAML frontmatter | ✅ 完成 |
| 7 | 深度限制 — max 2 层嵌套 | ✅ 完成 |
| 8 | 事件抑制机制 — `SuppressTransportEvents` + `EventObserver` 收集子 loop 文本 | ✅ 完成 |
| 9 | 示例定义 — reviewer.md, researcher.md | ✅ 完成 |
| 10 | 集成验证 — 实际对话测试 Task 工具触发子 Agent | ✅ 完成 |

> 执行记录：在 dev/iter-11 分支上完成。子 Agent 架构在迭代十一中做了五阶段深度增强（事件转发、上下文保持、步骤描述、审批交互、系统提示词引导）。

---

### 迭代十一：右侧面板 + 子 Agent 架构增强 + 终端/文件管理 ✅ 已完成（待合并 main）

**目标**：右侧面板动态 Tab 系统、子 Agent 架构五阶段增强、终端面板与文件管理快捷入口。

| Plan | 内容 | 状态 |
|------|------|------|
| 11-1 | 右侧面板 Tab 系统重构 — 动态 tab、拖拽调宽、tab 切换动画、浏览器持久化 | ✅ 完成 |
| 11-2 | SubAgentsPanel — 子 Agent 执行面板（列表 + 详情） | ✅ 完成 |
| 11-3 | BrowserPanel — 内置浏览器（webview + 地址栏导航） | ✅ 完成 |
| 11-4 | PreviewPanel — 文件预览面板（代码/Markdown/图片等多格式） | ✅ 完成 |
| 11-5 | AgentFilesPanel + SessionChangeReviewPanel — 文件目录 + 变更审查 | ✅ 完成 |
| 11-6 | 子 Agent 架构五阶段增强 — 事件转发、上下文保持、步骤描述、审批交互、系统提示词引导 | ✅ 完成 |
| 11-7 | 终端面板 — xterm.js 终端 + TitleBar 文件管理/终端快捷入口 | ✅ 完成 |
| 11-8 | 删除右侧面板默认 Activity/Memory tab | ✅ 完成 |

**遗留事项**：
- agent:changes 后端记录仍为 stub（变更审查面板无数据）
- 30+ 文件超 500 行需按 AGENTS.md 拆分
- Git push 需代理启动
- 迭代验证 + 合并 main 需用户确认

**验证标准**：tsc --noEmit + electron-vite build + dotnet build 全部通过。UI 交互待用户手动确认。

---

### 迭代十二：SSH 远程执行 + Agent 终端旁观

**目标**：Agent 能通过 SSH 连接到远程服务器执行命令，连接配置持久化复用，执行过程实时输出到终端面板供用户旁观。

**核心需求**：
- 用户配置一次 SSH 连接（host/user/密钥/密码），后续 Agent 自动复用，不需要重复认证
- Agent 调用 Bash 工具带 `sshConnectionId` 时，走 SSH 通道在远程服务器上执行
- 执行返回结构化结果（stdout/stderr/exitCode）给 Agent
- 执行过程实时推送到终端面板，用户可以旁观 Agent 的操作过程

#### 架构设计

```
Agent 调用 Bash(sshConnectionId=xxx, command="df -h")
    ↓
Worker: 判断有 sshConnectionId → 走远程执行
    ↓
Main: ssh:exec IPC → connection-manager 取长连接
    ↓
ssh2.Client.exec("df -h") → 拿到 stream
    ↓
stream.on('data') ──→ 拼接 stdout（结构化返回给 Agent）
                  └─→ IPC 推到前端终端面板（实时旁观）
    ↓
stream.on('close') ──→ { stdout, stderr, exitCode } 返回
```

#### Plan 拆分

**Plan 12-1：SSH 连接管理基础设施**

**目标**：建立 SSH 连接的存储、认证和连接池管理。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 安装 `ssh2` + `@types/ssh2` npm 依赖 | `package.json` |
| 2 | DB 建表 — `ssh_connections` 表（host/port/user/authType/加密密码/密钥路径等） | `DbClient.cs` 或手动建表 |
| 3 | Worker SSH DB CRUD — 搬入 `DbSshModels.cs` + `DbSshTools.cs`，适配 SqlSugar | `Modules/Db/DbSshTools.cs` |
| 4 | Main 进程 SSH 连接管理 — 从 OpenCowork 搬入 `connection-manager.ts`（精简版，去掉终端/sftp/传输），保留 `withSshConnection()` + `execSshCommand()` | `src/main/ssh/connection-manager.ts` |
| 5 | Main 进程 SSH 认证 — 从 OpenCowork 搬入 `auth.ts`（精简版，去掉 proxy jump），保留 `buildConnectConfig()` | `src/main/ssh/auth.ts` |
| 6 | Main 进程 SSH IPC 注册 — 注册 `ssh:connection:list/create/update/delete` + `ssh:exec` + `ssh:connect` + `ssh:disconnect` | `src/main/ipc/ssh-handlers.ts` |
| 7 | Main 进程 SSH DAO — 从 OpenCowork 搬入 `ssh-dao.ts`（通过 Worker DB 读写） | `src/main/db/ssh-dao.ts` |
| 8 | 移除 `ssh:connection:list` stub handler | `src/main/index.ts` |

**验证**：tsc + dotnet build 通过。能通过 IPC 创建 SSH 连接记录、建立 ssh2 连接、执行远程命令拿到 stdout。

---

**Plan 12-2：Agent SSH 工具执行器**

**目标**：Agent 调用 Bash/Read/Write 等工具时，如果带有 `sshConnectionId`，自动走 SSH 通道远程执行。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | Worker SSH 工具执行器 — 从 OpenCowork 搬入 `AgentRuntimeSshToolExecutor.cs`（精简版），实现 `CanExecute()` + `ExecuteAsync()` | `AgentRuntime/AgentRuntimeSshToolExecutor.cs` |
| 2 | Worker SSH 协议桥接 — Main 进程收到 Worker 的 SSH 执行请求，转发到 `execSshCommand()` | `src/main/ipc/ssh-handlers.ts` |
| 3 | ToolCallProcessor 集成 — 工具调用时检测 `sshConnectionId` 参数，路由到 SSH 执行器 | `AgentRuntime/ToolCallProcessor.cs` |
| 4 | 系统提示词引导 — 告知 Agent 项目绑定了 SSH 连接，可用 `sshConnectionId` 参数远程执行 | `Persona/PromptBuilder.cs` |
| 5 | 项目 SSH 绑定 — 项目可关联一个 SSH 连接 ID（已有 `sshConnectionId` 字段），Agent 自动使用 | `DbProjectTools.cs` |

**验证**：配置 SSH 连接 → 项目绑定 → 对 Agent 说"查看服务器 CPU"→ Agent 通过 Bash 工具走 SSH 远程执行 `top` 等命令 → 返回结构化结果。

---

**Plan 12-3：Agent 终端旁观模式**

**目标**：Agent 通过 SSH 执行命令时，执行过程实时输出到终端面板，用户可以旁观。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | execSshCommand 增加实时输出回调 — `stream.on('data')` 时同时推送到 IPC 事件 | `src/main/ssh/connection-manager.ts` 或 `sftp-service.ts` |
| 2 | IPC 事件 `ssh:exec-output` — 推送实时输出 chunk 到前端 | `src/renderer/src/lib/ipc/channels.ts` |
| 3 | TerminalPanel 增加 Agent 旁观 tab — 只读 xterm，显示 Agent 执行的命令 + 实时输出 | `src/renderer/src/components/terminal/TerminalPanel.tsx` |
| 4 | 命令执行开始/结束标记 — 在终端中显示 `~$ df -h` 命令行，执行完显示退出码 | 同上 |
| 5 | 自动切换到 Agent tab — Agent 开始远程执行时，终端面板自动切换到 Agent 旁观 tab | `TerminalPanel.tsx` + `ui-store` |

**验证**：Agent 通过 SSH 执行命令时，终端面板自动出现 Agent tab，实时显示命令和输出，命令结束后输出停在屏幕上可回看。Agent 同时拿到结构化 stdout/stderr/exitCode。

---

**Plan 12-4：SSH 连接管理 UI**

**目标**：前端提供 SSH 连接的增删改查界面，用户可配置和管理 SSH 连接。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | SSH 连接管理面板 — 从 OpenCowork 搬入 `SshConnectionList` + `SshConnectionCard` + `SshConnectionDetail`（精简） | `components/ssh/` |
| 2 | SSH 连接创建/编辑表单 — host/port/user/authType/password/privateKey | `components/ssh/SshConnectionDialog.tsx` |
| 3 | 项目设置中绑定 SSH 连接 — 项目设置页面可选择已配置的 SSH 连接 | `components/settings/` |
| 4 | 密码加密存储 — 使用 Electron `safeStorage` 加密密码/密钥短语 | `src/main/ssh/repository.ts` |
| 5 | 连接测试 — 配置后可测试 SSH 连接是否可用 | `src/main/ssh/auth.ts` |

**验证**：在设置页面添加 SSH 连接 → 测试连通性 → 项目绑定该连接 → Agent 对话中自动使用该连接远程执行命令。

#### 技术要点

- **长连接复用**：`connection-manager.ts` 维护 `Map<connectionId, ssh2.Client>` 连接池，keepalive 保活，断线自动重连
- **结构化返回**：`client.exec()` 非交互式执行，等 `close` 事件拿 stdout/stderr/exitCode，与交互式 PTY 终端完全不同
- **实时旁观**：`stream.on('data')` 的 chunk 同时推送到前端终端面板（只读 xterm），不影响结构化收集
- **密码安全**：密码/密钥短语用 Electron `safeStorage` 加密后存 DB，明文不出 main 进程
- **精简范围**：不搬 SFTP 文件传输、SSH 终端（SshTerminal）、端口转发、proxy jump、OpenSSH config 导入，只做 exec 执行
- **参考来源**：OpenCowork `src/main/ssh/`（connection-manager/auth/repository/sftp-service）+ `AgentRuntimeSshToolExecutor.cs`

---

### 迭代十三：聊天窗渲染调整（参考灵犀）

**目标**：优化聊天交互的视觉和交互体验，参考灵犀的聊天窗设计。

| 步骤 | 内容 |
|------|------|
| 1 | 工具调用卡片的折叠/展开交互优化 |
| 2 | Thinking block 展示优化（折叠默认、可展开） |
| 3 | 消息间距和视觉层次调整 |
| 4 | Agent Loop 多轮迭代的展示方式调整（当前平铺在一条消息内，评估是否调整为分段展示） |

**验证标准**：聊天界面交互流畅，工具调用和思考过程可折叠/展开，多轮迭代清晰可辨。

---

### 迭代十四：Skill 市场

**目标**：实现 Skill 的安装/卸载/列表管理和在线市场。

| 步骤 | 内容 |
|------|------|
| 1 | SKILL.md 解析和工具注册 — 读取 Skill 目录下的 SKILL.md，解析工具定义并注册到 ToolRegistry |
| 2 | Skill 安装/卸载/列表管理 — 复用已有 `SkillsMenu` 组件和 `skills-store` |
| 3 | 在线 Skill 市场浏览和安装 — 对接 Skill 仓库 API，浏览/搜索/安装 |

**验证标准**：从 Skill 市场安装一个 Skill → Agent 对话中能使用该 Skill 提供的工具 → 卸载后工具不可用。

---

### 迭代十五：MCP 管理

**目标**：实现 MCP Server 的配置管理和工具调用。

| 步骤 | 内容 |
|------|------|
| 1 | MCP Server 配置管理 — 复用已有 `mcp-store`，实现增删改查 |
| 2 | MCP 工具动态注册和调用 — MCP Server 启动后自动发现工具并注册 |
| 3 | MCP 状态监控 — 连接状态、工具列表、调用日志 |

**验证标准**：配置一个 MCP Server → 启动后自动发现其工具 → Agent 对话中能调用 MCP 工具 → 停止后工具不可用。

---

## MVP v2 阶段迭代（v2-iter-1 ~ v2-iter-9）

> MVP v1（迭代一~十五）已全部合并 main。以下为 MVP v2 阶段的迭代拆分，分支命名 `dev/v2-iter-{N}`；`v2-iter-{N}` 仅是迭代编号。正式版发布前，产品版本命名 `0.2.{N}`，tag 命名 `v0.2.{N}`。历史上已存在的旧式 tag 保留，不再用于后续迭代。详细需求见 `docs/mvp-v2.md`。

### v2-iter-1：Runtime 分层架构重构

**目标**：Worker 项目从 192 文件/29k 行的巨型项目拆分为 `WishfulClaw.Agent` + `WishfulClaw.Persona`，Worker 回归薄层 IPC 宿主。为后续所有功能开发打基础。

| 步骤 | 内容 |
|------|------|
| 1 | 创建 `WishfulClaw.Agent` 项目，将 AgentRuntime（60 文件）迁入：AgentLoop、所有 Executor、Provider、ConversationCodec、ContextCompression、ToolCallProcessor、SubAgent |
| 2 | 创建 `WishfulClaw.Persona` 项目，将 Persona（9 文件）迁入：PromptBuilder、PersonaGenerator、PersonaStore |
| 3 | Core 上提：ToolSchemaBuilder、ToolDefinitionPlaceholder、ToolModuleState 从 Worker 移到 Core |
| 4 | Worker 精简：仅保留 IPC 宿主 + Module 装载 + Program.cs |
| 5 | Contracts 精简：只留接口，JSON 序列化实现移到 Core 或 Worker |
| 6 | 更新 sln 引用关系，确保分层依赖正确（Agent → Core + Contracts；Persona → Core + Contracts；Worker → Agent + Persona + Core + Contracts） |
| 7 | 双编译验证：`dotnet build` + `npx tsc --noEmit -p tsconfig.web.json` 零错误 |

**验证标准**：编译通过，应用启动正常，核心对话 + 工具调用 + 记忆 + 人格全链路功能不回归。

**分支**：`dev/v2-iter-1`　**Tag**：`v2.1.0`　**状态**：✅ 已完成

---

### v2-iter-2：缓存命中率修复

**目标**：C# 端维护 conversation 状态，每轮只接收增量消息，消除全量重建导致的 prefix cache miss。同一会话缓存命中率稳定在 90%+。

| 步骤 | 内容 |
|------|------|
| 1 | C# 端 conversation 状态管理 — `AgentLoop.cs` 的 `ReadWireConversation` → `ReadConversation` 改为增量追加模式 |
| 2 | 渲染端 `use-chat-actions.ts` 改为只发送增量消息（新增的 user message + tool results），不再全量重建 history |
| 3 | `buildRuntimeReminder` 稳定化 — 动态内容注入到 user 消息前缀，确保不破坏前缀缓存 |
| 4 | `InjectTimestampPrefix` 调整 — 时间戳精度降低或移到不影响缓存的位置 |
| 5 | `cache_control` 断点优化 — 评估是否移除显式断点，依赖 Anthropic 自动前缀缓存 |
| 6 | 边界处理：session 切换时重置 conversation 状态、context compression 时重建前缀 |
| 7 | 缓存命中率指标验证 — 连续多轮对话观察 cache_read/cache_creation 比例 |

**验证标准**：同一会话连续 5 轮对话，缓存命中率稳定在 90%+，不再因全量重建导致跳动。

**分支**：`dev/v2-iter-2`　**Tag**：`v2.2.0`　**状态**：✅ 已完成

> 执行记录：12 步骤全部完成。SessionConversation per-session 状态管理、增量消息发送、prefix cache 断点优化（messages[last] 而非 tools[last]）、时间戳分钟级精度。额外完成：LLM 总结式上下文压缩（参考 Reasonix compact.go，7 段式结构化 briefing + PlanCompaction 分区折叠 + 90s 超时重试）、工具注册发现与注入体系参考 Reasonix ToolRegistry/InjectionStrategy 设计思路、压缩设置 UI（Switch + Slider 30%-90%）、版本号单一来源（app-version.ts 从 package.json 读取）、全局 OpenCowork → WishfulClaw 名称替换（56 前端文件 87 处 + 49 C# 文件 55 处）。5 个 commit 在 dev/v2-iter-2 分支。

---

### v2-iter-3：Infrastructure 层拆分

**目标**：新建 `WishfulClaw.Infrastructure` 项目，将 Db/Storage/Http 基础设施从 Worker 和 Agent 下沉，使 Worker 能进一步拆分 Tools 等模块。Worker 文件数从 113 降至 ~30。

| 步骤 | 内容 |
|------|------|
| 1 | 创建 `WishfulClaw.Infrastructure` 项目，配置 csproj 引用 Contracts + Core |
| 2 | 搬入 Db — `DbClient.cs` + `Entities/` 从 Worker/Modules/Db 迁入 Infrastructure/Db |
| 3 | 搬入 Storage — `ConfigStore.cs` + `ProviderStore.cs` + `JsonFileNodeCache.cs` 从 Worker 迁入 Infrastructure/Storage |
| 4 | 搬入 Http — `WorkerHttpClientFactory.cs` 从 Agent 迁入 Infrastructure/Http |
| 5 | 更新引用关系 — Agent 引用 Infrastructure；Worker 引用 Infrastructure；Worker 中的 Db Module 改为调用 Infrastructure |
| 6 | Worker 模块瘦身 — 将 FileTools / SearchTools / ShellTools / Providers 等工具实现迁出 Worker（迁入 Agent 或独立项目） |
| 7 | 更新 sln 引用关系，确保分层依赖正确（Contracts → Core → Infrastructure → Workspace → Persona → Agent → Worker） |
| 8 | 双编译验证：`dotnet build` + `npx tsc --noEmit -p tsconfig.web.json` 零错误 |
| 9 | 功能回归验证 — 核心对话 + 工具调用 + 记忆 + 人格 + DB 读写全链路不回归 |

**验证标准**：编译通过，应用启动正常，全链路功能不回归。Worker 文件数降至 ~30。Infrastructure 层独立可引用。

**分支**：`dev/v2-iter-3`　**Tag**：`v2.3.0`

---

### v2-iter-4：Skill 本地文件安装测试

**目标**：端到端验证 Skill 从本地文件夹安装 → Agent 使用 → 卸载的完整链路。

| 步骤 | 内容 |
|------|------|
| 1 | 端到端测试：选择包含 SKILL.md 的本地文件夹 → 安装成功 → 已安装列表出现 |
| 2 | 安全扫描验证：安装前危险命令/网络外发检测正常触发 |
| 3 | Agent 使用验证：安装后 Agent 对话中能调用该 Skill 提供的工具 |
| 4 | 卸载验证：卸载后工具从 ToolRegistry 移除，Agent 不再可用 |
| 5 | 修复测试中发现的问题 |

**验证标准**：从本地文件夹安装 Skill → Agent 能使用该 Skill 工具 → 卸载后工具不可用，全链路无手动干预。

**分支**：`dev/v2-iter-4`　**Tag**：`v2.4.0`

---

### v2-iter-5：渠道配置测试与完善

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

---

### v2-iter-6：SSH 远程执行测试与完善

**目标**：SSH 连接 → 项目绑定 → Agent 远程执行 → 终端旁观，全链路通过。

| 步骤 | 内容 |
|------|------|
| 1 | SSH 连接创建验证：配置 host/port/user/authType → 密码或密钥认证 → 连接测试通过 |
| 2 | 项目绑定验证：项目设置关联 connectionId → Agent 自动使用 |
| 3 | Agent 远程执行验证：Bash 工具带 sshConnectionId 走 SSH 通道 → 返回结构化 stdout/stderr/exitCode |
| 4 | 终端旁观验证：Agent SSH 执行时终端面板实时显示命令和输出 |
| 5 | 长连接复用验证：多次命令执行复用同一连接，断线重连 |
| 6 | 修复测试中发现的问题 |

**验证标准**：配置 SSH 连接 → 项目绑定 → Agent 远程执行 → 终端旁观，全链路无手动干预。

**分支**：`dev/v2-iter-6`　**Tag**：`v2.6.0`

---

### v2-iter-7：主聊天折叠块模式 ✅ 已完成 (tag v2.7.0)

**目标**：借鉴灵犀的工作台模式——聊天窗统一用折叠块组件渲染 Agent 回复，工具调用预览移至右侧面板"工作台" tab，实现聊天流清爽 + 执行详情分离。

**核心设计**：所有 Agent 回复都走同一个折叠块组件，通过动态值 `collapsible` 区分行为——执行过程中动态计算，一旦有工具调用或 Agent Loop 超过 2 轮即变为 `true`。

| 步骤 | 内容 |
|------|------|
| 1 | 新建折叠块组件 — 统一渲染所有 Agent 回复，通过 `collapsible` 动态值控制行为：`false`（一问一答 ≤2 轮无工具）默认展开不可折叠；`true`（有工具调用或 >2 轮）执行中展开、结束后自动折叠成摘要（"运行了X个命令，查看了X个文件，编辑了X个文件"），点击可展开看精简列表（ToolCallCard 去掉预览部分，保留工具名/参数摘要/状态），完整预览只去右侧工作台 |
| 2 | ToolCallCard 预览迁移至右侧工作台 — 完整的工具调用预览（命令输出、文件 diff、搜索结果等）从聊天流移到 RightPanel 新增的"工作台" tab，执行中实时更新 |
| 3 | 工作台会话级隔离 — 切换会话时工作台内容跟随切换，按 sessionId 存储，排序按当前时间线 |
| 4 | 用户交互保留在折叠块 — 选项选择、输入回复等需要用户操作的交互留在折叠块内，不迁移到工作台 |
| 5 | 保留现有执行后操作按钮（debug 等） |

**验证标准**：纯聊天 → 折叠块展开不可折叠（一问一答）；发送消息触发工具 → `collapsible` 变为 `true`，执行中展开实时更新，结束后自动折叠成摘要 → 右侧工作台展示完整预览 → 切换会话工作台跟随隔离 → 点击摘要可展开看精简列表。

**分支**：`dev/v2-iter-7`　**Tag**：`v2.7.0`

---

### v2-iter-8：计划模式（人机协同执行引擎）

**目标**：单个计划的人机协同执行引擎。Agent 接收需求后走"探索→规划→产出计划文件→用户确认→分步执行→验证"流程，计划文件和任务状态落盘到 `.wishful-claw/` 固定位置，可被外部读取。

**核心概念**：
- **计划模式**是单个计划的执行引擎（人机协同，需要用户确认）
- **Goal 模式**（v2-iter-9）是迭代级别的自主执行——Agent 自己把迭代拆成多个计划，每个计划自主走完整流程（不要人确认），跑完整个迭代
- 计划模式是地基：Goal 复用它去掉人工确认、加多计划编排；全局编排（v2-iter-10）最后接上读任务文件

| 步骤 | 内容 |
|------|------|
| 1 | 计划模式状态机 — 在 Agent Loop 基础上增加计划状态机（explore → plan → confirm → execute → verify） |
| 2 | 计划文件格式 — 定义 `.wishful-claw/` 下的计划文件和任务状态文件格式，包含：计划标题、步骤清单、每步状态（待执行/执行中/已完成/失败）、执行结果摘要 |
| 3 | 状态落盘 — 计划执行过程中实时更新任务状态文件，外部可读取"当前在做什么、做到哪了" |
| 4 | 用户确认环节 — 规划完成后暂停等待用户确认，确认后才执行；每步执行完做 Mini 验证 |
| 5 | 前端计划面板 — 展示计划步骤清单 + 实时状态 + 验证结果 |

**验证标准**：发送一个需求（如"给项目加个 README"）→ Agent 进入探索态 → 产出计划文件到 `.wishful-claw/` → 用户确认 → 分步执行并实时更新状态文件 → 每步 Mini 验证 → 全部完成 → 状态文件可被外部读取。

**分支**：`dev/v2-iter-8`　**Tag**：`v2.8.0`

---

### v2-iter-9：Goal 模式（自主跑完迭代）

**目标**：迭代级别的自主执行。用户设定目标后，主会话（编排层）将目标拆成多个计划，每个计划由子 Agent 串行执行（探索→规划→自行确认→执行→验证），主会话收集结果后 LLM 自检评估——达标则推进下一个计划，不达标则分析原因、调整方案、重新分配子 Agent 重试。整个过程中遇到 429 限流自动长退避等待恢复后继续，用户可随时中断。直到目标达成或用户中止。

**参考来源**：OpenAI Codex CLI `/goal` 模式（v0.128.0，2026 年 5 月发布），开源仓库 `github.com/openai/codex`，Rust 实现，MIT 协议。底层模型 codex-1 闭源，但 Agent Loop 工程实现（自动拆分子任务、自执行、自 review、目标跨多轮持续存在）可参考。

**与计划模式的关系**：Goal 模式复用计划模式的状态机和计划工具，去掉人工确认环节（`SubmitPlanReview` → 自行确认），外层套多计划编排循环。子 Agent 执行计划时复用现有 `AgentLoop` + `SubAgentExecutor`，编排层使用 LLM 做决策（拆目标、自检评估、调整方案）。

**架构设计**：

```
GoalOrchestrator（编排层，Agent 层）
  ├── LLM 决策循环：拆目标 → 分配 → 自检评估 → 调整/推进
  ├── 串行子 Agent 分配：每个计划 spawn 一个子 Agent
  ├── 429 长退避：子 Agent 因 429 崩溃 → 10 分钟轮询 → 恢复后重启
  ├── 可中断：CancellationToken，用户随时暂停/中止
  └── Goal 状态持久化：.wishful-claw/goals/ 文件 + DB

子 Agent（执行层，复用现有 AgentLoop）
  ├── 计划模式流程：explore → plan → self-confirm → execute → verify
  ├── 计划工具变体：SelfReviewPlan 替代 SubmitPlanReview
  └── 复用 SubAgentExecutor 生命周期管理
```

**两层循环**：

| 层 | 谁在跑 | 做什么 | LLM 调用频率 |
|----|--------|--------|-------------|
| 编排层（主会话） | GoalOrchestrator + LLM | 拆目标、分析子 Agent 结果、自检评估、调整方案、决定下一步 | 低（每个计划完成时 1 次） |
| 执行层（子 Agent） | 子 Agent + LLM | 走 explore → plan → execute → verify，具体写代码 | 高（Agent Loop 正常频率） |

**编排循环逻辑**：

```
GoalOrchestrator 编排循环：
  while (Goal 未达成 && !用户中断):
    ① 有当前计划？→ 没有则 LLM 拆目标生成计划列表
    ② spawn 子 Agent 串行执行计划
    ③ 子 Agent 完成 → 收集执行结果
    ④ LLM 自检评估：
       ├── 达标 → 标记完成，推进下一个计划
       ├── 不达标 → LLM 分析失败原因，调整方案
       │           → 生成新的计划描述
       │           → 回到 ② 重新分配子 Agent
       └── 429 限流 → 10 分钟轮询等待 → 恢复后回到 ② 重试
    ⑤ 所有计划完成且自检通过 → Goal 达成
```

**429 限流退避策略**（GoalOrchestrator 层，非 Provider 层）：

```
收到子 Agent 因 429 崩溃的错误
  ↓
① 有 Retry-After header？  → 直接等指定秒数
  ↓ 没有
② 快速退避（模型过载 / RPM 限制）
   2s → 4s → 8s → 16s
   成功 → 重启子 Agent 继续
  ↓ 4 次后仍 429（约 30 秒）
③ 切换到分钟级轮询（额度限制）
   600s（10 分钟）固定间隔
   前端状态推送："额度限制，等待恢复中... 已等待 X 分钟"
  ↓
④ 连续轮询 6 小时仍 429
   暂停 Goal，通知用户："额度可能本日耗尽，需手动确认"
```

**Plan 拆分**（详见 `docs/plans/iter-v2-9/` 下各 Plan 文件）：

| Plan | 内容 |
|------|------|
| 1 | Goal 状态模型 + DB 层 + 文件格式 — GoalEntity / DbGoalTools / .wishful-claw/goals/ 文件 |
| 2 | 计划工具自确认变体 — SelfReviewPlan 替代 SubmitPlanReview，去掉人工确认环节 |
| 3 | GoalOrchestrator 核心 — 目标拆分 + 串行子 Agent 编排 + 基础编排循环 |
| 4 | 自检评估 + 失败重试 — LLM 评估子 Agent 结果，不达标调整方案重新分配 |
| 5 | 429 限流长退避 — 429 检测 + 快速退避 + 10 分钟轮询 + 6 小时超时暂停 |
| 6 | 可中断机制 — CancellationToken 集成 + 暂停/恢复/中止 + IPC 端点 |
| 7 | 前端 Goal 进度面板 — 计划列表 + 步骤状态 + 实时日志 + 等待状态 + 中断按钮 |
| 8 | PromptBuilder 集成 + 系统提示词 + 集成验证 |
| 9 | 协作模式选择器 + Goal 入口重构 — 下拉选择器，常规/目标两选项，Plan 模式保留在 SkillsMenu 中 |

**验证标准**：设定目标（如"修复所有 TypeScript 编译错误"）→ 主会话 LLM 拆分为多个计划 → 串行 spawn 子 Agent 执行每个计划 → 子 Agent 自主走 explore→plan→execute→verify → 主会话自检评估 → 失败则调整方案重新分配 → 遇 429 自动退避等待 → 恢复后继续 → 前端进度面板实时更新 → 用户可随时暂停/中止 → Goal 达成或用户中止。

**分支**：`dev/v2-iter-9`　**Tag**：`v2.9.0`

### v2-iter-10：全局会话 + 项目编排工具

**目标**：全局会话作为通用小助手，不绑项目目录，可正常聊天问答；同时提供项目管理工具，支撑从渠道（微信等）查看项目状态、推动项目任务的场景。

**核心场景**：用户通过微信聊天 → 全局 Agent 接收 → 读项目 `.wishful-claw/` 下的任务状态文件 → 看有没有活跃会话 → 有活跃会话（1小时内）就等，超过1小时或没有就创建新会话发任务。全局 Agent 拿到项目路径后可直接用现有文件工具（Read/Glob/Grep）读项目文档。

**全局 Agent 工具清单**：

| 工具 | 作用 |
|------|------|
| `list_projects` | 列出项目（名称 + 路径 + 是否有活跃会话） |
| `get_sessions` | 查某项目下的会话列表和状态（支持按时间筛选） |
| `create_session` | 给项目创建新会话 |
| `send_session_message` | 向会话发送任务消息 |

**会话选择策略**（由 LLM 自主判断）：

| 判断 | 策略 |
|------|------|
| 有活跃会话（1小时内） | 直接发消息，复用上下文 |
| 有会话但超过1小时 | 新建会话，避免上下文膨胀 |
| 没有会话 | 新建会话发任务 |

**验证标准**：新建全局会话 → 正常聊天问答 → 微信发消息"xx项目做完没" → Agent 调 list_projects 查到项目 → 读 `.wishful-claw/` 任务状态文件 → 调 get_sessions 看会话状态 → 有近期活跃会话就回复"正在执行中"，没有就调 create_session + send_session_message 推动任务。

**分支**：`dev/v2-iter-10`　**Tag**：`v2.10.0`

---

### v2-iter-11：Native AOT 打包（SqlSugar → Dapper 迁移）

**目标**：真正实现 Native AOT 打包，让安装包尽量小。当前使用 SqlSugar 强类型链式 API，其表达式树 + 反射在 AOT 下必须保留全量元数据，导致 AOT 裁剪失效、包压不小。迁移到 Dapper.AOT（源生成器）+ Microsoft.Data.Sqlite（官方原生驱动，AOT 友好），实现零反射的 AOT 裁剪。

**背景 / 选型结论**：
- SqlSugar 在 Native AOT 下无法细粒度裁剪（Queryable 表达式树 / 实体映射 / 动态代理必须保留反射元数据），`rd.xml` 的 `Dynamic="Required All"` 是必然需求而非可优化项，故 AOT 无法真正减小体积
- EF Core 过重（用户不倾向）；Dapper 是轻量 ADO 封装，符合项目偏好的同时支持官方 `Dapper.AOT` 源生成器实现 AOT 零反射
- `MemoryFtsService` 已是手写 SQL，Dapper 迁移最顺

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 引入依赖 — `Dapper` + `Dapper.AOT` + `Microsoft.Data.Sqlite`，移除 `SqlSugar` | `WishfulClaw.Infrastructure.csproj` |
| 2 | 重写 `DbClient` — 建表（CodeFirst → 手写 CREATE TABLE）、PRAGMA 配置、列迁移逻辑 | `Infrastructure/Db/DbClient.cs` |
| 3 | 迁移 8 个 Db*Tools — `Queryable/Insertable/Updateable/Deleteable` 强类型链式 → 手写 SQL + Dapper 参数化 | `DbMessageTools/DbSessionTools/DbGoalTools/DbSubAgentTools/DbPlugin*/DbMessageCompactTools` 等 |
| 4 | Entity 列映射 — 核对属性名与列名一致性，配置 Dapper 别名 | `Infrastructure/Db/Entities/*.cs` |
| 5 | `MemoryFtsService` 适配 — 手写 SQL 改用 `Microsoft.Data.Sqlite` + Dapper（FTS5 trigram 保留） | `Workspace/Memory/MemoryFtsService.cs` |
| 6 | 移除 AOT 逃避配置 — 删 `rd.xml` 粗粒度保留、关 `JsonSerializerIsReflectionEnabledByDefault`，JSON 改源生成器 `[JsonSerializable]` | `Worker/rd.xml`、`Worker/*.csproj` |
| 7 | AOT 打包验证 — `dotnet publish -p:PublishAot=true -r win-x64` 成功 + 包体积对比 | `WishfulClaw.Worker` |
| 8 | 功能回归 — 项目/会话/消息/记忆/SSH 全链路 DB 读写不回归 | 全链路 |

**验证标准**：`dotnet publish -p:PublishAot=true -r win-x64` 打包成功，安装包体积较当前显著减小；启动后 DB 读写（项目、会话、消息、记忆、SSH、Goal、SubAgent）全链路正常；FTS5 记忆全文搜索正常。

**分支**：`dev/v2-iter-11`　**Tag**：`v2.11.0`

---

### v2-iter-12：Goal 系统全面修复 — 自动编排 + 中断重启

**目标**：全面修复 Goal 执行链路，让 Goal 真正能"自动编排、可暂停/恢复、进程重启后自动续跑、不丢进度"。一次性解决当前 Goal 系统"创建后不推进、重启后接不上、UI 与底层状态不匹配"的多重问题。

**背景**：当前 Goal 系统存在 4 层独立状态存储，Orchestrator 状态纯内存导致 6 个断点：goalId 不一致、无恢复机制、Resume 不认 DB、RunAsync 不能续跑、前端 Resume 空壳、进程重启后无自动恢复入口。

**详细设计**：`docs/plans/iter-v2-12/plan.md`

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | goalId 对齐 — `StartAsync` 增加 goalId 参数，不再生成新 ID，确认后 DB 与 ActiveGoals 用同一 ID | `GoalOrchestrator.cs`、`AgentRuntimeGoalExecutor.cs` |
| 2 | 新增 `ResumeFromDb` — 从 DB 读回 goal 构建 GoalContext 并启动 RunAsync；`Resume` 找不到时回退到它 | `GoalOrchestrator.cs` |
| 3 | `RunAsync` 支持续跑 — 已有 plans 时跳过分解，从 currentPlanIndex+1 续跑 | `GoalOrchestratorLoop.cs` |
| 4 | Worker 启动自动恢复 — 扫描 DB 中 active/paused 的 goals，恢复编排 | `GoalModule.cs` |
| 5 | 前端 Resume 修正 — 移除对空实现 `dispatchNextQueuedMessageForSession` 的依赖 | `goal-session-views.tsx` |

**验证标准**：
1. 编译通过（C# 0 错误，TypeScript 3/3 配置 0 错误）
2. 创建并确认 goal 后 Orchestrator 自动分解并执行 plans
3. 编排运行时 Pause 暂停循环，Resume 继续循环
4. 进程重启后正在执行/暂停的 goal 自动恢复续跑，不重复分解，从断点继续
5. DB goalId 与 ActiveGoals key 一致
6. 已有的 active goal 通过恢复机制续跑，无需重新创建

**分支**：`dev/v2-iter-12`　**产品版本**：`0.2.12`　**Tag**：`v0.2.12`

---


### v2-iter-13：OpenAI Responses API + 请求超时配置 + 文件树/输入框/设置页收口 ✅ 已完成

**目标**：接入 OpenAI Responses API（新一代 SSE 协议）；全局请求超时配置化；文件树、输入框、设置页多项缺陷修复与体验收口。

**实际交付**：
- OpenAI Responses Provider（5 文件：State/InputWriter/EventParser/Provider + AgentLoop 路由）
- AgentRuntimeRequestTimeout 全局超时配置（5s~120s），三个 Provider 均已接入
- AgentFileTreeToolbar（搜索输入框+刷新+更多下拉）
- 搜索结果 type 字段区分文件/文件夹图标
- 右键打开终端改为 createTab 带选中路径
- 文件树持久化（AnimatePresence 外挂载，切 tab 不丢展开状态）
- ComposerStatusIndicator 独立组件 + 移除重复重试 banner
- 移除 websearch 设置入口 + AboutPanel 动态版本号
- electron-builder.yml win.icon 路径修复
- 死代码清理 5 文件 1243 行

**分支**：`dev/v2-iter-13`　**产品版本**：`0.2.13`　**Tag**：`v0.2.13`

---

### v2-iter-14：历史消息反向分页

**目标**：长会话从最新消息尾页加载，滚动到顶部触发动态加载更早历史。解决当前长会话一次性全量加载导致启动慢、内存占用高的问题。

**背景**：最新消息尾页加载已实现，但 `loadOlderSessionMessages` 仍是 stub；虚拟列表顶部触发基础设施已存在。不是从零开发，但涉及分页合并、滚动锚点、消息驻留和回归测试。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 后端分页查询 — `DbMessageTools` 增加 `GetMessagesByPage(sessionId, beforeTimestamp, limit)` 分页查询，按 created_at DESC 游标分页 | `Infrastructure/Db/DbMessageTools.cs` |
| 2 | 前端 `loadOlderSessionMessages` 实现 — 调用分页 API，将旧消息 prepend 到消息列表头部 | `renderer/src/stores/chat-store.ts` |
| 3 | 虚拟列表顶部触发 — 滚动到顶部时触发 `loadOlderSessionMessages`，加载过程中显示 loading 指示器 | `renderer/src/components/chat/MessageList.tsx` |
| 4 | 滚动锚点保持 — 加载旧消息后保持当前滚动位置不跳动（参考浏览器 scroll anchoring） | 同上 |
| 5 | 分页合并 — 新加载的消息与已有消息去重合并，确保顺序正确 | `chat-store.ts` |
| 6 | 回归测试 — 短会话（<20条）不触发分页，长会话（>100条）分页加载正确 | 手动验证 |

**验证标准**：打开 100+ 条消息的长会话 → 首次只加载最近 50 条 → 滚动到顶部 → 自动加载更早 50 条 → 滚动位置不跳动 → 重复直到全部加载完 → 消息顺序正确无重复。

**分支**：`dev/v2-iter-14`　**产品版本**：`0.2.14`　**Tag**：`v0.2.14`

---

### v2-iter-15：快捷键系统 + 快速启动器 + 剪贴板增强 + 开机启动 ✅ 已完成

**目标**：开机自启动开关 + 模块管理页面；全局快捷键 Alt+Space 唤起快速启动器；剪贴板增强 (Ctrl+Shift+V) 前端重写 + 内嵌设置面板；快捷键独立设置页 + 多快捷键编辑器 + 优先级快捷键桥接 + 注册反馈；模型管理页面（模型列表 + 添加/编辑/删除 + thinking 配置）。

**实际交付**：
- 模型管理页面 — ModelManagementPanel（584 行），模型列表 + 添加/编辑/删除 + thinking 配置，从 OpenCowork ProviderPanel 迁移
- 开机启动开关 + 模块管理页面
- 快速启动器 (Alt+Space) — 全局快捷键唤起弹窗输入框，快捷键捕获注册
- 剪贴板增强 (Ctrl+Shift+V) — 剪贴板弹窗前端重写，内嵌设置面板，双击粘贴
- 快捷键系统 — 快捷键独立设置页（从主设置页提取），多快捷键编辑器，优先级快捷键桥接（priority-shortcuts.ts），快捷键注册反馈
- 主题同步修复 — 弹窗窗口与主应用主题和预设同步
- JSON BOM 修复 — 移除 JSON 文件 UTF-8 BOM 导致 PostCSS 解析错误

**验证标准**：TypeScript 3/3 PASS；C# build 0 错误；安装包冒烟测试通过；用户人工验证通过。

**分支**：`dev/v2-iter-15`　**产品版本**：`0.2.15`　**Tag**：`v0.2.15`

---

### v2-iter-16：左侧面板整理 + use_capability 工具发现增强

**目标**：参考 OpenCowork 实现左侧面板搜索功能；清空旧扩展项，将绘图/自动化/任务面板移入扩展下拉菜单；修复 use_capability 工具发现的分页/过滤/搜索能力；修复辅助窗口导致 reverse-request 发错窗口的 bug；工具输出截断从字符级改为 UTF-8 字节级。

**背景**：v2 功能基本开发完毕，发布正式版前整理左侧面板。Obsidian 知识库 `正式版发布规划.md` 中明确了整理方向。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 左侧面板搜索 — 搜索输入框 + DB LIKE 消息内容搜索（200ms 防抖）+ 会话标题/项目名称内存过滤 + 搜索结果展示组件 | `WorkspaceSidebar.tsx`、`use-sidebar-search.ts`、`sidebar-search-results.tsx`、`DbMessageTools.cs` |
| 2 | 扩展功能重组 — 清空旧扩展项（resources/skills/souls/sync/translate/codegraph），新增绘图/自动化/任务面板三项，放入扩展下拉菜单 | `WorkspaceSidebar.tsx`、`MainLayout.tsx`、`ui-store.ts` |
| 3 | 主窗口注册修复 — 新建 `main-window-registry.ts`，reverse-request 不再用 `BrowserWindow.getAllWindows()[0]`（辅助窗口会抢占 index 0），改为显式注册的 mainWindow | `main-window-registry.ts`、`native-agent-runtime.ts`、`index.ts` |
| 4 | use_capability 工具发现增强 — list action 支持分页（cursor/page_size）、类型过滤（type/category）、模糊搜索（query）；提取 `AgentRuntimeUseCapabilityDiscovery.cs` partial class；ToolRegistry 新增 `IsAvailableInMode` 方法 | `AgentRuntimeUseCapabilityDiscovery.cs`、`UseCapabilityToolProvider.cs`、`ToolRegistry.cs` |
| 5 | 工具输出截限改为 UTF-8 字节级 — 从 `MaxToolOutputChars=16K chars` 改为 `MaxToolOutputBytes=32K bytes`，Rune 边界安全切片；use_capability list/inspect 免截断 | `ToolCallProcessor.cs` |
| 6 | DB 搜索端点 + JSON 上下文 — `db/messages-search-content` IPC 端点 + `MessageSearchResultRow` entity + `InfrastructureJsonContext` 注册 | `DbMessageTools.cs`、`DbModule.cs`、`InfrastructureJsonContext.cs`、`MessageSearchResultRow.cs` |
| 7 | 回归测试适配 | `Program.Lifecycle.cs`、`Program.Support.cs` |

**验证标准**：左侧面板搜索输入关键词 → 搜索结果显示匹配的消息（含 snippet）→ 点击搜索结果跳转到对应会话；扩展下拉菜单显示绘图/自动化/任务面板三项；Agent 调用 use_capability list 能分页/过滤/搜索；工具输出超过 32KB 时正确截断不破坏 UTF-8；辅助窗口（剪贴板/启动器）打开时 reverse-request 不再发错窗口。

**分支**：`dev/v2-iter-16`　**产品版本**：`0.2.16`　**Tag**：`v0.2.16`

---

### v2-iter-17：工具调用权限

**目标**：「默认」模式下工具调用需弹窗确认的范围梳理与实现。写/删/执行类操作需用户确认，读/搜索类不需要。

**背景**：涉及安全策略设计，当前所有工具调用无确认直接执行。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 权限分类 — 将所有工具按风险分级：safe（read/search/grep/glob）、cautious（write/edit/bash）、dangerous（delete/rm/shell sudo） | `Agent/Tools/*Executor.cs` |
| 2 | 权限配置 — 设置页新增工具权限配置面板，用户可调整每个工具的确认级别 | `renderer/src/components/settings/ToolPermissionPanel.tsx` |
| 3 | 确认机制 — Agent 调用 cautious/dangerous 工具时通过 reverse request 暂停 Loop，弹出确认卡片 | `Agent/ToolCallProcessor.cs` |
| 4 | 前端确认卡片 — 类似 PlanReviewCard，展示工具名、参数摘要、风险提示，Allow/Deny 按钮 | `renderer/src/components/chat/ToolPermissionCard.tsx` |
| 5 | 白名单记忆 — 用户 Allow 后可选择「不再询问此工具」，写入项目配置 | `renderer/src/stores/settings-store.ts` |
| 6 | SSH 项目特殊处理 — SSH 远程执行默认 cautious，不可降为 safe | `Agent/AgentRuntimeSshToolExecutor.cs` |

**验证标准**：Agent 调用 FsRead → 直接执行不确认；Agent 调用 FsWrite → 弹出确认卡片 → 用户 Allow → 执行；用户选择「不再询问」→ 下次 FsWrite 直接执行；Agent 调用 ShellExecute → 必须确认。

**分支**：`dev/v2-iter-17`　**产品版本**：`0.2.17`　**Tag**：`v0.2.17`

---

### v2-iter-18：Cron 自动化验证

**目标**：验证 Cron Agent 的定时任务执行能力，确保定时触发、任务执行、结果通知全链路通过。验证通过后可接替老叶（KodaClaw 云实例）的定时任务。

**背景**：Cron Agent 已实现但未测试。属于独立端到端验收。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | Cron 表达式验证 — 测试各种 cron 表达式解析是否正确（每分钟/每小时/每天/每周/自定义） | `Agent/Modules/CronModule.cs` |
| 2 | 定时触发验证 — 创建定时任务 → 等待触发时间 → 确认 Agent 自动启动执行 | 同上 |
| 3 | 任务执行验证 — 定时触发的 Agent 能正常调用工具、完成指定任务 | 全链路 |
| 4 | 结果通知验证 — 任务完成后通知用户（IM/日志/UI） | `renderer/src/components/` |
| 5 | 持久化验证 — 关闭重开应用后定时任务仍然有效 | `Infrastructure/Db/` |
| 6 | 异常恢复验证 — 定时任务执行失败时不影响下一次触发 | `Agent/Modules/CronModule.cs` |
| 7 | 老叶任务迁移评估 — 对比 KodaClaw 云实例现有定时任务，评估迁移到 WishfulClaw 的可行性 | 评估文档 |

**验证标准**：创建一个每分钟触发的定时任务 → Agent 每分钟自动执行 → 执行结果在 UI 中可见 → 关闭重开后任务仍然有效 → 执行失败后下一次正常触发。

**分支**：`dev/v2-iter-18`　**产品版本**：`0.2.18`　**Tag**：`v0.2.18`


---

### v2-iter-19：Goal 编排记录可视化

**目标**：Goal 自动编排过程记库，右侧面板可查看每轮计划及执行详情。当前 Goal 运行只能看最终结果，编排过程是黑箱。

**背景**：涉及数据库新建表 + 运行时记录 + 前端面板，范围较大。原计划在 v2-iter-16，因实际优先级调整推后。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | DB 建表 — `goal_orchestrations`（编排记录：goalId/sessionId/createdAt/status）+ `goal_plan_tasks`（计划任务：orchestrationId/planIndex/title/status/result/startedAt/completedAt） | `Infrastructure/Db/DbClient.cs` |
| 2 | 后端记录 — GoalOrchestrator 每轮分解/执行/验证时写入 `goal_orchestrations` 和 `goal_plan_tasks` | `Agent/GoalOrchestrator*.cs` |
| 3 | IPC 端点 — `goal:list-orchestrations` / `goal:get-orchestration-detail` 分页查询编排记录 | `Agent/Modules/GoalModule.cs` |
| 4 | 前端面板 — RightPanel 新增 Goal 编排记录 tab，展示编排列表 + 点击查看计划步骤详情 | `renderer/src/components/goal/GoalOrchestrationPanel.tsx` |
| 5 | 实时更新 — Goal 运行时面板实时更新当前编排状态 | 同上 |
| 6 | 历史查看 — 已完成的 Goal 也能查看编排记录 | 同上 |

**验证标准**：创建并运行 Goal → 右侧面板 Goal 编排 tab 实时显示编排进度 → 每轮计划标题、状态、执行结果可见 → Goal 完成后可回看完整编排历史。

**分支**：`dev/v2-iter-19`　**产品版本**：`0.2.19`　**Tag**：`v0.2.19`

---

### v2-iter-23：会话可靠性与缺陷收口（执行中）

**目标**：完成上下文压缩快照与恢复、工具结果即时持久化、聊天执行体验改进和全项目缺陷治理，为后续功能补齐与稳定性验证建立可靠基线。

**边界**：本迭代不承担正式版发布，不执行正式版版本迁移、正式版 tag 或 GitHub Release。当前人工验收和未关闭问题形成 v2-iter-24/25 的输入。

**验证标准**：当前范围的自动化验证、构建检查和人工验收结果可追溯；功能缺口、遗留问题和风险均有明确后续归属。

---

### v2-iter-24：功能补齐与遗留问题推进（规划中）

**目标**：补齐当前仍缺失的产品能力，处理 v2-iter-23 人工验收、知识库和实际使用中确认的功能缺口；范围在开工前由老大逐项确认。

**边界**：优先完成用户可见功能和阻断日常使用的问题，不以正式版发布为硬截止，不在功能仍明显缺失时进入发布流程。

**验证标准**：纳入范围的功能有完整实现、自动化/构建证据和人工验收口径；未完成项不得转入候选版门槛。

---

### v2-iter-25：集中修复、完整回归与 Release Candidate 准备（规划中）

**目标**：冻结新增大功能，集中处理高优先级缺陷、静默失败、兼容性和安装链问题；完成全量回归、真实 Electron 进程级覆盖、Native AOT/NSIS 验证，并产出可供持续人工使用观察的 Release Candidate。

**进入条件**：v2-iter-24 的目标功能已完成，阻断性功能缺口已关闭，剩余问题有明确风险分级和处置结论。

**验证标准**：TypeScript 三配置、C# solution、Native AOT、数据库迁移、Electron 隔离冒烟、Windows 安装/覆盖升级/卸载重装及核心业务链通过；Release Candidate 经一段实际使用观察，无阻断发布的问题。

---

### v2-iter-26：正式版发布与收尾（规划中）

**目标**：在 Release Candidate 达到发布门槛并经老大明确确认后，执行正式版版本迁移、最终安装验证、main/tag/Release 和发布资料收尾。

**发布动作**：更新产品版本与发布元数据、生成 Windows 安装包、创建正式版 tag、推送 main/tag、创建 GitHub Release、上传安装包并核验下载与安装链路。具体正式版本号在本迭代规划时由老大确认，不在更早迭代预写死。

**验证标准**：所有发布门槛有可追溯证据；老大完成最终人工验收并明确授权发布；main、tag、Release、安装包和升级路径一致且可用。

---

## 迭代依赖关系

```
=== MVP v1（已完成，已合并 main，tag v0.15.0）===
迭代一（骨架）→ 二（Provider）→ 三（Agent Loop）→ 四（工具链）→ 五（项目+会话）
  → 六（人格）→ 七（记忆）→ 八（集成验证）
  → 九（输入框修复 + 提示词优化器）→ 十（子 Agent）
  → 十一（右侧面板 + 子 Agent 架构增强 + 终端/文件管理）
  → 十二（SSH 远程执行 + Agent 终端旁观）
  → 十三（聊天窗渲染调整）→ 十四（Skill 市场）→ 十五（MCP 管理）

=== MVP v2（进行中）===
v2-iter-1（Runtime 分层架构重构）✅
  ↓
v2-iter-2（缓存命中率修复）✅
  ↓
v2-iter-3（Infrastructure 层拆分）✅
  ↓
v2-iter-4（Skill 本地文件安装测试）  ┐
v2-iter-5（渠道配置测试与完善）      ├─ 三者可并行，互不依赖，均已完成 ✅
v2-iter-6（SSH 远程执行测试与完善）  ┘
  ↓
v2-iter-7（主聊天接入工作台模式）  ← 当前最高优先级，无前置依赖
  ↓
v2-iter-8（计划模式 — 人机协同执行引擎）  ← 当前最高优先级，依赖现有 Agent Loop
  ↓
v2-iter-9（Goal 模式 — 自主跑完迭代）✅  ← 依赖计划模式就绪（复用 + 去掉人工确认 + 多计划编排）
  ↓
v2-iter-10（全局会话 + 项目编排工具）✅  ← 依赖计划模式的任务文件可读
v2-iter-11（Native AOT 打包）✅  ← 基础设施改造，无功能前置依赖
v2-iter-12（Goal 生命周期一致性修复）✅  ← 依赖 Goal 模式就绪
v2-iter-13（Responses API + 超时 + 文件树/输入框/设置页收口）✅

v2-iter-14 ~ v2-iter-22 ✅ 已完成并合并 main
  ↓
v2-iter-23（会话可靠性与缺陷收口，执行中）
  ↓
v2-iter-24（功能补齐与遗留问题推进）
  ↓
v2-iter-25（集中修复、完整回归与 Release Candidate 准备）
  ↓
v2-iter-26（正式版发布与收尾；需老大最终确认）
```

v2-iter-1 ~ v2-iter-22 已完成；v2-iter-23 当前执行中。
v2-iter-24 ~ v2-iter-26 按“功能补齐 → 候选版稳定性门槛 → 正式版发布”顺序推进，不提前把某个开发迭代视为正式版。
每个迭代仍需老大确认具体范围后，再从最新 main 拆分支 `dev/v2-iter-{N}` 开始。