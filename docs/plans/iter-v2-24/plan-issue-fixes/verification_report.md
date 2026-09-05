# Issues 批次验证报告

> v2-iter-24 · plan-issue-fixes
> 日期：2026-08-30
> 验证方式：编译验证（工具证据）+ 运行态人工验证清单（待用户）

## 编译验证（PASS）

本批次仅前端与文档改动，按规范执行三套 TypeScript 配置检查：

```
$ npx tsc --noEmit -p tsconfig.web.json   → WEB OK（0 错误）
$ npx tsc --noEmit -p tsconfig.node.json  → NODE OK（0 错误）
$ npx tsc --noEmit -p tsconfig.json       → ROOT OK（0 错误）
```

无 C# 改动，不执行 `dotnet build`。

## 静态确认

- 「加载更多」重置 effect 全仓扫描：`useEffect(() => setShowAll*(false))` 模式 0 残留
- 「衍生」字样全仓 `.md` 扫描：仅存于 README 调整后表述（「大量参考与借鉴」）

## 运行态人工验证清单（待用户，`npm run dev` 启动后）

前置：至少一个项目下会话数 > 5；全局对话（未归属会话）> 5 条

1. 触发任一会话运行（保持流式中），点击该项目的「加载更多」→ 稳定展开不收起；「收起会话」按钮恢复正常折叠
2. 全局对话分区重复步骤 1 验证
3. 会话运行中：项目行文件夹图标位置变为转圈；会话结束后恢复文件夹图标（展开态恢复为 FolderOpen）
4. 回归：无运行会话时，两处「加载更多」/「收起会话」行为正常；会话删除后列表无异常状态

## VERDICT

待用户裁定（PASS / FAIL / PARTIAL）。
