# S-221 阶段六验证报告

> 验证人：实施者（老郑）
> 验证时间：2026-10-23 11:30 起
> 环境：Windows / node v24.14.1 / vite v8.3.0 / dev server `http://localhost:5280/`
> 手段：`npm run build` 门禁 + 内置浏览器 DOM 实测（模型无视觉能力，不靠截图目测，全部读计算样式与几何值）

**判定：PASS（编译门禁 + 行为实测全过）；观感项需老大过目**

---

## 一、门禁

| 命令 | 结果 |
|---|---|
| `cd website && npm run build` | **exit 0**；`tsc --noEmit` 0 错误；`vite build` 299 modules、293ms |
| BOM 扫描（3 个改动文件） | 全 False |
| 行数（`node split('\n')` 核准） | `section-rail.tsx` **100**、`App.tsx` 44、`site.ts` 298 —— 均远低于 500 行硬线 |

---

## 二、行为实测（视口 1079×956，`line = min(956 × 0.3, 420) = 286.8`）

### 2.1 形态与样式

| 项 | 实测值 | 期望 | 结论 |
|---|---|---|---|
| 导航存在 | `nav[aria-label="页内导航"]` 找到 1 个 | 1 | ✅ |
| 竖排 | `writing-mode: vertical-rl` | 竖排 | ✅ |
| 定位 | `position: fixed`、`z-index: 40`、`x=1029`、`w=26` | 低于顶栏 `z-50`、右侧贴边 | ✅ |
| 堆叠轴 | `ul` 的 `display: flex`、`flex-direction: row` | 竖排下沿 inline 轴上下堆叠 | ✅ |
| 实际排布 | 7 项 `x` 全为 1029、`y` 递增 280 / 320 / 372 / 448 / 524 / 564 / 628 | 单列竖排，非 7 列书脊 | ✅ |
| 条宽 | **26px**（16 行高 + 8 `pr-2` + 2 竖条） | ≤ 一列字宽级别 | ✅ |
| 选中项 | 「概览」`color: rgb(27,30,36)`、`font-weight: 600`、`border-right: 2px rgb(234,88,12)` | `ink-950` + 加粗 + accent 竖条 | ✅ |
| 未选中 | `oklab(... / 0.75)`、`weight 400`、`border-right: 2px rgba(0,0,0,0)` | 75% 透明、透明竖条占位 | ✅ |
| 与正文关系 | 正文内容右缘 **1015**、导航左缘 **1029** | 零遮挡 | ✅ **间隙 14px** |
| 7 项链接 | `#top` / `#value-ladder` / `#features` / `#advantages` / `#download` / `#quick-start` / `#faq` | 与 6 个既有锚点 + 新锚点逐一对上 | ✅ |

### 2.2 联动（10 步，`behavior: instant` 逐点定位）

> 首轮用默认 `scrollTo` 采到的是平滑滚动中间帧（`scrollY` 全部偏小），**测试本身无效**；关掉 `scroll-behavior` 后重测才有下表。

| 落点 | scrollY | 高亮 | 判定 |
|---|---|---|---|
| 页顶 | 0 | 概览 | ✅ |
| `value-ladder` + 40 | 588 | 它能干什么 | ✅（该块仅 195px 高，阈值线已越过它，属「线以上最后一个」语义） |
| `features` + 40 | 824 | 它能干什么 | ✅ |
| `advantages` + 40 | 1594 | 为什么是它 | ✅ |
| `download` + 40 | 2727 | 下载 | ✅ |
| `quick-start` + 40 | 3364 | 四步开始 | ✅ |
| `faq` + 40 | 3879 | 常见问题 | ✅ |
| 滚到底 | 3879 | 常见问题 | ✅（文末兜底生效） |
| **上滚回 `features`** | 824 | 它能干什么 | ✅ **无残影**（这是弃用 IntersectionObserver 的核心理由） |
| 回顶 | 0 | 概览 | ✅ |

板块实测偏移：`value-ladder` 548 / `features` 784 / `advantages` 1554 / `download` 2687 / `quick-start` 3324 / `faq` 3957。

### 2.3 三页隔离与窄屏

| 项 | 实测 | 结论 |
|---|---|---|
| `/guide` | `nav[aria-label="页内导航"]` = 0；`#top` = 0；原有「目录」nav 仍在 | ✅ |
| `/download` | 同上，均为 0 | ✅ |
| `/`（390×844 移动模拟） | `display: none`、`rect 0×0`、无横向溢出（`scrollWidth = clientWidth`） | ✅ |

---

## 三、未覆盖 / 待老大过目

- **hover 手感**：`transition-colors` + `motion-reduce:transition-none` 类名已验，但「移上去顺不顺」只能人眼看。
- **平滑滚动观感**：全局 `scroll-behavior: smooth` 下点击各项的滚动节奏，需人眼判断。
- **视觉密度**：1024–1280 区间导航与正文的呼吸感是否舒服，需人眼判断（几何上已确认零遮挡）。
- **阶段五补充的 `ResizeObserver`**：未构造「切 tab / 展手风琴后不滚动」场景实测，属静态推演修法。

---

## 四、结论

**PASS**：编译门禁全绿，形态、联动、隔离、窄屏四类行为全部实测通过，与 plan 的语义一致。

观感三项（hover / 平滑滚动 / 密度）留给老大在 `http://localhost:5280/` 过目。
