/**
 * Plain-text projection of a raw PTY byte stream.
 *
 * The terminal session manager keeps exactly what the pty wrote — colours, cursor moves, `\r`
 * overwrites — because xterm needs all of it to repaint a screen. A model does not: escape sequences
 * are pure noise that burns context and reads as garbage. This module is the single place that turns
 * one into the other, so there is exactly one set of stripping rules to reason about (and to test).
 *
 * Takes the chunk shape structurally (anything with a `data` string) rather than importing the
 * session record type: the only thing this module knows about a chunk is that it carries text.
 *
 * No Electron imports on purpose — the regression test imports it directly.
 */

/** How much trailing text a tool call may carry back to the model. Mirrors Bash's output cap. */
export const TERMINAL_TEXT_MAX_CHARS = 12_000

/**
 * Two families, matching what a shell prompt and a progress bar actually emit:
 *
 * - OSC (`ESC ] …` terminated by BEL, `ESC \` or 0x9C) — window titles, which are pure metadata.
 *   The payload is matched lazily rather than by a character class, because a title contains spaces.
 * - CSI (`ESC [ … final`) — colours, cursor moves, erase-line, and the private `ESC [ ? 25 l` form.
 *
 * Anything exotic that survives is still harmless text, whereas an over-eager pattern could eat real
 * output — so this errs towards leaving bytes alone.
 */
const ST = '(?:\\u0007|\\u001B\\u005C|\\u009C)'
const OSC = `\\u001B\\][\\s\\S]*?${ST}`
const CSI = '[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]'
const ANSI_PATTERN = new RegExp(`${OSC}|${CSI}`, 'g')

/** Drops every escape sequence, leaving the printable characters the terminal showed. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/**
 * Collapses `\r` the way a terminal does: within a line, only the text after the last carriage
 * return is what stayed on screen — that is how progress bars and spinners redraw.
 *
 * A trailing `\r` is dropped rather than honoured as an overwrite-to-nothing, because on a `\r\n`
 * line ending it is just the carriage return of the pair, and the line's text survived.
 */
export function collapseCarriageReturns(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
      const index = trimmed.lastIndexOf('\r')
      return index === -1 ? trimmed : trimmed.slice(index + 1)
    })
    .join('\n')
}

/** Raw pty bytes → what the user would have read on screen. */
export function toPlainText(raw: string): string {
  return collapseCarriageReturns(stripAnsi(raw))
}

/**
 * Keeps the tail, not the head: for a long-running process the interesting part is always the end.
 * The marker is included in the returned string so the model can tell it is looking at a window.
 */
export function tailText(text: string, maxChars: number = TERMINAL_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) return text
  return `[... ${text.length - maxChars} earlier characters trimmed]\n${text.slice(-maxChars)}`
}

/**
 * The whole buffer as one bounded plain-text block. Trimming happens after joining rather than per
 * chunk, because a single logical line can be split across many chunks.
 */
export function renderTerminalBuffer(
  chunks: readonly { data: string }[],
  maxChars: number = TERMINAL_TEXT_MAX_CHARS
): string {
  return tailText(
    toPlainText(chunks.map((chunk) => chunk.data).join('')),
    maxChars
  )
}
