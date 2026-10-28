# v3-iter-3：存量修准 + 大文件欠账清零

- 状态：已完成，已合并 main 并发布
- 分支：dev/v3-iter-3（已删除）
- Plan: docs/plans/iter-v3-3/plan.md
- VERDICT: PASS（编译验证 + 用户真机验证；S-254 的长时长档按已知缺口放行）
- 产品版本: 1.0.3
- Tag: v1.0.3
- 日期: 2026-10-28
- 迭代定位：**没有新功能，只有修准与还债**。上半程把散落在快捷启动、聊天窗、更新器、浏览器里的存量缺陷逐条修准（多数是真机撞出来的），下半程一次性清掉积压的 39 处超 500 行文件欠账。两件事的共通点：都属于「不做就一直烂在那儿」的那一类。

## 范围与功能单元（登记 25 条 / 实施 16 条 / 结转 9 条）

### 修复

- **S-253 文件搜索失败三态分离** —— 原来「没装 / 没跑 / 出错」一律说一句「软件没有运行」，既不自拉起也不给下一步。改为三态互斥：没装给引导下载、没跑自动拉起并推过程态、拉起失败给「重新检测 / 重试」。判定抽成纯函数 `isEverythingAutostartFailure`（`-startup` 撞到已在运行的实例会以 0 退出，是「没事要干」不是失败），冷却窗口内沿用上次判定，避免「点重试就改口」。落点 7 文件 + 独立窗 `main.tsx` 拆出 `result-list.tsx`（原 515 行触线）
- **S-255 顶部吸附条保真** —— `VirtualListContent.tsx` 只取了 `text`，图片、粘贴块、选中文件块全丢，纯图片消息落成空态。改为复合预览 + 缩略图/芯片行，守住 R-10.5 的两行高度上限；媒体行槽位改「缩略图与芯片共用 4 个」（原各 3 个最宽约 410px，`overflow-hidden` 先裁掉 `+N`）；容器 `div`→`span`（`<button>` 内非法 phrasing content）
- **S-259 右侧面板跨会话串扰** —— B 会话在后台跑浏览器工具，A 的面板莫名展开且空白。「开没开」是全局单值、「开的是谁的」是 per-session，两条生命周期不一致。**定案不是加新通道**：`ui-store.ts` 的 `options.background` 早就存在，缺的只是没传 ⇒ 判据收口成 `isRightPanelScopeActive`，护栏落进 `ensureBrowserTab`（background 分支后再拦一刀，调用方忘传也不抢屏），团队两处同判据。登记时给的三条候选（开关按 scope 存 / 加事件通道 / 只在调用点判断）**全部作废**
- **S-258「清空会话」补二次确认** —— 左侧右键一点即永久删库（不可逆、无撤销）。补 `confirm({variant:'destructive'})`，并按老大拍板把三处动作名统一成「清空会话」，做法是**合并成一份文案**（删两个冗余 i18n key、跨 ns 引用），不是三处各改成一样的字
- **S-234 更新说明二次打开空白** —— 补拉结果回写 coordinator，后台下载回来再看进度时说明还在
- **S-235 内置浏览器清除浏览数据** —— 缓存去不掉时用户能自己点，不用等我们猜
- **S-236 Read 读图被误判** —— 不再由本地配置拦「模型未标记为可读图」，改交上游判定（档 2）；读图链路已真机验证
- **S-237 HTTP 400 不再盲目重试** —— 原为兜住「部分服务商该返 429 却返 400」把 400 纳进重试；08:23 发现更严重的问题：400 报文进了请求上下文，后续必崩。商汤现测已返 429，前提不成立 ⇒ 分类器不做，`IsRetryableStatus` 收紧为 `429 / 5xx`，新增 `RetryStatusChecks.cs` 防回退
- **S-246 脏图片块污染历史** —— 一条坏图随历史每轮重发，卡死整个会话且无自愈。三处 wire 收口 + `ReadImage` 入口收紧；`.ico/.tiff` 一并纳入图像分支。**验收口径经老大校正**：不是「脏会话能救回来」，而是**源头不再产生脏块**
- **S-245 / S-254 耗时读数** —— 去掉小数（`7.3s`→`7s`）、单位链补 `d/h` 且秒常驻（`d/h/m/s` 有值就显示），毫秒只留给工具调用、状态栏不出毫秒；取整只在毫秒层做一次
- **S-257 粘贴块补字数统计** —— 「粘贴 · 42 行」→ 补「· 3,200 字」。两处 chip 共用写入时固化的 `payload.label`，所以只改生成侧管不到历史消息 ⇒ 改为**渲染时按 `pastedText` 现算**，零迁移

### 大文件欠账清零（S-249 ~ S-252）

39 处超 500 行文件全部处理完毕，AGENTS.md 的拆分规范从「部分达标」变为「全仓达标」：

| 需求 | 范围 | 结果 |
|---|---|---|
| **S-249** main 进程 6 个 | `quick-launcher` 2205 / `priority-shortcuts` 889 / `cron-reverse-handler` 760 / `updater` 696 / `clipboard-enhancer` 648 / `lib/es-search` 590 | 4 拆 + 2 标注豁免，`src/main` 归零 |
| **S-250** 渲染端 11 个 | `AppPluginPanel` 901 / `SkillsMenu` 721 / `search-dialog` 633 / `GoalHistoryPanel` 651 / `WorkingDirectorySelectorDialog` 627 / `SessionSummaryPanel` 597 / `structured-input` 596 / `UsagePanelParts` 582 / `PreviewPanel` 524 / `BrowserToolCard` 504 / `memory-organization` 639 | **11/11 全拆，零豁免** |
| **S-251** runtime C# 13 个 | `MessagePackJsonWriter` 877 / `SessionRestoreTools` 784 / `DbClient` 781 / `ToolCallProcessor` 648 / `OpenAIChatProvider` 632 / C# 目标编排 6 件 557~617 / `AgentRuntimeDesktopExecutor` 531 / `SubAgentExecutor` 518 / `SessionConversation` 507 | 全部 `partial class` 方法级平移，`dotnet build` 0 警告是硬门禁 |
| **S-252** 测试入口 8 个 + 发布脚本 | `CompactionSnapshot` 1562 / `updater-state` 1152 / `SessionTaskCascade` 663 / `renderable-chat-items` 660 / `CronRegressionTests` 643 / `GoalRegressionTests` 641 / `download-progress` 560 / `provider-presets` 558 / `scripts/deploy.mjs` 754 | 验收以**断言数逐项对齐**为唯一凭据 |

拆分带来的连带约定：**豁免注释不再写死行数**（`4fc2dc41`），改为「行数以实际为准」+ 豁免理由 + 日期 —— 否则每涨十行就要重新复核一遍，纯负担。

## 工程收口

- **审查方式定形**：本迭代把 dev 实例只读审查变成常规环节，S-253 一条走了 **5 轮**静态审查 + 2 次真机。结论是两者**验的不是同一层** —— 审查能算出 381.5px、能推 250ms 时序，但算不出「这台机器冷启动要几秒」；真机 15:54 那一次直接推翻了静态审查凭空推断的三个失败原因（Everything 其实拉起来了，PID 31688 / 119ms / 5 条结果 / 服务 Running+Automatic）
- **测试补强的方向**：`pinned-turn-preview` 的「尺子」函数不参与生产逻辑，只被回归测试当尺子用，却**同一个方向错了三次**（漏 `pl` 与 rem/px 量纲 → 漏徽标 gap → 徽标字宽取 12 而非 20）。每次都是低估，而低估会把真实溢出判成通过。修法是补**绝对读数断言**（360 / 389.5）而非宽松的 `< 400`，并做变异验证（改回错误实现必须炸）
- **`npm test` 套件数 85 → 89**：新增 `right-panel-scope`（19 断言）、`image-media-gate`（37 断言）、`retry-status-checks`、`es-search` 扩到 149 assertions

## 验证

- `npm run typecheck`（node + web 三配置）**0 错误**
- `npm test` **89/89**（`pinned-turn-preview` 122 / `es-search` 149 / `everything-search` 107 / `right-panel-scope` 19 / `ImageMediaGate` 37）
- `dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误**
- 官网本迭代**零改动**（`git diff --stat ae31e643..HEAD -- website` 为空）⇒ 发版只走 `installer`，不重发站点
- 老大真机验收：S-253 十一条全过 / S-255 七条全过 / S-259 六条全过 / S-234 · S-235 · S-245 · S-236 于 09:48 验过

## 遗留

- **S-233 聊天窗抖动挂账未关闭** —— 27 日定调：缺陷确定成立、出现频率低、先登记等模型能力足够再攻。已落 `d8a00a3b`（断掉盲区帧污染 `floor` 的自持环）与 `36aca60e`（贴底时拦住虚拟列表自写 `scrollTop`），但未结案
- **S-254 长时长档无法真机覆盖** —— 老大定「没有那么多可执行的东西跑满一小时」⇒ 按已知缺口放行。`d/h` 单位链已由 `message-timestamp` 断言钉死，未验的只有「长字符串每秒重渲染是否顶版式」这一层，留作下个迭代自然观察
- **S-257 / S-258 / S-237 三条未见单独真机记录** —— S-257（粘贴块字数）与 S-258（清空会话确认框）是纯前端显示，风险面小；S-237 是行为变更（400 从「重试」改为「报错」），只有真撞 400 才看得见，由 `RetryStatusChecks.cs` 断言兜底
- **S-207 沙箱越界临时关闭无真机复验** —— 上个迭代遗留，`CannotWritePropertyWithinArray` 报错未排查，不进本迭代
- **结转 v3-iter-4（9 条）**：插件基座五条 S-240 ~ S-244、内存治理 S-247、纯文本档换形态 S-248、超长文本静止 S-256、浏览器保活池 S-260；另 S-230（Qoder 接入）仍缺契约

## 发布

待补（收尾后另落一刀）。
