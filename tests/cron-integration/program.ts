import {
  applyCronUpdateTransaction,
  CronRunLock
} from '../../src/main/ipc/reverse-handlers/cron-execution-coordinator'

let passed = 0

function assert(condition: boolean, name: string): void {
  if (!condition) throw new Error(name)
  passed += 1
  console.log(`PASS: ${name}`)
}

async function testRunLockAndFireId(): Promise<void> {
  const lock = new CronRunLock()
  assert(lock.tryAcquire('job-a', 'fire-1'), 'first fire acquires the Main run lock')
  assert(!lock.tryAcquire('job-a', 'fire-2'), 'duplicate fire is rejected while the Renderer run is active')
  assert(!lock.release('job-a', 'fire-old'), 'stale fireId cannot release the active run lock')
  assert(lock.has('job-a'), 'stale completion leaves the active run protected')
  assert(lock.release('job-a', 'fire-1'), 'matching Renderer completion releases the run lock')
  assert(!lock.has('job-a'), 'completed run no longer blocks a later fire')
  assert(lock.tryAcquire('job-a', 'fire-3'), 'a later fire can acquire the released lock')
}

async function testRendererExitReleasesLocks(): Promise<void> {
  const lock = new CronRunLock()
  lock.tryAcquire('job-a', 'fire-a')
  lock.tryAcquire('job-b', 'fire-b')
  const released = lock.releaseAll()
  assert(released.length === 2, 'Renderer exit snapshots all active Cron runs')
  assert(lock.size === 0, 'Renderer exit releases all Main run locks')
  assert(lock.tryAcquire('job-a', 'fire-after-exit'), 'a recovered Renderer can run the job again')
}

async function testUpdateRollbackAfterRescheduleFailure(): Promise<void> {
  let persisted = 'old'
  let memory = 'old'
  let timer = 'old'
  const calls: string[] = []

  const result = await applyCronUpdateTransaction({
    persistNext: async () => {
      calls.push('persist-next')
      persisted = 'new'
    },
    applyNext: () => {
      calls.push('apply-next')
      memory = 'new'
      timer = 'cleared'
    },
    restorePrevious: () => {
      calls.push('restore-memory')
      memory = 'old'
      timer = 'old'
    },
    scheduleNext: () => {
      calls.push('schedule-next')
      return false
    },
    schedulePrevious: () => {
      calls.push('schedule-previous')
      return true
    },
    persistPrevious: async () => {
      calls.push('persist-previous')
      persisted = 'old'
    },
    wasPreviouslyScheduled: true,
    formatScheduleError: () => 'reschedule failed'
  })

  assert(result.success === false && result.error === 'reschedule failed',
    'reschedule failure is returned to the Main caller')
  assert(persisted === 'old' && memory === 'old' && timer === 'old',
    'reschedule failure restores DB, memory and the previous timer')
  assert(calls.join(',') === 'persist-next,apply-next,schedule-next,restore-memory,schedule-previous,persist-previous',
    'update rollback follows the expected Main transaction order')
}

async function testUpdateRollbackAfterPersistFailure(): Promise<void> {
  let restored = false
  let rollbackPersisted = false

  const result = await applyCronUpdateTransaction({
    persistNext: async () => { throw new Error('db unavailable') },
    applyNext: () => { throw new Error('must not apply an unpersisted update') },
    restorePrevious: () => { restored = true },
    scheduleNext: () => true,
    schedulePrevious: () => true,
    persistPrevious: async () => { rollbackPersisted = true },
    wasPreviouslyScheduled: true,
    formatScheduleError: () => 'unused'
  })

  assert(result.success === false && result.error === 'db unavailable',
    'database update failure is returned without masking the original error')
  assert(restored && rollbackPersisted,
    'database update failure still restores in-memory state and persists compensation')
}

async function main(): Promise<void> {
  await testRunLockAndFireId()
  await testRendererExitReleasesLocks()
  await testUpdateRollbackAfterRescheduleFailure()
  await testUpdateRollbackAfterPersistFailure()
  console.log(`Cron Main/Renderer integration regression tests passed: ${passed}`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
