namespace WishfulClaw.Persona;

/// <summary>
/// Layout constants for persona files.
/// Mirrors KodaClaw's KodaClawWorkspaceLayout pattern.
/// </summary>
public static class PersonaFileLayout
{
    /// <summary>Root directory name inside ~/.wishful-claw/</summary>
    public const string PersonasDirectoryName = "personas";

    /// <summary>Persona file names.</summary>
    public const string IdentityFile = "IDENTITY.md";
    public const string SoulFile = "SOUL.md";
    public const string OntologyFile = "ONTOLOGY.md";
    public const string AgentsFile = "AGENTS.md";

    /// <summary>All persona markdown files in load order.</summary>
    public static readonly string[] PersonaFiles =
    [
        IdentityFile,
        SoulFile,
        OntologyFile,
        AgentsFile
    ];
}

/// <summary>
/// Lightweight summary for list views.
/// </summary>
public sealed record PersonaSummary(
    string Id,
    string Name,
    string Tagline,
    string Description,
    bool IsBuiltin);

/// <summary>
/// Full persona content — all four markdown files.
/// </summary>
public sealed record PersonaConfig(
    string Id,
    string Name,
    string Tagline,
    string Description,
    bool IsBuiltin,
    string IdentityMarkdown,
    string SoulMarkdown,
    string OntologyMarkdown,
    string AgentsMarkdown)
{
    /// <summary>
    /// Returns a summary view of this config.
    /// </summary>
    public PersonaSummary ToSummary() => new(Id, Name, Tagline, Description, IsBuiltin);
}

/// <summary>
/// Metadata embedded in each persona's IDENTITY.md front-matter.
/// Parsed from the first markdown heading block.
/// </summary>
public sealed class PersonaMetadata
{
    public string Name { get; set; } = string.Empty;
    public string Tagline { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// Parse metadata from IDENTITY.md content.
    /// Expects a format like:
    /// # Name
    /// > Tagline
    /// Description text...
    /// </summary>
    public static PersonaMetadata Parse(string identityMarkdown)
    {
        var meta = new PersonaMetadata();
        if (string.IsNullOrWhiteSpace(identityMarkdown))
            return meta;

        var lines = identityMarkdown.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        foreach (var rawLine in lines)
        {
            var line = rawLine.Trim();
            if (string.IsNullOrEmpty(meta.Name) && line.StartsWith('#'))
            {
                meta.Name = line.TrimStart('#', ' ');
                continue;
            }
            if (string.IsNullOrEmpty(meta.Tagline) && line.StartsWith('>'))
            {
                meta.Tagline = line.TrimStart('>', ' ');
                continue;
            }
            // First non-heading, non-quote line after name is the description
            if (!string.IsNullOrEmpty(meta.Name) &&
                string.IsNullOrEmpty(meta.Description) &&
                !line.StartsWith('#') &&
                !line.StartsWith('>') &&
                !line.StartsWith('-') &&
                !string.IsNullOrWhiteSpace(line))
            {
                meta.Description = line;
                break;
            }
        }

        return meta;
    }
}
