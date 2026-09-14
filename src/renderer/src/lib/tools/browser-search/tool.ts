import { toolRegistry } from '../../agent/tool-registry'
import type { ToolHandler } from '../tool-types'
import { executeBrowserSearch } from './search'
import {
  BUILTIN_ENGINES,
  BUILTIN_INTENT_CONFIG,
  INTENT_IDS,
  engineDisplayName,
  intentDisplayName
} from './engines'

/** The agent-facing tool name. Renamed from `BrowserSearch` in iter-29 (S-23):
 *  the old name was misleading — this searches the web, it is not a browser
 *  operation. `BrowserSearch` still resolves through the tool-name alias map so
 *  historical sessions keep rendering. */
export const WEB_SEARCH_TOOL_NAME = 'WebSearch'

function buildDescription(): string {
  const engineList = Object.values(BUILTIN_ENGINES)
    .map((engine) => engineDisplayName(engine))
    .join(', ')
  const routing = INTENT_IDS.map((intent) => {
    const engines = (BUILTIN_INTENT_CONFIG[intent]?.engines ?? [])
      .map((id) => (BUILTIN_ENGINES[id] ? engineDisplayName(BUILTIN_ENGINES[id]) : id))
      .join(' + ')
    return `- ${intentDisplayName(intent)}: ${engines}`
  }).join('\n')

  return [
    'Multi-engine aggregated web search. No API key required.',
    '',
    'Automatically detects the query intent and queries the matching engines in',
    'parallel, then deduplicates and interleaves the hits so a single fast engine',
    'cannot fill the whole result list.',
    '',
    `Built-in engines: ${engineList}`,
    '',
    'Intent routing (which engines the user currently enables is applied on top):',
    routing,
    '',
    'Results include title, URL, snippet and source engine. Results from a',
    'user-defined basic engine carry `confidence: "low"` — its page is parsed',
    'with a generic heuristic, so treat those hits with more suspicion.',
    'Summarize the aggregated results for the user directly.'
  ].join('\n')
}

const webSearchHandler: ToolHandler = {
  definition: {
    name: WEB_SEARCH_TOOL_NAME,
    description: buildDescription(),
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        intent: {
          type: 'string',
          description: 'Override the auto-detected intent',
          enum: INTENT_IDS
        },
        maxResults: {
          type: 'number',
          description: 'Maximum results after deduplication. Default 10.',
          default: 10
        }
      },
      required: ['query']
    }
  },
  execute: executeBrowserSearch,
  requiresApproval: () => false
}

let _registered = false

export function registerBrowserSearchTool(): void {
  if (_registered) return
  _registered = true
  toolRegistry.register(webSearchHandler)
}

export function unregisterBrowserSearchTool(): void {
  if (!_registered) return
  _registered = false
  toolRegistry.unregister(webSearchHandler.definition.name)
}

export function isBrowserSearchToolRegistered(): boolean {
  return _registered
}
