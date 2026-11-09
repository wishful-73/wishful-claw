/**
 * 出站媒体来源读取 —— 本地路径或 http(s) URL 统一读成 Buffer。
 *
 * 从 `src/main/ipc/channel-handlers/channel-handler-utils.ts` 搬家至此，原因：
 * 渠道服务层（`channels/providers/*-service.ts`）要用它，而 IPC 层 import 渠道层
 * 是正常方向；反过来让渠道层 import IPC 工具会绕成
 * channel-handler-utils → channel-manager → providers/*-service → 本文件 → channel-handler-utils
 * 的循环依赖。
 *
 * IPC 层仍在 `channel-handler-utils.ts` 里 re-export 同名函数，调用方无需改动。
 */

import * as fs from 'fs'
import * as path from 'path'

/** 从来源推断文件名（URL 取 pathname，本地取 basename），推断不出用 fallback */
export function resolveSourceFileName(source: string, fallback: string): string {
  const value = source.trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const fileName = path.basename(url.pathname)
      return decodeURIComponent(fileName || fallback)
    } catch {
      return fallback
    }
  }

  const sanitized = value.split('?')[0]
  return path.basename(sanitized) || fallback
}

/** 读取媒体来源。支持 http(s) URL 与本地绝对路径，其余一律抛错 */
export async function readBinarySource(
  source: string,
  fallbackName: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const value = source.trim()
  if (!value) {
    throw new Error('File path is empty')
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value)
    if (!response.ok) {
      throw new Error(`Download URL failed: HTTP ${response.status}`)
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      fileName: resolveSourceFileName(value, fallbackName)
    }
  }

  if (!fs.existsSync(value)) {
    throw new Error(`File not found: ${value}`)
  }

  return {
    buffer: fs.readFileSync(value),
    fileName: resolveSourceFileName(value, fallbackName)
  }
}
