/**
 * 启动器 / 文件搜索的 IPC 注册表。
 *
 * S-249 从 `quick-launcher.ts` 搬出（原文件里 297 行的一个函数，压得整份读不下去）。
 * 相对原文的改动全是机械替换，没有一个 handler 的行为变过：`config.` → `getConfig().`；
 * 整体替换配置的 5 处 → `setConfig({ ...getConfig(), ... })`；`launcherWindow` → `getLauncherWindow()`；
 * `appListCache = null` → `invalidateAppListCache()`；探测缓存回写 → `setEverythingProbeCache(...)`；
 * 初始关键词槽的读+清 → `takeFileSearchInitialKeyword()`。
 */

import { dialog, shell } from 'electron'
import * as fs from 'fs'
import { registerMessagePackHandler } from '../ipc/messagepack-handler'
import { EVERYTHING_DOWNLOAD_URL, isEverythingExecutableName } from '../lib/everything-search'
import { isEsExecutableName, type EsCategory } from '../lib/es-search'
import { getOrRefreshAppList, searchApps, withIcon } from './app-list'
import { isAppsFolderPath, isSystemCommandPath, launchSystemCommand, spawnHidden } from './app-scan'
import { SYS_CMD_PREFIX } from './constants'
import { invalidateAppListCache } from './cache'
import { getConfig, saveConfig, setConfig } from './config'
import { getEsStatus, invalidateEsProbe } from './es-probe'
import {
  getEverythingStatus,
  invalidateEverythingProbe,
  setEverythingProbeCache
} from './everything-probe'
import {
  countFileResults,
  createFileSearchWindow,
  executeFileQuery,
  getFileIcons,
  hideFileSearchWindow,
  takeFileSearchInitialKeyword
} from './file-search'
import {
  getLauncherWindow,
  hideLauncherWindow,
  registerShortcut,
  unregisterShortcut
} from './window'
import type {
  AppShortcut,
  CustomApp,
  EsQueryRequest,
  EsSearchResult,
  EsStatus,
  EverythingStatus,
  LauncherConfig
} from './types'

// ── IPC ──

let ipcRegistered = false

export function registerLauncherIpc(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  registerMessagePackHandler<string, AppShortcut[]>('launcher:search', (query) => searchApps(query))

  registerMessagePackHandler<void, AppShortcut[]>('launcher:get-recent', async () => {
    if (getConfig().launchHistory.length === 0) return []
    const recent = getConfig().launchHistory.slice(0, 8)
    return Promise.all(recent.map(async (entry) => withIcon({ name: entry.name, path: entry.path })))
  })

  registerMessagePackHandler<string, boolean>('launcher:launch', async (appPath) => {
    let launchError = ''
    if (isSystemCommandPath(appPath)) {
      launchSystemCommand(appPath.slice(SYS_CMD_PREFIX.length))
    } else if (isAppsFolderPath(appPath)) {
      // shell: pseudo-paths don't go through shell.openPath; explorer handles them.
      spawnHidden('explorer.exe', [appPath])
    } else {
      // shell.openPath resolves to '' on success, an error string otherwise —
      // checking it is the only way to notice a failed launch.
      launchError = await shell.openPath(appPath)
      if (launchError) {
        console.warn(`[QuickLauncher] Failed to launch ${appPath}: ${launchError}`)
      }
    }
    if (launchError) {
      // Don't record failed launches in history and keep the panel open so
      // the user can retry instead of believing the launch succeeded.
      return false
    }
    // Record launch history
    const apps = getOrRefreshAppList()
    const launched = apps.find((a) => a.path === appPath)
    if (launched) {
      const entry: CustomApp = { name: launched.name, path: launched.path }
      getConfig().launchHistory = getConfig().launchHistory.filter((h) => h.path !== appPath)
      getConfig().launchHistory.unshift(entry)
      if (getConfig().launchHistory.length > 30) getConfig().launchHistory = getConfig().launchHistory.slice(0, 30)
      saveConfig()
      // History ordering changed — rebuild the merged list on next search.
      invalidateAppListCache()
    }
    hideLauncherWindow()
    return true
  })

  registerMessagePackHandler<void, { canceled: boolean; path?: string; name?: string }>('launcher:pick-exe', async () => {
    // launcherWindow may have been destroyed between the click and the dialog;
    // fall back to a parentless dialog instead of asserting.
    const options: Electron.OpenDialogOptions = {
      title: '选择应用程序',
      filters: [{ name: '应用程序', extensions: ['exe', 'bat', 'cmd'] }],
      properties: ['openFile']
    }
    const parent = getLauncherWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }
    const filePath = result.filePaths[0]
    const name = filePath.split(/[\\/]/).pop()!.replace(/\.(exe|bat|cmd)$/i, '')
    return { canceled: false, path: filePath, name }
  })

  // ── Config IPC ──

  registerMessagePackHandler<void, LauncherConfig>('launcher:get-config', () => getConfig())

  registerMessagePackHandler<void, void>('launcher:hide', () => {
    hideLauncherWindow()
  })

  registerMessagePackHandler<void, CustomApp[]>('launcher:get-custom-apps', () => getConfig().customApps)

  registerMessagePackHandler<{ name: string; path: string }, CustomApp[]>('launcher:add-custom-app', (app) => {
    if (!app.name || !app.path) return getConfig().customApps
    if (!fs.existsSync(app.path)) return getConfig().customApps
    if (getConfig().customApps.some((a) => a.path === app.path)) return getConfig().customApps
    getConfig().customApps.push({ name: app.name, path: app.path })
    saveConfig()
    invalidateAppListCache()
    return getConfig().customApps
  })

  registerMessagePackHandler<string, CustomApp[]>('launcher:remove-custom-app', (appPath) => {
    getConfig().customApps = getConfig().customApps.filter((a) => a.path !== appPath)
    saveConfig()
    invalidateAppListCache()
    return getConfig().customApps
  })

  registerMessagePackHandler<Partial<LauncherConfig>, LauncherConfig & { shortcutRegistered: boolean }>('launcher:update-config', (patch) => {
    const wasEnabled = getConfig().enabled
    setConfig({ ...getConfig(), ...patch })
    saveConfig()

    let shortcutRegistered = true
    if (patch.enabled !== undefined || patch.accelerators !== undefined) {
      if (!getConfig().enabled) {
        unregisterShortcut()
      } else if (patch.accelerators !== undefined || !wasEnabled) {
        shortcutRegistered = registerShortcut()
      }
    }

    return { ...getConfig(), shortcutRegistered }
  })

  // ── Everything 文件搜索 IPC（S-151）──

  registerMessagePackHandler<void, EverythingStatus>('launcher:get-everything-status', () =>
    getEverythingStatus()
  )

  registerMessagePackHandler<
    void,
    { canceled: boolean; status: EverythingStatus; error?: string }
  >('launcher:pick-everything-exe', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '选择 Everything 主程序',
      filters: [{ name: 'Everything', extensions: ['exe'] }],
      properties: ['openFile']
    }
    const parent = getLauncherWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, status: await getEverythingStatus() }
    }

    const filePath = result.filePaths[0]
    const fileName = filePath.split(/[\\/]/).pop() ?? ''
    // 选错文件（比如挑了 unins000.exe）就说清楚，不静默存进去让用户后面一脸问号。
    if (!isEverythingExecutableName(fileName)) {
      return {
        canceled: false,
        status: await getEverythingStatus(),
        error: 'not-everything-exe'
      }
    }

    setConfig({ ...getConfig(), everythingExePath: filePath, everythingExePathAuto: false })
    saveConfig()
    invalidateEverythingProbe()
    return { canceled: false, status: await getEverythingStatus() }
  })

  registerMessagePackHandler<void, EverythingStatus>('launcher:clear-everything-exe', async () => {
    setConfig({ ...getConfig(), everythingExePath: '', everythingExePathAuto: false })
    saveConfig()
    invalidateEverythingProbe()
    return getEverythingStatus()
  })

  /**
   * 「本机检测」（S-151 二轮）：跑一轮**重探**（含扫盘），检测到就**直接绑定**。
   *
   * 老大 2026-09-28 15:38 的口径：「如果用户本机没有，那么我们提供两个选项 1.去安装 2.本机检测，
   * 如果检测到直接给他绑定上，**而不是引导用户去绑定**」。
   *
   * 绑定写进 `everythingExePath`（与手动指定同一个槽位 —— 它本来就是最高优先级），但
   * `everythingExePathAuto = true`，设置页据此显示「本机检测」而不是「手动指定」。
   * 用户已经手选过路径时**不动它** —— 那是用户自己的判断，优先级更高。
   */
  registerMessagePackHandler<void, EverythingStatus>('launcher:detect-everything', async () => {
    invalidateEverythingProbe()
    const status = await getEverythingStatus(true)
    if (!status.ready || !status.exePath || getConfig().everythingExePath.trim()) return status

    setConfig({ ...getConfig(), everythingExePath: status.exePath, everythingExePathAuto: true })
    saveConfig()

    // 绑定后直接构造结果，不再重探一遍（重探要再扫一次盘 + 四个子进程，纯浪费）。
    const bound: EverythingStatus = { ...status, source: 'manual', detected: true }
    setEverythingProbeCache({ at: Date.now(), status: bound, deep: true })
    return bound
  })

  // ── 文件搜索独立窗（S-155 调整⑤）──

  /** 打开独立窗：原窗自己收起 —— 窄条窗留着没用，还压着结果。 */
  registerMessagePackHandler<{ keyword?: string } | null, boolean>(
    'launcher:open-file-search',
    (payload) => {
      createFileSearchWindow(payload?.keyword ?? '')
      hideLauncherWindow()
      return true
    }
  )

  /** 独立窗的取数入口（分页 / 排序 / 分类都在 payload 里）。 */
  registerMessagePackHandler<EsQueryRequest | null, EsSearchResult>('file-search:query', (payload) =>
    executeFileQuery(payload ?? {})
  )

  /** 结果总数（底栏「共 N 条结果」）。读不到回 null —— 界面不显示，不编数。 */
  registerMessagePackHandler<
    { keyword?: string; category?: EsCategory } | null,
    { total: number | null }
  >('file-search:count', async (payload) => ({ total: await countFileResults(payload ?? {}) }))

  /** 批量取真实文件图标（`app.getFileIcon` + 缓存）。取不到的路径回 null，界面退通用图标。 */
  registerMessagePackHandler<string[], Record<string, string | null>>('file-search:icons', (paths) =>
    getFileIcons(paths)
  )

  /**
   * 「我已装好，重新检测」（S-253）。
   *
   * 两个探测缓存都得作废：`es.exe` 就装在 Everything 目录里，只作废其中一个会拿着旧结论继续报错，
   * 用户点了按钮还是那句「没找到」。返回重探后的 es 状态，界面据此决定要不要再搜一次。
   */
  registerMessagePackHandler<void, EsStatus>('file-search:redetect', async () => {
    invalidateEsProbe()
    invalidateEverythingProbe()
    return getEsStatus(true)
  })

  /**
   * 渲染端挂载后来取一次初始关键词（取完即清空）。
   *
   * 这是**首次开窗唯一可靠**的带词通道：`file-search:init` 那条是推的，推的时候渲染端还没挂上
   * 监听（见 `fileSearchInitialKeyword`）。
   */
  registerMessagePackHandler<void, string>('file-search:take-initial-keyword', () => {
    return takeFileSearchInitialKeyword()


  })

  registerMessagePackHandler<void, boolean>('file-search:close', () => {
    hideFileSearchWindow()
    return true
  })

  /** 点结果项：`reveal` 时定位到所在目录，否则用系统默认程序打开它。 */
  registerMessagePackHandler<
    { path: string; reveal?: boolean },
    { success: boolean; error?: string }
  >('launcher:open-hit', async (payload) => {
    const target = (payload?.path ?? '').trim()
    if (!target) return { success: false, error: 'empty-path' }

    if (payload?.reveal) {
      shell.showItemInFolder(target)
      return { success: true }
    }

    const failed = await shell.openPath(target)
    // openPath 成功返回空串，失败返回错误描述 —— 不看返回值等于假装用户点开了。
    return failed ? { success: false, error: failed } : { success: true }
  })

  registerMessagePackHandler<void, EsStatus>('launcher:get-es-status', () => getEsStatus())

  /**
   * 手动指定 es.exe。挑错文件就说清楚，不静默存进去让用户后面一脸问号。
   *
   * S-155 调整① 后这是**唯一的覆盖入口** —— es.exe 已内置，不再有「本机检测 / 获取 ES」两个通道。
   * 留着它只为一种场景：用户自己那份 es.exe 版本更新，想顶掉内置的。
   */
  registerMessagePackHandler<void, { canceled: boolean; status: EsStatus; error?: string }>(
    'launcher:set-es-exe',
    async () => {
      const options = {
        title: '选择 es.exe',
        properties: ['openFile' as const],
        filters: [{ name: 'es.exe', extensions: ['exe'] }]
      }
      const parent = getLauncherWindow()
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, status: await getEsStatus() }
      }

      const filePath = result.filePaths[0]
      const fileName = filePath.split(/[\\/]/).pop() ?? ''
      if (!isEsExecutableName(fileName)) {
        return { canceled: false, status: await getEsStatus(), error: 'not-es-exe' }
      }

      setConfig({ ...getConfig(), esExePath: filePath, esExePathAuto: false })
      saveConfig()
      invalidateEsProbe()
      return { canceled: false, status: await getEsStatus() }
    }
  )

  registerMessagePackHandler<void, EsStatus>('launcher:clear-es-exe', async () => {
    setConfig({ ...getConfig(), esExePath: '', esExePathAuto: false })
    saveConfig()
    invalidateEsProbe()
    return getEsStatus()
  })

  registerMessagePackHandler<void, void>('launcher:open-everything-download', () => {
    // 固定 URL 写死在这里，不接受渲染端传任意地址。
    void shell.openExternal(EVERYTHING_DOWNLOAD_URL)
  })
}