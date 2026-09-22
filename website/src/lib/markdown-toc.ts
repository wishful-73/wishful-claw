export interface TocItem {
  id: string
  text: string
  level: 2 | 3
}

export interface DocToc {
  items: TocItem[]
  /** 标题原文 → 锚点 id，供 react-markdown 的 components 查表挂 id */
  ids: Map<string, string>
}

// GitHub 式 slug：小写 → 空格换成 '-' → 删掉非「字母/数字/连字符」的字符。
// 顺序不能反：先删标点会把 "插件 / 扩展" 的空格并成一个 '-'，与仓库既有 TOC 的 '--' 不一致。
// \p{L} \p{N} 保留中文，所以中文标题不需要转写。
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
}

/**
 * 预扫 markdown 的 ## / ### 标题，产出侧栏目录与「标题 → id」查表。
 * 必须在渲染前算好：components 里逐个 h2 现算会因重复标题（同名章节）拿到不同 id，锚点就跳错。
 * slugs 给出「标题 → 指定锚点」时优先用它（指引的英文锚点就走这条路），没给的仍按 GitHub 式中文 slug 兜底。
 */
export function buildToc(md: string, slugs?: Record<string, string>): DocToc {
  const items: TocItem[] = []
  const ids = new Map<string, string>()
  const used = new Map<string, number>()
  let inFence = false

  for (const line of md.split('\n')) {
    if (line.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const match = /^(#{2,3}) (.+)$/.exec(line)
    if (!match) continue

    const level = match[1].length as 2 | 3
    const text = match[2].trim()
    const base = slugs?.[text] || slugify(text) || 'section'
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    const id = seen === 0 ? base : `${base}-${seen}`

    if (!ids.has(text)) ids.set(text, id)
    items.push({ id, text, level })
  }

  return { items, ids }
}
