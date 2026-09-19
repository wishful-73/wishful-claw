import type { TaskItem } from '@renderer/stores/task-store-helpers'

/**
 * 会话 todo 的「当前批次」过滤。
 *
 * agent 干完一批活会直接开下一批，旧任务不会被清理 —— 面板计数一路累加（5 条做完
 * 再开 5 条就是 10/10），看上去像活越堆越多。这是显示口径问题，不是数据问题：
 * 任务状态归 agent 所有，删任务不可逆，所以**只过滤、不写数据**。
 *
 * 切批需要同时满足两条，缺一不可：
 *
 * 1. 前一批全部 completed（同一时刻只会有一批在跑）；
 * 2. 这条任务是**上一批做完之后才建的** —— `createdAt >= 上一批最后被更新的时刻`。
 *
 * 第 2 条是必需的：同一批任务是连着创建的，agent 逐条推进时必然出现
 * 「前几条 completed、后几条还 pending」的中间态，只按第 1 条判断会把同批里
 * 刚做完的那几条误判成上一批 —— 每完成一条列表就少一条。
 * 同批任务的 createdAt 一定早于本批任何一条的完成时刻，跨批的新任务则在之后，
 * 这个比较不需要任何时间阈值。
 *
 * @returns 当前批次里的任务；数据为空时返回空数组。全部完成时返回最后一批
 *          （此时没有「下一批」，抹掉会让面板直接空掉）。
 */
export function resolveCurrentTodoBatch(tasks: readonly TaskItem[]): TaskItem[] {
  if (tasks.length === 0) return []
  // 同一批一起创建，createdAt 常常完全相同，靠 sort 的稳定性保持原有次序。
  const ordered = [...tasks].sort((a, b) => a.createdAt - b.createdAt)

  let start = 0
  for (let index = 1; index < ordered.length; index += 1) {
    const previousBatch = ordered.slice(start, index)
    if (!previousBatch.every((task) => task.status === 'completed')) continue
    const previousBatchLastTouchedAt = previousBatch.reduce(
      (latest, task) => Math.max(latest, task.updatedAt),
      0
    )
    if (ordered[index].createdAt >= previousBatchLastTouchedAt) start = index
  }
  return ordered.slice(start)
}
