using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Persona;

/// <summary>
/// Prompt template for AI-assisted persona generation.
/// Separated from PersonaGenerator to keep HTTP/parsing logic separate from prompt content.
/// </summary>
public static class PersonaGenerationPrompt
{
    /// <summary>
    /// Builds the system prompt for persona generation.
    /// Optionally includes a reference persona's files as inspiration.
    /// </summary>
    public static string Build(string? referencePersonaId, string? workingFolder)
    {
        var referenceSection = BuildReferenceSection(referencePersonaId, workingFolder);
        var jsonExample = BuildJsonExample();

        return $"""
You are **WishfulClaw**, an assistant helping to create a new AI persona.

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
{jsonExample}

Return ONLY the JSON object, no additional explanation.
{referenceSection}
""";
    }

    /// <summary>
    /// Builds the JSON example block showing the expected output format.
    /// </summary>
    private static string BuildJsonExample()
    {
        return """
```json
{
  "name": "persona name",
  "tagline": "one-line tagline (e.g. a technical partner who never sugar-coats)",
  "description": "short description (2-3 sentences)",
  "identity": "full Markdown contents of IDENTITY.md",
  "soul": "full Markdown contents of SOUL.md",
  "ontology": "full Markdown contents of ONTOLOGY.md",
  "agents": "full Markdown contents of AGENTS.md"
}
```
""";
    }

    /// <summary>
    /// Builds the reference persona section if a reference ID is provided.
    /// Loads the reference persona's 4 markdown files and includes them as inspiration.
    /// </summary>
    private static string BuildReferenceSection(string? referencePersonaId, string? workingFolder)
    {
        if (string.IsNullOrWhiteSpace(referencePersonaId))
        {
            return string.Empty;
        }

        var refConfig = PersonaStore.Default.GetPersona(referencePersonaId, workingFolder);
        if (refConfig is null)
        {
            return string.Empty;
        }

        return $"""

## Reference Persona
The user referenced an existing persona "{refConfig.Name}" as inspiration. Here are its files:

### IDENTITY.md
{refConfig.IdentityMarkdown}

### SOUL.md
{refConfig.SoulMarkdown}

### ONTOLOGY.md
{refConfig.OntologyMarkdown}

### AGENTS.md
{refConfig.AgentsMarkdown}
""";
    }
}
