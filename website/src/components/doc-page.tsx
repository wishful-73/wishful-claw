import { useEffect, useRef, type ReactNode } from 'react'
import { SiteHeader } from './site-header'
import { SiteFooter } from '../sections/site-footer'
import { useActiveHeading } from '../lib/use-active-heading'
import type { NavGroup } from '../lib/doc-nav'

export interface DocCard {
  title: string
  links: { text: string; href: string }[]
}

// 文档页外壳：左分组目录（桌面 sticky、可独立滚）+ 右正文。使用指引与更新日志共用这一份。
// 排版对齐 reasonix.io/docs（2026-09-21 老大指定参考）：目录每项「标题 + 一句话副标题」的药丸、
// 首屏大标题 + 导语 + 入口卡；正文排版与卡片块见 index.css 的 .doc-prose 与 components/doc-blocks.tsx。
export function DocPage(props: {
  eyebrow: string
  title: string
  description: string
  nav: NavGroup[]
  cards?: DocCard[]
  children: ReactNode
}) {
  const ids = props.nav.flatMap((group) => group.items.map((item) => item.id))
  const articleRef = useRef<HTMLElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const active = useActiveHeading(articleRef, ids)

  // 选中项跟着正文变之后拉回目录可视区：只挪目录那一栏，不动整页，
  // 否则就把用户正在读的位置顶走。
  useEffect(() => {
    const box = railRef.current
    if (!box) return
    const link = [...box.querySelectorAll<HTMLAnchorElement>('a')].find(
      (a) => a.getAttribute('href') === `#${active}`
    )
    const item = link?.parentElement
    if (!item) return
    const itemBox = item.getBoundingClientRect()
    const boxShadow = box.getBoundingClientRect()
    if (itemBox.top < boxShadow.top + 8) box.scrollTop -= boxShadow.top + 8 - itemBox.top
    else if (itemBox.bottom > boxShadow.bottom - 8) box.scrollTop += itemBox.bottom - boxShadow.bottom + 8
  }, [active])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-6xl px-6 py-14 sm:py-16">
        {/* 字距压到 0.08em：拉丁文用 0.2em 是 reasonix 那种 mono 眉标的观感，中文是等宽方块字，
            照抄会把「心 相 · 使 用 指 引」拉成一片空格，反而像坏掉了。 */}
        <p className="font-mono text-xs font-semibold tracking-[0.08em] text-accent">{props.eyebrow}</p>
        <h1 className="mt-3 max-w-[22ch] text-[34px] font-semibold leading-[1.15] tracking-tight text-ink-950 sm:text-[42px]">
          {props.title}
        </h1>
        <p className="mt-4 max-w-[52ch] text-[17px] leading-[1.65] text-ink-900/70">{props.description}</p>

        {props.cards ? (
          <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {props.cards.map((card) => (
              <div key={card.title} className="rounded-[13px] border border-ink-700 bg-paper p-4 transition-colors hover:border-ink-900/25">
                <p className="text-[15px] font-semibold text-ink-950">{card.title}</p>
                <p className="mt-2 text-[13.5px] leading-[1.7]">
                  {card.links.map((link, index) => (
                    <span key={link.href + link.text}>
                      {index > 0 ? '、' : ''}
                      <a href={link.href} className="text-accent hover:underline">
                        {link.text}
                      </a>
                    </span>
                  ))}
                  。
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <details className="mt-9 rounded-[13px] border border-ink-700 bg-paper p-5 lg:hidden">
          <summary className="cursor-pointer text-sm font-semibold text-ink-950">目录（{ids.length} 节）</summary>
          {props.nav.map((group) => (
            <NavSection key={group.title ?? 'all'} group={group} active={active} />
          ))}
        </details>

        <div className="mt-12 grid gap-10 lg:grid-cols-[264px_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="目录" className="hidden lg:block">
            <div ref={railRef} className="doc-rail sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
              {props.nav.map((group) => (
                <NavSection key={group.title ?? 'all'} group={group} active={active} />
              ))}
            </div>
          </nav>
          <article ref={articleRef} className="prose doc-prose min-w-0 max-w-[720px]">
            {props.children}
          </article>
        </div>
      </main>
      <SiteFooter />
    </>
  )
}

function NavSection(props: { group: NavGroup; active: string }) {
  return (
    <div className="mb-6 last:mb-0">
      {props.group.title ? (
        <p className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-900/40">{props.group.title}</p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {props.group.items.map((item) => {
          const isActive = item.id === props.active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={isActive ? 'true' : undefined}
                className={`block rounded-[14px] px-4 py-[9px] transition-colors ${
                  isActive ? 'bg-accent-tint text-accent' : 'hover:bg-ink-800'
                }`}
              >
                <span className={`block text-sm leading-snug ${isActive ? 'font-medium' : 'text-ink-900/80'}`}>{item.title}</span>
                {item.description ? (
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-900/45">{item.description}</span>
                ) : null}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
