import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Switch } from '@renderer/components/ui/switch'
import { Separator } from '@renderer/components/ui/separator'
import { useMcpStore } from '@renderer/stores/mcp-store'
import type { McpServerConfig } from '@renderer/lib/mcp/types'
import { McpServerForm } from './mcp-server-form'
import { McpConnectionControl } from './mcp-connection-control'
import { McpCapabilities } from './mcp-capabilities'

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: 'stdio',
  sse: 'SSE (Legacy)',
  'streamable-http': 'Streamable HTTP'
}

export function McpServerConfig({
  server,
  projectId
}: {
  server: McpServerConfig
  projectId?: string
}): React.JSX.Element {
  const { t } = useTranslation('settings')
  const updateServer = useMcpStore((s) => s.updateServer)
  const removeServer = useMcpStore((s) => s.removeServer)
  const connectServer = useMcpStore((s) => s.connectServer)
  const disconnectServer = useMcpStore((s) => s.disconnectServer)
  const refreshServerInfo = useMcpStore((s) => s.refreshServerInfo)
  const serverStatuses = useMcpStore((s) => s.serverStatuses)
  const serverTools = useMcpStore((s) => s.serverTools)
  const serverResources = useMcpStore((s) => s.serverResources)
  const serverPrompts = useMcpStore((s) => s.serverPrompts)
  const serverErrors = useMcpStore((s) => s.serverErrors)

  const status = serverStatuses[server.id] ?? 'disconnected'
  const tools = serverTools[server.id] ?? []
  const resources = serverResources[server.id] ?? []
  const prompts = serverPrompts[server.id] ?? []
  const error = serverErrors[server.id]

  const [connecting, setConnecting] = useState(false)

  useEffect(() => {
    refreshServerInfo(server.id)
  }, [server.id, refreshServerInfo])

  // ── Handlers ──

  const handleUpdateServer = (patch: Partial<McpServerConfig>): void => {
    updateServer(server.id, patch)
  }

  const handleConnect = async (): Promise<void> => {
    setConnecting(true)
    try {
      const err = await connectServer(server.id)
      if (err) {
        toast.error(t('mcp.connectionFailed', { defaultValue: 'Connection failed' }), { description: err })
      } else {
        toast.success(t('mcp.connectedTo', { name: server.name, defaultValue: `Connected to ${server.name}` }))
      }
    } finally {
      setConnecting(false)
    }
  }

  const handleDisconnect = async (): Promise<void> => {
    await disconnectServer(server.id)
    toast.success(t('mcp.disconnectedFrom', { name: server.name, defaultValue: `Disconnected from ${server.name}` }))
  }

  const handleToggleEnabled = async (): Promise<void> => {
    const enabled = !server.enabled
    await updateServer(server.id, {
      enabled,
      ...(enabled && projectId && server.projectId !== projectId ? { projectId } : {})
    })
    if (!enabled && status === 'connected') {
      await disconnectServer(server.id)
    }
  }

  const handleDelete = async (): Promise<void> => {
    const confirmed = await confirm({
      title: t('mcp.deleteConfirm', { name: server.name, defaultValue: `Delete "${server.name}"?` }),
      variant: 'destructive'
    })
    if (!confirmed) return
    try {
      await removeServer(server.id)
      toast.success(t('mcp.serverRemoved', { defaultValue: 'Server removed' }))
    } catch (err) {
      toast.error(t('mcp.serverRemoveFailed', { defaultValue: 'Failed to remove server' }) + `: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const handleRefresh = async (): Promise<void> => {
    await refreshServerInfo(server.id)
    toast.success(t('mcp.refreshed', { defaultValue: 'Refreshed' }))
  }

  // ── Render ──

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden px-4 py-3">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold truncate">{server.name}</h3>
          <p className="text-xs text-muted-foreground">{TRANSPORT_LABELS[server.transport] ?? server.transport}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="inline-flex items-center justify-center size-7 rounded-md text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={handleDelete}
            title={t('mcp.deleteServer', { defaultValue: 'Delete' })}
          >
            <Trash2 className="size-3.5" />
          </button>
          <Switch checked={server.enabled} onCheckedChange={handleToggleEnabled} />
        </div>
      </div>

      <Separator className="mb-4" />

      {/* Configuration form */}
      <McpServerForm server={server} onUpdateServer={handleUpdateServer} />

      <Separator className="mb-4" />

      {/* Connection control + status */}
      <McpConnectionControl
        status={status}
        connecting={connecting}
        error={error}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefresh={handleRefresh}
      />

      {/* Capabilities (only when connected) */}
      {status === 'connected' && (
        <McpCapabilities tools={tools} resources={resources} prompts={prompts} />
      )}

      <div className="flex-1" />
    </div>
  )
}
