import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Trash2, ExternalLink, RotateCcw } from 'lucide-react'
import { RequestHeadersEditor } from './RequestHeadersEditor'
import { CollapsibleSection } from './CollapsibleSection'
import { ProviderModelsSection } from './ProviderModelsSection'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { Separator } from '@renderer/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useProviderStore } from '@renderer/stores/provider-store'
import type { AIProvider, ProviderType } from '../../../../../shared/types/provider'
import { PROVIDER_TYPE_OPTIONS_EDIT } from './constants'
import { ProviderIcon } from '../provider-icons'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

/**
 * Provider detail panel: identity, credentials, endpoint and the two rarely
 * touched settings. The model list lives in `ProviderModelsSection` — the file
 * was past the 500-line limit with the models markup in it.
 */
export function ProviderConfigPanel({ provider }: { provider: AIProvider }): React.JSX.Element {
  const { t: ts } = useTranslation('settings')
  const { t: tc } = useTranslation('common')

  const updateProvider = useProviderStore((s) => s.updateProvider)
  const deleteProvider = useProviderStore((s) => s.deleteProvider)
  const fetchModels = useProviderStore((s) => s.fetchModels)
  const setModels = useProviderStore((s) => s.setModels)

  const [showKey, setShowKey] = useState(false)
  const [showDeleteProvider, setShowDeleteProvider] = useState(false)
  // 焦点进入 Key 输入框时的值。失焦时靠它判断「是不是从没填变成填了」，
  // 避免用户只是点进去又点出来也触发一遍自动启用 + 拉模型。
  const apiKeyBeforeEditRef = useRef<string | null>(null)

  // 折叠后看不到编辑器内容，用条数告诉用户「这里面有东西」
  const headerCount = Object.keys(provider.requestOverrides?.headers ?? {}).length

  // 首次填入 API Key 后自动启用该服务商并拉一次模型列表：
  // 先填 Key、再去拨开关、再点「获取模型」本是三步，可以合成一步。
  const handleApiKeyBlur = async (): Promise<void> => {
    const before = apiKeyBeforeEditRef.current ?? ''
    apiKeyBeforeEditRef.current = null
    // 只在「原先没 Key -> 现在填了」这一步上联动。已配好的服务商换 Key 不必重新启用，
    // 也不该重复拉模型（会把用户手动关掉的模型重新打开）。
    if (before.trim() || !provider.apiKey.trim()) return
    if (!provider.enabled) updateProvider(provider.id, { enabled: true })
    // 取 store 里的最新值：onBlur 闭包捕获的 provider 可能落后于最后一次按键
    const latest = useProviderStore.getState().providers.find((p) => p.id === provider.id) ?? provider
    try {
      const models = await fetchModels(latest)
      if (models.length > 0) {
        setModels(provider.id, models)
        toast.success(ts('provider.config.models.fetchSuccess', { count: models.length }))
      }
    } catch {
      // 自动流程失败保持安静：服务商已经启用，用户可以在模型区手动重试
    }
  }

  // requestOverrides is merged shallowly by updateProvider, so preserve the
  // sibling body / omitBodyKeys keys when replacing the header map.
  const handleHeadersChange = (headers: Record<string, string>): void => {
    updateProvider(provider.id, {
      requestOverrides: { ...(provider.requestOverrides ?? {}), headers }
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border/60">
            <ProviderIcon builtinId={provider.builtinId} size={20} />
          </span>
          <div>
            <h3 className="text-sm font-semibold">{provider.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {ts(`provider.providerTypes.${provider.type}`)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* R-9.6: builtins are never really "deleted" — they are re-projected from their
              preset, so the action is presented as restoring factory defaults. */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            title={provider.builtinId ? ts('provider.config.resetBuiltin.tooltip') : undefined}
            onClick={() => setShowDeleteProvider(true)}
          >
            {provider.builtinId ? <RotateCcw className="size-3.5" /> : <Trash2 className="size-3.5" />}
          </Button>
          <Switch
            checked={provider.enabled}
            onCheckedChange={(checked) => updateProvider(provider.id, { enabled: checked })}
          />
        </div>
      </div>

      {/* Config body: upper sections keep natural height; the models section is
          the last element and stretches to fill all remaining vertical space,
          so only the model list itself scrolls. */}
      <div className="flex flex-1 min-h-0 flex-col overflow-x-hidden px-5 pt-4 pb-4">
        {/* Official website: builtins keep the preset link; custom providers get an editable field */}
        {provider.builtinId && provider.homepage ? (
          <section className="mb-4 flex min-w-0 shrink-0 items-center gap-2">
            <label className="shrink-0 text-sm font-medium">{ts('provider.config.officialWebsite')}</label>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="min-w-0 justify-start gap-1 p-0 text-left text-xs font-normal"
              title={provider.homepage}
              onClick={() => void window.api.invoke<void>('shell:openExternal', provider.homepage!)}
            >
              <ExternalLink className="size-3 shrink-0" />
              <span className="break-all whitespace-normal">{provider.homepage}</span>
            </Button>
          </section>
        ) : !provider.builtinId ? (
          <section className="mb-4 shrink-0 space-y-2">
            <label className="text-sm font-medium">{ts('provider.config.officialWebsite')}</label>
            <div className="flex items-center gap-2">
              <Input
                placeholder={ts('provider.add.homepagePlaceholder')}
                value={provider.homepage ?? ''}
                onChange={(e) => updateProvider(provider.id, { homepage: e.target.value })}
                className="min-w-0 flex-1 text-xs"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                disabled={!provider.homepage?.trim()}
                title={provider.homepage?.trim() || undefined}
                onClick={() => {
                  const url = provider.homepage?.trim()
                  if (url) void window.api.invoke<void>('shell:openExternal', url)
                }}
              >
                <ExternalLink className="size-3 shrink-0" />
                {ts('provider.config.openHomepage')}
              </Button>
            </div>
          </section>
        ) : null}

        {/* API Key */}
        <section className="shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{ts('provider.config.apiKey')}</label>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder={provider.requiresApiKey === false ? ts('provider.config.apiKeyNotRequired') : ts('provider.config.apiKeyPlaceholder')}
                value={provider.apiKey}
                onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                onFocus={() => {
                  apiKeyBeforeEditRef.current = provider.apiKey
                }}
                onBlur={() => void handleApiKeyBlur()}
                disabled={provider.requiresApiKey === false}
                className="pr-9 text-xs"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                tabIndex={-1}
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
        </section>

        {/* Base URL */}
        <section className="mt-4 shrink-0 space-y-2">
          <label className="text-sm font-medium">{ts('provider.config.baseUrl')}</label>
          <Input
            placeholder="https://api.openai.com/v1"
            value={provider.baseUrl}
            onChange={(e) => updateProvider(provider.id, { baseUrl: e.target.value })}
            className="text-xs"
          />
        </section>

        {/* Protocol type — collapsed: almost nobody changes it. The current value
            stays readable in the header above, so no badge is needed here. */}
        <CollapsibleSection title={ts('provider.config.protocolType')}>
          <Select
            value={provider.type}
            onValueChange={(v) => updateProvider(provider.id, { type: v as ProviderType, typeOverridden: true })}
          >
            <SelectTrigger className="text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROVIDER_TYPE_OPTIONS_EDIT.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {ts(`provider.providerTypes.${t}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-[11px] text-muted-foreground">{ts('provider.config.protocolTypeHint')}</p>
        </CollapsibleSection>

        {/* Extra request headers */}
        <CollapsibleSection
          title={ts('provider.config.requestHeaders.title')}
          badge={headerCount > 0 ? headerCount : null}
        >
          <RequestHeadersEditor
            key={provider.id}
            headers={provider.requestOverrides?.headers}
            onChange={handleHeadersChange}
          />
        </CollapsibleSection>

        {/* Anthropic cache TTL (provider-level) */}
        {provider.type === 'anthropic' && (
          <section className="mt-5 shrink-0 space-y-2">
            <label className="text-sm font-medium">{ts('provider.config.cacheTtl')}</label>
            <Select
              value={provider.cacheTtl ?? '5m'}
              onValueChange={(v) => updateProvider(provider.id, { cacheTtl: v as '5m' | '1h' })}
            >
              <SelectTrigger className="w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5m">5m</SelectItem>
                <SelectItem value="1h">1h</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{ts('provider.config.cacheTtlHint')}</p>
          </section>
        )}

        <Separator className="my-5 shrink-0" />

        {/* Models. The section carries its own dialogs with it; they portal to
            document.body, so being rendered inside this scroll container is not
            observable in the DOM. */}
        <ProviderModelsSection provider={provider} />
      </div>

      {/* Delete provider confirmation */}
      <AlertDialog open={showDeleteProvider} onOpenChange={setShowDeleteProvider}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {provider.builtinId
                ? ts('provider.config.resetBuiltin.title')
                : tc('confirmDelete.deleteProvider.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {provider.builtinId
                ? ts('provider.config.resetBuiltin.description')
                : tc('confirmDelete.deleteProvider.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteProvider(provider.id)
                toast.success(
                  provider.builtinId
                    ? ts('provider.config.resetBuiltin.done')
                    : ts('provider.list.providerDeleted')
                )
                setShowDeleteProvider(false)
              }}
            >
              {provider.builtinId
                ? ts('provider.config.resetBuiltin.action')
                : tc('confirmDelete.deleteProvider.action')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
