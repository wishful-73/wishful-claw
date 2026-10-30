/*
 * 插件资产 IPC（S-242）。六个动作：catalog / status / download / cancel / verify / remove。
 *
 * 进度走推送（`plugin-asset:progress`），不走轮询 —— 几百 MB 的下载让用户盯着
 * 一个不动的百分比是不可接受的。事件广播给所有窗口：插件面板只会在一个窗口里开，
 * 但广播的代价比重算「谁发起的」低得多。
 */

import { BrowserWindow } from 'electron'
import {
  encodeMessagePackPayload,
  toMessagePackChannel
} from '../../shared/messagepack/binary-ipc'
import { registerMessagePackHandler } from './messagepack-handler'
import { resolveDataPath } from '../lib/data-dir'
import {
  listCatalog,
  toPublicAssetInfo
} from '../plugins/plugin-asset-catalog'
import {
  PluginAssetManager,
  type PluginAssetProgressEvent,
  type PluginAssetStatus
} from '../plugins/plugin-assets'
import type { PluginAssetPublicInfo } from '../../shared/plugin-asset-types'

const PROGRESS_CHANNEL = 'plugin-asset:progress'

let manager: PluginAssetManager | null = null

function broadcastProgress(event: PluginAssetProgressEvent): void {
  const payload = encodeMessagePackPayload(event)
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try {
      window.webContents.send(toMessagePackChannel(PROGRESS_CHANNEL), payload)
    } catch {
      // 窗口正好在关，丢掉这一帧就行
    }
  }
}

/** 懒建单例：共享资产根是 `{dataRoot}/plugin-assets`。 */
function getManager(): PluginAssetManager {
  if (!manager) {
    manager = new PluginAssetManager({
      rootDir: resolveDataPath('plugin-assets'),
      emit: broadcastProgress
    })
  }
  return manager
}

function readId(args: string | { id?: string; assetId?: string } | undefined): string {
  if (typeof args === 'string') return args.trim()
  return (args?.id ?? args?.assetId ?? '').trim()
}

export function registerPluginAssetHandlers(): void {
  registerMessagePackHandler<undefined, PluginAssetPublicInfo[]>(
    'plugin-asset:catalog',
    async () => listCatalog().map(toPublicAssetInfo)
  )

  registerMessagePackHandler<string | { id?: string }, PluginAssetStatus>(
    'plugin-asset:status',
    async (args) => getManager().status(readId(args))
  )

  registerMessagePackHandler<string[] | { ids?: string[] }, PluginAssetStatus[]>(
    'plugin-asset:status-of',
    async (args) => getManager().statusOf(Array.isArray(args) ? args : (args?.ids ?? []))
  )

  registerMessagePackHandler<string | { id?: string }, PluginAssetStatus>(
    'plugin-asset:download',
    async (args) => getManager().download(readId(args))
  )

  registerMessagePackHandler<string | { id?: string }, { cancelled: boolean }>(
    'plugin-asset:cancel',
    async (args) => ({ cancelled: getManager().cancel(readId(args)) })
  )

  registerMessagePackHandler<string | { id?: string }, PluginAssetStatus>(
    'plugin-asset:verify',
    async (args) => getManager().verify(readId(args))
  )

  registerMessagePackHandler<string | { id?: string }, { removed: boolean }>(
    'plugin-asset:remove',
    async (args) => {
      await getManager().remove(readId(args))
      return { removed: true }
    }
  )
}
