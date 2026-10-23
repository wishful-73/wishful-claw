/*
 * S-218 WorkBuddy 账号接入（A 形态：复用用户已有套餐额度）。
 *
 * 契约来源：astragate-community/astra-gate-plugins → packages/workbuddy/
 * （Apache-2.0，src_sites.mjs / src_request.mjs / src_signin.mjs 实测记录）。
 *
 * 两个 build 共用一套代码，只有 endpoint / platform / 模型表 / 图片能力不同：
 *   国内版  workbuddy      https://copilot.tencent.com   /v2   15 个模型
 *   国际版  workbuddy-ai   https://www.workbuddy.ai      /v2   16 个模型
 *
 * 定价一律 0：这条通道吃的是用户自己的套餐额度，不按 token 计费。
 * 计费口径是 credits 倍率（`x0.03` 这类），只在运行时从 /v3/config 读，见 §3.5。
 */

import type { BuiltinProviderPreset } from './types'
import type { AIModelConfig, ReasoningEffortLevel } from '../../../../shared/types/provider'

/**
 * 模型清单：[id, name, contextLength, reasoningEfforts?]
 * 与参考实现 src_sites.mjs 的 CN_MODELS / AI_MODELS 逐条对齐，顺序也保持原样。
 */
type ModelRow = [id: string, name: string, context: number, efforts?: ReasoningEffortLevel[]]

const CN_MODELS: ModelRow[] = [
  ['auto', 'Auto', 168_000],
  ['hy4-preview-f', 'Hy4 preview', 1_000_000, ['high']],
  ['hy3', 'Hy3', 192_000, ['low', 'high']],
  ['hy3-x', 'Hy3-X', 192_000, ['low', 'high']],
  ['deepseek-v4.1-flash', 'Deepseek-V4.1-Flash', 1_000_000],
  ['glm-5.3', 'GLM-5.3', 1_000_000, ['low', 'high', 'max']],
  ['glm-5.3-flash', 'GLM-5.3-Flash', 1_000_000, ['low', 'high', 'max']],
  ['glm-5.2', 'GLM-5.2', 1_000_000, ['high', 'xhigh']],
  ['glm-5.1', 'GLM-5.1', 200_000],
  ['glm-5v-turbo', 'GLM-5v-Turbo', 200_000],
  ['minimax-m3', 'MiniMax-M3', 512_000],
  ['kimi-k3-1', 'Kimi-K3', 1_000_000, ['low', 'high', 'xhigh']],
  ['kimi-k2.7', 'Kimi-K2.7-Code', 256_000],
  ['kimi-k2.6', 'Kimi-K2.6', 256_000],
  ['deepseek-v4-pro', 'Deepseek-V4-Pro', 1_000_000, ['none', 'high', 'xhigh']]
]

const AI_MODELS: ModelRow[] = [
  ['default-model', 'Default', 176_000],
  ['fast-model', 'Fast', 200_000],
  ['balanced-model', 'Balanced', 256_000],
  ['primary-model', 'Primary', 272_000],
  ['deep-model', 'Deep', 176_000],
  ['gpt-5.5', 'GPT-5.5', 1_000_000],
  ['gpt-5.4', 'GPT-5.4', 272_000],
  ['gpt-5.3-codex', 'GPT-5.3-Codex', 272_000],
  ['gemini-3.1-pro', 'Gemini-3.1-Pro', 400_000],
  ['gemini-3.5-flash', 'Gemini-3.5-Flash', 1_000_000],
  ['glm-5.3', 'GLM-5.3', 1_000_000, ['low', 'high', 'max']],
  ['glm-5.2', 'GLM-5.2', 1_000_000, ['high', 'xhigh']],
  ['hy3', 'Hy3', 192_000, ['low', 'high']],
  ['kimi-k3', 'Kimi-K3', 1_000_000],
  ['kimi-k2.6', 'Kimi-K2.6', 256_000],
  ['minimax-m3', 'MiniMax-M3', 512_000]
]

/**
 * 把模型行转成预设用的 AIModelConfig。
 *
 * `visionFor` 由调用方给：国际版的 GLM 系即使 /v3/config 写着 supportsImages，
 * 服务端也会把图滤掉（参考实现 src_sites.mjs `noImages: /^glm-/`，真账号实测），
 * 所以按 `^glm-` 标纯文本；国内版没有这条实测记录，一律按 config 的说法给 true。
 */
function toModels(rows: ModelRow[], visionFor: (id: string) => boolean): AIModelConfig[] {
  return rows.map(([id, name, context, efforts]) => {
    const levels = efforts ?? []
    const supportsThinking = levels.length > 0
    return {
      id,
      name,
      enabled: true,
      contextLength: context,
      supportsVision: visionFor(id),
      supportsFunctionCall: true,
      // 吃套餐额度，不按 token 计费
      inputPrice: 0,
      outputPrice: 0,
      cacheCreationPrice: 0,
      cacheHitPrice: 0,
      ...(supportsThinking
        ? {
            supportsThinking: true,
            thinkingConfig: {
              bodyParams: {},
              reasoningEffortLevels: levels,
              defaultReasoningEffort: levels[0]
            }
          }
        : {})
    }
  })
}

/** 两个 build 共用的静态请求头。动态头（账号 / 会话 id）由后端方言层注入。 */
function staticHeaders(isInternational: boolean): Record<string, string> {
  return {
    'X-Product': 'SaaS',
    'X-IDE-Type': 'WorkBuddy',
    'X-IDE-Name': 'WorkBuddy',
    'X-IDE-Version': '5.5.6',
    'X-Requested-With': 'XMLHttpRequest',
    'X-Agent-Intent': 'craft',
    'X-Agent-Purpose': 'conversation',
    // 国际版专属；国内版带不带都能过，但不发更贴近原客户端
    ...(isInternational ? { 'X-Agent-Type': 'main' } : {})
  }
}

function serverPollOAuth(endpoint: string, platform: string): BuiltinProviderPreset['oauthConfig'] {
  return {
    flowType: 'server_poll',
    stateUrl: `${endpoint}/v2/plugin/auth/state`,
    platform,
    // 参考实现把 X-No-* 四个抑制头只发在 state 请求上
    stateRequestHeaders: {
      'X-No-Authorization': 'true',
      'X-No-User-Id': 'true',
      'X-No-Enterprise-Id': 'true',
      'X-No-Department-Info': 'true'
    },
    tokenUrl: `${endpoint}/v2/plugin/auth/token`,
    accountUrl: `${endpoint}/v2/plugin/login/account`,
    accountsUrl: `${endpoint}/v2/plugin/accounts`,
    refreshUrl: `${endpoint}/v2/plugin/auth/token/refresh`,
    pollIntervalMs: 1_000,
    pollTimeoutMs: 300_000,
    // 登录页要求追加 ?version=2.0.0&loginSessionId=<32 hex>（后一个由流程生成）
    extraParams: { version: '2.0.0' },
    useSystemProxy: true
  }
}

/** 国内版：WorkBuddy（CodeBuddy 套餐）。 */
export const workbuddyPreset: BuiltinProviderPreset = {
  builtinId: 'workbuddy',
  version: 1,
  name: 'WorkBuddy',
  type: 'openai-chat',
  defaultBaseUrl: 'https://copilot.tencent.com/v2',
  homepage: 'https://copilot.tencent.com',
  requiresApiKey: false,
  authMode: 'oauth',
  defaultModel: 'auto',
  useSystemProxy: true,
  // 缺它报 10085；config 拉取用 CLI 前缀的 UA，chat 用这个
  userAgent: 'WorkBuddy/5.5.6',
  oauthConfig: serverPollOAuth('https://copilot.tencent.com', 'workbuddy'),
  requestOverrides: { headers: staticHeaders(false) },
  ui: { hideOAuthSettings: true },
  defaultModels: toModels(CN_MODELS, () => true)
}

/** 国际版：WorkBuddy AI。 */
export const workbuddyAiPreset: BuiltinProviderPreset = {
  builtinId: 'workbuddy-ai',
  version: 1,
  name: 'WorkBuddy AI',
  type: 'openai-chat',
  defaultBaseUrl: 'https://www.workbuddy.ai/v2',
  homepage: 'https://www.workbuddy.ai',
  requiresApiKey: false,
  authMode: 'oauth',
  defaultModel: 'default-model',
  useSystemProxy: true,
  userAgent: 'WorkBuddy/5.5.6',
  oauthConfig: serverPollOAuth('https://www.workbuddy.ai', 'workbuddy-ai'),
  requestOverrides: { headers: staticHeaders(true) },
  ui: { hideOAuthSettings: true },
  // 国际版 GLM 系丢图（服务端过滤），按纯文本标，其余按 config 给 true
  defaultModels: toModels(AI_MODELS, (id) => !/^glm-/.test(id))
}
