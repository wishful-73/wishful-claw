# Plan 4: Goal 长时自治化 — 无限重试 + 提醒制 + 里程碑

## 目标
Goal 定位修正为"长时自治子 agent（可跑几天）"：基础设施失败永不判死（无限退避重试），防打转用提醒制而非熔断，重要节点记入时间线。

## 决策（老大确认）
1. 终止条件只剩：LLM 自主宣告 complete/failed、用户 abort、（可选）token 预算耗尽
2. 决策/执行失败 → 指数退避重试（封顶 10 分钟），429 走共享退避
3. 防打转：连续相似动作注入系统提醒让 LLM 自行调整，不硬杀
4. 重要节点：里程碑时间线（轻量记录，不打扰）

## 步骤清单
- [ ] 步骤1：无限重试改造（GoalOrchestratorAdaptive）
  - 删 AdaptiveMaxSteps / AdaptiveMaxConsecutiveParseFailures 熔断
  - 决策失败退避：2s→4s→8s→…封顶 600s，成功后归零；429 保持共享退避
  - 执行失败不重试同任务（结果进日志由决策器自适应），仅决策调用失败才退避重试
- [ ] 步骤2：提醒制防打转
  - 连续 5 次动作（标题+描述归一化）与上次成功进展高度相似 → RenderStepLog 头部注入系统提醒：
    "你最近 N 步在重复相似动作且无新进展。换一种方法，或将任务拆细，或宣告 failed。"
  - 提醒只注入一次/轮，动作有实质变化即清除计数
- [ ] 步骤3：里程碑时间线
  - 每 5 个成功步骤记一条 goal_event（kind=goal_milestone，摘要=近5步标题聚合），复用现有 goal_events 表与面板时间线渲染
- [x] 步骤4：验证（build/BOM）+ 报告更新

## 涉及文件
- `GoalOrchestratorAdaptive.cs`（步骤1/2/3）
- `GoalPromptTemplates.cs`（决策提示词补"可长期运行"语义）

## 验证标准
1. 决策失败不再出现 "failed N times in a row" 判死，日志呈指数退避
2. 重复动作触发提醒注入（日志可见）
3. 每 5 个成功步骤 goal_events 出现 milestone 记录
