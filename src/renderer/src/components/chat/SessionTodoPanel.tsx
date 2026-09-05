/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 *
 * 母本：OpenCowork src/renderer/src/components/cowork/StepsPanel.tsx 的
 * InlineStepsPanelCard。改动：去掉变更审查入口（本仓 ChangeReviewSheet /
 * RunChangeReviewCard 零 importer，接上去是死链）、去掉 team 任务聚合（现存
 * 活路径 TodoStatusList 也不聚合）、改为悬浮挂载不再占聊天窗 flex 高度。
 */

import * as React from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleDotDashed,
  CircleSlash,
  ClipboardList,
  Loader2
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useTaskStore, type TaskItem } from '@renderer/stores/task-store'

const EASE = [0.4, 0, 0.2, 1] as const
const EMPTY_TASKS: TaskItem[] = []

function TaskStatusIcon({ status }: { status: TaskItem['status'] }): React.JSX.Element {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-green-500" />
    case 'in_progress':
      return <Loader2 className="size-4 animate-spin text-blue-500" />
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
 * 会话 Todo 悬浮面板：贴在 composer 上方，展开体内部滚动，不挤占聊天窗高度。
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

  if (!projectScoped || !draftSessionId || tasks.length === 0) return null

  const completed = tasks.filter((task) => task.status === 'completed').length
  const isExecuting = tasks.some((task) => task.status === 'in_progress')
  const isComplete = completed === tasks.length
  const summaryLabel = t('todo.tasksDone', { completed, total: tasks.length })
  const transition = animationsEnabled ? { duration: 0.2, ease: EASE } : { duration: 0 }

  return (
    // 自带 relative 包裹层：bottom-full 以最近的 relative 祖先为锚，而挂载点在
    // composer-shell 容器之外，缺这层会锚到更远的祖先导致悬浮层错位。包裹层自身
    // 零高度（唯一子元素绝对定位），因此不再占用聊天窗的 flex 高度。
    <div className={cn('relative', className)}>
      <div className="absolute inset-x-0 bottom-full z-30 mb-2">
        <motion.div
          transition={transition}
          className="overflow-hidden rounded-xl border border-border/60 bg-background/80 shadow-xs backdrop-blur-sm"
        >
          <div className="flex items-center px-3 py-1.5">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex min-w-0 cursor-pointer items-center gap-2 text-left transition-colors hover:text-foreground"
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
              <span className="min-w-0 truncate text-[12px] font-medium text-foreground/90">
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
                    {tasks.map((task, index) => (
                      <li
                        key={task.id}
                        className="grid grid-cols-[18px_24px_minmax(0,1fr)] gap-2 text-[12px] leading-5"
                      >
                        <span className="flex justify-center pt-0.5">
                          <TaskStatusIcon status={task.status} />
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
                              'min-w-0 break-words',
                              task.status === 'completed' &&
                                'text-muted-foreground/60 line-through',
                              task.status === 'pending' && 'text-muted-foreground/80'
                            )}
                          >
                            {getTaskPrimaryText(task)}
                          </div>
                          {task.owner && (
                            <div className="text-[10px] text-muted-foreground/50">
                              {task.owner}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}
