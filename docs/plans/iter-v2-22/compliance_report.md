# 合规审查报告：v2-iter-22 渠道与定时任务打磨

## 审查结论

结论：通过，可提交规划态检查点；当前没有发现阻断执行的范围、架构或验证缺口。

本审查基于以下已确认材料：

- `docs/plans/iter-v2-22/exploration_findings.md`
- `docs/plans/iter-v2-22/plan.md`
- 用户确认的 v2-iter-22 范围和 v3 延后清单
- 项目既有开发流程、数据存储和分层约束

本报告只审查规划，不授权进入业务代码执行。业务代码修改须等待用户对正式 Plan 的最终执行确认。

## 逐项检查

| 检查项 | 结果 | 依据与说明 |
|---|---|---|
| 微信/飞书渠道打磨 | 通过 | FU-A 覆盖会话标题、名称解析、前缀去重；FU-B 覆盖统一主动发送、参数校验、错误处理和日志。 |
| 会话显示真实用户/群聊名称 | 通过 | Plan 要求私聊优先用户显示名、群聊优先群名；名称缺失时回退 `chatId`，并在步骤1/2设置回归验证。 |
| 修复“飞书/微信”前缀重复 | 通过 | FU-A 将标题生成集中到可复用 helper，renderer hydration 不再无条件拼接，并兼容历史重复前缀标题。 |
| 后台任务向指定渠道会话主动发消息 | 通过 | FU-B 建立不依赖聊天窗口的 Main 内部发送边界，参数包含 `pluginId/pluginType/chatId/content`，并保留微信发送所需 context token。 |
| 定时任务测试与修复 | 通过 | FU-D 步骤10覆盖三种调度模式、时区、启停、编辑、删除、重复触发、重启、Worker 重启、渠道/Agent/通知失败。 |
| 定时任务触发后的微信/飞书通知 | 通过 | FU-D 步骤8/9要求透传 delivery 和渠道目标，执行成功/失败后调用统一发送边界，通知失败只记录错误。 |
| 定时任务 UI 重新设计 | 通过 | FU-E 步骤11-13覆盖 Automation 入口、列表、筛选、表单、日历预览、执行反馈、i18n 和 Reasonix 风格布局。 |
| Cron 进入 SQLite | 通过 | 设计边界明确 SQLite 为配置和任务级运行状态来源；FU-C 步骤5明确表、字段、索引、迁移、CRUD。 |
| 应用重启恢复 | 通过 | FU-C 步骤7明确 Main 启动等待 Worker/DB 可用后恢复 enabled 且未删除任务，并列入重启验证。 |
| 渠道目标持久化 | 通过 | 表字段包含 `deliveryMode/deliveryTarget/pluginId/pluginChatId`，FU-C 步骤5、FU-D 步骤8/9均要求保存和透传。 |
| 任务级最近状态 | 通过 | 设计边界和步骤5明确 `lastFiredAt/lastRunAt/lastRunStatus/lastRunSummary/lastError/fireCount`；未扩大为本迭代的全量执行日志。 |
| AOT 与分层约束 | 通过 | Plan 指定 Infrastructure/Worker 提供 AOT 安全模型和端点，明确补齐 JsonContext；探索报告记录了 Contracts → Core → Infrastructure → Workspace → Persona → Agent → Worker 依赖方向及禁止反射约束。 |
| 每步验证点 | 通过 | 步骤1-15均包含明确验证内容，包含 TS、C# build、AOT publish、diff check 和人工联调。 |
| v3 内容隔离 | 通过 | Plan 目标和“不在本 Plan 内”均明确排除快捷搜索扩展、扩展 Tab、URL 插件、在线翻译/DeepSeek、本地文件搜索、ZIP 容器、XinXiang JSBridge 等 v3 内容。 |
| 未授权执行控制 | 通过 | Plan 末尾明确正式发布、tag、push 不在本 Plan 内；本报告完成后仅提交规划检查点，业务代码等待用户确认。 |

## 架构与实现边界审查

1. SQLite 与 Main 调度职责分离清晰：Worker/Infrastructure 负责数据访问，Main 负责 timer/node-cron 和启动恢复，避免把定时器放入 Worker。
2. 渠道主动发送由 Main 统一封装，Cron 不直接依赖具体渠道服务；发送失败以结果/状态方式反馈，并隔离于调度主循环。
3. Renderer 负责管理 UI 和事件联动，不将任务配置复制到第二套持久化存储；数据库作为恢复来源。
4. 迁移策略覆盖新库和旧库，要求使用 `CREATE TABLE IF NOT EXISTS` 与 `EnsureColumn`，符合现有手写 SQLite DDL 模式。
5. AOT 约束已被显式纳入步骤5/6/14/15，后续实现必须继续避免反射、`Activator.CreateInstance` 和未注册 JSON 类型。

## 执行阶段必须关注的非阻断风险

这些事项不阻断规划提交，但应在对应步骤中落实并记录证据：

- 启动恢复需要明确 Worker 可用、渠道服务初始化和 Agent 执行链路之间的时序，避免恢复任务过早触发。
- 微信的发送上下文与飞书的用户/群聊目标模型不同，不能仅用一个未定义的字符串字段替代渠道特有参数。
- 任务更新、重复触发和应用重启可能产生并发竞态，需要在步骤7、10、14中验证幂等和重复注册保护。
- 历史标题兼容逻辑必须区分占位标题、旧 chatId 标题和用户自定义标题，不能无条件覆盖已有自定义名称。
- 日志只能记录可定位的元数据，不得记录 token、secret 或完整消息内容。
- `deleteAfterRun` 的“归档/删除”语义需在实现时与 DB 的 `deletedAt`、启用状态和 UI 展示规则统一。
- “失败步骤回退到上一个检查点”属于执行流程要求，业务实现阶段每个步骤完成后必须先验证再提交。

## 提交前检查

- [x] 规划覆盖用户明确范围。
- [x] Cron 配置和任务级状态明确进入 SQLite。
- [x] 明确应用启动恢复路径。
- [x] 明确微信/飞书渠道目标持久化和主动发送路径。
- [x] 明确定时任务 UI 入口、管理、表单和执行反馈闭环。
- [x] 每个功能单元包含验证点。
- [x] 纳入 AOT、分层、迁移和敏感日志约束。
- [x] 未把 v3 延后内容带回本迭代。
- [x] 未授权直接进入业务代码执行、merge、tag、push 或发布。

## 后续门槛

规划检查点提交后暂停。只有用户明确确认执行 v2-iter-22，才进入步骤1；执行期间按 Plan 每一步完成验证并立即提交，最终由用户裁定迭代 PASS/FAIL/PARTIAL。
