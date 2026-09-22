# 迭代七：记忆系统


**目标**：记忆用上了，不是黑箱。

| 步骤 | 内容 |
|------|------|
| 1 | 实现工作区文件结构（~/.wishful-claw/ 全局 + .wishful-claw/ 项目级） |
| 2 | 实现 FTS5 搜索索引（记忆文件变更时同步更新索引） |
| 3 | 实现记忆主动回忆（TryInjectRecall：Loop 开始前自动检索注入） |
| 4 | 实现记忆工具（memory_read / memory_write / memory_search） |
| 5 | 实现记忆分层流转（sessions → topics → dormant → archive） |
| 6 | 实现记忆巩固 + HEARTBEAT 语义降级 |
| 7 | 前端记忆面板（可视化记忆文件、状态、搜索） |

**验证标准**：对话中告诉 Agent "记住我是前端工程师" → 关闭重开 → 新对话中 Agent 知道你是前端工程师（通过主动回忆注入，不是用户重新说）。

> **执行记录**：迭代七实际做了记忆系统（与迭代六对调）。8 个 Plan 全部完成。三层架构 Hot/Warm/Cold + FTS5。scope 隔离设计（global / project:{workingFolder}）。TryInjectRecall 注入为 User Message，标注 untrusted reference data。
