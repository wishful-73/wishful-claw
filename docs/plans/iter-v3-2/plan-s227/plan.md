# S-227 实施规划：官网「它能干什么」改 banner 形态

> 分支 `dev/v3-iter-2`。本文件是阶段二产物，对应 `requirements/S-227.md`。
> ⚠️ 记录偏差：首次实施未先产本文件、未走阶段三规划验证就直接改了代码（老大 17:25 点名
> 「漏流程了」）。本文件与 `compliance_report.md` 为事后补做，代码已按本文件回核一遍，
> 不一致处以本文件为准修正。

## 一、目标重述

`website/src/sections/features.tsx` 由「左侧 176px tab 列表 + 右侧单条面板」整体换成
**单张全宽大图 + 标题浮层**的 banner 轮播。tab 的 `role="tablist" / tab / tabpanel` 语义与左侧栏
一并拆掉，不做并存。

范围只有这一个板块，`#features` 锚点、`site.ts` 文案、其它板块一律不动。

## 二、现状勘察（阶段一结论）

| 项 | 实测（2026-10-26） |
|---|---|
| 布局 | 宽屏 `lg:grid-cols-[minmax(0,176px)_minmax(0,1fr)]`；窄屏横向滚动 tab |
| 切换输入 | 点击 tab + hover（`HOVER_DELAY_MS=90`）+ 自动轮播（`AUTOPLAY_MS=3500`） |
| 轮播刹车 | 鼠标在区块内 / 键盘焦点在区块内 / 不在视口（`IntersectionObserver threshold: 0.4`） |
| 键盘 | roving tabindex + 方向键 |
| 面板比例 | `PANEL_ASPECT = '2520 / 1608'` |
| 条目数 | **8 条**（原文档写 9 条，含已删的「桌面控制」，本轮已订正） |
| 素材尺寸 | 不统一：**5 张** 2520×1608 / 1688×1050 ×1 / 1842×1251 ×1 / 1226×1263 竖版 ×1 |
| 素材体积 | 8 张合计 **≈1.2 MB**（最大 `goal_chat.png` 315 KB、`scheduled-task.png` 241 KB） |
| 锚点依赖 | `components/section-rail.tsx:47-52` 只 `getElementById` + `getBoundingClientRect`，不看内部结构；`:63` 已有 `ResizeObserver(body)` 兜高度变化 ⇒ **无需改动** |
| `AssetPlaceholder` 调用方 | 全站**只有 1 处**：`quick-start.tsx:120`（`advantages.tsx:6` 只是「已不再引入」的注释） |
| `index.css` 里的 features 样式 | **无**（命中的 `.doc-prose ul.feature-grid` 是文档页的）。全局 `.reveal` + reduced-motion 兜底可直接复用 |

## 三、形态定稿（引 `requirements/S-227.md` §4）

单张全宽大图 + 文字浮层叠在图上；3.5s 自动轮播保留；8 条不分组；箭头 + 指示点都有；
375px 窄屏文字挪到图下方。

## 四、实施步骤清单

现状：12 步全部完成。`compliance_report.md` 提的 2 条 ❌ 已在步骤 13 修完。

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | `components/ui.tsx` 把 `assetSources` 由 `const` 改 `export`（+5 行注释） | `cd website && npm run typecheck` 零错误；`quick-start.tsx:120` 的 `AssetPlaceholder` 渲染不变 | ✓ |
| 2 | 重写 `sections/features.tsx` 骨架：状态（`active/hovered/focused/inView/cycle/seen`）+ 舞台容器 + 8 张 slide 绝对叠放 + `opacity` 交叉淡入 | 页面渲出第 1 张图；点指示点能换图；`role="tablist/tab/tabpanel"` 在文件内 0 命中 | ✓ |
| 3 | 自动轮播 effect 沿用 + **焦点刹车改判 `:focus-visible`**（见 §六 风险 4） | 静置 3.5s 自转；鼠标移入停转；移出续转；**点一次指示点后移开鼠标，3.5s 仍续转到下一张**；超宽矮窗口（3440×900）也自转 | ✓ |
| 4 | 宽屏文字浮层：绝对定位压图底部 + 底部渐变 + `reveal` 重放 | 浮层 `position:absolute`，不额外占高；切换时文字重放淡入 | ✓ |
| 5 | 窄屏文字卡：`sm:hidden`，图下方独立卡片 | 375px 下浮层 `display:none`；文字卡 `getBoundingClientRect().top ≥ 图区 bottom` | ✓ |
| 6 | 左右箭头：绝对定位、宽屏 hover 或键盘聚焦才浮现、窄屏常显 | 宽屏初始 `opacity:0`；hover 后可见；窄屏常显；`focus-visible` 时也可见 | ✓ |
| 7 | 指示点：常驻、当前项拉长成短横条、`aria-current` | 点哪个跳哪个；非当前点与白底对比 ≥ 3:1（`bg-ink-900/55`） | ✓ |
| 8 | 键盘：容器 `tabIndex=0` + 左/右方向键翻页（替换原 roving tabindex） | Tab 到板块后按左右键能翻页，且页面不横向滚动 | ✓ |
| 9 | 懒挂载：`seen` 集合只给看过的条目建 `<img>`，首张 `eager` 其余 `lazy`；进入视口 1.5s 后预取下一张 | 首屏网络面板 ≤ 2 张图请求；切换到任意已预取项无空白帧 | ✓ |
| 10 | 无障碍：`role="group"` + `aria-roledescription="carousel"` / `"slide"` + 活动项 `aria-label` + 其余 `aria-hidden`；箭头与指示点各有 `aria-label` | Chrome DevTools 无障碍树里容器可读出 carousel 角色；指示点每个可读出「第 N 项：名称」 | ✓ |
| 11 | 门禁：`cd website && npm run typecheck` + `npm run build` | 均零错误（`build` 内含 `tsc --noEmit`，不重复列） | ✓ |
| 12 | 文档回填：`raw-requirements.md` 状态、`S-227.md` §6 §7 §8、`plan.md` 需求索引、`changelog.md` 两条裁定 | 四处状态一致；S-227 有「代价与取舍」「刻意不做」两段 | ✓ |
| 13 | **切点未测出的两条阻断项已修**：① 焦点刹车改 `:focus-visible`（点击后不再永久停转）② 补 S-227 §6 §7 两段；另补 ⚠️ 6 条（IO 阈值 0.4→0.25、指示点对比、预取下一张、CRLF、plan.md「9 条」、`section-rail.tsx:60` 过期注释） | 见 `compliance_report.md` §七 两条 ❌ 的「建议改法」逐条对照 | ✓ |

## 五、涉及文件

| 动作 | 文件 |
|---|---|
| 改 | `website/src/components/ui.tsx`（`assetSources` 加 `export`） |
| 重写 | `website/src/sections/features.tsx`（169 → 226 行，在 200~500 区间，无需 500 行豁免头） |
| 改 | `website/src/components/section-rail.tsx:60` 注释（「features 切 tab」已过期，一行） |
| 改 | `docs/plans/iter-v3-2/requirements/S-227.md`（条目数订正 + §6 §7 §8） |
| 改 | `docs/plans/iter-v3-2/raw-requirements.md`（S-227 状态列） |
| 改 | `docs/plans/iter-v3-2/plan.md`（需求索引状态列 + 风险 4 的「9 条内容」） |
| 改 | `docs/plans/iter-v3-2/changelog.md`（10:14 取 A·替换、17:08 形态定稿两条裁定） |
| 新建 | `docs/plans/iter-v3-2/plan-s227/plan.md`（本文件） |
| 新建 | `docs/plans/iter-v3-2/plan-s227/compliance_report.md`（阶段三产物） |
| 后续 | `docs/plans/iter-v3-2/plan-s227/review_report.md`（阶段五）· `verification_report.md`（阶段六） |
| 后续 | `docs/PROGRESS.md`（迭代收尾时加 v3-iter-2 行） |

不碰：`content/site.ts`、`index.css`、其它 7 个 section、下载页 / 指引页、`vite.config.ts`。

## 六、风险与处置

| # | 风险 | 处置 |
|---|---|---|
| 1 | 8 张图全挂 DOM，首屏白吃 ≈1.2 MB | 步骤 9 懒挂载（`seen` 集合）+ 延迟 1.5s 预取下一张 |
| 2 | 素材尺寸不统一，舞台钉死比例后竖版图（微信遥控 1226×1263）被裁 | 一律 `object-cover object-center`，不为一张图引特殊分支；取舍已记入 `S-227.md` §6 |
| 3 | 浅色截图上压白字可读性不足 | 底部渐变 `from-ink-950/88 via-ink-950/50`，深压下 3 成高 |
| 4 | **焦点刹车把鼠标点击误判成「用户正在操作」** —— React `onFocus` 走 focusin 会从子按钮冒泡，点一次箭头 / 指示点就让 `focused=true` 且鼠标移开也不复位，3.5s 轮播永久停转 | `onFocus` 里判 `e.target.matches(':focus-visible')`：鼠标点击为 false、Tab 进来为 true（阶段三 ❌1 报出，已修） |
| 5 | 切到没看过的图先空一帧（`seen` 门控住 `<img>`） | 进入视口 1.5s 后预取下一张（早于 3.5s 自动翻页）；首屏请求仍 ≤ 2 张 |
| 6 | 无障碍退化（tablist 语义没了） | 步骤 10 换 carousel 语义；`aria-live` 不启用的理由记入 `S-227.md` §6 |
| 7 | 页面总高度膨胀（撞 2026-09-23「别撑到六千像素」） | 一屏一条、不分组、不分页；1440 视口净增 ≈ +90px（占预算 1.5%） |
| 8 | 引擎默认焦点环被 `outline-none` 抹掉 | 用 `focus-visible:ring-2 ring-accent/40` 补回 |
| 9 | `IntersectionObserver threshold: 0.4` 在超宽矮窗口（3440×900 ≈ 0.42）贴着阈值走，掉下去就永不轮播 | 降到 **0.25**（阶段三 ⚠️7 报出，已修） |
| 10 | 指示点非当前项 `bg-ink-700`（#e4e7ec）压白底 ≈1.2:1，肉眼几乎不可见 | 改 `bg-ink-900/55`（≈3.2:1）（阶段三 ⚠️6 报出，已修） |

## 七、参考源码

**无。** 官网自有组件，沿用旧实现（`features.tsx` 的轮播刹车 / `reveal` 节奏）的结构，
不参考任何外部项目，零依赖（不引轮播库、不引图标库，箭头用内联 SVG）。

## 八、阶段计划

| 阶段 | 状态 |
|---|---|
| 一 · 探索 | 完成 |
| 二 · 规划 | 完成（本文件，事后补做） |
| 三 · 规划验证 | 完成 —— `compliance_report.md`（PARTIAL，❌2 ⚠️13），❌ 已全修 |
| 四 · 执行 | 完成 —— 步骤 1~13 全过 |
| 五 · 审查 | 未开始 |
| 六 · 验证 | 未开始（真机：宽屏 / 375px / 键盘 / 轮播刹车 / 点击后仍续转） |
