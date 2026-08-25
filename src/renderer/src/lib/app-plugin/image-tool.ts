import type { ToolHandler } from '@renderer/lib/tools/tool-types'
import { IMAGE_GENERATE_TOOL_NAME } from './types'

export const imageGenerateTool: ToolHandler = {
  definition: {
    name: IMAGE_GENERATE_TOOL_NAME,
    description: 'Generate images from a concrete visual prompt. The native Agent Worker executes this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Complete visual prompt.' },
        count: { type: 'number', description: 'Number of images, capped at 4.' },
        reference_images: { type: 'array', items: { type: 'string' } },
        size: { type: 'string', enum: ['auto', '1024x1024', '1024x1536', '1536x1024'] },
        quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'] }
      },
      required: ['prompt']
    }
  },
  execute: async () =>
    JSON.stringify({
      error: 'ImageGenerate executes in the .NET Native Worker and is unavailable through the renderer boundary.'
    }),
  requiresApproval: () => false
}
