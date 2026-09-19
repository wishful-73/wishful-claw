import assert from 'node:assert/strict'
import { resolveCurrentTodoBatch } from '../../src/renderer/src/lib/agent/session-todo-batch'
import type { TaskItem } from '../../src/renderer/src/stores/task-store-helpers'

function task(
  id: string,
  status: TaskItem['status'],
  createdAt: number,
  updatedAt: number = createdAt
): TaskItem {
  return {
    id,
    subject: `task ${id}`,
    description: '',
    status,
    blocks: [],
    blockedBy: [],
    createdAt,
    updatedAt
  }
}

function ids(tasks: readonly TaskItem[]): string[] {
  return tasks.map((t) => t.id)
}

function testEmpty(): void {
  assert.deepEqual(resolveCurrentTodoBatch([]), [])
}

// 同一批任务是连着创建的：agent 逐条推进时会留下「前几条已完成、后几条还没动」
// 的中间态。这时候一条都不能切掉，否则每完成一条列表就少一条。
function testSameBatchMidProgress(): void {
  const tasks = [
    task('a', 'completed', 1000, 5000),
    task('b', 'in_progress', 1000),
    task('c', 'pending', 1000)
  ]
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['a', 'b', 'c'])
}

function testSameBatchAllButLastDone(): void {
  const tasks = [
    task('a', 'completed', 1000, 3000),
    task('b', 'completed', 1000, 4000),
    task('c', 'in_progress', 1000, 4500)
  ]
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['a', 'b', 'c'])
}

function testDropsPreviousCompletedBatch(): void {
  const tasks = [
    task('a', 'completed', 1000, 3000),
    task('b', 'completed', 1100, 4000),
    task('c', 'pending', 9000),
    task('d', 'pending', 9100)
  ]
  // c/d 是上一批做完（最后更新 4000）之后才建的
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['c', 'd'])
}

function testNewBatchAlreadyStarted(): void {
  const tasks = [
    task('a', 'completed', 1000, 3000),
    task('b', 'completed', 1000, 4000),
    task('c', 'completed', 5000, 6000),
    task('d', 'in_progress', 5000, 5000),
    task('e', 'pending', 5000)
  ]
  // 新批第一条（c）自己已经做完了，切批点仍要落在它身上
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['c', 'd', 'e'])
}

function testAllCompletedKeepsEverything(): void {
  const tasks = [task('a', 'completed', 1000, 2000), task('b', 'completed', 1000, 3000)]
  // 没有「下一批」，抹掉会让面板整个消失
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['a', 'b'])
}

function testThreeBatchesKeepsOnlyCurrent(): void {
  const tasks = [
    task('a', 'completed', 1000, 2000),
    task('b', 'completed', 1000, 3000),
    task('c', 'completed', 5000, 6000),
    task('d', 'completed', 5000, 7000),
    task('e', 'pending', 9000),
    task('f', 'pending', 9100)
  ]
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['e', 'f'])
}

function testOutOfOrderCompletionStillCounts(): void {
  const tasks = [
    task('a', 'completed', 1000, 9000),
    task('b', 'completed', 1000, 3000),
    task('c', 'in_progress', 1000, 3500)
  ]
  // 批内乱序完成，max(updatedAt) 仍是本批的完成时刻，不能把 a/b 切走
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['a', 'b', 'c'])
}

function testOrdersByCreatedAt(): void {
  const tasks = [
    task('c', 'pending', 9000),
    task('a', 'completed', 1000, 2000),
    task('b', 'completed', 1100, 3000)
  ]
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['c'])
}

function testSameCreatedAtKeepsInputOrder(): void {
  const tasks = [
    task('a', 'completed', 1000, 5000),
    task('b', 'pending', 1000),
    task('c', 'pending', 1000)
  ]
  assert.deepEqual(ids(resolveCurrentTodoBatch(tasks)), ['a', 'b', 'c'])
}

function testDoesNotMutateInput(): void {
  const tasks = [task('a', 'pending', 2), task('b', 'pending', 1)]
  const snapshot = structuredClone(tasks)
  resolveCurrentTodoBatch(tasks)
  assert.deepEqual(tasks, snapshot)
}

function testSingleTask(): void {
  assert.deepEqual(ids(resolveCurrentTodoBatch([task('a', 'in_progress', 1000)])), ['a'])
}

const tests: Array<[string, () => void]> = [
  ['empty session', testEmpty],
  ['same batch keeps already-finished rows', testSameBatchMidProgress],
  ['same batch all but last done', testSameBatchAllButLastDone],
  ['previous completed batch is dropped', testDropsPreviousCompletedBatch],
  ['new batch already started', testNewBatchAlreadyStarted],
  ['all completed keeps everything', testAllCompletedKeepsEverything],
  ['three batches keeps only current', testThreeBatchesKeepsOnlyCurrent],
  ['out of order completion within batch', testOutOfOrderCompletionStillCounts],
  ['orders by createdAt', testOrdersByCreatedAt],
  ['same createdAt keeps input order', testSameCreatedAtKeepsInputOrder],
  ['does not mutate input', testDoesNotMutateInput],
  ['single task', testSingleTask]
]

for (const [name, run] of tests) {
  run()
  console.log(`PASS: ${name}`)
}
console.log(`Session todo batch tests passed: ${tests.length}`)
