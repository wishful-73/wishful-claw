# v2-iter-13：OpenAI Responses API + 请求超时配置 + 文件树/输入框/设置页收口

- 状态：已完成，已合并 main
- 分支：dev/v2-iter-13（合并后清理）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.13
- Tag: v0.2.13
- Commit: 8ac3102
- 日期: 2026-08-14
- 备注：
  - **OpenAI Responses API** — 新增 OpenAIResponsesProvider（5 文件：State/InputWriter/EventParser/Provider + 路由），接入 AgentLoop provider 白名单、ContextCompression summarizer、ProviderTestService 连通性测试
  - **全局请求超时配置** — 新增 AgentRuntimeRequestTimeout.cs，设置页通用面板新增超时配置项（5s~120s），三个 Provider（Anthropic/OpenAIChat/OpenAIResponses）均接入
  - **文件树改进** — 新建 AgentFileTreeToolbar（搜索输入框+刷新+更多下拉，复用根目录右键菜单）；搜索结果增加 type 字段区分文件/文件夹图标；右键打开终端改为 createTab 带选中路径；文件树持久化（AnimatePresence 外挂载，切 tab 不丢展开状态）；移除 WebSearchPanel 死代码 5 文件 1243 行
  - **输入框调整** — ComposerStatusIndicator 提取为独立组件，位置 left-5 top-2；移除重复重试 banner
  - **设置页修复** — 移除 websearch 菜单项及 Search import；AboutPanel 版本号改用 APP_VERSION_LABEL 动态读取
  - **打包修复** — electron-builder.yml win.icon 从不存在的 icon-bmp.ico 改为 icon.ico
  - **左栏优化** — "更改工作文件夹"改为"打开工作文件夹"（shell.openPath）；聊天窗折叠统计同文件去重合并；隐藏文件（.开头）显示
  - 验证：TypeScript 3/3 PASS；C# build 0 错误
  - 后续独立 Plan：历史消息反向分页、模型管理页面、Goal 编排记录可视化、工具调用权限、Cron 自动化验证
