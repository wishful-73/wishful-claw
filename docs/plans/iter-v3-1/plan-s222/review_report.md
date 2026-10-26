# S-222 实施审查（阶段五）

> **审查方式**：独立只读审查（subagent），2026-10-23 10:44 起。除本文件外**未修改任何文件**，未执行 git、未跑构建（`esbuild`/`tsc`/`npm test` 均未运行）。
> 允许的动作里做了三件取证：
> ① 读源码 / 配置 / 文档；② 直接 `node tests/chat-time/out/program.cjs`（实现者 10:43 已构建的产物，未重新构建）确认 22 assertions；③ 用 `node -e` 内联跑**变异实现**（不落文件）验证断言是否锁得住行为。
> **旧代码取证**：因禁止 git，改从 2026-10-21 的构建产物 `out/renderer/assets/index-CZfQJvQl.js`（早于本次改动 10-23 10:39）里抽出改前的 JSX/函数原文，用于逐组合推演回归 —— 这是本报告二、三节的依据，比"按 plan 描述想象"更可靠。

**审查对象**：`src/renderer/src/lib/utils/chat-time.ts`（35 行）、`tests/chat-time/program.ts`（103 行）、`package.json:55`、`components/chat/UserMessage.tsx`（314 行，`:8` / `:242-246`）、`components/chat/AssistantMessage/action-bar.tsx`（243 行，`:19` / `:159-171`）、`components/chat/ContextCompressionMessage.tsx`（177 行，`:10` / `:25-26` / `:78` / `:115-127`）
**对照依据**：`requirements/S-222.md` §5.2（六条决策）/§8（八条验收）、`plan-s222/plan.md`（步骤 1-12 + 实现要点）、`plan-s222/compliance_report.md`（§3.2 / §3.3 五条建议）、`docs/dev-workflow.md:328-430`

**结论计数**：❌ 0 / ⚠️ 6 / ✅ 20
> 计数口径：❌/⚠️ 取「四、发现的问题」；✅ 为「一 / 一·bis / 二 / 三」各表中判 ✅ 的条目数（9 + 6 + 3 + 2）。

**判定**：**可进入阶段六**（❌ 为 0；但 ⚠️3 / ⚠️4 建议在阶段六前改完，各 3-5 行；⚠️5 的 §9 实施记录与 ⚠️1 的 action-bar 空段必须在提交前收口）

---

## 一、逐条对账（plan 步骤 1-12）

| # | 期望（plan） | 实际 | 结论 |
|---|---|---|---|
| 1 | `chat-time.ts` 导出 `formatChatTime(value, now?)`；零 import；不用 `toLocaleString`；`now` 有默认值；越界值有护栏 | `chat-time.ts:31` 签名为 `(value?: number \| null, now?: number)`（**比 plan 更宽** —— 必要：`meta?.compactedAt` 是 `number \| undefined`，按 plan 原签名会 TS 报错）；全文 0 个 import（`:1-35` 仅注释 + `pad` + 函数）；`now` 缺省 `:40`；`isFinite` + `isNaN(getTime())` 双护栏 `:32-36`；`now` 也做了 isNaN 护栏 `:41` | ✅ |
| 2 | `tests/chat-time/program.ts` 6 组 22 断言，**全部显式传固定 `NOW`，不用 `Date.now()`** | 6 组齐全、断言数 22（实跑确认）；`NOW` 固定 `:24`；**但第 6 组 `:86-98` 用了 `Date.now()`（两次调用）**，与检查点字面冲突（详见 ⚠️3） | ⚠️ |
| 3 | `package.json` 加 `test:chat-time`，写法与 `test:message-timestamp` 一致（`esbuild --alias:@renderer`），单独跑通且计数 > 0 | `package.json:55` 已加；**无 `--alias:@renderer`**（本需求零 import，功能无影响，但与 plan 文字不符）；单独跑通 + 22 断言（实测） | ✅（info 见 ⑧） |
| 4 | `UserMessage.tsx:243` 替换，外层 `createdAt &&` 守卫保留 | `:8` import；`:244` `formatChatTime(createdAt)`；`:242` 守卫原样 `{!compact && createdAt && (` | ✅ |
| 5 | `action-bar.tsx:159-164` 先算 → `filter(Boolean).join(' · ')`；时刻空时不留前导 ` · `；`totalElapsedMs` 段不受影响 | `:159-171` 已是数组 + `filter(Boolean).join(' · ')`；顺序 time → elapsed → total 与原一致；**但「旧代码有前导 ` · ` 缺陷」这一前提不成立**（见二、1 的旧码取证）；空段全空时仍渲染空 `<p>`（⚠️1） | ✅ |
| 6 | `ContextCompressionMessage.tsx` 删 `formatStamp`、两处调用改 `formatChatTime`、`:83` 解构去掉 `i18n`、`:119` 注释改述 | `formatStamp` 已删（全局 grep 仅剩 `:26` 的历史说明）；`:10` import；`:115-116` 两处调用；`:78` 已是 `const { t } = useTranslation('agent')`（另 `:36` 的 LiveDraft 也是 `{ t }`）；`:114` 注释改为「理由见文件头 S-208 注释」 | ✅ |
| 7 | 卡片文案拼接断言并入步骤 2 | 未新增 `t()` 层断言；`compactedAtLabel` 直接喂 `summaryCompactedAt` 模板（`:119`、`:122-125`），键与模板未动 —— 唯一变量就是函数返回值，已由步骤 2 直接断言。合并理由成立 | ✅ |
| 8 | grep 回归：消息流三处不再命中；剩余 6 处均范围外 | 实跑 grep `components/chat`：命中 `codegraph-project-index.tsx:310`、`ui-buttons.tsx:127`、`locator-utils.ts:271`、`ModelSettingsPopover.tsx:341/354/355`、`QuotaIndicators.tsx:56/129` —— **与 plan 列的清单逐条一致**，三处落点全部消失 | ✅ |
| 9 | `npm run typecheck` 双配置 0 错误，`ContextCompressionMessage.tsx` 不得报 TS6133 | 实现者标 [x]，**我未复跑**。静态复核：`i18n` 已无任何消费者（`:3` import 的 `useTranslation` 仍在用），`noUnusedLocals` 触发条件消失；`formatChatTime` 三个调用点类型匹配（`number \| undefined` / `number \| null`） | ✅（推理，非实跑） |
| 10 | `npm test` 79/79 | 实现者标 [x]。独立验证到分项：`node tests/chat-time/out/program.cjs` → 6 个 PASS + `chat-time: 22 assertions passed`，exit 0；`scripts/run-tests.mjs` 的 `test:` 前缀自动收录规则未变，`test:chat-time` 会被收进 | ✅（分项实测，整包未复跑） |
| 11 | 真机：今日消息只显示 `HH:MM` | **未做**，`plan.md:24` 保持 `[ ] 待老大` | ⚠️（流程性，非实施缺陷） |
| 12 | 真机：压缩卡片今日 / 非今日两种 | **未做**，`plan.md:25` 保持 `[ ] 待老大` | ⚠️（流程性） |

### 一·bis、需求 §8 验收逐行对账

| §8 行 | 期望 | 实际 | 结论 |
|---|---|---|---|
| 今天发的消息 | 两处都只 `09:55` | 两处同一函数；`testSameDay`（`:32-36`）锁住 `09:55 / 07:05 / 00:00 / 23:59 / 13:00` | ✅（真机待 11） |
| 昨天的消息 | `10-22 23:41` | `testOtherDaySameYear:42` 断言；变异验证会红（见三） | ✅ |
| 去年的消息 | `2025-12-31 23:41` | `testCrossYear:49` | ✅ |
| 压缩卡片（今天） | `压缩于 09:55`，不带日期 | 走同一函数（`:115`），今日返回 `HH:MM`；**卡片层无自动化断言** | ✅（函数级，卡片级见 ⚠️2） |
| 压缩卡片（昨天） | `压缩于 10-22 23:41` | 同上，函数级成立；卡片级仍只有真机步骤 12 | ⚠️（卡片拼接无断言 + 真机未做） |
| 结束行 `10-22 23:41 · 用时 12s` | 日期+耗时，时长不变 | 结构为 `time · elapsed · total`（`:161-169`），时长函数未动；**注意：旧码与现码都**没有「用时」二字（文案实际是 `12s` / `共 1m30s`，`locales/*/chat.json:1313`＋`format-duration.ts:8`），需求 §8 的「用时」是措辞松散，非缺陷 | ✅（代码级） |
| 无效时间戳 | 该行不渲染，不吐 `NaN-NaN` | 函数返回 `''`，不会吐 `NaN`；但 action-bar 在「时刻无效 + 无耗时」时会渲染空 `<p>`（⚠️1），「时刻无效 + 有耗时」时渲染只剩 `12s` 的一行（与「该行不渲染」字面不符，plan 步骤 5 已明确接受） | ⚠️ |
| 范围外 7 处不变 | 显示不变 | grep 逐一确认仍在：`ActivityPanel.tsx:88`（带秒）、`AutomationCalendar.tsx:76`、`goal-session-views.tsx:103`、`locator-utils.ts:271`、`QuotaIndicators.tsx:56/129`、`ui-buttons.tsx:127`、`codegraph-project-index.tsx:310`、`file-search-shared.ts`（本次未触碰） | ✅ |

---

## 二、回归风险推演

### 2.1 `action-bar` 拼接等价性（**旧码取证**：`out/renderer/assets/index-CZfQJvQl.js` @6853300）

改前源码（从 2026-10-21 构建产物还原，逐字）：

```tsx
!isStreaming && finishedAt != null && <p className="mt-1.5 …">
  {new Date(finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
  {elapsedMs != null && ` · ${formatDurationMs(elapsedMs)}`}
  {totalElapsedMs != null && ` · ${t('messageActions.elapsedTotal', { duration: formatDurationMs(totalElapsedMs) })}`}
</p>
```

**重要更正**：`compliance_report.md §3.3-1` 与 plan 步骤 5 的前提（「时刻为空时输出以 ` · ` 开头」）**不成立** —— 旧码的分隔符写在 `elapsedMs != null &&` 的条件内部，时刻无效时那一段本身为 `Invalid Date`，不会产生前导分隔符。旧码的真正症状是**渲染 `Invalid Date` 文本**。新码把这个症状消掉了（好事），但 plan/合规报告里那条理由属误判，应在阶段六记录里订正，避免后人照着错因去"防回归"。

逐组合推演（旧 → 新，`·` 表示 `' · '`）：

| `finishedAt` | `elapsedMs` | `totalElapsedMs` | 旧输出 | 新输出 | 等价 |
|---|---|---|---|---|---|
| 有效（今日） | null | null | `09:55` | `09:55` | ✅ |
| 有效 | 12s | null | `09:55 · 12s` | `09:55 · 12s` | ✅ |
| 有效 | null | 共 1m30s | `09:55 · 共 1m30s` | `09:55 · 共 1m30s` | ✅ |
| 有效 | 12s | 共 1m30s | `09:55 · 12s · 共 1m30s` | 同 | ✅ 顺序一致 |
| 有效（非今日） | 12s | 共 1m30s | `10-22 23:41 · 12s · 共 1m30s` | 同 | ✅ |
| 无效 | 12s | null | `Invalid Date · 12s` | `12s` | ✅ 有意的修复 |
| 无效 | null | null | `Invalid Date` | `''`（空 `<p>`） | ⚠️ 见下 |
| 无效 | null | 共 1m30s | `Invalid Date · 共 1m30s` | `共 1m30s` | ✅ |

结论：**所有有效时间戳的组合逐字等价**（顺序、分隔符、空值丢弃均一致）；差异只落在"时间戳无效"这一病态分支上，且方向正确。唯一遗留是最后一行之前的「无效 + 两段耗时都缺」→ 渲染 `''` 但仍输出带 `mt-1.5`（6px）的空 `<p>`。可达性很低（要求 `createdAt/updatedAt/runEnd.at` 是 `null` 之外的**非有限值**），但一行就能收口（见 ⚠️1）。

### 2.2 `UserMessage` 的 `createdAt === 0` / 假值行为

- 守卫 `:242` `{!compact && createdAt && (` **逐字未变**（旧码同位置 `!compact && createdAt && jsx(...)`，见构建产物 @6819561）。
- `0` → 假值 → 两版都**不渲染**；`NaN` / `undefined` → 同理不渲染。**行为一致** ✅。
- 唯一语义变化：`createdAt` 为**真值但非有限**（如 `Infinity`，实际不会出现）时，旧码渲染 `Invalid Date`，新码渲染空 `<p>`。同上，属病态分支。
- 另一处**有意**的视觉变化：旧码 `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })` 未设 `hour12`，英文面会出 `09:55 AM`（同仓 `locator-utils.ts:271` 是同一写法）；新码固定 `09:55`。这正是 §5.2 决策 3 要的，但**属用户可感知的变化，应写进 §9 实施记录**。

### 2.3 `formatStamp` 残留引用（全局 grep）

`grep -r formatStamp` 在 `src/` 下命中 **0 处**（唯一残留是 `ContextCompressionMessage.tsx:26` 的历史说明「原来的本地 `formatStamp` … 已删」，明确标注已删，不构成悬空符号）。其余命中全在 `docs/`（需求 / plan / 合规报告 / 探索记录）—— 历史文档不改名，正确。**无编译期 / 运行期残留** ✅。

---

## 三、测试有效性验证（变异实测）

用 `node -e` 把实现替换成被禁止的写法，跑 `program.ts` 里的全部时间用例（14 条等价断言），看红不红：

**变异 A —— `sameDay` 改成 `now - value < 86400000`（滚动 24 小时）**：**红 3 条** ——
`yesterday 23:41`（8h19m 差，会吐 `23:41`）、`midnight A`（10-22 23:50，8h10m，吐 `23:50`）、`midnight B`（10-22 23:59 vs 00:10，11 分钟，吐 `23:59`）。
⇒ **§5.2 第 1 条「自然日」被真正锁住了**，不是纸面覆盖。

**变异 B —— `sameDay` 去掉 `getFullYear()` 一项（只比月+日）**：**红 0 条，22 断言全绿**。
⇒ 存在一个真实漏洞：**「去年同月同日」无人覆盖**。此时 `2025-10-23 09:55` 在今天看会被写成 `09:55`（看起来像今天的消息）。函数实现是对的，但**测试锁不住**这一维 —— 建议补一例（⚠️4）。

**变异 C —— 去掉 `Number.isNaN(d.getTime())` 那道护栏**：`testInvalidValues:80-81` 的 `1e16` / `-1e16` 必然红（会吐 `NaN-NaN NaN:NaN`）⇒ 越界护栏**已锁住** ✅。

---

## 四、发现的问题

### ⚠️1 `action-bar.tsx:159-171` —— 时刻无效且无耗时时渲染空 `<p>`（会留 6px 空隙）

`{!isStreaming && finishedAt != null && (<p className="mt-1.5 …">…</p>)}` 的外层守卫只看 `finishedAt` 是否非 null，不看拼出来的字符串是否为空。`finishedAt = NaN` 且两段耗时都为 null 时，`[] .filter(Boolean).join()` 得 `''`，仍渲染一个只有 `margin-top` 的段落，与 §8「该行不渲染」不符。
**修法（3 行，顺带把 §8 第 7 行的两种子情形一起收口）**：

```tsx
const timeLine = [
  formatChatTime(finishedAt),
  elapsedMs != null ? formatDurationMs(elapsedMs) : '',
  totalElapsedMs != null ? t('messageActions.elapsedTotal', { duration: formatDurationMs(totalElapsedMs) }) : ''
].filter(Boolean).join(' · ')
…
{!isStreaming && timeLine && (
  <p className="mt-1.5 text-[10px] text-muted-foreground/50 tabular-nums">{timeLine}</p>
)}
```

（计算放组件顶层，避免 JSX 里再套一层；副作用为零，且比现在的 `finishedAt != null` 判据更贴合"有东西可显示才渲染"。）

### ⚠️2 §8「压缩卡片（昨天）」只有函数级覆盖，卡片字符串与真机都无人验

`ContextCompressionMessage.tsx:115-127` 的拼接（`summaryCompactedAt` + `time`）没有自动化断言，`plan.md:25` 的真机步骤仍是 `[ ]`。函数级成立（`10-22 23:41` 已由步骤 2 断言），但「卡片真的把该串塞进模板」这一步只靠人眼。
**修法**：二选一 —— (a) 阶段六把真机步骤 12 走掉并在 `S-222.md §9` 贴结果；(b) 若不打算为一张卡片引 i18n 初始化，至少在 `§9` 写明「卡片层靠真机覆盖，无自动化」作为显式取舍（现在 plan 步骤 7 只说了"不另起 i18n 去测"，没写"因此卡片层是人工验"）。

### ⚠️3 `tests/chat-time/program.ts:86-98` —— 用 `Date.now()` 两次调用，存在跨午夜偶发红；且与 plan 步骤 2 检查点直接冲突

`:87` 取 `now = Date.now()`，`:88-90` 按它算期望，`:91` / `:94` 各调一次 `formatChatTime(now)` —— 函数内部再取一次 `new Date()`。若这两次取时跨过 00:00，`sameDay` 变假，返回 `10-24 00:00` 而期望 `23:59`，**测试间歇性变红**。这正是 `compliance_report.md §3.2(d)` 与 plan 步骤 2 要求"全部显式传固定 `NOW`、不用 `Date.now()`"要避免的情形，而该步却标了 `[x]`。
**修法（保留默认分支的覆盖，但去掉抖动）**：

```ts
function testNowDefaultsToCurrentTime(): void {
  const before = Date.now()
  const label = formatChatTime(before)          // 只调一次，避免两次取时不一致
  const after = Date.now()
  // 跨午夜 / 跨日的极小概率窗口：本轮跳过（不让 CI 偶发红）
  if (new Date(before).getDate() !== new Date(after).getDate()) return
  const d = new Date(before)
  const expected = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  eq(label, expected, '不传 now 时按当前时间判，今天只给时分')
}
```

（`assert.ok(!includes('-'))` 与上一条断言同源，可删；`checks++` 的手工补偿也随之消失。）

### ⚠️4 测试未锁住 `sameDay` 的年份维度（变异 B 0 红）

`chat-time.ts:44-47` 的年/月/日三项里，**年份项删掉后 22 条断言全绿**（第三节实测）。后果是"去年同月同日"被显示成今天的时刻。
**修法（1 行断言，加进 `testOtherDaySameYear` 或 `testCrossYear`）**：

```ts
eq(formatChatTime(at(2025, 10, 23, 9, 55), NOW), '2025-10-23 09:55', '去年同月同日不能漏年份')
```

### ⚠️5 `S-222.md §9 实施记录` 仍是「（待实施）」，plan 步骤 11/12 未勾

`requirements/S-222.md:110-112` 未更新（同迭代 `S-220.md:167-171` 的写法是先例：日期 + 改动表）。另外**两处用户可感知的变化没有记录**：英文面 `09:55 AM → 09:55`（决策 3 的后果）、压缩卡片英文面原本分隔符随 locale 变（`10/22`）现已固定 `10-22`。
**修法**：阶段六补 §9（改动表 + 上述两条视觉变化 + `22 assertions` / `79/79` 结果），并把 plan 步骤 11/12 的真机结论回填。

### ⚠️6 `chat-time.ts:41`（`now` 非法 → 返回 `''`）无任何断言

该分支是"时间戳有效、参照时刻坏掉"时的静默不渲染。写错（例如误返回 `hm` 或抛错）现有 22 条断言**一条都不会红**。
**修法（1 行）**：`eq(formatChatTime(at(2026, 10, 23, 9, 55), Number.NaN), '', 'now 非法时静默不渲染')`；若认为该分支不该存在，也可直接删掉 `:41`，那就无需测试 —— 但二者要选一个。

### info ① `package.json:55` 缺 `--alias:@renderer`

plan 步骤 3 写"写法与 `test:message-timestamp` 一致（`esbuild --alias:@renderer`）"，实际脚本没有该参数。本需求 `chat-time.ts` 零 import、测试用相对路径，**功能无影响**。建议要么补上保持模板一致（复制粘贴起新测试时不会踩坑），要么把 plan 那半句去掉，别留一个与实际不符的"已满足"。

### info ② `tests/chat-time/program.ts:24` 的 `NOW` 用 0-based 月（`9`），`:26-27` 的 `at()` 用 1-based 月（`10`）

同一文件两种月份口径，后续加用例极易写错（`9` 当九月 → 实际十月）。建议 `const NOW = at(2026, 10, 23, 8, 0)`（把 `at` 提到前面即可），口径统一为一处。

### info ③ `chat-time.ts:40` 局部变量 `n` 与 `:18` 的 `pad(n)` 形参同名

不冲突（不同作用域），但一个读起来是"数字"、一个是"Date"，改名 `nowDate` 可省一次误读。

### info ④ `ContextCompressionMessage.tsx:26` 仍出现 `formatStamp` 字样

是历史说明（"原来的本地 `formatStamp` … 已删"），语义正确。若担心后续 grep 误判为悬空引用，可改成「原本地时刻格式化函数」。

### info ⑤ plan §规模估计（新增两文件 < 110 行）偏乐观：实际 35 + 103 = **138 行**

`program.ts` 用了 103 行（含分组注释与 6 个函数），比估计的 70 行多。无害，只是记录偏差，免得下次照 110 行做预算。

---

## 五、测试与实现的正面确认（避免只见问题）

1. **`chat-time.ts` 头注释质量达标**：`why 不用 toLocaleString`（`:8-9`：AM/PM 与 locale 分隔符）、`why 不用时间差`（`:13-14`：23:50 vs 08:00 的心智）、DST 边角（`:15-16`）、`now` 缺省的理由（`:38-39`）、越界值（`:34-35`）**五条 WHY 全部写清**；无指向不存在符号的引用。
2. **调用方零改动风险**：三个调用点都不传 `now`，缺省分支 `:40` 正确；`formatChatTime` 签名放宽到 `number | null | undefined` 恰好接住 `meta?.compactedAt` 的 `number | undefined`，避免了类型报错（比 plan 的签名更对）。
3. **500 行硬线**：`chat-time.ts` 35、`program.ts` 103、`UserMessage.tsx` 314、`action-bar.tsx` 243、`ContextCompressionMessage.tsx` 177 —— 全部远低于 500，且无一个在 400+ 区间。
4. **无效值护栏三道**（`:32` / `:36` / `:41`）与测试的 6 例（含 `±1e16` 两个越界有限值）**确实挡住 `NaN-NaN`**（变异 C 实测会红）。
5. **自然日判据被真正锁住**（变异 A 红 3 条），不是"写了断言但断言测不出区别"。
6. **范围控制干净**：只动 3 个组件 + 1 个脚本 + 2 个新文件；§3.1 的 7 处与 `QuotaIndicators` 两处逐条在场、未被顺手改。

## 六、总体评述

实现的**主体是对的**：单点纯函数、自然日判据、固定 24 小时制、三道无效值护栏、零 import、三个调用点替换干净，`formatStamp` 无残留，`i18n` 解构同步清理，grep 边界与 plan 清单逐条吻合 —— 这些我都实测或逐字核过。两处比 plan 还准的地方：签名放宽到 `number | null | undefined`（否则 `meta?.compactedAt` 会 TS 报错）、`now` 非法也拦了一道。

真正的欠缺集中在**验证层而非实现层**：`program.ts` 里那条用 `Date.now()` 的用例把"固定参照时刻"的原则破了（plan 自己要求过），并且"去年同月同日"这一维完全没有断言兜住（变异实测 0 红）；action-bar 的渲染判据仍停在"时间戳非 null"而非"拼出来非空"，留了一个空段落的小尾巴。这些都是 1-5 行能改完的事，**不构成阻断**。

另需订正一条文档事实：`compliance_report.md §3.3-1` 与 plan 步骤 5 认为"旧代码会留前导 ` · `"——**旧代码不是那样**（分隔符在条件内），旧症状是渲染 `Invalid Date`。结论没错（新写法更好），但理由要改，否则下次会照着错因做回归。

**判定：可进入阶段六**，建议顺序为 ⚠️3 / ⚠️4 / ⚠️6（测试，一起改完重跑 `npm run test:chat-time`）→ ⚠️1（action-bar 3 行）→ ⚠️5（§9 + plan 勾选）→ 真机 11/12。
