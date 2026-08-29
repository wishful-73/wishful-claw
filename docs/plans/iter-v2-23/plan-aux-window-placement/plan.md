# Plan：额外窗体多屏定位与生命周期修复

状态：规划中，等待规划合规审查与用户确认
日期：2026-08-29
分支：`dev/v2-iter-23`

## 目标

在不触碰主窗体聊天逻辑的前提下，修复快速搜索启动器与剪贴板增强窗口的 Windows 多屏定位、快速搜索瞬时失焦误隐藏，以及剪贴板窗口靠近当前系统输入框/caret 的定位问题；保留已有 Esc、外部点击、启动应用、粘贴和焦点恢复行为。

## 产品边界

- 快速搜索和剪贴板窗口由快捷键唤起时，优先落在快捷键触发前键盘焦点所在的显示器。
- 所有候选位置必须限制在目标显示器 work area 内，兼容负坐标和任务栏。
- 快速搜索 blur-hide 改为“初始 grace period + 延迟确认”：窗口重新获得焦点时取消待隐藏；确认仍失焦后才隐藏。
- 剪贴板定位优先使用系统当前焦点控件的 caret 矩形；不可用时回退焦点窗口/前台窗口中心，再回退目标屏幕工作区中心。
- 本阶段不实现主窗体聊天输入框坐标上报，不新增主窗体 renderer ↔ main IPC。
- 用户人工确认 Windows/Electron 实测通过后再提交本功能单元；计划执行期间只 commit 不 push，Plan 完成后按工作流处理 push。

## 步骤清单

### 步骤 1：定位策略与共享坐标模型

- [ ] 在 `src/main` 内实现最小内聚的窗口定位辅助逻辑，或在两个入口文件内以明确函数实现。定位输入分两类：
  - 启动器：`focusWindowRect` > `foregroundWindowRect` > 快捷键触发时的鼠标点 > 主屏工作区中心；目标显示器以焦点/前台窗口矩形所在屏为优先，不以 caret 作为唯一依据。
  - 剪贴板：有效屏幕 caret rect > `focusWindowRect` > `foregroundWindowRect` > 快捷键触发时的鼠标点 > 主屏工作区中心。
- [ ] 用 `screen.getDisplayNearestPoint()` 或 `screen.getDisplayMatching()` 获取显示器；用 Electron `Display.workArea`（x/y/width/height）计算居中、caret 下方/上方偏移和矩形 clamp。
- [ ] bridge 上报的原生坐标统一标注为 screen-physical；进入 Electron 定位前使用 `screen.screenToDipRect(null, rect)` 转为 DIP，再与 `Display.workArea` / `BrowserWindow` bounds 运算。Electron API 的 `screen`/`Display` bounds 与 work area 使用 DIP 坐标，不能直接混用 Windows 物理像素。
- [ ] 处理无效 HWND、无效/空 caret、显示器热插拔或矩形完全不可见时的回退；所有路径最终限制在目标 display work area 内。
- 验证检查点：静态检查确认启动器与剪贴板使用各自回退顺序、所有新增位置计算最终经过 work area clamp；无主窗体聊天文件改动；`git diff --check` 和 node TS 配置通过。

### 步骤 2：快速搜索启动器多屏定位与 blur 生命周期

- [ ] 修改 `src/main/quick-launcher.ts` 的创建与复用显示路径：快捷键唤起时选择当前焦点所在屏幕，初次创建和再次显示使用同一定位函数。
- [ ] 保留 `forceActivateWindow()`、`show` 事件中的 reset 和已有 renderer focus 重试；不改动已有 Windows 激活桥的语义。
- [ ] 为 blur-hide 增加窗口显示/激活后的短暂 grace period（具体毫秒数在实现前依据现有 30ms 激活延迟和 Windows 实测确定，并定义为命名常量）；blur 触发时仅安排延迟确认，不立即隐藏。
- [ ] 延迟确认区分两类情况：
  - 若窗口在确认前重新获得焦点，取消待隐藏；
  - 若确认时仍失焦，且鼠标位于 launcher bounds 外或当前前台已明确是其它应用，则执行正常外部点击/失焦关闭；若仍处于显示激活 grace period 或检测到窗口正在重新激活，则继续等待一次，不把瞬时切焦误判为关闭。
- [ ] 在 `focus`/`show`/再次激活时清理待隐藏 timer；主动 Esc、启动应用、内部显式关闭保持立即关闭；外部点击保持关闭但允许短暂确认延迟。
- [ ] 避免 timer 残留、窗口销毁后回调访问和重复 show/hide 竞态；`hide`/`close`/`will-quit` 路径统一清理 timer。
- 验证检查点：启动器重复唤起、唤起后瞬时 blur、延迟内重新 focus、点击外部后保持失焦、点击外部后立即回到 launcher、Esc、启动应用、连续快捷键等路径静态/运行验证；三套 TypeScript 检查与 `git diff --check` 通过。

### 步骤 3：Windows bridge 回传 caret 屏幕矩形

- [ ] 修改 `src/main/priority-shortcuts.ts` 的 `ShortcutContext`、`BridgeMessage` 和内联 C# bridge 输出，形成明确可选契约：
  - `foregroundWindow`、`focusWindow` 保持现有语义；新增 `foregroundWindowRect`、`focusWindowRect`，均为 `{ x, y, width, height } | null`，单位为 screen-physical；
  - 新增 `caretRect` 为 `{ x, y, width, height } | null`，单位为 screen-physical；不传 `hwndCaret` 作为定位依据，仅可作为 bridge 内部转换句柄或诊断字段；
  - `GUITHREADINFO.rcCaret` 需结合 `hwndCaret` 正确转换：先验证 `hwndCaret`/矩形有效；rcCaret 按 Win32 定义是相对于 hwndCaret 的客户区逻辑坐标，因此将左上角和右下角分别通过 `ClientToScreen(hwndCaret, ...)` 转为屏幕物理像素，重建 `{ x, y, width, height }`；禁止直接把 rcCaret 当作 Electron 坐标，禁止用 `focusWindow` 替代 `hwndCaret`；
  - 窗口矩形通过 `GetWindowRect` 获取；句柄无效、API 失败或宽高非正时输出 null；
  - 保持现有 `foregroundWindow`、`focusWindow`、焦点恢复、Paste/ActivateOnly、Alt 兼容层不变；
  - 保持 bridge 不可用时 `globalShortcut` fallback 的兼容行为，新增字段使用 null，不伪造 caret/窗口矩形。
- [ ] 在主进程 JSON 解析处兼容新字段，并在进入 Electron 定位前将 screen-physical rect 用 `screen.screenToDipRect(null, rect)` 转成 DIP；若转换 API 在当前 Electron 类型/运行时不可用，必须在步骤实现前确认替代的 per-monitor DPI 转换方案，不得静默混用两种坐标。
- 验证检查点：bridge 脚本文本可生成，PowerShell/C# 结构和 TypeScript 类型一致；Windows native bridge 启动、快捷键回调输出包含有效/无效 caret 与窗口矩形两类结果；混合 DPI/负坐标下转换后与 Electron display work area 同一坐标系；三套 TypeScript 检查通过。

### 步骤 4：剪贴板增强按 caret/焦点上下文定位

- [ ] 修改 `src/main/clipboard-enhancer.ts`：快捷键回调接收 caret/焦点/前台窗口屏幕矩形及必要上下文，并在创建/复用窗口前计算目标 bounds。
- [ ] 定位优先级：
  1. 有效 caret 矩形：优先显示在 caret 下方并按窗口宽高避让；若下方空间不足则切到上方；
  2. 无 caret 时使用 focus window rect 的中心/边缘；
  3. 无 focus window rect 时使用 foreground window rect 的中心/边缘；
  4. 无窗口几何信息时使用快捷键触发时记录的鼠标点；
  5. 最终使用主显示器 work area 中心。
- [ ] 对每种定位结果统一执行 work area clamp；窗口不能超出目标显示器工作区；混合 DPI 下先完成 screen-physical → Electron DIP 转换再计算。
- [ ] 保持现有 previous foreground/focus 保存、主动隐藏焦点恢复、blur 被动隐藏不恢复、粘贴顺序和 renderer 交互不变。
- 验证检查点：在传统 Win32 输入框、浏览器/Electron 输入框、无 caret 普通窗口和多屏负坐标场景检查位置；剪贴板粘贴目标和焦点恢复不回退；三套 TypeScript 检查通过。

### 步骤 5：审查、完整验证与人工验收

- [ ] 启动独立审查，检查范围是否越界、坐标系/工作区处理、timer 生命周期、bridge fallback、权限失败回退和是否误改主窗体。
- [ ] 运行静态验证：
  - `git diff --check`
  - `npx tsc --noEmit -p tsconfig.web.json`
  - `npx tsc --noEmit -p tsconfig.node.json`
  - `npx tsc --noEmit -p tsconfig.json`
- [ ] 如 docs/脚本要求，执行 `npm run build` 或对应 Electron build；涉及 PowerShell native bridge，至少执行一次真实 Electron/Windows 启动与快捷键冒烟。
- [ ] 人工验证矩阵：
  - 单屏：快速搜索与剪贴板正常显示、Esc/外部点击/启动应用行为正常；
  - 双屏/多屏：焦点在不同屏幕时分别唤起，窗口落在对应屏幕 work area；主屏在右侧/左侧、负坐标、不同 DPI；
  - 启动器：显示后瞬时 blur 不误隐藏；真正点击外部仍隐藏；重新 focus 可取消待隐藏；连续快捷键不闪退/不残留 timer；
  - 剪贴板：Win32 文本框 caret 下方/上方避让；浏览器/Electron 无 caret 时合理回退；粘贴内容仍进入原输入控件；
  - bridge 降级：bridge 启动失败或 caret 无效时仍能唤起，使用合理屏幕回退，不注入错误坐标。
- [ ] 产出本计划目录下 `review_report.md` 和 `verification_report.md`，记录工具输出、Windows 实测结果和未覆盖限制。
- [ ] 等待用户对 PASS/FAIL/PARTIAL 作最终裁定；用户确认 PASS 后再按工作流完成提交/推送，不自行宣告 Plan 完成。

## 涉及文件

### 预期产品代码

- `src/main/quick-launcher.ts` — 多屏定位、blur grace period、延迟确认、timer 清理。
- `src/main/clipboard-enhancer.ts` — 按 caret/焦点上下文计算窗口 bounds，复用定位回退。
- `src/main/priority-shortcuts.ts` — Windows bridge 回传 caret 屏幕矩形及主进程类型兼容。
- 如确需拆分：新增 `src/main/aux-window-placement.ts`，仅包含显示器 work area、矩形 clamp 和定位纯函数；是否新增由步骤 1 的实际耦合度决定。

### 明确不涉及

- `src/main/index.ts` 注册顺序无需改变，除非验证发现初始化时序问题。
- `src/renderer/src/launcher/main.tsx` 与 `src/renderer/src/clipboard/main.tsx` 原则上不改；只有发现窗口生命周期需要 renderer 协作时才做最小兼容调整。
- 主窗体聊天 renderer、输入框坐标上报 IPC、Agent/Goal/Plan、`preToolPhase`、构建产物均不在本计划内。

## 参考源码

- ZTools：`D:\claw\ZTools-main\src\main\managers\windowManager.ts` — `getDisplayAtCursor`、`moveWindowToCursor`、`showWindow`、`forceActivateWindow`、blur 抑制与延迟隐藏。
- ZTools：`D:\claw\ZTools-main\src\main\api\renderer\window.ts`、`src\renderer\src\App.vue` — 显示后 focus、动态窗口尺寸。
- Ditto：`D:\claw\Ditto\src\ExternalWindowTracker.cpp` — active/focus 分离、`FocusCaret`、`GetGUIThreadInfo`、焦点恢复。
- Ditto：`D:\claw\Ditto\src\Misc.cpp` — `EnsureWindowVisible`、`CenterRect`、`rcWork` 边界修正。
- Ditto：`D:\claw\Ditto\src\DPI.h` — DPI 缩放经验偏移。
- 项目流程：`docs/dev-workflow.md`、`AGENTS.md`、`docs/iteration-plan.md`。

## 验收标准

- 多屏下两个辅助窗口不再固定主屏；位置始终在目标 display work area 内。
- 快速搜索的瞬时 blur 不再导致唤起后自行隐藏；用户主动关闭行为保持。
- 剪贴板窗口在可取得 caret 时靠近当前系统输入框；不可取得时有可预测回退。
- 快捷键 bridge/粘贴/焦点恢复现有行为不回退；bridge/caret 失败不造成错误坐标或错误粘贴。
- 三套 TypeScript 检查、`git diff --check`、必要的 Electron/Windows 实测完成并留存报告。
- 本次提交只包含本计划相关文件，不重新加入 `.build-check` 或其他构建产物。
