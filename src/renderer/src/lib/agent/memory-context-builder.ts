import { useSettingsStore } from '../../stores/settings-store'
import { estimateTokens } from '../format-tokens'
import type { LayeredMemorySnapshot, SessionMemoryScope } from './memory-files'

/**
 * Build memory context text from a layered memory snapshot.
 * Extracted from dynamic-context.ts for maintainability (AGENTS.md: 200~500 lines per file).
 */
export function buildMemoryContext(
  snapshot: LayeredMemorySnapshot,
  sessionScope: SessionMemoryScope = 'main'
): string | null {
  const parts: string[] = []
  appendMemoryContext(parts, snapshot, sessionScope)
  return parts.length > 0 ? parts.join('\n') : null
}

function appendMemoryContext(
  parts: string[],
  snapshot: LayeredMemorySnapshot,
  sessionScope: SessionMemoryScope
): void {
  const globalSoul = snapshot.globalSoul?.content?.trim()
  const projectSoul = snapshot.projectSoul?.content?.trim()
  const globalUser = snapshot.globalUser?.content?.trim()
  const projectUser = snapshot.projectUser?.content?.trim()
  const globalMemory = snapshot.globalMemory?.content?.trim()
  const projectMemory = snapshot.projectMemory?.content?.trim()
  const globalMemorySummary = snapshot.globalMemorySummary?.content?.trim()
  const projectMemorySummary = snapshot.projectMemorySummary?.content?.trim()
  const globalMemoryPath = snapshot.globalMemory?.path?.trim()
  const globalMemorySummaryPath = snapshot.globalMemorySummary?.path?.trim()
  const projectMemorySummaryPath = snapshot.projectMemorySummary?.path?.trim()
  const globalDailyMemory = snapshot.globalDailyMemory ?? []
  const projectDailyMemory = snapshot.projectDailyMemory ?? []
  const settings = useSettingsStore.getState()
  const memoryUseMemories = settings.memoryUseMemories
  const memorySummaryBudget = Math.max(1000, settings.memorySummaryBudgetTokens)
  const effectiveGlobalMemory = globalMemorySummary
    ? {
        content: globalMemorySummary,
        path: globalMemorySummaryPath,
        summarizedFromPath: globalMemoryPath
      }
    : globalMemory && estimateTokens(globalMemory) <= memorySummaryBudget
      ? {
          content: globalMemory,
          path: globalMemoryPath
        }
      : {
          content: undefined,
          path: undefined
        }
  const effectiveProjectMemory = projectMemorySummary
    ? {
        content: projectMemorySummary,
        path: projectMemorySummaryPath,
        summarizedFromPath: snapshot.projectMemory?.path
      }
    : projectMemory && estimateTokens(projectMemory) <= memorySummaryBudget
      ? {
          content: projectMemory,
          path: snapshot.projectMemory?.path
        }
      : {
          content: undefined,
          path: undefined
        }

  if (sessionScope === 'main' && memoryUseMemories) {
    parts.push(
      `\n<memory_read_path_policy>`,
      `WishfulClaw memory is scoped. Global memory applies across projects; project memory applies only to the current workspace and takes priority when it conflicts with global memory.`,
      `Only summaries or small memory files are injected by default. Use MemoryList, MemoryRead, and MemorySearch when you need detailed memory provenance.`,
      `When relying on memory details from those tools, keep the scope and memoryRootId from the tool result with the cited fact so global memory and project memory are not confused.`,
      `</memory_read_path_policy>`
    )
  }

  const canInjectDurableMemory = sessionScope === 'main' && memoryUseMemories

  if (sessionScope === 'main') {
    parts.push(
      `\n<memory_loading_policy>`,
      `Session scope: MAIN. Load long-term persona, user profile, and curated memory layers.`,
      `Project-level files override global defaults when both exist. System prompt rules still take priority over all memory files.`,
      `SOUL.md defines your core identity, personality, tone, and behavioral constraints. You MUST embody and adhere to its directives throughout the entire conversation without exception, even when they are not explicitly repeated in follow-up messages.`,
      `</memory_loading_policy>`
    )
  } else if (sessionScope === 'channel') {
    parts.push(
      `\n<memory_loading_policy>`,
      `Session scope: CHANNEL. Load long-term persona/style from SOUL.md for channel replies.`,
      `Do not rely on USER.md, MEMORY.md, or daily memory files in channel contexts unless explicitly provided in the conversation.`,
      `Project-level SOUL.md refines or overrides the global soul for this workspace. System prompt rules still take priority over all memory files.`,
      `</memory_loading_policy>`
    )
  } else {
    parts.push(
      `\n<memory_loading_policy>`,
      `Session scope: SHARED. Do not rely on SOUL.md, USER.md, MEMORY.md, or daily memory files in shared contexts.`,
      `Use only the system prompt, current shared-session context, and any explicitly provided runtime details.`,
      `</memory_loading_policy>`
    )
  }

  if (sessionScope !== 'shared' && globalSoul) {
    parts.push(
      `\n<global_soul priority="high">`,
      `The following is global SOUL.md from \`${snapshot.globalSoul?.path}\`.`,
      `This file defines your **core identity, personality, communication style, and behavioral rules**. You MUST internalize and follow every directive below for the ENTIRE conversation. Do NOT revert to generic assistant behavior. When in doubt, re-read and comply with this section.`,
      ``,
      globalSoul,
      ``,
      `[END OF SOUL — Remember: the above directives override default behavior and apply to every response you produce.]`,
      `</global_soul>`
    )
  }

  if (sessionScope !== 'shared' && projectSoul) {
    parts.push(
      `\n<project_soul priority="high">`,
      `The following is project SOUL.md from \`${snapshot.projectSoul?.path}\`. It refines or overrides the global soul for this workspace. Where it conflicts with global SOUL.md, this file wins.`,
      `You MUST follow these project-level identity and style directives throughout the conversation.`,
      ``,
      projectSoul,
      `</project_soul>`
    )
  }

  if (canInjectDurableMemory && globalUser) {
    parts.push(
      `\n<global_user>`,
      `The following is global USER.md from \`${snapshot.globalUser?.path}\`, describing the human you are helping across projects.`,
      ``,
      globalUser,
      `</global_user>`
    )
  }

  if (canInjectDurableMemory && projectUser) {
    parts.push(
      `\n<project_user>`,
      `The following is project USER.md from \`${snapshot.projectUser?.path}\`. It adds workspace-specific user preferences and goals.`,
      ``,
      projectUser,
      `</project_user>`
    )
  }

  if (canInjectDurableMemory && globalDailyMemory.length > 0) {
    parts.push(
      `\n<global_daily_memory>`,
      `Recent global daily memory files provide short-term continuity.`,
      ...globalDailyMemory.flatMap((entry) => [
        `\n## ${entry.date} - \`${entry.path}\``,
        entry.content ?? ''
      ]),
      `</global_daily_memory>`
    )
  }

  if (canInjectDurableMemory && projectDailyMemory.length > 0) {
    parts.push(
      `\n<project_daily_memory>`,
      `Recent project daily memory files provide short-term workspace continuity.`,
      ...projectDailyMemory.flatMap((entry) => [
        `\n## ${entry.date} - \`${entry.path}\``,
        entry.content ?? ''
      ]),
      `</project_daily_memory>`
    )
  }

  if (canInjectDurableMemory && effectiveGlobalMemory.content) {
    parts.push(
      `\n<global_memory>`,
      effectiveGlobalMemory.summarizedFromPath
        ? `The following is memory_summary.md from \`${effectiveGlobalMemory.path}\`, summarizing oversized global MEMORY.md from \`${effectiveGlobalMemory.summarizedFromPath}\`.`
        : `The following is global MEMORY.md from \`${effectiveGlobalMemory.path}\`, containing curated cross-session memory.`,
      ``,
      effectiveGlobalMemory.content,
      `</global_memory>`
    )
  }

  if (canInjectDurableMemory && effectiveProjectMemory.content) {
    parts.push(
      `\n<project_long_term_memory>`,
      effectiveProjectMemory.summarizedFromPath
        ? `The following is memory_summary.md from \`${effectiveProjectMemory.path}\`, summarizing oversized project MEMORY.md from \`${effectiveProjectMemory.summarizedFromPath}\`.`
        : `The following is project MEMORY.md from \`${effectiveProjectMemory.path}\`, containing workspace-specific long-term memory.`,
      ``,
      effectiveProjectMemory.content,
      `</project_long_term_memory>`
    )
  }
}
