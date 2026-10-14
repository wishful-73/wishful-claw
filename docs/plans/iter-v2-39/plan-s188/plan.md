# Plan: S-188 全局 PM 对项目会话的掌控 —— 看不到队列 / 撤不了队列 / 停不了运行

> 所属迭代：iter-v2-39 ｜ 需求明细：[`../requirements/S-188.md`](../requirements/S-188.md)
> 类型：**跨端能力补充**（C# 工具面 + 渲染端反向请求桥）；**队列不落库、零 DB 迁移**。
> 口径：老大裁定 2 条（10-10 15:11）+ 助手拍定实施细节 5 项（见 `S-188.md` §5.1 / §5.2）。
> **分三刀**：第一刀「看 + 撤」（`27791c7f`）、第二刀「停」（`f111da66`）、**第三刀「恢复派发」（10-11 补裁，`689e031c`）**。

---

## 一、目标

全局 PM（全局会话 Agent）目前对项目会话**只有投递能力、没有观测与干预能力**：看不到队列、撤不了队列、停不了运行 ⇒「只能干着急」。

⇒ 给 PM 补上三类工具，全部复用**已有的反向请求桥**（与 `send_session_message` 同一条路），**不把队列搬进 DB**。

---

## 二、口径

### 2.1 老大裁定（2 条）

| # | 事项 | 裁定 |
|---|---|---|
| 1 | 是否纳入 39 | **纳入**，定性**「能力补充」**（非 bug） |
| 2 | 「停止」的语义 | **只停当前这一轮**（`cancelStream(sessionId)`）；**队列保留**，停完**可再发消息**。⚠️ 原写的「**派发照旧**」与实现不符（`cancelStream` 内部会冻住派发）—— 见第 3 条 |
| 3 | 「恢复」的口径（**10-11 补裁**） | **给 PM 补一个恢复工具**（老大原话「那加个方法去触发队列的继续」），等价于 UI 队列面板的「继续」按钮 —— 即第三刀 `resume_session_queue` |

### 2.2 实施细节（助手拍定，非老大裁定）

| # | 事项 | 定案 |
|---|---|---|
| 1 | 落地节奏 | **分两刀** —— 第一刀 A + B（看 + 撤），第二刀 C（停） |
| 2 | 「撤销」动作面 | **删单条 + 清空，两者都给** |
| 3 | 停止是否弹确认 | **不弹**（PM 是自动化角色，弹确认会阻塞其自身推理链；且「停」可逆） |
| 4 | 工具作用域 | **沿用 `GlobalSideOnly`**（与 `send_session_message` 同作用域，不新开口子） |
| 5 | `get_project_details` 的 `activeSessionId` 启发式 | **本需求不动**（独立议题，如需修由老大另立） |

### 2.3 新工具集

| 刀 | 工具 | 入参 | 作用 |
|---|---|---|---|
| 一 | `get_session_queue` | `sessionId` | 读 —— **真实运行态** + 队列快照 |
| 一 | `remove_session_queue_message` | `sessionId` / `messageId` | 撤 —— 删单条 |
| 一 | `clear_session_queue` | `sessionId` | 撤 —— 清空 |
| 二 | `stop_session_run` | `sessionId` | 停 —— `cancelStream(sessionId)` |
| 三 | `resume_session_queue` | `sessionId` | 恢复 —— 解冻队列派发（`resumePendingSessionDispatch`；无活跃 run 时立即 `dispatchNextQueuedMessageForSession`） |

⚠️ `get_session_queue` 的「真实运行态」取自 `hasActiveSessionRunForSession(sessionId)`（`use-chat-actions.ts:943`，**准确**），**不走** `get_project_details` 的启发式 ⇒ 与实施细节第 5 项不矛盾（**新工具给准的，老工具不动**）。

---

## 三、步骤清单（第一刀：看 + 撤）

- [x] **步骤 1（C#）：定义反向请求类型**
  - `src/runtime/WishfulClaw.Agent/.../AgentRuntimeReverseRequests.cs` 新增三个请求类型（读队列 / 删单条 / 清空），照现有 `send_session_message` 的反向请求形状。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误。
- [x] **步骤 2（C#）：注册三个工具**
  - `Tools/Providers/ProjectToolsProvider.cs` 加 `get_session_queue` / `remove_session_queue_message` / `clear_session_queue` 的工具定义（含 JSON schema：参数名、类型、是否必填）；作用域沿用 `GlobalSideOnly`。
  - `ToolDispatchRouter.cs` 登记新工具名（若该处需登记）。
  - **验证检查点**：编译零错误；工具能被列出（下一轮由 PM 侧验）。
- [x] **步骤 3（C#）：接执行分支**
  - `AgentRuntimeProjectExecutor.cs`：`ProjectToolNames` 集合加三个名字；`ExecuteAsync` 加三个分支，发反向请求并等结果。
  - **验证检查点**：编译零错误。
- [x] **步骤 4（渲染端）：新增反向处理器**
  - 照 `src/renderer/src/lib/tools/project-send-message.ts` 新增处理器（可同一文件同族新函数，或同目录新文件）：读 `getPendingSessionMessages` / `hasActiveSessionRunForSession`；调 `removePendingSessionMessage` / `clearPendingSessionMessages`。
  - `use-chat-actions.ts` **零改动**（四个 API 全已有）。
  - **验证检查点**：`npm run typecheck` 两配置零错误。
- [x] **步骤 5：整体实测（第一刀）**
  - dev 实例：在项目会话里连续发消息造出队列 → 全局 PM 调 `get_session_queue` ⇒ 能看到条数、内容摘要、是否在跑；调 `remove_session_queue_message` ⇒ 指定条消失；调 `clear_session_queue` ⇒ 队列清空；渲染端队列面板同步变化。
  - **验证检查点**：上述逐条实测通过；`npm test` 全量跑一遍。

## 四、步骤清单（第二刀：停）

- [x] **步骤 6（C#）：加 `stop_session_run`**
  - `ProjectToolsProvider.cs` 加工具定义；`ProjectToolNames` + `ExecuteAsync` 加分支；`AgentRuntimeReverseRequests.cs` 加请求类型。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误。
- [x] **步骤 7（渲染端）：处理器接 `cancelStream`**
  - 新增处理器调 `useChatStore.getState().cancelStream(sessionId)`（参考 `stores/chat-store/index.ts:541`；先例：`use-channel-auto-reply.ts:448`）。
  - **只停本轮**：**不碰** `clearPendingSessionMessages` / `pausePendingSessionDispatch`；**不用** `bridge.requestStopAgent(runId)`（死代码 + PM 拿不到 `runId`）。
  - **验证检查点**：`npm run typecheck` 零错误。
- [x] **步骤 8：整体实测（第二刀）**
  - 让某项目会话处于运行中 → 全局 PM 调 `stop_session_run` ⇒ 该会话本轮停止、**队列仍在**、**停完能再发消息并正常跑**；其它会话不受影响。
  - **验证检查点**：上述逐条实测通过；`npm test` 全量跑一遍。

## 四·b、步骤清单（第三刀：恢复派发，2026-10-11 补裁）

> 起因：第二刀的「停」走 `cancelStream`，而它内部会 `pausePendingSessionDispatch` ⇒ 停完队列**被冻住**，且**没有自动出口**（自动派发的 `resumePaused` 恒为 `false`）。老大 13:10「那加个方法去触发队列的继续」⇒ 本刀。

- [x] **步骤 9（渲染端）：新增 `resumePendingSessionDispatch`**
  - `hooks/use-chat-actions.ts` 加一个与 `pausePendingSessionDispatch` 对称的导出：**只清暂停标记 + 通知**，不派发。
  - **为什么不复用 `dispatchNextQueuedMessageForSession` 就够**：那条路在「有活跃 run」时直接 `return false` **且不解冻**（`:872-874`）⇒「会话在跑 + 队列被冻」的组合解不开。
  - **验证检查点**：`npm run typecheck` 零错误。
- [x] **步骤 10（渲染端）：处理器 `project/resume-session-queue`**
  - `lib/tools/project-session-queue.ts` 加 `handleProjectResumeSessionQueue`：**先解冻**，再按有没有活跃 run 走两条文案 —— 无活跃 run 立即 `dispatchNextQueuedMessageForSession`；有活跃 run 则说明「本轮结束自动续上」。
  - `lib/ipc/renderer-tool-bridge.ts` 加路由分支。
  - **验证检查点**：`npm run typecheck` 零错误。
- [x] **步骤 11（C# + 主进程）：`resume_session_queue`**
  - `Tools/Providers/ProjectToolsProvider.cs` 工具定义（沿用 `GlobalSideOnly`）；`AgentRuntimeProjectExecutor.cs` 的 `ProjectToolNames` + `ExecuteAsync` switch + `ResumeSessionQueueAsync`；`src/main/ipc/native-agent-runtime.ts` 的 `rendererMethods` 加 `project/resume-session-queue`。
  - 顺带给 `get_session_queue` / `stop_session_run` 的描述补上恢复入口指引（否则 PM 不知道该调它）。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误。
- [x] **步骤 12：门禁 + 测试**
  - `tests/WishfulClaw.GoalRegressionTests/Program.Lifecycle.cs` 全局工具清单 **10 → 11**（新增 `resume_session_queue`）。
  - `npm run typecheck` **0 错误** / `dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误** / `npm test` **68/68**（Goal 335 断言）。
  - **验证检查点**：**实机待验**（PM 会话里停一个带队列的项目会话 → `resume_session_queue` → 队列继续派发；UI 队列面板暂停态消失）。

**提交**：`689e031c feat(project): 全局 PM 可恢复被冻结的会话队列派发（S-188 第三刀）`

---

## 五、涉及文件

| 刀 | 侧 | 文件 | 动作 |
|---|---|---|---|
| 一 / 二 | **C#** | `src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs` | 改 —— 新工具定义 |
| 一 / 二 | **C#** | `src/runtime/WishfulClaw.Agent/.../AgentRuntimeProjectExecutor.cs` | 改 —— `ProjectToolNames` + `ExecuteAsync` 分支 |
| 一 / 二 | **C#** | `src/runtime/WishfulClaw.Agent/.../AgentRuntimeReverseRequests.cs` | 改 —— 新反向请求类型 |
| 一 / 二 | **C#** | `src/runtime/WishfulClaw.Agent/.../ToolDispatchRouter.cs` | 改 —— 登记工具名（如需要） |
| 一 / 二 | 渲染 | `src/renderer/src/lib/tools/`（照 `project-send-message.ts`） | **新增**反向处理器 |
| —— | 渲染 | `src/renderer/src/hooks/use-chat-actions.ts` | **零改动** |
| —— | **DB** | —— | **无迁移** |

（精确路径以实施时实际读到的为准；`AgentRuntime*` 三个文件的所在目录见 `S-188.md` §三。）

---

## 六、参考源码

- `src/renderer/src/lib/tools/project-send-message.ts` —— 渲染端**反向处理器模板**（本需求照抄形状）。
- `AgentRuntimeProjectExecutor.SendSessionMessageAsync` —— C# 侧发反向请求的现成写法。
- `src/renderer/src/hooks/use-chat-actions.ts:726` 的 `_pendingMessages` 与其导出 API（`:297` / `:772` / `:847` / `:950` / `:943`）。
- `src/renderer/src/stores/chat-store/index.ts:541` `cancelStream`；`src/renderer/src/hooks/use-channel-auto-reply.ts:448` 先例。
- 无外部参考项目。

---

## 七、风险

1. **反向请求是本需求的唯一新机制接入点** ⇒ 第一刀先跑通桥路，第二刀再叠「停」。
2. **工具名 / 参数名一旦发布就不好改** ⇒ 命名按 §2.3 定死；改名前先确认没有别处引用。
3. **`get_session_queue` 读的是渲染端内存态** ⇒ 渲染端未启动或会话未加载时，PM 会拿到「空」而不是「错误」，需在返回里区分「空队列」与「查不到该会话」。
