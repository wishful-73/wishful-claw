/**
 * PE icon extractor — reads RT_GROUP_ICON / RT_ICON resources straight from a
 * Windows executable, without the shell.
 *
 * Why: Electron's `app.getFileIcon` goes through `IImageList::GetIcon`, which
 * fails to render PNG-compressed icon entries and falls back to the generic
 * default icon. All exes built by electron-builder/rcedit (Electron apps —
 * e.g. WishfulClaw itself) use PNG-compressed entries, so every installed
 * Electron app shows the generic icon. The Win32 SHGetFileInfo path handles
 * them fine, but is not reachable from the main process without a native
 * module — so we parse the PE resource section ourselves:
 *
 *   DOS header → NT headers → sections → resource directory (type 14 =
 *   RT_GROUP_ICON → pick best size → RT_ICON id) → entry bytes.
 *
 * PNG entries are served as `image/png` data URLs; legacy BMP/DIB entries are
 * wrapped in a minimal .ico container (`image/x-icon`, rendered fine by
 * Chromium's <img>). Returns null on any parse failure so callers can fall
 * back to `app.getFileIcon`.
 */

import { readFileSync, statSync } from 'fs'

/** Pick the best-sized icon from a group: prefer 32px, then 48, 16, then the
 *  largest entry not exceeding 64, then simply the largest one. */
interface GroupEntry {
  width: number
  height: number
  bytes: number
  id: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_ICON_BYTES = 512 * 1024 // sanity cap for a single icon entry
// Don't pull absurdly large executables fully into memory just for an icon —
// this runs on the main process for every launcher search result.
const MAX_PE_FILE_BYTES = 100 * 1024 * 1024

function pickBestEntry(entries: GroupEntry[]): GroupEntry | null {
  if (entries.length === 0) return null
  const bySize = (target: number) => entries.find((e) => e.width === target)
  const smaller = entries.filter((e) => e.width <= 64).sort((a, b) => b.width - a.width)
  return bySize(32) ?? bySize(48) ?? bySize(16) ?? smaller[0] ?? entries.reduce((a, b) => (b.width > a.width ? b : a))
}

/**
 * Extract an icon from an exe as a data URL, or null when the file is not a
 * parseable PE / has no icon resources.
 */
export function extractPeIcon(exePath: string): string | null {
  let buf: Buffer
  try {
    const size = statSync(exePath).size
    if (size === 0 || size > MAX_PE_FILE_BYTES) return null
    buf = readFileSync(exePath)
  } catch {
    return null
  }
  try {
    return parsePeIcon(buf)
  } catch {
    // Malformed PE headers can still land out-of-bounds reads — any parse
    // failure simply means "no icon", never a crash.
    return null
  }
}

function parsePeIcon(buf: Buffer): string | null {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) return null // 'MZ'

  const peOff = buf.readUInt32LE(0x3c)
  if (peOff + 24 > buf.length || buf.readUInt32LE(peOff) !== 0x4550) return null // 'PE\0\0'

  // Optional header layout depends on magic (PE32 vs PE32+); the data
  // directory array starts at optHeader + 96 / 112 respectively.
  const optOff = peOff + 24
  if (optOff + 2 > buf.length) return null
  const magic = buf.readUInt16LE(optOff)
  const dataDirOff = optOff + (magic === 0x20b ? 112 : 96)
  const numSections = buf.readUInt16LE(peOff + 6)
  const optSize = buf.readUInt16LE(peOff + 20)
  const sectionOff = optOff + optSize

  if (dataDirOff + 2 * 8 + 4 > buf.length) return null
  const resRva = buf.readUInt32LE(dataDirOff + 2 * 8)
  if (!resRva) return null

  const sections: Array<{ va: number; rawSize: number; rawPtr: number; virtSize: number }> = []
  for (let i = 0; i < numSections; i++) {
    const off = sectionOff + i * 40
    if (off + 40 > buf.length) return null
    sections.push({
      va: buf.readUInt32LE(off + 12),
      rawSize: buf.readUInt32LE(off + 16),
      rawPtr: buf.readUInt32LE(off + 20),
      virtSize: buf.readUInt32LE(off + 8)
    })
  }

  const rvaToOffset = (rva: number): number | null => {
    for (const s of sections) {
      const span = Math.max(s.rawSize, s.virtSize)
      if (rva >= s.va && rva < s.va + span) return s.rawPtr + (rva - s.va)
    }
    return null
  }

  // Resource directory walk: root → type → name/id → language → data entry.
  // Each directory node: 16-byte header + entries of 8 bytes; the top bit of
  // the second uint32 marks a subdirectory.
  interface ResEntry {
    id: number
    offset: number
    isDir: boolean
  }
  const readDir = (dirOffset: number): ResEntry[] => {
    if (dirOffset + 16 > buf.length) return []
    const named = buf.readUInt16LE(dirOffset + 12)
    const ids = buf.readUInt16LE(dirOffset + 14)
    const out: ResEntry[] = []
    for (let i = 0; i < named + ids; i++) {
      const off = dirOffset + 16 + i * 8
      if (off + 8 > buf.length) return out
      out.push({
        id: buf.readUInt32LE(off),
        offset: buf.readUInt32LE(off + 4),
        isDir: (buf.readUInt32LE(off + 4) & 0x80000000) !== 0
      })
    }
    return out
  }

  const resRoot = rvaToOffset(resRva)
  if (resRoot === null) return null

  const typeEntries = readDir(resRoot)
  const groupType = typeEntries.find((e) => e.id === 14 && e.isDir) // RT_GROUP_ICON
  const iconType = typeEntries.find((e) => e.id === 3 && e.isDir) // RT_ICON
  if (!groupType || !iconType) return null

  // leaf data entry (RVA + size) for a resource node (skipping the language level)
  const leafOf = (node: ResEntry): { rva: number; size: number } | null => {
    if (!node.isDir) return null
    const langDir = readDir(resRoot + (node.offset & 0x7fffffff))
    const leaf = langDir.find((e) => !e.isDir)
    if (!leaf) return null
    // IMAGE_RESOURCE_DATA_ENTRY: OffsetToData (RVA) at +0, Size at +4
    const dataOff = resRoot + (leaf.offset & 0x7fffffff)
    if (dataOff + 8 > buf.length) return null
    return { rva: buf.readUInt32LE(dataOff), size: buf.readUInt32LE(dataOff + 4) }
  }

  // First icon group (multiple groups are rare — take the first)
  const firstGroupNode = readDir(resRoot + (groupType.offset & 0x7fffffff)).find((e) => e.isDir)
  if (!firstGroupNode) return null
  const groupLeaf = leafOf(firstGroupNode)
  if (!groupLeaf) return null
  const groupOff = rvaToOffset(groupLeaf.rva)
  if (groupOff === null || groupLeaf.size < 6) return null
  const count = buf.readUInt16LE(groupOff + 4)
  const groupEntries: GroupEntry[] = []
  for (let i = 0; i < count; i++) {
    const off = groupOff + 6 + i * 14
    if (off + 14 > buf.length) break
    groupEntries.push({
      width: buf.readUInt8(off) || 256,
      height: buf.readUInt8(off + 1) || 256,
      bytes: buf.readUInt32LE(off + 8),
      id: buf.readUInt16LE(off + 12)
    })
  }
  const best = pickBestEntry(groupEntries)
  if (!best) return null

  // Locate the RT_ICON resource with that id
  const iconNodes = readDir(resRoot + (iconType.offset & 0x7fffffff))
  const iconNode = iconNodes.find((e) => e.id === best.id)
  if (!iconNode) return null
  const iconLeaf = leafOf(iconNode)
  if (!iconLeaf || iconLeaf.size === 0 || iconLeaf.size > MAX_ICON_BYTES) return null
  const iconOff = rvaToOffset(iconLeaf.rva)
  if (iconOff === null || iconOff + iconLeaf.size > buf.length) return null
  const iconData = buf.subarray(iconOff, iconOff + iconLeaf.size)

  if (iconData.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return `data:image/png;base64,${iconData.toString('base64')}`
  }
  // Legacy BMP/DIB entries render fine through getFileIcon — return null so
  // the caller falls back to it (no need to re-wrap DIBs into .ico here).
  return null
}


