import type { BrowserUserDataSource } from '../../../../../shared/browser-plugin'

export interface CgAssetStatus {
  available: boolean
  downloaded?: boolean
  path?: string | null
  version?: string | null
  error?: string | null
  runtimeReady?: boolean
  ready?: boolean
  workerRunning?: boolean
  workerReady?: boolean
  grammarsDir?: string | null
  isDev?: boolean
  grammarsReady?: boolean
  grammarCount?: number
  availableLanguages: string[]
  invalidGrammarFiles: string[]
  unrecognizedGrammars: string[]
  missingLanguages: string[]
  grammarSource?: string | null
  /** S-303: 用户下载的语言包已就位（与随包的 bundled 区分开）。 */
  pluginGrammarsReady?: boolean
  /** S-303: 下载落点 —— `{dataDir}/plugins/codegraph/grammars`。 */
  pluginGrammarsDir?: string
  /**
   * 主进程此刻正在装这个插件。
   *
   * 进度状态不能只活在组件里：切到别的插件再切回来，组件是重新挂载的，本地 state 全丢，
   * 界面就会退回「下载代码图谱」，而主进程其实还在下（2026-11-03 老大真机报的）。
   */
  installing?: boolean
  diagnostic?: string | null
}

export interface BrowserEmulationStatus {
  reuseEnabled: boolean
  browserUserDataSource: BrowserUserDataSource
  browserName: string | null
  browserProfilePath: string | null
  browserProfileDisplayName: string | null
  usingDetectedBrowserProfile: boolean
  userAgent: string
  acceptLanguages: string
  browserSessionStoragePath: string | null
}
