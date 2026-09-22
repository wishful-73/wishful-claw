import { getNativeWorker } from '../lib/native-worker'
import { registerMessagePackHandler } from './messagepack-handler'

/**
 * Messagepack channels that are thin forwarders to the C# Worker.
 *
 * These are all one-line `getNativeWorker().request(...)` wrappers — around
 * fifty of them — so keeping them next to the app lifecycle in `index.ts` made
 * that file unreadable. Nothing here holds state; the entry point just calls
 * this once during `whenReady()`.
 */
export function registerWorkerForwardHandlers(): void {
  // ── Agent history handlers (forwarded to C# Worker SQLite) ──
  registerMessagePackHandler<{ toolUseId: string }, unknown>(
    'agent-history:read-by-tool-use-id',
    async (args) => getNativeWorker().request('db/sub-agent-read-by-tool-use-id', args)
  )
  registerMessagePackHandler<void, { total: number; sessions: unknown[] }>(
    'agent-history:index',
    async () => getNativeWorker().request('db/sub-agent-index', {})
  )
  registerMessagePackHandler<{ sessionId: string }, unknown[]>(
    'agent-history:read',
    async (args) => getNativeWorker().request('db/sub-agent-read-session', args)
  )
  registerMessagePackHandler<{
    upserts?: unknown[]
    removeIds?: string[]
    removeSessionIds?: string[]
  }, void>(
    'agent-history:apply',
    async (args) => { await getNativeWorker().request('db/sub-agent-apply', args) }
  )
  registerMessagePackHandler<{ snapshot: unknown }, void>(
    'agent-history:replace',
    async (args) => { await getNativeWorker().request('db/sub-agent-replace', args) }
  )

  // ── DB locator (forwarded to Worker) ──
  registerMessagePackHandler<string, unknown[]>(
    'db:messages:list-locator:msgpack',
    async (sessionId) => getNativeWorker().request('db/messages-list-locator', { sessionId })
  )

  // ── Goal DB handlers (forwarded to Worker) ──
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goals:list:msgpack',
    async (args) => getNativeWorker().request('db/goals-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:list-page:msgpack',
    async (args) => getNativeWorker().request('db/goals-list-page', args)
  )
  registerMessagePackHandler<string, unknown | null>(
    'db:goals:get:msgpack',
    async (sessionId) => getNativeWorker().request('db/goals-get', { sessionId })
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:create:msgpack',
    async (args) => getNativeWorker().request('db/goals-create', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:set:msgpack',
    async (args) => getNativeWorker().request('db/goals-set', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:update:msgpack',
    async (args) => getNativeWorker().request('db/goals-update', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goals:account:msgpack',
    async (args) => getNativeWorker().request('db/goals-account', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'agent:drain-sub-agent-notifications',
    async (args) => getNativeWorker().request('agent/drain-sub-agent-notifications', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-events:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-events-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-events:list-page:msgpack',
    async (args) => getNativeWorker().request('db/goal-events-list-page', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-events:add:msgpack',
    async (args) => getNativeWorker().request('db/goal-events-add', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-plan-tasks:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-plan-tasks-list', args)
  )
  // In-memory live snapshot for the panel's 1s poll (no SQLite round-trip).
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:live:msgpack',
    async (args) => getNativeWorker().request('goal/live', args)
  )

  // ── Session-scoped agent task (Todo) DB handlers (forwarded to Worker) ──
  registerMessagePackHandler<string, unknown[]>(
    'db:tasks:list-by-session:msgpack',
    async (sessionId) => getNativeWorker().request('db/tasks-list-by-session', { sessionId })
  )
  registerMessagePackHandler<string, unknown>(
    'db:tasks:get:msgpack',
    async (id) => getNativeWorker().request('db/tasks-get', { id })
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:tasks:create:msgpack',
    async (args) => getNativeWorker().request('db/tasks-create', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:tasks:update:msgpack',
    async (args) => getNativeWorker().request('db/tasks-update', args)
  )
  registerMessagePackHandler<string, unknown>(
    'db:tasks:delete:msgpack',
    async (id) => getNativeWorker().request('db/tasks-delete', { id })
  )
  registerMessagePackHandler<string, unknown>(
    'db:tasks:delete-by-session:msgpack',
    async (sessionId) => getNativeWorker().request('db/tasks-delete-by-session', { sessionId })
  )

  // ── Goal plans/tasks/execution-runs handlers ──
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-plans:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-plans:get:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-get', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-plans:update-status:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-update-status', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-plans:update-retry:msgpack',
    async (args) => getNativeWorker().request('db/goal-plans-update-retry', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-tasks:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-tasks-list', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-tasks:get:msgpack',
    async (args) => getNativeWorker().request('db/goal-tasks-get', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-tasks:update-status:msgpack',
    async (args) => getNativeWorker().request('db/goal-tasks-update-status', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-execution-runs:insert:msgpack',
    async (args) => getNativeWorker().request('db/goal-execution-runs-insert', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'db:goal-execution-runs:finish:msgpack',
    async (args) => getNativeWorker().request('db/goal-execution-runs-finish', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown[]>(
    'db:goal-execution-runs:list:msgpack',
    async (args) => getNativeWorker().request('db/goal-execution-runs-list', args)
  )

  // ── Goal control handlers ──
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:pause:msgpack',
    async (args) => getNativeWorker().request('goal/pause', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:resume:msgpack',
    async (args) => getNativeWorker().request('goal/resume', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:abort:msgpack',
    async (args) => getNativeWorker().request('goal/abort', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:status:msgpack',
    async (args) => getNativeWorker().request('goal/status', args)
  )
  registerMessagePackHandler<Record<string, unknown>, unknown>(
    'goal:confirm:msgpack',
    async (args) => getNativeWorker().request('goal/confirm', args)
  )

  // ── Shell process control (forwarded to Worker) ──
  // Kills a running shell process by tool call id (iter-34 S-137).
  registerMessagePackHandler<{ execId: string }, unknown>(
    'shell:abort',
    async (args) => getNativeWorker().request('shell/abort', args)
  )
}
