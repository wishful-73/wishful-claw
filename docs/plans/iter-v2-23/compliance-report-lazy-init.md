# 合规审查报告（Plan 23-10：惰性后端会话初始化）

> 日期：2026-08-29
>
> 审查方式：独立子代理只读审查（代码证据逐项核对）
>
> 结论：**PASS，0 个阻断项**（5 个建议项已吸收进 plan 步骤）

## 逐项结论

- **A 目标覆盖 ✅**：用户四点目标（进入仅前端渲染 / 发送时初始化 / 空间不够先压缩 / 快照+增量 / 无快照全量）分别由步骤 38、37②、37③、37③、37② 覆盖，步骤 39 场景 A-F 验收。
- **B 根因链复核 ✅**：
  - 根因 1 成立：状态卡 started 落库先于 `PersistSnapshot`（`AgentLoop.cs:237-240`），游标 = 事务内最大消息位（`DbCompactionSnapshotStore.cs:121-124`），完成态 upsert meta 变化 → `HasModelInputChanged`（`DbMessageToolsMutations.cs:132-140`）→ `InvalidateIfUpsertCovered`（:107-116）→ 快照必删。
  - 根因 2 成立：`IsChatOnlyArtifact`（`SessionRestoreTools.cs:356-371`）不过滤 `compactSummary` 与旧版文本摘要。
  - 根因 3 成立：前端直调仅 `session-slice.ts:530` 与 `use-channel-auto-reply.ts:199` 两处，其余 6 个入口均经 `loadRecentSessionMessages` 间接触发，步骤 38 单点移除全覆盖。
  - 步骤 37 设计兼容：`ShouldCompress(int, provider, parameters)` 与估算种子化兼容；`Append` 归零水位不破坏门控（归零后 `0 < count` 仍通过，由 token 阈值主导）。
- **C 分层与 AOT ✅**：`IsChatOnlyArtifactMeta` 置 Infrastructure 为纯 meta 判定，无逆向依赖；恢复核心提取仍在 Agent 层；不新增序列化类型（步骤 37 已注明若引入须注册）。
- **D 契约一致 ✅**：步骤 35 对齐快照契约 §7.4；步骤 38 落实压缩契约 §一"UI 加载历史不改变快照/Worker 会话"；步骤 37 复用 §6 回退链。
- **E 检查点可执行 ⚠️→已修**：步骤 36 原测试落点不可达（回归工程仅引用 Infrastructure，够不到 Agent internal），已改为补项目引用 + `InternalsVisibleTo`。

## 建议项吸收记录

| # | 建议 | 处理 |
|---|---|---|
| 1 | 步骤 36 明确测试落点 | 已写入步骤 36（补 Agent 引用 + InternalsVisibleTo） |
| 2 | 步骤 35 跳失效限定 meta-only；判定覆盖范围 | 已限定"仅 meta 变化"跳过；`compactSummary` 属模型输入，明确不纳入跳过集（与审查建议不同，理由已写入步骤：摘要行是快照 wire 会话成员，改写应失效） |
| 3 | 步骤 37 空 sessionId 守卫与水位说明 | 已加 `sessionId.Length > 0` 守卫；注明水位被 Append 归零为已知无害行为 |
| 4 | 步骤 39 补 Cron 场景 | 已加场景 F（绑定会话 Cron 确定性注入） |
| 5 | AOT 注册提醒 | 已写入步骤 37 |

## 阻断项

无。
