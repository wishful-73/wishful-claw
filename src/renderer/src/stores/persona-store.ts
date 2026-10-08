import { create } from 'zustand'
import type { PersonaSummary, PersonaConfig } from '@renderer/lib/persona/persona-types'
import { createEmptyPersonaConfig } from '@renderer/lib/persona/persona-types'
import { generatePersonaDraft, type PersonaDraft } from '@renderer/lib/persona/generator'
import { buildProviderPayload } from '@renderer/lib/agent/provider-payload'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type { AIProvider } from '@shared/types/provider'

interface PersonaStore {
  // ── State ──
  personas: PersonaSummary[]
  selectedPersona: PersonaConfig | null
  loading: boolean
  error: string | null
  dirty: boolean
  /** Whether the currently selected persona is a new (unsaved) one. */
  isNew: boolean

  // ── Actions ──
  listPersonas: (workingFolder?: string) => Promise<void>
  selectPersona: (id: string, workingFolder?: string) => Promise<void>
  startNewPersona: () => void
  savePersona: (config: PersonaConfig, workingFolder?: string) => Promise<{ success: boolean; id?: string; error?: string }>
  deletePersona: (id: string, workingFolder?: string) => Promise<{ success: boolean; error?: string }>
  applyToProject: (personaId: string | null, projectFolder: string) => Promise<{ success: boolean; count?: number; error?: string }>
  generatePersona: (
    prompt: string,
    provider: AIProvider,
    modelId: string,
    referencePersonaId?: string,
    workingFolder?: string
  ) => Promise<{ success: boolean; draft?: PersonaDraft; error?: string }>
  clearSelection: () => void
  clearError: () => void
}

/** Length of the GUID tail used when a name yields no usable slug. */
const SHORT_ID_LENGTH = 12

/**
 * Persona name → ID.
 *
 * Latin names slug straight through (`Alice` → `alice`); CJK goes via pinyin
 * (`苏妲` → `su-da`). Names that leave nothing usable — kana, emoji, pure
 * punctuation — fall back to a short GUID, so the ID is always a valid
 * directory name.
 *
 * `pinyin-pro` is imported lazily on purpose: it ships a sizeable dictionary
 * that only matters the moment a persona is actually saved, so it stays out of
 * the startup bundle.
 */
async function generatePersonaId(name: string): Promise<string> {
  const { pinyin } = await import('pinyin-pro')
  const slug = pinyin(name, { toneType: 'none', type: 'array' })
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || `p-${crypto.randomUUID().replace(/-/g, '').slice(0, SHORT_ID_LENGTH)}`
}

/**
 * Appends a numeric suffix until the ID is free (`su-da` → `su-da-2`).
 *
 * A generated ID is a pure function of the name, so two personas called the
 * same thing collide — and the Worker would silently overwrite the existing
 * directory. Suffixing keeps both: a user-created persona and a built-in preset
 * may legitimately share a name, and neither should be sacrificed.
 */
function uniquePersonaId(baseId: string, existing: PersonaSummary[]): string {
  const taken = new Set(existing.map((p) => p.id))
  if (!taken.has(baseId)) return baseId

  for (let suffix = 2; ; suffix++) {
    const candidate = `${baseId}-${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

export const usePersonaStore = create<PersonaStore>((set, get) => ({
  personas: [],
  selectedPersona: null,
  loading: false,
  error: null,
  dirty: false,
  isNew: false,

  listPersonas: async (workingFolder?: string) => {
    set({ loading: true, error: null })
    try {
      const result = (await window.api.workerRequest('persona/list', {
        workingFolder: workingFolder ?? null
      })) as { personas: PersonaSummary[] }

      set({ personas: result.personas ?? [], loading: false })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load personas'
      })
    }
  },

  selectPersona: async (id: string, workingFolder?: string) => {
    set({ loading: true, error: null })
    try {
      const result = (await window.api.workerRequest('persona/get', {
        id,
        workingFolder: workingFolder ?? null
      })) as PersonaConfig & { success?: boolean; error?: string }

      if (result.success === false) {
        set({ loading: false, error: result.error ?? 'Persona not found' })
        return
      }

      set({
        selectedPersona: result as PersonaConfig,
        loading: false,
        dirty: false,
        isNew: false
      })
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load persona'
      })
    }
  },

  startNewPersona: () => {
    set({
      selectedPersona: createEmptyPersonaConfig(),
      dirty: false,
      isNew: true,
      error: null
    })
  },

  savePersona: async (config: PersonaConfig, workingFolder?: string) => {
    set({ error: null })
    try {
      const isNew = !config.id
      const baseId = config.id || (await generatePersonaId(config.name))

      // An existing persona must never be silently overwritten, but the user
      // should not be blocked either — a new one simply takes the next free ID.
      const id = isNew ? uniquePersonaId(baseId, get().personas) : baseId

      const result = (await window.api.workerRequest('persona/save', {
        id,
        name: config.name,
        tagline: config.tagline,
        description: config.description,
        identityMarkdown: config.identityMarkdown,
        soulMarkdown: config.soulMarkdown,
        ontologyMarkdown: config.ontologyMarkdown,
        agentsMarkdown: config.agentsMarkdown,
        workingFolder: workingFolder ?? null
      })) as { success: boolean; id?: string; error?: string }

      if (result.success) {
        set({ dirty: false, isNew: false })
        // Refresh list
        await get().listPersonas(workingFolder)
        // Re-select the saved persona to get fresh data
        if (result.id) {
          await get().selectPersona(result.id, workingFolder)
        }
      } else {
        // Business failure (success: false) must surface in the error banner
        // too — previously only thrown exceptions wrote `error`.
        set({ error: result.error || 'Failed to save persona' })
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to save persona'
      set({ error: errorMsg })
      return { success: false, error: errorMsg }
    }
  },

  deletePersona: async (id: string, workingFolder?: string) => {
    set({ error: null })
    try {
      const result = (await window.api.workerRequest('persona/delete', {
        id,
        workingFolder: workingFolder ?? null
      })) as { success: boolean; error?: string }

      if (result.success) {
        // Clear selection if deleted persona was selected
        const current = get().selectedPersona
        if (current?.id === id) {
          set({ selectedPersona: null, dirty: false, isNew: false })
        }
        // Refresh list
        await get().listPersonas(workingFolder)
      } else {
        set({ error: result.error || 'Failed to delete persona' })
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete persona'
      set({ error: errorMsg })
      return { success: false, error: errorMsg }
    }
  },

  applyToProject: async (personaId: string | null, projectFolder: string) => {
    set({ error: null })
    try {
      const result = (await window.api.workerRequest('persona/apply-to-project', {
        personaId: personaId ?? null,
        projectFolder
      })) as { success: boolean; count?: number; error?: string }

      if (!result.success) {
        set({ error: result.error || 'Failed to apply persona to project' })
      }

      return result
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to apply persona to project'
      set({ error: errorMsg })
      return { success: false, error: errorMsg }
    }
  },

  generatePersona: async (prompt: string, provider: AIProvider, modelId: string, referencePersonaId?: string, workingFolder?: string) => {
    set({ loading: true, error: null })
    try {
      // Pure renderer-side flow — a single `provider/complete` call, same as the
      // prompt optimizer. Nothing persona-specific lives in the Worker anymore.
      //
      // No `providerRole: 'global'` on purpose: the caller hands us the
      // provider/model the user picked, and the Worker resolver only honours that
      // as the `explicit` route when the role is absent. Marking it "global"
      // makes TryResolveExplicit bail out, so the pick would be ignored and the
      // request would fall through to the configured/global route.
      // `globalActiveModel` stays as the last-resort fallback.
      const result = await generatePersonaDraft({
        provider: buildProviderPayload(provider, modelId, useSettingsStore.getState()),
        prompt,
        referencePersonaId,
        workingFolder
      })

      if (!result.success) {
        set({ loading: false, error: result.error })
        return { success: false, error: result.error }
      }

      set({ loading: false })
      return { success: true, draft: result.draft }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate persona'
      set({ loading: false, error: errorMsg })
      return { success: false, error: errorMsg }
    }
  },

  clearSelection: () => {
    set({ selectedPersona: null, dirty: false, isNew: false, error: null })
  },

  clearError: () => set({ error: null })
}))
