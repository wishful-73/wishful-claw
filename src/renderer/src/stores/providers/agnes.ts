import type { BuiltinProviderPreset } from './types'

export const agnesPreset: BuiltinProviderPreset = {
  builtinId: 'agnes',
  version: 2,
  name: 'Agnes',
  type: 'openai-chat',
  defaultBaseUrl: 'https://apihub.agnes-ai.com/v1',
  homepage: 'https://www.agnes-ai.com/',
  defaultModels: []
}
