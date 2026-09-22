/**
 * 消息朗读（iter-34 S-138）。
 *
 * 语音合成的调用点有两处 —— 助手消息操作条、用户消息操作条 —— 都走这里，
 * 免得「音色 / 语速 / 音调」的消费逻辑各写一份、日后不同步。
 */

export interface SpeechSettings {
  /** 选中的语音 `voiceURI`；空串 = 按文本语言自动挑一个。 */
  voice: string
  rate: number
  pitch: number
}

/** 含中日韩统一表意文字即按中文处理，否则按英文 —— 也决定「自动」时挑哪个音色。 */
function detectLang(text: string): string {
  return /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US'
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * 当前在念的那条。用来判断「结束回调是不是这条的」—— `cancel()` 也会把上一条
 * 的 `end` 事件打出来，不守住就会把刚开的那次误判成念完了。
 */
let current: SpeechSynthesisUtterance | null = null

/** 掐掉正在念的内容。没有待念内容时是空操作。 */
export function stopSpeaking(): void {
  if (!isSpeechSupported()) return
  current = null
  window.speechSynthesis.cancel()
}

/**
 * 朗读一段文本。选中的音色找不到（已卸载 / 换了机器）时退回按语言匹配；
 * 再没有就交给系统默认，不报错。
 *
 * `onEnd` 在这段念完（或出错）时触发一次 —— 试听按钮用它复位播放状态；
 * 消息朗读不关心，不传即可。
 */
export function speakMessage(
  text: string,
  settings: SpeechSettings,
  onEnd?: () => void
): void {
  if (!isSpeechSupported()) return

  const synth = window.speechSynthesis
  const lang = detectLang(text)
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang

  const voices = synth.getVoices()
  const preferred = settings.voice
    ? voices.find((voice) => voice.voiceURI === settings.voice)
    : undefined
  const byLang = voices.find((voice) =>
    voice.lang.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase())
  )
  const picked = preferred ?? byLang
  if (picked) utterance.voice = picked

  utterance.rate = settings.rate
  utterance.pitch = settings.pitch

  // 先认领再掐旧的：`cancel()` 带回的旧条 `end` 因此会被守卫挡掉。
  current = utterance
  if (onEnd) {
    const settle = (): void => {
      if (current !== utterance) return
      current = null
      onEnd()
    }
    utterance.onend = settle
    utterance.onerror = settle
  }

  // 连点朗读时先掐掉上一条，免得两条叠着念。
  synth.cancel()
  synth.speak(utterance)
}
