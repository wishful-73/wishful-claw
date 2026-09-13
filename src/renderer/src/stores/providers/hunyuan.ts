import type { ThinkingConfig } from '../../lib/api/types'
import type { BuiltinProviderPreset } from './types'

/** Hy3: no_think / think_low / think_high. Off maps to official `no_think`. */
const hy3ThinkingConfig: ThinkingConfig = {
  bodyParams: {},
  disabledBodyParams: { reasoning_effort: 'no_think' },
  reasoningEffortLevels: ['low', 'high'],
  defaultReasoningEffort: 'low',
  forceTemperature: 0.9
}

/** Hy4: defaults to high; only high / no_think. Off maps to official `no_think`. */
const hy4ThinkingConfig: ThinkingConfig = {
  bodyParams: {},
  disabledBodyParams: { reasoning_effort: 'no_think' },
  reasoningEffortLevels: ['high'],
  defaultReasoningEffort: 'high',
  forceTemperature: 0.9
}

export const hunyuanPreset: BuiltinProviderPreset = {
  builtinId: 'hunyuan',
  // v2: add Hy4 Preview (1M context, thinking defaults to high).
  // v3: hy3-preview retired by TokenHub on 2026-08-31 (traffic routes to hy3).
  // v4: 2026-09 按腾讯云 TokenHub 官方价格表（cloud.tencent.com/document/product/1823/130055）
  //     补齐 hy4-preview / hy3 价格。官方人民币牌价：hy4-preview 输入 ¥6 / 输出 ¥18 /
  //     缓存命中 ¥0.3；hy3 输入 ¥1 / 输出 ¥4 / 缓存命中 ¥0.25（每百万 token）。
  //     按 1 USD = 6.7106 CNY 折算为文件所用的 USD 口径。
  version: 4,
  name: '腾讯混元',
  type: 'openai-chat',
  defaultBaseUrl: 'https://tokenhub.tencentmaas.com/v1',
  homepage: 'https://cloud.tencent.com/product/tclm',
  apiKeyUrl: 'https://console.cloud.tencent.com/lkeap',
  defaultModel: 'hy3',
  deprecatedModelIds: ['hy3-preview'],
  defaultModels: [
    {
      id: 'hy4-preview',
      name: 'Hy4 Preview',
      icon: 'hunyuan',
      enabled: true,
      contextLength: 1_048_576,
      maxOutputTokens: 64_000,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.894,
      outputPrice: 2.682,
      cacheHitPrice: 0.045,
      supportsThinking: true,
      thinkingConfig: hy4ThinkingConfig
    },
    {
      id: 'hy3',
      name: 'Hy3',
      icon: 'hunyuan',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 128_000,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.149,
      outputPrice: 0.596,
      cacheHitPrice: 0.037,
      supportsThinking: true,
      thinkingConfig: hy3ThinkingConfig
    }
    // hy3-preview retired by TokenHub on 2026-08-31; see deprecatedModelIds above
  ]
}
