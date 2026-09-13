/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { BuiltinProviderPreset } from './types'

// v2: 2026-09 按硅基流动官方「模型价格总览」（siliconflow.cn/pricing）复核。
//     官方为人民币牌价（每百万 token），按 1 USD = 6.7106 CNY 折算为文件所用的 USD 口径。
//     Hunyuan-A13B-Instruct 等模型官方实行峰谷计价（9:00-18:00 为高价档），
//     此处一律取标准档（9:00-18:00）；DeepSeek-V4-Flash 同理取 0-2/8-24 点档。
//     本次仅复核官方价格页公示的模型，并新增该页新公示的 GLM-5.3 / Hy4 preview；
//     平台完整目录需鉴权（GET /v1/models 返回 401），故未做删除。

export const siliconflowPreset: BuiltinProviderPreset = {
  builtinId: 'siliconflow',
  version: 2,
  name: '硅基流动',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.siliconflow.cn/v1',
  homepage: 'https://siliconflow.cn',
  apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
  defaultModels: [
    // ── DeepSeek ──
    {
      id: 'deepseek-ai/DeepSeek-V4-Pro',
      name: 'DeepSeek V4 Pro',
      icon: 'deepseek',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.788,
      outputPrice: 3.577,
      cacheHitPrice: 0.149,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'deepseek-ai/DeepSeek-V4-Flash',
      name: 'DeepSeek V4 Flash',
      icon: 'deepseek',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.447,
      outputPrice: 1.341,
      cacheHitPrice: 0.045,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'deepseek-ai/DeepSeek-V3.2',
      name: 'DeepSeek V3.2',
      icon: 'deepseek',
      enabled: true,
      contextLength: 164_000,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.596,
      outputPrice: 0.894,
      cacheHitPrice: 0.06,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'deepseek-ai/DeepSeek-V3.1',
      name: 'DeepSeek V3.1',
      icon: 'deepseek',
      enabled: true,
      contextLength: 164_000,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.27,
      outputPrice: 1.0,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'deepseek-ai/DeepSeek-V3.1-Terminus',
      name: 'DeepSeek V3.1 Terminus',
      icon: 'deepseek',
      enabled: true,
      contextLength: 164_000,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.596,
      outputPrice: 1.788,
      cacheHitPrice: 0.06,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    // ── Qwen ──
    {
      id: 'Qwen/Qwen3.6-35B-A3B',
      name: 'Qwen3.6 35B-A3B',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.268,
      outputPrice: 1.61,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'tencent/Hy4-preview',
      name: 'Hy4 Preview',
      icon: 'hunyuan',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 64_000,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.894,
      outputPrice: 2.682,
      cacheHitPrice: 0.045
    },
    {
      id: 'Qwen/Qwen3-235B-A22B',
      name: 'Qwen3 235B',
      icon: 'qwen',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.455,
      outputPrice: 1.82,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'Qwen/Qwen3-30B-A3B',
      name: 'Qwen3 30B-A3B',
      icon: 'qwen',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.08,
      outputPrice: 0.28,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    {
      id: 'Qwen/Qwen3-8B',
      name: 'Qwen3 8B',
      icon: 'qwen',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 32_768,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.05,
      outputPrice: 0.4,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } }
    },
    // ── GLM (智谱) ──
    {
      id: 'zai-org/GLM-5.2',
      name: 'GLM-5.2',
      icon: 'chatglm',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.192,
      outputPrice: 4.172,
      cacheHitPrice: 0.298,
    },
    {
      id: 'zai-org/GLM-5.3',
      name: 'GLM-5.3',
      icon: 'chatglm',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 1.192,
      outputPrice: 4.172,
      cacheHitPrice: 0.298
    },
    {
      id: 'THUDM/GLM-4.5-Air',
      name: 'GLM-4.5 Air',
      icon: 'chatglm',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.149,
      outputPrice: 0.894
    },
    {
      id: 'THUDM/GLM-4-32B-0414',
      name: 'GLM-4 32B',
      icon: 'chatglm',
      enabled: true,
      contextLength: 32_768,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.282,
      outputPrice: 0.282
    },
    // ── Moonshot / Kimi ──
    {
      id: 'moonshotai/Kimi-K2.7-Code',
      name: 'Kimi K2.7 Code',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.969,
      outputPrice: 4.024,
      cacheHitPrice: 0.194,
    },
    {
      id: 'moonshotai/Kimi-K2.6',
      name: 'Kimi K2.6',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.15,
      outputPrice: 0.9
    },
    {
      id: 'moonshotai/Kimi-K2.5',
      name: 'Kimi K2.5',
      icon: 'kimi',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } },
        forceTemperature: 1
      },
      inputPrice: 0.23,
      outputPrice: 3.0
    },
    {
      id: 'moonshotai/Kimi-K2-Instruct',
      name: 'Kimi K2 Instruct',
      icon: 'kimi',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.58,
      outputPrice: 2.29
    },
    {
      id: 'moonshotai/Kimi-Dev-72B',
      name: 'Kimi Dev 72B',
      icon: 'kimi',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.29,
      outputPrice: 1.15
    },
    // ── MiniMax ──
    {
      id: 'MiniMaxAI/MiniMax-M3',
      name: 'MiniMax M3',
      icon: 'minimax',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 16_384,
      supportsVision: true,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } },
      inputPrice: 0.3,
      outputPrice: 1.2
    },
    {
      id: 'MiniMaxAI/MiniMax-M2.1',
      name: 'MiniMax M2.1',
      icon: 'minimax',
      enabled: true,
      contextLength: 196_608,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } },
      inputPrice: 0.29,
      outputPrice: 1.2
    },
    {
      id: 'MiniMaxAI/MiniMax-M2',
      name: 'MiniMax M2',
      icon: 'minimax',
      enabled: true,
      contextLength: 196_608,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctionCall: true,
      supportsThinking: true,
      thinkingConfig: { bodyParams: { enable_thinking: true } },
      inputPrice: 0.3,
      outputPrice: 1.2
    },
    {
      id: 'MiniMaxAI/MiniMax-M1-80k',
      name: 'MiniMax M1 80K',
      icon: 'minimax',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.55,
      outputPrice: 2.2
    },
    // ── OpenAI (开源) ──
    {
      id: 'openai/gpt-oss-120b',
      name: 'GPT-OSS 120B',
      icon: 'openai',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.039,
      outputPrice: 0.19
    },
    {
      id: 'openai/gpt-oss-20b',
      name: 'GPT-OSS 20B',
      icon: 'openai',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 16_384,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.03,
      outputPrice: 0.14
    },
    // ── 其他 ──
    {
      id: 'baidu/ERNIE-4.5-300B-A47B',
      name: 'ERNIE 4.5 300B',
      icon: 'ernie',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.28,
      outputPrice: 1.1
    },
    {
      id: 'tencent/Hunyuan-A13B-Instruct',
      name: 'Hunyuan A13B',
      icon: 'hunyuan',
      enabled: true,
      contextLength: 131_072,
      maxOutputTokens: 8_192,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.14,
      outputPrice: 0.57
    }
  ]
}
