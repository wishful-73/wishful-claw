# v2-iter-22：微信/飞书渠道与定时任务打磨（已完成，已合并 main）

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

---

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
