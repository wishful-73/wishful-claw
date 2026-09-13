import type { AIModelConfig, ThinkingConfig } from '../../lib/api/types'
import type { BuiltinProviderPreset } from './types'

// 价格来源：platform.stepfun.com/docs/zh/guides/pricing/details（2026-09 核对）
// 官方人民币牌价（每百万 token，输入/缓存命中/输出）：
//   step-3.7-flash       ¥1.35 / ¥0.27 / ¥8.1
//   step-3.5-flash       ¥0.7  / ¥0.14 / ¥2.1（含 -2603 版本）
// 按 1 USD = 6.7106 CNY 折算为文件所用的 USD 口径。

/** Step 3.7 has no non-thinking mode; official effort is low / medium / high. */
const step37ThinkingConfig: ThinkingConfig = {
  bodyParams: {},
  reasoningEffortLevels: ['low', 'medium', 'high'],
  defaultReasoningEffort: 'medium'
}

const step35ThinkingConfig: ThinkingConfig = {
  bodyParams: { enable_thinking: true },
  disabledBodyParams: { enable_thinking: false }
}

const stepfunModels: AIModelConfig[] = [
  {
    id: 'step-3.7-flash',
    name: 'Step 3.7 Flash',
    icon: 'stepfun',
    enabled: true,
    contextLength: 262_144,
    maxOutputTokens: 262_144,
    supportsVision: true,
    supportsFunctionCall: true,
    inputPrice: 0.201,
    outputPrice: 1.207,
    cacheHitPrice: 0.04,
    supportsThinking: true,
    thinkingConfig: step37ThinkingConfig
  },
  {
    id: 'step-3.5-flash',
    name: 'Step 3.5 Flash',
    icon: 'stepfun',
    enabled: true,
    contextLength: 262_144,
    maxOutputTokens: 65_536,
    supportsVision: false,
    supportsFunctionCall: true,
    inputPrice: 0.104,
    outputPrice: 0.313,
    cacheHitPrice: 0.021,
    supportsThinking: true,
    thinkingConfig: step35ThinkingConfig
  }
]

export const stepfunPreset: BuiltinProviderPreset = {
  builtinId: 'stepfun',
  version: 2,
  name: '阶跃星辰',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.stepfun.com/v1',
  homepage: 'https://platform.stepfun.com',
  apiKeyUrl: 'https://platform.stepfun.com/interface-key',
  defaultModel: 'step-3.7-flash',
  defaultModels: stepfunModels
}

export const stepfunPlanPreset: BuiltinProviderPreset = {
  builtinId: 'stepfun-plan',
  version: 2,
  name: '阶跃星辰（套餐）',
  type: 'openai-chat',
  defaultBaseUrl: 'https://api.stepfun.com/step_plan/v1',
  homepage: 'https://platform.stepfun.com',
  apiKeyUrl: 'https://platform.stepfun.com/interface-key',
  defaultEnabled: false,
  defaultModel: 'step-3.7-flash',
  defaultModels: [
    ...stepfunModels,
    {
      id: 'step-3.5-flash-2603',
      name: 'Step 3.5 Flash 2603',
      icon: 'stepfun',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 65_536,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.104,
      outputPrice: 0.313,
      cacheHitPrice: 0.021,
      supportsThinking: true,
      thinkingConfig: step35ThinkingConfig
    }
  ]
}
