# S-194 计划（token 数量显示统一）

> 状态：**已实施**（`f3eed21b`，2026-10-13）；阶段五审查已出（`review_report.md`）；阶段六验证已出（迭代级 [`../verification_report.md`](../verification_report.md) §8.2：**PARTIAL**，实机项见 §8.5 第 14 项）。
> 需求：`requirements/S-194.md`（§四 定案方案）。
> 老大口径：2026-10-13 11:26「token 加 G 单位那事还没拍板……这个按照你的推荐登记」⇒ 按 `requirements/S-194.md` §四 定案实施。
> 归属：**iter-v2-39**（体验优化 —— 显示格式收敛）。
> **补记说明**：本计划目录是事后补建的（实施时只落了需求正文与代码，未建 plan 目录），内容按 `f3eed21b` 的提交与代码现状回填。

---

## 一、目标

同一个 token 数值在三处显示成三种串、后缀大小写还不统一，且三套实现共有「`999999 → 1000k`」的进位缺陷。收敛成一份实现，补齐 G / T 单位。

## 二、落点

| 文件 | 改什么 |
|---|---|
| `lib/format-tokens.ts` | 重写 `formatTokens`：单位阶梯常量；`<1000` 输出整数原值；同单位内 `<10` 两位 / `<100` 一位 / `>=100` 整数；**非整数先取整再换算**；四舍五入跨过 1000 时升一级重算；**删除 `formatTokensDecimal`** |
| `components/settings/UsagePanelParts.tsx` | 删本地 `formatTokens`，改为从 `@renderer/lib/format-tokens` import |
| `components/settings/UsagePanel.tsx` | 同上改 import（`RollupTable` / `StatCard` / 图表仍从 `./UsagePanelParts` 取） |
| `components/settings/usage-detail-table.tsx` | 同上 + `sourceLabel` 仍从 `./UsagePanelParts` |
| `components/chat/TokenCounter.tsx` | `formatTokensDecimal` → `formatTokens`（import 与渲染处） |
| `tests/token-format/program.ts` | **新建**：27 断言（防御 0/负/NaN/Infinity、换算对照、进位与精度边界、后缀大小写、「仓内只剩一份实现」扫描断言） |
| `package.json` | 新增 `test:token-format` 脚本 |

**无 C# / DB / i18n 键。**

## 三、步骤（终止检查）

- [✓] 1. 重写 `formatTokens` + 删 `formatTokensDecimal`
- [✓] 2. 三处调用方改 import（UsagePanelParts / UsagePanel / usage-detail-table / TokenCounter）
- [✓] 3. 新增 `tests/token-format/program.ts` + `package.json` 脚本
- [✓] 4. 修测试自身写错的期望（`1_234.6` → `1.23k`；补 `999.6 → 1.00k` 升档断言）
- [✓] 5. 修 `ERR_INVALID_URL`（打包后 `import.meta.url` 不可靠 ⇒ 改 `path` + `__dirname` 上溯三级）
- [✓] 6. 门禁：`npm run test:token-format` 27 断言全过；`npm run typecheck` 0 错误
- [✓] 7. 提交 `f3eed21b`（7 文件，+177 / −30）
- [ ] 8. 阶段五：独立 subagent 审查 → `plan-s194/review_report.md`
- [ ] 9. 阶段六：验证（实机确认三处显示一致、G 单位生效）

## 四、门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | 70/70（TS 53 + C# 17，含本需求新增的 token-format 套件） |
| `dotnet build src/runtime/WishfulClaw.sln` | 本条无 C# 改动，收尾统一跑 |

## 五、验收判据

1. **主判据**：同一数值在上下文环 / 输入框下方 / 设置页用量统计三处**显示完全一致**。
2. `1127850000` 显示为 `1.13G`（不再是 `1127.9M` / `1127.85M` 两种串）。
3. 后缀口径统一：`k` 小写，`M` / `G` / `T` 大写。
4. 进位不再出现 `1000k`（封顶值升档）。
5. `<1000` 显示整数原值，不带单位。
6. 超大值（`T` 以上）不出现 `NaN` / `Infinity` / 空串。

## 六、非目标（刻意不做）

1. **不改版本规则** —— `0.2.{N}` 暂不动。
2. **不统一「格式化」以外的其它 token 口径**（如估算方式、上限判定）—— 只动显示格式。
3. **不给其它面板另加单位**（如成本 / 时长）—— 与本条无关。
