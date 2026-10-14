# S-195 计划（工具卡片误判「失败」）

> 状态：**已实施**（`5b65a231`，2026-10-13）；阶段五审查已出（`review_report.md`）；阶段六验证已出（迭代级 [`../verification_report.md`](../verification_report.md) §8.3：**PARTIAL**，实机项见 §8.5 第 15 项）。
> 需求：`requirements/S-195.md`。
> 老大口径：2026-10-13 16:28 提出（「我们有桌面操作工具，我看到每次调用显示的都是失败……渲染组件和实际返回不匹配」）→ 16:58 登记；方案倾向 A（§五 表明文）。
> 归属：**iter-v2-39**（bug 修复）。

---

## 一、目标

工具调用卡片**不再把「成功的输出」当错误**：`hasError` 只由 `status` / `error` prop 决定，输出内容不再参与成败判定。三处同源实现一起改，行为保持一致。

## 二、落点

| 文件 | 改什么 |
|---|---|
| `components/chat/DesktopActionToolCard.tsx` | `parseErrorMessage` 兜底行 `return output.trim() \|\| null` → `return null`（+ 注释） |
| `components/chat/BrowserToolCard.tsx:62-69` | 同上 |
| `components/chat/ImagePluginToolCard.tsx:52-59` | 同上 |
| `lib/app-plugin/desktop-routing.ts` | `isDesktopControlToolName` 由恒 `false` 空壳改为按 `types.ts` 的五个 `DESKTOP_*` 常量查表 |

**同族缺陷（本条一并修）**：`isDesktopControlToolName` 的调用点只有 `execution-outline.ts:209`，空壳导致 `category` 永远落不到 `'desktop'`，桌面工具在折叠态过程摘要里被计入「执行了 N 个操作」而不是既有的「N 个桌面操作」（`process-summary.ts:36` + `workbench.summaryDesktop` 文案早已就位）。改后行为变化仅限摘要文案。`isBrowserToolName` 同为空壳，但 `process-summary.ts:29` 已用 `startsWith('Browser')` 兜住，**不动**。

**不做跨端登记** —— 纯渲染端判定逻辑，无 C# / 无 DB / 无新 i18n 键。

## 三、步骤（终止检查）

- [✓] 1. 三处 `parseErrorMessage` 兜底行改为 `return null`（串行 Edit）
- [✓] 2. `isDesktopControlToolName` 落地为查表实现，行尾归一 CRLF
- [✓] 3. 门禁：`npm run typecheck` 0 错误；`npm test` **70/70**（TS 53 + C# 17）
- [✓] 4. 实机复现证据留档（`DesktopWait {delayMs:300}` 返回成功 JSON）—— 见需求 §3.3
- [ ] 5. 提交（本条一刀）
- [ ] 6. 阶段五：独立 subagent 审查
- [ ] 7. 阶段六：验证（实机确认桌面/浏览器/图片三类卡片均不再标红）

## 四、门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | 70/70（TS 53 + C# 17） |
| `dotnet build src/runtime/WishfulClaw.sln` | 本条无 C# 改动，收尾统一跑 |

## 五、验收判据

1. **主判据**：调用 `DesktopWait` / `DesktopClick` 等桌面工具，卡片子标题为「已完成」而非「失败」，且**不出现红色告警框**。
2. 浏览器工具卡（`BrowserNavigate` 等）、图片生成卡同样不再恒标失败。
3. 真失败仍标红：`status === 'error'` 或输出为 `{"error": "..."}` 时，红色告警框照常显示、内容为错误文本。
4. 折叠态过程摘要里桌面操作计入「N 个桌面操作」，不再混进「执行了 N 个操作」。
5. `DesktopScreenshot` / `CaptureAppWindow`（返回数组）行为不变。

## 六、非目标（刻意不做）

1. **不动 `decodeStructuredToolResult` / `isStructuredToolErrorText`** —— 共用工具，30+ 处调用，改动面远超本 bug；且方案 B（改用 `isStructuredToolErrorText`）会漏判 `{"error":"x","success":false}`，已否。
2. **不动 `status` 语义与 `canceledMessage` 分支** —— `status === 'error' / 'canceled'` 的判定是对的。
3. **不统一三个卡片的其它重复代码** —— `parseStructuredOutput` 等也是三份拷贝，收敛属重构，与本 bug 无关。
4. **不动 `isBrowserToolName` 空壳** —— 已被 `process-summary.ts:29` 的 `startsWith('Browser')` 覆盖，改它无行为收益。

   > **订正（2026-10-14，登记 S-199 时自查）**：**「改它无行为收益」不成立**。当时**只查了摘要那条链，漏了 `tool-block-renderer` 的卡片链** —— `tool-block-renderer.tsx:220` 的 `if (isBrowserToolName(block.name))` 被空壳挡死，`BrowserToolCard`（491 行）**从未渲染**，7 个浏览器工具全落通用 `ToolCallCard`；它用的 `toolCall.browser.*` 文案同样从未被读到。
   >
   > 摘要那条链的判断**本身是对的**（`process-summary.ts:29` 确实先短路），**桌面与浏览器在这里并不对称**：桌面卡片分支（`tool-block-renderer.tsx:262-268`）**直接内联了 5 个 `DESKTOP_*` 常量**，压根不走 `isDesktopControlToolName` ⇒ 所以 S-195「改后行为变化仅限摘要文案」**对 desktop 成立**，而**浏览器这份是唯一真正被空壳挡住的卡片**。⇒ 已另立 **S-199**（修法照 `desktop-routing.ts` 对称查表，等老大点头）。
