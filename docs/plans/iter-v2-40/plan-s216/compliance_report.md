# S-216 阶段三合规校验报告（第七轮 · plan v7）

> 校验时间：2026-10-21 11:49（+08:00）
> 校验对象：`docs/plans/iter-v2-40/plan-s216/plan.md`（**v7**，文件头标注「按第六份 compliance_report.md 的 2 个 ❌ + 9 个 ⚠️ 重写」）
> 对照基准：`docs/plans/iter-v2-40/requirements/S-216.md`、上一轮 `compliance_report.md`（v6 · 第六轮）、`docs/dev-workflow.md` 阶段三（:397-416）、`AGENTS.md` 大文件拆分硬线（:172-183）
> 校验方式：**只读**。实读 v7 全文（826 行）、S-216.md 全文、上一轮报告全文；实读 `src/renderer/src/lib/tools/tool-result-format.ts`（全 66 行）、`lib/tools/tool-types.ts`（全 67 行）、`lib/tools/browser-native-ui.ts`（:1-56 / :79-110 / :400-476）、`lib/tools/browser-tool.ts`（:1-40 / :200-260）、`lib/tools/browser-webview-helpers.ts`（全 144 行）、`lib/browser/webview-helpers.ts`（全 39 行）、`components/layout/BrowserPanel.tsx`（:1-200 / :200-365 / :360-470）、`stores/browser-session-helpers.ts`（:1-60 / :120-311）、`stores/ui-store-browser-slice.ts`（全 56 行）、`stores/ui-store.ts`（:505-556）、`stores/ui-store-interface.ts`（:180-200 区）、`stores/settings-store.ts`（:307-311）、`src/main/ipc/misc-handlers.ts`（:1-50 / :225-245）、`src/main/ipc/messagepack-handler.ts`（全 25 行）、`lib/ipc/ipc-client.ts`（:25-41）、`lib/ipc/channels.ts`（:340-380）、`lib/ipc/messagepack-channel-routing.ts`（:1-30 / :105-165）、`lib/app-plugin/types.ts`（全 115 行）、`components/settings/skill-panel.tsx`（:40-70）、`src/runtime/WishfulClaw.Agent/Tools/Providers/BrowserToolProvider.cs`（全 114 行）、`AgentRuntimeBrowserExecutor.cs`（:19-100）、`node_modules/electron/electron.d.ts`（`enableDeviceEmulation` :17930 / `disableDeviceEmulation` :17921 / `WebviewTag.getUserAgent` :19945 / `getWebContentsId` :19949 / `setUserAgent` :20130 / `reload` :20069 / `useragent` 属性文档 :20254-20259）、`node_modules/@types/react/index.d.ts`（`useRef` 重载 :1737-1761、`MutableRefObject` :1670）。
> 实测：17 个待改文件行数、8 个新建文件是否存在、新建目录是否冲突、`@types/react` 版本（19）。**未构建、未跑测试、未改任何源码或需求文档**（本报告除外）。仅用一次临时文件做 TS 函数参数可赋值性探针（`%TEMP%` 下，已删）。

## 结论

**PASS** —— ❌ **0** 项、⚠️ **8** 项（全部为「执行时补一行 / 可读性 / 口径文档」级别，不影响开工）。

- **上一轮 2 个 ❌ 都已真修，且修法正确**：
  1. `browser-device-native.ts` 的 import 已改为 `./tool-result-format`（plan.md:667），与磁盘上的 `tool-result-format.ts:19` 逐字对上，导出名 `encodeStructuredToolResult`、签名 `(value, format?) => string` 与调用处完全相容；
  2. hook 只剩**一版**实现（plan.md:533-614），空函数 `applyBrowserSyncOnly` 已从正文彻底消失（只在修订记录 :825 留存说明），`syncBrowserDeviceEmulation` 已正确导入（:538-541），`latestRef` 改为 hook 自持有 —— 逐条推演四个子问题后判定成立，`dom-ready` 补仿真不再恒 no-op。
- 上一轮 9 个 ⚠️：**已修 5**（⚠️10 / ⚠️N2 / ⚠️本-1 / ⚠️本-2 / ⚠️本-3）、**部分修 4**（⚠️11 / ⚠️5 / ⚠️本-4 / ⚠️本-5）。
- 本轮新发现 4 条，均属「执行体验 / 失败可见性」级别；无新的功能性硬伤，无编译性错误（唯一需要执行时补的是 3 行 import 与 1 处对象字面量，见 ⚠️R2）。

按 `docs/dev-workflow.md:414`「❌ 项 > 0 时禁止进入用户确认环节」，本方案**可以进入阶段四用户确认**。

## 总表

| # | 检查项 | 结果 | 说明 |
| --- | --- | --- | --- |
| 1 | 步骤覆盖需求目标（问题 1 / 问题 2 / §3.5 agent 工具） | ✅ | 问题 1 → 步骤 1（`committed-url.ts`）/3（`navigationSeq` 通道）/5（拆语义）；问题 2 → 步骤 1（预设表）/2（主进程 IPC）/3（设备状态）/4（应用层）/6（UI + hook）；agent 工具七处接线（:645-657）覆盖 `S-216.md §3.5` 的四处链路（声明 / 白名单 / 反向派发 / 占位），另补插件常量与文案。 |
| 2 | 每步验证检查点可执行 | ✅ | 9 步全部有检查点，且都是可判定断言：`npx tsc --noEmit -p tsconfig.web.json|node.json`、`npm run test:browser-device`、`BrowserEvaluate` 读 `window.innerWidth === 设备宽`（:713）、`grep dom-ready 回调内不出现 reload`（:444）、`BrowserPanel.tsx 实测 < 500`（:643）。步骤 5 给了 a~h 八条手工冒烟表（:512-523）。 |
| 3 | 文件路径 / 目录结构（AGENTS.md） | ⚠️ | 8 个新建文件父目录实测全部存在、无同名冲突（`lib/browser/` 现仅 `webview-helpers.ts`；`components/layout/` 38 项无同名；`tests/` 下无 `browser-device`）。§四 涉及文件表全部带 `src/` 前缀 ✅；但 §一 事实表仍残留裸路径（⚠️R1）。 |
| 4 | 分层依赖（main / renderer / shared / Worker） | ✅ | 主进程 `'../../shared/browser-device-presets'`：`src/main/ipc` 上溯两层 = `src/shared` ✅（`tsconfig.node.json` 无 `paths`，相对路径是唯一正确写法）；渲染端 `@shared` / `@renderer` 在 `tsconfig.web.json` 有配置，`BrowserPanel.tsx:4-22` 有同款先例；Worker 侧只加工具声明与白名单，不跨层。 |
| 5 | 技术路线正确性（UA / 设备仿真） | ✅ | `electron.d.ts:17921 disableDeviceEmulation()` / `:17930 enableDeviceEmulation(parameters: Parameters)` 实测存在；`Parameters` 六字段全必填、**无 UA 字段** ⇒「视口走主进程、UA 走 `setUserAgent`」双通道成立。`useragent` 属性文档（`:20254-20259`）明确「只在页面导航前生效，加载后请用 `setUserAgent`」，v7 :630-639 的 prop / method 分工与之完全一致。 |
| 6 | 500 行硬线（AGENTS.md:175） | ✅ | `browser-native-ui.ts` 实测 **476** → +3 ≈ 479 ✅。`BrowserPanel.tsx` 实测 **485**；v7 预算写 ~440，但未把「effect 由 4 行扩到 ~20 行」的 +16 计入，真实落点 ≈ **456**，仍 < 500，且备了 >490 抽 `browser-error-banner.tsx` 的预案（不贴豁免头）✅。`ui-store.ts` 556 属 store 豁免类（AGENTS.md:180），本方案只改 3 行。 |
| 7 | 测试可执行性（esbuild / alias / 收集） | ✅ | `package.json` 中 `--alias:@renderer=… --alias:@shared=…` 组合已有 6 处先例；`scripts/run-tests.mjs` 按 `test:` 前缀自动收 `npm test`；`tests/browser-device` 实测不存在，无冲突；被测两个模块（`browser-device-presets.ts` / `committed-url.ts`）均为零依赖纯函数，`--platform=node` 可直接 bundle。 |
| 8 | 代码事实断言（§一 事实表） | ✅ | 抽查 40+ 条全部属实：`BrowserPanel.tsx:47-48`、`:58`、`:126-129`、`:157-183`、`:222-247`（**确为 11 字段**）、`:251-363`（`useCallback(…, [])`，`:363` 空依赖）、`:278-288`、`:294-302`（`-3` 跳过）、`:367-431`（**正好 65 行**）、`:442/:447/:449`；`ui-store-browser-slice.ts:28-29`；`ui-store.ts:511-551`；`skill-panel.tsx:53` 确为 `setBrowserUrl`；`misc-handlers.ts:1` 确无 `webContents`、`:236-242` 桩恒回 `reuseEnabled:false`；`settings-store.ts:309` 默认 `true`；`channels.ts:353-362`；`routing:122-124`；`browser-native-ui.ts` **476 行** / `:428-449` switch；`app-plugin/types.ts` 常量 `:15-21` / 联合 `:33-47` / `toolNames :83-91`；`browser-tool.ts` `nativeOnlyBrowserResult :12-16`、`ALL_HANDLERS :233-242`。 |
| 9 | 与需求口径一致性 | ⚠️ | 三处收敛（去 `scale`、custom DPR 固定 3、缺省 390×844）在 §二 有记录，但与需求登记仍有漂移：`S-216.md:138-140` 仍写 `scale` 可选、`width/height` 缺省「回落当前预设」，需求文档未回写；§二 抬头「需老大确认」与正文「按协作口径自行定案」仍对冲；引用「需求登记 §五」有误（参数表在 §3.5）。见 ⚠️R3。 |
| 10 | 伪代码可直接落地（导入 / 类型 / 依赖数组） | ✅ | 上一轮 2 个 ❌ 全部闭合。逐行核对：`apply-browser-device.ts` 4 组 import 全部命中真实文件与导出；hook 的 `useRef` / `useCallback` / `useEffect` 依赖与作用域无悬空；`browser-device-native.ts` 的 import 名与步骤 1 的导出名逐字一致；`misc-handlers.ts` 的 `registerMessagePackHandler` 单参 handler 与 `messagepack-handler.ts:9-16` 一致，`ipcClient.invoke` 走 `args[0]`（`ipc-client.ts:36-38`）⇒ 主/渲染两端载荷形状对齐。剩余仅 3 行 import + 1 处对象字面量需执行时补齐（⚠️R2，非阻断）。 |
| 11 | 竞态 / 幂等 | ✅ | 同 key 同步占位、settle 即出表、不同 key 串行排队、`-3` 不提前结束、UA 失败回滚 —— 五条都在。新增的「agent 写 store + UI effect 双触发」被同 key 占位吸收（`setBrowserDevice` 与 `applyBrowserDevice` 同步发起，React 被动 effect 在毫秒级跟进，必落在 in-flight 窗口内）。`dom-ready` 每次导航都补一次仿真，`enableDeviceEmulation` 幂等且不产生导航 ⇒ 无自激。 |

## 上一轮 ❌ 复核（2 条逐一定论）

### ❌-1 `encodeStructuredToolResult` 的 import 路径 —— **真修，闭合**

| 核查点 | 实测 | 结论 |
| --- | --- | --- |
| 磁盘上是否存在 `tool-result.ts` | 不存在；同目录实际是 **`tool-result-format.ts`（66 行）** | — |
| 导出名 | `export function encodeStructuredToolResult(` @ `tool-result-format.ts:19` | ✅ 逐字一致 |
| 签名 | `(value: StructuredToolResult, format: ToolResultFormat = getCurrentToolResultFormat()): string`，`type StructuredToolResult = Record<string, unknown> \| unknown[]`（:13） | ✅ v7 调用 `encodeStructuredToolResult({ success, device, viewport, note })` 与 `encodeStructuredToolResult({ success:false, error })` 都传对象字面量，类型相容；返回 `string` |
| plan 写法 | `plan.md:667` `import { encodeStructuredToolResult } from './tool-result-format'`；`:660-669` 其余 5 组 import 全部落在真实文件（`@shared/browser-device-presets`、`@shared/browser-plugin`、`@renderer/stores/ui-store`、`./browser-webview-helpers`、`@renderer/lib/browser/apply-browser-device`） | ✅ |
| 与 `browser-native-ui.ts` 现有写法 | `:8` 就是 `from './tool-result-format'` | ✅ 口径统一 |

**定论：❌ 关闭。** 无新增同类问题（其余 import 已逐个核实，见文末附录）。

### ❌-2 hook 里的空函数 `applyBrowserSyncOnly` —— **真修，且四个子问题全部成立**

v7 步骤 6 只剩一版实现（`plan.md:557-614`）：`syncBrowserDeviceEmulation` 已导入（:538-541），`latestRef` 由 hook **自持有**并在每次渲染同步写（:563-564），`syncOnReady` 用 `useRef(fn).current` 固定引用（:572-579），`reapply` 用 `useCallback([webviewRef])`（:581-591），UI 触发用「首帧跳过 + 值比较」的 effect（:593-610）。逐问判定：

| 子问题 | 判定 | 推演 |
| --- | --- | --- |
| `useRef({...})` 初值 + 每次渲染重赋 `latestRef.current = {...}` 是否正确 | ✅ 正确 | 这是标准的 latest-ref 模式：`useRef` 只取首帧对象做容器，之后每次渲染把新值挂到 `.current`。容器身份不变 ⇒ 所有闭包拿到的都是同一个对象；`.current` 指向「最近一次已提交渲染」的值 ⇒ 回调在事件发生时读到最新值。渲染期写 ref 在这里不产生可见副作用（不触发渲染、不读 DOM），StrictMode 双渲染写入同值也安全。`desktopUserAgent` 这类字符串一并入 ref，避免把 props 固化成闭包。 |
| `syncOnReady = useRef(fn).current` 的 fn 内读 `latestRef.current`，能否读到最新值 | ✅ 能 | `useRef(fn)` 的初值只在首帧求值，`.current` 此后恒为**同一函数对象**；该函数体不闭包任何 props，只闭包 `latestRef`（稳定容器）与模块级 `syncBrowserDeviceEmulation`。调用发生在 `dom-ready`（远晚于渲染），因此读到的必然是当前渲染写入的值。⚠️ 唯一代价：每帧仍会新建一个被丢弃的箭头函数（无副作用，可忽略）。 |
| `reapply` 的 `useCallback([webviewRef])` 依赖是否合理 | ✅ 合理 | `webviewRef` 是 `useRef` 返回的稳定对象（`BrowserPanel.tsx:57`），作为依赖等价于空依赖 ⇒ `reapply` 恒为同一引用，不会让下游 effect 反复触发；而它需要的 `mode` / `customViewport` / `desktopUserAgent` 全部在调用时从 `latestRef.current` 现取 ⇒ 不存在陈旧闭包。`eslint-plugin-react-hooks` 也不会要求把 ref 放进/拿出依赖。 |
| 首帧跳过与「重复点同一设备」的关系，靠 picker 的 `reapply()` 补偿是否成立 | ✅ 成立（但有边界） | ① 首帧：`previousRef.current === null` ⇒ 只记基线、不触发，避免挂载即白 reload ✅。② 重复点同设备：`setBrowserDevice` 写入相同值后，`patchBrowserState` 仍会生成新 state 对象、`customViewport` 也可能是新对象 ⇒ effect **会**跑，但 `previous.mode === mode && width/height 相同` 会早退 ⇒ 不 reload；此时 picker 的 `onChange` 判定等值并直接 `reapply()`，且此刻 `latestRef.current` 仍是同一 mode ⇒ 目标正确 ✅。③ 预设之间互切时 `customViewport` 两侧多为 `null`，`undefined === undefined` 也成立，不会误判 ✅。④ 边界：这条补偿只覆盖「picker 的 onChange」这一条入口；若将来从菜单/快捷键/其他面板改设备，仍会「点了没反应」。 |

**定论：❌ 关闭。** 另附两点非阻断观察：(a) `syncOnReady` 用 `void` 丢弃结果，失败（如 guest 尚未 attach）不会留下任何日志，排障时看不到；(b) 首帧跳过 + `reapply` 的组合依赖「组件渲染时 `latestRef` 已写入」，wire #2 把 hook 调用放在 `webviewRef` 声明之后、`latestRef` 字面量（:222）之前，顺序正确，执行时不要改动该顺序。

## 上一轮 ⚠️ 复核（9 条）

| # | 上一轮问题 | v7 状态 | 说明与证据 |
| --- | --- | --- | --- |
| ⚠️10 | 面板未挂载时丢失设备意图 | **已修** | `executeBrowserSetDevice` 现在**先** `setBrowserDevice({mode, customViewport}, ctx.sessionId, ctx.projectId)`（:685），**再** `getWebview(ctx)`；无 webview 时返回 `{ success:true, device, viewport:null, note:'已记录设备设置，浏览器面板打开后自动生效' }`（:688-695）。落地面成立：面板挂载时 `effectiveUserAgent` prop（:633-635）决定新元素首帧 UA，`dom-ready → syncOnReady` 补视口（:623）⇒ 两条通道都在。**判定**：符合需求意图（意图先落地、不让调用失败），但 `success:true` 不带 `applied` 字段，agent 无法区分「已生效」与「已排队」，见 ⚠️R5。 |
| ⚠️11 | §一 残留裸路径 | **未修** | `plan.md:17` `BrowserPanel.tsx:278-288`、`:37` `ui-store-browser-slice.ts:31-32` / `ui-store.ts:511-551`、`:38` `skill-panel.tsx:53`、`:45` `lib/tools/browser-webview-helpers.ts:18`、`:51` `misc-handlers.ts:236-242` 仍是短形式。（§四 涉及文件表已全部带 `src/`。）纯规范瑕疵，见 ⚠️R1。 |
| ⚠️N2 | 同址回车判等用 `committedUrl`，与 agent 直设 `src` 脱钩 | **已修** | 判等改为 `isSameBrowserUrl(normalized, storedUrl)`（:488），并明写「同址比较用 `storedUrl`，不是 `committedUrl`」（:478）。正确性核实：`storedUrl` 由 `onNavigate` / `onNavigateInPage`（`BrowserPanel.tsx:278-288`）在每次真实导航后回写，agent 的 `executeBrowserNavigate`（`browser-native-ui.ts:97-101`）设完 `src` 也会触发 `did-navigate` ⇒ 不变式「storedUrl === 实际地址」成立；且 v7 让 `ensureBrowserTab` 一并递增 `navigationSeq`（:254），agent 导航后 `committedUrl` 也会被规则 2 追上，不再脱钩。 |
| ⚠️5 | 需求参数口径漂移（`scale` / custom DPR / 缺省回落） | **部分修** | §二 抬头仍是「需老大确认的口径变更」，正文仍写「按协作口径自行定案」⇒ 标题与正文对冲；引用「需求登记 §五」仍错（参数表实际在 `S-216.md §3.5`，§五 是「预计改动面」）；`S-216.md:138-140` **未回写**，仍写 `scale` 可选、缺省回落「当前预设」。实现侧（预设表 + 工具 schema + 执行器）三处完全自洽，不影响落地。见 ⚠️R3。 |
| ⚠️本-1 | `void promise.finally(...)` 未兜 reject | **已修** | 改为 `void promise.then(noop, noop).then(() => { 身份校验 + 删表 })`（:347-352）。推演：`then(noop,noop)` 同时注册成功与失败回调 ⇒ 无论 `promise` resolve 还是 reject，这条链都**不会** reject；第二条 `.then` 的上游因此恒为 fulfilled ⇒ 清理一定执行、且不会产生 unhandled rejection。比 v6 的 `.finally()` 更稳（`.finally` 会把 reject 传递给下游）。身份校验 `inFlight.get(id)?.promise === promise` 保证覆盖写时不会误删别人的条目 ✅。 |
| ⚠️本-2 | `reloadAndWait` 未忽略 `-3`（ERR_ABORTED） | **已修** | `const ERR_ABORTED = -3`（:293）；`onFail` 现在 `if (!event.isMainFrame) return` + `if (event.errorCode === ERR_ABORTED) return`（:410-414），与 `BrowserPanel.tsx:295` 的既有口径一致。`Electron.DidFailLoadEvent` 确有 `isMainFrame`，`onFail as EventListener` 的断言与 `:347` 同款 ✅。 |
| ⚠️本-3 | 同一设备重复点击在 UI 侧永远 no-op | **已修** | 接线 #5（:624）在 `setBrowserDevice` 之后做等值判定，命中即 `reapply()`；:626 写明原因。判定成立（见上一节第 4 问）。残留边界（只覆盖 picker 入口）记为 ⚠️R7 的一部分，不阻断。 |
| ⚠️本-4 | 步骤 5/6/7 缺若干接线行 | **部分修** | ✅ 已补：`requestBrowserNavigation` selector（:620）、`deviceMode` / `customViewport` selector（:620）、`setBrowserDevice` selector（:620）、hook 调用整行（:621）、`latestRef` 4 字段（:622）、`dom-ready` 注册与 cleanup（:623）。❌ 仍缺：`nextCommittedUrl` / `isSameBrowserUrl` 的 import（步骤 5 代码块 :450-476 / :488 直接使用，全文无 import 行）；`forgetBrowserDeviceState` 的 import（:623 使用）；`resolveBrowserDeviceViewport` 的 import（:633 使用）；`webviewSessionProps.useragent` 仍只是注释 `// webviewSessionProps.useragent = effectiveUserAgent`（:635），没写成对 `:65` 对象字面量的实际替换；`browser-tool.ts` 仍只写「占位 definition」（:653），未提必须在 `ALL_HANDLERS`（`browser-tool.ts:233-242`）追加一项，否则 `registerBrowserTool()`（:246-250）不会注册该工具。均属「执行时补一行」，见 ⚠️R2。 |
| ⚠️本-5 | `setBrowserDevice` 只传 `sessionId`，非激活项目可能写错作用域 | **部分修** | v7 已「成对传」`ctx.sessionId, ctx.projectId`（:685）。但实测 **`ToolContext`（`tool-types.ts:12-46`）没有 `projectId` 字段**；更关键的是上游从不产生它：`createToolContext`（`browser-native-ui.ts:42-56`）只读 `sessionId / workingFolder / toolUseId / agentRunId / runId`，Worker 的 `CreateBrowserRequest`（`AgentRuntimeBrowserExecutor.cs:74-96`）只写 `runId / agentRunId / toolUseId / toolName / sessionId / workingFolder / input`。因为函数签名是 `ctx: any`（:671），**不会编译失败**，但运行期 `ctx.projectId` 恒为 `undefined`，v7 :711 那句「以 `ToolContext` 实际字段为准」实际只有一种可能：走 `resolvePanelScope` 的 session 反查。对 session 级面板正确；对 project 级/全局面板（`sessionId` 为空）会落到 `activeScopedProjectId`（`browser-session-helpers.ts:141-153`），存在「视口已切、picker 还显示 PC」的错位。见 ⚠️R4。 |

**小计**：已修 **5**（⚠️10 / ⚠️N2 / ⚠️本-1 / ⚠️本-2 / ⚠️本-3）、部分修 **4**（⚠️11 / ⚠️5 / ⚠️本-4 / ⚠️本-5）。

> 作者自述「已修掉上一轮的 2 个 ❌ 与 9 个 ⚠️」—— **2 个 ❌ 全部为真**，⚠️ 部分为 5 修 / 4 部分修，**无一条恶化、无一条修出新错**。

## 本轮新发现

### ⚠️R5 「未挂载也 success」缺 `applied` 语义位（非阻断）

`executeBrowserSetDevice` 的两条成功路径返回结构不同：未挂载 `{ success:true, device, viewport:null, note }`（:689-694），已挂载 `{ success:true, device, viewport }`（:704-705）。agent 只能靠「`viewport === null`」推断没生效 —— 而 `pc` 模式**正常生效时 `viewport` 也是 `null`**（`resolveBrowserDeviceViewport('pc')` 返回 null，:116-117），两种语义撞在同一个值上。建议补 `applied: boolean`（未挂载 `false`）或 `mode:'pc' → disabled:true`，`note` 里明确「先 `BrowserNavigate` 再切」。

**判定：不影响需求目标**（意图已落 store，面板挂载后 UA prop + `dom-ready` 两条通道都会生效，:633-635 / :623），只是返回值可读性问题。

### ⚠️R6 `custom` 宽高输入若逐键 `onChange` 会逐键 reload

`BrowserDevicePicker` 的 `onChange` 直接 `setBrowserDevice`（:624），而 hook 的 effect（:593-610）对 `width/height` 变化无防抖 ⇒ 输入 `1200` 会在 `1`、`12`、`120`、`1200` 各触发一次 `applyBrowserDevice`（每次含 `setUserAgent` + IPC + reload）。由于不同 key 会串行排队（:342），不会交错，但会把用户输入卡住几秒。建议 picker 内部对宽高用本地 state，`onBlur` / `Enter` 才 `onChange`。

### ⚠️R7 `syncOnReady` 与 `reloadAndWait` 的「失败不可见」

- `syncOnReady` 里 `void syncBrowserDeviceEmulation({...})`（:573-578）丢弃返回值：`getWebContentsId()` 抛错、IPC 拒绝、主进程回 `{success:false}` 都不会留下任何痕迹（无 `console.warn`、无 store 标记）。webview 重建期偶发失败时，用户看到的是「选择器显示 iPhone、页面是 PC」，正好是 §六 第一条风险。
- `reloadAndWait`（:397-424）在**主框架真失败**（非 `-3`、非子帧）时也直接 `finish()` ⇒ `runDeviceSwitch` 仍 `return {ok:true}` ⇒ agent 收到成功，紧接着 `BrowserScreenshot` 可能拍到错误页。建议失败分支带 `errorCode` 返回 `{ok:false}` 或至少在结果里加 `loaded:false`。

### ⚠️R8 工具栏抽取后 `inputUrl` 的归属没写清

步骤 6 说把 `BrowserPanel.tsx:367-431`「整块搬出」，但步骤 5 的新 effect 仍然调用 `setInputUrl(storedUrl)`（:464）、`navigate()` 仍然被工具栏的「Go」按钮和 `handleKeyDown` 使用（`BrowserPanel.tsx:413-430`）。若把 `inputUrl` / `setInputUrl` 一起搬进 `BrowserToolbar`，父组件的 effect 就没有 setter 可调（TS2304）；正确做法是 **state 留在父组件**，把 `value` / `onChange` / `onKeyDown` / `onGo` 作为 props 传下去。实现本身不难，只是 plan 未点明，容易踩。

## 必须修复项清单（❌）

**无。**

上一轮 2 个 ❌ 已闭合，本轮未发现任何「会导致编译失败 / 运行错 / 需求目标落空 / 破硬约束」的问题。下列 ⚠️ 全部可在执行阶段顺手消化，不构成进入阶段四的阻断。

## 建议修复项清单（⚠️）

| # | 问题 | 建议落点 |
| --- | --- | --- |
| ⚠️R1 | §一 事实表残留裸路径（上轮 ⚠️11 未修） | `plan.md:17 / :37 / :38 / :45 / :51` 统一补 `src/renderer/src/` / `src/main/ipc/` 前缀。纯规范。 |
| ⚠️R2 | 步骤 5/6/7 仍缺 3 行 import + 1 处字面量（上轮 ⚠️本-4 残留） | ① `BrowserPanel.tsx` 顶部补 `import { nextCommittedUrl, isSameBrowserUrl } from '@renderer/lib/browser/committed-url'`、`import { forgetBrowserDeviceState } from '@renderer/lib/browser/apply-browser-device'`、`import { resolveBrowserDeviceViewport } from '@shared/browser-device-presets'`；② 把 `:635` 的注释改写为对 `:65` 的实际替换 `...(effectiveUserAgent ? { useragent: effectiveUserAgent } : {})`；③ `browser-tool.ts` 明写「`browserSetDeviceHandler` 追加进 `ALL_HANDLERS`（:233-242）」，否则 `registerBrowserTool()` 不会注册。**照抄代码块而不补①②会 TS2304，补上即可。** |
| ⚠️R3 | 口径变更的表述与需求文档不一致（上轮 ⚠️5 残留） | 二选一：①保留「需老大确认」，删掉正文「自行定案」，并把三处收敛回写 `S-216.md §3.5`（改 `:138-140`）；②改成「已定案的工程细节」并回写需求。同时把「需求登记 §五」改为「§3.5」。 |
| ⚠️R4 | `ctx.projectId` 实际不存在（`ToolContext` 无此字段，上游也不传） | 二选一：①诚实写法 —— `setBrowserDevice({...}, ctx.sessionId)`，并在注释里说明 project 由 `resolveProjectIdForSession` 反查；②真要支持 project 级面板，则扩 `ToolContext` + `createToolContext`（`browser-native-ui.ts:42-56`）读 `record.projectId` + `CreateBrowserRequest`（`AgentRuntimeBrowserExecutor.cs:74-96`）写 `projectId`，三处一起改，并把 `ctx` 参数类型从 `any` 收成 `ToolContext`。 |
| ⚠️R5 | 未挂载时 `success:true` 与 `pc` 生效都表现为 `viewport:null`，语义撞车 | 返回体补 `applied: boolean`（未挂载 `false`、已挂载 `true`）；`note` 明确「尚未生效，打开面板或先 `BrowserNavigate` 后生效」。 |
| ⚠️R6 | `custom` 宽高逐键写 store ⇒ 逐键 reload | `BrowserDevicePicker` 内宽高用本地 state，`onBlur` / `Enter` 才回调 `onChange`；或 hook 侧对同 mode 的尺寸变化做 300ms 防抖。 |
| ⚠️R7 | `syncOnReady` 静默吞失败；`reloadAndWait` 主框架真失败也当成功 | `syncOnReady` 失败至少 `console.warn('[BrowserPanel] device emulation sync failed', result.error)`；`reloadAndWait` 的 `onFail`（非 `-3`、`isMainFrame`）把 `errorCode` 带出，`runDeviceSwitch` 返回 `{ok:false, error:'… (code)'}`。 |
| ⚠️R8 | 工具栏抽取后 `inputUrl` / `setInputUrl` 归属未写清 | 在步骤 6 明确：`inputUrl` state 与 `handleKeyDown` 留在 `BrowserPanel`，`BrowserToolbar` 只收 `value / onChange / onKeyDown / onGo / loading / canGoBack / canGoForward / runWebviewCommand` 等 props；顺带把行数预算改写为 `485 − 65 − 25 + 61 ≈ 456`。 |

## 附：实测数据（2026-10-21 11:49）

### 待改文件行数（`(Get-Content).Count`，与 plan §一 声明逐项对照）

| 文件 | 实测行数 | plan 声明 | 判定 |
| --- | --- | --- | --- |
| `src/renderer/src/components/layout/BrowserPanel.tsx` | **485** | 485 | ✅ 一致；真实落点估 ≈456，< 500 |
| `src/renderer/src/lib/tools/browser-native-ui.ts` | **476** | 476 | ✅ +3 ≈ 479 |
| `src/renderer/src/lib/tools/browser-tool.ts` | 260 | 260 | ✅ |
| `src/renderer/src/lib/tools/tool-result-format.ts` | 66 | — | ✅ `encodeStructuredToolResult :19` |
| `src/renderer/src/stores/ui-store.ts` | **556** | 556 | ✅ store 豁免类（AGENTS.md:180），只改 3 行 |
| `src/renderer/src/stores/browser-session-helpers.ts` | 312 | 312 | ✅ 接口 `:39-53`、`DEFAULT :65-79`、合并 patch `:289-295` |
| `src/renderer/src/stores/ui-store-interface.ts` | 290 | 290 | ✅ `patchBrowserState :198`（`projectId?` 可选），新 action 照此声明即可（已实测「实现必填参数 vs 接口可选参数」在本仓库 `--strict` 下可赋值） |
| `src/renderer/src/stores/ui-store-browser-slice.ts` | 56 | 56 | ✅ `patchBrowserState :28-29`、`resolvePanelScope` / `getBrowserStateFromMap` 已导入 |
| `src/main/ipc/misc-handlers.ts` | 289 | 289 | ✅ `:1` 确无 `webContents`；`:236-242` 为现成 browser 段，新 handler 插此 |
| `src/renderer/src/lib/ipc/channels.ts` | 423 | 423 | ✅ `:353-362` 段确认 |
| `src/renderer/src/lib/ipc/messagepack-channel-routing.ts` | 438 | 438 | ✅ `:122-124` 三条 `browser:` |
| `src/renderer/src/lib/app-plugin/types.ts` | 115 | 115 | ✅ 常量 `:15-21` / 联合 `:33-47` / `toolNames :83-91` |
| `src/renderer/src/components/settings/skill-panel.tsx` | 236 | 236 | ✅ `:53` 确为 `setBrowserUrl(SKILLHUB_URL, SKILL_MARKET_SESSION_ID, null)` |
| `src/renderer/src/lib/tools/browser-webview-helpers.ts` | 144 | 144 | ✅ `getWebview :18-22`（`isWebviewConnected` 守卫）、统一导出 `:134-144` |
| `src/renderer/src/lib/browser/webview-helpers.ts` | 39 | — | ✅ `isWebviewConnected :18-22`（类型守卫签名与 plan 用法一致） |
| `BrowserToolProvider.cs` | 114 | — | ✅ 9 个工具 `:22-123`，新工具照 `ToolDefinitionPlaceholder` + `BrowserToolSchema.CreateObjectSchema` 写 |
| `AgentRuntimeBrowserExecutor.cs` | 125 | — | ✅ `BrowserToolNames :25-36`；`CreateBrowserRequest :74-96` **只写 sessionId / workingFolder，无 projectId** |

### 新建文件冲突核查（全部 `Test-Path = False`，父目录均存在）

`src/shared/browser-device-presets.ts`、`src/renderer/src/lib/browser/committed-url.ts`、`src/renderer/src/lib/browser/apply-browser-device.ts`（该目录现仅 `webview-helpers.ts`）、`src/renderer/src/lib/tools/browser-device-native.ts`、`src/renderer/src/components/layout/browser-toolbar.tsx`、`.../browser-device-picker.tsx`、`.../use-browser-device-emulation.ts`（`layout/` 现 38 项，无同名；`use-preview-save.ts` 是同款 hook 命名先例）、`tests/browser-device/program.ts`（`tests/` 下只有 `browser-user-agent`，不撞；目录名不匹配 `WishfulClaw.*RegressionTests`，不会被 C# 侧误收）。

### import 逐个核实（仅列本轮变更/新增项）

| # | 文件 | 符号 | plan 路径 | 实际 | 结论 |
| --- | --- | --- | --- | --- | --- |
| 1 | `browser-device-native.ts` | `encodeStructuredToolResult` | `./tool-result-format` | `lib/tools/tool-result-format.ts:19` | ✅（上轮 ❌ 已闭合） |
| 2 | 同上 | `applyBrowserDevice` | `@renderer/lib/browser/apply-browser-device` | 待建，步骤 4 `export function applyBrowserDevice` | ✅ |
| 3 | 同上 | `isBrowserDeviceMode` / `normalizeViewportSide` / `DEFAULT_CUSTOM_VIEWPORT` | `@shared/browser-device-presets` | 待建，步骤 1 三者均导出 | ✅ |
| 4 | `use-browser-device-emulation.ts` | `syncBrowserDeviceEmulation` | `@renderer/lib/browser/apply-browser-device` | 步骤 4 `export async function`（:296） | ✅（上轮 ❌ 已闭合） |
| 5 | `apply-browser-device.ts` | `IPC` / `ipcClient` | `@renderer/lib/ipc/channels` / `…/ipc-client` | `channels.ts` 常量对象；`ipc-client.ts:30-41` | ✅ |
| 6 | `misc-handlers.ts` | `webContents` | `electron` | `electron.d.ts` 导出；现文件 `:1` 无 | ✅ 需新增（plan 已写） |
| 7 | `misc-handlers.ts` | `registerMessagePackHandler` | `./messagepack-handler` | `:9-16`：`<TArgs, TResult = unknown>(channel, handler: (args, event) => …)` | ✅ handler 单参形式一致 |
| 8 | `BrowserPanel.tsx` | `nextCommittedUrl` / `isSameBrowserUrl` / `forgetBrowserDeviceState` / `resolveBrowserDeviceViewport` | **缺 import 行** | 分别来自待建 `committed-url.ts`、步骤 4 `apply-browser-device.ts`、待建 `browser-device-presets.ts` | ⚠️ 见 ⚠️R2（符号本身都有） |
| 9 | `browser-tool.ts` | `nativeOnlyBrowserResult` | 同文件 | `:12-16` 局部函数（未 export），同文件调用合法 | ✅；`ALL_HANDLERS :233-242` 追加项未写（⚠️R2） |

### Electron / React 类型事实（本轮复核）

| 事实 | 位置 | 结论 |
| --- | --- | --- |
| `enableDeviceEmulation(parameters: Parameters)` / `disableDeviceEmulation()` | `electron.d.ts:17930` / `:17921` | ✅ 存在，无需 `debugger.attach()` |
| `WebviewTag.getUserAgent(): string` | `:19945` | ✅ `runDeviceSwitch` 的 `previousUserAgent` 回滚来源成立 |
| `WebviewTag.getWebContentsId(): number` / `setUserAgent(userAgent)` / `reload()` | `:19949` / `:20130` / `:20069` | ✅ 均存在 |
| `webview.useragent` 属性语义 | `:20254-20259` | ✅「导航前生效；已加载请用 `setUserAgent`」⇒ prop / method 双通道分工正确 |
| `useRef` 返回类型 + `MutableRefObject` 是否仍可用 | `@types/react` **19**，`useRef` 重载 `:1737-1761`（`RefObject<T>`，`current` 可变）、`MutableRefObject :1670` | ✅ hook 入参 `React.MutableRefObject<Electron.WebviewTag \| null>` 与 `BrowserPanel.tsx:57` 的 `useRef<… \| null>(null)` 结构相容，不会报错 |

---

**校验声明**：本报告基于 2026-10-21 11:49 的工作区状态（`plan-s216/` 仍为未跟踪目录，S-216 相关源码未改动，8 个新建文件均不存在；`ui-store.ts` 已超 500 行为既有事实，非本方案引入）。只读取源码与文档，**未执行构建或测试，未修改除本报告外的任何文件**；唯一临时产物是 `%TEMP%\wc-arity-probe.ts`（用于验证「实现必填参数 / 接口可选参数」在本仓库 tsconfig 下可赋值），已删除。本报告**覆盖写入**，不保留第六轮内容（第六轮结论见 git 历史 / 上轮对话）。
