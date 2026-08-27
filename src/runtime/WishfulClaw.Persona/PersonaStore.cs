using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Persona;

/// <summary>
/// Reads and writes persona .md files from the global library (~/.wishful-claw/personas/)
/// or project library ({workingFolder}/.wishful-claw/personas/).
/// Built-in presets are served by <see cref="PersonaPresetService"/>.
/// </summary>
public sealed class PersonaStore
{
    private const string DataDirectoryName = ".wishful-claw";

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
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                DataDirectoryName)
            : workingFolder;

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
    /// Lists all personas in the given scope (built-in + custom on disk).
    /// Built-in presets are always included; custom personas are scanned from disk.
    /// </summary>
    public List<PersonaSummary> ListPersonas(string? workingFolder)
    {
        var result = Presets.ListBuiltin();

        // Scan custom personas on disk
        var personasDir = GetPersonasDirectory(workingFolder);
        if (Directory.Exists(personasDir))
        {
            foreach (var dir in Directory.GetDirectories(personasDir))
            {
                var id = Path.GetFileName(dir);
                if (BuiltinPresetIds.Contains(id)) continue; // already added

                var identityPath = Path.Combine(dir, PersonaFileLayout.IdentityFile);
                if (!File.Exists(identityPath)) continue;

                try
                {
                    var identityContent = File.ReadAllText(identityPath);
                    var meta = PersonaMetadata.Parse(identityContent);
                    result.Add(new PersonaSummary(
                        id,
                        string.IsNullOrEmpty(meta.Name) ? id : meta.Name,
                        meta.Tagline,
                        meta.Description,
                        IsBuiltin: false));
                }
                catch
                {
                    // Skip unreadable personas
                }
            }
        }

        return result;
    }

    // ── Get ──

    /// <summary>
    /// Gets the full persona config by ID.
    /// Checks built-in cache first, then disk.
    /// </summary>
    public PersonaConfig? GetPersona(string personaId, string? workingFolder)
    {
        // Check built-in presets
        if (BuiltinPresetIds.Contains(personaId))
        {
            // If a custom override exists on disk (project scope), prefer it
            if (!string.IsNullOrWhiteSpace(workingFolder))
            {
                var diskConfig = TryReadFromDisk(personaId, workingFolder);
                if (diskConfig is not null) return diskConfig;
            }
            return Presets.GetBuiltin(personaId);
        }

        // Read from disk
        return TryReadFromDisk(personaId, workingFolder);
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
            IsBuiltin: BuiltinPresetIds.Contains(personaId) && string.IsNullOrWhiteSpace(workingFolder),
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

        WriteAtomic(Path.Combine(dir, PersonaFileLayout.IdentityFile), config.IdentityMarkdown);
        WriteAtomic(Path.Combine(dir, PersonaFileLayout.SoulFile), config.SoulMarkdown);
        WriteAtomic(Path.Combine(dir, PersonaFileLayout.OntologyFile), config.OntologyMarkdown);
        WriteAtomic(Path.Combine(dir, PersonaFileLayout.AgentsFile), config.AgentsMarkdown);

        WorkerLog.Info($"persona saved id={config.Id} scope={(string.IsNullOrWhiteSpace(workingFolder) ? "global" : "project")}");
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
