// SSH SFTP file operation IPC handlers.
// Mirrors the local fs-handlers API but routes through SFTP on a remote SSH host.

import { registerMessagePackHandler } from './messagepack-handler'
import { withSftp } from '../ssh/connection-pool'
import type { Stats, FileEntryWithStats } from 'ssh2'

// ── Helpers ──

function statToFileEntry(
  name: string,
  fullPath: string,
  stats: Stats
): { name: string; type: 'file' | 'directory'; path: string } {
  return {
    name,
    type: stats.isDirectory() ? 'directory' : 'file',
    path: fullPath
  }
}

function statInfo(stats: Stats) {
  return {
    exists: true,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    size: stats.size,
    mtime: stats.mtime
  }
}

// ── Registration ──

export function registerSshFsHandlers(): void {
  // ── list-dir ──
  registerMessagePackHandler<{ connectionId: string; path: string }, { name: string; type: 'file' | 'directory'; path: string }[]>(
    'ssh:fs:list-dir',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          return await new Promise((resolve, reject) => {
            // sftp.readdir returns FileEntry[] with filename and attrs
            sftp.readdir(args.path, (err, list) => {
              if (err) {
                reject(err)
                return
              }
              const entries = list.map((item: FileEntryWithStats) => {
                const fullPath = args.path.replace(/\/$/, '') + '/' + item.filename
                return statToFileEntry(item.filename, fullPath, item.attrs)
              })
              resolve(entries)
            })
          })
        })
      } catch (err) {
        // Return an empty list, never an { error } object: the declared type
        // is an array and the renderer iterates it directly (a non-array
        // crashes the file tree). Matches local fs:list-dir behavior.
        console.warn(`[SSH-FS] list-dir failed for ${args.path}:`, String(err))
        return []
      }
    }
  )

  // ── read-file (text) ──
  registerMessagePackHandler<{ connectionId: string; path: string }, string>(
    'ssh:fs:read-file',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          return await new Promise<string>((resolve, reject) => {
            sftp.readFile(args.path, 'utf-8', (err, data) => {
              if (err) reject(err)
              else resolve(data.toString())
            })
          })
        })
      } catch {
        return ''
      }
    }
  )

  // ── read-text-file-lines ──
  registerMessagePackHandler<{ connectionId: string; path: string }, string | null>(
    'ssh:fs:read-text-file-lines',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          return await new Promise<string>((resolve, reject) => {
            sftp.readFile(args.path, 'utf-8', (err, data) => {
              if (err) reject(err)
              else resolve(data.toString())
            })
          })
        })
      } catch {
        return null
      }
    }
  )

  // ── write-file (text) ──
  registerMessagePackHandler<{ connectionId: string; path: string; content: string }, void>(
    'ssh:fs:write-file',
    async (args) => {
      await withSftp(args.connectionId, async (sftp) => {
        await new Promise<void>((resolve, reject) => {
          sftp.writeFile(args.path, args.content, 'utf-8', (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      })
    }
  )

  // ── stat-path ──
  registerMessagePackHandler<{ connectionId: string; path: string }, { exists: boolean; isDirectory: boolean; isFile: boolean; size: number; mtime: number } | { error: string }>(
    'ssh:fs:stat-path',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          return await new Promise((resolve, reject) => {
            sftp.stat(args.path, (err, stats) => {
              if (err) {
                if ((err as Error & { code?: number }).code === 2 || (err as Error & { code?: number }).code === 4) {
                  // ENOENT or ENOTDIR equivalent
                  resolve({ exists: false, isDirectory: false, isFile: false, size: 0, mtime: 0 })
                } else {
                  reject(err)
                }
              } else {
                resolve(statInfo(stats))
              }
            })
          })
        })
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  // ── mkdir ──
  registerMessagePackHandler<{ connectionId: string; path: string }, void>(
    'ssh:fs:mkdir',
    async (args) => {
      await withSftp(args.connectionId, async (sftp) => {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(args.path, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      })
    }
  )

  // ── delete (recursive for directories) ──
  registerMessagePackHandler<{ connectionId: string; path: string }, void>(
    'ssh:fs:delete',
    async (args) => {
      await withSftp(args.connectionId, async (sftp) => {
        const stats = await new Promise<Stats>((resolve, reject) => {
          sftp.stat(args.path, (err, s) => {
            if (err) reject(err)
            else resolve(s)
          })
        })
        if (!stats.isDirectory()) {
          await new Promise<void>((resolve, reject) => {
            sftp.unlink(args.path, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })
          return
        }
        // Recursively delete directory contents
        const removeDirRecursive = async (dirPath: string): Promise<void> => {
          const entries = await new Promise<FileEntryWithStats[]>((resolve, reject) => {
            sftp.readdir(dirPath, (err, list) => {
              if (err) reject(err)
              else resolve(list)
            })
          })
          for (const entry of entries) {
            const fullPath = dirPath.replace(/\/$/, '') + '/' + entry.filename
            if (entry.attrs.isDirectory()) {
              await removeDirRecursive(fullPath)
            } else {
              await new Promise<void>((resolve, reject) => {
                sftp.unlink(fullPath, (err) => {
                  if (err) reject(err)
                  else resolve()
                })
              })
            }
          }
          await new Promise<void>((resolve, reject) => {
            sftp.rmdir(dirPath, (err) => {
              if (err) reject(err)
              else resolve()
            })
          })
        }
        await removeDirRecursive(args.path)
      })
    }
  )

  // ── move (rename) ──
  registerMessagePackHandler<{ connectionId: string; from: string; to: string }, void>(
    'ssh:fs:move',
    async (args) => {
      await withSftp(args.connectionId, async (sftp) => {
        await new Promise<void>((resolve, reject) => {
          sftp.rename(args.from, args.to, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      })
    }
  )

  // ── glob (find files by pattern) ──
  registerMessagePackHandler<{ connectionId: string; path: string; pattern: string }, { path: string; name: string; type: 'file' | 'directory' }[]>(
    'ssh:fs:glob',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          const results: { path: string; name: string; type: 'file' | 'directory' }[] = []
          const patternRegex = globToRegex(args.pattern)

          const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > 8 || results.length > 500) return
            const entries = await new Promise<{ filename: string; attrs: Stats }[] | null>((resolve) => {
              sftp.readdir(dir, (err, list) => {
                if (err) { resolve(null); return }
                resolve(list)
              })
            })
            if (!entries) return

            for (const entry of entries) {
              if (entry.filename.startsWith('.')) continue
              const fullPath = dir.replace(/\/$/, '') + '/' + entry.filename
              const isDir = entry.attrs.isDirectory()

              // Match against filename or relative path
              const relPath = fullPath.replace(args.path, '').replace(/^[\\/]+/, '')
              if (patternRegex.test(entry.filename) || patternRegex.test(relPath)) {
                results.push({
                  path: fullPath,
                  name: entry.filename,
                  type: isDir ? 'directory' : 'file'
                })
              }

              if (isDir && depth < 8) {
                await walk(fullPath, depth + 1)
              }
            }
          }

          await walk(args.path, 0)
          return results
        })
      } catch {
        return []
      }
    }
  )

  // ── grep (search file contents) ──
  registerMessagePackHandler<{ connectionId: string; path: string; pattern: string }, { file: string; line: number; text: string }[]>(
    'ssh:fs:grep',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          const results: { file: string; line: number; text: string }[] = []
          const regex = new RegExp(args.pattern, 'i')
          const fileList: string[] = []

          const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > 6 || fileList.length > 1000) return
            const entries = await new Promise<{ filename: string; attrs: Stats }[] | null>((resolve) => {
              sftp.readdir(dir, (err, list) => {
                if (err) { resolve(null); return }
                resolve(list)
              })
            })
            if (!entries) return

            for (const entry of entries) {
              if (entry.filename.startsWith('.')) continue
              const fullPath = dir.replace(/\/$/, '') + '/' + entry.filename
              if (entry.attrs.isFile()) {
                fileList.push(fullPath)
              } else if (entry.attrs.isDirectory() && depth < 6) {
                await walk(fullPath, depth + 1)
              }
            }
          }

          await walk(args.path, 0)

          for (const file of fileList) {
            try {
              const content = await new Promise<string>((resolve, reject) => {
                sftp.readFile(file, 'utf-8', (err, data) => {
                  if (err) reject(err)
                  else resolve(data.toString())
                })
              })
              const lines = content.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  results.push({ file, line: i + 1, text: lines[i].trim() })
                  if (results.length >= 200) return results
                }
              }
            } catch {
              // skip binary / unreadable files
            }
          }
          return results
        })
      } catch {
        return []
      }
    }
  )

  // ── home-dir ──
  registerMessagePackHandler<{ connectionId: string }, string>(
    'ssh:fs:home-dir',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          // SFTP protocol doesn't have a direct "get home dir" method.
          // We use realpath on '.' to get the home directory.
          return await new Promise<string>((resolve, reject) => {
            sftp.realpath('.', (err, absPath) => {
              if (err) reject(err)
              else resolve(absPath)
            })
          })
        })
      } catch {
        return ''
      }
    }
  )

  // ── read-file-binary ──
  registerMessagePackHandler<{ connectionId: string; path: string }, ArrayBuffer | null>(
    'ssh:fs:read-file-binary',
    async (args) => {
      try {
        return await withSftp(args.connectionId, async (sftp) => {
          const buf = await new Promise<Buffer>((resolve, reject) => {
            sftp.readFile(args.path, (err, data) => {
              if (err) reject(err)
              else resolve(data)
            })
          })
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
        })
      } catch {
        return null
      }
    }
  )

  // ── write-file-binary ──
  registerMessagePackHandler<{ connectionId: string; path: string; content: Buffer | ArrayBuffer | Uint8Array }, void>(
    'ssh:fs:write-file-binary',
    async (args) => {
      await withSftp(args.connectionId, async (sftp) => {
        const data = Buffer.isBuffer(args.content)
          ? args.content
          : args.content instanceof ArrayBuffer
            ? Buffer.from(args.content)
            : Buffer.from(args.content)
        await new Promise<void>((resolve, reject) => {
          sftp.writeFile(args.path, data, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      })
    }
  )

  // ── connect / disconnect (stubs — connection pool handles lifecycle) ──
  registerMessagePackHandler<{ connectionId: string }, { success: boolean }>(
    'ssh:fs:connect',
    async () => {
      return { success: true }
    }
  )

  registerMessagePackHandler<{ connectionId: string }, { success: boolean }>(
    'ssh:fs:disconnect',
    async () => {
      return { success: true }
    }
  )
}

// ── Utility ──

function globToRegex(pattern: string): RegExp {
  let re = pattern.replace(/[.+^${}()|[\]]/g, '\\$&')
  re = re.replace(/\*\*/g, '<<GLOBSTAR>>')
  re = re.replace(/\*/g, '[^/]*')
  re = re.replace(/<<GLOBSTAR>>/g, '.*')
  re = re.replace(/\?/g, '.')
  return new RegExp('^' + re + '$', 'i')
}
