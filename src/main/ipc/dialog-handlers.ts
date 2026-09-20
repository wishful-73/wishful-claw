import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import * as fs from 'fs'

import { registerMessagePackHandler } from './messagepack-handler'

/**
 * Folder / directory picker channels used by the renderer.
 *
 * These used to be inlined in `index.ts`. `fs:select-folder` takes a
 * `defaultPath` so a caller can open the dialog where the user last was;
 * `fs:list-desktop-directories` backs the working-folder selector.
 */
export function registerDialogHandlers(): void {
  // Dialog: open folder selector
  registerMessagePackHandler<Record<string, unknown>, { folderPath: string | null; canceled: boolean }>(
    'dialog:openFolder',
    async (_args, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return {
        folderPath: result.canceled ? null : result.filePaths[0] ?? null,
        canceled: result.canceled
      }
    }
  )

  // Folder picker: returns { canceled, path } for the renderer's fs:select-folder channel
  registerMessagePackHandler<{ defaultPath?: string }, { canceled: boolean; path?: string }>(
    'fs:select-folder',
    async (args, event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const opts: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
      if (args && typeof args.defaultPath === 'string') {
        opts.defaultPath = args.defaultPath
      }
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts)
      return {
        canceled: result.canceled,
        path: result.canceled ? undefined : result.filePaths[0]
      }
    }
  )

  // List desktop directories for the working folder selector dialog
  registerMessagePackHandler<void, { desktopPath: string; directories: { name: string; path: string; isDesktop: boolean }[] } | { error: string }>(
    'fs:list-desktop-directories',
    async () => {
      try {
        const desktopPath = app.getPath('desktop')
        const entries = await fs.promises.readdir(desktopPath, { withFileTypes: true })
        const directories = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => ({
            name: entry.name,
            path: join(desktopPath, entry.name),
            isDesktop: false
          }))
        return { desktopPath, directories }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )
}
