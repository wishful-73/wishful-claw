import type {
  AIModelConfig,
} from '../api/types'

export interface CompressionConfig {
  enabled: boolean
  /** Model's max context token count. */
  contextLength: number
  /** Full compression trigger threshold, clamped to 0.3 ~ 0.9. */
  threshold: number
  /** Optional pre-compression trigger threshold before buffer adjustments. */
  preCompressThreshold?: number
  /** Tokens reserved for summary/output headroom before trigger calculations. */
  reservedOutputBudget?: number
}

export type CompressionStatus = 'compressed' | 'skipped' | 'failed' | 'blocked' | 'cancelled'

export interface CompressionResult {
  compressed: boolean
  originalCount: number
  newCount: number
  messagesSummarized?: number
  error?: string
  status?: CompressionStatus
  /** Machine-readable blocker, e.g. 'restore_failed' when the Worker could not rebuild the session. */
  reason?: string
  trigger?: 'auto' | 'manual'
  summarizerFailed?: boolean
  /** Worker-side token estimate of the conversation before compression. */
  estimatedPreTokens?: number
  /** Worker-side token estimate of the compressed conversation. */
  estimatedNewTokens?: number
}

export const DEFAULT_CONTEXT_COMPRESSION_LIMIT = 200_000
export const DEFAULT_CONTEXT_COMPRESSION_THRESHOLD = 0.8
export const MIN_CONTEXT_COMPRESSION_THRESHOLD = 0.3
export const MAX_CONTEXT_COMPRESSION_THRESHOLD = 0.9
export const DEFAULT_CONTEXT_COMPRESSION_RESERVED_OUTPUT_TOKENS = 20_000
export const CONTEXT_COMPRESSION_AUTO_BUFFER_TOKENS = 13_000
export const CONTEXT_COMPRESSION_PRE_BUFFER_TOKENS = 20_000
export const CONTEXT_COMPRESSION_PRE_GAP_TOKENS = 8_000

/**
 * 会话级「请求上下文上限」（iter-32 S-73，S-84 改成可拖动数值）的滑杆下限，200K。
 * 没有固定上限 —— 上限由当前模型的窗口决定，见 resolveSessionContextCapRange。
 *
 * ★ 十进制，不是 200 * 1024。模型档案里的 contextLength 写的就是 200_000 / 1_000_000
 * （见 stores/providers/*.ts），formatTokens 也是按 /1000 显示。用二进制会在界面上
 * 显示成「205k」—— 用户拖到最左看到 205k，跟他要的 200K 对不上。
 */
export const MIN_SESSION_CONTEXT_CAP_TOKENS = 200_000
/** 滑杆步长，4K（同样十进制，拖出来的值都是整千）。 */
export const CONTEXT_CAP_STEP_TOKENS = 4_000

const DEFAULT_PRECOMPRESS_THRESHOLD = 0.65
export const LEGACY_SUMMARY_PREFIXES = [
  '[Context Memory Compressed Summary]',
  '[Context Memory Compressed Summary]',
  '[Context Memory Compressed Summary'
]

export function resetCompressionFailures(): void {
  // Native worker owns the summarizer circuit breaker.
}

export function clampCompressionThreshold(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_CONTEXT_COMPRESSION_THRESHOLD
  }
  return Math.min(
    MAX_CONTEXT_COMPRESSION_THRESHOLD,
    Math.max(MIN_CONTEXT_COMPRESSION_THRESHOLD, value)
  )
}

export function resolveCompressionThreshold(globalThreshold?: number | null): number {
  return clampCompressionThreshold(globalThreshold)
}

/** 会话级压缩阈值（iter-32 S-85）滑条的步长，5%。 */
export const SESSION_COMPRESSION_THRESHOLD_STEP = 0.05

/**
 * 把界面/存储传来的会话级阈值收进合法区间；落在区间外（含 0、NaN）一律返回 0。
 *
 * 0 是这里的**哨兵值**，表示「跟随全局设置」—— 与 `Session.compressionThreshold` 的
 * 存储约定一致。所以这个函数不能像 `clampCompressionThreshold` 那样把非法值夹到边界：
 * 越界必须回落成「没设」，否则用户永远退不回跟随全局。
 */
export function clampSessionCompressionThreshold(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return value >= MIN_CONTEXT_COMPRESSION_THRESHOLD && value <= MAX_CONTEXT_COMPRESSION_THRESHOLD
    ? value
    : 0
}

/**
 * 会话实际生效的压缩阈值：会话设过就用会话的，否则用全局的。
 *
 * 发送时由 `chat-store` 的 `sendMessage` 盖章进 `contextCompressionThreshold` run param，
 * 这样 Worker 侧一行都不用改 —— 它本来就只读这一个参数。
 */
export function resolveSessionCompressionThreshold(
  sessionThreshold?: number | null,
  globalThreshold?: number | null
): number {
  const session = clampSessionCompressionThreshold(sessionThreshold)
  return session > 0 ? session : clampCompressionThreshold(globalThreshold)
}

export function resolveCompressionContextLength(
  modelConfig?: Pick<AIModelConfig, 'contextLength' | 'enableExtendedContextCompression'> | null
): number {
  const configuredContextLength =
    typeof modelConfig?.contextLength === 'number' && modelConfig.contextLength > 0
      ? modelConfig.contextLength
      : DEFAULT_CONTEXT_COMPRESSION_LIMIT

  if (configuredContextLength <= DEFAULT_CONTEXT_COMPRESSION_LIMIT) {
    return configuredContextLength
  }

  if (modelConfig?.enableExtendedContextCompression === false) {
    return DEFAULT_CONTEXT_COMPRESSION_LIMIT
  }

  return configuredContextLength
}

/**
 * 会话存的「请求上下文上限」是否还适用于当前模型。
 *
 * 老大口径（S-84）：「切换模型时，这个值改成模型的最大上下文，需要重新设置」——
 * 所以上限记住它是**在哪个模型上设的**，模型换了就不再生效（返回 0 = 不限制），
 * 用户得重新拖一次。0 同时表示「从没设过」。
 */
export function resolveSessionContextCapTokens(input: {
  capTokens?: number | null
  capModelId?: string | null
  currentModelId?: string | null
}): number {
  const { capTokens, capModelId, currentModelId } = input
  if (typeof capTokens !== 'number' || !Number.isFinite(capTokens) || capTokens <= 0) return 0
  if (!capModelId || !currentModelId || capModelId !== currentModelId) return 0
  return Math.floor(capTokens)
}

/**
 * 会话实际生效的「请求上下文上限」（iter-34 S-107）。
 *
 * 优先级与会话级压缩阈值完全同构：会话设过（且仍适用于当前模型）就用会话的，
 * 否则落到全局设置；全局也是 0 就返回 0 = 不限制。
 *
 * 这个函数是上限的**唯一出口** —— `chat-store` 的 `sendMessage` 盖章与
 * `context-ring` 的展示都走它，免得两边各算一遍再慢慢漂移。
 */
export function resolveEffectiveContextCapTokens(input: {
  sessionCapTokens?: number | null
  sessionCapModelId?: string | null
  currentModelId?: string | null
  globalCapTokens?: number | null
}): number {
  const sessionCap = resolveSessionContextCapTokens({
    capTokens: input.sessionCapTokens,
    capModelId: input.sessionCapModelId,
    currentModelId: input.currentModelId
  })
  if (sessionCap > 0) return sessionCap

  const globalCap = input.globalCapTokens
  if (typeof globalCap !== 'number' || !Number.isFinite(globalCap) || globalCap <= 0) return 0
  return Math.floor(globalCap)
}

/**
 * 滑杆量程：下限固定 200K，上限是当前模型的窗口。
 * 模型窗口本身不超过下限时返回 null —— 这种模型没什么可压的，控件不渲染。
 */
export function resolveSessionContextCapRange(
  contextLength: number
): { min: number; max: number; step: number } | null {
  if (!Number.isFinite(contextLength) || contextLength <= MIN_SESSION_CONTEXT_CAP_TOKENS) return null
  return {
    min: MIN_SESSION_CONTEXT_CAP_TOKENS,
    max: Math.floor(contextLength),
    step: CONTEXT_CAP_STEP_TOKENS
  }
}

/**
 * 套用会话级「请求上下文上限」：capTokens <= 0（未设 / 模型已换）时原样返回。
 * 模型档案里存的 contextLength 不动，只影响运行期展示与触发计算。
 */
export function applySessionContextCap(
  contextLength: number,
  capTokens?: number | null
): number {
  if (typeof capTokens !== 'number' || !Number.isFinite(capTokens) || capTokens <= 0) {
    return contextLength
  }
  if (contextLength <= 0) return contextLength
  return Math.min(contextLength, capTokens)
}

export function resolveCompressionReservedOutputBudget(
  modelConfig?: Pick<AIModelConfig, 'maxOutputTokens'> | null
): number {
  const maxOutputTokens =
    typeof modelConfig?.maxOutputTokens === 'number' && modelConfig.maxOutputTokens > 0
      ? Math.floor(modelConfig.maxOutputTokens)
      : DEFAULT_CONTEXT_COMPRESSION_RESERVED_OUTPUT_TOKENS
  return Math.min(DEFAULT_CONTEXT_COMPRESSION_RESERVED_OUTPUT_TOKENS, maxOutputTokens)
}

export function getEffectiveContextWindow(config: CompressionConfig): number {
  if (config.contextLength <= 0) return 0
  const reserved = Math.max(
    0,
    config.reservedOutputBudget ?? DEFAULT_CONTEXT_COMPRESSION_RESERVED_OUTPUT_TOKENS
  )
  return Math.max(1, config.contextLength - reserved)
}

export function getCompressionTriggerTokens(config: CompressionConfig): number {
  const effectiveWindow = getEffectiveContextWindow(config)
  if (effectiveWindow <= 0) return 0
  const ratioThreshold = Math.floor(effectiveWindow * config.threshold)
  const bufferedThreshold = effectiveWindow - CONTEXT_COMPRESSION_AUTO_BUFFER_TOKENS
  return Math.max(
    1,
    Math.min(ratioThreshold, bufferedThreshold > 0 ? bufferedThreshold : ratioThreshold)
  )
}

export function getPreCompressionTriggerTokens(config: CompressionConfig): number {
  const effectiveWindow = getEffectiveContextWindow(config)
  if (effectiveWindow <= 0) return 0

  const preThreshold = config.preCompressThreshold ?? DEFAULT_PRECOMPRESS_THRESHOLD
  const ratioThreshold = Math.floor(effectiveWindow * preThreshold)
  const fullThreshold = getCompressionTriggerTokens(config)
  const candidates = [ratioThreshold]
  const bufferedThreshold = effectiveWindow - CONTEXT_COMPRESSION_PRE_BUFFER_TOKENS
  if (bufferedThreshold > 0) candidates.push(bufferedThreshold)
  const gapThreshold = fullThreshold - CONTEXT_COMPRESSION_PRE_GAP_TOKENS
  if (gapThreshold > 0) candidates.push(gapThreshold)
  const threshold = Math.min(...candidates)
  return Math.max(1, Math.min(threshold, Math.max(1, fullThreshold - 1)))
}

export function shouldCompress(inputTokens: number, config: CompressionConfig): boolean {
  if (!config.enabled || config.contextLength <= 0) return false
  // The native worker owns summarizer failure handling and falls back to local
  // truncation when needed, so the renderer should keep triggering above the
  // token threshold to guarantee the context stays bounded.
  return inputTokens >= getCompressionTriggerTokens(config)
}

export function shouldPreCompress(inputTokens: number, config: CompressionConfig): boolean {
  void inputTokens
  void config
  void getPreCompressionTriggerTokens
  return false
}

