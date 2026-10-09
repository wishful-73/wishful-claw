# 审查报告：plan-s172（阶段五 · 审查态）

> 被审查对象：需求 `docs/plans/iter-v2-38/requirements/S-172.md`、计划 `docs/plans/iter-v2-38/plan-s172/plan.md`、落地提交 `316ecaff`（refactor(provider): 主链流式头链 5 份收敛到 ProviderHttpHeaders）
> 审查方式：独立 subagent（code-reviewer，只读源码；未改任何文件、未跑构建/测试）
> 时间：2026-10-09

## 一、总体结论

**❌ 项 = 0 · 可进入验证态。**

`316ecaff` 是一次「零行为变化为主 + 两处有意修漏」的收敛重构：5 处头链 + 3 份 debug 全部落到 `ProviderHttpHeaders`，`git grep` 复核后全仓只剩该类的内部调用 + 刻意的视频端点，与需求 §八.5 预期完全一致。逐调用点比对改前（`316ecaff~1`）与改后，**未发现任何丢头**；反而修掉了两处「多头发」（anthropic 摘要的 `x-api-key`、openai 摘要的 `Authorization` 会被 overrides 追加成两个值）。分层方向正确（Agent → Core，无反向依赖），无新增依赖，无硬编码路径/密钥。⚠️ 项集中在**验证覆盖**：本刀行为变化最大的 `OpenAIResponsesProvider` 没有任何直接回归断言，且摘要路径的真机验证未做 —— 这两点应在验证态补上，不构成阻断。

## 二、逐项结论

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 分层约定（无反向依赖） | ✅ | `ProviderHttpHeaders.cs:1-5` 只用 `System.Net.Http` / `System.Text.Json` / `WishfulClaw.Core.Protocol`；AGENTS.md 允许 Agent → Core。同层调用 `ApiUserAgent` / `ProviderRequestOverrides` / `JsonHelpers`。`Agent.csproj` 未改、`InternalsVisibleTo` 早有；`OpenAIChatHeaders.cs` 反而**删掉** `using WishfulClaw.Core.Protocol;`（收敛佐证） |
| 2 | 硬编码路径 / 密钥 / UA / magic string | ✅（ℹ️） | 无路径、无密钥（密钥一律来自 `provider.apiKey` 参数/配置）；UA 无硬编码，`ApiUserAgent.AppName` 未动。magic string 均为既有惯例：`"opencode-go"` 已收敛到 `ProviderHttpHeaders.cs:133-139`（仅 `ProviderTestService.cs:207` 刻意留一份）；`"2023-06-01"` 仍散 5 处（见 §三 P4） |
| 3 | 参考逻辑 / 行为等价 / 丢头多头 | ✅ | 逐调用点比对：chat live+debug **逐字节等价**；anthropic live+debug **逐字节等价**；responses 仅「新增 opencode 门禁 + debug 补上 live 本就有的 org/project」；两处摘要新增 org/project + `Ensure` 并修掉重复头。**无一处丢头**。详见下方「行为等价逐点核」 |
| 4 | 错误处理（Ensure 顺序 / 空 UA / sessionId 缺失） | ✅（ℹ️） | 四条链 `Ensure` 均在**最后**（`ProviderHttpHeaders.cs:60/67/92/103`），与 plan §六.3 一致；空/空白/含 CRLF 的 UA 由 `ApiUserAgent.cs:35-52` 兜回 `WishfulClaw`；`sessionId` 缺失由 `IsNullOrWhiteSpace` 短路（`:108-113` / `:123-128`）；重复注入有 `Contains`/`ContainsKey` 守卫 |
| 5 | 是否引入不需要的依赖 | ✅ | `git show --numstat` 无 `.csproj` 改动、无 NuGet 变动；`ProviderHttpHeaders.cs` 未新增 `using`；测试项目仅用已有引用 + 既有 `InternalsVisibleTo`（`Agent.csproj:23`） |
| 6 | 回归风险（丢头 / 重复头 / 顺序错） | ⚠️ | 无丢头、无新增重复头；顺序变化仅 `service_tier` 相对 UA 前移（`HttpRequestMessage` 头序无语义）+ 摘要 auth 前移到 overrides 之前（**这是修重复头**）。残留风险在**覆盖缺口**：responses 协议无直接断言（见 §三 P1） |
| 7 | 域外顺手改动 | ⚠️（ℹ️） | 唯一域外改动 = `AnthropicMessagesProvider.cs:1` 去掉 UTF-8 BOM（plan §四 未列，已在 plan §七.4 / compliance P5 记明）；其余 9 个文件全部落在 plan §四 清单内 |

## 三、问题与建议

### 3.1 行为等价逐点核（审查项 3 / 6 的证据底稿，改前取自 `316ecaff~1`）

| 调用点 | 改前头链（顺序） | 改后头链（顺序） | 判定 |
|---|---|---|---|
| `OpenAIChatHeaders.ApplyHeaders`（live chat） | `Authorization` → UA → org → project → overrides → opencode 门禁 → `Ensure` | 同上，UA…Ensure 由 `ProviderHttpHeaders.cs:45-61` 提供 | **逐字节等价** |
| `OpenAIChatHeaders.BuildDebugHeaders` | `Content-Type` → `Authorization: Bearer ***` → UA → overrides → opencode → `EnsureDebug` | 同上（`:74-93`） | **逐字节等价** |
| `OpenAIResponsesProvider.ApplyHeaders`（live） | `Authorization` → UA → org → project → `service_tier` → overrides → `Ensure` | `Authorization` → **`service_tier`** → UA → org → project → overrides → **opencode 门禁** → `Ensure` | 等价 + 2 处有意变化（`service_tier` 前移无语义影响；门禁为需求 §九 明列的「首次带上」） |
| `OpenAIResponsesProvider.BuildDebugHeaders` | `Content-Type` → `Authorization` → UA → `service_tier` → overrides → `EnsureDebug`（**缺 org/project**） | `Content-Type` → `Authorization` → `service_tier` → UA → org → project → overrides → opencode → `EnsureDebug` | **修 live/debug 漂移**：改前 live 带 org/project 而 debug 不带，debug 事件少报头 |
| `AnthropicMessagesProvider.ApplyHeaders`（live） | longcat `Authorization`/`x-api-key` → `anthropic-version` → `anthropic-beta` → UA → overrides → `Ensure` | 同左，UA…Ensure 由 `ProviderHttpHeaders.cs:63-68` 提供 | **逐字节等价** |
| `AnthropicMessagesProvider.BuildDebugHeaders` | `Content-Type` → `anthropic-version` → `anthropic-beta` → longcat 分支 → UA → overrides → `EnsureDebug` | 同左（`:99-104`） | **逐字节等价** |
| `ContextCompression` anthropic 摘要 | UA → overrides → `x-api-key` → `anthropic-version`（**无 `Ensure`**） | `x-api-key` → `anthropic-version` → UA → overrides → `Ensure`（`ContextCompression.cs:593-605`） | 有意修漏：补 `Ensure`；overrides 若含 `x-api-key`，改前被 `Headers.Add` 追加成**两个值**（`ProviderRequestOverrides.cs:89-90` 是 `Remove`+`Add`，故改后 override 胜且不重复） |
| `ContextCompression` openai 摘要 | UA → overrides → `Authorization: Bearer` → opencode 门禁（**无 `Ensure`、无 org/project**） | `Authorization: Bearer` → UA → org → project → overrides → opencode 门禁 → `Ensure`（`:611-623`） | 有意修漏：补 org/project + `Ensure`；同理修掉 `Authorization` 重复值 |

**结论**：无丢头；两处「多头发」被修掉；无新增重复头（`ApplyHttpHeaderOverrides` / `ApplyDebugHeaderOverrides` 都是覆盖语义，`ProviderRequestOverrides.cs:89-90 / 122`）。四处有意行为变化全部在需求 §九 / plan §七 有据。

### 3.2 问题清单

| # | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| P1 | ⚠️ | `src/runtime/WishfulClaw.Agent/OpenAIResponsesProvider.cs:229-255` | 本刀**行为变化最多**的一处（live 新增 opencode 门禁、debug 新增 org/project + opencode），却是**唯一没有任何回归断言**的一处：`ApplyHeaders` / `BuildDebugHeaders` 均 `private`，未开测试缝，只靠「编译 0 错 + 代码复核」（plan §七.3 自承）。而 `MainChainHeaderChecks.AssertDebugChainMirrorsLiveChain`（`MainChainHeaderChecks.cs:82-98`）只比 chat / anthropic 两条链 | 补一条测试缝（如 `internal static ... BuildDebugHeadersForTests`，与 `AnthropicMessagesProvider.BuildDebugHeadersForTests` 同法）或给 `ApplyHeaders` 开缝，断言 responses 的「live ≡ debug + `service_tier` + org/project」；真机验证时专挑 responses 协议 + 配 org/project |
| P2 | ⚠️ | `ContextCompression.cs:593-623` / 需求 §八.4 | 本刀两处**有意行为变化**（摘要带 org/project、补 `Ensure`）只在自动压缩路径生效，而离线断言打的是**构造方法**、未打调用链；真机验证（配带 org/project 的 OpenAI 兼容 provider 跑一轮触发压缩）**未做** | 进入验证态时列为必做项：至少跑一次「聊天头 ≡ 摘要头」（看 `request_debug` 或抓包） |
| P3 | ⚠️ | `ProviderHttpHeaders.cs:118-131` | `ApplyOpenCodeSessionDebug` 用 `headers.ContainsKey("x-opencode-session")` 判重，去重强度取决于**调用方字典的 comparer**。生产两处调用点（`OpenAIChatHeaders.cs:19`、`OpenAIResponsesProvider.cs:243`）都是 `StringComparer.OrdinalIgnoreCase`，当前安全；但若将来有调用方传默认（大小写敏感）字典，`headers["x-opencode-session"] = sessionId` 会写入第二个大小写不同的键 | 改为显式大小写无关扫描（对齐 `ApiUserAgent.EnsureDebug` 在 `ApiUserAgent.cs:63-76` 的写法），把守卫强度收到本类内部，不依赖调用方 |
| P4 | ℹ️ | `AnthropicMessagesProvider.cs:209/219`、`ContextCompression.cs:602`、`ProviderCompletionService.cs:200`、`ProviderTestService.cs:149/240` | `anthropic-version = "2023-06-01"` 字面量在 src 内仍有 **5 处**（本刀新增的 `ContextCompression.cs:602` 是把既有字面量搬进新缝，非新增欠账） | 既有欠账，本刀范围外（协议差异刻意留在调用点）；若后续做 anthropic 头链收敛可合并为一个常量 |
| P5 | ℹ️ | `ProviderRequestOverrides.cs:122` vs `OpenAIChatHeaders.cs:24` / `OpenAIResponsesProvider.cs:246` | debug 脱敏格式不统一：调用点写 `Authorization = "Bearer ***"`，而 overrides 命中敏感头时（`IsSensitiveHeader`）置 `"***"`。若用户用 `requestOverrides.headers` 覆盖 `Authorization`，则 **debug 显示 `***`、live 是实值**，`AssertSameHeaders`（`:212-230`）那类「逐头相等」断言在该场景不成立（现有测试未覆盖该组合） | 属既有语义、非本刀引入；若要让「debug ≡ live」成为硬契约，需在断言里对敏感头做归一化（或统一脱敏形态） |
| P6 | ℹ️ | `tests/WishfulClaw.ProviderHeaderRegressionTests/MainChainHeaderChecks.cs` | 新增断言未覆盖 `service_tier`（responses 专有头）与 anthropic `longcat` 鉴权分支的 debug 脱敏；断言 ③ 只覆盖「注入 + 永不注入」两侧（plan 步骤 6 已自述覆盖边界） | 视验证态需要补；不阻断 |

## 四、非本刀欠账（记录，不纳入本刀）

- **真机自动压缩验证**（需求 §八.4 / plan §八）未做 —— 需真实 provider，留给老大侧执行。
- **`ProviderTestService` 不收敛** —— 需求 §七 明列的刻意不做（其 `opencode-go` 门禁与固定 session id 语义独立，且有 4 条既有断言钉着）。
- **视频端点（`SeedanceVideoTools.cs:208-215` / `XaiVideoTools.cs:224-231`）不并入** —— 非 chat 协议、无 `requestOverrides`/路由头，本刀只加注释指向唯一头链定义点，结论已落纸。
- **anthropic 家族是否该传组织信息** —— 本刀判定 `OpenAI-Organization` / `OpenAI-Project` 是 OpenAI 品牌头，不引入；若真要给 Anthropic 传，需先确认 Anthropic 侧接受什么头（另起需求）。
- **`docs/plans/` 历史文件 UTF-8 BOM 欠账**（compliance 报告 §四 记的 61 个历史文件），与本刀无关。

## 五、结论

**❌ 项 = 0 ⇒ 可进入验证态。** ⚠️ 3 条（P1 responses 无回归断言、P2 摘要路径真机验证未做、P3 debug 去重依赖调用方 comparer）建议在验证态一并处理，其中 P1 / P2 与本刀的两处有意行为变化**直接对应**，价值最高。ℹ️ 3 条已记录。

> 说明：本报告审查的是**已提交代码** `316ecaff`（`git show` 快照）。审查期间工作区里 `plan-s172/plan.md` 与 `requirements/S-172.md` 另有未提交改动（compliance 报告 P1–P4 的措辞订正），本报告读的是这两份文档的**当前工作区版本**；代码结论不受影响。

## 六、审查范围自述

**读过的文件**（全部只读）：
- 需求 / 计划：`docs/plans/iter-v2-38/requirements/S-172.md`、`docs/plans/iter-v2-38/plan-s172/plan.md`、`docs/plans/iter-v2-38/plan-s172/compliance_report.md`、`AGENTS.md`（分层约定）
- 落地源码：`ProviderHttpHeaders.cs`（全文 140 行）、`OpenAIChatHeaders.cs`、`OpenAIResponsesProvider.cs:140-256`、`AnthropicMessagesProvider.cs:186-250`、`ContextCompression.cs:1-20 / 584-628`、`ApiUserAgent.cs`（全文）、`ProviderRequestOverrides.cs`（全文）、`ProviderCompletionService.cs:185-220`、`ProviderTestService.cs:199-215`（经 `git show 316ecaff:` 快照）
- 测试：`tests/WishfulClaw.ProviderHeaderRegressionTests/MainChainHeaderChecks.cs`（全文 242 行）、`Program.cs` 改动

**跑过的命令**（只读 git / 只读文件读取）：
- `git show --stat 316ecaff`、`git show 316ecaff --numstat --format=""`
- `git show 316ecaff -- <6 个源码/测试文件>`（逐文件 diff，与 `316ecaff~1` 比对）
- `git show 316ecaff:src/runtime/WishfulClaw.Agent/ProviderTestService.cs`（确认未动）
- `git grep -n "ApiUserAgent.Apply\|ApiUserAgent.Ensure\|ApplyHttpHeaderOverrides\|ApplyDebugHeaderOverrides" -- src tests`（残留检查）
- `git grep -n "opencode-go" / "2023-06-01" / "x-opencode-session" -- src`（magic string 分布）
- `git grep -n "InternalsVisibleTo" -- src tests`、`git log --oneline -5`、`git status --porcelain`
- 各改动文件的 BOM 首字节检查（`bom=False` 全体）

**未做**：未改任何文件（本产物除外）、未 commit / push、未跑 `dotnet build` / `npm run typecheck` / `npm test`（阶段五不验证）。
