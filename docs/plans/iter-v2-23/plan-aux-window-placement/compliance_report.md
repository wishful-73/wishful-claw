# 规划合规审查报告：额外窗体多屏定位与生命周期修复

日期：2026-08-29
审查对象：`plan.md`、`exploration_findings.md`
依据：`docs/dev-workflow.md`、`AGENTS.md`、`docs/iteration-plan.md`

## 结论

PASS：0 个阻断项。

本报告对应的计划版本已吸收第一轮独立审查提出的 3 个阻断项，具备进入用户确认环节的条件；尚未授权实现，因此没有修改产品代码。

## 检查结果

### 1. 目标覆盖

PASS。

计划覆盖：

- 快速搜索和剪贴板窗口按快捷键触发前的焦点/前台上下文选择显示器；
- 所有定位结果按 Electron display work area clamp；
- 快速搜索 blur grace period、延迟确认、重新 focus 取消隐藏、主动关闭路径保留；
- 剪贴板 caret 优先定位及 focus/foreground/mouse/主屏回退；
- bridge 无法使用或 caret 无效时不伪造坐标；
- 不增加主窗体聊天输入框坐标上报，不触碰主窗体聊天逻辑。

### 2. Windows bridge 契约与坐标系

PASS。

计划已明确：

- 新增 `foregroundWindowRect`、`focusWindowRect`、`caretRect` 可选字段，统一结构为 `{ x, y, width, height } | null`；
- native bridge 输出单位为 screen-physical；
- `rcCaret` 是相对于 `hwndCaret` 的客户区坐标，必须对左上角/右下角分别使用 `ClientToScreen(hwndCaret, ...)` 转屏幕坐标；
- 不把 `rcCaret` 直接当作 Electron 坐标，不使用 `focusWindow` 替代 `hwndCaret`；
- 进入 Electron 定位前使用 `screen.screenToDipRect(null, rect)` 转换到 DIP，随后才与 `Display.workArea` 运算；
- 句柄/矩形无效时传 null，globalShortcut fallback 不伪造 caret 或窗口矩形。

依据：Electron 官方 screen/display 文档确认 `Display.workArea` 使用 DIP，`screen.screenToDipRect(null, rect)` 可将物理屏幕矩形转为 DIP；Microsoft `GUITHREADINFO` 文档确认 `rcCaret` 是相对 `hwndCaret` 的客户区坐标，Win32 的 `ClientToScreen` 用于转换到屏幕坐标。

### 3. 启动器定位与 blur 生命周期

PASS。

计划已将启动器定位和剪贴板定位区分：启动器优先使用 focus/foreground window rect 选屏，不依赖 caret；blur 行为明确为：

- grace period 内等待激活稳定；
- blur 后延迟确认；
- focus/show/再次激活清除待隐藏 timer；
- 外部点击/持续失焦仍关闭；
- Esc、启动应用、内部显式关闭立即关闭；
- hide/close/will-quit 清理 timer；
- 连续快捷键及窗口销毁场景避免竞态。

验证矩阵已补充瞬时 blur、延迟内回 focus、外部点击后保持失焦、外部点击后回到 launcher、连续快捷键。

### 4. 文件范围与架构边界

PASS。

预期产品文件仅为：

- `src/main/quick-launcher.ts`
- `src/main/clipboard-enhancer.ts`
- `src/main/priority-shortcuts.ts`
- 必要时新增纯定位辅助模块 `src/main/aux-window-placement.ts`

明确排除主窗体 renderer、输入框 IPC、Agent/Goal/Plan、`preToolPhase`、`.build-check` 和构建产物。`src/main/index.ts` 注册顺序默认不改。

### 5. 验证与人工验收

PASS。

计划包含：

- `git diff --check`；
- `npx tsc --noEmit -p tsconfig.web.json`；
- `npx tsc --noEmit -p tsconfig.node.json`；
- `npx tsc --noEmit -p tsconfig.json`；
- 必要的 `npm run build`/Electron 构建；
- 真实 Windows/Electron bridge 启动和快捷键冒烟；
- 单屏、多屏、负坐标、混合 DPI、Win32 caret、浏览器/Electron 无 caret、bridge 降级等场景；
- review_report.md 与 verification_report.md。

## 执行前注意事项

- 计划确认后，步骤 3 实现前必须先以当前 Electron 版本的类型检查确认 `screen.screenToDipRect(null, rect)` 可用；若类型或运行时不一致，应采用已验证的等价 per-monitor DPI 转换，不得混用物理像素和 DIP。
- `rcCaret` 的转换必须以 `hwndCaret` 为基准，且检查右下角转换后的宽高为正。
- native bridge 输出 JSON 要保持字段可选，避免旧消息和非 Windows fallback 破坏既有粘贴/焦点恢复链路。
- 用户人工验收 PASS/FAIL/PARTIAL 仍是最终裁定；Agent 不得自行把计划标为完成。
