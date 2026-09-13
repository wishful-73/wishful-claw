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
    /// <see cref="ToolDefinition.ExcludedScopes"/> half of the pair: runs with nobody watching a window.
    /// A sub-agent is delegated and a background schedule fires on its own, so neither may take over the
    /// one shared browser surface — the page would change in front of no one, and no click can be
    /// explained or stopped. The session a user is looking at keeps it, and so does a scheduled task
    /// told to run <i>inside</i> a session: that one arrives as its host session's own role, not as
    /// <c>automation</c>, which only the headless sidecar path sends.
    /// </summary>
    public static readonly string[] UnattendedRoles = ["*:*@subagent", "*:*@goalsubagent", "*:*@automation"];

    /// <summary>
    /// <see cref="ToolDefinition.ExcludedScopes"/> half of the pair for tools that cannot do anything
    /// without a person able to answer: a question dialog, a rendered widget, a plan awaiting review.
    /// A sub-agent is delegated work with nobody at the keyboard, a background automation has no window
    /// to show them in, and a channel's only reply surface is plain text — the run would sit waiting
    /// for a click that is never coming.
    ///
    /// A veto is the only way to say this, not a narrower grant. These tools are granted in the mode
    /// their run belongs to (<see cref="HumanAttended"/>, <see cref="WorkRunsOnly"/>), and a scheduled
    /// task is normalized into the cowork mode, so a <c>*:cowork@*</c> grant covers the headless case
    /// as well. Subtracting the unattended contexts here is what keeps "a schedule fired from inside a
    /// session may ask" and "a schedule running on its own may not" from collapsing into each other.
    ///
    /// The role axis is <see cref="UnattendedRoles"/> itself rather than a second copy of it — both
    /// sets answer the same question, "is anyone there?", so a role added to one belongs in the other.
    /// </summary>
    public static readonly string[] NoHumanToAnswer = [.. UnattendedRoles, "*:channel@*"];
}
