# Plan-S172：主链流式头链 5 份收敛到 `ProviderHttpHeaders`

> 归属 iter-v2-38 第 1 刀。需求正文见 [`../requirements/S-172.md`](../requirements/S-172.md)。
> 状态：**已完成**（2026-10-08；实施记录与两处口径偏差见 [`../requirements/S-172.md`](../requirements/S-172.md) §九）。不占前置依赖，可与 S-173 并行排刀。

---

## 一、目标

把主链 4 个文件里 **5 处头链装配 + 3 份 debug 头装配**收敛到 `src/runtime/WishfulClaw.Agent/ProviderHttpHeaders.cs`，让它成为**唯一头链定义点**；顺带修掉 `ContextCompression` 两处丢 `organization` / `project` 的漏。

---

## 二、现状（实测）

| # | 位置 | 装配内容 | 与「超集」的差 |
|---|---|---|---|
| 1 | `OpenAIChatHeaders.cs:12-34` `ApplyHeaders` | UA + organization/project + overrides + opencode 门禁 + Ensure | **本身就是超集** |
| 2 | `OpenAIResponsesProvider.cs:229-250` | UA + organization/project + `service_tier` + overrides | 缺 opencode 门禁 |
| 3 | `AnthropicMessagesProvider.cs:194-214` | UA + overrides + longcat 鉴权 + `anthropic-version` / `anthropic-beta` | 缺 organization/project（协议无关）、缺 opencode 门禁 |
| 4 | `ContextCompression.cs:620-627`（anthropic 摘要） | UA + overrides + `x-api-key` + `anthropic-version` | **缺 organization/project**、缺 Ensure |
| 5 | `ContextCompression.cs:764-777`（openai 摘要） | UA + overrides + Bearer + opencode 门禁（手抄） | **缺 organization/project**、缺 Ensure |
| debug ×3 | `OpenAIChatHeaders.cs:36-53` / `OpenAIResponsesProvider.cs:252-267` / `AnthropicMessagesProvider.cs:216-239` | 各自手写脱敏值 | 未收敛；三者字段集不同（responses 多 `service_tier`） |

收敛目标类现有的两个方法（`ProviderHttpHeaders.cs:37-60`）：

- `ApplyOpenAiChat(request, provider, sessionId)` —— UA + organization/project + overrides + opencode 门禁 + Ensure
- `ApplyAnthropic(request, provider)` —— UA + overrides + Ensure

---

## 三、步骤清单

- [x] **步骤 1：`ProviderHttpHeaders` 补 debug 变体**
  - 加 `ApplyOpenAiChatDebug(Dictionary<string, string> headers, JsonElement provider, string? sessionId)` 与 `ApplyAnthropicDebug(Dictionary<string, string> headers, JsonElement provider)`，语义与 `ApplyOpenAiChat` / `ApplyAnthropic` 一一对应（`ApiUserAgent.ApplyDebug` → overrides 的 `ApplyDebugHeaderOverrides` → opencode 门禁 → `EnsureDebug`）。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`ProviderHeader` 套件仍全绿（本步不动调用方）。

- [x] **步骤 2：`OpenAIChatHeaders` 收敛**
  - `ApplyHeaders` 只留 `Authorization: Bearer`（鉴权留调用点），其余删掉改调 `ProviderHttpHeaders.ApplyOpenAiChat`。
  - `BuildDebugHeaders` 只留 `Content-Type` + `Authorization: Bearer ***`，其余改调 `ApplyOpenAiChatDebug`。
  - **验证检查点**：`ProviderHeader` 的 `AssertHeaders` 系列（8 + 1 条）**原样通过不改** —— 这是行为等价的证据（含 `Program.cs:116-120` 的实际头 / debug 头镜像断言）。

- [x] **步骤 3：`OpenAIResponsesProvider` 收敛**
  - `ApplyHeaders` 只留 `Authorization` + `service_tier`，其余改调 `ApplyOpenAiChat`；`BuildDebugHeaders` 只留 `Content-Type` / `Authorization` / `service_tier`，其余改调 `ApplyOpenAiChatDebug`。
  - **行为有意变化**：该协议首次带上 opencode-go 门禁 —— 当前无影响（opencode-go 是 openai-chat 协议），收敛后规则统一。
  - **验证检查点**：编译 0 错 0 警。

- [x] **步骤 4：`AnthropicMessagesProvider` 收敛**
  - `ApplyHeaders` 只留 longcat 的 `Bearer` + `x-api-key`、`anthropic-version`、`anthropic-beta`，其余改调 `ApplyAnthropic`；debug 同步调 `ApplyAnthropicDebug`。
  - **验证检查点**：编译 0 错 0 警；`ProviderHeader` 全绿。

- [x] **步骤 5：`ContextCompression` 两处收敛**
  - `:620-627`（anthropic 摘要）→ `ApplyAnthropic` + 保留 `x-api-key` / `anthropic-version`。
  - `:764-777`（openai 摘要）→ `ApplyOpenAiChat(request, provider, sessionId)` + 保留 `Authorization: Bearer`，删手抄的 opencode 门禁。
  - **行为有意变化**：两处开始带 `organization` / `project`（此前丢）—— 属修漏，需在验证里明说。
  - **验证检查点**：编译 0 错；`git grep "ApiUserAgent.Apply\|ApplyHttpHeaderOverrides"` 结果只剩 `ProviderHttpHeaders` 内部 + 视频工具（`SeedanceVideoTools` / `XaiVideoTools`，见步骤 7）+ `ProviderTestService`（刻意不做）。

- [x] **步骤 6：补断言（新增，旧断言一条不改）**
  - 摘要路径可测性：仿 `ProviderTestService.BuildTestRequestForTests` 的先例，给 `ContextCompression` 两个摘要请求构造加测试缝（`internal static` + `...ForTests`）。
  - 新增断言：① 两条摘要路径带上 `organization` / `project`；② 三协议（chat / responses / anthropic）收敛后的头字段集与 debug 头一致；③ opencode 门禁在三协议收敛后行为不变（`opencode` / 大小写变体 / 空值均不注入）。
  - **验证检查点**：`dotnet build tests/WishfulClaw.Tests.sln` 0 错；`ProviderHeader` 套件全绿（含新增断言）。

- [x] **步骤 7：视频工具并入与否的结论**
  - `SeedanceVideoTools.cs:204-210` / `XaiVideoTools.cs:220-226` 各自手抄 UA：走视频生成端点、非 chat 协议、无 `requestOverrides`。
  - **倾向不并入**，只在两处留注释指向 `ProviderHttpHeaders`；结论回填需求正文「七、刻意不做」。
  - **验证检查点**：结论落纸，不留下「待定」。

- [x] **步骤 8：整体测通**
  - `npm run typecheck` 三配置 0 错；`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`npm test` **65/65**（含步骤 6 新增断言）。
  - 真机：配一个带 `organization` / `project` 的 OpenAI 兼容 provider，跑一轮触发自动压缩，确认**摘要请求头 = 聊天请求头**（看 `request_debug` 事件或抓包）。
  - **验证检查点**：上述三项全过 ⇒ 本刀测通，按一需求一刀提交。

---

## 四、涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/ProviderHttpHeaders.cs` | 修改：补 debug 变体；类注释去掉「debug 变体刻意缺失」（S-171 的边界已不成立） |
| `src/runtime/WishfulClaw.Agent/OpenAIChatHeaders.cs` | 修改：`ApplyHeaders` / `BuildDebugHeaders` 收敛 |
| `src/runtime/WishfulClaw.Agent/OpenAIResponsesProvider.cs` | 修改：`ApplyHeaders` / `BuildDebugHeaders` 收敛 |
| `src/runtime/WishfulClaw.Agent/AnthropicMessagesProvider.cs` | 修改：`ApplyHeaders` / `BuildDebugHeaders` 收敛 |
| `src/runtime/WishfulClaw.Agent/ContextCompression.cs` | 修改：两处摘要头链收敛 + 测试缝 |
| `src/runtime/WishfulClaw.Agent/ProviderHttpHeaders.cs` | 修改：类注释去掉「debug 变体刻意缺失」（S-171 的边界已不成立） |
| `tests/WishfulClaw.ProviderHeaderRegressionTests/*.cs` | 新增断言（新文件），旧断言不动 |
| `docs/plans/iter-v2-38/requirements/S-172.md` | 回填「代价与取舍」「刻意不做」与实施记录 |

---

## 五、参考源码

**无外部参考** —— 本需求是仓内收敛，不搬任何参考项目代码。唯一参照是 `ProviderHttpHeaders.cs` 的类注释（S-171 已写明该类的 debug 变体「streaming providers converge here (S-172)」时自带）。

---

## 六、风险与取舍（实施前已知）

1. **主链是热路径**：4 文件 5 处 + 3 份 debug，改错一处就是「聊天能发、压缩摘要 403」这类只在特定路径复现的问题 ⇒ 靠 `ProviderHeader` 套件兜底，且**旧断言原样不改**作为行为等价证据。
2. **两处行为有意变化**：`ContextCompression` 开始带 `organization` / `project`；`OpenAIResponsesProvider` 开始带 opencode 门禁。都不是回归，是本需求要修的漏。
3. **`ApiUserAgent.Ensure` 的调用顺序**必须保持「Apply → … → Ensure」—— 它是空 UA 兜底，顺序反了会写出双 UA。

---

## 七、执行结果（2026-10-08）

八步全部落地。与计划的三处出入：

1. **步骤 4/6 修正**：`AnthropicMessagesProvider` **不补** `organization` / `project`（详见 §二 表格里的「协议无关」是按错误判断写的）—— 那两项是 OpenAI 品牌头，`ApplyAnthropic` 保持「UA + overrides + Ensure」两件套。
2. **步骤 6 的测试缝改用真名**：`BuildAnthropicSummaryRequest` / `BuildOpenAiSummaryRequest` 是调用点直接使用的真实构造方法，没有 `ForTests` 后缀；唯一纯测试转发是 `AnthropicMessagesProvider.BuildDebugHeadersForTests`。
3. **`OpenAIResponsesProvider` 无测试缝**：其 `ApplyHeaders` / `BuildDebugHeaders` 均为 `private`，且需求不要求为它开缝，故该文件按「编译 0 错 0 警 + 代码复核」验证（sessionId 已接进 `state.SessionId`）。

门禁：`dotnet build` 0 错 0 警 / `npm run typecheck` 0 错 / `npm test` **66/66**（`ProviderHeader` 全绿，旧断言一条未改）。真机自动压缩验证（§8 第二项）未做，需真实 provider，留给老大侧。
