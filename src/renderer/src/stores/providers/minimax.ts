/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from './types'

export const minimaxCodingPreset: BuiltinProviderPreset = {
  builtinId: 'minimax-coding',
  // v2: 2026-09 版本号推进（本次未改 Coding 套餐模型清单）。
  version: 2,
  name: 'MiniMax（套餐）',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
  homepage: 'https://platform.minimax.cn/subscribe/token-plan',
  apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  defaultEnabled: false,
  defaultModel: 'MiniMax-M3',
  defaultModels: [
    // Coding Plan models (official docs: same Anthropic endpoint, dedicated Coding Plan key)
    {
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      icon: 'minimax',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'MiniMax-M2.7',
      name: 'MiniMax M2.7',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'MiniMax-M2.7-highspeed',
      name: 'MiniMax M2.7 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'MiniMax-M2.5',
      name: 'MiniMax M2.5',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'MiniMax-M2.5-highspeed',
      name: 'MiniMax M2.5 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'MiniMax-M2.1',
      name: 'MiniMax M2.1',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 64_000,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'MiniMax-M2',
      name: 'MiniMax M2',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    }
  ]
}

export const minimaxPreset: BuiltinProviderPreset = {
  builtinId: 'minimax',
  // v2: 2026-09 按官方 paygo 定价核对（MiniMax-M3 价格微调）。
  version: 2,
  name: 'MiniMax（官方）',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.minimaxi.com/anthropic',
  homepage: 'https://www.minimax.cn',
  apiKeyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  defaultModel: 'MiniMax-M3',
  defaultModels: [
    // USD pricing references: https://platform.minimax.io/docs/guides/pricing-paygo
    // Note: M3 has two tiers — ≤512k tokens (standard) and >512k (long-context, 2× price)
    {
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      icon: 'minimax',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.3,
      outputPrice: 1.2,
      cacheHitPrice: 0.06
    },
    {
      id: 'MiniMax-M2.7',
      name: 'MiniMax M2.7',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.3,
      outputPrice: 1.2,
      cacheHitPrice: 0.06,
      cacheCreationPrice: 0.375
    },
    {
      id: 'MiniMax-M2.7-highspeed',
      name: 'MiniMax M2.7 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.6,
      outputPrice: 2.4,
      cacheHitPrice: 0.06,
      cacheCreationPrice: 0.375
    },
    {
      id: 'MiniMax-M2.5',
      name: 'MiniMax M2.5',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.3,
      outputPrice: 1.2,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.375
    },
    {
      id: 'MiniMax-M2.5-highspeed',
      name: 'MiniMax M2.5 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.6,
      outputPrice: 2.4,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.375
    },
    {
      id: 'MiniMax-M2.1',
      name: 'MiniMax M2.1',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 64_000,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.3,
      outputPrice: 1.2,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.375
    },
    {
      id: 'MiniMax-M2.1-highspeed',
      name: 'MiniMax M2.1 Highspeed',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 64_000,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.6,
      outputPrice: 2.4,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.375
    },
    {
      id: 'MiniMax-M2',
      name: 'MiniMax M2',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.3,
      outputPrice: 1.2,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.375
    }
  ]
}
