# iter-v2-34 规划合规报告

- 审查对象：docs/plans/iter-v2-34/plan.md
- 审查日期：2026-09-21
- 结论：**PASS**（❌ 0 项；⚠️ 4 项，不构成阻断）
- 抽查方式：Read（plan.md 149 行全读 / raw-requirements.md S-111 L126-263、S-112 L266-305）+ 1 次 PowerShell 批量 Test-Path / 逐行取行

## 逐项结论

| # | 检查项 | 结论 | 证据 |
|:--:|---|---|---|
| 1 | 覆盖完整性 | ✅ | S-112 三条 → 步骤 1（L65-69，`:95` 改 `openSettings('about')`）、步骤 2（L70-72，key 改名 + zh/en 值）；S-111 可实施项 → 步骤 4（裁定 1，6h）、步骤 5（裁定 3/7/8 + 10c）、步骤 6（裁定 10 + 10a 方案 B + 10b 方案 A）、步骤 7（裁定 5）、步骤 8（裁定 6）、步骤 9（连带 B 文案）。裁定 4 / 裁定 9 在「口径来源」表显式标注「**已具备，无需实施**」（L37、L42），符合规则 |
| 2 | 每步有验证检查点 | ✅ | 10/10 步全部带 `**验证**` 行：L69、L72、L75、L80、L84、L88、L93、L96、L100、L104 —— 无「只写改完、无验证手段」的步骤 |
| 3 | 路径真实存在 | ✅ | 12 条 `Test-Path`：10 条 `EXISTS`；`UpdateIndicator.tsx` = `MISSING`（标【新建】，**父目录 `src/renderer/src/components/updater` = EXISTS**，合规）；两个【删】目标 `UpdateStatusBanner.tsx`、`banner-position.ts` 均 `EXISTS`。另查 `components/layout`、`hooks` 均 `EXISTS` |
| 4 | 行号属实 | ✅ | 抽查 5 处（+ 加抽 1 处，共 6 处）**逐行内容全对**，详见下方「抽检实录」 |
| 5 | 参考源码路径 | ✅ | `D:\koda\OpenCowork` = EXISTS、`D:\koda\DeepSeek-Reasonix-main-v2` = EXISTS；plan 点名的 4 个具体文件全部 EXISTS（含 `DeepSeek-Reasonix-main-v2\desktop\frontend\src\components\UpdateBanner.tsx`） |
| 6 | 口径无断章取义 | ✅ | ① 频率 = **6h**：plan L34「低频定时 6h」+ L79 `60 * 60 * 1000` → `6 * 60 * 60 * 1000`，与 raw L179 一致（非 1h、非 3h）；② 浮块 = **砍掉（方案 A）**：plan L38 + L89-93，与 raw L183/L211 一致；③ 点图标重查 = **10a 方案 B / 10b 方案 A / 10c 图标即「有更新」信号**：plan L43 + 步骤 6（L86-87），与 raw L238 逐条对应；④ S-112 路径 = **A `openSettings('about')` 整页**：plan L31 + 步骤 1（L66），与 raw L286 一致（**未**误写成内嵌 `openSettingsPage`，raw L290 明示 B 路径已否） |

## 抽检实录（工具真实输出）

**行号核对（`Get-Content …[n-1]`，PS 5.1）**

| 引用 | plan 声称 | 实际该行内容 | 判定 |
|---|---|---|---|
| `layout/TitleBar.tsx:95` | `onClick={openUserGuide}` | `              onClick={openUserGuide}` | ✅ |
| `locales/zh/layout.json:101` | `topbar.userGuide` 值「使用指引」 | `    "userGuide": "使用指引",`（key 为 `userGuide`，非扁平 `topbar.userGuide` —— 在 `topbar` 命名空间下，属命名惯例差异，不影响改点名） | ✅ |
| `src/main/updater.ts:52` | `PERIODIC_RECHECK_INTERVAL_MS = 60 * 60 * 1000`（1h） | `const PERIODIC_RECHECK_INTERVAL_MS = 60 * 60 * 1000` | ✅ |
| `App.tsx:229` | `shouldLiftToastsForBanner` 用法 | `offset={shouldLiftToastsForBanner(updater.state.phase, updateBannerPosition) ? { bottom: UPDATE_BANNER_TOAST_BOTTOM } : undefined}` | ✅ |
| `UpdateDialog.tsx:172-176` | `trayHint`（「可随时从托盘『更新详情』查看进度」） | `172-176` = `<p>` / `{t('updater.dialog.trayHint', {` / `defaultValue: '可随时从托盘『更新详情』查看进度。'` / `})}` / `</p>` | ✅ |
| `layout/TitleBar.tsx:101`（加抽） | tooltip key `topbar.userGuide` | `<TooltipContent side="bottom">{t('topbar.userGuide', { defaultValue: '使用指引' })}</TooltipContent>` | ✅ |

> 注：控制台回显中文为乱码（PS 5.1 输出编码所致），按字节比对内容与 plan 所述一致，非文件问题。

**路径批量 `Test-Path`（`cd D:\claw\wishful-claw`）**

```
EXISTS  src/renderer/src/components/layout/TitleBar.tsx
EXISTS  src/renderer/src/locales/zh/layout.json
EXISTS  src/renderer/src/locales/en/layout.json
EXISTS  src/main/updater.ts
MISSING src/renderer/src/components/updater/UpdateIndicator.tsx   ← 标【新建】，父目录 EXISTS
EXISTS  src/renderer/src/hooks/use-app-updater.ts
EXISTS  src/renderer/src/components/updater/UpdateDialog.tsx
EXISTS  src/renderer/src/App.tsx
EXISTS  src/renderer/src/components/updater/UpdateStatusBanner.tsx  ←【删】目标在
EXISTS  src/renderer/src/components/updater/banner-position.ts      ←【删】目标在
EXISTS  src/renderer/src/locales/zh/settings.json
EXISTS  src/renderer/src/locales/en/settings.json
```

**参考源码路径**

```
EXISTS  D:\koda\OpenCowork
EXISTS  D:\koda\DeepSeek-Reasonix-main-v2
EXISTS  D:\koda\OpenCowork\src\renderer\src\components\layout\TitleBar.tsx
EXISTS  D:\koda\OpenCowork\src\renderer\src\App.tsx
EXISTS  D:\koda\OpenCowork\src\main\updater.ts
EXISTS  D:\koda\DeepSeek-Reasonix-main-v2\desktop\frontend\src\components\UpdateBanner.tsx
```

## ❌ 项明细

**无。** 六项检查全部通过，❌ = 0。

## ⚠️ 项明细

| # | 位置 | 问题 | 建议 |
|:--:|---|---|---|
| W1 | plan.md L15、L34-45（口径来源表）与 L65-104（步骤清单） | **两条「否定式」裁定未在步骤清单里显式标注「无需实施 / 保持原样」**：S-111-2「不做自动下载」、S-112-3「图标保持 `HelpCircle`」。二者只在「口径来源」表里有裁定记录，步骤里既无对应动作、也无「无需实施」字样 | 因属「不做 / 不改」项，**不构成漏实施**（放宽判为 ⚠️ 而非 ❌）。建议在各步骤清单的空档处补一行括注（如「S-111-2 / S-112-3：不做，无需步骤」），避免后续审查反复核这条 |
| W2 | 步骤 5（L81-84） | 裁定 8「**图标常驻**（不自动消失、不做 dismiss）」未在步骤描述里显式写出；步骤 5 只写了「四态 + tooltip 带百分比 + 任何窗口宽度都在」+ 验证「无更新时不渲染（10c）」。常驻语义需由「四态」+「10c 无更新不渲染」间接推出 | 步骤 5 补一句「有更新即常驻，**不提供 dismiss / 不自动隐藏**，直到下载+安装完成」，把裁定 8 落成可验收条目 |
| W3 | 步骤 8（L94-96） | 该步验证手段是「**真机实跑（或 dev 下模拟相位）**」—— 属人工验证，无任何 CI / 脚本化锚点（对比步骤 1/2/7 有 `grep 0 命中` 这类机械可判据）。步骤 3 亦含真机项，但至少还挂了 `npm run typecheck` | 可加机械判据兜底，如 `grep -n "setUpdateDialogOpen(true)" App.tsx` 命中 + `grep "toast.success" App.tsx` 命中；至少让「忘了实现」这类漏改能被脚本抓到 |
| W4 | 步骤 7 「显式检查点」（L92）与风险表 L138 | `updateBannerPosition` / `normalizeUpdateBannerPosition` 的处置**结论留空**（「删字段 or 留兼容」二选一未定），推迟到实施时确认。这是 raw L207 的既有设计（碰存量 settings 不宜拍脑袋），但意味着步骤 7 的"完成"标准尚不闭合 | 保持现状可接受（已给出回退「否则只停用不删字段」）；建议把「先跑一次 `settings-store` 迁移的存量配置用例」写成步骤 7 验证行的具体动作，让检查点有可执行形态 |
