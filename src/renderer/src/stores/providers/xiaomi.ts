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
//
// v3: 2026-10-14 按小米官方公告（platform.xiaomimimo.com 应用内横幅 + 模型列表页）更新：
//     V2.6 系列上线（mimo-v2.6-pro / mimo-v2.6-flash / mimo-v2.6-pro-ultraspeed），
//     上下文 1M / 最大输出 128K，三款均支持全模态理解（supportsVision: true）。
//     V2.5 系列（mimo-v2.5-pro / mimo-v2.5 / mimo-v2.5-pro-ultraspeed）自 2026-10-14 18:00
//     起自动转发至 V2.6，2026-10-21 10:00 正式下线（原名调用直接报错），故移出默认清单并
//     写入 deprecatedModelIds。UltraSpeed 旧价（1.305/2.61/0.0108）是已作废的「3 倍体验价」，
//     按官方定价页订正为 0.036/4.35/8.7（海外 USD，cache/输入/输出）。
//     TTS 三款不在下线名单内，保持原样。
const xiaomiTextModels: AIModelConfig[] = [
  {
    id: 'mimo-v2.6-pro',
    name: 'MiMo V2.6 Pro',
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
    id: 'mimo-v2.6-flash',
    name: 'MiMo V2.6 Flash',
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
    id: 'mimo-v2.6-pro-ultraspeed',
    name: 'MiMo V2.6 Pro UltraSpeed',
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
  version: 3,
  name: '小米（套餐）',
  // S-201: 套餐同时提供 Anthropic（/anthropic）与 OpenAI（/v1）两套兼容端点。统一走
  // OpenAI 兼容端点 —— 只有它支持模型列表拉取；且 thinkingConfig.bodyParams 在 openai-chat
  // 链路上才会被真正注入请求体（Anthropic 链路只读 enabled / budgetTokens，不读 bodyParams）。
  type: 'openai-chat',
  defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',
  homepage: 'https://platform.xiaomimimo.com/token-plan',
  apiKeyUrl: 'https://platform.xiaomimimo.com/token-plan',
  defaultEnabled: false,
  defaultModel: 'mimo-v2.6-flash',
  deprecatedModelIds: [
    'mimo-v2-pro',
    'mimo-v2-omni',
    'mimo-v2-flash',
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'mimo-v2.5-pro-ultraspeed'
  ],
  defaultModels: xiaomiTextModels.map((model) => ({ ...model }))
}

export const xiaomiPreset: BuiltinProviderPreset = {
  builtinId: 'xiaomi',
  version: 3,
  name: '小米',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.xiaomimimo.com/v1',
  homepage: 'https://platform.xiaomimimo.com/',
  apiKeyUrl: 'https://platform.xiaomimimo.com/',
  defaultModel: 'mimo-v2.6-flash',
  deprecatedModelIds: [
    'mimo-v2-pro',
    'mimo-v2-omni',
    'mimo-v2-flash',
    'mimo-v2.5-pro',
    'mimo-v2.5',
    'mimo-v2.5-pro-ultraspeed'
  ],
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
      inputPrice: 4.35,
      outputPrice: 8.7,
      cacheHitPrice: 0.036
    }
  ]
}
