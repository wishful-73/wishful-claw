// Extracted store selectors for InputArea to keep index.tsx under 500 lines

import * as React from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { AIModelConfig } from '@renderer/lib/api/types'
import { useChatStore } from '@renderer/stores/chat-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { useProviderStore, modelSupportsVision } from '@renderer/stores/provider-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useGoalStore } from '@renderer/stores/goal-store'
import { usePlanStore } from '@renderer/stores/plan-store'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import { isProjectSession, workspaceContextAvailable } from '@renderer/lib/session-scope'
import type { AppMode } from '@renderer/stores/ui-types'

export interface InputAreaSelectorsInput {
  sessionId?: string
  workingFolder?: string | null
  modelRoute: 'main' | 'fast'
}

export interface InputAreaSelectorsOutput {
  // Settings
  language: string
  mainModelSelectionMode: string
  autoApprove: boolean
  permissionWhitelistEnabled: boolean
  clarifyAutoAcceptRecommended: boolean
  animationsEnabled: boolean
  webSearchEnabled: boolean
  webSearchProvider: string
  webSearchApiKey: string
  webSearchRequiresApiKey: boolean
  canToggleWebSearch: boolean

  // Session
  targetSession: ReturnType<typeof getTargetSession> | undefined
  channels: ReturnType<typeof useChannelStore.getState>['channels']
  autoSelection: { providerId: string; modelId: string } | null
  activeProvider: {
    apiKey: string; requiresApiKey: boolean; type: string;
    models: AIModelConfig[]; modelId: string
  } | null
  supportsVision: boolean
  composerModelCfg: AIModelConfig | null

  // UI
  chatView: string
  isHomeComposer: boolean
  mode: AppMode
  openSettings: (tab: string) => void
  openFilePreview: (path: string) => void

  // Project/session
  activeProjectId: string | null
  activeSshConnectionId: string | null
  activeSessionId: string | null
  hasMessages: boolean
  clearSessionMessages: (sessionId: string) => void
  draftSessionId: string | null
  projectScoped: boolean
  workspaceReady: boolean


  // Plan / goal
  planMode: boolean
  activeGoal: { status: string } | undefined
  hasActiveGoal: boolean
  pendingReviewPlanId: string | null

  // Auth
  hasApiKey: boolean
}

type TargetSession = {
  id: string; projectId: string | null; pluginId: string | null;
  providerId: string | null; modelId: string | null; modelSelectionMode: string | null;
  messageCount: number; sshConnectionId: string | null
}

function getTargetSession(s: ReturnType<typeof useChatStore.getState>, sessionId?: string): TargetSession | undefined {
  const targetSessionId = sessionId ?? s.activeSessionId
  const idx = targetSessionId ? s.sessionsById[targetSessionId] : undefined
  const session = idx !== undefined ? s.sessions[idx] : undefined
  if (!session) return undefined
  return {
    id: session.id, projectId: session.projectId ?? null, pluginId: session.pluginId ?? null,
    providerId: session.providerId ?? null, modelId: session.modelId ?? null,
    modelSelectionMode: session.modelSelectionMode ?? null,
    messageCount: session.messageCount, sshConnectionId: session.sshConnectionId ?? null
  }
}

export function useInputAreaSelectors(input: InputAreaSelectorsInput): InputAreaSelectorsOutput {
  const { sessionId, workingFolder, modelRoute } = input
  const chatView = useUIStore((s) => s.chatView)
  const isSessionComposer = chatView === 'session' || Boolean(sessionId)

  const isHomeComposer = chatView === 'home' || chatView === 'project'

  // ── Settings ────────────────────────────────────────────────────
  const language = useSettingsStore((s) => s.language)
  const mainModelSelectionMode = useSettingsStore((s) => s.mainModelSelectionMode)
  const autoApprove = useSettingsStore((s) => s.autoApprove)
  const permissionWhitelistEnabled = useSettingsStore((s) => s.permissionPolicy.enabled)
  const clarifyAutoAcceptRecommended = useSettingsStore((s) => s.clarifyAutoAcceptRecommended)
  const animationsEnabled = useSettingsStore((s) => s.animationsEnabled)
  const webSearchEnabled = useSettingsStore((s) => s.webSearchEnabled)
  const webSearchProvider = useSettingsStore((s) => s.webSearchProvider)
  const webSearchApiKey = useSettingsStore((s) => s.webSearchApiKey)
  const webSearchRequiresApiKey = ['tavily','searxng','exa','exa-mcp','bocha','zhipu'].includes(webSearchProvider)
  const canToggleWebSearch = !webSearchRequiresApiKey || Boolean(webSearchApiKey)

  // ── Session ─────────────────────────────────────────────────────
  const targetSession = useChatStore(useShallow((s) => getTargetSession(s, sessionId)))
  const channels = useChannelStore((s) => s.channels)
  const autoSelection = useUIStore((s) =>
    targetSession ? (s.autoModelSelectionsBySession[targetSession.id] ?? null) : null
  )

  const activeProvider = useProviderStore(
    useShallow((s) => {
      const { providers, activeProviderId, activeModelId } = s
      const fastConfig = modelRoute === 'fast' ? s.getFastProviderConfig() : null
      const session = isSessionComposer ? targetSession : null
      const channel = session?.pluginId
        ? (channels.find((item) => item.id === session.pluginId) ?? null)
        : null
      const selection = session
        ? resolveSessionModelSelection({
            session: session as any, providers, activeProviderId, activeModelId,
            globalMode: mainModelSelectionMode,
            channelProviderId: channel?.providerId, channelModelId: channel?.model
          })
        : null
      const providerId = fastConfig?.providerId ??
        (selection ? (selection.isAutoModeActive && autoSelection?.providerId ? autoSelection.providerId : selection.providerId) : activeProviderId)
      const modelId = fastConfig?.model ??
        (selection ? (selection.isAutoModeActive && autoSelection?.modelId ? autoSelection.modelId : selection.modelId) : activeModelId)
      if (!providerId || !modelId) return null
      const provider = providers.find((item: any) => item.id === providerId)
      if (!provider) return null
      const model = provider.models.find((item: any) => item.id === modelId)
      if (!model) return null
      return { apiKey: provider.apiKey, requiresApiKey: provider.requiresApiKey, type: provider.type, models: provider.models, modelId }
    })
  )

  const supportsVision = React.useMemo(() => {
    if (!activeProvider) return false
    const model = activeProvider.models.find((m: any) => m.id === activeProvider.modelId)
    return modelSupportsVision(model, activeProvider.type)
  }, [activeProvider])

  const composerModelCfg = React.useMemo<AIModelConfig | null>(() => {
    if (!activeProvider) return null
    return activeProvider.models.find((m: any) => m.id === activeProvider.modelId) ?? null
  }, [activeProvider])

  // ── UI ──────────────────────────────────────────────────────────
  const mode = useUIStore((s) => s.mode)
  const openSettings = useUIStore((s) => s.openSettings)
  const openFilePreview = useUIStore((s) => s.openFilePreview)

  // ── Project / session IDs ───────────────────────────────────────
  const activeProjectId = useChatStore((s) => {
    const ts = getTargetSession(s, sessionId)
    return ts?.projectId ?? s.activeProjectId
  })

  const activeSshConnectionId = useChatStore((s) => {
    const ts = getTargetSession(s, sessionId)
    const projectId = ts?.projectId ?? s.activeProjectId
    const activeProject = projectId ? s.projects.find((project) => project.id === projectId) : undefined
    return ts?.sshConnectionId ?? activeProject?.sshConnectionId ?? null
  })

  const { activeSessionId, hasMessages, clearSessionMessages } = useChatStore(
    useShallow((s) => {
      const ts = getTargetSession(s, sessionId)
      return {
        activeSessionId: sessionId ?? s.activeSessionId,
        hasMessages: (ts?.messageCount ?? 0) > 0,
        clearSessionMessages: s.clearSessionMessages
      }
    })
  )

  const draftSessionId = sessionId ?? (chatView === 'session' ? activeSessionId : null)
  const projectScoped = isProjectSession({ chatView, session: targetSession as any, activeProjectId, workingFolder })
  const workspaceReady = workspaceContextAvailable({ chatView, session: targetSession as any, activeProjectId, workingFolder })
  // needsWorkingFolder is computed in the main component (depends onSelectFolder prop)

  // ── Plan / goal ─────────────────────────────────────────────────
  const planMode = useUIStore((s) =>
    draftSessionId ? Boolean(s.planModesBySession[draftSessionId]) : false
  )
  const activeGoal = useGoalStore((s) =>
    draftSessionId ? s.goalsBySession[draftSessionId] : undefined
  )
  const hasActiveGoal = activeGoal?.status === 'active'
  const pendingReviewPlanId = usePlanStore((s) =>
    draftSessionId ? (s.getPendingReviewPlan(draftSessionId)?.id ?? null) : null
  )

  // ── Auth ────────────────────────────────────────────────────────
  const hasApiKey = useProviderStore((s) =>
    // The banner means "no usable configured provider exists at all" — not
    // "the currently selected provider lacks a key". Scan every enabled
    // provider so disabled credentials do not suppress the warning.
    s.providers.some((p: any) =>
      p.enabled && (p.requiresApiKey === false || !!p.apiKey)
    )
  )

  return {
    language, mainModelSelectionMode, autoApprove, permissionWhitelistEnabled,
    clarifyAutoAcceptRecommended, animationsEnabled,
    webSearchEnabled, webSearchProvider, webSearchApiKey, webSearchRequiresApiKey, canToggleWebSearch,
    targetSession, channels, autoSelection: autoSelection as any, activeProvider: activeProvider as any, supportsVision, composerModelCfg,
    chatView, isHomeComposer, mode, openSettings: openSettings as any, openFilePreview,
    activeProjectId, activeSshConnectionId, activeSessionId, hasMessages, clearSessionMessages,
    draftSessionId, projectScoped, workspaceReady,
    planMode, activeGoal, hasActiveGoal, pendingReviewPlanId,
    hasApiKey,
  }
}
