/**
 * Generate concise Chinese step descriptions from tool call data.
 * Used by SubAgentCard to show what the sub-agent is doing at each step.
 */

import { normalizeToolName } from '../../tools/tool-name-aliases'

interface ToolCallLike {
  name: string
  input: Record<string, unknown>
  status?: string
}

/**
 * Maps tool name to a Chinese verb and the key parameter to extract.
 */
const TOOL_DESCRIPTION_MAP: Record<
  string,
  { verb: string; paramKey: string; paramPrefix?: string }
> = {
  Read: { verb: '查看', paramKey: 'file_path' },
  Edit: { verb: '修改', paramKey: 'file_path' },
  Write: { verb: '写入', paramKey: 'file_path' },
  WriteFile: { verb: '写入', paramKey: 'file_path' },
  CreateFile: { verb: '创建', paramKey: 'file_path' },
  Bash: { verb: '执行命令', paramKey: 'command', paramPrefix: ': ' },
  ShellExec: { verb: '执行命令', paramKey: 'command', paramPrefix: ': ' },
  Glob: { verb: '搜索', paramKey: 'pattern', paramPrefix: ' ' },
  Grep: { verb: '搜索包含', paramKey: 'pattern', paramPrefix: ' ' },
  Task: { verb: '启动子任务', paramKey: 'description', paramPrefix: ': ' },
  WebFetch: { verb: '访问网页', paramKey: 'url', paramPrefix: ' ' },
  WebSearch: { verb: '搜索网页', paramKey: 'query', paramPrefix: ': ' },
  GitStatus: { verb: '查看 Git 状态', paramKey: '' },
  GitDiff: { verb: '查看 Git 差异', paramKey: '' },
  GitCommit: { verb: '提交 Git 变更', paramKey: 'message', paramPrefix: ': ' },
  ListFiles: { verb: '列出文件', paramKey: 'path', paramPrefix: ' ' },
  SearchFiles: { verb: '搜索文件', paramKey: 'query', paramPrefix: ': ' }
}

const FILE_PATH_TOOLS = new Set([
  'Read',
  'Edit',
  'Write',
  'WriteFile',
  'CreateFile'
])

const BASH_TOOLS = new Set(['Bash', 'ShellExec'])

const MAX_DESC_LENGTH = 40

/**
 * Extracts just the file name from a full path.
 */
function basename(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return lastSlash >= 0 && lastSlash < filePath.length - 1
    ? filePath.slice(lastSlash + 1)
    : filePath
}

/**
 * Truncates a string to maxLen, adding "..." if truncated.
 */
function truncate(str: string, maxLen: number = MAX_DESC_LENGTH): string {
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str
}

/**
 * Extracts and formats the key parameter value for a tool call.
 */
function extractParamValue(
  toolName: string,
  input: Record<string, unknown>
): string {
  const mapping = TOOL_DESCRIPTION_MAP[toolName]
  if (!mapping || !mapping.paramKey) return ''

  const raw = input[mapping.paramKey]
  if (typeof raw !== 'string') {
    // Try to stringify non-string values
    if (raw != null) {
      return truncate(String(raw))
    }
    // Fall back to first string value in input
    for (const value of Object.values(input)) {
      if (typeof value === 'string' && value.length > 0) {
        return truncate(value)
      }
    }
    return ''
  }

  let value = raw

  // For file path tools, only show the file name
  if (FILE_PATH_TOOLS.has(toolName)) {
    value = basename(value)
  }

  // For bash tools, truncate at first && or |
  if (BASH_TOOLS.has(toolName)) {
    const cutIdx = value.search(/\s*[&|]/)
    if (cutIdx > 0) value = value.slice(0, cutIdx).trim()
  }

  return truncate(value)
}

/**
 * Generates a concise Chinese description for a tool call.
 * Example: Read({ file_path: "agents.md" }) → "查看 agents.md 文件"
 */
export function generateStepDescription(toolCall: ToolCallLike): string {
  const { input } = toolCall
  // iter-29 (S-23): the multi-engine search tool was registered as `BrowserSearch`
  // and is now `WebSearch`. Transcripts persisted before the rename still carry the
  // old name, so normalise it before looking anything up.
  const name = normalizeToolName(toolCall.name)
  const mapping = TOOL_DESCRIPTION_MAP[name]

  if (!mapping) {
    // Unknown tool: use tool name + first param value
    const firstValue = extractParamValue(name, input)
    return firstValue ? `${name}: ${firstValue}` : name
  }

  const paramValue = extractParamValue(name, input)
  const prefix = mapping.paramPrefix ?? ' '

  // Special formatting per tool type
  if (FILE_PATH_TOOLS.has(name)) {
    return paramValue ? `${mapping.verb} ${paramValue} 文件` : mapping.verb
  }

  if (BASH_TOOLS.has(name)) {
    return paramValue ? `${mapping.verb}${prefix}${paramValue}` : mapping.verb
  }

  if (name === 'Glob') {
    return paramValue ? `${mapping.verb}${prefix}${paramValue} 文件` : mapping.verb
  }

  if (name === 'Grep') {
    return paramValue ? `${mapping.verb}${prefix}${paramValue} 的内容` : mapping.verb
  }

  // Default: verb + prefix + paramValue
  return paramValue ? `${mapping.verb}${prefix}${paramValue}` : mapping.verb
}

/**
 * Returns the status icon character for a tool call status.
 */
export function getStepStatusIcon(status: string | undefined): string {
  switch (status) {
    case 'running':
      return '●'
    case 'completed':
      return '✓'
    case 'error':
      return '✗'
    default:
      return '○'
  }
}

/**
 * Returns the CSS color class for a tool call status.
 */
export function getStepStatusColor(status: string | undefined): string {
  switch (status) {
    case 'running':
      return 'text-sky-500'
    case 'completed':
      return 'text-emerald-500'
    case 'error':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}
