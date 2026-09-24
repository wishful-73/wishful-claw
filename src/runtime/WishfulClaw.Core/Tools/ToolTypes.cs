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
/// <param name="Content">
/// 文本结果，也是日志与工具事件里看的摘要。当 <paramref name="ContentBlocks"/> 非 null 时，
/// 它仍然作为人类可读的说明保留（例如「Read image: …」）。
/// </param>
/// <param name="ContentBlocks">
/// 结构化 content 数组（S-145）。非 null 时，写进 wire 的 `tool_result.content` 用它 ——
/// 这样 C# 内部工具（如 Read 读图）也能像渲染端工具（DesktopScreenshot）一样返回 image 块。
/// 为 null 时行为不变：content 就是 <paramref name="Content"/> 字符串。
/// </param>
public sealed record ToolResult(
    string Content,
    bool IsError = false,
    string? Error = null,
    JsonElement? ContentBlocks = null);

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
    IReadOnlyList<string>? SandboxRoots = null,
    /// <summary>
    /// 本次工具调用的 id（模型返回的 tool call id）。长跑的 shell 靠它把自己
    /// 登记进中止表，渲染层的「停止进程」按钮按同一个 id 找回来（iter-34 S-137）。
    /// </summary>
    string? ToolUseId = null,
    /// <summary>
    /// 当前模型是否支持图像输入（S-145）。默认 true = 不做降级：拿不到模型能力信息时
    /// 宁可照常送出图像块，也不要把图悄悄吞掉。渲染端在 run 参数里带 supportsVision 时以它为准。
    /// </summary>
    bool SupportsVision = true,
    /// <summary>
    /// 视频抽帧通路（S-145 §六）。视频只有渲染端的 Chromium 能解码，C# 的 Read 靠这个回调
    /// 把请求递过去、把 JPEG 帧收回来。<c>null</c> = 当前调用方没有这条通路（离线执行、测试），
    /// Read 命中视频时退回纯文本说明。由 <c>AgentRuntimeVideoFrameExtraction</c> 装配。
    /// </summary>
    Func<string, CancellationToken, Task<VideoFrameExtraction>>? VideoFrameExtractor = null);
