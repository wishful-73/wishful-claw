# Verification Report：额外窗体多屏定位与生命周期修复

日期：2026-08-29  
分支：`dev/v2-iter-23`  
基线：`05ff7fe2 fix: harden IME input and remove planning status bar`  
当前裁定：PASS（静态/构建验证通过；用户已于 2026-08-29 完成 Windows/Electron 实机人工验收并通过）

## 已运行并通过

| 检查 | 结果 | 备注 |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.web.json --composite false` | PASS | 零错误 |
| `npx tsc --noEmit -p tsconfig.node.json --composite false` | PASS | 零错误 |
| `npx tsc --noEmit -p tsconfig.json --composite false` | PASS | 零错误 |
| `npm run build` | PASS | `electron-vite build` 完成；仅有既有 Vite chunk 警告 |
| `git diff --check` | PASS | 仅有计划文档 LF/CRLF 提示，无 whitespace error |
| inline C# `Add-Type -Language CSharp` | PASS | 仅编译 native bridge 类型定义，未启动 hook |
| 触碰文件 BOM 扫描 | PASS | 使用原生 PowerShell 扫描，当前无 UTF-8 BOM |
| Git 范围检查 | PASS | 无 `.build-check`、无新增构建产物、无主窗体聊天文件改动 |

## 静态行为检查

- 快速搜索和剪贴板窗口首次创建/复用均调用统一定位函数。
- 快速搜索优先 focus window / foreground window / 触发时鼠标点 / primary display。
- 剪贴板优先 caret / focus window / foreground window / 触发时鼠标点 / primary display。
- bridge 的 screen-physical rect/point 优先通过 Electron `screenToDipRect` / `screenToDipPoint` 转为 DIP；转换 API 不可用时，多屏不猜测物理坐标，避免错误映射。
- 剪贴板主列表右上角仅提供“收起”，`clipboard:clear` 保留在设置页，并增加浏览器确认。
- 窗口最终 bounds clamp 到目标 display 的 `workArea`。
- bridge 的 `rcCaret` 通过 `hwndCaret + ClientToScreen` 转换，未直接混用客户区坐标。
- bridge 不可用时几何字段为 `null`，保留 globalShortcut fallback。
- 快速搜索 blur-hide 使用 grace period + 延迟确认；blur timer 和激活 timer 在 hide/close/will-quit 清理。延迟确认当前基于窗口可见性、焦点和 grace period，不额外查询鼠标是否位于 bounds 外或当前前台 HWND。
- Esc 已切换到 `launcher:hide`，与主进程新增 handler 闭环。

## 未能验证

以下项目当前环境没有完成真实 Windows/Electron 人工验证，不能宣称通过：

- 启动真实 Electron 应用并确认 native bridge PowerShell 进程启动、快捷键 hook 回调和实际 JSON 输出。
- 双屏/多屏窗口定位：不同焦点屏幕、主屏在左/右、负坐标、混合 DPI、任务栏 work area。
- 快速搜索瞬时 blur、连续快捷键、外部点击和重新 focus 的实际竞态表现。
- 剪贴板在 Win32 文本框、浏览器/Electron 输入框、无 caret 普通窗口中的实际定位。
- 剪贴板粘贴后原输入控件焦点恢复及 bridge 降级场景。

## 用户验收建议

在 Windows/Electron 实机上按以下顺序执行：

1. 单屏验证快速搜索、剪贴板、Esc、外部点击、启动应用和粘贴。
2. 双屏互换焦点屏幕，确认窗口始终落在对应显示器 work area。
3. 使用主屏左侧/右侧、负坐标和不同缩放比例重复第 2 步。
4. 在 Win32 文本框中打开剪贴板，确认窗口靠近 caret；靠近屏幕底部时确认切换到 caret 上方。
5. 在浏览器/Electron 输入框和普通无 caret 窗口中确认回退位置及粘贴焦点。
6. 快速搜索显示后制造瞬时 blur，再立即 focus，确认不会误隐藏；真正点击外部后确认隐藏。
7. 禁用/阻断 bridge 或模拟 caret 无效，确认 fallback 仍能唤起且不使用错误坐标。

用户已于 2026-08-29 完成实机人工验收，最终裁定为 `PASS`，功能单元已随本迭代收尾提交。
