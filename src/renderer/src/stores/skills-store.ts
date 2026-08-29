/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { create } from 'zustand'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { refreshDynamicToolCatalog } from '@renderer/lib/tools/dynamic-tool-catalog'

export interface SkillInfo {
  name: string
  description: string
  enabled: boolean
}

export interface ScanFileInfo {
  name: string
  size: number
  type: string
}

export interface RiskItem {
  severity: 'safe' | 'warning' | 'danger'
  category: string
  detail: string
  file: string
  line?: number
}

export interface ScanResult {
  name: string
  description: string
  files: ScanFileInfo[]
  risks: RiskItem[]
  skillMdContent: string
  scriptContents: { file: string; content: string }[]
}

export type SkillsTab = 'market' | 'installed'

interface SkillsStore {
  skills: SkillInfo[]
  loading: boolean
  selectedSkill: string | null
  skillContent: string | null
  skillFiles: ScanFileInfo[]
  searchQuery: string
  activeTab: SkillsTab

  // Editing state
  editing: boolean
  editContent: string | null

  // Actions
  loadSkills: () => Promise<void>
  setSearchQuery: (query: string) => void
  setActiveTab: (tab: SkillsTab) => void
  selectSkill: (name: string | null) => void
  readSkill: (name: string) => Promise<void>
  loadSkillFiles: (name: string) => Promise<void>
  deleteSkill: (name: string) => Promise<boolean>
  openSkillFolder: (name: string) => Promise<void>
  addSkillFromFolder: (
    sourcePath: string
  ) => Promise<{ success: boolean; name?: string; error?: string }>

  // Edit actions
  setEditing: (editing: boolean) => void
  setEditContent: (content: string | null) => void
  saveSkill: (name: string, content: string) => Promise<boolean>
  toggleSkillEnabled: (name: string, enabled: boolean) => Promise<boolean>
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  loading: false,
  selectedSkill: null,
  skillContent: null,
  skillFiles: [],
  searchQuery: '',
  activeTab: 'market',

  editing: false,
  editContent: null,

  loadSkills: async () => {
    set({ loading: true })
    try {
      const result = (await ipcClient.invoke('skills:list')) as SkillInfo[]
      set({ skills: Array.isArray(result) ? result : [] })
    } catch {
      set({ skills: [] })
    } finally {
      set({ loading: false })
    }
  },

  toggleSkillEnabled: async (name, enabled) => {
    try {
      const result = await ipcClient.invoke('skills:set-enabled', { name, enabled }) as { success: boolean }
      if (result?.success) {
        set({
          skills: get().skills.map(s =>
            s.name === name ? { ...s, enabled } : s
          )
        })
        void refreshDynamicToolCatalog()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  setSearchQuery: (query) => set({ searchQuery: query }),

  setActiveTab: (tab) =>
    set({
      activeTab: tab,
      selectedSkill: null,
      skillContent: null,
      skillFiles: [],
      editing: false,
      editContent: null
    }),

  selectSkill: (name) => {
    set({
      selectedSkill: name,
      skillContent: null,
      skillFiles: [],
      editing: false,
      editContent: null
    })
    if (name) {
      get().readSkill(name)
      get().loadSkillFiles(name)
    }
  },

  readSkill: async (name) => {
    try {
      const result = (await ipcClient.invoke('skills:read', { name })) as {
        content?: string
        error?: string
      }
      if (result.content) set({ skillContent: result.content })
    } catch {
      set({ skillContent: null })
    }
  },

  loadSkillFiles: async (name) => {
    try {
      const result = (await ipcClient.invoke('skills:list-files', { name })) as {
        files?: ScanFileInfo[]
        error?: string
      }
      if (result.files) set({ skillFiles: result.files })
    } catch {
      set({ skillFiles: [] })
    }
  },

  deleteSkill: async (name) => {
    try {
      const result = (await ipcClient.invoke('skills:delete', { name })) as { success: boolean }
      if (result.success) {
        const state = get()
        set({
          skills: state.skills.filter((s) => s.name !== name),
          selectedSkill: state.selectedSkill === name ? null : state.selectedSkill,
          skillContent: state.selectedSkill === name ? null : state.skillContent,
          skillFiles: state.selectedSkill === name ? [] : state.skillFiles
        })
        await refreshDynamicToolCatalog()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  openSkillFolder: async (name) => {
    try {
      await ipcClient.invoke('skills:open-folder', { name })
    } catch {
      // ignore
    }
  },

  addSkillFromFolder: async (sourcePath) => {
    try {
      const result = (await ipcClient.invoke('skills:add-from-folder', { sourcePath })) as {
        success: boolean
        name?: string
        error?: string
      }
      if (result.success) {
        await get().loadSkills()
        await refreshDynamicToolCatalog()
      }
      return result
    } catch (err) {
      return { success: false, error: String(err) }
    }
  },

  // Edit actions
  setEditing: (editing) => {
    const state = get()
    if (editing && state.skillContent) {
      set({ editing: true, editContent: state.skillContent })
    } else {
      set({ editing: false, editContent: null })
    }
  },

  setEditContent: (content) => set({ editContent: content }),

  saveSkill: async (name, content) => {
    try {
      const result = (await ipcClient.invoke('skills:save', { name, content })) as {
        success: boolean
        error?: string
      }
      if (result.success) {
        set({ skillContent: content, editing: false, editContent: null })
        await refreshDynamicToolCatalog()
        return true
      }
      return false
    } catch {
      return false
    }
  },

}))
