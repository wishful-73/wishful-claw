/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from '@renderer/stores/providers/types'

export const deepseekPreset: BuiltinProviderPreset = {
  builtinId: 'deepseek',
  // v3: 2026-09 按官方文档核对（模型名改为 deepseek-flash、V4.1-Flash、峰谷计费取非高峰价）
  version: 3,
  name: 'DeepSeek',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.deepseek.com/anthropic',
  homepage: 'https://platform.deepseek.com',
  apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  defaultModel: 'deepseek-flash',
  defaultModels: [
    {
      id: 'deepseek-flash',
      name: 'DeepSeek V4.1 Flash',
      icon: 'deepseek',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 384_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.15,
      outputPrice: 0.6,
      cacheCreationPrice: 0.15,
      cacheHitPrice: 0.003,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } }
      }
    },
    {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      icon: 'deepseek',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 384_000,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.66,
      outputPrice: 1.98,
      cacheCreationPrice: 0.66,
      cacheHitPrice: 0.022,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } }
      }
    }
  ],
  deprecatedModelIds: [
    'deepseek-chat',
    'deepseek-reasoner',
    'deepseek-v4-flash',
    'deepseek-v4-flash-vision-exp'
  ]
}
