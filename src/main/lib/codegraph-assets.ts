import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import grammarManifest from '../../shared/codegraph-grammars.json'
import { resolveDataPath } from './data-dir'
import { getNativeWorker, resolveNativeWorkerPath } from './native-worker'

// ---------------------------------------------------------------------------
// CodeGraph grammar assets (S-303: on-demand download, no longer bundled).
//
// The tree-sitter grammar libraries are ~42.5 MB of native code that most users
// never touch, so packaged builds stop shipping them. They live in the app data
// dir (`plugins/codegraph/bin/grammars`) and are fetched by the user from Settings.
//
// Resolution order: explicit env override > downloaded plugin dir > bundled dir
// (legacy installs — honoured so an in-place upgrade keeps working).
//
// ⚠️ 没有「dev 回落到 TreeSitter.DotNet NuGet 缓存」这一档了（2026-11-03 老大定）。
// 以前 `npm run dev` 会从 ~/.nuget/packages 直接读语法库，dev 永远显示「已就绪」，
// 而生产除非用户下载插件包就不可用 —— 两套行为，dev 上根本验不到「待下载 → 下载 →
// 移除」这条链路。现在 dev 与生产同一条路径：没下载就是没装。
//
// The worker loads its grammars from WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR (injected
// when the worker spawns); this module resolves that directory and reports status.
// ---------------------------------------------------------------------------

/** Plugin id shared with the renderer's app-plugin store and the IPC handlers. */
export const CODEGRAPH_PLUGIN_ID = 'codegraph'

/** Where downloaded plugin payloads live: `{dataDir}/plugins/codegraph`. */
export function resolveCodeGraphPluginDir(): string {
  return resolveDataPath('plugins', CODEGRAPH_PLUGIN_ID)
}

/**
 * Grammar libraries, inside the downloaded plugin payload (方案 B).
 *
 * 包结构固定为 `bin/codegraph.exe` + `bin/e_sqlite3.dll` + `bin/grammars/*.dll`，
 * grammars 必须挂在 `bin/` 下 —— 引擎的 CodeGraphNativeLibraryResolver.ProbeDirs()
 * 按 `{AppContext.BaseDirectory}/grammars` 查找，而 BaseDirectory 就是 `bin/`，
 * 所以不传环境变量也能命中。
 */
export function resolveCodeGraphPluginGrammarsDir(): string {
  return path.join(resolveCodeGraphPluginDir(), 'bin', 'grammars')
}

/** 引擎可执行文件：`{dataDir}/plugins/codegraph/bin/codegraph.exe`。 */
export function resolveCodeGraphEnginePath(): string {
  return path.join(
    resolveCodeGraphPluginDir(),
    'bin',
    process.platform === 'win32' ? 'codegraph.exe' : 'codegraph'
  )
}

const TREE_SITTER_LIB_RE = /^(?:lib)?(tree-sitter(?:-[a-z0-9-]+)?)\.(?:dylib|so|dll)$/i
const TREE_SITTER_CORE_LIBRARY = grammarManifest.runtime.library.toLowerCase()
const GRAMMAR_LANGUAGES = new Map(
  grammarManifest.grammars.map((grammar) => [
    grammar.library.toLowerCase(),
    grammar.languages.map((language) => language.id)
  ])
)

export type CodeGraphAssetDiagnostic =
  | 'ready'
  | 'worker-missing'
  | 'grammar-directory-missing'
  | 'core-library-missing'
  | 'language-grammars-missing'
  | 'incomplete-grammar-set'
  | 'invalid-grammar-files'

export interface CodeGraphAssetStatus {
  isDev: boolean
  workerReady: boolean
  workerRunning: boolean
  grammarsReady: boolean
  ready: boolean
  grammarsDir: string | null
  /** Native language grammar libraries, excluding the libtree-sitter runtime. */
  grammarCount: number
  /** Explicit replacement for the ambiguous legacy `ready` field. */
  runtimeReady: boolean
  coreLibraryReady: boolean
  availableGrammars: string[]
  missingGrammars: string[]
  availableLanguages: string[]
  missingLanguages: string[]
  unrecognizedGrammars: string[]
  invalidGrammarFiles: string[]
  grammarSource: 'override' | 'plugin' | 'bundled' | 'dev' | 'none'
  /** S-303: the user-downloaded grammar set is present and loadable. */
  pluginGrammarsReady: boolean
  /** Where downloads land — `{dataDir}/plugins/codegraph/bin/grammars`. */
  pluginGrammarsDir: string
  diagnostic: CodeGraphAssetDiagnostic
}

function isDevBuild(): boolean {
  return !app.isPackaged
}

// `resources/**` is unpacked by electron-builder, so resolving relative to the
// selected executable works in both the source tree and a packaged app.
function getBundledGrammarCandidates(): string[] {
  const workerPath = resolveNativeWorkerPath()
  if (!workerPath) return []
  const workerDir = path.dirname(workerPath)
  return [
    path.join(workerDir, 'codegraph-worker', 'grammars'),
    // Compatibility with packages produced before CodeGraph assets moved under
    // native-worker/codegraph-worker.
    path.join(workerDir, 'grammars')
  ]
}

function getBundledGrammarsDir(): string | null {
  const candidates = getBundledGrammarCandidates()
  return candidates.find((dir) => dirHasGrammars(dir)) ?? null
}

function directoryExists(dir: string | null | undefined): dir is string {
  if (!dir) return false
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function findGrammarDiagnosticDir(): string | null {
  const override = process.env.WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR?.trim()
  const candidates = [override, resolveCodeGraphPluginGrammarsDir(), ...getBundledGrammarCandidates()]
  return candidates.find(directoryExists) ?? null
}

function dirHasGrammars(dir: string | null | undefined): boolean {
  return inspectGrammarDir(dir).grammarLibraries.length > 0
}

interface GrammarDirectoryInspection {
  coreLibraryReady: boolean
  grammarLibraries: string[]
  invalidFiles: string[]
}

function inspectGrammarDir(dir: string | null | undefined): GrammarDirectoryInspection {
  const empty: GrammarDirectoryInspection = {
    coreLibraryReady: false,
    grammarLibraries: [],
    invalidFiles: []
  }
  if (!dir) return empty
  try {
    const grammarLibraries = new Set<string>()
    const invalidFiles: string[] = []
    let coreLibraryReady = false
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const match = TREE_SITTER_LIB_RE.exec(entry.name)
      if (!match) continue
      if (!entry.isFile()) {
        invalidFiles.push(entry.name)
        continue
      }
      let size = 0
      try {
        size = fs.statSync(path.join(dir, entry.name)).size
      } catch {
        invalidFiles.push(entry.name)
        continue
      }
      if (size <= 0) {
        invalidFiles.push(entry.name)
        continue
      }
      const library = match[1].toLowerCase()
      if (library === TREE_SITTER_CORE_LIBRARY) {
        coreLibraryReady = true
      } else {
        grammarLibraries.add(library)
      }
    }
    return {
      coreLibraryReady,
      grammarLibraries: [...grammarLibraries].sort(),
      invalidFiles: invalidFiles.sort()
    }
  } catch {
    return empty
  }
}

// The directory the worker should load grammars from. Priority:
//   1. explicit WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR override
//   2. grammars the user downloaded into the plugin data dir (S-303)
//   3. the RID-specific set bundled beside the worker (legacy installs)
//
// dev 构建走同一条路 —— 没有 NuGet 缓存兜底，没下载就是没装。
export function resolveCodeGraphGrammarsDir(): string | null {
  const override = process.env.WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR?.trim()
  if (override && dirHasGrammars(override)) return override

  const plugin = resolveCodeGraphPluginGrammarsDir()
  if (dirHasGrammars(plugin)) return plugin

  const bundled = getBundledGrammarsDir()
  if (bundled) return bundled

  return null
}

export function getCodeGraphAssetStatus(): CodeGraphAssetStatus {
  const isDev = isDevBuild()
  // Source-merged: CodeGraph ships inside the main worker binary.
  const workerReady = resolveNativeWorkerPath() != null
  // When no usable directory resolves, retain an existing candidate for precise
  // diagnostics (for example, a directory containing only a zero-byte runtime).
  const grammarsDir = resolveCodeGraphGrammarsDir() ?? findGrammarDiagnosticDir()
  const inspection = inspectGrammarDir(grammarsDir)
  const expectedGrammars = [...GRAMMAR_LANGUAGES.keys()].sort()
  const expectedGrammarSet = new Set(expectedGrammars)
  const availableGrammars = inspection.grammarLibraries.filter((grammar) =>
    expectedGrammarSet.has(grammar)
  )
  const unrecognizedGrammars = inspection.grammarLibraries.filter(
    (grammar) => !expectedGrammarSet.has(grammar)
  )
  const availableGrammarSet = new Set(availableGrammars)
  const missingGrammars = expectedGrammars.filter((grammar) => !availableGrammarSet.has(grammar))
  const availableLanguages = availableGrammars
    .flatMap((grammar) => GRAMMAR_LANGUAGES.get(grammar) ?? [])
    .sort()
  const missingLanguages = missingGrammars
    .flatMap((grammar) => GRAMMAR_LANGUAGES.get(grammar) ?? [])
    .sort()
  const grammarCount = availableGrammars.length
  const grammarsReady = inspection.coreLibraryReady && grammarCount > 0
  const runtimeReady = workerReady && grammarsReady
  const override = process.env.WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR?.trim()
  const grammarSource: CodeGraphAssetStatus['grammarSource'] = !grammarsDir
    ? 'none'
    : override === grammarsDir
      ? 'override'
      : grammarsDir === resolveCodeGraphPluginGrammarsDir()
        ? 'plugin'
        : getBundledGrammarCandidates().includes(grammarsDir)
          ? 'bundled'
          : 'dev'
  const diagnostic: CodeGraphAssetDiagnostic = !workerReady
    ? 'worker-missing'
    : !grammarsDir
      ? 'grammar-directory-missing'
      : !inspection.coreLibraryReady
        ? 'core-library-missing'
        : grammarCount === 0
          ? 'language-grammars-missing'
          : inspection.invalidFiles.length > 0 || unrecognizedGrammars.length > 0
            ? 'invalid-grammar-files'
            : missingGrammars.length > 0
              ? 'incomplete-grammar-set'
              : 'ready'
  return {
    isDev,
    workerReady,
    workerRunning: getNativeWorker().isRunning,
    grammarsReady,
    // `ready` is retained for existing renderers and external IPC consumers.
    ready: runtimeReady,
    grammarsDir,
    grammarCount,
    runtimeReady,
    coreLibraryReady: inspection.coreLibraryReady,
    availableGrammars,
    missingGrammars,
    availableLanguages,
    missingLanguages,
    unrecognizedGrammars,
    invalidGrammarFiles: inspection.invalidFiles,
    grammarSource,
    pluginGrammarsReady: dirHasGrammars(resolveCodeGraphPluginGrammarsDir()),
    pluginGrammarsDir: resolveCodeGraphPluginGrammarsDir(),
    diagnostic
  }
}
