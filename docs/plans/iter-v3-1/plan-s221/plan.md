# Plan: S-221 官网首页右侧悬浮联动导航

> 阶段二产物（**v3，阶段三第三轮复审 ❌0 / ⚠️6，判定可进阶段四**）。需求正文见 `../requirements/S-221.md`。
> 纯官网侧改动，**零软件改动**。
> 修订说明见 §八「相对首版的改动」，逐条对应 `compliance_report.md §三` 与 `§五`。

## 目标

首页 7 个大板块补一条常驻右侧竖排文字导航：本身是超链接、滚动时高亮当前板块、点击平滑跳转。`lg`（1024px）以下隐藏。

## 步骤清单

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | `App.tsx` 在 `<SiteHeader />` 之前插 `<span id="top" aria-hidden="true" className="block h-0" />` | `hero.tsx` **零改动**（类名一字不动）；`#top` 落点 `scrollY = 0` | [x] |
| 2 | `site.ts` 新增 `sectionRail` 常量（7 条 `{ id, label }`），组件只 `map` | 组件内无文案字面量（除 `aria-label`）；7 个 `id` 与首页 7 个锚点逐一对上 | [x] |
| 3 | 新建 `components/section-rail.tsx`：`<nav aria-label="页内导航">` + `<ul>` + 每项 `<a href="#id">` | 外层是 `nav`；每项是**真 `<a href>`**，**无 `onClick`、无 `scrollIntoView`**（`grep` 可验） | [x] |
| 4 | 联动：`scroll`（`passive`）+ `rAF` 合并 → 每次**全量**重算「阈值线以上最后一个 section」 | 上滚 / 回顶 / 滚到底三条路径高亮均正确（不是只在向下滚时对）；**`frame` 有声明、`compute` 开头有 `frame = 0`、挂载有首帧 `compute()`** —— 三条缺一则高亮冻住 | [x] |
| 5 | 当前项 `aria-current="true"`；`text-xs`；选中 `text-ink-950 font-semibold` + 右侧 2px accent 竖条；未选中 `text-ink-900/75` | 对比度实测：未选中 `text-ink-900/75`（token 值 `#33373f`@75%，**不是** `#1a1a1a`）≈ **5.50:1**、选中 `ink-950` ≈ **16.70:1**（均过 AA 4.5:1，`text-xs` 不降门槛）；颜色信号由竖条承担 | [x] |
| 6 | 形态与定位：`[writing-mode:vertical-rl]` 竖排；**`ul` 必须显式 `flex`（见 §十）**；`fixed right-4 xl:right-6 top-1/2 z-40 -translate-y-1/2 hidden lg:block` | 1024 / 1280 各核一次；与正文右缘**零重叠**（实测推演：1024 间隙 14px、1280 间隙 6px）；**条宽 ≈26px**（16 行高 + 8 `pr-2` + 2 竖条），不是 1 字宽的 16px、更不是裸堆叠的 7 列 ≈110px | [x] |
| 7 | 降级与动效：hover 若加 `transition-*` 必须配 `motion-reduce:transition-none`；不新增 CSS | `grep transition` 的结果里 `motion-reduce:` 成对出现；`index.css` 零改动 | [x] |
| 8 | 「无 JS 也能跳」按 **N/A** 处理（见 §七） | 不勾这条；改为验步骤 3 的「真 `<a>` 无 `onClick`」 | [x] |
| 9 | `App.tsx` 挂载一次（`<SiteHeader />` 之后、`<main>` **之前**，与 `SiteMist` 同级；`fixed` 出流，DOM 顺序不影响视觉）；`/guide`、`/download` 不挂 | 三页各访问一次：`/` 有，另两页无 | [x] |
| 9b | 阶段五补强：布局变化不发 `scroll`（features 切 tab / 手风琴展开 / 图片加载）⇒ 加 `ResizeObserver(document.body)` 复用同一 rAF，卸载时 `disconnect()` | 切 tab、展开手风琴后不滚动，高亮也应自动纠正 | [x] |
| 10 | 门禁：`cd website && npm run build` | `tsc --noEmit` + `vite build` 均 0 错误 | [x] |
| 11 | 真机观感（dev server `localhost:5280`） | 按 `S-221.md §8` 九条逐项过（第 7 条按 N/A） | 阶段六 |

## 一、联动实现（改：全量重算，不是只看本次 entries）

```tsx
const LINE_RATIO = 0.3
const LINE_MAX = 420 // 超高视口保护，理由见下
const firstId = sectionRail[0].id
const lastId = sectionRail[sectionRail.length - 1].id

export function SectionRail() {
  // ← 必须有声明。缺它 setActive 未定义，tsc --noEmit 当场报
  const [active, setActive] = useState<string>(firstId)

  useEffect(() => {
    let frame = 0 // ← 必须在 effect 内。落到组件体会每次渲染重置 + 重复注册监听

    const compute = () => {
      frame = 0 // ← 必须复位。漏这行：首次滚动后 `if (!frame)` 永假，rAF 不再排队，高亮冻在第一帧

      // 页顶直接给第一项。理由：4K 屏 innerHeight≈2160 ⇒ line≈648 > Hero 高（≈490），
      // 页顶时 Hero 与 value-ladder 的 top 都 <= line，会选中第二项「不花钱」。
      if (window.scrollY <= 0) {
        setActive(firstId)
        return
      }

      const line = Math.min(window.innerHeight * LINE_RATIO, LINE_MAX)
      // 文末兜底：页脚高度会让最后一块永远够不到线，不加这条最后一项永远选不上
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setActive(lastId)
        return
      }
      // 显式 string：site.ts 若按既有习惯写 as const（:13/:31/:43 都这么写），
      // 这里会被收窄成字面量 'top'，`current = item.id` 报 TS2322
      let current: string = firstId
      for (const item of sectionRail) {
        const el = document.getElementById(item.id)
        if (!el) continue
        if (el.getBoundingClientRect().top > line) break
        current = item.id
      }
      setActive(current)
    }

    const onScroll = () => { if (!frame) frame = requestAnimationFrame(compute) }

    compute() // 挂载即算一次：首屏在页顶时高亮必须直接落在第一项，而不是停在初始 state
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      // 清理照抄 use-active-heading.ts:53-57
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])
  // …return <nav aria-label="页内导航"><ul className="flex">…</ul></nav>
}
```

两条与参考实现逐字对齐、但极易抄漏的细节，单独钉住：`frame = 0` 的**声明**（`:21`）与**复位**（`:24`），以及挂载时的首帧 `compute()`（`:50`）。少任何一条，表面都能编译通过、页面也能渲染，只是高亮像死了 —— 这是本需求唯一的高危实现点。

`LINE_MAX = 420` 是拍的值，**真正的约束是首块高度，不是「各板块都 600~900」**：Hero 实测 ≈ **490px**（`hero.tsx:22` `sm:pt-36`=144 + 眉标 32 + h1 60 + 副标题 107 + CTA 84 + `pb-16`=64），阈值线只要 ≥ 490，页顶就会选中第二项。420 留下 **71px 余量**；`value-ladder` 只是 ≈ **195px** 的窄带，其余板块 600~900。配合 `scrollY <= 0` 的顶部短路，超高视口与常规视口都能落到正确项。**Hero 文案若被删减到 420 以下，两条兜底必须同时在**（短路管页顶、`LINE_MAX` 管滚动中）。

注意 `compute()` 首调这条与 `use-active-heading.ts:50` 一致 —— 少了它，刷新后停在某个锚点再回滚时首帧无高亮，要等第一次滚动才亮。

**为什么不用 `IntersectionObserver`**（推翻首版取舍）：

observer 回调**只交付本次变化的 entries**。上滚时某节离开窄带，本轮 entries 里只有 `isIntersecting: false` ⇒ 若按「取当前相交集合」实现，集合为空 ⇒ 保持上一个 ⇒ 用户已滚回 `features` 而高亮还挂在 `download`。正好砸在验收第 2、4 条上。

`scroll` + `rAF` 每次全量重算，天然没有这个状态残影；且 7 个元素在**同一帧内批量读** `getBoundingClientRect`（只读不写，不触发重排），成本可忽略。这条与站内既有实现（`lib/use-active-heading.ts:46-52`）完全同一模型。

## 二、文案落点（改：进 `site.ts`）

`site.ts:1-2` 写明「改文案只改这里，不散落进 JSX」。首版 plan 定「不改 `site.ts`」会让 7 条标签散进组件，日后改 `valueLadder.title` 时悬浮块不跟随。

改为在 `site.ts` 增常量：

```ts
export const sectionRail = [
  { id: 'top',          label: '概览' },        // 自拟（Hero 无 title 字段，兼回顶）
  { id: 'value-ladder', label: '不花钱' },      // 截短：原文「不花钱，也能用起来」10 字竖排过高
  { id: 'features',     label: '它能干什么' },  // 照抄 features.title（site.ts:191）
  { id: 'advantages',   label: '为什么是它' },  // 照抄 advantages.title（site.ts:99）
  { id: 'download',     label: '下载' },        // 截短：原值在 download-cta.tsx:10 拼「下载心相」
  { id: 'quick-start',  label: '四步开始' },    // 照抄 quickStart.title（site.ts:233）
  { id: 'faq',          label: '常见问题' }     // 照抄 faq.title（site.ts:257）
]
```

> 行号是插入 `sectionRail` **之后**的实测值（插入点在 `:82` 起的 15 行，其后全部 +15）。日后又改动就按符号名 grep，别信这一版数字。

**7 项构成：4 照抄 / 2 截短 / 1 自拟。**

`download` 段的标题**不在 `site.ts`**，在 `sections/download-cta.tsx:10` 用 `` title={`下载${BRAND.name}`} `` 拼成「下载心相」；竖排取「下载」两字。

## 三、可访问性与视觉

| 项 | 定值 | 理由 |
|---|---|---|
| 语义 | 外层 `<nav aria-label="页内导航">`；当前项 `aria-current="true"` | 对齐既有目录栏 `doc-page.tsx:90` / `:120`，站内一套语义 |
| 选中态 | `text-ink-950 font-semibold` + 右侧 `w-[2px] bg-accent` 竖条 | `text-accent` 对白底仅 ≈3.6:1，不达 AA；改由深色文字承担对比度、竖条承担颜色信号 |
| 未选中 | `text-ink-900/75`（实测 ≈5.50:1）、hover 升 `text-ink-950` | 首版 `/45` 仅 ≈2.5:1，压在通栏内容上不可读 |
| 位置 | `right-4 xl:right-6` | `ui.tsx:47` 右内边距 56px；竖排条宽约一字宽 + 竖条，1024–1280 与右缘文字重叠 ≤ 一列，接受 |
| 动效 | `transition-colors` + **`motion-reduce:transition-none`** | `index.css` 既有 4 处 reduced-motion 都不覆盖全局 `scroll-behavior: smooth`，本需求不新增 CSS，只保证组件自身不新增动画 |

## 四、涉及文件

### 新增

- `website/src/components/section-rail.tsx` — 悬浮导航（**实测 100 行**，含 24 行实现理由注释；原预估 70~85 未计注释）

### 修改

- `website/src/content/site.ts` — 新增 `sectionRail` 常量
- `website/src/App.tsx` — import + 挂载 + `#top` 锚点

### 不改

- `website/src/sections/hero.tsx` — **零改动**（锚点搬到 `App.tsx`，落点才是真正的 `scrollY = 0`）
- `website/src/index.css` — 699 行已带豁免头；本需求不新增 CSS
- `website/src/components/ui.tsx` — `Section` 已透传 `id`，六板块零改动
- `website/src/lib/use-active-heading.ts` — 见 §五

## 五、参考源码

| 参考 | 用途 | 是否复用 |
|---|---|---|
| `lib/use-active-heading.ts:1-61` | 判定模型：阈值线 + 扫全量取最后越过者 + **文末兜底**（`:31-37`，正是本需求担心「页脚处全灰」的解） | **不复用，但照抄模型** —— 它的 `TOP_LINE = 88` 是固定像素（配文档标题的 `scroll-margin-top`）、且绑定 `articleRef` + ids-key；首页要按视口比例 30% 判定。共用需参数化三处，收益低于改动 `/guide` 的回归风险 |
| `components/doc-page.tsx:89-96`、`:107-133` | `nav aria-label` + `hidden lg:block` + `aria-current="true"` + 选中样式 | **语义与断点照抄**，样式按竖排重写 |
| `index.css:24-25` | `html { scroll-behavior: smooth }` | 依赖，不改 |
| `lib/use-active-heading.ts:53-57` | 清理模板：`if (frame) cancelAnimationFrame(frame)` + 两个 `removeEventListener` | 复用它（**不是** `ui.tsx` —— 那里只有 `clearTimeout` 与 `io.disconnect()`，没有 rAF） |
| `components/ui.tsx:45` | `scroll-mt-24`（96px） | 六个板块已有，锚点不被 `h-14` 吸顶栏遮住 |

## 六、规模

新增文件 **100 行**（实测，含 24 行实现理由注释）；`site.ts` +15 行、`App.tsx` +6 行。不触碰任何 500 行线附近文件（最大 `site.ts` 298 行）。

## 七、「无 JS 也能跳」按 N/A 处理

本站是**纯 CSR**：`index.html:15` 只有空 `<div id="root"></div>`，`:16` 加载 `main.tsx`，渲染全在 `main.tsx:6-10` 的 `createRoot().render()`；`vite.config.ts:36` 是 `appType: 'mpa'` 四入口，无 SSG / prerender。**禁 JS 后整页空白，没有可点的链接** —— 该验收条物理上不可执行。

处置：
- 步骤 8 改判 **N/A**，不勾。
- 需求侧 `S-221.md:65`、`:130` 同步订正（见 §九）。
- 保留的真意：导航是**真 `<a href>`**，不依赖 JS 跳转（步骤 3 已验）。若将来要「禁 JS 可看」，那是引入 SSG 的新需求，另开编号。

## 八、相对首版的改动

| # | 首版 | 现在 | 依据 |
|---|---|---|---|
| 1 | 步骤 7「禁用 JS 后能跳」 | N/A + 改验「真 `<a>` 无 `onClick`」 | 合规 ❌ #2 |
| 2 | observer 取「当前相交集合」 | `scroll` + `rAF` 全量重算 + 文末兜底 | 合规 ⚠️-5（上滚错位） |
| 3 | 文案硬编码进组件、`downloadCta` 引用 | 进 `site.ts` 的 `sectionRail`；来源改 `download-cta.tsx:10`；结论改「4/2/1」 | 合规 ⚠️-2、⚠️-4 |
| 4 | 参考源码只列 `ui.tsx` | 增列 `use-active-heading.ts` 与 `doc-page.tsx`，写明不复用理由 | 合规 ⚠️-1 |
| 5 | 无 `nav` / `aria-current`、`/45` 对比度、无 `right-*` | 全部补齐（§三） | 合规 ⚠️-3 |
| 6 | `hero.tsx` 加 `id="top"` | 锚点搬到 `App.tsx` 零高元素，`hero.tsx` 零改动 | 合规 ⚠️-6 |
| 7 | `frame` 无声明、无复位 | 补齐声明 + `compute` 首行复位 + 挂载首帧调用，三条单列成检查点 | 复审 ❌-2 |
| 8 | 需求正文 8 行仍是首版口径 | §九 扩到 **13 处**，逐行订正 | 复审 ❌-新1 |
| 9 | `line = innerHeight * 0.3` 无上限 | 加 `LINE_MAX = 420` + `scrollY <= 0` 顶部短路 | 复审 ⚠️-新2 |
| 10 | 未写竖排实现方式、步骤 5 漏字号 | 步骤 6 补 `[writing-mode:vertical-rl]`、步骤 5 补 `text-xs` | 复审 ⚠️-新3 / ⚠️-新5 |
| 11 | 清理模式引 `ui.tsx:5-33` | 改引 `use-active-heading.ts:53-57`（前者无 rAF） | 复审 ⚠️-新4 |
| 12 | 竖排只挂 `nav`，`ul`/`li` 布局没定 | 步骤 6 + §十 明确 `ul` 用 `flex`（**禁 `flex-col`**），检查点加「条宽 = 1 字宽」 | 复审三 ⚠️-新2（最可能返工） |
| 13 | 伪代码缺 `useState` / `useEffect` 边界 / `current` 类型 | 三条补齐，片段改为可原样落地 | 复审三 ⚠️-新1 |
| 14 | `LINE_MAX` 依据写「各板块 600~900」 | 改为「首块 Hero ≈490 是真正的约束，余量 71px；value-ladder 仅 ≈195」 | 复审三 ⚠️-新3 |
| 15 | 步骤 5 检查点色值 `#1a1a1a` | 改 `text-ink-900/75`（`#33373f`@75%），比值 5.50:1 不变 | 复审三 ⚠️-新6 |
| 16 | §九 `:84`、「9 处」 | `:83`、「13 处」 | 复审三 ⚠️-新4 |

## 九、需求侧同步订正

| 位置 | 原 | 改 |
|---|---|---|
| `S-221.md:60` | 未选中 `text-ink-900/45`、选中 `text-accent` + 加粗 + 竖线 | 未选中 `text-ink-900/75`、选中 `text-ink-950` + `font-semibold` + 竖条 |
| `S-221.md:63` | 「`IntersectionObserver` 观察…用 observer 而非 `scroll`」 | 改 `scroll` + `rAF` 全量重算（含上滚错位的理由） |
| `S-221.md:65` | 「禁 JS 也能跳，只是不高亮」 | 标 N/A + CSR 证据 |
| `S-221.md:66` | 「全宽铺满，见 `ui.tsx:50`」 | `ui.tsx:47` |
| `S-221.md:70` | 「`sections/hero.tsx:22` 加 `id="top"`」 | 改 `App.tsx` 零高 `<span id="top">`，`hero.tsx` 零改动 |
| `S-221.md:102` | 5.2「observer 判定用视口上部 30% 内最靠上」 | 改「阈值线以上最后一个 + 页顶短路 + 文末兜底」 |
| `S-221.md:103` | 「未选中项降到 45% 不透明度」 | `/75`（≈5.50:1） |
| `S-221.md:107-110` | 代价取舍里「observer 判定会抖」「用 observer 避免布局计算」 | 改为 scroll+rAF 的取舍（7 个元素同帧批量读，只读不写） |
| `S-221.md:118` | 7「`observer` + 原生锚点足够」 | 「原生锚点 + 一次 rAF 合并的 scroll 足够」 |
| `S-221.md:124` | 验收「『概览』为当前项（品牌色加粗）」 | 改「深色加粗 + 竖条」（品牌色 3.6:1 不达 AA） |
| `S-221.md:128` | 「整条升到 100% 不透明度」 | 「升到 `text-ink-950`」 |
| `S-221.md:130` | 验收「禁用 JS，各项仍可点击跳转」 | 「导航项为真 `<a href>`，不依赖 JS 跳转；禁 JS 场景 N/A（CSR）」 |
| `S-221.md:83` | 「快速上手」 | 「四步开始」（`site.ts:218` 实际值） |

## 十、竖排堆叠轴（复审三 ⚠️-新2，本需求唯一会返工的坑）

`[writing-mode: vertical-rl]` 挂在 `nav` 上之后，**块流方向变成右→左**。此时裸 `<ul>` 里的 7 个 `<li>` 会排成 **7 列「书脊」**：条宽 ≈ 7 × 16px（`text-xs` 行高）+ 6 × gap ≈ **100~120px**。

按 `right-4`(16px) 算，1024px 视口下条左缘 ≈ 1024 − 16 − 110 ≈ **898px**，而正文右缘在 1024 − 56 = **968px** ⇒ 压进正文 ≈ **70px ≈ 5 字宽**，步骤 6 的检查点当场挂。

**正确写法：给 `ul` 显式 `flex`**（不要 `flex-col`）：

```tsx
<ul className="flex gap-4">   {/* 竖排下 row 轴 = inline 轴 = 上→下，正好是要的堆叠方向 */}
<li>…</li>
```

`flex-col` 反而错 —— 竖排下它沿**块轴**排，即右→左，还是 7 列。

**检查点**：条宽必须是 **1 个字宽（≈16px）**，不是 7 列。这是 `§六 规模` 之外唯一需要真机量的尺寸。
