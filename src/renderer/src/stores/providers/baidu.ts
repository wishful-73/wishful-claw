/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from './types'

export const baiduCodingPreset: BuiltinProviderPreset = {
  builtinId: 'baidu-coding',
  // v2: 2026-09 按千帆官方计费页核对（Kimi K2.5 已下线；DeepSeek-V3.2 官方标注即将下线）。
  version: 2,
  name: '百度智能云（套餐）',
  type: 'anthropic',
  defaultBaseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
  homepage: 'https://cloud.baidu.com/product/codingplan.html',
  apiKeyUrl: 'https://console.bce.baidu.com/qianfan/resource/subscribe',
  defaultEnabled: false,
  defaultModels: [
    {
      id: 'deepseek-v3.2',
      name: 'DeepSeek V3.2',
      icon: 'deepseek',
      enabled: true,
      contextLength: 163_840,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.26,
      outputPrice: 0.38,
      cacheCreationPrice: 0.26,
      cacheHitPrice: 0.026,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
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
      cacheHitPrice: 0.023,
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
      maxOutputTokens: 64_384,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 1.1,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.4,
      type: 'anthropic'
    },
    {
      id: 'MiniMax-M2.7',
      name: 'MiniMax M2.7',
      icon: 'minimax',
      enabled: true,
      contextLength: 204_800,
      maxOutputTokens: 131_072,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 1.1,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.4,
      type: 'anthropic'
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
      inputPrice: 0.3,
      outputPrice: 1.1,
      cacheHitPrice: 0.03,
      cacheCreationPrice: 0.4,
      type: 'anthropic'
    }
  ]
}

export const baiduPreset: BuiltinProviderPreset = {
  builtinId: 'baidu',
  // v2: 2026-09 按千帆官方计费页核对（补 ERNIE/DeepSeek/Kimi 价格；Kimi K2.5 已下线）。
  version: 2,
  name: '百度智能云（官方）',
  type: 'openai-chat',
  defaultBaseUrl: 'https://qianfan.baidubce.com/v2',
  homepage: 'https://cloud.baidu.com/product-s/qianfan_home',
  apiKeyUrl: 'https://cloud.baidu.com/doc/qianfan/s/wmh8l6tnf',
  defaultModel: 'ernie-5.1',
  deprecatedModelIds: ['kimi-k2.5', 'ernie-x1.1'],
  defaultModels: [
    // ERNIE (native models)
    {
      id: 'ernie-5.1',
      name: 'ERNIE 5.1',
      icon: 'ernie',
      enabled: true,
      supportsFunctionCall: true,
      inputPrice: 0.6,
      outputPrice: 2.68
    },
    {
      id: 'ernie-4.5-turbo-128k',
      name: 'ERNIE 4.5 Turbo 128K',
      icon: 'ernie',
      enabled: true,
      supportsFunctionCall: true,
      inputPrice: 0.12,
      outputPrice: 0.48
    },
    // ernie-x1.1 已于千帆下线，模型从默认清单移除，id 登记在 deprecatedModelIds 中。
    {
      id: 'deepseek-v3.2',
      name: 'DeepSeek V3.2',
      icon: 'deepseek',
      enabled: true,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 0.45
    },
    { id: 'glm-4.7', name: 'GLM 4.7', icon: 'chatglm', enabled: true, supportsFunctionCall: true },
    {
      id: 'kimi-k2.6',
      name: 'Kimi K2.6',
      icon: 'kimi',
      enabled: true,
      supportsFunctionCall: true,
      inputPrice: 0.97,
      outputPrice: 4.02,
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
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2.5',
      name: 'MiniMax M2.5',
      icon: 'minimax',
      enabled: true,
      supportsFunctionCall: true
    },
    {
      id: 'MiniMax-M2.1',
      name: 'MiniMax M2.1',
      icon: 'minimax',
      enabled: true,
      supportsFunctionCall: true
    }
  ]
}
