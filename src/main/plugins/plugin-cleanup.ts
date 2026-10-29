/*
 * 插件卸载清理（S-244 §4.2）。
 *
 * 卸载要清三处：插件目录、私有 KV、session 分区。
 *   - 插件目录 / state / KV / secret → C# 侧 `extension/remove` 早就做完了（`ExtensionManifestStore.cs:140-186`）
 *   - **session 分区**是 S-241 才出现的东西，C# 那边根本不知道它存在 → 只能在这里清
 *
 * 分区名与目录名都由插件 id 推导，判据在 `plugin-cleanup-rules.ts`（纯函数、有独立套件）。
 * 这个文件只负责 Electron 那一侧：真正去 clearStorageData / rm 目录。
 */

import { app, session } from 'electron'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  pluginPartitionDirName,
  pluginPartitionName
} from './plugin-cleanup-rules'

/** 插件 id → 分区目录全路径。id 不合法返回 null。 */
export function pluginPartitionDir(id: string): string | null {
  const dirName = pluginPartitionDirName(id)
  return dirName ? join(app.getPath('userData'), 'Partitions', dirName) : null
}

/**
 * 清掉一个插件的 session 分区（cookies / localStorage / IndexedDB / cache）。
 *
 * 不抛错：清理是「尽力而为」，任一步失败只记 warning 交给上层提示。一个锁住的 Cookie
 * 文件不该让整个卸载流程停在那里 —— 那会留下「列表里有、目录删了一半」的脏状态。
 * 目录删不掉通常是 Electron 还握着句柄，提示用户重启即可。
 */
export async function clearPluginSessionData(id: string): Promise<string[]> {
  const partition = pluginPartitionName(id)
  if (!partition) return [`invalid extension id: ${id}`]

  const warnings: string[] = []
  const target = session.fromPartition(partition)
  try {
    await target.clearStorageData()
  } catch (error) {
    warnings.push(`clear storage: ${(error as Error).message}`)
  }
  try {
    await target.clearCache()
  } catch (error) {
    warnings.push(`clear cache: ${(error as Error).message}`)
  }

  const dir = pluginPartitionDir(id)
  if (dir && existsSync(dir)) {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch (error) {
      warnings.push(`remove partition dir: ${(error as Error).message}`)
    }
  }

  return warnings
}
