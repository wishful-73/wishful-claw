import { ipcMain } from 'electron'
import { mkdir, rm } from 'fs/promises'
import AdmZip from 'adm-zip'
import { getCodeGraphAssetStatus, resolveCodeGraphPluginDir } from '../lib/codegraph-assets'
import { disconnectBuiltinCodeGraph, reconnectBuiltinCodeGraph } from './mcp-handlers'
import { getPluginAssetManager } from './plugin-asset-handlers'
import { safeSendMessagePackToAllWindows } from '../window-ipc'

// Channel names mirror IPC.CODEGRAPH_* in src/renderer/src/lib/ipc/channels.ts.
const ASSET_STATUS = 'codegraph:asset-status'
// S-303 / 方案 B：引擎与语言包合成一个包，整体按需下载，不随安装包发布。
const DOWNLOAD_ASSETS = 'codegraph:download-assets'
const REMOVE_ASSETS = 'codegraph:remove-assets'
const DOWNLOAD_PROGRESS = 'codegraph:download-progress'

/**
 * 代码图谱插件资产 id（见 plugins/plugin-asset-catalog.ts）。
 *
 * 方案 B（2026-11-03 老大定）：引擎与语言包合成一个包，整体走插件资产下载。
 * 包结构 `bin/codegraph.exe` + `bin/e_sqlite3.dll` + `bin/grammars/*.dll`。
 */
const CODEGRAPH_ASSET_ID = 'codegraph/win-x64.zip'

function broadcast(channel: string, payload: unknown): void {
  // postMessage-based fan-out: webContents.send() can raise an uncatchable
  // async error when the target render frame is mid-disposal (Electron 35+).
  safeSendMessagePackToAllWindows(channel, payload)
}

/**
 * 删插件目录，对 EPERM / EBUSY 做短重试。
 *
 * `codegraph.exe` 是内置 MCP server 的 stdio 子进程，进程活着时 Windows 锁住 exe 与 dll。
 * 光靠先断开还不够：进程退出与文件句柄释放不是同一时刻，立刻 rm 仍可能拿到 EPERM
 * （2026-11-03 真机点在「移除」上报的就是这个）。5 次递增退避足够，不无限等。
 */
async function removeDirWithRetry(dir: string, attempts = 5): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'ENOTEMPTY'
      if (!retryable || attempt === attempts - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)))
    }
  }
}

/**
 * 同一时刻只允许一次安装。
 *
 * 两次并发调 download 会在同一个 `.part` 上互相踩；而且面板切走再切回来时，用户完全
 * 可能以为没开始、再点一次。这个闸门只管「同一份资产」。
 */
let installPromise: Promise<{ ok: boolean; message?: string }> | null = null

function installGrammarsOnce(): Promise<{ ok: boolean; message?: string }> {
  if (installPromise) return installPromise
  installPromise = installGrammars().finally(() => {
    installPromise = null
  })
  return installPromise
}

export function registerCodeGraphHandlers(): void {
  // installing 必须由主进程给：切到别的插件再切回来，组件是重新挂载的，本地进度 state
  // 全没了 —— 不靠这个字段，界面就会退回「下载代码图谱」，而下载其实还在跑。
  ipcMain.handle(ASSET_STATUS, () => ({
    ...getCodeGraphAssetStatus(),
    installing: installPromise !== null
  }))
  ipcMain.handle(DOWNLOAD_ASSETS, () => installGrammarsOnce())
  ipcMain.handle(REMOVE_ASSETS, () => removeGrammars())
}

// ── 语言包安装 / 移除（S-303）──

type GrammarsPhase = 'downloading' | 'extracting' | 'restarting' | 'ready' | 'failed'

function broadcastGrammarsProgress(
  phase: GrammarsPhase,
  extra?: { percent?: number; message?: string }
): void {
  broadcast(DOWNLOAD_PROGRESS, { phase, ...extra })
}

/**
 * 下载并安装语言包。
 *
 * 三步，每步失败都回到「没装」的状态 —— 不留半套 dll 让 worker 半死不活：
 *   1. 下载：复用 S-242 的 PluginAssetManager（断点续传 / 多源回退 / sha256 校验）
 *   2. 解压：先清空目标目录再解，避免上一版残留的 dll 混进来
 *   3. 拉起引擎：引擎是独立 MCP stdio server（方案 B），装好即连 —— 不重启 worker，
 *      worker 与代码图谱已无关系（主仓侧只剩一条内置 MCP 配置）
 */
async function installGrammars(): Promise<{ ok: boolean; message?: string }> {
  broadcastGrammarsProgress('downloading', { percent: 0 })

  const manager = getPluginAssetManager()
  const downloaded = await manager.download(CODEGRAPH_ASSET_ID)
  if (downloaded.state !== 'ready' || !downloaded.path) {
    const message = downloaded.error ?? '代码图谱插件下载失败'
    broadcastGrammarsProgress('failed', { message })
    return { ok: false, message }
  }

  broadcastGrammarsProgress('extracting')

  // 解到插件根目录，解出来的就是 bin/ 子树（引擎 + SQLite + grammars）。
  const targetDir = resolveCodeGraphPluginDir()
  try {
    // 重装 / 升级时旧引擎可能正在跑：先断开再删，否则 rm 撞上被锁的 exe 就是 EPERM
    await disconnectBuiltinCodeGraph()
    await removeDirWithRetry(targetDir)
    await mkdir(targetDir, { recursive: true })
    new AdmZip(downloaded.path).extractAllTo(targetDir, true)
  } catch (error) {
    const message = `代码图谱插件解压失败：${error instanceof Error ? error.message : String(error)}`
    await removeDirWithRetry(targetDir).catch(() => undefined)
    broadcastGrammarsProgress('failed', { message })
    return { ok: false, message }
  }

  // 解压完必须真的认得出来才算装好 —— 空目录、零字节 dll 都算失败
  if (!getCodeGraphAssetStatus().pluginGrammarsReady) {
    const message = '代码图谱插件解压后校验未通过（核心库或语法库缺失）'
    await removeDirWithRetry(targetDir).catch(() => undefined)
    broadcastGrammarsProgress('failed', { message })
    return { ok: false, message }
  }

  broadcastGrammarsProgress('restarting')
  // 引擎是独立 MCP stdio server，装好即拉起；连不上不影响本次安装结果。
  await reconnectBuiltinCodeGraph()

  broadcastGrammarsProgress('ready', { percent: 100 })
  return { ok: true }
}

/**
 * 移除插件，回到「未安装」态。资产缓存的 zip 和已解压的整套 bin/ 一起删。
 *
 * 不动索引数据库 —— 索引落在 `{project}/.wishful-claw/codegraph`，用户卸个插件
 * 不该连图谱数据一起丢；重新装上还是原来那份。
 */
async function removeGrammars(): Promise<{ ok: boolean; message?: string }> {
  await getPluginAssetManager().remove(CODEGRAPH_ASSET_ID)
  // 顺序不能反：必须先断开内置 MCP server，再删目录。`codegraph.exe` 是它的 stdio
  // 子进程，进程活着时 Windows 锁着 exe / dll，直接删就是 EPERM
  // （2026-11-03 老大点「移除」报的错 —— 原来是先删后断，永远删不掉）。
  await disconnectBuiltinCodeGraph()
  try {
    // 整个插件根都删 —— 引擎和 SQLite 原生库也在里面，不只 grammars。
    await removeDirWithRetry(resolveCodeGraphPluginDir())
  } catch (error) {
    const message = `代码图谱插件移除失败：${error instanceof Error ? error.message : String(error)}`
    return { ok: false, message }
  }
  await reconnectBuiltinCodeGraph()
  return { ok: true }
}
