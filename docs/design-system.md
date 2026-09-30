# 设计系统（Wishful Claw）

> 本文**以现有代码为准反向固化** —— 只描述已经存在的 token 与它们的用法，不引入新设计、不改造历史组件。
> 出处集中在两处：`src/renderer/src/assets/main.css`（Tailwind v4 CSS-first 配置 + 全局层）与 `src/renderer/src/lib/theme-presets/`（六套成品预设）。

## 一、这份文档怎么用

- **新增 UI 之前**先在这里查：这个颜色该用哪个 token、这个圆角该取哪一档。
- **review 时**把 §十 / §十一 当清单过一遍。
- 文档里每一条都标了出处文件；**代码与文档不一致时以代码为准**，并回来修文档。

---

## 二、配色

### 2.1 两层结构

配色分两层，**不要跨层用**：

| 层 | 位置 | 谁能改 |
|---|---|---|
| **预设层** | `theme-presets/{mulberry,studio,graphite,ocean,forest,dawn}.ts` | 用户在设置里选预设 / 明暗，**不是**改单个 token |
| **结构层** | `main.css` 的 `:root` / `.dark` | 只在做新预设时改；日常不动 |

运行时由 `applyThemePresetCssVars(root, preset, mode)`（`theme-presets.ts:70`）把预设的 `cssVars[mode]` 逐条写到 `document.documentElement` 的 inline style 上。**它先 `removeProperty` 掉全部已知 key 再写**（`:76-81`）—— 所以换预设不会留下上一个预设的残留值，这一点是刻意的。

### 2.2 语义 token（shadcn 层）

六套预设各提供同一套 **32 个**语义变量（见 `studio.ts:27-96`）。它们经 `main.css` 的 `@theme inline`（`:7-56`）映射为 `--color-*`，因此**在 Tailwind 里可以直接当 utility 用**。

| token | 角色 | 用在哪 | 不要用在哪 |
|---|---|---|---|
| `--background` / `bg-background` | 应用画布底色 | 页面最外层、空白区 | 卡片内部（那用 `--card`） |
| `--foreground` / `text-foreground` | 主文字色 | 正文、标题 | 次要说明文字（用 `--muted-foreground`） |
| `--card` / `bg-card` | 卡片、面板底 | 内容卡片、弹层内容区 | 页面底色 |
| `--card-foreground` | 卡片上的文字 | 卡片内正文 | 卡片外 |
| `--popover` / `bg-popover` | 浮层底 | 下拉、菜单、tooltip 容器 | 常驻面板 |
| `--popover-foreground` | 浮层文字 | 浮层内文字 | — |
| `--primary` / `bg-primary` | 品牌主色、主操作 | 主按钮、选中态、聚焦高亮 | 大面积背景填充 |
| `--primary-foreground` | 主色上的文字 | 主按钮文字 | — |
| `--secondary` / `bg-secondary` | 次级操作底 | 次要按钮、中性胶囊 | 主操作 |
| `--secondary-foreground` | 次级底上的文字 | — | — |
| `--muted` / `bg-muted` | 弱化区块底 | 只读区、代码块底、空状态 | 可点击元素的常态底 |
| `--muted-foreground` | 弱化文字 | 说明、时间戳、占位 | 正文 |
| `--accent` / `bg-accent` | 悬停 / 强调底 | 列表项 hover、当前项 | 主操作（那是 `--primary`） |
| `--accent-foreground` | 强调底上的文字 | — | — |
| `--destructive` | 危险 / 破坏性操作 | 删除按钮、错误态 | 普通警示（用工作区 `warning` 系列） |
| `--destructive-foreground` | 危险底上的文字 | — | — |
| `--border` | 结构边框 | 分割线、卡片描边、输入框描边 | 阴影（用 shadow token） |
| `--input` | 输入控件描边 | 表单控件 | 通用边框 |
| `--ring` | 聚焦环 | `:focus-visible` 环、聚焦态描边 | 常态描边 |
| `--chart-1` … `--chart-5` | 图表色序 | 折线 / 柱状 / 饼图的第 1~5 序列 | 任何非图表场景 |
| `--sidebar*`（8 个） | 左侧栏专属一套 | 侧栏自身的底 / 文字 / 主色 / 强调 / 描边 / 聚焦 | 主内容区（主内容区用非 sidebar 那一套） |

**`--sidebar-*` 为什么单开一套**：侧栏底与主画布不是同一个色阶（`studio` 暗色下 `--sidebar: #162032` vs `--background: #101726`），直接拿 `--background` 刷侧栏会让两层糊在一起。

### 2.3 面板与工作区 token（**不进 Tailwind utility**）

下面这些**没有** `--color-*` 映射，只能在 CSS 里 `var(--x)` 使用，或写进组件的 `style`：

| 组 | token | 出处 |
|---|---|---|
| Composer（输入区） | `--composer-shell-top` / `-bottom` / `-border` / `-border-focus` / `-shadow` / `-shadow-focus` / `-glow`、`--composer-editor-surface` / `-strong` / `-border`、`--composer-toolbar-border`、`--composer-panel-bg` / `-border` / `-shadow`、`--composer-control-bg` / `-bg-hover` / `-border` / `-shadow` / `-active-bg` / `-active-border` / `-active-text`、`--composer-send-start` / `-end` / `-shadow` / `-shadow-hover` / `-foreground`、`--composer-chip-bg` / `-border` / `-text` / `-hover`、`--composer-drop-bg`、`--composer-placeholder`、`--composer-suggestion` | `main.css:106-144`（亮）、`:206-239`（暗） |
| 工作区文件树 | `--tree-row-height`（30px）、`--tree-row-radius`（7px）、`--tree-row-hover-bg`、`--tree-row-current-bg` / `-fg` / `-icon` / `-marker`、`--tree-guide-color`、`--workspace-filetree-bg` / `-divider` / `-empty-bg` | `main.css:147-157`、`:242-252` |
| Agent 文件面板 | `--agent-files-panel` / `-fg` / `-muted` / `-border` / `-hover` / `-icon` / `-added` / `-deleted` / `-conflict` / `-modified` | `main.css:158-167`、`:253-262`；`--color-agent-files-*` 映射在 `:40-49` |

`--agent-files-added` / `-deleted` / `-conflict` / `-modified` 是**文件变更语义色**（绿 / 红 / 琥珀 / 蓝），与 `--destructive` 不是一回事：前者描述「这个文件被加/删/冲突/改了」，后者描述「这个操作有破坏性」。

### 2.4 SSH 专属调色板

SSH 工作区不走 CSS 变量，走一份 TS 结构 `SshChromePalette`（`types.ts:19-62`，**40 个键**），由 `getSshChromePalette(preset, mode)` 取用。

分四组：`library*`（连接库）/ `connect*`（连接表单）/ `terminal*`（终端外壳）/ 通用 `canvas`·`panel`·`surface`·`text`·`muted`·`accent`·`success`·`warning`·`danger` 各带 `Soft` 变体，外加四类胶囊 `libraryPill*` / `connectPill*` / `terminalPill*`。

**为什么不复用 §2.2 的语义 token**：SSH 页面里同时存在三块视觉上互不相干的区域（库、表单、终端），它们需要各自的底与描边；而终端区域本身是「深色无论明暗模式」的（`studio` 亮色下 `terminalFrame: #191f35`）。用一套语义色硬刷会串味。

### 2.5 终端主题

xterm.js 用 `ITheme`（`terminal-theme.ts`），**不是 CSS**：`background` / `foreground` / `cursor` / `cursorAccent` / `selectionBackground` + 标准 16 色（`black`…`white` 与 `bright*`）。

由 `getTerminalTheme(preset, mode)`（`theme-presets.ts:62`）取用。改终端配色时**在预设文件里改**，不要在组件里内联色值。

---

## 三、字体

| 项 | 值 | 出处 |
|---|---|---|
| 字族 | `--app-font-family`，默认 `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, …` | `main.css:103` |
| 基准字号 | `--app-font-size`，默认 `14px` | `main.css:102` |
| 用户可覆盖 | 字族与字号都在设置里可改 | `ThemeRuntimeSync.tsx:34-44`、`theme-sync.ts:101-106` |

两条**结构事实**，改样式前必须知道：

1. **`html { font-size: var(--app-font-size) }`**（`main.css:269-271`）—— 用户把字号调大，**全部 rem 尺寸一起缩放**。所以：组件尺寸优先用 rem / Tailwind 默认步进，**不要写死 px**，否则用户调字号时那一块会不跟随，视觉上「卡住」。
2. `body` 上挂了 `-webkit-font-smoothing: antialiased` 与 `-moz-osx-font-smoothing: grayscale`（`main.css:277-278`）—— 新组件不需要重复声明。

独立窗口（如文件搜索）不继承主窗体的 `html` 规则，**必须自己声明**：`renderer/file-search.html:20-21` 就是显式 `var(--app-font-family)` + `var(--app-font-size)`。新增独立窗口照抄这个写法。

---

## 四、间距

项目**没有**自定义 spacing scale（无 `tailwind.config.*`，`main.css` 的 `@theme inline` 里也没有 `--spacing`）⇒ 一律使用 **Tailwind 默认步进**（`1 = 0.25rem`）。

- 优先用默认步进的**整数倍**，别写 `p-[7px]` 这类一次性魔数。
- 数字要能被 `--app-font-size` 缩放 ⇒ 用 `p-2` / `gap-3`，**不要** `p-[8px]`（见 §三.1）。
- 行高这类必须精确到像素的（`--tree-row-height: 30px`）已经 token 化，用 token 不要另写。

---

## 五、圆角

四档由**一个基数**推导（`main.css:50-53`）：

| 档 | 计算 | 默认值 | 用于 |
|---|---|---|---|
| `--radius-sm` | `--radius - 4px` | 6px | 小控件：胶囊、徽标、小按钮 |
| `--radius-md` | `--radius - 2px` | 8px | 控件：按钮、输入框 |
| `--radius-lg` | `--radius` | 10px | 容器：卡片、面板 |
| `--radius-xl` | `--radius + 4px` | 14px | 大容器：对话框、抽屉 |

基数 `--radius: 0.625rem`（`main.css:101`）**只在 `:root` 定义，不在预设的 `cssVars` 里** ⇒ 圆角**不随配色预设变化**，六套预设的圆角完全一致。

**已批准的例外**（都有明确理由，不要顺手"统一"掉）：

| 例外 | 值 | 理由 | 出处 |
|---|---|---|---|
| Composer 项目态 | `1.375rem`（22px） | 输入区是产品的视觉中心，用比 `xl` 更圆的外形与内容区拉开 | `main.css:400-402` |
| Composer 会话态 | `1.0625rem`（17px） | 会话内输入区比项目态收敛一档 | `main.css:404-406` |
| Composer 贴底态 | 底部两角归零 | 输入区与下方内容连成一片时，圆角会切出一道假的边界 | `main.css:408-411` |
| 树行 | `--tree-row-radius: 7px` | 行高只有 30px，套 10px 会让圆角吃掉半行 | `main.css:148` |
| 滚动条 | `999px` | 胶囊形 | `main.css:311` |

---

## 六、尺寸

- **基准**：`--tree-row-height: 30px` 是唯一被 token 化的行高（`main.css:147`）—— 树 / 列表类行高对齐它。
- **规则**：能跟着 `--app-font-size` 缩放的一律用 rem / Tailwind 步进；只有「必须精确」的尺寸（行高、滚动条宽）才写 px 并 token 化。
- **滚动条**：全站 `5px`（`main.css:302-305`），且 xterm 需要 `!important` 才能压到 5px（`:327-345` 有解释：xterm 把 14px 内联写死）。新增自定义滚动容器时不要另开宽度。

---

## 七、层次与景深

- **景深靠阴影 + 底色的组合**，不靠边框堆叠：`--composer-shell-shadow`（常态）与 `--composer-shell-shadow-focus`（聚焦）成对，`--composer-panel-shadow` 同理。
- 聚焦态同时改**描边**与**阴影**（`main.css:395-398`）—— 只改其中一个在深色预设下会看不出来。
- 阴影色一律走 `color-mix(...)` 或带 alpha 的黑，**不写实色**，否则换预设时会显脏。

---

## 八、动效

| 项 | 值 | 出处 |
|---|---|---|
| 折叠展开 | `--animate-collapsible-down` / `-up`，`0.2s ease-out` | `main.css:54-55` |
| 滚动条 hover | `background 0.2s` | `main.css:312` |
| 全局滚动行为 | `scroll-behavior: smooth` | `main.css:289-293` |

**`scroll-behavior: smooth` 是全局的**，写在 `@layer base` 的通配符上。需要**程序化跟随**（流式输出时自动滚到底）的容器必须显式给 `scroll-auto`，否则会跟动画打架 —— `main.css:285-288` 记录了这条踩坑（iter-30 修聊天窗滚动时只能靠 inline style 硬顶）。

---

## 九、无障碍与国际化

- **聚焦必须可见**：用 `--ring`，且**同时**改描边与阴影（§七）。隐藏 `outline` 前先给出替代的聚焦表现。
- **悬停态的动作面要用 `group-focus-within`，不是 `group-focus-visible`**：容器本身不可聚焦时，键盘用户 Tab 到里面的按钮会停在「看不见」的状态上（S-162 的 `ImagePreview` 按此口径实现）。
- **文字与底色的对比**由预设保证，新增预设时六套语义 token 要**成对**给（`x` 与 `x-foreground`），不能只给一半。
- 界面文案走 i18n（`src/renderer/src/locales/{en,zh}/`），**不要内联中英文字面量**；中英文之间加空格。

---

## 十、Do

1. 颜色**只用语义 token**（`bg-background` / `text-muted-foreground` / `border-border` …），新预设不该要求改组件。
2. 尺寸用 **rem / Tailwind 默认步进**，让 `--app-font-size` 能带着整页缩放。
3. 圆角从 `--radius-sm/md/lg/xl` **四档里选**，基数变了全站一起变。
4. 聚焦态**描边 + 阴影一起给**。
5. 悬停才出现的动作面，用 **`group-focus-within`** 让键盘也能到达。
6. 独立窗口**自己声明** `--app-font-family` / `--app-font-size`（照 `file-search.html`）。
7. 面板类 token（composer / tree / agent-files）**只能在 CSS 或 style 里用**，它们没有 `--color-*` 映射。
8. 改终端配色**去预设文件改**，别在组件里内联。
9. 用户可见文案走 i18n。
10. 新增 token 时，**明暗两档都要给**，并同时登记进本文档。

## 十一、Don't

1. **不要写死十六进制色值**（`#3558e8`）—— 换预设就是一块不合群的色斑。
2. **不要用 `--primary` 刷大面积背景**，它是主操作色不是画布色。
3. **不要拿 `--destructive` 当普通警示**（文件冲突用 `--agent-files-conflict`）。
4. **不要在 `main.css` 的 `@layer base` 外写通配符规则** —— 会盖住所有组件样式（`:285-288` 的踩坑）。
5. **不要给 xterm 另设滚动条宽度**，它有内联 14px，必须 `!important`。
6. **不要用 `px` 写常规尺寸**，用户调字号时会卡住不跟随。
7. **不要新增圆角档位** —— 例外要先写进 §五 并说明理由。
8. **不要在组件里复制预设的色值**，预设是唯一来源。
9. **不要把 `--sidebar-*` 用进主内容区**（两者色阶不同）。
10. **不要用 `group-focus-visible` 做悬停动作面的显形条件**（§九）。
