import { toolRegistry } from '../agent/tool-registry'
import { encodeToolError } from './tool-result-format'
import { ipcClient } from '../ipc/ipc-client'
import type { ToolContext } from './tool-types'

/**
 * Bridge for skill-management:execute reverse-request from Worker.
 *
 * The Worker registers a placeholder tool definition (list_installed_skills)
 * but execution lives in the renderer (skill-management-tool.ts). This bridge
 * dispatches to the renderer-side toolRegistry handlers.
 */

interface SkillManagementRequest {
  toolName: string
  input: Record<string, unknown>
}

export async function handleSkillManagementExecute(
  params: SkillManagementRequest
): Promise<unknown> {
  const { toolName, input } = params

  const handler = toolRegistry.get(toolName)
  if (!handler) {
    return encodeToolError(`Unknown skill management tool: ${toolName}`)
  }

  const ctx: ToolContext = {
    signal: new AbortController().signal,
    ipc: ipcClient
  } as ToolContext

  try {
    return await handler.execute(input ?? {}, ctx)
  } catch (err) {
    return encodeToolError(
      `Skill management tool '${toolName}' failed: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
