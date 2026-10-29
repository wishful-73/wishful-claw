/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { shell } from 'electron'
import { registerMessagePackHandler } from './messagepack-handler'
import type { ExtensionInstance } from '../../shared/extension-types'
import { getMcpManager } from './mcp-handlers'
import { nativeExtensionRequest } from './extension-native-bridge'
import {
  getExtensionAggregateInfo,
  reconcileExtensionSync,
  syncExtensionResources,
  unsyncExtensionResources,
  type ExtensionAggregateInfo
} from './extension-plugin-sync'
import { clearPluginSessionData } from '../plugins/plugin-cleanup'
import { closePluginView } from '../plugins/plugin-window'

type MutationResult = {
  success: boolean
  error?: string
  /**
   * 卸载时清理不干净的原因（S-244）。主流程照样算成功 —— 插件已经删了，
   * 用一条「重启后自动收尾」提示把残留交给用户知情，比让卸载按钮报错更有用。
   */
  cleanupWarnings?: string[]
}

type ExtensionUpdateArgs = {
  id: string
  patch: {
    enabled?: boolean
    config?: Record<string, string>
  }
}

type ExtensionAssetArgs = {
  id: string
  path: string
}

type ExtensionStorageGetArgs = {
  extensionId: string
  key: string
}

type ExtensionStorageSetArgs = ExtensionStorageGetArgs & {
  value: unknown
}

type ExtensionPathResult = MutationResult & {
  path?: string
}

function getExtensionId(args: string | { id?: string }): string {
  return typeof args === 'string' ? args : (args.id ?? '')
}

/**
 * Register extension management IPC handlers.
 * Ported from WishfulClaw extension-handlers.ts, adapted for wishful-claw:
 * - Uses getMcpManager() from mcp-handlers instead of parameter injection
 * - Uses registerMessagePackHandler instead of ipcMain.handle
 */
export function registerExtensionHandlers(): void {
  // Converge aggregate resources (MCP servers) with the current
  // enabled state, including changes made while the app was closed.
  void reconcileExtensionSync(getMcpManager())

  registerMessagePackHandler<undefined, ExtensionInstance[]>('extension:list', async () => {
    return await nativeExtensionRequest<ExtensionInstance[]>('extension/list')
  })

  registerMessagePackHandler<{ sourcePath: string }, MutationResult>(
    'extension:install-from-folder',
    async (args) => {
      const result = await nativeExtensionRequest<MutationResult>(
        'extension/install-from-folder',
        args
      )
      if (result.success) await reconcileExtensionSync(getMcpManager())
      return result
    }
  )

  registerMessagePackHandler<ExtensionUpdateArgs, MutationResult & { syncWarnings?: string[] }>(
    'extension:update',
    async (args) => {
      const result = await nativeExtensionRequest<MutationResult>('extension/update', args)
      if (result.success && typeof args.patch.enabled === 'boolean') {
        if (args.patch.enabled) {
          const syncWarnings = await syncExtensionResources(args.id, getMcpManager())
          return syncWarnings.length > 0 ? { ...result, syncWarnings } : result
        }
        await unsyncExtensionResources(args.id, getMcpManager())
      }
      return result
    }
  )

  registerMessagePackHandler<string | { id?: string }, ExtensionAggregateInfo>(
    'extension:aggregate-info',
    async (args) => {
      return await getExtensionAggregateInfo(getExtensionId(args))
    }
  )

  registerMessagePackHandler<string | { id?: string }, MutationResult>(
    'extension:remove',
    async (args) => {
      const id = getExtensionId(args)
      // 顺序钉死（S-244 §4.2）：停用并收子进程 → 关插件窗口 → 清 session 分区 →
      // 交给 C# 删插件目录 / state / KV / secret。窗口先关再清分区，否则渲染进程
      // 还在往同一个分区写 localStorage，清完立刻又长回来。
      await unsyncExtensionResources(id, getMcpManager())
      closePluginView(id)
      const cleanupWarnings = await clearPluginSessionData(id)
      const result = await nativeExtensionRequest<MutationResult>('extension/remove', { id })
      return cleanupWarnings.length > 0 ? { ...result, cleanupWarnings } : result
    }
  )

  registerMessagePackHandler<string | { id?: string }, MutationResult>(
    'extension:open-folder',
    async (args) => {
      const result = await nativeExtensionRequest<ExtensionPathResult>('extension/resolve-path', {
        id: getExtensionId(args)
      })
      if (!result.success || !result.path) {
        return { success: false, error: result.error ?? 'Extension path not found' }
      }

      const error = await shell.openPath(result.path)
      return error ? { success: false, error } : { success: true }
    }
  )

  registerMessagePackHandler<ExtensionAssetArgs, { content: string } | { error: string }>(
    'extension:read-asset',
    async (args) => {
      return await nativeExtensionRequest<{ content: string } | { error: string }>(
        'extension/read-asset',
        args
      )
    }
  )

  registerMessagePackHandler<ExtensionStorageGetArgs>('extension:storage-get', async (args) => {
    return await nativeExtensionRequest<unknown>('extension/storage-get', args)
  })

  registerMessagePackHandler<ExtensionStorageSetArgs, MutationResult>(
    'extension:storage-set',
    async (args) => {
      return await nativeExtensionRequest<MutationResult>('extension/storage-set', args)
    }
  )

  registerMessagePackHandler<ExtensionStorageGetArgs, MutationResult>(
    'extension:storage-delete',
    async (args) => {
      return await nativeExtensionRequest<MutationResult>('extension/storage-delete', args)
    }
  )
}
