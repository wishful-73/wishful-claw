# S-221 规划合规检查（阶段三）

> 2026-10-23 10:26 起，只读审查：逐条核对 `plan.md` 的 9 个步骤，并实地交叉验证 `website/` 13 个文件（`App.tsx` / `main.tsx` / `index.html` / `vite.config.ts` / `package.json` / `components/ui.tsx` / `components/site-header.tsx` / `components/doc-page.tsx` / `lib/use-active-heading.ts` / `sections/*.tsx` / `content/site.ts` / `index.css`）与 `requirements/S-221.md §8` 九条验收。未执行 git、未跑构建、未改动任何代码文件。

**检查对象**：`plan-s221/plan.md`（步骤 9 条，「文案表」7 项，「参考源码」3 条）
**检查依据**：`docs/dev-workflow.md:397-414`（阶段三五项 + 阻断规则）；`AGENTS.md:172-183`（500 行硬线及三类豁免）、`AGENTS.md:135-142`（文件命名）、`AGENTS.md:210-217`（编译验证）；`docs/plans/iter-v3-1/requirements/S-221.md` 全文（重点 §2 目标、§4 方案、§8 九条验收）
**结论计数**：❌ 1 / ⚠️ 6 / ✅ 5

**阻断判定**：按 `dev-workflow.md:414`「❌ 项 > 0 时禁止进入用户确认环节」⇒ 本报告存在 **1 项 ❌**，**阻断**，需先修订 `plan.md`（最小修订见 §三末）再复审，不得进入用户确认。

---

## 一、阶段三五项检查

| # | 检查项 | 结论 | 依据 |
|---|---|---|---|
| 1 | 步骤是否完整覆盖任务目标 | ✅ | 目标三条（超链接 / 滚动联动 / 点击跳转）分别落在步骤 2（`<a href>`）、步骤 3（observer 联动）、步骤 2 + `index.css:24-25` 的 smooth scroll；需求 §4.2 九项交互映射到步骤 3/4/5/6/7，§4.3 补锚点 → 步骤 1，§4.4 文案 → 步骤 2 + plan:35-47，§8 九条 → 步骤 9。**逐项有对应步骤，无漏项** |
| 2 | 每步是否有明确验证检查点 | ❌ | 步骤 7 的检查点「禁用 JS 后点「下载」能跳」**在物理上不可能成立**：官网是纯 CSR，`website/index.html:15` 只有空 `<div id="root"></div>`、`website/index.html:16` 才加载 `./src/main.tsx`，页面由 `website/src/main.tsx:6-10` 的 `createRoot().render()` 生成；`website/vite.config.ts:36` 是 `appType: 'mpa'` 四个 HTML 入口，全仓无 SSG/prerender 配置 ⇒ 禁 JS 后整页空白，没有可点的「下载」。该检查点执行期只能造假或卡死 |
| 3 | 文件路径是否符合项目结构 | ✅ | 新增 `website/src/components/section-rail.tsx` 落在既有 `components/` 目录、kebab-case 合 `AGENTS.md:138`；改动仅 `website/src/App.tsx`、`website/src/sections/hero.tsx`，均为既有文件 |
| 4 | 分层依赖是否正确 | ✅ | 全量改动在 `website/`，`website/` 不在 `AGENTS.md:23-112` 的 7 层 C# 依赖链内，plan:4「零软件改动」与 §涉及文件（plan:51-65）一致，无跨层引用风险 |
| 5 | 是否参考了正确源码 | ⚠️ | plan:69-73 的三条引用本身准确（`ui.tsx:5-33` 确为 `Reveal` 全函数、`ui.tsx:45` 确为 `scroll-mt-24`、`index.css:24-25` 确是 `html{scroll-behavior:smooth}`），**但漏掉同站点最接近的既有实现**：`website/src/lib/use-active-heading.ts:1-61`（滚动 → 高亮当前节）与 `website/src/components/doc-page.tsx:89-96`、`:107-133`（`nav aria-label="目录"` + `hidden lg:block` + active 样式 + `aria-current`）。详见 §三 ⚠️-1 |

## 二、补充检查（AGENTS.md）

| # | 项 | 结论 | 依据 |
|---|---|---|---|
| 6 | 是否触碰 >500 行文件 | ✅ | `website/src/index.css` 实测 **699 行**（与非空行 616 区分），plan:63 的「699 行」准确；文件头 `index.css:1-3` 已写明「500 行豁免（2026-10-20 实测 699 行）+ 豁免依据 AGENTS.md §大文件拆分第 5 条第 1 类」，合 `AGENTS.md:178-179`。且 plan:63 明确「本需求不新增 CSS」，规避了在 500+ 文件上继续加码。新文件预估 70~90 行（plan:53），远低于硬线 |
| 7 | 是否新增依赖 | ✅ | plan:118「不引入滚动库（如 `react-scrollspy`），observer + 原生锚点足够」；实现只用浏览器原生 `IntersectionObserver`；`website/package.json` 的 `dependencies`/`devDependencies` 无需变动 |
| 8 | 是否有硬编码 | ⚠️ | plan:62 定「不改 `site.ts`（本需求不新增文案字段）」+ plan:15「文案取 `site.ts` 实际 title」⇒ 7 条标签只能硬编码进 `section-rail.tsx`，与 `website/src/content/site.ts:1-2`「改文案只改这里，不散落进 JSX」正面冲突。详见 §三 ⚠️-2 |
| 9 | 降级与可访问性是否在步骤里可验 | ⚠️ | 小屏可验（步骤 5：1024px 两侧截图）；无 JS **不可验**（见上表 #2，已计 ❌）；reduced-motion 只写结论未写机制 —— `index.css` 现有 4 处降级（`:388-392` `.reveal`、`:484` `.site-mist::before`、`:588` `.tier`、`:688` `.dl-*`）**均不覆盖** `index.css:24-25` 的 `html{scroll-behavior:smooth}`；语义（`nav` 包裹 / `aria-current`）与对比度（未选中 `text-ink-900/45` ≈ 2.5:1、选中 `text-accent` ≈ 3.6:1）也未进步骤。详见 §三 ⚠️-3 |
| 10 | 行号 / 类名引用是否与真实代码一致 | ⚠️ | 逐条核对：`hero.tsx:22` ✅（裸 `<section className="relative isolate pt-28 pb-16 sm:pt-36">` 一字不差）、`ui.tsx:45` ✅、`ui.tsx:5-33` ✅、`index.css:24-25` ✅、`App.tsx:27-33` ✅、`site-header.tsx:23` `z-50` 与 `:27` `h-14` ✅（plan:59 的层级/遮挡推算成立）、`vite.config.ts:13` `DEV_PORT = 5280` ✅（步骤 9 端口对）、`package.json` `build = "tsc --noEmit && vite build"` ✅（步骤 8 门禁对）。**文案表有一处引用不实 + 一处结论不成立**（`downloadCta` 不存在；「唯一不一致」实为 3/7），详见 §三 ⚠️-4 |
| 11 | 联动算法描述是否可直接实现（补充核查） | ⚠️ | plan:30「收集所有 `entry.isIntersecting === true` 的 section」按字面实现会在**上滚/回顶**时错位 —— IntersectionObserver 每次回调只交付变化的 entries，出区间的 section 只以 `isIntersecting:false` 出现，本轮「true 的集合」为空 ⇒ 落进 plan:32「保持上一个」。详见 §三 ⚠️-5 |
| 12 | 「概览」回顶落点是否等于页面顶部（补充核查） | ⚠️ | `site-header.tsx:22-27` 是 `sticky top-0` + `h-14`（sticky 仍占流），`hero.tsx:22` 又无 `scroll-mt-*` ⇒ `#top` 落点 `scrollY ≈ 56`，且 `site-header.tsx:15` 阈值 8px 会让顶栏在落点已是玻璃底态。与验收「点「概览」→ 回到页面顶部」（`S-221.md:127`）字面不符。详见 §三 ⚠️-6 |

## 三、缺口说明

### ❌ #2 —— 步骤 7 的「无 JS 降级」检查点不可执行

**代价**：这是唯一一条会被阶段六如实打回的检查点。执行者只有三条路：① 硬勾（造假）；② 停在步骤 7 等指令（流程空转）；③ 临时给站点加 SSG/预渲染来「让它可验」—— 后者直接违反 plan:118「不引入依赖」并远超需求范围。三条都不是好结果，而这条在规划阶段就能一眼判掉。

**改法**（三选一，推荐第 ①＋③ 组合）：

1. 把检查点换成**可验的等价目标**：「`section-rail.tsx` 用真 `<a href="#id">`，不含 `onClick` + `scrollIntoView` 等式跳转」—— 代码可查（grep 无 `onClick`），语义可查（DOM 是 `<a>`）。这才是需求 §4.2「每一项是真 `<a>`」真正想保的东西。
2. 在 `plan.md` 步骤 7 与 `S-221.md:65`、`S-221.md:130` 三处同步写明：「本站为 CSR（`index.html:15-16` + `main.tsx:6-10`），无 JS 时整页不渲染，**该条按不适用（N/A）处理**，理由与证据见此处」，并在 `S-221.md §9 实施记录` 回填 —— 避免阶段六照旧去勾一条勾不动的项。
3. 若确实要「禁 JS 也能跳」，那是引入 SSG 的新需求，须另开编号、另过一遍阶段一～三，不要塞进 S-221。

### ⚠️-1（对应 #5）—— 参考源码漏了同站点最接近的实现

**代价**：① 重复造轮子；② **口径分裂** —— 既有实现用 `aria-current="true"`（`doc-page.tsx:120`）、阈值 `TOP_LINE = 88`（`use-active-heading.ts:5`）、文末兜底（`use-active-heading.ts:31-37`，正好解决 plan:32 担心的「页脚全灰」），plan 一律没提；③ plan:110「用 observer 而非 scroll 事件」与 `use-active-heading.ts:46-52`（`scroll` + `passive` + rAF 合并）是**相反取舍**却没写理由，实施后站内会有两套活跃项判定。

**改法**：在 §参考源码 增列 `website/src/lib/use-active-heading.ts` 与 `website/src/components/doc-page.tsx:89-96 / :107-133`，并补一句取舍说明，例如：「首页要按「上部 30% 窄带」而非「标题越过 88px 线」判定，`useActiveHeading` 的 ids + TOP_LINE 模型不适配，故不复用；但要沿用它已有的 `aria-current` 语义、`hidden lg:block` 断点与文末兜底思路」。这一句同时把 ⚠️-3(b) 的语义缺口补上。

### ⚠️-2（对应 #8）—— 7 条文案的落点未定，且与 `site.ts` 约定冲突

**代价**：`site.ts:1-2` 是全站唯一文案出口，plan:62 却锁死「不改 site.ts」⇒ 7 条标签散进 `section-rail.tsx`。日后某人改 `valueLadder.title`（`site.ts:150`）或 `features.title`（`site.ts:176`）时，悬浮块不会跟，出现「同一句文案两处维护、两处不一致」—— 这正是该约定要防的事。

**改法**：在 `site.ts` 增一个 `sectionRail` 常量（7 条 `{ id, label }`），组件只 `map`。其中 `top: '概览'`（Hero 无 title，`site.ts:45-68` 只有 `title.lead/highlight` 与 `subtitle`）、`'value-ladder': '不花钱'` 显式写短文案，其余五项直接取各段 `title` 值。这样既守住「只改一处」，又不是新造词（短文案就写在原文案旁边，肉眼可对照）。若坚持不动 `site.ts`，则 plan 必须把这 7 条硬编码**明写为已知例外**并给出理由，否则执行者会在「照抄 title」和「抄文案表」之间二选一、结果不可预测。

### ⚠️-3（对应 #9）—— 降级与可访问性四小项

**(a) reduced-motion 机制未定**：`index.css:24-25` 的全局平滑滚动**没有** reduced-motion 例外（grep 四处 `prefers-reduced-motion` 见 #9 行，均只关动画类）。plan 步骤 7 若只写「无过渡动画」，实现出来仍是平滑滚动，与验收（`S-221.md:131`「不做过渡动画（跟随现有 CSS 的降级约定）」）对不上。
→ 改法：步骤 7 拆两点。① hover 若加 `transition-colors`，必须配 `motion-reduce:transition-none`（Tailwind 内置变体，不新增 CSS，仍合 plan:63）；② 明写「平滑滚动是 `index.css:24-25` 的既有全局行为，本需求不为它新增例外，该条验收按『组件自身不新增动画』解释」。

**(b) 语义缺失**：plan 步骤 2/4 只写 `<a>` 与配色，没写外层 `<nav aria-label="页内导航">`、也没写 `aria-current`。既有目录栏两样都有（`doc-page.tsx:90`、`:120`），新组件缺了就是站内不一致。
→ 改法：步骤 2 增「外层 `<nav aria-label="页内导航">`」，步骤 4 增「当前项 `aria-current="true"`」。

**(c) 对比度不达标且与自评矛盾**：未选中 `text-ink-900/45` 按 `index.css:14` 的 `#33373f` 压到 45% 叠白底 ≈ `#A3A5A9`，对比度 ≈ **2.5:1**；选中 `text-accent` `#ea580c`（`index.css:19`）≈ **3.6:1**。两者对 `text-xs` 都低于 WCAG AA 的 4.5:1 —— 而 plan:17 的检查点却写「未选中项压在通栏内容上仍可读」。
→ 改法：未选中提到 `/60`（≈3.5:1）到 `/70`（≈4.3:1）；若坚持 45%，至少把「已知低于 AA、按设计取舍接受」写进 plan，别让阶段六按「可读」去打。

**(d) 位置未定量**：`ui.tsx:47` 内容容器是 `w-full px-6 sm:px-10 lg:px-14`（右内边距仅 56px），`fixed` 竖排条在 1024–1280 区间**必然**压到正文右缘。plan 步骤 5 只写「`fixed` 垂直居中、`z-40`」，没给 `right-*`，验收时无法判断「不挡右缘」。
→ 改法：步骤 5 写死 `right-4`／`right-6`，并明写「`lg`～`xl` 区间接受与右缘文字有 ≤ 一列重叠（与 plan:108 的取舍一致）」。

### ⚠️-4（对应 #10）—— 文案表的引用不实与结论不成立

已核对无误的：`features.title = '它能干什么'`（`site.ts:176`）、`advantages.title = '为什么是它'`（`site.ts:84`）、**`quickStart.title = '四步开始'`（`site.ts:218`）** —— plan:44 的「四步开始」**是对的**，需求 `S-221.md:84` 的占位「快速上手」才是错的，实施请以 plan 为准；`faq.title = '常见问题'`（`site.ts:242`）；`valueLadder.title = '不花钱，也能用起来'`（`site.ts:150`）截短为「不花钱」已在 plan:47 声明。

**两处问题**：

1. **`downloadCta` 这个符号不存在。** `site.ts` 只有 `downloadSources`（`:27`）、`platforms`（`:39`）、`footer`（`:272`），没有 `downloadCta`。该段真正标题在 `website/src/sections/download-cta.tsx:10`：`` title={`下载${BRAND.name}`} `` ⇒ 渲染成「下载心相」。plan:43 的来源列「`downloadCta` 入口语义」指向不存在的导出，且「下载」也不是原值而是截短。
   → 改法：来源列改成 `sections/download-cta.tsx:10`（模板串截短），并在 plan:35 的表头「按 `site.ts` 实际值」上补一句「`download` 段标题不在 `site.ts`，在 `download-cta.tsx:10` 拼 `BRAND.name`」。
2. **plan:47「这是唯一与 `site.ts` 原文案不一致的一项」不成立**：实际 7 项里 **4 项照抄**（features / advantages / quick-start / faq）、**2 项截短**（value-ladder、download）、**1 项自拟**（top）。
   → 改法：结论改成「4 照抄 / 2 截短 / 1 自拟」，逐项标好，实施时不会误以为只有 1 处需要自由发挥。

**附带（在需求侧，plan 未复述但建议顺手改）**：`S-221.md:66` 引「全宽铺满，见 `ui.tsx:50`」—— `ui.tsx:50` 实际是 `{props.eyebrow && (`，全宽容器在 `ui.tsx:47`。plan 没抄这个行号，所以不计入本次判定，但同一错误已在需求正文里，建议实施时一并订正，免得下次又被引用。

### ⚠️-5（对应 #11）—— plan:30 的联动算法按字面实现会在上滚时错位

`IntersectionObserver` 的回调只带**本次发生变化**的 entries。按 plan:30「收集所有 `entry.isIntersecting === true` 的 section，取 `top` 最小者」：上滚时某一节离开窄带，本轮 entries 里只有一个 `isIntersecting:false` ⇒ 集合为空 ⇒ 命中 plan:32 的「保持上一个选中项」，于是用户已经滚回 `features`，高亮还挂在 `download` 上。往下滚时多数场合看不出来，**回顶/上滚必错** —— 恰好就是验收第 2、4 行（`S-221.md:125`、`:127`）要测的路径。

**改法**（照抄即可）：

```
// 维护全量状态，而不是只看本次 entries
const visible = useRef<Map<Element, boolean>>(new Map())
const pick = () => {
  let best: string | null = null
  let bestTop = Infinity
  for (const el of sections) {
    if (!visible.current.get(el)) continue          // 只在上部 30% 窄带内的
    const top = el.getBoundingClientRect().top
    if (top < bestTop) { bestTop = top; best = el.id }
  }
  if (best) setActive(best)                          // 空则保持上一个（不清空）
}
// callback: entries.forEach(e => visible.current.set(e.target, e.isIntersecting)); pick()
```

并把 `useState('top')` 作为首帧默认（落实 plan:33），cleanup 沿用 `ui.tsx:8-27` 的 `useEffect` 返回 `io.disconnect()` 写法（plan:71 已声明复用，方向正确）。

### ⚠️-6（对应 #12）—— 「概览」落点 56px，不是「页面顶部」

`site-header.tsx:22-25` 是 `sticky top-0`，sticky 元素**仍在流内** ⇒ `hero` 的 `offsetTop = 56`；`hero.tsx:22` 无 `scroll-mt-*`，所以点 `#top` 落在 `scrollY ≈ 56`，同时因为 `site-header.tsx:15`（`scrollY > 8`）顶栏已切成玻璃底态 —— 观感像「跳到了首屏但没到底」。与 `S-221.md:127`「回到页面顶部」字面不符。

**改法**（推荐 ①，因为不碰 `hero.tsx`，还能顺手满足 plan 步骤 1 的「类名一字不动」约束）：

1. 把锚点搬到 `App.tsx`：在 `<SiteHeader />`（`App.tsx:25`）之前加 `<span id="top" aria-hidden className="block h-0" />`，`hero.tsx` 零改动 ⇒ 落点 `scrollY = 0`。
2. 或保留 `hero` 上的 `id="top"`，把验收文字改成「回到首屏顶部（顶栏下方）」。

### 非缺口的两点提醒（不计入计数）

- 阶段三产出后按 `dev-workflow.md:412` 需更新 `docs/PROGRESS.md`，这部分不在 `plan.md` 里，执行时别漏。
- plan 的文档结构（目标 / 步骤清单 / 涉及文件 / 参考源码）与 `dev-workflow.md:373-393` 的格式要求逐项吻合；步骤以表格带「验证检查点」列，合 `dev-workflow.md:403`。

### 最小修订清单（改完可复审）

1. `plan.md` 步骤 7：把「禁用 JS 后点「下载」能跳」换成「真 `<a href>` 无 `onClick`」+「N/A 及理由」，并同步 `S-221.md:65`、`:130`。（对应 ❌ #2）
2. `plan.md:30-33`：换成「`Map` 全量状态 + 每次回调重算」的写法。（⚠️-5）
3. `plan.md §文案表`：来源列 `downloadCta` → `sections/download-cta.tsx:10`；plan:47 结论改「4 照抄 / 2 截短 / 1 自拟」；并决定 7 条文案落在 `site.ts` 的 `sectionRail` 还是明写为硬编码例外。（⚠️-2 / ⚠️-4）
4. `plan.md §参考源码`：增列 `lib/use-active-heading.ts` 与 `components/doc-page.tsx:89-96 / :107-133`，补「不复用」理由，并对齐 `aria-current` 与 `hidden lg:block`。（⚠️-1）
5. `plan.md` 步骤 2/4/5/7：补 `nav aria-label`、`aria-current`、`right-*` 具体值、`motion-reduce:transition-none`，并给未选中不透明度一个不低到 2.5:1 的值或写明取舍。（⚠️-3）
6. `plan.md` 步骤 1：锚点改挂 `App.tsx` 零高元素，或把验收改成「回到首屏顶部」。（⚠️-6）

---

## 四、复审结果（2026-10-23）

**复审方式**：只读，不跑构建、不执行 git、不改任何文件（本节除外）。三步走：① 读本节 §三「最小修订清单」6 条 → ② 读 `plan-s221/plan.md`（v2，154 行，含 §八/§九 两张自称改动表）与 `requirements/S-221.md`（修订版，138 行）→ ③ **不采信 plan 的自述，回到代码逐条验事实**：`App.tsx` 全文、`content/site.ts:78-91/140-159/168-183/212-251`、`lib/use-active-heading.ts` 全文、`components/doc-page.tsx:80-136`、`components/ui.tsx:1-55`、`index.css:12-28/85-104`、`sections/download-cta.tsx:1-20`、`sections/hero.tsx:15-43`、`components/site-header.tsx:11-45`、`index.html`、`src/main.tsx`、`vite.config.ts`。对比度按 WCAG 相对亮度公式现场重算（单次算术脚本，非构建）。

### 修订落实（逐条裁定）

| # | 修订项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 步骤 7「禁 JS 能跳」换可执行目标 | **已落实 ✅** | `plan.md:17`（步骤 3 检查点「真 `<a href>`、无 `onClick`、无 `scrollIntoView`，`grep` 可验」）+ `plan.md:22`（步骤 8 改判 N/A 且「不勾这条」）+ `plan.md:125-132`（§七 保留 CSR 证据链）。需求侧 `S-221.md:65`、`:130` 均已改为 N/A 并写明证据。结论：这条现在可执行、可 grep，不再需要造假或空转 |
| 2 | 联动算法改 `scroll` + `rAF` + 全量重算 | **未落实 ❌** | 模型方向对（见下方走查），但 `plan.md:50` 的 `frame` 在 `compute`（`plan.md:33-48`）里**从不复位** ⇒ 第一次滚动后 `if (!frame)` 永假，高亮冻住。同文件 §五 `plan.md:115` 正是要照抄 `lib/use-active-heading.ts`，而参考实现在 `:21` 有 `let frame = 0`、`:24` 有 `frame = 0` —— 抄漏了最关键的这两行，且漏掉参考实现 `:50` 的首次 `compute()`。详见 §四·A |
| 3 | 文案落 `site.ts` + 来源改 `download-cta.tsx:10` + 「4/2/1」 | **已落实 ✅** | `plan.md:68-77` 的 7 条与真实值逐一对上：`features.title='它能干什么'`（`site.ts:176`）、`advantages.title='为什么是它'`（`:84`）、`quickStart.title='四步开始'`（`:218`）、`faq.title='常见问题'`（`:242`）、`valueLadder.title='不花钱，也能用起来'`（`:150`，截短成立）、`download-cta.tsx:10` `` title={`下载${BRAND.name}`} `` = 「下载心相」（截短成立）、`top` 无 title 字段故自拟。计数「4 照抄 / 2 截短 / 1 自拟」与实际一致。`plan.md:63` 援引 `site.ts:1-2`「改文案只改这里」与 `site.ts:2` 原文一字不差，落点合规 |
| 4 | 参考源码增列两份既有实现 | **已落实 ✅**（附 1 处引用小错，见 ⚠️-新4） | `plan.md:115` 增 `lib/use-active-heading.ts:1-61`、`plan.md:116` 增 `doc-page.tsx:89-96 / :107-133`。核对无虚构：`TOP_LINE = 88`（`use-active-heading.ts:5`）、入参 `articleRef + ids`（`:12-15`）、文末兜底 `:34-37`（plan 写 `:31-37`，同段注释起，可接受）、`aria-current="true"`（`doc-page.tsx:120`）、`hidden lg:block`（`:90`）。「不复用」理由站得住：`TOP_LINE` 是模块级常量、判定绑定 `articleRef` + ids-key，首页要多带一个视口比例参数，确属改公共 hook 的 `/guide` 回归风险 |
| 5 | `nav aria-label` / `aria-current` / `right-*` / `motion-reduce` / 对比度 | **部分落实 ⚠️** | plan 侧五样全在：`plan.md:17`（`nav aria-label="页内导航"`）、`:19`（`aria-current` + `text-ink-950 font-semibold` + 2px accent 竖条 + `text-ink-900/75`）、`:20`（`right-4 xl:right-6`）、`:21`（`motion-reduce:transition-none`）、`§三`表 `:87-91` 逐项给了理由。对比度现场重算亦成立（见下）。**但需求正文 8 行仍是首版口径**（`S-221.md:60/63/70/102/103/109/110/124/128`），未进 §九 同步表 ⇒ 计 ❌-新1 |
| 6 | 锚点搬 `App.tsx` 零高元素 | **已落实 ✅**（需求正文未同步，并入 ❌-新1） | 推导复核成立：`App.tsx:23-25` 是 fragment，`SiteMist` 是 `fixed inset-0`（`App.tsx:19-20` 注释）不吃文档流；`index.css:85-89` 的 `#root` 只有 `display:flex/flex-direction:column/min-height:100vh`、无 `padding`；`body`（`:91-104`）无 `margin`（Tailwind preflight 归零）⇒ 插在 `<SiteMist/>` 与 `<SiteHeader/>` 之间的 `h-0` 块其 `getBoundingClientRect().top === 0`，原生锚点把元素顶对齐到滚动口顶 ⇒ **`scrollY = 0`**。`SiteHeader` 的 `sticky top-0`（`site-header.tsx:23`）虽在流内占 56px，但落点是 `scrollY=0`，与它无关；且此刻 `scrolled=false`（`:15` 阈值 8）⇒ 顶栏回到全透明态，观感正是「页面顶部」 |

### A. 修订 2 的三条路径走查（伪代码逐帧）

```
compute():
  line = innerHeight * 0.3
  if (innerHeight + scrollY >= scrollHeight - 2) -> lastId ; return
  current = rail[0]
  for item of rail: el=byId(item.id); if (!el) continue; if (el.top > line) break; current = item.id
  setActive(current)
onScroll(): if (!frame) frame = rAF(compute)        // ← 缺陷所在
```

- **页顶**：`scrollY=0`，`#top` 的 `top=0`，`0 ≤ line` ⇒ `current='top'` ⇒ ✅（超高视口例外见 ⚠️-新2）。
- **上滚**：每帧全量读几何、无「本次 entries」残影 ⇒ 模型上 ✅ —— **但按 `plan.md:50` 字面实现，第一帧之后 `frame` 永不为 0，`compute` 不再被调度，上滚时高亮停在上次的值**。这条修订要救的正是上滚路径（首轮 ⚠️-5），照抄后依然砸在步骤 4 的检查点「上滚 / 回顶 / 滚到底三条路径高亮均正确」上 ⇒ ❌。
- **滚到底**：最大 `scrollY = scrollHeight − innerHeight` ⇒ 左式 = `scrollHeight`，恒 ≥ `scrollHeight − 2`；2px 余量吸收亚像素取整（`scrollY` 可为小数、`scrollHeight` 取整）。这与 `use-active-heading.ts:34` 生产在跑的是同一行同一阈值 ⇒ **-2 够用** ✅。

附带两处不自洽（同一处来源）：`plan.md:37` 用了未定义的 `lastId`；`plan.md:40-41` 用 `SECTION_RAIL`，而 §二 `plan.md:68` 定义的是 `sectionRail`。加上 `frame`/`useState` 缺失，说明这段没经过 `tsc`，是手抄参考实现的残件。

### 对比度重算（WCAG 2.x 相对亮度，非沿用 plan 数字）

公式：通道归一化 `c/255` → `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`；`L = 0.2126R + 0.7152G + 0.0722B`；`ratio = (L_hi+0.05)/(L_lo+0.05)`。半透明前景按 `c = α·fg + (1−α)·bg` 与白底 `#FFFFFF`（`index.css:17` `--color-paper`）合成。

| 场景（真实 token，`index.css:13/14/19`） | 合成色 | L | 对比度 | plan 自述 | 判定 |
|---|---|---|---|---|---|
| 未选中 `ink-900/75`（#33373f 压 75%） | #66696F | 0.1408 | **5.50:1** | ≈4.5 | 低估、达标（AA 4.5） |
| 未选中 `ink-900/45`（首版，首轮判 2.5） | #A3A5A9 | 0.3604 | 2.47:1 | — | 与首轮 2.5 一致，首轮判断无误 |
| 选中 `ink-950`（#1b1e24） | #1B1E24 | 0.0131 | **16.70:1** | ≈13 | 低估、达标 |
| 2px 竖条 `accent`（#ea580c） | #EA580C | 0.2451 | 3.56:1 | ≈3.6 | 准；非文本图形按 1.4.11 需 3:1，通过 |
| `ink-900/75` 压在灰面板 `ink-800`（#f6f7f9）上 | #63666C | — | 5.28:1 | — | 仍达标 |
| `ink-950` 压灰面板上 | — | — | 15.58:1 | — | 达标 |

结论：三处数字**都往保守方向低估**，没有吹牛；唯一措辞建议是把「≈4.5:1」改成「≥5.5:1（白底）/ ≥5.2:1（灰面板）」，否则执行者会误以为刚好压线而去无谓调色。

### B. 新发现问题

#### ❌-新1 需求正文与修订后的 plan 有 9 行实质冲突，§九「需求侧同步订正」只列了 4 项

`plan.md:145-152` 的 §九 只订正 `S-221.md:65/66/130/84`（这 4 项确已改），但修订 2/5/6 改了实现口径，需求正文**一行没跟**：

| 位置 | 需求正文现行文 | 修订后 plan |
|---|---|---|
| `S-221.md:63`（§4.2 联动） | 「`IntersectionObserver` 观察各 `<section>`…用 observer 而非 `scroll` 事件」 | §一 已**推翻** observer，改 `scroll`+`rAF` |
| `S-221.md:102`（§5.2 自决） | 「observer 判定用「视口上部 30% 内最靠上的 section」」 | 同上 |
| `S-221.md:109-110`（§6 代价） | 整条「`IntersectionObserver` 的判定边界会抖」「用 observer 而非 `scroll` 事件，避免每次滚动触发布局计算」 | 该代价条目已不成立，且与 plan:59 的结论相反 |
| `S-221.md:60`（§4.2 形态） | 未选中 `text-ink-900/45`、选中 `text-accent`、**左侧**一道竖线 | 未选中 `/75`、选中 `text-ink-950`、**右侧** 2px 竖条 |
| `S-221.md:103`（§5.2 第 4 条） | 「未选中项降到 45% 不透明度」 | 已废，且 45% 正是首轮判 2.5:1 的元凶 |
| `S-221.md:124`（§8 第 1 行） | 「「概览」为当前项（**品牌色**加粗）」 | plan 明确「`text-accent` 仅 3.6:1 不达 AA，改由深色文字承担对比度」⇒ 用品牌色就是验收不过 |
| `S-221.md:128`（§8 第 5 行） | hover「整条升到 100% 不透明度」 | hover 升 `text-ink-950`（100% 的 ink-900 是 #33373f，不是 ink-950） |
| `S-221.md:70`（§4.3） | 「Hero…加 `id="top"`」 | 步骤 1 把锚点搬到 `App.tsx`，`hero.tsx` 零改动 |

**为什么必须阻断**：`plan.md:25` 把验收指向 `S-221.md §8` 九条；而 §8 第 1 行现在要「品牌色加粗」—— 按 plan 实现必然不过，按需求实现则对比度回到 3.6:1。同一份 plan 里，步骤 1 的检查点写「`hero.tsx` 零改动」，需求 §4.3 却要求改 `hero.tsx`，阶段六两边必有一边判错。
**改法**：在 `plan.md` §九 表补 8 行（`S-221.md:60`、`:63`、`:70`、`:102`、`:103`、`:109-110`（2 行）、`:124`、`:128`），并顺手把 `S-221.md` §5.2 第 3/4 条的「自决」记录改为「推翻，理由：上滚状态残影 / 45% 仅 2.47:1」。

#### ⚠️-新2 超高视口下「页顶」会选中第二项

`line = 0.3 × innerHeight`。`hero.tsx:22` 的 Hero 高度估算：`sm:pt-36`(144) + 眉标 ~20 + 标题 52px×1.15 ≈ 60 + 副标题 `mt-5`+~28 + CTA `mt-9`+~48 + `pb-16`(64) ≈ **430~450px**。当 `innerHeight > ~1450px`（4K 全屏 ≈2020~2160、1440p 全屏临界）时 `line > 450` ⇒ `value-ladder` 的 `top` 也 ≤ `line`，循环会把 `current` 推成 `'value-ladder'` ⇒ 首屏高亮「不花钱」而不是「概览」，同时砸 §8 第 1 行和「点「概览」回顶」第 4 行。
**改法**（一行，放在 `compute` 最前、早于文末兜底）：

```ts
if (window.scrollY <= 8) { setActive(SECTION_RAIL[0].id); return }
```

#### ⚠️-新3 步骤 6 的定位依据缺 `writing-mode`，检查点可能过不了

`plan.md:70` 用「原文『不花钱，也能用起来』**10 字竖排过高**」论证截短，`plan.md:90` 又用「竖排条宽约**一字宽**」论证 1024–1280 只重叠 ≤ 一列 —— 两句都预设了「字符逐字竖叠」（`[writing-mode:vertical-rl]`），但步骤 3/6 与 §三表**都没写这个属性**。若执行者按 `flex flex-col`（每项横排、纵向堆叠）实现，条宽 = 最长标签 5 字 × 12px ≈ 60px，1024px 下正文右缘 x≈968（1024 − `px-14` 56，`ui.tsx:47`），条左缘 ≈ 1024 − 16 − 60 = 948 ⇒ 压进正文 20px，**超过检查点允许的「一列字宽 12px」**。
**改法**：步骤 6 的类名串补 `[writing-mode:vertical-rl]`（Tailwind 任意属性，不新增 CSS，仍合 `plan.md:107`），检查点写成「条宽 = 1 字宽」。

#### ⚠️-新4 `plan.md:117` 引用的清理写法在 `ui.tsx` 里不存在

`plan.md:117` 写「`components/ui.tsx:5-33` → 复用清理模式（`cancelAnimationFrame` + 双 `removeEventListener`）」。实际 `ui.tsx:5-33` 是 `Reveal`，清理只有 `clearTimeout(failsafe)` + `io.disconnect()`（`ui.tsx:23-26`），**没有** `cancelAnimationFrame`；要照抄的那套在 `lib/use-active-heading.ts:53-57`（`cancelAnimationFrame` + 两个 `removeEventListener`，正好也是 rAF 模型）。改法：该行来源改 `lib/use-active-heading.ts:53-57`（与 `plan.md:115` 合并亦可），否则执行者照 `ui.tsx` 抄会漏掉 `cancelAnimationFrame`。

#### ⚠️-新5 步骤 5 漏了字号 `text-xs`，AA 门槛因此没钉死

需求 §4.2（`S-221.md:66`）定了「字号 `text-xs`」，步骤 5（`plan.md:19`）只写颜色与字重。WCAG 的 4.5:1 门槛取决于字号（≥24px 或 ≥18.66px 粗体才降到 3:1），把字号写进类名串（`text-xs`）才能让「≈4.5:1 达标」的结论有确定前提。不算阻断，但建议补上。

### 复审结论计数

**❌ 2 / ⚠️ 4 / ✅ 6**

- ❌ 2：修订 2 未落实（`frame` 不复位，上滚路径仍错）；需求正文 9 行未同步（❌-新1）
- ⚠️ 4：超高视口页顶选错（新2）、缺 `writing-mode`（新3）、清理写法引用错源（新4）、缺 `text-xs`（新5）
- ✅ 6：修订 1、修订 3、修订 4、修订 6 四条已落实；CSR 证据链（`index.html:15-16`、`main.tsx:6-10`、`vite.config.ts:36`）经复核全部为真；对比度重算证明 plan 数字方向保守、无虚抬

### 复审判定

**继续阻断**。

按 `docs/dev-workflow.md:414`，❌ > 0 禁止进入用户确认。本轮两处 ❌ 都是「改几行就能过」的量级，建议下一版只动四处，不要再扩大：

1. `plan.md:33-52` 的代码块：`let frame = 0` + `compute` 首行 `frame = 0` + 末尾补 `compute()` 首帧调用 + `const [active, setActive] = useState(SECTION_RAIL[0].id)`，并在 `scrollY <= 8` 时直接选首项（顺带解决 ⚠️-新2）；把 `SECTION_RAIL`/`lastId` 统一成 `sectionRail`/`sectionRail.at(-1)!.id`。
2. `plan.md` §九 表补齐 `S-221.md:60/63/70/102/103/109-110/124/128` 八处，并真的改到需求正文（尤其 §8 第 1 行的「品牌色」和 §4.3 的「Hero 加 id」，不然后面两阶段自相矛盾）。
3. `plan.md` 步骤 6 补 `[writing-mode:vertical-rl]` 并写进检查点。
4. `plan.md:117` 来源改 `lib/use-active-heading.ts:53-57`；步骤 5 补 `text-xs`。

改完后无需重跑全量审查，只需核这四处 + 需求正文是否真改到位。

---

## 五、第三轮复审结果（2026-10-23）

**复审方式**：只读。未跑构建、未执行 git、未改任何代码文件（本节例外）。四步：① 读 §四 的四个待办（❌-2 / ❌-新1 / ⚠️-新2 / 新3 / 新4 / 新5）；② 通读 `plan-s221/plan.md`（v3，193 行，§一 伪代码整段逐行照抄式走查）+ `requirements/S-221.md`（现行全文 138 行）；③ **不采信 plan 自述**，回代码验事实：`use-active-heading.ts` 全文、`ui.tsx` 全文、`App.tsx` 全文、`hero.tsx` 全文、`value-ladder.tsx` 全文、`features.tsx:95-169`、`download-cta.tsx:1-30`、`site.ts:1-80/84/150/176/218/242`、`index.css:1-40/拆 395-488`、`site-header.tsx:11-50`、`site-mist.tsx`、`doc-page.tsx:85-135`、`index.html`、`main.tsx`、`vite.config.ts:25-49`；④ 单次算术：`index.css` 行数（699）、对比度（5.503 / 16.70 / 3.556 复算）、grep `scroll-padding`（0 命中）、grep `id="top"`（0 命中）、`components/` 下无 `section-rail.tsx`。

### A. 前轮 6 项落实裁定

| # | 前轮项 | 结论 | 证据 |
|---|---|---|---|
| 1 | ❌-2 `frame` 无声明 / 无复位 / 无首帧 | **已落实 ✅** | `plan.md:35` `let frame = 0`、`plan.md:38` `compute` 首行 `frame = 0`、`plan.md:65` 挂载 `compute()`；`plan.md:18` 把这三条单列进步骤 4 检查点。命名同步收敛：全文只剩 `sectionRail`（`plan.md:32/33/54/95/128`），`SECTION_RAIL` 已消失，`lastId` 改为 `plan.md:33` 的 `sectionRail[sectionRail.length - 1].id` 定义式 —— 无未定义符号 |
| 2 | ❌-新1 需求正文 8 行未同步 | **已落实 ✅** | §九 现 13 行（`plan.md:181-193`），逐行回读需求正文全部已改：`:60` 形态（`/75`+`ink-950`+右侧竖条）、`:63` 联动（scroll+rAF+页顶短路/页底兜底）、`:65` N/A、`:66` `ui.tsx:47`、`:70` `App.tsx` 锚点、`:102` 30%/420 上限+短路+兜底、`:103` `/75`≈5.50、`:107-110` 无 observer 口径、`:118` rAF 足够、`:124` `ink-950` 加粗+竖条、`:128` hover 升 `ink-950`、`:130` 真 `<a>`+N/A、`:83` 四步开始。全文 grep `IntersectionObserver` 仅剩 `:63`/`:110` 两处**说明为何不用**的句子；grep `/45`、`45%`、`快速上手` 均 0 命中 |
| 3 | ⚠️-新2 超高视口页顶选第二项 | **已落实 ✅** | 双保险：`plan.md:47` `Math.min(innerHeight*0.3, 420)` + `plan.md:42` `scrollY <= 0` 短路。Hero 静态高度 ≈ **491px**（`hero.tsx:22` `sm:pt-36`144 + 眉标 32 + h1 60 + 副标题 107 + CTA 84 + `pb-16`64）⇒ 2160px 视口下 line=420 < 491，页顶即使不靠短路也选中 `top`（见 C·路径 4） |
| 4 | ⚠️-新3 缺 `[writing-mode:vertical-rl]` | **已落实 ✅** | `plan.md:20` 步骤 6 类名串首项；`S-221.md:60` 同步；§八 第 10 行（`plan.md:174`）登记 |
| 5 | ⚠️-新4 清理写法引错源 | **已落实 ✅** | `plan.md:145` 改引 `lib/use-active-heading.ts:53-57`，并显式写「**不是** `ui.tsx` —— 那里只有 `clearTimeout` 与 `io.disconnect()`，没有 rAF」；`plan.md:69` 伪代码注释同源。核对 `ui.tsx:23-26` 确只有 `clearTimeout` + `io.disconnect()`，`use-active-heading.ts:53-57` 确有 `cancelAnimationFrame` + 两个 `removeEventListener` |
| 6 | ⚠️-新5 步骤 5 漏 `text-xs` | **已落实 ✅** | `plan.md:19` 类名串含 `text-xs`，检查点补「`text-xs` 不降门槛」；`S-221.md:60`、`:66` 一致 |

**另外补核（前轮要求、本轮新查）：`use-active-heading.ts` 四个关键行真实存在且描述属实** —— `:21` `let frame = 0`、`:24` `frame = 0`（`compute` 首行）、`:50` `compute()`（挂载首帧）、`:53-57` 清理块，与 `plan.md:76` 的「声明（`:21`）/复位（`:24`）/首帧（`:50`）」逐字对得上；`TOP_LINE = 88` 在 `:5`，`articleRef + ids` 入参在 `:12-15`，文末兜底在 `:34-37`（plan 写 `:31-37` 含注释起，可接受）。

### B. 需求正文 × 是否同步（全表，含未进 §九 的行）

| 需求行 | 原口径（首版） | 现行文（2026-10-23 实读） | 与 plan 一致？ |
|---|---|---|---|
| `:27` | Hero 无 id，`hero.tsx:22` | 同 | ✅（`hero.tsx:22` 确为裸 `<section className="relative isolate pt-28 pb-16 sm:pt-36">`，无 id、无 `scroll-mt-24`） |
| `:28-33` | 六个既有锚点行号 | 同 | ✅ 逐个核实：`value-ladder.tsx:12` / `features.tsx:102` / `advantages.tsx:9` / `download-cta.tsx:10` / `quick-start.tsx:65` / `faq.tsx:6` 全中 |
| `:38` | `ui.tsx:47` 的 `Section` 带 `scroll-mt-24` | 同（**未改**） | ⚠️ 事实错：`scroll-mt-24` 在 `ui.tsx:45`，`:47` 是内容容器 `px-6 sm:px-10 lg:px-14`。§九 只订正了 `:66` 同类错误，漏了 `:38`（见 ⚠️-新5②） |
| `:43` | 顶栏渲染 `site.ts:73` 的 `nav` | 同 | ✅（`site.ts:73` `export const nav`，`site-header.tsx:35-45` 渲染） |
| `:51`/`:53` | 挂 `App.tsx` `<main>` 之后、与 `SiteMist` 同级；两页不挂 | 同 | ✅（`App.tsx:24` `SiteMist`、`:26-34` `main`，同属一个 fragment，层级成立） |
| `:59` | `fixed right-*`、垂直居中、`z-40` | 同 | ✅（plan `right-4 xl:right-6`、`top-1/2 -translate-y-1/2`、`z-40` < 顶栏 `z-50`） |
| `:60` | `/45` + `text-accent` + 左侧竖线 | **已改**：`[writing-mode:vertical-rl]`+`text-xs`+`/75`+`ink-950`+右侧 2px accent | ✅ 与 plan 步骤 5/6 逐项同 |
| `:61` | 品牌色加粗 + 竖条 | 深色加粗 + 竖条，并写明品牌色 3.6:1 不达 AA | ✅ |
| `:62` | `<a href="#{id}">` | 同 | ✅ |
| `:63` | observer 观察各 section | **已改**：scroll(passive)+rAF 全量重算 + 页顶短路/页底兜底 + 不用 observer 的理由（上滚残影） | ✅ |
| `:64` | `lg` 以下 hidden | 同 | ✅ |
| `:65` | 「禁 JS 也能跳，只是不高亮」 | **已改**：N/A + CSR 证据链 + 真意 | ✅ |
| `:66` | 全宽铺满见 `ui.tsx:50` | **已改**：`ui.tsx:47`、`/75`、`text-xs`、hover `ink-950` | ✅ |
| `:70` | `sections/hero.tsx:22` 加 `id="top"` | **已改**：`App.tsx` 零高 span | ⚠️ 结论一致，**理由不实**：Hero 不是 `Section`、无 `scroll-mt-24`，「挂 hero 会被停在 96px」不成立（见 ⚠️-新5①） |
| `:74-86` | 7 项文案 | 同（4 照抄/2 截短/1 自拟 + 落点 `site.ts` 的 `sectionRail`） | ✅ 逐值核实：`site.ts:176`「它能干什么」、`:84`「为什么是它」、`:218`「四步开始」、`:242`「常见问题」、`:150`「不花钱，也能用起来」、`download-cta.tsx:10` `下载${BRAND.name}` |
| `:100-103` | §5.2 四条自决 | **已改**：30%/420 上限、线以上最后一个、页顶短路+页底兜底、`/75`≈5.50 | ✅ |
| `:107-110` | §6 代价（observer 会抖 / 避免布局计算） | **已改**：留「判定边界会抖」为题、下文改为「阈值线以上最后一个」；`:110` 改为同帧批量读 | ✅（`：109` 的标题略含糊，但正文与 plan 同向，不构成冲突） |
| `:118` | `observer` + 原生锚点足够 | **已改**：原生锚点 + 一次 rAF 合并的 scroll | ✅ |
| `:124` | §8-1 品牌色加粗 | **已改**：`ink-950` 加粗 + accent 竖条 | ✅（不再是「按 plan 实现过不了验收」） |
| `:125`/`:126`/`:127` | §8-2/3/4 | 未变 | ✅（`#download` 落点有 `scroll-mt-24` 96px > 顶栏 56px，不会被遮） |
| `:128` | §8-5 整条升到 100% 不透明度 | **已改**：升到 `text-ink-950` | ✅ |
| `:129` | §8-6 1024px 以下不出现 | 未变 | ✅ |
| `:130` | §8-7 禁 JS 仍可点击 | **已改**：真 `<a>` + N/A | ✅ |
| `:131` | §8-8 reduced-motion 不做过渡动画 | 未变 | 口径收窄差异（非冲突，见 ⚠️-新6 备注） |
| `:132` | §8-9 三页遍历 | 未变 | ✅ |

**结论：全文已无与 plan 冲突的实质口径**（上一轮 9 处全部消化，未出现「改了半句反而更冲突」的情况）。剩余两处是需求自身的**事实/行号错**（`:38`、`:70` 的理由），改法与实现无关。

### C. 伪代码逐行走查（`plan.md:29-74`，按跑代码给中间值）

静态几何（≥sm、≥lg 宽，无法跑 DOM，取结构估算）：Hero `0 → ≈491`、`value-ladder` `≈491 → ≈684`（`value-ladder.tsx:12` 无 `pt`、`pb-5`=20，卡片 `px-8 py-7`56 + 标题行 28 + `mt-6`24 + 三列 63 ≈ 171）、`features` 顶 `≈684`，页脚 ≈209px（`use-active-heading.ts:31-32` 同站实测注释）。

**路径 1 · 页顶（innerHeight=1080）**：`scrollY=0` → `plan.md:42` 短路 → `setActive('top')`，`return`。**把短路摘掉复算一遍**：`line = min(324,420) = 324`；`#top` 的 `top = 0 ≤ 324` ⇒ `current='top'`；`value-ladder` `top=491 > 324` ⇒ `break` ⇒ 仍为 `'top'`。⇒ 短路与主算法**同向**，不是掩盖 bug 的补丁。✔

**路径 2 · 上滚（从 scrollY=1400 回到 900）**：`1400`：line=324，`advantages` `top=1354−1400=−46 ≤ 324` ⇒ `current='advantages'`，下一块 >324 ⇒ `break` ⇒ 高亮 advantages。`1100`：`advantages` `top=254 ≤324` ⇒ advantages。`900`：`advantages` `top=454 > 324` ⇒ `break`，停在 `features`（`684−900=−216`）⇒ 高亮 features。**每一帧全量重读几何，无 entries 残影** ✔。帧调度：scroll 事件 `if (!frame)`（`plan.md:63`）→ `frame` 变成非 0 的 rAF id → 排队；`compute` 首行 `frame = 0`（`plan.md:38`）→ 下一事件可再排 ⇒ **不会冻在首帧**（这正是上一轮 ❌-2，已修好）。✔

**路径 3 · 滚到底**：`scrollY` 最大 = `scrollHeight − innerHeight` ⇒ 左式 `innerHeight + scrollY = scrollHeight ≥ scrollHeight − 2` 恒真 ⇒ `setActive('faq')`（`plan.md:49-51`）✔。2px 余量对亚像素取整够用（与 `use-active-heading.ts:34` 生产同款同阈值）。**两条 return 的先后无冲突**：底部时 `scrollY` 恒 > 0，不会先命中 `scrollY <= 0`；反过来「页高 ≤ 视口」时才可能两条都命中，首页长页不适用。✔

**路径 4 · 4K 视口（innerHeight=2160）**：页顶 → 短路 `'top'`；**抽掉短路复算**：`line = min(648, 420) = 420`；`#top` `0 ≤ 420` ⇒ `current='top'`；`value-ladder` `top=491 > 420` ⇒ `break` ⇒ `'top'` ✔（余量 71px）。`scrollY=100`：`value-ladder` `top=391 ≤420` ⇒ `'value-ladder'`，`features` `584 > 420` ⇒ 停在此。⇒ 4K 上只要滚过 ≈71px 高亮就从「概览」切到「不花钱」。这是 `LINE_MAX=420` 的设计后果（语义仍是「线以上最后一个」），**不砸验收**（§8-1 只测加载、§8-4 落点是 0），但要知道 420 与 Hero 491 只剩 71px 余量：Hero 文案若被删减到 <420，页顶就会选第二项 —— `scrollY <= 0` 短路兜的正是这一手，两条都要留。✔

**路径 5 · 卸载清理**：`frame` 有挂起 → `cancelAnimationFrame`（`plan.md:70`）；`scroll` + `resize` 两个监听都注销（`:71-72`）；`main.tsx:6-10` 是 `StrictMode`，dev 双挂载时第一轮 cleanup 已全部注销、第二轮重挂，不会双计 ✔。**前提**：`let frame` 必须落在 `useEffect` 内（参考实现 `:19-58`）。plan 的片段把 `let frame = 0` 与 effect 体同缩进、末尾又给了 `return`，可读作 effect 内；若被落到组件体，则每次渲染重置 + 监听重复注册（见 ⚠️-新1②）。

**结论**：本段已无「编译通过但运行失效」的漏洞。所有剩余缺口都属**tsc 能抓**（`setActive` 未声明）或**步骤 6 检查点能抓**（竖排堆叠轴）的量级。

### D. 新发现问题（6 项，均不阻断）

**⚠️-新1 伪代码仍不能原样落地（三小点，全部 tsc 可抓）**
① 全文 grep `useState` **0 命中** —— 片段用 `setActive` 却没声明 `const [active, setActive] = useState(firstId)`（上一轮第 1 条建议里的第 4 小项，未落实）；② 没显式写 `useEffect(() => { ... }, [])` 边界，`let frame` 的落点靠读者猜（见走查路径 5）；③ 若实施者按 `site.ts` 既有习惯给 `sectionRail` 加 `as const`（`site.ts:13/31/43` 三处都这么写），`let current = firstId` 会被收窄成字面量 `'top'`，`current = item.id` 触发 TS2322。
→ 改法（三行）：`const [active, setActive] = useState(sectionRail[0].id)`、片段首行补 `useEffect(() => {`、`let current: string = firstId`。

**⚠️-新2 竖排列表项的堆叠轴没定，这是本轮最可能返工的一处**
`plan.md:20` 把 `[writing-mode:vertical-rl]` 挂在 `nav` 上，但 plan/需求**都没写 `<ul>`/`<li>` 的布局**（grep `flex`/`grid` 在两份文档里 0 命中）。vertical-rl 下**块流方向是右→左**：裸 `<li>` 会排成 7 列「书脊」，条宽 ≈ 7×(text-xs 行高 16px) + gap ≈ 100~120px；`right-4`(16) 下左缘 ≈ 1024−16−110 ≈ 898，正文右缘 968 ⇒ **压进正文 ≈70px ≈ 5 字宽**，步骤 6 检查点「重叠 ≤ 一列字宽」当场挂（即：不会静默上线，但会返工一次）。要堆成从上到下，必须显式 `flex`（vertical 下 row 轴 = inline 轴 = 上→下）或 `grid grid-flow-col`。
→ 改法：步骤 6 补「`ul` 用 `flex`（**不要 `flex-col`**，竖排下 `flex-col` 走块轴 = 右→左）」，检查点写成「条宽 = 1 字宽（≈16px）」。

**⚠️-新3 `LINE_MAX = 420` 的依据不实（取值仍成立）**
`plan.md:78` 称「首页各板块高度在 600~900 之间」。实测结构：`value-ladder` ≈ **193px**（`value-ladder.tsx:12` 无 top padding + `pb-5`，卡片 `px-8 py-7`），Hero ≈ **491px**（`hero.tsx:22`）。真正决定 420 上限的是**首块**高度（Hero），不是「各板块 600~900」；而 420 与 491 只差 71px，这个余量应当写明。
→ 改法：`plan.md:78` 改成「Hero ≈490px 是首块，`LINE_MAX` 必须明显小于它（420 留 71px 余量）；其余板块 600~900，value-ladder 是 ≈195px 的窄带」。

**⚠️-新4 §九 行号漂移 + §八 计数不实**
① §九 第 13 行（`plan.md:193`）引 `S-221.md:84`「快速上手→四步开始」，但正文该行已漂到 **`:83`**（`:84` 现在是 `faq` 行）——改动本身做了，引用指错了行。② §八 第 8 行（`plan.md:172`）称「§九 扩到 **9** 处」，实际 §九 有 **13 行**（`:181-193`）。
→ 改法：`:84` → `:83`；「9 处」→「13 处」。**其余 §八 11 行逐条核过，无「声称改了而正文没改」的情况。**

**⚠️-新5 需求正文两处事实错误（与 plan 无冲突，但会被后续引用）**
① `S-221.md:70`「挂在 hero 上则会被 `Section` 的 `scroll-mt-24` 停在 96px 处」—— Hero **不是** `Section`（`ui.tsx:37-60`），`hero.tsx:22` 也没有 `scroll-mt-24`，挂 hero 上同样是 `scrollY = 0`。结论（改用 `App.tsx` 零高锚点）不受影响，但理由不成立。② `S-221.md:38` 把 `scroll-mt-24` 指到 `ui.tsx:47`，实际在 `:45`（`:47` 才是 `px-6 sm:px-10 lg:px-14` 容器）；§九 只订正了 `:66`，漏了 `:38`。
→ 改法：`:70` 理由改成「Hero 是裸 `<section>`、没有 `scroll-mt`，挂它落点同样是 0，但把锚点放在 `App.tsx` 能保证它先于任何区块、且不动 `hero.tsx`」；`:38` 改 `ui.tsx:45`。

**⚠️-新6 步骤 5 检查点的色值写错（比值对）**
`plan.md:19` 写「未选中 `#1a1a1a`@75% ≈ 5.50:1」。站点 token 里没有 `#1a1a1a`：`ink-900 = #33373f`（`index.css:14`）、`ink-950 = #1b1e24`（`:13`）。`#33373f` 压 75% 叠白底 = `#66696F`，L=0.1408 ⇒ **5.503:1**（我复算，与 plan 数字一致）；而 `#1a1a1a`@75% 会算到 ≈7.4:1，对不上。比值正确、色值写错 ⇒ 验收时按元素取色会取到 `#33373f`，与检查点的 hex 不一致，容易误判「不达标」。
→ 改法：`#1a1a1a` → `#33373f`（或直接写 `text-ink-900/75`）。
备注（不计入计数）：`S-221.md:131` §8-8 只写「不做过渡动画」，而 plan §三（`plan.md:118`）明确「组件用 `transition-colors` + `motion-reduce:transition-none`，但全局 `html{scroll-behavior:smooth}`（`index.css:24-25`）本需求不动」。二者在 reduced-motion 下一致（`motion-reduce:` 关掉过渡），但需求侧缺这半句限定，建议补「平滑滚动沿用现有全局行为」。

### E. 复核为真的事实清单（供后续引用，不必重查）

`use-active-heading.ts:21/24/50/53-57`（前轮四行）｜`site.ts:84/150/176/218/242` 五条标题原文｜`download-cta.tsx:10` `` title={`下载${BRAND.name}`} ``｜`ui.tsx:45` `scroll-mt-24`、`:47` `px-6 sm:px-10 lg:px-14`（lg 右内边距 56px）｜`index.css:24-25` `html{scroll-behavior:smooth}`、`:12-22` 全部 token、`:434-437` `.site-mist{position:fixed;inset:0;z-index:-11}`、行数 **699**｜`vite.config.ts:36` `appType:'mpa'`｜`index.html:15-16`｜`main.tsx:6-10`（含 `StrictMode`）｜`site-header.tsx:15` 阈值 8、`:23` `sticky top-0 z-50`、`:27` `h-14`｜`doc-page.tsx:90` `nav aria-label="目录"` + `hidden lg:block`、`:120` `aria-current`｜七个板块锚点行号全部命中｜`App.tsx:24/25/26-34` 层级｜全站无 `scroll-padding`（0 命中）｜全站无既有 `id="top"`（0 命中）｜`components/` 下无 `section-rail.tsx`（确为新增）。

### F. 复审结论计数

**❌ 0 / ⚠️ 6 / ✅ 11**

- **❌ 0**：上一轮两处 ❌（`frame` 不复位导致高亮冻住；需求正文 9 行未同步）均已落实，且不是「纸上改字」—— `frame` 三要素在伪代码与检查点双落，需求 13 行逐行读回原文确认。
- **⚠️ 6**：新1 伪代码缺 `useState`/`useEffect` 边界/`current` 类型（tsc 可抓）；新2 竖排堆叠轴未定（检查点可抓，最可能返工）；新3 `LINE_MAX` 依据不实；新4 §九 `:84` 行号漂移 + §八 计数 9/13；新5 需求 `:38`/`:70` 两处事实错；新6 步骤 5 色值写错（比值对）。
- **✅ 11**：前轮 6 项全部落实；`use-active-heading.ts` 四个关键行真实且与 plan 描述逐字一致；需求正文已无实质冲突（上一轮 9 处全消化）；锚点落点 = `scrollY 0` 的推导成立（`SiteMist` fixed 不吃流 / `#root` 无 padding / 无 `scroll-padding` / `#top` 唯一）；对比度 5.50 / 16.70 / 3.56 复算与 plan 一致且方向保守；伪代码五条路径（页顶 / 上滚 / 滚到底 / 4K / 清理）无静默失效。

### G. 复审判定

**可进入阶段四。**

依据：`docs/dev-workflow.md:414` 的阻断条件是 ❌ > 0，本轮为 0；6 项 ⚠️ 逐条看都是「一句话补上」的量级，且**没有一项会导致静默错上线**——新1 由 `tsc --noEmit`（步骤 10 门禁）当场拦，新2 由步骤 6 的「重叠 ≤ 一列字宽」当场拦，新3/4/5/6 只是文档口径与引用。

但**建议不要在阶段四边做边发现**，总共 7 行改动，先补进 plan 再开工（按性价比排序）：

1. **新2（最值钱）**：步骤 6 补「`ul` 用 `flex`，不要 `flex-col`」+ 检查点「条宽 = 1 字宽（≈16px）」。（1 行）
2. **新1**：伪代码补 `const [active, setActive] = useState(sectionRail[0].id)`、`useEffect(() => {` 开头、`let current: string = firstId`。（3 行）
3. **新4**：§九 `:84` → `:83`；§八「9 处」→「13 处」。（2 处字面）
4. **新3 / 新6**：`plan.md:78` 的 Hero 491 vs 420 余量改写；`plan.md:19` `#1a1a1a` → `#33373f`。（2 处字面）
5. **新5**：需求 `:38` → `ui.tsx:45`、`:70` 换掉「hero 被 `scroll-mt-24` 停 96px」的理由。（可留到实施时顺手改，不影响 plan 执行）
