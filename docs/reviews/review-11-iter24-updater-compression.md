# 代码审查报告 11：软件内自动更新复核 + 压缩卡片渲染复查

> 审查范围：① 迭代 24 软件内自动更新功能（未提交工作区改动：`src/main/updater.ts`、`src/main/lib/distribution.ts`、`src/shared/updater/`、`src/renderer/src/components/updater/`、`use-app-updater.ts`、设置面板与 electron-builder 发布配置）② 历史问题复查——"压缩卡片不进消息、堆在输入框上方"
> 审查时间：2026-09-01
> 审查基线：`dev/v2-iter-24`（HEAD `02011ba`，含未提交改动）
> 审查方式：静态走读 + 三配置 tsc + electron-vite 生产构建 + 打包产物 bundle 分析 + 前后端事件链路端到端核对
> 说明：本报告记录审查结论与修复计划；§4 为实现记录，修复已完成并通过编译验证。

---

## §1 总体结论

**自动更新**：整体设计正确（全确认流程、版本防降级、托盘拦截绕过、发布文档同步更新），打包链路验证通过——`electron-updater` 经 Vite 打进主进程 chunk，无 node_modules 运行时依赖。发现 3 个必修缺陷（i18n 缺失 ×2、无更新误报）与 3 个建议项，全部已修复。

**压缩卡片**：正常闭环（自动压缩四种终态、手动压缩）已经完整——状态消息进 `session.messages`、边界/摘要合并进转录、过滤与渲染链路齐全、DB 持久化支持重载。但存在一条残留泄漏路径：运行在压缩启动后被取消时后端不发完成事件，渲染端 `loop_end`/`error` 又无兜底清理，导致 live 卡片永久钉在输入框上方——与历史报告症状一致。已双端修复。

---

## §2 自动更新审查发现（已全部修复）

### U24-1 ❌ `anchorNav.updates` 缺失

**位置**：`src/renderer/src/components/settings/SettingsPage.tsx:28`；`src/renderer/src/locales/{zh,en}/settings.json`

**问题**：设置页锚点导航引用 `anchorNav.updates`，但两个 locale 的 `anchorNav` 块均未定义该 key，fallback 下直接显示原始 key 字符串。

**修复**：两个 locale 补 `"updates": "更新"` / `"Updates"`。

### U24-2 ❌ 检查无更新后对话框误报"发现新版本"

**位置**：`src/renderer/src/hooks/use-app-updater.ts:117`

**问题**：electron-updater 即使没有更新也会返回 latest 版本号（等于当前版本）。原代码 `availableVersion: result.latestVersion ?? previous.availableVersion` 在无更新时把 availableVersion 设成当前版本 → `UpdateDialog` 的 `hasAvailableUpdate` 为 true → 显示"发现新版本 X"与"下载更新"按钮，点击后主进程报"尚未发现可下载的更新"。

**修复**：改为 `result.available ? result.latestVersion : null`。

### U24-3 ❌ 更新对话框英文界面显示中文

**位置**：`UpdateDialog.tsx`（13 个 `updater.dialog.*` key 全部缺译）、`UpdateReleaseNotes.tsx:7`（硬编码中文）、`src/main/updater.ts`（7 条错误文案硬编码中文）

**问题**：对话框完全依赖 `defaultValue` 兜底，英文用户看到满屏中文；主进程错误文案同样只有中文。

**修复**：
- 两个 locale 补顶层 `updater.dialog.*` 13 个 key；
- `UpdateReleaseNotes` 硬编码改为 `updater.dialog.noNotes`；
- `updater.ts` 引入 `UPDATER_MESSAGES` 双语表，`tr()` 按持久化 `settings.language` 取值（读取逻辑抽为 `readRendererSettingsState()`，`getPersistedAutoUpdateEnabled` 复用）。

### U24-4 ⚠️ 静默失败残留 `error` 相位

**位置**：`src/main/updater.ts` `setError()`

**问题**：启动自检失败时 `setError(error, false)` 把主进程 phase 置 `'error'` 但不通知渲染端；窗口重载后 `update:status` 返回 `phase:'error'` 且 `error:null`，App 的 effect 自动弹出空错误描述的对话框。

**修复**：`setError` 在 `notify=false` 时把 phase 置回 `'idle'`（渲染端经 invoke 返回值自行显示错误，主进程相位无需保留）。

### U24-5 ⚠️ `dev-app-update.yml` 未跟踪

**问题**：开发态手动检查更新依赖该文件（`forceDevUpdateConfig`），文件存在但未纳入版本控制。

**修复**：已确认未被忽略，提交时随功能单元一并提交。

### U24-6 💡 `.gitignore` 的 `!package-lock.json` 费解

**问题**：用否定模式"取消忽略"一个本就无规则忽略的路径，语义绕。这是从"忽略 lockfile"到"提交 lockfile"的策略变更（为可复现安装 `electron-updater` 依赖）。

**修复**：直接删除该行；已验证无其他规则重新忽略，`package-lock.json`（971 packages，lockfileVersion 3）可正常跟踪。

### 未修复的已知瑕疵（评估后接受）

- 下载失败时 `error` 事件与 `downloadPromise.catch` 各推一条 `update:error`（内容一致，无害）；
- GeneralPanel 直接 invoke 绕过 hook，检查失败时渲染端 phase 不同步（有 toast 兜底）。

---

## §3 压缩卡片复查发现

### 现状：正常闭环已完整（历史问题主流程已解决）

| 环节 | 位置 | 结论 |
|------|------|------|
| 后端事件发射 | `AgentLoop.cs:253-380` | started/delta/compressed 齐全；compressed、skipped、failed、cancelled 四终态均发完成事件 |
| 线上字段映射 | `AgentStreamMessagePackEmitter.cs:84-89` | `compressionStatus`/`error`/`compactArtifacts` 与前端读取一致 |
| 渲染端落库 | `chat-store/index.ts:572-654` | live 清除 + `recordCompressionStatusMessage`（状态消息）+ `applyCompactArtifactsToSession`（边界+摘要）均写 DB |
| 过滤保留 | `transcript-filters.ts:73` | 带 `compressionStatus`/`compactBoundary` 的 system 消息保留渲染 |
| 卡片渲染 | `MessageItem.tsx:234` | `CompressionStatusMessage` 正常渲染；重载从 DB 恢复 |
| 手动压缩 | `use-chat-actions.ts:606-659` | 同样经 `recordCompressionStatusMessage` 进转录 |

### C24-1 ❌ live 卡片泄漏路径（已修复）

**位置**：

- `src/runtime/WishfulClaw.Agent/AgentLoop.cs:262-266`（后端取消竞态）
- `src/renderer/src/stores/live-compression-store.ts:86`（仅 `context_compressed` 清除）
- `src/renderer/src/stores/chat-store/index.ts:1361/1570`（`loop_end`/`error` 无清理）

**问题**：`context_compression_started` 发出后，若 `IsCancellationRequested`（用户在压缩启动瞬间点停止），后端直接 `EmitLoopEndAsync("aborted")` + return，**不发 `context_compressed`**。渲染端只在 `context_compressed` 时清 live store，`loop_end`/`error` 均无兜底 → 琥珀色"正在生成摘要"卡片永久悬在消息列表末尾（输入框上方），消息历史无压缩记录。Worker 压缩中途崩溃同样命中。与历史报告症状完全一致。

---

## §4 修复实现记录

### C24-1 后端：取消竞态补发完成事件

`AgentLoop.cs` 取消分支在 `EmitLoopEndAsync` 前补发 `CompressionStatus: "cancelled"` 的 `context_compressed`，保持 started/compressed 事件配对，渲染端同时清卡片并在历史留下 cancelled 状态卡。

### C24-1 前端：终态兜底清理

`chat-store/index.ts` 的 `loop_end` 与 `error` 两个 case 增加 `useLiveCompressionStore.getState().clear(targetSessionId)`。时序安全性：压缩在循环体内 await，`loop_end` 到达时压缩要么已完成（`context_compressed` 早已清除，重复 clear 幂等）要么被跳过（正需要清除）。同时覆盖 Worker 崩溃后主流恢复的错误路径。

### 验证结果

- `dotnet build`（WishfulClaw.sln）：0 错误
- `tsc --noEmit` × 3（web/node/root）：0 错误
- 未提交，待手动测试通过后按功能单元提交

---

## §5 遗留验证项

1. **压缩取消竞态手测**：长会话触发自动压缩（或调低压缩阈值），在"正在生成摘要"卡片出现瞬间点停止 → 卡片应立即消失，历史出现"已取消"状态卡；
2. **自动更新端到端**：按 `AGENTS.md` 发布后核验流程，用低版本安装包验证 `update-available` → 下载确认 → 安装重启全链路；
3. 更新功能与压缩修复同属未提交工作区，测试通过后分两个功能单元提交。
