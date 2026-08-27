import type React from 'react'
import { File, FileCode, FileJson, FileText, FileCog, FileLock, Database, Image } from 'lucide-react'
import type { FileEntry, TreeNode } from './file-tree-types'

// --- File icon helper ---

const EXT_ICONS: Record<string, React.ReactNode> = {
  '.ts': <FileCode className="size-3.5 text-blue-400" />,
  '.tsx': <FileCode className="size-3.5 text-blue-400" />,
  '.js': <FileCode className="size-3.5 text-yellow-500" />,
  '.jsx': <FileCode className="size-3.5 text-yellow-500" />,
  '.mjs': <FileCode className="size-3.5 text-yellow-500" />,
  '.cjs': <FileCode className="size-3.5 text-yellow-500" />,
  '.py': <FileCode className="size-3.5 text-green-500" />,
  '.rs': <FileCode className="size-3.5 text-orange-400" />,
  '.go': <FileCode className="size-3.5 text-cyan-400" />,
  '.cs': <FileCode className="size-3.5 text-violet-400" />,
  '.java': <FileCode className="size-3.5 text-red-400" />,
  '.c': <FileCode className="size-3.5 text-sky-400" />,
  '.h': <FileCode className="size-3.5 text-sky-400" />,
  '.cpp': <FileCode className="size-3.5 text-sky-400" />,
  '.sh': <FileCode className="size-3.5 text-emerald-400" />,
  '.bat': <FileCode className="size-3.5 text-emerald-400" />,
  '.ps1': <FileCode className="size-3.5 text-emerald-400" />,
  '.json': <FileJson className="size-3.5 text-amber-400" />,
  '.jsonc': <FileJson className="size-3.5 text-amber-400" />,
  '.md': <FileText className="size-3.5 text-muted-foreground" />,
  '.txt': <FileText className="size-3.5 text-muted-foreground" />,
  '.log': <FileText className="size-3.5 text-muted-foreground" />,
  '.yaml': <FileText className="size-3.5 text-pink-400" />,
  '.yml': <FileText className="size-3.5 text-pink-400" />,
  '.toml': <FileText className="size-3.5 text-pink-400" />,
  '.ini': <FileCog className="size-3.5 text-pink-400" />,
  '.env': <FileCog className="size-3.5 text-teal-400" />,
  '.css': <FileCode className="size-3.5 text-purple-400" />,
  '.scss': <FileCode className="size-3.5 text-purple-400" />,
  '.less': <FileCode className="size-3.5 text-purple-400" />,
  '.html': <FileCode className="size-3.5 text-orange-400" />,
  '.xml': <FileCode className="size-3.5 text-orange-300" />,
  '.sql': <Database className="size-3.5 text-indigo-400" />,
  '.db': <Database className="size-3.5 text-indigo-400" />,
  '.sqlite': <Database className="size-3.5 text-indigo-400" />,
  '.lock': <FileLock className="size-3.5 text-muted-foreground" />,
  '.dll': <FileCog className="size-3.5 text-zinc-400" />,
  '.exe': <FileCog className="size-3.5 text-zinc-400" />,
  '.zip': <FileCog className="size-3.5 text-lime-400" />,
  '.svg': <Image className="size-3.5 text-green-400" />,
  '.png': <Image className="size-3.5 text-green-400" />,
  '.jpg': <Image className="size-3.5 text-green-400" />,
  '.gif': <Image className="size-3.5 text-green-400" />,
  '.ico': <Image className="size-3.5 text-green-400" />,
  '.webp': <Image className="size-3.5 text-green-400" />
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
