/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 *
 * 母本：OpenCowork src/renderer/src/components/cowork/StepsPanel.tsx 的
 * InlineStepsPanelCard。改动：去掉变更审查入口（本仓 ChangeReviewSheet /
 * RunChangeReviewCard 零 importer，接上去是死链）、去掉 team 任务聚合（现存
 * 活路径 TodoStatusList 也不聚合）、改为 composer 上方的常驻提示条。
 */

import * as React from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDashed,
  CircleDotDashed,
  CircleSlash,
  ClipboardList,
  Loader2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@renderer/lib/utils'
import { useChatStore } from '@renderer/stores/chat-store'
import { useAgentStore } from '@renderer/stores/agent-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useTaskStore, type TaskItem } from '@renderer/stores/task-store'
import { resolveCurrentTodoBatch } from '@renderer/lib/agent/session-todo-batch'

const EASE = [0.4, 0, 0.2, 1] as const
const EMPTY_TASKS: TaskItem[] = []

/**
 * S-34：`in_progress` 超过这个时长、且本会话没有活跃 run，就认定它已经凉了。
 * 3 天的依据：「今天没空、明天接着干」是正常场景，1 天会把这种人误判成过期；
 * 真挂 3 天没人管的，基本不会再有人回来认领。
 */
const STALE_IN_PROGRESS_MS = 3 * 24 * 60 * 60 * 1000

/**
 * 会话 Todo 的显示态（只影响渲染，绝不回写数据 —— 任务状态归 agent 所有）。
 * - running：本会话有活跃 run，任务确实在跑
 * - suspended：run 已结束但任务仍挂着（多轮长任务的正常中间态）
 * - stale：run 早没了、updatedAt 也过期，这条多半不会再被认领
 */
type InProgressState = 'running' | 'suspended' | 'stale'

function TaskStatusIcon({
  status,
  inProgressState
}: {
  status: TaskItem['status']
  inProgressState?: InProgressState
}): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-green-500" />
    case 'in_progress':
      // 只有 run 真活着才转圈。此前只看 status，agent 不更新就能一直转下去。
      if (inProgressState === 'stale') {
        return <CircleDashed className="size-4 text-muted-foreground/50" />
      }
      if (inProgressState === 'running') {
        return <Loader2 className="size-4 animate-spin text-blue-500" />
      }
      return <Loader2 className="size-4 text-muted-foreground/70" />
    case 'blocked':
      return <CircleSlash className="size-4 text-amber-500" />
    case 'in_review':
      return <CircleDotDashed className="size-4 text-violet-500" />
    case 'pending':
    default:
      return <Circle className="size-4 text-muted-foreground" />
  }
}

function getTaskPrimaryText(task: TaskItem): string {
  return task.status === 'in_progress' && task.activeForm ? task.activeForm : task.subject
}

interface SessionTodoPanelProps {
  projectScoped: boolean
  draftSessionId: string | null | undefined
  className?: string
}

/**
 * 会话 Todo 提示条：排在 composer 上方，与其它提示条（API Key 提醒、排队面板、
 * goal 条）依次排列；展开体内部滚动。
 */
export function SessionTodoPanel({
  projectScoped,
  draftSessionId,
  className
}: SessionTodoPanelProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const animationsEnabled = useSettingsStore((s) => s.animationsEnabled)
  const [expanded, setExpanded] = React.useState(false)
  const tasks = useTaskStore((s) =>
    draftSessionId ? s.getTasksBySession(draftSessionId) : EMPTY_TASKS
  )
  // 「本会话有没有活跃 run」的两个来源，与 hasActiveSessionRunForSession
  // （hooks/use-chat-actions.ts）同口径；这里必须订阅，否则不重渲染。
  const streamingMessage = useChatStore((s) =>
    draftSessionId ? s.streamingMessages[draftSessionId] : undefined
  )
  const executionStatus = useAgentStore((s) =>
    draftSessionId ? s.runningSessions[draftSessionId] : undefined
  )

  // 只显示当前批次：agent 开第二批时旧任务不会清理，全量显示会让计数一路累加。
  // 纯渲染过滤，数据一字不动（任务状态归 agent 所有）。
  const batchTasks = React.useMemo(() => resolveCurrentTodoBatch(tasks), [tasks])

  if (!projectScoped || !draftSessionId || batchTasks.length === 0) return null

  const isRunLive =
    Boolean(streamingMessage) ||
    executionStatus === 'running' ||
    executionStatus === 'retrying'
  const now = Date.now()
  const inProgressStates = new Map<string, InProgressState>()
  for (const task of batchTasks) {
    if (task.status !== 'in_progress') continue
    inProgressStates.set(
      task.id,
      isRunLive ? 'running' : now - task.updatedAt > STALE_IN_PROGRESS_MS ? 'stale' : 'suspended'
    )
  }
  const completed = batchTasks.filter((task) => task.status === 'completed').length
  const isExecuting = [...inProgressStates.values()].includes('running')
  const isComplete = completed === batchTasks.length
  const summaryLabel = t('todo.tasksDone', { completed, total: batchTasks.length })
  const transition = animationsEnabled ? { duration: 0.2, ease: EASE } : { duration: 0 }

  return (
    // 流式占位（iter-32 S-81）。这里曾经是「零高度包裹层 + bottom-full 悬浮」，
    // 目的是不占聊天窗的 flex 高度 —— 代价是它向上展开时会盖住 composer 上方的
    // 其它常驻提示条（API Key 提醒 / 排队面板 / goal 条），多条同时出现即遮挡。
    // 同为「输入框上方的常驻提示」，没有理由特殊，改回正常排列。
    <div className={cn('mb-2', className)}>
      <motion.div
        transition={transition}
        className="overflow-hidden rounded-xl border border-border/60 bg-background/80 shadow-xs backdrop-blur-sm"
      >
        <div className="flex items-center px-3 py-1.5">
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-left transition-colors hover:text-foreground"
            aria-label={summaryLabel}
            aria-expanded={expanded}
          >
            {isExecuting ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-blue-500" />
            ) : isComplete ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
            ) : (
              <ClipboardList className="size-3.5 shrink-0 text-muted-foreground/80" />
            )}
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground/90">
              {summaryLabel}
            </span>
            <ChevronDown
              className={cn(
                'size-3 shrink-0 text-muted-foreground transition-transform duration-200',
                expanded && 'rotate-180'
              )}
            />
          </button>
        </div>

        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="expanded"
              initial={animationsEnabled ? { height: 0, opacity: 0 } : false}
              animate={{ height: 'auto', opacity: 1 }}
              exit={animationsEnabled ? { height: 0, opacity: 0 } : undefined}
              transition={transition}
              style={{ overflow: 'hidden' }}
              className="border-t border-border/50"
            >
              <div className="max-h-64 overflow-y-auto px-3 py-2.5">
                <ol className="space-y-1.5">
                  {batchTasks.map((task, index) => {
                    // 非「执行中」的 in_progress 得给一句解释，否则用户只看到圈不转了。
                    const inProgressState = inProgressStates.get(task.id)
                    const inProgressHint =
                      inProgressState === 'suspended'
                        ? t('todo.inProgressSuspended')
                        : inProgressState === 'stale'
                          ? t('todo.inProgressStale')
                          : undefined
                    // 正文只占一行，全文放 title；提示语不能顶掉全文，两者拼一起。
                    const primaryText = getTaskPrimaryText(task)
                    const rowTitle = inProgressHint
                      ? `${primaryText}\n${inProgressHint}`
                      : primaryText
                    return (
                      <li
                        key={task.id}
                        title={rowTitle}
                        className="grid grid-cols-[18px_24px_minmax(0,1fr)] gap-2 text-[12px] leading-5"
                      >
                        <span className="flex justify-center pt-0.5">
                          <TaskStatusIcon
                            status={task.status}
                            inProgressState={inProgressState}
                          />
                        </span>
                        <span
                          className={cn(
                            'select-none pt-0.5 text-right tabular-nums text-muted-foreground/70',
                            task.status === 'completed' && 'text-muted-foreground/45'
                          )}
                        >
                          {index + 1}.
                        </span>
                        <div className="min-w-0">
                          <div
                            className={cn(
                              'min-w-0 truncate',
                              task.status === 'completed' &&
                                'text-muted-foreground/60 line-through',
                              task.status === 'pending' && 'text-muted-foreground/80'
                            )}
                          >
                            {primaryText}
                          </div>
                          {task.owner && (
                            <div className="text-[10px] text-muted-foreground/50">
                              {task.owner}
                            </div>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
