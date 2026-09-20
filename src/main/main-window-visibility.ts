import { app, Notification } from 'electron'
import { getMainWindow } from './main-window-registry'
import { forceActivateWindow } from './priority-shortcuts'

/**
 * Show / hide / toggle for the main window.
 *
 * Split out of `index.ts` (already past the 500-line limit, no exemption) and
 * kept separate from `startup-flags.ts`, which must stay importable under plain
 * node: this file touches Electron at module scope (`app`, `Notification`) and
 * `priority-shortcuts.ts` runs `app.on('will-quit', …)` at module scope, so
 * pulling either into a pure-node test would throw on import.
 */

/**
 * Bring the main window back: restore, show, then fight for the foreground.
 *
 * `show()` has to come first. The PowerShell bridge's `activate-self` only
 * handles `IsIconic` (minimized) targets, so for a `hide()`-n window
 * `BringWindowToTop` / `SetForegroundWindow` are no-ops — a hidden window is not
 * in the Z-order at all.
 *
 * `forceActivateWindow` then resolves the Windows foreground lock (another
 * process owning the foreground), which a plain `focus()` loses.
 */
export function showMainWindow(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  if (!forceActivateWindow(win)) win.focus()
}

/** Hide the main window to the tray. */
export function hideMainWindow(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.hide()
}

/**
 * Set when a reveal request arrives before the main window exists.
 *
 * On a quiet start the window is created hidden, so the second instance's
 * request is the user's only way to say "show me" — and at that moment there is
 * no window to show. Dropping it leaves a double-click on the desktop icon
 * doing visibly nothing.
 */
let pendingReveal = false

/** Reveal the main window, or remember the request if it is not built yet. */
export function revealMainWindowOrDefer(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) {
    pendingReveal = true
    return
  }
  showMainWindow()
}

/** Redeem a deferred reveal. Called once the main window has been registered. */
export function flushPendingReveal(): void {
  if (!pendingReveal) return
  pendingReveal = false
  showMainWindow()
}

/**
 * Toggle the main window between visible and hidden.
 *
 * A minimized window still reports `isVisible() === true`, so visibility alone
 * would make the first press *hide* a window the user cannot see. The minimized
 * case is routed to `showMainWindow()` (restore + foreground) instead of being
 * read as "already visible".
 */
export function toggleMainWindow(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  if (win.isVisible() && !win.isMinimized()) {
    hideMainWindow()
    return
  }
  showMainWindow()
}

/**
 * Tell the user the app is running in the tray.
 *
 * Needed on a hidden start: Windows folds tray icons behind the `^` overflow,
 * so without this a `--hidden` launch looks identical to "nothing happened".
 * Only ever called on a hidden start — a normal launch shows the window.
 *
 * The copy is hard-coded Chinese rather than routed through the renderer: the
 * main process has no i18n facility of its own (see `quick-launcher.ts`), and
 * asking the renderer would require a brand-new "this was a hidden start"
 * channel that no other feature needs.
 */
export function notifyHiddenStartup(): void {
  if (!Notification.isSupported()) return
  new Notification({
    title: app.getName(),
    body: '已在后台启动，点击托盘图标可打开主窗口。'
  }).show()
}
