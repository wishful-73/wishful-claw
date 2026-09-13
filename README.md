<p align="center">
  <h1 align="center">Wishful Claw</h1>
  <p align="center">
    <strong>桌面 AI Agent 工作台 — 有记忆、有人格、能动手</strong><br>
    用一句自然语言交代任务，它在你自己的电脑上读写文件、执行命令、搜索代码、操作浏览器。
  </p>
</p>

<p align="center">
  <a href="#-快速上手">快速上手</a> •
  <a href="#-它能为你做什么">功能</a> •
  <a href="docs/user-guide.md">使用指引</a> •
  <a href="https://github.com/wishful-73/wishful-claw/releases/latest">下载</a> •
  <a href="docs/development.md">开发说明</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.2.28-orange" alt="Version">
  <img src="https://img.shields.io/badge/Platform-Windows-blue" alt="Windows">
  <img src="https://img.shields.io/badge/.NET-11-blue" alt=".NET">
  <img src="https://img.shields.io/badge/Electron-43-blue" alt="Electron">
  <img src="https://img.shields.io/badge/License-Apache_2.0-blue" alt="License">
</p>

---

## 🚀 快速上手

1. 到 [Releases](https://github.com/wishful-73/wishful-claw/releases/latest) 下载 `wishful-claw-x.y.z-setup.exe`，双击安装（无需另装运行时）。
2. 打开后进入 **设置 → AI 服务商**，选一家模型服务商，填入你自己的 API Key，点测试连通性并设为当前使用。
3. 回到主界面，新建一个项目指向你的代码目录，把任务说出来。第一次建议打开**计划模式**，先看它的方案再放它动手。

完整上手步骤、每一项能力的用法和排查方法都在 **[使用指引](docs/user-guide.md)** 里（应用内点顶栏的问号图标也能打开）。

## ✨ 它能为你做什么

### 🧠 长期记忆

- 对话开始前自动检索相关记忆注入，Agent 也会主动读写记忆——跨会话记住你的偏好、约定和踩过的坑
- 三层结构：活跃的 `MEMORY.md` 文本文件、可全文检索的条目库、超预算后降级留存的归档，自动在层间流转
- 支持每日定时自动整理：合并重复、清理过期、压缩冗长条目
- 全局记忆与项目记忆分开，项目那份跟着仓库走，可以用 Git 管理

### 🎭 人格与说话方式

- 内置多套人格预设（桃子、老郑、贾维斯、小爪、婷姐、阿明），可自定义身份、语气与行为准则
- 支持用 AI 从一段描述生成人格初稿
- 可以按全局、按项目、按会话分别指定不同人格
- 人格只加工最终输出，不干扰任务决策——换人格不会让活儿跑偏

### 🧰 干活的手段

| 方向 | 能力 |
|------|------|
| 代码 | 读 / 写 / 改文件、全文搜索、文件名匹配、代码图谱索引与语义检索 |
| 终端 | 执行 Shell 命令，输出超限自动保护 |
| 浏览器 | 内置浏览器导航、读取页面结构、点击与输入，可用来查资料和验证网页效果 |
| 图片 | 文生图、读图理解 |
| 远程 | SSH 连接管理、把远端目录当项目工作区、远端执行命令 |
| 并行 | 派发子 Agent 同时处理独立问题，结果汇总回主线 |
| 桌面 | 整桌面截图，用于取证或让你看清当前状态 |

Agent 干活时你可以随时插话：消息进队列，等当前这轮结束按序处理。

### 🎯 自主推进

- **计划模式** —— 先只读浏览代码，产出分步方案，你批准后才动文件
- **Goal 模式** —— 给一个目标，它按 plan → execute → verify → continue/adjust 循环自我推进并检查完成度
- **协作模式** —— 连续自主工作，只在需要你决策时停下来提问（可弹选项卡让你选）

### ⏰ 自动化与任务管理

- **定时任务** —— 列表与日历两种视图，支持周期/单次、指定模型、随会话执行或纯后台执行、立即运行一次
- **任务看板** —— 卡片式管理待办，设状态与优先级，直接派发给 Agent
- **渠道集成** —— 接入微信、飞书、QQ 机器人、钉钉、企业微信、Telegram、Discord、WhatsApp，在外面也能派活和收结果

### ⚡ 日常效率

- **快速启动器** —— `Alt + Space` 唤起，输入几个字符启动程序或打开应用内页面，支持词首字母缩写
- **剪贴板历史** —— `Ctrl + Shift + V` 翻查历史复制记录，选中后贴回你原本聚焦的窗口
- **右侧面板** —— 执行过程、文件树、预览、浏览器、终端、会话摘要、变更审阅，一屏看清 Agent 做了什么

### 🔌 可扩

- **插件** —— 内置 Image / Browser / CodeGraph / Desktop-control 能力开关，可各自指定模型
- **Skills** —— 给 Agent 装配某类任务的标准做法，支持在线市场与本地文件夹安装
- **MCP** —— 连接外部 MCP 服务器，把它们提供的工具接进 Agent
- **自定义扩展** —— 安装本地扩展包，带来新工具与界面组件

### 📊 看得清花销

- **用量统计** —— 24 小时 / 7 天 / 30 天三档，请求数、token、缓存命中、成本、平均耗时，按模型与按来源分别汇总，失败请求在图上单独标红
- **辅助模型与补位模型** —— 后台请求（提示词优化、人格生成等）可单独指定模型，并有统一兜底，不会悄悄用一个已经失效的模型
- **权限可控** —— 危险操作弹窗确认，可按通配符/正则加白名单，也可整会话切到全自动模式

## 💾 数据与隐私

- 全部数据存在你自己的电脑上：`~/.wishful-claw/`（数据库、服务商配置、全局记忆与人格、渠道配置），项目级数据在 `{项目目录}/.wishful-claw/`
- 记忆与人格是明文文件，可以直接手改，也可以纳入 Git
- 除你配置的模型服务商 API 调用外，不向第三方上传你的数据
- 运行日志落在 `~/.wishful-claw/logs/`，按日期切分，便于排查问题

## 🖥️ 系统要求

| 项 | 要求 |
|----|------|
| 操作系统 | Windows 10 / 11（x64） |
| 界面语言 | 简体中文、English |
| 模型 | 自备任一兼容服务商的 API Key（Anthropic、OpenAI、Gemini、OpenRouter、智谱、Kimi、DeepSeek 等） |
| 磁盘 | 安装包约 130 MB，安装后占用约 360 MB；数据随使用增长 |

## ❓ 常见问题

- **对话没有回复** —— 到 设置 → AI 服务商 点测试连通性，确认 Key 有效、模型名可用。
- **Agent 说找不到某个工具** —— 对应插件可能被停用，或当前会话类型不开放该工具；见使用指引第 8、9 节。
- **想彻底排查问题** —— 把 `~/.wishful-claw/logs/` 当天日志里的 `[ERROR]` 段落带上提问。

更多见 **[使用指引 · 常见问题排查](docs/user-guide.md#16-常见问题排查)**。

## 🛠️ 二次开发

架构（7 层 .NET 运行时 + Electron/React）、构建命令、编译验证口径、参考来源等，见 **[开发说明](docs/development.md)**；协作流程见 **[docs/dev-workflow.md](docs/dev-workflow.md)**。

## 📜 License

本项目采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源，Copyright 2026 **Wishful 心相团队**。

本项目部分代码源自开源项目 [OpenCowork](https://github.com/AIDotNet/OpenCowork)（Apache 2.0，Copyright 2026 AIDotNet），经迁移、拆分与重构后纳入 WishfulClaw 架构，原始版权声明保留在各迁移文件头部。完整第三方归属声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，设计参考来源见 [开发说明](docs/development.md#-reference-projects)。

---

<div align="center">

自用项目，慢慢打磨。

</div>
