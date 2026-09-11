# v2-iter-28：更新弹窗尺寸/全屏 与 后台悬浮窗位置

- 来源：老大 2026-09-11 装 v0.2.26 升 v0.2.27 真机实跑时发现（即 27 收尾移交的 **A4 真机升级验证** 项）
- 归属：`v2-iter-28`，建议立项为独立功能单元
- 状态：已按决议实施完毕，静态验证通过，待老大在 dev 目视复验（见文末「实施记录」）
- 行号按 2026-09-11 代码记录，实施前复核

## 缺陷 1：默认尺寸偏小，且全屏按钮根本没被看到

老大原话：①「更新弹窗还是没有全屏，以及默认高宽都太小」②「根本没看到这个全屏按钮」。

### 现状证据

- 默认尺寸：`src/renderer/src/components/updater/UpdateDialog.tsx:92` 的 `sm:max-w-3xl sm:min-h-[32rem]` = **768 × 512**。
- 全屏按钮：`UpdateDialog.tsx:125-143`，`variant="ghost" size="icon-sm"`、`Maximize2` 14px 图标，放在 `DialogHeader` 内右侧，且 header 带 `pr-10` 为基类的关闭 X 让位；关闭 X 在 `src/renderer/src/components/ui/dialog.tsx:62-67`，是 `absolute top-4 right-4`。**两个图标挤在右上角同一带里**，可发现性差 —— 这与"没看到"直接对应。

### 全屏本身另有 bug（⚠️ 代码分析结论，未经现场验证）

老大从未点击过该按钮，所以下面这条**尚未被症状证实**，修完才能验：

`UpdateDialog.tsx:96-106` 全屏时用 inline style 设 `top/left: 1rem`、`width/height: calc(100vw/vh - 2rem)` 和 `transform: 'none'`，意图是取消基类居中偏移。但基类 `dialog.tsx:56` 的居中用的是 `translate-x-[-50%] translate-y-[-50%]`，而项目是 **Tailwind v4（`package.json` `^4.3.3`）—— 这类工具编译成独立 CSS `translate` 属性，不受 `transform` 影响**。inline `transform: none` 压不住它，元素会在 `left: 1rem` 基础上再向左上各偏移自身一半，弹窗被推到可视区外。

对照：项目内已有跑通的全屏做法 `src/renderer/src/components/layout/change-diff-dialog.tsx:129-130` —— 纯 class `h-[92vh] w-[96vw] max-w-[96vw] sm:max-w-[96vw]`，完全不碰 inline transform。

### 决议（老大 2026-09-11 确认）

1. 默认尺寸改 **`sm:max-w-5xl`（1024px）+ `70vh`**，**保留全屏按钮**给长发布说明展开用（不采"默认即满屏、去掉全屏"那条路）。
2. 全屏改**纯 class 方案**，去掉 inline style：用 `translate-x-0 translate-y-0` 覆盖基类偏移，配 `h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none`。
3. **入口可发现性一并处理** —— 当前 14px ghost 图标与关闭 X 同处右上角，实测看不见。可加文字标签或移出 X 的争夺区（具体形态实施时定，需复测时老大认可）。

## 缺陷 2：后台下载悬浮窗在右下角，遮挡发送按钮

### 现状证据

`UpdateStatusBanner.tsx:60`：`fixed right-4 bottom-4 z-40 ... max-w-sm` —— 右下角，正盖在输入区的发送会话按钮上。该 banner 有意不做关闭按钮（`:15-23` 注释说明它存在的意义就是"状态不能变成用户看不见又回不来"），所以只能靠挪位置解决遮挡，不能靠加 dismiss。

### 决议（老大 2026-09-11 确认）

移到**左下角**，并与左侧面板底部"进入设置页"按钮留出距离。左侧面板宽度是运行时的，不能写死：

- `useUIStore` 的 `leftSidebarWidth`：默认 292，`clampLeftSidebarWidth` 限 272–420（`src/renderer/src/components/layout/right-panel-defs.ts:1-3`），拖拽改宽在 `workspace-sidebar-nav.tsx:10-37`
- 可整体收起：`leftSidebarOpen`（`src/renderer/src/stores/ui-store.ts:75-78`）
- 定位取 `leftSidebarOpen ? leftSidebarWidth + 16 : 16`，`bottom: 16`

**追加要求（老大 2026-09-11 补充）**：底部不要贴屏幕边，**离底再抬一点**（取 `bottom: 24`）。

实测记录，避免后人重复判断：为遮挡而抬底其实**不是必要防护** —— 设置按钮在 `WorkspaceSidebar.tsx:408-417` 的底部条内（`border-t px-2 py-1.5` + `py-1 text-xs`，含 14px 图标，条高约 37px），而侧边栏收起时整个 `<aside>` 在 `:179-181` **直接 `return null`**（注释原文"Collapsed state: completely hidden"），没有常驻图标窄栏，左下角收起后空无一物。展开态下 `left = leftSidebarWidth + 16` 已让悬浮窗整体越过侧边栏，设置按钮不可能被压。所以这 8px 是观感留白，不是防遮挡。

⚠️ 但**必须判 `leftSidebarOpen`**：`leftSidebarWidth` 在收起后仍保留上次数值（store 不清零），若不判这个布尔，收起侧边栏时悬浮窗会悬在 308px 处，左边空出一条突兀的带子。

## 验收标准

1. 打开更新弹窗即为 1024px 宽、约 70vh 高，未做任何操作就能读掉发布说明的多数内容。
2. 点全屏后弹窗真正撑满窗口、四边各留 1rem，无任何部分被推到屏幕外。
3. 全屏入口在关闭 X 之外可一眼识别，首次使用即能发现。
4. 触发后台下载后，悬浮窗出现在左下角，不遮挡发送按钮，也不遮挡侧边栏底部的设置按钮，且不贴屏幕底边（离底 24px）。
5. 收起左侧面板时悬浮窗贴左 16px，不留空档；拖宽拖窄侧边栏时悬浮窗跟随。
6. 报错态（`phase === 'error'`）与已下载态（`downloaded`，含"重启安装"按钮）在新位置同样不遮挡、不溢出。
7. 在 dev（`npm run dev:full`）里直接复测，不为验证 UI 改动重打包。

## 实施记录（2026-09-11）

### 改动

- `UpdateDialog.tsx:92` 默认尺寸 `sm:max-w-5xl sm:min-h-[70vh]`（原 3xl/32rem）。
- `UpdateDialog.tsx:90-97` 全屏改纯 class：`top-4 left-4 h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none translate-x-0 translate-y-0 sm:max-w-none grid-rows-[...] overflow-hidden`，删掉整段 inline style（含那句无效的 `transform:'none'`）。
- `UpdateDialog.tsx:125-136` 全屏入口改 `variant="outline" size="sm"` + 文字标签，文案提为 `fullscreenLabel` 供 label/title/文字三处复用；zh、en 的 `updater.dialog.fullscreen`/`exitFullscreen` 键已存在，无需补 i18n。基类按钮自带 `whitespace-nowrap shrink-0`，加文字不会换行，`pr-10` 仍给关闭 X 留出位置。
- `UpdateStatusBanner.tsx` 锚点改左下：去掉 `right-4`，`bottom-6`(24px)，`left` 用 inline style 承载 `leftSidebarOpen ? leftSidebarWidth + 16 : 16`。

### 实施中新发现：左下角已被 toast 栈占用

`App.tsx:217` 的 `<Toaster position="bottom-left">` 与本需求要落的角落是同一处。sonner 2.0.7 的容器为 `bottom:var(--offset-bottom)`（桌面默认 16px）、`z-index:9999`、单条宽 356px，全部高于 banner 的 `z-40`：侧边栏展开时与 banner 左侧重叠约 64px，**侧边栏收起时 banner 完全被 toast 盖住**——而 banner 存在的意义正是"状态不能变成用户看不见又回不来"。

**采法**：banner 可见时把 toast 栈抬高（`offset={{ bottom: 90 }}`），不改 toast 的默认位置与默认底距。判据与抬高量单点定义在 `UpdateStatusBanner.tsx`（`isUpdateBannerVisible` + `UPDATE_BANNER_TOAST_BOTTOM`），App.tsx 复用同一份，避免两处各写一遍 phase 列表；banner 内的 early return 也改用同一判据。无 banner 时 `offset` 传 `undefined`，由 sonner 自己回落默认值，不把默认值抄第二份。90 = 24 底距 + ~58 稳定高度（两行文案都是 `truncate`，高度不会飘）+ 8 间隙。

### 已做的验证（均为静态，未跑界面）

- `tsc --noEmit` 三配置零错误；`electron-vite build` 成功。
- updater 三套测试程序：`test:updater-state` 56、`test:updater-release-notes` 71、`test:updater-progress` 35，共 162 checks 全过。
- twMerge 合并探针：全屏态下 `top`/`left`/`translate-x`/`translate-y`/`max-w`（含 `sm:` 变体）/`w-h`/`overflow` 每项**只余一个类**，故不存在 CSS 源序争抢；默认态只余 `sm:max-w-5xl`。
- 构建产物 CSS 逐类确认已产出：`.translate-x-0` `.top-4` `.left-4` `.bottom-6` `.max-w-none` `.sm\:max-w-none` `.max-w-5xl` `.sm\:min-h-\[70vh\]` `.h-\[calc\(100vh-2rem\)\]` `.w-\[calc\(100vw-2rem\)\]`。
- **根因得证**：产物里 `.translate-x-0 { --tw-translate-x: 0px; translate: var(--tw-translate-x) var(--tw-translate-y); }` —— 确为独立 `translate` 属性，基类那句 inline `transform:'none'` 从头就不可能生效。

### 仍需老大目视复验（验收 1–6）

未做浏览器内几何验证的原因：本机正式版 Wishful Claw 正在运行（4 进程 + Worker），不往他的活动桌面里注合成点击（误落在"立即重启安装"上就是真事故）。dev 复测配方见 27 收尾移交记录：把 `package.json` 临时改 0.2.26 后 `npm run dev:full` 走真实检查，或直接给 `App.tsx:218/223` 注入假 `RendererUpdateState`；dev 里**别点"立即重启安装"**，验完 `git checkout package.json`。

## 与 A4 记账的关系

这次实跑证明了升级链路的**前半段可用**：装 0.2.26 能发现 0.2.27、能触发后台下载并看到进度。**下载确认之后的安装确认环节未提及**，A4 不得据此勾成完成。回填 27 的 `progress/v2-iter-27.md` 时按此措辞，并把上述两条缺陷挂到 28。
