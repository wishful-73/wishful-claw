# 探索报告：v2-iter-22 渠道与定时任务打磨

## 目标范围

用户确认本迭代包含：

- 微信/飞书渠道打磨；
- 会话首次创建时显示“渠道前缀 + 机器人名称”固定标题；
- 避免重复拼接“飞书/微信”前缀；
- 渠道会话主动发消息；
- 定时任务功能测试与修复；
- 定时任务触发后通过渠道主动通知；
- 定时任务 UI 重新设计；
- 定时任务必须进入数据库，支持重启恢复。

快捷搜索扩展、URL 插件、扩展 Tab、轻应用容器全部移至 v3，本迭代不做。

## 当前项目状态

- 当前基线：`main`，产品版本 `0.2.21`，最新正式 tag `v0.2.21`。
- 当前开发分支：`dev/v2-iter-22`，从干净的 `main` 创建。
- 前端是 Electron + React；后端是 Native AOT .NET Worker；IPC 使用 MessagePack。
- `docs/dev-workflow.md` 要求：探索报告 → Plan → 合规报告 → 用户确认 → 执行；每步 Mini 验证并 commit，Plan 完成后 push。
- 数据库是全局 `~/.wishful-claw/index.db`，由 `WishfulClaw.Infrastructure.Db.DbClient` 手写 DDL 初始化。

## 渠道现状

### 入站消息与会话路由

- `src/main/channels/auto-reply.ts`
  - 接收入站 `incoming_message`；
  - 调用 Worker `db/plugin-route-session` 按 `pluginId + chatId` 路由会话；
  - 当前在 Main 侧生成渠道前缀标题，并尝试更新 DB；
  - 发送 `plugin:session-task` 到 renderer；
  - 本迭代标题规则改为首次创建时使用渠道连接配置中的机器人名称，后续消息复用已有标题。

- `src/renderer/src/hooks/use-channel-auto-reply.ts`
  - 收到 `plugin:session-task` 后创建 renderer 会话快照；
  - 当前又调用 `buildSessionTitle` 生成一次渠道前缀标题；
  - Agent 完成后通过 `IPC.PLUGIN_EXEC` 的 `sendMessage` 将最终文本发回渠道。

### 渠道机器人名称与会话标题

- 飞书连接启动时可以取得 Agent 机器人名称，例如 `心相助手`；首次创建会话的标题应为 `飞书:心相助手`。
- 微信使用同样规则，首次创建会话的标题应为 `微信:<机器人名称>`；名称缺失时回退为 `飞书对话`/`微信对话`。
- `DbPluginSessionTools` 已有会话路由、会话标题更新和外部聊天 ID 存储能力；后续消息不得重新生成标题。
- 用户名称、群聊名称、发送者名称不参与本迭代的会话标题生成，但仍可保留在消息元数据中。

### 已识别问题

1. 标题构建逻辑重复存在于 Main 和 renderer 两处，容易出现 `飞书:飞书:心相助手`。
2. 首次创建、已有会话复用和机器人名称缺失回退没有集中在一个函数中。
3. 渠道主动消息底层能力已存在，但需要形成一个可被 Cron 调用的稳定发送边界，并将失败结果隔离，不得阻断调度器。

## Cron 现状

### 调度器

- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts`
  - 使用 `Map<string, CronJob>` 保存任务；
  - `setTimeout` 支持 `at`；
  - `setInterval` 支持 `every`；
  - `node-cron` 支持 `cron` 表达式和时区；
  - `fireJob` 只向 renderer 发送 `cron:fire`，并更新内存中的 `lastFiredAt/fireCount`；
  - `deleteAfterRun` 只修改内存状态；
  - 应用重启后所有任务丢失。

### 工具与 IPC

- `src/renderer/src/lib/tools/cron-tool.ts` 已注册 CronAdd/CronCreate/CronUpdate/CronRemove/CronDelete/CronList，执行已迁移到 Native Worker。
- `src/runtime/WishfulClaw.Agent/AgentRuntimeCronExecutor.cs` 将工具调用反向请求到 Main 的 `cron:add/update/delete/list`。
- `src/renderer/src/lib/ipc/messagepack-channel-routing.ts` 已预留 `cron:add/update/remove/delete/list/toggle/run-now/...` 等通道，但当前反向处理器只完整实现 add/update/delete/list 基础路径。
- `src/renderer/src/lib/tools/cron-events.ts` 已定义 fired、run_started、run_progress、run_finished、job_removed 事件类型，但没有发现完整的 Cron 管理 UI 消费链路。
- `src/renderer/src/components/layout/MainLayout.tsx` 中 `tasks` 仍显示 `PlaceholderPage`，标题为 Automation。
- `WorkspaceSidebar` 已有 Automation 入口，调用 `openTasksPage`。
- UI 设计方向已确定：Reasonix 风格设置页作为主管理入口，OpenCowork Automation 日历只作为预览视图，不创建第二套任务编辑或持久化逻辑。

### 已识别问题

1. Cron 任务不落库，重启后丢失，不能满足“定时任务可用”的要求。
2. `CronJob` 当前没有完整保存工具 schema 中声明的 `pluginId/pluginChatId`，渠道通知目标无法可靠持久化。
3. `fireJob` 只发送 `cron:fire`，执行完成后的结果需要由 renderer/Agent 链路明确回传到渠道。
4. UI 入口是占位页，没有任务列表、表单、运行记录和通知配置闭环。
5. 任务状态、最近执行结果、最近错误、执行次数需要进入数据库，至少支持任务级最近状态；复杂全量日志可作为后续迭代。

## 数据库与启动恢复现状

- `DbClient.Initialize` 负责手写 CREATE TABLE 和迁移辅助 `EnsureColumn`。
- `WorkerHostBuilder.InitializeModulesAsync` 会先初始化 DB，再调用各 Worker Module 的 `InitializeAsync`。
- `GoalModule.InitializeAsync` 已证明“从 DB 恢复运行态”的模块初始化模式可复用。
- Cron 属于 Main 调度与渠道资源域，不能让 Infrastructure 直接依赖 Main；建议：
  - Cron 任务数据表、CRUD Worker 端点放 Infrastructure/Worker；
  - Main 负责 timer/node-cron、启动恢复和渠道发送；
  - renderer 通过 worker IPC 读写任务和订阅事件。

## 风险与依赖

1. 数据库表迁移必须兼容已有 `index.db`，不能只在新库创建。
2. Worker AOT 序列化需要为新增 DTO、列表和结果类型显式注册 JsonSerializable。
3. Main 进程启动顺序必须保证 DB/Worker 已可请求后再恢复 Cron 调度，避免任务触发早于渠道和 Agent 初始化。
4. 渠道发送需要区分飞书和微信的目标 ID/上下文 token；不能把二者统一成仅一个未经定义的字符串。
5. Cron 执行失败、渠道发送失败必须写入最近错误并继续保留周期任务。
6. UI 设计需复用现有导航和 shadcn 组件，不引入第二套状态管理或独立持久化。

## 建议实现闭环

```text
创建/编辑 Cron
  ↓
Worker DB CRUD 持久化
  ↓
Main 调度器加载 enabled 未删除任务
  ↓
到点发出 cron:fire
  ↓
renderer/Agent 执行 prompt
  ↓
记录 run 状态和最近结果
  ↓
按 deliveryMode 选择桌面、会话或微信/飞书
  ↓
渠道 sendMessage 失败只记录错误，不杀死调度器
```
