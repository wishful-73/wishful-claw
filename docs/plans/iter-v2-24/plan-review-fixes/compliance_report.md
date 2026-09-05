# v2-iter-24 评审问题修复计划合规报告

> 日期：2026-08-31  
> 计划：`docs/plans/iter-v2-24/plan-review-fixes/plan.md`  
> 依据：`docs/dev-workflow.md`、`AGENTS.md`、`docs/reviews/review-10-iter24.md`  
> 检查方式：独立只读审查，未修改业务代码。

## 结论

- ❌ 阻断项：0
- ⚠️ 待执行时关注：3
- ✅ 合规项：计划覆盖完整，可进入执行态。

## ✅ 合规项

1. 覆盖 I24-1、I24-2 两个合并前阻断项。
2. 覆盖 I24-3～I24-7、I24-8～I24-10、I24-12～I24-18，以及 S2、S3、S4。
3. 明确采用 patch 局部列更新：未出现在 patch 中的字段保持原值；`dueAt: null`、`archived: false` 等显式值具有独立语义。
4. 明确 Automation 继续使用 `permissionMode='fullAccess'`，不扩大本轮权限语义变更。
5. 明确 Automation 使用已有有效 `sessionMode` 值：project 为 `normal`，global 为 `global`，不引入新的 automation mode。
6. 明确 S2 删除前只扫描当前代码、csproj、构建配置和运行时资源引用；历史计划/评审文档中的路径说明不构成运行时引用；只删除 Worker 下的死副本，不触碰 Persona 层生效资源。
7. 明确 Persona 层不得直接依赖 Agent 层；PromptBuilder 的上下文清洗由 Agent 层完成后传入，避免违反单向分层依赖。
8. 明确 S3 先形成独立核验记录；确认已由 Worker preset 注入时不修改，确认实际为空时新增独立修复步骤和 commit。
9. 每个步骤包含 Mini 验证点；最终包含 C# solution、Native AOT、TypeScript 三配置、核心回归和 `git diff --check`。
10. 遵守 Plan 执行期间本地 commit、不 push；最终验证等待用户裁定 PASS/FAIL/PARTIAL。

## ⚠️ 执行时关注

1. 局部列更新需要区分“属性未出现”和“属性显式为 null”，不能把 MessagePack nil 统一当成清空。
2. dispatch Create 的 scope/project 校验、目标 session 存在性和 INSERT 必须处于同一事务；Update 应避免整行覆写。
3. S3 必须保留最终请求体或等价日志证据，不能仅凭 `use-chat-actions.ts` 不传工具数组就下结论，因为 Worker 可能按 `toolPreset` 注入工具。

## 文件与分层检查

- Agent 修改位于 `WishfulClaw.Agent`，基础 DB 修改位于 `WishfulClaw.Infrastructure`，符合依赖方向。
- PromptBuilder 保持在 `WishfulClaw.Persona`，计划明确不从 Persona 反向引用 Agent。
- Renderer/Main 修改位于既有目录。
- 死资源删除目标限定为 `src/runtime/WishfulClaw.Worker/Resources/Personas/`。
- 实际 AgentLoop 文件为 `AgentLoop.cs`、`AgentLoop.Helpers.cs`，计划路径已修正。
- Automation 表单实际路径为 `src/renderer/src/components/automation/AutomationTaskFormDialog.tsx`。

## 进入执行态条件

计划无 ❌ 阻断项，且用户已确认本轮关键决策：

- Task/dispatch 使用 patch 局部列更新；
- Automation 保持 fullAccess；
- S2 本轮删除；
- 其他事项先核实。

因此计划可进入执行态。