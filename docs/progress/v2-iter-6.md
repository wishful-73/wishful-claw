# v2-iter-6：SSH 远程执行 + Agent 终端旁观 + 项目档案

- 状态：已完成
- 分支：dev/v2-iter-6（已合并 main）
- VERDICT: PASS
- Tag: v2.6.0
- Commit: e1529ee
- 日期: 2026-08-04
- 备注：
  - Agent SSH 输出不自动展开终端面板，输出在面板隐藏时仍写入 xterm 缓冲
  - 终端面板可见性从 project 级改为 session 级（bottomTerminalDockOpenBySessionId）
  - 非 SSH 项目无 ssh_capability 提示块（BuildSshContext 返回 Empty）
  - BuildSshContext 只在 SSH 项目时调用（sshConnectionId 检查）
  - Bash 工具加 `local: true` 逃生口，SSH 项目中 Agent 可操作本地
  - ShellExecuteTool.cs 901 行拆分为 4 个 partial class（AGENTS.md 规范）
  - ProjectArchivePage.tsx 765 行拆分为 3 个文件
  - 终端关闭不自动收起面板，用户手动控制
  - 终端 i18n 补全（16 个 key 加到 zh/en layout.json）
  - 本地项目首次打开终端面板自动创建终端（dockOpen 时触发）
  - node-pty native module 打包修复（electron.vite.config.ts external）
