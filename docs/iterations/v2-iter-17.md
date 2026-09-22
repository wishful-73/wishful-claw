# v2-iter-17：工具调用权限


**目标**：「默认」模式下工具调用需弹窗确认的范围梳理与实现。写/删/执行类操作需用户确认，读/搜索类不需要。

**背景**：涉及安全策略设计，当前所有工具调用无确认直接执行。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 权限分类 — 将所有工具按风险分级：safe（read/search/grep/glob）、cautious（write/edit/bash）、dangerous（delete/rm/shell sudo） | `Agent/Tools/*Executor.cs` |
| 2 | 权限配置 — 设置页新增工具权限配置面板，用户可调整每个工具的确认级别 | `renderer/src/components/settings/ToolPermissionPanel.tsx` |
| 3 | 确认机制 — Agent 调用 cautious/dangerous 工具时通过 reverse request 暂停 Loop，弹出确认卡片 | `Agent/ToolCallProcessor.cs` |
| 4 | 前端确认卡片 — 类似 PlanReviewCard，展示工具名、参数摘要、风险提示，Allow/Deny 按钮 | `renderer/src/components/chat/ToolPermissionCard.tsx` |
| 5 | 白名单记忆 — 用户 Allow 后可选择「不再询问此工具」，写入项目配置 | `renderer/src/stores/settings-store.ts` |
| 6 | SSH 项目特殊处理 — SSH 远程执行默认 cautious，不可降为 safe | `Agent/AgentRuntimeSshToolExecutor.cs` |

**验证标准**：Agent 调用 FsRead → 直接执行不确认；Agent 调用 FsWrite → 弹出确认卡片 → 用户 Allow → 执行；用户选择「不再询问」→ 下次 FsWrite 直接执行；Agent 调用 ShellExecute → 必须确认。

**分支**：`dev/v2-iter-17`　**产品版本**：`0.2.17`　**Tag**：`v0.2.17`
