# v2-iter-14：历史消息反向分页 + 滚动修复 + 侧边栏收起图标统一

- 状态：已完成，已合并 main
- 分支：dev/v2-iter-14（合并后清理）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.14
- Tag: v0.2.14
- Commit: 0fd5755
- 日期: 2026-08-17
- 备注：
  - **历史消息反向分页** — 后端 ListLocator + ListByTurns 端点（DbMessageTools + DbModule），按对话轮次分页（默认5轮），前端 loadRecentSessionMessages + fetchOlderMessages + prependMessages，loadedRangeStart 语义改为 created_at
  - **首次加载误触发修复** — handleListScroll 加 prevScrollHeightRef（scrollHeight 变化时不触发）+ programmaticScrollUntilRef（程序滚动期间不触发）双重守卫
  - **代码简化** — 删除 stalledOlderLoadStartRef、requestScrollToBottom、scheduledScrollFrameRef、流式轮询 effect、AUTO_SCROLL_MIN_DELTA、BOTTOM_SCROLL_CORRECTION_EPSILON、STREAMING_AUTO_SCROLL_STOP_THRESHOLD 等（511→350 行）
  - **loadOlderMessages** — flushSync + scrollHeight 差值补偿 + shouldAdjustScrollPositionOnItemSizeChange 加载期间返回 false
  - **侧边栏收起图标统一** — 去掉 WorkspaceSidebar 收起按钮，TitleBar toggle 常驻显示（开=PanelLeftClose，关=PanelLeftOpen）
  - **已知问题** — prepend 后有一帧闪烁（"先到顶再滚下来"），根因是 flushSync 期间虚拟列表 getTotalSize() 用估算值，measureElement 异步测量后 scrollHeight 再变。记录到 MEMORY.md 和知识库，留待后续解决
  - 验证：TypeScript 3/3 PASS；C# build 0 错误
  - 后续独立 Plan：模型管理页面、Goal 编排记录可视化、工具调用权限、Cron 自动化验证
