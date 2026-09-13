import type { BuiltinProviderPreset } from './types'

export const googlePreset: BuiltinProviderPreset = {
  builtinId: 'google',
  // v2: 2026-09 按官方定价页核对（新增 3.8/3.7/3.6 Flash 与 3.5 Flash-Lite；修正 3.5 Flash 价格）。
  version: 2,
  name: 'Google Gemini',
  type: 'openai-chat',
  defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  homepage: 'https://ai.google.dev',
  apiKeyUrl: 'https://aistudio.google.com/apikey',
  deprecatedModelIds: ['gemini-2.0-flash'],
  defaultModels: [
    // Gemini 3.8 / 3.7 / 3.6 Flash（2026-09 官方定价页；2026-12-31 前为促销价，之后翻倍）
    {
      id: 'gemini-3.8-flash',
      name: 'Gemini 3.8 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.75,
      outputPrice: 3.75,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-3.7-flash',
      name: 'Gemini 3.7 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.75,
      outputPrice: 3.75,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-3.6-flash',
      name: 'Gemini 3.6 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.75,
      outputPrice: 3.75,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-3.5-flash-lite',
      name: 'Gemini 3.5 Flash-Lite',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 2.5,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    // Gemini 3.5 (stable)
    {
      id: 'gemini-3.5-flash',
      name: 'Gemini 3.5 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 1.5,
      outputPrice: 9,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    // Gemini 3.1 (preview)
    {
      id: 'gemini-3.1-pro-preview',
      name: 'Gemini 3.1 Pro Preview',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 2,
      outputPrice: 12
    },
    {
      id: 'gemini-3-flash-preview',
      name: 'Gemini 3 Flash Preview',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.5,
      outputPrice: 3
    },
    // Gemini 2.5 Pro (stable)
    {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 1.25,
      outputPrice: 10,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 2.5,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    {
      id: 'gemini-2.5-flash-lite',
      name: 'Gemini 2.5 Flash-Lite',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.1,
      outputPrice: 0.4,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    // Gemini 3.1 Flash-Lite (stable — most cost-efficient current tier)
    {
      id: 'gemini-3.1-flash-lite',
      name: 'Gemini 3.1 Flash-Lite',
      icon: 'gemini',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.25,
      outputPrice: 1.5,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { reasoning_effort: 'medium' } }
    },
    // Gemini image generation
    {
      id: 'gemini-3.1-flash-image',
      name: 'Nano Banana 2 (Gemini 3.1 Flash Image)',
      icon: 'gemini',
      enabled: true,
      category: 'image',
      type: 'gemini',
      supportsVision: true,
      supportsFunctionCall: false
    },
    {
      id: 'gemini-3-pro-image',
      name: 'Nano Banana Pro (Gemini 3 Pro Image)',
      icon: 'gemini',
      enabled: true,
      category: 'image',
      type: 'gemini',
      supportsVision: true,
      supportsFunctionCall: false
    },
    {
      id: 'gemini-2.5-flash-image',
      name: 'Nano Banana (Gemini 2.5 Flash Image)',
      icon: 'gemini',
      enabled: true,
      category: 'image',
      type: 'gemini',
      supportsVision: true,
      supportsFunctionCall: false
    }
  ]
}
