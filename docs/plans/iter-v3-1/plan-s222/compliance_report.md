# S-222 规划合规检查（阶段三）

> **审查方式**：独立只读审查（2026-10-23 10:27 起）。除本文件外未修改任何文件；未执行 git 命令；未跑构建 / 测试（结论均来自读码与配置继承链核对，个别 JS 语义点用 `node -e` 单行求值实证，未触碰仓库）。
> **文件指纹**：审查结束时 `plan.md` = 82 行 / 4876 字节 / LF 换行，MD5 `A0A9DD5E486EEE2E09CA5010B0F58E4D`。

**检查对象**：`plan-s222/plan.md`（步骤 10 条 + 实现要点 3 节 + 涉及文件 / 参考源码 / 规模）
**检查依据**：`docs/dev-workflow.md:328-416`（六阶段，重点 `:397-416` 阶段三五项与 `:414` 阻断规则）、`AGENTS.md`（分层 `:30-112`、命名 `:137-141`、大文件拆分 `:172-183`、编译验证 `:210-217`）、`requirements/S-222.md`（§3 现状表 `:16-24`、§3.1 范围外 `:26-38`、§5.2 六条决策 `:73-82`、§8 验收 `:97-108`）、`plan-s219/compliance_report.md`（格式参照）

**结论计数**：❌ 0 / ⚠️ 5 / ✅ 10

**阻断判定**：**不阻断** —— ❌ 为 0，按 `dev-workflow.md:414`（「❌ 项 > 0 时禁止进入用户确认环节」）可进入用户确认。但 ⚠️5 / ⚠️12 两条建议在确认前收口（各 3 行内可改完，见「三、缺口说明」）。

> **审查期修订记录（必读）**：首版 `plan.md` 步骤 6 的检查点只写「`language` 参数若因此变成未使用，一并清掉」——**不足以覆盖 `:83` 的 `i18n` 解构**（该解构不是 `formatStamp` 的参数，删函数不会连带删它）。审查过程中该行被改成了显式要求 `:83` 改为 `const { t } = …`，并新增 `:64` 的对应描述。**本报告以现版（含 `:83` 修正）为准判 ✅**；若执行时取到的是首版，检查项 ⑪ 直接降为 ❌。

---

## 一、阶段三五项检查

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 步骤是否完整覆盖需求目标（含 §8 验收 8 条） | ✅ | 三个落点各有一步、纯函数与单测各有一步：`plan.md:16`（UserMessage）`plan.md:17`（action-bar）`plan.md:18`（压缩卡片）`plan.md:13-15`（函数 / 单测 / 脚本）。§8 八条逐条对得上：今天→`plan.md:21`；昨天 / 去年→`plan.md:14` 单测组；压缩卡片今天→`plan.md:22`；结束行带日期+耗时→`plan.md:17`（拼接不动）；无效值→`plan.md:14`+`:50`；范围外→`plan.md:69`。**无需求目标落空**；验证颗粒度的欠缺单列在 ⑭ |
| 2 | 每步是否有明确验证检查点 | ⚠️ | 10 步全部带检查点（`plan.md:13-22`），无空检查点。四处偏松：①`plan.md:14` 未要求**显式传 `now`**，「今日」用例用 `Date.now()` 构造会在跨 00:00 时抖动；②`plan.md:22` 只验「今日压缩」，§8 第 5 行（昨天压缩 `压缩于 10-22 23:41`）无步骤；③`plan.md:17` 只写「拼接一行不动」，未验**时刻为空时不留前导 ` · `**（见 ⑬）；④`plan.md:69` 的七处「不改」无任何回归验证步骤 |
| 3 | 文件路径是否符合项目结构 | ✅ | `src/renderer/src/lib/utils/chat-time.ts`：目录已存在（`lib/utils/export-chat.ts`、`image-clipboard.ts`、`image-format.ts`、`mermaid-theme.ts`），且 `lib/utils/image-format.ts:15` 已有「Pure and Electron-free so `tests/image-format` can run it in plain node」的纯模块先例；文件名 kebab-case 合 `AGENTS.md:138`。`tests/chat-time/program.ts` 合 `dev-workflow.md:324`（TS 测试 = `tests/<名字>/program.ts` + `package.json` 加 `test:<名字>`）。`tests/chat-time` 当前不存在，无覆盖风险 |
| 4 | 分层依赖是否正确（渲染端纯模块不得反向依赖 store / ipc） | ✅ | `plan.md:13` 把「零 import、不读 `window`、不依赖 i18n」写成检查点，方向正确。对照：同目录 `image-clipboard.ts:1` 引 `@renderer/lib/ipc/channels`（该链会摸 `window`）、`mermaid-theme.ts:1` 引 react —— 所以「不依赖 i18n/window」这条不是废话，是必须写死的约束。`format-duration.ts` 全文零 import（`:1-6` 只有版权注释），可直接被 node 侧静态 import（`tests/message-timestamp/program.ts:19`） |
| 5 | 是否参考了正确源码 | ✅ | 三条内部引用**逐条核到行**：`lib/format-duration.ts` 存在（61 行，零依赖纯格式化，确为正确的组织范式）；`tests/message-timestamp/program.ts:23-28` 正是 `let checks = 0` + `function eq(...){ checks++; assert.strictEqual(...) }`；`scripts/run-tests.mjs:28-30` 正是 `k.startsWith('test:') && k !== 'test:clean'` 的自动收录。本需求无外部参考项目，`plan.md:74` 的判断成立 |

---

## 二、补充检查（AGENTS.md）

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| 6 | 是否新增依赖 | ✅ | 不新增：`plan.md:13` 要求零 import，`plan.md:15` 复用已在用的 `esbuild`，`plan.md:76` 只在项目内沿用 `format-duration.ts` 的组织方式。`package.json:99+` 的 dependencies 无需动 |
| 7 | 是否有硬编码 | ✅ | 硬编码的是**格式**不是文案：`plan.md:43` 的补零、`:46` 的 `-` 与空格分隔符、`:40` 的固定 24 小时制。三项均有 `S-222.md §5.2` 第 3 条与 §6 的显式理由，且不产出可翻译文本。`AGENTS.md` 只在 `:150`（提示词语言）与 `:182`（locales JSON 豁免）约束 i18n，无「时刻格式必须走 locale」的规定，故不算违规 |
| 8 | 是否触碰 >500 行文件 | ✅ | 三个改动文件均远低：`UserMessage.tsx` 313 行、`action-bar.tsx` 237 行、`ContextCompressionMessage.tsx` 182 行（`AGENTS.md:175` 硬线 500）；`plan.md:82` 的「不触碰 500 行线附近文件」属实。`MessageList/utils.ts` 661 行**在改动面之外**，`plan.md:69` 也未列它 |
| 9 | 是否遗漏既有测试的回归影响（`npm test` 计数） | ✅ | `plan.md:20` 写「78 全绿 + 1 = 79」，**数字核实无误**：`package.json` 去掉 `test:clean` 后共 **60** 个 `test:` 脚本，`tests/` 下匹配 `^WishfulClaw\..+RegressionTests$` 的目录 **18** 个，60+18 = 78。另核了最可能被波及的两个套件：`tests/compaction-snapshot-display/program.ts:37` 的 `'10-20 08:21'` 是**摘要正文（发给模型的拼接文本）**里的字面量，不是卡片渲染；`tests/` 全目录 grep `formatStamp` / `toLocaleTimeString` / `toLocaleString` 均无命中 ⇒ 删除 `formatStamp` 不打破任何既有断言 |
| 10 | plan 引用的行号与函数名是否与真实代码一致 | ✅ | 逐条对齐：`formatStamp` 定义 `ContextCompressionMessage.tsx:24`（`:32` 收尾）✅；两处调用 `:120` / `:121`，实参均为 `i18n.language` ✅；`:83` 确为 `const { t, i18n } = useTranslation('agent')` ✅；`UserMessage.tsx:243` 是 `toLocaleTimeString([], {...})`，`:241` 是 `{!compact && createdAt && (` 守卫 ✅，`:26` `createdAt?: number` 与 `plan.md:50`「可选字段」的表述一致 ✅；`action-bar.tsx:160` 是时刻那一段 ✅，`:71` `const finishedAt = endAt ?? createdAt` 与 `plan.md:17` 的「只换时刻」一致 ✅；`run-tests.mjs:28-30` ✅；`tests/message-timestamp/program.ts:23-28` ✅ |
| 11 | **重点验证 ①**：删 `formatStamp` 后 `i18n` 的处置 / `noUnusedLocals` 是否开启 | ✅ | **①`i18n` 无其他用途**：全文件 `i18n` 仅出现 4 处 —— `:3` import、`:83` 解构、`:120`、`:121`（`:24` 是 `formatStamp` 的 `language` **形参**，`:119` 是注释里提到 `formatStamp`）。②**`noUnusedLocals` 确实开着**：`tsconfig.web.json:2` extends `@electron-toolkit/tsconfig/tsconfig.web.json` → 其 `:3` extends `./tsconfig.json` → `tsconfig.json:15-16` = `"noUnusedLocals": true, "noUnusedParameters": true`；`tsconfig.web.json:9-22` **未覆盖**这两项（只设 composite / noImplicitAny / jsx / baseUrl / paths），`package.json:20` 的 `--composite false` 也不影响它们 ⇒ 只清调用点参数、不改 `:83`，**必定报 TS6133 未使用变量**。③现版 `plan.md:18` 已明确要求 `:83` 改为 `const { t } = …`，并由 `:64` 复核 ⇒ 该风险已收口 |
| 12 | **重点验证 ②**：本地时区字段判「同一自然日」能否覆盖 §5.2 第 1 条 | ⚠️ | **核心判据成立**：`plan.md:31-33` 三元比较（年/月/日）可正确区分「昨晚 23:50 vs 今早 08:00」→ 日期字段不同 → 带日期，正是 §5.2 第 1 条要的心智；**跨月、跨年不是漏洞**（`getMonth` / `getFullYear` 各自参与比较）。但有两个实现陷阱 plan 没拦住：见「三、3.2」的 (a)(b)(c) |
| 13 | 无效时间戳在 action-bar 的落地（§8 第 7 条） | ⚠️ | `action-bar.tsx:158` 的守卫是 `finishedAt != null`，`:159-164` 是「时刻 + ` · 用时`」同段拼接。`formatChatTime` 返回 `''` 时**该行仍会渲染**，输出以 ` · 12s` 开头（前导分隔符），与 §8「该行不渲染，不出现 `NaN:NaN`」不完全一致。另两处是安全的：`UserMessage.tsx:241` 的 `createdAt &&` 对 `NaN` 取假值天然不渲染；`ContextCompressionMessage.tsx:122-132` 用 `.filter(Boolean)` 过滤空串 |
| 14 | §8 剩余三行是否有验证步骤 | ⚠️ | ①**压缩卡片「昨天」**（`S-222.md:105`）：无步骤 —— `plan.md:14` 只测函数、`plan.md:22` 只验今日，`t('contextCompression.summaryCompactedAt', { time })` 的**拼接结果**无人验；②**结束行 `10-22 23:41 · 用时 12s`**（`S-222.md:106`）：`plan.md:17` 只到「拼接一行不动」的代码级，无非今日 `finishedAt` 的样例；③**范围外 7 处显示不变**（`S-222.md:108`）：`plan.md:69` 只有「不改」清单，无回归动作（一条 `grep toLocaleTimeString src/renderer/src/components/chat` 即可闭环） |
| 15 | 范围边界：聊天窗内是否还有第 4、5 处时刻未被收口 | ⚠️ | `components/chat/ModelSwitcher/QuotaIndicators.tsx:56`（`formatResetAt`，恒 `MM-DD HH:MM`）与 `:129`（`tokenExpiresAt`，同样恒带日期）就在聊天窗模型切换器的 tooltip 里，形态与压缩卡片原状完全一致；`components/chat/AssistantMessage/ui-buttons.tsx:127`（`toLocaleTimeString()`，debug 信息）、`components/chat/codegraph-project-index.tsx:310` 同类。需求 `S-222.md:9` 的口径是「聊天窗里出现的**每一个**时刻」，但 §3 现状表（`:16-24`）只列 3 处、§3.1（`:26-38`）也没排这 4 处 ⇒ **plan 本身没错，是继承了需求的范围缺口**，但执行时会被拿来对照，需要一句显式排除（建议归入「计划时刻 / 配额元信息」类，与 `AutomationCalendar` 同理由） |

---

## 三、缺口说明

### 3.1 重点验证项 ①（`i18n` / `noUnusedLocals`）—— 结论：现版已收口 ✅

链条完整：

1. `ContextCompressionMessage.tsx:83` 解构了 `i18n`，`:120` / `:121` 是**唯一**两个消费者（`:24` 的 `language` 是 `formatStamp` 的形参，与解构无关）。
2. 删 `formatStamp` + 两处改调 `formatChatTime(meta?.compactedAt)` ⇒ 解构出的 `i18n` 变成未使用局部变量。
3. `noUnusedLocals: true` 来自 `@electron-toolkit/tsconfig/tsconfig.json:15`（经 `tsconfig.web.json:2` → 包内 `tsconfig.web.json:3` 继承），项目侧 **无覆盖** ⇒ `npm run typecheck` 会报 TS6133。

所以首版「只清 `language` 参数」的写法是**真的会红**——因为 `language` 是随函数一起消失的形参，真正会残留的是 `:83` 的解构。现版 `plan.md:18` 已把它写成显式动作，**这一条现无缺口**。

顺带一条同类隐患（未计入计数，执行时顺手处理）：`ContextCompressionMessage.tsx:119` 的注释「理由见文件头的 formatStamp 注释」在删函数后会变成指向不存在的符号，建议同步改述为「见文件头 S-208 注释」。

### 3.2 重点验证项 ②（自然日判据）—— 结论：核心覆盖 ⚠️，需补两道护栏

**能覆盖的**：用本地时区字段做三元比较（`plan.md:31-33`）判定「同一自然日」，与「滚动 24 小时」相比正是 §5.2 第 1 条要求的语义；跨月、跨年也由字段比较天然覆盖，无需额外分支。

**可能漏洞**（按危害排序）：

- **(a) `now` 没有默认值 —— 照 `plan.md:30` 字面实现会让「今天」全部带日期。**
  `formatChatTime(value, now?)` 里 `const n = new Date(now)`，三处调用点（`plan.md:16-18`）**都不传** `now`。实测：`new Date(undefined)` → `Invalid Date`，`getFullYear()` → `NaN`，于是 `sameDay` 恒 `false`，今日消息一律输出 `10-23 09:55`。必须写成：

  ```ts
  const n = now == null ? new Date() : new Date(now)
  ```

  （`plan.md:21` 的真机步骤能当场撞出这个问题，所以不判 ❌；但改法要写进 plan，否则执行时极易照抄。）

- **(b) 有限但越界的时间戳会吐出 `NaN-NaN NaN:NaN`。**
  `Number.isFinite(1e16)` 为 `true`，但 `new Date(1e16)` 是 `Invalid Date`（Date 上限 ±8.64e15 ms），`pad(NaN)` 得到 `"NaN"`。`plan.md:50` 只用「`Number.isFinite` 为假 → 返回 `''`」，拦不住这种情况，与 §8 第 7 条「不出现 `NaN:NaN`」直接冲突。补一道：

  ```ts
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  ```

  并把步骤 2（`plan.md:14`）的「无效值」组扩成 **NaN / Infinity / undefined / null / 1e16（越界有限值）** 五例。

- **(c) 夏令时**：比较的是本地墙钟字段，美国（02:00 切换）、中国（无 DST）都不受影响；只有「午夜切换」的时区（如 `America/Santiago`）会把 00:00–01:00 的消息归到前一天。项目面向中英双语用户，可接受，**建议在 `chat-time.ts` 头注释记一句**，不算缺陷。

- **(d) `now` 注入已具备，但测试未要求使用它。** `plan.md:14` 的「今日」组若用 `Date.now()` 现算期望值，在 00:00 前后跑会间歇失败；应固定 `const NOW = new Date(2026, 9, 23, 8, 0).getTime()` 之类的常量，全部用例显式传 `now`。这既让测试可控，也顺带把 (a) 的默认分支与显式分支都覆盖到。

### 3.3 其余缺口（不阻断，建议随本需求收口）

1. **action-bar 空时刻的前导分隔符**（检查项 ⑬）。建议把 `action-bar.tsx:159-164` 改成先算 `timeLabel` 再拼：

   ```tsx
   const timeLabel = formatChatTime(finishedAt)
   ...
   {[timeLabel, elapsedMs != null ? formatDurationMs(elapsedMs) : '', totalElapsedMs != null ? t('messageActions.elapsedTotal', { ... }) : ''].filter(Boolean).join(' · ')}
   ```

   这样时刻为空时输出只剩 `12s`，既守住 §8 第 7 条，也不丢耗时。检查点补一句「手工把 `finishedAt` 置 `NaN`，结束行只剩耗时、无前导 `·`」。

2. **§8 第 5 / 6 / 8 行无验证步骤**（检查项 ⑭）。最低成本补法：步骤 2 里加一条「卡片文案拼接」的纯字符串断言（`t('contextCompression.summaryCompactedAt', { time: formatChatTime(昨日, NOW) })` 的入参就够，无需渲染 `.tsx`）；步骤 6 的检查点补「非今日样例输出 `10-22 23:41`」；再加一步 `grep toLocaleTimeString src/renderer/src/components/chat` 期望只剩 `locator-utils.ts:271`（§3.1 明确范围外）与 `ui-buttons.tsx:127`（debug）——这一步同时把检查项 ⑮ 的范围口径钉死。

3. **范围口径需一句显式排除**（检查项 ⑮）。`QuotaIndicators.tsx:56` / `:129` 恒带日期，且就在聊天窗内；建议在 `plan.md:69` 的「不改」清单里点名，理由写「配额重置/过期时刻，同 `AutomationCalendar.tsx:76`（计划时刻）一类」，避免阶段五审查再当新问题提。

4. **新建的 `tests/chat-time/program.ts` 不受 `npm run typecheck` 覆盖**（流程事实，非 plan 过失）：`tsconfig.web.json:3-8` 只 include `src/renderer/src/**`、`tsconfig.node.json:3` 只 include `src/main|preload|shared`，`tests/**` 两个配置都不含，而 esbuild 不做类型检查 ⇒ 步骤 7 的「双配置 0 错误」保证不了这个新测试文件自身的类型正确性，只能靠运行时断言兜。建议在步骤 2 的检查点补「`npm run test:chat-time` 单独跑通且计数行 > 0」。

5. **命名一致性（仅建议）**：项目里同类纯格式化模块叫 `lib/format-duration.ts` / `lib/format-tokens.ts`，`lib/utils/` 里也有 `image-format.ts`。`chat-time.ts` 的名字跟了两处都不完全一致，但它是 `S-222.md §5.2` 第 6 条**已拍板的落点**，改路径反而要回头改需求 —— **维持现状**，仅记录取舍。

6. **流程提醒**：`dev-workflow.md:412` 要求本阶段完成后更新 `docs/PROGRESS.md`（并入需求提交，不单独 commit）。这是主 agent 的动作，不是 plan 的步骤，此处只做备忘。

---

## 四、总体评述

这是一份**目的清楚、验证落到门禁**的计划：把三处时刻收敛到一个零依赖纯函数，落点、行号、函数名全部与真实代码对得上（检查项 ⑩ 是逐行核过的），`78 → 79` 的测试计数也是真的有账可查（60 TS + 18 C#）。分层与 500 行线两条硬线都没有踩。

真正需要补的不是「少了什么功能」，而是**两个实现细节的护栏**：`now` 缺默认值会让最主流的场景（今天的消息）全线失准，`Number.isFinite` 不足以挡越界有限值、会违背 §8「不出现 `NaN:NaN`」。两者都在 `chat-time.ts` 十几行内解决，且现有步骤 9 的真机验证能当场撞出前者 —— 所以判不阻断，但建议把 3.2(a)(b) 的写法直接抄进 plan 的「实现要点」，别留给执行期自由发挥。

`plan.md` 在审查期被改过一次（步骤 6 由「清 `language` 参数」补成「改 `:83` 解构」），这次修订恰好修掉了一条本会成为 ❌ 的问题——记录在此，避免后续误以为首版就合规。
