# 探索结论：额外窗体多屏定位与生命周期修复

日期：2026-08-29
分支：`dev/v2-iter-23`
基线：`05ff7fe2 fix: harden IME input and remove planning status bar`

## 1. 当前工作区状态

- `git status --short --branch`：工作区干净，当前分支为 `dev/v2-iter-23`。
- 最近提交保留 `05ff7fe2` 与基线 `1741329`，本探索未修改产品代码。
- 本次范围仅包含快速搜索启动器、剪贴板增强、Windows 快捷键上下文桥接及对应验证；不触碰主窗体聊天逻辑、`preToolPhase` 或 `.build-check` 构建产物。

## 2. 当前 Wishful Claw 实现

### 2.1 快速搜索启动器

文件：`src/main/quick-launcher.ts`

- `createLauncherWindow()` 复用单个 `BrowserWindow`。
- 现有窗口创建位置直接取 `screen.getPrimaryDisplay().workAreaSize`，窗口初始位置固定为主屏中心附近（约 871-879 行）。
- 已有 Windows `forceActivateWindow()`，窗口显示后约 30ms 再次激活并发送 `launcher:reset`（约 903-910 行）；首次创建后也会立即 show/focus（约 919-922 行）。
- renderer `src/renderer/src/launcher/main.tsx` 已有：
  - 页面加载时输入框 focus；
  - 最长约 800ms 的 `requestAnimationFrame` focus 重试；
  - `launcher:reset` 后清空状态并重新 focus；
  - renderer window `focus` 后重新 focus 输入框。
- 当前仍有无条件 `launcherWindow.on('blur', () => launcherWindow?.hide())`（约 895-897 行）。这会把启动器显示/激活期间的瞬时失焦、其它应用抢焦点或系统窗口切换直接解释成用户主动关闭。
- 用户主动 Esc、启动应用后隐藏、点击外部导致的正常失焦关闭行为需要保留，不能简单取消 blur-hide。

### 2.2 剪贴板增强

文件：`src/main/clipboard-enhancer.ts`

- 快捷键回调当前只接收 `{ foregroundWindow, focusWindow }`，然后调用 `createClipboardWindow()` 保存恢复目标。
- 窗口创建和复用均直接以主屏工作区尺寸居中（约 360-368 行），未使用当前鼠标、前台窗口或焦点控件位置。
- `hideClipboardWindow()` 已采用 Ditto 风格的恢复顺序：主动隐藏时先尝试恢复目标窗口/控件焦点，再延迟隐藏；blur 被动隐藏不恢复外部焦点（约 312-341 行）。该链路应保持。
- 粘贴、Esc、双击、Enter、方向键等 renderer 交互已完成，不应在本计划中重复调整。

### 2.3 Windows 快捷键 bridge

文件：`src/main/priority-shortcuts.ts`

- `ShortcutContext` 和 `BridgeMessage` 当前只包含 `foregroundWindow`、`focusWindow`。
- PowerShell 内联 C# bridge 已定义 `GUITHREADINFO`，其中包含 `hwndCaret` 和 `RECT rcCaret`（约 71-83 行），但按键命中时只读取并回传 `hwndFocus`，没有回传 caret 信息（约 426-437 行）。
- bridge 已有 `GetGUIThreadInfo()`、`GetWindowThreadProcessId()`、`AttachThreadInput()`、`ClientToScreen()` 等能力可供扩展；焦点恢复的 `RestoreFocus()`、激活确认与 Alt 兼容层是现有功能，不能破坏。
- `globalShortcut` fallback 回调目前传 `{ foregroundWindow: null, focusWindow: null }`。因此 native bridge 不可用时，无法可靠得到外部窗口 caret；计划必须明确 fallback 仍使用当前显示器/合理默认位置，而不能伪造 caret 坐标。
- 坐标处理要求：`GUITHREADINFO.rcCaret` 应结合 `hwndCaret` 做客户区到屏幕坐标转换；不得直接把 `rcCaret` 当作屏幕坐标，也不得默认使用 `focusWindow` 替代 `hwndCaret`。

### 2.4 主进程注册顺序

文件：`src/main/index.ts`

- `createWindow()`、`createTray()` 后依次调用 `registerClipboardEnhancer()` 与 `registerQuickLauncher()`（约 480-485 行）。
- 本次无需修改注册顺序；只需保证新增上下文字段在 bridge 输出解析和两个调用方之间兼容。

## 3. ZTools 参考源码结论

参考仓库：`D:\claw\ZTools-main`

关键文件：

- `src/main/managers/windowManager.ts`
  - `getDisplayAtCursor()`：用 `screen.getCursorScreenPoint()` 与 `screen.getDisplayNearestPoint()` 选择显示器。
  - `moveWindowToCursor()`：支持 cursor/primary/lastActive/remember 策略，并基于目标显示器 `workArea` 定位。
  - `showWindow()` / `forceActivateWindow()`：显示前记录 previous active window，Windows 下显示后补激活。
  - `mainWindow.on('blur')`：不是单一立即 hide；有短暂 suppress、延迟确认、鼠标按下/释放处理及平台差异。
- `src/main/core/native/index.ts`
  - Windows 原生获取前台窗口信息、激活窗口；说明外部窗口恢复需要区分 top-level active window 与内部 focus window。
- `src/main/api/renderer/window.ts`、`src/renderer/src/App.vue`
  - renderer 在窗口显示/视图切换后重新 focus，并通过 IPC 处理动态尺寸。

可迁移原则：

1. 目标显示器应由当前操作上下文选择，而不是固定主屏。
2. 所有位置最终必须限制在目标显示器 `workArea` 内。
3. 启动器 blur 隐藏要有 grace period 与延迟确认；重新获得焦点时取消待隐藏任务。
4. Windows 窗口显示后可以保留现有 bridge 强制激活与 renderer focus 重试协作。

不直接搬入的内容：ZTools 原生 addon、插件管理、全局鼠标监听、复杂位置记忆及与本次需求无关的插件/跨平台兼容逻辑。

## 4. Ditto 参考源码结论

参考仓库：`D:\claw\Ditto`

关键文件：

- `src/ExternalWindowTracker.cpp`
  - `TrackActiveWnd()` 分开记录前台顶层窗口与真实焦点控件。
  - `FocusCaret()` 采用 IAccessible → `GetGUIThreadInfo().rcCaret` → `AttachThreadInput + GetCaretPos` 的多级回退。
  - `ActivateTarget()` / `WaitForActiveWnd()` 说明外部窗口激活需要确认，而不是只调用一次 API。
- `src/Misc.cpp`
  - `EnsureWindowVisible()` 使用 `MONITORINFO.rcWork` 对矩形做边界修正；负坐标多屏也可处理。
  - `CenterRect()` / `MonitorRectFromRect()` 使用目标矩形或点选择显示器，失败时回退主屏。
- `src/DPI.h`
  - 经验偏移和窗口尺寸应按目标窗口/显示器 DPI 缩放。
- `src/MainFrm.cpp`
  - 显示前先计算矩形、做可见性修正，再移动、显示、激活。

可迁移原则：

1. caret 优先于前台窗口中心；caret 不可用时回退到焦点窗口/前台窗口合理位置。
2. 使用结构化 caret rect（屏幕坐标）而不是只传一个点，方便按弹窗尺寸进行上下/左右避让。
3. 每个候选位置都要根据 `workArea` clamp；显示器不存在、坐标无效或目标矩形完全不可见时回退到焦点屏幕/主屏中心。
4. `rcCaret` 的坐标系必须在 bridge 中显式转换并记录有效性。

Ditto 旧实现存在的注意点：`rcCaret` 的客户区/屏幕坐标转换不能机械照抄，且 `+20` 等经验偏移应考虑 DPI；本计划要求以 Windows bridge 实际返回的屏幕坐标为准。

## 5. 计划边界与风险

### 允许修改

- `src/main/quick-launcher.ts`
- `src/main/clipboard-enhancer.ts`
- `src/main/priority-shortcuts.ts`
- 必要时新增一个仅服务于上述两个窗体的定位辅助模块（建议先评估是否可保持小范围内聚，避免无必要拆分）
- 本计划目录下的探索、计划、合规、审查和验证文档

### 不允许修改

- 主窗体聊天 renderer / 输入框 IPC；本阶段不实现 Wishful Claw 主窗体输入框坐标上报。
- `preToolPhase`、Agent/Goal/Plan 状态链路。
- `.build-check`、`dist`、`out`、`obj`、`bin` 等构建产物。
- 与本次窗口定位和快捷键上下文无关的 bridge 行为。

### 主要风险

- Windows 前台锁、UIPI、管理员权限可能导致 `SetForegroundWindow`、`AttachThreadInput` 或 caret API 失败；必须有无 caret 的安全回退。
- 混合 DPI、多屏负坐标、任务栏工作区和显示器热插拔会影响位置计算。
- 启动器 grace period 过长会让用户点击外部后窗口延迟消失；过短则无法解决瞬时 blur，需以人工实测调参。
- native bridge JSON 新字段必须保持旧/非 Windows fallback 兼容。
- 任务只解决系统当前实际焦点控件；不保证 Chromium/Electron 页面 DOM caret 能由 Win32 API 精确取得。
