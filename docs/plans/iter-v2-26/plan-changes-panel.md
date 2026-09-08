# Plan H：项目会话右侧变更选项卡

## 目标

在已有右侧文件树旁增加项目会话专属的“变更”选项卡，展示 Git 工作区变更并支持文件 Diff 查看；全局会话不显示该选项卡。

## 步骤清单

- [ ] H1：新增变更面板组件，复用 `useGitStore` 的 status/refresh/diff 能力；验证项目会话能加载变更列表、无仓库/无变更有空状态。
- [ ] H2：在 `AgentFilesPanel` 接入“文件树/变更”Tab，仅在有 `workingFolder` 时展示并保持文件树原有行为；验证全局会话不出现变更入口。
- [ ] H3：接入文件点击 Diff 预览、刷新及 Agent 文件变更后的状态更新；验证新增/修改/删除文件与错误状态。
- [ ] H4：运行 TS web/node/root、C# solution、build、diff check，并记录验证报告。

## 涉及文件

- `src/renderer/src/components/layout/AgentFilesPanel.tsx`
- `src/renderer/src/components/cowork/ChangesPanel.tsx`（新增）
- `src/renderer/src/components/chat/CodeDiffViewer.tsx`（仅必要时复用，不改行为）
- `src/renderer/src/components/chat/GitPage/utils.tsx`（仅必要时复用，不改行为）
- `src/renderer/src/stores/git-store.ts`（仅必要时补充刷新/选择适配）
- `src/renderer/src/locales/zh/layout.json`
- `src/renderer/src/locales/en/layout.json`
- `docs/plans/iter-v2-26/verification-changes-panel.md`

## 参考实现

- 本项目：`src/renderer/src/components/chat/GitPage/ScmSidebar.tsx`
- 本项目：`src/renderer/src/components/chat/CodeDiffViewer.tsx`
- 本项目：`src/renderer/src/stores/git-store.ts`

## 约束

- 不新增 IPC/Preload/Worker 接口。
- 不修改现有 Provider 未提交改动。
- 不提供暂存、丢弃、提交等 Git 写操作。
- 不把变更 Tab 加到全局会话。
