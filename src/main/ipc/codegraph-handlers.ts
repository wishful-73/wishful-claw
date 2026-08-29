import { ipcMain } from 'electron'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { getCodeGraphAssetStatus } from '../lib/codegraph-assets'
import { getNativeWorker } from '../lib/native-worker'
import { readPersistedSettings } from '../lib/settings-store'
import { safeSendMessagePackToAllWindows } from '../window-ipc'

// Channel names mirror IPC.CODEGRAPH_* in src/renderer/src/lib/ipc/channels.ts.
const ASSET_STATUS = 'codegraph:asset-status'
// Live index/sync progress streamed from the CodeGraph worker (fan-out to all
// windows). The worker already emits codegraph/index-progress + index-complete
// with a stable indexId; we just relay them so the settings panel can render a
// real progress bar instead of an opaque busy state.
const INDEX_PROGRESS = 'codegraph:index-progress'

// Persisted app-plugin store key (zustand persist name in app-plugin-store.ts).
const APP_PLUGIN_STORAGE_KEY = 'wishfulclaw-app-plugins'
const CODEGRAPH_PLUGIN_ID = 'codegraph'

let indexProgressForwardingRegistered = false

function broadcast(channel: string, payload: unknown): void {
  // postMessage-based fan-out: webContents.send() can raise an uncatchable
  // async error when the target render frame is mid-disposal (Electron 35+).
  safeSendMessagePackToAllWindows(channel, payload)
}

// Subscribe once to the worker's index progress/complete events and relay them to
// the renderer. onEvent registers on the manager's persistent emitter (survives
// worker respawns) and does not force a spawn, so this is safe at startup.
function registerIndexProgressForwarding(): void {
  if (indexProgressForwardingRegistered) return
  indexProgressForwardingRegistered = true
  const worker = getNativeWorker()
  worker.onEvent('codegraph/index-progress', (params) => {
    broadcast(INDEX_PROGRESS, params)
  })
  worker.onEvent('codegraph/index-complete', (params) => {
    broadcast(INDEX_PROGRESS, { ...(params as Record<string, unknown>), done: true })
  })
}

export function registerCodeGraphHandlers(): void {
  registerIndexProgressForwarding()
  ipcMain.handle(ASSET_STATUS, () => getCodeGraphAssetStatus())
}

// ── Reverse-request surface (agent → main → worker) ──

// The CodeGraph tool result is consumed verbatim by the agent; WorkerResponse
// errors RESOLVE on the worker side, so disabled/unavailable states are
// success-shaped (not_indexed) rather than thrown.
function codeGraphNotReadyResult(message: string): {
  success: true
  isError: false
  errorKind: 'not_indexed'
  message: string
} {
  return { success: true, isError: false, errorKind: 'not_indexed', message }
}

// Enabled when any project's CodeGraph plugin instance is enabled
// (per-project gating would need the working folder mapping; the coarse check
// matches the tool-registration surface in the renderer).
function readCodeGraphEnabled(): boolean {
  try {
    const persisted = readPersistedSettings(APP_PLUGIN_STORAGE_KEY) as {
      state?: {
        pluginsByProject?: Record<string, Array<{ id?: string; enabled?: boolean }>>
      }
    } | null
    const byProject = persisted?.state?.pluginsByProject
    if (!byProject) return false
    for (const list of Object.values(byProject)) {
      if (
        Array.isArray(list) &&
        list.some((plugin) => plugin?.id === CODEGRAPH_PLUGIN_ID && plugin.enabled === true)
      ) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

/**
 * Handle the `codegraph:tool` reverse request from the agent runtime.
 * Mirrors OpenCowork's host-reverse-requests case: `codegraph_<action>` maps to
 * the worker method `codegraph/<action>` with the session's workingFolder
 * injected when the tool input doesn't pin a project of its own.
 */
export async function handleCodeGraphTool(params: Record<string, unknown>): Promise<unknown> {
  const toolName = typeof params.name === 'string' ? params.name : ''
  if (!toolName.startsWith('codegraph_')) {
    return codeGraphNotReadyResult(`Unknown CodeGraph tool: ${toolName || '(missing)'}`)
  }
  if (!readCodeGraphEnabled()) {
    return codeGraphNotReadyResult(
      'CodeGraph is disabled. Enable it in Settings to index this project for code navigation.'
    )
  }
  const method = `codegraph/${toolName.slice('codegraph_'.length)}`
  const input =
    params.input && typeof params.input === 'object'
      ? { ...(params.input as Record<string, unknown>) }
      : {}
  const workingFolder = typeof params.workingFolder === 'string' ? params.workingFolder : undefined
  if (
    workingFolder &&
    input.projectPath === undefined &&
    input.workingFolder === undefined
  ) {
    input.workingFolder = workingFolder
  }
  // Route the graph DB to the project-local .wishful-claw/codegraph when the root is
  // a writable local folder (SSH/remote roots fall back to the centralized home).
  const dataRoot = resolveCodeGraphDataRoot(
    typeof input.workingFolder === 'string'
      ? input.workingFolder
      : typeof input.projectPath === 'string'
        ? input.projectPath
        : undefined,
    input.dataRoot
  )
  if (dataRoot) {
    input.dataRoot = dataRoot
  }
  try {
    return await getNativeWorker().request(method, input, 120_000)
  } catch (error) {
    return codeGraphNotReadyResult(
      `CodeGraph is unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Resolve the per-project graph-DB data dir for a working folder.
 * Local writable folder -> `{wf}/.wishful-claw/codegraph` (project-local storage,
 * same scope as memory/persona). SSH or unwritable roots -> explicit override when
 * provided (e.g. `~/.wishful-claw/projects/{projectId}/codegraph`), else undefined
 * so the worker keeps its centralized default.
 */
export function resolveCodeGraphDataRoot(
  workingFolder: string | undefined,
  explicitOverride?: unknown
): string | undefined {
  const overridden =
    typeof explicitOverride === 'string' && explicitOverride.trim()
      ? explicitOverride.trim()
      : undefined
  if (overridden) return overridden
  if (!workingFolder) return undefined
  try {
    const dataRoot = join(workingFolder, '.wishful-claw', 'codegraph')
    // Writable check: the root must exist as a directory. Creating
    // .wishful-claw/codegraph happens lazily on the worker side at DB open.
    if (!existsSync(workingFolder) || !statSync(workingFolder).isDirectory()) {
      return undefined
    }
    return dataRoot
  } catch {
    return undefined
  }
}
