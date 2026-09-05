# Verification Report: 独立记忆整理模型配置与 nightly 启动行为

日期：2026-09-02
状态：静态与构建验证完成；运行时人工验收待用户执行。

## 自动验证结果

以下命令在本 Plan 完整修改及压缩摘要 UI 回归修复后执行：

- `npx tsc --noEmit -p tsconfig.web.json` — PASS
- `npx tsc --noEmit -p tsconfig.node.json` — PASS
- `npx tsc --noEmit -p tsconfig.json` — PASS
- `npm run build` — PASS；1209 modules transformed，仅有既有 Vite dynamic/static import 与大 chunk 警告
- `dotnet build src\runtime\WishfulClaw.sln --no-restore -c Release`，`DOTNET_ROOT=D:\claw\dotnet-sdk` — PASS，0 warning、0 error
- C# Debug 构建 — 未通过；运行中的 `WishfulClaw.Worker`（PID 10232）锁定 Debug DLL，属于运行态文件锁；Release 构建已绕过并通过
- `git diff --check` — PASS
- 中英文 settings locale JSON 经 PowerShell `ConvertFrom-Json` 解析 — PASS

## 针对性静态验证

- settings store 存在三个独立字段、默认值、persist partialize 和 version 35 迁移。
- 迁移 effort 白名单仅接受 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`；其他值清空。
- `memory-automation-utils.ts` 静态搜索无 active/fast Provider/Model 回退引用。
- 独立 Provider/Model 解析要求 Provider enabled 且认证就绪，Model 属于该 Provider、enabled 且适合文本请求。
- UI 和解析端均排除 speech、embedding、image、video 类别，以及图片/视频请求协议。
- scheduler 保留 `catchup` 触发类型兼容，但正常启动路径不存在 `fireOrganization('catchup')` 调用。
- nightly timer、五分钟轮询兜底、设置变化重装与退出清理代码仍存在。
- 本 Plan 相关 diff 未发现 secret 字面量或 Provider API key 输出。

## 压缩摘要 UI 回归验证

- `ContextCompressionMessage.tsx` 已删除折叠状态下额外渲染摘要首段的 preview button/span；折叠时只显示“上下文已压缩”分隔线。
- `context-compression.ts` 的显示归一化会剥离首尾 `<compaction-summary>` 标签和固定英文引导语；不修改持久化消息或 Worker 协议。
- TypeScript 三配置、生产构建和 `git diff --check` 均在该修复后重新通过。
- 实际 Electron 显示仍需用户刷新/重启后验收：折叠状态不显示摘要预览，点击分隔线才显示正文，展开正文不显示标签或固定英文引导语。

## 未执行的运行时验收

以下项目不能仅凭编译判定通过，需用户运行应用验收：

1. 设置页可独立保存 Provider、Model、思考模式和 reasoning effort。
2. 应用重启后独立设置保持。
3. 手动记忆整理实际使用独立模型和指定思考配置。
4. 修改全局 active/fast 模型不影响记忆整理模型。
5. nightly 模式正常重启不 catch-up，且到达配置时刻能够触发。
6. startup 模式启动后仍按水位和 20 小时节流触发。
7. 刷新/重启 Electron 后，压缩摘要折叠与展开显示符合上述回归预期。

## 裁定

自动静态与构建验证：PASS。
运行时 Electron/UI/定时验收：PENDING。
最终 PASS / FAIL / PARTIAL：由用户验收后裁定。
