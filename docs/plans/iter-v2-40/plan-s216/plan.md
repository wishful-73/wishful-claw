# Plan: S-216 内置浏览器站内切换被强制重载 + 无法查看 H5

> 需求正文：[../../requirements/S-216.md](../../requirements/S-216.md)
> 迭代：iter-v2-40　分支：`dev/v2-iter-40`　状态：**执行中**
> 版本：v7（2026-10-21，按第六份 [compliance_report.md](compliance_report.md) 的 2 个 ❌ + 9 个 ⚠️ 重写）

## 目标

一句话：**站内切 tab 不再整页重载；内置浏览器能按 iPhone / Pixel / iPad / 自定义切到移动端形态看 H5，用户点得到、agent 也调得到。**

## 一、探索结论（已实读，非推测）

### 问题 1 的自激闭环

```
webview 站内跳转
  → onNavigate / onNavigateInPage（BrowserPanel.tsx:278-288）
  → setBrowserUrl(e.url)            // 回写 store，:280 / :286
  → storedUrl 变
  → useEffect([storedUrl])（:126-129）setCommittedUrl(storedUrl)
  → <webview src={committedUrl}>（:449）src 变
  → Electron 认为 src 赋值即导航 ⇒ 整页重载
```

### 关键事实表

| 事实 | 位置 | 对方案的影响 |
| --- | --- | --- |
| `committedUrl` / `inputUrl` 初值取自 `storedUrl` | `BrowserPanel.tsx:47-48` | 首次挂载天然正确 |
| `committedUrl` 为空 ⇒ webview 不渲染 | `BrowserPanel.tsx:442` | 切会话可清空；首次靠 `storedUrl` 挂载 |
| `<webview key>` 含「复用浏览器数据」开关 ⇒ 切开关重建 | `BrowserPanel.tsx:447` | 重建时 `src` 取 `committedUrl` |
| `webviewRef` 是 `useRef`，赋值不触发 re-render | `BrowserPanel.tsx:258` | 重建时 hook effect 不重跑 ⇒ 重放挂 `dom-ready` |
| `latestRef` 现有 11 个字段 | `BrowserPanel.tsx:222-247` | 新状态必须加进去 |
| `initialBrowserUserDataReuseEnabledRef` 已存在 | `BrowserPanel.tsx:58` | 做首帧基线 |
| `runWebviewCommand` 是**组件内局部包装**，签名 `(action, command)` | `BrowserPanel.tsx:109-124` | `navigate` 直接调用，**无需导入** |
| `onFailLoad` 现有写法会跳过 `errorCode === -3`（ERR_ABORTED） | `BrowserPanel.tsx:295` | `reloadAndWait` 必须照此，否则新导航打断会提前 resolve |
| `openBrowserTab` → `ensureBrowserTab` 只 patch `url` | `ui-store-browser-slice.ts:31-32`、`ui-store.ts:511-551` | 删 effect 后外部打开会失效 ⇒ 需补偿通道 |
| `setBrowserUrl` 实测 **4 个**调用点：`BrowserPanel.tsx:164` / `:280` / `:286`、`skill-panel.tsx:53` | 同上 | 语义必须拆 |
| 全仓 `<webview>` 仅 `BrowserPanel.tsx:446`、`FreeChatPage.tsx:197` | — | 无第三条绕过 store 的写 `src` 路径 |
| `webview.useragent` 属性**只对导航前生效**，已加载后要用 `setUserAgent` | `electron.d.ts:20254-20259` | 重建靠 prop，运行时切靠方法 |
| `did-finish-load` / `did-fail-load` / `dom-ready` 均在 WebviewTag 事件声明中 | `electron.d.ts:19646-19653` / `:19677` | `reloadAndWait` 与重放可行 |
| `Electron.DidFailLoadEvent` 有 `isMainFrame` | `electron.d.ts:21400-21405` | 子帧失败不提前结束 |
| `webContents.enableDeviceEmulation` / `disableDeviceEmulation` 可用；`Parameters`（`:22931-22959`）六字段、**无 UA** | `electron.d.ts:17930` / `:17921` | 视口与 UA 两条独立通道 |
| `enableDeviceEmulation` 即时生效，不要求 reload | Electron API 语义 | ⇒「补仿真」与「重载」可解耦 |
| `getWebview(ctx)` 返回 `ElectronWebview \| null` | `lib/tools/browser-webview-helpers.ts:18` → `:134` | **全仓无 `getBrowserWebview`** |
| `isWebviewConnected` | `lib/browser/webview-helpers.ts:18` | 守卫用 |
| `encodeStructuredToolResult` / `encodeToolError` 来自 **`./tool-result-format`** | `browser-native-ui.ts:8` | v6 误写 `./tool-result`，已改 |
| `stripElectronFromUserAgent` | `src/shared/browser-plugin.ts:38`，映射 `@shared/browser-plugin` | UA 来源 |
| `registerMessagePackHandler<TArgs, TResult>`，handler 为**单参**对象 | `main/ipc/messagepack-handler.ts:9-11` | 签名照此 |
| `patchBrowserState(sessionId, patch, projectId)` 只吃 plain patch；`resolvePanelScope` / `getBrowserStateFromMap` 已在该文件导入 | `ui-store-browser-slice.ts:5-29` | slice 实现可直接用 |
| `settings-store.ts:309` 的 `browserUserDataReuseEnabled` 默认 **true**；`browser:emulation-status` 桩恒回 **false** | `misc-handlers.ts:236-242` | **每次挂载必翻一次 key、重建一次 webview**（既有行为，规则 4 兜住） |
| `misc-handlers.ts` 顶部**未导入 `webContents`** | `misc-handlers.ts:1` 区 | 必须补 |
| `browser-native-ui.ts` 实测 **476 行**，`:428-449` switch | — | executor 必须拆独立文件 |
| 实测行数：`BrowserPanel.tsx` 485 / `ui-store.ts` 556 / `browser-tool.ts` 260 / `browser-session-helpers.ts` 312 / `ui-store-interface.ts` 290 / `ui-store-browser-slice.ts` 56 / `misc-handlers.ts` 289 / `channels.ts` 423 / `routing` 438 / `app-plugin/types.ts` 115 / `skill-panel.tsx` 236 | — | 除 `ui-store.ts`（已超限，本方案只改 3 行）外均安全 |
| `tsconfig.node.json` 无 `paths` | `tsconfig.node.json` | 主进程引用共享层写相对路径 |
| `tests/` 由 `scripts/run-tests.mjs` 收集 `package.json` 的 `test:*` | `package.json:23-82` | 新脚本自动进 `npm test` |
| 仓库无 `tsx` 依赖 | `node_modules/tsx` 不存在 | 测试脚本用 esbuild |

## 二、需老大确认的口径变更（相对需求登记 §五）

需求 §五 登记的工具参数是 `device, width?, height?, scale?`。方案做了三处收敛，**按协作口径自行定案，此处显式记录**：

| # | 变更 | 理由 |
| --- | --- | --- |
| 1 | 去掉 `scale` 参数 | 无法可靠存放与复原；1:1 渲染已够用 |
| 2 | `custom` 的 DPR 固定 3 | 不暴露给 agent，减少无效参数面 |
| 3 | `custom` 缺省 390 × 844，宽高夹到 320~2560 | 防 agent 传 0 / 负数 / 超大值把面板搞崩 |

老大若要改，改 `browser-device-presets.ts` 一张表即可，不动调用方。

## 三、步骤清单

### 步骤 1：设备预设表 + 导航目标状态机（纯函数）

- [x] 新建 `src/shared/browser-device-presets.ts`

```ts
export const BROWSER_DEVICE_MODES = ['pc', 'iphone', 'pixel', 'ipad', 'custom'] as const
export type BrowserDeviceMode = (typeof BROWSER_DEVICE_MODES)[number]
export const DEFAULT_BROWSER_DEVICE_MODE: BrowserDeviceMode = 'pc'
export const DEFAULT_CUSTOM_VIEWPORT = { width: 390, height: 844 } as const
export const CUSTOM_VIEWPORT_MIN = 320
export const CUSTOM_VIEWPORT_MAX = 2560

export interface BrowserDeviceViewport {
  width: number
  height: number
  deviceScaleFactor: number
  userAgent: string
}

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const IPAD_USER_AGENT =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

/** 规整到 [MIN, MAX] 的整数；非法值回落 fallback。 */
export function normalizeViewportSide(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(CUSTOM_VIEWPORT_MAX, Math.max(CUSTOM_VIEWPORT_MIN, Math.round(parsed)))
}

export function isBrowserDeviceMode(value: unknown): value is BrowserDeviceMode {
  return typeof value === 'string' && (BROWSER_DEVICE_MODES as readonly string[]).includes(value)
}

/** pc 返回 null —— 表示「取消仿真、回到桌面形态」 */
export function resolveBrowserDeviceViewport(
  mode: BrowserDeviceMode,
  custom?: { width?: number; height?: number } | null
): BrowserDeviceViewport | null {
  switch (mode) {
    case 'pc':
      return null
    case 'iphone':
      return { width: 390, height: 844, deviceScaleFactor: 3, userAgent: IOS_USER_AGENT }
    case 'pixel':
      return { width: 412, height: 915, deviceScaleFactor: 2.625, userAgent: ANDROID_USER_AGENT }
    case 'ipad':
      return { width: 820, height: 1180, deviceScaleFactor: 2, userAgent: IPAD_USER_AGENT }
    case 'custom':
      return {
        width: normalizeViewportSide(custom?.width, DEFAULT_CUSTOM_VIEWPORT.width),
        height: normalizeViewportSide(custom?.height, DEFAULT_CUSTOM_VIEWPORT.height),
        deviceScaleFactor: 3,
        userAgent: IOS_USER_AGENT
      }
    default:
      return null
  }
}

/** 去重键由**夹取后**的视口派生，保证与真实生效值一致。 */
export function browserDeviceKey(
  mode: BrowserDeviceMode,
  custom?: { width?: number; height?: number } | null
): string {
  const viewport = resolveBrowserDeviceViewport(mode, custom)
  return viewport ? `${mode}:${viewport.width}x${viewport.height}` : mode
}
```

- [x] 新建 `src/renderer/src/lib/browser/committed-url.ts`

```ts
export interface CommittedUrlInput {
  prev: string
  storedUrl: string
  navigationSeq: number
  prevNavigationSeq: number
  scopeChanged: boolean
  reuseModeChanged: boolean
}
export function nextCommittedUrl(input: CommittedUrlInput): string

/** 宽松比较两个地址是否指向同一页（忽略尾斜杠与大小写主机名） */
export function isSameBrowserUrl(a: string, b: string): boolean
```

`nextCommittedUrl` 判定顺序（先命中先返回）：

| # | 条件 | 返回 | 理由 |
| --- | --- | --- | --- |
| 1 | `scopeChanged` | `storedUrl`（允许空） | 切会话 → 恢复目标会话地址 |
| 2 | `navigationSeq !== prevNavigationSeq` | `storedUrl` | **命令式导航**：外部打开 / 地址栏 / skill 面板 |
| 3 | `prev === ''` | `storedUrl` | 首次有值，webview 靠它挂载 |
| 4 | `reuseModeChanged && storedUrl !== ''` | `storedUrl` | webview 重建，用实际地址 |
| 5 | 其余（站内切 tab / hash / pushState） | `prev` | **一律不动** |

**验证检查点**：`npx tsc --noEmit -p tsconfig.web.json` 零错误；步骤 8 单测逐行覆盖 5 条规则 + 优先级 + `isSameBrowserUrl`。

### 步骤 2：主进程设备仿真 IPC

- [x] `src/renderer/src/lib/ipc/channels.ts` — Built-in Browser 段（`:353` 起，`CODEGRAPH_*` 在 `:355-360` 夹在中间）加 `BROWSER_SET_DEVICE: 'browser:set-device'`
- [x] `src/renderer/src/lib/ipc/messagepack-channel-routing.ts` — `MESSAGEPACK_INVOKE_CHANNELS` 加 `'browser:set-device'`
- [x] `src/main/ipc/misc-handlers.ts`
  - **顶部补导入**（该文件目前没有，不补直接编译失败）：

```ts
import { webContents } from 'electron'
import {
  resolveBrowserDeviceViewport,
  type BrowserDeviceMode,
  type BrowserDeviceViewport
} from '../../shared/browser-device-presets'
```

  - handler（`registerMessagePackHandler<TArgs, TResult>`，handler 单参）：

```ts
type SetDeviceResult =
  | { success: true; mode: BrowserDeviceMode; viewport: BrowserDeviceViewport | null }
  | { success: false; error: string }

registerMessagePackHandler<
  { webContentsId: number; mode: BrowserDeviceMode; custom?: { width?: number; height?: number } | null },
  SetDeviceResult
>('browser:set-device', async (args) => {
  try {
    const target = webContents.fromId(args.webContentsId)
    if (!target || target.isDestroyed()) return { success: false, error: 'Target web contents not found' }
    const viewport = resolveBrowserDeviceViewport(args.mode, args.custom)
    if (viewport === null) target.disableDeviceEmulation()
    else target.enableDeviceEmulation({
      screenPosition: 'mobile',
      screenSize: { width: viewport.width, height: viewport.height },
      viewPosition: { x: 0, y: 0 },
      viewSize: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      scale: 1
    })
    return { success: true, mode: args.mode, viewport }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
})
```

**验证检查点**：`npx tsc --noEmit -p tsconfig.node.json` 零错误；`npm test` 的 `ipc-msgpack-routing` 通过。

### 步骤 3：设备状态 + 导航序号进 store

- [x] `src/renderer/src/stores/browser-session-helpers.ts` — `BrowserPanelSessionState` 加 `deviceMode: BrowserDeviceMode` / `customViewport: { width: number; height: number } | null` / `navigationSeq: number`；`DEFAULT_BROWSER_STATE`（`:65`）补 `'pc'` / `null` / `0`
- [x] `src/renderer/src/stores/ui-store-interface.ts` — 加 `setBrowserDevice` / `requestBrowserNavigation` 声明（两个都带 `projectId?`）
- [x] `src/renderer/src/stores/ui-store-browser-slice.ts` — 实现（**sessionId 与 projectId 成对传，别只传 sessionId**）：

```ts
setBrowserDevice: (
  device: { mode: BrowserDeviceMode; customViewport: { width: number; height: number } | null },
  sessionId: any,
  projectId: any
) =>
  get().patchBrowserState(
    sessionId,
    { deviceMode: device.mode, customViewport: device.customViewport },
    projectId
  ),

requestBrowserNavigation: (url: string, sessionId: any, projectId: any) => {
  const state = get()
  const scope = resolvePanelScope(state, sessionId, projectId)
  const current = getBrowserStateFromMap(state.browserStatesBySession, scope.sessionId, scope.projectId)
  return get().patchBrowserState(
    sessionId,
    { url, navigationSeq: (current.navigationSeq ?? 0) + 1 },
    projectId
  )
},
```

- [x] `src/renderer/src/stores/ui-store.ts` — `ensureBrowserTab`（`:511-551`）内当 `url !== undefined` 时，`browserStatePatch` 一并带 `navigationSeq`（`set((state)=>…)` 内读当前值 + 1）
- [x] `src/renderer/src/components/settings/skill-panel.tsx:53` — `setBrowserUrl` → `requestBrowserNavigation`

**为什么 `setBrowserUrl` 不递增序号**：它是 webview 事件回写通道（`:280`/`:286`），递增就等于自激。

**验证检查点**：typecheck 0 错误；`setBrowserUrl` 四个调用点逐一确认：`:280`/`:286` 保留、`:164` 删除、`skill-panel:53` 改用新 action。

### 步骤 4：设备应用 —— 只缓存「进行中」+ 失败可重试（v6 的 2 个 ❌ 在此修掉）

- [x] 新建 `src/renderer/src/lib/browser/apply-browser-device.ts`

**完整实现（含全部 import，照抄可编译）**：

```ts
import {
  browserDeviceKey,
  resolveBrowserDeviceViewport,
  type BrowserDeviceMode,
  type BrowserDeviceViewport
} from '@shared/browser-device-presets'
import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { isWebviewConnected } from '@renderer/lib/browser/webview-helpers'

export type BrowserDeviceApplyResult =
  | { ok: true; viewport: BrowserDeviceViewport | null }
  | { ok: false; error: string }

export interface BrowserDeviceTarget {
  webview: Electron.WebviewTag
  mode: BrowserDeviceMode
  customViewport: { width: number; height: number } | null
}

export interface BrowserDeviceSwitchTarget extends BrowserDeviceTarget {
  desktopUserAgent: string
}

const RELOAD_TIMEOUT_MS = 10000
const ERR_ABORTED = -3

/** ① 只补视口仿真，不 reload、不碰 UA。幂等，可安全挂在 dom-ready 上。 */
export async function syncBrowserDeviceEmulation(
  target: BrowserDeviceTarget
): Promise<BrowserDeviceApplyResult> {
  let webContentsId: number
  try {
    webContentsId = target.webview.getWebContentsId()
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
  try {
    const response = (await ipcClient.invoke(IPC.BROWSER_SET_DEVICE, {
      webContentsId,
      mode: target.mode,
      custom: target.customViewport
    })) as
      | { success: true; viewport: BrowserDeviceViewport | null }
      | { success: false; error: string }
    return response.success
      ? { ok: true, viewport: response.viewport }
      : { ok: false, error: response.error }
  } catch (error) {
    return { ok: false, error: describe(error) }
  }
}

/** 只缓存「进行中」的调用；settled 即删，失败可立即重试。 */
const inFlight = new Map<number, { key: string; promise: Promise<BrowserDeviceApplyResult> }>()

/** ② 运行时切换设备：改 UA → 补仿真 → reload 并等加载完成。 */
export function applyBrowserDevice(
  target: BrowserDeviceSwitchTarget
): Promise<BrowserDeviceApplyResult> {
  let webContentsId: number
  try {
    webContentsId = target.webview.getWebContentsId()
  } catch (error) {
    return Promise.resolve({ ok: false, error: describe(error) })
  }

  const key = browserDeviceKey(target.mode, target.customViewport)
  const existing = inFlight.get(webContentsId)

  // 同配置正在跑 ⇒ 直接复用，不重复 reload
  if (existing && existing.key === key) return existing.promise

  // 不同配置在途 ⇒ 等它跑完再跑，避免两次 reload 交错
  const queued = existing ? existing.promise.then(noop, noop) : Promise.resolve()
  const promise: Promise<BrowserDeviceApplyResult> = queued.then(() => runDeviceSwitch(target))

  // ★ 同步占位：检查与 set 之间没有 await
  inFlight.set(webContentsId, { key, promise })
  void promise
    .then(noop, noop)          // 先吞掉 reject，避免 finally 链产生未处理拒绝
    .then(() => {
      // ★ 身份校验 + 立即删除 ⇒ 不缓存已完成/已失败结果
      if (inFlight.get(webContentsId)?.promise === promise) inFlight.delete(webContentsId)
    })

  return promise
}

/** webview 重建/销毁时清掉旧 guest 的占位，防止 id 复用误命中。 */
export function forgetBrowserDeviceState(webview: Electron.WebviewTag | null): void {
  if (!webview) return
  try {
    inFlight.delete(webview.getWebContentsId())
  } catch {
    /* webview 已销毁，无需清理 */
  }
}

async function runDeviceSwitch(
  target: BrowserDeviceSwitchTarget
): Promise<BrowserDeviceApplyResult> {
  const { webview } = target
  if (!isWebviewConnected(webview)) return { ok: false, error: 'Webview not connected' }

  const viewport = resolveBrowserDeviceViewport(target.mode, target.customViewport)
  let previousUserAgent: string
  try {
    previousUserAgent = webview.getUserAgent()
    webview.setUserAgent(viewport ? viewport.userAgent : target.desktopUserAgent)
  } catch (error) {
    return { ok: false, error: describe(error) }
  }

  const emulation = await syncBrowserDeviceEmulation(target)
  if (!emulation.ok) {
    // 仿真失败 ⇒ 回滚 UA，别留下「UA 是手机、视口是桌面」的撕裂状态
    try {
      webview.setUserAgent(previousUserAgent)
    } catch {
      /* 回滚失败不影响主流程 */
    }
    return emulation
  }

  await reloadAndWait(webview)
  return { ok: true, viewport: emulation.viewport }
}

function reloadAndWait(webview: Electron.WebviewTag): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      webview.removeEventListener('did-finish-load', onFinish)
      webview.removeEventListener('did-fail-load', onFail)
      resolve()
    }
    const onFinish = (): void => finish()
    // 子帧失败不算加载结束；-3（ERR_ABORTED）是被新导航打断，同样不算失败
    const onFail = (event: Electron.DidFailLoadEvent): void => {
      if (!event.isMainFrame) return
      if (event.errorCode === ERR_ABORTED) return
      finish()
    }
    const timer = setTimeout(finish, RELOAD_TIMEOUT_MS)
    webview.addEventListener('did-finish-load', onFinish)
    webview.addEventListener('did-fail-load', onFail as EventListener)
    try {
      webview.reload()
    } catch {
      finish()
    }
  })
}

function noop(): void {
  /* 忽略上一次的执行结果，只为排队/吞异常 */
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
```

**四条闭环推演**：

| # | 路径 | 是否终止 |
| --- | --- | --- |
| ① | 首次挂载 → `dom-ready` → `syncBrowserDeviceEmulation`（无 reload） | ✅ 不产生新导航 |
| ② | 切设备 → `applyBrowserDevice` → reload → 再触发 `dom-ready` → `syncBrowserDeviceEmulation`（无 reload） | ✅ 第二次纯 IPC |
| ③ | agent 写 store → executor 与 UI effect 都调 `applyBrowserDevice` | ✅ 同 key 同步占位复用同一 promise |
| ④ | 切换失败 → 出表 → 重新点击/调用 | ✅ 真重跑，不被旧失败结果锁死 |

**验证检查点**：typecheck 0 错误；grep 确认 `dom-ready` 回调内**不出现 `reload`**；`applyBrowserDevice` 内不读 store；失败后重试能生效。

### 步骤 5：问题 1 —— 拆 `committedUrl` / `storedUrl` 语义

- [x] `BrowserPanel.tsx:126-129` 替换：

```ts
const storedNavigationSeq = useUIStore(
  (s) => s.getBrowserState(sessionId, projectId).navigationSeq
)
const scopeRef = useRef({ sessionId, projectId, navigationSeq: storedNavigationSeq })
const reuseModeRef = useRef(initialBrowserUserDataReuseEnabledRef.current)

useEffect(() => {
  const prev = scopeRef.current
  const scopeChanged = prev.sessionId !== sessionId || prev.projectId !== projectId
  const reuseModeChanged = reuseModeRef.current !== runtimeBrowserUserDataReuseEnabled
  scopeRef.current = { sessionId, projectId, navigationSeq: storedNavigationSeq }
  reuseModeRef.current = runtimeBrowserUserDataReuseEnabled

  setInputUrl(storedUrl)
  setCommittedUrl((cur) =>
    nextCommittedUrl({
      prev: cur,
      storedUrl,
      navigationSeq: storedNavigationSeq,
      prevNavigationSeq: prev.navigationSeq,
      scopeChanged,
      reuseModeChanged
    })
  )
}, [storedUrl, storedNavigationSeq, sessionId, projectId, runtimeBrowserUserDataReuseEnabled])
```

- [x] `navigate()`（`:157-183`）改为（**同址比较用 `storedUrl`，不是 `committedUrl`** —— 站内导航后 `committedUrl` 不跟随，用它判断会漏）：

```ts
const navigate = useCallback(
  (url: string): void => {
    const normalized = normalizeBrowserUrl(url)
    if (!normalized) return
    setInputUrl(normalized)
    if (!canNavigateTo(normalized)) return
    setBrowserErrorInfo(null, sessionId, projectId)
    if (isSameBrowserUrl(normalized, storedUrl)) {
      // 同址再回车 ⇒ 显式重载（序号变但 committedUrl 不变，React 会 bail out）
      runWebviewCommand('navigate', (wv) => wv.reload())
      return
    }
    requestBrowserNavigation(normalized, sessionId, projectId)
  },
  [
    canNavigateTo,
    projectId,
    requestBrowserNavigation,
    runWebviewCommand,
    sessionId,
    setBrowserErrorInfo,
    storedUrl
  ]
)
```

  —— 删掉手写的 `setCommittedUrl` 与 `wv.src = normalized`。
  —— `webviewRef` 是 `useRef`，**不进依赖数组**；`runWebviewCommand` 是组件内 `useCallback`，进依赖数组。

- [x] `src/renderer/src/lib/tools/browser-native-ui.ts:97-101` 的 agent 导航保持原样（直接设 `src`）。理由：它不依赖 `committedUrl`，且 `onNavigate` 会把实际地址回写 `storedUrl`，规则 2/4 拿到的永远是实际地址。

**验证检查点**：

| # | 场景 | 预期 |
| --- | --- | --- |
| a | 站内点 tab（hash / query） | 地址栏跟随、**页面不重载**、tab 状态保留 |
| b | 首次 `openBrowserTab` | webview 正常挂载 |
| c | **面板已挂载时外部打开新链接** | 跳到新地址 |
| d | 地址栏输入新地址回车 | 正常跳转，只重载一次 |
| e | **地址栏输入当前地址回车** | **重载一次** |
| f | 切会话再切回 | 各自地址正确恢复 |
| g | 切「复用浏览器数据」开关 | 重载、最终停在当前地址 |
| h | agent `BrowserNavigate` | 正常跳转 |

### 步骤 6：抽工具栏 + 设备选择器 + hook

> 485 行存量 + 新增逻辑，直接加必破 500。**先抽后加**，不贴豁免头。

- [x] 新建 `src/renderer/src/components/layout/browser-toolbar.tsx` —— `BrowserPanel.tsx:367-431` 整块搬出（约 70 行）
- [x] 新建 `src/renderer/src/components/layout/browser-device-picker.tsx` —— 五选一 + `custom` 宽高输入（约 90 行）
- [x] 新建 `src/renderer/src/components/layout/use-browser-device-emulation.ts`

**完整实现（v6 的空函数 `applyBrowserSyncOnly` 已彻底删除）**：

```ts
import { useCallback, useEffect, useRef } from 'react'
import type { BrowserDeviceMode } from '@shared/browser-device-presets'
import {
  applyBrowserDevice,
  syncBrowserDeviceEmulation
} from '@renderer/lib/browser/apply-browser-device'

export interface UseBrowserDeviceEmulationOptions {
  webviewRef: React.MutableRefObject<Electron.WebviewTag | null>
  mode: BrowserDeviceMode
  customViewport: { width: number; height: number } | null
  desktopUserAgent: string
}

export interface BrowserDeviceEmulationApi {
  /** 挂到 handleWebviewRef 的 dom-ready：只补仿真，不 reload */
  syncOnReady: (webview: Electron.WebviewTag) => void
  /** 用户重复点同一设备时手动重放 */
  reapply: () => void
}

export function useBrowserDeviceEmulation(
  options: UseBrowserDeviceEmulationOptions
): BrowserDeviceEmulationApi {
  const { webviewRef, mode, customViewport, desktopUserAgent } = options

  // 每次渲染同步刷新，供 dom-ready 回调读最新值（回调本身引用稳定）
  const latestRef = useRef({ mode, customViewport, desktopUserAgent })
  latestRef.current = { mode, customViewport, desktopUserAgent }

  const previousRef = useRef<{
    mode: BrowserDeviceMode
    width: number | null
    height: number | null
  } | null>(null)

  const syncOnReady = useRef((webview: Electron.WebviewTag): void => {
    const latest = latestRef.current
    void syncBrowserDeviceEmulation({
      webview,
      mode: latest.mode,
      customViewport: latest.customViewport
    })
  }).current

  const reapply = useCallback((): void => {
    const webview = webviewRef.current
    if (!webview) return
    const latest = latestRef.current
    void applyBrowserDevice({
      webview,
      mode: latest.mode,
      customViewport: latest.customViewport,
      desktopUserAgent: latest.desktopUserAgent
    })
  }, [webviewRef])

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = {
      mode,
      width: customViewport?.width ?? null,
      height: customViewport?.height ?? null
    }
    // 首帧只记基线，不触发（否则面板一挂载就白 reload 一次）
    if (!previous) return
    if (
      previous.mode === mode &&
      previous.width === (customViewport?.width ?? null) &&
      previous.height === (customViewport?.height ?? null)
    ) {
      return
    }
    reapply()
  }, [mode, customViewport, reapply])

  return { syncOnReady, reapply }
}
```

- [x] **接线清单（5 处，逐条落地）**：

| # | 位置 | 落地内容 |
| --- | --- | --- |
| 1 | `BrowserPanel.tsx` 顶部解构 | `const { deviceMode, customViewport } = useUIStore((s) => s.getBrowserState(sessionId, projectId))` + `const setBrowserDevice = useUIStore((s) => s.setBrowserDevice)` + `const requestBrowserNavigation = useUIStore((s) => s.requestBrowserNavigation)` |
| 2 | `BrowserPanel.tsx`，`webviewRef` 声明之后 | `const { syncOnReady, reapply } = useBrowserDeviceEmulation({ webviewRef, mode: deviceMode, customViewport, desktopUserAgent: runtimeBrowserUserAgent })` |
| 3 | `latestRef`（`:222-247`）初值与赋值的对象字面量 | **新增 4 个字段**：`deviceMode`、`customViewport`、`desktopUserAgent: runtimeBrowserUserAgent`、`syncOnReady`（两处都要加） |
| 4 | `handleWebviewRef` 内，`onNewWindow` 注册之后 | `const onDomReady = (): void => R.syncOnReady(wv)` + `wv.addEventListener('dom-ready', onDomReady)`；cleanup 里 `wv.removeEventListener('dom-ready', onDomReady)` + `forgetBrowserDeviceState(wv)` |
| 5 | 工具栏渲染处 | `<BrowserToolbar …/>` 尾部 `<BrowserDevicePicker mode={deviceMode} customViewport={customViewport} onChange={(next) => { setBrowserDevice(next, sessionId, projectId); if (next.mode === deviceMode && next.customViewport?.width === customViewport?.width && next.customViewport?.height === customViewport?.height) reapply() }} />` |

> 第 5 处的 `reapply()`：**用户重复点同一设备时 store 值不变 ⇒ effect 不触发**，必须显式重放，否则「再点一次没反应」。

- [x] `locales/{zh,en}/layout.json` — `browser.device.pc|iphone|pixel|ipad|custom`、`browser.device.width|height`

**UA prop 处理（两条路各管一段）**：

```ts
const deviceViewport = resolveBrowserDeviceViewport(deviceMode, customViewport)
const effectiveUserAgent = deviceViewport?.userAgent ?? runtimeBrowserUserAgent
// webviewSessionProps.useragent = effectiveUserAgent
```

- **prop**：决定新元素首次导航前的 UA ⇒ 覆盖重建。
- **方法**：运行时切换由 `setUserAgent` 负责 ⇒ 覆盖已加载页面。

**行数预算**：485 − 65（工具栏） − 25（hook 外移） + ~45（接线 5 处 + latestRef 4 字段） ≈ **440 行**。若落地后 > 490，立刻把 `errorInfo` 渲染块抽成 `browser-error-banner.tsx`，**不贴豁免头**。

**验证检查点**：五选项逐个点；`pc` 回桌面；切设备后重载并出移动布局；**面板首次挂载不产生额外 reload**；**再点当前设备仍会重载一次**；`BrowserPanel.tsx` 实测 `< 500`；typecheck 0 错误。

### 步骤 7：`BrowserSetDevice` 工具接线（七处）

| # | 文件 | 改动 |
| --- | --- | --- |
| 1 | `src/runtime/WishfulClaw.Agent/Tools/Providers/BrowserToolProvider.cs` | 注册 `BrowserSetDevice`：`device`（必填）、`width` / `height`（可选，仅 custom）；`visibleScopes: Everywhere`、`excludedScopes: UnattendedRoles` |
| 2 | `src/runtime/WishfulClaw.Agent/AgentRuntimeBrowserExecutor.cs:25-36` | `BrowserToolNames` 加 `"BrowserSetDevice"` |
| 3 | **新建** `src/renderer/src/lib/tools/browser-device-native.ts` | `executeBrowserSetDevice` |
| 4 | `src/renderer/src/lib/tools/browser-native-ui.ts` | `runBrowserTool`（`:428-449`）加 `case 'BrowserSetDevice'`（import + 一行 case，≤10 行） |
| 5 | `src/renderer/src/lib/tools/browser-tool.ts` | 占位 definition（`execute` 返回 `nativeOnlyBrowserResult`） |
| 6 | `src/renderer/src/lib/app-plugin/types.ts` | `BROWSER_SET_DEVICE_TOOL_NAME`（`:15-21`）+ 并入 `AppPluginToolName`（`:33-47`）+ 加进 `BROWSER_PLUGIN.toolNames`（`:83-91`） |
| 7 | `locales/{zh,en}/chat.json`（`:816` 区）、`settings.json`（`:938` 区）；可选 `ToolCallCard/types.ts` 的 `COMPACT_BUILTIN_TOOL_NAMES` | 文案 |

`browser-device-native.ts` **完整实现（import 已核实：`tool-result-format`，不是 `tool-result`）**：

```ts
import {
  DEFAULT_CUSTOM_VIEWPORT,
  isBrowserDeviceMode,
  normalizeViewportSide
} from '@shared/browser-device-presets'
import { stripElectronFromUserAgent } from '@shared/browser-plugin'
import { useUIStore } from '@renderer/stores/ui-store'
import { encodeStructuredToolResult } from './tool-result-format'
import { getWebview } from './browser-webview-helpers'
import { applyBrowserDevice } from '@renderer/lib/browser/apply-browser-device'

export async function executeBrowserSetDevice(input: any, ctx: any): Promise<any> {
  if (!isBrowserDeviceMode(input?.device)) {
    return encodeStructuredToolResult({ success: false, error: `未知设备：${String(input?.device)}` })
  }
  const mode = input.device
  const customViewport =
    mode === 'custom'
      ? {
          width: normalizeViewportSide(input?.width, DEFAULT_CUSTOM_VIEWPORT.width),
          height: normalizeViewportSide(input?.height, DEFAULT_CUSTOM_VIEWPORT.height)
        }
      : null

  // 先写意图：即便面板当前未挂载，打开面板后 dom-ready 也会按此应用
  useUIStore.getState().setBrowserDevice({ mode, customViewport }, ctx.sessionId, ctx.projectId)

  const webview = getWebview(ctx)
  if (!webview) {
    return encodeStructuredToolResult({
      success: true,
      device: mode,
      viewport: null,
      note: '已记录设备设置，浏览器面板打开后自动生效'
    })
  }

  const applied = await applyBrowserDevice({
    webview,
    mode,
    customViewport,
    desktopUserAgent: stripElectronFromUserAgent(navigator.userAgent)
  })
  return encodeStructuredToolResult(
    applied.ok
      ? { success: true, device: mode, viewport: applied.viewport }
      : { success: false, error: applied.error }
  )
}
```

> `ctx.projectId`：以 `ToolContext` 实际字段为准；若不存在则按 `ctx.sessionId` 单参调用（`patchBrowserState` 的 `projectId` 可省略）。

**验证检查点**：`dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误；typecheck 0 错误；agent 调完立刻 `BrowserScreenshot` 拍到新形态；**agent 切完再调 `BrowserEvaluate` 读 `window.innerWidth`，应等于设备宽**；`browser-native-ui.ts` 实测 `< 500`。

### 步骤 8：纯函数单测

- [x] 新建 `tests/browser-device/program.ts`
- [x] `package.json` 加：

```json
"test:browser-device": "esbuild tests/browser-device/program.ts --bundle --platform=node --format=cjs --alias:@renderer=./src/renderer/src --alias:@shared=./src/shared --outfile=tests/browser-device/out/program.cjs && node tests/browser-device/out/program.cjs"
```

断言清单：

- `nextCommittedUrl` 五条规则各一条 + **优先级顺序**一条；
- **「站内切 tab 不改变 committedUrl」单独一条**（唯一能自动拦回归的闸）；
- `isSameBrowserUrl`：尾斜杠、大小写主机名、不同路径；
- `resolveBrowserDeviceViewport('pc') === null`；
- 三个预置宽高与 DPR 精确匹配；
- `custom` 缺省回落 390 × 844 / DPR 3；
- `normalizeViewportSide`：0 / 负数 / NaN / 超上限 → 夹到合法值；
- UA 非空且不含 `Electron`；
- `isBrowserDeviceMode` 拒 `'desktop'` / `null` / `1`；
- `browserDeviceKey`：同输入同键、不同尺寸不同键、**夹取后与原值不同的入参产出相同键**。

**验证检查点**：`npm run test:browser-device` 打印 pass；`npm test` 全绿。

### 步骤 9：门禁

- [x] `npm run typecheck`（三配置）→ 0 错误
- [x] `npm test` → 全绿
- [x] `dotnet build src\runtime\WishfulClaw.sln` → 0 警告 0 错误（**编译前关 dev 实例**）
- [x] 手动冒烟：步骤 5 的 a~h 八条 + 五设备 + agent 工具 + `BrowserEvaluate` 读宽度（**老大 2026-10-21 14:04 真机通过**）

## 四、涉及文件

**新建**（父目录均已存在，无同名冲突）

| 文件 | 用途 |
| --- | --- |
| `src/shared/browser-device-presets.ts` | 预置表 + 纯函数 |
| `src/renderer/src/lib/browser/committed-url.ts` | 导航目标状态机 + `isSameBrowserUrl` |
| `src/renderer/src/lib/browser/apply-browser-device.ts` | 补仿真 / 切设备 + 只缓存进行中 |
| `src/renderer/src/lib/tools/browser-device-native.ts` | `executeBrowserSetDevice` |
| `src/renderer/src/components/layout/browser-toolbar.tsx` | 抽出的工具栏 |
| `src/renderer/src/components/layout/browser-device-picker.tsx` | 设备选择器 |
| `src/renderer/src/components/layout/use-browser-device-emulation.ts` | 两个触发源 + `reapply` |
| `tests/browser-device/program.ts` | 纯函数单测 |

**修改**

| 文件 | 实测行数 | 改动 |
| --- | --- | --- |
| `src/renderer/src/components/layout/BrowserPanel.tsx` | 485 → ~440 | 拆语义 + 接线 5 处 + `latestRef` 补 4 字段 |
| `src/renderer/src/lib/tools/browser-native-ui.ts` | 476 → ~481 | 一行 case + import |
| `src/renderer/src/stores/ui-store.ts` | 556（已超限，只改 3 行） | `ensureBrowserTab` 递增序号 |
| `src/renderer/src/stores/ui-store-browser-slice.ts` | 56 | 两个 action |
| `src/renderer/src/stores/ui-store-interface.ts` | 290 | 两个声明 |
| `src/renderer/src/stores/browser-session-helpers.ts` | 312 | 三个字段 + 默认值 |
| `src/main/ipc/misc-handlers.ts` | 289 | `webContents` 导入 + handler |
| `src/renderer/src/lib/ipc/channels.ts` / `messagepack-channel-routing.ts` | 423 / 438 | 新通道 + 白名单 |
| `src/renderer/src/lib/app-plugin/types.ts` | 115 | 常量 + 联合类型 + `toolNames` |
| `src/renderer/src/components/settings/skill-panel.tsx` | 236 | 换 action |
| `src/renderer/src/lib/tools/browser-tool.ts` | 260 | 占位 definition |
| `locales/{zh,en}/layout.json` / `chat.json` / `settings.json` | — | 文案（`AGENTS.md:182` 豁免） |
| `src/runtime/WishfulClaw.Agent/Tools/Providers/BrowserToolProvider.cs` | — | 工具注册 |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeBrowserExecutor.cs` | — | 白名单 |
| `package.json` | — | 新测试脚本 |

## 五、参考源码

无外部参考项目。技术依据全是 Electron 自有 API，行号见 §一。

## 五之二、阶段三 PASS 后的 8 条建议项（实施时一并处理）

阶段三校验结论 PASS / ❌ 0 / ⚠️ 8，以下为实施时必须顺手收掉的细节：

| # | 项 | 落地处理 |
| --- | --- | --- |
| R1 | §一 表格里 `runtime/…/BrowserToolProvider.cs` 裸路径 | 一律写 `src/runtime/…` |
| R2 | `browser-device-native.ts` 缺 3 行 import / `webviewSessionProps.useragent` 仍是注释 / `ALL_HANDLERS` 未提 | 补齐 import；`useragent` 写实；在第 4 处改动里显式加进 `runBrowserTool` 的 switch 与 handler 登记表 |
| R3 | §二 口径表述与需求文档漂移 | 需求 §五 未回写，实施完在需求文档 §五 追加「已按方案收敛」一行 |
| R4 | `ToolContext` **无 `projectId`**（`tool-types.ts:12-46`），`ctx.projectId` 恒 `undefined` | executor 只传 `ctx.sessionId`，`projectId` 省略；需要时另开需求补上下文 |
| R5 | 面板未挂载时 `success:true` 与 `pc` 生效的 `viewport:null` 语义撞车 | 返回体加 `applied: false` 字段区分「已记录但未生效」 |
| R6 | `custom` 宽高逐键写 store ⇒ 逐键 reload | picker 的宽高输入用本地 state，失焦/回车才提交一次 |
| R7 | `syncOnReady` 静默吞失败、`reloadAndWait` 主框架真失败也返回 `ok` | `syncOnReady` 失败打 `console.warn`；`reloadAndWait` 主框架真失败时返回 `{ ok: false, error }` |
| R8 | 工具栏抽取后 `inputUrl` 归属未写清 | `inputUrl` / `setInputUrl` **留在 `BrowserPanel.tsx`**，作为 props 传入 `BrowserToolbar` |

## 六、风险与对策

| 风险 | 对策 |
| --- | --- |
| **`dom-ready` 无限重载** | `dom-ready` 只调 `syncBrowserDeviceEmulation`（无 reload） |
| **去重竞态 / 失败结果被缓存** | 同步占位 + settle 后身份校验删除 ⇒ 只缓存进行中 |
| 不同 key 在途并发交错 | 新 key 排队等上一次结束再跑 |
| 面板首次挂载白 reload | UI effect 用 ref 跳过首帧 |
| **重复点同一设备没反应** | picker 的 `onChange` 里比较等值后调 `reapply()` |
| 外部打开失效 | `navigationSeq` 通道 + 验证 c |
| 同址回车无反应 | `isSameBrowserUrl(normalized, storedUrl)` → `wv.reload()` + 验证 e |
| 运行时只改 `useragent` 属性无效 | 运行时用 `setUserAgent`；prop 只负责重建首帧 |
| 仿真失败留下撕裂 UA | 失败回滚 `setUserAgent(previousUserAgent)` |
| agent 切完截图拍到旧形态 | await 到 `did-finish-load`（10s 兜底，子帧与 `-3` 不算完成）+ `BrowserEvaluate` 读宽度验收 |
| `getWebContentsId` 未连接时抛错 | 两处入口 try/catch + `runDeviceSwitch` 的 `isWebviewConnected` 守卫 |
| 面板未挂载时 agent 切设备 | **先写 store 意图**，返回 `success:true` + note，打开面板即生效 |
| **切 reuse 开关每次挂载多一次加载** | `settings-store.ts:309` 默认 true + 桩恒 false ⇒ 每次挂载必翻 key、重建一次。**既有行为**，非本方案引入；规则 4 保证重建后落在正确地址。要根治另开需求修桩 |
| **仿真视口留白** | 1:1 渲染，面板窄于设备宽时右侧留白。等价 DevTools 未勾「自适应」，非缺陷。要自适应另开需求 |
| `BrowserPanel.tsx` 破 500 | 抽工具栏 + hook，预算 ~440；> 490 再抽错误提示区，不贴豁免头 |
| `ui-store.ts` 已 556 行 | 只改 3 行，不扩大该文件 |
| 会话恢复被改坏 | 规则 1 专保；验证 f |

## 七、版本修订记录

| # | 来源 | 修订 |
| --- | --- | --- |
| 1 | ①❌1 | 测试脚本 `tsx` → `esbuild` |
| 2 | ①❌2 | 设备应用改普通函数 + 显式触发源 |
| 3 | ①⚠️ | 工具链路 7 处；删 `scale`；先抽工具栏；留白入风险 |
| 4 | ②❌1 | 新增 `navigationSeq` 通道 |
| 5 | ②❌2 | UA 改 `setUserAgent` |
| 6 | ②❌3 | executor 拆 `browser-device-native.ts` |
| 7 | ②⚠️ | `latestRef` 补字段；`@shared` alias；主进程相对导入；reload await；路径补 `src/` |
| 8 | ③❌1 | `dom-ready` 与 reload 解耦 |
| 9 | ③⚠️ | 同址回车 reload；`getWebview`；两字段合一 action；首帧跳过；抽 hook；reuse 首帧入风险 |
| 10 | ④❌1 | 去重表改「同步占位 promise」 |
| 11 | ④⚠️ | 判别联合 `{ok}`；补 `webContents` 导入；`navigate` 依赖；`isWebviewConnected` 守卫；规则 4 空值守卫 |
| 12 | ⑤❌1 | **只缓存进行中**：`finally` 身份校验删除，失败可重试 |
| 13 | ⑤⚠️ | 不同 key 排队；`getWebContentsId` try/catch；hook 返回类型；`did-fail-load` 判 `isMainFrame`；key 由夹取后视口派生；UA 失败回滚；`BrowserEvaluate` 验收；口径变更上呈 |
| 14 | ⑥❌1 | **`./tool-result` → `./tool-result-format`**（实测 `browser-native-ui.ts:8`） |
| 15 | ⑥❌2 | **删空函数 `applyBrowserSyncOnly`**，hook 改用 `latestRef` 自持有 + 正确导入 `syncBrowserDeviceEmulation` |
| 16 | ⑥⚠️ | `finally` 先吞 reject；`reloadAndWait` 补 `-3`；重复点同设备走 `reapply`；接线列 5 处明细；`setBrowserDevice` 成对传 sessionId/projectId；面板未挂载也写 store；裸路径补 `src/`；同址回车改用 `isSameBrowserUrl(normalized, storedUrl)` |
