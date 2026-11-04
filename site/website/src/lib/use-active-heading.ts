import { useEffect, useState, type RefObject } from 'react'

// 阈值线：比正文标题的 scroll-margin-top（80px，见 index.css）稍低一点，
// 点目录跳过去之后，目标标题停在 80px 处，正好落在阈值线下方 ⇒ 高亮不会跳回上一节。
const TOP_LINE = 88

/**
 * 右侧滚到哪一节，左侧目录就选中哪一节。
 * 高亮只由标题位置推出，点击时不额外钉住 —— 跳转动画途中它跟着内容走，落点自然正确。
 * ids 按文档出现顺序传入；用 join 做依赖键，调用方就地写数组字面量也不会每轮重挂监听。
 */
export function useActiveHeading(
  articleRef: RefObject<HTMLElement | null>,
  ids: string[]
): string {
  const key = ids.join('|')
  const [active, setActive] = useState(() => ids[0] ?? '')

  useEffect(() => {
    if (!articleRef.current) return
    let frame = 0

    const compute = (): void => {
      frame = 0
      const nodes = key
        .split('|')
        .map((id) => document.getElementById(id))
        .filter((node): node is HTMLElement => node !== null)
      if (nodes.length === 0) return

      // 文末兜底：最后几节的标题可能一路够不到阈值线 —— 实测更新日志滚到底时 v0.2.24 停在
      // y≈379，因为下面还压着 209px 的页脚 ⇒ 没有这条，目录最后一项永远选不上。
      // 指引页不需要（滚到底时第 17 章在 y=−233，早已越过线），加上也不改变它的结果。
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setActive(nodes[nodes.length - 1].id)
        return
      }
      let current = nodes[0].id
      for (const node of nodes) {
        if (node.getBoundingClientRect().top > TOP_LINE) break
        current = node.id
      }
      setActive(current)
    }

    const onScroll = (): void => {
      if (!frame) frame = requestAnimationFrame(compute)
    }

    compute()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [articleRef, key])

  return active
}
