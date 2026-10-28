import { useTranslation } from 'react-i18next'
import { CODEGRAPH_PLUGIN_ID, type AppPluginDescriptor } from '@renderer/lib/app-plugin/types'
import { getToolStatusDescriptionKey, TOOL_ARG_LABELS } from './meta'

interface ToolStatusSectionProps {
  selectedDescriptor: AppPluginDescriptor
  selectedPluginId: string
  activeState: 'disabled' | 'not_ready' | 'ready'
}

export function ToolStatusSection({
  selectedDescriptor,
  selectedPluginId,
  activeState
}: ToolStatusSectionProps): React.JSX.Element {
  const { t } = useTranslation('settings')

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div>
        <p className="text-sm font-medium">{t('plugin.toolStatus')}</p>
        <p className="text-xs text-muted-foreground">
          {t(getToolStatusDescriptionKey(selectedDescriptor))}
        </p>
        {selectedPluginId === CODEGRAPH_PLUGIN_ID && activeState === 'ready' ? (
          <p className="text-xs text-emerald-600">{t('plugin.toolReadyCodeGraph')}</p>
        ) : null}
        {selectedPluginId === CODEGRAPH_PLUGIN_ID ? (
          <p className="text-xs text-muted-foreground">{t('plugin.toolConstraintCodeGraph')}</p>
        ) : null}
      </div>
      <div className="space-y-3">
        {selectedDescriptor.toolNames.map((toolName) => (
          <div key={toolName} className="rounded-lg border bg-muted/10 p-3">
            <p className="text-sm font-medium">{toolName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`plugin.status.${activeState}`)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{t(`plugin.toolArgsMap.${toolName}`)}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
              {TOOL_ARG_LABELS[toolName].map((label) => (
                <span key={label} className="rounded-full bg-muted px-2 py-0.5">
                  {label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
