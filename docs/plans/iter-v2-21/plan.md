# Plan: v2-iter-21 — 设置页重构 + 运行时健壮性补强

## 目标

从通用设置拆出「运行与性能」区块挪入 AI 板块并瘦身 GeneralPanel；同时完成 6 项审查遗留修复（RC-2 / RC-3 / AL-6 / TL-1 / TL-4 / SA-4）。

范围由老大确认（2026-08-24 会话）：锚点导航、AL-3 软提示、Worker 关闭/重启（EM-1/EM-2）本次**不做**。

## 步骤清单

### FU-A 设置页重构

- [ ] 步骤1：新建 `RuntimePanel.tsx`（AI 服务商分组下「运行与性能」面板），迁移 GeneralPanel 中三个 section：API 请求超时（L369-429）、Provider 最大重试次数（L432-492）、上下文压缩（L495-542）；SettingsPage 菜单 AI 分组加 `runtime` 项（ui-store SettingsTab 类型同步）；GeneralPanel 删除对应 section 与不再使用的 import。验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误。
- [ ] 步骤2：i18n 补齐 `settings.runtime.*` 翻译键（zh/en），复用现有 general 下 timeout/retries/compression 文案或迁移动词。验证：tsc 零错误 + 切语言无裸 key。

### FU-B 备选项修复（C# Agent 层）

- [ ] 步骤3：RC-2 cancelStream 指定 sessionId — `chat-store/index.ts` cancelStream 增加可选参数 `(sessionId?: string)`，缺省仍用 activeSessionId；调用方不变。验证：TS 三配置零错误。
- [ ] 步骤4：RC-3 error 清流态 — 排查 chat-store 错误分支中 streamingMessages 未清理的路径，error 时移除对应 sessionId 的流态标记。验证：TS 零错误 + 人工冒烟。
- [ ] 步骤5：AL-6 压缩降级 TruncateMessages — `AgentLoop.cs` L182-209 压缩 try 块：CompactAsync 抛异常或结果未变小时，追加一次 `ContextCompression.TruncateMessages` 机械截断兜底（保留 head+tail），成功则 Replace 并发 context_compressed 事件；TruncateMessages 也失败才仅记 Warn。验证：`dotnet build src/runtime/WishfulClaw.sln` 0 错误 0 警告。
- [ ] 步骤6：TL-1 Grep/Glob 排除目录 — 新建共享帮助类 `Tools/SearchTools/SearchFilter.cs`（默认排除 node_modules/.git/dist/build/obj/bin/release/debug/out/vendor 等 + 可选 exclude 参数 glob 匹配路径段）；GrepTool.EnumerateSearchableFiles 与 GlobTool.EnumerateFiles 接入过滤；两工具 InputSchema 增加 `exclude_dirs` 数组参数。验证：dotnet build 0 错误。
- [ ] 步骤7：TL-4 FileRead 流式读取 — FileReadTool 改用 StreamReader 逐行读取，只保留 offset..end 区间的行，避免大文件全量 ReadAllText 进内存；行数超 DefaultLimit 即提前退出。验证：dotnet build 0 错误。
- [ ] 步骤8：SA-4 子 agent 最终报告只取末段 — `SubAgentRunCollector.GetFinalOutput()`：文本输出超过阈值（如 12000 字符）时只保留末段（前缀标注 `[final report truncated]`），thinking 兜底逻辑保持现状。验证：dotnet build 0 错误。

### FU-C 收尾

- [ ] 步骤9：编译验证 — C# build 0 错误 0 警告 + TS 三配置零错误；更新 PROGRESS.md。

## 涉及文件

- src/renderer/src/components/settings/RuntimePanel.tsx — 新建
- src/renderer/src/components/settings/GeneralPanel.tsx — 修改（瘦身）
- src/renderer/src/components/settings/SettingsPage.tsx — 修改（菜单项）
- src/renderer/src/stores/ui-store.ts — 修改（SettingsTab 类型）
- src/renderer/src/locales/** — i18n
- src/renderer/src/stores/chat-store/index.ts — RC-2 / RC-3
- src/runtime/WishfulClaw.Agent/AgentLoop.cs — AL-6
- src/runtime/WishfulClaw.Agent/Tools/SearchTools/SearchFilter.cs — 新建（TL-1）
- src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs / GlobTool.cs — TL-1
- src/runtime/WishfulClaw.Agent/Tools/FileTools/FileReadTool.cs — TL-4
- src/runtime/WishfulClaw.Agent/SubAgentRunCollector.cs — SA-4
- docs/PROGRESS.md — 收尾

## 参考源码

- 无需外部参考项目——本迭代全部为内部重构与审查遗留修复；AL-6 兜底沿用 ContextCompression.TruncateMessages 既有实现（Reasonix mechanical fold 思路）。
