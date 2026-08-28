using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.MemoryRecallRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        var testRoot = Path.Combine(Path.GetTempPath(), $"wishful-memory-recall-regression-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testRoot);
        try
        {
            RunFtsLiteralQuerySuite(Path.Combine(testRoot, "memory.db"));
            RunSessionDeduplicationSuite();
            RunRecallFilteringSuite();
            Console.WriteLine($"Memory recall regression checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Memory recall regression test failed: {ex}");
            return 1;
        }
        finally
        {
            try
            {
                Directory.Delete(testRoot, true);
            }
            catch
            {
                // Best-effort cleanup for temporary regression data.
            }
        }
    }

    private static void RunFtsLiteralQuerySuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"temporary memory database initializes: {initialization.Error}");

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        DbClient.GetClient().Execute(
            "INSERT INTO memory_entries (scope, title, content, priority, status, created_at, updated_at) " +
            "VALUES (@scope, @title, @content, 'standard', 'active', @now, @now)",
            new SqliteParameter("@scope", "global"),
            new SqliteParameter("@title", "FTS special syntax"),
            new SqliteParameter("@content", "special <memory-recall> say \"hello\" OR token alpha:beta (gamma)"),
            new SqliteParameter("@now", now));

        var search = new MemoryFtsService();
        AssertFtsHit(search, "<memory-recall>");
        AssertFtsHit(search, "say \"hello\"");
        AssertFtsHit(search, "OR token");
        AssertFtsHit(search, "alpha:beta (gamma)");
    }

    private static void AssertFtsHit(MemoryFtsService search, string query)
    {
        var hits = search.SearchAsync(query, "global").GetAwaiter().GetResult();
        Assert(hits.Count > 0, $"FTS literal query returns a hit: {query}");
        Assert(hits[0].Score is not null, $"FTS literal query does not fall back to LIKE: {query}");
    }

    private static void RunSessionDeduplicationSuite()
    {
        var session = new SessionConversation();
        session.Initialize([], []);

        Assert(session.NeedsMemoryInjection(1, "content-v1"), "new memory needs injection");
        session.MarkMemoryInjected(1, "content-v1");
        Assert(!session.NeedsMemoryInjection(1, "content-v1"), "same memory content is skipped");
        Assert(session.NeedsMemoryInjection(1, "content-v2"), "changed memory content is injected again");

        session.MarkMemoryInjected(1, "content-v2");
        session.Replace([], []);
        Assert(session.NeedsMemoryInjection(1, "content-v2"), "context replacement clears recall deduplication state");

        session.MarkMemoryInjected(2, "content-v1");
        session.Clear();
        Assert(session.NeedsMemoryInjection(2, "content-v1"), "session clear resets recall deduplication state");
    }

    private static void RunRecallFilteringSuite()
    {
        var projectHit = Hit(1, "project:demo", "project memory");
        var globalHit = Hit(2, "global", "global memory");
        var search = new StubMemorySearch(projectHit, globalHit);
        var recall = new MemoryRecallService(search, new StubBudgetPlanner());

        var outcome = recall.TryInjectRecallAsync(
            "memory query",
            "project:demo",
            globalFallback: true,
            candidateFilter: hit => hit.Id != projectHit.Id).GetAwaiter().GetResult();

        AssertEqual("injected", outcome.Reason, "global fallback injects when project hits were already present");
        AssertEqual(1, outcome.InjectedHits.Count, "global fallback injects one new entry");
        AssertEqual(globalHit.Id, outcome.InjectedHits[0].Id, "global fallback injects the new global entry");
        var firstGlobal = search.Scopes.IndexOf("global");
        Assert(
            firstGlobal > 0
            && search.Scopes.Take(firstGlobal).All(scope => scope == "project:demo")
            && search.Scopes.Skip(firstGlobal).All(scope => scope == "global"),
            "recall searches project variants before global variants after deduplication");
    }

    private static MemorySearchResult Hit(long id, string scope, string content) => new()
    {
        Id = id,
        Title = $"memory-{id}",
        Content = content,
        Scope = scope,
        Priority = "standard",
        Status = "active",
        UpdatedAt = DateTimeOffset.UnixEpoch,
        Score = 1
    };

    private sealed class StubMemorySearch(MemorySearchResult projectHit, MemorySearchResult globalHit) : IMemorySearch
    {
        public List<string> Scopes { get; } = [];

        public Task<IReadOnlyList<MemorySearchResult>> SearchAsync(
            string query,
            string? scope = null,
            int limit = 10,
            bool includeDeprecated = false,
            CancellationToken ct = default)
        {
            Scopes.Add(scope ?? "");
            IReadOnlyList<MemorySearchResult> hits = scope == "global" ? [globalHit] : [projectHit];
            return Task.FromResult(hits);
        }
    }

    private sealed class StubBudgetPlanner : IContextBudgetPlanner
    {
        public int PlanBudget(int maxTokens, int maxChars) => Math.Min(maxTokens * 4, maxChars);
    }

    private static void Assert(bool condition, string name)
    {
        if (!condition)
            throw new InvalidOperationException(name);
        _passed++;
        Console.WriteLine($"PASS: {name}");
    }

    private static void AssertEqual<T>(T expected, T actual, string name)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new InvalidOperationException($"{name}: expected={expected}, actual={actual}");
        Assert(true, name);
    }
}
