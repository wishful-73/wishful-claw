# Plan H 探索证据：项目会话右侧变更面板

## 当前状态

- 当前分支：`dev/v2-iter-26`
- 工作区存在上一功能单元未提交改动，本 Plan 不触碰这些文件。
- 右侧入口为 `src/renderer/src/components/layout/AgentFilesPanel.tsx`。
- 该组件已经根据会话的 `workingFolder` 判断是否为项目会话；全局会话无工作目录时直接展示无目录状态。

## 已有能力

- `FileTreePanel.tsx` 已实现完整文件树，仅需由外层增加 Tab 容器，不改文件树行为。
- `src/renderer/src/stores/git-store.ts` 的 `useGitStore.refreshRepository()` 已通过 `IPC.GIT_GET_STATUS_DETAILED` 加载 Git 状态，并缓存 repository details。
- `src/renderer/src/components/chat/GitPage/ScmSidebar.tsx` 与 `GitPage/utils.tsx` 已有变更行模型及文件行展示。
- `src/renderer/src/components/chat/CodeDiffViewer.tsx`、`file-change-diff.tsx` 已提供 Diff 展示基础。
- 不需要新增 Main IPC、Preload、Worker 或 C# 接口。

## 方案边界

- 仅 `workingFolder` 存在的项目会话显示“变更”Tab；全局会话保持当前无目录状态。
- 变更列表读取当前 Git repository 的 status；支持点击文件加载并查看 diff。
- 只读查看，不加入暂存、丢弃、提交等 SCM 操作。
- 刷新按钮调用现有 `refreshRepository(..., { force: true })`。

## 风险

- 无 Git 仓库时需要清晰空状态。
- 多仓库工作目录需要选定包含工作目录的 repository，不能误读其他仓库。
- 二进制或未追踪文件的 diff 由现有 diff IPC/Viewer 返回错误或空内容时显示提示。
