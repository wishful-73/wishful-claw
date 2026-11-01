/*
 * 自家窗口元素树（v3-iter-4 S-273 段 A）。
 *
 * 存在理由：这条链路里最贵的错误不是「找不到元素」，而是**`Accessibility.enable` 开了没关** ——
 * Chromium 会为那个渲染进程一直维护完整 a11y 树，正是 v3-iter-4 刚压下去的内存问题。
 * 而这种泄漏在功能上完全看不出来，只能靠回归钉死。
 *
 * `lib/ax-elements.ts` 刻意不 import electron，CDP 会话是注入的 ⇒ 这里能塞假 session，
 * 断言调用顺序，包括**异常路径**。
 */

import assert from 'node:assert/strict'
import {
  collectAxElements,
  cssRectToPhysical,
  pickClosestNames,
  type AxFrame,
  type CdpSession
} from '../../src/main/lib/ax-elements'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

function equal<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.deepEqual(actual, expected, description)
}

/** 假 CDP 会话：记录每次调用，按需抛错。 */
class FakeSession implements CdpSession {
  readonly calls: string[] = []
  readonly boxRequests: number[] = []

  constructor(
    private readonly tree: unknown,
    private readonly options: {
      failOn?: string
      disableThrows?: boolean
      boxes?: Map<number, number[]>
    } = {}
  ) {}

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(method)
    if (this.options.failOn === method) {
      throw new Error(`boom:${method}`)
    }
    if (method === 'Accessibility.getFullAXTree') {
      return this.tree
    }
    if (method === 'DOM.getBoxModel') {
      const id = Number(params?.backendNodeId)
      this.boxRequests.push(id)
      const quad = this.options.boxes?.get(id)
      if (!quad) throw new Error('node has no box')
      return { model: { content: quad } }
    }
    if (method === 'Accessibility.disable' && this.options.disableThrows) {
      throw new Error('disable failed')
    }
    return {}
  }

  count(method: string): number {
    return this.calls.filter((call) => call === method).length
  }

  indexOf(method: string): number {
    return this.calls.indexOf(method)
  }
}

/** 一棵最小可访问性树：根 → 容器(ignored) → 按钮 / 输入框。 */
function makeTree(): unknown {
  return {
    nodes: [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: '心相' }, childIds: ['2'] },
      {
        nodeId: '2',
        role: { value: 'generic' },
        name: { value: '' },
        childIds: ['3', '4']
      },
      {
        nodeId: '3',
        role: { value: 'button' },
        name: { value: '发送' },
        backendDOMNodeId: 30,
        childIds: []
      },
      {
        nodeId: '4',
        role: { value: 'textbox' },
        name: { value: '输入框' },
        backendDOMNodeId: 40,
        properties: [{ name: 'disabled', value: { value: true } }],
        childIds: []
      }
    ]
  }
}

const boxes = new Map<number, number[]>([
  // content quad 顺序：x1,y1, x2,y2, x3,y3, x4,y4（CSS 像素，相对视口）
  [30, [100, 200, 180, 200, 180, 240, 100, 240]],
  [40, [20, 600, 320, 600, 320, 640, 20, 640]]
])

const frame: AxFrame = {
  originX: 40,
  originY: 60,
  scaleFactor: 1.5,
  zoomFactor: 1
}

// ── 1. enable / disable 成对（正常路径）──────────────────────────────

async function normalPath(): Promise<void> {
  const session = new FakeSession(makeTree(), { boxes })
  const result = await collectAxElements(session, frame, {})

  check(session.count('Accessibility.enable') === 1, 'enable 恰好调用一次')
  check(session.count('Accessibility.disable') === 1, 'disable 恰好调用一次（正常路径）')
  check(
    session.indexOf('Accessibility.enable') < session.indexOf('Accessibility.getFullAXTree'),
    'enable 必须在取树之前'
  )
  check(
    session.indexOf('Accessibility.getFullAXTree') < session.indexOf('Accessibility.disable'),
    'disable 必须在取树之后'
  )

  equal(result.totalNodes, 4, '总节点数按树里实际条数报')
  equal(result.elements.map((element) => element.name), ['发送', '输入框'], '两个可交互元素都被列出')

  // 矩形换算：CSS(100,200) → 屏幕 (40 + 100) × 1.5 = 210, (60 + 200) × 1.5 = 390
  const send = result.elements[0]
  equal(send.x, 210, '按钮左上角 x 按视口原点 + 缩放换算')
  equal(send.y, 390, '按钮左上角 y 按视口原点 + 缩放换算')
  equal(send.width, 120, '宽度按缩放换算（80 CSS × 1.5）')
  equal(send.height, 60, '高度按缩放换算（40 CSS × 1.5）')
  equal(send.centerX, 270, '中心点 x 可直接喂给 DesktopClick')
  equal(send.centerY, 420, '中心点 y 可直接喂给 DesktopClick')
  check(send.enabled, '没标 disabled 的元素视为可用')

  const input = result.elements[1]
  check(!input.enabled, '标了 disabled 的元素必须如实报不可用')

  check(result.frameNote.includes('physical pixels'), '报文说明坐标系是物理像素')
  check(result.frameNote.includes('DesktopListWindows'), '报文把第三方应用引回 DesktopListWindows')
  equal(result.missingRects, 0, '所有元素都拿到了矩形')
}

// ── 2. 异常路径：取树失败，disable 仍然被调用 ────────────────────────

async function failingTree(): Promise<void> {
  const session = new FakeSession(makeTree(), { failOn: 'Accessibility.getFullAXTree', boxes })
  let threw = false
  try {
    await collectAxElements(session, frame, {})
  } catch {
    threw = true
  }
  check(threw, '取树失败必须向上抛，不能吞成空列表')
  check(session.count('Accessibility.disable') === 1, '异常路径下 disable 仍被调用（这是本条的核心）')
}

// ── 3. disable 自己失败不许掩盖原始异常 ─────────────────────────────

async function disableFails(): Promise<void> {
  const session = new FakeSession(makeTree(), { failOn: 'Accessibility.getFullAXTree', disableThrows: true })
  let message = ''
  try {
    await collectAxElements(session, frame, {})
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  equal(message, 'boom:Accessibility.getFullAXTree', '原始异常优先，disable 的失败不覆盖它')

  // 正常路径下 disable 失败也不该让结果丢掉
  const ok = new FakeSession(makeTree(), { boxes, disableThrows: true })
  const result = await collectAxElements(ok, frame, {})
  equal(result.elements.length, 2, 'disable 失败不影响已经拿到的元素')
}

// ── 4. 过滤与上限 ───────────────────────────────────────────────────

async function filters(): Promise<void> {
  const byName = await collectAxElements(new FakeSession(makeTree(), { boxes }), frame, {
    nameFilter: '发'
  })
  equal(byName.elements.map((element) => element.name), ['发送'], 'nameFilter 只留命中的名字')

  const byRole = await collectAxElements(new FakeSession(makeTree(), { boxes }), frame, {
    roles: ['textbox']
  })
  equal(byRole.elements.map((element) => element.name), ['输入框'], 'roles 过滤按 role 生效')

  const limited = await collectAxElements(new FakeSession(makeTree(), { boxes }), frame, {
    maxElements: 1
  })
  equal(limited.elements.length, 1, 'maxElements 生效')

  // 深度 0 = 只有根；根没有 backendDOMNodeId，不是可点元素 ⇒ 列表为空
  const shallow = await collectAxElements(new FakeSession(makeTree(), { boxes }), frame, {
    maxDepth: 0
  })
  equal(shallow.elements.length, 0, 'maxDepth 从根算，深度 0 只剩根而根不可点')
}

// ── 5. ignored 容器不能把子元素整片带走 ─────────────────────────────

async function ignoredContainer(): Promise<void> {
  const tree = {
    nodes: [
      { nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'root' }, childIds: ['2'] },
      {
        nodeId: '2',
        ignored: true,
        role: { value: 'generic' },
        name: { value: '' },
        childIds: ['3']
      },
      { nodeId: '3', role: { value: 'button' }, name: { value: '确定' }, backendDOMNodeId: 33 }
    ]
  }
  const session = new FakeSession(tree, { boxes: new Map([[33, [0, 0, 10, 0, 10, 10, 0, 10]]]) })
  const result = await collectAxElements(session, frame, {})
  check(
    result.elements.some((element) => element.name === '确定'),
    'ignored 容器下面的按钮仍然找得到（Chromium 常这么挂）'
  )
}

// ── 6. 拿不到矩形的节点计入 missingRects，不让整棵树失败 ────────────

async function missingRect(): Promise<void> {
  const session = new FakeSession(makeTree(), { boxes: new Map([[30, [0, 0, 10, 0, 10, 10, 0, 10]]]) })
  const result = await collectAxElements(session, frame, {})
  equal(result.elements.length, 1, '只有拿到矩形的元素进列表')
  equal(result.missingRects, 1, '拿不到矩形的节点计数上报，不吞掉')
}

// ── 7. 坐标换算的边界（zoomFactor / 缺省值）─────────────────────────

function coordinateMath(): void {
  const physical = cssRectToPhysical(
    { x: 0, y: 0, width: 100, height: 50 },
    { originX: 0, originY: 0, scaleFactor: 2, zoomFactor: 1 }
  )
  equal(physical, { x: 0, y: 0, width: 200, height: 100 }, 'scaleFactor 2 时 CSS 尺寸翻倍')

  const zoomed = cssRectToPhysical(
    { x: 100, y: 100, width: 100, height: 100 },
    { originX: 10, originY: 20, scaleFactor: 1, zoomFactor: 2 }
  )
  equal(zoomed, { x: 60, y: 70, width: 50, height: 50 }, '页面缩放 2 时 CSS 像素减半再换算')

  const fallback = cssRectToPhysical(
    { x: 0, y: 0, width: 10, height: 10 },
    { originX: 0, originY: 0, scaleFactor: 0, zoomFactor: 0 }
  )
  equal(fallback, { x: 0, y: 0, width: 10, height: 10 }, 'scaleFactor/zoomFactor 为 0 时退化成 1，不除零')
}

// ── 8. 找不到时的候选名 ─────────────────────────────────────────────

function candidates(): void {
  const names = ['发送', '输入框', '设置', '新建会话']
  equal(pickClosestNames('发松', names, 2).length, 2, '候选数量按 limit 截断')
  equal(pickClosestNames('发送', names, 1), ['发送'], '完全命中时排第一')

  const english = ['Send', 'Settings', 'Save']
  equal(pickClosestNames('setings', english, 1), ['Settings'], '英文近似名能挑出来（编辑距离）')
  equal(pickClosestNames('', english, 2), ['Send', 'Settings'], '空关键字退回原顺序前 N 个')
}

async function main(): Promise<void> {
  await normalPath()
  await failingTree()
  await disableFails()
  await filters()
  await ignoredContainer()
  await missingRect()
  coordinateMath()
  candidates()

  console.log(`desktop-ax-elements: ${checks} passed`)
}

main().catch((error) => {
  console.error('desktop-ax-elements FAILED:', error)
  process.exit(1)
})
