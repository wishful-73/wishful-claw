import type {
  AIModelConfig,
  SelectedFileReadItemMeta,
  SelectedFileReadsMeta
} from '../api/types'
import { estimateTokens } from '../format-tokens'
import { IPC } from '../ipc/channels'
import { ipcClient } from '../ipc/ipc-client'
import { parseSelectFileText } from '../select-file-tags'

/** 单文件行数硬上限，与 token 预算构成双保险。 */
export const SELECTED_FILE_READ_MAX_LINES = 1_000

const FILE_CONTEXT_BUDGET_RATIO = 0.25
const FILE_CONTEXT_BUDGET_MAX_TOKENS = 24_000
const FILE_CONTEXT_FALLBACK_TOKENS = 12_000

/**
 * 按 utf-8 读进来只会污染上下文的扩展名：office/pdf 是压缩包，其余是二进制。
 * `fs:read-file` 不做扩展名判断，白名单只能在这里维护。
 */
const BLOCKED_TEXT_READ_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.docm',
  '.dot',
  '.dotx',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.ppt',
  '.pptx',
  '.pps',
  '.ppsx',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
  '.pages',
  '.numbers',
  '.key',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.ico',
  '.tif',
  '.tiff',
  '.heic',
  '.heif',
  '.avif',
  '.psd',
  '.ai',
  '.sketch',
  '.fig',
  '.mp3',
  '.wav',
  '.ogg',
  '.oga',
  '.m4a',
  '.aac',
  '.flac',
  '.opus',
  '.mp4',
  '.m4v',
  '.mov',
  '.webm',
  '.mkv',
  '.avi',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.zst',
  '.dmg',
  '.iso',
  '.img',
  '.exe',
  '.msi',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.parquet',
  '.arrow',
  '.wasm',
  '.pyc',
  '.class',
  '.jar',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2'
])

/** `fs:stat-path` 与 `ssh:fs:stat-path` 的返回 shape 不一致，取两者并集。 */
interface FsStatResult {
  exists?: boolean
  isDirectory?: boolean
  error?: string
}

interface ResolvedSelectedFile {
  /** 用户看到的原样路径（工作区内是相对路径），也是注入块的 `##` 标题。 */
  displayPath: string
  /** 交给 IPC 的绝对路径；null 表示无法解析，只作路径引用不读盘。 */
  readPath: string | null
}

export interface SelectedFileContextArgs {
  /** 待发送的原始消息文本，`<select-file>` 与 `@{path}` 两种形态都在里面。 */
  text: string
  workingFolder?: string
  sshConnectionId?: string
  modelConfig?: AIModelConfig | null
}

export interface SelectedFileContextResult {
  meta?: SelectedFileReadsMeta
  /** 追加到发给模型的文本末尾；无可注入内容时为 undefined，但 meta 仍会返回。 */
  contextText?: string
}

/**
 * 从消息文本解析出被引用的文件，读盘并拼成 `<system-reminder><selected_files>` 注入块。
 *
 * 唯一注入来源是消息文本本身：composer 的局部 selectedFiles、`sendOptions.selectedFileReferences`
 * 与 `ui-store.selectedFiles` 三条通道都没有读取方，排队消息重放也走同一条文本装配路径。
 */
export async function buildSelectedFileContext(
  args: SelectedFileContextArgs
): Promise<SelectedFileContextResult> {
  const files = collectSelectedFilePaths(args.text, args.workingFolder)
  if (files.length === 0) return {}

  const budget = resolveFileContextBudget(args.modelConfig)
  const metaFiles: SelectedFileReadItemMeta[] = []
  const sections: string[] = []
  let usedTokens = 0

  for (const file of files) {
    const baseMeta: SelectedFileReadItemMeta = {
      id: `file-${metaFiles.length + 1}`,
      name: getBaseNameFromPath(file.displayPath),
      path: file.displayPath,
      ...(file.readPath ? { readPath: file.readPath } : {}),
      lineCount: 0,
      maxLines: SELECTED_FILE_READ_MAX_LINES,
      truncated: false
    }

    if (!file.readPath) {
      metaFiles.push({ ...baseMeta, skipped: true, skipReason: 'unresolved' })
      continue
    }

    const skipReason = getBlockedExtensionSkipReason(file.readPath)
    if (skipReason) {
      metaFiles.push({ ...baseMeta, skipped: true, skipReason })
      continue
    }

    const statError = await statFileForRead(file.readPath, args.sshConnectionId)
    if (statError) {
      metaFiles.push({ ...baseMeta, error: statError })
      continue
    }

    let content: string
    try {
      content = await readTextFile(file.readPath, args.sshConnectionId)
    } catch (error) {
      metaFiles.push({ ...baseMeta, error: formatReadError(error) })
      continue
    }

    // 行数硬上限先切，再进 token 预算：先切把 estimateTokens 的输入压到
    // 1000 行以内，超大文件不必整篇分词。
    const lines = content ? content.split(/\r?\n/) : []
    const overLineCap = lines.length > SELECTED_FILE_READ_MAX_LINES
    let kept = overLineCap ? lines.slice(0, SELECTED_FILE_READ_MAX_LINES) : lines
    let truncated = overLineCap

    const header = `## ${file.displayPath}`
    const headerTokens = estimateTokens(header)
    const remaining = budget - usedTokens - headerTokens
    if (remaining <= 0) {
      metaFiles.push({ ...baseMeta, skipped: true, skipReason: 'budget' })
      continue
    }

    const bodyTokens = estimateTokens(kept.join('\n'))
    if (bodyTokens > remaining) {
      kept = truncateLinesToTokenBudget(kept, remaining)
      truncated = true
      if (kept.length === 0) {
        metaFiles.push({ ...baseMeta, skipped: true, skipReason: 'budget' })
        continue
      }
    }

    const body = kept.join('\n')
    usedTokens += headerTokens + estimateTokens(body)
    sections.push(
      [header, sanitizeInjectedContent(body), truncated ? `[Only the first ${kept.length} lines were read.]` : '']
        .filter(Boolean)
        .join('\n')
    )
    metaFiles.push({ ...baseMeta, lineCount: kept.length, truncated })
  }

  const meta: SelectedFileReadsMeta = {
    maxLines: SELECTED_FILE_READ_MAX_LINES,
    files: metaFiles
  }

  if (sections.length === 0) return { meta }

  return {
    meta,
    contextText: [
      '<system-reminder>',
      'The user selected file references in this message. The application read the following file contents directly before sending. Use this as user-provided context.',
      '<selected_files>',
      ...sections,
      '</selected_files>',
      '</system-reminder>'
    ].join('\n')
  }
}

function collectSelectedFilePaths(text: string, workingFolder?: string): ResolvedSelectedFile[] {
  const byKey = new Map<string, ResolvedSelectedFile>()
  for (const segment of parseSelectFileText(text)) {
    if (segment.type !== 'file') continue
    const sendPath = normalizeFilePath(segment.text)
    if (!sendPath) continue
    const readPath = resolveReadPath(sendPath, workingFolder)
    // parseSelectFileText 只按标签位置合并重叠区间，不按路径去重：同一文件从文件树
    // 和 @ 搜索各加一次会得到两个 file 段，路径级去重必须在这里做。
    const key = normalizeFilePathKey(readPath ?? sendPath)
    if (byKey.has(key)) continue
    byKey.set(key, { displayPath: sendPath, readPath })
  }
  return Array.from(byKey.values())
}

function resolveReadPath(sendPath: string, workingFolder?: string): string | null {
  if (isAbsoluteFilePath(sendPath)) return sendPath
  // 相对路径没有 workingFolder 就没有根（全局会话），退化为纯路径引用而不是瞎拼。
  if (!workingFolder) return null
  return resolveWithinFolder(workingFolder, sendPath)
}

/**
 * 把相对路径拼进 workingFolder 并做越界防护：`..` 一旦走出根目录就判不可解析。
 * 没有这层防护，拼错的路径会让整个项目的文件全部退化成「未读取」。
 */
function resolveWithinFolder(workingFolder: string, relativePath: string): string | null {
  const prefix = normalizeFilePath(workingFolder).replace(/\/+$/, '')
  const baseSegments = prefix.split('/').filter(Boolean)
  const baseDepth = baseSegments.length
  const segments = [...baseSegments]

  for (const raw of normalizeFilePath(relativePath).split('/')) {
    if (!raw || raw === '.') continue
    if (raw === '..') {
      segments.pop()
      if (segments.length < baseDepth) return null
      continue
    }
    segments.push(raw)
  }

  if (segments.length <= baseDepth) return null
  return `${prefix}/${segments.slice(baseDepth).join('/')}`
}

async function statFileForRead(path: string, sshConnectionId?: string): Promise<string | null> {
  // `fs:read-file` 与 `ssh:fs:read-file` 都把 ENOENT / EISDIR / 权限错误吞成 ''，
  // 读回的空串无法区分「空文件」和「读失败」，失败态只能先 stat 判定。
  const result = (await ipcClient.invoke(
    sshConnectionId ? IPC.SSH_FS_STAT_PATH : IPC.FS_STAT_PATH,
    sshConnectionId ? { connectionId: sshConnectionId, path } : { path }
  )) as FsStatResult | null

  if (!result) return 'File not found'
  if (result.error) return result.error
  if (result.exists === false) return 'File not found'
  if (result.isDirectory) return 'Path is a directory'
  return null
}

async function readTextFile(path: string, sshConnectionId?: string): Promise<string> {
  const content = await ipcClient.invoke(
    sshConnectionId ? IPC.SSH_FS_READ_FILE : IPC.FS_READ_FILE,
    sshConnectionId ? { connectionId: sshConnectionId, path } : { path }
  )
  return typeof content === 'string' ? content : ''
}

/** 文件内容跨进提示词块，闭合标签必须转义，否则能被文件内容截断注入块。 */
function sanitizeInjectedContent(content: string): string {
  return content
    .replace(/<\/system-reminder>/gi, '<\\/system-reminder>')
    .replace(/<\/selected_files>/gi, '<\\/selected_files>')
}

function resolveFileContextBudget(modelConfig?: AIModelConfig | null): number {
  const contextLength = modelConfig?.contextLength
  if (typeof contextLength !== 'number' || contextLength <= 0) {
    return FILE_CONTEXT_FALLBACK_TOKENS
  }
  return Math.min(
    FILE_CONTEXT_BUDGET_MAX_TOKENS,
    Math.max(4_000, Math.floor(contextLength * FILE_CONTEXT_BUDGET_RATIO))
  )
}

function truncateLinesToTokenBudget(lines: string[], tokenBudget: number): string[] {
  if (tokenBudget <= 0) return []
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = estimateTokens(line) + (kept.length > 0 ? 1 : 0)
    if (used + cost > tokenBudget) break
    kept.push(line)
    used += cost
  }
  return kept
}

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, '/').trim()
}

function normalizeFilePathKey(value: string): string {
  return normalizeFilePath(value).toLowerCase()
}

function isAbsoluteFilePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/')
}

function getBaseNameFromPath(value: string): string {
  const parts = normalizeFilePath(value).split('/').filter(Boolean)
  return parts[parts.length - 1] || value || 'file'
}

function getBlockedExtensionSkipReason(filePath: string): string | null {
  const filename = normalizeFilePath(filePath).split('/').filter(Boolean).pop() ?? ''
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0) return null
  const extension = filename.slice(dotIndex).toLowerCase()
  if (!BLOCKED_TEXT_READ_EXTENSIONS.has(extension)) return null
  return extension === '.pdf' ? 'pdf' : 'nonText'
}

function formatReadError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error ?? 'Failed to read file')
}
