/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from './types'

export const qwenCodingPreset: BuiltinProviderPreset = {
  builtinId: 'qwen-coding',
  // v2: 2026-09 版本号推进（本次未改 Coding Plan 模型清单）。
  version: 2,
  name: '通义千问（套餐）',
  type: 'anthropic',
  defaultBaseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
  homepage: 'https://dashscope.aliyun.com',
  apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
  defaultEnabled: false,
  userAgent: 'claude-cli/2.1.71 (external, cli)',
  defaultModels: [
    // Coding Plan models (official: Coding Plan 概述 / 套餐详情)
    {
      id: 'qwen3.5-plus',
      name: 'Qwen3.5 Plus',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 1.2,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } }
      }
    },
    {
      id: 'qwen3-coder-next',
      name: 'Qwen3 Coder Next',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.22,
      outputPrice: 1.0,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { enable_thinking: true },
        disabledBodyParams: { enable_thinking: false }
      }
    },
    {
      id: 'qwen3-coder-plus',
      name: 'Qwen3 Coder Plus',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.22,
      outputPrice: 1.0,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { enable_thinking: true },
        disabledBodyParams: { enable_thinking: false }
      }
    },
    {
      id: 'qwen3-max-2026-01-23',
      name: 'Qwen3 Max 2026-01-23',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.2,
      outputPrice: 6,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'kimi-k2.6',
      name: 'Kimi K2.6',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.15,
      outputPrice: 0.9,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'kimi-k2.5',
      name: 'Kimi K2.5',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.23,
      outputPrice: 3,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'kimi-k2-thinking',
      name: 'Kimi K2 Thinking',
      icon: 'kimi',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.47,
      outputPrice: 2,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      }
    },
    {
      id: 'glm-5',
      name: 'GLM 5',
      icon: 'chatglm',
      enabled: true,
      contextLength: 202_752,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.14,
      outputPrice: 0.56
    },
    {
      id: 'glm-4.7',
      name: 'GLM 4.7',
      icon: 'chatglm',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.38,
      outputPrice: 1.7
    },
    {
      id: 'MiniMax-M2.5',
      name: 'MiniMax M2.5',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsVision: false,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.3,
      outputPrice: 1.1
    }
  ]
}

export const qwenPreset: BuiltinProviderPreset = {
  builtinId: 'qwen',
  // v2: 2026-09 按官方模型大全核对（新增 Qwen3.8 Max）。
  version: 2,
  name: '通义千问（官方）',
  type: 'openai-chat',
  defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  homepage: 'https://dashscope.aliyun.com',
  apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
  defaultModels: [
    // Qwen3.8 系列（2026-09 官方新旗舰）。价格按官方北京地域标准价（¥12/¥36 每百万 Token）
    // 以 1 USD = 6.7106 CNY 换算为 USD，与文件内其它 Qwen 模型的美元口径一致。
    {
      id: 'qwen3.8-max',
      name: 'Qwen3.8 Max',
      icon: 'qwen',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.79,
      outputPrice: 5.37,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    // Qwen3.7 series (2026-05 flagship refresh)
    {
      id: 'qwen3.7-max',
      name: 'Qwen3.7 Max',
      icon: 'qwen',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.25,
      outputPrice: 3.75,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'qwen3.7-plus',
      name: 'Qwen3.7 Plus',
      icon: 'qwen',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 65_536,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.32,
      outputPrice: 1.28,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    // Qwen3 series (tiered pricing, base tier ≤32K/≤256K shown)
    {
      id: 'qwen3-max',
      name: 'Qwen3 Max',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.2,
      outputPrice: 6,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'qwen-plus',
      name: 'Qwen Plus (Qwen3)',
      icon: 'qwen',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.4,
      outputPrice: 1.2,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    // Legacy Qwen models
    {
      id: 'qwen-max',
      name: 'Qwen Max',
      icon: 'qwen',
      enabled: true,
      contextLength: 32_768,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.6,
      outputPrice: 6.4
    },
    // Qwen-Flash (low-cost tier; free trial ended 2026-04-15)
    {
      id: 'qwen-flash',
      name: 'Qwen Flash',
      icon: 'qwen',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.05,
      outputPrice: 0.4,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    }
  ]
}
