# 合规报告：plan-s173（阶段三 · 规划验证）

> 被验证对象：`docs/plans/iter-v2-38/plan-s173/plan.md`（+ 需求正文 `requirements/S-173.md`）
> 检查项来源：`docs/dev-workflow.md` 阶段三（第 353-372 行）
> 验证方式：独立 subagent（`code-reviewer`，只读；未改任何文件、未跑构建/测试），以 `git show 17dafdc1` / `17dafdc1^:<file>` 逐文件比对
> 落地提交：`17dafdc1`（feat(image): 图片生成模型设置入口落到「模型管理」第四档（S-173），11 files, +271/−39）
> 时间：2026-10-09（事后补验）

---

## 一、总体结论

**❌ 项 = 0 · 可进入执行态。**

代码与三个核定口径（**方案 A** / **接线走甲（Worker 送达）** / **悬空即报错、不回落**）**如实落地、自洽**：分层边界干净（主进程不读 `config.json`，只认反向请求里带来的两个 id），S-166 三级回落的既有断言**一行未改**，`docs/plans/` 文档格式合规。发现的均为文档层面 ⚠️（勾选失真、漏列文件、行号微偏、参考路径写错、BOM 副作用），无阻断级问题。

**最值得处理的一条**：步骤 4 原勾 `[x]` 但真机未做 —— 属**验收完整性**缺口（功能闭环最后一环未验），非计划合规性问题。

---

## 二、逐项结论（8 项）

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 步骤完整覆盖目标 | ⚠️→✅ | 五步覆盖「模型管理页指定图片生成模型」全链（配置扩容 → 渲染第四档 → 主进程解析 → 真机 → 整体）；**原 §四 漏列 `ProviderCompletionSettingsService.cs`**（`IsPair` 第四对校验），已补 |
| 2 | 每步有验证检查点 | ✅ | 步骤 1-5 全带检查点（`plan.md:38/44/51/56/60`） |
| 3 | 文件路径合规 | ✅ | C# 落 `Infrastructure`/`Agent`（PascalCase）；主进程 kebab-case；测试 `tests/image-endpoint/program.ts` + `package.json` 注册 `test:image-endpoint`，符合 dev-workflow |
| 4 | 分层依赖正确 | ✅ | Agent → Infrastructure 为允许方向；`Infrastructure` 侧无逆向引用；主进程不读 `config.json`（`image-endpoint.ts` 无该引用）；渲染端只经 Worker RPC |
| 5 | 行号属实 | ⚠️→✅ | 主体逐条命中（`ProviderCompletionSettings.cs:12-18/22/145-190/192-216`、`AgentRuntimeImageGenerateExecutor.cs:64-84`、`image-reverse-handler.ts:52-59` 等）；`requirements/S-173.md` 两处行号微偏已订正（见 §三） |
| 6 | 现状描述与代码一致 | ✅ | `ModelFormDialog.tsx:262-278` 确有「Model category」下拉含 `image`（`:274`）；S-173「唯一可用入口深且绕」属实 |
| 7 | 刻意不做 / 不回退既有修复 | ✅ | `ModelManagementPanel` 未动；`ModelFormDialog` 的「使用方式=图像」未删；S-166 `resolveImageEndpoint`（`:72-103`）一行未改（纯新增） |
| 8 | CRLF / 无 BOM | ✅ | `plan.md` 108 CRLF / 0 裸 LF / 无 BOM；`S-173.md` 133 / 0 / 无 BOM |

---

## 三、验证报告点出、已在本轮订正的文档问题

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | 中 | `plan.md` 步骤 4 | 勾 `[x]` 但 §七写明「真机未做」，**勾选与事实矛盾** | ✅ 改回 `[ ]` 并注明「待老大真机」；§七 补第 4 条说明 |
| 2 | 低 | `plan.md` 步骤 5 | 写 `npm test 65/65`，实施记录为 `66/66`（复算 50 + 16 = 66 属实） | ✅ 步骤 5 统一为 **66/66** |
| 3 | 低 | `plan.md` §四 | 漏列 `ProviderCompletionSettingsService.cs`（`IsPair` 增第四对） | ✅ 补进涉及文件表 |
| 4 | 低 | `plan.md` §五 参考源码 | 路径 `D:\claw\open-cowork-1.4.0\settings\pages\model\ModelPage.tsx` **不存在**（行号 1383-1388 与语义正确） | ✅ 订正为 `D:\claw\OpenCowork\src\renderer\src\settings\pages\model\ModelPage.tsx` |
| 5 | 低 | `requirements/S-173.md:49-50` | 行号微偏：`image-endpoint.ts:50` 应为 `:52`；`:36-39` 应为 `:35-38` | ✅ 两处订正 |
| 6 | 低 | `ProviderCompletionSettingsService.cs` / `ProviderCompletionSettingsPanel.tsx` | 提交顺带抹掉两文件首行 UTF-8 BOM（未申报） | ✅ 已在 `plan.md` §七 补第 3 条知晓项（方向与仓库多数文件一致，不回滚） |

---

## 四、非本刀欠账（记录，不纳入本刀）

- **真机验收缺口**：步骤 4（真机生图 → 确认打的是指定位 provider/model；清空后回落不变）**未做**，需真实 provider，留老大侧。功能闭环最后一环未验。
- 步骤 3 的实现形态与计划不同（另起 `resolveExplicitImageEndpoint` 而非给 `resolveImageEndpoint` 加参数）—— **已在 `plan.md` §七 主动申报**，属自洽偏离，**建议保留该设计**（分开让 S-166 既有断言一条未改）。
- `docs/plans/` 全树 **61 个历史文件带 UTF-8 BOM**（`iter-v2-19` ~ `iter-v2-28`），与本次 S-173 文件无关。

---

## 五、结论

**可进入执行态** —— 代码改动已落地（`17dafdc1`）并通过门禁（`typecheck` 0 错 / `npm test` 66/66 / `dotnet build` 0 错 0 警 / `test:image-endpoint` 43 checks），文档论断订正完毕，已随需求一刀提交。

> 说明：本报告为 2026-10-09 老大指令「38 迭代的其它计划都按照开发工作流去验证一遍」的**事后补验**产物。S-172 ~ S-176 原实施时未落 `compliance_report.md`（历史省略该产物），本次按工作流补齐。
