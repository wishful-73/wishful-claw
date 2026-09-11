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

## 收尾时点复核（2026-09-11）

> 上方正文是审查当时的快照，保留不改。本节记录启动收尾时各项的真实状态，避免按过期基线写 VERDICT。

**粘贴实现已变更**：正文与 `review_report.md` 第 14 行所记的 `document.execCommand('insertText')` 方案已被替换为 `insertHTML`。原因经用真实模块跑探针定案：`insertText` 会让 Blink 把换行拆成 `<div>` 块，而 `parseDomToDocument` 只在块后补换行，多行粘贴丢换行；且选区未变更的连续 `insertText` 会被并入同一撤销组，一次 Ctrl+Z 撤掉多段。

**已取得证据的项**：

- H（普通/长/多行/选区粘贴、连续 Ctrl+Z）：老大人工验证通过 —— 连粘三次后逐段撤销、多行换行保留、选区替换语义正常。残留一段撤销后的选中态，仅观感，已登记 `docs/plans/iter-v2-28/editor-undo-selection-issue.md`。
- 生产包安装验证：`release/wishful-claw-0.2.27-setup.exe`（11:08，含上述修复）经老大安装并确认通过。产物已核验 sha512 与 `latest.yml` 逐字符一致、size 一致、安装器 ProductVersion 0.2.27、asar 内含新粘贴实现。
- 编译与回归：沿用正文记录的命令结果；收尾时点补跑 TypeScript web/node/root 三套配置均 0 错误。

**收尾时点仍无证据、移交后续**：

- A3（更新弹窗全屏阅读）、B3（扩展页面互斥切换）、F（错误回复展示）、G（Provider/模型持久化与发送路由）：未见逐项桌面验证记录。老大本轮确认的是安装与粘贴两项，未逐项覆盖这些，本项**不得当作已验证**。
- A4（v0.2.26 → v0.2.27 真机升级）：发布前 GitHub Release 仅有 0.2.26，升级链路无法在发布前实跑。发布后须按 AGENTS.md「发布后核验」用低于当前 Release 的本地版本实调 `electron-updater.checkForUpdates()` 验证进入 `update-available`，再测下载与安装确认。
- Dispatch 集成（`reply_global_dispatch` 反向回传的并发/取消/失败重试）：仍无专用入口，只有静态控制流结论与隔离编译结果。
