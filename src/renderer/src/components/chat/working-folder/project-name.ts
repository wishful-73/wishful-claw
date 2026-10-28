/**
 * 项目名清洗与从目录名推导。
 *
 * S-250 从 `WorkingFolderSelectorDialog.tsx` 搬出，函数体逐字平移。
 */

export function sanitizeProjectName(rawName: string): string {
  const cleaned = rawName
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'New Project'
}

export function deriveProjectNameFromFolder(folderPath: string, fallbackName: string): string {
  const normalized = folderPath.trim().replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  const name = parts[parts.length - 1]
  return name ? sanitizeProjectName(name) : fallbackName
}
