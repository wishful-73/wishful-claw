namespace WishfulClaw.Core.Tools;

/// <summary>
/// Shared <see cref="ToolDefinition.VisibleScopes"/> declaration sets (R-3).
///
/// A pattern is <c>&lt;scope&gt;:&lt;mode&gt;[@&lt;role&gt;]</c> where <c>*</c> matches one segment.
/// Only a set carried by more than one tool belongs here — a one-off scope is written inline on the
/// executor that owns it, so the declaration stays next to the behaviour it describes.
/// </summary>
public static class ToolVisibilityScopes
{
    /// <summary>
    /// Messaging-channel tools. They post into the chat that triggered the run, so outside a channel
    /// session there is no destination at all. The role is left open because a scheduled task that
    /// fires into a channel still has to be able to reply there.
    /// </summary>
    public static readonly string[] ChannelOnly = ["*:channel@*"];

    /// <summary>
    /// Read-only and session-local tools: looking, searching, recalling, and the run's own todo list.
    /// Nothing here changes state outside the session, so every run can use it — including a
    /// sub-agent, which is why the bare <c>"*"</c> (and not a list of scopes) is the honest form.
    /// </summary>
    public static readonly string[] Everywhere = ["*"];

    /// <summary>
    /// Tools that change something: files, shell, the desktop, a schedule, a goal, a plan, a team.
    /// They belong to a work run, at any role, and are absent from a chat and from a channel session
    /// — <c>availableModes</c> already refused them a chat, and this is that same boundary stated
    /// where the admission check reads it.
    /// </summary>
    public static readonly string[] WorkRunsOnly = ["*:cowork@*"];

    /// <summary>
    /// The global side's own capabilities: global tasks, sessions, dispatches and the hot memory that
    /// belongs to the user rather than to a project. A project chat is deliberately excluded — it has
    /// a project to work in — while the work runs that serve those requests are included.
    /// </summary>
    public static readonly string[] GlobalSideAndWorkRuns = ["global:*@*", "*:cowork@*"];

    /// <summary>
    /// Tools whose whole point is a human reacting: an answer dialog, a rendered widget. Visible in
    /// every desktop run, absent from a channel, where the only reply surface is plain text and a
    /// dialog would hang the run waiting for a click nobody can make.
    /// </summary>
    public static readonly string[] HumanAttended = ["*:chat@*", "*:cowork@*"];

    /// <summary>
    /// <see cref="ToolDefinition.ExcludedScopes"/> half of the pair: a sub-agent runs unattended, so a
    /// tool that takes over a foreground surface (the browser) stays with the session the user asked.
    /// Expressed as a veto rather than as a grant list because these tools are otherwise useful
    /// everywhere — including an automation run, which is unattended but is the session it was asked
    /// to be.
    /// </summary>
    public static readonly string[] SubAgentRoles = ["*:*@subagent", "*:*@goalsubagent"];
}
