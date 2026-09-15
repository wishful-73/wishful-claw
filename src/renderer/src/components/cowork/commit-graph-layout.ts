import type { GitCommitGraphItem } from '@renderer/stores/git-store'

/** Lane colours — saturated enough to stay legible on the light panel background. */
export const LANE_COLORS = [
  '#2563eb',
  '#d97706',
  '#059669',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#ca8a04',
  '#dc2626'
] as const

export const GRAPH_ROW_HEIGHT = 26
export const GRAPH_LANE_WIDTH = 14
export const GRAPH_PADDING_X = 10
export const GRAPH_PADDING_Y = 6

export interface GraphLink {
  /** Row index of the parent commit — always greater than the source row. */
  row: number
  lane: number
}

export interface GraphRow {
  commit: GitCommitGraphItem
  row: number
  lane: number
  /** Parents present in this batch; parents cut off by the limit are dropped. */
  links: GraphLink[]
}

export interface CommitGraphLayout {
  rows: GraphRow[]
  laneCount: number
  width: number
  height: number
}

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

export function graphNodeX(lane: number): number {
  return GRAPH_PADDING_X + lane * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2
}

export function graphNodeY(row: number): number {
  return GRAPH_PADDING_Y + row * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2
}

/**
 * Assigns every commit a lane (column) so that a commit and its first parent share one,
 * side branches get their own, and lanes freed by a merge are reused by the next branch
 * that needs one. Width stays bounded by the number of branches alive at the same time
 * rather than by the total branch count.
 *
 * `commits` must be in `git log` order (newest first): the walk is single-pass and relies
 * on every parent appearing *after* its child, which `--date-order` output guarantees for
 * the truncated window we request.
 */
export function layoutCommitGraph(commits: GitCommitGraphItem[]): CommitGraphLayout {
  const lanes: (string | null)[] = []
  const laneByHash = new Map<string, number>()
  const rowByHash = new Map<string, number>()
  const rows: GraphRow[] = []

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash)
    if (lane === -1) {
      const free = lanes.indexOf(null)
      lane = free === -1 ? lanes.length : free
      lanes[lane] = commit.hash
    }
    laneByHash.set(commit.hash, lane)
    rowByHash.set(commit.hash, row)

    // This commit is drawn; hand its lane to the first parent so the branch reads as one
    // continuous line, and park the remaining parents (merge sources) on their own lanes.
    lanes[lane] = null
    commit.parents.forEach((parent, index) => {
      if (lanes.includes(parent)) return
      if (index === 0) {
        lanes[lane] = parent
        return
      }
      const free = lanes.indexOf(null)
      const target = free === -1 ? lanes.length : free
      lanes[target] = parent
    })

    rows.push({ commit, row, lane, links: [] })
  })

  let laneCount = 1
  for (const graphRow of rows) {
    graphRow.links = graphRow.commit.parents.flatMap((parent) => {
      const parentRow = rowByHash.get(parent)
      const parentLane = laneByHash.get(parent)
      return parentRow === undefined || parentLane === undefined
        ? []
        : [{ row: parentRow, lane: parentLane }]
    })
    laneCount = Math.max(laneCount, graphRow.lane + 1)
    for (const link of graphRow.links) laneCount = Math.max(laneCount, link.lane + 1)
  }

  return {
    rows,
    laneCount,
    width: GRAPH_PADDING_X * 2 + laneCount * GRAPH_LANE_WIDTH,
    height: GRAPH_PADDING_Y * 2 + rows.length * GRAPH_ROW_HEIGHT
  }
}
