import * as React from 'react'
import { Send, FolderOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import { SkillsMenu } from '../SkillsMenu'
import { CollabModeSwitcher, type CollabMode } from '../CollabModeSwitcher'
import { ModelSwitcher } from '../ModelSwitcher'
import { PersonaSwitcher } from '../PersonaSwitcher'
import { ContextRing } from './context-ring'
import { ReadOnlyModelBadge } from './badges'
import { PermissionControl } from './permission-control'
import { ClearConversationDialog } from './clear-conversation-dialog'
import type { MessageRequestModelMeta } from '@renderer/lib/api/types'

interface ComposerToolbarProps {
  // Model
  readOnlyModel?: MessageRequestModelMeta | null
  modelRoute: 'main' | 'fast'
  draftSessionId: string | null

  // Collab mode
  draftSessionIdCollab?: string | null
  collabModeDisabled?: boolean
  onCollabModeChange?: (mode: CollabMode) => void
  collabModeOverride?: CollabMode

  disabled: boolean
  isStreaming: boolean

  // Skills menu
  setSelectedSkill: (name: string | null) => void
  insertSlashCommand: (name: string) => void
  insertPluginPrompt: (pluginId: string, focus?: boolean) => void
  handleAttachMedia: () => void
  activeProjectId: string | null
  mode: string
  hideModeSwitch: boolean
  planMode: boolean
  goalModeEnabled: boolean
  planModeDisabled: boolean
  goalModeDisabled: boolean
  onPlanModeChange: (enabled: boolean) => void
  onGoalModeChange: (enabled: boolean) => void

  // Folder
  onSelectFolder?: () => void
  hideWorkingFolderPicker: boolean

  // Optimize (only the lock is left: it still gates send + editor)
  isOptimizingLocked: boolean

  // Permission
  permissionMode: 'default' | 'fullAccess'
  showPermissionControl: boolean
  onSelectPermissionMode: (mode: 'default' | 'fullAccess') => Promise<void>
  onOpenSettings: (tab: string) => void

  // Send
  onStop?: () => void
  onSend: () => void
  finalSerializedText: string
  attachedImagesCount: number
  needsWorkingFolder: boolean
  pendingImageReads: number

  // Context ring
  onCompressContext?: () => void
  isContextCompressing: boolean

  // Clear conversation
  showInlineClearConversation: boolean
  hasMessages: boolean
  activeSessionId: string | null
  queuedMessagesCount: number
  onClearSession: (sessionId: string) => void

  // Styling
  composerIconControlClass: string

  // Ref for height measurement
  toolbarRef?: React.Ref<HTMLDivElement>
}

export function ComposerToolbar(props: ComposerToolbarProps) {
  const { t } = useTranslation('chat')
  const {
    readOnlyModel, modelRoute, draftSessionId,
    draftSessionIdCollab, collabModeDisabled, onCollabModeChange, collabModeOverride,
    disabled, isStreaming,
    setSelectedSkill, insertSlashCommand, insertPluginPrompt, handleAttachMedia,
    activeProjectId, mode, hideModeSwitch, planMode, goalModeEnabled,
    planModeDisabled, goalModeDisabled, onPlanModeChange, onGoalModeChange,
    onSelectFolder, hideWorkingFolderPicker,
    isOptimizingLocked,
    permissionMode, showPermissionControl, onSelectPermissionMode, onOpenSettings,
    onStop, onSend, finalSerializedText, attachedImagesCount, needsWorkingFolder, pendingImageReads,
    onCompressContext, isContextCompressing,
    showInlineClearConversation, hasMessages, activeSessionId, queuedMessagesCount, onClearSession,
    composerIconControlClass, toolbarRef
  } = props

  const composerVariant = 'session'

  const skillsMenuControl = (
    <SkillsMenu
      onSelectSkill={(name) => {
        setSelectedSkill(name)
      }}
      onSelectCommand={(name) => {
        insertSlashCommand(name)
      }}
      onSelectPlugin={(pluginId) => {
        insertPluginPrompt(pluginId)
      }}
      onAttachMedia={() => void handleAttachMedia()}
      disabled={disabled || isStreaming}
      projectId={activeProjectId ?? undefined}
      showChannels={mode !== 'chat'}
      triggerClassName={composerIconControlClass}
      menuClassName="composer-flyout"
      showModeToggles={!hideModeSwitch}
      planModeEnabled={planMode}
      goalModeEnabled={goalModeEnabled}
      planModeDisabled={planModeDisabled}
      goalModeDisabled={goalModeDisabled}
      onPlanModeChange={goalModeEnabled ? undefined : onPlanModeChange}
      onGoalModeChange={onGoalModeChange}
    />
  )


  const folderControl = onSelectFolder && !hideWorkingFolderPicker && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={composerIconControlClass}
          onClick={onSelectFolder}
        >
          <FolderOpen className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('input.selectFolder')}</TooltipContent>
    </Tooltip>
  )

  const permissionControl = (
    <PermissionControl
      permissionMode={permissionMode}
      onSelectMode={onSelectPermissionMode}
      onOpenSettings={(tab) => onOpenSettings(tab as never)}
    />
  )

  // 运行中只要输入框里有内容（文字或附件），按钮就该是「发送」，消息由上游排队等当前轮跑完；
  // 只有输入框为空时才是「终止」。
  const hasSendableContent = Boolean(finalSerializedText.trim()) || attachedImagesCount > 0
  const isStopAction = isStreaming && !hasSendableContent

  const sendControl = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="default"
          className="composer-send rounded-xl px-3.5 transition-[filter,box-shadow] duration-200"
          data-composer-variant={composerVariant}
          data-tone={isStopAction ? 'warning' : undefined}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
          onClick={isStopAction ? () => onStop?.() : onSend}
          disabled={
            isStopAction
              ? false
              : !hasSendableContent ||
                disabled ||
                needsWorkingFolder ||
                pendingImageReads > 0 ||
                isOptimizingLocked
          }
          aria-label={isStopAction ? t('input.stopTooltip') : t('input.sendTooltip')}
        >
          {isStopAction ? (
            <>
              <Spinner className="mr-1.5 size-3.5" />
              <span>{t('action.stop', { ns: 'common' })}</span>
            </>
          ) : (
            <>
              <span>{t(draftSessionId ? 'action.send' : 'action.start', { ns: 'common' })}</span>
              <Send className="ml-1.5 size-3.5" />
            </>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isStopAction ? t('input.stopTooltip') : t('input.sendTooltip')}
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div
      ref={toolbarRef}
      className="composer-toolbar relative z-20 mt-1 shrink-0 flex items-center justify-between gap-1 px-2 pb-2"
    >
      <div className="flex w-full items-center justify-between gap-1">
        {/* 左侧组：控件自带 px-2，间距收到 0.5 由它们自己的内边距承担分隔 */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-1 [scrollbar-width:none]">
          {onCollabModeChange && (
            <div className="shrink-0">
              <CollabModeSwitcher
                sessionId={draftSessionIdCollab}
                disabled={collabModeDisabled || isStreaming}
                modeOverride={collabModeOverride}
                onModeChange={onCollabModeChange}
              />
            </div>
          )}
          <div className="shrink-0">
            {readOnlyModel !== undefined ? (
              <ReadOnlyModelBadge model={readOnlyModel} />
            ) : (
              <ModelSwitcher modelRoute={modelRoute} sessionId={draftSessionId} />
            )}
          </div>
          <div className="shrink-0">
            <PersonaSwitcher sessionId={draftSessionId} />
          </div>
          {skillsMenuControl}
          {folderControl}
        </div>

        {/* 右侧组是图标按钮，没有 px-2 兜底，留一点间隔免得 hover 底色块粘连 */}
        <div className="flex shrink-0 items-center gap-1">
          <ClearConversationDialog
            show={showInlineClearConversation}
            hasMessages={hasMessages}
            isStreaming={isStreaming}
            activeSessionId={activeSessionId}
            queuedMessagesCount={queuedMessagesCount}
            onClearSession={onClearSession}
          />

          <ContextRing
            sessionId={draftSessionId}
            onCompressContext={onCompressContext}
            isCompressing={isContextCompressing}
          />
          {showPermissionControl ? permissionControl : null}
          {sendControl}
        </div>
      </div>
    </div>
  )
}
