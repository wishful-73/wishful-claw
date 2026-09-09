# v2-iter-7：主聊天折叠块模式

- 状态：已完成
- 分支：dev/v2-iter-7（已合并 main）
- VERDICT: PASS
- Tag: v2.7.0
- Commit: a36f392
- 日期: 2026-08-04
- 备注：
  - ExecutionProcessBlock 折叠块组件 — 执行中展开，结束后自动折叠成摘要，用户可手动 toggle
  - 过程/最终文本拆分 — 从 render items 末尾向前扫描，执行过程（thinking/tool_use）包裹在折叠块内，最终输出（text/image）在折叠块之外
  - 按工具分类摘要 — 细分 commands/reads/edits/browser/desktop/orchestration/mcp/interactive/visual/skill/other
  - collapsible 动态计算 — 只有存在工具调用时才折叠，纯思考+回复不折叠
  - 取消执行处理 — 取消时也折叠过程，最终回复区域显示固定文本
  - 缓存命中率修复 — 从 session 级请求计数改为 token 级口径（cacheRead/input），修复 session 恢复后后端计数器丢失导致百分比不准
  - 原计划含右侧工作台 tab + ToolCallCard compact 模式，开发中决策去掉（折叠块内 ToolCallCard 本身有展开预览能力，compact 模式去掉再补工作台是绕圈子）
  - content-renderer.tsx 从 525 行拆分至 494 行（提取 splitProcessAndFinal 到 process-summary.ts）
