// S-322 回归：会话驻留必须有闸。
//
// 为什么这条必须有回归：淘汰失效不报错、不崩、功能一切正常 —— 只是十几个会话的完整
// wire 副本（含全部历史截图 base64）钉在托管堆上直到进程退出。除了「内存只涨不降」
// 没有任何可观测症状，只能靠断言钉住。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败。

using System;
using System.Text.Json;
using WishfulClaw.Agent.Sessions;
using WishfulClaw.Agent;

var passed = 0;
var failed = 0;

void Check(bool condition, string label)
{
    if (condition)
    {
        passed++;
        return;
    }

    failed++;
    Console.WriteLine($"FAIL {label}");
}

// ── 一、常量按需求单钉死：闲置 2h、常驻 8 条 ────────────────────────────────
Check(SessionConversationManager.IdleTimeout == TimeSpan.FromHours(2),
    $"idle timeout is 2h (actual {SessionConversationManager.IdleTimeout})");
Check(SessionConversationManager.MaxResident == 8,
    $"resident cap is 8 (actual {SessionConversationManager.MaxResident})");

// ── 二、闲置淘汰：超过阈值，下一次取会话就把它砍掉 ───────────────────────────
SessionConversationManager.ClearAll();
var idleVictim = SessionConversationManager.GetOrCreate("idle-victim");
using (var wireDoc = JsonDocument.Parse("{\"role\":\"user\",\"content\":\"hi\"}"))
{
    idleVictim.Initialize([wireDoc.RootElement.Clone()], []);
}

Check(idleVictim.MessageCount == 1, "victim holds one wire message before eviction");
Check(SessionConversationManager.Count == 1, "one session registered");

idleVictim.ForceIdleForTests(SessionConversationManager.IdleTimeout + TimeSpan.FromMinutes(1));
SessionConversationManager.GetOrCreate("another"); // 任何一次 GetOrCreate 都会跑闸

Check(SessionConversationManager.TryGet("idle-victim") is null, "idle session evicted");
Check(SessionConversationManager.Count == 1, "only the fresh session remains");

// 淘汰后重建必须是空会话 —— 这正是 agent loop 从 DB 懒恢复的触发条件。
var rebuilt = SessionConversationManager.GetOrCreate("idle-victim");
Check(rebuilt.MessageCount == 0, "rebuilt session starts empty (DB restore trigger)");

// ── 三、刚好没超阈值不能砍 ────────────────────────────────────────────────
SessionConversationManager.ClearAll();
var warm = SessionConversationManager.GetOrCreate("warm");
warm.ForceIdleForTests(SessionConversationManager.IdleTimeout - TimeSpan.FromMinutes(1));
SessionConversationManager.GetOrCreate("trigger");
Check(!ReferenceEquals(SessionConversationManager.TryGet("warm"), null), "session just inside the window survives");

// ── 四、TryGet 也算一次访问：否则「常读但看起来闲置」的会话会被砍在脚下 ───────
SessionConversationManager.ClearAll();
var reread = SessionConversationManager.GetOrCreate("reread");
reread.ForceIdleForTests(SessionConversationManager.IdleTimeout - TimeSpan.FromSeconds(1));
var touched = SessionConversationManager.TryGet("reread");
Check(touched is not null, "TryGet finds the near-idle session");
Check(touched!.IdleMilliseconds < 5_000, "TryGet resets the idle clock");

reread.ForceIdleForTests(SessionConversationManager.IdleTimeout + TimeSpan.FromSeconds(1));
SessionConversationManager.TryGet("reread"); // Touch 一次，mock 一个真实访问
SessionConversationManager.GetOrCreate("trigger-2");
Check(!ReferenceEquals(SessionConversationManager.TryGet("reread"), null), "a touched session is not evicted");

// ── 五、容量淘汰：连开 12 个，只留 8 条，最久未访问的先走 ─────────────────────
SessionConversationManager.ClearAll();
const int sessionTotal = 12;
for (var i = 0; i < sessionTotal; i++)
{
    var session = SessionConversationManager.GetOrCreate($"cap-{i}");
    // i 越小越旧：cap-0 闲置 12 分钟，cap-11 闲置 1 分钟。
    session.ForceIdleForTests(TimeSpan.FromMinutes(sessionTotal - i));
}

Check(SessionConversationManager.Count == SessionConversationManager.MaxResident,
    $"resident count capped at {SessionConversationManager.MaxResident} (actual {SessionConversationManager.Count})");

var oldestEvicted = 0;
for (var i = 0; i < sessionTotal - SessionConversationManager.MaxResident; i++)
{
    if (SessionConversationManager.TryGet($"cap-{i}") is null)
    {
        oldestEvicted++;
    }
}

Check(oldestEvicted == sessionTotal - SessionConversationManager.MaxResident,
    $"the {sessionTotal - SessionConversationManager.MaxResident} oldest got evicted (actual {oldestEvicted})");
Check(!ReferenceEquals(SessionConversationManager.TryGet($"cap-{sessionTotal - 1}"), null),
    "the most recently used session survives");

// 最后被 GetOrCreate 的那个永不作废 —— 哪怕容量扫描挑不出更新的候选。
SessionConversationManager.ClearAll();
for (var i = 0; i < SessionConversationManager.MaxResident; i++)
{
    SessionConversationManager.GetOrCreate($"keep-{i}").ForceIdleForTests(TimeSpan.FromMinutes(30));
}

var kept = SessionConversationManager.GetOrCreate("just-created");
Check(ReferenceEquals(SessionConversationManager.TryGet("just-created"), kept),
    "the session that triggered the sweep is never a victim");

// ── 六、Remove / ClearAll 行为不变 ───────────────────────────────────────────
SessionConversationManager.Remove("just-created");
Check(SessionConversationManager.TryGet("just-created") is null, "explicit Remove still works");

SessionConversationManager.ClearAll();
Check(SessionConversationManager.Count == 0, "ClearAll empties the registry");

// 空 sessionId 仍落到 __default__，不因重构而改变。
var fallback = SessionConversationManager.GetOrCreate(string.Empty);
Check(ReferenceEquals(SessionConversationManager.GetOrCreate("__default__"), fallback),
    "empty sessionId still maps to __default__");

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;
