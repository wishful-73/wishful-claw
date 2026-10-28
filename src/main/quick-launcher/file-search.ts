/**
 * 文件搜索独立窗（S-155 调整⑤）：窗口、图标、取数与总数。
 *
 * S-249 从 `quick-launcher.ts` 搬出。相对原文件只有两处改动：`registerLauncherIpc()` → `ensureLauncherIpc()`
 * （拆开后 ipc.ts 反过来要 import 本模块，直接的互相 import 会成环，改走一条注入线），
 * 以及把初始关键词槽的读写收成一个 `takeFileSearchInitialKeyword()`。窗口参数、缓存上限、
 * 首次开窗不走推送的理由全部原样平移。
 *
 * 老大 2026-09-29 的口径：搜索结果不该挤在原窗里（原窗是「搜应用」的窄条、失焦即隐），
 * 「搜索文件」另开一个**常规窗** —— 有系统按钮、可拖可缩、进任务栏、失焦不消失。
 */

import { app, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { resolveDataDir } from '../lib/data-dir'
import { ES_PROCESS_TIMEOUT_MS, buildEsCountArgs, parseEsResultCount, type EsCategory } from '../lib/es-search'
import { forceActivateWindow } from '../priority-shortcuts'
import { safeSendMessagePackToWindow } from '../window-ipc'
import { ensureLauncherIpc } from './ipc-registrar'
import {
  enqueueEsSearch,
  getEsStatus,
  invalidateEsProbe,
  runEsSearch,
  startEverythingAndRetry
} from './es-probe'
import type { EsQueryRequest, EsSearchResult } from './types'

// ── 文件搜索独立窗（S-155 调整⑤）────────────────────────────────────────────
//
// 老大 2026-09-29 的口径：搜索结果不该挤在原窗里（原窗是「搜应用」的窄条、失焦即隐），
// 「搜索文件」另开一个**常规窗** —— 有系统按钮、可拖可缩、进任务栏、失焦不消失。
// 形态照抄剪贴板小窗那套（`clipboard-enhancer.ts` 的 `createClipboardWindow`），只是不用
// `frame:false`（保留系统标题栏的最小化 / 关闭）、也不置顶 —— 置顶与关闭都由系统标题栏管。

const FILE_SEARCH_WIDTH = 960
const FILE_SEARCH_HEIGHT = 640

let fileSearchWindow: BrowserWindow | null = null

/**
 * 新窗待消费的初始关键词（原窗带过来的已输入文字）。
 *
 * 为什么要这个槽，而不是光靠 `file-search:init` 推：那条是**推**给渲染端的，而**首次开窗**时
 * 渲染端还没挂载监听 —— `on` 只是 `ipcRenderer.on` 的封装，注册时机在 React 的 `useEffect`，
 * 晚于主进程发消息的 `did-finish-load`，消息直接丢。表现就是「第一次点搜索文件带不过文字，
 * 关掉再开一次就好了」。所以创建时先存这儿，渲染端挂载后主动来取（取完清空）。
 */
let fileSearchInitialKeyword = ''

/** 文件图标缓存（data URL）。同一目录下大量文件的图标通常一样，命中率很高。 */
const fileIconCache = new Map<string, string | null>()

/** 缓存上限。到顶就按插入序丢最老的一批（不做 LRU 精细淘汰，够用且不会无界增长）。 */
const FILE_ICON_CACHE_LIMIT = 600

/** 一次最多取多少个图标。整页 100 条以内，给 300 的余量足够，也拦住乱传的大数组。 */
const FILE_ICON_BATCH_LIMIT = 300

/**
 * 结果总数（底栏「共 N 条结果」）。
 *
 * 单独一次进程：`-get-result-count` 与导出互斥；而且**只有关键词/分类变了才需要重算** ——
 * 翻页时总数不变，不该跟着重跑一遍。读不到就回 `null`，界面不显示总数（不编一个数）。
 */
export function runEsCountProcess(exePath: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      execFile(
        exePath,
        args,
        {
          windowsHide: true,
          timeout: ES_PROCESS_TIMEOUT_MS,
          encoding: 'utf8',
          maxBuffer: 1024 * 1024,
          cwd: resolveDataDir()
        },
        (error, stdout) => {
          if (error) {
            resolve(null)
            return
          }
          resolve(parseEsResultCount(typeof stdout === 'string' ? stdout : ''))
        }
      )
    } catch {
      resolve(null)
    }
  })
}

export async function countFileResults(request: {
  keyword?: string
  category?: EsCategory
}): Promise<number | null> {
  const status = await getEsStatus()
  if (!status.ready || !status.exePath) return null

  const args = buildEsCountArgs(request.keyword ?? '', request.category ?? 'all')
  if (!args) return null

  const exePath = status.exePath
  return enqueueEsSearch(() => runEsCountProcess(exePath, args))
}

/**
 * 取数 + 失败兜底：探测失效就作废重探、Everything 没跑就替他拉起重试。
 *
 * 独立窗的 `file-search:query` 与底栏的 `file-search:count` 都走这一套 —— 兜底逻辑一个字都不该
 * 抄两遍（原来还有个 `launcher:search-files`，调整⑤ 删了）。
 */
export async function executeFileQuery(request: EsQueryRequest): Promise<EsSearchResult> {
  const status = await getEsStatus()
  if (!status.ready || !status.exePath) {
    return { ok: false, hits: [], failure: 'spawn-failed', error: 'es-not-ready' }
  }

  const exePath = status.exePath
  let result = await enqueueEsSearch(() => runEsSearch(exePath, request))

  // es.exe 失效（用户删了 / 换了盘）⇒ 让下一轮探测重新找，别一直拿死路径报错。
  if (result.failure === 'spawn-failed') {
    invalidateEsProbe()
    return result
  }

  // Everything 没在跑 ⇒ 替他拉起来再重试（S-155 调整②），别让用户自己去找。
  if (result.failure === 'not-running') {
    result = await startEverythingAndRetry(exePath, request, result)
  }
  return result
}

/** 单个路径的文件图标（data URL）。取不到回 `null`，界面退化成通用图标，不能因此丢整行。 */
export async function getFileIconDataUrl(target: string): Promise<string | null> {
  if (fileIconCache.has(target)) return fileIconCache.get(target) ?? null

  let icon: string | null = null
  try {
    const image = await app.getFileIcon(target, { size: 'small' })
    icon = image.isEmpty() ? null : image.toDataURL()
  } catch {
    // 文件已经不在了（搜索到点击之间被删）—— 当成没有图标。
    icon = null
  }

  if (fileIconCache.size >= FILE_ICON_CACHE_LIMIT) {
    let drop = Math.ceil(FILE_ICON_CACHE_LIMIT / 4)
    for (const key of fileIconCache.keys()) {
      fileIconCache.delete(key)
      drop -= 1
      if (drop <= 0) break
    }
  }
  fileIconCache.set(target, icon)
  return icon
}

/** 批量取图标。路径按原样回填成 `{ 路径: dataURL | null }`，渲染端按行取用。 */
export async function getFileIcons(targets: string[]): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  const wanted = (Array.isArray(targets) ? targets : [])
    .filter((target) => typeof target === 'string' && target.trim().length > 0)
    .slice(0, FILE_ICON_BATCH_LIMIT)

  await Promise.all(
    wanted.map(async (target) => {
      result[target] = await getFileIconDataUrl(target)
    })
  )
  return result
}

export function hideFileSearchWindow(): void {
  if (fileSearchWindow && !fileSearchWindow.isDestroyed()) fileSearchWindow.hide()
}

/**
 * 开（或唤到最前）文件搜索独立窗。
 *
 * `keyword` 是原窗带过来的已输入文字 —— 用户在原窗打了一半才发现要搜文件，不该让他重打。
 * 已有实例时只把文字推过去（`file-search:init`），不重建窗（重建会丢用户的分类/滚动位置）。
 */
export function createFileSearchWindow(keyword = ''): void {
  ensureLauncherIpc()

  const initialKeyword = (keyword ?? '').trim()

  if (fileSearchWindow && !fileSearchWindow.isDestroyed()) {
    if (!fileSearchWindow.isVisible()) fileSearchWindow.show()
    if (!forceActivateWindow(fileSearchWindow)) fileSearchWindow.focus()
    if (initialKeyword) {
      safeSendMessagePackToWindow(fileSearchWindow, 'file-search:init', { keyword: initialKeyword })
    }
    // 这条窗的渲染端早就挂载了，推送收得到 —— 槽不留东西，免得谁刷新页面时又取到旧词。
    fileSearchInitialKeyword = ''
    return
  }

  // 新窗：文字先存槽，等渲染端挂载后主动来取（首次开窗推消息必丢，见 fileSearchInitialKeyword）。
  fileSearchInitialKeyword = initialKeyword

  fileSearchWindow = new BrowserWindow({
    width: FILE_SEARCH_WIDTH,
    height: FILE_SEARCH_HEIGHT,
    minWidth: 720,
    minHeight: 420,
    show: false,
    title: '文件搜索',
    autoHideMenuBar: true,
    // 常规窗：有系统最小化/最大化/关闭，可拖可缩，**进任务栏**（用户可能想切回来继续看结果）。
    // 不设 `alwaysOnTop`，也不设透明 —— 省掉一层合成开销。
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  fileSearchWindow.on('closed', () => {
    fileSearchWindow = null
  })

  // 失焦**不隐藏**（跟原窗相反）：这是用户在用的窗，挡住搜索是他自己的选择。
  fileSearchWindow.webContents.on('did-finish-load', () => {
    const win = fileSearchWindow
    if (!win || win.isDestroyed()) return
    // 关键词**不在这里推**：此刻渲染端还没挂上监听（见 fileSearchInitialKeyword），推必丢。
    // 它挂载后会主动来取。这里只管把窗露出来。
    if (!win.isVisible()) win.show()
  })
  fileSearchWindow.once('ready-to-show', () => {
    const win = fileSearchWindow
    if (!win || win.isDestroyed() || win.isVisible()) return
    win.show()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    fileSearchWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/file-search.html`)
  } else {
    fileSearchWindow.loadFile(join(__dirname, '../renderer/file-search.html'))
  }

  // 从原窗（alwaysOnTop + 透明）跳过来时，新窗抢不抢得到前台是另一回事 —— 走同一套
  // 强制激活兜底，失败了再退化成普通 focus。
  if (!forceActivateWindow(fileSearchWindow)) fileSearchWindow.focus()
}

/** 取走待消费的初始关键词（取完即清空）—— IPC 的 `file-search:take-initial-keyword` 走这里。 */
export function takeFileSearchInitialKeyword(): string {
  const pending = fileSearchInitialKeyword
  fileSearchInitialKeyword = ''
  return pending
}