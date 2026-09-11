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
}
