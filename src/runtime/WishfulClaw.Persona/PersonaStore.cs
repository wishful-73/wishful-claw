using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Persona;

/// <summary>
/// Reads and writes persona .md files from the global library (~/.wishful-claw/personas/)
/// or project library ({workingFolder}/.wishful-claw/personas/).
/// Built-in presets are served by <see cref="PersonaPresetService"/>.
/// </summary>
public sealed class PersonaStore
{

    private static readonly Lazy<PersonaStore> _default = new(() => new PersonaStore());
    public static PersonaStore Default => _default.Value;

    // Delegate to PersonaPresetService for built-in lookups
    private static PersonaPresetService Presets => PersonaPresetService.Default;

    /// <summary>Proxy for backward compatibility.</summary>
    public static HashSet<string> BuiltinPresetIds => PersonaPresetService.BuiltinPresetIds;

    // ── Path resolution ──

    /// <summary>
    /// Returns the personas directory for the given scope.
    /// If workingFolder is null/empty, returns the global library path.
    /// </summary>
    public static string GetPersonasDirectory(string? workingFolder)
    {
        var root = string.IsNullOrWhiteSpace(workingFolder)
            ? WishfulClawDataDir.Root
            : Path.Combine(workingFolder, WishfulClawPaths.DataDirName);

        return Path.Combine(root, PersonaFileLayout.PersonasDirectoryName);
    }

    /// <summary>
    /// Returns the directory for a specific persona.
    /// </summary>
    public static string GetPersonaDirectory(string personaId, string? workingFolder)
    {
        ValidatePersonaId(personaId);
        return Path.Combine(GetPersonasDirectory(workingFolder), personaId);
    }

    /// <summary>
    /// personaId arrives via IPC — confine it to a safe filename shape so it
    /// cannot escape the personas directory. Without this, persona/save could
    /// write into arbitrary directories and persona/delete recursively remove
    /// them (mirrors the MemoryPathResolver SSH-scope containment).
    /// </summary>
    private static void ValidatePersonaId(string personaId)
    {
        if (string.IsNullOrWhiteSpace(personaId)
            || personaId.Contains('\\')
            || personaId.Contains('/')
            || personaId.Contains("..")
            || Path.IsPathRooted(personaId)
            || personaId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            throw new ArgumentException($"Invalid persona id: {personaId}", nameof(personaId));
        }
    }

    // ── List ──

    /// <summary>
    /// Lists every persona visible in the given scope: the built-in presets, the
    /// user's global personas on disk, and — when a working folder is supplied —
    /// that project's own personas. Later layers win on an ID collision, so a
    /// project copy shadows the global one and both shadow a preset.
    /// </summary>
    public List<PersonaSummary> ListPersonas(string? workingFolder)
    {
        var result = new List<PersonaSummary>();
        var positions = new Dictionary<string, int>(StringComparer.Ordinal);

        void Upsert(PersonaSummary summary)
        {
            if (positions.TryGetValue(summary.Id, out var position))
            {
                result[position] = summary;
                return;
            }

            positions[summary.Id] = result.Count;
            result.Add(summary);
        }

        // Global layer: built-in presets, then the user's own personas on disk.
        foreach (var preset in Presets.ListBuiltin()) Upsert(preset);
        foreach (var summary in ScanPersonasOnDisk(workingFolder: null)) Upsert(summary);

        // Project layer — shadows any global entry sharing its ID.
        if (!string.IsNullOrWhiteSpace(workingFolder))
        {
            foreach (var summary in ScanPersonasOnDisk(workingFolder)) Upsert(summary);
        }

        return result;
    }

    /// <summary>
    /// Reads every persona directory under the scope's personas folder. A
    /// directory without an IDENTITY.md is not a persona and is skipped, as is
    /// one whose IDENTITY.md cannot be parsed.
    /// </summary>
    private static IEnumerable<PersonaSummary> ScanPersonasOnDisk(string? workingFolder)
    {
        var personasDir = GetPersonasDirectory(workingFolder);
        if (!Directory.Exists(personasDir)) yield break;

        foreach (var dir in Directory.GetDirectories(personasDir))
        {
            var id = Path.GetFileName(dir);
            var identityPath = Path.Combine(dir, PersonaFileLayout.IdentityFile);
            if (!File.Exists(identityPath)) continue;

            PersonaSummary? summary = null;
            try
            {
                var meta = PersonaMetadata.Parse(File.ReadAllText(identityPath));
                summary = new PersonaSummary(
                    id,
                    string.IsNullOrEmpty(meta.Name) ? id : meta.Name,
                    meta.Tagline,
                    meta.Description,
                    IsBuiltin: IsBuiltinId(id, workingFolder));
            }
            catch
            {
                // Skip unreadable personas
            }

            if (summary is not null) yield return summary;
        }
    }

    /// <summary>
    /// A preset ID only counts as built-in while it still resolves to the
    /// embedded resource — a project-local copy of a preset is an ordinary
    /// project persona and must stay editable and deletable.
    /// </summary>
    private static bool IsBuiltinId(string personaId, string? workingFolder)
    {
        return BuiltinPresetIds.Contains(personaId) && string.IsNullOrWhiteSpace(workingFolder);
    }

    // ── Get ──

    /// <summary>
    /// Gets the full persona config by ID.
    ///
    /// The project layer is consulted first, so a project-local copy shadows the
    /// global one; the global layer then covers the user's own personas, and the
    /// built-in presets are the last resort. A non-built-in ID used to fall
    /// straight through to the project scope, which is why a globally created
    /// persona disappeared as soon as the session carried a working folder.
    /// </summary>
    public PersonaConfig? GetPersona(string personaId, string? workingFolder)
    {
        if (!string.IsNullOrWhiteSpace(workingFolder))
        {
            var projectConfig = TryReadFromDisk(personaId, workingFolder);
            if (projectConfig is not null) return projectConfig;
        }

        var globalConfig = TryReadFromDisk(personaId, workingFolder: null);
        if (globalConfig is not null) return globalConfig;

        return Presets.GetBuiltin(personaId);
    }

    private static PersonaConfig? TryReadFromDisk(string personaId, string? workingFolder)
    {
        var dir = GetPersonaDirectory(personaId, workingFolder);
        var identityPath = Path.Combine(dir, PersonaFileLayout.IdentityFile);
        if (!File.Exists(identityPath)) return null;

        var identityContent = File.ReadAllText(identityPath);
        var meta = PersonaMetadata.Parse(identityContent);

        return new PersonaConfig(
            personaId,
            string.IsNullOrEmpty(meta.Name) ? personaId : meta.Name,
            meta.Tagline,
            meta.Description,
            IsBuiltin: IsBuiltinId(personaId, workingFolder),
            IdentityMarkdown: identityContent,
            SoulMarkdown: TryReadFile(Path.Combine(dir, PersonaFileLayout.SoulFile)),
            OntologyMarkdown: TryReadFile(Path.Combine(dir, PersonaFileLayout.OntologyFile)),
            AgentsMarkdown: TryReadFile(Path.Combine(dir, PersonaFileLayout.AgentsFile)));
    }

    private static string TryReadFile(string path)
    {
        return File.Exists(path) ? File.ReadAllText(path) : string.Empty;
    }

    // ── Save ──

    /// <summary>
    /// Saves a persona config to disk (creates directory if needed).
    /// Each file is written to a temp path first and then moved into place,
    /// so a crash mid-save never leaves a half-written persona file.
    /// </summary>
    public void SavePersona(PersonaConfig config, string? workingFolder)
    {
        var dir = GetPersonaDirectory(config.Id, workingFolder);
        Directory.CreateDirectory(dir);

        WriteAtomic(Path.Combine(dir, PersonaFileLayout.IdentityFile), ComposeIdentityMarkdown(config));
        WriteAtomic(Path.Combine(dir, PersonaFileLayout.SoulFile), config.SoulMarkdown);
        WriteAtomic(Path.Combine(dir, PersonaFileLayout.OntologyFile), config.OntologyMarkdown);
        WriteAtomic(Path.Combine(dir, PersonaFileLayout.AgentsFile), config.AgentsMarkdown);

        WorkerLog.Info($"persona saved id={config.Id} scope={(string.IsNullOrWhiteSpace(workingFolder) ? "global" : "project")}");
    }

    /// <summary>
    /// Rebuilds the IDENTITY.md header from the structured meta fields.
    ///
    /// The editor keeps name / tagline / description as three separate inputs
    /// while the markdown body lives in its own tab, so nothing ever carried
    /// them to disk. <see cref="PersonaMetadata.Parse"/> reads them back from
    /// the markdown only — which is why an edited tagline silently reverted on
    /// reload. Re-synthesising the header here closes that round-trip.
    /// </summary>
    private static string ComposeIdentityMarkdown(PersonaConfig config)
    {
        var body = StripMetadataHeader(config.IdentityMarkdown);

        var headerLines = new List<string>();
        if (!string.IsNullOrWhiteSpace(config.Name)) headerLines.Add($"# {config.Name.Trim()}");
        if (!string.IsNullOrWhiteSpace(config.Tagline)) headerLines.Add($"> {config.Tagline.Trim()}");
        if (!string.IsNullOrWhiteSpace(config.Description)) headerLines.Add(config.Description.Trim());

        if (headerLines.Count == 0) return body;
        if (body.Length == 0) return string.Join('\n', headerLines);

        return $"{string.Join('\n', headerLines)}\n\n{body}";
    }

    /// <summary>
    /// Drops the leading name / tagline / description block from IDENTITY.md,
    /// mirroring exactly what <see cref="PersonaMetadata.Parse"/> consumes, so
    /// the header can be re-synthesised instead of duplicated. A body that
    /// opens with real content is returned untouched.
    /// </summary>
    private static string StripMetadataHeader(string markdown)
    {
        if (string.IsNullOrWhiteSpace(markdown)) return string.Empty;

        var lines = markdown.Replace("\r\n", "\n").Split('\n');
        var index = 0;

        while (index < lines.Length && string.IsNullOrWhiteSpace(lines[index])) index++;

        var seenName = false;
        var seenTagline = false;
        var seenDescription = false;

        while (index < lines.Length)
        {
            var line = lines[index].Trim();

            if (!seenName && line.StartsWith('#')) { seenName = true; index++; continue; }
            if (!seenTagline && line.StartsWith('>')) { seenTagline = true; index++; continue; }
            if (seenName && !seenDescription && line.Length > 0
                && !line.StartsWith('#') && !line.StartsWith('>') && !line.StartsWith('-'))
            {
                seenDescription = true;
                index++;
                continue;
            }

            break;
        }

        return string.Join('\n', lines.Skip(index)).TrimStart('\n');
    }

    private static void WriteAtomic(string path, string content)
    {
        var tempPath = $"{path}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(tempPath, content);
        File.Move(tempPath, path, overwrite: true);
    }

    // ── Delete ──

    /// <summary>
    /// Deletes a persona from disk. Built-in presets cannot be deleted.
    /// </summary>
    public bool DeletePersona(string personaId, string? workingFolder)
    {
        if (BuiltinPresetIds.Contains(personaId) && string.IsNullOrWhiteSpace(workingFolder))
        {
            return false; // Cannot delete global built-in presets
        }

        var dir = GetPersonaDirectory(personaId, workingFolder);
        if (!Directory.Exists(dir)) return false;

        Directory.Delete(dir, recursive: true);
        WorkerLog.Info($"persona deleted id={personaId} scope={(string.IsNullOrWhiteSpace(workingFolder) ? "global" : "project")}");
        return true;
    }

    // ── Copy to project ──

    /// <summary>
    /// Copies a persona from the source scope to a project library.
    /// If personaId is null, copies all built-in presets.
    /// </summary>
    public int CopyToProject(string? personaId, string projectFolder)
    {
        var count = 0;

        IEnumerable<string> idsToCopy;
        if (string.IsNullOrWhiteSpace(personaId))
        {
            idsToCopy = BuiltinPresetIds;
        }
        else
        {
            idsToCopy = [personaId];
        }

        foreach (var id in idsToCopy)
        {
            var config = GetPersona(id, workingFolder: null);
            if (config is null) continue;

            SavePersona(config, projectFolder);
            count++;
        }

        WorkerLog.Info($"persona copy to project folder={projectFolder} count={count} personaId={personaId ?? "<all>"}");
        return count;
    }
}
