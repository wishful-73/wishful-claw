using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.ToolConcurrencyRegressionTests;

internal static class Program
{
    public static async Task<int> Main()
    {
        try
        {
            await RunQueueSuiteAsync();
            await RunCancellationSuiteAsync();
            Console.WriteLine("Tool concurrency regression checks passed.");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Tool concurrency regression test failed: {ex}");
            return 1;
        }
    }

    private static async Task RunQueueSuiteAsync()
    {
        var executor = new DelayedToolExecutor();
        var previousRegistry = ToolModuleState.Registry;
        ToolModuleState.Registry = new ToolRegistry();
        ToolModuleState.Registry.Register(executor);

        try
        {
            using var state = new AgentRuntimeRunState("tool-concurrency-run", "tool-concurrency-session");
            state.SuppressTransportEvents = true;
            state.EventObserver = _ => ValueTask.CompletedTask;
            state.ReplaceParameters(Parse("""
                {
                  "maxParallelTools": 2,
                  "maxToolCallsPerTurn": 1,
                  "scope": "global",
                  "collaborationMode": "chat",
                  "runtimeRole": "automation"
                }
                """));

            var calls = Enumerable.Range(0, 5)
                .Select(index => new AgentRuntimeNativeToolCall(
                    $"call-{index}",
                    "regression-delay-tool",
                    Parse($"{{\"index\":{index}}}")))
                .ToList();

            var results = await ToolCallProcessor.ExecuteAsync(calls, state.Parameters, state, CreateContext(state.CancellationToken));

            AssertEqual(5, executor.Completed.Count, "all calls execute despite maxToolCallsPerTurn=1");
            AssertEqual(5, results.Count, "all calls return results");
            Assert(executor.MaxActive <= 2, $"active tool count never exceeds maxParallelTools=2 (observed {executor.MaxActive})");
            Assert(executor.MaxActive == 2, "queue test exercises the configured parallel slots");
            Assert(!results.Any(result => result.Content.ValueKind == JsonValueKind.String &&
                (result.Content.GetString() ?? string.Empty).StartsWith("Skipped:", StringComparison.Ordinal)),
                "queue execution does not create synthetic Skipped errors");

            for (var index = 0; index < calls.Count; index++)
            {
                AssertEqual(calls[index].Id, results[index].ToolUseId,
                    $"result order remains aligned with input order at index {index}");
            }
        }
        finally
        {
            ToolModuleState.Registry = previousRegistry;
        }
    }

    private static async Task RunCancellationSuiteAsync()
    {
        var executor = new DelayedToolExecutor(delayMs: 10_000);
        var previousRegistry = ToolModuleState.Registry;
        ToolModuleState.Registry = new ToolRegistry();
        ToolModuleState.Registry.Register(executor);

        try
        {
            using var state = new AgentRuntimeRunState("tool-cancellation-run", "tool-cancellation-session");
            state.SuppressTransportEvents = true;
            state.EventObserver = _ => ValueTask.CompletedTask;
            state.ReplaceParameters(Parse("""
                {
                  "maxParallelTools": 1,
                  "scope": "global",
                  "collaborationMode": "chat",
                  "runtimeRole": "automation"
                }
                """));

            var calls = Enumerable.Range(0, 3)
                .Select(index => new AgentRuntimeNativeToolCall(
                    $"cancel-call-{index}",
                    "regression-delay-tool",
                    Parse($"{{\"index\":{index}}}")))
                .ToList();

            var execution = ToolCallProcessor.ExecuteAsync(calls, state.Parameters, state, CreateContext(state.CancellationToken));
            await executor.FirstStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));
            state.Cancel("regression cancellation");

            await AssertThrowsAsync<OperationCanceledException>(
                () => execution.WaitAsync(TimeSpan.FromSeconds(3)),
                "cancellation releases queued WaitAsync calls without deadlocking");
        }
        finally
        {
            ToolModuleState.Registry = previousRegistry;
        }
    }

    private static WorkerRequestContext CreateContext(CancellationToken cancellationToken)
    {
        return new WorkerRequestContext(
            (_, _, _) => ValueTask.CompletedTask,
            (_, _) => ValueTask.CompletedTask,
            cancellationToken);
    }

    private static JsonElement Parse(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
            throw new InvalidOperationException($"Assertion failed: {message}");
    }

    private static void AssertEqual<T>(T expected, T actual, string message)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"Assertion failed: {message}; expected={expected}, actual={actual}");
    }

    private static async Task AssertThrowsAsync<TException>(Func<Task> action, string message)
        where TException : Exception
    {
        try
        {
            await action();
        }
        catch (TException)
        {
            return;
        }

        throw new InvalidOperationException($"Assertion failed: {message}; expected {typeof(TException).Name}");
    }

    private sealed class DelayedToolExecutor : IToolExecutor
    {
        private readonly int _delayMs;
        private int _active;
        private int _maxActive;

        public DelayedToolExecutor(int delayMs = 80)
        {
            _delayMs = delayMs;
        }

        public string Name => "regression-delay-tool";
        public string Description => "Test-only delayed tool executor.";
        public JsonElement InputSchema => Parse("{\"type\":\"object\"}");
        public ConcurrentBag<string> Completed { get; } = [];
        public TaskCompletionSource FirstStarted { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public int MaxActive => Volatile.Read(ref _maxActive);

        public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)
        {
            var index = input.GetProperty("index").GetInt32();
            var active = Interlocked.Increment(ref _active);
            UpdateMaxActive(active);
            FirstStarted.TrySetResult();
            try
            {
                await Task.Delay(_delayMs + ((4 - index) * 10), context.CancellationToken);
                Completed.Add($"{index}");
                return new ToolResult($"completed-{index}");
            }
            finally
            {
                Interlocked.Decrement(ref _active);
            }
        }

        private void UpdateMaxActive(int active)
        {
            while (true)
            {
                var current = Volatile.Read(ref _maxActive);
                if (active <= current || Interlocked.CompareExchange(ref _maxActive, active, current) == current)
                    return;
            }
        }
    }
}
