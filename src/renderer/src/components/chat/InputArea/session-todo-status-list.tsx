import * as React from 'react'
import { TodoStatusList } from '../TodoCard'
import { useTaskStore } from '@renderer/stores/task-store'
import { cn } from '@renderer/lib/utils'

interface SessionTodoStatusListProps {
  projectScoped: boolean
  draftSessionId: string | null | undefined
  className?: string
}

export function SessionTodoStatusList({
  projectScoped,
  draftSessionId,
  className
}: SessionTodoStatusListProps): React.JSX.Element | null {
  const tasks = useTaskStore((s) => draftSessionId ? s.getTasksBySession(draftSessionId) : [])

  if (!projectScoped || !draftSessionId || tasks.length === 0) return null

  return <TodoStatusList tasks={tasks} className={cn('mb-2', className)} />
}
