# iter-25 渠道会话 × 全局 Agent 业务健壮度审查

- 性质：只读业务审查，不修改业务代码
- 范围：微信/内置渠道入口 → 全局 Agent 会话 → 项目会话分派 → 项目执行 → reply_global_dispatch 回传
- 基线：`dev/v2-iter-25` 当前工作树
- 结论：主链路可用，但暂不具备长期无人值守的小助手/产品经理健壮度

## 结论摘要

### P0：渠道入口仍可能成为宿主机高权限执行入口

证据：`src/renderer/src/hooks/use-channel-auto-reply.ts:277-279` 将 `channelSession: true` 与 `permissionMode: session.permissionMode` 一起传入；`docs/reviews/review-13-iter25-release-prep.md:40-46` 已记录默认 fullAccess 与渠道入站无 untrusted 包裹的问题。

业务后果：微信用户发来的自然语言会直接进入现有全局/项目 Agent 权限上下文。若会话继承 fullAccess，渠道消息可能触发 Shell、写文件、外发、定时任务等高影响动作。渠道是外部入口，不能等同本机桌面用户已确认。

建议：渠道、Cron、全局分派目标会话统一使用 default 权限；高风险动作必须显式走文本确认或拒绝；渠道入站内容标记为不可信数据。该项应作为渠道上线硬门槛。

### P0：渠道消息与全局 Agent 同一 Session 缺少业务级串行化

证据：`use-channel-auto-reply.ts:260-301` 每条入站消息直接调用 `sendMessage`；review-13 §2 已指出 `sendMessage` 不检查会话是否正在运行，`SessionConversation` 按 sessionId 共享上下文。

复现路径：微信连续快速发送两条消息，或全局 Agent 尚未回复时再次发送；两个 run 可能同时追加/读取同一对话。后发消息可能被前一轮上下文消费，回复顺序与消息顺序错位，分派指令也可能交叉。

建议：按 sessionId 建立单队列；新消息选择排队、合并或明确忙碌回复；必须保证一条消息完成/失败后再消费下一条；每条回复带原始 messageId 关联。

### P1：分派状态存在“已完成后被回写 sent”的竞态

证据：`AgentRuntimeGlobalTaskExecutor.cs:267-279` 投递成功后无条件更新为 sent；`AgentRuntimeGlobalDispatchReplyExecutor.cs:82-103` 目标会话可能已经把同一 dispatch 更新为 completed/blocked。

复现路径：全局 Agent 发起任务 → reverse-request 已触发目标会话 → 目标快速执行并 reply completed → 原 send_work_request 恢复后无条件写 sent。看板与全局 Agent 会看到过期状态，可能重复催办或再次执行。

建议：sent 更新必须带当前状态条件，仅允许 pending → sent；若已是 acknowledged/in_progress/completed/blocked，保持新状态。发送与状态迁移需要幂等语义。

### P1：分派成功不等于项目会话已接受或开始执行

证据：`send_work_request` 创建 dispatch 后通过 `project/send-session-message` 投递，并在 reverse-request 返回成功后标记 sent；业务上 sent 只代表消息投递到会话入口，不代表 Agent 已启动、已理解或会回报。

后果：全局 Agent 可能把 sent 当成项目已经接单；目标会话忙、Worker 重启、provider 失败、权限阻断时，用户只能看到“已发送”，无法区分排队、执行、失败或无人处理。

建议：拆分并展示 created/sent/acknowledged/in_progress/completed/blocked/failed；目标会话收到指令后尽快回 acknowledged；超时自动标记 delivery_timeout，并允许重试但必须去重。

### P1：回传链路失败后只有数据库记录，渠道用户不一定可见

证据：`AgentRuntimeGlobalDispatchReplyExecutor.cs:105-159` 回报先写 DB，向全局会话投递失败只返回 `deliveryNote`；渠道侧的用户反馈依赖全局会话后续产生回复。

后果：项目会话实际上已完成，但全局 Agent 没收到；微信用户看不到结果，分派记录也不会主动触发渠道通知。长期任务会表现为“没有结果”。

建议：回传失败建立可重试 outbox；全局会话恢复时补投递；最终状态变化主动通知原渠道会话，至少发送“任务完成/阻塞，但回传延迟”的可理解消息。

### P1：渠道用户身份与全局 Agent 身份未形成业务授权边界

证据：渠道路由主要按 plugin/chat/session 复用；`send_work_request` 允许全局 Agent 传入目标 session/projectId；当前审查未发现基于 `senderId` 的项目授权、目标会话授权或敏感项目确认闭环。

风险：同一渠道群聊中的成员可能共享同一个全局会话；任何成员都可能读取上下文、创建任务、向项目会话派工或触发外发动作。群聊尤其危险。

建议：明确私聊/群聊策略；按 senderId 建立授权；项目与全局会话绑定允许列表；敏感操作要求管理员确认；所有派工和查询在渠道中显示目标项目和影响范围。

### P1：全局 Agent 的长期上下文可能混入渠道身份/群聊成员语义

证据：渠道会话通过同一 session 持续追加消息，Prompt 仅增加渠道环境说明；当前计划明确“唯一微信聊天路由”，但未建立成员/来源隔离模型。

后果：不同人、不同群、不同任务上下文可能进入同一产品经理会话，造成错误归因、错误记忆、错误派工。

建议：至少将 pluginId + externalChatId + chatType + senderId 纳入上下文边界；群聊默认不复用私聊全局会话；记忆写入包含渠道/会话来源。

### P2：渠道长任务的用户反馈粒度不足

证据：渠道自动回复主要发送文本段和最终剩余文本；未形成统一的“已接收/正在执行/等待项目回报/完成/失败”业务状态协议。

后果：手机端用户不知道 Agent 是否活跃，容易重复发送同一请求，进一步放大并发和重复派工问题。

建议：首条立即回复 receipt；长任务按阶段发送低频状态；重复请求返回已有 dispatchId；最终回复包含任务摘要、目标项目、状态和下一步。

### P2：无限执行策略不适合渠道产品经理角色

证据：`use-channel-auto-reply.ts:280` 传 `maxIterations: 0`；review-13 §3 已指出分派侧同样存在无限轮语义。

后果：provider 异常、工具失败或模型循环时，渠道用户只能等待，无法知道是否卡死；高成本请求可能持续运行。

建议：渠道会话设置默认轮次/时间预算；达到预算发送“仍在执行/需要继续”状态；提供文本取消命令；全局 Agent 与项目分派分别设预算。

### P2：路由复用验证不足以证明消息归属正确

现有回归证明了同一 plugin route 可复用一个 Session，但主要覆盖“一个渠道、一个路由”。尚未形成以下业务矩阵：

- 同一渠道不同私聊联系人隔离；
- 私聊与群聊隔离；
- 群聊不同 sender 权限；
- 渠道重启后未完成任务恢复；
- 同一消息重复投递幂等；
- 全局 Agent 回传到原始渠道而非错误渠道/错误会话。

## 已通过能力

- 微信扫码绑定后自动启动与重启恢复：已有 iter-25 计划和当前改动覆盖。
- 同一路由首次创建与后续复用：已有 `SessionTaskCascadeRegressionTests` 覆盖。
- 全局任务/dispatch/reply 基础闭环：已有回归覆盖。
- 渠道会话工具筛选与通用图片/文件发送工具：当前实现已接入，但未替代上述业务授权与并发风险。

## 建议验收顺序

1. P0：渠道权限强制 default + 入站身份/不可信边界。
2. P0：同一渠道会话单队列，验证 5 条连续消息顺序和上下文不交叉。
3. P1：dispatch 状态条件更新与 acknowledged/in_progress/failed 语义。
4. P1：回传 outbox/补投递，验证 Worker 重启和全局会话暂时不可用。
5. P1：私聊、群聊、不同 sender、不同项目授权矩阵。
6. P2：渠道长任务预算、取消、重复请求去重和用户状态通知。

## 总判定

- 基础路径：PASS（扫码、路由复用、派工和回传在正常单线程场景可走通）。
- 异常与并发：PARTIAL。
- 外部渠道长期无人值守：FAIL，主要阻断为权限边界和 Session 并发。
- 本报告未修改业务代码。
