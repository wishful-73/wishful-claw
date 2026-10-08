/*
 * AI-assisted persona creation — renderer-side.
 *
 * The whole flow is a single-shot `provider/complete` call, exactly like the
 * prompt optimizer (`lib/prompt-optimizer/optimizer.ts`): this file owns the
 * system prompt, the request shape and the response parsing, and the Worker
 * owns nothing persona-specific. It replaces the C# `PersonaGenerator` +
 * `PersonaGenerationPrompt` that used to live in `WishfulClaw.Persona` — the
 * prompt text and the tolerant JSON extraction below are ported from them
 * unchanged.
 */

export interface PersonaDraft {
  name: string
  tagline: string
  description: string
  identityMarkdown: string
  soulMarkdown: string
  ontologyMarkdown: string
  agentsMarkdown: string
}

export interface PersonaReference {
  name: string
  identityMarkdown: string
  soulMarkdown: string
  ontologyMarkdown: string
  agentsMarkdown: string
}

export type PersonaGenerationResult =
  | { success: true; draft: PersonaDraft }
  | { success: false; error: string }

/** Single-shot completion result as the Worker returns it. */
interface CompletionResult {
  ok: boolean
  text?: string | null
  error?: string | null
}

const JSON_EXAMPLE = `\`\`\`json
{
  "name": "persona name",
  "tagline": "one-line tagline (e.g. a technical partner who never sugar-coats)",
  "description": "short description (2-3 sentences)",
  "identity": "full Markdown contents of IDENTITY.md",
  "soul": "full Markdown contents of SOUL.md",
  "ontology": "full Markdown contents of ONTOLOGY.md",
  "agents": "full Markdown contents of AGENTS.md"
}
\`\`\``

function buildSystemPrompt(reference: PersonaReference | null): string {
  const referenceSection = reference ? buildReferenceSection(reference) : ''

  return `You are **WishfulClaw**, an assistant helping to create a new AI persona.

You will receive a user's description of the kind of persona they want. Generate a complete persona with 4 markdown files.

## Persona File Structure

Each persona consists of 4 markdown files:

1. **IDENTITY.md** — Identity: name, background, role, outward impression, inner traits
2. **SOUL.md** — Soul: core personality, communication style, interaction patterns, boundaries, principles
3. **ONTOLOGY.md** — Cognitive/values: essential definitions, capability boundaries, value priorities, honesty principles
4. **AGENTS.md** — Behavior rules: memory writing boundaries, tool usage principles, safety strategies, error handling

## Design Principles

- **Personas are not perfect.** Every persona should have personality strengths AND small flaws that make them feel human. Flaws should be endearing, not debilitating.
- **Flaws are not bugs, they are character.** Write them as natural personality traits, not negative labels.
- The personality layer (IDENTITY + SOUL + ONTOLOGY) affects output style — "how they talk"
- The behavior layer (AGENTS) affects agent loop decisions — "how they work"
- Write in the language the user uses in their prompt.

## Output Format

Return a single JSON object with these fields. The example shows the shape of each field, not its
language: write the values in the language the user wrote their prompt in.
${JSON_EXAMPLE}

Return ONLY the JSON object, no additional explanation.
${referenceSection}`
}

function buildReferenceSection(reference: PersonaReference): string {
  return `
## Reference Persona
The user referenced an existing persona "${reference.name}" as inspiration. Here are its files:

### IDENTITY.md
${reference.identityMarkdown}

### SOUL.md
${reference.soulMarkdown}

### ONTOLOGY.md
${reference.ontologyMarkdown}

### AGENTS.md
${reference.agentsMarkdown}
`
}

/**
 * Generates a persona draft from a user prompt.
 *
 * `provider` is the shared provider payload (`buildProviderPayload`) — the
 * Worker's header chain reads the per-provider User-Agent and
 * `requestOverrides` straight off it.
 */
export async function generatePersonaDraft(args: {
  provider: Record<string, unknown>
  prompt: string
  referencePersonaId?: string
  workingFolder?: string
}): Promise<PersonaGenerationResult> {
  const providerId = String(args.provider.providerId ?? args.provider.id ?? '')
  const modelId = String(args.provider.model ?? '')

  const reference = args.referencePersonaId
    ? await loadReference(args.referencePersonaId, args.workingFolder)
    : null

  const { agentBridge } = await import('../ipc/agent-bridge')
  const initialized = await agentBridge.initialize()
  if (!initialized) {
    return { success: false, error: 'Sidecar unavailable' }
  }

  const result = await window.api.workerRequest<CompletionResult | null>('provider/complete', {
    provider: args.provider,
    requestKind: 'persona',
    globalActiveModel: { providerId, modelId },
    model: modelId,
    systemPrompt: buildSystemPrompt(reference),
    message: args.prompt
  })

  if (!result?.ok) {
    return { success: false, error: result?.error ?? 'Empty response from worker' }
  }

  try {
    return { success: true, draft: parseDraft(result.text ?? '') }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Loads the reference persona's 4 markdown files. A missing reference is not
 * fatal — generation continues without it, matching the old C# behaviour.
 */
async function loadReference(
  id: string,
  workingFolder?: string
): Promise<PersonaReference | null> {
  try {
    const config = await window.api.workerRequest<{
      name?: string
      identityMarkdown?: string
      soulMarkdown?: string
      ontologyMarkdown?: string
      agentsMarkdown?: string
      error?: string
    }>('persona/get', { id, workingFolder: workingFolder ?? null })

    if (!config?.name || config.error) return null

    return {
      name: config.name,
      identityMarkdown: config.identityMarkdown ?? '',
      soulMarkdown: config.soulMarkdown ?? '',
      ontologyMarkdown: config.ontologyMarkdown ?? '',
      agentsMarkdown: config.agentsMarkdown ?? ''
    }
  } catch {
    return null
  }
}

function parseDraft(text: string): PersonaDraft {
  if (!text.trim()) {
    throw new Error('LLM returned empty response for persona generation')
  }

  const parsed = JSON.parse(extractJsonFromText(text)) as Record<string, unknown>

  return {
    name: stringField(parsed, 'name') ?? 'New Persona',
    tagline: stringField(parsed, 'tagline') ?? '',
    description: stringField(parsed, 'description') ?? '',
    identityMarkdown: stringField(parsed, 'identity') ?? '',
    soulMarkdown: stringField(parsed, 'soul') ?? '',
    ontologyMarkdown: stringField(parsed, 'ontology') ?? '',
    agentsMarkdown: stringField(parsed, 'agents') ?? ''
  }
}

/** Tolerant extraction: the model may wrap the object in a ```json fence. */
function extractJsonFromText(text: string): string {
  let trimmed = text.trim()

  if (trimmed.startsWith('```')) {
    const firstNewline = trimmed.indexOf('\n')
    if (firstNewline >= 0) {
      trimmed = trimmed.slice(firstNewline + 1)
    }
    const lastFence = trimmed.lastIndexOf('```')
    if (lastFence >= 0) {
      trimmed = trimmed.slice(0, lastFence)
    }
    trimmed = trimmed.trim()
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  return trimmed
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' ? value : null
}
