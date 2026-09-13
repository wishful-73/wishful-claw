/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from '@renderer/stores/providers/types'

export const anthropicPreset: BuiltinProviderPreset = {
  builtinId: 'anthropic',
  // v3: 2026-09 按官方模型页与价格页核对（新增 Claude Fable 5.1 / Claude Opus 5）。
  version: 3,
  name: 'Anthropic',
  type: 'anthropic',
  defaultBaseUrl: 'https://api.anthropic.com',
  homepage: 'https://anthropic.com',
  apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  deprecatedModelIds: [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-3-5-haiku-20241022'
  ],
  defaultModels: [
    // Claude Fable 5.1（2026-09 官方：$10/$50，1M 上下文；缓存读按 0.025x = $0.25 计费）
    {
      id: 'claude-fable-5-1',
      name: 'Claude Fable 5.1',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 10,
      outputPrice: 50,
      cacheCreationPrice: 12.5,
      cacheHitPrice: 0.25,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    // Claude Opus 5（2026-09 官方新旗舰：$5/$25，1M 上下文，adaptive thinking）
    {
      id: 'claude-opus-5',
      name: 'Claude Opus 5',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 5,
      outputPrice: 25,
      cacheCreationPrice: 6.25,
      cacheHitPrice: 0.5,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    // Claude Fable 5 (flagship-tier, above Opus 4.8 — always-on adaptive thinking, 1M context)
    {
      id: 'claude-fable-5',
      name: 'Claude Fable 5',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 10,
      outputPrice: 50,
      cacheCreationPrice: 12.5,
      cacheHitPrice: 1,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    // Claude Sonnet 5 (latest Sonnet — adaptive thinking, 1M context)
    {
      id: 'claude-sonnet-5',
      name: 'Claude Sonnet 5',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 2,
      outputPrice: 10,
      cacheCreationPrice: 2.5,
      cacheHitPrice: 0.2,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    // Claude 4.8 (latest flagship — adaptive thinking, 1M context)
    {
      id: 'claude-opus-4-8',
      name: 'Claude Opus 4.8',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 5,
      outputPrice: 25,
      cacheCreationPrice: 6.25,
      cacheHitPrice: 0.5,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    // Claude 4.7 (previous flagship, now legacy)
    {
      id: 'claude-opus-4-7',
      name: 'Claude Opus 4.7',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 128_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 5,
      outputPrice: 25,
      cacheCreationPrice: 6.25,
      cacheHitPrice: 0.5,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    // Claude 4.6 series (adaptive thinking, 1M context)
    {
      id: 'claude-opus-4-6',
      name: 'Claude Opus 4.6',
      icon: 'claude',
      enabled: true,
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 5,
      outputPrice: 25,
      cacheCreationPrice: 6.25,
      cacheHitPrice: 0.5,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    {
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      icon: 'claude',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 3,
      outputPrice: 15,
      cacheCreationPrice: 3.75,
      cacheHitPrice: 0.3,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'adaptive' } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high', 'max'],
        defaultReasoningEffort: 'high'
      }
    },
    {
      id: 'claude-sonnet-4-5-20250929',
      name: 'Claude Sonnet 4.5',
      icon: 'claude',
      enabled: true,
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 3,
      outputPrice: 15,
      cacheCreationPrice: 3.75,
      cacheHitPrice: 0.3,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled', budget_tokens: 10000 } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'high'
      }
    },
    {
      id: 'claude-haiku-4-5-20251001',
      name: 'Claude Haiku 4.5',
      icon: 'claude',
      enabled: true,
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 1,
      outputPrice: 5,
      cacheCreationPrice: 1.25,
      cacheHitPrice: 0.1,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled', budget_tokens: 8000 } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'claude-opus-4-5-20251101',
      name: 'Claude Opus 4.5',
      icon: 'claude',
      enabled: true,
      contextLength: 200_000,
      maxOutputTokens: 64_000,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 5,
      outputPrice: 25,
      cacheCreationPrice: 6.25,
      cacheHitPrice: 0.5,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled', budget_tokens: 10000 } },
        forceTemperature: 1,
        reasoningEffortLevels: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'high'
      }
    }
  ]
}
