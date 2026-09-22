# 迭代二：AI 服务商 + 模型管理


**目标**：能配置 Provider，选择模型，为后续对话做准备。

| 步骤 | 内容 |
|------|------|
| 1 | 从 OpenCowork 搬入 Provider 配置框架（API Key 管理、Base URL、模型列表、配置字段等，直接用） |
| 2 | 清理 routin.ai 相关私货（预设端点、模型预设、token 中转硬编码），其余全部保留 |
| 3 | 实现模型配置存储（Provider 列表、模型列表、默认模型，存 SQLite） |
| 4 | 前端 Provider 设置页面（直接用 OpenCowork 的，只删 routin.ai 相关内容） |
| 5 | 实现模型连通性测试（配置后能验证 API 是否可用） |

**验证标准**：添加一个 OpenAI 兼容 Provider → 填 API Key 和 Base URL → 测试连通性通过 → 能看到可用模型列表。
