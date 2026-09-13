/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { AIModelConfig } from '../../../../shared/types/provider'
import type { BuiltinProviderPreset } from './types'

const xiaomiThinkingConfig = {
  bodyParams: { thinking: { type: 'enabled' } },
  disabledBodyParams: { thinking: { type: 'disabled' } }
} as const

// MiMo-V2 系列（mimo-v2-pro / mimo-v2-omni / mimo-v2-flash / mimo-v2-tts）已由小米官方于
// 2026-06-30 正式下线：6/1 起 v2-pro→v2.5-pro、v2-omni→v2.5 自动路由，6/18 起 v2-flash→v2.5、
// v2-tts→v2.5-tts 自动路由，6/30 起旧模型名调用直接报错。故从默认模型中移除，id 移入
// deprecatedModelIds 以便自动清理老用户配置。
//
// v2: 2026-09 按小米 MiMo 官方定价页（mimo.mi.com/docs/zh-CN/pricing，2026-08-06 更新）复核，
//     v2.5-pro / v2.5 的海外美元价与文件现值逐项一致（0.435/0.87/0.0036、0.14/0.28/0.0028），
//     UltraSpeed 亦确认为 v2.5-pro 的 3 倍限时体验价，故本次只 bump 版本、不改数据。
const xiaomiTextModels: AIModelConfig[] = [
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    icon: 'mimo',
    enabled: true,
    contextLength: 1_000_000,
    maxOutputTokens: 131_072,
    supportsVision: false,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: xiaomiThinkingConfig
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5',
    icon: 'mimo',
    enabled: true,
    contextLength: 1_000_000,
    maxOutputTokens: 131_072,
    supportsVision: true,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: xiaomiThinkingConfig
  },
  {
    id: 'mimo-v2.5-pro-ultraspeed',
    name: 'MiMo V2.5 Pro UltraSpeed',
    icon: 'mimo',
    enabled: true,
    contextLength: 1_000_000,
    maxOutputTokens: 131_072,
    supportsVision: false,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: xiaomiThinkingConfig
  },
  {
    id: 'mimo-v2.5-tts',
    name: 'MiMo V2.5 TTS',
    icon: 'mimo',
    enabled: true,
    category: 'speech',
    audio: true
  },
  {
    id: 'mimo-v2.5-tts-voicedesign',
    name: 'MiMo V2.5 TTS VoiceDesign',
    icon: 'mimo',
    enabled: true,
    category: 'speech',
    audio: true
  },
  {
    id: 'mimo-v2.5-tts-voiceclone',
    name: 'MiMo V2.5 TTS VoiceClone',
    icon: 'mimo',
    enabled: true,
    category: 'speech',
    audio: true
  }
]

export const xiaomiCodingPreset: BuiltinProviderPreset = {
  builtinId: 'xiaomi-coding',
  version: 2,
  name: '小米（套餐）',
  type: 'anthropic',
  defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
  homepage: 'https://platform.xiaomimimo.com/token-plan',
  apiKeyUrl: 'https://platform.xiaomimimo.com/token-plan',
  defaultEnabled: false,
  defaultModel: 'mimo-v2.5-pro',
  deprecatedModelIds: ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
  defaultModels: xiaomiTextModels.map((model) => ({ ...model }))
}

export const xiaomiPreset: BuiltinProviderPreset = {
  builtinId: 'xiaomi',
  version: 2,
  name: '小米',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
  homepage: 'https://platform.xiaomimimo.com/',
  apiKeyUrl: 'https://platform.xiaomimimo.com/',
  defaultModel: 'mimo-v2.5-pro',
  deprecatedModelIds: ['mimo-v2-pro', 'mimo-v2-omni', 'mimo-v2-flash'],
  defaultModels: [
    {
      ...xiaomiTextModels[0],
      inputPrice: 0.435,
      outputPrice: 0.87,
      cacheHitPrice: 0.0036
    },
    {
      ...xiaomiTextModels[1],
      inputPrice: 0.14,
      outputPrice: 0.28,
      cacheHitPrice: 0.0028
    },
    {
      ...xiaomiTextModels[2],
      inputPrice: 1.305,
      outputPrice: 2.61,
      cacheHitPrice: 0.0108
    }
  ]
}
