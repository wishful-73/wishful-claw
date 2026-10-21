import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  Globe,
  MessageSquare,
  RefreshCw,
  ListChecks
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { useSkillsStore } from '@renderer/stores/skills-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { BrowserPanel } from '@renderer/components/layout/BrowserPanel'
import { FloatingChatWindow } from '@renderer/components/settings/floating-chat-window'
import { useFloatingChatSession } from '@renderer/components/settings/use-floating-chat-session'
import { InstalledTab } from '@renderer/components/settings/skill-installed-tab'
import { toast } from 'sonner'

const SKILLHUB_URL = 'https://skillhub.cn/'
const SKILL_MARKET_SESSION_ID = 'skill-market'

type TabId = 'installed' | 'market'

export function SkillPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const selectedSkill = useSkillsStore((s) => s.selectedSkill)
  const skillContent = useSkillsStore((s) => s.skillContent)
  const skillFiles = useSkillsStore((s) => s.skillFiles)
  const selectSkill = useSkillsStore((s) => s.selectSkill)
  const deleteSkill = useSkillsStore((s) => s.deleteSkill)
  const saveSkill = useSkillsStore((s) => s.saveSkill)
  const toggleSkillEnabled = useSkillsStore((s) => s.toggleSkillEnabled)

  const [activeTab, setActiveTab] = useState<TabId>('installed')
  const [searchQuery, setSearchQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState<string | null>(null)

  const browserUrl = useUIStore((s) => s.getBrowserState(SKILL_MARKET_SESSION_ID, null).url)
  const requestBrowserNavigation = useUIStore((s) => s.requestBrowserNavigation)

  const floatingChat = useFloatingChatSession()

  useEffect(() => {
    loadSkills()
    if (!browserUrl) {
      requestBrowserNavigation(SKILLHUB_URL, SKILL_MARKET_SESSION_ID, null)
    }
  }, [loadSkills, browserUrl, requestBrowserNavigation])

  const handleChatMessageSent = useCallback(() => {
    setTimeout(() => loadSkills(), 3000)
    setTimeout(() => loadSkills(), 8000)
  }, [loadSkills])

  const handleRefresh = useCallback(() => loadSkills(), [loadSkills])

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleAddFromFolder = async (): Promise<void> => {
    const result = (await ipcClient.invoke('fs:select-folder')) as {
      canceled?: boolean
      path?: string
    }
    if (result.canceled || !result.path) return
    const store = useSkillsStore.getState()
    const installResult = await store.addSkillFromFolder(result.path)
    if (installResult.success) {
      toast.success(t('skills.installed.installedSuccess', { name: installResult.name }))
    } else {
      toast.error(installResult.error ?? t('skills.installed.installFailed'))
    }
  }

  const handleDelete = async (name: string): Promise<void> => {
    const success = await deleteSkill(name)
    toast[success ? 'success' : 'error'](
      success ? t('skills.installed.deleted', { name }) : t('skills.installed.deleteFailed')
    )
  }

  const handleSave = async (): Promise<void> => {
    if (!selectedSkill || !editContent) return
    const success = await saveSkill(selectedSkill, editContent)
    toast[success ? 'success' : 'error'](
      success ? t('skills.installed.saved') : t('skills.installed.saveFailed')
    )
    if (success) setEditing(false)
  }

  const handleStartEdit = (): void => {
    if (skillContent) {
      setEditing(true)
      setEditContent(skillContent)
    }
  }

  const handleCancelEdit = (): void => {
    setEditing(false)
    setEditContent(null)
  }

  const handleToggleEnabled = useCallback(async (name: string, enabled: boolean) => {
    const success = await toggleSkillEnabled(name, enabled)
    if (!success) {
      toast.error(t('skills.installed.toggleFailed'))
    }
  }, [toggleSkillEnabled, t])

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ── Tab bar ── */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5 shrink-0">
        <button
          onClick={() => setActiveTab('installed')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'installed'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <ListChecks className="size-3.5" />
          {t('skills.tabs.installed')}
          {skills.length > 0 && (
            <span className="ml-0.5 rounded bg-muted px-1 text-[10px] tabular-nums">
              {skills.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('market')}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'market'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          )}
        >
          <Globe className="size-3.5" />
          {t('skills.tabs.market')}
        </button>

        <div className="flex-1" />

        {activeTab === 'installed' && (
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7" onClick={handleRefresh}>
                  <RefreshCw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('skills.installed.refresh')}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-7" onClick={handleAddFromFolder}>
                  <FolderOpen className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('skills.installed.installFromFolder')}</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* ── Tab content — both tabs stay mounted, hidden via CSS to preserve webview state ── */}
      <div className="flex-1 min-h-0">
        <div className={cn('h-full', activeTab !== 'installed' && 'hidden')}>
          <InstalledTab
            loading={loading}
            skills={filteredSkills}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedSkill={selectedSkill}
            onSelectSkill={selectSkill}
            skillContent={skillContent}
            skillFiles={skillFiles}
            editing={editing}
            editContent={editContent}
            onStartEdit={handleStartEdit}
            onEditChange={setEditContent}
            onCancelEdit={handleCancelEdit}
            onSave={handleSave}
            onDelete={handleDelete}
            onToggleEnabled={handleToggleEnabled}
            onBack={() => selectSkill(null)}
          />
        </div>
        <div className={cn('h-full', activeTab !== 'market' && 'hidden')}>
          <BrowserPanel sessionId={SKILL_MARKET_SESSION_ID} projectId={null} />
        </div>
      </div>

      {/* ── Floating Installer FAB (bottom-right) ── */}
      <div className="absolute bottom-4 right-4 z-30">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={floatingChat.isOpen ? 'secondary' : 'default'}
              size="icon"
              className="size-11 rounded-full shadow-lg"
              onClick={floatingChat.isOpen ? floatingChat.close : floatingChat.open}
            >
              <MessageSquare className="size-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {floatingChat.isOpen ? t('skills.market.closeInstaller') : t('skills.market.openInstaller')}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Floating chat window — docks to right side */}
      {floatingChat.isOpen && (
        <FloatingChatWindow
          sessionId={floatingChat.sessionId}
          ensureSession={floatingChat.ensureSession}
          onClose={floatingChat.close}
          onInstalled={handleChatMessageSent}
        />
      )}
    </div>
  )
}
