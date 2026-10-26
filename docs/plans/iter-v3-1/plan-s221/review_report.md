# S-221 阶段五独立审查报告

> 审查人：独立 reviewer（只读）
> 审查时间：2026-10-23 11:14 起
> 对象：需求 `docs/plans/iter-v3-1/requirements/S-221.md`、方案 `plan-s221/plan.md`（v3）、实施产物 3 个文件
> 依据：`docs/dev-workflow.md:465-481`（阶段五五项 + ❌>0 阻断）

**结论计数：❌ 0 / ⚠️ 6 / ✅ 18**
**判定：可进入阶段六**（见 §四）

---

## 一、审查范围与方法

### 1.1 读过的文件（全文或指定区间）

| 类别 | 文件 | 读法 |
|---|---|---|
| 流程规范 | `docs/dev-workflow.md` | `:300-529`（阶段四/五/六 + 阻断规则 + 编码约定 `:618`） |
| 需求 | `docs/plans/iter-v3-1/requirements/S-221.md` | 全文 138 行 |
| 方案 | `docs/plans/iter-v3-1/plan-s221/plan.md` | 全文 225 行（含 §十 竖排堆叠轴） |
| 合规 | `docs/plans/iter-v3-1/plan-s221/compliance_report.md` | 全文（第三轮 ❌0 / ⚠️6） |
| 实施 | `website/src/components/section-rail.tsx` | 全文 100 行 |
| 实施 | `website/src/content/site.ts` | `:1-120` + 全部 `title` 命中行 |
| 实施 | `website/src/App.tsx` | 全文 44 行 |
| 参照 | `website/src/components/ui.tsx` | `:1-70` |
| 参照 | `website/src/components/site-header.tsx` | 全文 56 行 |
| 参照 | `website/src/sections/hero.tsx` | `:1-43` |
| 参照 | `website/src/sections/site-footer.tsx` | 全文 50 行 |
| 参照 | `website/src/index.css` | `:1-30`、`:434-453`、`prefers-reduced-motion` 四处命中、`#root`/`body` |
| 参照 | `website/src/main.tsx` / `guide-main.tsx` / `download-main.tsx` | 全文 |
| 参照 | 7 个板块的 `id` 与容器类 | `grep 'id="'` 全量命中 |

### 1.2 跑过的命令（实测，非自述）

| 命令 | 结果 |
|---|---|
| `cd website; npm run build` | **exit 0**；`tsc --noEmit` 0 错误；`vite build` **299 modules transformed**、built in **285ms**（任务书记 337ms，仅耗时差异） |
| `git status --porcelain` / `git diff` | 工作区改动仅：`website/src/App.tsx`(+6)、`website/src/content/site.ts`(+15)、`?? website/src/components/section-rail.tsx`；**`hero.tsx`、`index.css`、`package.json` 均未出现** |
| `git diff -- website/src/App.tsx website/src/content/site.ts` | 逐行看过，见 §二 #13/#14/#16 |
| 字节级检查（PowerShell `ReadAllBytes`/`ReadAllLines`） | BOM 全 False；行数 `section-rail.tsx=100`、`App.tsx=44`、`site.ts=298`、`hero.tsx=43`、`index.css=699` |
| `dist/assets/*.css` 正则检索 | 确认 `writing-mode:vertical-rl` **真的被 Tailwind 产出**（不是被 purge 的无效类） |
| `git check-ignore -v website/dist` | `.gitignore:21 dist/` ⇒ 构建产物不进版本库，复跑不改动仓库状态 |

### 1.3 方法与边界

- **不做的事**：未起 dev server、未开浏览器、未截图、未改任何源码、未做任何 git 写操作（`commit`/`add`/`reset` 全未执行）。本文件是唯一写出的产物。
- 因此「真机观感」（plan 步骤 11、验收 §8 的 hover 手感 / 平滑滚动 / 1024px 两侧截图）本报告**不认领**，一律留阶段六。
- 凡涉及视口几何的结论都标了 **静态推演**（按类名换算 px，无 DOM 实测）；凡跑过的标 **实测**。两者不混写。

---

## 二、逐项核对结果

| # | 检查项 | 结论 | 证据（文件:行）+ 实测/推演 |
|---|---|---|---|
| 1 | plan 11 步逐条落地 | ⚠️ | 步骤 1-10 的**代码与门禁**全部落地（见 #2-#16）；但 `plan.md:15-25` 的「状态」列 **11 个仍是 `[ ]`**，`S-221.md:136` 仍是「（规划态，实施后回填）」，`changelog.md` grep `S-221` **0 命中** ⇒ 阶段四的「0 个 `[ ]` 残留」终止条件形式上未满足。详见 ⚠️-2 |
| 2 | 伪代码六要素与 plan §一 一致 | ✅ | `section-rail.tsx:26` `let frame = 0`（**effect 内**）、`:30` `frame = 0`（复位在 `compute` 首行）、`:61` 挂载首帧 `compute()`、`:33` `window.scrollY <= 0` 短路、`:40-43` 文末兜底（`>= scrollHeight - 2`）、`:46` `let current: string = firstId`。`:62` `{ passive: true }`、`:64-68` 清理含 `cancelAnimationFrame` + 双 `removeEventListener`。逐行对 `plan.md:29-83` 无一处走样（实测对读） |
| 3 | `ul` 是 `flex` 不是 `flex-col` | ✅ | `section-rail.tsx:78` `<ul className="flex gap-4">`，且 `:76-77` 注释写明「不要 flex-col」的理由 ⇒ plan §十 的唯一返工坑已避开（实测） |
| 4 | 竖排条的实际条宽 | ⚠️ | **静态推演 ≈26px**：`text-xs` 行高 16 + `pr-2` 8 + `border-r-2` 2（`section-rail.tsx:86`）= 26px，**非** plan `:20` 检查点写的「1 字宽 ≈16px」。结论方向正确（远小于裸堆叠的 7 列 ≈110px），但检查点字面数值不成立。详见 ⚠️-5 |
| 5 | 1024–1280 与正文右缘关系 | ✅ | 静态推演：正文右缘 = 视口 − 56（`ui.tsx:47` `lg:px-14`）；1024 时竖排条 x∈[982,1008]（`right-4`=16）⇒ **间隙 14px**；1280 时 x∈[1230,1256]（`xl:right-6`=24）⇒ **间隙 6px**。**全区间 0 重叠**，优于 plan `:20` 允许的「≤ 一列字宽」 |
| 6 | 联动四路径（页顶/上滚/滚到底/4K） | ✅ | 静态推演（视口 1080，line = min(324,420) = 324；Hero 顶 = 56+≈491，value-ladder 顶 ≈547，features 顶 ≈740）：`scrollY=0`→短路 `'top'`；**抽掉短路复算**：`#top` top=0≤324 收 `'top'`、value-ladder 547>324 `break` ⇒ 仍 `'top'`（短路与主算法同向，非遮 bug）。`300`→value-ladder 247≤324 收 `'value-ladder'`；`500`→features 240≤324 收 `'features'`。**上滚回 200** → value-ladder 347>324 ⇒ 回到 `'top'`（每帧全量重读，无 entries 残影）。**滚到底**：`innerHeight+scrollY = scrollHeight ≥ scrollHeight−2` 恒真 ⇒ `'faq'`。**4K（2160）**：line=420，`#top` 0≤420 收 `'top'`、value-ladder 547>420 `break` ⇒ `'top'`（余量 127px，比 plan 说的 71px 更宽 —— plan 未计顶栏 56px） |
| 7 | `sectionRail` 顺序 = `App.tsx` 区块顺序 | ✅ | `site.ts:88-94`：top → value-ladder → features → advantages → download → quick-start → faq；`App.tsx:29/33-39`：`#top` → Hero → ValueLadder → Features → Advantages → DownloadCta → QuickStart → Faq。**逐项同名同序**（实测） |
| 8 | 7 个 `id` 与既有锚点逐一对上 | ✅ | `value-ladder.tsx:12`、`features.tsx:102`、`advantages.tsx:9`、`download-cta.tsx:10`、`quick-start.tsx:65`、`faq.tsx:6` 全部实测命中；`top` = `App.tsx:29` 新建（全站 `id="top"` grep 命中 1 处，无重复） |
| 9 | `#top` 位置与落点 = 真 `scrollY 0` | ✅ | 静态推演 + 结构核对：`#root` 是 `flex; flex-direction:column; min-height:100vh`（`index.css:85-89`）、`body` 只有 `background-color/color/font`（`:91-95`，Tailwind preflight 归零 margin）；`SiteMist` 为 `position:fixed` 出流（`index.css:434-440`，另 `pointer-events:none`）⇒ `App.tsx:29` 的 `<span id="top" class="block h-0">` 是**首个在流子元素**，其 top=0 ⇒ 落点即 `scrollY=0`。`:29` 也确在 `<SiteHeader />`（`:30`）之前，与 plan 步骤 1 一字不差 |
| 10 | 既有锚点不被 sticky 顶栏遮挡 | ✅ | `ui.tsx:45` `scroll-mt-24`=96px > `site-header.tsx:27` `h-14`=56px ⇒ 余量 40px；`value-ladder.tsx:12` 自带宽高 `scroll-mt-24`。`#download` 由 `Section` 渲染（`download-cta.tsx:10`）⇒ 96px 生效（实测类名） |
| 11 | `nav aria-label` + `aria-current` | ✅ | `section-rail.tsx:73` `aria-label="页内导航"`；`:85` `aria-current={isActive ? 'true' : undefined}`（非 `false`，与 `doc-page.tsx:120` 同口径）。`:84` 是 `href={`#${item.id}`}` 真锚点，`grep onClick|scrollIntoView` 在 `section-rail.tsx` **0 命中**（实测） |
| 12 | 对比度（自算，不采信 plan） | ✅ | 未选中 `text-ink-900/75` = `#33373f`@75% 叠白 = `#66696F`，L=0.14085 ⇒ **5.50:1**；叠页脚 `bg-paper-soft` `#f7f8fa`（`site-footer.tsx:7`）⇒ **5.18:1**，仍过 AA 4.5。选中 `text-ink-950` `#1b1e24`（`index.css:13`）⇒ **16.70:1**。竖条 `bg-accent` `#ea580c` 非文字不设门槛。与 plan `:19` 的 5.50 / 16.70 一致（我独立复算，非复述） |
| 13 | reduced-motion 成对 | ✅ | `section-rail.tsx:86` 同一元素同时有 `transition-colors` 与 `motion-reduce:transition-none`；`grep transition` 在组件内仅此一处 ⇒ 无裸动画。全局 `html{scroll-behavior:smooth}`（`index.css:24-25`）未改，按 plan `:128` 口径属「既有行为，本需求不新增」 |
| 14 | `hero.tsx` 零改动 | ✅ | `git status`/`git diff` 无 `website/src/sections/hero.tsx`；`hero.tsx:22` 仍是裸 `<section className="relative isolate pt-28 pb-16 sm:pt-36">`（无 id、无 scroll-mt）—— 实测 |
| 15 | `index.css` 零改动 | ✅ | git 无该文件改动；`ReadAllLines` = 699 行、BOM=False，与文件头豁免声明一致（实测） |
| 16 | `site.ts` 既有导出未误改 | ✅ | `git diff` 仅 `+15` 行、`-0`：新增 `:82-96` 的注释 + `sectionRail`（`as const`）。`BRAND`/`nav`/`advantages`/`valueLadder`/`features`/`quickStart`/`faq`/`downloadSources`/`platforms`/`footer` 全未触碰（实测 diff） |
| 17 | `/guide`、`/download` 不受影响 | ✅ | `main.tsx:3` 是唯一引入 `App` 的入口；`guide-main.tsx:3/8` 渲染 `GuidePage`、`download-main.tsx:3/8` 渲染 `DownloadPage`，二者均不引入 `App`/`SectionRail`；`grep SectionRail` 仅命中 `App.tsx:3/31`（实测） |
| 18 | 文案 4 照抄 / 2 截短 / 1 自拟 | ✅ | 照抄 4：`它能干什么`=`site.ts:191`、`为什么是它`=`:99`、`四步开始`=`:233`、`常见问题`=`:257`；截短 2：`不花钱`←`:165`、`下载`←`download-cta.tsx:10` 的 `下载${BRAND.name}`；自拟 1：`概览`。逐字一致，无新造词（实测） |
| 19 | 组件内无硬编码文案 | ✅ | `section-rail.tsx` 内唯一的文字字面量是 `:73` 的 `aria-label="页内导航"`（plan 步骤 2 已豁免）；标签全部来自 `sectionRail.map`（`:79-92`） |
| 20 | 挂载位置 vs plan 步骤 9 字面 | ⚠️ | plan `:23` 写「`<main>` **之后**」，实现放在 `App.tsx:31`（`<main>` 在 `:32`）⇒ 在 `<main>` **之前**。因 `fixed` 出流，视觉/布局零差异，但 DOM 顺序与屏读顺序变了，字面一致性不成立。详见 ⚠️-4 |
| 21 | 无 scroll 时布局变化导致高亮陈旧 | ⚠️ | 代码只监听 `scroll`（`:62`）与 `resize`（`:63`），**无** `ResizeObserver`/`load` 钩子。`quick-start.tsx:79` 的手风琴 `onClick` 会改变块高、图片加载也会推移后续 section，这些都不触发 `scroll` ⇒ 高亮停在旧值直到用户滚动。详见 ⚠️-1 |
| 22 | 规模：500 行硬线 / 自述行数 / BOM | ⚠️ | 500 行硬线远未触及（最大 `site.ts` 298 行，`section-rail.tsx` 100 行）；BOM 三文件全 False（实测）。但**行数与自述不符**：实测 `section-rail.tsx` = **100 行**，任务书与实施者口径写 86，plan `:134` 预估 70~85、`:160` 写「< 85 行」⇒ 三处都不实。详见 ⚠️-3 |
| 23 | 需求文档 `§9 实施记录` 回填 | ⚠️ | `S-221.md:136` 仍是「**（规划态，实施后回填）**」；同时本次在 `site.ts:82` 插入 15 行导致文档里的行号引用整体漂移 +15（`S-221.md:38/80/81/83/84` 引的 `site.ts:176/84/218/242/150` 现应为 `:191/99/233/257/165`）。详见 ⚠️-6 |
| 24 | 构建门禁 | ✅ | **实测**：`cd website; npm run build` exit 0、299 modules、285ms；且 dist CSS 中确认 `writing-mode:vertical-rl` 已产出（排除「类名写错被 purge」这条静默失效路径） |

---

## 三、问题清单（按严重度排序）

### ⚠️-1（唯一行为缺陷，低-中）布局在「无 scroll 事件」时变化 ⇒ 高亮陈旧

- **现象**：`section-rail.tsx:62-63` 只挂了 `scroll` 与 `resize`。首页有两类会移动 section 边界、却不发 `scroll` 的事件：① `quick-start.tsx:79` 手风琴 `onClick={shot ? () => toggle(step.name) : undefined}` 展开/收起（面板高度变化大）；② 图片/字体加载完成把下游板块整体推移。此时高亮会停在旧板块，直到用户再滚一次。`Reveal`（`ui.tsx:5-33`）不影响 section 自身 rect（只动子元素 transform），**不是**来源。
- **严重度**：低-中。不砸 §8 九条里任何一条（九条都伴随滚动或点击 + 由 hash 跳转引发的滚动），但用户「点开四步开始的手风琴、再回头看导航」时会看到错项。
- **最小修法（3 行，零新增依赖）**：
  ```ts
  const ro = new ResizeObserver(onScroll)   // 与 scroll 共用同一 rAF 合并
  ro.observe(document.body)
  // cleanup 里 ro.disconnect()
  ```
  若判定超出本需求范围，则**必须**在 `S-221.md §9` 记为已知限制，别留给读者当 bug 报。

### ⚠️-2（流程记账，中）阶段四收尾账没做

- **现象**：`plan.md:15-25` 11 个步骤状态全为 `[ ]`（代码 10 步已实打实完成、第 10 步门禁我也复跑通过）；`S-221.md:136` 未回填；`changelog.md` 无 S-221 条目。
- **代价**：`dev-workflow.md:461` 的「0 个 `[ ]` 残留 → 自动进入审查态」在形式上不成立；阶段六/收尾汇总时无法从文档判断哪步做过、哪些留给真机。
- **最小修法**：步骤 1-10 改 `[✓]`；步骤 11 保留 `[ ]` 并加注「阶段六执行（本阶段无浏览器）」；`S-221.md §9` 补 3-5 行（落点文件、构建结果、7 条文案来源、已知限制见本报告 ⚠️-1）。

### ⚠️-3（文档数字不实，中低）`section-rail.tsx` 行数 100 ≠ 自述 86 / plan 预估 <85

- **实测**：`ReadAllLines` = 100（LF=100、末尾有换行）。
- **代价**：plan `:160`「新增文件 < 85 行」与 `:134`「预计 70~85 行」都被打破；规模类检查点失去可信度（虽距 500 行硬线极远，不构成违规）。多出的 14 行是 `:4-13` 与 `:32-45` 的实现理由注释，属**有价值的注释**，不建议为凑数字删。
- **最小修法**：改 plan `:134`/`:160` 为「实测 100 行（含 20 行设计理由注释）」，并同步阶段四的门禁事实。

### ⚠️-4（字面一致性，低）`<SectionRail />` 落在 `<main>` 之前，与 plan 步骤 9「之后」不符

- **证据**：`App.tsx:31`（rail）在 `:32`（`<main>`）之前。
- **代价**：`fixed` 出流，视觉零差异；影响的是 DOM 顺序（屏读器先读导航再读正文，实际更接近目录语义）与「与 plan 字面不符」。
- **最小修法**：二选一 —— ① 把 `<SectionRail />` 移到 `</main>`（`:40`）之后、`<SiteFooter />` 之前；② 改 plan `:23` 口径为「`<main>` 之前（`#top` 与 `SiteHeader` 之间）」。**建议选 ②**，因为「悬浮导航先于正文被屏读器读到」是更好的语义顺序。

### ⚠️-5（检查点数值，低）条宽实测 ≈26px，plan 检查点写「≈16px（1 字宽）」

- **推演**：`section-rail.tsx:86` 的 `border-r-2`(2) + `pr-2`(8) + `text-xs` 行高(16) = **26px**（vertical-rl 下这三者都在块轴/横向）。
- **代价**：验收时若按 16px 量会误判「不达标」；本质仍达标（0 重叠，见 #5）。
- **最小修法**：plan `:20` 检查点改成「条宽 ≈26px（2px 竖条 + 8px 内边距 + 16px 行高）；与正文右缘 0 重叠」。

### ⚠️-6（文档漂移，低）需求正文行号因本次插入 +15 失效，且 `§9` 未回填

- **证据**：`S-221.md:80-84` 引 `site.ts:176/84/218/242/150`；插入 `sectionRail`（`site.ts:82-96`，+15 行）后实际为 `:191/99/233/257/165`。`S-221.md:23` 引 `App.tsx:27-33`，现区块在 `:33-39`。
- **最小修法**：在 §3.1 / §4.4 表头加一行「行号为插入 `sectionRail` 前的基线，现行 +15」，或直接把数字改掉；`§9` 回填见 ⚠️-2。

### 备注（不计入计数，供收尾决定）

1. **两个 `<nav>` 只有一个有名字**：新增 `section-rail.tsx:73` 带 `aria-label`，而既有顶栏 `site-header.tsx:35` 的 `<nav>` 无 `aria-label` ⇒ 屏读器会列出两个 navigation、其中一个无名。属**既有缺陷被本次放大**，一行可修（`aria-label="站点导航"`），但不在 S-221 范围。
2. **`/#faq` 跨页直达**：从 `/guide` 点顶栏 `./#faq` 进首页属 CSR 首帧无锚点，浏览器未必补跳；`compute()` 挂载时若 `scrollY=0` 会先把高亮定在「概览」。这是**既有行为**（S-221 前也存在），非本次回归；若阶段六观察到，另开编号。
3. **极端矮视口**：7 项竖向堆叠总高 ≈ 25 字 × 12px + 6×16px gap ≈ **396px**（推演）。`hidden` 只认宽度（1024px），1024×<420 的视口会上下溢出；实际设备极少，可不管。
4. `plan.md:88` 的「71px 余量」偏保守：未计顶栏 56px，真实余量 ≈127px（见 #6）。不影响结论。

---

## 四、判定

| 项 | 数 | 明细 |
|---|---|---|
| ❌ | **0** | 无阻断项：无静默错误、无编译失败、无锚点/顺序错位、无对比度不达标、无越界改动 |
| ⚠️ | **6** | ⚠️-1 高亮陈旧（唯一行为缺陷，低-中）；⚠️-2 阶段四记账未做；⚠️-3 行数自述 100≠86；⚠️-4 挂载点与 plan 字面不符；⚠️-5 条宽检查点 16px≠26px；⚠️-6 需求行号 +15 漂移 + §9 未回填 |
| ✅ | **18** | 见 §二 |

**判定：可进入阶段六。**

依据 `docs/dev-workflow.md:480`「❌ 项 > 0 时禁止进入验证态」—— 本轮 ❌ = 0。6 项 ⚠️ 里：

- 唯一会影响用户观感的是 ⚠️-1，且它需要「手风琴展开 + 不滚动」才复现，**九条验收一条都不覆盖它** ⇒ 不构成阻断，但阶段六请顺手验一次「展开『四步开始』面板后导航高亮是否错位」。
- ⚠️-2 是流程账，收尾前必须补齐（否则迭代汇总表对不上）。
- ⚠️-3/4/5/6 全是文档口径，改动量合计 ≤ 6 行。

**给阶段六的必验清单（本报告不认领）**：① 首屏「概览」是否已高亮（挂载首帧 `compute()`）；② 1024px 与 1280px 两个断点截图，量条宽与正文间隙（本报告推演 26px / 14px / 6px）；③ 点「下载」落点是否在顶栏下方 40px；④ 上滚回第一块高亮是否跟手；⑤ 滚到底是否停在「常见问题」；⑥ `/guide`、`/download` 无悬浮块；⑦ 系统「减少动态效果」下 hover 是否无过渡。
