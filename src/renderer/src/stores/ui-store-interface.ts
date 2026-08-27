// Extracted from ui-store.ts — UIStore interface definition

import type React from 'react'
import type {
  AppMode,
  AutoModelRoutingState,
  AutoModelSelectionStatus,
  AgentFilesChangeSource,
  AgentFilesTab,
  ChatView,
  DetailPanelContent,
  MessageListViewState,
  NavItem,
  RightPanelSection,
  RightPanelTabInstance,
  SettingsTab
} from './ui-types'
import type { BrowserErrorInfo, BrowserPanelSessionState } from './browser-session-helpers'
import type { PreviewPanelState, PreviewPanelTab, OpenDiffParams } from './preview-panel-helpers'

// ─── Store Interface ───

export interface UIStore {
  // Top-level view (splash / main / settings)
  view: 'splash' | 'main' | 'settings'
  setView: (view: 'splash' | 'main' | 'settings') => void
  enterMain: () => void
  openSettings: (tab?: SettingsTab) => void
  closeSettings: () => void

  // Selected provider (for ModelSwitcher)
  selectedProvider: Record<string, unknown> | null
  setSelectedProvider: (provider: Record<string, unknown> | null) => void

  // Mode
  mode: AppMode
  setMode: (mode: AppMode) => void

  // Navigation rail
  activeNavItem: NavItem
  setActiveNavItem: (item: NavItem) => void

  // Left sidebar
  leftSidebarOpen: boolean
  leftSidebarWidth: number
  toggleLeftSidebar: () => void
  setLeftSidebarOpen: (open: boolean) => void
  setLeftSidebarWidth: (width: number) => void

  // Conversation panel
  conversationPanelFullWidth: boolean
  setConversationPanelFullWidth: (fullWidth: boolean) => void

  // Right panel
  rightPanelOpen: boolean
  toggleRightPanel: () => void
  setRightPanelOpen: (open: boolean) => void
  rightPanelWidth: number
  setRightPanelWidth: (width: number) => void
  rightPanelTab: string
  setRightPanelTab: (tab: string) => void
  rightPanelSection: RightPanelSection
  setRightPanelSection: (section: RightPanelSection) => void
  rightPanelTabs: RightPanelTabInstance[]
  rightPanelActiveTabId: string
  setRightPanelActiveTab: (tabId: string) => void
  closeRightPanelTab: (tabId: string) => void
  rightPanelRailWidth: number

  // Runtime status panel
  runtimeStatusPanelOpen: boolean
  toggleRuntimeStatusPanel: () => void
  setRuntimeStatusPanelOpen: (open: boolean) => void

  // Auto model selection (from WishfulClaw)
  autoModelSelectionsBySession: Record<string, AutoModelSelectionStatus | null>
  autoModelRoutingStatesBySession: Record<string, AutoModelRoutingState>
  setAutoModelSelection: (sessionId: string, status: AutoModelSelectionStatus | null) => void
  setAutoModelRoutingState: (sessionId: string, status: AutoModelRoutingState) => void

  // Settings page
  settingsPageOpen: boolean
  settingsTab: SettingsTab
  setSettingsTab: (tab: SettingsTab) => void
  openSettingsPage: (tab?: SettingsTab) => void
  closeSettingsPage: () => void

  // Feature page toggles (all preserved as entry points)
  skillsPageOpen: boolean
  openSkillsPage: () => void
  closeSkillsPage: () => void
  soulsPageOpen: boolean
  openSoulsPage: () => void
  closeSoulsPage: () => void
  syncPageOpen: boolean
  openSyncPage: () => void
  closeSyncPage: () => void
  resourcesPageOpen: boolean
  openResourcesPage: () => void
  closeResourcesPage: () => void
  translatePageOpen: boolean
  openTranslatePage: () => void
  closeTranslatePage: () => void
  drawPageOpen: boolean
  openDrawPage: () => void
  closeDrawPage: () => void
  tasksPageOpen: boolean
  openTasksPage: () => void
  closeTasksPage: () => void
  codeGraphPageOpen: boolean
  openCodeGraphPage: () => void
  closeCodeGraphPage: () => void
  taskBoardPageOpen: boolean
  openTaskBoardPage: () => void
  closeTaskBoardPage: () => void

  // Dialogs
  shortcutsOpen: boolean
  setShortcutsOpen: (open: boolean) => void
  conversationGuideOpen: boolean
  setConversationGuideOpen: (open: boolean) => void
  changelogDialogOpen: boolean
  setChangelogDialogOpen: (open: boolean) => void
  pendingInsertText: string | null
  setPendingInsertText: (text: string | null) => void

  // Detail panel
  detailPanelOpen: boolean
  detailPanelContent: DetailPanelContent | null
  openDetailPanel: (content: DetailPanelContent) => void
  closeDetailPanel: () => void

  // Agent files
  agentFilesActiveTab: AgentFilesTab
  setAgentFilesActiveTab: (tab: AgentFilesTab) => void
  agentFilesSelectedChangeKey: string | null
  setAgentFilesSelectedChangeKey: (key: string | null) => void
  agentFilesChangeSource: AgentFilesChangeSource
  setAgentFilesChangeSource: (source: AgentFilesChangeSource) => void

  // Bottom terminal dock
  bottomTerminalDockOpenBySessionId: Record<string, boolean>
  setBottomTerminalDockOpen: (sessionId: string, open: boolean) => void
  toggleBottomTerminalDock: (sessionId: string) => void
  isBottomTerminalDockOpen: (sessionId?: string | null) => boolean
  bottomTerminalDockHeight: number
  setBottomTerminalDockHeight: (height: number) => void

  // SubAgent execution detail
  subAgentExecutionDetailOpen: boolean
  subAgentExecutionDetailToolUseId: string | null
  subAgentExecutionDetailInlineText: string | null
  openSubAgentExecutionDetail: (toolUseId: string, inlineText?: string | null, name?: string, sessionId?: string) => void
  closeSubAgentExecutionDetail: () => void
  selectedSubAgentToolUseId: string | null
  setSelectedSubAgentToolUseId: (toolUseId: string | null) => void

  // Orchestration console
  selectedOrchestrationRunId: string | null
  setSelectedOrchestrationRunId: (runId: string | null) => void
  selectedOrchestrationMemberId: string | null
  setSelectedOrchestrationMemberId: (memberId: string | null) => void
  orchestrationConsoleOpen: boolean
  orchestrationConsoleView: 'overview' | 'member' | 'tasks'
  openOrchestrationPanel: (runId?: string | null, memberId?: string | null) => void
  openOrchestrationMember: (runId: string, memberId: string) => void
  openMarkdownPreview: (title: string, content: string, sessionId?: string | null) => void
  closeOrchestrationPanel: () => void

  // Plan mode
  planMode: boolean
  enterPlanMode: (sessionId?: string | null) => void
  exitPlanMode: (sessionId?: string | null) => void
  planModesBySession: Record<string, boolean>
  isPlanModeEnabled: (sessionId?: string | null) => boolean

  // Collab mode (normal / goal)
  collabModesBySession: Record<string, 'normal' | 'goal'>
  setCollabMode: (sessionId: string, mode: 'normal' | 'goal') => void
  getCollabMode: (sessionId?: string | null) => 'normal' | 'goal'

  // Browser panel (session-scoped state)
  browserStatesBySession: Record<string, BrowserPanelSessionState | undefined>
  browserWebviewRefsBySession: Record<string, React.RefObject<Electron.WebviewTag | null> | null | undefined>
  browserUrl: string
  setBrowserUrl: (url: string, sessionId?: string | null, projectId?: string | null) => void
  browserLoading: boolean
  setBrowserLoading: (loading: boolean, sessionId?: string | null, projectId?: string | null) => void
  browserPageTitle: string
  setBrowserPageTitle: (title: string, sessionId?: string | null, projectId?: string | null) => void
  browserCanGoBack: boolean
  setBrowserCanGoBack: (can: boolean, sessionId?: string | null, projectId?: string | null) => void
  browserCanGoForward: boolean
  setBrowserCanGoForward: (can: boolean, sessionId?: string | null, projectId?: string | null) => void
  browserErrorInfo: BrowserErrorInfo | null
  setBrowserErrorInfo: (info: BrowserErrorInfo | null, sessionId?: string | null, projectId?: string | null) => void
  browserWebviewRef: React.RefObject<Electron.WebviewTag | null> | null
  getBrowserState: (sessionId?: string | null, projectId?: string | null) => BrowserPanelSessionState
  patchBrowserState: (sessionId: string | null | undefined, patch: Partial<BrowserPanelSessionState>, projectId?: string | null) => void
  setBrowserWebviewRef: (ref: React.RefObject<Electron.WebviewTag | null> | null, sessionId?: string | null, projectId?: string | null) => void

  // Selected files
  selectedFiles: string[]
  setSelectedFiles: (files: string[]) => void
  toggleFileSelection: (filePath: string) => void
  clearSelectedFiles: () => void

  // Preview panel
  previewPanelOpen: boolean
  previewPanelState: PreviewPanelTab | null
  previewPanelTabs: PreviewPanelTab[]
  activePreviewPanelTabId: string | null
  openFilePreview: (
    filePath: string,
    viewMode?: 'preview' | 'code',
    sshConnectionId?: string | null,
    sessionId?: string | null,
    targetLine?: number,
    targetColumn?: number
  ) => void
  openPreviewTab: (
    state: PreviewPanelState,
    preserveExistingViewMode?: boolean,
    mirrorToRightPanel?: boolean
  ) => void
  openDiff: (params: OpenDiffParams) => void
  openDevServerPreview: (projectDir: string, port: number, sessionId?: string | null) => void
  closePreviewTab: (tabId: string) => void
  closePreviewPanel: () => void
  setActivePreviewTab: (tabId: string | null) => void
  updatePreviewTab: (tabId: string, patch: Partial<PreviewPanelTab>) => void
  setPreviewViewMode: (mode: 'preview' | 'code', sessionId?: string | null) => void

  // Hovering state
  isHoveringRightPanel: boolean
  setIsHoveringRightPanel: (hovering: boolean) => void
  runtimeStatusPanelTriggerHovered: boolean
  setRuntimeStatusPanelTriggerHovered: (hovering: boolean) => void

  // Session-scoped state
  activeScopedSessionId: string | null
  activeScopedProjectId: string | null
  syncSessionScopedState: (sessionId: string | null, projectId?: string | null) => void
  messageListViewStatesBySession: Record<string, MessageListViewState | undefined>
  setMessageListViewState: (sessionId: string, state: MessageListViewState | null) => void
  getMessageListViewState: (sessionId?: string | null) => MessageListViewState | null
  releaseDormantSessionUiState: (sessionId?: string | null) => void

  // Chat view navigation
  chatView: ChatView
  navigateToHome: () => void
  navigateToProject: (projectId?: string | null) => void
  navigateToArchive: (projectId?: string | null) => void
  navigateToChannels: (projectId?: string | null) => void
  navigateToGit: (projectId?: string | null) => void
  navigateToPersona: (projectId?: string | null) => void
  navigateToSession: (sessionId?: string | null) => void
  applyRouteFromLocation: () => void
  applyChatRouteFromLocation: () => void

  // Right panel tab management
  ensureActivityTab: () => void
  ensureBrowserTab: (
    url?: string,
    sessionId?: string | null,
    projectId?: string | null,
    options?: { background?: boolean }
  ) => void
  ensureSubAgentTab: (
    toolUseId?: string | null,
    inlineText?: string | null,
    title?: string | null,
    sessionId?: string | null
  ) => void
  openSubAgentsPanel: (toolUseId?: string | null, sessionId?: string | null) => void
  openGoalPanel: (
    sessionId?: string | null,
    projectId?: string | null,
    goalId?: string | null
  ) => void
  ensureTerminalTab: () => void
  ensureFilesTab: (sessionId?: string | null) => void
  getBrowserWebviewRef: (sessionId?: string | null, projectId?: string | null) => React.RefObject<Electron.WebviewTag | null> | null
  openBrowserTab: (
    url?: string,
    sessionId?: string | null,
    projectId?: string | null,
    options?: { background?: boolean }
  ) => void
}