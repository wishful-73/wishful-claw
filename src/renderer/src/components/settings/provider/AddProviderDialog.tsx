import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useProviderStore } from '@renderer/stores/provider-store'
import type { ProviderType } from '../../../../../shared/types/provider'
import { PROVIDER_TYPE_OPTIONS } from './constants'

export function AddProviderDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}): React.JSX.Element {
  const { t: ts } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const addCustomProvider = useProviderStore((s) => s.addCustomProvider)
  const fetchModels = useProviderStore((s) => s.fetchModels)
  const setModels = useProviderStore((s) => s.setModels)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProviderType>('openai-chat')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  const setActiveProvider = useProviderStore((s) => s.setActiveProvider)

  const handleAdd = (): void => {
    if (!name.trim()) return
    const provider = addCustomProvider(name.trim(), type, baseUrl.trim(), apiKey.trim())
    setActiveProvider(provider.id)
    toast.success(ts('provider.add.added', { name: name.trim() }))
    // Fire-and-forget model fetch right after adding: failures only toast and
    // never block the add flow (the key can still be completed in the panel).
    void fetchModels(provider)
      .then((models) => {
        if (models.length === 0) return
        setModels(provider.id, models)
        toast.success(ts('provider.config.models.fetchSuccess', { count: models.length }))
      })
      .catch((err) => {
        toast.error(ts('provider.config.models.fetchFailed'), {
          description: err instanceof Error ? err.message : String(err)
        })
      })
    setName('')
    setBaseUrl('')
    setApiKey('')
    setType('openai-chat')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{ts('provider.add.title')}</DialogTitle>
          <DialogDescription>{ts('provider.add.desc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">{ts('provider.add.name')}</label>
            <Input
              placeholder={ts('provider.add.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{ts('provider.add.type')}</label>
            <Select value={type} onValueChange={(v) => setType(v as ProviderType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPE_OPTIONS.map((tKey) => (
                  <SelectItem key={tKey} value={tKey}>
                    {ts(`provider.providerTypes.${tKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{ts('provider.add.baseUrl')}</label>
            <Input
              placeholder={ts('provider.add.baseUrlPlaceholder')}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{ts('provider.add.baseUrlHint')}</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{ts('provider.add.apiKey')}</label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder={ts('provider.add.apiKeyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pr-9"
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
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>{tc('actions.cancel')}</Button>
            <Button disabled={!name.trim()} onClick={handleAdd}>{tc('actions.add')}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
