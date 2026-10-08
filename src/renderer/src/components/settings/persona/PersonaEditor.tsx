import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2, Save, RotateCcw, Sparkles } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { Textarea } from '@renderer/components/ui/textarea'
import { Input } from '@renderer/components/ui/input'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@renderer/components/ui/alert-dialog'
import {
  PERSONA_FILES,
  type PersonaConfig,
  type PersonaFileKey
} from '@renderer/lib/persona/persona-types'
import { cn } from '@renderer/lib/utils'

interface PersonaEditorProps {
  draft: PersonaConfig
  dirty: boolean
  isNew: boolean
  saving: boolean
  onChange: (field: keyof PersonaConfig, value: string) => void
  onSave: () => void
  onReset: () => void
  onDelete: (id: string) => void
  /** Opens the AI-assisted generator. Only offered while creating a new persona. */
  onAiCreate?: () => void
}

export function PersonaEditor({
  draft,
  dirty,
  isNew,
  saving,
  onChange,
  onSave,
  onReset,
  onDelete,
  onAiCreate
}: PersonaEditorProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const [activeTab, setActiveTab] = useState<PersonaFileKey>('identityMarkdown')

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Meta fields */}
      <div className="shrink-0 space-y-3 border-b px-6 py-4">
        {isNew && onAiCreate && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onAiCreate}>
              <Sparkles className="mr-1.5 size-3.5" />
              {t('persona.aiAssist', { defaultValue: 'AI 辅助创建' })}
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('persona.fieldName', { defaultValue: '名称' })}
            </label>
            <Input
              value={draft.name}
              onChange={(e) => onChange('name', e.target.value)}
              placeholder={t('persona.namePlaceholder', { defaultValue: '人格名称' })}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {t('persona.fieldTagline', { defaultValue: '标语' })}
            </label>
            <Input
              value={draft.tagline}
              onChange={(e) => onChange('tagline', e.target.value)}
              placeholder={t('persona.taglinePlaceholder', { defaultValue: '一句话描述' })}
              className="h-8 text-sm"
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            {t('persona.fieldDescription', { defaultValue: '描述' })}
          </label>
          <Input
            value={draft.description}
            onChange={(e) => onChange('description', e.target.value)}
            placeholder={t('persona.descriptionPlaceholder', { defaultValue: '更详细的描述' })}
            className="h-8 text-sm"
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex shrink-0 items-center gap-1 border-b px-6 py-2">
        {PERSONA_FILES.map((file) => (
          <button
            key={file.key}
            onClick={() => setActiveTab(file.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
              activeTab === file.key
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            )}
          >
            {file.label}
          </button>
        ))}
      </div>

      {/* Active file description */}
      <div className="shrink-0 px-6 pt-3">
        <p className="text-[11px] text-muted-foreground/70">
          {PERSONA_FILES.find((f) => f.key === activeTab)?.description}
        </p>
      </div>

      {/* Markdown editor */}
      <div className="min-h-0 flex-1 px-6 py-3">
        <Textarea
          value={draft[activeTab] as string}
          onChange={(e) => onChange(activeTab, e.target.value)}
          className="h-full min-h-[200px] resize-none font-mono text-[13px] leading-relaxed"
          placeholder={t('persona.editorPlaceholder', { defaultValue: '在此编写 Markdown 内容...' })}
        />
      </div>

      {/* Action bar */}
      <div className="flex shrink-0 items-center justify-between border-t px-6 py-3">
        <div className="flex items-center gap-2">
          {isNew ? (
            <Badge variant="outline" className="text-[11px]">
              {t('persona.newBadge', { defaultValue: '新建' })}
            </Badge>
          ) : draft.isBuiltin ? (
            <Badge variant="secondary" className="text-[11px]">
              {t('persona.builtin', { defaultValue: '内置' })}
            </Badge>
          ) : null}
          {dirty && (
            <span className="text-[11px] text-amber-500">
              {t('persona.unsaved', { defaultValue: '未保存' })}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onReset} disabled={!dirty || saving}>
            <RotateCcw className="mr-1.5 size-3.5" />
            {t('persona.reset', { defaultValue: '重置' })}
          </Button>

          {!isNew && !draft.isBuiltin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-1.5 size-3.5" />
                  {t('persona.delete', { defaultValue: '删除' })}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('persona.deleteConfirmTitle', { defaultValue: '删除人格' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('persona.deleteConfirmDesc', { defaultValue: '确定要删除「{{name}}」吗？此操作不可撤销。', name: draft.name })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>
                    {t('persona.cancel', { defaultValue: '取消' })}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => onDelete(draft.id)}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {t('persona.confirmDelete', { defaultValue: '删除' })}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button size="sm" variant="default" onClick={onSave} disabled={!dirty || saving}>
            {saving ? (
              <Spinner className="mr-1.5 size-3.5" />
            ) : (
              <Save className="mr-1.5 size-3.5" />
            )}
            {t('persona.save', { defaultValue: '保存' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
