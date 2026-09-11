# v2-iter-27 验证报告

## 结论摘要

代码级、TypeScript、核心回归、隔离 C# 构建和 Native AOT 验证已通过。真实 Electron UI、低于 0.2.27 的安装包升级、渠道人工验证和真实 dispatch 回传集成仍未完成，因此本报告不是发布 PASS，也不触发 v0.2.27 发布收尾。

## 已执行命令与结果

| 命令 | 结果 | 说明 |
|---|---:|---|
| `npx tsc --noEmit -p tsconfig.web.json --composite false` | 0 | 通过 |
| `npx tsc --noEmit -p tsconfig.node.json --composite false` | 0 | 通过 |
| `npx tsc --noEmit -p tsconfig.json --composite false` | 0 | 通过 |
| `npm run test:renderable-chat-items` | 0 | 16 项通过 |
| `npm run test:provider-presets` | 0 | 330 assertions、43 presets 通过 |
| `npm run test:session-follow-up` | 0 | 20 项通过 |
| `dotnet build src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj --no-restore -p:BaseOutputPath=.tmp-build/agent/` | 0 | 0 warning、0 error |
| `dotnet build src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj --no-restore -p:BaseOutputPath=.tmp-build/worker/` | 0 | 0 warning、0 error |
| `DOTNET_ROOT=D:\claw\dotnet-sdk npm run build:worker:prod` | 0 | Native AOT 成功；未见 IL2026/IL3050/IL3051；捆绑 18 个 grammar |
| `git diff --check` | 0 | 通过 |

隔离构建生成的 `.tmp-build` 目录已清理；运行中的 Electron/Worker 进程未被终止。

## 代码级验证覆盖

- F：Agent 错误回复保留，错误卡片与既有回复内容共存。
- G：渠道只展示启用 Provider 及当前 Provider 的启用 chat 模型；无可用 chat 模型时清空 stale active model。
- H：普通文本粘贴使用 contenteditable 原生插入/撤销路径，失败时回退到受控选区替换。
- C3：终态及相同状态/报告幂等保护；同一 Worker 进程内回传序列化，避免并发重复通知。
- 消息转换缓存：原地修改消息内容时通过内容签名触发重新转换。

## 未完成或无法验证项目

### Electron / 桌面人工验证

当前可访问的是 `http://localhost:5173` 的 Vite 页面，不具备 Electron preload 的 `window.api` bridge，页面也没有可用的桌面 DOM 运行条件。因此以下项目没有被宣称通过：

- A3：更新弹窗及全屏阅读真实 Electron 交互。
- B3：扩展页面互斥切换真实 Electron 交互。
- A4：v0.2.26 → v0.2.27 安装包升级及发布资产验证。
- F/G/H：真实错误回复展示、Provider/模型持久化与发送路由、普通/长/多行/选区粘贴、连续 Ctrl+Z、输入法组合输入、设置页切回。

### Dispatch 集成

当前没有专用入口直接执行真实 `reply_global_dispatch` → 来源会话/渠道反向回传并发、取消和失败重试场景；因此只记录静态控制流结论和隔离编译结果，不替代真实集成证据。

### 发布收尾

未执行以下操作：更新版本徽章、打包 NSIS、上传 setup.exe/latest.yml/blockmap、合并 main、打 tag、更新进度文档、发布 GitHub Release。Plan I5 需要用户确认 PASS 后再执行。

## 工作区证据

本轮完成后，除原计划文档和源代码未提交修改外，新增本报告与独立审查报告；未创建发布提交，未推送远程，未改变用户正在运行的进程。
