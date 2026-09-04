import { Notification, ipcMain, type BrowserWindow } from 'electron'
import { getNativeWorker } from '../lib/native-worker'
import { safeSendMessagePackToWindow, safeSendMessagePackToAllWindows } from '../window-ipc'
import {
  SIDECAR_RENDERER_TOOL_REQUEST_MSGPACK_CHANNEL,
  SIDECAR_RENDERER_TOOL_RESPONSE_MSGPACK_CHANNEL,
  decodeMessagePackPayload,
  toMessagePackChannel
} from '../../shared/messagepack/binary-ipc'
import {
  captureDesktopScreenshot,
  desktopInputClick,
  desktopInputType,
  desktopInputScroll,
  DESKTOP_SCREENSHOT_CAPTURE,
  DESKTOP_INPUT_CLICK,
  DESKTOP_INPUT_TYPE,
  DESKTOP_INPUT_SCROLL
} from './desktop-control'
import { isMainProcessMethod, dispatchReverseRequest } from './reverse-handlers'
import { getMainWindow } from '../main-window-registry'
import { logWarn } from '../lib/logger'

const SIDECAR_RENDERER_REQUEST_TIMEOUT_MS = 30_000

// User-interaction methods genuinely wait for a human, but "no timeout" must
// not mean "forever": if the renderer crashes or the user walks away, the
// worker would otherwise hang on the reverse request indefinitely.
const USER_INTERACTION_TIMEOUT_MS = 30 * 60 * 1000

// Methods that wait for explicit user interaction — generous timeout.
const USER_INTERACTION_METHODS = new Set([
  'ask-user/request',
  'plan/review-request',
  'goal/confirm-request',
  'sub-agent:approve-tool'
])

type RendererToolRequest = {
  id?: number | string
  method?: string
  params?: unknown
}

type PendingRendererToolRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
  window?: BrowserWindow
  onWindowClosed?: () => void
}

const pendingRendererToolRequests = new Map<string, PendingRendererToolRequest>()

/** Remove a pending request and release its timer + window listener. */
function removePendingRendererToolRequest(requestId: string): PendingRendererToolRequest | undefined {
  const pending = pendingRendererToolRequests.get(requestId)
  if (!pending) return undefined
  pendingRendererToolRequests.delete(requestId)
  if (pending.timer) clearTimeout(pending.timer)
  if (pending.window && pending.onWindowClosed) {
    pending.window.removeListener('closed', pending.onWindowClosed)
  }
  return pending
}

/**
 * Routes reverse-request events from the native worker to the renderer.
 * The renderer executes browser tool calls and sends back the result via
 * the SIDECAR_RENDERER_TOOL_RESPONSE_MSGPACK_CHANNEL IPC channel.
 */
export function registerNativeAgentRuntimeHandlers(): void {
  const worker = getNativeWorker()

  // Listen for agent/reverse-request events from the worker
  worker.onEvent('agent/reverse-request', (params: unknown) => {
    void handleReverseRequest(params as RendererToolRequest)
  })

  // Listen for agent/reverse-cancel events from the worker
  worker.onEvent('agent/reverse-cancel', (params: unknown) => {
    const request = params as RendererToolRequest
    const id = request?.id
    if (typeof id !== 'number' && typeof id !== 'string') return
    const pending = removePendingRendererToolRequest(String(id))
    if (pending) {
      pending.reject(new Error('Reverse request cancelled by worker'))
    }
  })

  // Relay global agent Task Board change events (global tasks / dispatches
  // only — never session-internal Todos) so the board refreshes without polling.
  worker.onEvent('global/task-changed', (params: unknown) => {
    safeSendMessagePackToAllWindows('global:task-changed', params)
  })
  worker.onEvent('global/dispatch-changed', (params: unknown) => {
    safeSendMessagePackToAllWindows('global:dispatch-changed', params)
  })

  // Relay manual-compression summary deltas so the live compression card in the
  // renderer types out the draft while the worker's LLM call is still streaming.
  worker.onEvent('agent/compression-delta', (params: unknown) => {
    safeSendMessagePackToAllWindows('agent:compression-delta', params)
  })

  // Register IPC handler for renderer tool responses
  ipcMain.handle(
    toMessagePackChannel(SIDECAR_RENDERER_TOOL_RESPONSE_MSGPACK_CHANNEL),
    async (_event, bytes: Uint8Array) => {
      const payload = decodeMessagePackPayload<{
        requestId: string
        result?: unknown
        error?: string
      }>(bytes)
      return completeRendererToolResponse(payload)
    }
  )
}

async function handleReverseRequest(request: RendererToolRequest): Promise<void> {
  const id = request?.id
  const method = request?.method
  if ((typeof id !== 'number' && typeof id !== 'string') || typeof method !== 'string') {
    return
  }

  const targetWindow = getMainWindow()
  if (!targetWindow) {
    await sendReverseResponse(id, undefined, 'Main window not available')
    return
  }

  // Desktop control methods: handled directly in the main process
  const desktopMethods = new Set([
    DESKTOP_SCREENSHOT_CAPTURE,
    DESKTOP_INPUT_CLICK,
    DESKTOP_INPUT_TYPE,
    DESKTOP_INPUT_SCROLL
  ])

  if (desktopMethods.has(method)) {
    try {
      let result: unknown
      const params = request.params as Record<string, unknown> | undefined
      switch (method) {
        case DESKTOP_SCREENSHOT_CAPTURE:
          result = await captureDesktopScreenshot()
          break
        case DESKTOP_INPUT_CLICK:
          result = desktopInputClick(params as unknown as Parameters<typeof desktopInputClick>[0])
          break
        case DESKTOP_INPUT_TYPE:
          result = desktopInputType(params as unknown as Parameters<typeof desktopInputType>[0])
          break
        case DESKTOP_INPUT_SCROLL:
          result = desktopInputScroll(params as unknown as Parameters<typeof desktopInputScroll>[0])
          break
        default:
          result = { success: false, error: `Unknown desktop method: ${method}` }
      }
      await sendReverseResponse(id, result, undefined)
    } catch (error) {
      await sendReverseResponse(id, undefined, error instanceof Error ? error.message : String(error))
    }
    return
  }

  // Main process methods: dispatch to registered handlers
  if (isMainProcessMethod(method)) {
    try {
      // notify:desktop uses Electron's Notification API directly
      if (method === 'notify:desktop') {
        const params = request.params as Record<string, unknown> | undefined
        const title = (params?.title as string) ?? ''
        const body = (params?.body as string) ?? ''
        const type = (params?.type as string) ?? 'info'
        if (Notification.isSupported()) {
          const notification = new Notification({
            title,
            body,
            urgency: type === 'error' ? 'critical' : 'normal'
          })
          notification.show()
          await sendReverseResponse(id, { success: true, title, body }, undefined)
        } else {
          await sendReverseResponse(id, { success: false, error: 'Notifications not supported' }, undefined)
        }
        return
      }

      // All other main process methods: dispatch to handler modules
      const result = await dispatchReverseRequest(method, request.params)
      await sendReverseResponse(id, result, undefined)
    } catch (error) {
      await sendReverseResponse(id, undefined, error instanceof Error ? error.message : String(error))
    }
    return
  }

  // Methods that route to the renderer via the tool bridge
  const rendererMethods = new Set([
    'browser/tool-request',
    'ask-user/request',
    'plan/ui-update',
    'plan/review-request',
    'goal/confirm-request',
    'sub-agent:approve-tool',
    'mcp:capability-list',
    'mcp:capability-inspect',
    'skill-management:execute',
    'project/send-session-message'
  ])
  if (rendererMethods.has(method)) {
    const requestId = `sidecar-renderer-tool-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        // Every request gets a timeout; user-interaction methods just get a
        // much longer one so a crashed renderer can't leak the entry forever.
        const timeoutMs = USER_INTERACTION_METHODS.has(method)
          ? USER_INTERACTION_TIMEOUT_MS
          : SIDECAR_RENDERER_REQUEST_TIMEOUT_MS
        const timer = setTimeout(() => {
          removePendingRendererToolRequest(requestId)
          reject(new Error(`Renderer tool request timed out: ${method}`))
        }, timeoutMs)

        // If the target window goes away before answering (renderer crash,
        // user closed it), fail fast instead of waiting for the timeout.
        const onWindowClosed = (): void => {
          const pending = removePendingRendererToolRequest(requestId)
          if (pending) {
            pending.reject(new Error(`Renderer window closed before responding: ${method}`))
          }
        }
        targetWindow.once('closed', onWindowClosed)

        pendingRendererToolRequests.set(requestId, {
          resolve,
          reject,
          timer,
          window: targetWindow,
          onWindowClosed
        })

        const sent = safeSendMessagePackToWindow(
          targetWindow,
          SIDECAR_RENDERER_TOOL_REQUEST_MSGPACK_CHANNEL,
          {
            requestId,
            method,
            params: request.params
          }
        )

        if (!sent) {
          removePendingRendererToolRequest(requestId)
          reject(new Error(`Failed to deliver renderer tool request: ${method}`))
        }
      })

      await sendReverseResponse(id, result, undefined)
    } catch (error) {
      await sendReverseResponse(
        id,
        undefined,
        error instanceof Error ? error.message : String(error)
      )
    }
  } else {
    await sendReverseResponse(id, undefined, `Unsupported reverse request method: ${method}`)
  }
}

function completeRendererToolResponse(payload: {
  requestId: string
  result?: unknown
  error?: string
}): { ok: boolean } {
  const pending = removePendingRendererToolRequest(payload.requestId)
  if (!pending) return { ok: false }

  if (payload.error) {
    pending.reject(new Error(payload.error))
  } else {
    pending.resolve(payload.result)
  }
  return { ok: true }
}

async function sendReverseResponse(
  id: number | string,
  result: unknown,
  error: string | undefined
): Promise<void> {
  await getNativeWorker()
    .request(
      'agent/reverse-response',
      {
        id,
        ...(typeof error === 'string' ? { error } : { result })
      },
      30_000
    )
    .catch((sendError) => {
      logWarn(
        'main',
        `[NativeAgentRuntime] reverse response failed: ${
          sendError instanceof Error ? sendError.message : String(sendError)
        }`
      )
    })
}
