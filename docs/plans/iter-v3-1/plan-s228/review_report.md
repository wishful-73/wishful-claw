# S-228 阶段五 · 审查报告

> 2026-10-26 · 审查对象：官网「回到顶部」浮动按钮
> 审查方式：独立 subagent 全量审查（读 21 个文件 / 跑 `tsc --noEmit`），助手复核后处置

## 一、审查结论

| 档位 | 条数 | 处置 |
|---|---|---|
| ❌ 必修 | 1 | 已修 |
| ⚠️ 建议 | 4 | 全部采纳 |
| ℹ️ 备注 | 9 | 采纳 3 条（惰性初始化 / `transition-all`→`transition` / `z` 层级），其余记录不改 |

`npx tsc --noEmit` 实测 `exit 0`（strict + `noUnusedLocals` + `verbatimModuleSyntax`）。

## 二、❌ 必修（1 条）

### ❌1 `scrollTo({ behavior: 'auto' })` 挡不住 CSS 的 `smooth`，减动效降级失效

**原实现**（`back-to-top.tsx:28-29`）：

```ts
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
```

**问题**：`ScrollBehavior` 的 `auto` 语义是「按元素 computed 的 `scroll-behavior` 走」，
而 `index.css:25` 给 `html` 写死了 `scroll-behavior: smooth` ⇒ reduce 用户点下去**照样平滑滚动**，
降级完全没生效，验收第 3 条不达标。原注释还把这个误解写成了「事实」，误导后来人。

**复核**：属实。`index.css` 四个 `prefers-reduced-motion` 块（388 / 484 / 588 / 688 行）
逐一核对，只写了 `animation: none`，**没有一条动 `scroll-behavior`**，组件也没兜住。

**修复**：走 CSS 层，`index.css` 的 `html` 规则后新增

```css
@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}
```

组件内简化为裸 `window.scrollTo(0, 0)`，平滑与否交给 CSS。一处生效，覆盖全站锚点
（`section-rail`、doc 目录、`#top`），且只影响开了该偏好的用户。

## 三、⚠️ 建议（4 条，全部采纳）

| # | 问题 | 修法 |
|---|---|---|
| ⚠️2 | 隐藏瞬间不清焦点，键盘/读屏用户会卡在 `opacity-0` 元素上（`tabIndex={-1}` 只挡「之后按 Tab 进来」，挡不住「已经在里面」） | 统一由 `inert` 处理 |
| ⚠️3 | `opacity-0` 不改变无障碍树，`scrollY = 0` 时读屏仍能浏览到一个按了没效果的按钮 | 同上 |
| ⚠️4 | 同一控件挂载位置两页不一致：首页在 `main` 之前、指南页在 `main` 之后 ⇒ Tab / 读屏顺序不同 | 两页统一挪到 `<SiteFooter />` 之后 |
| ⚠️5 | 单阈值 480 在触控板微调时会反复淡入淡出（各 200ms） | 双阈值滞回：显示 480 / 隐藏 440 |

⚠️2 + ⚠️3 合并为 `inert={!visible}`（React 19 原生支持布尔 `inert`），
一次解决「移出无障碍树 + 不可聚焦 + 不吃指针事件」，同时删掉 `tabIndex`。
实测 `tsc --noEmit` 通过，类型层无问题。

## 四、ℹ️ 备注（9 条）

| # | 内容 | 处置 |
|---|---|---|
| ℹ️6 | 初始 `useState(false)` 不会造成可见闪烁，但可惰性初始化省一帧 | **采纳**：`useState(() => window.scrollY > 480)`，effect 里的 `onScroll()` 保留（滚动恢复可能晚于首次渲染） |
| ℹ️8 | 375px 无重叠；`H < 352px` 且 `W ≥ 1024px` 时按钮会盖住 rail 末项（同为 `z-40`，`BackToTop` DOM 更靠后） | **采纳**：降为 `z-30` |
| ℹ️10 | `transition-all` 过宽，会连带 `padding` 等无关属性一起动画 | **采纳**：改 `transition` |
| ℹ️7 | 卸载与泄漏检查通过；`StrictMode` 下 effect 跑—清—再跑无重复注册 | 记录，不改 |
| ℹ️9 | 全站 `focus-visible` / `outline-` grep 0 命中，都依赖 UA 默认焦点环 | 记录，不改（要做得全站一起加，不在本需求范围） |
| ℹ️11 | `h-11 w-11` = 44×44 达标；`index.html` 无 `viewport-fit=cover` ⇒ `bottom-5` 无需 safe-area 偏移 | 记录，不改 |
| ℹ️12 | 三个页面是三个独立入口（非 SPA 内切换）⇒ 不会有两个实例并存；`doc-page.tsx:14` 注释「使用指引与更新日志共用」是历史残留（官网已无更新日志页） | 记录，不改（无关改动） |
| ℹ️13 | 类型安全通过：显式返回类型、无 `any` / `@ts-ignore` / 断言 | 记录 |
| ℹ️14 | 注释体例、`useEffect` 写法、`className` 组织与 `section-rail` / `site-header` 同构 | 记录 |
| ℹ️15 | 地址栏残留 `#hash`（点过 `#faq` 再回顶仍留着）属既有锚点体系行为 | 写进 plan §四 范围外 |

## 五、验收标准逐条对照（修复后）

| # | 标准 | 结论 |
|---|---|---|
| 1 | 滚过 480 淡入 / 回顶淡出 | ✅ |
| 2 | 点击平滑回 `scrollY = 0` | ✅ |
| 3 | 减少动态效果时瞬间跳转 | ✅（CSS 层覆盖后生效） |
| 4 | 隐藏态不可聚焦 | ✅（`inert`，比 `tabIndex={-1}` 更彻底） |
| 5 | 指南页一致 / 下载页不出现 | ✅ |
| 6 | 与 rail、顶栏无层级冲突 | ✅（`z-30` < rail `z-40` < header `z-50`） |
| 7 | 375px 不遮挡主要内容且可点 | ✅ |
| 8 | `tsc --noEmit && vite build` 0 错 | ✅ 实测 |

## 六、改动清单

| 文件 | 改动 |
|---|---|
| `website/src/index.css` | `html` 规则后新增 `prefers-reduced-motion` 的 `scroll-behavior: auto` 覆盖（+9 行带注释） |
| `website/src/components/back-to-top.tsx` | 重写：`inert`、双阈值、惰性初始值、裸 `scrollTo(0,0)`、`z-30`、`transition`、注释订正 |
| `website/src/App.tsx` | `<BackToTop />` 从 `main` 前移到 `<SiteFooter />` 后 |
| `website/src/components/doc-page.tsx` | `<BackToTop />` 从 `<SiteFooter />` 前移到后 |

## 七、教训（补进审查清单）

**「显式传参」不等于「真的生效」**：`scrollTo({ behavior: 'auto' })`、`behavior: 'instant'`
这类枚举值必须核对其规范语义，不能凭字面猜。凡涉及「我传了值所以它一定按这个来」的写法，
都要进浏览器实测或查 `lib.dom.d.ts` / MDN 确认 —— 本次是 CSS 层的 `smooth` 压过了 JS 意图。
