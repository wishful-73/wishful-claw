# v3-iter-4 阶段一：探索发现

> 只读探查，2026-10-28 17:28 ~ 17:40。由两个独立 subagent 并行执行，主会话汇总。
> 目的：核实九条承接需求的现状/缺口/涉及文件，并给刀序提供依据。
> **本文件只写证据与结论，不改任何需求正文**；需求口径仍以 `../iter-v3-3/requirements/S-24x.md` 为准。

## 〇、一句话总览

插件基座**不是从零开始**：extension 体系（manifest / 安装 / 卸载 / 私有 KV）已经完整，缺的是 **views 与 assets 两个新维度**、**独立窗口**、**资产下载器**、**录音采集**。最大不确定项 **S-243 已有确定性答案**（Electron 原生 loopback，Windows 专属，不需要原生模块）。另有 **2 个阻断项** 必须先解决否则 S-240 起不了步。

## 一、插件基座（S-240 ~ S-244）

### 1.1 现有基础（可直接复用的）

| 能力 | 位置 |
|---|---|
| 清单类型（TS） | `src/shared/extension-types.ts:87-111` |
| 清单归一化（**字段白名单**） | `src/runtime/WishfulClaw.Agent/Modules/Extensions/ExtensionManifestNormalizer.cs:24-107` |
| 清单读盘（强类型，供工具执行） | `ExtensionManifestReader.cs` |
| 安装 / 列表 / 卸载 | `ExtensionManifestStore.cs:43`（install）/ `:34`（list）/ `:145-182`（remove） |
| 数据根（dev / packaged 区分） | `src/main/lib/data-dir.ts:11-19`、`src/shared/data-dir.ts:1`（`~/.wishful-claw`，dev 为 `.wishful-claw-dev`） |
| 内置扩展播种 | `ExtensionStateStore.cs:134` `EnsureBuiltinExtensions` |
| 安装等 IPC 全链 | `src/main/ipc/extension-handlers.ts:67/71/83/98/105/114/129/139-155` |
| 渲染端 manifest 来源 | **C# 归一化后的 JsonNode** —— `ExtensionStateStore.cs:68` `ListExtensionsCore` → `:96-108` 每条 `manifest.DeepClone()` |
| 插件设置面板 | `src/renderer/src/components/settings/ExtensionPanel.tsx`，挂载 `SettingsPage.tsx:107-116` / `:240-258` |

> ⚠️ 关键认知：**渲染端拿到的 manifest 不是原文件，是 C# 归一化后的结果**。所以「只改 TS 类型」不会生效 —— 归一化器白名单会把新字段静默吃掉。

### 1.2 S-240 清单扩展与导轨入口

**缺口**
1. `src/shared/extension-types.ts`：加 `ExtensionViewDefinition` / `ExtensionAssetDefinition` + `views?` / `assets?`
2. `ExtensionManifestNormalizer.cs:24-107`：**必须**新增 `views` / `assets` 归一化分支（否则字段被吃）
3. `ExtensionManifestNormalizer.cs:~52`：现有 `if (tools.Count == 0) throw "extension must define at least one tool"` ⇒ **只声明 views 的插件今天装不上**
4. `ExtensionModels.cs:20-27`：同步补 `Views` / `Assets`（注意该 record 只服务工具执行，渲染端不走它）
5. 导轨：`src/renderer/src/components/layout/WorkspaceSidebar.tsx:215-219` 现在**硬编码** `draw/automation/taskboard`（`:257-300` 渲染），与 manifest 完全无关 ⇒ 需追加「启用中扩展的 views，按 `nav.order`」
6. `src/renderer/src/stores/extension-store.ts:34-190`：暴露派生数据（现只有 `extensions/getActiveExtensions`）

### 1.3 S-241 视图独立窗口与生命周期

**可抄的先例（4 处，最像的是第一个）**
- `src/main/ipc/web-fetch-handlers.ts:68-77` —— 隐藏窗口、`sandbox:true`、无 preload、用完即关
- `clipboard-enhancer.ts:585`、`quick-launcher/window.ts:143`、`ipc/channel-handlers/qr-page-capture.ts:111`、主窗 `src/main/index.ts:104-127`
- `webviewTag: true` 在 `src/main/index.ts:123`
- 分区隔离先例：`src/shared/browser-plugin.ts:8`（`persist:wishfulclaw-browser`），webview 以 `partition` prop 传（`BrowserPanel.tsx:86-93`）

**缺口**
- 新建 `src/main/plugins/`（**目录当前不存在**）：`plugin-window.ts`（`pluginId → BrowserWindow` 注册表、懒开、单插件单窗）、`plugin-lifecycle.ts`（空闲回收、pid 树回收、退出钩子）、`src/main/ipc/plugin-view-handlers.ts`（`plugin-view:open/close/list/status`）
- `src/main/index.ts` 补全局 `render-process-gone`（现仅主窗有，`:163`）与 `before-quit`（现 `:482-497` 无按插件 pid 树）
- pid 树回收：**全仓无 `tree-kill` / `taskkill`**，只有 `native-worker.ts` 与 `killAllTerminalSessions` ⇒ Windows 需自写 `taskkill /T /F` 或 pid 遍历
- 分区：`webPreferences.partition = persist:plugin-<id>`（主进程里**没有先例写法**，webview 用的是 prop）

### 1.4 S-242 资产下载器

**现状：零下载能力**
- `src/main/lib/codegraph-assets.ts:30-58` 只有本地探测（七态诊断），注释明确 `bundled only — no online download`
- 唯一进度推送范式可抄：`src/main/updater.ts:56-60`（节流）、`:291-305`（`sendUpdateEvent` → `safeSendMessagePackToWindow`）；通用发送器 `src/main/window-ipc.ts:8-14 / :46-52`
- `net.request` 仅用于 API 代理 `ipc/api-request-handler.ts:93-95`（拿 body 不落盘）；全仓无 `.part` / `Range` / `createWriteStream`
- `requiresDownload` 是死字段：声明 `src/renderer/src/lib/app-plugin/types.ts:61`，唯一消费点 **S-250 拆分后已搬到** `settings/app-plugin/meta.tsx:103`（文档里的 `AppPluginPanel.tsx:174` 是拆前旧行号）

**缺口**：`src/main/plugins/plugin-asset-catalog.ts`、`plugin-assets.ts`（状态机/多源/续传/流式 sha256/重试/并发锁/取消）、`src/main/ipc/plugin-asset-handlers.ts`；渲染端卡片与设置页资产区。插件窗口需注入 `window.wishful.assets` —— **当前 preload 只暴露 `window.api` / `window.electron`**（`src/preload/index.ts:105-120`，无 `window.wishful`）。

**落盘口径需改**：文档写 `%APPDATA%/WishfulClaw/plugin-assets/`，但本仓数据根是 `~/.wishful-claw` ⇒ 应统一，否则出现两套数据根。

### 1.5 S-243 录音采集 —— **最大不确定项已消解**

**现状**
- **Electron 43.2.0**
- 音频相关**全仓零实现**：`getUserMedia` / `MediaRecorder` / `setDisplayMediaRequestHandler` / `setPermissionRequestHandler` 零命中
- `desktopCapturer` 只用于截图（`src/main/ipc/desktop-control.ts:8`、`:130-133` `types:['screen']`，**无 audio**）
- 无音频依赖（无 wav / ffmpeg / audio 库）

**判断：可行（Windows 专属），不需要原生 WASAPI 模块**
- 依据：`node_modules/electron/electron.d.ts:13229` 有 `session.setDisplayMediaRequestHandler`；`:23668-23674` 明确 `Streams.audio?: 'loopback' | 'loopbackWithMute'`，注释原文「capture system audio, **currently only supported on Windows**」
- ⇒ 主进程注册 handler + 渲染端 `getDisplayMedia` 即可，拿到的是**系统混音**（不是麦克风混录）

**必须实测的三点 —— 2026-10-28 18:0x 已全部实测完毕（第 0 刀，探针实测见 §1.7）**

### 1.7 第 0 刀实测结果（2026-10-28，探针 `.wishful-claw/notes/s243-probe/`，Electron 43.2.0 / Windows）

| # | 问题 | 实测结论 | 对实现的影响 |
|---|---|---|---|
| 1 | 纯音频 `getDisplayMedia({audio:true})` 能否被允许 | **不能**。抛 `AbortError: Invalid capture constraints`，handler 都没走到 | **必须**先要 `video` 再丢掉 video track。这是硬约束，不是可选优化 |
| 2 | 系统 loopback 是否真能采到混音 | **能**。静音基线 `avgRms=0 / peakRms=0`；本程序播 440 Hz 时 `avgRms=0.0165 / peakRms=0.0796`，FFT 主频 **445 Hz**（2048 点 @48 kHz ⇒ 分辨率 ~23 Hz，440 落 445 bin 正常） | loopback 通路成立，**不需要原生 WASAPI 模块**（拍定 #8 成立） |
| 3 | 是否混入本程序自身播放 | **确认必然混入**。放的 440 Hz 是本程序自己播的，被完整采到 | 拍定 #7（接受）落地。需求文档里要写成**已知特性**，不是缺陷 |
| 4 | loopback 给的采样率 / 声道 | **48 000 Hz、`channelCount: 1`（单声道）**，label `System audio` | ⚠️ **意外**：不是预想的 48 k stereo。只需重采样、**不需要声道下混**。但实现必须按 `track.getSettings()` 动态取值，别写死 mono |
| 5 | 48 k → 16 k 重采样可行性与精度 | **可行**。`OfflineAudioContext(1, 16000, 16000)` 渲染 1 s：输出 `16000Hz × 1ch`、长度精确 `16000`、`rms=0.25` | 不需要新依赖，WebAudio 原生够用 |
| 6 | 麦克风通路 | **通**。`getUserMedia({audio:true})` OK，48 000 Hz / 1 ch。`enumerateDevices()` 列出 **3 个** audioinput（Default / Communications / 本机麦克风，英特尔智音） | 验收第 1 条（列设备、可切换）具备前提 |
| 7 | `callback` 只给 video 不给 audio | audioTracks = **0**，videoTracks = 1，**不报错** | 对照组成立 ⇒ 上面第 2 条的音频确实是 `audio:'loopback'` 带来的，不是假阳性 |

**顺带记下**：`setDisplayMediaRequestHandler(handler, { useSystemPicker: false })` 在本机生效，没有弹系统选择器。

**还剩一条没测**：`loopbackWithMute` 的确切语义（是否「采集但静音本机播放」）。当前口径用 `'loopback'` 即可，`loopbackWithMute` 留作后续「不想听到自己声音」时的备选。

**主进程 / 渲染端分工定案**：主进程只负责 `setDisplayMediaRequestHandler` 注册与 source 选择（按 session 注册，见下）；采集、测量、重采样、落盘全在渲染端 WebAudio 做。

**分区注意**：`setDisplayMediaRequestHandler` **按 session 生效**；S-241 的插件窗口用 `persist:plugin-<id>` ⇒ handler 必须注册到插件 session，否则插件窗口里 `getDisplayMedia` 直接被拒。

### 1.6 S-244 安装确认与卸载清理

**现状**
- 安装无确认：`ExtensionPanel.tsx` 直接调 `installFromFolder`（`extension-store.ts:114-120` → `extension-handlers.ts:71-81` → `ExtensionManifestStore.cs:43-80` 直接 `CopyDirectory`）。已有 `confirm()` 组件可复用（`ExtensionPanel.tsx:12` 引入，`remove` 里在用）
- **卸载清理比文档写的更完整**：`ExtensionManifestStore.cs:145-182` 一处做完 4 件 —— 删目录、从 `extensions.json` 删状态、从 `extensions-storage.json` 删**私有 KV 整个 id**、删 `extension:<id>:secret:*` 加密配置（`ExtensionManifestHelpers.cs:149-157`）。⇒ 文档 §3.2「私有 KV 不清」**是过时/错误**
- 无 DB 表：扩展状态与 KV 都是 JSON（`~/.wishful-claw/extensions.json`、`extensions-storage.json`）
- 未清的：session 分区（尚不存在）、窗口/子进程（S-241 才有）、共享资产（按设计不删）

**缺口**：安装确认弹窗（勾选才可装、按 id 记住、带「需额外下载约 XX MB」）；`remove` 顺序编排（先关窗 → 收 pid 树 → `clearStorageData()` → 删目录，新增 `src/main/plugins/plugin-cleanup.ts`）；设置页缺「存储」tab（现「插件」组只有 5 个 tab，`SettingsPage.tsx:107-116`）。

## 二、插件线风险与依赖（严重度降序）

1. **【阻断】`NormalizeManifestNode` 强制 ≥1 tool**（`ExtensionManifestNormalizer.cs:~52`）—— S-240 验收 1（只声明 views 的假插件）**今天必失败**，且报错发生在 C# 安装/列表阶段
2. **【阻断】三处必须同刀**：TS 类型 + `ExtensionModels.cs` + `ExtensionManifestNormalizer.cs`。只改前两处，字段会被归一化器静默丢弃
3. **【高】S-241 权限全开 + 分区数据删不掉**：`nodeIntegration:true / contextIsolation:false / sandbox:false` 是已知情接受；真风险是 `clearStorageData()` ≠ 删目录，session 存活时目录被占用
4. **【高】S-243 整机混音包含自身**：会议场景若插件自己放音频会形成回声；无 per-process 排除 API
5. **【中】S-242 目录口径不一致**：文档 `%APPDATA%` vs 实际 `~/.wishful-claw`
6. **【中】S-243 handler 是 session 级**：只在 `defaultSession` 注册则插件窗口取不到；给 defaultSession 注册则主窗也能被静默录屏
7. **【中】S-241 空闲回收会杀掉「正在听」的会话**：15 分钟无活动销毁窗口，而录音可能在跑 ⇒ 需「繁忙标记」或把采集放主进程
8. **【中】S-244 安装历史无落点**：无 DB 表、无 settings 目录约定，「按 id 记住勾选」需拍板落点
9. **【低】命名撞车**：`src/main/channels/plugin-*` 与 `channels.ts:142-160` 的 `plugin:*` 是**聊天渠道插件**，与本需求的 `extension:*` 无关；新增 `src/main/plugins/` 会加剧混淆
10. **【低】`app-plugin`（image/browser/desktop-control/codegraph）是第二套插件体系**，纯渲染端、无 manifest，与 `extension.json` 无交集 ⇒ S-240 不要往 `APP_PLUGIN_DESCRIPTORS`（`lib/app-plugin/types.ts:75-118`）里塞

## 三、文档过时点（需订正）

| 文档说法 | 实测 |
|---|---|
| 「全仓无 `<webview>` 使用点」 | **有**：`BrowserPanel.tsx:510-517`、`FreeChatPage.tsx:197` |
| S-244「卸载不清私有 KV」 | **清了**（`ExtensionManifestStore.cs:145-182`） |
| S-242 `AppPluginPanel.tsx:174` | 已搬到 `settings/app-plugin/meta.tsx:103`（S-250 拆分） |
| S-240 §4 只列 TS + Models 两处 | 漏了**归一化器**这第三处，且它是阻断项 |

## 四、待决问题

已全部拍定，见 **§七**。

## 五、资源治理与渲染四条 + 两条未排查项

### 5.1 S-247 内存占用异常偏高 —— 结论：**端点早就有了，零调用；缺的全是消费端**

**现状**
- 记录定义：`src/runtime/WishfulClaw.Worker/SystemModule.cs:23` `public sealed record SystemMemorySnapshot(...)`，字段 `ManagedBytes / HeapBytes / FragmentedBytes / WorkingSetBytes`
- 采集实现：`SystemModule.cs:32` `Capture()`；`:41` `GC.GetTotalMemory(forceFullCollection: false)`
- AOT 注册：`WishfulClawJsonContext.cs:149` `[JsonSerializable(typeof(SystemMemorySnapshot))]`
- **零调用**：全仓 `worker/memory` 命中只有 `SystemModule.cs` + `WishfulClawJsonContext.cs` + 文档。主进程/渲染端只调 `worker/ping`（`misc-handlers.ts:49,52`、`native-worker.ts:253`）与 `worker/routes`
- 全仓 `memoryUsage|performance.memory|getAppMetrics|GC.Collect|GetTotalMemory` 在 `src` 下唯一代码命中就是 `SystemModule.cs:41` ⇒ **无任何采样上报**

**要动**：`src/main/ipc/*` 新增轮询 + 推送通道、preload 暴露、渲染端状态面板（`ui-store.ts` 已有 `runtimeStatusPanelOpen` 开关）。**`SystemModule.cs` 本体不用改。**

### 5.2 S-248 纯文本档 —— 结论：**`text` 档只影响「折叠」，从未下沉到卡片层**

**证据**
- 类型：`src/renderer/src/stores/settings-store-types.ts:48` `ChatRenderDensity = 'text' | 'compact' | 'detail'`；迁移回落 `settings-store-migrate.ts:242-246`（非三档一律 `compact`）
- 矩阵（纯函数，不 import React、不读 store）：`src/renderer/src/components/chat/render-density.ts` —— `:15` 三档常量、`:17` 默认 `compact`、`:102` `deriveToolRunCollapsed`、`:118` `deriveThinkingCollapsed`、`:134` `deriveSubAgentExpanded`
- policy 入口：`components/chat/use-density-override.ts:28` `useDensityPolicy()`，`:29-30` 读 `s.chatRenderDensity`
- 消费点：`FileChangeCard.tsx:42-44`、`components/chat/execution-outline.ts:18`
- 过程层外壳：`components/chat/AssistantMessage/execution-process-block.tsx`（thinking + tool calls + 中间文本，可折叠；流式中展开、结束自动折叠、手动覆盖）
- 卡片分发：`content-renderer.tsx:259` `toolBlockProps` → `tool-block-renderer.tsx`
- **关键空档**：`tool-block-renderer.tsx` 内 grep `density|Density` = **0 命中** ⇒ 密度没下沉，`text` 档目前只是「折叠/展开」开关
- 可复用的行式件：`lib/agent/sub-agents/step-descriptions.ts:114 generateStepDescription` / `:155 getStepStatusIcon` / `:169 getStepStatusColor`
- 参照物：`components/chat/SubAgentCard.tsx:77 SubAgentStepList`，`:84 useReducer` 强刷、`:85 listRef`、`:87-89` S-179 自动跟随（240px 视口只增不减）

**要动**：`execution-process-block.tsx`（text 档分支不走 `tool-block-renderer`）、`render-density.ts`（补行式参数，保持纯函数）、`execution-outline.ts`；测试目录 `tests/render-density/` 已存在可加断言。

### 5.3 S-256 流式超长卡死 —— 结论：**两个根因叠加，且「无步长上限」被测试写死成契约**

**根因 A：追帧步长无上限**
- `src/renderer/src/hooks/use-typewriter.ts:64` `getCatchupStep(poolSize, config)` = `Math.max(1, Math.ceil(poolSize / config.catchupFrames))` —— **无 `Math.min` 上限**；`:57-60` 注释自述几何衰减（「10k 字符 ~15 帧排干」）；调用点 `:150`
- 测试把「不设上限」钉成契约：`tests/streaming-render-pool/program.ts:57` 注释 `// ── No fixed-rate floor, no step cap ───`；`:68` 断言名 `a huge backlog is drained proportionally, not step-capped`

**根因 B：无空行 / fence 未闭合 ⇒ tail 全文累积、每帧全量重渲染**
- `src/renderer/src/hooks/use-streaming-markdown-blocks.ts:61 useStreamingMarkdownBlocks`
- 切块条件 `:108-121`：空行记 `pendingBlankStart`，下一非空行**非缩进**才 settle；`:124-128` fence 开合跟踪 ⇒ 长段落无空行 / 代码块未闭合时 tail **永不 settle**
- 全量渲染：`components/chat/AssistantMessage/markdown-renderer.tsx:471` `useStreamingMarkdownBlocks(renderPool.text, isStreaming)`
- `content-visibility`：全仓代码**零使用**

**要动**：`use-typewriter.ts:64`（加步长上限）+ `RenderPoolConfig` 增字段；`use-streaming-markdown-blocks.ts:108-121`（补兜底切块）；**必然连带改** `tests/streaming-render-pool/program.ts:57,68` 的契约口径。

### 5.4 S-260 浏览器保活池 —— 结论：**无保活、无上限、无 lease/evict；tab 已 per-session，只是从不回收**

**证据**
- 共用 partition：`src/shared/browser-plugin.ts:8` `BUILTIN_BROWSER_PARTITION = 'persist:wishfulclaw-browser'`（**全局一份，不是每会话一份**）
- per-session tab：`stores/ui-store.ts:517 ensureBrowserTab(url, sessionId, projectId, options)` → `:523` `tabId = scopedRightPanelTabId('browser', resolvedSessionId)` → `:524-525` 命中复用否则新建
- 转调与 ref 表：`ui-store-browser-slice.ts:31-32 openBrowserTab`、`:34-37 getBrowserWebviewRef`、`:40 setBrowserWebviewRef`
- 关闭：`ui-store.ts:217 closeRightPanelTab`、`:237-253 removeRightPanelTabsForSession`
- **无上限/无保活**：renderer 内 `保活|keepAlive|lease|evict` 零命中（只有 updater `releaseNotes` 噪声）；`MAX_|LIMIT|maxTabs` 唯一命中 `background-session-store.ts:13`（无关）
- 面板常驻：`components/layout/RightPanel.tsx:15` import `BrowserPanel`；`:255` 只有 `kind !== 'browser' && !== 'files'` 才渲染别的 ⇒ browser 走常驻分支，切走不卸载
- `BrowserPanel.tsx:1-3` 有 500 行豁免注释 ⇒ 改动要控制在 store 层，别碰它

**要动**：`ui-store.ts:517-560`（容量检查）、`ui-store-browser-slice.ts:31-32`（透传结果）、`ui-store-interface.ts`（类型）、`lib/tools/browser-native-ui.ts`（工具侧把 `pool-full` 转成给 agent 的话）、`right-panel-tab-factories.ts:9-13`（若做 LRU 需 `lastUsedAt`）；新增 `tests/browser-pool/`。

### 5.5 S-207 沙箱提权 `CannotWritePropertyWithinArray` —— **结论：早已修复，无需再做**

**这是本迭代必须纠正的一条误记。**

- 修复提交 **`b6a95eca`（2026-10-20）**：`fix(agent): 修沙箱申请工具请求包序列化与提示条落点（S-207）`
- `S-207.md:3` 状态行原文：**「已完成（阶段五审查修复 + 真机验证通过，2026-10-20）」**
- `S-207.md:349-350` 已把现象与根因写全：`SandboxElevationExecutor.BuildRequest` 用 `WorkerJsonHelper.BuildJsonElement(writer => …)` **漏写 `WriteStartObject()` / `WriteEndObject()`**，首 token 即属性名 ⇒ `Utf8JsonWriter` 抛 `InvalidOperationException`；发布包 AOT 裁掉 System.Text.Json 资源串，消息退化成 `CannotWritePropertyWithinArray, None`
- 该提交动了 5 个文件：`SandboxElevationExecutor.cs`（+6）、`sandbox-elevation-chip.tsx`、`SessionConversationPane.tsx`、`InputArea/index.tsx`、`S-207.md`
- 旁证扫描：`src/runtime` 全部 `.cs` 扫「`BuildJsonElement(` 后未先 `WriteStartObject/Array` 就 `WritePropertyName`」⇒ **0 命中**，无同类残留

⇒ **v3-iter-3 收尾时把它列进「遗留未排查」是错的**。可选动作只剩「加一条 AOT 冒烟断言防回归」，不构成需求。

### 5.6 Goal `KeyNotFoundException` —— 结论：**Goal 目录内无直接抛点，需一次运行时抓栈才能定案**

- 状态字典：`Goal/GoalOrchestrator.cs:21 ActiveGoals`、`:27 PendingGoals`、`:165 PendingGoals[goalId] = ...`（写侧非读索引）；`IsActive` `:32-38`
- `JsonElement.GetProperty`（属性缺失即抛 `KeyNotFoundException`）在 **Goal 相关文件零命中**；Goal 侧普遍走安全路径（`GoalModule.cs:32`、`JsonHelpers.cs:7-13`、`DbGoalExecutionRunTools.cs:31,104`、`AgentRuntimeGoalExecutorJson.cs:45-187` 全 `TryGetProperty`）
- 下标类：`Goal/GoalFileTools.cs:109-110` `state.Plans.IndexOf(plan)` 为 -1 时抛的是 `ArgumentOutOfRangeException`（**类型不符**）；`GoalOrchestratorAdaptive.Decision.cs:74` 已判空
- 非 Goal 文件的裸取点（跨链路候选）：`AgentRuntimeCronRunReader.cs:67 root.GetProperty("result")`、`AgentRuntimeGlobalDispatchReplyExecutor.cs:77/235/265 GetProperty(...)`

⇒ 抛点在 **Goal 之外、但被 Goal 流程调用**的层（DB 行解码 / Worker 响应解码 / 反向请求响应解码）。**定案前必须先抓一次运行时堆栈**，否则任何修法都是猜。另：本迭代 17:31 复跑 `npm test` **89/89 全过**（含 Goal 335 断言）⇒ 当前 HEAD 不复现。

## 六、风险与依赖（两条线合并）

| 项 | 风险 | 说明 |
|---|---|---|
| S-240 | **阻断** | `NormalizeManifestNode` 强制 ≥1 tool；三处必须同刀 |
| S-243 | 中 | 整机混音必含自身；handler 是 session 级 |
| S-241 | 高 | 权限全开 + partition 数据删不掉 |
| S-256 | **中高** | 步长上限与既有测试契约正面冲突，必须同步改口径；切块兜底可能影响 `tests/stream-segments/`、`tests/renderable-chat-items/` |
| S-248 | 中 | `tool-block-renderer.tsx` 密度零感知，text 档要绕过它 ⇒ 需处理 diff/终端/图片在行式文本下的降级 |
| S-260 | 中 | `ensureBrowserTab` 被多处调用，改成可失败需全链路处理返回值 |
| S-247 | 极低 | 纯新增消费端，Runtime 侧不用改 |
| S-207 | **无（已闭环）** | 仅建议加防回归断言 |
| Goal KeyNotFound | **高不确定** | 三条嫌疑全无直接证据，需运行时抓栈 |

**依赖顺序**：S-256 影响 S-248 / S-260 的交互体验验证，宜先做。

## 七、待决问题 —— 全部已拍定（2026-10-28 17:57 老大授权「根据你的建议来」）

### 7.1 技术一致性可判定的（自行拍定）

| # | 问题 | 拍定 | 依据 |
|---|---|---|---|
| 1 | 允许「零工具、只声明 views」的插件吗 | **允许**，放宽为「tools / views 至少一项」 | S-240 验收假插件就是只声明 views，不放宽没法起步 |
| 2 | 资产落盘根目录 | **`~/.wishful-claw/plugin-assets/`** | 与扩展/状态同根，符合现有 `resolveDataDir` 的 dev/packaged 区分 |
| 3 | 卸载 partition 目录删不掉 | **两段式**：本次 `clearStorageData`，下次启动补删 | `clearStorageData` ≠ 删目录，session 存活时必占用 |

### 7.2 老大授权后拍定（5 条）

| # | 问题 | 拍定 | 理由 |
|---|---|---|---|
| 4 | **S-256** 允许改掉 `tests/streaming-render-pool/program.ts:57,68` 的「不设步长上限」契约吗 | **允许改**，新口径「有上限，且上限内仍按比例追帧」 | 那两处断言是**把现状固化成需求**，不是产品意图。卡死是真实缺陷，必须让步。**同刀必须一起修根因 B**（tail 永不 settle）—— 只加步长上限，长段落无空行时仍每帧全量重渲染，卡死照旧 |
| 5 | **S-260** 上限 2 是全局还是每会话；满了拒绝还是 LRU | **全局 2**；满了**拒绝新开 + 结构化告知 agent**；**不做 LRU** | 老大原话已定死：「同时两个会话都要用浏览器 都能活着」「有两个活着就行了，要是能提示 agent 已经有两个是最好的」。LRU 会踢掉用户正在看的页面，比拒绝更糟 |
| 6 | **S-248** `text` 档完全不渲染卡片，还是「折叠 + 单行摘要」 | **完全不渲染工具卡片**，降级为纯文本行；**折叠保留**（复用现有折叠层）；**错误行红色** | 老大原话：「不呈现组件了，也不能点开组件查看，类似子 agent 卡片里面的显示方式」「折叠可以留，这样我们就还能复用之前的方式，只是组件的渲染变了而已」「错误丢了就丢了，文字行显示红色就行」 |
| 7 | **S-243** 系统 loopback 必然混入本程序自身播放音，接受吗 | **接受，暂不做「录制期间静音自身」** | Windows loopback 无按进程排除 API；主场景是「听会议 / 听别人说话」，此时本程序不播放。真出现「边放音乐边转写」再单独立需求 |
| 8 | **S-243** 实测不通时是否引入原生 WASAPI 模块 | **不引入**。第 0 刀实测失败则麦克风路径先交付，系统音挂账 | Electron 43 官方 `Streams.audio: 'loopback'` 已声明 Windows 支持，为尚未发生的假设引新 native 依赖（rebuild + 打包 + 签名）不值。测完再议 |

### 7.3 连带拍定

| # | 问题 | 拍定 |
|---|---|---|
| 9 | **S-247** 内存采样的消费形态 | **状态面板常驻数字 + 超阈值写日志**；轮询 **5 s**（低频，不干扰性能） |
| 10 | **Goal `KeyNotFoundException`** 是否授权跑测试抓栈 | **本迭代不做**。当前 HEAD `npm test` 89/89 不复现，无稳定复现路径的抓栈是浪费；维持挂账，复发即抓 |


