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
