# 迭代六：人格系统


**目标**：不同人格，输出风格不同。

| 步骤 | 内容 |
|------|------|
| 1 | 实现 Identity / Soul 文件读写（全局 + 项目级） |
| 2 | 实现 PersonaPreset 预设管理（内置 6 种 + 自定义） |
| 3 | 实现 PromptBuilder（分段组装 System Prompt + 字符预算） |
| 4 | System Prompt 构建从前端移到后端（runtime 侧组装） |
| 5 | 实现人格在最终输出时体现（输出层加工，不介入 Loop 决策） |
| 6 | 前端人格切换面板（选择/预览/自定义人格） |

**验证标准**：切换"极简执行者"和"深度分析师"两种人格，同一个问题得到风格明显不同的回答。

> **执行记录**：迭代六实际做了人格系统（原计划为记忆系统，执行顺序与迭代七对调）。8 个 Plan 全部完成。PromptBuilder 分段组装 System Prompt + 字符预算截断 + InjectSystemPrompt。Base Instruction 在迭代八中改为运行环境介绍而非身份定义。
