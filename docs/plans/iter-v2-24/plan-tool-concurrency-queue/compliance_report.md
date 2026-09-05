# 工具并发等待队列专项规划合规报告

## 总体结论

**PASS（本地复核与回归验证通过）**

计划内容覆盖用户目标和主要实现边界。本次按用户明确要求不使用子代理，因此未执行独立 subagent 审查；以下结论仅代表主代理完成的源码复核、编译和回归测试，不冒充独立审查结论。此前两次独立审查尝试失败的记录保留在下方偏差说明中。

## 审查范围

- `docs/dev-workflow.md`
- `AGENTS.md`
- `docs/plans/iter-v2-24/plan-tool-concurrency-queue/exploration_findings.md`
- `docs/plans/iter-v2-24/plan-tool-concurrency-queue/plan.md`
- `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`
- `src/renderer/src/components/settings/RuntimePanel.tsx`
- renderer 设置存储、请求构造、sidecar mapping 和协议类型
- 当前工作区未提交差异与 Git 历史 `43c1b653`

## 本地只读复核结果

### ✅ 通过项

1. **根因定位准确**：计划正确区分了 `maxParallelTools` 的 `SemaphoreSlim.WaitAsync` 等待槽位，以及 `maxToolCallsPerTurn` 在进入 semaphore 前执行 `Take(...)` 的硬截断。
2. **目标覆盖完整**：计划要求完整 tool call batch 进入已有等待队列，同时运行数不超过配置值，超出部分不再生成 `Skipped: ... Retry this call next turn.` 错误。
3. **最小实现边界合理**：不重写通用 limiter，不修改单个工具执行器，不改变工具结果持久化和数据库 schema。
4. **子 Agent 边界正确**：计划明确保留 `SubAgentConcurrencyLimiter` 和 `maxConcurrentSubAgents` 独立语义，Task 工具不与普通工具混用同一上限。
5. **审批顺序已覆盖**：计划要求核对 default permission mode 的 approval barrier，避免队列调整破坏需要审批工具的顺序门控。
6. **失败与取消已覆盖**：测试范围包含工具失败后释放槽位、等待任务继续，以及取消后未开始调用不再启动。
7. **请求入口覆盖较完整**：普通聊天、继续/重试、后台唤醒、渠道自动回复和跨会话消息均列入清理范围。
8. **兼容策略明确**：旧 settings JSON 中的 `maxToolCallsPerTurn` 字段允许继续存在，但新版 UI 不展示、新请求不发送、Worker 不再用它拒绝调用。
9. **工作区隔离已记录**：计划明确当前压缩显示专项存在 7 个未提交文件，禁止 stash/reset/checkout，并要求避免或精确隔离 `chat-store/index.ts`。
10. **验证命令完整**：包含三套 TypeScript、相关 C# 回归测试、Agent build、solution/隔离输出 build 和 `git diff --check`。

### ⚠️ 建议项

1. `maxToolCallsPerTurn` 原本承担“防模型一次生成过多工具”的保护作用。移除后仍有并发限制但不再有队列长度上限；实现和验证报告应明确这是用户要求的行为变化，而非遗漏。
2. 若清理 renderer 请求类型需要修改当前压缩专项已改动的 `chat-store/index.ts`，优先保留局部兼容字段而不是扩大冲突面；该死字段可在压缩专项提交后单独清理。
3. 回归测试最好直接验证执行峰值和所有调用完成，不只断言返回数量；否则无法证明真实等待而不是串行或提前完成。
4. 取消测试应区分“正在运行的调用”和“仍等待槽位的调用”，只要求后者不启动；已运行调用按现有 cancellation token 语义终止。
5. 如果 solution build 被运行中的 Worker 锁定，应使用独立输出目录验证，不能强制结束用户进程。

### ℹ️ 偏差说明

1. **独立 subagent 规划审查未执行**：此前两次审查均在读取源码前失败；随后用户明确要求“不用子代理，正常执行”，因此本次以主代理源码复核、可执行回归测试和构建结果作为验证依据。

## 需要修订的具体段落

本地复核未发现必须修订的业务规划缺口。独立审查未执行是按用户明确要求跳过，不代表计划或实现存在已知错误。

执行前需要用户明确确认以下范围决策：

- 从设置页移除“每轮最大工具调用数”；
- 新请求不再发送 `maxToolCallsPerTurn`；
- Worker 即使收到旧客户端字段也忽略它；
- 所有工具只受“最大并行工具数”控制，超出部分进入等待队列；
- 旧 settings 字段暂时保留兼容，不做配置文件迁移删除。

## 后续条件

本次已按用户确认的方向完成执行。独立子代理审查未执行；本地源码复核、回归测试和构建验证均已通过。不提交、不 push，等待用户测试确认。
