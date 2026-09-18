# 开发进度

> 进度总览：每个迭代一行（迭代号 + Tag + 日期 + 简述），明细见 `docs/progress/` 下对应文件。
> 迭代收尾时：本表新增一行，并在 `docs/progress/` 创建 `v2-iter-{N}.md` 明细（格式见 `docs/dev-workflow.md`）。

## v1 迭代（MVP）

| 迭代 | Tag | 日期 | 简述 |
|---|---|---|---|
| [迭代1](progress/iter-1.md) | v0.1.0 | 2026-07-20 | 项目骨架 |
| [迭代2](progress/iter-2.md) | v0.2.0 | 2026-07-21 | AI 服务商 + 模型管理 |
| [迭代3](progress/iter-3.md) | v0.3.0 / v0.3.1 | 2026-07-21 | Agent Loop + 对话 |
| [迭代4](progress/iter-4.md) | v0.4.0 | 2026-07-22 | 工具链（最小集） |
| [迭代5](progress/iter-5.md) | v0.5.0 | 2026-07-22 | 项目注册 + 会话历史 |
| [迭代6](progress/iter-6.md) | v0.6.0 | 2026-07-23 | 人格系统 |
| [迭代7](progress/iter-7.md) | v0.7.0 | 2026-07-23 | 记忆系统 |
| [迭代8](progress/iter-8.md) | v0.8.0 | 2026-07-23 | 集成验证 |

## v2 迭代

| 迭代 | Tag | 日期 | 简述 |
|---|---|---|---|
| v2-iter-1 | — | — | 无进度记录（规划见 iteration-plan.md） |
| [v2-iter-2](progress/v2-iter-2.md) | v2.2.0 | 2026-07-2? | 缓存命中率修复 + LLM 上下文压缩 + 版本号统一 |
| [v2-iter-3](progress/v2-iter-3.md) | v2.3.0 | 2026-07-2? | Infrastructure 层拆分 + DeepSeek 缓存命中率深度修复 |
| v2-iter-4 | — | — | 无进度记录（规划见 iteration-plan.md） |
| [v2-iter-5](progress/v2-iter-5.md) | v2.5.0 | 2026-08-03 | 渠道配置测试与完善 |
| [v2-iter-6](progress/v2-iter-6.md) | v2.6.0 | 2026-08-04 | SSH 远程执行 + Agent 终端旁观 + 项目档案 |
| [v2-iter-7](progress/v2-iter-7.md) | v2.7.0 | 2026-08-04 | 主聊天折叠块模式 |
| [v2-iter-8](progress/v2-iter-8.md) | v2.8.0 | 2026-08-05 | 计划模式（人机协同执行引擎） |
| [v2-iter-9](progress/v2-iter-9.md) | v2.9.0 | 2026-08-07 | Goal 模式自动编排 + 系统完善 |
| [v2-iter-10](progress/v2-iter-10.md) | v2.10.0 | 2026-08-08 | 全局会话 + 项目编排工具 |
| [v2-iter-11](progress/v2-iter-11.md) | v2.11.0 | 2026-08-09 | Native AOT 打包 — SqlSugar → Microsoft.Data.Sqlite 迁移 |
| [v2-iter-12](progress/v2-iter-12.md) | v0.2.12 | 2026-08-14 | Goal 生命周期一致性、可审计历史与运行态修复 |
| [v2-iter-13](progress/v2-iter-13.md) | v0.2.13 | 2026-08-14 | OpenAI Responses API + 请求超时配置 + 文件树/输入框/设置页收口 |
| [v2-iter-14](progress/v2-iter-14.md) | v0.2.14 | 2026-08-17 | 历史消息反向分页 + 滚动修复 + 侧边栏收起图标统一 |
| [v2-iter-15](progress/v2-iter-15.md) | v0.2.15 | 2026-08-18 | 快捷键系统 + 快速启动器 + 剪贴板增强 + 开机启动 |
| [v2-iter-16](progress/v2-iter-16.md) | v0.2.16 | 2026-08-19 | 左侧面板整理 + use_capability 工具发现增强 |
| [v2-iter-17](progress/v2-iter-17.md) | v0.2.17 | 2026-08-20 | 缺陷修复迭代 |
| [v2-iter-18](progress/v2-iter-18.md) | v0.2.18 | 2026-08-20 | 429 重试配置化 + 输入框状态独立显示 + 默认模式工具审批 |
| [v2-iter-19](progress/v2-iter-19.md) | v0.2.19 | 2026-08-23 | Goal 编排记录可视化 + 三层生命周期收口 |
| [v2-iter-20](progress/v2-iter-20.md) | v0.2.20 | 2026-08-24 | 审查修复 · 安全与运行时健壮性 |
| [v2-iter-21](progress/v2-iter-21.md) | v0.2.21 | 2026-08-25 | 设置页重构 + 运行时健壮性补强 |
| [v2-iter-22](progress/v2-iter-22.md) | v0.2.22 | 2026-08-27 | 微信/飞书渠道与定时任务打磨 |
| [v2-iter-23](progress/v2-iter-23.md) | v0.2.23 | 2026-08-29 | 会话可靠性与缺陷收口 |
| [v2-iter-24](progress/v2-iter-24.md) | v0.2.24 | 2026-09-05 | 全局产品经理 Agent + 会话临时 Todo |
| [v2-iter-25](progress/v2-iter-25.md) | v0.2.25 | 2026-09-07 | 微信渠道全局会话闭环 |
| [v2-iter-26](progress/v2-iter-26.md) | v0.2.26 | 2026-09-09 | 桌面自动更新体验收口 + 4 项 Obsidian 待办 + 项目变更面板 |
| [v2-iter-27](progress/v2-iter-27.md) | v0.2.27 | 2026-09-11 | 更新弹窗全屏阅读 + 扩展互斥切换 + 会话 Todo 闭环 + 日志/数据目录隔离 + 粘贴撤销修复（Provider fallback 移交 iter-28） |
| [v2-iter-28](progress/v2-iter-28.md) | v0.2.28 | 2026-09-13 | 模型用量统计面板 + 工具可见性收敛到注册期声明 + 渠道设置全局化 + 内置服务商懒物化 + 聊天执行态渲染修复 + 使用指引与补位模型 |
| [v2-iter-29](progress/v2-iter-29.md) | v0.2.29 | 2026-09-15 | S-16~S-25 十项正式需求 + T-1~T-15 十五项临时需求 + 渠道配置页改版 + 限额自动接管收口 |
| [v2-iter-30](progress/v2-iter-30.md) | v0.2.30 | 2026-09-16 | 工具输出落盘 spill + 免费对话页 + 聊天窗跳动收口 + 工具可见性体系收口（preset 退役）+ 会话 todo 每轮注入 + 配对错自愈 |
| [v2-iter-31](progress/v2-iter-31.md) | v0.2.31 | 2026-09-18 | 死代码清理 + 代码图谱核心化 + 子代理轮次与报告回传 + 时间戳/排队/终端/权限档/剪贴板/文档预览/更新巡检七项修复 + 服务商推荐分组 |
