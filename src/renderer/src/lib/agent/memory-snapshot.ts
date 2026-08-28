import { IPC } from '@renderer/lib/ipc/channels'
import type { IPCClient } from '@renderer/lib/tools/tool-types'
import { GlobalMemorySnapshot, LayeredMemorySnapshot, SessionMemoryScope, joinFsPath, layeredMemoryListeners, loadDailyMemoryEntries, loadOptionalMemoryFile, loadProjectDailyMemoryEntries, normalizeWatchPath, resolveProjectMemoryTextFile, snapshotsEqual, toOptionalEntry, _memState } from './memory-files'


export function getLayeredMemorySnapshot(): LayeredMemorySnapshot {
  return _memState.cachedLayeredSnapshot
}

export function getGlobalMemorySnapshot(): GlobalMemorySnapshot {
  return {
    path: _memState.cachedLayeredSnapshot.globalMemory?.path,
    content: _memState.cachedLayeredSnapshot.globalMemory?.content,
    version: _memState.cachedLayeredSnapshot.version,
    updatedAt: _memState.cachedLayeredSnapshot.updatedAt
  }
}

export function subscribeLayeredMemoryUpdates(
  listener: (snapshot: LayeredMemorySnapshot) => void
): () => void {
  layeredMemoryListeners.add(listener)
  return () => {
    layeredMemoryListeners.delete(listener)
  }
}

export function subscribeGlobalMemoryUpdates(
  listener: (snapshot: GlobalMemorySnapshot) => void
): () => void {
  return subscribeLayeredMemoryUpdates((snapshot) => {
    listener({
      path: snapshot.globalMemory?.path,
      content: snapshot.globalMemory?.content,
      version: snapshot.version,
      updatedAt: snapshot.updatedAt
    })
  })
}

async function invokeStringIpc(ipc: IPCClient, channel: string): Promise<string | undefined> {
  try {
    const result = await ipc.invoke(channel)
    return typeof result === 'string' && result.trim() ? result.trim() : undefined
  } catch {
    return undefined
  }
}

function getRendererEnvHomeDir(): string | undefined {
  if (typeof window === 'undefined') return undefined

  const env = window.electron?.process?.env
  const homeDir = env?.HOME || env?.USERPROFILE
  if (homeDir?.trim()) return homeDir.trim()

  const homeDrive = env?.HOMEDRIVE?.trim()
  const homePath = env?.HOMEPATH?.trim()
  return homeDrive && homePath ? `${homeDrive}${homePath}` : undefined
}

export async function resolveGlobalMemoryHomePath(ipc: IPCClient): Promise<string | undefined> {
  if (_memState.cachedGlobalHomePath) {
    return _memState.cachedGlobalHomePath
  }

  const globalMemoryHomePath = await invokeStringIpc(ipc, IPC.APP_GLOBAL_MEMORY_HOME)
  if (globalMemoryHomePath) {
    _memState.cachedGlobalHomePath = globalMemoryHomePath
    return _memState.cachedGlobalHomePath
  }

  const homeDirResult = await invokeStringIpc(ipc, IPC.APP_HOMEDIR)
  const homeDir = homeDirResult ?? getRendererEnvHomeDir()
  if (homeDir) {
    _memState.cachedGlobalHomePath = joinFsPath(homeDir, '.wishful-claw')
    return _memState.cachedGlobalHomePath
  }

  return undefined
}

export async function resolveGlobalMemoryPath(ipc: IPCClient): Promise<string | undefined> {
  const homePath = await resolveGlobalMemoryHomePath(ipc)
  return homePath ? joinFsPath(homePath, 'MEMORY.md') : undefined
}

async function buildLayeredMemorySnapshot(
  ipc: IPCClient,
  options: {
    workingFolder?: string
    sshConnectionId?: string | null
    scope?: SessionMemoryScope
  } = {}
): Promise<LayeredMemorySnapshot> {
  const globalHomePath = await resolveGlobalMemoryHomePath(ipc)
  const projectRootPath = options.workingFolder?.trim() || undefined
  const projectSshConnectionId = options.sshConnectionId?.trim() || undefined
  const scope = options.scope ?? 'main'

  const globalSoulPath = globalHomePath ? joinFsPath(globalHomePath, 'SOUL.md') : undefined
  const globalUserPath = globalHomePath ? joinFsPath(globalHomePath, 'USER.md') : undefined
  const globalMemoryPath = globalHomePath ? joinFsPath(globalHomePath, 'MEMORY.md') : undefined
  const globalMemorySummaryPath = globalHomePath
    ? joinFsPath(globalHomePath, 'memory_summary.md')
    : undefined

  const [
    globalSoulContent,
    projectSoulFile,
    globalUserContent,
    projectUserFile,
    globalMemoryContent,
    projectMemoryFile,
    globalMemorySummaryContent,
    projectMemorySummaryFile,
    globalDailyMemory,
    projectDailyMemory
  ] = await Promise.all([
    scope !== 'shared' && globalSoulPath
      ? loadOptionalMemoryFile(ipc, globalSoulPath)
      : Promise.resolve(undefined),
    scope !== 'shared' && projectRootPath
      ? resolveProjectMemoryTextFile(
          ipc,
          projectRootPath,
          projectSshConnectionId,
          'SOUL.md'
        )
      : Promise.resolve(undefined),
    scope === 'main' && globalUserPath
      ? loadOptionalMemoryFile(ipc, globalUserPath)
      : Promise.resolve(undefined),
    scope === 'main' && projectRootPath
      ? resolveProjectMemoryTextFile(
          ipc,
          projectRootPath,
          projectSshConnectionId,
          'USER.md'
        )
      : Promise.resolve(undefined),
    scope === 'main' && globalMemoryPath
      ? loadOptionalMemoryFile(ipc, globalMemoryPath)
      : Promise.resolve(undefined),
    scope === 'main' && projectRootPath
      ? resolveProjectMemoryTextFile(
          ipc,
          projectRootPath,
          projectSshConnectionId,
          'MEMORY.md'
        )
      : Promise.resolve(undefined),
    scope === 'main' && globalMemorySummaryPath
      ? loadOptionalMemoryFile(ipc, globalMemorySummaryPath)
      : Promise.resolve(undefined),
    scope === 'main' && projectRootPath
      ? resolveProjectMemoryTextFile(
          ipc,
          projectRootPath,
          projectSshConnectionId,
          'memory_summary.md'
        )
      : Promise.resolve(undefined),
    scope === 'main' ? loadDailyMemoryEntries(ipc, globalHomePath) : Promise.resolve([]),
    scope === 'main'
      ? loadProjectDailyMemoryEntries(ipc, projectRootPath, projectSshConnectionId)
      : Promise.resolve([])
  ])

  return {
    globalHomePath,
    projectRootPath,
    globalSoul: globalSoulPath ? toOptionalEntry(globalSoulPath, globalSoulContent) : undefined,
    projectSoul:
      projectSoulFile && !projectSoulFile.error
        ? toOptionalEntry(projectSoulFile.path, projectSoulFile.content)
        : undefined,
    globalUser: globalUserPath ? toOptionalEntry(globalUserPath, globalUserContent) : undefined,
    projectUser:
      projectUserFile && !projectUserFile.error
        ? toOptionalEntry(projectUserFile.path, projectUserFile.content)
        : undefined,
    globalMemory: globalMemoryPath
      ? toOptionalEntry(globalMemoryPath, globalMemoryContent)
      : undefined,
    projectMemory:
      projectMemoryFile && !projectMemoryFile.error
        ? toOptionalEntry(projectMemoryFile.path, projectMemoryFile.content)
        : undefined,
    globalMemorySummary: globalMemorySummaryPath
      ? toOptionalEntry(globalMemorySummaryPath, globalMemorySummaryContent)
      : undefined,
    projectMemorySummary:
      projectMemorySummaryFile && !projectMemorySummaryFile.error
        ? toOptionalEntry(projectMemorySummaryFile.path, projectMemorySummaryFile.content)
        : undefined,
    globalDailyMemory,
    projectDailyMemory,
    version: _memState.cachedLayeredSnapshot.version,
    updatedAt: _memState.cachedLayeredSnapshot.updatedAt
  }
}

async function ensurePrimaryMemoryWatcher(
  ipc: IPCClient,
  filePath: string | undefined
): Promise<void> {
  const normalizedPath = filePath ? normalizeWatchPath(filePath) : undefined
  if (normalizedPath && _memState.watchedLayerPathKey && _memState.watchedLayerPathKey === normalizedPath) return

  if (_memState.layeredMemoryWatchCleanup && _memState.watchedLayerPath) {
    _memState.layeredMemoryWatchCleanup()
    _memState.layeredMemoryWatchCleanup = null
    await ipc.invoke(IPC.FS_UNWATCH_FILE, { path: _memState.watchedLayerPath }).catch(() => {})
  }

  if (!filePath || !normalizedPath) {
    _memState.watchedLayerPath = undefined
    _memState.watchedLayerPathKey = undefined
    return
  }

  _memState.watchedLayerPath = filePath
  _memState.watchedLayerPathKey = normalizedPath
  await ipc.invoke(IPC.FS_WATCH_FILE, { path: filePath }).catch(() => {})
  _memState.layeredMemoryWatchCleanup = ipc.on(IPC.FS_FILE_CHANGED, (...args: unknown[]) => {
    const data = args[0] as { path?: string } | undefined
    if (!data?.path) return
    if (normalizeWatchPath(data.path) !== normalizedPath) return
    void loadLayeredMemorySnapshot(ipc, {
      workingFolder: _memState.cachedLayeredSnapshot.projectRootPath,
      sshConnectionId: _memState.cachedLayerSshConnectionId,
      scope: _memState.cachedLayerScope
    })
  })
}

export async function loadLayeredMemorySnapshot(
  ipc: IPCClient,
  options: {
    workingFolder?: string
    sshConnectionId?: string | null
    scope?: SessionMemoryScope
  } = {}
): Promise<LayeredMemorySnapshot> {
  const nextSnapshot = await buildLayeredMemorySnapshot(ipc, options)
  const previousSnapshot = _memState.cachedLayeredSnapshot
  _memState.cachedLayerSshConnectionId = options.sshConnectionId?.trim() || undefined
  _memState.cachedLayerScope = options.scope ?? 'main'

  const materializedSnapshot: LayeredMemorySnapshot = {
    ...nextSnapshot,
    version: previousSnapshot.version,
    updatedAt: previousSnapshot.updatedAt
  }

  if (!snapshotsEqual(previousSnapshot, materializedSnapshot)) {
    _memState.layeredMemoryVersion += 1
    _memState.layeredMemoryUpdatedAt = Date.now()
    _memState.cachedLayeredSnapshot = {
      ...materializedSnapshot,
      version: _memState.layeredMemoryVersion,
      updatedAt: _memState.layeredMemoryUpdatedAt
    }

    for (const listener of layeredMemoryListeners) {
      listener(_memState.cachedLayeredSnapshot)
    }
  } else {
    _memState.cachedLayeredSnapshot = {
      ...materializedSnapshot,
      version: _memState.layeredMemoryVersion,
      updatedAt: _memState.layeredMemoryUpdatedAt
    }
  }

  const primaryWatchPath = _memState.cachedLayerSshConnectionId
    ? _memState.cachedLayeredSnapshot.globalMemory?.path ||
      _memState.cachedLayeredSnapshot.globalSoul?.path ||
      _memState.cachedLayeredSnapshot.globalUser?.path
    : _memState.cachedLayeredSnapshot.globalMemory?.path ||
      _memState.cachedLayeredSnapshot.globalSoul?.path ||
      _memState.cachedLayeredSnapshot.globalUser?.path

  await ensurePrimaryMemoryWatcher(ipc, primaryWatchPath)

  return _memState.cachedLayeredSnapshot
}

export async function loadGlobalMemorySnapshot(
  ipc: IPCClient
): Promise<{ path?: string; content?: string }> {
  const snapshot = await loadLayeredMemorySnapshot(ipc, { scope: 'main' })
  return {
    path: snapshot.globalMemory?.path,
    content: snapshot.globalMemory?.content
  }
}
