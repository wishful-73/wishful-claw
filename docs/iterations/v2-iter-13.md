# v2-iter-13：OpenAI Responses API + 请求超时配置 + 文件树/输入框/设置页收口 ✅ 已完成


**目标**：接入 OpenAI Responses API（新一代 SSE 协议）；全局请求超时配置化；文件树、输入框、设置页多项缺陷修复与体验收口。

**实际交付**：
- OpenAI Responses Provider（5 文件：State/InputWriter/EventParser/Provider + AgentLoop 路由）
- AgentRuntimeRequestTimeout 全局超时配置（5s~120s），三个 Provider 均已接入
- AgentFileTreeToolbar（搜索输入框+刷新+更多下拉）
- 搜索结果 type 字段区分文件/文件夹图标
- 右键打开终端改为 createTab 带选中路径
- 文件树持久化（AnimatePresence 外挂载，切 tab 不丢展开状态）
- ComposerStatusIndicator 独立组件 + 移除重复重试 banner
- 移除 websearch 设置入口 + AboutPanel 动态版本号
- electron-builder.yml win.icon 路径修复
- 死代码清理 5 文件 1243 行

**分支**：`dev/v2-iter-13`　**产品版本**：`0.2.13`　**Tag**：`v0.2.13`
