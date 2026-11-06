import { toolRegistry } from '../agent/tool-registry'
import { encodeToolError } from './tool-result-format'
import type { ToolHandler } from './tool-types'

function nativeOnlyPlanResult(toolName: string): string {
  return encodeToolError(
    `${toolName} executes in the .NET Native Worker and is unavailable through the renderer boundary.`
  )
}

const enterPlanModeHandler: ToolHandler = {
  definition: {
    name: 'EnterPlanMode',
    description:
      'Enter Plan Mode to explore the codebase and create a detailed implementation plan. ' +
      'In plan mode, all tools remain available — Read, Write, Edit, Bash, Glob, Grep etc. ' +
      'Write the plan into the current plan file returned by this tool, then call SubmitPlanReview.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description:
            'Brief reason for entering plan mode. This becomes the initial plan title (e.g. "add-user-authentication").'
        }
      }
    }
  },
  execute: async () => nativeOnlyPlanResult('EnterPlanMode'),
  requiresApproval: () => false
}

const exitPlanModeHandler: ToolHandler = {
  definition: {
    name: 'SubmitPlanReview',
    description:
      'Exit Plan Mode after writing the plan file. This signals that the plan is finalized and ready for user review. ' +
      'After calling this tool, you MUST STOP and wait for the user to review the plan; do NOT continue with any further actions.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  execute: async () => nativeOnlyPlanResult('SubmitPlanReview'),
  requiresApproval: () => false
}

export function registerPlanTools(): void {
  toolRegistry.register(enterPlanModeHandler)
  toolRegistry.register(exitPlanModeHandler)
}
