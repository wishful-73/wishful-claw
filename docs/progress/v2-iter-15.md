# v2-iter-15：快捷键系统 + 快速启动器 + 剪贴板增强 + 开机启动

- 状态：已完成，待合并 main
- 分支：dev/v2-iter-15
- VERDICT: PASS（编译验证 + 用户人工验证 + 安装包冒烟测试）
- 产品版本: 0.2.15
- Tag: v0.2.15
- Commit: a6f7731
- 日期: 2026-08-18
- 备注：
  - **开机启动开关 + 模块管理页面** — 设置页新增开机自启动开关，模块管理页面
  - **快速启动器 (Alt+Space)** — 全局快捷键 Alt+Space 唤起快速启动器，快捷键捕获注册
  - **剪贴板增强 (Ctrl+Shift+V)** — 剪贴板弹窗前端重写，内嵌设置面板，双击粘贴
  - **快捷键系统** — 快捷键独立设置页（从主设置页提取），多快捷键编辑器，优先级快捷键桥接（priority-shortcuts.ts），快捷键注册反馈
  - **主题同步修复** — 弹窗窗口（剪贴板/启动器）与主应用主题和预设同步，透明 body，Tailwind CSS 导入修复
  - **JSON BOM 修复** — 移除 JSON 文件 UTF-8 BOM 导致 PostCSS 解析错误
  - 验证：TypeScript 3/3 PASS；C# build 0 错误；安装包冒烟测试通过（4 Electron 进程 + 1 Worker 正常拉起）
  - 安装包：wishful-claw-0.2.15-setup.exe，103.02 MiB，SHA-256 D55C0B2E7E90CB72105EFFAC9A6C14DFDF33A78B5CDED5B5EA1262FAFB93D6C8
