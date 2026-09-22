# v2-iter-9：Goal 模式（自主跑完迭代）


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
