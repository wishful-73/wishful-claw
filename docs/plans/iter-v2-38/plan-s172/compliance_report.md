# 合规报告：plan-s172（阶段三 · 规划验证）

> 被验证对象：`docs/plans/iter-v2-38/plan-s172/plan.md`（+ 需求正文 `requirements/S-172.md`）
> 检查项来源：`docs/dev-workflow.md` 阶段三（第 353-372 行）
> 验证方式：独立 subagent（`code-reviewer`，只读；未改任何文件、未跑构建/测试），逐文件比对 `git show 316ecaff` 与 `316ecaff~1:<file>`
> 落地提交：`316ecaff`（refactor(provider): 主链流式头链 5 份收敛到 ProviderHttpHeaders）
> 时间：2026-10-09（事后补验）

---

## 一、总体结论

**❌ 项 = 0 · 可进入执行态。**

plan 结构完整、边界清晰，与已落地提交 `316ecaff` **高度自洽**：5 处头链 + 3 份 debug 全部收敛，`ProviderHttpHeaders.cs` 已是唯一头链定义点（`OpenAIChatHeaders.cs` 改动时甚至删掉了 `using WishfulClaw.Core.Protocol;`，正面佐证依赖收敛发生）。plan §二 行号以 **改前快照** 为准**逐条精确命中**。与落地代码的 3 处口径偏差（anthropic 不补 `OpenAI-*`、测试缝用真名、responses 无测试缝）已在 plan §七 与 `requirements/S-172.md` §九 **自行回填**，不构成不一致。

---

## 二、逐项结论（8 项）

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 步骤完整覆盖目标 | ✅ | 5 处头链（chat / responses / anthropic / 摘要×2）+ 3 份 debug，由步骤 1-5 一一对应；步骤 6 补断言、步骤 7 给视频工具结论、步骤 8 整体测通 |
| 2 | 每步有验证检查点 | ✅ | 八步全带检查点（`plan.md:36/41/46/50/56/61/66/71`）；步骤 2/6 把「旧断言原样通过」明确列为行为等价证据 |
| 3 | 文件路径合规 | ✅ | §四 列出的源码全在 `src/runtime/WishfulClaw.Agent/`（AGENTS.md 第 6 层）；测试在 `tests/WishfulClaw.ProviderHeaderRegressionTests/`，与 `git show --stat` 实际改动一致 |
| 4 | 分层依赖正确 | ✅ | `ProviderHttpHeaders.cs` 仅引用 `WishfulClaw.Core.Protocol`（Agent → Core 合法）；依赖的 `ApiUserAgent` / `ProviderRequestOverrides` 同层；无 Workspace / Worker 反向依赖 |
| 5 | 行号属实 | ✅ | 8 组引用（`OpenAIChatHeaders:12-34/36-53`、`OpenAIResponsesProvider:229-250/252-267`、`AnthropicMessagesProvider:194-214/216-239`、`ContextCompression:620-627/764-777`、`ProviderHttpHeaders:37-60`）以 `316ecaff~1` 为基准**全部精确命中** |
| 6 | 「5 份头链覆盖面各不相同」论断 | ✅ | 改前实测确认 5 份确不相同；「`ContextCompression` 两处连 organization/project 都丢」属实（`:624-627` 与 `:769-777` 均无该头、均缺 Ensure） |
| 7 | 刻意不做 / 不回退既有修复 | ✅ | 视频工具只加注释（零行为变化）；`ProviderTestService` 未动；未发现域外改动（唯一附带改动见 §三.P5） |
| 8 | CRLF / 无 BOM | ✅ | `plan.md` 112 CRLF / 0 裸 LF / 无 BOM；`S-172.md` 119 / 0 / 无 BOM |

---

## 三、验证报告点出、已在本轮订正的文档问题

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| P1 | ⚠️ | `plan.md` 步骤 8 vs §七 / `S-172.md` §九 | 步骤 8 写 `npm test 65/65`，实施记录写 `66/66`，**文档内部数字不一致** | ✅ 步骤 8 统一为 **66/66** |
| P2 | ⚠️ | `plan.md` §四 | `ProviderHttpHeaders.cs` **重复一行** | ✅ 删去重复行，仅留一条 |
| P3 | ⚠️ | `plan.md` 步骤 6 ③ | 原声称断言覆盖 opencode 门禁「大小写变体 / 空值均不注入」，落地实际只断言「chat 注入 `opencode-go` / anthropic 永不注入」 | ✅ 订正措辞并按实况标注覆盖边界 |
| P4 | ⚠️ | `plan.md` 步骤 5 检查点 | 把 `ProviderTestService` 列为 `git grep "ApiUserAgent.Apply\|ApplyHttpHeaderOverrides"` 的残留，但该文件**不调用**这两个符号（手写 `Authorization` / `x-opencode-session`） | ✅ 措辞改为「另见…属刻意不做」 |
| P5 | ℹ️ | `AnthropicMessagesProvider.cs:1` | 提交顺带删除该文件 UTF-8 BOM，plan §四 未列 | ✅ 已在 §七 补第 4 条知晓项（方向与仓库「无 BOM」纪律一致，不回滚） |

---

## 四、非本刀欠账（记录，不纳入本刀）

- 本刀**无独立回归断言**覆盖 `ContextCompression` 两处摘要路径的**调用点**（测试缝覆盖构造方法，未覆盖调用链）。真机验证（§8 第二项）需真实 provider，留给老大侧。
- `docs/plans/` 全树 **61 个历史文件带 UTF-8 BOM**（落在 `iter-v2-19` ~ `iter-v2-28`），与本次 S-172 文件无关，属既有欠账。

---

## 五、结论

**可进入执行态** —— 代码改动已落地（`316ecaff`）并通过门禁（`dotnet build` 0 错 0 警 / `typecheck` 0 错 / `npm test` 66/66），文档论断订正完毕，已随需求一刀提交。

> 说明：本报告为 2026-10-09 老大指令「38 迭代的其它计划都按照开发工作流去验证一遍」的**事后补验**产物。S-172 ~ S-176 原实施时未落 `compliance_report.md`（历史省略该产物），本次按工作流补齐。
