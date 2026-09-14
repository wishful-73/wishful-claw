# S-21 调用链与不变式梳理（D1 实施笔记）

> iter-29 / S-21 多服务商限额自动 fallback。本文件是 D1 阶段产物，给 D2-D6
> 实施做参考。完成后 S-21 全量 commit 时把这份笔记并入 plan.md 或保留作为附录。

## 现状调用链

```
AgentLoop.cs:319-328                         (turn dispatch 入口)
    └─ ProviderRetryPolicy.ExecuteAsync      (ProviderRetryPolicy.cs:80-172)
        └─ ExecuteTurnAsync                  (AgentLoop.cs:526-532, dispatch by providerType)
            └─ AnthropicMessagesProvider / OpenAIResponsesProvider / OpenAIChatProvider
               ↓ 失败（HTTPException / Timeout）
        ↑ catch（重试 + 退避 + emit request_retry）
        循环直到：成功 / 重试耗尽 / 状态不可重试（context window exceeded）→ throw
```

### 关键事实

1. **`ProviderRetryPolicy.ExecuteAsync` 只在 `AgentLoop.cs:324` 一个地方被调用**（grep
   确认全仓唯一调用点）。fallback 切换只需要在那里接住「可切换」结果，不需要在每个
   Provider 复制状态机。
2. **三种 catch 分支**：
   - `TimeoutException` 且未耗尽 → 重试退避
   - `ProviderHttpException` 且状态可重试（400/429/5xx）且非 context-window exceeded 且未耗尽 → 重试退避
   - 其他（含状态不可重试 / 重试耗尽）→ **throw**（这就是 fallback 切入点）
3. **`requestMaxRetries` 语义**（ProviderRetryPolicy.cs:78）：
   - `null` / 缺失 → 默认 10
   - `0` → **无限**（`isUnlimited` = true）
   - `>0` → 那个值
   - **计划要求**：`requestMaxRetries=0` 必须**保持不切换**（无限重试不被打断）→ 这个 catch
     即使 fallback 也不能跳出无限循环
4. **`AgentRuntimeProviderTurnResult`**（`Models/ConversationModels.cs:8`）当前只有
   `AssistantMessage / ToolCalls / StopReason / Usage` —— **没有「可切换失败」状态**。
   S-21 需要扩展（建议加 `SwitchFromProviderId` / `SwitchReason` 可空字段，null = 正常结果）。

## 计划要求的 4 个核心不变式（也是 D4 切换时的关键测试点）

1. **不会重复工具调用**：切到新 Provider 时，`conversation` / `toolDefs` / `state` 完整复用；
   已生成的 `AssistantMessage` 不带回新 Provider，新 Provider 从「切换点的对话快照」开始。
2. **不循环 fallback**：同一请求按排序逐个尝试 provider，**每个 provider 一次**，不回头。
3. **`requestMaxRetries=0` 不切换**：`isUnlimited` 走原 throw 路径，不被 fallback 截胡。
4. **取消立即终止**：`CancellationToken` 在任何重试 / 切换前都要检查；fallback 也遵守。

## ⚠️ 已知风险点（plan D4 警告）

**`openai-responses` Provider 有 `OpenAIResponsesState` 的 response id**。切换到
非 openai-responses 的 provider 时，这个 id 无意义（其它 Provider 不理解）。
**反之**：从非 openai-responses 切到 openai-responses 也丢上下文。

**未实测** —— D4 实施时须用一个简单的 mock provider 验证：
- A 跑半轮（生成一些 tool calls）→ 切到 B → B 是否能看到 A 的工具结果
- openai-responses 内重试 vs 跨 provider 切换分别确认

## 与 iter-27 Plan D 的差异

iter-27 把这个需求叫「Plan D」但**未实施**（步骤 `[ ]`）。iter-29 把它升级为 S-21，
额外加了两步：**D6 AOT** 与 **D7 回归测试工程并入 .sln**（iter-27 没有回归工程、
没有 AOT 门禁要求）。

iter-27 的设计骨架（`docs/plans/iter-v2-27/plan.md:195-205`）是权威参考。

## 已完成

- ✅ D7：测试工程 `tests/WishfulClaw.ProviderFallbackRegressionTests` 已建，
  `dotnet sln add` 同步进 `src/runtime/WishfulClaw.sln`；build sln 0/0；
  `dotnet run --project tests/... --no-build` 通过（sanity 断言 1 条）。
  状态机测试与 AgentLoop 集成测试在 D3 / D4 落地时填实。

## 剩余

- ⏳ D2：shared/types/provider.ts + ProviderPanel 配置面
- ⏳ D3：`AgentRuntimeProviderTurnResult` 加可切换字段；`ProviderRetryPolicy`
  终端 catch 改为「返回可切换结果」（`isUnlimited` 仍 throw）
- ⏳ D4：AgentLoop.cs:319-328 接住可切换结果 + Provider 优先级列表 + 切换时复用
  conversation / toolDefs / state
- ⏳ D5：观测（request_fallback stream event）+ Mock endpoint 验证
- ⏳ D6：AOT —— 新增具名 DTO 注册 `InfrastructureJsonContext`