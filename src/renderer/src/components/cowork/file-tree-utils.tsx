import type React from 'react'
import { File, FileCode, FileJson, FileText, FileCog, FileLock, Database, Image } from 'lucide-react'
import type { FileEntry, TreeNode } from './file-tree-types'

// --- File icon helper ---
//
// Colors follow the app-wide status-color convention (`text-*-500` on light,
// `dark:text-*-400` on dark) so the palette stays legible across all six
// theme presets in both modes. Class strings must stay static literals for
// the Tailwind v4 scanner.
const ICON_CLS = {
  blue: 'size-3.5 text-blue-500 dark:text-blue-400',
  yellow: 'size-3.5 text-yellow-500 dark:text-yellow-400',
  green: 'size-3.5 text-green-500 dark:text-green-400',
  orange: 'size-3.5 text-orange-500 dark:text-orange-400',
  cyan: 'size-3.5 text-cyan-500 dark:text-cyan-400',
  violet: 'size-3.5 text-violet-500 dark:text-violet-400',
  red: 'size-3.5 text-red-500 dark:text-red-400',
  sky: 'size-3.5 text-sky-500 dark:text-sky-400',
  emerald: 'size-3.5 text-emerald-500 dark:text-emerald-400',
  amber: 'size-3.5 text-amber-500 dark:text-amber-400',
  pink: 'size-3.5 text-pink-500 dark:text-pink-400',
  teal: 'size-3.5 text-teal-500 dark:text-teal-400',
  purple: 'size-3.5 text-purple-500 dark:text-purple-400',
  indigo: 'size-3.5 text-indigo-500 dark:text-indigo-400',
  zinc: 'size-3.5 text-zinc-500 dark:text-zinc-400',
  lime: 'size-3.5 text-lime-500 dark:text-lime-400'
} as const

const EXT_ICONS: Record<string, React.ReactNode> = {
  '.ts': <FileCode className={ICON_CLS.blue} />,
  '.tsx': <FileCode className={ICON_CLS.blue} />,
  '.js': <FileCode className={ICON_CLS.yellow} />,
  '.jsx': <FileCode className={ICON_CLS.yellow} />,
  '.mjs': <FileCode className={ICON_CLS.yellow} />,
  '.cjs': <FileCode className={ICON_CLS.yellow} />,
  '.py': <FileCode className={ICON_CLS.green} />,
  '.rs': <FileCode className={ICON_CLS.orange} />,
  '.go': <FileCode className={ICON_CLS.cyan} />,
  '.cs': <FileCode className={ICON_CLS.violet} />,
  '.java': <FileCode className={ICON_CLS.red} />,
  '.c': <FileCode className={ICON_CLS.sky} />,
  '.h': <FileCode className={ICON_CLS.sky} />,
  '.cpp': <FileCode className={ICON_CLS.sky} />,
  '.sh': <FileCode className={ICON_CLS.emerald} />,
  '.bat': <FileCode className={ICON_CLS.emerald} />,
  '.ps1': <FileCode className={ICON_CLS.emerald} />,
  '.json': <FileJson className={ICON_CLS.amber} />,
  '.jsonc': <FileJson className={ICON_CLS.amber} />,
  '.md': <FileText className="size-3.5 text-muted-foreground" />,
  '.txt': <FileText className="size-3.5 text-muted-foreground" />,
  '.log': <FileText className="size-3.5 text-muted-foreground" />,
  '.yaml': <FileText className={ICON_CLS.pink} />,
  '.yml': <FileText className={ICON_CLS.pink} />,
  '.toml': <FileText className={ICON_CLS.pink} />,
  '.ini': <FileCog className={ICON_CLS.pink} />,
  '.env': <FileCog className={ICON_CLS.teal} />,
  '.css': <FileCode className={ICON_CLS.purple} />,
  '.scss': <FileCode className={ICON_CLS.purple} />,
  '.less': <FileCode className={ICON_CLS.purple} />,
  '.html': <FileCode className={ICON_CLS.orange} />,
  '.xml': <FileCode className={ICON_CLS.orange} />,
  '.sql': <Database className={ICON_CLS.indigo} />,
  '.db': <Database className={ICON_CLS.indigo} />,
  '.sqlite': <Database className={ICON_CLS.indigo} />,
  '.lock': <FileLock className="size-3.5 text-muted-foreground" />,
  '.dll': <FileCog className={ICON_CLS.zinc} />,
  '.exe': <FileCog className={ICON_CLS.zinc} />,
  '.zip': <FileCog className={ICON_CLS.lime} />,
  '.svg': <Image className={ICON_CLS.green} />,
  '.png': <Image className={ICON_CLS.green} />,
  '.jpg': <Image className={ICON_CLS.green} />,
  '.gif': <Image className={ICON_CLS.green} />,
  '.ico': <Image className={ICON_CLS.green} />,
  '.webp': <Image className={ICON_CLS.green} />
}

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.idea',
  '.vscode',
  'target',
  'coverage',
  '.turbo',
  '.parcel-cache'
])

export function fileIcon(name: string): React.ReactNode {
  const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : ''
  return EXT_ICONS[ext] ?? <File className="size-3.5 text-muted-foreground/60" />
}

// --- Sort: directories first, then alphabetical ---
export function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function countTreeStats(nodes: TreeNode[]): { folders: number; files: number } {
  return nodes.reduce(
    (acc, node) => {
      if (node.type === 'directory') {
        acc.folders += 1
        if (node.children?.length) {
          const childStats = countTreeStats(node.children)
          acc.folders += childStats.folders
          acc.files += childStats.files
        }
      } else {
        acc.files += 1
      }
      return acc
    },
    { folders: 0, files: 0 }
  )
}

export function collapseTree(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((node) => ({
    ...node,
    expanded: false,
    children: node.children ? collapseTree(node.children) : node.children
  }))
}

export function collectExpandedPaths(nodes: TreeNode[], paths = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === 'directory' && node.expanded) paths.add(node.path)
    if (node.children?.length) collectExpandedPaths(node.children, paths)
  }
  return paths
}

export function toRelativePath(filePath: string, workingFolder?: string): string {
  if (!workingFolder) return filePath
  if (!filePath.startsWith(workingFolder)) return filePath
  return filePath.slice(workingFolder.length).replace(/^[\\/]+/, '')
}

export function basename(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized
}

export function parentPath(filePath: string, separator: string): string {
  const index = filePath.lastIndexOf(separator)
  if (index <= 0) return separator === '/' ? '/' : ''
  return filePath.slice(0, index)
}

export function joinPath(parent: string, name: string, separator: string): string {
  return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`
}

export function getErrorMessage(err: unknown, fallback = 'Operation failed'): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

export function getIpcError(result: unknown): string | null {
  if (!result || typeof result !== 'object' || !('error' in result)) return null
  const error = (result as { error?: unknown }).error
  return typeof error === 'string' && error.length > 0 ? error : 'Operation failed'
}

export type EntryNameValidationError = 'empty' | 'dot' | 'separator'

export function validateEntryName(name: string): EntryNameValidationError | null {
  if (!name.trim()) return 'empty'
  if (name === '.' || name === '..') return 'dot'
  if (/[\\/]/.test(name)) return 'separator'
  return null
}

export function DepthGuides({ depth }: { depth: number }): React.JSX.Element | null {
  if (depth <= 0) return null

  return (
    <div className="absolute inset-y-0 left-0 pointer-events-none">
      {Array.from({ length: depth }).map((_, index) => (
        <span
          key={index}
          className="workspace-filetree-guide absolute inset-y-0 w-px"
          style={{ left: `${index * 14 + 9}px` }}
        />
      ))}
    </div>
  )
}
