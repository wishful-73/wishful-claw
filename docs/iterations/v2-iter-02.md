# v2-iter-2：缓存命中率修复


**目标**：C# 端维护 conversation 状态，每轮只接收增量消息，消除全量重建导致的 prefix cache miss。同一会话缓存命中率稳定在 90%+。

| 步骤 | 内容 |
|------|------|
| 1 | C# 端 conversation 状态管理 — `AgentLoop.cs` 的 `ReadWireConversation` → `ReadConversation` 改为增量追加模式 |
| 2 | 渲染端 `use-chat-actions.ts` 改为只发送增量消息（新增的 user message + tool results），不再全量重建 history |
| 3 | `buildRuntimeReminder` 稳定化 — 动态内容注入到 user 消息前缀，确保不破坏前缀缓存 |
| 4 | `InjectTimestampPrefix` 调整 — 时间戳精度降低或移到不影响缓存的位置 |
| 5 | `cache_control` 断点优化 — 评估是否移除显式断点，依赖 Anthropic 自动前缀缓存 |
| 6 | 边界处理：session 切换时重置 conversation 状态、context compression 时重建前缀 |
| 7 | 缓存命中率指标验证 — 连续多轮对话观察 cache_read/cache_creation 比例 |

**验证标准**：同一会话连续 5 轮对话，缓存命中率稳定在 90%+，不再因全量重建导致跳动。

**分支**：`dev/v2-iter-2`　**Tag**：`v2.2.0`　**状态**：✅ 已完成

> 执行记录：12 步骤全部完成。SessionConversation per-session 状态管理、增量消息发送、prefix cache 断点优化（messages[last] 而非 tools[last]）、时间戳分钟级精度。额外完成：LLM 总结式上下文压缩（参考 Reasonix compact.go，7 段式结构化 briefing + PlanCompaction 分区折叠 + 90s 超时重试）、工具注册发现与注入体系参考 Reasonix ToolRegistry/InjectionStrategy 设计思路、压缩设置 UI（Switch + Slider 30%-90%）、版本号单一来源（app-version.ts 从 package.json 读取）、全局 OpenCowork → WishfulClaw 名称替换（56 前端文件 87 处 + 49 C# 文件 55 处）。5 个 commit 在 dev/v2-iter-2 分支。
