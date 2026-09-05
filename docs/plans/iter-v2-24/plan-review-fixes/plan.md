# Plan：v2-iter-24 评审问题修复

> 日期：2026-08-31  
> 分支：`dev/v2-iter-24`  
> 来源：`docs/reviews/review-10-iter24.md`  
> 执行依据：`docs/dev-workflow.md`  
> 用户决策：Task/dispatch 采用 patch 局部列更新；Automation 保持 `fullAccess`；S2 死人人格副本本轮删除；其余先核实。

## 目标

修复 v2-iter-24 全面复核中的合并前阻断问题和已确认的重要正确性问题，强化 scope/运行身份隔离，避免 Task Board 与 dispatch 数据被错误覆盖，并完成死资源清理。OpenAI Responses 工具注入本轮先完成证据核验，只有确认实际缺失时才另行纳入修复。

## 范围与步骤清单

- [ ] 步骤1：修复 `use_capability` 代理权限与运行上下文边界
  - 覆盖 I24-1、I24-3、I24-4、I24-5、I24-6、I24-7、I24-16，以及 S4 的 `sessionMode` 正确性。
  - `list/inspect/call` 使用统一的 `AgentRunContextPolicy` 判断；TaskGet/TaskUpdate 拒绝空 sessionId；dispatch 目标必须是 project scope；回复必须校验调用方；显式 scope 冲突报错；Automation 使用已有有效模式值（project 为 `normal`、global 为 `global`），不引入新的 automation mode。
  - PromptBuilder 位于 Persona 层，不直接依赖 Agent 层策略；由 Agent 层在调用前完成 scope 清洗，并将已解析的 sessionMode/清洗后的参数传入 PromptBuilder，确保身份 prompt、工具过滤和缓存键使用同一上下文。
  - Mini 验证：相关 C# 项目 build；静态检查代理路径不存在绕过权限；补充/运行隔离回归测试。

- [ ] 步骤2：修复 Task Board patch 局部列更新与用户可见行为
  - 覆盖 I24-2、I24-10、I24-13、I24-14。
  - Renderer 只发送定义过的 patch 字段；Worker 按 patch 中实际存在的键构造局部 `UPDATE`。`title`、`description`、`status`、`priority`、`tags`、`dueAt`、`archived` 各自独立更新：未出现的键保持原值；`dueAt: null` 表示明确清空；`archived: false` 表示明确解除归档；`undefined`/MessagePack nil 不得被解释为清空或解除归档。
  - Archive 对不存在任务返回失败；InputArea 按目标 session 读取 Todo；已删除目标会话禁用导航。
  - Mini 验证：TypeScript web/node/root 三配置；DB Task Board 回归覆盖部分更新、明确清空 dueAt、归档保持、Archive not found、空会话 Todo 展示和无效导航。

- [ ] 步骤3：修复 dispatch 局部更新、创建事务与投递失败反馈
  - 覆盖 I24-8、I24-9、I24-12。
  - dispatch Update 只更新 patch 中实际出现的 `instruction`、`status`、`latestReport`、`error`、`completedAt`、`updatedAt` 列；未出现的列保持原值，`latestReport/error/completedAt: null` 表示明确清空。读取、字段校验和 UPDATE 在同一事务内完成，避免跨连接 read-modify-write 覆盖。Update 同时保证状态/完成时间语义一致。
  - dispatch Create 将父 `global_tasks` 存在性、目标 `sessions` 存在性、目标 `scope=project`、`project_id` 一致性校验与 INSERT 放入同一 `ExecuteInTransaction`，阻止目标会话被并发删除后留下悬空记录。
  - `project-send-message.ts` 等待并检查 `sendMessage(): Promise<boolean>`；返回 false 或抛异常时回写 dispatch 为 failed/error，成功后刷新状态；关键失败路径使用统一 main 日志。
  - Mini 验证：C# build；并发/局部 patch/TOCTOU 回归；投递 false、目标会话不存在和正常送达三条路径验证。

- [ ] 步骤4：删除 Worker 死人人格副本并完成低风险工程修复
  - 覆盖 S2、I24-11、I24-15、I24-17、I24-18；仅纳入不改变产品语义的低风险项。
  - 删除前扫描当前代码、csproj、构建配置和运行时资源引用；历史 `docs/plans/iter-6/**`、评审记录和本计划中的路径说明不算运行时引用。确认后只删除 `src/runtime/WishfulClaw.Worker/Resources/Personas/`，不触碰 `WishfulClaw.Persona/Resources/Personas/`。
  - 统一 `src/main/ipc/native-agent-runtime.ts` 的 main 日志；拆分 InputArea 至 500 行以内；为 QR `loadURL` 和相关 fetch 增加超时与窗口清理。
  - Automation 固定 `permissionMode='fullAccess'`，同步修正文案/测试契约，不改权限语义；其有效 `sessionMode` 由步骤1 修为已有值。
  - Mini 验证：限定范围引用扫描；TypeScript 三配置；C# build；QR 超时静态/单测证据；Automation fullAccess 回归。

- [ ] 步骤5：专项核实 OpenAI Responses 工具注入并执行全量验证
  - 覆盖 S3；先验证 `sendMessage → Worker request → AgentLoop → OpenAIResponsesInputWriter` 是否实际补入 `parameters.tools`，重点检查 toolPreset 到 Worker 工具定义的转换点和最终 Responses request body。
  - S3 核验先形成独立证据记录；若工具数组在 Worker 侧已由 preset 注入，则记录为误报/设计差异，不修改；若真实请求 tools 为空，则在该核验记录提交后新增独立修复步骤/功能单元，补回归并单独 commit，不与前述修复混合。
  - 全量验证：C# solution build、Native AOT（0 warning/0 error）、TypeScript web/node/root、既有核心回归、git diff --check；生成 `verification_report.md`，等待用户裁定 PASS/FAIL/PARTIAL。

## 涉及文件与模块

- `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityExecutor.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityDiscovery.cs`
- `src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeTaskExecutor*.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalDispatchReplyExecutor.cs`
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs`
- `src/runtime/WishfulClaw.Agent/AgentLoop.Helpers.cs`
- `src/runtime/WishfulClaw.Agent/Tools/Providers/TaskToolProvider.cs`
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskTools.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskDispatchTools.cs`
- `src/renderer/src/stores/task-board-store.ts`
- `src/renderer/src/components/chat/InputArea/**`
- `src/renderer/src/components/taskboard/TaskDetailPane.tsx`
- `src/renderer/src/lib/tools/project-send-message.ts`
- `src/renderer/src/lib/tools/cron-runtime.ts`
- `src/renderer/src/components/automation/AutomationTaskFormDialog.tsx`
- `src/main/ipc/native-agent-runtime.ts`
- `src/main/ipc/channel-handlers/qr-page-capture.ts`
- `src/main/ipc/channel-handler-utils.ts`
- `src/runtime/WishfulClaw.Worker/Resources/Personas/`
- `docs/plans/iter-v2-24/plan-review-fixes/`

## 约束与决策

- 不重写历史，不修改与本计划无关的已有工作。
- Plan 执行期间每个独立步骤验证通过后本地 commit，不 push；Plan 完成并经用户裁定后再按工作流 push。
- 遵守 AOT 约束：不引入反射、匿名 JSON 序列化或未注册 JsonTypeInfo。
- Automation 继续使用 `fullAccess`；`sessionMode` 必须使用已有有效模式值，不引入新的 automation 模式。
- Task/dispatch 更新必须保留未出现在 patch 中的字段。

## 参考资料

- `docs/reviews/review-10-iter24.md`
- `docs/tool-slimming-analysis.md`
- `docs/persona-slimming-record.md`
- `docs/plans/iter-v2-24/plan.md`
- `docs/dev-workflow.md`
