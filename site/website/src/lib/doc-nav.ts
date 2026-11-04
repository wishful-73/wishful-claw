import type { TocItem } from './markdown-toc'

export interface NavItem {
  id: string
  title: string
  description?: string
}

export interface NavGroup {
  /** 省略则不渲染组标题（更新日志页就一组，不需要标题） */
  title?: string
  items: NavItem[]
}

// "5. 项目下会话：干活的地方" → 标题留编号（正文里也是这个编号，对得上），冒号后的部分当副标题。
// 冒号只切第一处：章节标题里「插件 / 扩展：A、B」这种副标题本身还可能带顿号，不再切。
function splitTitle(text: string): { title: string; description?: string } {
  const at = text.indexOf('：')
  if (at === -1) return { title: text }
  return { title: text.slice(0, at), description: text.slice(at + 1).trim() }
}

function chapterOf(text: string): number | null {
  const match = /^(\d+)\.\s/.exec(text)
  return match ? Number(match[1]) : null
}

/**
 * 把二级标题按章号归进给定分组。
 * 漏配章号的条目落到末尾的「其他」，不让导航静默少一项 —— 侧栏少一章比多一章难发现得多。
 */
export function buildNav(
  items: TocItem[],
  opts: { groups: { title: string; chapters: number[] }[]; fallbackDescs?: Record<number, string> }
): NavGroup[] {
  const byChapter = new Map<number, NavItem>()
  for (const item of items) {
    if (item.level !== 2) continue
    const chapter = chapterOf(item.text)
    const { title, description } = splitTitle(item.text)
    byChapter.set(chapter ?? -1, {
      id: item.id,
      title,
      description: description || (chapter !== null ? opts.fallbackDescs?.[chapter] : undefined)
    })
  }

  const nav: NavGroup[] = opts.groups.map((group) => ({
    title: group.title,
    items: group.chapters.map((chapter) => byChapter.get(chapter)).filter((item): item is NavItem => item !== undefined)
  }))

  const placed = new Set(opts.groups.flatMap((group) => group.chapters))
  const rest = [...byChapter.entries()].filter(([chapter]) => !placed.has(chapter))
  if (rest.length > 0) nav.push({ title: '其他', items: rest.map(([, item]) => item) })

  return nav.filter((group) => group.items.length > 0)
}

/** 无分组的一维列表（更新日志页用） */
export function flatNav(items: TocItem[]): NavGroup[] {
  return [{ items: items.map((item) => ({ id: item.id, title: item.text })) }]
}
