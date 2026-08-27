# 迭代 23 上线前全量排查报告（Plan 23-9）

- 排查时间：2026-08-27
- 排查方式：5 组并行子代理初审（IPC 形状/静默失败、主进程全层、渲染端全层、Worker C#/AOT、i18n/打包）+ 本人逐项代码级核实 + 三项横切自查（镜像同步/竞态/持久化）
- 覆盖范围：渲染进程全部组件与 43 个 store、主进程 36 个 IPC handler 与外围模块、channels 11 文件、Worker 7 层 C#、i18n 双语、打包链路
- 本报告只查不改；修复清单由用户确认后另起步骤实施

---

## 修复状态汇总（2026-08-27 更新）

用户决策：**高中危全修 + 低危静默失败类择修**；技能市场保留"内置浏览器 + 安装小助手"路线、平台登录死代码移除。八批修复已全部完成并本地提交（未 push）：

| 批次 | Commit | 覆盖范围 |
|------|--------|----------|
| 1 | `1f23f11` | H1/H2/M2–M9/M21，附带 L1 `fs:watch-file` 伪成功、L2 `cancelKeys` 泄漏 |
| 2 | `f3fd9d2` | H3/H4/M30–M32 |
| 3 | `7ecacff` | H5/M33–M36 |
| 4 | `282b007` | M10–M20 |
| 5 | `68f16f2` | M22–M29 |
| 6 | `5faa16b` | H6 + H7（移除平台登录死代码，保留 token 刷新活路径） |
| 7 | `b6546f8` | H8（技能市场死代码通道清理，保留 `list_installed_skills` 与浏览器入口） |
| 8 | `c0adb01` | L1–L4/L7–L11 低危静默失败类 |

每批验证门槛：TS 三配置（web/node/根）零错误；涉及 C# 的批次另过 `dotnet build` 0 警告 0 错误。

### 未修与遗留（有意保留）

- **M37** SSH 明文密码回传渲染端——存疑区 #2，待用户确认是否编辑场景有意设计，未列入批次
- **L5/L6** i18n 键缺失（`settings:channel.*` 76 英文键、代码用而文件缺 155 键）——非静默失败类，留待专门 i18n 补齐任务
- **L12**（其余 C# 低危项）/**L13**（AOT 裸 `JsonSerializerOptions` 7 处，功能无害）/**L14**（死代码清理）/**L15**（打包字段）/**L16**（hydration 注销函数）——择修范围外，视需要另起批次
- 存疑区其余条目（#3–#9）维持待实测/待用户确认状态

## 核实口径说明

子代理结论已全部经过本人代码级复核，其中两条被纠正降级：

- `registerSidecarHandlers` 零调用不构成故障：`agentBridge` 全部请求走 `worker:request`（native worker），`sidecar:notify` 为单向 send 无需 handler——该项降为死代码清理（L 级）
- `ipcClient.invoke` 结果强转业务类型不检查 `error` 字段的问题（`messagepack-handler.ts` 异常统一转 `{error}` 正常返回）为系统性风险，列入第四批静默失败治理

---

## 高危（上线前必须处理）

### H1 退出清理系统性缺失——三类子进程退出即成孤儿
- 位置：`src/main/index.ts:501-506`（before-quit 只清 SSH 与 channels）
- 根因：`shutdownMcp()`（mcp-handlers.ts:260）、`killAllTerminalSessions()`（terminal-handlers.ts:446）、`latchNativeWorkerShutdown()`（native-worker.ts:488）三个清理函数全部导出但全项目零调用
- 影响：每次退出应用，.NET worker、全部 stdio MCP 服务器、最多 32 个 pty 终端进程残留；反复开发/使用会积累大量孤儿进程
- 修复建议：before-quit（或 will-quit）串联调用三个清理函数，带超时兜底

### H2 native-worker socket 无 error 监听 + closeWorker 不杀子进程
- 位置：`src/main/lib/native-worker.ts:267-275`（socket 只挂 data/close）、`380-394`（`this.child = null` 前无 `child.kill()`）
- 根因：named-pipe socket 的 error 事件无监听器 → Node 未捕获异常直接崩主进程；断连/无效帧路径置空 child 引用但不 kill → worker 进程孤儿
- 影响：主进程崩溃风险 + 与 H1 叠加的进程泄漏
- 修复建议：补 `socket.on('error')` 日志+降级；closeWorker 先 `child.kill()`

### H3 ProviderRetryPolicy 超时分支无限重试
- 位置：`src/runtime/WishfulClaw.Agent/ProviderRetryPolicy.cs:95-114`
- 根因：`TimeoutException` 分支无 `retryAttempt < maxAttempts` 守卫（HTTP 分支有），服务端持续超时时永久循环重试，完全无视用户 `requestMaxRetries` 配置
- 影响：用户无法通过停止以外的方式中断超时循环，token 持续消耗
- 修复建议：超时分支补同样的次数守卫

### H4 压缩摘要器超时 OCE 逃逸，整个 run 失败
- 位置：`src/runtime/WishfulClaw.Agent/ContextCompression.cs:134` + `377-378`（`cts.CancelAfter(SummaryTimeout)`）
- 根因：摘要超时产生 `OperationCanceledException`，被 `when (ex is not OperationCanceledException)` 过滤排除后一路穿透压缩器与 AgentLoop——设计意图是超时降级机械折叠，实际是 run 直接失败
- 影响：摘要服务慢/超时→自动压缩炸掉整个对话轮次
- 修复建议：catch 内区分"用户取消"（外层 token 已取消→继续抛）与"超时"（外层 token 未取消→走机械折叠降级）

### H5 PersonaStore personaId 路径遍历，可递归删除任意目录
- 位置：`src/runtime/WishfulClaw.Persona/PersonaStore.cs:43-46`（`Path.Combine(dir, personaId)` 无校验）+ `174`（`Directory.Delete(dir, recursive: true)`）
- 根因：personaId 来自 IPC 参数，未拒绝 `..`/路径分隔符；对比 `MemoryPathResolver.cs:34-48` 对 SSH scope 有完整防逃逸校验，此处缺失
- 影响：`persona/save` 可向任意目录写文件、`persona/delete` 可递归删除任意目录（数据丢失级）
- 修复建议：入口处校验 personaId 仅允许安全字符集（参照 MemoryPathResolver 模式）

### H6 BashArtifactsCard 两处裸字符串调 shell 通道（已修 bug 的漏网点）
- 位置：`src/renderer/src/components/chat/BashArtifactsCard.tsx:65`（`shell:showItemInFolder`）、`:73`（`shell:openPath`）
- 根因：与本轮已修复的 6 处同类——主进程期望 `{ path }`，此处传裸字符串导致 `args.path === undefined`，静默失效；且 73 行 `void` 吞掉错误返回串
- 影响：聊天中 Bash 产物卡片的"打开/在文件管理器显示"按钮全部失效
- 修复建议：改传 `{ path }` 并消费错误串出 toast（与 PreviewPanel 一致）

### H7 平台登录通道 `api:request` 主进程无 handler
- 位置：调用方 `src/renderer/src/lib/auth/channel.ts:49,83,108`、`oauth.ts:134`、`copilot.ts:184`、`kimi.ts:139`；src/main 全库 0 注册
- 影响：若 vcode/oauth/copilot/kimi 登录入口在 UI 可达，点击必然失败
- 修复建议：确认这些登录流程是否为正式版功能——是则补 handler，否则移除/隐藏入口（需用户决策，标"需实测确认入口可达性"）
- **处置（批6 `5faa16b`）**：用户决策移除——删除 `channel.ts`/`kimi.ts` 与全部零调用登录入口（`startOAuthFlow`/`startProviderOAuth`/通道码登录/账号导入导出），清理 `api:request`/`oauth:*` 白名单与 `OAUTH_*` 常量；保留 `ensureProviderAuthReady→refreshOAuthFlow` 活路径（translate/pet 在用）

### H8 技能市场通道无 handler，功能整体不可用
- 位置：调用方 `skills-store.ts:284,334`、`skill-management-tool.ts:113,197`；`skills:market-list`/`skills:download-remote` 主进程 0 注册
- 影响：技能市场列表永远空白（且 `skills-store` 的 catch 静默吞掉失败），Agent 的技能管理工具对应分支必失败
- 修复建议：补 handler 或在正式版隐藏市场入口（需用户决策）
- **处置（批7 `b6546f8`）**：用户确认产品路线为"内置浏览器固定访问技能市场 + 复制安装语句由技能安装小助手执行"（路线通畅），死通道不再补全——删除市场死 actions、`search_skill_market`/`install_skill` 工具（含 Worker 占位定义）、`skills:market-list`/`download-remote`/`cleanup-temp` 通道与废弃设置项；保留 `list_installed_skills`

---

## 中危

### 主进程

| # | 位置 | 问题 |
|---|------|------|
| M2 | `index.ts:155-161` | `second-instance` 中 `mainWindow` 无 `isDestroyed()` 防护，且窗口关闭后未置 null |
| M3 | `index.ts:196/215`、`misc-handlers.ts:157`、`quick-launcher.ts:769` | 4 处 `BrowserWindow.fromWebContents(...)!`/`win!` 非空断言，窗口缺失时抛异常 |
| M4 | `ipc/fs-handlers.ts:354-360` | `fs:watch-dir` 用 `getAllWindows()[0]`（辅助窗口可能排首位，事件发给剪贴板/启动器窗口）+ `webContents.send` 非 postMessage + watcher 无 error 监听（FSWatcher error 崩主进程） |
| M5 | `ipc/fs-handlers.ts:163` | `fs:read-file-binary` 无文件大小上限，大文件全量进内存 |
| M6 | `ipc/misc-handlers.ts:113-118` | `shell:openExternal` 无协议白名单，`file://` 等可直达 |
| M7 | `ipc/misc-handlers.ts:147` | `shell:openWithApp` 吞掉 `shell.openPath` 错误串返回 void，渲染端 `getIpcError` 永远拿不到错误 |
| M8 | `ipc/misc-handlers.ts:179-186` | `fs:watch-file` error 时只删 map 不 `close()`；回调内 `getMainWindow()!` 断言 |
| M9 | `ipc/terminal-handlers.ts:127-134` | 终端输出事件 `createWindowEvent` fallback `getAllWindows()[0]`，可能发给辅助窗口 |
| M10 | `ipc/mcp-handlers.ts` + `mcp/mcp-client.ts:143` | MCP connect 无超时（无响应永久挂起）；连接后服务器断开无事件监听，状态一直 'connected' |
| M11 | `ssh/connection-pool.ts:122-126` | 连接失败路径先 `reconnectAttempts = 0` 再 `scheduleReconnect` → 上限（2 次）永远触发不了，持续性故障时按退避表无限重连（已核实） |
| M12 | `ipc/ssh-fs-handlers.ts:56-57` | list-dir 出错返回 `{ error }` 对象强转数组类型，渲染端按数组迭代即崩 |
| M13 | `ipc/native-agent-runtime.ts:27-32` | `USER_INTERACTION_METHODS` 反向请求无超时，渲染进程崩溃后条目永不清理，worker 侧永久挂起 |
| M14 | `quick-launcher.ts:750` | `launcher:launch` 忽略 `shell.openPath` 错误串，启动失败仍返回 true；:262 等 5 处 `spawn` 无 error 监听 |
| M15 | `priority-shortcuts.ts:668-677/697-712/592-596` | 桥进程退出后 1 秒无条件重启（无退避无上限→无限重启循环）；`ensureWindowsBridge` 返回 true 即视为成功（异步崩溃后热键静默失效）；stdin.write 无 error 监听 |
| M16 | `clipboard-enhancer.ts:318-329/387-390` | 焦点还原为异步桥消息后立即 `hide()`（时序竞争）；新窗口固定 200ms 后推历史（慢加载时首屏数据丢失，应由 did-finish-load 驱动） |
| M17 | `pe-icon-extractor.ts:50/62/68` | `readFileSync` 全量同步读任意大 exe（主进程阻塞+内存暴涨）；PE 偏移读取无边界检查（畸形文件抛 RangeError） |
| M18 | `ipc/web-search-handlers.ts:74-116` | `web:fetch-rendered` 用 `sandbox: false, contextIsolation: false` 隐藏窗口加载渲染端传入的任意 URL（无协议校验），`waitMs` 无上限 |
| M19 | `ipc/channel-handlers/channel-handler-utils.ts:102-110` | `registerChannelMessagePackHandler` 不捕获异常（与其他网关返回 `{error}` 的契约不一致），`plugin:*` 通道错误以 reject 返回，前端按 `{error}` 消费则静默失败 |
| M20 | `ipc/reverse-handlers/image-reverse-handler.ts:58-72` | 调 OpenAI Images API 无 AbortController/超时，网络挂起时反向请求永久不返回（阻塞工具槽位） |
| M21 | `ipc/codegraph-handlers.ts:22-27` | broadcast 用 `webContents.send` 而非 postMessage（Electron 35 disposed frame 异步抛错风险），检查与发送间存在销毁竞态 |

### 渲染端

| # | 位置 | 问题 |
|---|------|------|
| M22 | `stores/chat-store/session-slice.ts:132-147` | **删除会话不清理右侧面板绑定该会话的 tab**（summary/review/subagent/goal/browser/preview 残留，指向已删会话；本人自查发现） |
| M23 | `components/layout/CommandPalette.tsx:101-104` | 无结果时按方向键 `% 0` 产生 NaN 选中索引；重新打开面板 `selectedIndex` 不重置残留陈旧高亮 |
| M24 | `components/layout/PreviewPanel.tsx:247-252` | 复制 Markdown 未 await/未捕获，剪贴板写入失败仍显示"已复制"假反馈 |
| M25 | `components/layout/PreviewPanel.tsx:254-257` + `RightPanel.tsx:213-223` | `fs:select-file` invoke 无 try/catch，失败为静默未处理 rejection（双处同入口） |
| M26 | `hooks/use-file-watcher.ts:96-98` | 文件读取失败仅置空内容不暴露 error 态，预览无法区分"空文件"与"读取失败" |
| M27 | `components/settings/RuntimePanel.tsx:39` | 开机自启开关先乐观更新再 `void` invoke 不检查结果，失败时开关与系统状态不一致 |
| M28 | `components/terminal/LocalTerminal.tsx:140` | 终端键入 `void` invoke 无 catch，写入失败按键静默丢失 |
| M29 | `stores/persona-store.ts:102-117` + PersonaPanel | Worker 返回 `success: false` 的业务失败不写 `error`（仅异常路径写），保存失败无横幅反馈 |

### Worker C#

| # | 位置 | 问题 |
|---|------|------|
| M30 | `Providers/ProviderRetryPolicy.cs:161-164` | HTTP 400（客户端错误）被判为可重试，结合 H3 形成无效重试风暴 |
| M31 | `Providers/AnthropicMessagesProvider.cs:69-113` | 缺 HttpRequestException→ProviderHttpException 转换（OpenAIChatProvider 有），网络错误不进重试策略 |
| M32 | `AgentLoop.cs:58-60` | `__goal__{id}` 会话键只创建从不移除（对比 `__subagent__` 键有清理），长进程字典持续增长 |
| M33 | `Infrastructure/Db/DbClient.cs:49-477` | Initialize 无幂等早退；失败后 `_db` 已赋值而 `_initialized=false`，`GetClient` 每次重建；首次成功前不同 `dbPath` 参数可静默切换全局 DB |
| M34 | `Worker/WorkerHostBuilder.cs:56-59` | 模块初始化 fire-and-forget，服务器初始化完成前即接受请求（Goal 恢复等可能读到空状态）；单模块初始化失败仅 Warn 不熔断 |
| M35 | `Workspace/Memory/MemoryModule.cs:85` | `MemoryUpdateQueue.Enqueue("", ...)` 传空 sessionId 被静默丢弃——memory/write 覆写事件永远不会注入下一轮对话 |
| M36 | `Workspace/Memory/MemoryPathResolver.cs:53-56` | local project scope 无任何路径校验（SSH scope 有），可指向任意目录创建 `.wishful-claw` 写入（与 H5 同类的双标不一致） |
| M37 | `ssh/...`（ssh-handlers.ts:35-59 `toMeta`） | 明文 password/passphrase 回传渲染端，与 `repository.ts` 注释"plaintext secrets are never sent to the renderer"矛盾——需确认是否编辑场景的有意设计 |

---

## 低危（择要，完整清单见子代理原始记录）

- L1 `ipc/misc-handlers.ts:189`：`fs:watch-file` 建立失败返回 `{ path }` 伪成功；`fs:search-files` 错误吞为 `[]`
- L2 `native-worker.ts`：请求正常完成不从 `cancelKeys` 删除（缓慢内存泄漏）；`video-handlers.ts:35` jobs Map 永不清理
- L3 `ipc/git-cache.ts:264-273`：失败结果也写入 TTL 缓存（错误响应缓存 1.5–5 秒）
- L4 `cron-reverse-handler.ts:64-67/295-299`：退出时 timers 无人清理；主窗口不可用时一次性任务触发静默丢失
- L5 `settings:channel.*` 76 键英文侧整体缺失（英文用户渠道设置页全回退中文）；`chat:goal.pendingTitle` zh 缺失
- L6 i18n 代码用而文件缺 155 键：整个 `agent` ns 无文件（压缩组件全靠 defaultValue）；`ssh:connectionFailed` 无 defaultValue 直接显示键名；`common` ns 43 键实际写在 `chat` 里（ns 不匹配）；`chat` 31 键、`settings` 33 键、`layout` 12 键、动态 ns 20 键
- L7 `git-page-handlers.ts:173`：`handleCommit` 无 try/finally，reject 时按钮永久 loading
- L8 `BottomTerminalDock.tsx:99-111`：自动建终端失败静默且当轮不重试，依赖数组省略导致陈旧闭包窗口
- L9 `mcp-store.ts:208`：`removeServer` 未捕获（同文件其他方法均有）
- L10 `use-file-watcher.ts:131`：监视注册失败空 catch，预览自动刷新静默失效
- L11 `BrowserPanel.tsx:309`：裸 `invoke` 无 await/无 catch（unhandled rejection）
- L12 C# 低危：`OpenAIChatProvider.cs:311` SSE 行 `JsonDocument.Parse` 无 try；`RunState.Cancel` 忽略 reason；`DbService.cs:152` Rollback 抛异常掩盖原始异常；`LocalIpcWorkerServer.cs:285` 关闭时任务枚举竞态；`PersonaGenerator` 无 CancellationToken（取消后挂到 2 分钟超时）；`PersonaStore.SavePersona` 4 文件顺序写非原子；`MemoryModule.cs:209` 死分支；`MemoryFtsService.cs:44` catch 吞全部异常
- L13 AOT 规范偏离（功能无害）：7 处裸 `new JsonSerializerOptions()`（QqSessionStore/ProviderStore/ConfigStore/ChannelConfigStore/SkillCatalog + 2 处死代码声明）
- L14 死代码清理项：`sidecar-handlers.ts` 全文件（已核实非故障）、`agent-runtime-sync.ts installAgentRuntimeSyncListener`、`ExtensionManifestStore.cs:32`/`ProviderTestService.cs:19` 未使用字段
- L15 打包：`package.json` 缺 `author` 字段（builder 告警）；`publish-aot.bat` 硬编码本机路径且未被任何 script 引用
- L16 `App.tsx:56`：`persist.onFinishHydration` 注销函数未捕获（实际无害）

---

## 存疑区（需用户决策或实测确认）

1. **H7 的登录流程是否仍为正式版功能**——决定补 handler 还是移除入口
2. **M37 SSH 明文密码回传渲染端**——是否编辑场景的有意设计
3. `oauth-utils.ts:106` `app:system-info` 无 handler 但有显式降级注释——有意设计还是掩盖缺失
4. `db-helpers.ts:338` 消息落盘失败仅日志——注释表明有意（后续快照为超集），但用户不可感知
5. `SessionConversationPane.tsx:68-70` `useState(() => initTerminal())` 渲染期副作用，StrictMode 双渲染下初始化跑两次——需实测幂等性
6. `ToolDispatchRouter.cs:510` 未识别工具名返回空成功——是否由上层兜底
7. `BackgroundSubAgentRegistry.cs:106-172` 读-改-写非原子——当前单写者模型下缓解
8. `MemoryUpdateQueue._queues` 未找到会话结束时清理路径——长进程缓慢积累
9. `skill-panel.tsx`/`WorkspaceSidebar.tsx`/`ChatHomePage.tsx` 的 `fs:select-folder`/`createProject` 无 try/catch——取决于主进程 handler 失败形态

---

## 已核实通过的检查项

- React Hooks 顺序违规：全量扫描 197 个候选文件，零违规（历史 #300 事故后纪律保持）
- 事件/订阅泄漏：组件级订阅均有 cleanup，模块级注册均幂等单例，仅 1 条形式问题（L16）
- zustand 原地变异：5 个 store 走 immer 中间件，其余 set 均返回新引用，零失更新点
- 预览双层 tab 同步：本轮已修（setRightPanelActiveTab/closeRightPanelTab 双向），复查无残留缺口
- Worker 模块注册：21 个 IWorkerModule 实现与 Catalog 一一对应；未知方法返回 Error 不挂死；全局异常兜底存在
- AOT 合规：0 处反射创建实例/反射扫描/匿名类型序列化违规，无 trim 崩溃级风险
- 打包链路 5 项核心核对全部通过（资源路径/删除清单/AOT 产物↔加载路径/grammars/asar 白名单）
- 本迭代已修竞态复核无回归：手动压缩 TOCTOU 重查、restore 原子化守卫、dbUpsertMessage 串行队列
- 持久化链路：settings-store version 33 迁移守卫、草稿启动清扫+删会话清理、三路径落库一致性（迭代内已验证）

## 修复优先级建议

1. **第一批（进程安全与数据保护）**：H1 退出清理接线、H2 socket error+kill、H5 persona 路径遍历、M36 local scope 校验
2. **第二批（核心对话可靠性）**：H3 超时重试守卫、H4 摘要 OCE 降级、M30 400 不可重试、M31 Anthropic 异常转换、M11 SSH 重连上限
3. **第三批（功能修复/决策）**：H6 Bash 产物卡两处、H7/H8 通道缺失（需用户决策补或移除）、M22 删会话清 tab、M23 CommandPalette NaN
4. **第四批（静默失败治理）**：M7/M14 错误串回传、M24-M29 渲染端反馈补齐、M19 网关契约统一
5. **第五批（体验与清理）**：i18n 缺失（settings:channel 整段优先）、低危择修、死代码清理

> 统计：高危 8（其中 H7 待决策）、中危 36、低危 16 组、存疑 9。核实通过率：Hooks/泄漏/变异/AOT/打包/模块注册六大机械检查全部通过。
