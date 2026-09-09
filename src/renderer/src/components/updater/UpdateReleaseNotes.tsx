import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import {
  RELEASE_NOTES_COMPONENTS,
  RELEASE_NOTES_REHYPE_PLUGINS,
  RELEASE_NOTES_REMARK_PLUGINS
} from './release-notes-sanitizer'

interface UpdateReleaseNotesProps {
  notes: string
  expanded?: boolean
}

export function UpdateReleaseNotes({ notes, expanded = false }: UpdateReleaseNotesProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  if (!notes.trim()) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('updater.dialog.noNotes', { defaultValue: '本次发布未提供更新说明。' })}
      </p>
    )
  }

  return (
    <div
      className="max-h-48 overflow-y-auto rounded-md border bg-muted/30 p-3 text-xs text-foreground/85"
      style={expanded ? { maxHeight: 'none' } : undefined}
    >
      <Markdown
        remarkPlugins={RELEASE_NOTES_REMARK_PLUGINS}
        rehypePlugins={RELEASE_NOTES_REHYPE_PLUGINS}
        components={RELEASE_NOTES_COMPONENTS}
      >
        {notes}
      </Markdown>
    </div>
  )
}
