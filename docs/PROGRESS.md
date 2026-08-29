# 开发进度

## v2-iter-24：全局产品经理 Agent + 会话临时 Todo

- 状态：范围已确认，待执行（2026-08-29 老大拍板：全局任务不删除只归档；全局 Agent 复用既有 `sessionMode='global'` 机制；执行顺序 Plan B → Plan A）
- 分支：`dev/v2-iter-24`
- Plan：`docs/plans/iter-v2-24/plan.md`（迭代总览）、`plan-session-tasks/`（OpenCowork 风格会话临时 Todo）、`plan-task-panel/`（全局 Agent、全局任务与 Task Board）
- 范围要点：会话 Agent 使用 `tasks` 维护内部临时 Todo；全局 Agent 使用独立 `global_tasks` 维护跨项目任务，并通过 `global_task_dispatches` 向项目会话发送消息/工作请求；全局 Agent 不读取、不管理、不统计会话 Todo；Task Board 展示全局任务和分派记录；本迭代默认不自动唤醒空闲会话执行
- VERDICT: —
- Tag: —
- Commit: —
- 日期: —

## v2-iter-23：会话可靠性与缺陷收口（已完成，已合并 main）

- 状态：已完成，已合并 main（2026-08-29 老大确认完结并授权按标准流程收尾，此前“不发版”决策随之解除）
- 分支：`dev/v2-iter-23`（合并后清理）
- Plan：`docs/plans/iter-v2-23/plan.md`（Plan 23-9 全量排查 / Plan 23-10 惰性会话初始化 / plan-aux-window-placement）
- VERDICT：PASS（编译验证 + 回归测试 + 用户人工验收）
- 产品版本：`0.2.23`
- Tag：`v0.2.23`
- Commit：见 git log v0.2.22..v0.2.23（48+ 功能 commit）
- 日期：2026-08-29
- 范围与功能单元：
  - **压缩快照体系** — 快照 schema/Entity/Mapper/读写端点 + AOT 注册 + 破坏性变更失效钩子；游标后增量查询 + 版本/损坏/游标校验安全回退；DB 回归测试 252 断言全过；CompactionOutcome 统一压缩产物（边界/摘要聊天产物 + trigger/降级字段）；手动压缩端点会话化；压缩事件五态闭环与聊天窗摘要卡；快照持久化与 Worker 会话同步；SessionRestoreTools 快照/全量兼容恢复（失败回退全量）
  - **会话可靠性** — tool_call_result 完成边界立即落库（幂等稳定键）；messages upsert 串行写入队列；恢复 reconciliation（tool_use 必配 tool_result）；渠道会话三路径持久化一致性审计；惰性后端会话初始化（进入会话与后端重建解耦）；恢复时过滤压缩摘要/边界/状态卡消息；产物 meta 生命周期不再失效快照；关闭每轮自动记忆提取；IME 输入加固；移除 planning 状态栏
  - **聊天体验** — 历史加载改点击触发；进行中当前轮 user message 顶部吸附卡；右上角悬浮竖向操作块（压缩/打开文件夹/宽窄调节，移除清除会话入口）；右侧面板浮框新增会话摘要入口；多文档预览切换 tab 内容错位修复；全局会话兼容终端（无工作目录以用户主目录为 cwd）
  - **上线前全量排查（Plan 23-9）** — 高危 8/中危 36/低危 16/存疑 9；分批整改：Worker 重试与压缩可靠性、主进程退出清理与进程安全、路径安全与初始化健壮性、渲染端中危、技能市场死代码移除、i18n 缺失键、C# 低危与 AOT 规范偏离；有意设计项（M30/M37）用户确认后保留并回滚/注释对齐；审计文档批 1-10 结果同步入库；压缩状态事件/快照失效确定性/压缩竞态/恢复原子化等审查修复（步骤4-21、26-31）
  - **前端打磨（步骤26-31）** — 输入草稿持久化实装（input-draft 五端点 + hook）；项目档案路径斜杠混用修复；服务商弹窗 API Key 必填 + 空模型列表双按钮 + 列表展示排序/滚动收敛；模型图标选择器真实系列图标；文件树目录/文件图标天空蓝/琥珀双色体系 + 120+ 类型着色；侧栏对话分区可收起/展开与图标对齐；记忆与上下文面板更新合并去重；剪贴板主列表右上角收敛入口（清空保留在设置页并加确认）
  - **辅助窗口多屏定位与生命周期（plan-aux-window-placement）** — 快速搜索/剪贴板窗口统一定位（focus/foreground/caret/primary 分级回退 + workArea clamp）；native bridge 物理坐标经 screenToDipRect/Point 转 DIP；启动器 blur-hide grace period + 延迟确认；剪贴板收起入口 + clear 保留在设置页并加确认；用户实机验收通过（裁定 PASS）
  - **收尾（用户授权）** — 解除“不发版”决策，按标准流程升级产品版本 0.2.23、打 tag、发 Release 与安装包
- 验证：TypeScript 3/3 零错误；DB 快照回归测试 252 断言全过；审计修复 0 阻断遗留；多屏定位用户实机验收 PASS
- 历史决策记录：2026-08-28 曾决定本迭代不发版；2026-08-29 老大确认完结并授权按 AGENTS.md 标准流程收尾，延期决策仅影响“正式产品版（1.0）”定位，v2-iter-24/25/26 路线不变
- 下一步：从最新 main 创建 `dev/v2-iter-24`，功能补齐与遗留问题推进（范围先与老大确认）

## v2-iter-22：微信/飞书渠道与定时任务打磨（已完成，已合并 main）

- 状态：已完成，已合并 main
- 分支：`dev/v2-iter-22`（合并后清理）
- Plan：`docs/plans/iter-v2-22/plan.md`
- 最终审查基线：`docs/reviews/review-09-iter22.md`；`docs/plans/iter-v2-22/review_report.md`
- 最终验证：`docs/plans/iter-v2-22/verification_report.md`
- VERDICT: PASS（编译验证 + 用户人工确认；I22-3 真实 Electron 进程级 harness 留后续迭代）
- 产品版本：0.2.22
- Tag：v0.2.22
- Commit：528c728（merge）
- 日期：2026-08-27
- 范围：渠道标题/主动发送、Cron SQLite 数据模型与启动恢复、Automation 列表/表单/日历、运行状态/通知/归档、隔离测试与并发修复、ActivityPanel 迁入右侧 Tab、hasApiKey 选择器调整
- 验证：TS 3/3、C# solution 0 warning/0 error、Goal regression 113、Cron regression 38/76/8/8、diff check 通过；隔离 Electron 冒烟通过；I22-3 协调器级 harness 已补（15 项通过），真实 Electron 进程级 harness 待补（非阻断）
- 审查：0 阻断项、0 高风险未修复项

## v2-iter-22+：OpenCowork 近期提交参考迁移候选（2026-08-24 调研，待排期）

来源：D:\claw\OpenCowork git log 1.3.9 → 1.3.16（排除 CLI 与宠物体系）

**高价值（正确性问题，建议优先）：**
1. **工具结果即时持久化**（`56e888a6`）— tool_result 原等 30s 检查点/run 结束才落库，崩溃窗口内丢失已执行工具输出导致模型静默重跑；修复为工具边界立即 flush。我们 chat-store 流式消息同样存在此窗口
2. **压缩水位线 + contextLength 回退**（`4d79734c` + `fe3f9e33`）— compact 水位线持久化防已总结轮次重入请求；无 contextLength 的模型回退默认窗口而非静默禁用自动压缩。我们 AgentLoop.ShouldCompress 的 `contextLength<=0 return false` 是同样的坑
3. **渲染器空闲 CPU 忙循环**（`22eb6c4d`）— 侧边栏自动水合失败→改 state→重触发 effect 无限重试打满 CPU；iter-16 的侧边栏自动加载有同类隐患，值得排查
4. **运行时恢复与失败反馈强化**（`b2a82d41` + `7b424686`）— 瞬态 provider 失败重试策略、压缩位置保持、完整执行错误透出

**中价值：**
5. 计划模式增强（`94c92277`/`329c822f`/`6fb35b8c`）— ExitPlanMode 可选 plan 参数、审查卡"请求修订"反馈、实施模型选择、重开计划而非 fork
6. 子 agent 聊天内联可视化（`8424a162`）— 内联文件 diff、子 agent 实时活动
7. 用户图片块转发 Gemini/OpenAI（`96b0532a`）— 多模态 wire 格式归一化
8. ACP 主 agent 只读编排工具（`005e4e1c`）— 父 agent 可用 skills/memory/search 编排但禁写类工具

**低优先：**
- 渠道长回复分片与回复路由（`fa93aae6`）；Provider 预设更新（GLM-5.3/Grok 4.6/DeepSeek V4）；任务看板（与我们 todo 重叠）

## v2-iter-21：设置页重构 + 运行时健壮性补强
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-21（合并后清理）
- Plan: docs/plans/iter-v2-21/（主计划 + 追加插件管理 Plan）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.21
- Tag: v0.2.21
- Commit: 63d7191
- 日期: 2026-08-25
- 范围确认（老大）：设置页重构 + 备选项全做（RC-2/RC-3/AL-6/TL-1/TL-4/SA-4）；锚点导航、AL-3 软提示、EM-1/EM-2 本次不做
- 备注：
  - **FU-A 设置页重构（按老大反馈修正范围）** — RuntimePanel.tsx 迁入：API 请求超时 / Provider 最大重试 / 上下文压缩 / 工具执行（并行数、每轮上限、并发子 agent）/ 开发者模式 / 开机启动（含 launchAtLogin 状态逻辑）；GeneralPanel 只留语言/主题/预设/外观，585→233 行；SettingsTab 增加 runtime；i18n zh/en tabs.runtime + runtimePage 键
  - **设置页锚点导航** — 新建 section-anchor-nav.tsx：面板右侧 sticky 锚点列，点击 smooth 滚动到 section、滚动联动高亮当前区块；GeneralPanel 4 锚点（语言/主题/预设/外观）+ RuntimePanel 6 锚点（超时/重试/压缩/工具执行/开发者/开机启动），section 注入 id
  - **RC-2** — chat-store cancelStream 支持可选 targetSessionId 参数，缺省仍用 activeSessionId
  - **RC-3** — error 事件清理该 session 全部消息的 isStreaming 标记（原来只清 runId 匹配的那条，重载后残留流态），error 文案仍只写目标消息
  - **AL-6** — AgentLoop 压缩块：CompactAsync 无缩减效果时降级 TruncateMessages 机械截断兜底，两者都无效才仅记 Warn
  - **TL-1** — 新建 SearchFilter.cs：默认排除 node_modules/.git/dist/obj/bin/release/debug/vendor 等目录 + exclude_dirs 参数（支持通配段）；GrepTool/GlobTool 枚举接入，InputSchema 同步
  - **TL-4** — FileReadTool 改 StreamReader 逐行流式读取，只保留 [offset, offset+limit) 窗口，不再 ReadAllText 全量进内存
  - **SA-4** — SubAgentRunCollector.GetFinalOutput 文本超 12000 字符只保留末段（前缀标注 truncated），thinking 兜底逻辑不变
  - 验证：C# solution build 0 警告 0 错误；TS 3/3 零错误；git diff --check PASS
  - **追加功能单元：插件管理与 Browser 加载闭环** — 设置页新增内置应用插件面板和自定义扩展管理入口；ExtensionPanel 覆盖安装/启停/配置/打开目录/移除；扩展工具按当前项目启用状态刷新名称快照，由 Native Worker 负责真实执行；Browser/Image/CodeGraph 注册在持久化 hydration 后同步，并监听开关变化即时注册/注销
  - 追加文档：`docs/plans/iter-v2-21/review_report-plugin-management.md`、`verification_report-plugin-management.md`
  - 追加验证：C# solution build 0 警告 0 错误；TS 3/3 零错误；git diff --check PASS；运行时人工验证待用户
  - **追加功能单元：CodeGraph 项目档案入口 + 存储本地化** — 引擎从仓库根 codegraph/ 迁入 src/runtime/WishfulClaw.CodeGraph（sln/csproj 路径同步修正）；新增 CodeGraphDataRootRegistry，main IPC 层按 workingFolder 注入 dataRoot 使图谱 DB 落 `{workingFolder}/.wishful-claw/codegraph/`（SSH 项目回退 ~/.wishful-claw/projects/{id}/codegraph，与记忆同策略）；项目档案页新增「代码图谱」区块（未启用置灰引导 / 索引状态 / 索引+同步+进度条）；插件面板移除全局项目列表仅留资产诊断。Plan: plan-codegraph-project-archive.md
  - 追加验证：C# build + AOT publish + TS 3/3 全零错误；运行时人工验证待用户

## v2-iter-21 原始候选记录（已被上方实际范围取代）

- 状态：规划中
- 分支：dev/v2-iter-21（待从 main 切出）
- Plan: docs/plans/iter-v2-21/（待建）
- 备注（已确认的候选内容）：
  - **设置页重构** — 从通用设置拆出「运行与性能」区块（API 请求超时、最大重试次数、上下文压缩等 AI 运行时相关项），挪入 AI 板块；GeneralPanel 当前 585 行需同步瘦身
  - **设置页左侧锚点导航** — 各面板内 section 锚点 + 滚动位置联动高亮，锚点列表覆盖拆分后的目标面板
  - **AL-3 无限循环软提示** — maxIterations=0 保持无限语义；检测连续多轮相似失败模式时注入 user-tail 提示引导换思路/询问用户，不强退
  - **Worker 优雅关闭** — before-quit 通知 Worker 停止接受新 run → 等安全点落盘 → 超时强杀（EM-1）
  - **Worker 崩溃自动重启** — 指数退避 + 连续崩溃熔断广播（EM-2）
  - 其余 iter-21 备选：RC-2 cancelStream 指定 sessionId、RC-3 error 清流态、AL-6 压缩降级 TruncateMessages、TL-1 Grep/Glob 排除目录、TL-4 FileRead 流式读取、SA-4 子 agent 最终报告只取末段

## v2-iter-20：审查修复 · 安全与运行时健壮性
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-20（合并后清理）
- Plan: docs/plans/iter-v2-20/
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.20
- Tag: v0.2.20
- Commit: 见 git log v0.2.19..v0.2.20
- 日期: 2026-08-24
- 备注：
  - 来源：docs/reviews/review-02~08b 全项目审查；高优先级全修 + 配套中优
  - FU1 安全：PV-1 TLS 收口工厂+allowInsecureTls 开关（默认关）；MB-1 SSH 记忆 scope 路径校验；TL-6 NotebookEdit 入审批、Monitor 移出
  - FU2 并发：AL-1 同 session 单活跃 run；DB-1 DbClient.Initialize 加锁；SA-1 registry 终态淘汰(100)+排序；SA-2 后台取消注册 Dispose（顺带 SA-6 emit 兜底）；SA-3 ConcurrentDictionary；MB-3 MemoryStore 按 scope 信号量；GL-2 经核验已在 iter-19 修复
  - FU3 静默错误：AL-2 缓存 key 纳入 persona 文件 mtime 指纹（Persona 层零改动）；GL-1/GL-3 已修于 main，补最后残留 "executing" 字面量；PV-2 await emit；TL-5 IsJsonError 忽略 null/空；RC-1 信封 sessionId 优先路由；DB-3 QueryScalar Nullable 特判
  - 明确不做（用户确认）：SA-5b 子 agent 免审批为有意设计；AL-3 无限循环保留语义，改软提示方案归 iter-21
  - **追加 bug 修复（2026-08-24）** — ① 桌面图标白角：4 个图标资产（ico 5 尺寸 + png/512/256）圆角外像素 alpha 全为 255，统一置 0（16% 圆角半径），已验证角部透明/中心不透明；② 删除激活服务商后"未配置 API Key"误报：deleteProvider 回退时优先选 auth-ready 服务商而非 providers[0]，并校验 activeModelId 归属
  - **use_capability 代理显示链路修复（2026-08-24）** — ① Worker 端 ToolCallProcessor 将 action=call 的代理调用展示事件改写为真实工具名+arguments（builtin:/skill:/mcp-tool: 三种形式，ResolveProxyDisplay）；② 渲染端新增 use-capability-proxy.ts 镜像解析，在 stream-event-adapter 入口统一改写 tool_use_streaming_start/generated/tool_call_* 事件（Provider 层流式事件先于 Worker 改写到达，必须在入口兜底）；③ chat-store existing 分支同步 name；④ use_capability 入 HIDDEN_TOOL_NAMES 兜底隐藏未解析卡
  - **default-mode 审批链路修复（2026-08-24）** — ① 审批屏障：default-mode 下需审批的工具按 LLM 发出顺序串行门控（ExecuteGatedAsync barrier chain），杜绝并发执行顺序失控（如删文件先于建文件）；② confirm-dialog 并发队列化：单例对话框排队弹出，修复多弹窗互顶导致 promise 永久挂起、卡片永远"进行中"；③ 弹窗按 startedAt 排序与卡片顺序一致；④ 审批结果对 LLM 可见：批准注入 [USER APPROVED] 前缀、拒绝返回 [USER REJECTED] 指令性反馈（不得假设已生效）；⑤ 审批日志来源标签修正（default-mode/sub-agent 区分）
  - 验证：C# build 0 错误 0 警告；TS 3/3 零错误

## v2-iter-19：Goal 编排记录可视化 + 三层生命周期收口
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-19（合并后清理）
- Plan: docs/plans/iter-v2-19/ + .plan/vUakoMqaW0Wz.md
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.19
- Tag: v0.2.19
- Commit: e31b66a（merge）
- 日期: 2026-08-23
- 备注：
  - **goal_plan_tasks 表** — 每行 = 一个计划的一轮执行（round = retry+1）：description/steps/summary/评估 reasoning/是否 satisfied/adjusted/起止时间；偏离排期为单表设计（两表方案其中一表语义空洞），已获老大确认
  - **编排写入** — GoalPlanRecorder（best-effort，失败仅 Warn 不阻断编排）挂接 GoalOrchestratorLoop 四节点；与 GoalPlanTracker 的 md 落盘并行镜像
  - **端点链路** — db/goal-plan-tasks-list（DbModule → main IPC → shared 常量 → loadGoalPlanTasks store）
  - **面板 UI** — GoalHistoryPanel 计划卡片点击展开每轮详情（轮次徽标/状态/耗时/评估理由/已调整标记/steps），active goal 10s 轮询刷新；轮次按链根 planId 匹配（兼容 adjust 换 planId）
  - **后台子 agent 内容错位修复** — 根因：子 agent childState 复用父 SessionId，AgentLoop 以 sessionId 为键取 SessionConversation，后台子 agent 与主会话并发读写同一消息列表（主 agent 后续消息被子 agent 消费执行、子 agent transcript 反向污染主上下文；前台模式同样污染只是串行不明显）。修复：sessionMode=subAgent 时会话键改为 `__subagent__{runId}` 隔离，子 agent 结束后 Remove 清理
  - **步骤7：拆分即落库** — decomposer 拆完立即 SyncGoalToDb（plans 全量入库），面板无需等执行完才见计划列表
  - **步骤8：goal_activity 实时事件链** — GoalEventContext(GoalId/PlanId/Round) 挂 RunState；SubAgentExecutor.CreateCollector 将子 agent tool_call/tool_result/iteration 以 goal_activity 事件转发（复用 Input(JsonElement) 字段，不改协议）；前端 chat-store 分流 → goal-store.applyGoalActivity（每 goal 保留 200 条）→ GoalHistoryPanel 计划卡片展开显示实时活动流（最近 30 条，按链根 planId 过滤，active 时带转圈）
  - **步骤9：流式降噪** — Goal 运行时子 agent text_delta 不逐条转发，消除 seq 爆炸刷屏（最终报告仍随 sub_agent_end 到达）
  - **三层生命周期收口** — Goal→Plan→Task 三层统一四态（pending/active/complete/aborted）；新增 goal_plans/goal_tasks/goal_execution_runs 三表 + Entity/Row/Mapper/DB 工具 + IPC 端点 + main 桥接；编排循环 MaterializePlans + execution attempts；FinalizeOwnedRunAsync 失败保持 active 不移除 ActiveGoals；AbortSubtree 取消向下传播；SweepInterruptedGoals 重启清扫三层；前端 SessionGoalPlan/SessionGoalTask/GoalExecutionRun 类型 + store 查询层
  - **SSE 流空闲超时** — AgentRuntimeRequestTimeout.ReadLineAsync 复用 requestTimeoutSeconds 作为逐行空闲超时（OpenAI Chat/Responses + Anthropic）；停滞流抛 TimeoutException 走重试而非永久挂死
  - **Goal 暂停立即中断当前 turn** — pause watcher 250ms 轮询 RunState，Paused 时取消 in-flight 子 agent turn（含 provider 重试循环），GoalContext.CurrentTurnState 跟踪
  - **其他** — 无限重试长时自主运行 + 里程碑、Goal 确认卡片模型选择 UI、ProviderStore encodeURIComponent 路径兼容、架构 review 文档 review-02..08 入库、清理误提交的 node_out/root_out/stderr/stdout.txt
  - 验证：C# build 0 错误；TS 3/3 零错误；BOM 0 残留；用户实测通过

## v2-iter-18：429重试配置化 + 输入框状态独立显示 + 默认模式工具审批
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-18（合并后清理）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.18
- Tag: v0.2.18
- Commit: a46e6de
- 日期: 2026-08-20
- 备注：
  - **#1 429重试次数配置化** — ProviderConfig 新增 maxRetries 配置，重试状态显示支持无限模式（maxAttempts=0 显示 attempt/∞）
  - **#2 输入框状态独立显示** — 输入框上方独立运行状态指示（思考中/输出中/等待），collectRuntimeOutputSnapshot 改读流式 segments（当前迭代过滤 + think 标签解析 + GLM 空 thinking 块兼容）
  - **#3 默认模式工具审批** — 权限模式简化为 default/fullAccess 两档（旧 whitelist 档仅保留迁移兼容），默认模式下风险工具弹审批
  - **requestMaxRetries 透传修复** — mapSidecarProvider 白名单补 requestTimeoutSeconds/requestMaxRetries（此前 C# 端恒读到默认 10）
  - **实测修复批次** — 会话/项目删除确认弹窗（confirm-dialog）+ 侧栏流式指示器 + 会话折叠（超 5 项 load more）+ Worker 日志级别随主进程透传（打包版 warn/开发版 debug）
  - 验证：TypeScript 3/3 PASS；C# build 0 错误

## v2-iter-17：缺陷修复迭代
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-17（合并后清理）
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.17
- Tag: v0.2.17
- Commit: 30814e6
- 日期: 2026-08-20
- 备注：
  - **#1 左侧面板收起报 React error #300** — useState(searchOpen) 移到早退 return 之前，hooks 调用数量一致
  - **#2 启动器焦点偶发丢失** — show 事件驱动 + focus 重试至落位(800ms) + 窗口重获焦点自动聚焦
  - **#3 剪贴板粘贴未到目标/网页焦点丢失** — 激活确认轮询 + GetGUIThreadInfo 焦点捕获 + RestoreFocus + Alt 系快捷键兼容层（clearMenu + Esc 清除 Chrome 菜单态）；五轮排查定位真正根因为 Alt 系快捷键漏给应用
  - **#4 扩展菜单子项闪烁** — 非 modal 化 + hover 桥接死区 + 阻止外部交互误关闭
  - **#5 提示词优化永久卡死** — AbortController + 120s 超时 + 取消/关闭弹窗即中断并复位状态
  - **#6 剪贴板交互增强** — 单击选中/双击粘贴 + window 级方向键导航 + 置顶/删除按钮 stopPropagation
  - **#7 日志分级** — 打包版仅 error/开发版全量 + WISHFUL_CLAW_LOG_LEVEL 覆盖 + debug 级与 log:write 支持
  - **#8 快速搜索匹配增强** — UWP 应用扫描(PowerShell Shell.Application + GBK 解码 + 内联 C# 图标提取 alpha 保留) + ~90 项系统设置入口(ms-settings URI/控制面板/管理工具) + 拼音全拼/首字母/驼峰首字母分层评分 + 启动历史优先 + .lnk target 去重 + 桌面快捷方式扫描 + PE 图标提取器(PNG 压缩图标) + ZTools 扫描器过滤采纳
  - **BOM 回归修复** — 156 个文件被重新加了 UTF-8 BOM，批量去除
  - 验证：TypeScript 3/3 PASS；BOM 扫描 0 残留

## v2-iter-16：左侧面板整理 + use_capability 工具发现增强
- 状态：已完成，待合并 main
- 分支：dev/v2-iter-16
- VERDICT: PASS（编译验证 + 用户人工验证）
- 产品版本: 0.2.16
- Tag: v0.2.16
- Commit: 255e310
- 日期: 2026-08-19
- 备注：
  - **左侧面板搜索** — 搜索输入框 + DB LIKE 消息内容搜索（200ms 防抖）+ 会话标题/项目名称内存过滤 + 搜索结果展示组件
  - **搜索弹窗模式** — cmdk CommandDialog 弹窗模式，默认展示快捷操作 + 最近会话，固定高度 520px + flex 布局
  - **扩展功能重组** — 清空旧扩展项，新增绘图/自动化/任务面板占位，放入扩展下拉菜单
  - **主窗口注册修复** — 新建 main-window-registry.ts，reverse-request 不再用 BrowserWindow.getAllWindows()[0]（辅助窗口会抢占 index 0），改为显式注册的 mainWindow
  - **use_capability 工具发现增强** — list action 支持分页（cursor/page_size）、类型过滤（type/category）、模糊搜索（query）；提取 AgentRuntimeUseCapabilityDiscovery.cs partial class；ToolRegistry 新增 IsAvailableInMode 方法
  - **工具输出截限改为 UTF-8 字节级** — 从 MaxToolOutputChars=16K chars 改为 MaxToolOutputBytes=32K bytes，Rune 边界安全切片；use_capability list/inspect 免截断
  - **DB 搜索端点** — db/messages-search-content IPC 端点 + MessageSearchResultRow entity + InfrastructureJsonContext 注册
  - **剪贴板置顶功能** — 置顶项 + 过期按修改时间判断 + Pin 图标 + 操作按钮统一 hover 显示
  - **BOM 回归修复** — 28 个文件被重新加了 UTF-8 BOM（v2-iter-15 修过的 recurring error），批量去除
  - **回归测试适配** — use_capability 工具发现 + 搜索端点
  - 验证：TypeScript 3/3 PASS；C# build 0 错误

## v2-iter-15：快捷键系统 + 快速启动器 + 剪贴板增强 + 开机启动
- 状态：已完成，待合并 main
- 分支：dev/v2-iter-15
- VERDICT: PASS（编译验证 + 用户人工验证 + 安装包冒烟测试）
- 产品版本: 0.2.15
- Tag: v0.2.15
- Commit: a6f7731
- 日期: 2026-08-18
- 备注：
  - **开机启动开关 + 模块管理页面** — 设置页新增开机自启动开关，模块管理页面
  - **快速启动器 (Alt+Space)** — 全局快捷键 Alt+Space 唤起快速启动器，快捷键捕获注册
  - **剪贴板增强 (Ctrl+Shift+V)** — 剪贴板弹窗前端重写，内嵌设置面板，双击粘贴
  - **快捷键系统** — 快捷键独立设置页（从主设置页提取），多快捷键编辑器，优先级快捷键桥接（priority-shortcuts.ts），快捷键注册反馈
  - **主题同步修复** — 弹窗窗口（剪贴板/启动器）与主应用主题和预设同步，透明 body，Tailwind CSS 导入修复
  - **JSON BOM 修复** — 移除 JSON 文件 UTF-8 BOM 导致 PostCSS 解析错误
  - 验证：TypeScript 3/3 PASS；C# build 0 错误；安装包冒烟测试通过（4 Electron 进程 + 1 Worker 正常拉起）
  - 安装包：wishful-claw-0.2.15-setup.exe，103.02 MiB，SHA-256 D55C0B2E7E90CB72105EFFAC9A6C14DFDF33A78B5CDED5B5EA1262FAFB93D6C8

## v2-iter-14：历史消息反向分页 + 滚动修复 + 侧边栏收起图标统一
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

## v2-iter-13：OpenAI Responses API + 请求超时配置 + 文件树/输入框/设置页收口
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

## v2-iter-12：Goal 生命周期一致性、可审计历史与运行态修复
- 状态：已完成，已合并 main
- 分支：dev/v2-iter-12（合并后清理）
- VERDICT: PASS（自动验证；桌面人工冒烟未执行，用户确认先行合并）
- 产品版本: 0.2.12
- Tag: v0.2.12
- 版本纠正：误建的 `v2.12.0` tag 已撤销，以 `v0.2.12` 为准
- Commit: a6cb015
- 日期: 2026-08-14
- 备注：系统性修复 Goal 状态契约、唯一运行循环、取消安全点、精确持久化、终态收尾、工具状态源、历史保留与 Step 9 阻断缺陷。
  - Goal 目标状态与运行状态分离，统一 pending/active/complete/failed/aborted 及 idle/running/paused
  - 单一 owned loop、恢复与取消链路收敛，Pause/Resume/Abort 遵循安全点并同步前端运行态
  - Goal 历史永久保留，项目/会话隔离，稳定游标分页及前端“加载更多”
  - 新增 list_goals、get_goal_history、reopen_goal；重开保持旧 Goal 不变并写入双向审计事件
  - 三个新增 Goal 工具已加入 use_capability 显式代理白名单，未开放其他 Goal 控制工具
  - Goal 分解/评估使用无副作用 provider turn，避免编排阶段误调用工具
  - 验证：TypeScript 3/3 PASS；Agent build 0 错误/0 警告；Goal 回归 91 项 PASS；NativeAOT PASS；git diff --check PASS

## v2-iter-11：Native AOT 打包 — SqlSugar → Microsoft.Data.Sqlite 迁移
- 状态：已完成 PASS
- Tag: v2.11.0
- 分支：dev/v2-iter-11
- Commit: 23c3fc9
- 日期: 2026-08-09
- 备注：将 SqlSugar ORM 完全替换为 Microsoft.Data.Sqlite（零反射，AOT 友好）。
  - 新建 DbService 包装类（Query/QueryFirstOrDefault/QueryScalar/Execute/ExecuteReturnIdentity/Exists/QueryDataTable），替代 SqlSugarScope
  - 新建 EntityMappers（9 个 entity 的显式 mapper 委托，编译时确定，零反射）
  - 新建 DbReaderExtensions（SqliteDataReader null 安全扩展）
  - 重写 DbClient：手写 CREATE TABLE DDL（10 表 + FTS5 虚拟表 + 4 个触发器），替代 CodeFirst
  - 迁移全部 9 个 Db*Tools 文件 + MemoryFtsService + Agent 层 5 个文件 + Worker MemoryModule
  - 移除全部 SugarTable/SugarColumn 属性，Entity 类变为纯 POCO
  - 清除 AOT 逃避配置：删除 rd.xml、移除 StaticConfig.EnableAot、移除 JsonSerializerIsReflectionEnabledByDefault
  - **AOT 反射序列化消除**：新增 AotResultTypes/AotAgentResultTypes/AotProjectResultTypes/AotSubAgentResultTypes/AotMemoryResultTypes 具名类型替代匿名类型
  - **Json 显式传参**：全部 143 处 WorkerResponse.Json 调用显式传 JsonTypeInfo；新增 InfrastructureJsonContext，扩展 AgentRuntimeJsonContext/WishfulClawJsonContext
  - **ToolProvider 直接注册**：移除反射加载（删除 ToolProviderDiscovery），ToolModule 直接 new 实例注册
  - **JsonArray.Add 消除警告**：改用非泛型 JsonNode 重载，AOT 编译 0 警告
  - **系统托盘**：关闭窗口最小化到托盘，托盘菜单退出（参考 OpenCowork）
  - **图标修复**：extraResources 打包图标，主进程按 app.isPackaged 定位
  - C# 编译：0 错误；TypeScript 编译：3/3 配置 PASS；AOT 打包：Worker.exe = 14.6 MB，0 警告
  - C++ 工具链：VS 2026 Build Tools (MSVC 14.44)，需 vcvars64.bat 初始化环境（已固化到 scripts/publish-aot-worker.mjs）

## v2-iter-10：全局会话 + 项目编排工具
- 状态：已完成
- 分支：main
- VERDICT: PASS
- Tag: v2.10.0
- Commit: 1d3eb2f
- 日期: 2026-08-08
- 备注：全局会话 + 4 个项目编排工具（list_projects/get_project_details/create_session/send_session_message），ToolProvider availableModes 扩展 "global" 模式，sessionMode 类型支持 "global"，send_session_message 通过 reverse request 走 renderer sendMessage 链路，fire-and-forget 异步执行，InputArea 区分全局/项目会话。
  - 审查修正：send_session_message 描述改为 fire-and-forget 语义，清理返回值调试信息，加 .catch() 防止未捕获 rejection
  - ContextCompression 拆分为 partial class（TokenEstimation + Transcript）
  - 相关修复：ProviderRetryPolicy 400 可重试、FileListTool hidden 默认 true、DbMessageTools 更新 UpdatedAt、cancelStream 多会话修复、会话列表流式状态指示器



## 迭代一：项目骨架
- 状态：已完成
- 分支：dev/iter-1
- Plan: docs/plans/plan_001/
- VERDICT: PASS
- Tag: v0.1.0
- Commit: (待 commit)
- 日期: 2026-07-20
- 备注：全链路验证通过。Electron + .NET 工程跑起来，前端发 ping，后端回 pong（ok=true, pid=<worker_pid>）。

## 迭代二：AI 服务商 + 模型管理
- 状态：已完成
- 分支：dev/iter-2
- Plan: docs/plans/plan_002/
- VERDICT: PASS
- Tag: v0.2.0
- Commit: c4f5b10
- 日期: 2026-07-21
- 备注：28 个内置预设完整对齐 OpenCowork（含 OAuth/Channel），Provider CRUD + 连通性测试 + 模型拉取，前端设置页面（Provider/通用/i18n），验证通过

## 迭代三：Agent Loop + 对话
- 状态：已完成（含前端修复）
- 分支：dev/iter-3
- Plan: docs/plans/plan_003/ + docs/plans/plan_003b/
- VERDICT: PASS (plan_003 + plan_003b)
- Tag: v0.3.0 (plan_003) / v0.3.1 (plan_003b 待打)
- Commit: d5f0245 (plan_003) / adeae4d (plan_003b)
- 日期: 2026-07-21
- 备注：
  - plan_003: Agent Loop 后端 + 前端流式对话（v0.3.0 已验证通过）
  - plan_003b: 前端框架修复 — 搬入 OpenCowork 完整布局（NavRail+WorkspaceSidebar+TitleBar+CommandPalette+RightPanel+SessionConversationPane+ChatHomePage+ProjectHomePage），保留所有功能入口+接口预留，chat-store 拆分7文件+immer中间件。tsc+electron-vite build+dotnet build 全部通过。

## 迭代四：工具链（最小集）
- 状态：已完成
- 分支：dev/iter-4（已合并 main）
- Plan: docs/plans/iter-4/plan-001/ + docs/plans/iter-4/plan-002/
- VERDICT: PASS
- Tag: v0.4.0
- Commit: 867b890 (plan-001) / 03bf2e2 (plan-002)
- 日期: 2026-07-22
- 备注：
  - plan-001: 后端工具框架 — IToolExecutor 接口 + ToolRegistry + 7个工具实现（Read/Write/Edit/LS/Glob/Grep/Bash）+ ToolModule 注册 + tool/list IPC handler。dotnet build 0错误。
  - plan-002: AgentLoop 工具执行集成 + 前端工具 UI — 替换占位代码实现完整工具调用循环，前端 ToolCallCard 组件 + 事件处理 + sendMessage 传入 tools/workingFolder。tsc+build+dotnet 全部通过。

## 迭代五：项目注册 + 会话历史
- 状态：已完成
- 分支：dev/iter-5（已合并 main）
- Plan: docs/plans/iter-5/plan-001/ + docs/plans/iter-5/plan-002/
- VERDICT: PASS (编译验证 + 端到端 DB 测试)
- Tag: v0.5.0
- Commit: 48e6aec (plan-001) / 45104f1 (plan-002)
- 日期: 2026-07-22
- 备注：
  - plan-001: 后端 DB 层 — SqlSugarCore ORM + DbClient/DbEntities/DbProjectTools/DbSessionTools/DbMessageTools/DbModule，CodeFirst 自动建表，8 项端到端测试通过
  - plan-002: 前端 DB 层 — db-helpers.ts 用 workerRequest 直连 Worker（简化架构，无需 Main 侧 DAO），消息序列化/反序列化，sendMessage/message_end 实时持久化，dbLoadAll 启动加载，loadRecentSessionMessages 按需加载
  - 架构简化：原计划 5 个 Main 侧文件 → 0 个（worker:request 通用转发器已覆盖）
  - tsc + electron-vite build + dotnet build 全部通过

## 迭代六：人格系统
- 状态：已完成
- 分支：dev/iter-6（已合并 main）
- Plan: docs/plans/iter-6/plan-001 ~ plan-008
- VERDICT: PASS (编译验证 tsc + electron-vite build + dotnet build 全部通过)
- Tag: v0.6.0
- Commit: 1a8289f ~ a9804bf
- 日期: 2026-07-23
- 备注：
  - plan-001: 后端人格数据层 — PersonaModels + PersonaStore + 6 套 24 个 .md 预设 + csproj 嵌入资源
  - plan-002: PersonaModule IPC 端点 — list/get/save/delete/apply-to-project
  - plan-003: 前端人格管理 UI（全局）— persona-types + persona-store + PersonaPanel(拆 3 文件) + SettingsPage 集成 + i18n
  - plan-004: 项目级人格管理 UI — PersonaPanel 支持 workingFolder + ChatView persona + MainLayout + ProjectHomePage 按钮
  - plan-005: SplashPage 改造 — PersonaSelectPage + onboarding 流程 + settings-store 加 defaultPersonaId
  - plan-006: PromptBuilder + AgentLoop 集成 — 分段组装 System Prompt + 字符预算截断 + InjectSystemPrompt
  - plan-007: AI 辅助创建人格 — PersonaGenerator（单轮 LLM 调用）+ persona/generate 端点 + PersonaGeneratorDialog
  - plan-008: 会话级人格切换 + DB 变更 — SessionEntity 加 PersonaId + ALTER TABLE 迁移 + PersonaSwitcher 组件
  - PersonaStore 耦合拆分：PersonaStore(文件 CRUD) + PersonaPresetService(预设加载)

## 迭代七：记忆系统
- 状态：已完成
- 分支：dev/iter-7（已合并 main）
- Plan: docs/plans/iter-7/plan.md (Plan 1~8)
- VERDICT: PASS (编译验证 tsc + dotnet build 全部通过)
- Tag: v0.7.0
- Commit: c8b481b ~ aac4ba0
- 日期: 2026-07-23
- 备注：
  - Plan 1: 接口和模型定义 — MemoryModels (MemoryEntry/MemoryTier/MemoryPriority/MemorySearchResult/MemoryStats/MemoryFrontmatter/MemorySection) + IMemoryStore + IMemorySearch + IMemoryRecall
  - Plan 2: 文件层 — MemoryMarkdownParser (## 分段解析+UpsertSection) + MemoryFrontmatterParser (YAML frontmatter) + MemoryPathResolver (scope→路径) + MemoryStore (MEMORY.md/daily/dormant CRUD)
  - Plan 3: FTS5 索引层 — MemoryArchiveEntity + memory_fts FTS5 虚拟表 + 触发器自动同步 + MemoryFtsService (Search/Index/Archive/SearchCold)
  - Plan 4: 记忆工具 — memory_append/memory_search/memory_read/memory_write 4 个工具 + ToolModule 注册 + ToolTypes 加 ProjectId
  - Plan 5: TryInjectRecall — ContextBudgetPlanner (Token×4+字符双限制) + MemoryRecallService (先项目后全局+冷记忆fallback) + AgentLoop iteration==1 时注入
  - Plan 6: System Prompt 集成 — PromptBuilder.BuildMemoryContext 注入 MEMORY.md Critical 段 (预算 6000 字符)
  - Plan 7: MemoryModule IPC — 9 个端点 (stats/list/search/read/write/append/promote/archive/consolidate)
  - Plan 8: 前端 — memory-helpers.ts (IPC 封装) + MemoryPanel.tsx (统计卡片+搜索+结果) + RightPanel 双 tab + i18n (中英文)
  - 三层架构：Hot (MEMORY.md 文件) / Warm (dormant/*.md 文件) / Cold (SQLite memory_archive 表 + FTS5)
  - scope 字段区分：global (~/.wishful-claw/) 或 project:{workingFolder} ({工作区}/.wishful-claw/)
  - TryInjectRecall 注入为 User Message，标注 untrusted reference data 防 prompt injection

## 迭代八：集成验证
- 状态：已完成
- 分支：main
- Plan: —
- VERDICT: PASS
- Tag: v0.8.0
- Commit: 32ed2a6
- 日期: 2026-07-23
- 备注：
  - 记忆系统全链路修复（FTS5外部内容表、触发器语法、参数绑定）
  - Worker 进程防崩溃
  - 日志等级控制
  - 记忆工具预览 UI
  - 消息时间戳
  - 历史消息加载修复
  - Agent Loop 迭代限制去除
  - Base Instruction 人格冲突修复（改为运行环境介绍而非身份定义）
  - 代码已合并到 main，旧开发分支已清理

---

## v2 迭代

### v2-iter-2：缓存命中率修复 + LLM 上下文压缩 + 版本号统一
- 状态：已完成
- 分支：dev/v2-iter-2（已合并 main）
- VERDICT: PASS
- Tag: v2.2.0
- Commit: 8b19017
- 日期: 2026-07-2?
- 备注：缓存命中率统计修复、LLM 上下文压缩、版本号统一为 v2.x、OpenCowork 名称清理、7 层架构文档更新

### v2-iter-3：Infrastructure 层拆分 + DeepSeek 缓存命中率深度修复
- 状态：已完成
- 分支：dev/v2-iter-3（已合并 main）
- VERDICT: PASS
- Tag: v2.3.0
- Commit: 318e126
- 日期: 2026-07-2?
- 备注：Infrastructure 层 Db/Storage/Http 下沉、Worker 深度瘦身（Modules 迁入 Agent/Infrastructure，Worker 降至 12 文件）、缓存命中率深度修复

### v2-iter-9：Goal 模式自动编排 + 系统完善
- 状态：已完成
- 分支：dev/v2-iter-9（已合并 main）
- VERDICT: PASS
- Tag: v2.9.0
- Commit: 9f8d861
- 日期: 2026-08-07
- 备注：
  - Goal 模式自动编排 — create_goal 进 pending，前端确认卡片（类似计划模式确认卡片）用户确认后启动 GoalOrchestrator 自动编排执行，goal/confirm IPC 路由
  - GoalOrchestrator 拆分 — GoalOrchestrator / GoalOrchestratorLLM / GoalOrchestratorLoop / GoalOrchestratorModels / GoalPlanTracker / GoalPromptTemplates / GoalBackoffStrategy，goal → plan → execute → verify → continue/adjust 状态机
  - 上下文压缩阈值统一 — 后端阈值基数改用 effectiveWindow（contextLength−预留输出），与前端 getCompressionTriggerTokens 对齐，两端约 80% 一致触发
  - 移除前端压缩死代码 — context-compression-runtime.ts 及 types.ts 中 contextCompression 字段（压缩实际由后端 worker 执行）
  - 内置浏览器修复 — BrowserPanel 改用 callback ref 绑定 webview 事件，修复首次挂载与 key 切换时事件不绑定、导航重绑问题；新增 render-process-gone 崩溃自动恢复
  - main 窗口推送统一用 postMessage — 避免 webContents.send 在 frame 销毁时异步抛 Render frame was disposed；修复 goal:confirm 注册参数错位
  - 工具耗时显示 — file 写入/编辑改为毫秒(ms)级别，与其余工具一致
  - 配色默认值 — 默认配色改远航蓝(studio) 并迁移；AOT 兼容配置（StaticConfig.EnableAot + rd.xml）

### v2-iter-8：计划模式（人机协同执行引擎）
- 状态：已完成
- 分支：dev/v2-iter-8（已合并 main）
- VERDICT: PASS
- Tag: v2.8.0
- Commit: 7e19496
- 日期: 2026-08-05
- 备注：
  - 计划模式状态机 — explore → plan → confirm → execute → verify，Agent 接收需求后走完整人机协同流程
  - 计划文件格式 — .wishful-claw/plans/{planId}.md 计划文件 + {planId}.state.json 状态文件（计划标题、步骤清单、每步状态、执行结果摘要）
  - 状态落盘 — 执行过程中实时更新 state.json，外部可读取“当前在做什么、做到哪了”
  - 用户确认环节 — SubmitPlanReview 通过 reverse request 暂停 agent loop 等待用户确认，确认后才执行；ExitPlanMode 取消计划
  - 前端 PlanReviewCard — 步骤清单 + 实时状态 + 验证结果 + Adjust plan 反馈输入
  - Plan mode banner — session 级隔离（planModesBySession），Exit Plan Mode 按钮处理两种场景：agent 流式中 cancelStream + sendMessage，等待 review 时 cancelPlanReview resolve cancelled
  - 工具拆分 — ExitPlanMode 拆为 SubmitPlanReview（提交审查）+ ExitPlanMode（取消），新增 UpdatePlanStep（步骤状态跟踪）
  - Plan store 从 invokeMessagePackBinary 迁移到 window.api.workerRequest
  - PlanEntity + DbPlanTools — plans 表 CodeFirst 自动建表，6 个 DB 端点注册到 DbModule
  - PromptBuilder guidance 通过工具返回值注入而非 system prompt
  - AgentRuntimePlanExecutor.cs 拆分为 4 个 partial class（778→525+80+87+119）
  - 双编译零错误：tsc --noEmit (3 configs) + dotnet build

### v2-iter-7：主聊天折叠块模式
- 状态：已完成
- 分支：dev/v2-iter-7（已合并 main）
- VERDICT: PASS
- Tag: v2.7.0
- Commit: a36f392
- 日期: 2026-08-04
- 备注：
  - ExecutionProcessBlock 折叠块组件 — 执行中展开，结束后自动折叠成摘要，用户可手动 toggle
  - 过程/最终文本拆分 — 从 render items 末尾向前扫描，执行过程（thinking/tool_use）包裹在折叠块内，最终输出（text/image）在折叠块之外
  - 按工具分类摘要 — 细分 commands/reads/edits/browser/desktop/orchestration/mcp/interactive/visual/skill/other
  - collapsible 动态计算 — 只有存在工具调用时才折叠，纯思考+回复不折叠
  - 取消执行处理 — 取消时也折叠过程，最终回复区域显示固定文本
  - 缓存命中率修复 — 从 session 级请求计数改为 token 级口径（cacheRead/input），修复 session 恢复后后端计数器丢失导致百分比不准
  - 原计划含右侧工作台 tab + ToolCallCard compact 模式，开发中决策去掉（折叠块内 ToolCallCard 本身有展开预览能力，compact 模式去掉再补工作台是绕圈子）
  - content-renderer.tsx 从 525 行拆分至 494 行（提取 splitProcessAndFinal 到 process-summary.ts）

### v2-iter-6：SSH 远程执行 + Agent 终端旁观 + 项目档案
- 状态：已完成
- 分支：dev/v2-iter-6（已合并 main）
- VERDICT: PASS
- Tag: v2.6.0
- Commit: e1529ee
- 日期: 2026-08-04
- 备注：
  - Agent SSH 输出不自动展开终端面板，输出在面板隐藏时仍写入 xterm 缓冲
  - 终端面板可见性从 project 级改为 session 级（bottomTerminalDockOpenBySessionId）
  - 非 SSH 项目无 ssh_capability 提示块（BuildSshContext 返回 Empty）
  - BuildSshContext 只在 SSH 项目时调用（sshConnectionId 检查）
  - Bash 工具加 `local: true` 逃生口，SSH 项目中 Agent 可操作本地
  - ShellExecuteTool.cs 901 行拆分为 4 个 partial class（AGENTS.md 规范）
  - ProjectArchivePage.tsx 765 行拆分为 3 个文件
  - 终端关闭不自动收起面板，用户手动控制
  - 终端 i18n 补全（16 个 key 加到 zh/en layout.json）
  - 本地项目首次打开终端面板自动创建终端（dockOpen 时触发）
  - node-pty native module 打包修复（electron.vite.config.ts external）

### v2-iter-5：渠道配置测试与完善
- 状态：已完成
- 分支：dev/v2-iter-5（已合并 main）
- VERDICT: PASS
- Tag: v2.5.0
- Commit: 8822390
- 日期: 2026-08-03
- 备注：
  - Channel 系统初始化（ChannelManager + 注册 + autoStart + stopAll）
  - 8 个渠道中文化 + 顺序调整（微信/飞书/QQ/钉钉/企业微信/国际）
  - 飞书 OAuth Device Flow 扫码绑定（参考 Reasonix）
  - 微信长轮询扫码绑定
  - auto-reply hook（渠道消息→sendMessage→Agent Loop→回复发回渠道）
  - 会话标题带渠道前缀（飞书: 桃子）
  - 全局渠道设置区（人格选择 + Provider/Model 选择）
  - 布局参考 Reasonix：上方渠道列表+详情，下方全局设置
  - 渠道三态状态显示 + 启动时查询实际状态
  - channel-plugin-handlers.ts 拆分为 3 个文件（CRUD/Session/Stream）
  - 安装 bufferutil/utf-8-validate（ws 原生依赖）、react-pdf/xlsx/mammoth（前端预览）

## 后续迭代规划

### 迭代九：输入框修复 + 提示词优化器
- 状态：已完成（dev/iter-11 分支，待合并 main）
- 优先级：高 — 直接影响使用体验
- 目标：修复输入框底部 token 统计全为 0 的问题；实现提示词优化器功能

| Plan | 内容 | 涉及文件 | 说明 |
|------|------|----------|------|
| 9-1 | 提示词优化器实现 | `src/renderer/src/lib/prompt-optimizer/optimizer.ts` | 从 OpenCowork 移植，复用已有 `streamSidecarProviderTurn` + `usePromptOptimizer` hook。当前 optimizer.ts 是空壳 stub |
| 9-2 | Token 统计修复 | `OpenAIChatSseParser.cs` / `runtime-status.tsx` | 排查 usage 是否为 null（疑似中转商不支持 `stream_options.include_usage`）。若确认无 usage 返回，后端做 fallback 估算 |
| 9-3 | AGENTS.md 路径修正 | `AGENTS.md` | 参考项目路径从 `D:\gy\*` 更新为 `D:\claw\*`（笔记本实际路径） |

- 技术要点：
  - 提示词优化器：OpenCowork 方案是用 `streamSidecarProviderTurn`（`providerTurnOnly: true`）做单轮 LLM 调用，给模型提供 `WriteOptimizedPrompts` 工具返回 1-3 个优化方案。wishful-claw 已有 `streamSidecarProviderTurn`，可直接复用
  - Token 统计：数据链路（C# Worker → MessagePack 编码 → IPC → 前端解码 → chat-store → ComposerRuntimeStatus）代码逻辑无误，最可能是中转商不返回 usage。需加日志确认

### 迭代十：子 Agent（Sub-Agent）
- 状态：已完成（dev/iter-11 分支，待合并 main）
- 优先级：高 — 功能扩展核心方向
- 目标：实现子 Agent 的创建、执行、事件流和前端渲染
- 前端已有骨架：`OrchestrationBlock`、`OrchestrationMemberStrip`、`SubAgentCard` 等组件
- 参考来源：OpenCowork `sub-agents/` 目录
- 技术要点：
  - 子 Agent 生命周期管理（独立 runId，挂载到父 Agent state）
  - 事件流（`sub_agent_start` / `sub_agent_progress` / `sub_agent_end`）
  - Task 工具：父 Agent 通过工具调用启动子 Agent
  - 前端事件适配和渲染

### 迭代十一：右侧面板 + 子 Agent 架构增强 + 终端/文件管理
- 状态：已完成（dev/iter-11 分支，待合并 main）
- 优先级：高
- 目标：右侧面板动态 Tab 系统、子 Agent 架构五阶段增强、终端面板与文件管理快捷入口
- 备注：8 个 Plan 全部完成，tsc + build + dotnet build 通过。遗留：agent:changes stub、代码拆分、合并 main
- 技术要点：
  - 工具调用卡片的折叠/展开交互
  - Thinking block 展示优化
  - 消息间距和视觉层次
  - Agent Loop 多轮迭代的展示方式（当前平铺在一条消息内，可能调整为分段展示）

### 迭代十二：SSH 远程执行 + Agent 终端旁观
- 状态：已完成（v2-iter-6）
- VERDICT: PASS
- Tag: v2.6.0
- Commit: e1529ee
- 日期: 2026-08-04
- 目标：Agent 通过 SSH 长连接远程执行命令，执行过程实时输出到终端面板供用户旁观
- 备注：已完成，详见上方 v2-iter-6 条目

### 迭代十三：聊天窗渲染调整（参考灵犀）
- 状态：已完成（v2-iter-7）
- VERDICT: PASS
- Tag: v2.7.0
- 日期: 2026-08-04
- 目标：借鉴灵犀工作台模式，聊天窗统一用折叠块组件渲染 Agent 回复
- 备注：已完成，详见上方 v2-iter-7 条目

### 迭代十四：Skill 市场
- 状态：未开始
- 优先级：中 — 生态扩展
- 目标：实现 Skill 的安装/卸载/列表管理和在线市场

### 迭代十五：MCP 管理
- 状态：未开始
- 优先级：中 — 生态扩展
- 目标：实现 MCP Server 的配置管理和工具调用
- 前端已有骨架：`mcp-store`
- 技术要点：
  - MCP Server 配置管理
  - MCP 工具动态注册和调用
  - MCP 状态监控
