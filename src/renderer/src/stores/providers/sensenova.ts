import type { BuiltinProviderPreset } from './types'

export const sensenovaPreset: BuiltinProviderPreset = {
  builtinId: 'sensenova',
  version: 2,
  name: '商汤日日新 / SenseNova',
  type: 'openai-chat',
  defaultBaseUrl: 'https://token.sensenova.cn/v1',
  homepage: 'https://www.sensenova.cn/token-plan',
  defaultModels: []
}
