# Plan: S-222 聊天窗时间统一为时分，跨天补日期

> 阶段二产物（**v2，阶段三 ⚠️5 收口后**）。需求正文见 `../requirements/S-222.md`（含 §5.2 六条已拍板决策），本文只写**怎么做**与**怎么验**。
> 收口依据见 `compliance_report.md §3.2(a)(b)(d) / §3.3`。

## 目标

聊天窗内三处时刻统一走一个纯函数：当天 `09:55`（不带日期），非当天 `10-22 23:41`，跨年 `2025-12-31 23:41`。无效值返回空串，调用方据此不渲染。

## 步骤清单

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | 新建 `src/renderer/src/lib/utils/chat-time.ts`，导出 `formatChatTime(value, now?)` | 纯模块：零 import、不读 `window`、不依赖 i18n；手写补零，**不用 `toLocaleString`**；`now` 有默认值、越界值有护栏（见 §实现要点） | [x] |
| 2 | 新建 `tests/chat-time/program.ts`（沿用 `tests/message-timestamp/program.ts` 的 `eq()` + 计数行写法） | 6 组：今日 / 昨日 / 同年异地月 / 跨年 / `23:59` 与 `00:00` 边界 / **无效值 6 例**（`NaN`、`Infinity`、`undefined`、`null`、`±1e16`）；阶段五变异补两条：「去年同月同日」（锁年份维度）、「`now` 非法」；固定 `NOW` 用 `at()` 表达（月份口径 1-based 统一）；唯一用 `Date.now()` 的那条**只取时一次** + 跨日窗口跳过 | [x] `24 assertions passed` |
| 3 | `package.json` 加 `test:chat-time` 脚本 | 单独跑通且计数行 > 0（`tests/**` 不在任何 tsconfig 的 include 内，类型靠运行时断言兜）；本模块零 import，故**不用** `--alias:@renderer`（原检查点照抄模板，与实际不符，已订正） | [x] |
| 4 | `chat/UserMessage.tsx:243` 替换 | `toLocaleTimeString([], {...})` → `formatChatTime(createdAt)`；外层 `createdAt &&` 守卫保留 | [x] |
| 5 | `action-bar.tsx` 在组件顶层算 `timeLine`（数组 + `filter(Boolean).join(' · ')`），渲染判据改 `timeLine` 非空 | 空段不渲染 `<p>`（只按 `finishedAt != null` 判，时刻无效且无耗时时会留 6px 空隙）；**订正**：旧码并无「前导 ` · `」缺陷（分隔符写在 `elapsedMs != null &&` 条件内部），旧症状是渲染 `Invalid Date`；所有有效时间戳组合新旧逐字等价 | [x] |
| 6 | `chat/ContextCompressionMessage.tsx` 删本地 `formatStamp`（`:24-32`）改调 `formatChatTime` | 两处调用点 `:120`（压缩于）/ `:121`（你上次发言）同步；**`:83` 的 `const { t, i18n } = …` 改为 `const { t } = …`**（`i18n` 仅这两处用途）；**`:119` 注释「见文件头的 formatStamp 注释」改述**为「见文件头 S-208 注释」 | [x] |
| 7 | 卡片文案拼接断言 | **并入步骤 2**：拼接逻辑是模板串 `summaryCompactedAt` + `time` 参数，键不动、模板不动，唯一变量就是 `formatChatTime` 的返回值，已由步骤 2 直接断言出 `10-22 23:41`。不另起 i18n 初始化去测 `t()` —— 那是测 i18next，不是测本需求 | [x] 合并 |
| 8 | 范围回归：`grep "toLocaleTimeString\|toLocaleString" src/renderer/src/components/chat` | 消息流三处**不再命中**。剩余 6 处全部非时刻或范围外：`ModelSettingsPopover.tsx:341/354/355`（`thinkingBudget.toLocaleString()`，数字千分位）、`QuotaIndicators.tsx:56/129`（配额时刻，已点名）、`locator-utils.ts:271` / `ui-buttons.tsx:127` / `codegraph-project-index.tsx:310`（范围外 / debug） | [x] |
| 9 | 门禁：`npm run typecheck`（node + web） | 双配置 0 错误；**`ContextCompressionMessage.tsx` 不得报 TS6133**（`noUnusedLocals: true` 继承自 `@electron-toolkit/tsconfig`） | [x] |
| 10 | 门禁：`npm test` | 既有 78 全绿 + 新增 ⇒ **79 套件通过**（`run-tests.mjs:28-30` 自动收录 `test:` 前缀） | [x] **79/79** |
| 11 | 真机：今日消息 | 用户消息与助手结束行都只显示 `HH:MM`，无日期 | [ ] 待老大 |
| 12 | 真机：压缩卡片 | 今日压缩只显示 `压缩于 09:55`；**非今日**（可用 `meta.compactedAt` 造昨日数据）显示 `压缩于 10-22 23:41` | [ ] 待老大 |

## 实现要点

### 判「同一自然日」用本地时区字段，不用时间差

```ts
const d = new Date(value)
const n = now == null ? new Date() : new Date(now)   // ← 必须有默认值，见下
const sameDay = d.getFullYear() === n.getFullYear()
  && d.getMonth() === n.getMonth()
  && d.getDate() === n.getDate()
```

**不能用** `now - value < 86400000`：昨晚 23:50 的消息今早 08:00 看，差 8 小时，按 24 小时判会仍显示 `23:50` —— 而用户心智是「昨天」。这是 `S-222.md §5.2` 第 1 条的落地方式。跨月 / 跨年由字段比较天然覆盖，无需额外分支。

### `now` 必须有默认值（否则「今天」全线带日期）

三处调用点**都不传** `now`。若照 `new Date(now)` 字面写，`new Date(undefined)` → `Invalid Date` → `getFullYear()` 为 `NaN` → `sameDay` 恒 `false` ⇒ 今日消息一律输出 `10-23 09:55`，正是本需求要消除的形态。

```ts
const n = now == null ? new Date() : new Date(now)
```

### 无效值护栏：`isFinite` 不够，还要 `isNaN`

`Number.isFinite(1e16)` 为 `true`，但 `new Date(1e16)` 是 `Invalid Date`（Date 上限 ±8.64e15 ms），补零后吐 `NaN-NaN NaN:NaN` —— 与 §8「不出现 `NaN:NaN`」直接冲突。

```ts
if (value == null || !Number.isFinite(value)) return ''
const d = new Date(value)
if (Number.isNaN(d.getTime())) return ''
```

函数体收口（约 20 行）：

```ts
export function formatChatTime(value?: number | null, now?: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const n = now == null ? new Date() : new Date(now)
  if (Number.isNaN(n.getTime())) return ''

  const pad = (x: number): string => String(x).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  if (sameDay) return hm

  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === n.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md} ${hm}`
}
```

### 固定 24 小时制，手写补零

`toLocaleString` 在英文面会输出 `2:41 PM`，一处宽一处窄；且 `month: '2-digit'` 在不同 locale 下分隔符不同（`10/22` vs `10-22`）。输出分隔符固定为 `-` 与空格，与压缩卡片现有的 `10-23 09:55` 视觉一致。

### 夏令时一句话记录

比较的是本地墙钟字段，「午夜切换」的时区（如 `America/Santiago`）会把 00:00–01:00 的消息归到前一天。面向中英双语用户，接受，在 `chat-time.ts` 头注释记一句即可。

## 涉及文件

### 新增

- `src/renderer/src/lib/utils/chat-time.ts` — 纯函数（约 30 行）
- `tests/chat-time/program.ts` — 单测（约 70 行）

### 修改

- `package.json` — 加 `test:chat-time` 脚本一行
- `src/renderer/src/components/chat/UserMessage.tsx` — 一处替换
- `src/renderer/src/components/chat/AssistantMessage/action-bar.tsx` — 一处替换 + 拼接改 `filter(Boolean)`
- `src/renderer/src/components/chat/ContextCompressionMessage.tsx` — 删本地函数、改两处调用、`:83` 解构去掉 `i18n`、`:119` 注释改述

### 不改

- `formatDurationMs`（`lib/format-duration.ts`）—— 时长不是时刻，`· 用时 12s` 一律不动
- `activity/ActivityPanel.tsx`、`workspace-sidebar-items.tsx`、`usage-detail-table.tsx`、`AutomationCalendar.tsx`、`goal-session-views.tsx`、`locator-utils.ts`、`file-search-shared.ts` —— `S-222.md §3.1` 七处范围外
- `chat/ModelSwitcher/QuotaIndicators.tsx:56` / `:129` —— 配额重置 / 过期时刻，恒带日期是有意的，归属「计划时刻 / 配额元信息」一类（同 `AutomationCalendar.tsx:76`），不在本需求口径内
- `tests/message-timestamp/` —— 它测 `updatedAt` 搬运与耗时档位，与本需求不重叠，**不复用不改动**

## 参考源码

无外部参考项目。内部沿用：

- `src/renderer/src/lib/format-duration.ts` — 同样是「零依赖纯格式化模块 + 单测直连」，本模块照此组织
- `tests/message-timestamp/program.ts:23-28` — `eq()` 计数断言写法
- `scripts/run-tests.mjs:28-30` — `test:` 前缀自动收录，无需改汇总脚本

## 规模

新增两文件实测 **138 行**（`chat-time.ts` 35 + `program.ts` 103，比阶段二的 110 行估计乐观）。改后行数：`UserMessage.tsx` 314 / `action-bar.tsx` 243 / `ContextCompressionMessage.tsx` 177 —— 全部远低于 500 行硬线。

## 阶段五审查修复（2026-10-23）

审查结论 ❌0 / ⚠️6 / ✅20，可进阶段六；其中 4 条已在阶段六前收口：

| # | 问题 | 处置 |
|---|---|---|
| ⚠️4 | 删掉 `getFullYear()` 那一项后 22 条断言**全绿** —— 「去年同月同日」无人覆盖 | 补断言 `2025-10-23 09:55`（`testOtherDaySameYear` 末条） |
| ⚠️3 | `program.ts` 用 `Date.now()` 两次取时，跨午夜偶发红，且与步骤 2 自己的检查点矛盾 | 改为只取一次 + 跨日窗口跳过 |
| ⚠️6 | `chat-time.ts:41`（`now` 非法 → `''`）无断言，写错也拦不住 | 补断言 `formatChatTime(valid, NaN) === ''` |
| ⚠️1 | `action-bar` 判据是 `finishedAt != null`，时刻无效且无耗时时渲染空 `<p>`（6px 空隙） | 顶层算 `timeLine`，判据改 `timeLine` 非空 |
| info ② | `NOW` 用 0-based 月、`at()` 用 1-based 月，同文件两种口径 | `NOW` 改用 `at(2026, 10, 23, 8, 0)` |
| info ③ | `chat-time.ts` 局部变量 `n` 与 `pad(n)` 形参同名 | 改名 `nowDate` |
| ⚠️2 | 压缩卡片「昨天」只有函数级覆盖，卡片拼接无自动化 | 接受：卡片层靠真机步骤 12 覆盖，不为此起 i18n 初始化 |
| ⚠️5 | `S-222.md §9` 仍是「待实施」、真机步骤未勾 | 写 §9（含英文面 `09:55 AM → 09:55`、卡片分隔符固定 `10-22` 两处视觉变化） |

**跑完复验**：`test:chat-time` **24 assertions passed**（原 22，+2）；`npm run typecheck` node + web 双 0 错误。

**文档事实订正**：`compliance_report.md §3.3-1` 曾说「旧码会留前导 ` · `」——经审查从 10-21 构建产物里还原改前代码核对，**不成立**：分隔符写在 `elapsedMs != null &&` 条件内部，旧症状是渲染 `Invalid Date`。结论不变（新写法更好），但理由已改，免得后人照错因做「防回归」。

## 相对首版的改动

| # | 首版 | 现在 | 依据 |
|---|---|---|---|
| 1 | `new Date(now)` 无默认值 | `now == null ? new Date() : …` | 合规 §3.2(a) —— 「今天」会全线带日期 |
| 2 | 只用 `isFinite` 拦无效值 | 补 `Number.isNaN(d.getTime())`；无效组 5 例 | 合规 §3.2(b) —— `1e16` 吐 `NaN-NaN` |
| 3 | 测试用 `Date.now()` 现算 | 固定 `NOW` 常量，全例显式传 | 合规 §3.2(d) —— 00:00 前后间歇失败 |
| 4 | action-bar「拼接一行不动」 | 先算 `timeLabel` 再 `filter(Boolean).join` | 合规 §3.3-1 —— 空时刻留前导 ` · ` |
| 5 | §8 第 5/6/8 行无验证步骤 | 新增步骤 7（拼接断言）/ 8（grep 回归）/ 12（非今日卡片） | 合规 §3.3-2 |
| 6 | 范围外未点名 QuotaIndicators | 「不改」清单点名并给归类理由 | 合规 §3.3-3 |
| 7 | 步骤 2 只有类型门禁 | 补 `test:chat-time` 单独跑通 | 合规 §3.3-4 —— `tests/**` 不入 tsconfig |
| 8 | 未提 `:119` 注释 | 随删函数一并改述 | 合规 §3.1 顺带项 |
