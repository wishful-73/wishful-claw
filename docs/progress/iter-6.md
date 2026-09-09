# 迭代六：人格系统

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
