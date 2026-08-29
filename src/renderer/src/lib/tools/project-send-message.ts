/**
 * Project Send-Session-Message Handler
 *
 * Handles `project/send-session-message` reverse-request from the native worker.
 * The global session (project manager) sends a message to a target project session
 * via the normal sendMessage pipeline — fully simulating a user action.
 *
 * Before calling sendMessage, ensures the target session exists in the chat store
 * (injected if missing). sendMessage is called fire-and-forget — the target session
 * processes the message asynchronously. Returns immediately after dispatch.
 *
 * Flow:
 *   Worker (send_session_message tool)
 *     → reverse-request "project/send-session-message"
 *     → Main process (rendererMethods)
 *     → Renderer (this handler)
 *     → Ensure session in store → chatStore.sendMessage() → agent/run
 *     → Read target session's reply from store
 *     → Response back to Worker
 */

import { useChatStore } from '@renderer/stores/chat-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { writeLog } from '@renderer/lib/error-logger'

interface SendSessionMessageParams {
  sessionId: string
  content: string
  workingFolder?: string
  projectId?: string
  /**
   * Session mode for the simulated turn. Defaults to 'normal' (project target
   * sessions); 'global' is used when delivering replies back to the global
   * agent's own session so it keeps its identity prompt and global-only tools.
   */
  sessionMode?: 'normal' | 'goal' | 'global'
}

export async function handleProjectSendSessionMessage(
  params: unknown
): Promise<{ success: boolean; result?: string; error?: string }> {
  const { sessionId, content, workingFolder, projectId, sessionMode } = params as SendSessionMessageParams

  if (!sessionId || !content) {
    return { success: false, error: 'Missing required fields: sessionId, content' }
  }

  // 1. Ensure target session exists in the chat store
  //    (sendMessage's beginUserTurn silently fails if session is not in store)
  const chatStore = useChatStore.getState()
  const existingSession = chatStore.sessions.find((s) => s.id === sessionId)
  if (!existingSession) {
    useChatStore.setState((state) => {
      state.sessions.push({
        id: sessionId,
        title: 'Project Task',
        mode: 'chat',
        messages: [],
        messageCount: 0,
        messagesLoaded: false,
        loadedRangeStart: 0,
        loadedRangeEnd: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectId: projectId || undefined,
        workingFolder: workingFolder || undefined,
        modelSelectionMode: 'inherit'
      })
    })
  }

  // 2. Get provider config from store
  const providerStore = useProviderStore.getState()
  const targetProvider = providerStore.getActiveProvider()
  if (!targetProvider) {
    return { success: false, error: 'No active provider configured. Please configure a provider in Settings.' }
  }

  const modelId = providerStore.activeModelId || targetProvider.defaultModel
  if (!modelId) {
    return { success: false, error: 'No model configured. Please select a model in Settings.' }
  }

  const settings = useSettingsStore.getState()
  const provider = {
    id: targetProvider.id,
    name: targetProvider.name,
    type: targetProvider.type,
    apiKey: targetProvider.apiKey,
    baseUrl: targetProvider.baseUrl,
    model: modelId,
    temperature: settings.temperature ?? undefined,
    maxTokens: settings.maxTokens ?? undefined,
    thinkingEnabled: false
  }

  // 3. Fire-and-forget sendMessage — global session doesn't need to wait for result
  //    The Agent can check back later via get_project_details.
  try {
    // Fire-and-forget: don't await, let the target session execute in background
    writeLog('info', '[sendMsg] sending to session: ' + sessionId + ' content: ' + content)
    useChatStore.getState().sendMessage({
      sessionMode: sessionMode ?? 'normal',
      provider,
      messages: [{ role: 'user', content }],
      sessionId,
      toolPreset: workingFolder && sessionMode !== 'global' ? 'coding' : 'chat',
      webSearchEnabled: settings.webSearchEnabled,
      workingFolder: workingFolder || undefined,
      projectId: projectId || undefined,
      maxIterations: 0,
      maxParallelTools: settings.maxParallelToolCalls,
      maxToolCallsPerTurn: settings.maxToolCallsPerTurn,
      maxConcurrentSubAgents: settings.maxConcurrentSubAgents,
      personaId: settings.defaultPersonaId ?? undefined,
      language: settings.language,
      userRules: settings.systemPrompt || undefined,
      contextCompressionEnabled: settings.contextCompressionEnabled,
      contextCompressionThreshold: settings.contextCompressionThreshold
    }).catch(err => {
      writeLog('error', '[sendMsg] sendMessage async error: ' + (err instanceof Error ? err.message : String(err)))
    })

    return {
      success: true,
      result: `Message sent to session "${sessionId}". The target session is now processing. Check back later with get_project_details.`
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Failed to send message: ${msg}` }
  }
}

