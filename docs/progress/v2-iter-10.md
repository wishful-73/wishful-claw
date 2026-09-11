# v2-iter-10：全局会话 + 项目编排工具

- 状态：已完成
- 分支：main
- VERDICT: PASS
- Tag: v2.10.0
- Commit: 1d3eb2f
- 日期: 2026-08-08
- 备注：全局会话 + 4 个项目编排工具（list_projects/get_project_details/create_session/send_session_message），ToolProvider availableModes 扩展 "global" 模式，sessionMode 类型支持 "global"，send_session_message 通过 reverse request 走 renderer sendMessage 链路，fire-and-forget 异步执行，InputArea 区分全局/项目会话。
  - 审查修正：send_session_message 描述改为 fire-and-forget 语义，清理返回值调试信息，加 .catch() 防止未捕获 rejection
  - ContextCompression 拆分为 partial class（TokenEstimation + Transcript）
  - 相关修复：ProviderRetryPolicy 400 可重试、FileListTool hidden 默认 true、DbMessageTools 更新 UpdatedAt、cancelStream 多会话修复、会话列表流式状态指示器
