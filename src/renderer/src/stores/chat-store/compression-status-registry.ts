import type { CompressionStatusMeta } from '@renderer/lib/api/types'

const knownCompressionOperations = new Set<string>()

export function trackCompressionStatus(meta: CompressionStatusMeta): void {
  if (meta.operationId) {
    knownCompressionOperations.add(meta.operationId)
  }
}

export function isCompressionOperationKnown(operationId?: string): boolean {
  return Boolean(operationId && knownCompressionOperations.has(operationId))
}
