import type React from 'react'
import { FileCode, Trash2, ListTodo, CalendarClock, Bell, HelpCircle, Code2, Globe2, MousePointerClick, Keyboard, ScrollText, Camera, Monitor, SquareTerminal, LogIn, LogOut, FileText, Target, Database, Box, Search, FolderTree } from 'lucide-react'
import type { ToolResultContent } from '@renderer/lib/api/types'
import { type CompactToolHeaderBadge, type CompactToolHeaderModel } from '../CompactToolCallHeader'
import type { ToolCallCardProps } from './types'
import { COMMAND_TOOL_NAMES } from './types'
import {
  compactWhitespace,
  getStringInput,
  firstStringInput,
  compactPath,
  pathFileName,
  pathParent,
  fileToolPath,
  compactToolPathSummary,
  getSkillNameFromInput,
  getReadOutputLineCount,
  hasImageBlocks,
  bashOutputStats,
  parseGrepOutput,
  parseGlobOutput,
  parseLsEntries,
  getSearchVisualState
} from './utils'
import { SearchStateBadge } from './shared'

export function compactStatusLabel(
  status: ToolCallCardProps['status'],
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (status === 'streaming') return t('toolCall.receivingArgs')
  if (status === 'running') return t('toolCall.executing')
  if (status === 'pending_approval') return t('permission.title')
  if (status === 'error') return t('error.label')
  if (status === 'canceled') return t('toolCall.canceled', { defaultValue: 'Canceled' })
  return null
}

function lineRangeBadge(
  input: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  const rawOffset = input.offset
  const rawLimit = input.limit
  const offset = typeof rawOffset === 'number' && Number.isFinite(rawOffset) ? rawOffset : null
  const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit) ? rawLimit : null
  if (offset === null) return null
  if (limit === null || limit <= 0) return t('toolCall.lineRangeFrom', { start: offset })
  return t('toolCall.lineRange', { start: offset, end: offset + limit - 1 })
}

function searchScopeText(
  input: Record<string, unknown>,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const path = getStringInput(input, ['path'])
  const include = getStringInput(input, ['include'])
  const exclude = getStringInput(input, ['exclude'])
  return [
    path ? t('toolCall.searchInPath', { path: compactPath(path, 3) }) : null,
    include ? t('toolCall.includeGlob', { include }) : null,
    exclude ? t('toolCall.excludeGlob', { exclude }) : null
  ]
    .filter((item): item is string => !!item)
    .join(' · ')
}

function genericCompactToolHeaderModel({
  icon,
  primary,
  secondary,
  displayName
}: {
  icon: React.ReactNode
  primary?: string
  secondary?: string
  displayName: string
}): CompactToolHeaderModel {
  return {
    icon,
    primary: primary || displayName,
    secondary,
    badges: [],
    title: [primary, secondary].filter(Boolean).join('\n') || displayName
  }
}

function getBuiltinToolIcon(name: string): React.ReactNode {
  if (['Write', 'SavePlan'].includes(name)) return <FileCode className="size-3.5" />
  if (['Edit', 'NotebookEdit'].includes(name)) return <FileCode className="size-3.5" />
  if (name === 'Delete') return <Trash2 className="size-3.5" />
  if (name.startsWith('Task')) return <ListTodo className="size-3.5" />
  if (name.startsWith('Cron')) return <CalendarClock className="size-3.5" />
  if (name === 'Notify') return <Bell className="size-3.5" />
  if (name === 'AskUserQuestion') return <HelpCircle className="size-3.5" />
  if (name === 'visualize_show_widget') return <Code2 className="size-3.5" />
  if (name === 'WebSearch' || name === 'WebFetch' || name.startsWith('Browser')) {
    if (name === 'BrowserClick') return <MousePointerClick className="size-3.5" />
    if (name === 'BrowserType') return <Keyboard className="size-3.5" />
    if (name === 'BrowserScroll') return <ScrollText className="size-3.5" />
    if (name === 'BrowserScreenshot') return <Camera className="size-3.5" />
    if (name === 'BrowserSnapshot') return <Monitor className="size-3.5" />
    return <Globe2 className="size-3.5" />
  }
  if (name === 'Monitor') return <SquareTerminal className="size-3.5" />
  if (name === 'EnterPlanMode') return <LogIn className="size-3.5" />
  if (name === 'SubmitPlanReview') return <LogOut className="size-3.5" />
  if (name === 'Skill') return <FileText className="size-3.5" />
  if (name.endsWith('goal')) return <Target className="size-3.5" />
  if (name.startsWith('memory_')) return <Database className="size-3.5" />
  return <Box className="size-3.5" />
}

export function getToolNamespace(name: string): string {
  if (['Read', 'Write', 'Edit', 'NotebookEdit', 'LS', 'Delete'].includes(name)) return 'files'
  if (['Glob', 'Grep'].includes(name)) return 'search'
  if (COMMAND_TOOL_NAMES.has(name) || name === 'Monitor') return 'shell'
  if (name.startsWith('Browser') || name === 'WebSearch' || name === 'WebFetch') return 'web'
  if (name.startsWith('Task')) return 'tasks'
  if (name.startsWith('Cron')) return 'cron'
  if (name.startsWith('memory_')) return 'memory'
  if (name.endsWith('goal')) return 'goal'
  if (name === 'visualize_show_widget') return 'widget'
  if (name === 'Notify') return 'notify'
  if (name === 'Skill') return 'skill'
  return 'wishful-claw'
}

export function buildCompactToolHeaderModel({
  name,
  input,
  output,
  outputText,
  displayName,
  summary,
  t
}: {
  name: string
  input: Record<string, unknown>
  output?: ToolResultContent
  outputText?: string
  displayName: string
  summary?: string | null
  t: (key: string, options?: Record<string, unknown>) => string
}): CompactToolHeaderModel {
  if (COMMAND_TOOL_NAMES.has(name)) {
    const command = compactWhitespace(getStringInput(input, ['command', 'command_preview']))
    const description = getStringInput(input, ['description'])
    const stats = bashOutputStats(outputText)
    const badges: CompactToolHeaderBadge[] = []
    if (stats.exitCode !== null)
      badges.push({ label: t('toolCall.exitCode', { code: stats.exitCode }) })
    if (stats.lines !== null) {
      badges.push({ label: t('toolCall.outputLineCount', { count: stats.lines }), tone: 'blue' })
    }
    const commandLines = typeof input.command_lines === 'number' ? input.command_lines : null
    if (commandLines !== null && stats.lines === null) {
      badges.push({ label: t('toolCall.lineCount', { count: commandLines }), tone: 'blue' })
    }
    return {
      icon: <SquareTerminal className="size-3.5" />,
      primary: command || summary || t('toolCall.receivingArgs'),
      secondary: description || undefined,
      badges,
      title: command || summary || displayName
    }
  }

  if (name === 'Read') {
    const filePath = getStringInput(input, ['file_path', 'path'])
    const lines = getReadOutputLineCount(outputText)
    const range = lineRangeBadge(input, t)
    const badges: CompactToolHeaderBadge[] = []
    if (lines !== null)
      badges.push({ label: t('toolCall.lineCount', { count: lines }), tone: 'blue' })
    if (range) badges.push({ label: range })
    if (hasImageBlocks(output)) badges.push({ label: t('toolCall.imageFile'), tone: 'blue' })
    return {
      icon: <FileCode className="size-3.5" />,
      primary: pathFileName(filePath) || summary || t('toolCall.receivingArgs'),
      secondary: filePath ? pathParent(filePath) || compactPath(filePath, 2) : undefined,
      badges,
      title: filePath || summary || displayName
    }
  }

  if (['Write', 'Edit', 'Delete', 'NotebookEdit', 'SavePlan'].includes(name)) {
    const targetPath = fileToolPath(input)
    const pathSummary = compactToolPathSummary(targetPath)
    const badges: CompactToolHeaderBadge[] = []
    const lineTotal =
      typeof input.content_lines === 'number'
        ? input.content_lines
        : typeof input.old_string_lines === 'number' || typeof input.new_string_lines === 'number'
          ? Math.max(
              typeof input.old_string_lines === 'number' ? input.old_string_lines : 0,
              typeof input.new_string_lines === 'number' ? input.new_string_lines : 0
            )
          : null
    const editCount = Array.isArray(input.edits) ? input.edits.length : null
    if (editCount !== null) badges.push({ label: t('toolCall.pathCount', { count: editCount }) })
    if (lineTotal !== null) {
      badges.push({ label: t('toolCall.lineCount', { count: lineTotal }), tone: 'blue' })
    }
    if (
      input.content_truncated === true ||
      input.old_string_truncated === true ||
      input.new_string_truncated === true
    ) {
      badges.push({ label: t('toolCall.preview'), tone: 'amber' })
    }
    return {
      icon: getBuiltinToolIcon(name),
      primary: pathSummary.primary || summary || displayName,
      secondary: pathSummary.secondary,
      badges,
      title: targetPath || summary || displayName
    }
  }

  if (name === 'Grep') {
    const pattern = getStringInput(input, ['pattern'])
    const parsed = outputText ? parseGrepOutput(outputText) : null
    const matchCount = parsed?.matches.length ?? null
    const fileCount = parsed ? new Set(parsed.matches.map((match) => match.file)).size : null
    const badges: CompactToolHeaderBadge[] = []
    if (matchCount !== null && fileCount !== null) {
      badges.push({
        label: t('toolCall.matchesInFiles', { matches: matchCount, files: fileCount }),
        tone: matchCount > 0 ? 'amber' : 'default'
      })
    }
    return {
      icon: <Search className="size-3.5" />,
      primary: pattern ? `/${pattern}/` : summary || t('toolCall.receivingArgs'),
      secondary: searchScopeText(input, t) || undefined,
      badges,
      statusBadge: parsed ? (
        <SearchStateBadge state={getSearchVisualState(parsed.meta, parsed.matches.length)} />
      ) : undefined,
      title: [pattern ? `/${pattern}/` : '', searchScopeText(input, t)].filter(Boolean).join('\n')
    }
  }

  if (name === 'Glob') {
    const pattern = getStringInput(input, ['pattern'])
    const path = getStringInput(input, ['path'])
    const parsed = outputText ? parseGlobOutput(outputText) : null
    const badges: CompactToolHeaderBadge[] = []
    if (parsed) {
      badges.push({
        label: t('toolCall.pathCount', { count: parsed.matches.length }),
        tone: parsed.matches.length > 0 ? 'green' : 'default'
      })
    }
    return {
      icon: <Search className="size-3.5" />,
      primary: pattern || summary || t('toolCall.receivingArgs'),
      secondary: path ? t('toolCall.searchInPath', { path: compactPath(path, 3) }) : undefined,
      badges,
      statusBadge: parsed ? (
        <SearchStateBadge state={getSearchVisualState(parsed.meta, parsed.matches.length)} />
      ) : undefined,
      title: [pattern, path].filter(Boolean).join('\n') || summary || displayName
    }
  }

  if (name === 'LS') {
    const path = getStringInput(input, ['path'])
    const parsed = parseLsEntries(outputText)
    const dirs = parsed?.filter((entry) => entry.type === 'directory').length ?? null
    const files = parsed?.filter((entry) => entry.type === 'file').length ?? null
    const badges: CompactToolHeaderBadge[] = []
    if (dirs !== null && files !== null) {
      badges.push({ label: t('toolCall.foldersAndFiles', { folders: dirs, files }) })
    }
    return {
      icon: <FolderTree className="size-3.5" />,
      primary: compactPath(path, 3) || summary || t('toolCall.receivingArgs'),
      secondary: path && compactPath(path, 3) !== path ? path : undefined,
      badges,
      title: path || summary || displayName
    }
  }

  if (name.startsWith('Task')) {
    const taskTitle = firstStringInput(input, ['title', 'subject', 'name', 'content'])
    const taskId = firstStringInput(input, ['taskId', 'task_id', 'id'])
    const taskStatus = firstStringInput(input, ['status', 'state'])
    return genericCompactToolHeaderModel({
      icon: getBuiltinToolIcon(name),
      primary: taskTitle || (taskId ? `#${taskId}` : summary || displayName),
      secondary: taskStatus || undefined,
      displayName
    })
  }

  if (name.startsWith('Cron')) {
    const cronName = firstStringInput(input, ['name', 'title', 'id', 'cronId'])
    const schedule = firstStringInput(input, ['expr', 'cron', 'schedule', 'rrule'])
    return genericCompactToolHeaderModel({
      icon: getBuiltinToolIcon(name),
      primary: cronName || summary || displayName,
      secondary: schedule || undefined,
      displayName
    })
  }

  if (name === 'AskUserQuestion') {
    const questions = Array.isArray(input.questions) ? input.questions.length : null
    return {
      icon: getBuiltinToolIcon(name),
      primary: summary || displayName,
      secondary: questions ? t('toolCall.pathCount', { count: questions }) : undefined,
      badges: [],
      title: summary || displayName
    }
  }

  if (name === 'Skill') {
    const skillName = getSkillNameFromInput(input)
    return {
      icon: getBuiltinToolIcon(name),
      primary: skillName || summary || displayName,
      badges: [],
      title: skillName || summary || displayName
    }
  }

  if (name === 'visualize_show_widget') {
    const title = firstStringInput(input, ['title', 'name'])
    const chars =
      typeof input.widget_code_chars === 'number'
        ? input.widget_code_chars
        : typeof input.widget_code === 'string'
          ? input.widget_code.length
          : null
    return {
      icon: getBuiltinToolIcon(name),
      primary: title || summary || displayName,
      badges:
        chars !== null ? [{ label: t('toolCall.charCount', { count: chars }), tone: 'blue' }] : [],
      title: title || summary || displayName
    }
  }

  if (name.startsWith('Browser') || name === 'WebFetch' || name === 'WebSearch') {
    const target = firstStringInput(input, ['url', 'query', 'selector', 'text'])
    return genericCompactToolHeaderModel({
      icon: getBuiltinToolIcon(name),
      primary: target || summary || displayName,
      displayName
    })
  }

  if (
    [
      'Notify',
      'Monitor',
      'EnterPlanMode',
      'SubmitPlanReview',
      'get_goal',
      'create_goal',
      'update_goal',
    ].includes(name)
  ) {
    const primary = firstStringInput(input, [
      'message',
      'objective',
      'query',
      'name',
      'uri',
      'path',
      'command',
      'reason'
    ])
    return genericCompactToolHeaderModel({
      icon: getBuiltinToolIcon(name),
      primary: primary || summary || displayName,
      displayName
    })
  }

  if (name === 'memory_hot_read') {
    const scope = firstStringInput(input, ['scope'])
    return {
      icon: getBuiltinToolIcon(name),
      primary: scope || summary || displayName,
      secondary: undefined,
      badges: [],
      title: scope || summary || displayName
    }
  }

  if (name === 'memory_hot_write') {
    const section = firstStringInput(input, ['section'])
    return {
      icon: getBuiltinToolIcon(name),
      primary: section || summary || displayName,
      secondary: undefined,
      badges: [],
      title: section || summary || displayName
    }
  }

  if (name === 'memory_search') {
    const query = firstStringInput(input, ['query'])
    const scope = firstStringInput(input, ['scope'])
    return {
      icon: getBuiltinToolIcon(name),
      primary: query ? `/${query}/` : (summary || displayName),
      secondary: scope || undefined,
      badges: [],
      title: [query, scope].filter(Boolean).join('\n') || summary || displayName
    }
  }

  if (name === 'memory_append') {
    return {
      icon: getBuiltinToolIcon(name),
      primary: summary || displayName,
      badges: [],
      title: summary || displayName
    }
  }

  if (name === 'memory_update') {
    const id = firstStringInput(input, ['id'])
    return {
      icon: getBuiltinToolIcon(name),
      primary: id ? `#${id}` : (summary || displayName),
      secondary: undefined,
      badges: [],
      title: summary || displayName
    }
  }

  return {
    icon: getBuiltinToolIcon(name),
    primary: summary || displayName,
    badges: [],
    title: summary || displayName
  }
}

export function hasFocusedExpandedOutput(
  name: string,
  output: ToolResultContent | undefined,
  outputText: string | undefined
): boolean {
  if (!output) return false
  if (name === 'Read') return true
  return ['Grep', 'Glob', 'LS'].includes(name) && (outputText?.length ?? 0) > 0
}
