import { useTaskStore } from '../../stores/task-store'
import { usePlanStore } from '../../stores/plan-store'
import { useGoalStore } from '../../stores/goal-store'
export { buildMemoryContext } from './memory-context-builder'
import { useMcpStore } from '../../stores/mcp-store'
import { getRegisteredSkills } from '../tools/skill-tool'
import { buildGoalSessionStateLine } from './goal-context'

/**
 * Build a runtime reminder passed to the Native Worker as request context.
 * Carries lightweight session state.
 */
export async function buildRuntimeReminder(options: {
  sessionId: string
}): Promise<string> {
  const { sessionId } = options

  const parts: string[] = []
  const sessionStateContext = buildSessionStateContext(sessionId)
  if (sessionStateContext) {
    parts.push(sessionStateContext)
  }

  if (parts.length === 0) {
    return ''
  }

  return `<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
}

function buildSessionStateContext(sessionId: string): string | null {
  const parts: string[] = ['Session State:']

  // Capability route: only tell the agent that use_capability exists.
  // Full enumeration is unnecessary — the agent can discover via use_capability(action="list").
  const mcpStore = useMcpStore.getState()
  const activeServers = mcpStore.getActiveMcps()
  const skills = getRegisteredSkills()
  if (activeServers.length > 0 || skills.length > 0) {
    parts.push(
      `- Capabilities: ${activeServers.length} MCP server(s), ${skills.length} skill(s) available. Use use_capability(action="list") to discover, action="inspect" for schema, action="call" to execute.`
    )
  }

  const goal = useGoalStore.getState().getGoalBySession(sessionId)
  if (goal) {
    parts.push(buildGoalSessionStateLine(goal))
    if (goal.status === 'active') {
      parts.push('  Reminder: Keep working toward the active goal unless the user redirects you.')
    }
    if (goal.status === 'paused') {
      parts.push('  Reminder: The goal is paused. Do not auto-continue it until resumed.')
    }
    if (goal.status === 'blocked') {
      parts.push('  Reminder: The goal is blocked. Do not claim it is unblocked without new input.')
    }
    if (goal.status === 'usage_limited') {
      parts.push('  Reminder: The goal is usage-limited. Wait for resume before continuing.')
    }
    if (goal.status === 'budget_limited') {
      parts.push('  Reminder: The goal is budget-limited. Wrap up instead of starting new work.')
    }
  }

  const tasks = useTaskStore.getState().getTasksBySession(sessionId)
  if (tasks.length > 0) {
    const pending = tasks.filter((task) => task.status === 'pending').length
    const inProgress = tasks.filter((task) => task.status === 'in_progress').length
    const completed = tasks.filter((task) => task.status === 'completed').length
    parts.push(
      `- Task List: ${tasks.length} tasks (${pending} pending, ${inProgress} in_progress, ${completed} completed)`
    )
    if (inProgress > 0 || pending > 0) {
      parts.push(
        '  Reminder: Continue with existing tasks and use TodoTaskUpdate to keep status current.'
      )
    }
  }

  const plan = usePlanStore.getState().getPlanBySession(sessionId)
  if (plan) {
    parts.push(`- Plan: "${plan.title}" (status: ${plan.status})`)
    if (plan.status === 'awaiting_review') {
      parts.push(
        '  Reminder: The plan is awaiting user review. Do not implement until it is approved.'
      )
    }
    if (plan.status === 'approved' || plan.status === 'implementing') {
      parts.push('  Reminder: An approved plan exists. Follow the plan steps for implementation.')
    }
    if (plan.status === 'rejected') {
      parts.push('  Reminder: The plan was rejected. Revise it in Plan Mode based on feedback.')
    }
  }

  return parts.length > 1 ? parts.join('\n') : null
}

