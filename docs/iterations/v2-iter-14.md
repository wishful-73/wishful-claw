# v2-iter-14：历史消息反向分页


**目标**：长会话从最新消息尾页加载，滚动到顶部触发动态加载更早历史。解决当前长会话一次性全量加载导致启动慢、内存占用高的问题。

**背景**：最新消息尾页加载已实现，但 `loadOlderSessionMessages` 仍是 stub；虚拟列表顶部触发基础设施已存在。不是从零开发，但涉及分页合并、滚动锚点、消息驻留和回归测试。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | 后端分页查询 — `DbMessageTools` 增加 `GetMessagesByPage(sessionId, beforeTimestamp, limit)` 分页查询，按 created_at DESC 游标分页 | `Infrastructure/Db/DbMessageTools.cs` |
| 2 | 前端 `loadOlderSessionMessages` 实现 — 调用分页 API，将旧消息 prepend 到消息列表头部 | `renderer/src/stores/chat-store.ts` |
| 3 | 虚拟列表顶部触发 — 滚动到顶部时触发 `loadOlderSessionMessages`，加载过程中显示 loading 指示器 | `renderer/src/components/chat/MessageList.tsx` |
| 4 | 滚动锚点保持 — 加载旧消息后保持当前滚动位置不跳动（参考浏览器 scroll anchoring） | 同上 |
| 5 | 分页合并 — 新加载的消息与已有消息去重合并，确保顺序正确 | `chat-store.ts` |
| 6 | 回归测试 — 短会话（<20条）不触发分页，长会话（>100条）分页加载正确 | 手动验证 |

**验证标准**：打开 100+ 条消息的长会话 → 首次只加载最近 50 条 → 滚动到顶部 → 自动加载更早 50 条 → 滚动位置不跳动 → 重复直到全部加载完 → 消息顺序正确无重复。

**分支**：`dev/v2-iter-14`　**产品版本**：`0.2.14`　**Tag**：`v0.2.14`
