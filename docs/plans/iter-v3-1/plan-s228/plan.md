# S-228 实施方案 · 官网「回到顶部」浮动按钮

> 迭代 v3-iter-1（提前自 v3-iter-2）· 2026-10-26
> 形态拍板：**右下角独立浮动按钮**（老大 2026-10-26 10:35）

## 一、探索结论（已实查）

### 1.1 现状：全站无回顶入口

`website/src` 全树搜索 `backToTop / back-to-top / 回到顶部 / 返回顶部 / scrollIntoView` —— **0 命中**。
`scrollTo(` 仅两处，均与回顶无关：

| 位置 | 用途 |
|---|---|
| `sections/features.tsx:56` | 窄屏 tab 横向滚动居中 |
| `components/site-header.tsx:15` | 只读 `window.scrollY`，控制顶栏玻璃底样式 |

### 1.2 「概览」不是回顶按钮（上一轮判断失误的更正）

`components/section-rail.tsx`（S-221）第一项 `{ id: 'top', label: '开始' }` 点击跳 `#top`，
功能上确实回顶。但：

- **语义不同**：那是「跳到首页顶部这一块」的板块锚点，渲染成竖排文字项（`[writing-mode:vertical-rl]`），
  用户不会读成「回到顶部」；
- **覆盖不足**：整栏 `hidden lg:block` ⇒ **1024px 以下完全不存在**；
- **线上根本没有**：S-221 在 `dev/v3-iter-1`，尚未发布 ⇒ 当前线上大屏小屏都无回顶路径。

⇒ 结论：需要独立控件，且**不依赖 S-221 是否发布**。

### 1.3 可复用的既有基础

| 项 | 位置 | 复用方式 |
|---|---|---|
| 平滑滚动 | `index.css:25` `scroll-behavior: smooth` | 无需自己写动画 |
| 顶部锚点 | `App.tsx:29` `<span id="top" />` | 本方案不用锚点（见 §2.4） |
| 滚动监听模式 | `site-header.tsx:14-19`（`passive` + `useEffect`） | 照抄同一个写法 |
| 设计 token | `index.css:13-21` — `accent` `#ea580c` / `ink-700` 边框 / `paper` 底 | 全部沿用，不新增变量 |
| 动效降级 | 项目通用 `motion-reduce:*` | 沿用 |

### 1.4 定位冲突排查

`section-rail` 为 `fixed top-1/2 right-4 z-40`（垂直居中），`site-header` 为 `sticky top-0 z-50`。
右下角 `bottom-5/6 right-5/6` 与二者**垂直方向错开，无重叠**。`z-40` 与 rail 同级、低于 header。

## 二、方案

### 2.1 新增组件 `website/src/components/back-to-top.tsx`

- 单文件、约 60 行、零依赖、内联 SVG 上箭头（项目惯例：不引图标库）。
- 状态单一：`visible`。**双阈值滞回** —— 显示 480、隐藏 440（阶段五审查 ⚠️5 补：
  单阈值时用户停在 480 附近微调，按钮会反复淡入淡出）。
- 初始值惰性取 `window.scrollY > 480`（纯 CSR，无 hydration 顾虑），effect 内仍立即执行一次
  （带 `#hash` 直达时滚动恢复可能晚于首次渲染，光靠初始值兜不住）。
- 监听用 `passive: true`。

### 2.2 阈值 = 480px

Hero 实测约 490px（`section-rail.tsx:16-17` 注释记录）。滚过首屏才出现：
短页面（如下载页）自然不触发，因此**组件可安全挂在任何页面**。

### 2.3 挂载点

| 页面 | 是否挂 | 理由 |
|---|---|---|
| 首页 `App.tsx` | ✅ | 8 个板块，最长 |
| 指南页 `components/doc-page.tsx` | ✅ | 长文 + 侧目录，回顶需求同样强 |
| 下载页 `download-page.tsx` | ❌ | 内容短，480px 阈值下不会出现，挂了也是死代码 |

两页挂载位置统一为 **`<SiteFooter />` 之后**（阶段五审查 ⚠️4 修正：原先首页排在 `main` 之前、
指南页排在 `main` 之后，`fixed` 定位让视觉一致但 Tab / 读屏顺序两页不同）。

### 2.4 用 `button` + `scrollTo`，不用 `<a href="#top">`

理由三条：

1. **不污染 URL / 历史记录**。锚点会在地址栏留下 `#top` 并新增一条 history，用户点后退会停在顶部而不是回到上一位置。
2. **减少动态效果可控**。锚点跳转的平滑与否完全由 CSS 决定，JS 无干预点；`button` + `scrollTo` 则能收口。
3. 锚点方案要求目标元素存在，`doc-page.tsx` 里没有 `id="top"`，还要额外补一个。

> **⚠️ 原方案此处有错，已订正（阶段五审查 ❌1）**：原写「`prefers-reduced-motion` 时由 JS 显式退化为
> `behavior: 'auto'`」—— **这是错的**。`ScrollBehavior` 的 `auto` 语义是「按元素 computed 的
> `scroll-behavior` 走」，而 `index.css:25` 给 `html` 写死了 `smooth` ⇒ 传 `'auto'` 等于没写，
> 降级根本不生效。
> 现改为 **CSS 层降级**：`index.css` 的 `html` 规则后新增
> `@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } }`，组件里回到裸
> `window.scrollTo(0, 0)`，由 CSS 决定平滑与否。一处生效、覆盖全站锚点（rail、doc 目录、`#top`），
> 且只影响开了该偏好的用户。

### 2.5 无障碍

| 项 | 处理 |
|---|---|
| 名称 | `aria-label="回到顶部"`（图标本身 `aria-hidden="true"`） |
| 隐藏时 | **`inert={!visible}`** —— React 19 原生支持布尔 `inert`，一次解决「移出无障碍树 / 不可聚焦 / 不吃指针事件」三件事（阶段五审查 ⚠️2+⚠️3：原写 `tabIndex={-1}`，挡不住「已聚焦后按钮变隐藏」的焦点滞留，且 `opacity-0` 不改变无障碍树，读屏在顶部也会读到它） |
| 触摸目标 | `h-11 w-11`（44×44px），达 WCAG 建议的最小尺寸 |
| 焦点可见 | 依赖浏览器默认 focus ring（全站均如此，见审查 ℹ️9）；按钮有 `border`，对比度足够 |
| 动效 | `motion-reduce:transition-none` + `transition`（不用 `transition-all`，见审查 ℹ️10） |
| 层级 | `z-30`（阶段五审查 ℹ️8：原 `z-40` 与 `section-rail` 同级，极端窄高视口 `H < 352px` 时会盖住 rail 末项） |

## 三、验收标准

1. 首页滚过 480px 后，右下角淡入圆形按钮；滚回顶部后淡出。
2. 点击后平滑回到 `scrollY = 0`。
3. 系统开启「减少动态效果」时，点击为瞬间跳转（无平滑动画）。
4. 按钮隐藏状态下 `Tab` 键无法聚焦到它。
5. 指南页行为一致；下载页不出现。
6. 与右侧 `section-rail`（大屏）无视觉重叠；与顶栏无层级冲突。
7. 375px 窄屏下按钮不遮挡主要内容，且仍可点击（44px）。
8. `npm run build`（`tsc --noEmit && vite build`）0 错误。

## 四、范围外

- 不做滚动进度条（老大未提）。
- 不改 `section-rail` 现有高亮联动逻辑。
- ~~不改 `index.css` 的 `scroll-behavior` 全局策略~~ —— **已撤回**（阶段五审查 ❌1）：只新增一条
  `prefers-reduced-motion: reduce` 下的 `scroll-behavior: auto` 覆盖，普通用户行为零变化，
  属修正而非策略变更。
- 不清理地址栏残留的 `#hash`（如点过 `#faq` 再回顶，地址栏仍留着）—— 既有锚点体系的固有行为，
  要做得用 `history.replaceState`，那是新需求。
- 不引入第三方轮播 / 图标 / 动效库。
