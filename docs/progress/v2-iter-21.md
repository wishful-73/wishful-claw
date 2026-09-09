# v2-iter-21：设置页重构 + 运行时健壮性补强

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

---

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
