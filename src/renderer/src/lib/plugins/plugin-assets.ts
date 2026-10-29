/*
 * 插件资产（S-242）渲染端入口。
 *
 * 渲染端只认 id 和状态，不认 URL / 哈希 —— 那两样留在主进程目录表里。
 * 进度是主进程推过来的，不轮询：几百 MB 的下载靠定时拉状态，用户看到的
 * 百分比会一格一格地跳。
 */

import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import type {
  PluginAssetProgressEvent,
  PluginAssetPublicInfo,
  PluginAssetStatus
} from '@shared/plugin-asset-types'

export type {
  PluginAssetProgressEvent,
  PluginAssetPublicInfo,
  PluginAssetState,
  PluginAssetStatus
} from '@shared/plugin-asset-types'
export { formatAssetSize } from '@shared/plugin-asset-types'

/** 一批资产的状态（未知 id 会如实返回 `unknown`，不会丢）。 */
export async function fetchAssetStatuses(ids: string[]): Promise<PluginAssetStatus[]> {
  if (ids.length === 0) return []
  const result = await ipcClient.invoke(IPC.PLUGIN_ASSET_STATUS_OF, ids)
  return Array.isArray(result) ? (result as PluginAssetStatus[]) : []
}

/**
 * 主程序内置目录表（S-242）。渲染端只能拿到 id / 名称 / 用途 / 体积 ——
 * URL 与 sha256 留在主进程，插件看不见。
 */
export async function fetchAssetCatalog(): Promise<PluginAssetPublicInfo[]> {
  const result = await ipcClient.invoke(IPC.PLUGIN_ASSET_CATALOG)
  return Array.isArray(result) ? (result as PluginAssetPublicInfo[]) : []
}

/** 删掉一个已下载的资产（S-244：卸载不删共享资产，删除只能从这里来）。 */
export async function removeAsset(id: string): Promise<{ removed: boolean }> {
  return (await ipcClient.invoke(IPC.PLUGIN_ASSET_REMOVE, id)) as { removed: boolean }
}

export async function downloadAsset(id: string): Promise<PluginAssetStatus> {
  return (await ipcClient.invoke(IPC.PLUGIN_ASSET_DOWNLOAD, id)) as PluginAssetStatus
}

export async function cancelAsset(id: string): Promise<{ cancelled: boolean }> {
  return (await ipcClient.invoke(IPC.PLUGIN_ASSET_CANCEL, id)) as { cancelled: boolean }
}

export async function verifyAsset(id: string): Promise<PluginAssetStatus> {
  return (await ipcClient.invoke(IPC.PLUGIN_ASSET_VERIFY, id)) as PluginAssetStatus
}

/** 订阅下载进度，返回取消订阅。 */
export function onAssetProgress(
  callback: (event: PluginAssetProgressEvent) => void
): () => void {
  return ipcClient.on(IPC.PLUGIN_ASSET_PROGRESS, (payload) => {
    if (payload && typeof payload === 'object') {
      callback(payload as PluginAssetProgressEvent)
    }
  })
}
