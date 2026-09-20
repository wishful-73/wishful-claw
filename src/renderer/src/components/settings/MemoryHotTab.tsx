import { useCallback, useEffect, useState } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'
import { memoryRead, memoryWrite } from '@renderer/stores/chat-store/memory-helpers'
import { SettingsSection, SettingHint } from './settings-primitives'

/**
 * Global hot memory — `MEMORY.md` for scope `global` (iter-33 S-96).
 *
 * Editable on purpose, unlike the regular-memory tab next to it: the hot file is
 * the one memory surface a user can meaningfully hand-tune, and the project
 * archive page already exposes the same file for editing. Writes go through
 * `memory/write`, which is a WHOLE-FILE overwrite for the given scope — the copy
 * says so instead of implying a per-section edit, because clobbering the file by
 * accident is the failure mode worth preventing here.
 *
 * Scope is hard-coded to `global`: this page is the global settings page, so
 * there is no session or project context to resolve a narrower scope from.
 */
function MemoryHotTab(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [savedContent, setSavedContent] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await memoryRead('global')
      const content = result.content ?? ''
      setSavedContent(content)
      setDraftContent(content)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      setSavedContent('')
      setDraftContent('')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const hasUnsavedChanges = draftContent !== savedContent

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      // No sessionId: this write is session-independent, so there is no next
      // turn to announce it on (see memory-helpers.memoryWrite).
      await memoryWrite('global', draftContent)
      setSavedContent(draftContent)
      toast.success(t('memoryPage.hot.saved'))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      toast.error(t('memoryPage.hot.saveFailed'), { description: message })
    } finally {
      setSaving(false)
    }
  }, [draftContent, t])

  return (
    <SettingsSection
      id="sec-memory-hot"
      title={t('memoryPage.hot.title')}
      description={t('memoryPage.hot.desc')}
      actions={
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={() => setDraftContent(savedContent)}
            disabled={!hasUnsavedChanges || saving}
          >
            <RotateCcw className="mr-1 size-3" />
            {t('memoryPage.hot.reset')}
          </Button>
          <Button
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={() => void handleSave()}
            disabled={!hasUnsavedChanges || saving}
          >
            {saving ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Save className="mr-1 size-3" />
            )}
            {t('memoryPage.hot.save')}
          </Button>
        </>
      }
    >
      <SettingHint>
        {hasUnsavedChanges ? t('memoryPage.hot.unsavedState') : t('memoryPage.hot.syncedState')}
      </SettingHint>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t('memoryPage.hot.loadFailed')}: {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          {t('memoryPage.hot.loading')}
        </div>
      ) : (
        <Textarea
          value={draftContent}
          onChange={(e) => setDraftContent(e.target.value)}
          placeholder={t('memoryPage.hot.placeholder')}
          rows={20}
          spellCheck={false}
          className="min-h-[420px] w-full rounded-md border-border/60 bg-background font-mono text-xs leading-5"
        />
      )}
    </SettingsSection>
  )
}

export default MemoryHotTab
