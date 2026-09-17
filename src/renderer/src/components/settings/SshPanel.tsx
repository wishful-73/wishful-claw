import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus, Pencil, Server, Trash2, Zap, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useSshStore, type SshConnection } from '@renderer/stores/ssh-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import type { ShellExecutionEndpoint } from '@renderer/stores/settings-store-types'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { SettingsSection } from './settings-primitives'
import {
  SshConnectionDialog,
  DEFAULT_FORM,
  type SshFormData
} from './SshConnectionDialog'

/** 当前平台可选的 shell 端点 —— Windows 与 POSIX 各一套。 */
function getShellEndpointOptions(): ShellExecutionEndpoint[] {
  const isWindows = window.electron?.process?.platform === 'win32'
  return isWindows
    ? ['auto', 'powershell', 'pwsh', 'cmd', 'custom']
    : ['auto', 'zsh', 'bash', 'sh', 'custom']
}

export function SshPanel(): React.JSX.Element {
  const { t } = useTranslation('settings')
  const connections = useSshStore((s) => s.connections)
  const loaded = useSshStore((s) => s._loaded)
  const loadAll = useSshStore((s) => s.loadAll)
  const createConnection = useSshStore((s) => s.createConnection)
  const updateConnection = useSshStore((s) => s.updateConnection)
  const deleteConnection = useSshStore((s) => s.deleteConnection)
  const testConnection = useSshStore((s) => s.testConnection)

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<SshFormData>(DEFAULT_FORM)
  const [saving, setSaving] = React.useState(false)
  const [testingId, setTestingId] = React.useState<string | null>(null)
  const [testResults, setTestResults] = React.useState<Record<string, { success: boolean; error?: string }>>({})

  const shellExecutionEndpoint = useSettingsStore((s) => s.shellExecutionEndpoint)
  const customShellExecutable = useSettingsStore((s) => s.customShellExecutable)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const shellEndpointOptions = getShellEndpointOptions()

  React.useEffect(() => {
    void loadAll()
  }, [loadAll])

  const openCreate = (): void => {
    setForm(DEFAULT_FORM)
    setEditingId(null)
    setDialogOpen(true)
  }

  const openEdit = (conn: SshConnection): void => {
    setForm({
      name: conn.name,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      authType: conn.authType,
      password: conn.password ?? '',
      privateKeyPath: conn.privateKeyPath ?? '',
      passphrase: conn.passphrase ?? '',
      defaultDirectory: conn.defaultDirectory ?? '',
      keepAliveInterval: conn.keepAliveInterval
    })
    setEditingId(conn.id)
    setDialogOpen(true)
  }

  const doSave = async (): Promise<string | null> => {
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) return null
    setSaving(true)
    try {
      if (editingId) {
        await updateConnection(editingId, {
          name: form.name.trim(),
          host: form.host.trim(),
          port: form.port,
          username: form.username.trim(),
          authType: form.authType,
          password: form.password || null,
          privateKeyPath: form.privateKeyPath || null,
          passphrase: form.passphrase || null,
          defaultDirectory: form.defaultDirectory || null,
          keepAliveInterval: form.keepAliveInterval
        })
        return editingId
      } else {
        const id = await createConnection({
          name: form.name.trim(),
          host: form.host.trim(),
          port: form.port,
          username: form.username.trim(),
          authType: form.authType,
          password: form.password || undefined,
          privateKeyPath: form.privateKeyPath || undefined,
          passphrase: form.passphrase || undefined,
          defaultDirectory: form.defaultDirectory || undefined,
          keepAliveInterval: form.keepAliveInterval
        })
        setEditingId(id)
        return id
      }
    } catch (err) {
      console.error('[SshPanel] Save failed:', err)
      return null
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    const id = await doSave()
    if (id) setDialogOpen(false)
  }

  const handleTestInDialog = async (): Promise<{ success: boolean; error?: string }> => {
    const id = await doSave()
    if (!id) return { success: false, error: 'Failed to save connection' }
    return await testConnection(id)
  }

  const handleDelete = async (id: string): Promise<void> => {
    await deleteConnection(id)
    setTestResults((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const handleTest = async (id: string): Promise<void> => {
    setTestingId(id)
    try {
      const result = await testConnection(id)
      setTestResults((prev) => ({ ...prev, [id]: result }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { success: false, error: err instanceof Error ? err.message : String(err) }
      }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 pb-16 pt-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">
          {t('ssh.title', { defaultValue: '终端与SSH' })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('ssh.description', {
            defaultValue: '内置终端的默认 shell，以及用于远程命令执行的 SSH 连接。'
          })}
        </p>
      </div>

      {/* 终端：内置终端面板新建标签页时使用的 shell */}
      <SettingsSection
        id="sec-terminal-shell"
        title={t('ssh.terminal.title', { defaultValue: '终端' })}
        description={t('ssh.terminal.description', {
          defaultValue: '新建终端标签页时使用的 shell；已打开的标签页不受影响。'
        })}
      >
        <Select
          value={shellExecutionEndpoint}
          onValueChange={(value) =>
            updateSettings({ shellExecutionEndpoint: value as ShellExecutionEndpoint })
          }
        >
          <SelectTrigger className="w-64 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shellEndpointOptions.map((option) => (
              <SelectItem key={option} value={option} className="text-xs">
                {t(`ssh.terminal.shellOptions.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {shellExecutionEndpoint === 'custom' && (
          <Input
            value={customShellExecutable}
            onChange={(event) => updateSettings({ customShellExecutable: event.target.value })}
            placeholder={t('ssh.terminal.customPlaceholder', { defaultValue: '/path/to/shell' })}
            className="h-8 text-xs"
          />
        )}
      </SettingsSection>

      {/* SSH 连接 */}
      <div className="mb-3 mt-6 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">
            {t('ssh.connections.title', { defaultValue: 'SSH 连接' })}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('ssh.connections.description', { defaultValue: '用于远程命令执行的服务器连接。' })}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <Plus className="size-4" />
          {t('ssh.add', { defaultValue: 'Add Connection' })}
        </Button>
      </div>

      {!loaded ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : connections.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16">
          <Server className="size-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {t('ssh.empty', { defaultValue: 'No SSH connections yet. Click "Add Connection" to create one.' })}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {connections.map((conn) => {
            const testResult = testResults[conn.id]
            const isTesting = testingId === conn.id
            return (
              <div
                key={conn.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Server className="size-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{conn.name}</span>
                    {testResult && (
                      <span className="flex items-center gap-0.5 text-xs">
                        {testResult.success ? (
                          <CheckCircle2 className="size-3.5 text-emerald-500" />
                        ) : (
                          <XCircle className="size-3.5 text-red-500" />
                        )}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {conn.username}@{conn.host}:{conn.port}
                    {conn.defaultDirectory ? ` · ${conn.defaultDirectory}` : ''}
                  </div>
                  {testResult && !testResult.success && testResult.error && (
                    <div className="mt-0.5 truncate text-xs text-red-500">{testResult.error}</div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => void handleTest(conn.id)}
                    disabled={isTesting}
                    title={t('ssh.test', { defaultValue: 'Test connection' })}
                  >
                    {isTesting ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Zap className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8"
                    onClick={() => openEdit(conn)}
                    title={t('ssh.edit', { defaultValue: 'Edit' })}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-red-500"
                    onClick={() => void handleDelete(conn.id)}
                    title={t('ssh.delete', { defaultValue: 'Delete' })}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <SshConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingId={editingId}
        form={form}
        onFormChange={setForm}
        onSave={handleSave}
        onTest={handleTestInDialog}
        saving={saving}
      />
    </div>
  )
}
