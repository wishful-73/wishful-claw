import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'

// ── Types ──

interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive' | 'warning'
  onConfirm?: () => void | Promise<void>
  sessionId?: string
  imageEdit?: unknown
  status?: string
  /** Ordering key for concurrent dialogs (e.g. tool startedAt ms). Lower shows first. */
  sequence?: number
  [key: string]: unknown
}

type ResolveCallback = (confirmed: boolean) => void

// ── Internal state (module-level singleton) ──

let _setDialog: React.Dispatch<React.SetStateAction<DialogState | null>> | null = null

// Concurrent confirm() calls queue up: the singleton dialog can only show one
// at a time, and overwriting the state would leave earlier callers' promises
// unresolved forever (e.g. three parallel tool approvals → stuck "running" cards).
interface QueuedDialog {
  options: ConfirmOptions
  resolve: ResolveCallback
}
const _dialogQueue: QueuedDialog[] = []
let _dialogActive = false

interface DialogState {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant: 'default' | 'destructive'
  resolve: ResolveCallback
}

// ── Public imperative API ──

/**
 * Show a confirm dialog and return a promise that resolves to true/false.
 *
 * Usage:
 * ```ts
 * import { confirm } from '@renderer/components/ui/confirm-dialog'
 * if (await confirm({ title: 'Delete?', variant: 'destructive' })) { ... }
 * ```
 */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  const title = options.title ?? ''
  const description = options.description

  if (!_setDialog) {
    // Provider not mounted — fall back to the native dialog rather than
    // silently approving (the old stub returned true unconditionally).
    console.warn('[confirm] ConfirmDialogProvider is not mounted, falling back to window.confirm')
    const result = window.confirm(description ? `${title}\n${description}` : title)
    if (result) await options.onConfirm?.()
    return result
  }

  const approved = await new Promise<boolean>((resolve) => {
    // Insert by startedAt (ascending): concurrent tool approvals arrive via IPC
    // in nondeterministic order, but dialogs should follow the tool card order.
    const seq = typeof options.sequence === 'number' ? options.sequence : Number.MAX_SAFE_INTEGER
    const insertAt = _dialogQueue.findIndex(
      (entry) =>
        typeof entry.options.sequence === 'number' && entry.options.sequence > seq
    )
    if (insertAt === -1) {
      _dialogQueue.push({ options, resolve })
    } else {
      _dialogQueue.splice(insertAt, 0, { options, resolve })
    }
    pumpDialogQueue()
  })

  if (approved) await options.onConfirm?.()
  return approved
}

function pumpDialogQueue(): void {
  if (_dialogActive || !_setDialog) return
  const next = _dialogQueue.shift()
  if (!next) return
  _dialogActive = true
  const { title, description } = next.options
  _setDialog({
    title: title ?? '',
    description,
    confirmLabel: next.options.confirmLabel ?? next.options.confirmText,
    cancelLabel: next.options.cancelLabel ?? next.options.cancelText,
    // warning is rendered like the default variant — it is a caution, not
    // a destructive action.
    variant: next.options.variant === 'destructive' ? 'destructive' : 'default',
    resolve: (confirmed: boolean) => {
      _dialogActive = false
      _setDialog?.(null)
      next.resolve(confirmed)
      // Defer: the caller (handleConfirm/handleCancel) also calls setDialog(null)
      // after resolve() returns. Pumping synchronously would get wiped by that
      // trailing setDialog(null), leaving the next queued promise unresolved.
      setTimeout(pumpDialogQueue, 0)
    }
  })
}

// ── Provider component (mount once at app root) ──

export function ConfirmDialogProvider(): React.JSX.Element {
  const { t } = useTranslation('common')
  const [dialog, setDialog] = React.useState<DialogState | null>(null)

  React.useEffect(() => {
    _setDialog = setDialog
    return () => {
      _setDialog = null
    }
  }, [])

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open && dialog) {
        dialog.resolve(false)
        setDialog(null)
      }
    },
    [dialog]
  )

  const handleCancel = React.useCallback(() => {
    dialog?.resolve(false)
    setDialog(null)
  }, [dialog])

  const handleConfirm = React.useCallback(() => {
    dialog?.resolve(true)
    setDialog(null)
  }, [dialog])

  return (
    <AlertDialog open={!!dialog} onOpenChange={handleOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{dialog?.title}</AlertDialogTitle>
          {dialog?.description && (
            <AlertDialogDescription>{dialog.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm" onClick={handleCancel}>
            {dialog?.cancelLabel ?? t('action.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            size="sm"
            variant={dialog?.variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
          >
            {dialog?.confirmLabel ?? t('action.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
