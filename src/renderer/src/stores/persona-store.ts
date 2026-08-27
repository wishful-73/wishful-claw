import { create } from 'zustand'
import type { PersonaSummary, PersonaConfig } from '@renderer/lib/persona/persona-types'
import { createEmptyPersonaConfig } from '@renderer/lib/persona/persona-types'

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
  generatePersona: (prompt: string, provider: Record<string, unknown>, referencePersonaId?: string, workingFolder?: string) => Promise<{ success: boolean; draft?: Partial<import('@renderer/lib/persona/persona-types').PersonaConfig>; error?: string }>
  clearSelection: () => void
  clearError: () => void
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
      const result = (await window.api.workerRequest('persona/save', {
        id: config.id || null,
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

  generatePersona: async (prompt: string, provider: Record<string, unknown>, referencePersonaId?: string, workingFolder?: string) => {
    set({ loading: true, error: null })
    try {
      const result = (await window.api.workerRequest('persona/generate', {
        prompt,
        provider,
        referencePersonaId: referencePersonaId ?? null,
        workingFolder: workingFolder ?? null
      })) as { success?: boolean; name?: string; tagline?: string; description?: string; identityMarkdown?: string; soulMarkdown?: string; ontologyMarkdown?: string; agentsMarkdown?: string; error?: string }

      if (result.success === false) {
        set({ loading: false, error: result.error ?? 'Generation failed' })
        return { success: false, error: result.error ?? 'Generation failed' }
      }

      set({ loading: false })
      return { success: true, draft: result }
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
