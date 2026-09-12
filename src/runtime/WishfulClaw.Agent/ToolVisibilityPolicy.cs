using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// R-3.2 — the single visibility entry point.
///
/// Before this existed, "can this tool be used here?" was answered in several places at once
/// (<c>AgentRunContextPolicy.IsToolAllowed</c>, <c>ToolRegistry.IsAvailableInMode</c>, the proxied
/// category lists inside <c>use_capability</c>), and each of them drifted. This type is the one
/// place a run context is turned into a <c>ctxStr</c> and matched against a tool's declared
/// <see cref="ToolDefinition.VisibleScopes"/>, so the prompt, the direct tool list, and
/// <c>use_capability</c> can no longer disagree about what is visible.
///
/// Rules (R-3.D), in priority order:
/// <list type="number">
/// <item><b>Blacklist wins.</b> A tool on an exclusion list is not visible, whatever it declares.</item>
/// <item><b>Declaration narrows.</b> A tool with <c>VisibleScopes</c> is visible only where a
/// pattern matches. A pattern with no <c>@role</c> matches only <c>sessionagent</c>, so
/// <c>"project:cowork"</c> is about the session itself and not about the sub-agents it spawns.</item>
/// <item><b>A matching declaration also admits.</b> Declaring scopes is therefore a complete answer
/// for a tool that lives in exactly one kind of run — <c>"*:channel"</c> both narrows it to the
/// channel and grants it there, which is what lets the old name tables go away.</item>
/// <item><b>Default visible.</b> No declaration (null or empty) means visible everywhere. This is
/// deliberate: a newly added tool must not silently disappear because someone forgot to declare it.</item>
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
    /// Decides visibility and reports <i>how</i> it was decided.
    ///
    /// The distinction matters for the enforcement layer: a tool granted by its own declaration
    /// needs no further allowlist check, while an undeclared (default-visible) tool is still subject
    /// to the run-context rules that predate declarations. Without this, removing a name from the
    /// old channel table would have taken the tool's only grant with it.
    /// </summary>
    public static VisibilityOutcome Evaluate(
        AgentRunContext context,
        bool channelSession,
        string toolName,
        string? category,
        string[]? visibleScopes)
    {
        if (IsGloballyExcluded(context, channelSession, toolName, category))
        {
            return VisibilityOutcome.Blocked;
        }

        // No declaration → default visible. Checked after the blacklist so that "undeclared" can
        // never be read as "unrestricted", even for a tool the blacklist rejects.
        if (visibleScopes is null || visibleScopes.Length == 0)
        {
            return VisibilityOutcome.DefaultVisible;
        }

        var ctxStr = RenderContext(context, channelSession);
        foreach (var pattern in visibleScopes)
        {
            if (MatchesPattern(pattern, ctxStr))
            {
                return VisibilityOutcome.Declared;
            }
        }

        return VisibilityOutcome.Blocked;
    }

    /// <summary>
    /// Decides whether <paramref name="toolName"/> is visible in the given run context.
    ///
    /// <paramref name="visibleScopes"/> is the tool's declaration; null or empty means visible
    /// everywhere.
    /// </summary>
    public static bool IsVisible(
        AgentRunContext context,
        bool channelSession,
        string toolName,
        string? category,
        string[]? visibleScopes)
    {
        return Evaluate(context, channelSession, toolName, category, visibleScopes)
            != VisibilityOutcome.Blocked;
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
        }
    }

    /// <summary>
    /// Blacklist layer. Kept separate from declarations because these are cross-cutting facts about
    /// the run rather than properties of a tool: a channel session cannot render interactive UI, and
    /// a sub-agent cannot drive the foreground browser.
    /// </summary>
    private static bool IsGloballyExcluded(
        AgentRunContext context,
        bool channelSession,
        string toolName,
        string? category)
    {
        if (channelSession && ChannelExcludedTools.Contains(toolName))
        {
            return true;
        }

        if (string.Equals(category, "browser", StringComparison.OrdinalIgnoreCase)
            && BackgroundBrowserExcludedRoles.Contains(context.RuntimeRole))
        {
            return true;
        }

        return false;
    }

    /// <summary>
    /// Tools that need a human present, so they are unavailable in any run where nobody can answer.
    /// Shared by the channel case and (later) the background-automation case — declared once here.
    /// </summary>
    private static readonly HashSet<string> ChannelExcludedTools = new(StringComparer.OrdinalIgnoreCase)
    {
        "visualize_show_widget",
        "AskUserQuestion",
        "ExitPlanMode"
    };

    /// <summary>
    /// Browser tools drive the foreground browser process and therefore cannot be delegated to a
    /// background sub-agent. Goal sub-agents have the same execution boundary.
    /// </summary>
    private static readonly HashSet<string> BackgroundBrowserExcludedRoles = new(StringComparer.OrdinalIgnoreCase)
    {
        "subagent",
        "goalsubagent"
    };

    private static string Normalize(string? value, string fallback)
    {
        var trimmed = value?.Trim().ToLowerInvariant();
        return string.IsNullOrEmpty(trimmed) ? fallback : trimmed;
    }
}

/// <summary>
/// How <see cref="ToolVisibilityPolicy"/> decided a tool's visibility, so the enforcement layer can
/// tell a declaration-based grant from the "undeclared, therefore visible" default.
/// </summary>
internal enum VisibilityOutcome
{
    /// <summary>Blacklisted, or declared only for contexts this run is not in.</summary>
    Blocked,

    /// <summary>A <c>VisibleScopes</c> pattern matched this run context — the tool's own word that it belongs here.</summary>
    Declared,

    /// <summary>No declaration at all, so the default-visible rule applies.</summary>
    DefaultVisible
}
