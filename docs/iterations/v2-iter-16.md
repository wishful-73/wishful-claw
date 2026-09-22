# v2-iter-16：左侧面板整理 + use_capability 工具发现增强


**目标**：参考 OpenCowork 实现左侧面板搜索功能；清空旧扩展项，将绘图/自动化/任务面板移入扩展下拉菜单；修复 use_capability 工具发现的分页/过滤/搜索能力；修复辅助窗口导致 reverse-request 发错窗口的 bug；工具输出截断从字符级改为 UTF-8 字节级。

**背景**：v2 功能基本开发完毕，发布正式版前整理左侧面板。Obsidian 知识库 `正式版发布规划.md` 中明确了整理方向。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 左侧面板搜索 — 搜索输入框 + DB LIKE 消息内容搜索（200ms 防抖）+ 会话标题/项目名称内存过滤 + 搜索结果展示组件 | `WorkspaceSidebar.tsx`、`use-sidebar-search.ts`、`sidebar-search-results.tsx`、`DbMessageTools.cs` |
| 2 | 扩展功能重组 — 清空旧扩展项（resources/skills/souls/sync/translate/codegraph），新增绘图/自动化/任务面板三项，放入扩展下拉菜单 | `WorkspaceSidebar.tsx`、`MainLayout.tsx`、`ui-store.ts` |
| 3 | 主窗口注册修复 — 新建 `main-window-registry.ts`，reverse-request 不再用 `BrowserWindow.getAllWindows()[0]`（辅助窗口会抢占 index 0），改为显式注册的 mainWindow | `main-window-registry.ts`、`native-agent-runtime.ts`、`index.ts` |
| 4 | use_capability 工具发现增强 — list action 支持分页（cursor/page_size）、类型过滤（type/category）、模糊搜索（query）；提取 `AgentRuntimeUseCapabilityDiscovery.cs` partial class；ToolRegistry 新增 `IsAvailableInMode` 方法 | `AgentRuntimeUseCapabilityDiscovery.cs`、`UseCapabilityToolProvider.cs`、`ToolRegistry.cs` |
| 5 | 工具输出截限改为 UTF-8 字节级 — 从 `MaxToolOutputChars=16K chars` 改为 `MaxToolOutputBytes=32K bytes`，Rune 边界安全切片；use_capability list/inspect 免截断 | `ToolCallProcessor.cs` |
| 6 | DB 搜索端点 + JSON 上下文 — `db/messages-search-content` IPC 端点 + `MessageSearchResultRow` entity + `InfrastructureJsonContext` 注册 | `DbMessageTools.cs`、`DbModule.cs`、`InfrastructureJsonContext.cs`、`MessageSearchResultRow.cs` |
| 7 | 回归测试适配 | `Program.Lifecycle.cs`、`Program.Support.cs` |

**验证标准**：左侧面板搜索输入关键词 → 搜索结果显示匹配的消息（含 snippet）→ 点击搜索结果跳转到对应会话；扩展下拉菜单显示绘图/自动化/任务面板三项；Agent 调用 use_capability list 能分页/过滤/搜索；工具输出超过 32KB 时正确截断不破坏 UTF-8；辅助窗口（剪贴板/启动器）打开时 reverse-request 不再发错窗口。

**分支**：`dev/v2-iter-16`　**产品版本**：`0.2.16`　**Tag**：`v0.2.16`
