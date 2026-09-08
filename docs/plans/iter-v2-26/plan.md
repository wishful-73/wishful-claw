# v2-iter-26：桌面自动更新体验收口 + 4 项 Obsidian 待办

- 状态：规划中
- 分支：`dev/v2-iter-26`
- 基线：`v0.2.25` / commit `5625d363`
- 目标版本：待本迭代完成功能验收后确认
- 范围确认：2026-09-07 老大确认先推进前三项；安全富文本、托盘后台下载、用户明确安装、下载/差分可观测
- 范围调整：2026-09-08 老大确认 Plan C 只做下载可观测性，**不做真实安装版升级验证**
- 范围追加：2026-09-08 老大确认把 Obsidian 待办 4 项并入本迭代，对应 Plan D~G（渠道会话按“特殊 global”统一工具可见性、飞书绑定后自动启用、同步 OpenCowork 内置服务商、OpenCode Go 会话请求头）
- 暂缓：Windows 发布者签名、发布链路自动化收口、真实安装版旧→新升级验证（隔离 VM/Sandbox 构建 NSIS 测试包、历史 24→25 复现、安装期失败场景）、`vertex-ai` 与 `routin-ai` 两个服务商预设，及其他后续追加项
- 探索证据：Plan A~C 见本文档第 1~2 节；Plan D~G 的逐条代码证据见 `docs/plans/iter-v2-26/exploration_findings.md` 的“追加项探索结论（2026-09-08）”章节，Plan D 的三层过滤与 `sessionMode` 消费点清点见本文档 Plan D 章节
- 规划复审修订：2026-09-08 首轮独立复审判 BLOCKED（2 个 ❌ 同一根因：Plan G 误判发送路径为单一入口；3 个 ⚠️：Plan E 漏掉吞异常的裸 catch、`IWorkerRequestContext` 成员漏列、部分文件路径未写全）。全部已在本版修订；第二轮复审判 **PASS（❌ 0）**，详见 `compliance_report.md`
- **Plan D 修法变更（2026-09-08 老大裁定）**：老大指出“渠道会话就是特殊的 global”。核实后确认 `AgentRunContextPolicy.Resolve:121-126` 已按此把 `scope` 归一为 `global`，但 `ResolveAvailableMode:164-182` 未做同样归一，这一处不一致同时造成三个症状（项目工具、全局任务工具、`Plugin*` 6 工具），且第三层白名单本来就为它们放行。故 Plan D 由“改 10 处 `availableModes` 追加 `"channel"`”（修法 A，**已废弃**）改为修法 B：把 `channel` 归一为 `global`。附带**三个**有意的行为变更：渠道会话新增 `<global_agent>` prompt 注入、`Plugin*` 6 工具恢复可见、渠道会话不再注入 `<session_todo>`（`AgentLoop.cs:209`）。
- **Plan D 第三轮复审处置（2026-09-08）**：修法 B 首版被判 BLOCKED（❌ 3、⚠️ 3）。处置结果——**❌-1（归一化不幂等会让“绑定项目的渠道会话”必崩）经老大裁定前提不成立，已排除**：老大明确“全局会话和渠道会话本质上都是全局会话，不会绑定项目”，代码侧亦证实 `src/main/channels/auto-reply.ts:177` 硬编码 `projectId: null`、`db/plugin-sync-session-project` 无渲染端调用方，故 Plan D **维持单文件改法，不动 `AgentLoop.Helpers.cs`**（详见 Plan D 的“已排除的伪风险”一节）；❌-2（`sessionMode` 消费点漏列 `AgentLoop.cs:203-213`）与 ❌-3（代理路径漏列第三道 gate `AgentRuntimeUseCapabilityEncoding.cs:128-130`）已补全；⚠️ 三项（D2 的 `subAgent` 大小写、桌面全局基线断言零检出力、`BuildGlobalAgentPrompt` 行号）已修正。
- **老大 2026-09-08 裁定跳过第四轮独立复审，直接进入执行态。** 有意的行为变更共三个：渠道会话新增 `<global_agent>` prompt、`Plugin*` 6 工具恢复可见、渠道会话不再注入 `<session_todo>`（`AgentLoop.cs:209`）。

## 1. 背景与已核验事实

25 版本发布后，自动更新主链路可以正常工作，但需要继续收口：

1. 更新说明弹窗显示 `<h2>`、`<li>` 等标签文本。
2. 更新下载需要支持后台进行；用户关闭更新弹窗后要有明确指引，不能让用户误以为下载已中断或已经完成。
3. 25 版本下载在数秒内完成，需要把下载量/速度/耗时/状态做成可观测，并留存 `electron-updater` 原生日志；差分还是完整下载按日志证据判定，无证据时明确记为“未确定”，本迭代不做安装版实测证明。
4. 对照 DeepSeek-Reasonix 的更新闭环，补足本次更新体验所需的状态和可观测性；其他改进后续追加计划。

### 1.1 当前代码证据

- `src/renderer/src/components/updater/UpdateReleaseNotes.tsx` 使用 `<pre>{notes}</pre>`，所以 GitHub Atom 返回的 HTML 直接作为文本显示。
- `src/main/updater.ts` 配置 `autoDownload = false`，点击下载后调用 `updater.downloadUpdate()`；关闭 `UpdateDialog` 只改变 React 的 `open` 状态，没有取消 IPC，也没有调用下载取消 API。因此当前实现中关闭弹窗不会中断下载，但关闭后没有全局进度入口。
- `electron-updater@6.6.2` 的 Windows `NsisUpdater` 会优先尝试嵌入 blockmap 的差分下载；差分失败才回退完整 EXE。差分日志会输出 `Full` 与 `To download`。
- v0.2.25 的 `latest.yml` 指向 `127,316,506` bytes 的完整 NSIS 安装包，Release 同时有 `.blockmap`；v0.2.24 安装包为 `127,352,200` bytes，文件大小只相差约 `35,694` bytes。25 版 Release 资产和 `latest.yml` 已核对一致，EXE 支持 `Accept-Ranges: bytes`。
- 本机现有日志没有本次 24→25 下载对应的 `To download` 记录，因此不能仅凭“几秒”断言差分下载的确切字节量。老大已确认本迭代不补安装版升级测试，故历史 24→25 的下载模式在报告中固定记为“未确定”；Plan C 的可观测性保证后续任何一次真实下载都能留下可判定证据。

## 2. Reasonix 对照结论

参考本机 `D:\claw\DeepSeek-Reasonix\desktop\updater.go`、`updater_app.go`、`frontend/src/lib/useUpdater.ts`、`frontend/src/components/UpdateBanner.tsx`：

- 更新状态显式区分 checking / available / downloading / verifying / authorizing / installing / relaunching / done / error。
- `latest.json` manifest 提供版本、说明、下载地址、大小和 SHA-256；下载后再做签名与摘要校验。
- 更新请求绑定 `requestId`、channel、expectedVersion，过滤旧请求/旧版本事件，避免并发或过期事件污染当前 UI。
- 下载进行时使用常驻横幅展示已下载量、总量和进度；关闭/忽略的是提示，不是后台更新操作。
- 发布源按 CDN → 网关 → GitHub fallback；失败区分 retryable / recovery / manual，并提供丢弃旧事务等恢复入口。

本迭代只借鉴状态、可观测性、请求绑定和恢复指引，不把 Wishful Claw 的 Electron/GitHub Releases 链路改造成 Reasonix 的自研 manifest、签名服务或 Wails 更新器。

## 3. 跨 Plan 硬契约

### 3.1 状态与进程生命周期

- `src/main/updater.ts` 是更新状态的唯一持有者；状态只在当前 Electron Main 进程内常驻，不写入磁盘，也不承诺应用彻底退出后继续下载。
- Renderer 每次挂载都先调用 `update:status` 恢复完整快照，因此关闭更新弹窗、隐藏主窗口、Renderer 重载后都能恢复当前状态；主窗口隐藏时 Main 和 `electron-updater` 不销毁，下载继续。
- 每次新下载生成单调递增的 `operationId`，并固定 `expectedVersion`。重复下载请求返回同一活动操作；失败重试生成新操作；版本不匹配的完成事件和已结束操作的旧事件不得覆盖当前状态。
- 固定状态字段：`phase`、`currentVersion`、`availableVersion`、`downloadedVersion`、`releaseNotes`、`operationId`、`expectedVersion`、`percent`、`transferred`、`total`、`bytesPerSecond`、`elapsedMs`、`declaredInstallerSize`、`error`。未知数值使用 `null`，不得伪造 `0` 或 `100`。
- 固定状态流：`idle → checking → available → downloading → downloaded → installing`；检查失败回到 `idle`，下载失败进入 `error` 并保留可重试版本，重试从 `error → downloading`。本迭代不增加无法从 `electron-updater` 可靠观测的伪 `verifying` 阶段。

### 3.2 IPC、托盘与安装边界

- Renderer → Main 请求固定为 `update:check`、`update:download`、`update:status`、`update:install`；Main → Renderer 事件固定为 `update:available`、`update:download-progress`、`update:downloaded`、`update:error`、`update:show-details`。
- 继续使用现有通用 MessagePack `window.api.invoke/on`；`src/preload/index.ts` 和 `src/preload/index.d.ts` 不修改，Renderer 不导入或持有 Electron 对象。
- `src/main/index.ts` 持有窗口和托盘。托盘“更新详情”只执行恢复/聚焦主窗口并发送 `update:show-details`；托盘点击、通知、窗口关闭和退出均不得连接安装 API。
- 本迭代不新增系统通知。常驻 `UpdateStatusBanner` 与托盘“更新详情”是唯一恢复入口，避免通知语义和入口重复。
- 唯一允许调用 `requestUpdateInstall()` / `quitAndInstall()` 的路径是：用户在 Renderer 明确点击“重启安装” → `update:install` → Main。`update-downloaded`、弹窗关闭、主窗口关闭/隐藏、托盘操作、Renderer 重载、正常退出和启动恢复都不得自动安装或重启。
- `autoDownload=false`、`autoInstallOnAppQuit=false` 保持不变；彻底退出会终止当前下载，已下载更新也不会因正常退出自动安装。

### 3.3 每步统一 Mini 门槛

每个产生代码改动的步骤完成后都执行以下命令，任一失败不得标记 `[✓]` 或提交。Plan A~G 全部适用同一门槛：

1. `npx tsc --noEmit -p tsconfig.web.json`
2. `npx tsc --noEmit -p tsconfig.node.json`
3. `npx tsc --noEmit -p tsconfig.json`
4. `dotnet build src/runtime/WishfulClaw.sln`（0 错误）。Plan D、G 改动 C#，除 0 错误外还必须确认 **AOT 0 警告**：不得引入 `Activator.CreateInstance`、`Assembly.GetTypes()`、匿名类型 JSON 序列化、裸 `new JsonSerializerOptions()` 或 `System.Reflection`；新增可序列化类型必须登记到对应 `JsonSerializerContext`。
5. 当前步骤指定的测试脚本与 `git diff --check`

> 构建 C# 前需把 `DOTNET_ROOT` 指向本机便携 SDK `D:\claw\dotnet-sdk`（见 AGENTS.md）。

## 4. Plan 拆分与执行步骤

### Plan A：Release Notes 安全富文本

目标：把不可信的 GitHub Atom HTML、Markdown 或普通文本渲染为可读的安全富文本，不再裸显 HTML 标签。

确定文件范围：

- 修改 `src/renderer/src/components/updater/UpdateReleaseNotes.tsx`：使用 `react-markdown + remark-gfm + rehype-raw + rehype-sanitize`，保留滚动容器和空说明文案，不使用 `dangerouslySetInnerHTML`。
- 新增 `src/renderer/src/components/updater/release-notes-sanitizer.ts`：定义唯一 schema、URL 规范化与安全链接组件配置。
- 新增 `tests/updater-release-notes/program.ts`：覆盖纯函数和静态渲染结果，不依赖 Electron。
- 修改 `package.json`、`package-lock.json`：加入 `rehype-raw`、`rehype-sanitize`，新增 `test:updater-release-notes`；复用已有 `react-markdown`、`remark-gfm`。

安全边界：

- 仅允许 `h1`~`h6`、`p`、`br`、`ul`、`ol`、`li`、`strong`、`em`、`code`、`pre`、`blockquote`、`a`。
- 清洗输入时仅允许 `a[href]`；渲染链接时统一覆盖为 `target="_blank"`、`rel="noopener noreferrer"`，不信任输入自带的 `target`、`rel`。
- URL 去除首尾空白与 ASCII 控制字符后再解析，只允许绝对 `http:` / `https:`；相对地址、协议相对地址、`javascript:`、`data:`、`blob:` 及大小写/空白/控制字符绕过全部拒绝。
- 删除所有事件属性、`style`、SVG、MathML、`iframe`、`object`、`embed`、`script`、`form`、图片与未知节点。

步骤清单：

- [✓] A1：安装两个依赖，实现 schema 与 URL 过滤；加入真实 v0.2.25 notes、Markdown、普通文本、空字符串和恶意输入 fixture。Mini 验证：`npm run test:updater-release-notes` 断言允许节点保留，危险节点/属性/协议及绕过变体从静态渲染结果中消失，安全链接具有固定 `target/rel`。（已完成：`rehype-raw@^7` + `rehype-sanitize@^6`；71 项断言通过）
- [✓] A2：接入 `UpdateReleaseNotes`，统一处理 Atom HTML、Markdown 和普通文本。Mini 验证：`npm run test:updater-release-notes`；真实 v0.2.25 fixture 显示标题/列表且不出现 `<h2>`、`<li>` 源码文本，空内容显示既有空说明。（已完成：三套 `tsc --noEmit -p` 0 错误、`dotnet build` 0 警告 0 错误、`npm run build` 成功、`git diff --check` 干净）
- [ ] A3：完成统一 Mini 门槛并在开发态做 DOM/截图核验，确认链接只经现有 Main `setWindowOpenHandler` → `shell.openExternal` 外开。证据写入 `docs/plans/iter-v2-26/download-observability-report.md`，安全渲染截图固定为 `docs/plans/iter-v2-26/evidence/release-notes-safe.png`。**与 C4 合并执行**：本步需要一次能真正触发 `update-available` 并带出 Release Notes 的开发态会话，而 C4 已为此临时下调 `package.json` 版本，两者共用同一次取证会话，避免重复启动与重复降版。

验收断言：真实 v0.2.25 内容、中英文和空说明正常；恶意 HTML/Markdown 不执行、不保留危险 DOM；Renderer 不直接依赖 Electron。

### Plan B：后台下载、托盘继续与明确安装

目标：下载任务与弹窗生命周期解耦；Main 进程存活期间始终可恢复状态；安装只由用户明确按钮触发。

确定文件范围：

- 新增 `src/main/updater-state.ts`：纯状态协调器，负责 operationId、expectedVersion、合法状态转换、进度单调性和旧事件过滤，供 Main 与 Node 测试复用。
- 修改 `src/main/updater.ts`：持有 updater 与状态协调器，下载请求采用 single-flight 并在任务启动后立即确认；原生 promise 在 Main 后台继续并通过事件更新状态；系统任务栏进度只在 Main 设置。
- 修改 `src/main/index.ts`：托盘固定增加“更新详情”；统一恢复/聚焦窗口并发送 `update:show-details`；保留现有 hide-to-tray 与显式退出语义。
- 修改 `src/shared/updater/types.ts`：固化完整状态快照、操作标识、进度、错误和请求返回类型。
- 修改 `src/renderer/src/hooks/use-app-updater.ts`：状态恢复、事件过滤、下载/重试/安装动作；只消费共享类型和 `window.api`。
- 修改 `src/renderer/src/components/updater/UpdateDialog.tsx`：按钮改为“后台下载”；Main 确认任务启动后立即关闭详情；下载完成仅显示“重启安装”和“稍后”。
- 新增 `src/renderer/src/components/updater/UpdateStatusBanner.tsx`：在 downloading/downloaded/error 三态常驻，点击恢复详情；下载完成状态不可通过关闭弹窗永久隐藏。
- 修改 `src/renderer/src/App.tsx`：顶层挂载横幅和弹窗；监听 `update:show-details`；启动下载获 Main 确认后收起弹窗。
- 修改 `src/renderer/src/locales/zh/settings.json`、`src/renderer/src/locales/en/settings.json`：补齐后台下载、托盘继续、稍后、重试和错误文案。
- 新增 `tests/updater-state/program.ts`；修改 `package.json` 增加 `test:updater-state`。
- 明确不修改 `src/preload/index.ts`、`src/preload/index.d.ts`，不新增取消下载 API，不新增系统通知。

步骤清单：

- [✓] B1：实现 `updater-state.ts` 和共享类型。重复下载返回相同 operationId；错误重试创建新 operationId；错误保留 expectedVersion/availableVersion；错误操作、错误版本和倒退进度不得污染当前快照。Mini 验证：`npm run test:updater-state` 覆盖合法/非法转换、single-flight、旧事件、版本不匹配与 Renderer 重挂载快照，再执行统一 Mini 门槛。（已完成：新增纯状态协调器 `src/main/updater-state.ts`（Electron 无关，可注入时钟），`src/shared/updater/types.ts` 固化 `UpdateProgressSnapshot`/`UpdateStateSnapshot`/`RendererUpdateState`/`UpdateStatus` 与 `NO_UPDATE_OPERATION_ID`；`updater.ts` 全部状态改写经协调器，`use-app-updater.ts` 的 `update:status` 改为整快照替换、`progress` 更名 `percent`；42 项断言通过，三套 `tsc --noEmit -p` 0 错误、`dotnet build` 0 警告 0 错误、`npm run build` 成功、`test:updater-release-notes` 71 项未回归、`git diff --check` 干净）
- [ ] B2：改造 Main 下载启动语义。`update:download` 在 `downloadUpdate()` 成功启动后立即返回 `{ success: true, operationId }`，不等待完整下载；后台 promise 必须自行捕获失败并广播，关闭弹窗/隐藏窗口不触发取消。Mini 验证：`npm run test:updater-state` 断言“启动确认先于完成事件”、重复请求不启动第二个下载、close/hide 不产生取消或安装动作，再执行统一 Mini 门槛。
- [ ] B3：实现顶层横幅、弹窗恢复与托盘“更新详情”。托盘动作执行 restore/show/focus 后发送 `update:show-details`；Renderer 收到后打开详情并以 `update:status` 快照为准。托盘“退出”只设置退出标志并 `app.quit()`。Mini 验证：开发态手动覆盖关闭弹窗、关闭主窗口、托盘恢复、Renderer reload 四条路径；状态与进度不丢，退出不调用安装；截图保存为 `docs/plans/iter-v2-26/evidence/background-download.png`，再执行统一 Mini 门槛。
- [ ] B4：收口安装硬契约。Main 的 `requestUpdateInstall()` 保持唯一 `quitAndInstall(false, true)` 调用点；仅 `UpdateDialog` 与横幅中的“重启安装”按钮可调用 `installUpdate()`；重复点击幂等。`update-downloaded` 只广播并进入 downloaded，不调用安装。Mini 验证：`npm run test:updater-state` 断言下载完成、关闭/隐藏、托盘、重载、正常退出均产生 0 次安装调用，单次用户点击产生 1 次，重复点击仍为 1 次；安装调用同步抛错恢复 error，再执行统一 Mini 门槛。
- [ ] B5：补齐中英文文案和 available/downloading/downloaded/error 四态视觉。下载中显示后台继续说明；downloaded 横幅持续提供恢复入口；error 保留重试。Mini 验证：开发态逐态截图与键盘操作检查；待安装截图保存为 `docs/plans/iter-v2-26/evidence/downloaded-awaiting-install.png`，再执行统一 Mini 门槛。

验收断言：用户点击“后台下载”后弹窗收起，聊天可继续；关闭弹窗或关闭主窗口隐藏到托盘不停止下载；横幅和托盘都能恢复详情；下载完成不自动安装，正常退出也不安装；只有用户点击“重启安装”才触发安装；彻底退出终止进程内下载。

### Plan C：下载量/差分可观测性

目标：把下载行为做成可观测——字节级 UI、结构化日志、`electron-updater` 原生日志留存与关联，并在开发态跑出一次真实下载留下可判定证据；没有证据时明确写“未确定”。**不做真实安装版旧→新升级验证**（老大 2026-09-08 确认暂缓）。

确定文件范围：

- 修改 `src/main/updater.ts`、`src/main/updater-state.ts`：记录下载开始/进度/完成/失败，字段包含 operationId、当前版本、目标版本、declaredInstallerSize、transferred、total、bytesPerSecond、elapsedMs；保留默认差分优先和完整回退，不设置任何禁用差分的选项。
- 修改 `src/shared/updater/types.ts`：下载数值允许 `null`，完成快照保留最后一次观测值。
- 新增 `src/renderer/src/components/updater/update-progress.ts`：纯格式化函数，统一字节、速度、耗时和未知值展示。
- 修改 `src/renderer/src/hooks/use-app-updater.ts`、`UpdateDialog.tsx`、`UpdateStatusBanner.tsx`：展示已下载/总量、速度、耗时；不显示无法可靠获知的“差分/完整”标签。
- 新增 `tests/updater-state/download-progress.ts`；修改 `package.json` 增加 `test:updater-progress`。
- 新增 `docs/plans/iter-v2-26/download-observability-report.md`：唯一可观测性证据报告。
- 修改已有 `docs/smoke-test-checklist.md`：新增自动更新可观测性专项，只记录开发态可复现的核验步骤，不含安装版升级步骤。
- 新增 `docs/plans/iter-v2-26/evidence/`：只保存脱敏后的截图和日志证据；不得提交凭据、完整用户路径或真实用户数据。
- 明确不新增：隔离 VM/Sandbox 构建脚本、NSIS 测试包版本号覆盖、本机临时 HTTP generic feed、`app-update.yml` 改写、用户数据哈希核验工具。

差分/完整判定规则：

- electron-updater 原生日志出现 `Full` 与 `To download`，且 `To download < Full`，才记为“差分下载证据成立”。
- 原生日志明确记录差分失败并回退，且实际传输接近声明安装包大小，才记为“完整回退证据成立”。
- 只有 transferred/total、耗时很短或疑似缓存命中而没有原生日志时，模式记为“未确定”；不得仅按比例猜测。
- 历史 0.2.24→0.2.25 固定记为“未确定”：本机无对应原生日志，且本迭代不复现该升级。

步骤清单：

- [ ] C1：实现字节级状态、结构化日志和格式化展示。进度按 operationId 关联且不倒退；total/速度未知时显示“未知”而非 0；完成日志保留最后观测值与声明包大小。Mini 验证：`npm run test:updater-progress` 覆盖 unknown、0 字节、单调性、重复/旧事件、elapsedMs 与格式化边界，再执行统一 Mini 门槛。
- [ ] C2：保留并核验 electron-updater 原生日志。每次下载的自有日志以 operationId、currentVersion、expectedVersion 关联原生 `[updater]` 输出；报告按上述规则判定 differential/full/unknown。Mini 验证：模拟 progress/complete/error 序列后检查结构化字段完整；源码断言 `autoDownload=false`、`autoInstallOnAppQuit=false` 且未设置禁用差分的选项，再执行统一 Mini 门槛。
- [ ] C3：完成自动验证与开发态交互证据。运行 `npm run test:updater-release-notes`、`npm run test:updater-state`、`npm run test:updater-progress`、三套 TypeScript、C# solution、`npm run build`、`git diff --check`；记录实际命令、退出码和截图。Mini 验证：全部命令退出码为 0，证据写入报告。
- [ ] C4：开发态真实下载取证。用 `dev-app-update.yml`（指向公开 GitHub Release）在开发态触发一次真实检查 + 下载，采集 UI 上的 transferred/total/bytesPerSecond/elapsedMs、Main 结构化日志，以及原生 `[updater]` 日志中的 `Full` / `To download`，按判定规则记为 differential/full/unknown。全程不安装、不重启：只点“稍后”，依赖 `autoInstallOnAppQuit=false`。
  - 版本障碍与做法：开发态 `app.getVersion()` 读 `package.json`，本地版本不低于线上 Release 时检查不到更新。允许**临时**把 `package.json` 版本降到低于线上 Release（如 `0.2.24`）后启动开发态触发真实下载；该临时改动只存在于工作区，取证完成后必须还原，**不得提交**。
  - 这一步顺带用原生日志回答“25 版为何几秒”的历史疑问，但它属于开发态可观测性取证，**不算**安装版旧→新升级验证，也不验证安装行为。
  - 若临时降版后仍无法完成真实下载（网络受限、Release 资产不可达等），在报告显式记“未取到真实下载证据”并说明原因，模式记 unknown，不得用模拟数据替代真实取证。
  - Mini 验证：报告中该次下载的 operationId、日志时间段、数值与截图证据齐全，`git diff` 确认 `package.json` 版本已还原，或“未取到证据”一项有明确原因。
- [ ] C5：完成唯一报告与清单。`download-observability-report.md` 固定包含：环境（开发态）、currentVersion、availableVersion、operationId、日志时间段、`Full`、`To download`、transferred/total、峰值与末次 bytesPerSecond、elapsedMs、declaredInstallerSize、differential/full/unknown 判定、证据路径、未取证项显式标记；历史 0.2.24→0.2.25 单列一行记为 unknown。`docs/smoke-test-checklist.md` 固化开发态复测步骤。Mini 验证：报告字段无空缺，未验证项显式标记，`git diff --check` 通过。

验收断言：UI、结构化日志和报告三者数值一致；total/速度未知时显示“未知”而非 0；进度按 operationId 关联且不倒退；差分失败回退不静默；历史 24→25 明确标为 unknown 而非猜测；开发态真实下载证据存在，或在报告中显式说明未取到及原因。安装版旧→新升级、安装期失败场景和升级前后用户数据核验**不在本 Plan 验收范围**，未做不得视为本 Plan 失败。

### Plan D：渠道会话按“特殊的 global 会话”统一工具可见性

对应待办：`bugs.md 2026-09-08 | 渠道会话 | 全局会话的渠道会话无法看到项目列表，需将项目相关工具开放给 channel`。

老大 2026-09-08 两次裁定：

1. 同类的“全局任务工具”**一起修**；
2. **“渠道会话就是特殊的 global”** —— 因此不按工具逐个追加 `"channel"` mode，而是在 mode 解析层把渠道会话归一为 `"global"`。

> 修法沿革：本 Plan 初版采用“改 10 处 `availableModes` 追加 `"channel"`”（下称修法 A），2026-09-08 老大裁定后改为“改 `ResolveAvailableMode` 一处，channel → global”（下称修法 B）。修法 A 只治已记录的那一个症状，且每新增一个应对渠道开放的工具都要记得多加一个字面量，不一致会复发；修法 B 修的是三层过滤中唯一没有落实“渠道 = 特殊 global”语义的那一层。**修法 A 已废弃，不得执行。**

目标：一次修好同一根因的三个症状——渠道会话能直接看到并调用 4 个项目工具、能经 `use_capability` 代理调用 6 个全局任务工具、6 个 `Plugin*` 渠道消息工具恢复可见；桌面全局会话与桌面项目会话的现有可见性一字不变。

#### 已核验的根因：三层过滤中第 2 层的 mode 解析没有落实“渠道 = 特殊 global”

第 1 层与第 3 层都已按“渠道是特殊 global”处理，只有第 2 层没有，导致前两层放行的工具被中间那道门丢弃：

1. **第 1 层 preset 分类**（`src/runtime/WishfulClaw.Core/Tools/ToolPreset.cs` + `ToolRegistry.GetToolDefinitions(preset, sessionMode)`，`src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs:215-236`）：
   - `channel` preset（`ToolPreset.cs:76-85`）的 `AllowedCategories`（`:82-83`）含 `"project"` 与 `"plugin"`，**不含** `"cron"`/`"desktop"`/`"team"`/`"skill-management"`/`"global-task"`。
   - preset 取自独立参数 `toolPreset`（`src/runtime/WishfulClaw.Agent/AgentLoop.cs:161-164`），**不由 `sessionMode` 推导**，因此修法 B 不影响第 1 层，渠道会话仍使用 `channel` preset。
   - `"global-task"` 不在任何 preset 中是**有意设计**：`src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityExecutor.cs:28-38` 注释明确“Tool categories that are NOT directly registered in chat/coding presets. Tools in these categories are accessible only via use_capability”，并把 `"global-task"`、`"project"`、`"task"` 等一并列入 `ProxiedCategories`。本 Plan **禁止**把 `"global-task"` 加进任何 preset。
2. **第 2 层 `availableModes` 匹配 —— 唯一缺陷**：`src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs:121-126` 在 `sessionMode == "channel"` 时已强制 `scope = "global"`，注释写着 “A channel is a specialized global session. Keep the global scope semantics while using a distinct available-mode/tool policy”，但同文件 `ResolveAvailableMode:164-182` 只做了 `agent|chat → normal` 的归一，随后 `:169-170` 在 `sessionMode.Length > 0` 时直接返回字面量 `"channel"`，**永远走不到** `:172-173` 的 `context.Scope == "global" → return "global"`。注释里 “using a **distinct** available-mode” 正是这半截设计的自我说明。于是第 2 层用 `"channel"` 去匹配各 Provider 的 `availableModes`（匹配逻辑 `ToolRegistry.cs:222-232`，`Array.IndexOf(modes, sessionMode) >= 0`）：
   - `src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs:17,30,43,58` 四个工具（`list_projects`、`get_project_details`、`create_session`、`send_session_message`）为 `new[] { "global" }` → 不匹配，丢弃；
   - `src/runtime/WishfulClaw.Agent/Tools/Providers/GlobalTaskToolsProvider.cs:33,51,77,93,114,138` 六个工具为 `new[] { "global" }` → 不匹配，丢弃；
   - `src/runtime/WishfulClaw.Agent/Tools/Providers/PluginToolProvider.cs:26,40,54,61,75,84` 六个工具（`PluginSendMessage`、`PluginReplyMessage`、`PluginGetGroupMessages`、`PluginListGroups`、`PluginSummarizeGroup`、`PluginGetCurrentChatMessages`）为 `["normal","goal","global"]` → 不匹配，丢弃。
   - 代理路径被同一道门挡住，且**共有三道 gate**（第三轮复审补全）：`call` 在 `AgentRuntimeUseCapabilityExecutor.cs:316-321`、`list` 在 `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityDiscovery.cs:150-152`、`inspect` 在 `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityEncoding.cs:128-130`，三处都调用 `registry.IsAvailableInMode(toolName, sessionMode)`（实现 `ToolRegistry.cs:87-98`）并叠加 `IsProxiedBuiltinTool` + `IsToolAllowed`。所以修好 mode 解析，直接调用与三条代理路径同时恢复。
3. **第 3 层 白名单**（`AgentRunContextPolicy.IsToolAllowed:190-213`）：已正确放行，无需改动，且**反证第 2 层是缺陷而非设计**——
   - `Resolve:125` 把渠道会话 `scope` 归一为 `"global"`，`:140-143` 把 `collaborationMode` 强制为 `"chat"`，因此白名单取 `GlobalChatTools`（`:209-212`）；
   - `GlobalChatTools:96-109` 与其基集 `SharedChatTools:55-85` 已列出 4 个项目工具与全部 6 个全局任务工具；
   - `ChannelOnlyTools:29-53` 已逐字列出上述 6 个 `Plugin*` 工具，且 `:200-201` 对 `channelSession == true` 直接 `return true`。
   - 即：第 3 层专门为渠道会话开了白名单，第 2 层又把它们挡在门外，**代码自相矛盾**。这是本轮新发现的第三个症状，Obsidian 待办里未记录。

渠道会话的 `sessionMode` 字面量来源已核验为两处，均为 `'channel'`：`src/renderer/src/hooks/use-channel-auto-reply.ts:276`、`src/renderer/src/hooks/use-chat-actions.ts:251`（`isChannelSession ? 'channel' as const : opts?.sessionMode`），类型声明在 `src/renderer/src/lib/ipc/sidecar-mapping.ts:234`、透传在 `:337`。修法 B 在 Worker 侧统一归一，两处入口同时生效，**Renderer 不需改动**。

另注：桌面项目列表走的是独立 RPC `db/projects-list`（`db-helpers.ts:588` → `DbModule.cs:26`），与 Agent 工具无关，本 Plan 不涉及 IPC 改动。

#### 已排除的伪风险：归一化不幂等（老大 2026-09-08 裁定不成立）

第三轮复审曾判 ❌：`NormalizeRuntimeParameters`（`AgentLoop.Helpers.cs:117-160`）在 `omitProjectContext == true` 时删掉 `projectId`/`workingFolder`/`sshConnectionId`，却把 `scope` 原样保留，产出不幂等；若渠道会话带 `scope:"project"`，修法 B 会让第二次 `Resolve` 落到 `AgentRunContextPolicy.cs:134-136` 抛 `scope=project requires projectId`。

**老大裁定：全局会话与渠道会话本质上都是全局会话，不会绑定项目，该前提不成立。** 代码侧已核实支持这一裁定：

- `src/main/channels/auto-reply.ts:177` 向 `db/plugin-route-session` **硬编码** `projectId: null`，`DbPluginSessionRouting.cs:42-47` 因此永远得到 `project == null`，新建渠道会话的 `scope` 恒为 `"global"`、`project_id`/`working_folder`/`ssh_connection_id` 恒为 NULL（`:67-74`、`:93-95`）；
- `routedSession.workingFolder` 恒为 null → `auto-reply.ts:261` 的 `workingFolder: pluginWorkDir || undefined` 恒为 `undefined`；
- 唯一能给渠道会话写上 `project_id` 的 `SyncPluginSessionProject`（`DbPluginSessionTools.cs:60-84`，RPC `db/plugin-sync-session-project`）在渲染端**没有任何调用方**，只出现在 `messagepack-channel-routing.ts:256` 的路由白名单里；
- 故 `use-channel-auto-reply.ts:143` 的 `task.projectId ? 'project' : 'global'` 恒走 `'global'` 分支，`:272` 恒发 `projectId: undefined`。

**结论：Plan D 回到单文件改法，不动 `AgentLoop.Helpers.cs`。** 归一化不幂等本身仍是既有瑕疵，但在渠道路径不可触发，且按“不为不可能发生的场景加防御”的约定不顺手修，记入迭代收尾待办备查。

#### 附带影响：`sessionMode` 消费点已全量清点

修法 B 改变的是 `ResolveAvailableMode` 的返回值，且 `AgentLoop.cs:150-153` 会经 `NormalizeRuntimeParameters`（`src/runtime/WishfulClaw.Agent/AgentLoop.Helpers.cs:117-160`，`:140-143` 覆盖既有 `sessionMode`、`:151-153` 在缺失时补写）+ `state.ReplaceParameters` 把归一结果写回 parameters，因此**所有下游读到的都是 `"global"`**，包括 `AgentLoop.cs:165-166` 的第二次 `Resolve`/`ResolveAvailableMode`（幂等）。逐个消费点核验：

| 消费点 | 读什么 | 影响 |
|---|---|---|
| `AgentLoop.cs:56-63` | `:56` 读**归一化之前**的原始 `parameters`（`JsonHelpers.GetString(parameters, "sessionMode")`），`:57-58` 用 `StringComparison.Ordinal` 比对 `"subAgent"`/`"goalSubAgent"` 决定 conversationKey | 无影响：归一化发生在 `:150-153`，晚于 `:56`，故本行读到的永远是调用方原值；渠道会话仍按 `sessionId` 建会话状态，不与全局会话串流 |
| `AgentLoop.cs:161-164` | 独立参数 `toolPreset` | 无影响，仍用 `channel` preset，第 1 层不变 |
| `AgentLoop.cs:166`、`src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:117` | 第 2 层 mode 匹配与运行时复检（`:150-157`） | **目标效果**：三个症状同时修好 |
| `AgentRuntimeUseCapabilityExecutor.cs:127`、`AgentRuntimeUseCapabilityDiscovery.cs:150-152`、`AgentRuntimeUseCapabilityEncoding.cs:128-130` | 三条代理 gate（call / list / inspect）的 `IsAvailableInMode` | **目标效果**：代理路径恢复 |
| `AgentLoop.cs:203-213` | `:204-206` `SystemPromptCache.ComputeKey(..., sessionMode, pluginId, externalChatId)`；`:209` `includeSessionTodoPrompt = sessionMode != "global"` | **缓存键一次性变化（无害）**：渠道会话的 system prompt 缓存键随 `sessionMode` 由 `"channel"` 变 `"global"` 而改变，首次请求 miss 一次；`:205-206` 已把 `pluginId`/`externalChatId` 计入键，渠道会话与桌面全局会话不会撞键。**行为变更（有意，第三轮复审补录）**：归一后 `includeSessionTodoPrompt` 为 `false`，渠道会话不再注入 `<session_todo>` 段。与 `:208` 既有注释“the global agent host opts out”语义一致——渠道会话的编排由新增的 `<global_agent>` 段描述，`<session_todo>` 属于普通会话 Agent 的指引 |
| `src/runtime/WishfulClaw.Persona/PromptBuilder.cs:67-78` | `sessionMode == "goal"` / `== "global"` 注入对应 prompt | **行为变更（有意）**：渠道会话新增 `BuildGlobalAgentPrompt()`（`:410-428`）注入。该 prompt 内容是“跨项目全局产品经理助手 + 全局任务工具走 `use_capability` 代理 + 6 个工具名 + 派发/回复工作流”，与已归一的 `scope = "global"`、已放行的 `GlobalChatTools` 完全一致；渠道会话此前拿不到它，Agent 不知道代理工作流存在，这是“无法看到项目列表”表现为完全无从下手的直接原因 |
| `PromptBuilder.cs:61` + `:310-314` | 本地 `IsChannelSession`，基于 `channelSession`/`pluginId`/`externalChatId`/`pluginChatId`，**不读 sessionMode** | 无影响，`BuildChannelSessionPrompt`（`:316` 起）继续注入，渠道专属约束（纯文本回复、不依赖 widget/桌面弹窗）不丢 |
| `ToolCallProcessor.cs:563` + `:589-593` | 本地 `IsChannelSession`，同样不读 sessionMode | 无影响，渠道文件工具特判保留 |
| `src/runtime/WishfulClaw.Agent/AgentLoop.MemoryRecall.cs:41` | 只调 `Resolve`（取 scope） | 无影响，`Resolve` 未改 |
| 写入方 `AgentRuntimeGlobalDispatchReplyExecutor.cs:132`、`src/runtime/WishfulClaw.Agent/Goal/GoalSubAgentExecutor.cs:101`、`src/runtime/WishfulClaw.Agent/SubAgentExecutor.Parameters.cs:77` | 自行写死 `"global"`/`"goalSubAgent"`/透传值 | 无影响，均非渠道路径 |

**不会过度暴露**：`cron`（6 工具）、`desktop`（5）、`team`（4）、`skill-management`（1）的 `availableModes` 含 `"global"`，第 2 层归一后会通过；`skill-management` 的 `list_installed_skills` 还在 `SharedChatTools:79` 里，第 3 层也放行。但这些分类**不在** `channel` preset 的 `AllowedCategories` 中，第 1 层先丢弃，因此渠道会话不会新获得定时任务、桌面控制、团队或技能管理工具。D2 用断言把这条钉死；若断言失败说明第 1 层被意外放宽，必须回退改动而不是改断言。

`src/runtime/WishfulClaw.Agent/Tools/Providers/ChannelPluginToolProvider.cs` 16 处 `availableModes: ["normal","goal","global","channel"]` 中的 `"channel"` 字面量在归一后不再可能被匹配，成为死条目；因 `"global"` 仍在列表中，行为不变。**本 Plan 不清理**，避免 16 行零行为变更的 diff 噪音，记入迭代收尾待办。

#### 确定文件范围

- 修改 `src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs`：**唯一的生产代码改动点**。在 `ResolveAvailableMode`（`:164-182`）的 `agent|chat → normal` 归一（`:167-168`）之后、`sessionMode.Length > 0` 直接返回（`:169-170`）之前，插入 `channel → "global"` 归一；并把 `Resolve:123-124` 那句失真的 “while using a distinct available-mode/tool policy” 注释改为与实现一致的描述（渠道会话沿用 global 的 available-mode，工具策略差异仍由 `channelSession` 布尔 + `ChannelOnlyTools`/`ChannelExcludedTools` 承担）。
- 新增 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/WishfulClaw.ChannelToolVisibilityRegressionTests.csproj`：按 `tests/WishfulClaw.ToolConcurrencyRegressionTests/WishfulClaw.ToolConcurrencyRegressionTests.csproj` 同构（`net11.0`、`OutputType=Exe`、`ImplicitUsings`/`Nullable` enable、只 `ProjectReference` 到 `..\..\src\runtime\WishfulClaw.Agent\WishfulClaw.Agent.csproj`）。
- 新增 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs`：`public static async Task<int> Main()` 返回 `0/1`，参照 `tests/WishfulClaw.ToolConcurrencyRegressionTests/Program.cs:13-27` 的 try/catch 结构；用 `new ToolRegistry()` + `PushCategory(provider.Category)` / `RegisterTools` / `PopCategory()`（与 `src/runtime/WishfulClaw.Agent/Tools/ToolModule.cs` 同一注册顺序）自建注册表。
- 修改 `src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj`：在既有 `:18-20` 三条 `InternalsVisibleTo` 后追加 `WishfulClaw.ChannelToolVisibilityRegressionTests`（`AgentRunContextPolicy` 与 `AgentRunContext` 均为 `internal`，测试需要它们做第 2/3 层断言）。
- 修改 `src/runtime/WishfulClaw.sln`：登记新测试项目，路径写法与既有 `..\..\tests\...` 条目一致，使 `dotnet build src/runtime/WishfulClaw.sln` 覆盖其编译。
- 新增 `docs/plans/iter-v2-26/evidence/channel-project-tools.png`：渠道会话中项目工具真实可见/可调的脱敏截图。
- **明确不修改**：`ProjectToolsProvider.cs`、`GlobalTaskToolsProvider.cs`、`PluginToolProvider.cs`、`ChannelPluginToolProvider.cs`（四者 `availableModes` **一行不动**）、`src/runtime/WishfulClaw.Core/Tools/ToolPreset.cs`（不把 `global-task` 加进任何 preset，不改 `channel` preset 的 `AllowedCategories`）、`src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs`（其 `GetToolDefinitions` 大小写敏感的 `Array.IndexOf`（`:222-232`）与 `IsAvailableInMode` 的 `OrdinalIgnoreCase`（`:87-98`）不一致是既有隐患；已核验到一个具体受害者：`GoalToolProvider.cs:117` 的 `update_goal_progress` 声明 `availableModes: ["subAgent"]`，而 `ResolveAvailableMode:169-170` 经 `Normalize:238` 返回小写 `"subagent"`，大小写敏感匹配不上 → 该工具在子 Agent 的工具定义列表中静默缺失（`GoalPromptTemplates.cs:163` 的提示语写成 “If the update_goal_progress tool is available” 恰好兜住了它，故未暴露）。**本 Plan 不修**，记入迭代收尾待办，与 Plan D 无因果关系）、`ToolCallProcessor.cs`、`AgentRuntimeUseCapabilityExecutor.cs`、`AgentRuntimeUseCapabilityDiscovery.cs`、`AgentRuntimeUseCapabilityEncoding.cs`（三道代理 gate 一处不动，只靠上游 mode 归一恢复）、`PromptBuilder.cs`（prompt 变更是 `ResolveAvailableMode` 的自然结果，**不得**在 PromptBuilder 里加 channel 分叉去屏蔽它）、`ToolModule.cs`、`GlobalDispatchReplyToolProvider.cs`（其 `["normal","goal"]` 是被派发方项目会话用的回复工具，语义不同）、`AgentLoop.cs`、`AgentLoop.Helpers.cs`（归一化不幂等属既有瑕疵，渠道路径不可触发，见“已排除的伪风险”一节）、Renderer 全部文件、`package.json`（既有 C# 回归测试均无 npm 脚本，沿用 `dotnet run` 约定）。

#### 跨 Plan 硬契约

- 生产代码改动只允许落在 `AgentRunContextPolicy.cs` 的 `ResolveAvailableMode` 与其紧邻注释；**任何 Provider 的 `availableModes` 都不得出现在 diff 中**。这是修法 B 与已废弃的修法 A 的分界，D1 用 `git diff --stat` + grep 双重钉死。
- `AgentRunContextPolicy.IsChannelSession:184-188` 的判定必须保持不变：渠道专属行为（`ChannelOnlyTools` 直通、`ChannelExcludedTools` 排除、渠道文件工具特判、渠道 prompt）全部依赖它，**不得改为依赖 `sessionMode`**——归一后 `sessionMode` 已无法区分渠道与桌面全局会话。
- 项目工具与 `Plugin*` 工具在渠道会话中**直接可见**（`project`、`plugin` 已在 `channel` preset 中），全局任务工具在渠道会话中**只经 `use_capability` 代理可见**（保持 `ProxiedCategories` 设计）。这个差异是预期结果，不得为了“统一”而把 `global-task` 塞进 preset。
- 渠道会话**不得**新获得 `cron`/`desktop`/`team`/`skill-management` 工具；这条由第 1 层 `channel` preset 保证，D2 必须有对应断言。
- 渠道会话**必须**同时保留 `<channel_session>` 与新增的 `<global_agent>` 两段 prompt，缺任一段都算失败。
- 渠道会话**不再**注入 `<session_todo>` 是第三个有意的行为变更（`AgentLoop.cs:209`）。**禁止**为此在 `:209` 加 channel 分叉或把 `includeSessionTodoPrompt` 改回 `true`——那等于在 `AgentLoop.cs` 里再造一处“渠道 ≠ global”的判定，与老大裁定相反。若 D3 实机观察到缺 `<session_todo>` 造成实际功能损失，处理方式是回到规划态重新裁定，不是就地打补丁。
- 不得为了让工具通过而放宽 `AgentRunContextPolicy` 的白名单或 `ToolCallProcessor` 的运行时复查。
- AOT：本 Plan 不引入反射、不引入匿名类型 JSON、不新增序列化类型，因此不需要改任何 `JsonSerializerContext`；仍须满足 `dotnet build` 0 错误 + AOT 0 警告（`DOTNET_ROOT` 指向 `D:\claw\dotnet-sdk`）。

步骤清单：

- [ ] D1：在 `AgentRunContextPolicy.ResolveAvailableMode` 中把 `channel` 归一为 `global`，并同步修正 `Resolve:123-124` 的失真注释。Mini 验证：
  - `dotnet build src/runtime/WishfulClaw.sln` 0 错误 0 新增警告、AOT 0 警告（`DOTNET_ROOT=D:\claw\dotnet-sdk`）；三套 `tsc --noEmit -p`（本步不改 TS，仍按门槛执行）；`git diff --check`；
  - `git diff --stat` 中生产代码**只有** `src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs` 一个文件；
  - **四个 Provider 的 `availableModes` 一行未改**：`grep -rc 'availableModes'` 对 `ProjectToolsProvider.cs`/`GlobalTaskToolsProvider.cs`/`PluginToolProvider.cs`/`ChannelPluginToolProvider.cs` 分别输出 `4`/`6`/`6`/`16`（合计 32，与改动前实测基线一致），且 `git diff --name-only` 中不含这四个文件；
  - `grep -c '"channel"' src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs` 由改动前的 `1`（仅 `Resolve:121`）变为 `2`，新增的一处位于 `ResolveAvailableMode` 内。
- [ ] D2：新增回归测试项目并登记 `InternalsVisibleTo` 与 sln。断言至少覆盖：
  - **归一本身**：以 `{"sessionMode":"channel","channelSession":true,"pluginId":"feishu","externalChatId":"oc_test"}` 构造 parameters，`AgentRunContextPolicy.Resolve(...)` 的 `Scope == "global"`、`CollaborationMode == "chat"`，`ResolveAvailableMode(...)` 返回 `"global"`；`IsChannelSession(...)` 仍为 `true`（渠道判定未被归一破坏）；
  - **症状 1 项目工具直接可见**：`GetToolDefinitions(ToolPreset.BuiltIn["channel"], "global")` 含 `list_projects`、`get_project_details`、`create_session`、`send_session_message`；
  - **症状 3 Plugin 工具恢复可见**：同一调用结果含 `PluginSendMessage`、`PluginReplyMessage`、`PluginGetGroupMessages`、`PluginListGroups`、`PluginSummarizeGroup`、`PluginGetCurrentChatMessages`；
  - **症状 2 全局任务工具只经代理**：同一调用结果**不含** `create_global_task`、`list_global_tasks`、`update_global_task`、`list_global_dispatches`、`update_dispatch`、`send_work_request`（第 1 层 `channel` preset 拦直接可见性）；但 `IsAvailableInMode(name, "global")` 对这 6 个均为 `true`（第 2 层已放行，故代理路径可用）；
  - **不过度暴露**：同一调用结果**不含** `CronAdd`、`CronCreate`、`CronUpdate`、`DesktopScreenshot`、`DesktopClick`、`DesktopType`、`TeamCreate`、`TeamStatus`、`TeamDelete`、`list_installed_skills`；
  - **桌面全局/项目会话的 mode 解析不回归**（替换原“`GetToolDefinitions(chat, "global")` 逐项相等”断言：该调用**根本不经过** `ResolveAvailableMode`，拿它当基线对本改动零检出力）——直接断言 `ResolveAvailableMode`：
    - `{"sessionMode":"global"}` + `scope:"global"` → `"global"`；
    - 无 `sessionMode` + `scope:"global"` → `"global"`（走 `:172-173` 分支，该分支今天就是桌面全局会话的实际路径，不得被新增的 channel 归一挡在前面）；
    - `{"sessionMode":"agent"}` + `scope:"project"` + projectId → `"normal"`；
    - 无 `sessionMode` + `scope:"project"` + projectId → `"normal"`（`RuntimeRole` 为空时的 `_ =>` 分支）；
  - **桌面项目会话不放宽**：`IsAvailableInMode("list_projects", "normal")` 为 `false`；
  - **其他 mode 归一不受影响**：`ResolveAvailableMode` 对 `{"sessionMode":"goal"}` 返回 `"goal"`、`{"sessionMode":"agent"}` 返回 `"normal"`、`{"sessionMode":"chat"}` 返回 `"normal"`、`{"sessionMode":"global"}` 返回 `"global"`、`{"sessionMode":"subAgent"}` 返回 **`"subagent"`**（全小写——`Normalize:238` 先 `ToLowerInvariant`，`:169-170` 返回的是归一后的值。第三轮复审 ⚠️ 指出原断言写 `"subAgent"` 是错的；这条顺带把“既有大小写敏感匹配”隐患钉在测试里，若日后有人去改 `ToolRegistry` 的大小写行为，这条断言会先响）；
  - **第 3 层放行**：`IsToolAllowed(runContext, name, category, channelSession: true)` 对 4 个项目工具 + 6 个全局任务工具 + 6 个 `Plugin*` 工具共 16 个均为 `true`；对 `visualize_show_widget`、`AskUserQuestion`、`ExitPlanMode` 均为 `false`（`ChannelExcludedTools` 仍生效）；
  - **第 2/3 层联合**：`FilterToolDefinitions(GetToolDefinitions(ToolPreset.BuiltIn["channel"], "global"), registry, runContext, channelSession: true)` 的结果含 4 个项目工具与 6 个 `Plugin*` 工具、不含 6 个全局任务工具与上述 10 个过度暴露代表工具——这是 Agent 实际拿到的工具集，为最终断言。
  Mini 验证：`dotnet run --project tests/WishfulClaw.ChannelToolVisibilityRegressionTests -c Debug` 退出码 0；`dotnet build src/runtime/WishfulClaw.sln` 0 错误；`git diff --check`。
- [ ] D3：开发态实机取证。启动开发态，进入一个渠道会话：① 让 Agent 列出可用项目并读取其中一个项目的会话；② 用 `use_capability` 的 `list` 确认 `builtin:list_global_tasks` 出现在能力清单中，并成功 `inspect` 与 `call` 各一次（`inspect` 走第三道 gate `AgentRuntimeUseCapabilityEncoding.cs:128-130`，必须实测，不能只验 `call`）；③ 确认 `Plugin*` 渠道消息工具在工具列表中可见；④ 确认该次请求的 System Prompt 同时含 `<channel_session>` 与 `<global_agent>` 两段（从 `request_debug` 事件或当天日志核验）。全程不得出现 “is not available through the capability proxy in this session mode” 或 “tool not found”。截图存为 `docs/plans/iter-v2-26/evidence/channel-project-tools.png`（须脱敏：不含真实聊天内容、真实 chatId、凭据），并核验桌面全局会话与桌面项目会话各一次，确认工具可见性与改动前一致，且桌面全局会话的 prompt 仍含 `<global_agent>`、桌面项目会话的 prompt 仍**不含** `<global_agent>` 与 `<channel_session>`。Mini 验证：统一 Mini 门槛 + 截图存在且已脱敏 + 当天日志 `~/.wishful-claw/logs/<date>.log` 中无新增 `[ERROR]`。

验收断言：渠道会话能直接调用 4 个项目工具与 6 个 `Plugin*` 工具；能经 `use_capability` 的 `list`/`inspect`/`call` 三条 gate 调用 6 个全局任务工具；渠道会话**未**获得 `cron`/`desktop`/`team`/`skill-management` 工具；`global-task` 仍不在任何 preset 中；四个 Provider 的 `availableModes` 一行未改；生产代码 diff 只有 `AgentRunContextPolicy.cs` 一个文件；桌面全局会话与桌面项目会话的工具可见性与 prompt 均无变化；渠道会话 prompt 同时含 `<channel_session>` 与 `<global_agent>`、不再含 `<session_todo>`；渠道专属行为（`ChannelExcludedTools` 排除、渠道文件工具特判、`IsChannelSession` 判定依据）仍生效；回归测试退出码 0；实机截图与日志证据齐全。

### Plan E：飞书扫码绑定后自动启用并启动

对应待办：`bugs.md 2026-09-08 | 飞书绑定 | 飞书扫码绑定后未自动启用，需用户手动点击启用`。

目标：飞书扫码绑定成功后，渠道与微信绑定路径行为一致——自动写入凭据、自动 `enabled`、自动置 `features.autoStart`、自动调用 `startChannel`，用户无需再手动点“启用”；保存或启动失败必须显式报错，不得呈现为成功。

已核验的根因（同一文件内微信与飞书两条成功路径不对等）：

- 微信成功路径 `src/renderer/src/components/settings/plugin-panel-qr.tsx:125-165`：patch 含 `enabled: true` 与 `features: { autoReply, streamingReply, autoStart: true }` → `await updateChannel(...)` **检查返回值并在失败时 throw** → `await startChannel(channel.id)` **同样检查返回值并 throw** → 状态文案“绑定成功，渠道已启动!”；依赖数组 `:191` 为 `[channel, t, updateChannel, startChannel, cleanup]`。
- 飞书成功路径 `plugin-panel-qr.tsx:245-261`：只 `await updateChannel(channel.id, { config: {...}, enabled: true })`（`:251-258`），**返回值未检查**；**没有 `startChannel` 调用**；**没有 `features.autoStart`**；并且 `cleanup()`、`setLoginStatus('connected')`、`setStatusMessage(...)` 发生在 `await` **之前**（`:247-249`），保存失败时界面已先显示“飞书授权成功!”。`toast.success` 位于 `:259`，确实在 `await` 之后——但因为下面的 catch 会吞掉异常，这个 toast 在失败时既不会出现、也不会报错。
- **吞异常的轮询 catch（本次修订新增核验，是 E1 必须一并改造的点）**：`plugin-panel-qr.tsx:273-275` 是一个裸 `catch {}`，捕获整个 poll 函数体内的**任何**异常后只做 `setTimeout(() => void poll(), pollInterval)` 静默重排。因此一旦 `updateChannel`（或将来加入的 `startChannel`）抛错，代码不会走到外层 `:279-282` 的错误呈现分支，而是**无限重新轮询**，同时界面停留在 `:248-249` 设置的成功状态——用户看到“授权成功”但渠道永远没启用，且没有任何错误提示。这正是“需用户手动点击启用”的第二个成因，必须与缺失的 `startChannel` 一起修，否则加了 `startChannel` 也只是把失败换成静默死循环。
- 依赖数组 `plugin-panel-qr.tsx:283` 为 `[channel, t, updateChannel, cleanup]`，缺 `startChannel`。
- 注释与代码矛盾：`src/main/channels/providers/feishu/feishu-install.ts` 头部注释宣称第 5 步“Save credentials to channel config, enable channel”，但 `pollFeishuInstall`（`:192-250`）只返回 `{done, status:'connected', appId, appSecret, domain, userId}`，既不落盘也不启用。持久化与启用一直是 Renderer 的职责，注释会误导后续排查。
- IPC 与 store 无需改动：`src/main/ipc/channel-handlers/channel-feishu-handlers.ts:319-331` 已注册 `plugin:feishu:install-start` / `plugin:feishu:install-poll`；`src/renderer/src/stores/channel-store.ts:18` 已有 `autoStart: boolean`，`:66`、`:133` 已有 `startChannel`。

确定文件范围：

- 修改 `src/renderer/src/components/settings/plugin-panel-qr.tsx`：把飞书成功路径（`:245-261`）对齐微信成功路径（`:125-165`）的六个动作——① patch 增加 `features: { ...channel.features, autoStart: true }`（保留该渠道已有 feature 开关，不得整对象覆盖丢失其他字段）与 `enabled: true`；② 检查 `updateChannel` 返回值，失败 `throw`；③ `await startChannel(channel.id)` 并检查返回值，失败 `throw`；④ 把 `cleanup()`、`setLoginStatus('connected')`、成功状态文案与 `toast.success` 全部移到两个 await 都成功**之后**；⑤ **改造 `:273-275` 的裸 `catch {}`**，使凭据保存/启动阶段的异常不再被静默重排为下一次轮询——把成功分支的保存+启动包在自己的 `try/catch` 中，捕获后 `cleanup()`、`setLoginStatus('error')`、`setStatusMessage(错误信息)` 并 `return`，**不得**再 `setTimeout` 重排；轮询 IPC 本身（`invoke` 失败）仍可保留原有静默重试语义，两者必须区分开；⑥ 依赖数组 `:283` 补 `startChannel`。不得用 `@ts-ignore` 或 eslint 注释绕过 `react-hooks/exhaustive-deps`。
- 修改 `src/main/channels/providers/feishu/feishu-install.ts`：**只改头部注释**，把第 5 步描述修正为“返回凭据给 Renderer，由 Renderer 负责写入渠道配置、启用并启动”，不改任何运行时行为。
- 视需要修改 `src/renderer/src/locales/zh/settings.json`、`src/renderer/src/locales/en/settings.json`：若飞书成功文案需从“已连接”改为与微信一致的“绑定成功，渠道已启动”，以及需要新增保存/启动失败的错误文案，则补齐中英文；已有可复用键（如微信路径使用的键）优先复用，不新增重复键。
- 新增 `docs/plans/iter-v2-26/evidence/feishu-bind-autostart.png`：飞书扫码绑定后渠道处于已启用且已启动状态的脱敏截图。
- **明确不修改**：微信成功路径（`:125-165`）与其依赖数组、`feishu-install.ts` 的运行时逻辑与返回结构、`src/main/ipc/channel-handlers/channel-feishu-handlers.ts`、`src/renderer/src/stores/channel-store.ts`、任何 C# 文件、`src/preload/*`。不新增“绑定即发测试消息”之类的额外行为。

跨 Plan 硬契约：

- 绑定成功后渠道必须同时满足 `enabled === true` 与 `features.autoStart === true`，且实际处于运行态；三者缺一即视为失败并报错。
- 成功状态与成功 toast 只能在持久化与启动都成功之后出现；任何一步失败都必须让用户看到失败，不得静默成功。
- 保存或启动失败必须**终止轮询**并进入 `error` 状态；不得保留“失败后继续无限重新轮询”的现有语义。轮询 IPC 调用本身的瞬时失败仍可静默重试——两类异常必须走不同分支。
- 飞书与微信的成功路径行为必须对等；不得为了改飞书而改动微信路径。

步骤清单：

- [ ] E1：改 `plugin-panel-qr.tsx` 飞书成功路径的六个动作（含 `:273-275` 裸 catch 的改造）与依赖数组。Mini 验证：三套 `tsc --noEmit -p` 0 错误（依赖数组缺项由 `react-hooks/exhaustive-deps` 暴露，不得用 `@ts-ignore` 或 eslint 注释绕过）；`dotnet build src/runtime/WishfulClaw.sln` 0 错误；`git diff --check`；`grep -n "startChannel" src/renderer/src/components/settings/plugin-panel-qr.tsx` 确认飞书分支内出现调用且 `:283` 依赖数组含该项；`grep -c "catch {" src/renderer/src/components/settings/plugin-panel-qr.tsx` 结果为 0（裸 catch 已被替换为具名捕获 + 错误呈现）；人工复核 diff 确认保存/启动失败分支中出现 `setLoginStatus('error')` 且**没有** `setTimeout(... poll ...)` 重排。
- [ ] E2：修正 `feishu-install.ts` 头部注释与代码的矛盾，并核对/补齐中英文文案。Mini 验证：三套 `tsc --noEmit -p` 0 错误；`git diff --check`；确认 `pollFeishuInstall` 返回结构与运行时逻辑 0 改动（`git diff` 中该文件只出现注释行变更）。
- [ ] E3：开发态实机取证（**需老大配合真实飞书扫码**）。走完扫码绑定，确认：绑定成功后无需任何手动点击，渠道列表里该渠道即为已启用且运行中；重启应用后仍自动启动（验证 `features.autoStart` 真的落盘）。再构造一次失败分支（例如绑定后立即断网或在保存前把渠道删掉），确认界面显示失败而非成功。截图存为 `docs/plans/iter-v2-26/evidence/feishu-bind-autostart.png`。Mini 验证：统一 Mini 门槛 + 截图存在 + 当天日志无新增 `[ERROR]`（失败分支产生的预期错误须在报告中说明）。

验收断言：飞书扫码绑定成功后渠道自动 `enabled` + `autoStart` + 已启动，用户无需手动点启用；重启后仍自动启动；保存或启动失败时界面明确报错，不出现假成功；微信路径行为与代码 0 变化；实机截图与日志证据齐全。

> E3 依赖真实飞书账号扫码，Agent 无法独立完成。若老大当次不便配合，E3 记为“待用户验证”，不得以代码走查或模拟数据冒充实机取证。

### Plan F：同步 OpenCowork 最新内置服务商列表（17 个）

对应待办：`改进.md 2026-09-08 | 服务商 | 同步OpenCowork最新内置AI服务商列表`。老大 2026-09-08 裁定：**只搬 17 个可用的，排除 `vertex-ai` 与 `routin-ai`**。

目标：把 OpenCowork 有而 Wishful Claw 没有的内置服务商预设补齐到 17 个，用户在服务商面板能选到它们并正常发起对话；不引入 Wishful Claw 尚不存在的类型与机制。

已核验的现状：

- 预设目录差集：Wishful Claw 现有 20 个（anthropic、azure-openai、baidu、bigmodel、codex-oauth、copilot-oauth、deepseek、gitee-ai、google、longcat、minimax、moonshot、ollama、openai、openrouter、qwen、siliconflow、volcengine、x-ai、xiaomi）；OpenCowork 有 39 个。缺失 19 个，Wishful Claw 没有 OpenCowork 缺失的预设。
- 排除项及理由：
  - `vertex-ai`：`D:\claw\OpenCowork\src\renderer\src\stores\providers\vertex-ai.ts:4,7,9` 声明 `type: 'vertex-ai'`，但 Wishful Claw 的 C# 侧只有 `AnthropicMessagesProvider`、`OpenAIChatProvider`、`OpenAIResponsesProvider` 三个运行时，分派逻辑（`AgentLoop.cs:533-541`，另见 `ProviderCompletionService.cs:155,307`、`ProviderTestService.cs:135,161,222`）只认 `anthropic` / `openai-responses` / 其余走 openai-chat，**没有 Gemini/Vertex 运行时**。搬进来会落到 openai-chat 分支且 baseUrl 是占位符 `YOUR_PROJECT`，属于上线即死代码。
  - `routin-ai`：使用了 `offPeakInputPrice`、`offPeakOutputPrice`、`offPeakCacheCreationPrice`、`offPeakCacheHitPrice`、`pricingSchedule`、`supportsWebsocket` 等字段，Wishful Claw 的 `AIModelConfig` 完全没有这些类型。搬入需要先扩类型与计价/展示链路，超出本迭代。
  - 其余 17 个逐文件核查后**没有**用到 Wishful Claw 缺失的字段，可直接搬入：cerebras、fireworks、groq、huggingface、hunyuan、infini、lmstudio、meta、mistral、modelscope、novita、nvidia、opencode、opencode-go、ppio、stepfun、together。
- 类型已对齐，无需扩：`src/shared/types/provider.ts` 的 `BuiltinProviderPreset`（`:351-387`）与 OpenCowork 逐字段一致；`ProviderType`（`:11-19`）已含 `openai-responses`；`ReasoningEffortLevel`（`:29-37`）已含全部 8 个取值。
- 模型级 `type` 不参与分派：C# 只看 **preset 级** `type`。例如 `opencode-go.ts` 里有模型标 `type:'openai-responses'`（grok-4.5、muse-spark-1.2-contributor、gpt-5.6-luna）和 `type:'anthropic'`（minimax-m3/m2.7/m2.5、qwen3.8-max/3.7-max/3.7-plus/3.6-plus），但 preset 级是 `openai-chat`，因此全部走 `OpenAIChatProvider`。搬入时**原样保留**这些模型级 type，不要为了“一致”去改。
- OpenCowork 的 `providers/index.ts` 有 184 行，含 Wishful Claw 没有的机制：`applyGptLongContextDefaults`（依赖 `shared/gpt-context`，该文件在 Wishful Claw 不存在）、`applyServerToolCapabilityDefaults`、`BUILTIN_SEARCH_CAPABLE_PRESETS`、`IMAGE_GENERATION_CAPABLE_PRESETS`。**不搬这些机制**，只按 Wishful Claw 现有 52 行 `index.ts` 的结构追加注册。
- 本地 OpenCowork 副本 `D:\claw\OpenCowork` 已约 8 天未更新，“最新”需要先确认副本新鲜度。

确定文件范围：

- 新增 17 个 `src/renderer/src/stores/providers/<builtinId>.ts`：cerebras、fireworks、groq、huggingface、hunyuan、infini、lmstudio、meta、mistral、modelscope、novita、nvidia、opencode、opencode-go、ppio、stepfun、together。内容以 OpenCowork 对应文件为准，保留其 `builtinId`、`version`、`name`、`type`、`defaultBaseUrl`、`homepage`、`apiKeyUrl`、`defaultModel`、`defaultModels`（含每个模型的 `enabled: true`）。
- 修改 `src/renderer/src/stores/providers/index.ts`：按现有结构追加 17 个 import 与注册条目；不引入 `applyGptLongContextDefaults`、`applyServerToolCapabilityDefaults`、`BUILTIN_SEARCH_CAPABLE_PRESETS`、`IMAGE_GENERATION_CAPABLE_PRESETS`。
- 新增 `tests/provider-presets/program.ts` + `package.json` 的 `test:provider-presets` 脚本：按 `tests/renderable-chat-items` 的 esbuild 打包约定（`--bundle --platform=node --format=cjs --alias:@renderer=./src/renderer/src`）运行，不依赖 Electron。
- 新增 `docs/plans/iter-v2-26/evidence/provider-list-synced.png`：服务商面板出现新预设的脱敏截图。
- **明确不修改**：`src/shared/types/provider.ts`（类型已对齐，不扩字段）、现有 20 个预设文件（`AIModelConfig` 与 OpenCowork 已**双向分叉**，整体覆盖会丢掉 Wishful Claw 侧改动）、任何 C# 文件（不新增 Provider 运行时）、`src/main/*`、`src/preload/*`。不搬 `vertex-ai`、`routin-ai`、`shared/gpt-context`。

跨 Plan 硬契约：

- `builtinId` 全局唯一且与文件名一致；`version` 是单调递增整数，首次引入取 OpenCowork 当前值，**不得下调**（`version` 用于覆盖用户已持久化的旧配置，下调会导致同步失效）。
- `defaultModel` 必须存在于 `defaultModels` 且该模型 `enabled` 为 `true`；preset 级 `type` 必须是 C# 能分派的取值（`anthropic` / `openai-responses` / `openai-chat`）。
- 依赖 Plan G：`opencode-go` 在本 Plan 引入，其会话请求头由 Plan G 实现。两个 Plan 必须同迭代交付，不得只搬预设不补头。
- 排除项要有去处：`vertex-ai`（缺 C# 运行时）与 `routin-ai`（缺计价字段）在本迭代结束后记入 Obsidian 待办，不得静默丢弃。

步骤清单：

- [ ] F1：确认 OpenCowork 副本新鲜度。在 `D:\claw\OpenCowork` 先 `git status`；**工作区干净**才 `git pull`，随后记录 `git rev-parse HEAD` 与提交日期。若工作区有未提交改动则**不 pull**，改为锁定当前本地 HEAD 并在报告中写明“副本未更新到上游最新，锁定 commit <hash> / 日期”，不得为了拉新而丢弃或 stash 他人的在途改动。Mini 验证：报告中记录了实际使用的 commit hash 与日期；`D:\claw\wishful-claw` 工作区无任何变更（本步不改本仓库文件）。
- [ ] F2：按 F1 锁定的副本重新核对 17 个文件的字段兼容性（逐文件 grep `offPeak|pricingSchedule|supportsWebsocket|applyGptLongContext|gpt-context`），确认 0 命中；若某个预设在此核对中新出现 Wishful Claw 缺失的字段，把它移出本 Plan 并记入待办，不得顺手扩类型。Mini 验证：核对命令与输出写入报告；本步仍不改本仓库文件。
- [ ] F3：搬入 17 个预设文件并在 `index.ts` 注册。Mini 验证：三套 `tsc --noEmit -p` 0 错误；`dotnet build src/runtime/WishfulClaw.sln` 0 错误；`git diff --check`；`ls src/renderer/src/stores/providers/*.ts` 数量比改动前增加 17；确认 `git diff --stat` 中**没有**任何现有预设文件被修改。
- [ ] F4：实现 `tests/provider-presets/program.ts` 与 `test:provider-presets` 脚本，断言：全部预设 `builtinId` 唯一且与文件名一致；`version` 为正整数；`defaultModel` 存在且 `enabled`；preset 级 `type` ∈ `{anthropic, openai-responses, openai-chat}`；`defaultModels` 非空且每个模型 `id` 在该预设内唯一；`vertex-ai`、`routin-ai` **不在**注册表中；17 个新 `builtinId` 全部在注册表中。Mini 验证：`npm run test:provider-presets` 退出码 0；`npm run typecheck` 通过。
- [ ] F5：开发态实机核验。服务商面板中确认 17 个新预设全部出现、名称与图标正常、选中后模型下拉能列出该预设的模型且不报运行时错误；已有的 20 个预设与用户既有配置（apiKey、自定义模型）不受影响。截图存为 `docs/plans/iter-v2-26/evidence/provider-list-synced.png`。若老大提供可用 key，再对至少 1 个新预设跑通一次真实对话；**没有 key 时不得伪造对话成功**，在报告中记为“未做真实对话验证，原因：无可用凭据”。Mini 验证：统一 Mini 门槛 + `npm run test:provider-presets` + 截图存在 + 当天日志无新增 `[ERROR]`。

验收断言：服务商面板新增 17 个预设且可选中、模型列表可加载；`vertex-ai` 与 `routin-ai` 未被引入并已记入待办；现有 20 个预设文件与用户既有配置 0 变化；`index.ts` 未引入 OpenCowork 的四项额外机制；预设一致性测试退出码 0；实机截图存在，真实对话验证做了或明确标记未做及原因。

### Plan G：OpenCode Go 请求注入 `x-opencode-session`

对应待办：`改进.md 2026-09-08 | OpenCode Go | 调 Go 端点请求需注入 x-opencode-session 请求头，使用现有会话 ID`。老大 2026-09-08 裁定：**补 `providerBuiltinId` 精确 gate**。

目标：仅当本次请求使用的内置服务商是 `opencode-go` 时，向 OpenAI Chat Completions 请求注入 `x-opencode-session: <现有会话 ID>`；其他服务商、其他 Provider 运行时、其他端点一律不注入。该请求头上游 OpenCowork 不存在，属本仓库新增行为。

已核验的现状：

- 注入点：`src/runtime/WishfulClaw.Agent/OpenAIChatHeaders.cs` 的 `ApplyHeaders(HttpRequestMessage, JsonElement provider, string apiKey)`——依次设置 `Authorization: Bearer`、`ApiUserAgent.Apply`、可选 `OpenAI-Organization`、可选 `OpenAI-Project`、`ProviderRequestOverrides.ApplyHttpHeaderOverrides`、`ApiUserAgent.Ensure`。同文件 `:30` 的 `BuildDebugHeaders(provider)` 为 `request_debug` 事件镜像同一组头。`ProviderRequestOverrides` 已是“按 provider 配置追加自定义头”的既有先例。
- 影响面只有 1 个 Provider：`OpenAIChatHeaders.cs` 的这两个私有方法只被 `OpenAIChatProvider.cs:43`（`BuildDebugHeaders`）与 `:59`（`ApplyHeaders`）调用。`AnthropicMessagesProvider.cs:213` 与 `OpenAIResponsesProvider.cs:248` 各有**自己独立的** `BuildDebugHeaders`，不受影响。`opencode-go` 的 preset 级 `type` 是 `openai-chat`（`opencode-go.ts:369`），因此其全部模型都走 `OpenAIChatProvider`。
- 会话 ID 在 C# 侧可直接取得：`AgentRuntimeRunState.cs:29` 有 `public string SessionId { get; }`，而 `OpenAIChatProvider.ExecuteTurnAsync` 的签名（`:28-34`）已带 `AgentRuntimeRunState state`。**不需要**从 `parameters` 里解析 sessionId，也不需要给 `IWorkerRequestContext`（`src/runtime/WishfulClaw.Contracts/IWorkerRequestContext.cs:9-22`，当前只有 `CancellationToken`、`ConnectionCancellationToken`、`ForBackgroundOperation()` 和 `Emit*` 方法）加成员。
- **前置阻塞**：C# 已在 `OpenAIChatProvider.cs:54` 读 `providerBuiltinId`，但 Renderer 的主聊天载荷从来不发送它。Renderer 的 provider 对象本身已带 `builtinId`（`src/shared/types/provider.ts:303`，`src/renderer/src/stores/provider-store.ts:210,222` 已在传递），所以缺的只是发送端组装。
- **发送路径盘点（2026-09-08 复核修正）**：早期结论“全部 7 个发送点都经同一个 `buildProviderPayload`，改一处即全覆盖”**经 grep 证伪，已作废**。实际情况是 `agent/run` 的 provider 载荷有 **4 处独立构造点**，其中只有 1 处是 `buildProviderPayload`：
  1. `src/renderer/src/hooks/use-chat-actions.ts:210-225` — `handleSendMessage` **主聊天路径**，自己内联构造 provider 对象，**不调用** `buildProviderPayload`（`:364-366` 的注释正好自证：`buildProviderPayload` 是“matching handleSendMessage's logic”的复制品）。**缺** `providerBuiltinId`。这是用户在主输入框选 `opencode-go` 对话时走的路径，漏掉它 gate 永不成立。
  2. `src/renderer/src/hooks/use-chat-actions.ts:385-399` — `buildProviderPayload`，被 7 处调用：`use-chat-actions.ts:432,488,567,678`、`src/renderer/src/hooks/use-background-subagent-wakeup.ts:79`、`src/renderer/src/components/goal/goal-session-views.tsx:197`、`src/renderer/src/lib/tools/cron-runtime.ts:395`。**缺** `providerBuiltinId`；改这一处覆盖上述 7 个调用点。
  3. `src/renderer/src/hooks/use-channel-auto-reply.ts:223-235` — 渠道自动回复路径。**缺** `providerBuiltinId`。
  4. `src/renderer/src/lib/tools/project-send-message.ts:87-97` — `send_session_message` 工具把消息派发到项目会话的路径。**缺** `providerBuiltinId`。
  - 已带该字段、无需改动：`src/renderer/src/lib/tools/cron-runtime.ts:101-128`（`:111` 已有 `providerBuiltinId: provider.builtinId`，走的是独立的 `ProviderConfig` 形状）、`src/renderer/src/lib/agent/memory-automation-utils.ts:271`、`src/renderer/src/lib/ipc/sidecar-mapping.ts:153`（`mapSidecarProvider` 已在字段存在时透传）。
- **显式裁决：Task 子 Agent 的 fast-model 路径不在本 Plan 范围**。`src/renderer/src/lib/agent/sub-agents/builtin/index.ts:17-37` 的 `getProviderConfig()` 与 `src/renderer/src/lib/ipc/sidecar-mapping.ts:290-291` 都依赖 `getFastProviderConfig()`，而该函数的返回形状（`src/renderer/src/stores/provider-store-helpers.ts:34`、`src/renderer/src/stores/provider-store.ts:101`）只有 `{ providerId, model, apiKey, requiresApiKey, baseUrl }`，**不含 `builtinId`**。要覆盖子 Agent 就得改这个 fast-config 契约，而它同时被标题生成（`src/renderer/src/lib/api/generate-title.ts:201`）、提示词优化（`src/renderer/src/components/chat/InputArea/use-input-area-selectors.ts:127`）、模型切换器展示（`src/renderer/src/components/chat/ModelSwitcher.tsx:69`）、用量统计（`use-completion-summary.ts:71`）和压缩 Provider 消费，blast radius 远超本待办。后果有限且非致命：子 Agent 用 `opencode-go` 时请求不带 `x-opencode-session`，只是用量归属不完整，不影响对话可用。按 AGENTS.md“不扩大范围”原则本迭代不做，**迭代结束后记入 Obsidian 待办**（连同 `OpenAIChatProvider.cs:53` 的 `providerId`/`id` 命名不一致）。若老大在确认环节要求纳入，改动量约为上述两个 store 文件各 1 行 + `getProviderConfig` 透传，可追加为 G5。
- 附带发现（本 Plan **不修**，仅记录）：`OpenAIChatProvider.cs:53` 读的是 `providerId`，而 `buildProviderPayload` 发的是 `id`，两者名字不一致，`request_debug` 的 providerId 字段可能一直为空（`cron-runtime.ts:110` 发的是 `providerId`，说明这个字段名在不同路径下本就不统一）。属既有缺陷，与本待办无关，记入 Obsidian 待办另议。

确定文件范围：

- 修改 **4 个** Renderer 发送路径，统一补 `providerBuiltinId: <provider>.builtinId ?? undefined`（自定义服务商无 `builtinId` 时为 `undefined`，序列化后不出现该键，C# 侧 `JsonHelpers.GetString` 返回 `null`，gate 自然不成立）：
  - `src/renderer/src/hooks/use-chat-actions.ts:210-225`（`handleSendMessage` 主聊天路径，源对象为 `activeProvider`）
  - `src/renderer/src/hooks/use-chat-actions.ts:385-399`（`buildProviderPayload`，源对象为 `activeProvider!`；改这一处即覆盖其 7 个调用点）
  - `src/renderer/src/hooks/use-channel-auto-reply.ts:223-235`（源对象为 `targetProvider`）
  - `src/renderer/src/lib/tools/project-send-message.ts:87-97`（源对象为 `targetProvider`）
  - 四处必须用**同一字段名** `providerBuiltinId`，与 `cron-runtime.ts:111`、`memory-automation-utils.ts:271`、`sidecar-mapping.ts:153` 既有写法保持一致。
- 修改 `src/runtime/WishfulClaw.Agent/OpenAIChatHeaders.cs`：
  - `ApplyHeaders` 增加 `string? sessionId` 参数；在 `ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider)` **之后**、`ApiUserAgent.Ensure` 之前注入，且仅当 ①`JsonHelpers.GetString(provider, "providerBuiltinId")` 等于 `"opencode-go"`（`Ordinal` 精确比较，不做前缀/包含匹配）②`sessionId` 非空白 ③`!request.Headers.Contains("x-opencode-session")` 三条同时成立时才 `TryAddWithoutValidation("x-opencode-session", sessionId)`。放在 overrides 之后 + `Contains` 判断，保证用户显式配置的同名头优先，且不产生重复头。
  - `BuildDebugHeaders` 同步增加 `string? sessionId` 参数并镜像同一条件，使 `request_debug` 展示的头与真实发出的头一致；不得只改一边。
- 修改 `src/runtime/WishfulClaw.Agent/OpenAIChatProvider.cs`：`:43` 与 `:59` 两个调用点传入 `state.SessionId`。
- 新增 `tests/WishfulClaw.ProviderHeaderRegressionTests/{Program.cs,.csproj}`：按 `ToolConcurrencyRegressionTests` 同构；若需要访问 `internal` 成员，则在 `WishfulClaw.Agent.csproj` 追加对应 `InternalsVisibleTo` 并登记到 sln。
- 新增 `docs/plans/iter-v2-26/evidence/opencode-go-session-header.png`：`request_debug` 事件中出现 `x-opencode-session` 的脱敏截图（**必须遮掉 apiKey 与 Bearer 值**）。
- **明确不修改**：`src/runtime/WishfulClaw.Agent/AnthropicMessagesProvider.cs`、`src/runtime/WishfulClaw.Agent/OpenAIResponsesProvider.cs` 及各自的 `BuildDebugHeaders`、`src/runtime/WishfulClaw.Contracts/IWorkerRequestContext.cs`、`ProviderRequestOverrides`、`ApiUserAgent`、`src/preload/*`；`buildProviderPayload` 的 7 个调用点（改函数本身即覆盖，不得在调用点各自拼 provider）；`src/renderer/src/lib/tools/cron-runtime.ts`、`src/renderer/src/lib/agent/memory-automation-utils.ts`、`src/renderer/src/lib/ipc/sidecar-mapping.ts`（三者已带 `providerBuiltinId`）。按上文裁决，本 Plan **也不修改** `src/renderer/src/stores/provider-store.ts`、`src/renderer/src/stores/provider-store-helpers.ts`、`src/renderer/src/lib/agent/sub-agents/builtin/index.ts`（fast-model / Task 子 Agent 路径），除非老大在确认环节明确要求追加 G5。不注入到 Anthropic / Responses 端点，不注入 `opencode`（Zen）预设，不按 baseUrl 字符串匹配做 gate。

跨 Plan 硬契约：

- gate 只认 `providerBuiltinId === "opencode-go"`。不得改用 baseUrl 包含 `opencode.ai/zen/go` 之类的模糊匹配，也不得扩大到 `opencode`。
- 头的值就是**现有会话 ID**（`state.SessionId`），不新造 ID、不复用 runId、不做哈希或编码变换。
- `providerBuiltinId` 是通用字段，补齐后对所有内置服务商生效；本 Plan 只**读取**它做 `opencode-go` 判断，不得让它影响其他 Provider 的任何行为。
- **4 个发送路径必须全部覆盖**（`use-chat-actions.ts:210-225`、`use-chat-actions.ts:385-399`、`use-channel-auto-reply.ts:223-235`、`project-send-message.ts:87-97`）。只改 `buildProviderPayload` 会漏掉主聊天路径，导致用户在主输入框选 `opencode-go` 时 gate 永不成立——这是本轮规划复审判 ❌ 的原因，不得重犯。
- 用户通过 `requestOverrides.headers` 显式配置的同名头必须胜出，且最终请求中该头**只出现一次**。
- 依赖 Plan F：`opencode-go` 预设由 Plan F 引入。若 Plan F 未交付，本 Plan 的 gate 永远不会成立，等同死代码——两者必须同迭代完成。

步骤清单：

- [ ] G1：Renderer 4 处发送路径统一补发 `providerBuiltinId`（`use-chat-actions.ts:210-225` 主聊天、`use-chat-actions.ts:385-399` `buildProviderPayload`、`use-channel-auto-reply.ts:223-235` 渠道自动回复、`project-send-message.ts:87-97` 会话派发）。Mini 验证：
  - 三套 `tsc --noEmit -p` 0 错误；`dotnet build src/runtime/WishfulClaw.sln` 0 错误；`git diff --check`；
  - `git diff --stat` 中 Renderer 侧**恰好**只有 3 个文件：`use-chat-actions.ts`、`use-channel-auto-reply.ts`、`project-send-message.ts`。已带字段的 3 个文件（`cron-runtime.ts`、`memory-automation-utils.ts`、`sidecar-mapping.ts`）不得出现在 diff 中；`buildProviderPayload` 的 7 个调用点中，位于其他文件的 3 处（`use-background-subagent-wakeup.ts:79`、`goal-session-views.tsx:197`、`cron-runtime.ts:395`）同样不得出现，而位于 `use-chat-actions.ts` 内的 4 处（`:432,488,567,678`）按**行粒度**核验——diff 中该文件的改动行只应落在 `:210-225` 与 `:385-399` 两个区间，不得出现调用点行的改动；
  - `grep -rn "providerBuiltinId" src/renderer/src/hooks/use-chat-actions.ts src/renderer/src/hooks/use-channel-auto-reply.ts src/renderer/src/lib/tools/project-send-message.ts src/renderer/src/lib/tools/cron-runtime.ts src/renderer/src/lib/agent/memory-automation-utils.ts` 在上述每个文件均至少命中 1 次；
  - 反向兜底：`grep -rn "apiKey:" src/renderer/src --include=*.ts --include=*.tsx` 的每一处命中都必须能被判定为“已带 `providerBuiltinId`”“非 `agent/run` 载荷（如设置面板表单、鉴权、UI 展示、sidecar 映射）”或“已裁决排除的 fast-model 路径”三者之一；出现第四类即视为遗漏，必须补进本步骤，不得留到验证态才发现。
- [ ] G2：C# 注入头 + debug 镜像 + 两个调用点传 `state.SessionId`。Mini 验证：`dotnet build src/runtime/WishfulClaw.sln` 0 错误、**AOT 0 警告**（不得引入反射或匿名类型 JSON）；三套 `tsc --noEmit -p`；`git diff --check`；`grep -n "x-opencode-session" src/runtime/WishfulClaw.Agent/OpenAIChatHeaders.cs` 在 `ApplyHeaders` 与 `BuildDebugHeaders` 中**各命中一次**。
- [ ] G3：新增 C# 回归测试。断言至少覆盖：
  - `providerBuiltinId = "opencode-go"` + 非空 sessionId → 头存在且值等于 sessionId，且只出现一次；
  - `providerBuiltinId` 缺失 / 为 `"opencode"` / 为 `"anthropic"` / 为 `"OpenCode-Go"`（大小写不同）→ 头不存在；
  - sessionId 为 `null`、空串、纯空白 → 头不存在；
  - `requestOverrides.headers` 已含 `x-opencode-session: custom` → 最终值为 `custom` 且只出现一次；
  - `BuildDebugHeaders` 与 `ApplyHeaders` 在以上每种输入下产出的该头**完全一致**；
  - `Authorization: Bearer` 与 `User-Agent` 行为不因本次改动变化。
  Mini 验证：`dotnet run --project tests/WishfulClaw.ProviderHeaderRegressionTests -c Debug` 退出码 0；`dotnet build src/runtime/WishfulClaw.sln` 0 错误。
- [ ] G4：开发态实机取证（**需老大提供 OpenCode Go 凭据**）。选中 `opencode-go` 预设发起一次对话，从 `request_debug` 事件确认请求头含 `x-opencode-session` 且值等于当前会话 ID，同时确认 `Authorization` 未被泄露到截图；再切到任一非 `opencode-go` 预设发起一次对话，确认该头**不**出现。截图存为 `docs/plans/iter-v2-26/evidence/opencode-go-session-header.png`，apiKey 与 Bearer 值必须遮挡。Mini 验证：统一 Mini 门槛 + 两个测试项目退出码 0 + 截图存在且已脱敏 + 当天日志无新增 `[ERROR]`。

验收断言：`opencode-go` 请求带 `x-opencode-session` 且值为当前会话 ID；其他服务商、其他 Provider 运行时、大小写变体、空 sessionId 一律不带该头；用户显式同名头优先且不重复；`request_debug` 展示的头与真实请求一致；C# 回归测试退出码 0；实机正反两次取证截图存在且已脱敏。

> G4 依赖真实 OpenCode Go 凭据。若老大未提供，G4 记为“待用户验证”，仅以 G3 的单元测试作为证据，不得伪造真实请求截图。

## 5. 非目标

- 不替换 electron-updater，不引入自建长期 CDN/manifest/签名/增量更新服务。
- 不做真实安装版旧→新升级验证（老大 2026-09-08 确认暂缓）：不在隔离 VM/Sandbox 构建 NSIS 测试包，不复现历史 0.2.24→0.2.25 升级，不搭本机临时 HTTP generic feed，不改写 `app-update.yml`，不验证磁盘空间不足/安装失败回退/升级前后用户数据哈希。
- 不处理 Windows 发布者签名、发布自动化或正式 Release；后续另立计划。
- 不新增系统通知、独立后台服务或退出应用后继续下载能力。
- 不提供取消下载，不强制完整下载 121 MiB 安装包，不伪造 differential/full 状态。
- 不修改 Preload、用户数据库 schema 或用户数据目录。C# Worker 仅在 Plan D（`AgentRunContextPolicy.ResolveAvailableMode` 的 mode 归一）与 Plan G（请求头注入）划定的文件内改动，不新增 Provider 运行时、不改工具分派/过滤机制、不改 IPC 契约。
- Plan D 不做的事：**不改任何 Provider 的 `availableModes`**（`ProjectToolsProvider`/`GlobalTaskToolsProvider`/`PluginToolProvider`/`ChannelPluginToolProvider` 四者一行不动，已废弃的修法 A 就是逐处追加 `"channel"`）；不把 `global-task` 加进任何 `ToolPreset`（它是 `ProxiedCategories` 有意代理的分类）；不改 `channel` preset 的 `AllowedCategories`；不放宽 `AgentRunContextPolicy` 白名单或 `ToolCallProcessor` 运行时复查；不在 `PromptBuilder` 里加 channel 分叉去屏蔽 `<global_agent>` 注入；**不修 `NormalizeRuntimeParameters` 的归一化不幂等**（老大裁定渠道会话不绑定项目，该场景不可触发；记入迭代收尾待办备查）；**不为 `<session_todo>` 缺失打补丁**（属第三个有意的行为变更，有实际损失则回规划态重新裁定）；**不修 `ToolRegistry.GetToolDefinitions` 的大小写敏感匹配与 `IsAvailableInMode` 不一致**（既有隐患，已核到 `update_goal_progress` 一个受害者，与 Plan D 无因果，记入迭代收尾待办）；不清理 `ChannelPluginToolProvider` 16 处归一后失效的 `"channel"` 死条目（记入迭代收尾待办）；不改 `GlobalDispatchReplyToolProvider`；不改 Renderer 与 `db/projects-list` 链路；不主动为渠道会话开放 `cron`/`desktop`/`team`/`skill-management`（这四类由第 1 层 `channel` preset 拦住，属预期，不是缺口）。
- Plan E 不做的事：不改微信绑定路径；不改飞书 OAuth Device Flow 的 begin/poll 协议与返回结构；不改 `channel-store`、IPC handler 或 C#；不新增“绑定后自动发测试消息”等额外行为；不改轮询 IPC 本身瞬时失败的静默重试语义（只把保存/启动失败从该语义中分离出来）。
- Plan F 不做的事：不搬 `vertex-ai`（Wishful Claw 无 Gemini/Vertex C# 运行时）与 `routin-ai`（缺 offPeak 计价与 `supportsWebsocket` 等类型）；不扩 `AIModelConfig` / `BuiltinProviderPreset` 字段；不引入 OpenCowork 的 `applyGptLongContextDefaults`、`applyServerToolCapabilityDefaults`、`BUILTIN_SEARCH_CAPABLE_PRESETS`、`IMAGE_GENERATION_CAPABLE_PRESETS` 与 `shared/gpt-context`；不整体覆盖现有 20 个预设文件；不为新预设新增 C# Provider 运行时。
- Plan G 不做的事：不按 baseUrl 模糊匹配做 gate；不注入到 Anthropic / OpenAI Responses 端点或 `opencode`（Zen）预设；不给 `IWorkerRequestContext` 加 SessionId 成员；不新造会话标识；**不改 `getFastProviderConfig()` 契约，因此 Task 子 Agent / fast-model 路径本迭代不带 `x-opencode-session`**（已显式裁决，理由见 Plan G 现状条目；除非老大要求追加 G5）；不顺带修 `OpenAIChatProvider.cs:53` 的 `providerId` / `id` 命名不一致（记入待办另议）。

## 6. 提交、审查与总体验收门槛

- 规划复审 PASS 且用户确认后才进入执行态。
- 执行顺序：A → B → C → D → E → F → G。D、E 与 A~C 相互独立，可按此顺序串行推进；**F 必须先于 G**（`opencode-go` 预设由 F 引入，G 的 gate 才有对象），两者必须同迭代交付。
- A~G 各自按功能单元完成 Mini 验证后本地 commit，提交信息遵循 `<type>(<scope>): <简述>`；Plan 执行期间**只 commit 不 push**，整个 Plan 全部完成并通过验证后才一次性 push。
- 执行完进入独立代码审查；0 个阻断项后进入验证态。
- 最终必须全部通过：
  - Release Notes 安全测试 `npm run test:updater-release-notes`
  - 更新状态与安装契约 `npm run test:updater-state`
  - 下载可观测性 `npm run test:updater-progress`
  - 渠道工具可见性 `dotnet run --project tests/WishfulClaw.ChannelToolVisibilityRegressionTests -c Debug`
  - 请求头注入 `dotnet run --project tests/WishfulClaw.ProviderHeaderRegressionTests -c Debug`
  - 服务商预设一致性 `npm run test:provider-presets`
  - 三套 TypeScript：`npx tsc --noEmit -p tsconfig.web.json`、`-p tsconfig.node.json`、`-p tsconfig.json`
  - C# `dotnet build src/runtime/WishfulClaw.sln` 0 错误，且 Plan D/G 改动 **AOT 0 警告**
  - `npm run build`、`git diff --check`
  - C4 开发态真实下载取证
- 依赖用户配合的三步——E3（真实飞书扫码）、F5 的真实对话子项（需服务商凭据）、G4（需 OpenCode Go 凭据）：Agent 无法独立完成时，在验证报告中逐条标为“待用户验证”并写明缺什么，**不得**以代码走查、模拟数据或伪造截图冒充实机取证；这三步未做不影响其余步骤的判定，但整体结论最高只能给 PARTIAL。
- C4 未取到真实下载证据时按 C5 在报告显式标记原因，不得用模拟数据冒充。
- 验证报告产出后停下，由用户裁定 PASS/FAIL/PARTIAL；真实安装版升级验证、Windows 签名、正式发版、main/tag/Release，以及 4 项已裁决排除/延后的待办——`vertex-ai`（缺 C# 运行时）、`routin-ai`（缺计价字段）、Task 子 Agent fast-model 路径的 `x-opencode-session`（缺 `getFastProviderConfig` 的 `builtinId`）、`OpenAIChatProvider.cs:53` 的 `providerId`/`id` 命名不一致——均不在本计划内，迭代收尾时记入 Obsidian 待办。
- 迭代收尾（合并 main、打 tag、GitHub Release、安装包上传、Obsidian 待办归档到 `历史记录.md`）必须等老大明确确认迭代完结后才执行，Agent 不得自行判定。
