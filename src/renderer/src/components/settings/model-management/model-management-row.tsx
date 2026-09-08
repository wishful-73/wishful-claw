import { Brain, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { Switch } from '@renderer/components/ui/switch'
import { ProviderIcon, ModelIcon } from '../provider-icons'
import { cn } from '@renderer/lib/utils'
import type { ManagedModelConfig } from '@renderer/stores/managed-models'
import type { ManagedModelProviderSource } from './provider-source-index'
import { getCapabilityIndicators } from './model-capability-helpers'
import { toRoundedTokenThousands } from '../provider/constants'

interface ModelManagementRowProps {
  model: ManagedModelConfig
  providerSources: ManagedModelProviderSource[]
  onEdit: (model: ManagedModelConfig) => void
  onEditThinking: (model: ManagedModelConfig) => void
  onDelete: (model: ManagedModelConfig) => void
  onToggle: (model: ManagedModelConfig) => void
}

export function ModelManagementRow({
  model,
  providerSources,
  onEdit,
  onEditThinking,
  onDelete,
  onToggle
}: ModelManagementRowProps): React.JSX.Element {
  const { t } = useTranslation('settings')
  const capabilityIndicators = getCapabilityIndicators(model)
  const primarySource = providerSources[0]
  const visibleSources = providerSources.slice(0, 4)
  const hiddenCount = Math.max(0, providerSources.length - 4)

  return (
    <div
      className={cn(
        'group flex items-center gap-3 border-b border-border/60 px-5 py-3 transition-colors last:border-b-0 hover:bg-muted/25',
        model.enabled ? '' : 'bg-muted/10 opacity-75'
      )}
    >
      <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/45 ring-1 ring-border/60">
        <ModelIcon
          icon={model.icon}
          modelId={model.id}
          providerBuiltinId={primarySource?.builtinId}
          size={20}
          className="shrink-0 opacity-80"
        />
        {primarySource && (
          <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border border-background bg-background shadow-sm">
            <ProviderIcon builtinId={primarySource.builtinId} size={13} />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-medium">{model.name}</p>
          {!model.enabled && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t('provider.disabled')}
            </span>
          )}
          <span className="truncate font-mono text-[10px] text-muted-foreground/50">{model.id}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground/60">
          {providerSources.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/20 px-2 py-1 text-muted-foreground/80">
                  <span className="flex -space-x-1.5">
                    {visibleSources.map((source) => (
                      <span
                        key={source.key}
                        className="flex size-5 items-center justify-center rounded-full border border-background bg-background shadow-xs"
                      >
                        <ProviderIcon builtinId={source.builtinId} size={13} />
                      </span>
                    ))}
                  </span>
                  <span className="truncate">{t('provider.modelManagementSourceCount', { count: providerSources.length })}</span>
                  {hiddenCount > 0 && <span className="shrink-0">+{hiddenCount}</span>}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-[11px]">
                <div className="flex max-w-64 flex-col gap-1">
                  {providerSources.map((source) => (
                    <div key={source.key} className="flex items-center gap-1.5">
                      <ProviderIcon builtinId={source.builtinId} size={12} />
                      <span className="min-w-0 flex-1 truncate">{source.name}</span>
                      <span className="text-muted-foreground/70">
                        {source.configured
                          ? source.enabled
                            ? t('provider.enabled')
                            : t('provider.disabled')
                          : t('provider.modelManagementPresetProvider')}
                      </span>
                    </div>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border bg-muted/20 px-2 py-1 text-muted-foreground/80">
              <ProviderIcon size={13} />
              {t('provider.modelManagementNoSource')}
            </span>
          )}

          {model.contextLength && (
            <span className="rounded-full bg-muted/45 px-2 py-0.5">
              {toRoundedTokenThousands(model.contextLength)}K ctx
            </span>
          )}
          {model.maxOutputTokens && (
            <span className="rounded-full bg-muted/45 px-2 py-0.5">
              {toRoundedTokenThousands(model.maxOutputTokens)}K out
            </span>
          )}
          {(model.inputPrice != null || model.outputPrice != null) && (
            <span className="rounded-full bg-muted/45 px-2 py-0.5">
              ${model.inputPrice ?? '?'}/{model.outputPrice ?? '?'}
            </span>
          )}
          {capabilityIndicators.length > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground/60">
              {capabilityIndicators.map(({ key, icon: Icon }) => (
                <Tooltip key={`${model.normalizedKey}-${key}`}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                      <Icon className="size-3" />
                    </span>
                  </TooltipTrigger>
                </Tooltip>
              ))}
            </span>
          )}
        </div>
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('provider.editModel')}
            className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/45 transition-colors hover:bg-muted hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
            onClick={() => onEdit(model)}
          >
            <Pencil className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">{t('provider.editModel')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={model.supportsThinking ? t('provider.editThinkConfig') : t('provider.configThinkSupport')}
            className={cn(
              'flex size-7 items-center justify-center rounded-lg transition-colors hover:bg-muted lg:opacity-0 lg:group-hover:opacity-100',
              model.supportsThinking ? 'text-violet-500' : 'text-muted-foreground/45 hover:text-foreground'
            )}
            onClick={() => onEditThinking(model)}
          >
            <Brain className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-[11px]">
          {model.supportsThinking ? t('provider.editThinkConfig') : t('provider.configThinkSupport')}
        </TooltipContent>
      </Tooltip>
      <button
        type="button"
        aria-label={t('common:action.delete', { defaultValue: 'Delete' })}
        className="flex size-7 items-center justify-center rounded-lg text-muted-foreground/45 transition-colors hover:text-destructive lg:opacity-0 lg:group-hover:opacity-100"
        onClick={() => onDelete(model)}
      >
        <Trash2 className="size-3.5" />
      </button>
      <div className="rounded-full border bg-background px-1 py-0.5">
        <Switch
          checked={model.enabled}
          onCheckedChange={() => onToggle(model)}
          aria-label={t('provider.enabled')}
        />
      </div>
    </div>
  )
}
