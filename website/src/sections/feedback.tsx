/**
 * 首页反馈区（需求 S-226 §8.3）—— 「待办 / 已做」公开列表 + 两个提交入口。
 *
 * 关于「空态整段不渲染」的边界，这里分得比站点统计更细：
 *   · **列表**拿不到 ⇒ 列表整段不出现（同 `site-stats` 口径：不显示 0、不显示「暂无」）
 *   · **标题与两个提交按钮**始终在 ⇒ 那是这个区块存在的理由。
 *     列表是「结果展示」，提交是「功能本身」；功能不该因为读接口挂了而消失。
 *
 * 正文**纯文本渲染**（`whitespace-pre-wrap`），全程 textContent 路径，
 * 不碰 `dangerouslySetInnerHTML` —— XSS 面为零（§11 已拍板）。
 */

import { useState } from 'react'

import { FeedbackDialog } from '../components/feedback-dialog'
import { Reveal, Section } from '../components/ui'
import { feedback as copy } from '../content/site'
import { useFeedbackList, type FbEntry, type FbType } from '../lib/feedback'

export function Feedback() {
  const items = useFeedbackList()
  const [openType, setOpenType] = useState<FbType | null>(null)
  const [showAll, setShowAll] = useState(false)

  const visible = items ? (showAll ? items : items.slice(0, copy.visibleCount)) : []
  const hasMore = !!items && items.length > copy.visibleCount

  return (
    <Section id="feedback" eyebrow={copy.eyebrow} title={copy.title}>
      <Reveal>
        <div className="mx-auto max-w-3xl">
          <p className="text-base leading-relaxed text-ink-900/65">{copy.intro}</p>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setOpenType('feature')}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-soft"
            >
              {copy.openFeature}
            </button>
            <button
              type="button"
              onClick={() => setOpenType('bug')}
              className="rounded-lg border border-ink-700 px-5 py-2.5 text-sm font-medium text-ink-900 transition-colors hover:bg-paper-soft"
            >
              {copy.openBug}
            </button>
          </div>

          {/* 列表：拿不到数据就整段不渲染（不显示空态文案） */}
          {items && items.length > 0 && (
            <div className="mt-10">
              <h3 className="mb-4 text-xs font-semibold tracking-[0.18em] text-ink-900/45 uppercase">
                {copy.listTitle}
              </h3>
              <ul className="flex flex-col gap-3">
                {visible.map((item) => (
                  <li key={item.id}>
                    <Entry item={item} />
                  </li>
                ))}
              </ul>
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-4 text-sm font-medium text-accent hover:underline"
                >
                  {showAll ? copy.less : copy.more}
                </button>
              )}
            </div>
          )}
        </div>
      </Reveal>

      {openType && <FeedbackDialog type={openType} onClose={() => setOpenType(null)} />}
    </Section>
  )
}

/** 4 字符的 MM-DD —— 20xx 年对读者没有信息量，写全只是噪音 */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function Entry(props: { item: FbEntry }) {
  const { item } = props
  const [expanded, setExpanded] = useState(false)
  const done = item.status === 'done'
  // 长正文默认折到 3 行，就地展开（不做详情页）
  const long = item.content.length > 160

  return (
    <article className="rounded-[13px] border border-ink-700 bg-paper px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            done
              ? 'rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700'
              : 'rounded-md bg-ink-800 px-2 py-0.5 text-[11px] font-semibold text-ink-900/70'
          }
        >
          {done ? `✓ ${copy.doneLabel}` : copy.todoLabel}
        </span>
        <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
          {copy.typeLabel[item.type]}
        </span>
        <h4 className="text-[15px] font-semibold text-ink-950">{item.title}</h4>
        <span className="ml-auto text-xs text-ink-900/35">{shortDate(item.created_at)}</span>
      </div>

      <p
        className={`mt-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink-900/70 ${
          expanded || !long ? '' : 'line-clamp-3'
        }`}
      >
        {item.content}
      </p>
      {long && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-accent hover:underline"
        >
          {expanded ? copy.less : copy.more}
        </button>
      )}
    </article>
  )
}
