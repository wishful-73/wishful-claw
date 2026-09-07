# v2-iter-25：微信渠道全局会话闭环

> 状态：已完成
>
> 日期：2026-09-05
>
> 分支：`dev/v2-iter-25`

## 目标

修复微信扫码渠道的两个阻断缺陷，使扫码绑定后的渠道无需二次操作即可使用，并让同一微信渠道的连续消息稳定复用同一个全局会话及其上下文。

现有全局 Agent、全局任务、项目工具和渠道回复链路保持不变；本迭代不重复扩展已经验证过的产品经理/助手能力。

## 本迭代验收范围

1. 全新扫码绑定微信后，无需再次点击“启动”，渠道立即进入运行状态并可收发消息。
2. 关闭并重启 Wishful Claw 后，已绑定且启用的微信渠道自动恢复运行。
3. 同一微信渠道连续发送 5 条消息，只创建并复用一个 Session。
4. 第 5 条消息能够引用第 1 条消息的上下文，证明 AgentConversation 与数据库历史均复用成功。

## 已确认根因

### 扫码后未启动

扫码成功逻辑只保存凭证并写入 `enabled: true`，未调用渠道启动；内置渠道默认 `features.autoStart: false`，因此绑定完成后仍处于 stopped。

### 每条消息创建新会话

`DbPluginSessionRouting.RoutePluginSession` 在查不到路由时生成了 `SessionEntity`，但未执行 `INSERT INTO sessions`。下一条消息仍查不到 `channel_route_key`，因而再次生成新 `sessionId`。

## 实施步骤

### Plan 25-1：绑定与启动生命周期

- 微信扫码成功后先持久化 token、accountId、baseUrl、userId。
- 同时写入 `enabled: true` 和 `features.autoStart: true`。
- 配置保存成功后立即调用 `startChannel(channel.id)`。
- 只有启动成功才显示完整成功反馈；启动失败时显示错误并保持真实运行状态。
- 验证应用启动恢复逻辑会自动启动该渠道。

### Plan 25-2：会话持久化与复用

- 修复 `RoutePluginSession` 新建路径，真正插入 Session。
- 新会话显式保存 `global:chat + default` 上下文。
- 保存 `plugin_id`、`plugin_type`、`channel_route_key`、`external_chat_id` 和模型继承字段。
- 路由创建采用事务和冲突安全策略，避免同时到达的消息创建重复 Session。
- 保持现有 Agent Loop、全局 Prompt、记忆召回和回复发送链路不变。

### Plan 25-3：回归与实机验收

- 增加路由首次创建、再次复用和上下文字段的回归覆盖。
- 运行 TypeScript 三套配置检查。
- 运行 C# solution build 和相关回归测试。
- 实机执行本文件四项微信扫码验收。

## 不在本迭代范围

- 不处理多个不同微信联系人之间的隔离策略；当前扫码渠道只按现有唯一微信聊天路由工作。
- 不重做全局 Agent、产品经理角色、全局任务或项目工具。
- 不重复已经通过的渠道回复、项目查询和全局工具测试。
- 不执行 `review-13-iter25-release-prep.md` 中的全量 Release Candidate、安全、门面和质量账整改。
- 不发布、不合并 main、不打 tag；迭代完结仍由老大确认。

## 验证门槛

- `npx tsc --noEmit -p tsconfig.web.json`
- `npx tsc --noEmit -p tsconfig.node.json`
- `npx tsc --noEmit -p tsconfig.json`
- `dotnet build src/runtime/WishfulClaw.sln`
- 微信扫码四项人工验收全部通过
