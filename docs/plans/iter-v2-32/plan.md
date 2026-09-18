# Plan: v2-iter-32 体验收口与沙箱边界

> 分支 `dev/v2-iter-32`（base `main` @ `2498dcae`，v0.2.31）。
> 需求文档（权威）：`docs/plans/iter-v2-32/raw-requirements.md`，编号 S-72 ~ S-79，共 8 项。
> 本迭代节奏放缓，需求逐步积攒；追加项直接续编号写进 raw-requirements 并在本文档补小节。
> 规划验证报告：`docs/plans/iter-v2-32/compliance_report.md`（首轮 FAIL，3 项阻断已按报告修入本文档）。

## 目标

修掉一批**输入框与聊天窗的交互粗糙点**（按钮语义、工具栏间距、聊天窗被挤扁、压缩片段时间、todo 面板条数），
补上两个**成本与安全**能力（会话级上下文上限、工具路径边界校验），
并把**审批弹窗**的长正文收进视口。

## 实施顺序与理由

| # | 需求 | 为什么排这里 |
|---|---|---|
| 1 | **S-74** 工具栏间距收窄 | 纯 class 改动，风险最低；且**是 S-75 的前置**（间距直接决定聊天窗最低宽度的阈值） |
| 2 | **S-75** 聊天窗最低宽度保护 | 依赖 S-74 定下的间距；改布局常量，影响面比 S-74 大 |
| 3 | **S-76** 压缩片段时间 | 渲染端单链路，改的是既有函数，风险可控 |
| 4 | **S-77** todo 面板单行截断 + 切批 | 渲染端；含一条待裁定口径（切批规则暂取推荐 A） |
| 5 | **S-78** 审批弹窗高度上限 | 动 UI 原语，影响 `confirm()` 全部调用点，需回归面确认 |
| 6 | **S-72** 发送/终止按钮语义 | 单点改动，但依赖上游入队链（iter-30 S-58 打的地基） |
| 7 | **S-73** 会话级上下文上限 | 跨 Worker 4 处读取点 + 渲染端 2 处 + 透传链路，改动面中等 |
| 8 | **S-79** 沙箱路径边界 | C# 为主，改动面最大，放最后一段完整时间做 |

## 待用户裁定项（进入执行前确认）

这些是 raw-requirements 里明确标注「待定」的，实施时不能当默认成立：

| # | 项 | 本文档暂取值 | 出处 |
|---|---|---|---|
| V1 | **S-73** UI 入口位置 | 暂定 `context-ring`（输入框右下角那个上下文环） | raw §64⑤、§88 |
| V2 | **S-73** 新会话默认态 | 暂定**默认关**（= 保持现状，不改变老用户行为） | raw §91 |
| V3 | **S-77** 切批规则 | 暂取**推荐 A**（渲染端只显示当前批次，数据一字不动） | raw §336-341 |
| V4 | **S-75** 聊天窗最低宽度数值 | 待 S-74 落地后**真机实测**再定（粗估 ≈800px） | raw §217-230 |
| V5 | **S-75** 的 `::-webkit-scrollbar` 全局规则修不修 | 暂定**本迭代不动**，只把它记成已知限制 | raw §201-210 |
| V6 | **S-73** 是否另给下拉档位（128K / 256K） | 暂按**固定 256K、不给下拉** | raw §91 |

## 步骤清单

### S-74 输入框底部工具栏控件间距过宽

落点 `src/renderer/src/components/chat/InputArea/composer-toolbar.tsx`。
实测三处 gap：`:225` 外层 `justify-between gap-2`、`:227` 内层 `gap-2`（承载左右两组）、`:228` 左组末 `gap-2`、`:253` 右组 `gap-1.5`。

- [ ] 步骤 1：`:228` 左侧组 `gap-2` → `gap-0.5`（控件自带 `px-2`，让它们自己承担分隔）
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误（本步仅编译门禁，呈现留待步骤 4）
- [ ] 步骤 2：`:253` 右侧组 `gap-1.5` → `gap-1`（图标按钮无 `px-2` 兜底，不能一刀切）
  - 验证：同上
- [ ] 步骤 3：`:225` 外层与 `:227` 内层两处 `gap-2` → `gap-1`
  - 验证：同上
- [ ] 步骤 4：整体测通 —— 真机看工具栏：相邻控件不再显得散；相邻 hover 底色块**不粘连**；左侧组控件不被裁
  - 验证：`tsconfig.web.json` + `tsconfig.node.json` 零错误；真机截图

### S-75 聊天窗最低宽度保护

落点 `src/renderer/src/components/layout/right-panel-defs.ts`（常量 + 两个 clamp）+
`MainLayout.tsx` 或右面板宽度消费处（触发收起逻辑）。

- [ ] 步骤 1：定**聊天窗最低宽度常量**（按 raw 估算 ≈800px 量级，取「宁大勿小」；S-74 落地后真机校准，见 V4）
  - 验证：常量落库，写注释说明来源与「必须 ≥ 输入框自然宽度」这条硬约束
- [ ] 步骤 2：`clampRightPanelWidth`（`right-panel-defs.ts:19-26`）上限由 `min(∞, 视口 × 0.8)` 改为 `视口 − 最低宽度`（`0.8` 退居兜底）
  - 验证：tsc 零错误
- [ ] 步骤 3：`clampLeftSidebarWidth`（`right-panel-defs.ts:15-17`，现为定值 420）按**同一口径**收口为 `min(420, 视口 − 最低宽度)` —— 左侧单独拖宽同样能挤爆聊天窗（raw §234）
  - 验证：tsc 零错误
- [ ] 步骤 4：加**统一判定函数**（聊天窗会被挤到下限 → 收起另一侧），供展开/收起路径与拖拽路径共用
  - 落点**定死**：判定收在 `useUIStore` 的 `setLeftSidebarOpen` / `setRightPanelOpen` / `setRightPanelWidth` 三个 setter 内，
    避免在散落的调用点（`register.ts`、`team-native-ui.ts`、`ConversationGuideDialog.tsx`、`PreviewPanel.tsx`、`RightPanel.tsx`）各判一次
  - 验证：函数是纯函数、可单测；拖拽路径（`RightPanel.tsx:143`）与开关路径都调到它
- [ ] 步骤 5：处理**退化分支** —— 两侧都关 / 无处可收时保持现状，不出现互相收或抖动
  - 验证：逻辑分支有注释说明；真机把窗口拖到极窄不进入循环
- [ ] 步骤 6：整体测通 —— 真机：开右侧挤到下限自动收左侧；反向对称；拖拽（含单独拖宽左侧）同样触发
  - 验证：tsc 三配置零错误；真机截图/录屏
- 备注（V5，不在本需求范围）：`assets/main.css:302-305` 那条裸写在 `@layer` 外的全局 `::-webkit-scrollbar { height: 5px }`
  会让 `[scrollbar-width:none]` 失效并占位撑高工具栏 —— 本迭代**不改**，只作为**已知限制**写进 raw-requirements

### S-76 压缩片段各自显示「那一刀」的时间

落点 `src/renderer/src/components/chat/renderable-chat-items.ts`（`createAssistantFragment` 调用处附近）+
`MessageItem.tsx` / `AssistantMessage/*`（消费端）。

- [ ] 步骤 1：在切分处按 `splits` 顺序给每段算出**首尾相接**的 `createdAt` / `updatedAt`（取压缩工件对的 `createdAt`）
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误；无压缩消息走原路径（`splits` 为空 ⇒ 不产生 fragment）
- [ ] 步骤 2：末段加**整轮总耗时**（复用 S-54 既有值），只在有切分时出现
  - 验证：同上
- [ ] 步骤 3：边界兜底 —— 压缩时间缺失时该段退化回原复制值；`live` 段用 `liveState.startedAt`
  - 验证：同上（本步仅编译门禁，时间呈现留待步骤 4）
- [ ] 步骤 4：整体测通 —— 真机：一次压缩后各折叠块显示递增的分段耗时，末段带总耗时；无压缩消息不变
  - 验证：tsc 三配置零错误；真机截图

### S-77 会话 todo 面板：单条单行 + 切批

落点 `src/renderer/src/components/chat/SessionTodoPanel.tsx`。

- [ ] 步骤 1：单条正文（`:212-220` `min-w-0 break-words`）由折行改为**单行截断**（省略号）
  - 验证：tsc 零错误（本步仅编译门禁，呈现留待步骤 4）
- [ ] 步骤 2：整行常挂 `title` = 全文；与 `inProgressHint`（`:195`，待续/已过期提示）**合并**，两者都不丢
  - 验证：tsc 零错误；真机 hover 出全文且待续态仍能看到解释
- [ ] 步骤 3：按 **V3（推荐 A）** 实现切批过滤 —— 渲染端只显示「当前批次」，数据一字不动
  - 切批规则：上一批全部 `completed` 之后新建的第一个任务 = 新批起点
  - 计数（`:130` `total: tasks.length`）改为与列表同口径
  - 验证：抽成纯函数并单测（`tests/session-todo-batch/program.ts`）
- [ ] 步骤 4：整体测通 —— 真机：6 条任务 = 6 行；第二批开始时计数不累加
  - 验证：tsc 三配置零错误 + 新增单测通过；真机截图
- 备注：本需求**不动文案**，计数沿用现有 `todo.tasksDone` 的 `{completed,total}` 插值 ⇒ `locales/*/chat.json` 见「涉及文件」的说明

### S-78 审批弹窗正文过多时撑出弹窗

落点 `src/renderer/src/components/ui/alert-dialog.tsx`（原语）+ `components/ui/confirm-dialog.tsx`（正文区）+
`lib/tools/sub-agent-approval.ts`（传 `descriptionVariant: 'code'`）。

- [ ] 步骤 1：`AlertDialogContent`（`:41`，现仅 `max-w-lg`）加视口上限 `max-h-[calc(100vh-2rem)]` + 显式 `grid-rows` 行模板 + `overflow-hidden`（`grid` 只加 `max-h` 压不住行高）
  - 验证：tsc 零错误
- [ ] 步骤 2：标题 `shrink-0`，不被正文挤扁
  - 验证：tsc 零错误
- [ ] 步骤 3：`confirm-dialog.tsx` 正文区加自滚层：`min-h-0` + `max-h` + `overflow-y-auto` + `whitespace-pre-wrap` + `break-words`
  - 滚动只发生在正文，标题与底部按钮钉住
  - 验证：tsc 零错误
- [ ] 步骤 4：`ConfirmOptions` 加可选 `descriptionVariant?: 'code'`，只给审批弹窗开等宽字体；其余调用点零改动
  - 验证：tsc 零错误；`git diff` 确认调用点未被波及（raw §384 记 28 处，**实读 grep 为 26 处**，以 `git diff` 实数为准）
- [ ] 步骤 5：整体测通 —— 真机：超长 shell 命令的审批弹窗不出视口、正文可滚、换行保留；短内容弹窗与现在一致
  - 验证：tsc 三配置零错误；真机截图（长/短两种）

### S-72 发送/终止按钮语义

落点 `src/renderer/src/components/chat/InputArea/composer-toolbar.tsx`（`sendControl`，`:191` `onClick={isStreaming ? onStop : onSend}`）。

- [ ] 步骤 1：核实**点按钮与回车完全同路径**（同一 `handleSend`、同样清稿、同样进队列面板）
  - 验证：读代码给出结论，写进 raw-requirements 的「待核实」
- [ ] 步骤 2：`isStreaming` 下的分支改为复用非流式已有判据（`:195` `!text.trim() && attachedImagesCount === 0`）：
  **有内容 → `onSend`（入队）；无内容 → `onStop`**
  - 验证：tsc 零错误
- [ ] 步骤 3：按钮文案/图标随「有无内容」分流（有内容仍显示发送，无内容显示终止）
  - 验证：tsc 零错误
- [ ] 步骤 4：整体测通 —— 真机：agent 运行中，输入框有内容时按钮是「发送」且点击进队列；清空后变「终止」
  - 验证：tsc 三配置零错误；真机截图

### S-73 会话级「请求上下文上限」开关

落点：Worker 侧 cap 施加（`AgentLoop.ContextCompression.cs` / `AgentLoop.cs` / `ContextCompression.cs` 的
`contextLength` 读取层）+ 渲染端（`InputArea/context-ring.tsx` + `lib/agent/context-compression.ts`）+
会话列（`DbClient.cs` 加列 + `DbSessionTools.cs` 读写）+ UI 入口（V1）。

- [ ] 步骤 1：定性 cap 的施加点 —— 优先「合成虚拟 contextLength 在读取层统一替换」（四条读取点零改动：
  `AgentLoop.ContextCompression.cs:38`、`AgentLoop.cs:658`、`ContextCompression.cs:282`、`ContextCompression.cs:350`）
  - 验证：给出结论并写入 raw-requirements 的待探索 ①
- [ ] 步骤 2：会话级字段落库 —— **`DbClient.cs` 的 `EnsureColumn("sessions", <新列>, "TEXT")`（`:521-537` 那个迁移列表，S-59 的 `permission_mode` 就在 `:537`）+ `DbSessionTools.cs` 读写映射**
  - 注意：加列机制**不在** `DbSessionTools.cs`（该文件 `EnsureColumn` 零命中），两个文件都要动
  - 验证：C# 编译 0 警告 0 错误；migration 走 `DbClient.EnsureColumn`
- [ ] 步骤 3：Worker 侧按 cap 夹心有效窗口（`min(真实 contextLength, 256K)`，仅对 >256K 的模型生效）
  - 验证：C# 回归套件全过 + 新增断言
- [ ] 步骤 4：渲染端同口径（`context-ring` 的有效窗口跟着变；模型档案里的 `contextLength` **保持真值**）
  - 验证：tsc 零错误
- [ ] 步骤 5：UI 入口（V1 暂定 `context-ring`）+ 落 run params（**透传链全补**，不是「之一」——与会话字段同口径）
  - 验证：tsc 零错误；真机可见可切
- [ ] 步骤 6：整体测通 —— 真机：1M 模型开会话级上限后，环上显示 256K 且到阈值触发压缩；关闭后恢复 1M
  - 验证：tsc 三配置零错误 + C# 全回归；真机截图
- 备注（V2）：默认态暂定**关**（保持现状）。`stores/settings-store*` **不是**本需求的开关落点（raw §49 明确「会话级，不需要全局」），
  仅当 UI 需要记住「上次选择」这类纯偏好时才动，实施时若不需要就从「涉及文件」移除

### S-79 沙箱：工具参数的工作目录边界校验

落点 `src/runtime/WishfulClaw.Agent/Tools/ToolHelpers.cs`（三个 helper 内加判定）+ 开关接入
（`settings-store` + run params）+ 路由端开关透传。

- [ ] 步骤 1：实现**边界判定纯函数**：路径规范化 + 目录边界（`C:\a` 不匹配 `C:\abc`）+ 大小写
  - 验证：单测覆盖（相等 / 子目录 / 前缀陷阱 / 相对路径 / `\..` 逃逸）
- [ ] 步骤 2：把判定接进 `ResolveFilePath` / `ResolveSearchPath` / `ResolveCwd`，越界**显式失败**（不静默回退）
  - 验证：C# 编译 0/0
- [ ] 步骤 3：根集合构造 —— 项目会话取自身 `workingFolder`；全局会话取**全部非 SSH 项目 `workingFolder` 的并集**（`ssh_connection_id` 非空的不参与）
  - 验证：单测覆盖（空集合 ⇒ 视为未开；SSH 项目被排除）
- [ ] 步骤 4：开关（全局 settings，默认**开**）接入 Worker，经 run params 下发
  - **透传链全补**（对齐同类全局开关 `contextCompressionEnabled` 的实际散布点）：
    `hooks/use-chat-actions.ts`（4 处）、`hooks/use-channel-auto-reply.ts`、`hooks/use-background-subagent-wakeup.ts`、
    `lib/.../provider-auto-fallback.ts`、`lib/.../project-send-message.ts`
  - 验证：C# 编译 0/0；默认开、可关；**渠道会话与后台唤醒路径同样透传**（渠道在生效范围内，漏传会关不掉）
- [ ] 步骤 5：**覆盖审计**（raw §495-497 明确要求）—— 逐个确认以下面是否也经 helper，未覆盖的**写进 raw-requirements 的能力边界说明**，
  不能留下「默认开 + 用户以为全防住」的失真：
  - `Monitor`（也执行命令）
  - `use_capability` 代理路径（raw §416 已知 `AgentRuntimeUseCapabilityExecutor` **不经过** `ResolveFilePath`）
  - 子代理 / cron / skill 内部的工具调用
  - MCP 工具自身的路径参数
  - 验证：审计结论逐条落进 raw-requirements；审计到的文件补进「涉及文件」
- [ ] 步骤 6：错误文案给出路（「关闭沙箱开关 / 把该目录设为工作目录」）+ i18n zh/en
  - 验证：tsc 零错误；两个 locale JSON 合法
- [ ] 步骤 7：整体测通 —— 真机：项目内读写正常；往项目外写被拒且报文清晰；关掉开关后放行
  - 验证：tsc 三配置零错误 + C# 全回归 + AOT 无 IL2026/IL3050/IL3051；真机截图

## 涉及文件

**新增**
- `docs/plans/iter-v2-32/plan.md`、`exploration_findings.md`、`compliance_report.md` — 本阶段产物
- `tests/session-todo-batch/program.ts` — S-77 切批规则单测（TS）
- `tests/WishfulClaw.GoalRegressionTests/Program.SandboxPath.cs` — S-79 边界判定单测（C#，挂在既有回归套件内，不新开工程）

**修改（按需求分组）**
- S-74：`src/renderer/src/components/chat/InputArea/composer-toolbar.tsx`
- S-75：`src/renderer/src/components/layout/right-panel-defs.ts`（两个 clamp）、`stores/ui-store.ts`（三步判定收进 setter）、`components/layout/RightPanel.tsx`（拖拽路径）、`components/layout/MainLayout.tsx`（如需）
- S-76：`src/renderer/src/components/chat/renderable-chat-items.ts`、`components/chat/MessageItem.tsx`、`components/chat/AssistantMessage/{index.tsx,action-bar.tsx,types.ts}`
- S-77：`src/renderer/src/components/chat/SessionTodoPanel.tsx`、`tests/session-todo-batch/program.ts`、`package.json`（登记测试脚本）
  - `locales/*/chat.json`：**仅当**切批需要新文案时才动；不需要则从本清单移除
- S-78：`src/renderer/src/components/ui/alert-dialog.tsx`、`components/ui/confirm-dialog.tsx`、`lib/tools/sub-agent-approval.ts`
- S-72：`src/renderer/src/components/chat/InputArea/composer-toolbar.tsx`、`components/chat/InputArea/index.tsx`（如需）
- S-73：`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`（加列）、`Db/DbSessionTools.cs`（读写）、`src/runtime/WishfulClaw.Agent/AgentLoop.ContextCompression.cs`、`AgentLoop.cs`、`ContextCompression.cs`、`src/renderer/src/components/chat/InputArea/context-ring.tsx`、`src/renderer/src/lib/agent/context-compression.ts`
- S-79：`src/runtime/WishfulClaw.Agent/Tools/ToolHelpers.cs`、`Tools/ShellTools/ShellExecuteTool.Helpers.cs`、`ToolCallProcessor.cs`（root 集合注入）、`src/renderer/src/stores/settings-store*`、`hooks/use-chat-actions.ts`、`hooks/use-channel-auto-reply.ts`、`hooks/use-background-subagent-wakeup.ts`、`lib/agent/provider-auto-fallback.ts`、`lib/tools/project-send-message.ts`、`stores/chat-store/index.ts`（如 run params 定义在此）、`locales/{zh,en}/settings.json`（错误文案）
- 各需求新测试脚本对应的 `package.json` 登记

**文档**
- `docs/plans/iter-v2-32/raw-requirements.md` — 各需求补「核实结论 / 实施记录」
- `docs/PROGRESS.md` — 阶段三完成后更新

## 参考源码

- **`D:\claw\OpenCowork`** — 布局与聊天窗组件的移植来源（S-74 / S-75 的容器结构）。在 AGENTS.md「参考源码」表内（`AGENTS.md:194`）。
- **`D:\claw\deepseek-harness`** — **不在 AGENTS.md 白名单**，仅作 S-79 的**子系统文档写法**参考
  （`docs/subsystems/*.zh.md` 的契约式写法：不变量 + 失败语义），不搬其代码。
- 本仓既有先例（**优先照本仓风格，不照搬参考项目**）：
  - S-73 的「会话级设置」形态 → S-59 `permissionMode`（`DbClient.EnsureColumn` 加列 + `DbSessionTools` 读写 + 渲染端归一化）
  - S-79 的「判据收进单一谓词」→ S-51 `AgentRunContextPolicy.IsToolAllowed`
  - S-77 的「渲染端过滤、数据不动」→ S-34 会话 todo 三态（agent 说了算，代码只对齐展示）

## 门禁（每个需求提交前必过）

1. `npx tsc --noEmit -p tsconfig.web.json` / `-p tsconfig.node.json` / `-p tsconfig.json` —— **三配置零错误**
2. **遍历 `package.json` 里所有 `test*` 脚本**逐个跑（`npm run test:*` 里的 `*` 不会被 `npm` 展开，要按脚本名逐个执行）；新增脚本必须先登记进 `package.json`
3. 动 C# 时：Worker 编译 0 警告 0 错误 + `tests/WishfulClaw.Tests.sln` 0/0 + 10 个回归套件全过
4. 发布前 AOT：`npm run build:worker:prod` **不得有 IL2026 / IL3050 / IL3051**
5. 触碰文件 **BOM clean**（首三字节非 `EF BB BF`）
