/*
 * 插件视图窗口（S-241）—— 把清单里声明的 views[] 真正打开成独立窗口。
 *
 * 与主程序自己的两个独立窗口（剪贴板浮窗 / 快捷启动器）的区别只在三点：
 * ① 一个插件一个 session 分区，登录态与缓存不跟别的插件串；
 * ② 可重开 —— 关窗只销毁窗口，不动插件自己的进程；
 * ③ 有崩溃计数 —— 一崩就狂重启会把 CPU 吃光，超过上限宁可停手。
 *
 * 权限按老大 2026-10-27 14:03 定案全开（nodeIntegration / contextIsolation /
 * sandbox 三项都放开）。插件能 exec、能读写，这是设计选择，不是疏漏：
 * 软件跑在用户自己电脑上，装什么插件是用户自己的决定。
 */

import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { isAbsolute, resolve as resolvePath } from 'path'
import type { ExtensionInstance, ExtensionViewDefinition } from '../../shared/extension-types'
import { logError, logInfo, logWarn } from '../lib/logger'
import { nativeExtensionRequest } from '../ipc/extension-native-bridge'
import { isEntryInsideRoot, pruneCrashStamps, shouldStopReopening } from './plugin-view-rules'
import { pluginPartitionName } from './plugin-cleanup-rules'

/** 缺省窗口尺寸 —— 老大 14:03 定案 1100×760，清单里的 views[].window 可覆盖。 */
const DEFAULT_WIDTH = 1100
const DEFAULT_HEIGHT = 760

/** 崩溃自愈：1 分钟内 ≤ 3 次；超过则标红并停手，不再自动放开。 */
const CRASH_WINDOW_MS = 60_000
const CRASH_LIMIT = 3

/** 每个插件同时最多一个窗口（需求 §7），所以注册表键是 pluginId，不是 pluginId:viewId。 */
interface PluginViewRecord {
  pluginId: string
  viewId: string
  title: string
  window: BrowserWindow
  /** webContents 的 OS 进程 pid —— 退出时按 pid 树回收它拉起的子进程。 */
  pid: number
  /** 失焦起点；null = 用户正在用。空闲回收只看这个字段。 */
  idleSince: number | null
  /** 最近一分钟内的崩溃时间戳。 */
  crashes: number[]
  /** true = 该插件已撞过上限，入口再点也不开。 */
  crashLoop: boolean
}

export interface PluginViewOpenArgs {
  pluginId: string
  viewId: string
}

export interface PluginViewOpenResult {
  success: boolean
  /** 已存在、只是提到前面 —— 渲染端不必提示「已打开」。 */
  reused?: boolean
  /** true = 撞过崩溃上限，入口应标红。 */
  crashLoop?: boolean
  error?: string
}

export interface PluginViewStatus {
  pluginId: string
  viewId: string
  title: string
  pid: number
  visible: boolean
  focused: boolean
  crashed: boolean
}

const registry = new Map<string, PluginViewRecord>()

/** 视图 entry 必须落在插件根内 —— 判据在 plugin-view-rules，这里只用。 */
async function resolveViewEntry(
  pluginId: string,
  view: ExtensionViewDefinition
): Promise<{ root: string; abs: string }> {
  const resolved = await nativeExtensionRequest<{
    success: boolean
    path?: string
    error?: string
  }>('extension/resolve-path', { id: pluginId })
  if (!resolved.success || !resolved.path) {
    throw new Error(resolved.error ?? 'Extension path not found')
  }

  const root = resolved.path
  const abs = isAbsolute(view.entry) ? view.entry : resolvePath(root, view.entry)
  if (!isEntryInsideRoot(root, abs)) {
    throw new Error(`View entry escapes plugin root: ${view.entry}`)
  }
  if (!existsSync(abs)) {
    // 插件装了、清单写了、文件不在 —— 报清楚路径，否则只剩一个白窗口
    throw new Error(`View entry not found: ${view.entry}`)
  }
  return { root, abs }
}

async function readViewDefinition(
  pluginId: string,
  viewId: string
): Promise<ExtensionViewDefinition> {
  const instances = await nativeExtensionRequest<ExtensionInstance[]>('extension/list', {})
  const instance = instances.find((item) => item.id === pluginId)
  if (!instance) throw new Error('Extension not installed')
  if (!instance.enabled) throw new Error('Extension is disabled')

  const view = (instance.manifest.views ?? []).find((item) => item.id === viewId)
  if (!view) throw new Error(`View not declared: ${viewId}`)
  return view
}

function attachLifecycleHandlers(record: PluginViewRecord): void {
  const { window } = record

  // 失焦即开始空闲计时；重新获得焦点立刻清掉。隐藏（最小化 / 被系统收走）也算空闲。
  window.on('focus', () => {
    record.idleSince = null
  })
  window.on('blur', () => {
    record.idleSince = record.idleSince ?? Date.now()
  })
  window.on('hide', () => {
    record.idleSince = record.idleSince ?? Date.now()
  })

  window.on('closed', () => {
    registry.delete(record.pluginId)
    logInfo('main', `plugin-view: window closed: ${record.pluginId}/${record.viewId}`)
  })

  window.webContents.on('render-process-gone', (_event, details) => {
    const now = Date.now()
    record.crashes = pruneCrashStamps(record.crashes, now, CRASH_WINDOW_MS)
    record.crashes.push(now)
    const reason = `${details.reason} (exit ${details.exitCode})`

    if (shouldStopReopening(record.crashes, CRASH_LIMIT)) {
      // 一分钟崩三次，问题在插件不在我们 —— 停手并留痕，别跟着一起进死循环
      record.crashLoop = true
      logError(
        'main',
        `plugin-view: renderer crash loop: ${record.pluginId}/${record.viewId} ${reason}, 1min=${record.crashes.length}, stop reopening`
      )
    } else {
      logWarn(
        'main',
        `plugin-view: renderer gone: ${record.pluginId}/${record.viewId} ${reason}, 1min=${record.crashes.length}`
      )
    }

    // 窗口已被销毁时不再动它，只留注册表状态
    if (!window.isDestroyed()) window.destroy()
  })
}

/**
 * 打开插件视图。已开着就提到前面（`reused: true`），不是新开第二个。
 */
export async function openPluginView(args: PluginViewOpenArgs): Promise<PluginViewOpenResult> {
  const pluginId = (args.pluginId ?? '').trim()
  const viewId = (args.viewId ?? '').trim()
  if (!pluginId || !viewId) return { success: false, error: 'pluginId and viewId are required' }

  const existing = registry.get(pluginId)
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore()
    existing.window.show()
    existing.window.focus()
    return { success: true, reused: true }
  }

  const crashedRecord = existing
  if (crashedRecord?.crashLoop) {
    // 崩溃循环期间不自动放开：入口点一次报一次，别再烧一遍渲染进程
    return { success: false, crashLoop: true, error: 'Plugin window keeps crashing, reopened denied' }
  }

  try {
    // 分区名与卸载清理共用同一判据（S-244）：两处各写一遍字面量，早晚会漂
    const partition = pluginPartitionName(pluginId)
    if (!partition) return { success: false, error: 'invalid pluginId' }

    const view = await readViewDefinition(pluginId, viewId)
    const { abs } = await resolveViewEntry(pluginId, view)

    const window = new BrowserWindow({
      width: view.window?.width ?? DEFAULT_WIDTH,
      height: view.window?.height ?? DEFAULT_HEIGHT,
      minWidth: view.window?.minWidth,
      minHeight: view.window?.minHeight,
      resizable: view.window?.resizable ?? true,
      title: view.title,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        // 权限全开（老大 14:03 定案）：插件是用户自己装的，不设沙箱、不做白名单
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        // 只给自己保留登录态与缓存，绝不与主窗口或其它插件共用分区
        partition
      }
    })

    const record: PluginViewRecord = {
      pluginId,
      viewId,
      title: view.title,
      window,
      pid: window.webContents.getOSProcessId(),
      idleSince: null,
      // 换窗口但保留崩溃计数：重开能成功，说明上一次只是偶发
      crashes: crashedRecord?.crashes ?? [],
      crashLoop: false
    }
    registry.set(pluginId, record)
    attachLifecycleHandlers(record)

    window.once('ready-to-show', () => {
      if (!window.isDestroyed()) window.show()
    })

    await window.loadFile(abs)
    logInfo('main', `plugin-view: window opened: ${pluginId}/${viewId} pid=${record.pid}`)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logWarn('main', `plugin-view: open failed: ${pluginId}/${viewId} ${message}`)
    return { success: false, error: message }
  }
}

export function closePluginView(pluginId: string): { success: boolean; error?: string } {
  const record = registry.get((pluginId ?? '').trim())
  if (!record) return { success: true }
  if (!record.window.isDestroyed()) record.window.destroy()
  registry.delete(record.pluginId)
  return { success: true }
}

export function listPluginViews(): PluginViewStatus[] {
  const result: PluginViewStatus[] = []
  for (const record of registry.values()) {
    if (record.window.isDestroyed()) continue
    result.push({
      pluginId: record.pluginId,
      viewId: record.viewId,
      title: record.title,
      pid: record.pid,
      visible: record.window.isVisible(),
      focused: record.window.isFocused(),
      crashed: record.crashLoop
    })
  }
  return result
}

export function getPluginViewStatus(pluginId: string): PluginViewStatus | null {
  return listPluginViews().find((item) => item.pluginId === (pluginId ?? '').trim()) ?? null
}

/** 空闲回收：返回并销毁超时空闲的窗口。`idleMs` 由 lifecycle 传，便于测试。 */
export function sweepIdlePluginViews(idleMs: number): string[] {
  const now = Date.now()
  const swept: string[] = []
  for (const record of registry.values()) {
    if (record.window.isDestroyed()) {
      registry.delete(record.pluginId)
      continue
    }
    if (record.idleSince === null) continue
    if (now - record.idleSince < idleMs) continue
    logInfo(
      'main',
      `plugin-view: idle reclaim: ${record.pluginId}/${record.viewId} idle ${Math.round((now - record.idleSince) / 1000)}s`
    )
    record.window.destroy()
    registry.delete(record.pluginId)
    swept.push(record.pluginId)
  }
  return swept
}

/**
 * 退出前收掉全部插件窗口，并把它们的 pid 交出去 —— 插件权限全开，
 * 自己 `spawn` 的子进程不跟着 Electron 走，必须由 lifecycle 按 pid 树杀。
 */
export function destroyAllPluginViews(): number[] {
  const pids: number[] = []
  for (const record of registry.values()) {
    pids.push(record.pid)
    if (!record.window.isDestroyed()) record.window.destroy()
  }
  registry.clear()
  return pids
}

/** 测试与调试用：当前注册表快照（不含 BrowserWindow 实例）。 */
export function getPluginViewRegistrySnapshot(): Array<{
  pluginId: string
  viewId: string
  pid: number
  crashLoop: boolean
}> {
  return [...registry.values()].map((record) => ({
    pluginId: record.pluginId,
    viewId: record.viewId,
    pid: record.pid,
    crashLoop: record.crashLoop
  }))
}
