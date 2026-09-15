/**
 * Tool names that were persisted under an older name.
 *
 * Tool names live in the durable conversation: `messages.meta` stores
 * `{ thinking, toolCalls, isStreaming, error }` and each entry in `toolCalls`
 * carries a `name` (`chat-store/db-helpers.ts`). Display code therefore has to
 * normalize through here, otherwise a renamed tool makes every historical call
 * fall back to the "unknown tool" card.
 */
const TOOL_NAME_ALIASES: Record<string, string> = {
  // iter-29 (S-23): the multi-engine scraper was registered as `BrowserSearch`,
  // which read like a browser automation tool. It is a web search.
  BrowserSearch: 'WebSearch'
}

/** Map a historical tool name onto its current name. */
export function normalizeToolName(name: string | null | undefined): string {
  if (!name) return ''
  return TOOL_NAME_ALIASES[name] ?? name
}
