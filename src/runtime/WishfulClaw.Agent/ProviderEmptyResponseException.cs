namespace WishfulClaw.Agent;

/// <summary>
/// Thrown when the provider completes a turn successfully (HTTP 200) but returns
/// no usable output — no text, no tool calls, no reasoning, and usually no usage.
///
/// This is a transient upstream condition (overloaded gateway, rate-limited free
/// tier, dropped stream), not a client error: re-sending the same request often
/// succeeds. The retry policy therefore treats it as retryable rather than
/// failing the run outright.
/// </summary>
internal sealed class ProviderEmptyResponseException(string message) : Exception(message);
