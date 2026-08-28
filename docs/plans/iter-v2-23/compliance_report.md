# v2-iter-23 规划合规审查报告

> 审查阶段：阶段三，规划验证
>
> 日期：2026-08-27
>
> 审查范围：`plan.md`、`exploration_findings.md`、`draft-plan.md`
>
> 对照规范：`docs/dev-workflow.md`、`AGENTS.md`、`docs/data-storage.md`、`docs/mvp-scope.md`
>
> 本报告为只读规划审查结果，未修改产品代码。
>
> 路线更新（2026-08-28）：本报告审查的是原始规划；其中将正式版发布绑定 v2-iter-23 的结论已被用户延期决策取代。当前迭代只做可靠性与缺陷收口，正式发布移至 v2-iter-26。

## 审查结论

**PASS：0 个阻断项，可进入用户确认环节。**

## 审查结果

### 1. 目标覆盖：PASS

`plan.md` 的步骤完整覆盖当前已确认目标：

- 上下文压缩与手动压缩链路；
- 压缩摘要推送到聊天窗；
- 压缩快照持久化和历史恢复；
- 无快照会话兼容全量恢复；
- 前端历史分页与后端 Agent 上下文解耦；
- 当前进行中轮次 user message 吸附；
- 右上角悬浮操作块重构；
- 工具结果即时持久化与崩溃恢复；
- v2-iter-22 遗留 Electron 集成覆盖；
- 当前迭代全量验证与后续问题交接。

对应位置：`plan.md:9-23`、`plan.md:25-40`。

### 2. 步骤与验证：PASS

步骤 1 至步骤 25 均包含独立验证说明，覆盖：

- IPC/Worker 端点契约；
- AOT JSON 与 MessagePack 边界；
- SQLite 新库 DDL、旧库迁移、损坏数据回退；
- 自动/手动压缩和聊天摘要展示；
- 历史恢复和 UI 分页隔离；
- 当前轮吸附的开始/结束边界；
- 悬浮块操作反馈；
- 工具结果幂等和恢复 reconciliation；
- TypeScript、C#、Native AOT、Electron 验证，以及后续 NSIS/Release Candidate 验证的交接要求。

对应位置：`plan.md:43-114`。

### 3. 项目分层与文件路径：PASS

计划涉及的 Runtime、Infrastructure、Agent、Renderer、Main、Shared 和文档路径符合当前 7 层架构及 Electron 分层。

- DB/Entity/迁移放在 `WishfulClaw.Infrastructure`；
- Agent Loop、压缩、恢复和工具执行放在 `WishfulClaw.Agent`；
- Worker 仅承担端点注册和宿主职责；
- Renderer 负责聊天展示、状态和 UI；
- Shared 负责流式协议；
- Main 只在已有 Cron/channel/background 路径上补可靠性覆盖，不新增无关产品功能。

对应位置：`plan.md:116-161`；规范：`AGENTS.md` 7 层架构。

### 4. AOT / SQLite / MessagePack / IPC：PASS

计划已要求：

- 新增 JSON 类型注册到对应 `JsonSerializerContext`；
- 不使用匿名类型序列化；
- 新库 DDL 和旧库迁移兼容；
- SQL 参数化；
- IPC 通过现有 Worker request / MessagePack 流式协议；
- Native AOT 构建 0 warning / 0 error。

未发现违反 AOT、分层或数据存储规范的设计。

### 5. OpenCowork 参考：PASS

计划列出了具体参考文件和职责：

- `AgentRuntimeContextCompression.cs`：压缩状态和摘要事件；
- `OpenAIChatRuntime.cs`：压缩生命周期；
- `AgentRuntimeToolResultJournal.cs`：工具结果恢复查询；
- `DbSchemaMigrator.cs`：durable journal schema；
- `runtime-reattach.ts`：工具结果 reconciliation；
- `cron-agent-background.ts`：后台工具结果边界 flush；
- `headless-auto-reply.ts`：渠道结果收集和落库；
- `cli/ARCHITECTURE.md`：压缩事件和 transcript result。

计划明确只借鉴行为边界和恢复语义，不直接复制代码，不破坏 Wishful Claw 的命名空间、分层和 AOT 约束。

对应位置：`plan.md:163-173`；详细证据：`exploration_findings.md:105-116,200-211`。

### 6. UI 范围：PASS

计划与用户已确认范围一致：

- 前端默认最近 5 轮仅用于展示；
- 历史加载改为点击触发；
- 当前轮 user message 仅在执行期间吸附；
- 历史会话继续折叠展示；
- 悬浮块改为竖向；
- 加入压缩会话、打开右侧文件夹、聊天区域宽窄调节；
- 移除悬浮块中的清除会话；
- 不做虚拟列表 prepend 闪烁大规模重构。

### 7. 发布门槛：路线已更新

原计划对发布动作设置了用户确认门，但 2026-08-28 用户进一步决定延期正式版：

- v2-iter-23 只完成当前可靠性、缺陷治理和验证交接；
- v2-iter-24 补齐功能与遗留问题；
- v2-iter-25 完成集中修复、全量回归、Native AOT/NSIS 和 Release Candidate 使用观察；
- v2-iter-26 只有在发布门槛满足且用户明确确认后，才执行版本迁移、tag、push、Release 和安装包发布。

因此，原报告中将版本规则迁移绑定 v2-iter-23 的判断不再适用；当前 `0.2.N` 通用规则继续保留。

## 非阻断建议

1. Plan 执行前进一步列明 `src/main` 中具体 Cron/channel/background handler 文件，避免“必要的 handlers”范围过宽。
2. `docs/mvp-scope.md` 将 Cron、渠道列为早期 MVP 外功能；本 Plan 对它们只做已有路径的可靠性覆盖，不新增功能，执行时需保持边界。
3. 工具结果是否引入 Worker durable journal，应先验证现有 messages upsert 是否能满足恢复需求，再决定是否增加新表，避免不必要的双重数据源。
4. 正式版发布已移至 v2-iter-26，必须维持用户确认门；v2-iter-23 的原始规划稿不能作为版本迁移或发布授权。
5. 当前无法访问 GitHub：直连 `git pull origin main` 因 TLS 连接异常失败，代理 `127.0.0.1:7897` 连接也失败；本地 `main` 与 `origin/main` 在此前检查时无 ahead/behind，后续网络恢复后应重新拉取确认。

## 阻断项

无。

## 审查结论

**PASS，0 个阻断项。**

原规划可以进入当时的用户确认环节；当前实际状态以 `plan.md` 为准。v2-iter-23 不执行版本升级或正式发布，后续发布路线按 v2-iter-24 → v2-iter-25 → v2-iter-26 推进。
