import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { recordSyntheticEntry, resolveMemoryRoots, appendStage1Outputs, runPhase2ForRoot, runningSessionAutomations, _maState } from './memory-automation-internal'
import { AUTO_RUN_DEBOUNCE_MS, INVALID_MEMORY_JSON_ERROR, RunSessionOptions, buildConversationExcerpt, buildMemoryRootInputs, buildStage1Input, hasUsableProvider, resolveAutomationProvider, summarizeMemorySnapshot, targetForRoot, extractStage1Outputs } from './memory-automation-utils'
import { loadLayeredMemorySnapshot } from './memory-files'
import { getErrorMessage } from './memory-json-parsers'
import type { MemoryRootScope, MemoryStage1OutputInput } from '../../../../shared/memory-automation-types'


export async function runMemoryAutomationForSession(options: RunSessionOptions): Promise<void> {
  const settings = useSettingsStore.getState()
  if (!settings.memoryAutomationEnabled || !settings.memoryGenerateMemories) {
    if (options.manual) {
      await recordSyntheticEntry({
        status: 'skipped',
        reason: 'disabled',
        sourceSessionId: options.sessionId,
        content: 'Memory generation is disabled'
      })
    }
    return
  }
  if (options.aborted) return

  const now = Date.now()
  const lastRunAt = _maState.lastAutoRunBySession.get(options.sessionId) ?? 0
  if (!options.manual && now - lastRunAt < AUTO_RUN_DEBOUNCE_MS) return
  _maState.lastAutoRunBySession = new Map(_maState.lastAutoRunBySession).set(options.sessionId, now)

  if (runningSessionAutomations.has(options.sessionId)) return
  runningSessionAutomations.add(options.sessionId)

  try {
    const chatState = useChatStore.getState()
    const session = chatState.sessions.find((item) => item.id === options.sessionId)
    if (!session) return
    if (settings.memoryAutomationMainSessionsOnly && session.pluginId) {
      await recordSyntheticEntry({
        status: 'skipped',
        reason: 'unsupported_scope',
        sourceSessionId: options.sessionId,
        content: 'Skipped plugin/channel session'
      })
      return
    }

    const provider = resolveAutomationProvider()
    const providerType = provider?.type
    if (!hasUsableProvider(provider)) {
      await recordSyntheticEntry({
        status: 'skipped',
        reason: providerType === 'openai-images' ? 'unsupported_provider' : 'missing_provider',
        sourceSessionId: options.sessionId,
        content: 'No usable text provider for memory generation'
      })
      return
    }

    const messages = chatState.getSessionMessages(options.sessionId)
    if (messages.length === 0) {
      await recordSyntheticEntry({
        status: 'skipped',
        reason: 'no_candidates',
        sourceSessionId: options.sessionId,
        content: 'No session messages available for memory generation'
      })
      return
    }

    const snapshot =
      options.memorySnapshot ??
      (await loadLayeredMemorySnapshot(ipcClient, {
        workingFolder: session.workingFolder,
        sshConnectionId: session.sshConnectionId,
        scope: 'main'
      }))
    const rootInputs = buildMemoryRootInputs({
      snapshot,
      projectId: session.projectId,
      sshConnectionId: session.sshConnectionId
    })
    if (rootInputs.length === 0) {
      await recordSyntheticEntry({
        status: 'skipped',
        reason: 'missing_target',
        sourceSessionId: options.sessionId,
        content: 'No memory root available'
      })
      return
    }

    const roots = resolveMemoryRoots(rootInputs)

    const scopeOutputs = await extractStage1Outputs({
      provider,
      conversation: buildConversationExcerpt(messages as any, options.assistantMessageId),
      memorySnapshotText: summarizeMemorySnapshot(snapshot),
      projectAvailable: Boolean(snapshot.projectRootPath),
      sessionId: options.sessionId
    })

    const stage1ByScope = new Map<MemoryRootScope, MemoryStage1OutputInput[]>()
    for (const scopeOutput of scopeOutputs) {
      if (scopeOutput.scope === 'project' && !snapshot.projectRootPath) continue
      const root = roots.find((item) => item.scope === scopeOutput.scope)
      if (!root) continue
      const built = buildStage1Input({
        root,
        scopeOutput,
        sourceSessionId: options.sessionId,
        sourceUpdatedAt: session.updatedAt
      })
      if (built.input) {
        const bucket = stage1ByScope.get(root.scope) ?? []
        bucket.push(built.input)
        stage1ByScope.set(root.scope, bucket)
      }
      if (!built.input || built.input.status === 'filtered') {
        await recordSyntheticEntry({
          status: 'filtered',
          reason: built.reason ?? 'temporary_chatter',
          sourceSessionId: options.sessionId,
          rootScope: root.scope,
          memoryRootId: root.id,
          projectId: root.projectId ?? null,
          target: targetForRoot(root),
          content: built.content || 'Stage 1 output was empty after safety filtering'
        })
      }
    }

    if (stage1ByScope.size === 0) {
      await recordSyntheticEntry({
        status: 'skipped',
        reason: 'no_candidates',
        sourceSessionId: options.sessionId,
        content: 'Model returned no durable memory outputs'
      })
      return
    }

    for (const root of roots) {
      const outputs = stage1ByScope.get(root.scope)
      if (!outputs || outputs.length === 0) continue
      const activeOutputs = outputs.filter((output) => output.status !== 'filtered')
      if (activeOutputs.length === 0) continue
      const appendError = await appendStage1Outputs({
        root,
        outputs: activeOutputs,
        sourceSessionId: options.sessionId
      })
      if (appendError) {
        await recordSyntheticEntry({
          status: 'error',
          reason: 'write_error',
          sourceSessionId: options.sessionId,
          rootScope: root.scope,
          memoryRootId: root.id,
          projectId: root.projectId ?? null,
          target: targetForRoot(root),
          content: 'Failed to append stage 1 raw memories',
          targetPath: root.rootPath,
          error: appendError
        })
        continue
      }
      await runPhase2ForRoot({
        root,
        provider,
        sourceSessionId: options.sessionId
      })
    }
  } catch (error) {
    const message = getErrorMessage(error)
    await recordSyntheticEntry({
      status: 'error',
      reason: message === INVALID_MEMORY_JSON_ERROR ? 'invalid_json' : 'write_error',
      sourceSessionId: options.sessionId,
      target: 'global_memory',
      content: 'Memory pipeline failed',
      error: message
    })
  } finally {
    runningSessionAutomations.delete(options.sessionId)
  }
}
