export interface CronRunLockSnapshot {
  jobId: string
  fireId: string
}

export class CronRunLock {
  private readonly active = new Map<string, string>()

  tryAcquire(jobId: string, fireId: string): boolean {
    if (this.active.has(jobId)) return false
    this.active.set(jobId, fireId)
    return true
  }

  matches(jobId: string, fireId: string): boolean {
    return this.active.get(jobId) === fireId
  }

  release(jobId: string, fireId: string): boolean {
    if (!this.matches(jobId, fireId)) return false
    this.active.delete(jobId)
    return true
  }

  releaseAll(): CronRunLockSnapshot[] {
    const snapshot = [...this.active.entries()].map(([jobId, fireId]) => ({ jobId, fireId }))
    this.active.clear()
    return snapshot
  }

  has(jobId: string): boolean {
    return this.active.has(jobId)
  }

  get size(): number {
    return this.active.size
  }
}

export interface CronUpdateTransaction {
  persistNext: () => Promise<void>
  applyNext: () => void
  restorePrevious: () => void
  scheduleNext: () => boolean
  schedulePrevious: () => boolean
  persistPrevious: () => Promise<void>
  wasPreviouslyScheduled: boolean
  formatScheduleError: () => string
}

export async function applyCronUpdateTransaction(
  transaction: CronUpdateTransaction
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await transaction.persistNext()
    transaction.applyNext()
    if (!transaction.scheduleNext()) {
      throw new Error(transaction.formatScheduleError())
    }
    return { success: true }
  } catch (error) {
    transaction.restorePrevious()
    if (transaction.wasPreviouslyScheduled && !transaction.schedulePrevious()) {
      console.warn('[Cron] failed to restore previous schedule after update failure')
    }
    try {
      await transaction.persistPrevious()
    } catch (rollbackError) {
      console.warn('[Cron] failed to rollback persisted Cron update:', rollbackError)
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
