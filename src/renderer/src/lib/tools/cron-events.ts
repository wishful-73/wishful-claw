/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

type CronFiredEvent = {
  jobId: string
  sessionId?: string | null
  name?: string
  prompt?: string
  agentId?: string | null
  model?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
  firedAt?: number
  deliveryMode?: 'desktop' | 'session' | 'none' | 'plugin'
  deliveryTarget?: string | null
  deleteAfterRun?: boolean
  maxIterations?: number
  pluginId?: string | null
  pluginType?: string | null
  pluginChatId?: string | null
  error?: string
}

type CronJobRemovedEvent = {
  jobId: string
  reason: 'delete_after_run' | 'manual'
}

type CronRunStartedEvent = {
  jobId: string
  runId: string
}

type CronRunProgressEvent = {
  jobId: string
  runId: string
  iteration: number
  toolCalls: number
  elapsed: number
  currentStep?: string
}

type CronRunFinishedEvent = {
  jobId: string
  runId: string
  status: 'success' | 'error' | 'aborted'
  toolCallCount: number
  jobName?: string
  sessionId?: string | null
  deliveryMode?: string
  deliveryTarget?: string | null
  outputSummary?: string
  error?: string
}

type CronEvent =
  | ({ type: 'fired' } & CronFiredEvent)
  | ({ type: 'job_removed' } & CronJobRemovedEvent)
  | ({ type: 'run_started' } & CronRunStartedEvent)
  | ({ type: 'run_progress' } & CronRunProgressEvent)
  | ({ type: 'run_finished' } & CronRunFinishedEvent)

type CronEventListener = (event: CronEvent) => void

const listeners = new Set<CronEventListener>()

export const cronEvents = {
  emit(event: CronEvent): void {
    for (const listener of listeners) {
      try {
        listener(event)
      } catch (err) {
        console.error('[cronEvents] listener error:', err)
      }
    }
  },

  on(listener: CronEventListener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}

export type {
  CronFiredEvent,
  CronJobRemovedEvent,
  CronRunStartedEvent,
  CronRunProgressEvent,
  CronRunFinishedEvent,
  CronEvent
}
