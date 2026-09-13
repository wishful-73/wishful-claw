using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// R-3 — the single visibility entry point.
///
/// Before this existed, "can this tool be used here?" was answered in several places at once
/// (<c>AgentRunContextPolicy</c>'s name tables, <c>ToolRegistry.IsAvailableInMode</c>, the proxied
/// category lists inside <c>use_capability</c>), and each of them drifted. This type is the one place
/// a run context is turned into a <c>ctxStr</c> and matched against a tool's declarations, so the
/// prompt, the direct tool list, and <c>use_capability</c> can no longer disagree about what is
/// visible.
///
/// Rules, in priority order:
/// <list type="number">
/// <item><b>The tool's own veto wins.</b> A context matching <see cref="IToolExecutor.ExcludedScopes"/>
/// is not visible, whatever else it declares — that is where a tool says "never where nobody can
/// answer".</item>
/// <item><b>Declaration narrows.</b> A tool with <see cref="IToolExecutor.VisibleScopes"/> is visible
/// only where a pattern matches. A pattern with no <c>@role</c> matches only <c>sessionagent</c>, so
/// <c>"project:cowork"</c> is about the session itself and not about the sub-agents it spawns; a bare
/// <c>"*"</c> is the exception and means every context.</item>
/// <item><b>A matching declaration also admits.</b> Declaring scopes is therefore a complete answer
/// for a tool that lives in exactly one kind of run — <c>"*:channel"</c> both narrows it to the
/// channel and grants it there.</item>
/// <item><b>Default visible.</b> No declaration (null or empty) means visible everywhere. This is
/// deliberate: a newly added tool must not silently disappear because someone forgot to declare it,
/// and tools registered at runtime (MCP servers, skills) have no declaration to write.</item>
/// </list>
/// </summary>
internal static class ToolVisibilityPolicy
{
    /// <summary>Wildcard that matches any single segment of a pattern.</summary>
    public const string Wildcard = "*";

    /// <summary>
    /// Scope used when an execution has no session host at all (e.g. a background automation run).
    /// Reserved value — it is not a third business scope alongside project and global.
    /// </summary>
    public const string UnknownScope = "unknown";

    /// <summary>Mode used by the channel special case, which is a global session replying through a plugin.</summary>
    public const string ChannelMode = "channel";

    /// <summary>
    /// Default role: a run that is the session itself rather than something the session spawned.
    /// A <c>VisibleScopes</c> pattern without <c>@role</c> is shorthand for this role.
    /// </summary>
    public const string SessionAgentRole = "sessionagent";

    /// <summary>
    /// Renders a run context into the canonical <c>&lt;scope&gt;:&lt;mode&gt;[@&lt;role&gt;]</c> string.
    ///
    /// This is the only place the string is built. Callers pass the result around instead of
    /// re-deriving it, which is what keeps the declaration side (patterns) and the runtime side
    /// (this string) in the same vocabulary.
    /// </summary>
    public static string RenderContext(AgentRunContext context, bool channelSession)
    {
        var scope = Normalize(context.Scope, UnknownScope);
        var mode = channelSession
            ? ChannelMode
            : Normalize(context.CollaborationMode, "chat");
        var role = Normalize(context.RuntimeRole, SessionAgentRole);

        // Role is rendered only when it is not the session itself, so the common case stays short
        // and "project:cowork" keeps meaning "the session", not "a sub-agent of it".
        var hasRole = !string.Equals(role, SessionAgentRole, StringComparison.Ordinal);

        // An ownerless run has no session mode to speak of, so the mode segment is dropped rather
        // than defaulted to "chat" — R-3.C renders this scenario as "unknown" / "unknown@automation".
        if (string.Equals(scope, UnknownScope, StringComparison.Ordinal))
        {
            return hasRole ? $"{scope}@{role}" : scope;
        }

        return hasRole ? $"{scope}:{mode}@{role}" : $"{scope}:{mode}";
    }

    /// <summary>
    /// Decides whether a tool is visible in a run context from its two declarations alone.
    ///
    /// <paramref name="visibleScopes"/> null or empty means the tool declared nothing, so the
    /// default-visible rule applies; it is checked after the veto so "undeclared" can never be read as
    /// "unrestricted" for a tool that vetoed this context.
    /// </summary>
    public static bool IsVisible(
        AgentRunContext context,
        bool channelSession,
        string[]? visibleScopes,
        string[]? excludedScopes = null)
    {
        var ctxStr = RenderContext(context, channelSession);

        if (MatchesAny(excludedScopes, ctxStr))
        {
            return false;
        }

        if (visibleScopes is null || visibleScopes.Length == 0)
        {
            return true;
        }

        return MatchesAny(visibleScopes, ctxStr);
    }

    private static bool MatchesAny(string[]? patterns, string ctxStr)
    {
        if (patterns is null)
        {
            return false;
        }

        foreach (var pattern in patterns)
        {
            if (MatchesPattern(pattern, ctxStr))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Matches a declaration pattern against a rendered context string.
    ///
    /// Both sides are <c>scope:mode[@role]</c>. <c>*</c> matches any one segment. A pattern without
    /// <c>@role</c> is interpreted as <c>@sessionagent</c> rather than "any role" — otherwise
    /// <c>"project:cowork"</c> would silently grant sub-agents everything the session has, which is
    /// exactly the leak the sub-agent rules exist to prevent.
    /// </summary>
    public static bool MatchesPattern(string? pattern, string? ctxStr)
    {
        if (string.IsNullOrWhiteSpace(pattern) || string.IsNullOrWhiteSpace(ctxStr))
        {
            return false;
        }

        ParseScopeMode(pattern, out var patternScope, out var patternMode, out var patternRole);
        ParseScopeMode(ctxStr, out var ctxScope, out var ctxMode, out var ctxRole);

        return MatchesSegment(patternScope, ctxScope)
            && MatchesSegment(patternMode, ctxMode)
            && MatchesSegment(patternRole, ctxRole);
    }

    private static bool MatchesSegment(string pattern, string value)
    {
        if (string.Equals(pattern, Wildcard, StringComparison.Ordinal))
        {
            return true;
        }

        return string.Equals(pattern, value, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Splits a <c>scope:mode[@role]</c> string. A missing role yields the session-agent default so
    /// both sides of a comparison are always fully specified.
    /// </summary>
    private static void ParseScopeMode(string value, out string scope, out string mode, out string role)
    {
        var body = value.Trim();

        var atIndex = body.IndexOf('@');
        if (atIndex >= 0)
        {
            role = Normalize(body[(atIndex + 1)..], SessionAgentRole);
            body = body[..atIndex];
        }
        else
        {
            role = SessionAgentRole;
        }

        var colonIndex = body.IndexOf(':');
        if (colonIndex >= 0)
        {
            scope = Normalize(body[..colonIndex], Wildcard);
            mode = Normalize(body[(colonIndex + 1)..], Wildcard);
        }
        else
        {
            // A bare segment is read as a scope with an unrestricted mode, so "*" and "project"
            // both mean something sensible to a human writing a declaration.
            scope = Normalize(body, Wildcard);
            mode = Wildcard;

            // A bare "*" is the documented "every context" token, so it wildcards the role too.
            // Without this it would silently read as "everywhere, but never a sub-agent", which is
            // the opposite of what a tool declaring "safe in all runs" means.
            if (string.Equals(scope, Wildcard, StringComparison.Ordinal))
            {
                role = Wildcard;
            }
        }
    }

    private static string Normalize(string? value, string fallback)
    {
        var trimmed = value?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(trimmed) ? fallback : trimmed;
    }
}
