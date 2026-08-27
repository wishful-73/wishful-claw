// File system IPC handlers — extracted from main/index.ts

import * as fs from 'fs'
import { registerMessagePackHandler } from './messagepack-handler'
import AdmZip from 'adm-zip'
import { join } from 'path'
import { app } from 'electron'
import { getMainWindow } from '../main-window-registry'
import { safeSendMessagePackToWindow } from '../window-ipc'

// Cap binary reads: the payload crosses IPC as base64 (~33% inflation) and
// viewers/streaming use the oc-media protocol for anything larger.
const MAX_BINARY_READ_BYTES = 64 * 1024 * 1024

function formatLocalDateFolderName(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function extractDocxText(filePath: string): string {
  const zip = new AdmZip(filePath)
  const parts: string[] = []

  const docEntry = zip.getEntry('word/document.xml')
  if (docEntry) {
    const xml = docEntry.getData().toString('utf-8')
    parts.push(extractTextFromDocxXml(xml))
  }

  const entries = zip.getEntries()
    .filter(e => /word\/(header|footer)\d*\.xml/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))

  for (const entry of entries) {
    const xml = entry.getData().toString('utf-8')
    const text = extractTextFromDocxXml(xml)
    if (text) parts.push(text)
  }

  return parts.join('\n').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}

function extractTextFromDocxXml(xml: string): string {
  let processed = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:(br|cr)\s*\/>/g, '\n')

  let result = ''
  const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g
  let match: RegExpExecArray | null
  while ((match = tRegex.exec(processed)) !== null) {
    result += match[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
  }

  // Simpler approach: just add newlines between text runs based on paragraph end markers
  
  return result.trim()
}


export function registerFsHandlers(): void {
    registerMessagePackHandler<{ path: string; maxLines?: number }, string>(
      'fs:read-file',
      async (args) => {
        try {
          const content = await fs.promises.readFile(args.path, 'utf-8')
          return content
        } catch (err) {
          // Return empty string for missing files instead of throwing
          const code = (err as NodeJS.ErrnoException).code
          if (code === 'ENOENT' || code === 'EISDIR') return ''
          throw new Error(String(err))
        }
      }
    )

    registerMessagePackHandler<{ path: string; content: string; encoding?: BufferEncoding }, void>(
      'fs:write-file',
      async (args) => {
        await fs.promises.writeFile(args.path, args.content, args.encoding ?? 'utf-8')
      }
    )

    registerMessagePackHandler<{ path: string }, { isDirectory: boolean; isFile: boolean; size: number; mtime: number } | null>(
      'fs:stat-path',
      async (args) => {
        try {
          const stat = await fs.promises.stat(args.path)
          return {
            isDirectory: stat.isDirectory(),
            isFile: stat.isFile(),
            size: stat.size,
            mtime: stat.mtimeMs
          }
        } catch {
          return null
        }
      }
    )

    registerMessagePackHandler<{ path: string }, { name: string; type: 'file' | 'directory'; path: string }[]>(
      'fs:list-dir',
      async (args) => {
        try {
          const entries = await fs.promises.readdir(args.path, { withFileTypes: true })
          const sep = args.path.includes('/') && !args.path.includes('\\') ? '/' : '\\'
          return entries
            .map((entry) => ({
              name: entry.name,
              type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
              path: args.path.replace(/[\\/]+$/, '') + sep + entry.name
            }))
        } catch {
          return []
        }
      }
    )

    registerMessagePackHandler<{ path: string; recursive?: boolean }, void>(
      'fs:mkdir',
      async (args) => {
        await fs.promises.mkdir(args.path, { recursive: args.recursive ?? true })
      }
    )

    registerMessagePackHandler<{ path: string }, void>(
      'fs:delete',
      async (args) => {
        const stat = await fs.promises.stat(args.path).catch(() => null)
        if (!stat) return
        if (stat.isDirectory()) {
          await fs.promises.rm(args.path, { recursive: true })
        } else {
          await fs.promises.unlink(args.path)
        }
      }
    )

    registerMessagePackHandler<{ from: string; to: string }, void>(
      'fs:move',
      async (args) => {
        await fs.promises.rename(args.from, args.to)
      }
    )

    registerMessagePackHandler<{ path: string }, string | null>(
      'fs:read-text-file-lines',
      async (args) => {
        try {
          const content = await fs.promises.readFile(args.path, 'utf-8')
          return content
        } catch {
          return null
        }
      }
    )

    registerMessagePackHandler<{ path: string }, { data: string } | { error: string }>(
      'fs:read-file-binary',
      async (args) => {
        try {
          const stat = await fs.promises.stat(args.path)
          if (stat.size > MAX_BINARY_READ_BYTES) {
            return { error: `File too large to read into memory (${stat.size} bytes)` }
          }
          const buffer = await fs.promises.readFile(args.path)
          return { data: buffer.toString('base64') }
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) }
        }
      }
    )

    registerMessagePackHandler<{ path: string; content: Buffer | ArrayBuffer | Uint8Array }, void>(
      'fs:write-file-binary',
      async (args) => {
        const data = Buffer.isBuffer(args.content)
          ? args.content
          : args.content instanceof ArrayBuffer
            ? Buffer.from(args.content)
            : Buffer.from(args.content)
        await fs.promises.writeFile(args.path, data)
      }
    )

    // Glob - simple pattern matching (supports * and **)
    registerMessagePackHandler<{ pattern: string; cwd?: string }, { path: string; name: string; isDirectory: boolean }[]>(
      'fs:glob',
      async (args) => {
        try {
          const cwd = args.cwd ?? process.cwd()
          const pattern = args.pattern.replace(/\\/g, '/')
          const results: { path: string; name: string; isDirectory: boolean }[] = []
          const globToRegex = (p: string): RegExp => {
            let re = p.replace(/[.+^${}()|[\]]/g, '\\$&')
            re = re.replace(/\*\*/g, '<<GLOBSTAR>>')
            re = re.replace(/\*/g, '[^/]*')
            re = re.replace(/<<GLOBSTAR>>/g, '.*')
            re = re.replace(/\?/g, '.')
            return new RegExp('^' + re + '$')
          }
          const regex = globToRegex(pattern)
          const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > 8 || results.length > 500) return
            let entries: fs.Dirent[]
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
              const fullPath = join(dir, entry.name)
              const relPath = fullPath.replace(cwd, '').replace(/^[\\/]+/, '').replace(/\\/g, '/')
              if (regex.test(relPath) || regex.test(entry.name)) {
                results.push({ path: fullPath, name: entry.name, isDirectory: entry.isDirectory() })
              }
              if (entry.isDirectory() && depth < 8) {
                await walk(fullPath, depth + 1)
              }
            }
          }
          await walk(cwd, 0)
          return results
        } catch {
          return []
        }
      }
    )

    // Grep - search file contents
    registerMessagePackHandler<{ pattern: string; path?: string; glob?: string }, { file: string; line: number; text: string }[]>(
      'fs:grep',
      async (args) => {
        try {
          const cwd = args.path ?? process.cwd()
          const results: { file: string; line: number; text: string }[] = []
          const regex = new RegExp(args.pattern, 'i')
          const fileList: string[] = []
          const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > 6 || fileList.length > 1000) return
            let entries: fs.Dirent[]
            try { entries = await fs.promises.readdir(dir, { withFileTypes: true }) } catch { return }
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
              const fullPath = join(dir, entry.name)
              if (entry.isFile()) {
                fileList.push(fullPath)
              } else if (entry.isDirectory() && depth < 6) {
                await walk(fullPath, depth + 1)
              }
            }
          }
          await walk(cwd, 0)
          for (const file of fileList) {
            try {
              const content = await fs.promises.readFile(file, 'utf-8')
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  results.push({ file, line: i + 1, text: lines[i].trim() })
                  if (results.length >= 200) return results
                }
              }
            } catch {
              // skip binary files
            }
          }
          return results
        } catch {
          return []
        }
      }
    )

    // Search files by name
    registerMessagePackHandler<{ query: string; path?: string }, { path: string; name: string; type: 'file' | 'directory' }[]>(
      'fs:search-files',
      async (args) => {
        try {
          const cwd = args.path ?? process.cwd()
          const query = args.query.toLowerCase()
          const results: { path: string; name: string; type: 'file' | 'directory' }[] = []
          const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > 5 || results.length > 200) return
            const entries = await fs.promises.readdir(dir, { withFileTypes: true })
            for (const entry of entries) {
              if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
              const fullPath = join(dir, entry.name)
              if (entry.name.toLowerCase().includes(query)) {
                results.push({ path: fullPath, name: entry.name, type: entry.isDirectory() ? 'directory' : 'file' })
              }
              if (entry.isDirectory() && depth < 5) {
                await walk(fullPath, depth + 1)
              }
            }
          }
          await walk(cwd, 0)
          return results
        } catch {
          return []
        }
      }
    )

    // Ensure default chat working folder exists (Documents/<date>/Chat)
    registerMessagePackHandler<void, { path?: string; error?: string }>(
      'fs:default-chat-working-folder',
      async () => {
        try {
          const folderPath = join(app.getPath('documents'), formatLocalDateFolderName(), 'Chat')
          await fs.promises.mkdir(folderPath, { recursive: true })
          return { path: folderPath }
        } catch (err) {
          return { error: String(err) }
        }
      }
    )

    // Read document — extract text from .docx files, plain text for others
    registerMessagePackHandler<{ path: string; maxFileReadBytes?: number }, { content: string | null; fileName: string | null; error: string | null }>(
      'fs:read-document',
      async (args) => {
        try {
          const filePath = args.path
          if (!filePath) return { content: null, fileName: null, error: 'Missing path' }

          const stat = await fs.promises.stat(filePath)
          const maxBytes = args.maxFileReadBytes ?? 10 * 1024 * 1024
          if (stat.size > maxBytes) {
            return { content: null, fileName: null, error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB, limit ${(maxBytes / 1024 / 1024).toFixed(0)} MB)` }
          }

          const ext = filePath.toLowerCase().split('.').pop()
          let content: string

          if (ext === 'docx') {
            content = extractDocxText(filePath)
          } else {
            content = await fs.promises.readFile(filePath, 'utf-8')
          }

          return { content, fileName: filePath.split(/[\\/]/).pop() ?? null, error: null }
        } catch (err) {
          return { content: null, fileName: null, error: err instanceof Error ? err.message : String(err) }
        }
      }
    )



    // ── Directory watching ──
    const watchedDirs = new Map<string, fs.FSWatcher>()

    registerMessagePackHandler<{ path: string; recursive?: boolean }, void>(
      'fs:watch-dir',
      async (args) => {
        const key = `${args.path}:${args.recursive ?? false}`
        if (watchedDirs.has(key)) return
        try {
          const watcher = fs.watch(args.path, { recursive: args.recursive ?? false }, (_eventType, filename) => {
            // Route through the registered main window — getAllWindows()[0] may
            // be an auxiliary window (clipboard enhancer, quick launcher).
            const win = getMainWindow()
            if (win && !win.isDestroyed()) {
              safeSendMessagePackToWindow(win, 'fs:dir-changed', { path: args.path, changedPath: filename })
            }
          })
          watcher.on('error', () => {
            // Without an error listener a failing FSWatcher crashes the main
            // process; drop the watcher instead.
            watchedDirs.delete(key)
            try {
              watcher.close()
            } catch {
              // already closed
            }
          })
          watchedDirs.set(key, watcher)
        } catch {
          // Ignore — path may not exist or not be watchable
        }
      }
    )

    registerMessagePackHandler<{ path: string; recursive?: boolean }, void>(
      'fs:unwatch-dir',
      async (args) => {
        const key = `${args.path}:${args.recursive ?? false}`
        const watcher = watchedDirs.get(key)
        if (watcher) {
          watcher.close()
          watchedDirs.delete(key)
        }
      }
    )

}
