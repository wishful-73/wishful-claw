/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from './types'

export const moonshotPreset: BuiltinProviderPreset = {
  builtinId: 'moonshot',
  // v3: 2026-09 按官方定价页核对（修正 K2.7 Code HighSpeed 价格；K2.5 已下线）。
  version: 3,
  name: 'Moonshot（官方）',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.moonshot.cn/v1',
  homepage: 'https://platform.moonshot.cn',
  apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
  defaultModel: 'kimi-k2.7-code',
  deprecatedModelIds: [
    'kimi-k2.5',
    'kimi-k2-0905-preview',
    'kimi-k2-0711-preview',
    'kimi-k2-turbo-preview',
    'kimi-k2-thinking',
    'kimi-k2-thinking-turbo',
    'kimi-latest',
    'kimi-thinking-preview'
  ],
  defaultModels: [
    // Kimi K3（2026-07-16）：thinking 常开，官方 API 文档走顶层 reasoning_effort（当前仅 max 档）；
    // temperature/top_p 等采样参数服务端固定，请求中必须省略。输出上限也省略（服务端默认
    // 131072）：max_tokens 是遗留别名，推理模型下与思考内容共享预算，小值会导致 200 空内容。
    {
      id: 'kimi-k3',
      name: 'Kimi K3',
      icon: 'kimi',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 131_072,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 3,
      outputPrice: 15,
      cacheHitPrice: 0.3,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['max'],
        defaultReasoningEffort: 'max'
      },
      requestOverrides: {
        omitBodyKeys: ['temperature', 'max_tokens', 'max_completion_tokens']
      }
    },
    {
      id: 'kimi-k2.7-code',
      name: 'Kimi K2.7 Code',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.95,
      outputPrice: 4,
      cacheHitPrice: 0.19,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'kimi-k2.7-code-highspeed',
      name: 'Kimi K2.7 Code HighSpeed',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 1.9,
      outputPrice: 8,
      cacheHitPrice: 0.38,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        forceTemperature: 1
      }
    },
    // Kimi K2.6
    {
      id: 'kimi-k2.6',
      name: 'Kimi K2.6',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.95,
      outputPrice: 4,
      cacheHitPrice: 0.16,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    // Moonshot V1 series (cache: 75% off input)
    {
      id: 'moonshot-v1-auto',
      name: 'Moonshot v1 Auto',
      icon: 'moonshot',
      enabled: true,
      maxOutputTokens: 4_096,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.6,
      outputPrice: 2.5,
      cacheHitPrice: 0.15
    },
    {
      id: 'moonshot-v1-8k',
      name: 'Moonshot v1 8K',
      icon: 'moonshot',
      enabled: true,
      contextLength: 8_192,
      maxOutputTokens: 4_096,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.28,
      outputPrice: 1.4,
      cacheHitPrice: 0.07
    },
    {
      id: 'moonshot-v1-32k',
      name: 'Moonshot v1 32K',
      icon: 'moonshot',
      enabled: true,
      contextLength: 32_768,
      maxOutputTokens: 4_096,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.7,
      outputPrice: 2.8,
      cacheHitPrice: 0.18
    },
    {
      id: 'moonshot-v1-128k',
      name: 'Moonshot v1 128K',
      icon: 'moonshot',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 4_096,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.4,
      outputPrice: 4.2,
      cacheHitPrice: 0.35
    },
    {
      id: 'moonshot-v1-8k-vision-preview',
      name: 'Moonshot v1 8K Vision Preview',
      icon: 'moonshot',
      enabled: true,
      contextLength: 8_192,
      maxOutputTokens: 4_096,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.28,
      outputPrice: 1.4,
      cacheHitPrice: 0.07
    },
    {
      id: 'moonshot-v1-32k-vision-preview',
      name: 'Moonshot v1 32K Vision Preview',
      icon: 'moonshot',
      enabled: true,
      contextLength: 32_768,
      maxOutputTokens: 4_096,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.7,
      outputPrice: 2.8,
      cacheHitPrice: 0.18
    },
    {
      id: 'moonshot-v1-128k-vision-preview',
      name: 'Moonshot v1 128K Vision Preview',
      icon: 'moonshot',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 4_096,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 1.4,
      outputPrice: 4.2,
      cacheHitPrice: 0.35
    }
  ]
}
