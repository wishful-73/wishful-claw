# 验证报告：plan-s172（阶段六 · 验证态）

> 被验证对象：`docs/plans/iter-v2-38/plan-s172/plan.md`（+ 需求正文 `requirements/S-172.md`）
> 落地提交：`316ecaff`（refactor(provider)，11 files，+445/−100）
> 验证方式：**独立跑**（本仓门禁 + 专项回归套件），命令与原始输出见下。构建产物与测试输出目录均属 gitignore 范围，未改动任何跟踪文件。
> 验证时间：2026-10-09（事后补验）

---

## 一、总体结论

**PARTIAL** —— 编译与回归**全绿**（typecheck 0 错 / `dotnet build` 0 错 0 警 / `npm test` 67/67 / `ProviderHeader` 套件全绿），但设置明确要求的一项**真机验证未做**（摘要请求头 = 聊天请求头，需真实 provider），故不判 PASS。

**判定依据**：可跑的全跑通；未覆盖项全部是「需真实 provider + 真机抓包」类，我这边不可执行。

---

## 二、编译证据

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `npm run typecheck`（含 `typecheck:node` + `typecheck:web`） | **0** | 两配置均无输出（0 错） |
| 2 | `dotnet build src/runtime/WishfulClaw.sln` | **0** | `已成功生成。0 个警告 0 个错误`（用时 3.63s） |

配 `-p tsconfig.node.json` / `tsconfig.web.json --composite false`，与工作流要求的「TypeScript 各配置零错误」一致。

---

## 三、测试证据

### 3.1 总门禁

```
npm test  →  67/67 通过      （ES 51 + C# 16）  退出码 0
```

其中 `== C# 回归套件（16）==` 含本需求直接相关的：

```
  ok   ProviderHeader                          4.5s
```

### 3.2 专项套件（本需求）

| 套件 | 结果 | 说明 |
|---|---|---|
| `ProviderHeader`（C#，`tests/WishfulClaw.ProviderHeaderRegressionTests`） | **ok** | 本刀新增的 `MainChainHeaderChecks` 由它承载（`Program.cs` 只 +1 行调用），**旧断言一条未改** |

### 3.3 相邻套件（防回归，非本刀业务但同域）

无（provider 头链只此一套；视频端点刻意未并入，见 plan §七）。

---

## 四、逐项验证（对照 plan 步骤 1-8）

| 步骤 | 检查点 | 结论 | 证据 |
|---|---|---|---|
| 1-4 | 各 provider 的 live/debug 头链收敛到 `ProviderHttpHeaders` | ✅ | `git grep "ApiUserAgent.Apply\|ApplyHttpHeaderOverrides"` 全仓只剩 `ProviderHttpHeaders` 内部 + 两个视频工具；与需求 §八.5 完全一致 |
| 5 | 摘要头链收敛 | ✅ | `ContextCompression.cs` 两处改用 `Build*SummaryRequest` |
| 6 | 新增断言（新文件，旧断言不动） | ✅ | `MainChainHeaderChecks.Run()` 由 `ProviderHeader` 套件执行，ok；**未触碰旧断言** |
| 7 | 视频工具不并入 + 落结论 | ✅ | `SeedanceVideoTools.cs` / `XaiVideoTools.cs` 各留指向注释，结论已落需求 §七 |
| 8 | `npm run typecheck` 0 错；`dotnet build` 0 错 0 警；`npm test` 66/66 | ⚠️→✅ | **三者全部通过**；本轮计数为 **67/67**（plan 写 66/66 是实施时点的快照；本刀之后仅 **S-176** 新增 `test:scroll-watermark` 一套 ⇒ 66→67，**S-177 未新增套件**） |

---

## 五、未覆盖项（PARTIAL 的直接原因）

| # | 项 | 为什么没做 | 谁来做 |
|---|---|---|---|
| 1 | **真机：摘要请求头 == 聊天请求头**（plan 步骤 8 第二项、需求 §八.4） | 需真实带 `organization` / `project` 的 OpenAI 兼容 provider，跑一轮触发自动压缩并抓 `request_debug` / 抓包。我这边没有可用的真实 provider | 老大侧 |
| 2 | `OpenAIResponsesProvider` 头链等价（plan §九.1 已披露的无缝盲区） | 该 provider 的 `ApplyHeaders` / `BuildDebugHeaders` 均为 `private`、本需求不要求为它开测试缝 ⇒ 只有「编译 0 错 + 代码复核」兜底，**无机器断言** | 已知盲区，随需求 §九 披露 |

> 说明：第 1 项是本刀**唯一**影响最终观感的验证缺口；第 2 项是计划自己申报的取舍，不是遗漏。

---

## 六、补充审查发现（阶段五第二轮，须跟进，不阻断）

本迭代阶段五共跑过**两轮**独立审查。第二轮（补充复核）另发现以下 ⚠️ 项，**已在 `review_report.md` 之外单列，随迭代收尾刀统一处置**：

| # | 级别 | 位置 | 问题 |
|---|---|---|---|
| 1 | ⚠️ 需修（纯 docs） | `requirements/S-172.md:67,79`、`plan-s172/plan.md:55` | 偏差①（anthropic **不**补 `OpenAI-*` 头）已声明，但「**两处**摘要路径开始带 `organization` / `project`」的表述未回填 —— 实际只有 **1 处**（openai 摘要），与实现和 §九.1 自相矛盾 |
| 2 | ⚠️ 需修（纯 docs） | `plan-s172/plan.md:106-110` | §七 标题写「与计划的**三处**出入」，正文却列了**四条**（含事后发现的去 BOM 项） |
| 3 | 💡 建议 | `plan-s172/plan.md:60` | 步骤 6 承诺断言「② 三协议收敛后与 debug 头一致」，实际只覆盖 chat + anthropic（responses 无缝）⇒ 措辞宜改「两协议」或补 responses 断言 |
| 4 | 💡 建议 | `ContextCompression.cs:611-623` | openai 摘要的**排序行为变化**（`Authorization` 先落、overrides 后压）未在 §九 申报；改动方向正确，仅缺一句说明 |

> 计数不一致（`plan.md:69` = 65/65 vs `:112` = 66/66）已在本轮阶段三订正中就地修复为 66/66（需求 §九 亦为 66/66），此处不再列为问题。

---

## 七、结论

| 项 | 结果 |
|---|---|
| 编译 | ✅ 0 错 / 0 警 |
| 回归 | ✅ `npm test` 67/67，`ProviderHeader` 全绿，旧断言一条未改 |
| 收敛目标 | ✅ 主链 5 处 + 3 份 debug 全部落 `ProviderHttpHeaders` |
| 真机验收 | ❌ 未做（需真实 provider，留老大侧） |
| 阶段五 ⚠️ 项 | 4 条（前 2 条纯 docs 回填，随收尾刀处置） |

**最终判定：PARTIAL**（工程侧全绿，真机验收缺口待老大侧闭合）。

> 说明：本报告为 2026-10-09 老大指令「按开发工作流推进」的**事后补验**产物；S-172 ~ S-177 原实施时未走阶段五/六，本次按 `docs/dev-workflow.md` 补齐。
