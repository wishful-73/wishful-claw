/**
 * 反馈提交表单（需求 S-226 §8.1）—— **Dialog 形态，不新增路由**。
 *
 * 用原生 `<dialog>` + `showModal()`：焦点陷阱、ESC 关闭、背景 `inert` 都是浏览器给的，
 * 自己实现一遍只会多三种漏焦点的方式。
 *
 * 提交成功**不关闭、不清空**，就地切成功态 + 「再提一条」——
 * 关掉弹窗再看内容消失，是最招人恨的一种交互。
 *
 * ⚠️ 提交成功后**不刷新列表**：新条目是 `pending`，本来就不在公开集里。
 * 不是漏了刷新。
 */

import { useEffect, useRef, useState } from 'react'

import { feedback as copy } from '../content/site'
import { ApiError } from '../lib/api'
import { CODE } from '../lib/api-codes'
import { submitFeedback, type FbType } from '../lib/feedback'

type Phase = 'form' | 'sending' | 'done'

export function FeedbackDialog(props: { type: FbType; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('form')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [contact, setContact] = useState('')
  // 蜜罐：真人看不见、也 tab 不到；填了说明是脚本
  const [website, setWebsite] = useState('')
  const [error, setError] = useState('')

  const isFeature = props.type === 'feature'
  const c = copy.dialog

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    if (!el.open) el.showModal()
    // 打开就聚焦标题框：少一次点击，也让读屏从第一个字段开始念
    titleRef.current?.focus()
  }, [])

  // ESC 走原生 cancel 事件；这里同步父组件状态，避免 dialog 关了而 React 以为还开着
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onCancel = (e: Event) => {
      e.preventDefault()
      props.onClose()
    }
    el.addEventListener('cancel', onCancel)
    return () => el.removeEventListener('cancel', onCancel)
  }, [props])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (phase === 'sending') return

    if (!title.trim() || !content.trim()) {
      setError(c.requiredError)
      return
    }

    setError('')
    setPhase('sending')
    try {
      const r = await submitFeedback({
        type: props.type,
        title,
        content,
        contact,
        // 只带 pathname：查询串里可能有别的东西，跟「在哪一页提的」无关
        page: window.location.pathname,
        website
      })

      if (r.code === CODE.OK) {
        setPhase('done')
        return
      }

      setPhase('form')
      // 服务端的 msg 本来就是给用户看的中文，直接用它；空则兜底
      setError(r.msg || c.failed)
      // 超长/参数缺失时把焦点打回第一个可能出问题的字段
      if (r.code === CODE.TOO_LONG || r.code === CODE.PARAM) titleRef.current?.focus()
    } catch (err) {
      setPhase('form')
      // 传输层失败（网络断 / 网关返 HTML）时 ApiError 的 msg 已经是人话；
      // 其它异常兜一层，别把 `TypeError: xxx` 直接怼给用户
      const message = err instanceof ApiError ? err.message : String((err as Error)?.message || err)
      setError(`${c.failed}：${message}`)
    }
  }

  function reset() {
    setTitle('')
    setContent('')
    setContact('')
    setWebsite('')
    setError('')
    setPhase('form')
    titleRef.current?.focus()
  }

  return (
    <dialog
      ref={dialogRef}
      className="fb-dialog w-[calc(100vw-2rem)] max-w-lg rounded-[13px] border border-ink-700 bg-paper p-0 text-ink-950"
      // 点遮罩关：::backdrop 不派发事件，点击落在 dialog 自身（内边距区），
      // 所以内容都包在下面的 div 里，点到的 target 是 dialog 本身才算「点了外面」
      onClick={(e) => {
        if (e.target === dialogRef.current) props.onClose()
      }}
    >
      <div className="p-6">
        {phase === 'done' ? (
          <div>
            <h2 className="text-lg font-semibold">{c.successTitle}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-900/65">{c.successBody}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={reset}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-paper-soft"
              >
                {c.again}
              </button>
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-soft"
              >
                {c.close}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <h2 className="text-lg font-semibold">{isFeature ? c.featureTitle : c.bugTitle}</h2>
            <p className="mt-1 text-sm text-ink-900/55">{isFeature ? c.featureHint : c.bugHint}</p>

            <label htmlFor="fb-title" className="mt-5 block text-xs font-semibold text-ink-900/70">
              {c.titleLabel}
            </label>
            <input
              id="fb-title"
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={c.titlePlaceholder}
              className="mt-1.5 w-full rounded-lg border border-ink-700 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            />

            <label htmlFor="fb-content" className="mt-4 block text-xs font-semibold text-ink-900/70">
              {c.contentLabel}
            </label>
            <textarea
              id="fb-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={2000}
              rows={6}
              placeholder={c.contentPlaceholder}
              className="mt-1.5 w-full resize-y rounded-lg border border-ink-700 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            />

            <label htmlFor="fb-contact" className="mt-4 block text-xs font-semibold text-ink-900/70">
              {c.contactLabel}
            </label>
            <input
              id="fb-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={120}
              placeholder={c.contactPlaceholder}
              className="mt-1.5 w-full rounded-lg border border-ink-700 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <p className="mt-1.5 text-xs leading-relaxed text-ink-900/45">{c.contactHint}</p>

            {/* 蜜罐：绝对定位移出视口 + tabIndex -1 + aria-hidden。
                不用 display:none / hidden —— 一部分脚本会跳过「看不见」的字段，
                却不跳过「移出屏幕」的字段。名字 `website` 对机器人很有吸引力。 */}
            <div aria-hidden="true" className="pointer-events-none absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden">
              <label htmlFor="fb-website">website</label>
              <input
                id="fb-website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-accent/8 px-3 py-2 text-sm text-ink-950">
                {error}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-lg border border-ink-700 px-4 py-2 text-sm font-medium text-ink-900 hover:bg-paper-soft"
              >
                {c.cancel}
              </button>
              <button
                type="submit"
                disabled={phase === 'sending'}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-soft disabled:opacity-60"
              >
                {phase === 'sending' ? c.submitting : c.submit}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  )
}
