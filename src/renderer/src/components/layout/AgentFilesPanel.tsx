import { useTranslation } from 'react-i18next'
import { FileTreePanel } from '@renderer/components/cowork/FileTreePanel'
import { ChangesPanel } from '@renderer/components/cowork/changes-panel'
import { useState } from 'react'
import { useChatStore } from '@renderer/stores/chat-store'
import { FileCode } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

export interface AgentFilesPanelProps {
  sessionId?: string | null
}

export function AgentFilesPanel(props: AgentFilesPanelProps) {
  const { t } = useTranslation('layout')
  const [activeTab, setActiveTab] = useState<'files' | 'changes'>('files')

  const sessionView = useChatStore(
    useShallow((state) => {
      const resolvedSessionId = props.sessionId ?? state.activeSessionId
      const currentSession = resolvedSessionId
        ? state.sessions.find((item) => item.id === resolvedSessionId)
        : undefined
      const currentProject = currentSession?.projectId
        ? state.projects.find((item) => item.id === currentSession.projectId)
        : undefined
      return {
        sessionId: resolvedSessionId,
        workingFolder: currentSession?.workingFolder ?? currentProject?.workingFolder ?? null
      }
    })
  )

  if (!sessionView.workingFolder) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-xs text-muted-foreground">
        <FileCode className="size-8 opacity-45" />
        <div className="text-sm font-medium">
          {t('agentFiles.noFolder', { defaultValue: 'No working folder' })}
        </div>
        <div className="max-w-64 leading-5">
          {t('agentFiles.noFolderDesc', {
            defaultValue: 'Select a working folder to browse files.'
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
        <button type="button" onClick={() => setActiveTab('files')} className={`rounded px-2 py-1 text-xs ${activeTab === 'files' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}>
          {t('agentFiles.files', { defaultValue: 'Files' })}
        </button>
        <button type="button" onClick={() => setActiveTab('changes')} className={`rounded px-2 py-1 text-xs ${activeTab === 'changes' ? 'bg-muted font-medium' : 'text-muted-foreground'}`}>
          {t('agentFiles.changes', { defaultValue: 'Changes' })}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {activeTab === 'files' ? <FileTreePanel sessionId={sessionView.sessionId} surface="agent" watchEnabled /> : <ChangesPanel workingFolder={sessionView.workingFolder} />}
      </div>
    </div>
  )
}
