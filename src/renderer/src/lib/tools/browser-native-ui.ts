import type { ImageBlock, ToolResultContent } from '@renderer/lib/api/types'
import { getBrowserAccessDecision, normalizeBrowserUrl } from '../app-plugin/browser-access'
import { describeWebviewOperationError } from '../browser/webview-helpers'
import { IPC } from '../ipc/channels'
import { ipcClient } from '../ipc/ipc-client'
import { useUIStore } from '../../stores/ui-store'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import { executeBrowserSearch, WEB_SEARCH_TOOL_NAME } from './browser-search'
import type { ToolContext } from './tool-types'
import {
  HTML_TO_MD_SCRIPT,
  SNAPSHOT_SCRIPT,
  CLICK_SCRIPT,
  TYPE_SCRIPT
} from './browser-scripts'
import {
  type NativeImageLike,
  ensureAttachedWebview,
  requireWebview,
  runWebviewCommand,
  waitForLoad,
  waitForWebview,
  parseWebviewJson,
  extractBase64ImageData
} from './browser-webview-helpers'

type NativeBrowserToolResponse = {
  content: ToolResultContent
  isError?: boolean
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function createToolContext(record: Record<string, unknown>): ToolContext {
  return {
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : undefined,
    workingFolder: typeof record.workingFolder === 'string' ? record.workingFolder : undefined,
    currentToolUseId: typeof record.toolUseId === 'string' ? record.toolUseId : undefined,
    agentRunId:
      typeof record.agentRunId === 'string'
        ? record.agentRunId
        : typeof record.runId === 'string'
          ? record.runId
          : undefined,
    signal: new AbortController().signal,
    ipc: ipcClient
  }
}

/** Check URL access rules; throw if blocked. */
function assertBrowserAccess(url: string): void {
  const decision = getBrowserAccessDecision(url)
  if (!decision.allowed) {
    throw new Error(decision.reason ?? 'Browser navigation blocked.')
  }
}

/** Check current page URL access rules; throw if blocked. */
function assertCurrentBrowserAccess(ctx?: ToolContext): void {
  const url = useUIStore.getState().getBrowserState(ctx?.sessionId).url
  if (url) assertBrowserAccess(url)
}

// ── Tool executors ──
//
// Convention: all execute* functions throw on error (never return encodeToolError).
// handleNativeBrowserToolRequest's catch block converts thrown errors into
// { content, isError: true, error } so the Worker can emit tool_call_result
// with status "error" and the agent loop continues.

async function executeBrowserNavigate(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  const action = (input.action as string) || 'goto'

  if (action === 'goto') {
    let url = input.url as string
    if (!url || typeof url !== 'string') throw new Error('"url" is required for goto')
    url = normalizeBrowserUrl(url)
    assertBrowserAccess(url)
    // Reveal the browser panel so the user can see the page being loaded.
    useUIStore.getState().openBrowserTab(url, ctx.sessionId)
    // Wait for the webview element to mount and register its ref.
    const webview = await waitForWebview(ctx, 10000)
    if (!webview) {
      throw new Error('Browser panel did not attach in time. Ensure the browser plugin is enabled.')
    }
    // Explicitly set src in case BrowserPanel's committedUrl hasn't updated yet.
    const loadPromise = waitForLoad(webview)
    await runWebviewCommand(webview, 'navigate', (target) => {
      target.src = url
    })
    await loadPromise
    const browserState = useUIStore.getState().getBrowserState(ctx.sessionId)
    return encodeStructuredToolResult({
      success: true,
      url,
      title: browserState.pageTitle
    })
  }

  if (action !== 'back' && action !== 'forward' && action !== 'refresh') {
    throw new Error(`Unknown action "${action}". Use goto, back, forward, or refresh.`)
  }

  const webview = requireWebview(ctx)
  if (action === 'back') {
    const canGoBack = await runWebviewCommand(webview, 'read back navigation state', (target) =>
      target.canGoBack()
    )
    if (!canGoBack) throw new Error('Browser cannot go back.')
  } else if (action === 'forward') {
    const canGoForward = await runWebviewCommand(
      webview,
      'read forward navigation state',
      (target) => target.canGoForward()
    )
    if (!canGoForward) throw new Error('Browser cannot go forward.')
  } else {
    assertCurrentBrowserAccess(ctx)
  }

  const loadPromise = waitForLoad(webview)
  if (action === 'back') {
    await runWebviewCommand(webview, 'go back', (target) => target.goBack())
  } else if (action === 'forward') {
    await runWebviewCommand(webview, 'go forward', (target) => target.goForward())
  } else {
    await runWebviewCommand(webview, 'refresh', (target) => target.reload())
  }
  await loadPromise
  const browserState = useUIStore.getState().getBrowserState(ctx.sessionId)
  return encodeStructuredToolResult({
    success: true,
    url: browserState.url,
    title: browserState.pageTitle
  })
}

async function executeBrowserGetContent(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const selector = (input.selector as string) || ''
  const outputType = (input.type as string) || 'markdown'

  if (outputType === 'html') {
    const raw = await runWebviewCommand(webview, 'read page HTML', (target) =>
      target.executeJavaScript(
        `(function(sel) {
          var root = sel ? document.querySelector(sel) : document.body
          if (!root) return JSON.stringify({ error: 'Element not found: ' + sel })
          return JSON.stringify({ title: document.title, content: root.innerHTML })
        })(${selector ? JSON.stringify(selector) : 'null'})`
      )
    )
    const parsed = parseWebviewJson<{ error?: string; title?: string; content?: string }>(raw)
    if (parsed.error) throw new Error(parsed.error)
    const content = (parsed.content ?? '').slice(0, 80000)
    return encodeStructuredToolResult({
      url: useUIStore.getState().getBrowserState(ctx.sessionId).url,
      title: parsed.title,
      type: 'html',
      content
    })
  }

  const raw = await runWebviewCommand(webview, 'read page Markdown', (target) =>
    target.executeJavaScript(
      `${HTML_TO_MD_SCRIPT}(${selector ? JSON.stringify(selector) : 'null'})`
    )
  )
  const parsed = parseWebviewJson<{ error?: string; title?: string; content?: string }>(raw)
  if (parsed.error) throw new Error(parsed.error)
  const content = (parsed.content ?? '').slice(0, 80000)
  return encodeStructuredToolResult({
    url: useUIStore.getState().getBrowserState(ctx.sessionId).url,
    title: parsed.title,
    type: 'markdown',
    content
  })
}

async function executeBrowserScreenshot(
  _input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const nativeImage = await runWebviewCommand<NativeImageLike>(webview, 'capture screenshot', (target) =>
    (target as unknown as { capturePage: () => NativeImageLike }).capturePage()
  )
  if (nativeImage.isEmpty()) {
    throw new Error('Failed to capture screenshot; page may still be loading.')
  }
  const encodedImage = extractBase64ImageData(nativeImage.toDataURL())
  if (!encodedImage?.data) {
    throw new Error('Failed to encode screenshot image.')
  }
  const size = nativeImage.getSize()
  const persisted = (await ctx.ipc.invoke(IPC.IMAGE_PERSIST_GENERATED, {
    data: encodedImage.data,
    mediaType: encodedImage.mediaType
  })) as { filePath?: string; mediaType?: string; data?: string; error?: string }
  const image: ImageBlock = {
    type: 'image',
    source: {
      type: 'base64',
      mediaType: persisted?.mediaType || encodedImage.mediaType,
      data: persisted?.data || encodedImage.data,
      ...(persisted?.filePath ? { filePath: persisted.filePath } : {})
    }
  }
  return [
    image,
    {
      type: 'text',
      text: `Screenshot captured: ${size.width}x${size.height}px - ${useUIStore.getState().getBrowserState(ctx.sessionId).url}`
    }
  ]
}

async function executeBrowserSnapshot(
  _input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const raw = await runWebviewCommand(webview, 'read interactive elements', (target) =>
    target.executeJavaScript(SNAPSHOT_SCRIPT)
  )
  const parsed = parseWebviewJson<{
    title?: string
    count?: number
    elements?: Array<{ selector: string; description: string }>
  }>(raw)
  const elements = parsed.elements ?? []
  const lines = elements
    .map((item, index) => `[${index}] ${item.description}\n    selector: ${item.selector}`)
    .join('\n')
  return encodeStructuredToolResult({
    url: useUIStore.getState().getBrowserState(ctx.sessionId).url,
    title: parsed.title,
    elementCount: parsed.count ?? elements.length,
    elements: lines
  })
}

async function executeBrowserClick(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const selector = input.selector as string
  if (!selector) throw new Error('"selector" is required')
  const raw = await runWebviewCommand(webview, 'click page element', (target) =>
    target.executeJavaScript(`${CLICK_SCRIPT}(${JSON.stringify(selector)})`)
  )
  const parsed = parseWebviewJson<{ error?: string; tag?: string; text?: string }>(raw)
  if (parsed.error) throw new Error(parsed.error)
  await new Promise((resolve) => setTimeout(resolve, 300))
  return encodeStructuredToolResult({
    success: true,
    clicked: `<${parsed.tag}> "${parsed.text}"`
  })
}

async function executeBrowserType(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const selector = input.selector as string
  const text = input.text as string
  const clear = input.clear !== false
  const submit = input.submit === true
  if (!selector) throw new Error('"selector" is required')
  if (text == null) throw new Error('"text" is required')
  const raw = await runWebviewCommand(webview, 'type into page element', (target) =>
    target.executeJavaScript(
      `${TYPE_SCRIPT}(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${clear}, ${submit})`
    )
  )
  const parsed = parseWebviewJson<{ error?: string; tag?: string; value?: string }>(raw)
  if (parsed.error) throw new Error(parsed.error)
  return encodeStructuredToolResult({
    success: true,
    element: parsed.tag,
    value: parsed.value
  })
}

async function executeBrowserScroll(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const direction = (input.direction as string) || 'down'
  const amount = typeof input.amount === 'number' ? input.amount : 0
  const raw = await runWebviewCommand(webview, 'scroll page', (target) =>
    target.executeJavaScript(`
      (function() {
        var amt = ${amount} || window.innerHeight
        window.scrollBy(0, ${direction === 'up' ? '-' : ''}amt)
        return JSON.stringify({
          scrollY: Math.round(window.scrollY),
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight
        })
      })()
    `)
  )
  const parsed = parseWebviewJson<{
    scrollY?: number
    scrollHeight?: number
    viewportHeight?: number
  }>(raw)
  return encodeStructuredToolResult({
    success: true,
    scrollY: parsed.scrollY,
    scrollHeight: parsed.scrollHeight,
    viewportHeight: parsed.viewportHeight
  })
}

async function executeBrowserEvaluate(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  assertCurrentBrowserAccess(ctx)
  const webview = await ensureAttachedWebview(ctx)
  const code = input.code
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('"code" is required and must be a non-empty string')
  }

  // User code is inserted verbatim so it runs as real JavaScript in the page.
  // It is wrapped in an async IIFE (so `await` and top-level `return` both work)
  // and the resolved value is JSON-serialized with a string fallback for
  // non-serializable results (DOM nodes, functions, circular refs).
  const script = `
    (function() {
      function __serialize(v) {
        if (v === undefined) return { type: 'undefined', value: null }
        try { return { type: typeof v, value: JSON.parse(JSON.stringify(v)) } }
        catch (e) { return { type: typeof v, value: String(v) } }
      }
      return Promise.resolve()
        .then(function() { return (async function() {\n${code}\n})() })
        .then(function(r) { return JSON.stringify({ success: true, result: __serialize(r) }) })
        .catch(function(e) {
          return JSON.stringify({
            error: (e && e.message) ? String(e.message) : String(e),
            stack: (e && e.stack) ? String(e.stack) : ''
          })
        })
    })()
  `

  const raw = await runWebviewCommand(webview, 'evaluate JavaScript', (target) =>
    target.executeJavaScript(script)
  )
  const parsed = parseWebviewJson<{
    success?: boolean
    result?: { type?: string; value?: unknown }
    error?: string
    stack?: string
  }>(raw)
  if (parsed.error) {
    throw new Error(parsed.stack ? `${parsed.error}\n${parsed.stack}` : parsed.error)
  }
  return encodeStructuredToolResult({
    success: true,
    url: useUIStore.getState().getBrowserState(ctx.sessionId).url,
    resultType: parsed.result?.type,
    result: parsed.result?.value
  })
}

// ── Dispatch + entry point ──

async function runBrowserTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  switch (toolName) {
    case 'BrowserNavigate':
      return await executeBrowserNavigate(input, ctx)
    case 'BrowserGetContent':
      return await executeBrowserGetContent(input, ctx)
    case 'BrowserScreenshot':
      return await executeBrowserScreenshot(input, ctx)
    case 'BrowserSnapshot':
      return await executeBrowserSnapshot(input, ctx)
    case 'BrowserClick':
      return await executeBrowserClick(input, ctx)
    case 'BrowserType':
      return await executeBrowserType(input, ctx)
    case 'BrowserScroll':
      return await executeBrowserScroll(input, ctx)
    case 'BrowserEvaluate':
      return await executeBrowserEvaluate(input, ctx)
    case WEB_SEARCH_TOOL_NAME:
      return await executeBrowserSearch(input, ctx)
    default:
      throw new Error(`Unsupported browser tool: ${toolName}`)
  }
}

export async function handleNativeBrowserToolRequest(
  params: unknown
): Promise<NativeBrowserToolResponse> {
  const record = normalizeRecord(params)
  const toolName = typeof record.toolName === 'string' ? record.toolName : ''
  const input = normalizeRecord(record.input)
  const ctx = createToolContext(record)

  try {
    return {
      content: await runBrowserTool(toolName, input, ctx),
      isError: false
    }
  } catch (error) {
    const message = describeWebviewOperationError(
      toolName ? `run ${toolName}` : 'run browser tool',
      error
    )
    return {
      content: encodeToolError(message),
      isError: true,
      error: message
    }
  }
}
