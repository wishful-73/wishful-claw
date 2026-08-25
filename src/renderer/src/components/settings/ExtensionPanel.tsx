import { useEffect, useState } from 'react'
import { FolderOpen, FolderPlus, Puzzle, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Switch } from '@renderer/components/ui/switch'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { refreshExtensionTools } from '@renderer/lib/extensions/extension-tools'
import { useExtensionStore } from '@renderer/stores/extension-store'
import type { ExtensionInstance } from '../../../../shared/extension-types'

function ExtensionDetail({
  extension,
  onClose
}: {
  extension: ExtensionInstance
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const updateExtension = useExtensionStore((state) => state.updateExtension)
  const removeExtension = useExtensionStore((state) => state.removeExtension)
  const openExtensionFolder = useExtensionStore((state) => state.openExtensionFolder)
  const [config, setConfig] = useState(extension.config)
  const [saving, setSaving] = useState(false)

  useEffect(() => setConfig(extension.config), [extension.config])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const result = await updateExtension(extension.id, { config })
      if (!result.success) throw new Error(result.error ?? '保存扩展配置失败')
      await refreshExtensionTools()
      toast.success(t('extension.saved', { defaultValue: '扩展配置已保存' }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!(await confirm({
      title: t('extension.removeConfirm', { defaultValue: '移除这个扩展？' }),
      description: extension.manifest.name,
      variant: 'destructive'
    }))) return
    const result = await removeExtension(extension.id)
    if (!result.success) {
      toast.error(result.error ?? '移除扩展失败')
      return
    }
    await refreshExtensionTools()
    onClose()
    toast.success(t('extension.removed', { defaultValue: '扩展已移除' }))
  }

  return (
    <div className="space-y-4 rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{extension.manifest.name}</h2>
          <p className="text-xs text-muted-foreground">{extension.id} · v{extension.manifest.version}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>返回列表</Button>
      </div>
      {extension.manifest.description ? <p className="text-sm text-muted-foreground">{extension.manifest.description}</p> : null}
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant={extension.enabled ? 'secondary' : 'outline'}>{extension.enabled ? '已启用' : '已禁用'}</Badge>
        <Badge variant="outline">{extension.manifest.tools.length} 个工具</Badge>
        <Badge variant="outline">{extension.manifest.components?.length ?? 0} 个组件</Badge>
      </div>
      {(extension.manifest.configSchema ?? []).length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {(extension.manifest.configSchema ?? []).map((field) => (
            <label key={field.key} className="grid gap-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{field.label}{field.required ? ' *' : ''}</span>
              <Input
                type={field.type === 'secret' ? 'password' : 'text'}
                value={config[field.key] ?? field.defaultValue ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setConfig((current) => ({ ...current, [field.key]: event.target.value }))}
              />
              {field.description ? <span className="text-xs text-muted-foreground">{field.description}</span> : null}
            </label>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}><Save className="mr-2 size-3.5" />保存配置</Button>
        <Button size="sm" variant="outline" onClick={() => void openExtensionFolder(extension.id)}><FolderOpen className="mr-2 size-3.5" />打开目录</Button>
        <Button size="sm" variant="destructive" onClick={() => void remove()}><Trash2 className="mr-2 size-3.5" />移除</Button>
      </div>
    </div>
  )
}

export function ExtensionPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const extensions = useExtensionStore((state) => state.extensions)
  const loaded = useExtensionStore((state) => state.loaded)
  const loadExtensions = useExtensionStore((state) => state.loadExtensions)
  const installFromFolder = useExtensionStore((state) => state.installFromFolder)
  const updateExtension = useExtensionStore((state) => state.updateExtension)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => { void loadExtensions() }, [loadExtensions])

  const selected = extensions.find((extension) => extension.id === selectedId) ?? null

  const install = async (): Promise<void> => {
    const result = (await ipcClient.invoke(IPC.FS_SELECT_FOLDER)) as { canceled?: boolean; path?: string }
    if (result.canceled || !result.path) return
    const installed = await installFromFolder(result.path)
    if (!installed.success) {
      toast.error(installed.error ?? '安装扩展失败')
      return
    }
    await refreshExtensionTools()
    toast.success(t('extension.installed', { defaultValue: '扩展已安装' }))
  }

  const toggle = async (extension: ExtensionInstance, enabled: boolean): Promise<void> => {
    const result = await updateExtension(extension.id, { enabled })
    if (!result.success) {
      toast.error(result.error ?? '更新扩展失败')
      return
    }
    await refreshExtensionTools()
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-5 px-8 pb-16 pt-8">
        <div className="flex items-start justify-between gap-3">
          <div><h1 className="text-xl font-semibold">{t('extension.title', { defaultValue: '自定义扩展' })}</h1><p className="mt-1 text-sm text-muted-foreground">{t('extension.subtitle', { defaultValue: '安装和管理为 Agent 提供工具与组件的本地扩展。' })}</p></div>
          <Button className="gap-2" onClick={() => void install()}><FolderPlus className="size-4" />安装目录</Button>
        </div>
        {selected ? <ExtensionDetail extension={selected} onClose={() => setSelectedId(null)} /> : !loaded ? (
        <div className="rounded-xl border p-6 text-sm text-muted-foreground">加载中…</div>
      ) : extensions.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"><Puzzle className="mx-auto mb-3 size-8" />暂无已安装扩展</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {extensions.map((extension) => (
            <section key={extension.id} className="rounded-xl border border-border/60 bg-background p-4">
              <button className="w-full text-left" onClick={() => setSelectedId(extension.id)}>
                <div className="flex items-start gap-3">
                  <Puzzle className="mt-0.5 size-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1"><h3 className="truncate font-medium">{extension.manifest.name}</h3><p className="truncate text-xs text-muted-foreground">{extension.id} · v{extension.manifest.version}</p></div>
                </div>
                {extension.manifest.description ? <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{extension.manifest.description}</p> : null}
              </button>
              <div className="mt-3 flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">{extension.manifest.tools.length} 个工具</span><Switch checked={extension.enabled} onCheckedChange={(enabled) => void toggle(extension, enabled)} /></div>
            </section>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
