# v2-iter-20：审查修复 · 安全与运行时健壮性

- 状态：已完成，已合并 main
- 分支：dev/v2-iter-20（合并后清理）
- Plan: docs/plans/iter-v2-20/
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.20
- Tag: v0.2.20
- Commit: 见 git log v0.2.19..v0.2.20
- 日期: 2026-08-24
- 备注：
  - 来源：docs/reviews/review-02~08b 全项目审查；高优先级全修 + 配套中优
  - FU1 安全：PV-1 TLS 收口工厂+allowInsecureTls 开关（默认关）；MB-1 SSH 记忆 scope 路径校验；TL-6 NotebookEdit 入审批、Monitor 移出
  - FU2 并发：AL-1 同 session 单活跃 run；DB-1 DbClient.Initialize 加锁；SA-1 registry 终态淘汰(100)+排序；SA-2 后台取消注册 Dispose（顺带 SA-6 emit 兜底）；SA-3 ConcurrentDictionary；MB-3 MemoryStore 按 scope 信号量；GL-2 经核验已在 iter-19 修复
  - FU3 静默错误：AL-2 缓存 key 纳入 persona 文件 mtime 指纹（Persona 层零改动）；GL-1/GL-3 已修于 main，补最后残留 "executing" 字面量；PV-2 await emit；TL-5 IsJsonError 忽略 null/空；RC-1 信封 sessionId 优先路由；DB-3 QueryScalar Nullable 特判
  - 明确不做（用户确认）：SA-5b 子 agent 免审批为有意设计；AL-3 无限循环保留语义，改软提示方案归 iter-21
  - **追加 bug 修复（2026-08-24）** — ① 桌面图标白角：4 个图标资产（ico 5 尺寸 + png/512/256）圆角外像素 alpha 全为 255，统一置 0（16% 圆角半径），已验证角部透明/中心不透明；② 删除激活服务商后"未配置 API Key"误报：deleteProvider 回退时优先选 auth-ready 服务商而非 providers[0]，并校验 activeModelId 归属
  - **use_capability 代理显示链路修复（2026-08-24）** — ① Worker 端 ToolCallProcessor 将 action=call 的代理调用展示事件改写为真实工具名+arguments（builtin:/skill:/mcp-tool: 三种形式，ResolveProxyDisplay）；② 渲染端新增 use-capability-proxy.ts 镜像解析，在 stream-event-adapter 入口统一改写 tool_use_streaming_start/generated/tool_call_* 事件（Provider 层流式事件先于 Worker 改写到达，必须在入口兜底）；③ chat-store existing 分支同步 name；④ use_capability 入 HIDDEN_TOOL_NAMES 兜底隐藏未解析卡
  - **default-mode 审批链路修复（2026-08-24）** — ① 审批屏障：default-mode 下需审批的工具按 LLM 发出顺序串行门控（ExecuteGatedAsync barrier chain），杜绝并发执行顺序失控（如删文件先于建文件）；② confirm-dialog 并发队列化：单例对话框排队弹出，修复多弹窗互顶导致 promise 永久挂起、卡片永远"进行中"；③ 弹窗按 startedAt 排序与卡片顺序一致；④ 审批结果对 LLM 可见：批准注入 [USER APPROVED] 前缀、拒绝返回 [USER REJECTED] 指令性反馈（不得假设已生效）；⑤ 审批日志来源标签修正（default-mode/sub-agent 区分）
  - 验证：C# build 0 错误 0 警告；TS 3/3 零错误
