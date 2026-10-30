/**
 * 自家窗口的元素树 —— 走 CDP 的 `Accessibility.getFullAXTree`（S-273 段 A）。
 *
 * **为什么不碰 UIA**：`WishfulClaw.Worker` 是 `PublishAot=true`，`System.Windows.Automation`
 * 属 WindowsDesktop SDK，AOT 下直接不可用（详见 `docs/plans/iter-v3-4/requirements/S-273.md`
 * §九 的实测）。而自家窗口有一条更省的路：主进程本来就拿得到 `webContents`，挂 CDP 就能
 * 拿到 Chromium 自己维护的可访问性树 —— 元素名与矩形都是浏览器给的，不用视觉猜。
 *
 * **这个文件刻意不 import electron**：`debugger` / `Accessibility.enable` 都通过注入的
 * `CdpSession` 走，测试才能塞一个假 session，断言 `enable` 与 `disable` **成对**（含异常
 * 路径）。真实接线在 `ipc/desktop-elements.ts`。
 *
 * **坐标系**（必须与 S-272 对齐，对齐不了就明说）：
 * - `DOM.getBoxModel` 给的是 **CSS 像素、相对视口**；
 * - 视口左上角在屏幕上的位置 = `win.getContentBounds()`（**DIP**，屏幕坐标）；
 * - DIP → 物理像素按 `scaleFactor` 乘（与 `lib/desktop-screen.ts` 的 `toPhysicalRect` 同源）。
 *
 * 混合 DPI 下 `getContentBounds()` 本身是 DIP、乘的是**窗口所在那块屏**的 `scaleFactor`，
 * 与 S-272 用的主屏 `scaleFactor` 在「窗口在主屏」时完全一致；窗口在副屏且两块屏缩放不同
 * 时会有偏差 —— 这条写进返回报文的 `frameNote`，不假装对齐。
 */

/** CDP 会话的最小形状 —— 真实实现是 `webContents.debugger`，测试里是假的。 */
export interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

export interface AxQueryOptions {
  /** 只保留名字里含这个关键字的元素（大小写不敏感）。空 = 全留。 */
  nameFilter?: string
  /** 只保留这些 role（如 `button` / `textbox` / `link`）。空 = 全留。 */
  roles?: string[]
  /** 树深度上限，默认 8。 */
  maxDepth?: number
  /** 最多返回多少条，默认 120 —— 上千条对模型没用，还占上下文。 */
  maxElements?: number
}

export interface AxElementRow {
  name: string
  role: string
  /** 命中关键字时模型最常用的锚点，可能为空。 */
  automationId?: string
  /** 屏幕物理像素矩形，与 `DesktopClick` 同一套。 */
  x: number
  y: number
  width: number
  height: number
  enabled: boolean
  /** 中心点，直接可以喂给 `DesktopClick`。 */
  centerX: number
  centerY: number
}

export interface AxFrame {
  /** 视口（内容区）左上角，屏幕 DIP。 */
  originX: number
  originY: number
  scaleFactor: number
  /** CSS 像素 → DIP 的除数（页面缩放）。 */
  zoomFactor: number
}

/** `collectAxElements` 的完整结果 —— 报文里除了元素还要说清楚坐标系。 */
export interface AxCollectResult {
  elements: AxElementRow[]
  /** 树里一共有多少节点（过滤前），让模型知道「没找到」是过滤掉的还是本来就没有。 */
  totalNodes: number
  /** 坐标系说明。混合 DPI 下的偏差在这里如实说，不藏。 */
  frameNote: string
  /** 拿不到矩形的节点数 —— `getBoxModel` 对不可见节点会失败。 */
  missingRects: number
}

const DEFAULT_MAX_DEPTH = 8
const DEFAULT_MAX_ELEMENTS = 120
/** `getBoxModel` 对上千个节点逐个发请求会把主进程拖住 —— 只给最有用的前 N 个取矩形。 */
const MAX_BOX_MODEL_REQUESTS = 200

interface AxNode {
  nodeId?: string
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  properties?: Array<{ name?: string; value?: { value?: unknown } }>
  backendDOMNodeId?: number
  childIds?: string[]
}

interface BoxModelResponse {
  model?: { content?: number[]; width?: number; height?: number }
}

/**
 * 拉一棵可访问性树并把元素换算成屏幕物理像素。
 *
 * **`Accessibility.enable` / `disable` 必须成对**：开了不关，Chromium 会为这个渲染进程
 * 一直维护完整 a11y 树 —— 正是 v3-iter-4 刚压下去的内存问题的来源。所以 `disable` 放在
 * `finally`，异常路径也收；`disable` 自己失败不许掩盖原始异常。
 */
export async function collectAxElements(
  session: CdpSession,
  frame: AxFrame,
  options: AxQueryOptions = {}
): Promise<AxCollectResult> {
  const maxDepth = clampInt(options.maxDepth, DEFAULT_MAX_DEPTH, 1, 32)
  const maxElements = clampInt(options.maxElements, DEFAULT_MAX_ELEMENTS, 1, 500)

  await session.send('Accessibility.enable')
  try {
    const tree = await session.send('Accessibility.getFullAXTree')
    const nodes = extractNodes(tree)
    const roots = buildRootSet(nodes)
    const wanted = selectCandidates(nodes, roots, maxDepth, options)

    const withRects: Array<{ node: AxNode; rect: CssRect }> = []
    let missingRects = 0
    let boxRequests = 0
    for (const node of wanted) {
      if (withRects.length >= maxElements) break
      if (typeof node.backendDOMNodeId !== 'number') {
        // 根 / 容器节点没有后端 DOM 节点，本来就不该被点 —— 跳过但**不计入
        // missingRects**，那个计数只统计「本该有矩形却没拿到」的元素。
        continue
      }
      if (boxRequests >= MAX_BOX_MODEL_REQUESTS) break
      boxRequests += 1
      const rect = await tryGetBoxModel(session, node.backendDOMNodeId)
      if (!rect) {
        missingRects += 1
        continue
      }
      withRects.push({ node, rect })
    }

    return {
      elements: withRects.map(({ node, rect }) => toRow(node, rect, frame)),
      totalNodes: nodes.length,
      frameNote: describeFrame(frame),
      missingRects
    }
  } finally {
    // 收在这里，异常路径也收。disable 失败不抛出 —— 它一旦盖住原始异常，
    // 模型看到的是「disable 失败」而不是「树没拉到」，排查方向直接跑偏。
    try {
      await session.send('Accessibility.disable')
    } catch {
      // 忽略：调用方要么已经拿到结果，要么已经有更重要的异常在飞
    }
  }
}

/**
 * 名字里一个都对不上时，给模型一串候选 —— 让它在下一轮改对，而不是反复试坐标。
 * 纯编辑距离，短名单，够用。
 */
export function pickClosestNames(name: string, candidates: string[], limit = 5): string[] {
  const needle = name.trim().toLowerCase()
  if (!needle) return candidates.slice(0, limit)
  return candidates
    .map((candidate) => ({ candidate, score: editDistance(needle, candidate.toLowerCase()) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

/** CSS 像素矩形（相对视口）→ 屏幕物理像素矩形。与 S-272 同一套帧。 */
export function cssRectToPhysical(
  rect: CssRect,
  frame: AxFrame
): { x: number; y: number; width: number; height: number } {
  const zoom = frame.zoomFactor > 0 ? frame.zoomFactor : 1
  const scale = frame.scaleFactor > 0 ? frame.scaleFactor : 1
  const left = frame.originX + rect.x / zoom
  const top = frame.originY + rect.y / zoom
  return {
    x: Math.round(left * scale),
    y: Math.round(top * scale),
    width: Math.round((rect.width / zoom) * scale),
    height: Math.round((rect.height / zoom) * scale)
  }
}

export interface CssRect {
  x: number
  y: number
  width: number
  height: number
}

function toRow(node: AxNode, rect: CssRect, frame: AxFrame): AxElementRow {
  const physical = cssRectToPhysical(rect, frame)
  return {
    name: stringValue(node.name),
    role: stringValue(node.role),
    automationId: readAutomationId(node),
    ...physical,
    enabled: readEnabled(node),
    centerX: physical.x + Math.round(physical.width / 2),
    centerY: physical.y + Math.round(physical.height / 2)
  }
}

function extractNodes(tree: unknown): AxNode[] {
  const holder = tree as { nodes?: unknown }
  if (!holder || !Array.isArray(holder.nodes)) return []
  return holder.nodes.filter((node): node is AxNode => Boolean(node) && typeof node === 'object')
}

/** 没有父节点引用的节点当根 —— `getFullAXTree` 不给父指针，只能靠 `childIds` 反推。 */
function buildRootSet(nodes: AxNode[]): Set<string> {
  const children = new Set<string>()
  for (const node of nodes) {
    for (const childId of node.childIds ?? []) {
      children.add(childId)
    }
  }
  const roots = new Set<string>()
  for (const node of nodes) {
    if (node.nodeId && !children.has(node.nodeId)) roots.add(node.nodeId)
  }
  return roots
}

/**
 * 按深度与过滤条件挑候选。
 *
 * 深度从根算：根的深度是 0。**`ignored` 节点要保留**——Chromium 常把容器标成 ignored
 * 而把真正的按钮挂在它下面，直接跳过会整片丢元素；只有它自己名字和 role 都空时才跳过。
 */
function selectCandidates(
  nodes: AxNode[],
  roots: Set<string>,
  maxDepth: number,
  options: AxQueryOptions
): AxNode[] {
  const byId = new Map<string, AxNode>()
  for (const node of nodes) {
    if (node.nodeId) byId.set(node.nodeId, node)
  }

  const depthOf = new Map<string, number>()
  const queue: Array<{ id: string; depth: number }> = []
  for (const rootId of roots) queue.push({ id: rootId, depth: 0 })
  // 没有根的极端情况（所有节点都有父）—— 从第一个节点兜底，别返回空列表。
  if (queue.length === 0 && nodes.length > 0 && nodes[0].nodeId) {
    queue.push({ id: nodes[0].nodeId!, depth: 0 })
  }

  while (queue.length > 0) {
    const current = queue.shift()!
    if (depthOf.has(current.id)) continue
    depthOf.set(current.id, current.depth)
    const node = byId.get(current.id)
    if (!node || current.depth >= maxDepth) continue
    for (const childId of node.childIds ?? []) {
      queue.push({ id: childId, depth: current.depth + 1 })
    }
  }

  const nameFilter = options.nameFilter?.trim().toLowerCase() ?? ''
  const roleFilter = new Set((options.roles ?? []).map((role) => role.toLowerCase()))

  return nodes.filter((node) => {
    if (!node.nodeId) return false
    const depth = depthOf.get(node.nodeId)
    if (depth === undefined || depth > maxDepth) return false
    const name = stringValue(node.name)
    const role = stringValue(node.role)
    if (!name && !role) return false
    if (nameFilter && !name.toLowerCase().includes(nameFilter)) return false
    if (roleFilter.size > 0 && !roleFilter.has(role.toLowerCase())) return false
    return true
  })
}

async function tryGetBoxModel(session: CdpSession, backendNodeId: number): Promise<CssRect | null> {
  try {
    const response = (await session.send('DOM.getBoxModel', { backendNodeId })) as BoxModelResponse
    const content = response?.model?.content
    if (!Array.isArray(content) || content.length < 8) return null
    const xs = [content[0], content[2], content[4], content[6]]
    const ys = [content[1], content[3], content[5], content[7]]
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const width = maxX - minX
    const height = maxY - minY
    if (!(width > 0) || !(height > 0)) return null
    return { x: minX, y: minY, width, height }
  } catch {
    // 节点不可见 / 已从 DOM 摘掉 —— 正常现象，计入 missingRects 而不是让整棵树失败。
    return null
  }
}

function stringValue(field: { value?: string } | undefined): string {
  return typeof field?.value === 'string' ? field.value : ''
}

function readEnabled(node: AxNode): boolean {
  for (const property of node.properties ?? []) {
    if (property.name === 'disabled') {
      return property.value?.value !== true
    }
  }
  return true
}

function readAutomationId(node: AxNode): string | undefined {
  for (const property of node.properties ?? []) {
    if (property.name === 'automationId' && typeof property.value?.value === 'string') {
      return property.value.value
    }
  }
  return undefined
}

function describeFrame(frame: AxFrame): string {
  const scale = frame.scaleFactor > 0 ? frame.scaleFactor : 1
  const zoom = frame.zoomFactor > 0 ? frame.zoomFactor : 1
  return (
    `Rectangles are screen physical pixels (same frame as DesktopClick). ` +
    `Viewport origin on screen: (${Math.round(frame.originX)}, ${Math.round(frame.originY)}) DIP, ` +
    `display scale ${scale}, page zoom ${zoom}. ` +
    `Only this app's own window is covered; other applications are not reachable this way — ` +
    `use DesktopListWindows and relative coordinates for those.`
  )
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  let previous = new Array<number>(cols)
  let current = new Array<number>(cols)
  for (let col = 0; col < cols; col += 1) previous[col] = col
  for (let row = 1; row < rows; row += 1) {
    current[0] = row
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1
      current[col] = Math.min(
        previous[col] + 1,
        current[col - 1] + 1,
        previous[col - 1] + cost
      )
    }
    const swap = previous
    previous = current
    current = swap
  }
  return previous[cols - 1]
}
