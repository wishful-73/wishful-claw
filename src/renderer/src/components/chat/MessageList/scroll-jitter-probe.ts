/**
 * S-233 抖动诊断探针 —— **仅 DEV 构建生效，生产包里 `import.meta.env.DEV` 为假，整段被 tree-shake 掉。**
 *
 * 为什么要有它：S-233 的三条硬判据把范围收到了「小幅（几像素）+ 静置无输出 + 一滚即停」，
 * 而静态穷举下来跟随分支里**没有任何写点能产生几像素的位移** —— 最小的一个也是 216px
 * （提前量补位 `gapTarget(240) - REFILL_AT(24)`）。所以剩下的两个量必须实测才看得见：
 *
 *   1. `scrollTop` 到底有没有被小幅改写（有 ⇒ 另有写入点；没有 ⇒ 是布局在动）
 *   2. `content.style.minHeight` / `scrollHeight` 有没有在静置时变化
 *      （有 ⇒ 水位线在动，即 `applyMinHeight` 被别人反复调到）
 *
 * 观测方式：定时采样上面这几个量 + 实测内容底 + 尾部是否挂载，环形缓冲最近若干帧。
 * 一旦发现「小幅往复」（同一量在 1~40px 之间来回变 ≥3 次），就把整段缓冲按行落日志，
 * 一行一帧，事后直接从磁盘读，**用户不需要做任何操作、不需要开控制台**。
 *
 * 纪律：探针只读，不写 DOM、不改滚动、不 setState。采样失败一律静默放弃。
 */

export interface ScrollJitterSample {
  /** performance.now() 取整 */
  t: number
  /** listRef.scrollTop */
  st: number
  /** listRef.scrollHeight */
  sh: number
  /** listRef.clientHeight */
  ch: number
  /** content 的 inline min-height（'none' 表示空串） */
  mh: string
  /** 实测内容底（getRealContentBottom 同源） */
  rb: number
  /** 尾部行是否挂载 */
  tail: boolean
  /** 虚拟行总数 */
  rows: number
  /** 是否处于「会话输出中」 */
  out: boolean
}

type SampleReader = () => ScrollJitterSample | null

/** 小幅变动的认定区间（px）：小于 1 是阈值内噪声，大于 40 就是正常的大位移。 */
const SMALL_DELTA_MIN = 1
const SMALL_DELTA_MAX = 40
/** 采样间隔：100ms 足够看清往复，又不会自己造成 reflow 压力。 */
const SAMPLE_INTERVAL_MS = 100
/** 环形缓冲帧数：30 帧 ≈ 3 秒，够看出一个往复周期。 */
const BUFFER_SIZE = 30
/** 判定抖动：1 秒内出现这么多次「小幅变动」。 */
const JITTER_HIT_THRESHOLD = 3
const JITTER_WINDOW_MS = 1000
/** 同一个会话里最多报几次，防日志爆掉。 */
const MAX_REPORTS = 3
/** 静置心跳间隔：只在 out=true（等模型响应）时记，覆盖目标场景。 */
const HEARTBEAT_MS = 5000

function delta(prev: number, next: number): number {
  return Math.abs(next - prev)
}

function isSmallChange(prev: number, next: number): boolean {
  const d = delta(prev, next)
  return d >= SMALL_DELTA_MIN && d <= SMALL_DELTA_MAX
}

function formatSample(s: ScrollJitterSample): string {
  return `t=${s.t} st=${s.st.toFixed(1)} sh=${s.sh} ch=${s.ch} mh=${s.mh || '-'} rb=${s.rb.toFixed(1)} tail=${s.tail ? 1 : 0} rows=${s.rows} out=${s.out ? 1 : 0}`
}

function emit(message: string): void {
  try {
    void window.api?.log({ level: 'info', message })
  } catch {
    // 日志通道不可用就算了，探针不能影响功能。
  }
}

/**
 * 启动探针，返回停止函数。调用方负责在 DEV 之外不调用它。
 */
export function startScrollJitterProbe(read: SampleReader): () => void {
  const buffer: ScrollJitterSample[] = []
  let prev: ScrollJitterSample | null = null
  let hits: number[] = []
  let reports = 0
  let lastHeartbeat = 0
  let stopped = false

  emit('[S-233 probe] armed')

  // 挂载即采一帧：字段名与量纲当场可验，不用等心跳（心跳要 out=true 且 5 秒才出）。
  try {
    const first = read()
    if (first) emit(`[S-233 probe] baseline ${formatSample(first)}`)
  } catch {
    emit('[S-233 probe] baseline <read threw>')
  }

  const timer = window.setInterval(() => {
    if (stopped) return
    // 采样本身绝不能让定时器崩掉：read 里碰的是 DOM 与 ref，任何一处为空都可能抛。
    let sample: ScrollJitterSample | null = null
    try {
      sample = read()
    } catch {
      prev = null
      return
    }
    if (!sample) {
      prev = null
      return
    }

    buffer.push(sample)
    if (buffer.length > BUFFER_SIZE) buffer.shift()

    if (prev) {
      // 三个可能「抖」的量分别看：滚动位置、滚动区总高、水位线。
      // 任一小幅变动都记一次命中；三者在同一帧变只算一次。
      const moved =
        isSmallChange(prev.st, sample.st) ||
        isSmallChange(prev.sh, sample.sh) ||
        isSmallChange(parseFloat(prev.mh || '0') || 0, parseFloat(sample.mh || '0') || 0)
      if (moved) {
        hits.push(sample.t)
        hits = hits.filter((h) => sample.t - h <= JITTER_WINDOW_MS)
      }
    }
    prev = sample

    if (hits.length >= JITTER_HIT_THRESHOLD && reports < MAX_REPORTS) {
      reports += 1
      hits = []
      emit(
        `[S-233 probe] JITTER #${reports} hits=${JITTER_HIT_THRESHOLD}+ window=${JITTER_WINDOW_MS}ms buffer=${buffer.length}`
      )
      for (const s of buffer) emit(`[S-233 probe]   ${formatSample(s)}`)
      buffer.length = 0
      return
    }

    // 静置心跳：只在等模型响应（out=true）时记，正是老大报症状的场景。
    if (sample.out && sample.t - lastHeartbeat >= HEARTBEAT_MS) {
      lastHeartbeat = sample.t
      emit(`[S-233 probe] idle ${formatSample(sample)}`)
    }
  }, SAMPLE_INTERVAL_MS)

  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}
