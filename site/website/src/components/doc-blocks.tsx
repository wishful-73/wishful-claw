import { Children, isValidElement, type ReactNode } from 'react'
import type { Components } from 'react-markdown'

// 正文块级结构 → 卡片的映射（参考 reasonix.io/docs 的 panel / callout / choice-grid）。
// 判据全部来自 markdown 自身的结构，不引入新语法：
//   ol                → 步骤卡（本文档的有序列表都是操作流程，没有例外）
//   ul（每项以 **粗** 开头，≥2 项）→ 特性卡网格；否则保持普通项目符号
//   blockquote        → callout；首段写 [!TIP] / [!WARNING] 可换强调档
//   table             → 带圆角容器与表头底色的表格卡

type HastNode = {
  tagName?: string
  children?: HastNode[]
}

const CALLOUT_MARKERS: Record<string, { label: string; variant: string }> = {
  '[!TIP]': { label: '提示', variant: 'tip' },
  '[!WARNING]': { label: '注意', variant: 'warning' },
  '[!NOTE]': { label: '说明', variant: 'note' }
}

function isStrongLeadItem(item: HastNode): boolean {
  return item.tagName === 'li' && firstElementChild(item)?.tagName === 'strong'
}

function firstElementChild(node: HastNode): HastNode | undefined {
  return node.children?.find((child) => child.tagName !== undefined)
}

function readsAsFeatureGrid(node: HastNode | undefined): boolean {
  const items = (node?.children ?? []).filter((child) => child.tagName === 'li')
  return items.length >= 2 && items.every(isStrongLeadItem)
}

/** 把 React 子节点里的纯文本拼出来（react-markdown 给单个文本也会包成数组，不能只判 string） */
function textOf(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** 首段是 "[!TIP]" 这类标记时把它摘掉，返回标记与剩余内容 */
function splitCalloutMarker(children: ReactNode): { marker: { label: string; variant: string } | null; rest: ReactNode[] } {
  // 块级子节点之间会留下纯换行的文本节点，不先滤掉就取不到真正的首段
  const nodes = Children.toArray(children).filter(
    (node) => !(typeof node === 'string' && node.trim() === '')
  )
  const head = nodes[0]
  if (isValidElement<{ children?: ReactNode }>(head)) {
    const marker = CALLOUT_MARKERS[textOf(head.props.children).trim()]
    if (marker) return { marker, rest: nodes.slice(1) }
  }
  return { marker: null, rest: nodes }
}

export const docComponents: Components = {
  ol: ({ children }) => <ol className="steps">{children}</ol>,

  ul: ({ children, node }) => {
    if (!readsAsFeatureGrid(node as HastNode | undefined)) return <ul>{children}</ul>
    return <ul className="feature-grid">{children}</ul>
  },

  blockquote: ({ children }) => {
    const { marker, rest } = splitCalloutMarker(children)
    const variant = marker?.variant ?? 'note'
    return (
      <blockquote className={`callout callout--${variant}`}>
        <span className="callout-badge" aria-hidden="true">!</span>
        <div className="callout-body">
          {marker ? <span className="callout-label">{marker.label}</span> : null}
          {rest}
        </div>
      </blockquote>
    )
  },

  table: ({ children }) => (
    <div className="doc-table">
      <table>{children}</table>
    </div>
  )
}
