/**
 * Startup flags that decide whether the main window is shown on boot.
 *
 * Deliberately free of Electron imports: the regression suite bundles this file
 * with esbuild and runs it under plain node (`tests/startup-flags`, registered
 * as `test:startup-flags`), and the repo's `test:*` scripts pass no
 * `--external:electron`. Any module-scope Electron access throws at import
 * time, so the pure predicate lives alone here while the Electron-touching half
 * lives in `main-window-visibility.ts`.
 */

/**
 * Switch handed to the app by the OS login item when it should start hidden.
 *
 * Written into the login item by `ipc/window-handlers.ts` and read back here —
 * a single literal, so the writer and the reader can never drift apart.
 */
export const HIDDEN_FLAG = '--hidden'

/**
 * True when the main window should be shown on startup.
 *
 * The flag arrives via `process.argv`, which Electron also fills with its own
 * switches (`--inspect`, `--remote-debugging-port=…`, …). The comparison is
 * therefore an exact, case-sensitive match on the whole argument rather than a
 * prefix scan, so an unrelated switch can never be mistaken for ours.
 */
export function shouldShowOnStartup(argv: readonly string[]): boolean {
  return !argv.includes(HIDDEN_FLAG)
}
