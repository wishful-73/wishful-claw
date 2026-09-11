# v2-iter-9：Goal 模式自动编排 + 系统完善

- 状态：已完成
- 分支：dev/v2-iter-9（已合并 main）
- VERDICT: PASS
- Tag: v2.9.0
- Commit: 9f8d861
- 日期: 2026-08-07
- 备注：
  - Goal 模式自动编排 — create_goal 进 pending，前端确认卡片（类似计划模式确认卡片）用户确认后启动 GoalOrchestrator 自动编排执行，goal/confirm IPC 路由
  - GoalOrchestrator 拆分 — GoalOrchestrator / GoalOrchestratorLLM / GoalOrchestratorLoop / GoalOrchestratorModels / GoalPlanTracker / GoalPromptTemplates / GoalBackoffStrategy，goal → plan → execute → verify → continue/adjust 状态机
  - 上下文压缩阈值统一 — 后端阈值基数改用 effectiveWindow（contextLength−预留输出），与前端 getCompressionTriggerTokens 对齐，两端约 80% 一致触发
  - 移除前端压缩死代码 — context-compression-runtime.ts 及 types.ts 中 contextCompression 字段（压缩实际由后端 worker 执行）
  - 内置浏览器修复 — BrowserPanel 改用 callback ref 绑定 webview 事件，修复首次挂载与 key 切换时事件不绑定、导航重绑问题；新增 render-process-gone 崩溃自动恢复
  - main 窗口推送统一用 postMessage — 避免 webContents.send 在 frame 销毁时异步抛 Render frame was disposed；修复 goal:confirm 注册参数错位
  - 工具耗时显示 — file 写入/编辑改为毫秒(ms)级别，与其余工具一致
  - 配色默认值 — 默认配色改远航蓝(studio) 并迁移；AOT 兼容配置（StaticConfig.EnableAot + rd.xml）
