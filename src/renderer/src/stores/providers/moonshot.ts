/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from './types'

// 对齐 github.com/MoonshotAI/kimi-cli 当前版本（coding 端点有客户端白名单，UA 需可识别）。
// 不换成新 CLI 的 kimi-code-cli/<ver>：那个客户端还会携带 X-Msh-* 设备头，我们不发。
const KIMI_CLI_USER_AGENT = 'KimiCLI/1.49.0'
const KIMI_OAUTH_HOST = 'https://auth.kimi.com'
const KIMI_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098'

// Price fields below are USD per 1M tokens; Kimi publishes CNY prices, so values are converted.
export const moonshotCodingPreset: BuiltinProviderPreset = {
  builtinId: 'moonshot-coding',
  // v3: 2026-09 按官方定价页核对；kimi-for-coding 已指向 K2.8 Preview（Model ID 不变）。
  version: 3,
  name: 'Moonshot（套餐）',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.kimi.com/coding/v1',
  homepage: 'https://www.kimi.com',
  apiKeyUrl: 'https://www.kimi.com/code/console?from=membership',
  defaultEnabled: false,
  requiresApiKey: false,
  authMode: 'oauth',
  userAgent: KIMI_CLI_USER_AGENT,
  oauthConfig: {
    authorizeUrl: '',
    tokenUrl: `${KIMI_OAUTH_HOST}/api/oauth/token`,
    deviceCodeUrl: `${KIMI_OAUTH_HOST}/api/oauth/device_authorization`,
    clientId: KIMI_CLIENT_ID,
    clientIdLocked: true,
    flowType: 'device_code',
    tokenRequestHeaders: {
      Accept: 'application/json',
      'User-Agent': KIMI_CLI_USER_AGENT
    },
    refreshRequestHeaders: {
      Accept: 'application/json',
      'User-Agent': KIMI_CLI_USER_AGENT
    },
    deviceCodeRequestHeaders: {
      Accept: 'application/json',
      'User-Agent': KIMI_CLI_USER_AGENT
    },
    usePkce: false
  },
  ui: { hideOAuthSettings: true },
  defaultModels: [
    // Kimi K3（Kimi Code 套餐，2026-07-16）。请求参数对齐官方 kimi-code CLI
    // （github.com/MoonshotAI/kimi-code, kosong/providers/kimi.ts）对 coding 端点的线上格式：
    //  - thinking 常开，effort 走 thinking.effort（当前仅 max 档），因此省略顶层 reasoning_effort；
    //  - temperature 服务端固定，官方客户端默认不发；
    //  - 输出上限官方客户端默认不发（服务端默认 131072）。max_tokens 是遗留别名，推理模型下
    //    与思考内容共享预算，小值会导致 200 空内容，因此连同 max_completion_tokens 一起省略。
    // 上下文按档位：Moderato 256K，Allegretto 及以上 1M —— 预设取保守的 256K，
    // 高档位用户可在模型编辑里调大。价格按 Moonshot 官方 API 的 K3 价目展示。
    {
      id: 'k3',
      name: 'Kimi K3',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 131_072,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 3,
      outputPrice: 15,
      cacheHitPrice: 0.3,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled', effort: 'max' } },
        reasoningEffortLevels: ['max'],
        defaultReasoningEffort: 'max'
      },
      requestOverrides: {
        omitBodyKeys: ['temperature', 'max_tokens', 'max_completion_tokens', 'reasoning_effort']
      }
    },
    {
      id: 'kimi-for-coding',
      name: 'Kimi For Coding (K2.8 Preview)',
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
    // Allegretto 及以上档位可用；输出加速，输入/缓存价与 kimi-for-coding 相同。
    {
      id: 'kimi-for-coding-highspeed',
      name: 'Kimi For Coding HighSpeed (K2.8 Preview)',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.95,
      outputPrice: 8,
      cacheHitPrice: 0.19,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        forceTemperature: 1
      }
    }
  ]
}

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
