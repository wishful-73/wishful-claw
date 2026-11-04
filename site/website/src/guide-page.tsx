import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import GUIDE_MD from './content/user-guide.md?raw'
import { DocPage, type DocCard } from './components/doc-page'
import { docComponents } from './components/doc-blocks'
import { buildToc } from './lib/markdown-toc'
import { buildNav } from './lib/doc-nav'
import { guideCards, guideFallbackDescs, guideGroups, guideSlugs } from './content/guide-nav'

// 渲染前先把标题扫出来（同名章节要靠出现顺序去重，边渲染边算会跳错锚点）
const toc = buildToc(GUIDE_MD, guideSlugs)
const nav = buildNav(toc.items, { groups: guideGroups, fallbackDescs: guideFallbackDescs })

// 章号 → 锚点：入口卡只写章号，标题改字不影响跳转
const idByChapter = new Map<number, string>()
for (const item of toc.items) {
  const match = /^(\d+)\.\s/.exec(item.text)
  if (match) idByChapter.set(Number(match[1]), item.id)
}

const cards: DocCard[] = guideCards.map((card) => ({
  title: card.title,
  links: card.sentence.map((link) => ({ text: link.text, href: `#${idByChapter.get(link.chapter) ?? ''}` }))
}))

function headingText(children: unknown): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.filter((c) => typeof c === 'string').join('')
  return ''
}

const components: Components = {
  ...docComponents,
  h2: ({ children }) => <h2 id={toc.ids.get(headingText(children))}>{children}</h2>,
  h3: ({ children }) => <h3 id={toc.ids.get(headingText(children))}>{children}</h3>
}

export default function GuidePage() {
  return (
    <DocPage
      eyebrow="心相 · 使用指引"
      title="从装好到派活，都在这一页"
      description="项目下会话怎么干活、全局会话怎么派活、权限怎么给、记忆怎么用 —— 可以顺着读，也可以只翻你卡住的那一节。"
      nav={nav}
      cards={cards}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {GUIDE_MD}
      </Markdown>
    </DocPage>
  )
}
