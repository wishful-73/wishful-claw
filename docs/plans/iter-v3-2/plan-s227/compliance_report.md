# S-227 规划合规报告

> **审查时间**：2026-10-26 17:26 (+08:00)
> **审查对象**：`docs/plans/iter-v3-2/plan-s227/plan.md`（12 步）· 需求正文 `requirements/S-227.md` · 迭代总览 `iter-v3-2/plan.md`
> **审查者**：独立规划验证 subagent（只读审查，未修改任何代码文件；唯一写入本文件）
> **已执行的门禁**：`cd website && npx tsc --noEmit` → **exit 0**（零类型错误）。`npm run build` 未执行（会产生 dist 产物，按只读约束跳过）。

## 结论

**PARTIAL** —— 12 步覆盖住了形态定稿五项、主干可执行，但**「3.5s 自动轮播」在点击任何按钮后会永久停转**（风险 4 的处置实际失效，步骤 3 检查点在真机上必挂），且需求正文缺 dev-workflow 强制要求的「代价与取舍 / 刻意不做」两段，不补则阶段五审查必被打回。

**❌ 阻断项 2 条 · ⚠️ 建议项 13 条**

---

## 一、需求覆盖

需求正文 §4「形态定稿」五项 + §5 五条风险，逐项对表：

| 需求点 | plan 步骤 | 判定 |
|---|---|---|
| §4 单张全宽大图 + 标题浮层（不额外占高） | 步骤 2（骨架/舞台）+ 步骤 4（宽屏浮层） | ✅ 覆盖。实现见 `features.tsx:96-99`（`aspectRatio: SLIDE_RATIO` 的舞台）、`:136-141`（`absolute inset-x-0 bottom-0` 浮层） |
| §4 3.5s 自动轮播保留、三个刹车搬过来 | 步骤 3 | ⚠️ **形式覆盖、实质不成立** —— 见 §二 与 ❌ 1 |
| §4 8 条不分组、一屏一条 | 步骤 2（8 张 slide 叠放） | ✅ 覆盖。`site.ts:192-226` 确为 8 条，全部带 `image`；无分组/分页残留 |
| §4 箭头 + 指示点都有（箭头 hover 才现、指示点常驻） | 步骤 6 + 步骤 7 | ⚠️ 覆盖。但非当前点近乎不可见（⚠️ 6）；箭头以 `opacity-0` 隐藏仍可聚焦点击（`features.tsx:148,156`），可接受但未在步骤里说明 |
| §4 375px 文字挪图下 | 步骤 5（`sm:hidden` 独立卡片） | ✅ 覆盖。断点取 `sm`=640px，375px 落在其内，符合意图（`features.tsx:163-168`） |
| §5.1 高度膨胀（别撑到六千像素） | 风险 6 | ✅ 处置成立（粗算净增 <100px，见 §五） |
| §5.2 输入源打架、手动抢过轮播并重置计时 | 步骤 3 `cycle` / 风险 4 | ❌ **处置无效**，见 ❌ 1 |
| §5.3 无障碍不能只换视觉 | 步骤 10 | ⚠️ 部分覆盖。需求点名的 `aria-live` 被静默换成 `aria-hidden`，**无取舍记录** |
| §5.4 首屏性能（别预载多张） | 步骤 9 | ✅ 覆盖。但检查点写法把"空白帧"锁死，见 ⚠️ 5 |
| §5.5 `#features` 锚点仍准 | §二 现状勘察 + §五「不碰 section-rail」 | ✅ 判断正确（`section-rail.tsx:48` 只 `getElementById`；`:63` 已有 `ResizeObserver` 兜高度变化） |
| §3 取 A·替换（tab 语义一并拆掉，hover 切换消失） | 步骤 2 | ✅ 覆盖。`role="tablist/tab/tabpanel"` 全清（对比 HEAD 版），`HOVER_DELAY_MS` 已删 |

**超范围检查**：步骤 9（懒挂载）、步骤 10（carousel 语义）均在需求 §5 风险项覆盖内；`site.ts` 文案未动（`git status` 只有 `ui.tsx` + `features.tsx` 两个代码文件改动，与 plan §5 一致）。**无越界**。

---

## 二、检查点可验证性

只列有问题的：

| 步骤 | 原检查点 | 问题 |
|---|---|---|
| 1 | 「其它**三个**使用 `AssetPlaceholder` 的板块不受影响」 | **事实错误 + 不可判定**。全站只有 1 个调用方：`quick-start.tsx:3`（import）、`:120`（使用）。`advantages.tsx:6` 是"已不再引入"的注释。应改为「`quick-start.tsx:120` 渲染不变」 |
| 3 | 「静置 3.5s 自转；鼠标移入停转；移出续转；**手动翻页后重新计时**」 | **现实现必失败**。`features.tsx:58` 的刹车是 `hovered \|\| focused \|\| !inView`；点指示点/箭头会让按钮获得焦点 → `:91` 的 `onFocus`（React 用 focusin，会冒泡）置 `focused=true`；鼠标移开后 `hovered=false` 但 `focused` 仍真 ⇒ **轮播不再启动**，`pick()` 里的 `setCycle`（`:68`）永远等不到 effect 重建 interval。真机验收时"点一次 → 移开鼠标 → 等 3.5s"会看到不动 |
| 5 | 「375px 下文字不压图、**不糊**」 | "不糊"主观。建议换成可判定的两条：375px 下浮层 `display:none`、文字卡 `getBoundingClientRect().top ≥ 图区 bottom` |
| 7 | 「当前项与其它项**视觉可区分**」 | 可判定但会"假通过"：非当前点 `bg-ink-700`（`index.css:16` = `#e4e7ec`）压在 `--color-paper #ffffff` 上，对比 ≈1.2:1，肉眼几乎看不到。应加一条「非当前点与背景对比 ≥ 3:1」 |
| 10 | 「读屏 / 键盘能拿到「第 N / 8：名称」」 | 未指定判定手段。需写明工具（Chrome DevTools Accessibility 树 / NVDA），否则"读屏"无法验。另注：`aria-label` 挂在**被 `aria-hidden` 的 slide 上**（`features.tsx:103-108`），8 张里 7 张对读屏不可见 ⇒ 实际只能读到"当前这张"的编号，读不到总数 |
| 11 | 「`npx tsc --noEmit` + `npm run build`」 | **未写工作目录，有假通过风险**。在仓库根跑 `npx tsc --noEmit` 走的是 references-only 壳（`AGENTS.md:216` 明确"0 错误是假的"）。应写 `cd website && npm run typecheck`（`website/package.json` 已有该脚本）；且 `npm run build` 本身 = `tsc --noEmit && vite build`，两步重复 |

可判定且写得好的：步骤 2（渲出第一张/点指示点换图）、步骤 4（量浮层是否额外占高）、步骤 6、步骤 8（Tab 到板块按左右键、不横向滚动）、步骤 9（网络面板请求数）、步骤 12（三处状态一致）。

---

## 三、文件路径核对

| plan 里的路径 | 实际 | 判定 |
|---|---|---|
| `website/src/components/ui.tsx` | 存在，112 行（全 CRLF）。改动 = `const`→`export` + 4 行注释，`git diff` 已核，**+5 行**（plan 写"+4 行"） | ✅ 正确 |
| `website/src/sections/features.tsx` | 存在，**207 行**（plan 写"169 → 约 200 行"；169 是旧版实测值） | ✅ 正确 |
| `docs/plans/iter-v3-2/requirements/S-227.md` | 存在（4795 B） | ✅ |
| `docs/plans/iter-v3-2/raw-requirements.md` | 存在（1794 B，S-227 行在 `:10`） | ✅ |
| `docs/plans/iter-v3-2/plan.md` | 存在（4562 B，S-227 行在 `:19`） | ✅ |
| `docs/plans/iter-v3-2/plan-s227/plan.md` | 存在（5810 B） | ✅ |
| `docs/plans/iter-v3-2/plan-s227/compliance_report.md` | **审查前不存在**，由本报告建档 | ✅ 目录名 `plan-s{NNN}/` 符合 `dev-workflow.md:531` |
| （缺）`plan-s227/review_report.md`、`verification_report.md` | 未列。阶段五/六产物，`dev-workflow.md:467,495` 要求；迭代总览 `iter-v3-2/plan.md:72` 已声明会产出 | ⚠️ §5 清单不全 |
| （缺）`docs/plans/iter-v3-2/changelog.md` | 存在但 plan 未列。10:14「取 A·替换」与 17:08「形态定稿」两条裁定按 `dev-workflow.md:545` 应落流水 | ⚠️ |
| （缺）`docs/PROGRESS.md` | `dev-workflow.md:412` 要求阶段三完成后更新，plan 未提 | ⚠️ |

> 路径本身**零错**，无虚构文件；`plan-s227/` 命名与该目录下 `plan-s225/` 一致。

---

## 四、影响面遗漏

把 `website/src` 全目录扫过（40 个文件），逐项核三项必查点：

1. **`components/section-rail.tsx`（`#features` 锚点）** —— **plan 判断正确，无需改动**。证据：`section-rail.tsx:47-52` 只做 `document.getElementById(item.id)` + `getBoundingClientRect()`，不看内部结构；`:60-64` 已有 `ResizeObserver(document.body)` 兜"板块变高变矮"；`site.ts:90` 的 id 与 `features.tsx:80` 的 `Section id="features"` 对齐。**唯一遗留**是 `section-rail.tsx:60` 注释"features 切 tab"已成过期描述（无行为影响）。
2. **`components/ui.tsx` 的 `AssetPlaceholder`** —— 全仓唯一调用方 `quick-start.tsx:120`；`assetSources` 由 `const` 提为 `export` 对 `AssetPlaceholder`（`ui.tsx:89` 内部引用）**零影响**，不会波及别的调用方。**plan 步骤 1 的"三个板块"表述是错的**（见 ⚠️ 1）。
3. **`index.css`** —— **无 features 专属样式**。全文搜 `feature|tablist|tabpanel|carousel`：只命中 `:242-265`、`:363` 的 `.doc-prose ul.feature-grid`（指引页/文档页用，与首页无关）。新代码唯一复用的是全局 `.reveal`（`:394-397`）与它的 `prefers-reduced-motion` 兜底（`:398-402`），可放心复用。`bg-linear-to-t`、`max-sm:` 均为 Tailwind v4 写法（`tailwindcss ^4.3.3`），`--color-ink-700/900/950`、`--color-accent`、`--color-paper(-soft)` 均在 `index.css:12-21` 定义，无未定义 token。

补充核实（均**无**影响，可视为 plan 判断正确）：`App.tsx:8,36` 只挂 `<Features />`；全仓 `\bfeatures\b` 仅出现在 `site.ts`(90,136-137,190)、`features.tsx`、`value-ladder.tsx:8-9`（注释，讲的 `pt-5` 仍成立）、`App.tsx`、`section-rail.tsx:60`（注释）；`index.html` / `vite.config.ts` 无引用；`public/screenshots/` 里 8 条用到的素材（assetNo 11/12/13/1/5/6/10/3）**全部存在**。

**plan 真漏的影响面只有一条**：`section-rail.tsx:60` 的过期注释（建议顺手改，也可以明确写"不改注释"）。

---

## 五、风险处置

### 5.1 plan §6 七条逐条核

| # | 风险 | 处置是否成立 |
|---|---|---|
| 1 | 8 张图全挂 DOM 白吃 MB | ✅ 成立。`features.tsx:40` 初始 `new Set([0])`、`:53-55` 访问才加、`:113` 才建 `<img>`。**但数字要改**：8 张实际合计 **≈1.2 MB**（最大 `goal_chat.png` 315 KB、`scheduled-task.png` 241 KB），不是"数 MB" |
| 2 | 素材尺寸不统一、竖版被裁 | ✅ 成立。实测 `public/screenshots`：`wechat.png` 1226×1263（唯一竖版）、`search.png` 1688×1050、`ctrl_cv.png` 1842×1251，其余 5 张 2520×1608（不是 plan 写的 4 张）。`object-cover`（`:119`）确实裁上下，属于**已声明的取舍**，可接受 |
| 3 | 浅色截图压白字可读性 | ✅ 成立。`from-ink-950/88 via-ink-950/50`+`pt-16`（`:136`），深压约 3 成高，符合处置描述 |
| 4 | 手动翻页被轮播抢走 | ❌ **不成立** —— `setCycle` 重置被 `focused` 刹车短路，见 ❌ 1 |
| 5 | tablist 语义没了 | ⚠️ 部分成立。`role="group"`+`aria-roledescription="carousel/slide"`+逐张 `aria-label` 有（`:84-85,105-107`），但需求点名的 `aria-live` 缺位且未记录理由 |
| 6 | 总高度膨胀 | ✅ 成立（粗算）。1440 视口：新舞台 = (1440−112)/1.5662 ≈ **848px** + 指示点区 22px ≈ 870；旧版 = 面板列宽 (1328−176−32)=1120 → 内图 1072 宽 / 684 高 + `p-6` 48 + 文案 ~28 + `mt-5` 20 ≈ 780。**净增 ≈ +90px**（占"六千像素"预算 1.5%），"净增 ≈ 0"的说法偏乐观但结论不变 |
| 7 | 焦点环被 `outline-none` 抹掉 | ✅ 成立。`features.tsx:93` `outline-none` + `focus-visible:ring-2 ring-accent/40 ring-offset-2` 配对补回；箭头另有 `focus-visible:opacity-100`（`:148`）解决"不可见却可聚焦" |

### 5.2 三个指定探针

- **React 19 并发 + `useState<Set>`**：**无问题**。`:54` 是纯函数式更新且 `new Set(prev).add(active)` 不回写旧集合，`has` 命中时返回原引用避免重渲 —— 是正确的不可变写法，`StrictMode` 双调用也安全。
- **`IntersectionObserver` 在 aspect-ratio 容器上**：**基本成立、余量偏薄**。observer 目标是外层 `wrapRef`（`:82-83`），`threshold: 0.4` 要求自身 40% 面积可见：1920×1080 比值 ≈0.92、2560×1080 ≈0.67、**3440×900 ≈0.42、2560×720 ≈0.45**。超宽矮窗口贴着阈值走，掉到 0.4 以下就永不轮播。建议 `threshold: 0.25`（或加 `rootMargin`）。另 `inView` 初值 `false`（`:36`），IO 首帧回调前不轮播，属可接受。
- **`aria-hidden` 与可聚焦子元素冲突**：**本实现无冲突** —— 8 张 slide 内只有 `<img>`/`<div>`（`:100-132`），无可聚焦元素；箭头（`:144-159`）与指示点（`:172-183`）都在 slide 之外，不会被 `aria-hidden` 连带隐藏。但存在另一面：7 张 hidden slide 的 `aria-label="第 N / 8"` 也一并读不到，读屏用户拿不到总数。

### 5.3 plan 未识别的风险

1. **点击后自动轮播永久停**（= ❌ 1）。这是本需求最容易在真机上被老大一眼看出的退化。
2. **切到没看过的图先空白一帧**。`seen` 只在 `active` 变化后的 effect 里加（`:53-55`），所以切到第 5 张的那一帧里 slide 5 还没有 `<img>`，随后才发起请求（`goal_chat.png` 315 KB / `scheduled-task.png` 241 KB）；叠加 `transition-opacity duration-500`（`:109`）与 3.5s 自动轮播，"电商首页那种"顺滑观感会打折。而步骤 9 的检查点"翻到第 5 张才请求第 5 张"恰好把这种行为**写成了验收标准**，二者互相矛盾。建议：预取下一张（`<link rel=preload>` 或隐藏 `<img>`），检查点改成"首屏 ≤ 2 张请求、切换无空白帧"。
3. **指示点非当前项不可见**（⚠️ 6，`#e4e7ec` on `#fff` ≈1.2:1）。需求要的是"指示点常驻"，实际只剩一根橙色短条。建议 `bg-ink-900/25` 或 `bg-accent/20`。
4. **`focused` 刹车的语义漂移**：原来焦点刹车针对 tab（键盘用户的"正在选"），现在**任何鼠标点击**都会点上刹车。处置见 ❌ 1。

---

## 六、规范冲突

| 规范条目 | 判定 |
|---|---|
| `AGENTS.md:174-175` 单文件 200~500 行、>500 必拆（代码文件） | ✅ **通过**。`features.tsx` 实测 **207 行**（207 个 LF、0 个 CR），在 200~500 区间内，无需豁免头注释；`ui.tsx` 112 行。plan 写"约 200 行"与实测基本一致 |
| `AGENTS.md:137-142` TS 文件名 kebab-case / 注释中文 | ✅ **通过**。`features.tsx`、`ui.tsx` 均 kebab；新代码注释全中文，`§` 分节写法与仓库既有风格（`section-rail.tsx:4-18`）一致 |
| `AGENTS.md:217` 禁 `@ts-ignore` | ✅ **通过**，未使用 |
| `AGENTS.md:212-216` TS 门禁口径 | ⚠️ plan 步骤 11 写 `npx tsc --noEmit`，未限定工作目录；官网自带 `npm run typecheck`（`website/package.json`）却没用 |
| `docs/dev-workflow.md:618` 行尾一律 CRLF、无 BOM | ⚠️ **`features.tsx` 全文裸 LF**（207 LF / **0** CRLF），对比 `ui.tsx` 112/112 全 CRLF；`git diff` 已警告 `LF will be replaced by CRLF the next time Git touches it`。无 BOM。因 `core.autocrlf=true`，入库 blob 不受影响，故不阻断 |
| `docs/dev-workflow.md:423-461` 阶段四"每步标记 [✓]、终止判据 0 个 [ ] 残留" | ⚠️ plan 用表格没有勾选列，§7 直接断言"步骤 1~11 全过"（`plan.md:84`），无逐条证据可核 |
| `docs/dev-workflow.md:552-568` 需求正文七段模板（含「代价与取舍」「刻意不做」，明确"不允许整段不写"） | ❌ **违反**。`S-227.md` 只有 §1 原话 / §2 现状 / §3 意图 / §4 定稿 / §5 风险 / §6 范围外 / §7 阶段表，缺第 6、7 段 |
| `docs/dev-workflow.md:373-393` plan.md 格式（目标 / 步骤+检查点 / 涉及文件 / **参考源码具体路径**） | ⚠️ 无「参考源码」小节。本需求确实不涉参考项目，但应显式写"无（官网自有组件，零依赖）"，否则审查无法区分"漏写"与"不适用" |
| `docs/dev-workflow.md:511-535` 文档目录约定（总览+明细、`plan-s{NNN}/`） | ✅ **通过**（仅 §5 清单不全，见 §三） |

---

## 七、❌ 阻断项（必须改完才能实施）

1. **自动轮播在用户第一次点击后永久停转 —— 风险 4 处置失效，需求 §4「保留 3.5s 自动轮播」不达标。**
   证据链：`features.tsx:58`（刹车 `hovered || focused || !inView`）→ `:91` `onFocus`（React 合成事件基于 focusin，会从子按钮冒泡到容器）→ 点指示点（`:178`）或箭头（`:147,155`）时按钮获得焦点 ⇒ `focused=true` 且**鼠标移开也不会复位**（只有焦点离开容器才走 `:92` 的 `onBlur`）⇒ interval 不再创建，`:68` 的 `setCycle` 重置形同虚设。
   影响：`pick()` 之后"移开鼠标等 3.5s"看不到任何翻页 —— 步骤 3 检查点「移出续转 / 手动翻页后重新计时」在阶段六真机必挂，等于返工。
   建议改法（任选其一，最小改动优先）：
   - a) 把"焦点刹车"限定为**键盘来源**：`onFocus` 里判 `el.matches(':focus-visible')`，并在 `onPointerDown` 时 `setFocused(false)`；
   - b) 指示点/箭头 `onClick` 后显式 `e.currentTarget.blur()`，把焦点交回容器或 `document.body`；
   - c) 改用"最近一次交互来源"状态（`'pointer' | 'keyboard'`）驱动刹车，pointer 交互不刹车、只重置 `cycle`。
   验收：点第 5 个点 → 移开鼠标 → 3.5s 后自动翻到第 6 张。

2. **需求正文缺 dev-workflow 强制段「代价与取舍」「刻意不做」，且 `aria-live` 的需求偏离无取舍记录。**
   证据：`dev-workflow.md:552-568`（七段固定、"允许留空标题，**不允许因为「还没实施」就整段不写**"）；`S-227.md` 全文无这两段；plan 步骤 12（`plan.md:49`）的文档回填只写"状态列"，不覆盖它们；`S-227.md:73-75` 明确要求"换成 `aria-roledescription` + `aria-live` 控制"，而步骤 10（`plan.md:47`）只写 `aria-hidden`，**静默替换**（`features.tsx:103-108` 实现亦无 `aria-live`）。
   影响：阶段五审查按"需求未落地"必打回；且后人会把"hover 切换/左侧 tab"当 bug 修回去（这正是第 6/7 段存在的理由）。
   建议改法：`S-227.md` 补两段 ——
   - **代价与取舍**：hover 切换彻底消失（点击/hover 二选一，不再有"扫过去就切"）；竖版 `wechat.png` 被 `object-cover` 裁上下；`aria-live` 不启用（8 条 3.5s 自动播报会打断读屏）改由"活动 slide 的 `aria-label` + `aria-hidden` 静默切换"承担，读屏用户需手动 Tab 进容器再按方向键；页面净增约 90px。
   - **刻意不做**：不分组/不分页（撞六千像素约束）、不预载全部 8 张、不引第三方轮播库（整站零依赖）、不改 `site.ts` 文案（归 S-205）、不为单张图引特殊比例分支。
   同时把步骤 12 检查点从"三处状态一致"扩为"三处状态一致 + 上述两段已补 + changelog 有两条裁定流水"。

---

## 八、⚠️ 建议项

1. **步骤 1 检查点的事实错误**："其它**三个**使用 `AssetPlaceholder` 的板块"（`plan.md:38`）→ 实际只有 `quick-start.tsx:120` 一处。改为「`quick-start.tsx:120` 渲染不变」。
2. **步骤 11 门禁写法有假通过风险**（`plan.md:48`）：`npx tsc --noEmit` 未写工作目录，在仓库根跑的是 references-only 壳（`AGENTS.md:216`）。改成 `cd website && npm run typecheck`；`npm run build` 已含 `tsc --noEmit`，不必单列。
3. **步骤清单缺 `[ ]` / `[✓]` 列**：`dev-workflow.md:423-461` 的终止判据是"0 个 `[ ]` 残留"。现在 `plan.md:84` 一句"步骤 1~11 全过"没有任何逐条证据，等于事后自我声明。
4. **§二 两个数字要订正**（`plan.md:26`、`:69`）：features 用到的 8 张里 **5 张**是 2520×1608（不是 4 张）；8 张合计 **≈1.2 MB**（不是"数 MB"）。
5. **补一条风险：懒挂载的空白帧**。`seen` 门控（`features.tsx:53-55,113`）+ `duration-500` 交叉淡入 ⇒ 切到没看过的图先空一帧；而步骤 9 检查点"翻到第 5 张才请求第 5 张"把这个行为固化。建议允许预取下一张，检查点改"首屏 ≤ 2 张请求、切换无空白帧"。
6. **指示点非当前项几乎不可见**：`bg-ink-700`（`index.css:16` `#e4e7ec`）在白底对比 ≈1.2:1（`features.tsx:180`），需求要的"指示点常驻"实际只剩一根橙条。建议 `bg-ink-900/25` 或 `bg-accent/20`。
7. **`threshold: 0.4` 余量太薄**（`features.tsx:48`）：3440×900 估算比值 ≈0.42。建议降到 `0.25`，并在步骤 3 检查点加"首屏即为激活区时无需滚动就自转"。
8. **`features.tsx` 全文 LF**（207 LF / 0 CRLF），与仓库 CRLF 约定不符（`dev-workflow.md:618`）；`ui.tsx` 是 112/112 CRLF。建议提交前统一 CRLF（`git add` 会归一化 blob，风险仅为工作区不一致，故不阻断）。
9. **迭代总览 `iter-v3-2/plan.md:63` 仍写「9 条内容」**，与 `S-227.md:38-39` 刚订正的 8 条矛盾；步骤 12 既然要改 `plan.md`，顺手改这一处。
10. **`S-227.md:86-92` 阶段表用「三·实施 / 四·自查」**，与 `dev-workflow.md` 六阶段「三·规划验证 / 四·执行」不同名；步骤 12 回填时会把错名继续沿用，建议一并改名对齐。
11. **§5 文件清单不全**（`plan.md:53-60`）：缺 `changelog.md`（`dev-workflow.md:545` 裁定流水）、`plan-s227/review_report.md`、`verification_report.md`（`:467,495`）、`docs/PROGRESS.md`（`:412`）。
12. **补「参考源码」小节**：写"无（官网自有组件，沿用旧实现结构，零依赖）"，避免审查误判漏写。
13. **两处小瑕疵**：`section-rail.tsx:60` 注释"features 切 tab"已过期（无行为影响，可顺手改）；`features.tsx:121-128` 的占位兜底分支当前**不可达**（8 条 assetNo 全部已在 `ui.tsx:75-84` 登记），且与 `AssetPlaceholder`（`ui.tsx:101-110`）文案重复 —— 保留可以，但应在文件头写明"素材位回退用"，否则后人会当死代码删掉。

---

## 附：本次审查做过的事

- **读**：`plan-s227/plan.md`、`requirements/S-227.md`、`iter-v3-2/plan.md`、`raw-requirements.md`、`AGENTS.md`、`docs/dev-workflow.md`、`website/src/{App.tsx, sections/features.tsx, components/ui.tsx, components/section-rail.tsx, content/site.ts, index.css}`、`website/package.json`、`website/src` 全目录清单。
- **比对**：`git show HEAD:website/src/sections/features.tsx`（旧 tab 版）↔ 工作区新 banner 版；`git diff website/src/components/ui.tsx`。
- **命令**：`git status --porcelain`（仅 `ui.tsx` + `features.tsx` 两个代码文件改动，`docs/plans/iter-v3-2/` 未跟踪）；`cd website && npx tsc --noEmit` → exit 0；PNG 头部读尺寸（`public/screenshots` 10 张）；行尾/字节统计（`features.tsx` 207 裸 LF / `ui.tsx` 112 CRLF）。
- **未做**：`npm run build`、`npm run dev`、任何 git 写操作、任何代码文件修改。
