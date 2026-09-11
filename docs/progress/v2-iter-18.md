# v2-iter-18：429重试配置化 + 输入框状态独立显示 + 默认模式工具审批

- 状态：已完成，已合并 main
- 分支：dev/v2-iter-18（合并后清理）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.18
- Tag: v0.2.18
- Commit: a46e6de
- 日期: 2026-08-20
- 备注：
  - **#1 429重试次数配置化** — ProviderConfig 新增 maxRetries 配置，重试状态显示支持无限模式（maxAttempts=0 显示 attempt/∞）
  - **#2 输入框状态独立显示** — 输入框上方独立运行状态指示（思考中/输出中/等待），collectRuntimeOutputSnapshot 改读流式 segments（当前迭代过滤 + think 标签解析 + GLM 空 thinking 块兼容）
  - **#3 默认模式工具审批** — 权限模式简化为 default/fullAccess 两档（旧 whitelist 档仅保留迁移兼容），默认模式下风险工具弹审批
  - **requestMaxRetries 透传修复** — mapSidecarProvider 白名单补 requestTimeoutSeconds/requestMaxRetries（此前 C# 端恒读到默认 10）
  - **实测修复批次** — 会话/项目删除确认弹窗（confirm-dialog）+ 侧栏流式指示器 + 会话折叠（超 5 项 load more）+ Worker 日志级别随主进程透传（打包版 warn/开发版 debug）
  - 验证：TypeScript 3/3 PASS；C# build 0 错误
