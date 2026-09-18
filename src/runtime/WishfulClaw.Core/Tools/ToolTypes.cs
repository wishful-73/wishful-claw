using System.Text.Json;

namespace WishfulClaw.Core.Tools;

/// <summary>
/// Tool definition sent to the LLM provider.
/// </summary>
/// <param name="Name">Tool name as the LLM sees it.</param>
/// <param name="Description">Description rendered into the provider request.</param>
/// <param name="InputSchema">Canonicalized JSON schema for the tool's arguments.</param>
/// <param name="AvailableModes">Session modes the tool is available in. null/empty = all modes.</param>
/// <param name="Category">Category from <see cref="ToolCategoryCatalog"/>; null when uncategorized.</param>
/// <param name="Priority">Sort key for the request payload; lower sorts first.</param>
/// <param name="VisibleScopes">
/// Run-context patterns this tool is visible under, e.g. <c>"project:cowork"</c> or <c>"*:chat@subagent"</c>.
/// A bare <c>"*"</c> is shorthand for every context, including background roles — the declaration a
/// tool needs when it is safe everywhere (task tracking, read-only file inspection).
/// <para>
/// <b>null means "visible everywhere"</b> — an undeclared tool stays visible, so adding a tool never
/// silently loses it. An empty array is treated the same as null (see <see cref="ToolRegistry"/>).
/// </para>
/// <para>
/// This is a declaration only. Whether it is enforced, and how patterns are matched against a run
/// context, is decided by the single visibility entry point in the Agent layer.
/// </para>
/// </param>
/// <param name="ExcludedScopes">
/// Run-context patterns this tool is explicitly unavailable under, same syntax as
/// <see cref="VisibleScopes"/>. This is the tool's own veto: it wins over a matching
/// <see cref="VisibleScopes"/> pattern and over the default-visible rule, so "never in a run where no
/// human can answer" is stated once, next to the tool that needs the human.
/// </param>
/// <param name="IsCore">
/// Whether the tool is worth permanent space in the system prompt (see the core-tool-set principle),
/// as opposed to being reachable on demand through <c>use_capability</c>.
/// <para>
/// Defaults to <b>false</b>: visibility and core-ness are orthogonal — a tool can be visible in every
/// scope yet not belong in the prompt. Tools that should be listed directly opt in explicitly.
/// </para>
/// </param>
public sealed record ToolDefinition(
    string Name,
    string Description,
    JsonElement InputSchema,
    string[]? AvailableModes = null,
    string? Category = null,
    int Priority = 100,
    string[]? VisibleScopes = null,
    string[]? ExcludedScopes = null,
    bool IsCore = false);

/// <summary>
/// Result of executing a tool.
/// </summary>
public sealed record ToolResult(
    string Content,
    bool IsError = false,
    string? Error = null);

/// <summary>
/// Context passed to tool executors.
/// </summary>
public sealed record ToolExecutionContext(
    string? WorkingFolder = null,
    string? SessionId = null,
    string? RunId = null,
    string? ProjectId = null,
    string? SshConnectionId = null,
    CancellationToken CancellationToken = default,
    /// <summary>
    /// 沙箱模式（iter-32 S-79）是否生效。默认 false = 不校验：没接线的调用方
    /// （测试、一次性工具）不该被一个它们拿不到的设置拦住。
    /// </summary>
    bool SandboxEnabled = false,
    /// <summary>允许的根目录集合，空/ null 表示没有边界可依，一律放行。</summary>
    IReadOnlyList<string>? SandboxRoots = null);
