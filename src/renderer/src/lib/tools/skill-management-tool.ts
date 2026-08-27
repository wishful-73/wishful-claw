import type { ToolHandler } from './tool-types'
import { toolRegistry } from '../agent/tool-registry'
import { ipcClient } from '../ipc/ipc-client'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'

// --- Types matching the IPC contracts ---

interface InstalledSkillInfo {
  name: string
  description: string
  enabled?: boolean
}

// --- Tool: List installed skills ---

const listInstalledSkillsHandler: ToolHandler = {
  definition: {
    name: 'list_installed_skills',
    description: [
      'List all skills currently installed in the local skills directory.',
      '',
      'Returns each skill\u2019s name, description, and enabled status.',
      'Use this to check what is already installed before attempting installation.'
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  execute: async (_input, ctx) => {
    try {
      const result = await ctx.ipc.invoke('skills:list')
      const skills = Array.isArray(result) ? (result as InstalledSkillInfo[]) : []

      if (skills.length === 0) {
        return encodeStructuredToolResult({
          installed: [],
          count: 0,
          message: 'No skills are currently installed.'
        })
      }

      const formatted = skills.map((s) => ({
        name: s.name,
        description: s.description,
        enabled: s.enabled !== false
      }))

      return encodeStructuredToolResult({
        installed: formatted,
        count: formatted.length
      })
    } catch (err) {
      return encodeToolError(`Failed to list installed skills: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
  requiresApproval: () => false
}

// --- Registration ---

export function registerSkillManagementTools(): void {
  toolRegistry.register(listInstalledSkillsHandler)
}

// Also export for ipcClient fallback (used when ctx.ipc is unavailable)
export { ipcClient }
