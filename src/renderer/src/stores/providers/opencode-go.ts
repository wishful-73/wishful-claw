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

// Go 网关是 Go 写的 OpenAI 兼容层，严格解码 —— 不认 `thinking` 字段。开着思考时把
// `shared` 的 `{ thinking: { type: 'enabled' } }` 注入请求体会直接 400
// （json: unknown field "thinking"）；关思考时的 `disabledBodyParams` 同理会被拒。
// GLM 系列思考由上游默认开启，这里不注入任何 body 字段。
const glmThinkingConfig = { bodyParams: {} }

const chatModels: OpenCodeGoModel[] = [
  {
    id: 'grok-4.7',
    name: 'Grok 4.7',
    icon: 'grok',
    type: 'openai-responses',
    contextLength: 256_000,
    maxOutputTokens: 32_768,
    inputPrice: 4,
    outputPrice: 12,
    cacheHitPrice: 1,
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
    id: 'grok-4.6',
    name: 'Grok 4.6',
    icon: 'grok',
    type: 'openai-responses',
    contextLength: 256_000,
    maxOutputTokens: 32_768,
    inputPrice: 4,
    outputPrice: 12,
    cacheHitPrice: 1,
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
    cacheHitPrice: 0.26,
    thinkingConfig: glmThinkingConfig
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    icon: 'chatglm',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.15,
    outputPrice: 0.5,
    cacheHitPrice: 0.03,
    thinkingConfig: glmThinkingConfig
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
      bodyParams: {},
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'max'
    }
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
    id: 'longcat-2.5-preview-free',
    name: 'LongCat 2.5 Preview Free',
    icon: 'longcat',
    type: 'openai-chat',
    contextLength: 1_048_576,
    maxOutputTokens: 131_072,
    inputPrice: 0,
    outputPrice: 0,
    cacheHitPrice: 0,
    supportsVision: false,
    supportsFunctionCall: true,
    supportsThinking: true,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } }
    }
  },
  {
    id: 'mimo-v2.6-flash',
    name: 'MiMo-V2.6-Flash',
    icon: 'mimo',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.14,
    outputPrice: 0.28,
    cacheHitPrice: 0.0028
  },
  {
    id: 'mimo-v2.6-pro',
    name: 'MiMo-V2.6-Pro',
    icon: 'mimo',
    type: 'openai-chat',
    ...shared,
    maxOutputTokens: 131_072,
    inputPrice: 0.435,
    outputPrice: 0.87,
    cacheHitPrice: 0.003625
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
    id: 'hy4-preview',
    name: 'Hy4 preview',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.834,
    outputPrice: 2.501,
    cacheHitPrice: 0.042
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
    id: 'space-bunny',
    name: 'Space Bunny',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.15,
    outputPrice: 0.6,
    cacheHitPrice: 0.03
  },
  {
    id: 'deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    icon: 'deepseek',
    type: 'openai-chat',
    ...shared,
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.006,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high'
    }
  },
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    icon: 'deepseek',
    type: 'openai-chat',
    ...shared,
    inputPrice: 1.32,
    outputPrice: 3.96,
    cacheHitPrice: 0.044,
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
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.006,
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
    inputPrice: 0.3,
    outputPrice: 1.2,
    cacheHitPrice: 0.006,
    supportsVision: true,
    thinkingConfig: {
      bodyParams: { thinking: { type: 'enabled' } },
      disabledBodyParams: { thinking: { type: 'disabled' } },
      reasoningEffortLevels: ['low', 'high', 'max'],
      defaultReasoningEffort: 'high'
    }
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT 6 Luna',
    icon: 'openai',
    type: 'openai-responses',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    inputPrice: 0.2,
    outputPrice: 0.75,
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
  },
  {
    id: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5',
    icon: 'claude',
    type: 'anthropic',
    ...shared,
    contextLength: 200_000,
    maxOutputTokens: 64_000,
    inputPrice: 0.5,
    outputPrice: 2.5,
    cacheHitPrice: 0.05,
    cacheCreationPrice: 0.625
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna',
    icon: 'openai',
    type: 'openai-responses',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    inputPrice: 0.4,
    outputPrice: 1.8,
    cacheHitPrice: 0.04,
    cacheCreationPrice: 0.5,
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

// v9: 2026-09-30 修正 GLM 系列思考配置 —— Go 网关（Go 写的 OpenAI 兼容层）不认
//     `thinking` 字段，开着思考时注入会直接 400（json: unknown field "thinking"）。
//     四个 GLM 模型不再注入该字段，思考由上游默认开启。
// v10: 2026-10-08 模型清单按官方文档（https://opencode.ai/v2/docs/console/go）全量刷新：
//     增 10（Grok 4.7/4.6、GPT 6 Luna、Claude Haiku 5.5、LongCat 2.5 Preview Free、
//     MiMo-V2.6-Flash/Pro、DeepSeek V4.1 Flash、Hy4 preview、Space Bunny），
//     删 6（Grok 4.5、GLM-5.1、MiniMax M2.5、Qwen3.7 Max、Qwen3.6 Plus、Ox Alpha Free），
//     并按官方价目表订正 4 处价格。官方按 token 数 / 时段分档报价的一律取最高档。
// v11: 2026-10-13 产品页地址改为 https://opencode.ai/zh/go —— 官方已**取消推广返利**，
//     故不再带 ?ref= 邀请码（旧值 https://opencode.ai/go?ref=PWHP4P4E29 作废）。
export const opencodeGoPreset: BuiltinProviderPreset = {
  builtinId: 'opencode-go',
  version: 11,
  name: 'OpenCode Go',
  type: 'openai-chat',
  defaultBaseUrl: OPENCODE_GO_BASE_URL,
  // 产品页地址（不是文档地址 —— 别顺手订正成 /docs/…）。2026-10-13 官方取消推广返利后不再带邀请码。
  homepage: 'https://opencode.ai/zh/go',
  apiKeyUrl: 'https://opencode.ai/auth',
  defaultModel: 'deepseek-v4-flash',
  defaultModels: chatModels.map((model) => ({ ...model, enabled: true }))
}
