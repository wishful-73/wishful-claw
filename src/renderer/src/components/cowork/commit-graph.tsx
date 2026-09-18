import * as React from 'react'
import {
  graphNodeX,
  graphNodeY,
  laneColor,
  type CommitGraphLayout
} from './commit-graph-layout'

const NODE_RADIUS = 3.5
/** 节点本体只有 7px 直径、很难命中，垫一层透明的扩大命中区；行距 26px，不会与相邻行重叠。 */
const NODE_HIT_RADIUS = 8
/** Fraction of the vertical gap spent easing into the curve, so merges look smooth. */
const CURVE_RATIO = 0.6

/**
 * Lane rails for the commit graph. Drawn as a plain SVG so the panel pulls in no chart
 * dependency; the row heights here must match `GRAPH_ROW_HEIGHT` in the layout module,
 * because the sibling commit list positions its rows against this drawing.
 */
export function CommitGraphSvg({
  layout,
  activeHash = null,
  onRowHover
}: {
  layout: CommitGraphLayout
  /** 被标出的提交哈希，由父容器的行 hover 或本组件内的节点 hover 驱动，两侧共用。 */
  activeHash?: string | null
  onRowHover?: (hash: string | null) => void
}): React.JSX.Element {
  return (
    <svg
      className="shrink-0"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
    >
      {layout.rows.map((row) =>
        row.links.map((link) => {
          const x1 = graphNodeX(row.lane)
          const y1 = graphNodeY(row.row)
          const x2 = graphNodeX(link.lane)
          const y2 = graphNodeY(link.row)
          const dy = (y2 - y1) * CURVE_RATIO
          return (
            <path
              key={`${row.commit.hash}-${link.row}`}
              d={`M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`}
              fill="none"
              stroke={laneColor(row.lane)}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          )
        })
      )}
      {layout.rows.map((row) => {
        const isActive = activeHash === row.commit.hash
        return (
          <g
            key={row.commit.hash}
            onMouseEnter={() => onRowHover?.(row.commit.hash)}
            onMouseLeave={() => onRowHover?.(null)}
          >
            <circle
              cx={graphNodeX(row.lane)}
              cy={graphNodeY(row.row)}
              r={NODE_HIT_RADIUS}
              fill="transparent"
            />
            <circle
              cx={graphNodeX(row.lane)}
              cy={graphNodeY(row.row)}
              r={isActive ? NODE_RADIUS * 2 : NODE_RADIUS}
              fill={laneColor(row.lane)}
              style={{ transition: 'r 120ms ease-out' }}
            />
          </g>
        )
      })}
    </svg>
  )
}
