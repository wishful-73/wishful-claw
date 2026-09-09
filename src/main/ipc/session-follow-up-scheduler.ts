import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import { getNativeWorker } from '../lib/native-worker'
import { logError, logWarn } from '../lib/logger'
import { safeSendMessagePackToWindow } from '../window-ipc'
import {
  SESSION_FOLLOW_UP_CANCEL_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_COMPLETE_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_CREATE_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_FAIL_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_MARK_NOTIFIED_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_RENDERER_READY_MSGPACK_CHANNEL,
  SESSION_FOLLOW_UP_RESCHEDULE_MSGPACK_CHANNEL
} from '../../shared/messagepack/binary-ipc'
import type {
  SessionFollowUpFiredEvent,
  SessionFollowUpMutationResult,
  SessionFollowUpRequest,
  SessionFollowUpRow
} from '../../shared/types/session-follow-up'
import { registerMessagePackHandler } from './messagepack-handler'

const timers = new Map<string, NodeJS.Timeout>()
const recoveryTimers = new Map<string, NodeJS.Timeout>()
const MAX_TIMEOUT_MS = 2_147_000_000
const RENDERER_RETRY_MS = 30_000
const CLAIM_RECOVERY_MS = 5 * 60 * 1000
let restored = false
let restorePromise: Promise<void> | null = null
let getMainWindow: (() => BrowserWindow | null) | null = null

async function dbRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const result = await getNativeWorker().request<T>(method, params)
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const error = (result as Record<string, unknown>).error
    if (typeof error === 'string' && error) throw new Error(error)
  }
  return result
}

function clearScheduled(id: string): void {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  const recoveryTimer = recoveryTimers.get(id)
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoveryTimers.delete(id)
}

function schedule(row: SessionFollowUpRow): void {
  clearScheduled(row.id)
  if (row.status !== 'waiting') return
  const delay = Math.max(0, Math.min(row.follow_up_at - Date.now(), MAX_TIMEOUT_MS))
  timers.set(row.id, setTimeout(() => {
    timers.delete(row.id)
    if (row.follow_up_at - Date.now() > MAX_TIMEOUT_MS) {
      schedule(row)
      return
    }
    void fire(row.id)
  }, delay))
}

async function rescheduleAfterDeliveryFailure(
  followUp: SessionFollowUpRow,
  claimToken: string,
  error: string
): Promise<void> {
  const result = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-reschedule', {
    id: followUp.id,
    claimToken,
    followUpAt: Date.now() + RENDERER_RETRY_MS,
    lastError: error
  })
  if (result.success && result.followUp) schedule(result.followUp)
}

async function fire(id: string): Promise<void> {
  const claimToken = randomUUID()
  try {
    const claimed = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-claim', {
      id,
      claimToken,
      now: Date.now()
    })
    if (!claimed.success || !claimed.followUp) return

    const event: SessionFollowUpFiredEvent = { followUp: claimed.followUp, claimToken }
    const window = getMainWindow?.() ?? null
    if (!window || !safeSendMessagePackToWindow(window, 'session-follow-up:fire', event)) {
      await rescheduleAfterDeliveryFailure(claimed.followUp, claimToken, 'Renderer unavailable')
      return
    }

    recoveryTimers.set(id, setTimeout(() => {
      recoveryTimers.delete(id)
      void restore(true)
    }, CLAIM_RECOVERY_MS))
  } catch (error) {
    logError('main', `Session follow-up fire failed (${id}): ${String(error)}`)
  }
}

async function restore(force = false): Promise<void> {
  if (restored && !force) return
  if (!restorePromise) {
    restorePromise = dbRequest<SessionFollowUpRow[]>('db/session-follow-ups-list-schedulable', {
      now: Date.now()
    })
      .then((rows) => {
        for (const row of rows ?? []) schedule(row)
        restored = true
      })
      .catch((error) => {
        logWarn('main', `Session follow-up restore failed: ${String(error)}`)
      })
      .finally(() => {
        restorePromise = null
      })
  }
  await restorePromise
}

export function registerSessionFollowUpHandlers(options: {
  getMainWindow: () => BrowserWindow | null
}): void {
  getMainWindow = options.getMainWindow

  registerMessagePackHandler<SessionFollowUpRequest, SessionFollowUpMutationResult>(
    SESSION_FOLLOW_UP_CREATE_MSGPACK_CHANNEL,
    async (request) => {
      const result = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-create', {
        ...request,
        notificationKey: request.notificationKey ?? request.id
      })
      if (result.success && result.followUp) schedule(result.followUp)
      return result
    }
  )
  registerMessagePackHandler<Record<string, unknown>, SessionFollowUpMutationResult>(
    SESSION_FOLLOW_UP_RESCHEDULE_MSGPACK_CHANNEL,
    async (request) => {
      const result = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-reschedule', request)
      if (result.success && result.followUp) schedule(result.followUp)
      return result
    }
  )
  registerMessagePackHandler<Record<string, unknown>, SessionFollowUpMutationResult>(
    SESSION_FOLLOW_UP_COMPLETE_MSGPACK_CHANNEL,
    async (request) => {
      const result = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-complete', request)
      if (result.success) clearScheduled(String(request.id ?? ''))
      return result
    }
  )
  registerMessagePackHandler<Record<string, unknown>, SessionFollowUpMutationResult>(
    SESSION_FOLLOW_UP_FAIL_MSGPACK_CHANNEL,
    async (request) => {
      const result = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-fail', request)
      if (result.success) clearScheduled(String(request.id ?? ''))
      return result
    }
  )
  registerMessagePackHandler<Record<string, unknown>, SessionFollowUpMutationResult>(
    SESSION_FOLLOW_UP_CANCEL_MSGPACK_CHANNEL,
    async (request) => {
      const result = await dbRequest<SessionFollowUpMutationResult>('db/session-follow-ups-cancel', request)
      if (request.id) clearScheduled(String(request.id))
      if (request.todoId) await restore(true)
      return result
    }
  )
  registerMessagePackHandler<Record<string, unknown>, SessionFollowUpMutationResult>(
    SESSION_FOLLOW_UP_MARK_NOTIFIED_MSGPACK_CHANNEL,
    async (request) => dbRequest('db/session-follow-ups-mark-notified', request)
  )
  registerMessagePackHandler<unknown, { success: true }>(
    SESSION_FOLLOW_UP_RENDERER_READY_MSGPACK_CHANNEL,
    async () => {
      await restore(true)
      return { success: true }
    }
  )
}

export function initializeSessionFollowUpScheduler(): Promise<void> {
  return restore()
}

export function shutdownSessionFollowUpScheduler(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  for (const timer of recoveryTimers.values()) clearTimeout(timer)
  timers.clear()
  recoveryTimers.clear()
  restored = false
  restorePromise = null
}
