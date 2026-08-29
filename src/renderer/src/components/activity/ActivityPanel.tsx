import { useActivityStore } from '@renderer/stores/activity-store'
import { Activity } from 'lucide-react'

export function ActivityPanel() {
  const activities = useActivityStore((s) => s.activities)
  const currentIteration = useActivityStore((s) => s.currentIteration)
  const clearActivities = useActivityStore((s) => s.clearActivities)

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Activity</span>
          {currentIteration > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
              iter {currentIteration}
            </span>
          )}
        </div>
        <button
          onClick={clearActivities}
          className="rounded p-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Clear"
        >
          Clear
        </button>
      </div>

      {/* Activity list */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {activities.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">No activity yet</div>
        ) : (
          activities.map((item) => <ActivityItemRow key={item.id} item={item} />)
        )}
      </div>
    </div>
  )
}

function ActivityItemRow({ item }: { item: ReturnType<typeof useActivityStore.getState>['activities'][number] }) {
  const icon = getActivityIcon(item.type)
  const label = getActivityLabel(item.type)

  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50 transition-colors">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{label}</span>
          {item.iteration !== undefined && (
            <span className="text-muted-foreground">#{item.iteration}</span>
          )}
        </div>
        {item.details && (
          <p className="text-muted-foreground truncate">{item.details}</p>
        )}
        {item.debugInfo && (
          <div className="mt-0.5 space-y-0.5">
            <p className="text-muted-foreground truncate text-[10px]">{item.debugInfo.url}</p>
            {item.debugInfo.model && (
              <p className="text-muted-foreground text-[10px]">{item.debugInfo.model}</p>
            )}
          </div>
        )}
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    </div>
  )
}

function getActivityIcon(type: string): string {
  switch (type) {
    case 'iteration_start': return '▶'
    case 'iteration_end': return '■'
    case 'context_compression_started':
    case 'context_compression_start':
    case 'context_compressed': return '⤢'
    case 'request_debug': return '⚙'
    case 'tool_use_streaming_start':
    case 'tool_call_start':
    case 'tool_call_result': return '⚙'
    default: return '•'
  }
}

function getActivityLabel(type: string): string {
  switch (type) {
    case 'iteration_start': return 'Iteration Started'
    case 'iteration_end': return 'Iteration Ended'
    case 'context_compression_started':
    case 'context_compression_start': return 'Compressing Context'
    case 'context_compressed': return 'Context Compressed'
    case 'request_debug': return 'Request Sent'
    case 'tool_use_streaming_start': return 'Tool Call Started'
    case 'tool_call_start': return 'Tool Executing'
    case 'tool_call_result': return 'Tool Result'
    default: return type
  }
}
