import type { BuiltinProviderPreset } from './types'

const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

type OpenCodeGoModel = {
  id: string
  name: string
  enabled?: true
  icon?: string
  type: 'openai-chat' | 'anthropic' | 'openai-responses'
  contextLength: number
  maxOutputTokens: number
  inputPrice: number
  outputPrice: number
  cacheHitPrice?: number
  cacheCreationPrice?: number
  supportsThinking?: boolean
  thinkingConfig?: {
    bodyParams: Record<string, unknown>
    disabledBodyParams?: Record<string, unknown>
    reasoningEffortLevels?: ('low' | 'medium' | 'high' | 'xhigh' | 'max')[]
    defaultReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    forceTemperature?: number
  }
  supportsVision?: boolean
  supportsFunctionCall: boolean
}

const shared = {
  contextLength: 262_144,
  maxOutputTokens: 32_768,
  supportsVision: false,
  supportsFunctionCall: true,
  supportsThinking: true,
  thinkingConfig: {
    bodyParams: { thinking: { type: 'enabled' } },
    disabledBodyParams: { thinking: { type: 'disabled' } }
  }
} as const

const chatModels: OpenCodeGoModel[] = [
  {
    id: 'grok-4.5',
    name: 'Grok 4.5',
    icon: 'grok',
    type: 'openai-responses',
    contextLength: 256_000,
    maxOutputTokens: 32_768,
    inputPrice: 2,
    outputPrice: 6,
    cacheHitPrice: 0.3,
    supportsVision: true,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: {},
      reasoningEffortLevels: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'high'
    }
  },
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    icon: 'chatglm',
    type: 'openai-chat',
    ...shared,
    inputPrice: 1.4,
    outputPrice: 4.4,
    cacheHitPrice: 0.26
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    icon: 'chatglm',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.15,
    outputPrice: 0.5,
    cacheHitPrice: 0.03
  },
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    icon: 'chatglm',
    type: 'openai-chat',
    ...shared,
    inputPrice: 1.4,
    outputPrice: 4.4,
    cacheHitPrice: 0.26,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'max'
    }
  },
  {
    id: 'glm-5.1',
    name: 'GLM-5.1',
    icon: 'chatglm',
    type: 'openai-chat',
    ...shared,
    inputPrice: 1.4,
    outputPrice: 4.4,
    cacheHitPrice: 0.26
  },
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    icon: 'kimi',
    type: 'openai-chat',
    contextLength: 262_144,
    maxOutputTokens: 32_768,
    inputPrice: 3,
    outputPrice: 15,
    cacheHitPrice: 0.3,
    supportsVision: true,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: {},
      reasoningEffortLevels: ['max'],
      defaultReasoningEffort: 'max'
    }
  },
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    icon: 'kimi',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.95,
    outputPrice: 4,
    cacheHitPrice: 0.19,
    supportsVision: true
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    icon: 'kimi',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.95,
    outputPrice: 4,
    cacheHitPrice: 0.16,
    supportsVision: true
  },
  {
    id: 'longcat-2.0',
    name: 'LongCat-2.0',
    icon: 'longcat',
    type: 'openai-chat',
    contextLength: 1_048_576,
    maxOutputTokens: 131_072,
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.006,
    supportsVision: false,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } }
    }
  },
  {
    id: 'mimo-v2.5',
    name: 'MiMo-V2.5',
    icon: 'mimo',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.14,
    outputPrice: 0.28,
    cacheHitPrice: 0.0028
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo-V2.5-Pro',
    icon: 'mimo',
    type: 'openai-chat',
    ...shared,
    maxOutputTokens: 131_072,
    inputPrice: 0.435,
    outputPrice: 0.87,
    cacheHitPrice: 0.003625
  },
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    icon: 'minimax',
    type: 'anthropic',
    ...shared,
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.06
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    icon: 'minimax',
    type: 'anthropic',
    ...shared,
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.06,
    cacheCreationPrice: 0.375
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    icon: 'minimax',
    type: 'anthropic',
    ...shared,
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.06,
    cacheCreationPrice: 0.375
  },
  {
    id: 'muse-spark-1.3-contributor',
    name: 'Muse Spark 1.3 Contributor',
    icon: 'meta',
    type: 'openai-responses',
    contextLength: 1_048_576,
    maxOutputTokens: 32_768,
    inputPrice: 0.1,
    outputPrice: 0.2,
    cacheHitPrice: 0.002,
    supportsVision: true,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: {},
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    }
  },
  {
    id: 'muse-spark-1.2-contributor',
    name: 'Muse Spark 1.2 Contributor',
    icon: 'meta',
    type: 'openai-responses',
    contextLength: 1_048_576,
    maxOutputTokens: 32_768,
    inputPrice: 0.1,
    outputPrice: 0.2,
    cacheHitPrice: 0.002,
    supportsVision: true,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: {},
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    }
  },
  {
    id: 'qwen3.8-max',
    name: 'Qwen3.8 Max',
    icon: 'qwen',
    type: 'anthropic',
    ...shared,
    inputPrice: 2,
    outputPrice: 6,
    cacheHitPrice: 0.25,
    cacheCreationPrice: 2.5
  },
  {
    id: 'qwen3.8-flash',
    name: 'Qwen3.8 Flash',
    icon: 'qwen',
    type: 'anthropic',
    ...shared,
    inputPrice: 0.15,
    outputPrice: 0.47,
    cacheHitPrice: 0.016,
    cacheCreationPrice: 0.2
  },
  {
    id: 'qwen3.7-max',
    name: 'Qwen3.7 Max',
    icon: 'qwen',
    type: 'anthropic',
    ...shared,
    inputPrice: 2.5,
    outputPrice: 7.5,
    cacheHitPrice: 0.5,
    cacheCreationPrice: 3.125
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen3.7 Plus',
    icon: 'qwen',
    type: 'anthropic',
    ...shared,
    // 官方按 256K 上下文分两档报价，单一价格字段装不下一组；取 >256K 档。
    inputPrice: 1.2,
    outputPrice: 4.8,
    cacheHitPrice: 0.12,
    cacheCreationPrice: 1.5
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen3.6 Plus',
    icon: 'qwen',
    type: 'anthropic',
    ...shared,
    // 同 qwen3.7-plus：取 >256K 档。
    inputPrice: 2,
    outputPrice: 6,
    cacheHitPrice: 0.2,
    cacheCreationPrice: 2.5
  },
  {
    id: 'hy3',
    name: 'Hy3',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.14,
    outputPrice: 0.58,
    cacheHitPrice: 0.035
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    icon: 'deepseek',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.66,
    outputPrice: 1.98,
    cacheHitPrice: 0.022,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high'
    }
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    icon: 'deepseek',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.22,
    outputPrice: 0.66,
    cacheHitPrice: 0.007,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high'
    }
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    name: 'DeepSeek V4 Flash Vision Exp',
    icon: 'deepseek',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.22,
    outputPrice: 0.66,
    cacheHitPrice: 0.007,
    supportsVision: true,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high'
    }
  },
  {
    id: 'ox-alpha-free',
    name: 'Ox Alpha Free',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0,
    outputPrice: 0,
    cacheHitPrice: 0,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'max'
    }
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna',
    icon: 'openai',
    type: 'openai-responses',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    inputPrice: 0.2,
    outputPrice: 1.2,
    cacheHitPrice: 0.02,
    cacheCreationPrice: 0.25,
    supportsVision: true,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: {},
      reasoningEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      defaultReasoningEffort: 'high'
    }
  }
]

export const opencodeGoPreset: BuiltinProviderPreset = {
  builtinId: 'opencode-go',
  version: 8,
  name: 'OpenCode Go',
  type: 'openai-chat',
  defaultBaseUrl: OPENCODE_GO_BASE_URL,
  // 推广链接（带邀请码），不是文档地址 —— 别顺手订正回 /docs/zh-cn/go/
  homepage: 'https://opencode.ai/go?ref=PWHP4P4E29',
  apiKeyUrl: 'https://opencode.ai/auth',
  defaultModel: 'deepseek-v4-flash',
  defaultModels: chatModels.map((model) => ({ ...model, enabled: true }))
}
