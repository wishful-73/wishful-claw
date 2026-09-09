/**
 * Provider source index for managed models.
 *
 * Maps each managed model (by normalizedKey) to the list of providers
 * (both configured and preset-only) that expose it.
 *
 * Migrated from OpenCowork's ProviderPanel.tsx.
 */

import type { AIProvider, ProviderType } from '../../../../../shared/types/provider'
import { builtinProviderPresets } from '@renderer/stores/providers'
import { normalizeModelKey } from '@renderer/stores/managed-models'

const BUILTIN_PROVIDER_KEY_PREFIX = 'builtin:'
const CUSTOM_PROVIDER_KEY_PREFIX = 'provider:'

export interface ManagedModelProviderSource {
  key: string
  name: string
  type: ProviderType
  builtinId?: string
  configured: boolean
  enabled?: boolean
}

export function getProviderSourceKey(provider: Pick<AIProvider, 'id' | 'builtinId'>): string {
  return provider.builtinId
    ? `${BUILTIN_PROVIDER_KEY_PREFIX}${provider.builtinId}`
    : `${CUSTOM_PROVIDER_KEY_PREFIX}${provider.id}`
}

function addManagedModelProviderSource(
  index: Map<string, ManagedModelProviderSource[]>,
  modelId: string,
  source: ManagedModelProviderSource
): void {
  const modelKey = normalizeModelKey(modelId)
  const sources = index.get(modelKey) ?? []
  const existingIndex = sources.findIndex((item) => item.key === source.key)

  if (existingIndex >= 0) {
    const existing = sources[existingIndex]
    sources[existingIndex] = {
      ...existing,
      ...source,
      configured: existing.configured || source.configured,
      enabled: existing.enabled || source.enabled
    }
    index.set(modelKey, sources)
    return
  }

  index.set(modelKey, [...sources, source])
}

function sortManagedModelProviderSources(
  sources: ManagedModelProviderSource[]
): ManagedModelProviderSource[] {
  return [...sources].sort((a, b) => {
    const rank = (source: ManagedModelProviderSource): number => {
      if (source.configured && source.enabled) return 0
      if (source.configured) return 1
      return 2
    }
    const rankCompare = rank(a) - rank(b)
    if (rankCompare !== 0) return rankCompare
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function buildManagedModelProviderSourceIndex(
  providers: AIProvider[]
): Map<string, ManagedModelProviderSource[]> {
  const index = new Map<string, ManagedModelProviderSource[]>()

  for (const provider of providers) {
    const source: ManagedModelProviderSource = {
      key: getProviderSourceKey(provider),
      name: provider.name,
      type: provider.type,
      builtinId: provider.builtinId,
      configured: true,
      enabled: provider.enabled
    }

    for (const model of provider.models) {
      addManagedModelProviderSource(index, model.id, source)
    }
  }

  for (const preset of builtinProviderPresets) {
    const source: ManagedModelProviderSource = {
      key: `${BUILTIN_PROVIDER_KEY_PREFIX}${preset.builtinId}`,
      name: preset.name,
      type: preset.type,
      builtinId: preset.builtinId,
      configured: false
    }

    for (const model of preset.defaultModels) {
      addManagedModelProviderSource(index, model.id, source)
    }
  }

  for (const [modelKey, sources] of index) {
    index.set(modelKey, sortManagedModelProviderSources(sources))
  }

  return index
}

export function sortManagedModelProviderSourcesForList(
  sources: ManagedModelProviderSource[]
): ManagedModelProviderSource[] {
  return sortManagedModelProviderSources(sources)
}

export const ALL_PROVIDER_FILTER = '__all__'
