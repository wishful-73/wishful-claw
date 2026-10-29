/*
 * S-243：录音采集的渲染端实现（麦克风 / 系统内录 / 两路混音）。
 *
 * 分工：这一层只做「采」，不做「懂」——不切语义、不转写、不做 VAD。
 * 重采样与声道下混交给 `AudioContext({ sampleRate, channelCount: 1 })`，浏览器
 * 自带；我们只把浮点样本转成 16-bit PCM 交给主进程落盘。
 *
 * 实测约束（v3-iter-4 第 0 刀）：Windows 上纯音频 `getDisplayMedia({ audio: true })`
 * 会抛 `AbortError: Invalid capture constraints`，必须带上 video 请求再把
 * video track 丢掉。这不是可选优化，是唯一能拿到 loopback 的方式。
 */

export type AudioSourceKind = 'mic' | 'system' | 'both'

export interface AudioRecorderOptions {
  source: AudioSourceKind
  /** 麦克风设备 id（`enumerateDevices()` 的 deviceId）；省略用系统默认。 */
  deviceId?: string
  /** 每段时长，缺省 30 s。 */
  segmentSeconds?: number
  /** 音量电平（0~1 RMS），每 ~100 ms 一次。 */
  onLevel?: (level: number) => void
  /** 每落满一段回调一次（主进程也会推 `plugin-audio:segment`）。 */
  onSegment?: (filePath: string) => void
}

export interface AudioRecorderHandle {
  sessionId: string
  /** 停止并返回本次会话落出的全部 wav。 */
  stop: () => Promise<string[]>
}

const TARGET_SAMPLE_RATE = 16_000
const TARGET_CHANNELS = 1
const PROCESSOR_BUFFER = 4_096

/** 浮点 [-1, 1] → 交错 16-bit PCM（小端）。 */
export function floatToPcm16(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < input.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, input[i]))
    view.setInt16(i * 2, Math.round(clamped * 0x7fff), true)
  }
  return out
}

/** 单块 RMS，给电平条用。 */
export function rmsOf(input: Float32Array): number {
  if (input.length === 0) return 0
  let sum = 0
  for (let i = 0; i < input.length; i += 1) sum += input[i] * input[i]
  return Math.sqrt(sum / input.length)
}

async function openStream(options: AudioRecorderOptions): Promise<MediaStream> {
  if (options.source === 'mic') {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
        channelCount: TARGET_CHANNELS,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    })
  }

  if (options.source === 'system') {
    // 必须带 video（见文件头）；拿到后立刻丢掉 video track —— 我们只关心声音，
    // 留着它会让画面被持续抓取，白烧 GPU。
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    for (const track of stream.getVideoTracks()) {
      track.stop()
      stream.removeTrack(track)
    }
    return stream
  }

  // both：两路各自采，混音由 WebAudio 图完成（基座不区分说话人，区分靠插件事后分割）。
  const [mic, system] = await Promise.all([
    openStream({ ...options, source: 'mic' }),
    openStream({ ...options, source: 'system' })
  ])
  const merged = new MediaStream()
  for (const track of [...mic.getAudioTracks(), ...system.getAudioTracks()]) merged.addTrack(track)
  return merged
}

/**
 * 开始录音。返回句柄；`stop()` 之后所有轨道与 AudioContext 都会关闭。
 *
 * 采集链：MediaStream → MediaStreamAudioSourceNode → （可选混音）→ AudioContext
 * 输出到 ScriptProcessorNode → floatToPcm16 → `api.audio.append`。
 */
export async function startAudioRecording(
  options: AudioRecorderOptions
): Promise<AudioRecorderHandle> {
  const stream = await openStream(options)
  const audioContext = new AudioContext({
    sampleRate: TARGET_SAMPLE_RATE,
    latencyHint: 'interactive'
  })

  const session = await window.api.audio.start({
    format: { sampleRate: TARGET_SAMPLE_RATE, channels: TARGET_CHANNELS },
    segmentSeconds: options.segmentSeconds
  })

  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(PROCESSOR_BUFFER, TARGET_CHANNELS, TARGET_CHANNELS)
  let writeChain: Promise<unknown> = Promise.resolve()

  processor.onaudioprocess = (event): void => {
    const channel = event.inputBuffer.getChannelData(0)
    if (options.onLevel) options.onLevel(rmsOf(channel))
    const pcm = floatToPcm16(channel)
    // 串行化写入：IPC 是异步的，乱序 append 会让音频前后颠倒。
    writeChain = writeChain
      .then(() => window.api.audio.append(session.sessionId, pcm))
      .then((result) => {
        for (const path of result.segments) options.onSegment?.(path)
      })
      .catch(() => {
        // 主进程写盘失败不该炸掉录音图；下一次 append 会重建这条链。
      })
  }

  source.connect(processor)
  // ScriptProcessorNode 必须接到 destination 才会出 onaudioprocess（不接则静默），
  // 但它输出的是我们自己的混合结果 —— 用 0 增益避免把麦克风原声从扬声器放出来。
  const mute = audioContext.createGain()
  mute.gain.value = 0
  processor.connect(mute)
  mute.connect(audioContext.destination)

  let stopped = false

  return {
    sessionId: session.sessionId,
    stop: async (): Promise<string[]> => {
      if (stopped) return []
      stopped = true
      processor.onaudioprocess = null
      try {
        source.disconnect()
        processor.disconnect()
        mute.disconnect()
      } catch {
        // 图已经拆过一遍，忽略
      }
      for (const track of stream.getTracks()) track.stop()
      await writeChain.catch(() => undefined)
      await audioContext.close().catch(() => undefined)
      const result = await window.api.audio.stop(session.sessionId)
      return result.wavPaths
    }
  }
}
