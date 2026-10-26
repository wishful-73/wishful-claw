# S-228 阶段六 · 验证报告

> 2026-10-26 · 官网「回到顶部」浮动按钮
> 结论：**门禁全绿，可提交**；真机观感待老大确认

## 一、门禁结果

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `cd website; npx tsc --noEmit` | **exit 0**，0 错 |
| 官网构建 | `cd website; npm run build` | **✓ built in 325ms**，0 错 |
| 产物确认 | `dist/assets/back-to-top-*.js` | 1.06 kB（gzip 0.67 kB），已独立分包 |

无软件侧改动（纯官网），`dotnet build` / `npm test` 不适用。

## 二、验收标准核对（8 条）

| # | 标准 | 结果 | 依据 |
|---|---|---|---|
| 1 | 滚过 480 淡入 / 回顶淡出 | ✅ | `back-to-top.tsx` 双阈值 480/440 + `opacity` / `translate` / `pointer-events` 三态一致 |
| 2 | 点击平滑回 `scrollY = 0` | ✅ | 裸 `window.scrollTo(0, 0)`，依赖 `index.css` 的 `html { scroll-behavior: smooth }` |
| 3 | 减少动态效果时瞬间跳转 | ✅ | `index.css` 新增 `@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } }`；**阶段五 ❌1 修复后才成立** |
| 4 | 隐藏态不可聚焦 | ✅ | `inert={!visible}`，同时移出无障碍树、不吃指针事件 |
| 5 | 指南页一致 / 下载页不出现 | ✅ | `doc-page.tsx` 已挂（与首页同为 `SiteFooter` 之后）；`download-page.tsx` 未挂 |
| 6 | 与 rail / 顶栏无层级冲突 | ✅ | `z-30`（按钮）< `z-40`（rail）< `z-50`（header）；大屏 rail 垂直居中、按钮贴底 |
| 7 | 375px 不遮挡主要内容且可点 | ✅ | `h-11 w-11` = 44×44；`right-5 bottom-5`；会覆盖正文右端 44px 一条，属浮动按钮固有代价 |
| 8 | `tsc --noEmit && vite build` 0 错 | ✅ | 见上表 |

## 三、静态核对

- `BOM=False`；换行 CRLF。
- 零第三方依赖：图标为内联 SVG，未引图标库。
- 未新增设计 token，颜色全部取自 `index.css:13-21` 既有变量（`ink-700` / `paper` / `accent` / `ink-900`）。
- 文案集中于 `site.ts` 的规则未被触碰 —— 本按钮的 `aria-label` 是组件内固定中文字符串，
  与 `section-rail` 的 `aria-label="页内导航"`、`site-header` 的同类写法一致（不属于对外营销文案）。

## 四、待老大真机确认

1. **回顶观感**：滚到页底点按钮，平滑回到顶部；再滚回中部，按钮应淡出。
2. **减动效**：Windows「设置 → 辅助功能 → 视觉效果 → 动画效果」关闭后，点击应为瞬间跳转（无平滑）。
3. **首屏不出**：页面停在顶部时，右下角应是空的（无按钮、无残影）。
4. **尺寸**
   - 375px：按钮不与正文 / 页脚文字重叠到看不清；
   - ≥1280px：按钮与右侧竖排导航（S-221，本分支未发布）不相撞。
5. **指南页**：`/guide` 页行为与首页一致。

本地 dev 已在 **http://localhost:5280/** 运行（vite HMR 自动热更新）。
