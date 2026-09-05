import type { CompressionStatusMeta } from '@renderer/lib/api/types'

const knownCompressionOperations = new Map<string, CompressionStatusMeta>()

export function trackCompressionStatus(meta: CompressionStatusMeta): void {
  if (!meta.operationId) return
  const previous = knownCompressionOperations.get(meta.operationId)
  knownCompressionOperations.set(meta.operationId, {
    ...previous,
    ...meta,
    displayAnchor: meta.displayAnchor ?? previous?.displayAnchor
  })
}

export function getCompressionStatus(operationId?: string): CompressionStatusMeta | undefined {
  return operationId ? knownCompressionOperations.get(operationId) : undefined
}

export function isCompressionOperationKnown(operationId?: string): boolean {
  return Boolean(operationId && knownCompressionOperations.has(operationId))
}
