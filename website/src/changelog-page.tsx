import CHANGELOG_MD from './content/changelog.md?raw'
import { changelogAnchor, parseChangelog } from './lib/changelog'
import { DocPage } from './components/doc-page'
import { flatNav } from './lib/doc-nav'
import { GITHUB_REPO_URL } from './content/site'

const entries = parseChangelog(CHANGELOG_MD)
const nav = flatNav(
  entries.map((entry) => ({ id: changelogAnchor(entry.version), text: entry.version, level: 2 as const }))
)

export default function ChangelogPage() {
  return (
    <DocPage
      eyebrow="心相 · 更新日志"
      title="每个迭代改了什么，一条条记在这儿"
      description="按迭代发布，一个版本一节。想翻更早的记录，去 GitHub Releases。"
      nav={nav}
    >
      {entries.map((entry) => (
        <section key={entry.version} id={changelogAnchor(entry.version)}>
          <h2>
            {entry.version}
            <span className="ml-3 align-middle text-sm font-normal text-ink-900/45">{entry.date}</span>
          </h2>
          <ul>
            {entry.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </section>
      ))}
      <p>
        更早版本的完整记录在{' '}
        <a href={`${GITHUB_REPO_URL}/releases`} target="_blank" rel="noopener noreferrer">
          GitHub Releases
        </a>
        。
      </p>
    </DocPage>
  )
}
