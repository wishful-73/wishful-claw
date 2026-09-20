import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import { Textarea } from '@renderer/components/ui/textarea'

import {
  type FileState,
  DEFAULT_MEMORY_TEMPLATE,
  readTextFile,
  writeTextFile
} from './project-archive-helpers'

/**
 * Editable project MEMORY.md (split out of ProjectArchivePage for the 500-line budget).
 *
 * Self-contained on purpose: it owns loading, saving and dirty state, so the page only hands it
 * a path. An external refresh is expressed by remounting with a new `key`.
 */
function ProjectMemoryFileTab({ path }: { path: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tCommon } = useTranslation('common')

  const [file, setFile] = useState<FileState>({
    path: '',
    savedContent: '',
    draftContent: '',
    loading: true,
    saving: false,
    missingFile: true,
    error: null
  })

  const load = useCallback(async () => {
    if (!path) {
      setFile((prev) => ({ ...prev, loading: false, path: '' }))
      return
    }
    setFile((prev) => ({ ...prev, loading: true, path, error: null }))
    const result = await readTextFile(path)
    if (result.error) {
      // ENOENT — file doesn't exist yet
      const isMissing =
        result.error.toLowerCase().includes('no such') ||
        result.error.toLowerCase().includes('enotfound') ||
        result.error.toLowerCase().includes('找不到')
      setFile({
        path,
        savedContent: isMissing ? DEFAULT_MEMORY_TEMPLATE : '',
        draftContent: isMissing ? DEFAULT_MEMORY_TEMPLATE : '',
        loading: false,
        saving: false,
        missingFile: isMissing,
        error: isMissing ? null : result.error
      })
    } else {
      setFile({
        path,
        savedContent: result.content ?? '',
        draftContent: result.content ?? '',
        loading: false,
        saving: false,
        missingFile: false,
        error: null
      })
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!file.path) return

    setFile((prev) => ({ ...prev, saving: true, error: null }))

    const err = await writeTextFile(file.path, file.draftContent)
    if (err) {
      setFile((prev) => ({ ...prev, saving: false, error: err }))
      toast.error(t('projectArchive.saveFailed', { defaultValue: 'Failed to save' }), {
        description: err
      })
    } else {
      setFile((prev) => ({
        ...prev,
        saving: false,
        savedContent: prev.draftContent,
        missingFile: false,
        error: null
      }))
      toast.success(t('projectArchive.saved', { defaultValue: 'Saved' }))
    }
  }, [file, t])

  const handleReset = useCallback(() => {
    setFile((prev) => ({ ...prev, draftContent: prev.savedContent, error: null }))
  }, [])

  const hasUnsavedChanges = file.draftContent !== file.savedContent
  const canSave = file.missingFile || hasUnsavedChanges

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <FileText className="size-4 shrink-0" />
          <span className="truncate text-xs">
            {file.path || t('projectArchive.pathUnavailable', { defaultValue: 'Path unavailable' })}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file.missingFile && (
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
              {t('projectArchive.notCreated', { defaultValue: 'Not yet created' })}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {hasUnsavedChanges
              ? t('projectArchive.unsavedState', { defaultValue: 'Unsaved changes' })
              : t('projectArchive.savedState', { defaultValue: 'Content synced' })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={handleReset}
            disabled={!hasUnsavedChanges}
          >
            {t('projectArchive.resetAction', { defaultValue: 'Reset' })}
          </Button>
          <Button
            size="sm"
            className="h-7 rounded-md px-2.5 text-xs"
            onClick={() => void handleSave()}
            disabled={file.saving || !canSave}
          >
            {file.saving ? (
              <Loader2 className="mr-1 size-3 animate-spin" />
            ) : (
              <Save className="mr-1 size-3" />
            )}
            {tCommon('action.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      </div>

      {file.missingFile && (
        <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          {t('projectArchive.missingFileHint', {
            defaultValue:
              'File does not exist yet. An initial template has been loaded — click Save to create it.'
          })}
        </p>
      )}

      <div className="mt-3 flex-1 overflow-auto">
        {file.loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('projectArchive.loading', { defaultValue: 'Loading...' })}
          </div>
        ) : (
          <Textarea
            value={file.draftContent}
            onChange={(e) => {
              const value = e.target.value
              setFile((prev) => ({ ...prev, draftContent: value }))
            }}
            placeholder={t('projectArchive.placeholder', {
              defaultValue: 'Edit content here...'
            })}
            rows={24}
            className="min-h-[480px] w-full rounded-md border-border/60 bg-background font-mono text-xs leading-5"
          />
        )}
      </div>

      {file.error && (
        <div className="border-t px-5 py-3 text-sm text-destructive">
          {t('projectArchive.errorLabel', { defaultValue: 'Error: ' })}
          {file.error}
        </div>
      )}
    </div>
  )
}

export default ProjectMemoryFileTab
