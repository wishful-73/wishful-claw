# S-195 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`）。
> 审查对象：`5b65a231`（分支 `dev/v2-iter-39`，base `f3eed21b`），4 文件 +30 / −5。
> 规划依据：`requirements/S-195.md`（方案 A）、`plan-s195/plan.md`。
> 审查方式（读码）：`git show 5b65a231` 全文；`components/chat/DesktopActionToolCard.tsx`（全文相关段 `:45-55 / :86-89 / :225-237`）；`BrowserToolCard.tsx`（`:62-72 / :305-331`）；`ImagePluginToolCard.tsx`（`:52-62 / :154-164`）；`lib/app-plugin/desktop-routing.ts`（全文）；`execution-outline.ts:195-233`；`process-summary.ts:28-46 / :115`；`AssistantMessage/utils.ts:19-27`；`ToolCallCard/utils.ts:100-143` + `ToolCallCard/index.tsx:168-214`；全仓 grep `function parseErrorMessage` / `isStructuredToolErrorText` / `output.trim()` / `parsedError` / `hasError`。
> 出报告：2026-10-13。
> **结论：⚠️ 有条件通过（无阻断）—— 三处同源兜底已一并删除，真失败仍有 `status` / `error` prop / `{"error":…}` 三道兜底；但主会话补审发现 `isBrowserToolName` 恒 `false` 使 `BrowserToolCard` **整张卡不可达** ⇒ 三处修复里的浏览器那处是空转（见 ⚠️-1）。另有 2 条非阻断观察（无回归测试、判据 5 措辞与实现略有出入）。**
>
> **报告合并说明**：本报告主体由独立 subagent（`code-reviewer`，79 次工具调用 / 47 轮）产出；⚠️-1 由**主会话补审**追加（子 agent 未覆盖到该落点），其余保持原样。

---

## 一、改动核对

| 审查项 | 结论 | 证据 |
|---|---|---|
| 三处 `parseErrorMessage` 兜底行删除 | ✅ | `DesktopActionToolCard.tsx:54`、`BrowserToolCard.tsx:71`、`ImagePluginToolCard.tsx:61` 三处均由 `return output.trim() \|\| null` 改为 `return null`，且改了同一条注释 |
| 三处实现「逐字相同」确为同源 | ✅ | 三处 `parseErrorMessage` 函数体（含前置 `typeof output !== 'string'` 与 `parsed.error` 分支）逐字一致——改后仍一致 |
| 仓内无第四处 `parseErrorMessage` | ✅ | `git grep 'function parseErrorMessage'` = 3，全部已改 |
| `isDesktopControlToolName` 由空壳改为查表 | ✅ | `desktop-routing.ts:1-19`：`import` 五个 `DESKTOP_*` 常量（`lib/app-plugin/types.ts:22-26`）组成 `Set`，`.has(name)`；不再恒 `false` |
| 查表常量集与 `types.ts` 一致 | ✅ | `types.ts:22-26`：Screenshot/Click/Type/Scroll/Wait 五个，与 `desktop-routing.ts:9-15`、`tool-block-renderer.tsx:262-268` 的路由分支完全对应 |
| 本次未动共用工具（刻意不做） | ✅ | `lib/tools/tool-result-format.ts` 未在 diff 内；`isStructuredToolErrorText` / `decodeStructuredToolResult` 零改动 |
| 无 C# / DB / i18n 改动 | ✅ | `git show --stat 5b65a231` 仅 4 个渲染端文件 |

---

## 二、逐条验收判据核验

| # | 判据（S-195 §五） | 结论 | 证据 |
|---|---|---|---|
| 1 | 主判据：桌面工具卡片子标题「已完成」且**无红色告警框** | **符合（静态）** | 成功体 `{"success":true,…}` 走 `decodeStructuredToolResult` → 无 `error` 字段 → 落到 `return null`（`:54`）⇒ `parsedError` 退回 `error \|\| canceledMessage`；status=completed 时二者皆空 ⇒ `hasError=false`（`:89`）⇒ `:225` 红框不渲染。实机由阶段六 |
| 2 | 浏览器工具卡 / 图片生成卡不再恒标失败 | **符合（静态）** | 同源改动；且浏览器卡 `:331` 的 `rawOutput` 只在 `!jsonOutput && !parsedError` 时有值——成功 JSON 有 `jsonOutput`，行为不变 |
| 3 | 真失败仍标红：`status === 'error'` 或输出为 `{"error":…}` | **符合**（含一处已文档化边界，见 💡-1） | `:89` `status === 'error' \|\| status === 'canceled' \|\| Boolean(parsedError)` 保留；`{"error":…}` 由 `:48` 的 `typeof parsed.error === 'string && parsed.error.trim()` 分支捕获（该分支**未删**）；`error` prop 在 `:86` 优先级最高。多键错误体 `{"error":…,"success":false}` 也命中该分支（`parsed.error` 仍是字符串） |
| 4 | 折叠态摘要计入「N 个桌面操作」 | **符合** | `execution-outline.ts:209` 现可达 → `category='desktop'`；`process-summary.ts:36 case 'desktop' → 'desktop'`；`:115` 输出 `workbench.summaryDesktop` 文案。可见性不变：`getToolVisibility`（`:222-233`）对 `desktop` 不在 ordinary 名单内 ⇒ 仍为 `force`（与改动前 `unknown`→`force` 相同） |
| 5 | `DesktopScreenshot` / `CaptureAppWindow`（返回数组）行为不变 | **基本符合（卡片不变）/ 摘要分类有变（见 💡-2）** | 卡片侧：`parseErrorMessage` 首行 `typeof output !== 'string'` 对数组提前返回 `null`（改动前后一致）。但 `isDesktopControlToolName` 现包含 `DesktopScreenshot` ⇒ 其 `category` 由 `unknown` 变 `desktop`，折叠态摘要归类随之改变——属 S-195 同族修的**预期**变化，但判据 5 字面「行为不变」未覆盖这一项 |

---

## 三、发现

### 💡-1 被接受的代价边界：非结构化纯文本失败 + `status !== 'error'` 时不再标红（真失败兜底仍足）

删掉兜底后，唯一不再触发红框的路径是「输出为非 JSON 纯文本、`status` 非 `error`、`error` prop 为空」。构造函数化反例：某工具返回纯文本 `"Error: window not found"` 且 `isError` 未置位（`AssistantMessage/utils.ts:24 resolveToolCallStatus` 只有在 `result.isError` 为真时才给 `status='error'`）。此时代码走 `return null` ⇒ 卡片显示「已完成」。

**判定可接受**，因为：
1. `requirements/S-195.md` §六明确接受该代价，且称当前工具集无此实例（本审查未找到反例实现）；
2. C# 侧错误体（单键 `{"error":…}` 与多键 `{"error":…,"success":false}`）都含字符串 `error`，被 `:48` 分支接住，不会漏判；
3. `status==='error'` / `canceled` / `error` prop 三道兜底均在（`:86`、`:89`）。

**建议**：在 `parseErrorMessage` 的注释里补一句「纯文本输出的失败不在本函数职责内，由 `status` 承担」，避免后人误以为这里能识别一切失败。

### 💡-2 S-195 无任何回归测试

`git show --stat 5b65a231` 只含 4 个源文件，`tests/**` 无新增/改动。本 bug 是「判定逻辑写错」，属纯函数可测：`parseErrorMessage` 是模块内非导出函数，但可通过 `parseErrorMessage`-等价的输入/输出对（或把它抽成可测工具）落一组断言（`{"success":true}`→null、`{"error":"x"}`→`"x"`、数组→null）。

**判定非阻断**：改动是「删一行兜底」，风险面极小；且仓库对同类小改在 S-192/S-193 亦以「实机验证 + 代码审查」替代自动化。列为遗留项。

### 💡-3 判据 5 与实现的口径差（`DesktopScreenshot` 摘要分类改变）

见 §二-#5。`DesktopScreenshot` 的**卡片渲染**确未变（数组提前返回），但其 `execution-outline` 分类由 `unknown` 变 `desktop`，折叠态摘要从「N 个操作」归入「N 个桌面操作」。这是同族修的**有意行为**，不构成缺陷，但判据 5 写「行为不变」会让人误判。建议把判据 5 改为「卡片呈现不变；摘要归类随桌面操作一并修正」。

### 💡-4 全仓排查：未见其它卡片把成功输出当错误（仅 3 处病灶，已全修）

- 只读核了同类候选：
  - `ToolCallCard`（通用卡）：`deriveOutputError`（`ToolCallCard/utils.ts:100-114`）**也有**「非 JSON → `return trimmed`」的同形兜底，但其消费点 `ToolCallCard/index.tsx:214` 是 `compactHeaderError = Boolean(displayError) || (status === 'error' && !!outputError)`，而 `displayError`（`:171-173`）= `error || (status === 'error' ? outputError : null)` —— **`outputError` 恒受 `status === 'error'` 门控**，成功输出不会触发 ⇒ 安全，无需改动。
  - `PlanReviewCard.tsx:218` 用 `isStructuredToolErrorText`（只认纯 `error` 单键对象）⇒ 安全。
  - `AskUserQuestionCard.tsx:39` 同用 `isStructuredToolErrorText` ⇒ 安全。
  - `CodeGraphToolCard.tsx:245` 走 envelope `isError` 字段 ⇒ 安全。
- 结论：**S-195 的 3 处即为全仓同类病灶全集**，无遗漏落点。

---

### ⚠️-1（主会话补审）`isBrowserToolName` 恒 `false` ⇒ `BrowserToolCard` **整张卡不可达**，本刀浏览器侧那处修复是空转

`src/renderer/src/lib/app-plugin/browser-tool-names.ts` 全文只有 3 行：

```ts
export function isBrowserToolName(_name: string): boolean {
  return false
}
```

它与本次修的 `isDesktopControlToolName` 是**同一提交**（`d6228b27 feat(chat): 全量移植 OpenCowork 聊天渲染系统`）引入的同类空壳，**本刀未动它**。它的两处消费点**全部因此不可达**：

| # | 消费点 | 后果 |
|---|---|---|
| 1 | `execution-outline.ts:208` `if (isBrowserToolName(name)) return 'browser'` | `'browser'` 分类不可达 —— 与本刀刚修好的 desktop 那处**完全对称**（折叠态摘要文案退化） |
| 2 | `tool-block-renderer.tsx:220` `if (isBrowserToolName(block.name)) { … <BrowserToolCard … /> }` | **`BrowserToolCard` 永远渲染不出来** ⇒ 浏览器工具落进后面的通用 `ToolCallCard` 回退分支 |

**这不是「未启用的功能」**：`lib/app-plugin/types.ts:9` 定义 `BROWSER_PLUGIN_ID`；`:15-21` 定义 **7 个** `BROWSER_*` 工具名常量（`BrowserNavigate` / `BrowserGetContent` / `BrowserScreenshot` / `BrowserSnapshot` / `BrowserClick` / `BrowserType` / `BrowserScroll`）；`:81-93` 在 `APP_PLUGIN_DESCRIPTORS` 里把这 7 个全注册进 `toolNames`；`:50` 的 `isAppPluginEnabledByDefault` 对 `BROWSER_PLUGIN_ID` **返回 `true`**。⇒ 浏览器插件是**默认启用的真功能**。

**引用面证据**：全仓 `BrowserToolCard` 只有 1 处 import（`tool-block-renderer.tsx:23`）与 1 处使用（`:229`），且该使用点即由恒 `false` 的判定把守 ⇒ **`BrowserToolCard.tsx`（含本刀刚改的 `parseErrorMessage`）是死代码**。

**对本刀结论的修正**：本刀三处 `parseErrorMessage` 修复中，**桌面与图片两处有效，浏览器那处打在不可达路径上**。改动本身无害（不是错修），但**没有兑现用户可见效果** —— 浏览器工具卡片当前根本走不到。

**建议（二选一，等老大裁决）**：

1. **补修（推荐）**：按本刀修 `desktop-routing.ts` 的同一手法，把 `isBrowserToolName` 改成 7 个 `BROWSER_*` 常量的 `Set` 查表（约 15 行）。**收益一箭双雕**：① 浏览器工具终于渲染专属卡片（本刀的浏览器修复才真正生效）；② `execution-outline` 的 `'browser'` 分类恢复可达，折叠态摘要口径与 desktop 一致。**建议单列一条需求**（S-197），因为它改变的是**可见行为**（卡片从通用卡变专属卡），不只是文案。
2. **不修**：在需求正文记明「浏览器侧两处空壳在本轮不收敛」，并把 `format-tokens.ts` 之外这类「恒 false 空壳」登记成一条待办，避免后人再踩。

**风险提示**：若选 1，属**可见行为变化** —— 浏览器工具的卡片外观会从通用卡变成 `BrowserToolCard`（含图标、专属布局、`ImagePreview`）。按 `AGENTS.md`「方向性变化谨慎」，这条**必须先由老大拍板再动**，不宜并入收尾刀。

---

## 四、建议

1. 补一组 `parseErrorMessage` 行为断言（成功 JSON→null / `{"error":…}`→错误文本 / 数组→null），防回归（非阻断）。
2. 把 `parseErrorMessage` 的注释补上「纯文本失败不在职责内」（💡-1）。
3. 订正 `requirements/S-195.md` §五判据 5 的措辞（💡-3）。

---

## 五、门禁证据 / 提交范围

- 门禁（主会话）：`npm run typecheck` 0 错误；`npm test` 70/70（TS 53 + C# 17）。本条无 C# 改动。
- 提交范围：`5b65a231` = 4 文件（3 卡片 + `desktop-routing.ts`），+30 / −5。
- 本报告仅新增 `docs/plans/iter-v2-39/plan-s195/review_report.md`，未改任何源码。

---

## 六、遗留项

- 💡-2 无自动化回归（建议补，非阻断）。
- 💡-3 判据 5 措辞订正（文档）。
- 阶段六实机核验项：桌面 / 浏览器 / 图片三类工具卡片各调一次，确认「已完成」且无红框；真失败（如工具抛错）仍标红。
