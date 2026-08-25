import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Check,
  Search,
  Loader2,
  Globe2,
  ChevronDown
} from 'lucide-react'
import { isProviderAvailableForModelSelection, useProviderStore } from '@renderer/stores/provider-store'
import {
  useSettingsStore,
} from '@renderer/stores/settings-store'
import { useChatStore } from '@renderer/stores/chat-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { useQuotaStore } from '@renderer/stores/quota-store'
import { useUIStore } from '@renderer/stores/ui-store'

import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@renderer/components/ui/hover-card'

import {
  ProviderIcon,
  ModelIcon,
  AutoModelIcon
} from '@renderer/components/settings/provider-icons'
import { cn } from '@renderer/lib/utils'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import { type ProviderGroup, type ModelSwitcherSessionSnapshot, selectModel, selectFastModel, selectAutoModel, selectFollowGlobalModel } from './ModelSwitcher/utils'
import { ModelCapabilityTags, ModelHoverDetails } from './ModelSwitcher/model-info'
import { ModelSettingsPopover } from './ModelSwitcher/ModelSettingsPopover'
import { CodexQuotaIndicator, CopilotQuotaIndicator } from './ModelSwitcher/QuotaIndicators'

export function ModelSwitcher({
  modelRoute = 'main',
  sessionId
}: {
  modelRoute?: 'main' | 'fast'
  /**
   * Session this composer writes to. `null` means a new/draft session (home or
   * project home) — selections should target the global model so the freshly
   * created session inherits them. When omitted, falls back to the active session.
   */
  sessionId?: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  const { t: tChat } = useTranslation('chat')
  const { t: tSettings } = useTranslation('settings')
  const isFastRoute = modelRoute === 'fast'
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const autoModelRef = useRef<HTMLButtonElement>(null)
  const activeModelRef = useRef<HTMLButtonElement>(null)
  const hasAutoScrolledToSelectionRef = useRef(false)
  const activeProviderId = useProviderStore((s) => s.activeProviderId)
  const activeModelId = useProviderStore((s) => s.activeModelId)
  const activeFastProviderId = useProviderStore((s) => s.activeFastProviderId)
  const activeFastModelId = useProviderStore((s) => s.activeFastModelId)
  const providers = useProviderStore((s) => s.providers)
  const setActiveFastProvider = useProviderStore((s) => s.setActiveFastProvider)
  const setActiveFastModel = useProviderStore((s) => s.setActiveFastModel)
  const fastSelection = useProviderStore(
    useShallow((s) => {
      if (!isFastRoute) return { providerId: null as string | null, modelId: '' }
      const config = s.getFastProviderConfig()
      return {
        providerId: config?.providerId ?? null,
        modelId: config?.model ?? ''
      }
    })
  )
  const quotaByKey = useQuotaStore((s) => s.quotaByKey)
  const fallbackActiveSessionId = useChatStore((s) => s.activeSessionId)
  const activeSessionId = sessionId !== undefined ? sessionId : fallbackActiveSessionId
  const activeSession = useChatStore(
    useShallow((s): ModelSwitcherSessionSnapshot | null => {
      if (!activeSessionId) return null
      const indexed = s.sessionsById[activeSessionId]
      const session =
        indexed !== undefined && s.sessions[indexed]?.id === activeSessionId
          ? s.sessions[indexed]
          : s.sessions.find((item) => item.id === activeSessionId)
      if (!session) return null
      return {
        id: session.id,
        pluginId: session.pluginId,
        providerId: session.providerId,
        modelId: session.modelId,
        modelSelectionMode: session.modelSelectionMode
      }
    })
  )
  const activeChannelModelBinding = useChannelStore(
    useShallow((s) => {
      if (!activeSession?.pluginId) return { providerId: null, modelId: null }
      const channel = s.channels.find((item) => item.id === activeSession.pluginId)
      return {
        providerId: channel?.providerId ?? null,
        modelId: channel?.model ?? null
      }
    })
  )
  const mainModelSelectionMode = useSettingsStore((s) => s.mainModelSelectionMode)
  const { autoSelection, autoRoutingState } = useUIStore(
    useShallow((s) => ({
      autoSelection: activeSessionId
        ? (s.autoModelSelectionsBySession[activeSessionId] ?? null)
        : null,
      autoRoutingState: activeSessionId
        ? (s.autoModelRoutingStatesBySession[activeSessionId] ?? 'idle')
        : 'idle'
    }))
  )

  const enabledProviders = useMemo(
    () => (open ? providers.filter((p: any) => isProviderAvailableForModelSelection(p)) : []),
    [open, providers]
  )
  const sessionModelSelection = resolveSessionModelSelection({
    session: activeSession,
    providers,
    activeProviderId,
    activeModelId,
    globalMode: mainModelSelectionMode,
    channelProviderId: activeChannelModelBinding.providerId,
    channelModelId: activeChannelModelBinding.modelId
  })
  const displayProviderId = isFastRoute
    ? (fastSelection.providerId ?? activeFastProviderId ?? activeProviderId)
    : sessionModelSelection.providerId
  const displayModelId = isFastRoute
    ? fastSelection.modelId || activeFastModelId || activeModelId
    : sessionModelSelection.modelId
  const displayProvider = providers.find((p: any) => p.id === displayProviderId)
  const displayModel = displayProvider?.models.find((m: any) => m.id === displayModelId)
  const isAutoModeActive = !isFastRoute && sessionModelSelection.isAutoModeActive
  const isExplicitAutoActive =
    !isFastRoute &&
    (activeSession
      ? !activeSession.pluginId && sessionModelSelection.mode === 'auto'
      : mainModelSelectionMode === 'auto')
  const isFollowGlobalActive =
    !isFastRoute && Boolean(activeSession) && sessionModelSelection.mode === 'inherit'
  const autoResolvedProvider = autoSelection?.providerId
    ? providers.find((provider: any) => provider.id === autoSelection.providerId)
    : null
  const autoResolvedModel = autoResolvedProvider?.models.find(
    (model: any) => model.id === autoSelection?.modelId
  )
  const settingsProviderId = isAutoModeActive ? autoResolvedProvider?.id : displayProvider?.id
  const settingsModel = isAutoModeActive ? (autoResolvedModel ?? undefined) : displayModel
  const settingsPopoverSide = activeSession ? 'top' : 'bottom'
  const triggerLabel = isAutoModeActive
    ? autoRoutingState === 'routing'
      ? t('topbar.autoModel')
      : (autoSelection?.modelName ?? t('topbar.autoModel'))
    : (displayModel?.name ?? displayModelId ?? t('topbar.noModel'))
  const triggerAriaLabel = isAutoModeActive
    ? autoRoutingState === 'routing'
      ? t('topbar.autoModelRoutingShort')
      : t('topbar.autoModel')
    : (displayModel?.name ?? displayModelId ?? t('topbar.noModel'))
  const triggerProviderName = isAutoModeActive
    ? (autoResolvedProvider?.name ?? t('topbar.autoModel'))
    : (displayProvider?.name ?? null)
  const triggerModel = isAutoModeActive ? (autoResolvedModel ?? null) : (displayModel ?? null)
  const triggerProviderType = isAutoModeActive ? autoResolvedProvider?.type : displayProvider?.type
  const triggerDetail = isAutoModeActive
    ? autoRoutingState === 'routing'
      ? t('topbar.autoModelRouting')
      : autoSelection?.modelName
        ? t('topbar.autoModelTooltip', {
            route: t(
              autoSelection.target === 'main' ? 'topbar.autoModelMain' : 'topbar.autoModelFast'
            ),
            model: autoSelection.modelName,
            taskType: autoSelection.taskType ?? t('topbar.autoModelTaskTypeUnknown'),
            confidence: autoSelection.confidence ?? t('topbar.autoModelConfidenceUnknown'),
            complexity: autoSelection.complexity
              ? t(`topbar.autoModelComplexity.${autoSelection.complexity}`)
              : '',
            risk: autoSelection.risk ? t(`topbar.autoModelRisk.${autoSelection.risk}`) : '',
            reason: autoSelection.fallbackReason
              ? t(`topbar.autoModelFallback.${autoSelection.fallbackReason}`, {
                  defaultValue: autoSelection.fallbackReason
                })
              : ''
          })
        : t('topbar.autoModelTooltipIdle')
    : displayModelId && displayModel?.name && displayModel.name !== displayModelId
      ? displayModelId
      : null

  const codexQuota = useMemo(() => {
    if (!displayProvider || displayProvider.builtinId !== 'codex-oauth') return null
    const quota =
      quotaByKey[displayProvider.id] ||
      (displayProvider.builtinId ? quotaByKey[displayProvider.builtinId] : undefined) ||
      quotaByKey['codex'] ||
      null
    return quota?.type === 'codex' ? quota : null
  }, [displayProvider, quotaByKey])

  const copilotQuota = useMemo(() => {
    if (!displayProvider || displayProvider.builtinId !== 'copilot-oauth') return null
    const quota =
      quotaByKey[displayProvider.id] ||
      (displayProvider.builtinId ? quotaByKey[displayProvider.builtinId] : undefined) ||
      quotaByKey['copilot'] ||
      null
    return quota?.type === 'copilot' ? quota : null
  }, [displayProvider, quotaByKey])

  const groups = useMemo<ProviderGroup[]>(() => {
    if (!open) return []
    const q = search.toLowerCase().trim()
    return enabledProviders
      .map((provider: any) => {
        const models = provider.models.filter((m: any) => {
          if (!m.enabled) return false
          if (isFastRoute && (m.category ?? 'chat') !== 'chat') return false
          if (!q) return true
          const name = (m.name || m.id).toLowerCase()
          return name.includes(q) || provider.name.toLowerCase().includes(q)
        })
        return { provider, models }
      })
      .filter((g: any) => g.models.length > 0)
  }, [enabledProviders, isFastRoute, open, search])
  const selectedGroup = useMemo(
    () =>
      selectedProviderId
        ? (groups.find((group) => group.provider.id === selectedProviderId) ?? null)
        : null,
    [groups, selectedProviderId]
  )

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    setSelectedProviderId(null)
  }, [])

  useEffect(() => {
    if (!open) {
      hasAutoScrolledToSelectionRef.current = false
      return
    }

    const timer = setTimeout(() => {
      setSearch('')
      searchRef.current?.focus()
    }, 50)

    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (
      !open ||
      !selectedGroup ||
      isAutoModeActive ||
      search.trim() ||
      hasAutoScrolledToSelectionRef.current
    ) {
      return
    }

    const timer = setTimeout(() => {
      const target = activeModelRef.current
      const container = listRef.current
      if (!target || !container) return

      const containerRect = container.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const offsetTop = targetRect.top - containerRect.top + container.scrollTop
      const scrollTop = offsetTop - container.clientHeight / 2 + targetRect.height / 2

      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'auto'
      })
      hasAutoScrolledToSelectionRef.current = true
    }, 0)

    return () => clearTimeout(timer)
  }, [open, search, selectedGroup, isAutoModeActive])

  return (
    <div className="inline-flex h-8 items-center rounded-lg border border-transparent hover:border-border/50 hover:bg-muted/30 transition-colors">
      {/* Model icon trigger — opens model list */}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <HoverCard openDelay={180} closeDelay={100}>
          <HoverCardTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className="inline-flex h-8 max-w-56 items-center gap-1.5 rounded-l-lg px-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                aria-label={triggerAriaLabel}
                title={triggerAriaLabel}
              >
                {isAutoModeActive ? (
                  autoRoutingState === 'routing' ? (
                    <Loader2 size={15} className="shrink-0 animate-spin text-amber-500" />
                  ) : (
                    <AutoModelIcon size={17} className="shrink-0" />
                  )
                ) : (
                  <ModelIcon
                    icon={displayModel?.icon}
                    modelId={displayModelId ?? undefined}
                    providerBuiltinId={displayProvider?.builtinId}
                    size={18}
                  />
                )}
                <span className="truncate text-xs font-medium">{triggerLabel}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </button>
            </PopoverTrigger>
          </HoverCardTrigger>
          <HoverCardContent side="top" align="start" className="w-72 p-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-muted/45">
                {isAutoModeActive ? (
                  autoRoutingState === 'routing' ? (
                    <Loader2 size={16} className="animate-spin text-amber-500" />
                  ) : (
                    <AutoModelIcon size={18} />
                  )
                ) : (
                  <ModelIcon
                    icon={displayModel?.icon}
                    modelId={displayModelId ?? undefined}
                    providerBuiltinId={displayProvider?.builtinId}
                    size={20}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{triggerLabel}</div>
                {triggerProviderName && (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {triggerProviderName}
                  </div>
                )}
              </div>
            </div>
            {triggerDetail && (
              <div className="mt-2 break-words text-[11px] leading-4 text-muted-foreground/85">
                {triggerDetail}
              </div>
            )}
            {triggerModel && (
              <div className="mt-2 border-t border-border/60 pt-2">
                <ModelCapabilityTags
                  model={triggerModel}
                  providerType={triggerProviderType}
                  t={t}
                  showContext={false}
                />
                <ModelHoverDetails model={triggerModel} tSettings={tSettings} />
              </div>
            )}
          </HoverCardContent>
        </HoverCard>
        <PopoverContent
          className="w-64 max-w-[calc(100vw-2rem)] overflow-visible p-0"
          align="start"
          sideOffset={8}
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-3.5 text-muted-foreground/60 shrink-0" />
            <input
              ref={searchRef}
              type="text"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/40"
              placeholder={t('topbar.searchModel')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {!isFastRoute && activeSession && (
            <div className="border-b p-1">
              <button
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted/60 transition-colors group',
                  isFollowGlobalActive && 'bg-primary/5'
                )}
                onClick={() => selectFollowGlobalModel(activeSessionId, setOpen)}
              >
                <span className="mt-0.5 flex size-5 items-center justify-center shrink-0">
                  {isFollowGlobalActive ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/10">
                      <Check className="size-3 text-primary" />
                    </span>
                  ) : (
                    <Globe2 size={18} />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'truncate text-xs',
                      isFollowGlobalActive
                        ? 'font-semibold text-primary'
                        : 'text-foreground/80 group-hover:text-foreground'
                    )}
                  >
                    {t('topbar.followGlobalModel', {
                      defaultValue: 'Follow global model'
                    })}
                  </span>
                  <span className="line-clamp-2 text-[10px] text-muted-foreground">
                    {t('topbar.followGlobalModelDesc', {
                      defaultValue: 'Use the global main model setting for this session.'
                    })}
                  </span>
                </div>
              </button>
            </div>
          )}
          {!isFastRoute && !activeSession?.pluginId && (
            <div className="border-b p-1">
              <button
                ref={autoModelRef}
                className={cn(
                  'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-muted/60 transition-colors group',
                  isExplicitAutoActive && 'bg-primary/5'
                )}
                onClick={() => selectAutoModel(activeSessionId, setOpen)}
              >
                <span className="mt-0.5 flex size-5 items-center justify-center shrink-0">
                  {isExplicitAutoActive ? (
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/10">
                      <Check className="size-3 text-primary" />
                    </span>
                  ) : (
                    <AutoModelIcon size={18} />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span
                    className={cn(
                      'truncate text-xs',
                      isExplicitAutoActive
                        ? 'font-semibold text-primary'
                        : 'text-foreground/80 group-hover:text-foreground'
                    )}
                  >
                    {t('topbar.autoModel')}
                  </span>
                  <span className="line-clamp-2 text-[10px] text-muted-foreground">
                    {autoRoutingState === 'routing'
                      ? t('topbar.autoModelRouting')
                      : autoSelection?.modelName
                        ? t('topbar.autoModelTooltip', {
                            route: t(
                              autoSelection.target === 'main'
                                ? 'topbar.autoModelMain'
                                : 'topbar.autoModelFast'
                            ),
                            model: autoSelection.modelName,
                            taskType:
                              autoSelection.taskType ?? t('topbar.autoModelTaskTypeUnknown'),
                            confidence:
                              autoSelection.confidence ?? t('topbar.autoModelConfidenceUnknown'),
                            complexity: autoSelection.complexity
                              ? t(`topbar.autoModelComplexity.${autoSelection.complexity}`)
                              : '',
                            risk: autoSelection.risk
                              ? t(`topbar.autoModelRisk.${autoSelection.risk}`)
                              : '',
                            reason: autoSelection.fallbackReason
                              ? t(`topbar.autoModelFallback.${autoSelection.fallbackReason}`, {
                                  defaultValue: autoSelection.fallbackReason
                                })
                              : ''
                          })
                        : t('topbar.autoModelDesc')}
                  </span>
                </div>
              </button>
            </div>
          )}
          <div className="p-1">
            <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {t('topbar.providers')}
            </div>
            <div className="max-h-[328px] overflow-y-auto">
              {groups.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-muted-foreground/50">
                  {enabledProviders.length === 0 ? t('topbar.noProviders') : t('topbar.noModels')}
                </div>
              ) : (
                groups.map(({ provider, models }) => {
                  const isSelected = provider.id === selectedGroup?.provider.id
                  const isDisplayProvider = provider.id === displayProviderId && !isAutoModeActive
                  return (
                    <Popover
                      key={provider.id}
                      open={selectedProviderId === provider.id}
                      onOpenChange={(nextOpen) => {
                        if (nextOpen) setSelectedProviderId(provider.id)
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/70',
                            isSelected && 'bg-background shadow-sm',
                            isDisplayProvider && !isSelected && 'text-primary'
                          )}
                          onFocus={() => setSelectedProviderId(provider.id)}
                          onMouseEnter={() => setSelectedProviderId(provider.id)}
                          onClick={() => setSelectedProviderId(provider.id)}
                        >
                          <ProviderIcon builtinId={provider.builtinId} size={16} />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {provider.name}
                          </span>
                          <span
                            className={cn(
                              'rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground',
                              isDisplayProvider && 'bg-primary/10 text-primary'
                            )}
                          >
                            {models.length}
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden p-1"
                        align="start"
                        side="right"
                        sideOffset={6}
                      >
                        <div className="sticky top-0 z-10 mb-1 flex items-center gap-2 border-b bg-popover/95 px-2 py-1.5 backdrop-blur">
                          <ProviderIcon builtinId={provider.builtinId} size={14} />
                          <span className="min-w-0 flex-1 truncate text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                            {provider.name}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground/50">
                            {t('topbar.modelsCount', { count: models.length })}
                          </span>
                        </div>
                        <div
                          ref={selectedProviderId === provider.id ? listRef : undefined}
                          className="max-h-[344px] overflow-y-auto"
                        >
                          {models.map((m) => {
                            const isActive =
                              !isAutoModeActive &&
                              provider.id === displayProviderId &&
                              m.id === displayModelId
                            return (
                              <button
                                key={`${provider.id}-${m.id}`}
                                ref={isActive ? activeModelRef : undefined}
                                className={cn(
                                  'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/60 group',
                                  isActive && 'bg-primary/5'
                                )}
                                onClick={() =>
                                  isFastRoute
                                    ? selectFastModel(
                                        provider,
                                        m.id,
                                        activeFastProviderId,
                                        setActiveFastProvider,
                                        setActiveFastModel,
                                        setOpen
                                      )
                                    : selectModel(provider, m.id, activeSessionId, setOpen)
                                }
                              >
                                <span className="mt-0.5 shrink-0">
                                  {isActive ? (
                                    <span className="flex size-5 items-center justify-center rounded-full bg-primary/10">
                                      <Check className="size-3 text-primary" />
                                    </span>
                                  ) : (
                                    <ModelIcon
                                      icon={m.icon}
                                      modelId={m.id}
                                      providerBuiltinId={provider.builtinId}
                                      size={20}
                                    />
                                  )}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <span
                                    className={cn(
                                      'truncate text-xs',
                                      isActive
                                        ? 'font-semibold text-primary'
                                        : 'text-foreground/80 group-hover:text-foreground'
                                    )}
                                  >
                                    {m.name || m.id.replace(/-\d{8}$/, '')}
                                  </span>
                                  <ModelCapabilityTags
                                    model={m}
                                    providerType={provider.type}
                                    t={t}
                                  />
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )
                })
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Quota Indicators */}
      {codexQuota && <CodexQuotaIndicator quota={codexQuota} tSettings={tSettings} />}
      {copilotQuota && <CopilotQuotaIndicator quota={copilotQuota as any} tSettings={tSettings} />}
      {/* Settings / Thinking trigger — ModelSettingsPopover renders a brain icon
          with effort label for thinking-capable models, or a gear icon otherwise */}
      <ModelSettingsPopover
        model={settingsModel}
        providerId={settingsProviderId}
        providerType={isAutoModeActive ? autoResolvedProvider?.type : displayProvider?.type}
        providerWebsocketMode={
          isAutoModeActive ? autoResolvedProvider?.websocketMode : displayProvider?.websocketMode
        }
        side={settingsPopoverSide}
        t={t}
        tChat={tChat}
        tSettings={tSettings}
      />
    </div>
  )
}
