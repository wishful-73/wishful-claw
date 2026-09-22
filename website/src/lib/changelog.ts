export interface ChangelogEntry {
  version: string
  date: string
  bullets: string[]
}

/**
 * 解析 `website/content/changelog.md`：`## v0.2.33 · 2026-09-20` 开一节，节内 `- ` 行是变更条目。
 * 刻意只认这一种结构、不跑 markdown 渲染器 —— 首页区块与独立页共用这里的纯数据，
 * 否则为了几行日志要把渲染器拖进首页 chunk。
 */
export function parseChangelog(md: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null

  for (const line of md.split('\n')) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      const [version, date] = heading[1].split(' · ')
      current = { version: version.trim(), date: (date ?? '').trim(), bullets: [] }
      entries.push(current)
      continue
    }
    const bullet = /^- (.+)$/.exec(line)
    if (bullet && current) current.bullets.push(bullet[1].trim())
  }

  return entries
}

export function changelogAnchor(version: string): string {
  return version.replace(/\./g, '-')
}
