# Plan: CodeGraph 索引入口迁移至项目档案页 + 索引存储项目本地化

> 归属迭代：v2-iter-21（追加功能单元，接续插件管理 Plan）
> 分支：dev/v2-iter-21（沿用当前分支）

## 目标

把 CodeGraph 的项目索引操作从设置页插件面板迁到项目档案页（按项目操作），并把索引 DB 从全局集中式 `~/.wishful-claw/codegraph/<hash>/` 改为项目本地 `{workingFolder}/.wishful-claw/codegraph/`（SSH 项目回退 `~/.wishful-claw/projects/{projectId}/codegraph/`，与记忆同策略）。

## 老大已确认的决策

1. 入口迁移，插件面板保留精简版（只留资产诊断）
2. 存储位置跟记忆同策略（本地项目 `.wishful-claw/`，SSH 项目回退 home）
3. 插件未启用时项目档案页区块置灰 + 引导开启
4. `dataRoot` 注入放 main 进程 IPC 层，renderer 不感知存储细节
5. 存量 `~/.wishful-claw/codegraph/<hash>/` 不迁移，直接废弃重建

## 步骤清单

- [ ] 步骤 1：后端 — `CodeGraphDataDir` 支持显式 dataRoot
  - `Support/CodeGraphDataDir.cs` 增加 `GraphDbPath(root, dataRoot)` / `IsInitialized(root, dataRoot)` / `Remove(root, dataRoot)` 重载：dataRoot 非空时用 `<dataRoot>/graph.db`，否则走原集中式路径（vendored 默认行为不变）
  - `CodeGraphEngine.Open/OpenReadOnly/IsInitialized/Remove/Stats` 等调用点透传可选 dataRoot 参数
  - `CodeGraphToolHandler.ResolveWorkingFolder` 旁新增 `ResolveDataRoot(args)`：读可选 `dataRoot` 字段；引擎缓存 key 追加 dataRoot 维度避免同 root 不同存储冲突
  - 验证：`dotnet build src/runtime/WishfulClaw.sln` 0 错误
- [ ] 步骤 2：main 进程 IPC 层注入 dataRoot
  - `src/main/ipc/codegraph-handlers.ts`：新增 `resolveCodeGraphDataRoot(workingFolder)` —— workingFolder 存在且可写时返回 `<wf>/.wishful-claw/codegraph`，否则 null（引擎回退集中式）；SSH 项目由 renderer 显式传 `~/.wishful-claw/projects/{projectId}/codegraph`
  - `handleCodeGraphTool` 与新增的项目档案专用 handler 统一在调 worker 前补 `input.dataRoot`
  - 验证：TS node 配置零错误
- [ ] 步骤 3：项目档案页 CodeGraph 区块（前端）
  - 从 `AppPluginPanel.tsx` 抽出进度条组件为共享组件（如 `components/chat/codegraph-index-progress.tsx`）
  - `ProjectArchivePage.tsx` 新增「代码图谱」区块：
    - 读 `app-plugin-store` 判断当前项目 CODEGRAPH 插件 enabled；未启用 → 置灰 + 「去开启」跳转设置页插件面板
    - 已启用 → 显示索引状态（是否已建/文件数/节点数/dbSize/上次索引时间）+ 索引/同步按钮 + 进度条
    - SSH 项目传 projectId 推导的 dataRoot；本地项目不传（main 层按 workingFolder 解析）
  - i18n zh/en 补键
  - 验证：TS web 配置零错误
- [ ] 步骤 4：插件面板精简
  - `AppPluginPanel.tsx` 移除全局项目列表 + 索引/同步/移除按钮，保留资产诊断（grammar 状态、下载、诊断）
  - 清理不再使用的 state/handler/i18n 键
  - 验证：TS web/node 零错误
- [ ] 步骤 5：整体验证
  - `dotnet build src/runtime/WishfulClaw.sln` 0 错误
  - TS 三配置全零错误
  - 启动应用：开启 CodeGraph 插件 → 项目档案页执行索引 → 确认 DB 落在 `{workingFolder}/.wishful-claw/codegraph/graph.db` → explore 工具可用
  - 输出 verification_report

## 涉及文件

- src/runtime/WishfulClaw.CodeGraph/Support/CodeGraphDataDir.cs — 修改（dataRoot 重载）
- src/runtime/WishfulClaw.CodeGraph/CodeGraphEngine.cs — 修改（透传 dataRoot）
- src/runtime/WishfulClaw.CodeGraph/Mcp/CodeGraphToolHandler.cs — 修改（ResolveDataRoot + 缓存 key）
- src/main/ipc/codegraph-handlers.ts — 修改（dataRoot 注入）
- src/renderer/src/components/chat/ProjectArchivePage.tsx — 修改（新区块）
- src/renderer/src/components/chat/codegraph-index-progress.tsx — 新建（共享进度组件）
- src/renderer/src/components/settings/AppPluginPanel.tsx — 修改（精简）
- src/renderer/src/locales/{zh,en}/chat.json、settings.json — i18n

## 参考源码

- vendored 引擎自身：Support/CodeGraphDataDir.cs（Decision 3 集中式设计——本次在其上叠加可选 dataRoot，不改默认行为）
- 记忆同策略参照：ProjectArchivePage.tsx memoryRoot 逻辑（SSH 回退 ~/.wishful-claw/projects/{id}/）
