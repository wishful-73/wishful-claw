# Plan 3: Goal 模式重构 — 自由编排 + 后台优先（用户定位修正）

## 目标
Goal 模式从"固定分解→顺序执行"改为**完全自由编排**：编排器每步由 LLM 决定下一个动作，可根据执行结果自行调整路线；前端降级为**按需检查器**——无推送、纯轮询，不看就是纯后台。

## 设计决策（老大已确认）
1. 立即在当前分支重构（不等 iter-19 修复实测）
2. 面板 = 运行结果查询器：执行中几秒轮询一次可接受，去掉推送流
3. 编排力度：完全自由（LLM 每步决策），接受 token 成本换取灵活性

## 步骤清单
- [x] 步骤1：后端自适应编排循环 `GoalOrchestratorAdaptive.cs`（新）
  - RunAdaptiveAsync：单合成计划（"自适应执行"，复用现有 DB 三层表/面板兼容）+ 循环 ≤24 步：
    每步 DecideNextActionAsync（LLM 看 目标+已执行步骤日志）返回 JSON：
    execute(title/description 含验证标准) | complete(summary) | failed(reason)
  - execute → 复用 ExecuteTaskAsync（含 Verification 行要求）+ 429 退避复用；结果追加进历史
  - 解析连续失败 3 次 → 判失败防死循环；历史喂给决策器用 HeadTail 截断
  - RunAsync 改为路由到自适应循环；旧固定管线方法保留标注 superseded（iter-20 清理）
  - 新增 AdaptiveOrchestratorSystemPrompt / BuildAdaptiveDecisionUserPrompt
  - 推送瘦身：只发 started/completed/failed/paused/resumed，不再逐步发 PlanStarted 等
- [x] 步骤2：前端去推送
  - SubAgentExecutor：goal 运行时 collector 不再转发 tool_call/iteration（goal_activity 断供）
  - GoalHistoryPanel：移除实时活动流块；轮询 10s→5s（仅选中且运行中）
  - chat-store：移除 goal_activity 路由块
- [x] 步骤3：验证（build/tsc/BOM）+ 报告更新

## 涉及文件
- 新建 `src/runtime/WishfulClaw.Agent/Goal/GoalOrchestratorAdaptive.cs`
- `GoalOrchestratorLoop.cs`（路由）、`GoalPromptTemplates.cs`（新提示词）
- `SubAgentExecutor.cs`、`GoalHistoryPanel.tsx`、`stores/chat-store/index.ts`

## 验证标准
1. 新 Goal 不再预分解计划列表，而是逐任务推进；面板单计划下任务持续增长
2. 执行中无 goal_activity/goal_progress 刷屏；面板打开时 5s 轮询可见新任务落库
3. 中途结果可改变后续任务方向（决策器看得到全部历史）
