# v2-iter-27 规划合规复审报告

- 复审结论：PASS
- 阻断项：0
- 复审方式：独立只读检查，未修改代码
- 检查对象：`plan.md`、`exploration_findings.md`、`AGENTS.md`、`docs/dev-workflow.md`
- 当前阶段：规划验证通过，等待用户确认后进入执行态

## 上一轮阻断项复核

| 项目 | 结果 | 当前依据 |
|---|---|---|
| 普通消息与临时跟进契约 | PASS | 无 `followUp` 时只发送；显式 `SessionFollowUpRequest` 才创建跟进并返回 `followUpId`；失败语义和禁止 global task/dispatch 已定义。见 `plan.md:58-63` |
| C1.1/C2.1/C2.2/C2.3/C3.1 独立验收 | PASS | 各步骤已增加 schema、契约、调度、状态机、调用链和证据检查点。见 `plan.md:124-139` |
| Native AOT 命令 | PASS | 明确 `DOTNET_ROOT=D:\\claw\\dotnet-sdk` 执行 `npm run build:worker:prod` / `scripts/publish-aot-worker.mjs`，并要求无 IL2026/IL3050/IL3051。见 `plan.md:128`、`plan.md:161` |
| 分层矩阵 | PASS | 已明确 Contracts、Infrastructure、Agent、Main、Worker、Renderer 职责、依赖和注册位置。见 `plan.md:65-77` |

## 全面检查

- FU-A：覆盖更新弹窗尺寸、全屏阅读、下载/托盘/安装闸门及低版本真实升级验证。见 `plan.md:90-106`。
- FU-B：统一扩展活动页状态，覆盖正反向切换和证据。见 `plan.md:108-120`。
- FU-C：覆盖独立跟进持久化、普通 session message、调度、自动唤醒、查询、应用内/渠道反馈；复杂任务维持 global dispatch。见 `plan.md:122-155`。
- FU-D：覆盖重试边界、优先级、有限/无限、取消、完整上下文、流式事件、聚合错误和 Mock Provider。见 `plan.md:157-175`。
- FU-E：覆盖逐步 Mini 门槛、独立代码审查、综合验证报告和用户确认后的发布收尾。见 `plan.md:176-189`。
- 双路径边界：跨会话不等于全局任务；简单任务不写 `global_tasks` / `global_task_dispatches`，复杂任务不经 Todo 升级。见 `plan.md:20-33`、`plan.md:48-63`、`plan.md:134`。
- AOT 与分层：新增 JSON 类型须显式注册 context，Worker 仅做宿主/注册，依赖方向符合项目七层架构。见 `plan.md:65-77`。
- 用户闸门：验证结果和发布收尾均保留用户确认点，未授权前不执行版本发布。见 `plan.md:186-189`。

## 非阻断建议

1. 实现时将 `SessionFollowUpRequest`、状态、响应定义为具名 DTO，并固化事务顺序和补偿路径。
2. 为忙会话延期、重启恢复、重复 reply 与来源唤醒竞态增加可控时钟/集成测试。
3. D5 的 Mock Provider 固化 429/503/超时、成功、取消和下一轮回到首选 Provider 的序列。
4. E4 保存完整 AOT 标准输出、退出码和警告搜索结果；A4 分项记录检查更新、下载、关闭恢复、托盘、安装确认和重启核验。

本报告只证明规划具备执行条件，不代表代码、AOT、真机升级或渠道回归已经通过。
