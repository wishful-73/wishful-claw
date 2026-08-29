# Review Report：额外窗体多屏定位与生命周期修复

日期：2026-08-29  
分支：`dev/v2-iter-23`  
基线：`05ff7fe2 fix: harden IME input and remove planning status bar`  
状态：静态审查通过；真实 Windows/Electron 人工验收待执行

## 审查范围

- `src/main/aux-window-placement.ts`
- `src/main/aux-window-screen.ts`
- `src/main/priority-shortcuts.ts`
- `src/main/quick-launcher.ts`
- `src/main/clipboard-enhancer.ts`
- `src/renderer/src/launcher/main.tsx`
- 本计划文档及工作区差异范围

## 结论

静态代码审查结论：PASS（无已发现的代码阻断项）。

独立审查子任务已尝试启动，但因 120 秒无输出超时，未返回独立报告。因此本报告的结论来自主 agent 的逐段审查和工具验证，不能替代用户的真实 Windows/Electron 多屏人工验收。

## 已核对事项

1. 定位顺序

   - 启动器：`focusWindowRect` → `foregroundWindowRect` → 触发时鼠标点 → primary display。
   - 剪贴板：`caretRect` → `focusWindowRect` → `foregroundWindowRect` → 触发时鼠标点 → primary display。
   - 快速搜索不以 caret 作为定位依据；剪贴板仅在有效 caret 存在时使用 caret 下方/上方定位。

2. 坐标系与 work area

   - native bridge 的窗口/caret 矩形和鼠标点标注为 screen-physical。
   - `screen.screenToDipRect(null, rect)` 通过窄类型能力检测调用；API 缺失或异常时按目标显示器 `scaleFactor` 回退。
   - Electron `Display.bounds`、`Display.workArea` 和 BrowserWindow bounds 使用 DIP。
   - 居中、caret 上下方定位和最终窗口位置均经过 work area clamp，覆盖负坐标和任务栏工作区。

3. native bridge

   - `GetWindowRect` 只在 HWND 有效且矩形宽高为正时输出窗口矩形，否则输出 `null`。
   - `GUITHREADINFO.hwndCaret` 与 `rcCaret` 经过有效性检查；两个角点分别通过 `ClientToScreen(hwndCaret, ...)` 转屏幕坐标，未直接把 `rcCaret` 当成屏幕坐标。
   - 鼠标点在快捷键命中时通过 `GetCursorPos` 采样。
   - bridge 输出 JSON 字段与主进程 `BridgeMessage`/`ShortcutContext` parser 对齐。
   - `globalShortcut` fallback 的新增几何字段均为 `null`，保留原有快捷键、激活、粘贴和 Alt 兼容行为。
   - `SetProcessDpiAwarenessContext` 失败时安全忽略；通过独立 `Add-Type` 编译检查。

4. 快速搜索生命周期

   - blur 不再立即隐藏，而是经过 `LAUNCHER_BLUR_CONFIRM_MS = 120` 延迟确认。
   - `LAUNCHER_ACTIVATION_GRACE_MS = 250` 覆盖 show/激活初始窗口期。
   - focus、show、再次唤起、hide、close、closed、will-quit 路径清理相关 timer。
   - 激活回调的 30ms timer 也纳入统一清理，并在执行前检查窗口仍存在且可见。
   - Esc 使用新增的 `launcher:hide` IPC；启动应用仍通过统一隐藏函数关闭。

5. 剪贴板生命周期与行为

   - 创建和复用均使用同一定位函数。
   - previous foreground/focus 来自快捷键 context。
   - 主动隐藏仍恢复原窗口/焦点；blur 被动隐藏仍不恢复焦点。
   - 粘贴、历史记录、renderer IPC 行为未做无关变更。

6. 范围控制

   - 未修改主窗体聊天逻辑、输入框坐标上报 IPC、Agent/Goal/Plan 链路、`preToolPhase`。
   - 未提交 `.build-check` 或构建产物；`out/` 为既有忽略目录。
   - 当前差异仅包含计划文档、两个新增定位模块、两个主进程增强模块和启动器 renderer 的最小 IPC 修复。

## 未覆盖风险 / 后续人工检查

- 尚未启动真实 Electron 应用验证 native bridge hook、快捷键事件输出和窗口激活竞态。
- 尚未在双屏/多屏、负坐标、主屏左右排列、混合 DPI、任务栏 work area 场景人工确认实际窗口位置。
- 尚未在 Win32 文本框、浏览器/Electron 输入框及无 caret 窗口中人工确认 caret 回退链和粘贴焦点恢复。
- `screenToDipRect` 运行时分支与 scaleFactor 降级分支均已静态覆盖，但真实混合 DPI 数值仍需 Windows 实机确认。

## 审查结果

- 阻断项：0
- 静态审查：PASS
- 运行/人工验收：待用户执行并裁定 PASS / PARTIAL / FAIL
