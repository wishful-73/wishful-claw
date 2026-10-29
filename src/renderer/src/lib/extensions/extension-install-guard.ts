/*
 * 安装前置（S-244 §4.1）：选中目录之后、真正落盘之前，先让用户看清自己在装什么。
 *
 * 两条纪律：
 *  1. **体积必须来自主程序目录表**，不取插件自报。目录表里查不到的资产 id 不计入体积
 *     （少报好过多报，更不能编一个数字）。
 *  2. **确认按插件 id 记住**，同一个插件更新时不再问。存 localStorage —— 它天然是
 *     渲染端的展示偏好，不进 manifest、不进 C# state，也不会被插件读到。
 */

import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { fetchAssetCatalog } from '@renderer/lib/plugins/plugin-assets'

export interface ExtensionInstallPreview {
  id: string
  name: string
  version: string
  description: string
  toolCount: number
  viewCount: number
  /** 需额外下载的总字节数；0 表示没有（或全部查不到） */
  assetBytes: number
  /** 目录表能对上号的资产数量 —— 用来说明「有 XX 个运行文件要下载」 */
  assetCount: number
}

const ACK_STORAGE_KEY = 'wishful.extension.install-ack'

/** 与 C# `ExtensionIdRegex` 一致；此处只用于提前给出人话错误，真正的校验在后端。 */
const EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/

function readCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * 读插件目录里的 `extension.json` 摘要。
 *
 * 失败一律抛「人话」错误：用户选错目录（选成插件里的子目录、选成任意文件夹）是最常见的
 * 情况，这时候抛 `Unexpected token <` 等于没说。
 */
export async function readExtensionInstallPreview(folder: string): Promise<ExtensionInstallPreview> {
  const manifestPath = `${folder.replace(/[\\/]+$/, '')}/extension.json`
  const raw = (await ipcClient.invoke(IPC.FS_READ_FILE, { path: manifestPath })) as string
  if (!raw || raw.trim().length === 0) {
    throw new Error('这个目录里没有 extension.json，请选择插件根目录')
  }

  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('extension.json 不是合法的 JSON')
  }

  const id = String(manifest.id ?? '').trim().toLowerCase()
  const name = String(manifest.name ?? '').trim()
  const version = String(manifest.version ?? '').trim()
  if (!EXTENSION_ID_PATTERN.test(id)) throw new Error('extension.json 的 id 不合法')
  if (name.length === 0) throw new Error('extension.json 缺少 name')
  if (version.length === 0) throw new Error('extension.json 缺少 version')

  const declaredAssetIds = (Array.isArray(manifest.assets) ? manifest.assets : [])
    .map((entry) => String((entry as { id?: unknown })?.id ?? '').trim())
    .filter((assetId) => assetId.length > 0)

  let assetBytes = 0
  let assetCount = 0
  if (declaredAssetIds.length > 0) {
    const catalog = await fetchAssetCatalog()
    for (const assetId of declaredAssetIds) {
      const entry = catalog.find((item) => item.id === assetId)
      if (!entry) continue
      assetBytes += entry.size
      assetCount += 1
    }
  }

  return {
    id,
    name,
    version,
    description: String(manifest.description ?? '').trim(),
    toolCount: readCount(manifest.tools),
    viewCount: readCount(manifest.views),
    assetBytes,
    assetCount
  }
}

function readAckSet(): Set<string> {
  try {
    const raw = window.localStorage.getItem(ACK_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item)) : [])
  } catch {
    return new Set()
  }
}

export function isInstallAcknowledged(id: string): boolean {
  return readAckSet().has(id.trim().toLowerCase())
}

/** 记住「这个插件的安装确认用户已经点过」—— 之后再装 / 更新都不再问。 */
export function acknowledgeExtensionInstall(id: string): void {
  const normalized = id.trim().toLowerCase()
  if (!normalized) return
  const acked = readAckSet()
  if (acked.has(normalized)) return
  acked.add(normalized)
  try {
    window.localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify([...acked]))
  } catch {
    // 存储满了也不该挡住安装本身 —— 最坏情况是下次再问一遍
  }
}
