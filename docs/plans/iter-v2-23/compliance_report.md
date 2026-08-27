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
- `v1.0.0` 正式版验证与发布。

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
- TypeScript、C#、Native AOT、Electron、NSIS 和 Release 验证。

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

### 7. 发布门槛：PASS

计划多处明确：

- 规划稿和文件头未授权提前发布；
- 必须先完成构建、AOT、集成、安装和人工验收；
- 必须等待用户确认迭代完结；
- 之后才更新版本、合并 main、创建 tag、push、创建 Release 和上传安装包。

对应位置：`plan.md:1-7`、`plan.md:175-180`。

`v1.0.0` 将替代当前 `0.2.N` 规则，计划已把 `AGENTS.md` 和相关文档同步更新列为发布步骤。执行阶段需再次明确：这是用户确认正式版完结后的版本规则迁移，不得提前按旧规则打 `v0.2.23`。

## 非阻断建议

1. Plan 执行前进一步列明 `src/main` 中具体 Cron/channel/background handler 文件，避免“必要的 handlers”范围过宽。
2. `docs/mvp-scope.md` 将 Cron、渠道列为早期 MVP 外功能；本 Plan 对它们只做已有路径的可靠性覆盖，不新增功能，执行时需保持边界。
3. 工具结果是否引入 Worker durable journal，应先验证现有 messages upsert 是否能满足恢复需求，再决定是否增加新表，避免不必要的双重数据源。
4. `v1.0.0` 发布动作必须维持用户确认门；当前计划仅是规划稿，不能据此自行发布。
5. 当前无法访问 GitHub：直连 `git pull origin main` 因 TLS 连接异常失败，代理 `127.0.0.1:7897` 连接也失败；本地 `main` 与 `origin/main` 在此前检查时无 ahead/behind，后续网络恢复后应重新拉取确认。

## 阻断项

无。

## 审查结论

**PASS，0 个阻断项。**

可以进入用户确认环节。用户确认 Plan 方向后，才进入产品代码执行态；用户未确认前，不执行数据库迁移、手动压缩端点、UI 改造、工具结果持久化、版本升级或发布动作。
