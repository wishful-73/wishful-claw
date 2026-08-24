using System.Collections.Concurrent;
using System.Collections.Generic;
using WishfulClaw.Core.Protocol;
namespace WishfulClaw.Agent;

/// <summary>
/// In-memory registry for SubAgent definitions.
/// Populated once at startup from ~/.wishful-claw/agents/*.md files.
/// This is the C# equivalent of WishfulClaw's SubAgentRegistry (TS).
///
/// The registry decouples Task tool definition (which lists available agent types)
/// from SubAgentExecutor (which resolves a type name to a SubAgentDefinition).
///
/// SA-3: tool execution dispatches concurrently while skill management may
/// mutate the registry at runtime — all access goes through ConcurrentDictionary
/// and caches are rebuilt under a lock.
/// </summary>
public static class SubAgentRegistry
{
    private const string CustomAgentType = "custom";

    private static readonly ConcurrentDictionary<string, SubAgentDefinition> _agents =
        new(System.StringComparer.OrdinalIgnoreCase);

    private static readonly object CacheLock = new();
    private static List<SubAgentDefinition>? _allCache;
    private static List<string>? _namesCache;

    /// <summary>
    /// Register a sub-agent definition.
    /// </summary>
    public static void Register(SubAgentDefinition definition)
    {
        _agents[definition.Name] = definition;
        InvalidateCache();
    }

    /// <summary>
    /// Unregister a sub-agent by name.
    /// </summary>
    public static void Unregister(string name)
    {
        if (_agents.TryRemove(name, out _))
        {
            InvalidateCache();
        }
    }

    /// <summary>
    /// Look up a sub-agent definition by name (case-insensitive).
    /// Returns null if not found.
    /// </summary>
    public static SubAgentDefinition? Get(string name)
    {
        return _agents.TryGetValue(name, out var def) ? def : null;
    }

    /// <summary>
    /// Check if a sub-agent is registered by name.
    /// </summary>
    public static bool Has(string name)
    {
        return _agents.ContainsKey(name);
    }

    /// <summary>
    /// Get all registered sub-agent definitions (excluding "custom").
    /// </summary>
    public static IReadOnlyList<SubAgentDefinition> GetAll()
    {
        lock (CacheLock)
        {
            _allCache ??= new List<SubAgentDefinition>(_agents.Values);
            return _allCache;
        }
    }

    /// <summary>
    /// Get all available sub-agent type names, including "custom" at the end.
    /// Used to build the Task tool's subagent_type enum.
    /// </summary>
    public static IReadOnlyList<string> GetNames()
    {
        lock (CacheLock)
        {
            _namesCache ??= new List<string>(_agents.Keys) { CustomAgentType };
            return _namesCache;
        }
    }

    /// <summary>
    /// Load all .md agent definitions from disk into the registry.
    /// Should be called once at startup before registering the Task tool.
    /// </summary>
    public static void LoadFromDisk()
    {
        var agents = SubAgentDefinitionLoader.LoadAll();
        foreach (var agent in agents)
        {
            Register(agent);
        }

        if (_agents.Count > 0)
        {
            WorkerLog.Info($"sub-agent registry loaded count={_agents.Count}");
        }
    }

    /// <summary>
    /// Clear all registered definitions.
    /// </summary>
    public static void Clear()
    {
        _agents.Clear();
        InvalidateCache();
    }

    private static void InvalidateCache()
    {
        lock (CacheLock)
        {
            _allCache = null;
            _namesCache = null;
        }
    }
}
