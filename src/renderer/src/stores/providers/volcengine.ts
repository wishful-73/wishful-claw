import type { BuiltinProviderPreset } from './types'
// 价格来源：火山方舟官方「模型价格」文档 volcengine.com/docs/82379/1544106（2026-09 核对）。
// 官方人民币牌价按 1 USD = 6.7106 CNY 折算为文件所用的 USD 口径。
// 注意两点口径：
//   1) seed-2.0 系列（pro / lite / mini / code）为「按输入长度分段计费」，此处取首档
//      （[0,32]K）的基准价，长输入档价格更高（如 2.0-pro 在 (128,256]K 档为 ¥9.6/¥48）。
//   2) 火山方舟另有「低延迟」与「批量推理」两套价目，此处取在线推理（常规）价。
// 官方人民币基准价（每百万 token，输入 / 输出 / 缓存命中）：
//   seed-2.1-pro     ¥6   / ¥30  / ¥1.2
//   seed-2.1-turbo   ¥3   / ¥15  / ¥0.6
//   seed-evolving    ¥6   / ¥30  / ¥1.2
//   seed-2.0-pro     ¥3.2 / ¥16  / ¥0.64
//   seed-2.0-lite    ¥0.6 / ¥3.6 / ¥0.12
//   seed-2.0-mini    ¥0.2 / ¥2.0 / ¥0.04
//   seed-2.0-code    ¥3.2 / ¥16  / ¥0.64
//   seed-code        ¥1.2 / ¥8.0 / ¥0.24
// 定时版本号（-260628 / -260215）与不带日期的基础名共用同一价目。

export const volcenginePreset: BuiltinProviderPreset = {
  builtinId: 'volcengine',
  version: 2,
  name: '火山引擎',
  type: 'openai-chat',
  defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
  homepage: 'https://www.volcengine.com/product/doubao',
  apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
  defaultEnabled: false,
  defaultModel: 'doubao-seed-2-1-pro-260628',
  defaultModels: [
    {
      id: 'doubao-seed-2-1-pro-260628',
      name: 'Doubao Seed 2.1 Pro (260628)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.894,
      outputPrice: 4.471,
      cacheHitPrice: 0.179,
      contextLength: 256_000,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'doubao-seed-2-1-turbo-260628',
      name: 'Doubao Seed 2.1 Turbo (260628)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.447,
      outputPrice: 2.235,
      cacheHitPrice: 0.089,
      contextLength: 256_000,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'doubao-seed-evolving',
      name: 'Doubao Seed Evolving',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.894,
      outputPrice: 4.471,
      cacheHitPrice: 0.179,
      contextLength: 256_000,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'doubao-seed-2-0-pro-260215',
      name: 'Doubao Seed 2.0 Pro (260215)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.477,
      outputPrice: 2.384,
      cacheHitPrice: 0.095,
      contextLength: 256_000,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'doubao-seed-2-0-lite-260215',
      name: 'Doubao Seed 2.0 Lite (260215)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.089,
      outputPrice: 0.536,
      cacheHitPrice: 0.018,
      contextLength: 256_000,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'doubao-seed-2-0-mini-260215',
      name: 'Doubao Seed 2.0 Mini (260215)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.03,
      outputPrice: 0.298,
      cacheHitPrice: 0.006,
      contextLength: 256_000,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: {},
        reasoningEffortLevels: ['minimal', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'medium'
      }
    },
    {
      id: 'doubao-seed-2.0-code',
      name: 'Doubao Seed 2.0 Code',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.477,
      outputPrice: 2.384,
      cacheHitPrice: 0.095,
      contextLength: 256_000
    },
    {
      id: 'doubao-seed-2-0-code-preview-260215',
      name: 'Doubao Seed 2.0 Code Preview (260215)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.477,
      outputPrice: 2.384,
      cacheHitPrice: 0.095,
      contextLength: 256_000
    },
    {
      id: 'doubao-seed-code-preview-latest',
      name: 'Doubao Seed Code Preview (Latest)',
      icon: 'doubao',
      enabled: true,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.179,
      outputPrice: 1.192,
      cacheHitPrice: 0.036,
      contextLength: 256_000
    }
  ]
}
