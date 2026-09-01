import { useTranslation } from 'react-i18next'

interface UpdateReleaseNotesProps {
  notes: string
}

export function UpdateReleaseNotes({ notes }: UpdateReleaseNotesProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  if (!notes.trim()) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('updater.dialog.noNotes', { defaultValue: '本次发布未提供更新说明。' })}
      </p>
    )
  }

  return (
    <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3">
      <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-foreground/85">
        {notes}
      </pre>
    </div>
  )
}
