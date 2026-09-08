# Plan H 合规检查

- [x] 目标覆盖项目会话变更 Tab、全局会话隐藏、文件 Diff。
- [x] 步骤包含组件、入口接线、交互验证和统一编译验证。
- [x] 文件路径符合 Renderer 目录约定，新增组件使用 kebab-case 文件名例外需按现有 `ChangesPanel.tsx` 组件命名风格确认；实现时遵循仓库现有组件命名。
- [x] 复用现有 Git store、ScmSidebar、CodeDiffViewer，不新增后端接口。
- [x] 不触碰当前工作区既有未提交改动。
- [x] 不涉及分层逆向依赖或 AOT 风险。

结论：PASS，可进入执行态。
