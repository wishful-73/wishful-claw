using System.Text.Json;
using System.Text.RegularExpressions;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Static definition of a sub-agent, loaded from ~/.wishful-claw/agents/*.md files.
/// Simplified from WishfulClaw's SubAgentDefinitionNative.
/// </summary>
/// <param name="Name">Unique name, used as subagent_type in the Task tool</param>
/// <param name="Description">Human-readable description for the LLM</param>
/// <param name="SystemPrompt">Focused system prompt for this sub-agent</param>
/// <param name="MaxTurns">Max LLM turns before forced stop</param>
/// <param name="Model">Optional model override</param>
/// <param name="Temperature">Optional temperature override</param>
public sealed record SubAgentDefinition(
    string Name,
    string Description,
    string SystemPrompt,
    int MaxTurns,
    string? Model = null,
    double? Temperature = null,
    bool ProviderTurnOnly = false);

/// <summary>
/// Loads sub-agent definitions from the filesystem.
/// Files are Markdown with YAML frontmatter, similar to WishfulClaw's approach.
/// </summary>
internal static partial class SubAgentDefinitionLoader
{
    private const string AgentsDirectoryName = ".wishful-claw/agents";
    private const int DefaultMaxTurns = 12;

    /// <summary>
    /// Loads all sub-agent definitions from ~/.wishful-claw/agents/*.md
    /// </summary>
    public static List<SubAgentDefinition> LoadAll()
    {
        var result = new List<SubAgentDefinition>();
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            AgentsDirectoryName);

        if (!Directory.Exists(root))
        {
            return result;
        }

        foreach (var file in Directory.EnumerateFiles(root, "*.md", SearchOption.TopDirectoryOnly))
        {
            try
            {
                var parsed = ParseAgentFile(File.ReadAllText(file), Path.GetFileName(file));
                if (parsed is not null)
                {
                    result.Add(parsed);
                }
            }
            catch (Exception ex)
            {
                WorkerLog.Warn(
                    $"failed to load sub-agent file={file} error={ex.GetType().Name}: {ex.Message}");
            }
        }

        return result;
    }

    /// <summary>
    /// Parses a Markdown file with YAML frontmatter into a SubAgentDefinition.
    /// Frontmatter fields: name, description, maxTurns, model, temperature
    /// Body (after frontmatter) becomes the system prompt.
    /// </summary>
    internal static SubAgentDefinition? ParseAgentFile(string content, string filename)
    {
        var match = FrontmatterRegex().Match(content);
        if (!match.Success)
        {
            WorkerLog.Warn($"sub-agent skipped filename={filename} reason=no frontmatter");
            return null;
        }

        var frontmatter = match.Groups[1].Value;
        var body = content[match.Length..].TrimStart();

        var name = GetFrontmatterString(frontmatter, "name");
        var description = GetFrontmatterString(frontmatter, "description");

        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(description))
        {
            WorkerLog.Warn($"sub-agent skipped filename={filename} reason=missing name/description");
            return null;
        }

        var maxTurns = GetFrontmatterInt(frontmatter, "maxTurns") ?? DefaultMaxTurns;
        if (maxTurns < 0) maxTurns = DefaultMaxTurns;

        var model = GetFrontmatterString(frontmatter, "model");
        var temperature = GetFrontmatterDouble(frontmatter, "temperature");

        return new SubAgentDefinition(
            name.Trim(),
            description.Trim(),
            body.Length == 0 ? $"You are {name}, a specialized agent." : body,
            maxTurns,
            string.IsNullOrWhiteSpace(model) ? null : model,
            temperature);
    }

    /// <summary>
    /// Creates the "custom" sub-agent definition for general-purpose use.
    /// </summary>
    public static SubAgentDefinition CreateCustomDefinition(string? workingFolder)
    {
        return new SubAgentDefinition(
            "custom",
            "General-purpose sub-agent with a built-in default system prompt",
            BuildDefaultSystemPrompt(workingFolder),
            DefaultMaxTurns);
    }

    public static SubAgentDefinition CreateStructuredDefinition(
        string name,
        string description,
        string systemPrompt)
        // MaxTurns 6: reasoning models spend early turns on thinking (which
        // produces no text output); 2 turns starved them into "completed but
        // produced no output". 6 leaves room for think → answer.
        => new(name, description, systemPrompt, 6, Temperature: 0, ProviderTurnOnly: true);

    /// <summary>
    /// Default system prompt for custom sub-agents.
    /// Inspired by Reasonix's DefaultTaskSystemPrompt — concise, self-contained.
    /// </summary>
    private static string BuildDefaultSystemPrompt(string? workingFolder)
    {
        var folderHint = string.IsNullOrWhiteSpace(workingFolder)
            ? string.Empty
            : $"\nWorking directory: {workingFolder}\n";

        return $@"Sub-agent invoked by a parent agent to carry out one focused task.
Use the provided tools to investigate or act. Return a single final answer that is concise and self-contained — the parent will see only that answer, not your tool calls or reasoning.{folderHint}
If you need to ask for clarification, fail with a precise question instead of guessing.
Before calling tools, briefly state what you are about to do. After results, briefly summarize what you found. Never call tools silently.";
    }

    // ── Frontmatter parsing helpers ──

    [GeneratedRegex(@"^---\s*\n(.*?)\n---\s*\n", RegexOptions.Singleline)]
    private static partial Regex FrontmatterRegex();

    private static string? GetFrontmatterString(string frontmatter, string key)
    {
        var match = Regex.Match(
            frontmatter,
            $@"^{key}:\s*(.+)$",
            RegexOptions.Multiline);
        return match.Success ? match.Groups[1].Value.Trim().Trim('"') : null;
    }

    private static int? GetFrontmatterInt(string frontmatter, string key)
    {
        var value = GetFrontmatterString(frontmatter, key);
        return int.TryParse(value, out var result) ? result : null;
    }

    private static double? GetFrontmatterDouble(string frontmatter, string key)
    {
        var value = GetFrontmatterString(frontmatter, key);
        return double.TryParse(value, out var result) ? result : null;
    }
}
