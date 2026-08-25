# 验证报告: CodeGraph 索引入口迁移至项目档案页 + 存储项目本地化

- Plan: docs/plans/iter-v2-21/plan-codegraph-project-archive.md
- 分支: dev/v2-iter-21
- 日期: 2026-08-25

## 自动验证（已通过）

| 检查项 | 结果 |
|--------|------|
| C# `dotnet build src/runtime/WishfulClaw.sln` | ✅ 0 错误 0 警告 |
| AOT `node scripts/publish-aot-worker.mjs` | ✅ 完成，产物 WishfulClaw.Worker.exe 21MB，18 个 grammar 捆绑 |
| TS `npx tsc --noEmit -p tsconfig.web.json` | ✅ 0 错误 |
| TS `npx tsc --noEmit -p tsconfig.node.json` | ✅ 0 错误 |
| TS `npx tsc --noEmit -p tsconfig.json` | ✅ 0 错误 |

## 实现摘要

1. **步骤 1 后端** — 新建 `Support/CodeGraphDataRootRegistry.cs`（root→dataRoot 进程内注册表）；`CodeGraphDataDir.CodeGraphBaseDir/CodeGraphDir` 优先查注册表，未注册走原集中式路径（vendored 默认行为不变）；`CodeGraphToolHandler` 各 Rpc 入口 + AdminTools.RemoveProjectRpc 调用 `RegisterDataRoot(args)` 读取可选 `dataRoot` 字段。
2. **步骤 2 main IPC** — `codegraph-handlers.ts` 新增 `resolveCodeGraphDataRoot(workingFolder, override)`：本地目录存在时返回 `{wf}/.wishful-claw/codegraph`，注入到每个 worker 调用的 input。
3. **步骤 3 项目档案页** — 新建 `codegraph-project-index.tsx` 共享区块：插件未启用→置灰提示+「去设置开启」；启用→index-status 状态行（state/files/nodes/dbSize/lastIndexedAt）+ 索引/同步按钮 + 实时进度条；SSH 项目显式传 `~/.wishful-claw/projects/{projectId}/codegraph`。挂载于 ProjectArchivePage header 与 tab bar 之间。
4. **步骤 4 插件面板精简** — AppPluginPanel 移除全局项目列表/索引/同步/删除按钮及关联 state，保留资产诊断区块，加迁移指引文案；清理无用 i18n 键。

## 待人工验证（需启动应用）

- [ ] 开启 CodeGraph 插件 → 项目档案页出现「代码图谱」区块
- [ ] 关闭插件 → 区块置灰 + 引导按钮跳转设置页
- [ ] 执行索引 → DB 落在 `{workingFolder}/.wishful-claw/codegraph/graph.db`
- [ ] 会话中 codegraph_explore 工具可正常查询该项目

## 结论

自动验证全部 PASS；运行时人工验证待老大确认后裁定 VERDICT。
