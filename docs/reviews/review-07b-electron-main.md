# 代码审查报告 7b：Electron 主进程

> 审查范围：`main/index.ts`、`lib/native-worker.ts`、`ipc/messagepack-handler.ts`、`ipc/native-agent-runtime.ts`、`ipc/agent-stream-handler.ts`、`window-ipc.ts`、`quick-launcher.ts`（窗口生命周期部分）、`priority-shortcuts.ts`（主进程侧）
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 进程生命周期交叉验证
> 说明：全项目持续审查第 7b 部分，只记录问题，不附带修复。

---

## §1 高优先级

### EM-1 Worker 无优雅关闭：退出时正在跑的 run 全部硬死

**位置**：`lib/native-worker.ts:412-414`、`main/index.ts:487-492`

**问题**：
- `latchNativeWorkerShutdown()` 是**空函数**（注释自认 "Placeholder for graceful shutdown"），且**无任何调用方**。
- `before-quit` 只清理 SSH 和 channel，**从不通知 Worker**：不调用任何 shutdown 端点、不 `child.kill()`、不等待退出。
- 后果链：用户关闭应用（托盘退出）→ Electron 主进程退出 → 命名管道断开 → Worker 检测到管道关闭后自行终止（或被系统回收）→ **所有进行中的 agent run、后台子 agent、Goal 编排瞬间死亡**，无落盘机会。DB 里留下假 active 状态（靠下次启动 SweepInterruptedGoals 兜底，iter-19 已修），但：
  - 正在写的文件可能停在半截（WriteAndFlushAsync 被打断）；
  - shell 子进程树可能残留（Worker 死了没人 Kill 进程树）；
  - Goal 的"暂停后可恢复"承诺在退出场景完全失效——恢复的是 interrupted 而非优雅暂停。
- 对比：quick-launcher/priority-shortcuts/clipboard-enhancer 都认真注册了 will-quit 清理，唯独最重的 Worker 没有。

**建议**：before-quit 里调用 Worker 的优雅关闭（新增 worker/shutdown 端点：停止接受新 run、等待进行中工具到安全点、落盘、退出），带超时强杀兜底。

---

## §2 中优先级

### EM-2 NativeWorkerManager 无自动重启，Worker 崩溃后整个应用瘫痪直到手动重启

**位置**：`native-worker.ts:157-161`

**问题**：
- `child.on('exit')` 只记日志 + `closeWorker`（reject 所有 pending、清空状态），**不重启**。
- Worker 崩溃后：所有 IPC handler 调 `getNativeWorker().request()` → `ensureStarted()` → `start()` 会重新 spawn——**惰性重启存在**，但：
  1. 崩溃瞬间所有 pending 请求 reject，渲染端各 store 收到错误但**不重试**，用户看到的都是一次性报错；
  2. `agent/stream` 事件监听（agent-stream-handler 在启动时注册一次 `worker.onEvent`）——`closeWorker` 清空了 child/socket 但 **events EventEmitter 还在**，重启后 onEvent 监听仍有效，这点没问题；但渲染端 `agentStream` 的流式状态（streamingMessages）不会自动恢复，正在流式输出的会话永久卡住（RC-3 的残留条目）；
  3. Worker 崩溃前的 ActiveRuns、SessionConversation、Goal ActiveGoals 全部丢失——Goal 面板显示 active 但 GetContext 为 null，点暂停/恢复走 DB 恢复路径（能工作但状态语义已乱）。
- 无崩溃计数/退避：若 Worker 因某输入稳定崩溃，会形成"用户发消息→崩溃→重发→再崩溃"循环。

**建议**：exit 时自动重启 + 指数退避；连续 N 次崩溃后停止并向渲染端广播"Worker 不可用"；重启成功后广播让渲染端清流式状态。

### EM-3 请求超时后 pending 条目泄漏 + 迟到响应错配风险

**位置**：`native-worker.ts:103-111`

**问题**：
- 超时 timer 触发时 `pending.delete(id)` + reject——正确。但**请求本身已写入 socket**，Worker 仍会执行并回包；迟到响应到达时 `pending.get(id)` 为 undefined，被静默丢弃（L305 `if (!pending) return`）——行为安全但：
  1. **副作用已发生**：如 `agent/run` 超时（60s 默认）后 Worker 其实启动了 run，渲染端以为失败，用户重发 → 双 run 并行。agent/run 这类长操作用 60s 超时本身可疑（run 是异步接受的，正常毫秒级返回；但 Worker 忙时排队可能超时）。
  2. `nextId` 在 Worker 重启后**不重置也不需要重置**（Worker 端无状态按 id 回包），但重启后旧 Worker 的迟到响应与新 Worker 的响应共用同一 id 空间——旧响应若在新请求发出后到达，id 恰好相同会**错配给新请求**（低概率但存在；closeWorker 清了 pending 表，旧响应到达时 get 不到，安全——前提是 closeWorker 先于新请求，时序上成立）。此项实际风险低，主要是超时后副作用未知的语义问题。

**建议**：对 agent/run 类"有副作用"的请求不用超时或用超时+取消补偿；至少文档化"超时≠未执行"。

### EM-4 quick-launcher 窗口关闭后引用不置空

**位置**：`quick-launcher.ts:864-866`（blur hide）、全文件无 `closed` 事件处理

**问题**：
- launcherWindow 只 hide 不 close，正常不触发；但系统清理/任务管理器杀窗口/开发者工具里手动 close() 时，`closed` 后 `launcherWindow` 仍指向已销毁实例。
- 后续热键触发 `createLauncherWindow` 走 `if (launcherWindow)` 分支 → `launcherWindow.isVisible()` 在 destroyed 实例上**抛异常**（Electron destroyed 对象访问方法 throw），热键从此失效直到重启。
- 对比：mainWindow 有 render-process-gone 处理；launcher 没有。

**建议**：注册 `launcherWindow.on('closed', () => { launcherWindow = null })`。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| EM-5 | `index.ts:86-92` console-message | 渲染端 **所有 warn 及以上日志**（含第三方库噪音、React DevTools 提示）全量写主日志文件；且 message 含用户会话内容时同样落盘（与 RC-7 同族）。日志无采样/上限，长期运行日志文件持续膨胀，无轮转机制迹象（依赖 logger 内部实现，未见 rotate） |
| EM-6 | `index.ts:237, 279-322` | 缩进混乱（`registerWebSearchHandlers()` 少两格）、stub handler（agents:list/commands:list/config:get 等返回空值）散落在主文件——应集中到 stub-handlers.ts 并注明"待实现"或删除调用方 |
| EM-7 | `native-worker.ts:355, 382` | 主进程代码里用 `require('fs')` 内联引入（两处），与顶部 ESM import 风格割裂；electron-vite 环境应统一 import |
| EM-8 | `native-worker.ts:16` | MAX_FRAME_BYTES = 256MB——单帧上限过大，恶意/异常 Worker 可让主进程一次性分配 256MB Buffer。建议降到 16-32MB（实际消息远小于此） |
| EM-9 | `index.ts:482` | window-all-closed 判定 `isQuiting \|\| !tray`——tray 创建失败（如图标加载异常）时关窗即退出，与"最小化到托盘"的产品预期不符；失败路径应兜底创建 tray 或提示 |
| EM-10 | `native-agent-runtime.ts:24` | 渲染端工具请求超时 30s 硬编码——文件树大项目 fs 枚举、MCP 冷启动可能超 30s，超时后 Worker 侧 reverse-request 收到错误，但渲染端 handler 可能仍在执行（结果被丢弃），双份执行 |
| EM-11 | `messagepack-handler.ts:22` | handler 抛错时返回 `{ error: msg }` 而非 ipcMain.handle 的 reject——渲染端 invokeMessagePackBinary 拿到正常 resolve，**必须手动检查 error 字段**；各调用方是否都检查了无统一保证（goal-store 检查了，其它 store 未必）。协议级约定应改为 reject 或封装统一 Result 类型 |
| EM-12 | `agent-stream-handler.ts:12-16` | agent/stream 广播给 **所有** BrowserWindow——包括 quick-launcher、clipboard-enhancer 等辅助窗口。辅助窗口 preload 里若未监听该 channel 则无害，但每次 run 事件都做一次无谓的 postMessage 序列化；高频 text_delta 下是纯开销 |

---

## 附：确认无误的设计点

- 单实例锁 + second-instance 聚焦已有窗口，双击 exe 行为正确
- 命名管道端点含 pid+时间戳+UUID，多实例残留管道不会冲突
- 帧解析（4 字节长度头 + 分块缓冲）实现正确，consumeBufferedBytes 跨 chunk 拼接无误
- connect 阶段检测 Worker 提前退出（exitCode 检查在重试循环内），避免对死进程空等 10s
- safeSendMessagePackToWindow 用 postMessage 而非 send 规避 Electron 35 的 WebFrameMain disposed 异步 throw，注释解释了原因
- main-window-registry 的引入明确解决了"getAllWindows()[0] 可能是辅助窗口"的 reverse-request 路由 bug（注释记录了教训）
- Worker 日志级别通过环境变量与主进程对齐（dev=debug / packaged=warn）
- USER_INTERACTION_METHODS（ask-user/plan-review/goal-confirm/sub-agent-approve）不设超时，等待用户交互语义正确
