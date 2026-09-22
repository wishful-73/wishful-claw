# Plan: iter-v2-34 第三批需求实施（S-135 ~ S-138）

> 2026-09-22 建，同日两次改版（补 S-138、S-137 缩范围）。**需求口径权威源 = 同目录 `raw-requirements.md` + `requirements/S-13x.md`**，本文件只排步骤与文件面。
> 分支：按 2026-09-22 裁定（老大选 **C**）**直接在 `dev/v2-iter-34` 上实施**，不新开 iter-35。

## 目标

四项追加需求各独立成一刀，**由小到大**：**S-136 分叉按钮** → **S-138 朗读音色** → **S-137 shell 停止进程** → **S-135 流式渲染降级**。

## 已定口径（2026-09-22 收口，不再逐条请示）

| # | 项 | 定案 | 依据 |
|:--:|---|---|---|
| 1 | 分叉会话标题 | 沿用源标题 +「（分支）」后缀 | 侧栏里分得清 |
| 2 | C# `Running` 骨架 | **接**，不删 | 骨架现成，比删干净便宜 |
| 3 | S-137 后台按钮组 | **砍掉** | 老大裁定；且实测该组从不渲染（见下） |
| 4 | S-135 降级对象 | 全部同档节流，进行中的工具卡输出优先降 | 老大原话「暂停不重要的进行中渲染」 |
| 5 | S-135 策略 | 固定两档（33ms / 150ms） | 先跑起来再调 |
| 6 | S-135 落点 | **main**（`agent-stream-handler.ts`） | 与 OpenCowork 同构，从源头减量 |
| 7 | S-138 选择器位置 | **设置页 `GeneralPanel` 加一节** | 新开 tab 要动 `SettingsTab` 类型 + `SETTINGS_TABS` 白名单 + `settings-tabs` 测试套件，不值 |
| 8 | S-138 作用域 | 全局一个默认音色 | 朗读是轻功能 |
| 9 | S-138 `rate`/`pitch` | 一并做 | 十几行，实用性高 |
| 10 | S-138 下载引导 | **砍掉** | 实测本机中文语音已全装（3 个即全部），无物可装 |

**顺带修、不单独裁定**：`ShellExecuteTool.Process.cs:94` 取消路径不 kill 进程树（真 bug，随 S-137 一刀走）。

## 范围与顺序

| 序 | 需求 | 体量 | 为什么排这个位置 |
|:--:|---|---|---|
| 1 | **S-136** | 小（1 个 store 函数 + 0 接线） | UI / 文案 / 错误处理已齐备，实现体一补即通，先把流程跑通 |
| 2 | **S-138** | 小（设置页一节 + 朗读入口消费） | 单层改动，无跨进程 |
| 3 | **S-137** | 中（C# + main + 渲染三层） | 砍完后台按钮后收敛为单件事：接通前台停止链路 |
| 4 | **S-135** | 大（搬 + 拆 853 行参考） | 体量最大，独立成刀，放最后避免挡住前三项 |

**S-137 的范围边界（已核实）**：勘测到**两处**零调用点 —— ① 前台 `registerForegroundShellExec`（老大报的「停止进程点了没反应」就在这条路上，**本刀必接**）；② 后台 `initBackgroundProcessTracking` / `registerBackgroundProcess`（零调用点 ⇒ **后台那组按钮从不渲染**）⇒ **② 整片砍掉**（老大裁定「我都没见过，那就砍掉」）。

**S-135 拆分清单已落定**（依据 `dev-workflow.md:395` 的「200~500 行/文件」+ `:396` 的耦合拆分；落点经 `docs/project-structure.md` 与同目录既有子目录惯例 `channel-handlers/`、`reverse-handlers/` 核对）：`src/main/ipc/batcher/` 下四个文件 —— `batcher-config.ts`（阈值常量）/ `aggregatable-events.ts`（可聚合事件白名单）/ `batcher-codec.ts`（delta 累加合并）/ `adaptive-event-batcher.ts`（状态机 + flush 调度）。

## 步骤清单

### 第一部分：S-136 分叉按钮

- [ ] **步骤 1** —— `src/renderer/src/stores/chat-store/session-slice.ts`：在 `duplicateSession` 旁实现 `forkSessionFromMessage`
  - 结构照 `duplicateSession`（`:477-498`），差异在**消息切片** `messages.slice(0, messageIndex + 1)`（含目标消息本身）。
  - 新 `sessionId` = `nanoid()`；克隆消息**重发新 id**（照 `duplicateSession` 的 `${m.id}_copy_${nanoid(6)}` 写法）；`toolUseId` 等**内部引用保持原值**（分叉是独立副本，引用历史工具调用正常）。
  - 落库顺序：先 `dbCreateSession(newSession)`，再**逐条 `dbUpsertMessage(newId, msg, index)`** —— **已核实 `dbCreateSession` 只写会话元数据、不写消息**（`db-helpers.ts:313` → `db/sessions-create`），不逐条写就是空壳会话。
  - `set` 里 push + `activeSessionId = newId`；返回 newId。类型声明上的 `?` 可去掉（实现体已存在）。
  - **验证**：`npm run typecheck` EXIT=0。
- [ ] **步骤 2** —— 真机验证 + commit
  - 点第 N 条消息的「分叉」⇒ 新会话出现，**消息恰为 1~N 条**，且是可继续对话的活会话；刷新 / 重启后新会话仍在、消息仍全（验落库真的写了消息）。
  - **验证**：`npm run typecheck` + `npm test` 全量 ⇒ **commit（S-136 独立一刀）**

### 第二部分：S-138 朗读音色

- [ ] **步骤 3** —— **前置勘测**：`GeneralPanel.tsx` 既有设置项怎么持久化（store / 后端 settings / localStorage），决定 `voice` / `rate` / `pitch` 存哪；顺带确认 `locales/{zh,en}/settings.json` 的字段命名惯例。
- [ ] **步骤 4** —— `GeneralPanel.tsx` 新增「朗读」一节
  - 语音下拉：`window.speechSynthesis.getVoices()` 过滤 `localService === true`；**注意 `getVoices()` 首次可能返回空**，须监听 `voiceschanged` 事件补一次（实测教训：探针第一版就是栽在这，见 S-138.md）。
  - `rate` / `pitch` 滑条（`rate` 默认 1、`pitch` 默认 1）。
  - 文案走 i18n（zh + en **两份都要加**）。
  - **验证**：`npm run typecheck` EXIT=0；`npm test -- --filter i18n` 过（仓库有 i18n 覆盖测试）。
- [ ] **步骤 5** —— `components/chat/AssistantMessage/action-bar.tsx` 的 `handleSpeak` 消费设置：`utterance.voice` / `utterance.rate` / `utterance.pitch`（`voice` 要按 name 匹配 `getVoices()`）。
- [ ] **步骤 6** —— 真机验证 + commit
  - 设置页切三个音色各听一次（Huihui / Kangkang / Yaoyao）；调 `rate` 生效；重启后设置保持。
  - **验证**：`npm run typecheck` + `npm test` 全量 ⇒ **commit（S-138 独立一刀）**

### 第三部分：S-137 shell 停止进程

- [ ] **步骤 7** —— **砍掉后台按钮组那片死代码**（纯删除，不改逻辑）
  - `bash-output.tsx`：删后台按钮块（`:179-209`）、`process` 订阅（`:80`）及其衍生判断（`:82/83/84/85-86/90-94/152-154` —— 靠 `parsed` 兜底后行为不变）、「打开会话」跳转（`:185`，`{type:'terminal',processId}` 全仓仅此一处）、两个 store 订阅（`:42-43`）。
  - `background-process-slice.ts`：删 5 个零调用 action（`initBackgroundProcessTracking` / `registerBackgroundProcess` / `stopBackgroundProcess` / `sendBackgroundProcessInput` / `removeBackgroundProcess`）+ `trimBackgroundProcessMap`。**保留** `registerForegroundShellExec` / `updateForegroundShellExec` / `clearForegroundShellExec` / `abortForegroundShellExec`（本刀正题要用）与 `foregroundShellExecByToolUseId`。
  - 连带清理：`agent-store/index.ts:47`（`backgroundProcesses: {}`）、`agent-store/types.ts`（`backgroundProcesses` 字段 + 5 个 action 声明 + `BackgroundProcessState` 类型）、`session-slice.ts:81`、`sub-agent-slice.ts:441-444`。
  - **验证**：`npm run typecheck` EXIT=0；`grep -rn "backgroundProcesses" src/` 归零或仅剩无关命中。
- [ ] **步骤 8** —— C# 侧接线：填 `Running` 表 + 暴露中止入口
  - `ShellExecuteTool.Process.cs` 的 `RunProcessAsync`：`process.Start()` 后 `Running[execId] = new RunningProcess(process)`，`finally` 里移除。
  - **前置核实**：`ToolExecutionContext` 是否带 `toolUseId` / 调用 id（`execId` 的来源）；若无，从上层透传或在 `ExecuteAsync` 内生成后回报 main。
  - 中止入口：仿 `AgentRuntimeModule.cs` 既有请求处理，新增按 id 中止的分支。
  - **验证**：`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警。
- [ ] **步骤 9** —— 修 `ShellExecuteTool.Process.cs:94` 取消路径
  - `catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)` 的 `when` 把外部取消排除在 kill 分支外 ⇒ 外部取消时**不杀子进程树**。改法：外部取消也要 `TryKillProcessTree`，并在 `AbortReason` 上留痕（与 `timedOut` 语义区分）。
  - **验证**：扩 C# 回归断言（取消 ⇒ 进程树被 kill）；`npm test -- --csharp-only` 过。
- [ ] **步骤 10** —— main 转发 + 渲染层接线
  - `SHELL_ABORT` 常量在 **`src/renderer/src/lib/ipc/channels.ts`**（**只读核对，本刀不改它**）；主进程新增 `shell:abort` handler 落在 **`src/main/ipc/worker-forward-handlers.ts`**（该文件定位就是「thin forwarders to the C# Worker」）。
  - `registerForegroundShellExec`（`stores/agent-store/types.ts:401` / `slices/background-process-slice.ts:27`）接上**写入点** —— 否则 map 恒空，按钮照样没反应。
  - `bash-output.tsx:211-226` 的前台按钮改成真调用。
  - **验证**：`npm run typecheck` EXIT=0；`grep -rn "registerForegroundShellExec" src/` 有调用点（不再是零）。
- [ ] **步骤 11** —— 真机验证 + commit
  - 跑一条长命令（如 `ping -t`）⇒ 点「停止进程」⇒ **进程真的死、按钮状态更新**；会话「停止」时正在跑的 Bash **不再留孤儿**（验步骤 9）。
  - **验证**：`npm run typecheck` + `npm test` 全量 ⇒ **commit（S-137 独立一刀）**

### 第四部分：S-135 流式渲染降级

- [ ] **步骤 12** —— 搬 `adaptive-event-batcher` 到 `src/main/ipc/batcher/`（四文件，见「范围与顺序」）
  - 参考 `D:\koda\OpenCowork\src\main\ipc\adaptive-event-batcher.ts`（**实测 853 行**）。只留本项目的 `agent/stream` 事件形状，**OpenCowork 特有依赖（频道 / CodeGraph 等）不进**。
  - **验证**：① `npm run typecheck` EXIT=0；② **逐文件行数落进 200~500**（`dev-workflow.md:395`）；③ 新增 TS 回归脚本 `tests/adaptive-event-batcher/program.ts` + `package.json` 加 `test:adaptive-event-batcher`（`dev-workflow.md:280`：这两处会被 `npm test` 自动收进来，**不改 `scripts/run-tests.mjs`**），断言三条 —— 同一 `runId` 的多个 `textDelta` 在窗口内合并为一条 / 控制类事件不参与合批、立即直通 / 缓冲超 `maxBufferSize` 立即 flush；`npm test -- --filter adaptive` 过。
- [ ] **步骤 13** —— 接进 `src/main/ipc/agent-stream-handler.ts`（现 17 行裸转发 ⇒ 改为经聚合器按帧推）
  - **验证**：typecheck 0 错；dev 起来后单条消息流式输出正常（**无丢字、无乱序** —— 聚合器只合可加事件，控制类直通）。
- [ ] **步骤 14** —— 真机压测 + commit
  - 跑一个工具密集 + 模型快的任务（复现老大那次），**页面不再整屏假死**；主会话「停止」按钮**即时生效**。
  - **验证**：`npm run typecheck` + `npm test` 全量 ⇒ **commit（S-135 独立一刀）**

## 涉及文件

| 文件 | 动作 | 需求 |
|---|---|---|
| `src/renderer/src/stores/chat-store/session-slice.ts` | 改（实现 `forkSessionFromMessage`） | S-136 |
| `src/renderer/src/components/settings/GeneralPanel.tsx` | 改（新增「朗读」一节） | S-138 |
| `src/renderer/src/locales/{zh,en}/settings.json` | 改（朗读文案） | S-138 |
| `src/renderer/src/components/chat/AssistantMessage/action-bar.tsx` | 改（`handleSpeak` 消费 voice/rate/pitch） | S-138 |
| `src/renderer/src/components/chat/ToolCallCard/output-blocks/bash-output.tsx` | 改（砍后台块 + 前台按钮真调用） | S-137 |
| `src/renderer/src/stores/agent-store/slices/background-process-slice.ts` | 改（砍 5 个死 action + 接前台写点） | S-137 |
| `src/renderer/src/stores/agent-store/index.ts` | 改（删 `backgroundProcesses: {}`） | S-137 |
| `src/renderer/src/stores/agent-store/types.ts` | 改（删后台类型 + 声明） | S-137 |
| `src/renderer/src/stores/agent-store/slices/session-slice.ts` | 改（清 `backgroundProcesses` 引用） | S-137 |
| `src/renderer/src/stores/agent-store/slices/sub-agent-slice.ts` | 改（清批量 kill 死逻辑） | S-137 |
| `src/runtime/WishfulClaw.Agent/Tools/ShellTools/ShellExecuteTool.cs` | 改（`Running` 表写入） | S-137 |
| `src/runtime/WishfulClaw.Agent/Tools/ShellTools/ShellExecuteTool.Process.cs` | 改（注册 / 移除 + 修取消 kill） | S-137 |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeModule.cs` | 改（新增按 id 中止的请求分支） | S-137 |
| `src/main/ipc/worker-forward-handlers.ts` | 改（新增 `shell:abort` → C# worker 转发） | S-137 |
| `src/renderer/src/lib/ipc/channels.ts` | **只读核对**（`SHELL_ABORT` 常量在此，不改） | S-137 |
| `src/main/ipc/batcher/batcher-config.ts` | **新建**（阈值常量） | S-135 |
| `src/main/ipc/batcher/aggregatable-events.ts` | **新建**（可聚合事件白名单） | S-135 |
| `src/main/ipc/batcher/batcher-codec.ts` | **新建**（delta 累加 / 合并） | S-135 |
| `src/main/ipc/batcher/adaptive-event-batcher.ts` | **新建**（状态机 + flush 调度） | S-135 |
| `tests/adaptive-event-batcher/program.ts` | **新建**（TS 回归脚本） | S-135 |
| `src/main/ipc/agent-stream-handler.ts` | 改（接入聚合器） | S-135 |
| `package.json` | 改（加 `test:adaptive-event-batcher`） | S-135 |

## 参考源码

| 项目 | 路径 | 参考什么 |
|---|---|---|
| OpenCowork | `D:\koda\OpenCowork\src\renderer\src\stores\chat-store.ts:4280-4331` | `forkSessionFromMessage` 完整实现（S-136） |
| OpenCowork | `D:\koda\OpenCowork\src\main\ipc\shell-handlers.ts:371-497` | `runningShellProcesses` Map + `shell:abort` + `shell/output` 广播**设计**（S-137；**其代码抄不到 —— 它自己渲染层也零调用点**） |
| OpenCowork | `D:\koda\OpenCowork\src\main\ipc\adaptive-event-batcher.ts` | 自适应事件批处理（S-135，实测 853 行，需拆分） |
| 本地 | `src/renderer/src/stores/chat-store/session-slice.ts:477-498` | `duplicateSession` —— 分叉的本地风格参考（S-136） |

## 风险与回退

| 风险 | 处置 |
|---|---|
| 分叉会话消息 id 重写后与工具调用 / 附件引用失配 | 只重写 `msg.id`，内部引用（`toolUseId` 等）保持原值；真机验证覆盖「分叉后再发一条消息」 |
| S-137 砍死代码时**误删前台 action** | 明确保留清单（4 个前台 action + `foregroundShellExecByToolUseId`），删完 `grep` 复核编译 |
| S-137 的 `execId` 源头无从获取 | 步骤 8 的**前置核实**；拿不到就退而用 `ExecuteAsync` 内生成的 id + 上报 main |
| `getVoices()` 首次返回空（实测已踩） | 步骤 4 必须监听 `voiceschanged` 补一次 |
| S-135 搬 853 行引入不必要依赖 | 步骤 12 只搬事件形状与聚合逻辑 |
| S-135 降频后**丢字 / 乱序** | 聚合器只合 `textDelta` 一类可加事件，控制类直通；步骤 13 验证流式输出完整性 |
| S-135 按 4 文件拆分后过度碎片化 | 853 ÷ 4 ≈ 210 行/文件，仍在 200~500 区间；某文件不足 200 行就并回相邻文件，**不为凑数硬拆** |
| 四项改动面重叠（都碰渲染层） | 四刀由小到大；每刀单独 `npm test` 全量后再进下一刀 |

## 提交节奏

- 步骤 2 ⇒ **commit 1：S-136**
- 步骤 6 ⇒ **commit 2：S-138**
- 步骤 11 ⇒ **commit 3：S-137**
- 步骤 14 ⇒ **commit 4：S-135**
- 迭代收尾再一刀「审查与验证修复调整」
- **迭代内一律不 push**

## 门禁基线

- 起点：`npm run typecheck` EXIT=0；`npm test` **47/47**（TS 35 + C# 12）；两 sln 0 错 0 警。
- 每刀提交前：`npm run typecheck` + `npm test` 全量。
- `npm test` 支持的筛选参数（`scripts/run-tests.mjs:7-10` 实测，非推测）：`--ts-only` / `--csharp-only` / `--no-build` / `--filter <子串>`。全量一次约 36 秒（`dev-workflow.md:270`），**不必为省时间只跑子集**。
- C# 编译前**先确认开发实例没在跑**（见 `dev-workflow.md`「编译环境」节）。
