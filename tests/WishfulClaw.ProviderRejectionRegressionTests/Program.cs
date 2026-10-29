// S-262 回归：请求级 400 的「替换最后一条工具结果 + 重发」与三道安全阀。
//
// 这套断言守的是两件事，写错任何一边代价都不对称：
//   · 护栏不严 —— 对着同一个错反复重发，烧的是用户的请求费（2026-10-27 撤掉 400 重试就为这个）
//   · 判据误伤 —— 把图像 / 配对 / 超限的 400 也吞进来，会让专项分支失效（S-236 判据 10 红线）
//
// 所以下面一半断言是「必须认」，另一半是「不许认」。
//
// 约定：失败断言打 FAIL，最后一行打 "passed: N, failed: M"，非零退出码表示失败
// （scripts/run-tests.mjs 按退出码判定，按 "passed: N" 取计数）。

using System;
using System.Collections.Generic;
using System.Net;
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

// ── 一、判据 1：只认 400 ──

ProviderHttpException Http(HttpStatusCode code, string body) =>
    new("OpenAI-compatible chat", code, body, null);

Check(ProviderRejectionErrors.IsRequestRejected(Http(HttpStatusCode.BadRequest, "bad body")),
    "400 is recognised as a request rejection");
Check(!ProviderRejectionErrors.IsRequestRejected(Http(HttpStatusCode.TooManyRequests, "rate limited")),
    "429 is NOT a request rejection (retry policy owns it)");
Check(!ProviderRejectionErrors.IsRequestRejected(Http(HttpStatusCode.InternalServerError, "boom")),
    "500 is NOT a request rejection");
Check(!ProviderRejectionErrors.IsRequestRejected(Http(HttpStatusCode.Unauthorized, "bad key")),
    "401 is NOT a request rejection");
Check(!ProviderRejectionErrors.IsRequestRejected(new Exception("plain failure")),
    "plain exception is NOT a request rejection");
Check(ProviderRejectionErrors.IsRequestRejected(
    new InvalidOperationException("outer", Http(HttpStatusCode.BadRequest, "nested"))),
    "400 nested in an outer exception is recognised");

// ── 二、报文取料 ──

var liveBody = ".messages[477].image[0]: You have uploaded an unsupported image. Please upload a supported image.";
var described = ProviderRejectionErrors.Describe(Http(HttpStatusCode.BadRequest, liveBody));
Check(described.Contains("messages[477]", StringComparison.Ordinal),
    "describe keeps the upstream body verbatim");
Check(described.Contains("HTTP 400", StringComparison.Ordinal),
    "describe keeps the status line so the provider is identifiable");
Check(described.Contains("OpenAI-compatible chat", StringComparison.Ordinal),
    "describe keeps the provider name");

var longDescribed = ProviderRejectionErrors.Describe(
    Http(HttpStatusCode.BadRequest, new string('x', 2000)));
Check(longDescribed.Length <= ProviderRejectionErrors.MaxReportedLength + 1,
    "describe truncates oversized bodies to MaxReportedLength");

Check(ProviderRejectionErrors.Describe(new Exception("fallback message"))
        .Contains("fallback", StringComparison.Ordinal),
    "describe falls back to the innermost message when nothing is a 400");

// ── 三、指纹：同一毛病不该被当成新问题 ──

Check(ProviderRejectionErrors.Fingerprint(null) == string.Empty,
    "null report yields an empty fingerprint");
Check(ProviderRejectionErrors.Fingerprint("   ") == string.Empty,
    "whitespace-only report yields an empty fingerprint");

// 索引去掉是刻意的：上游常把 .messages[N] 写进正文，索引算进指纹就等于
// 把「同一个毛病在下一处复发」误判成新问题，白白多烧一次请求。
Check(ProviderRejectionErrors.Fingerprint(".messages[477].image[0]: unsupported image")
      == ProviderRejectionErrors.Fingerprint(".messages[478].image[0]: unsupported image"),
    "fingerprint ignores message indices");
Check(ProviderRejectionErrors.Fingerprint("BIG BODY Rejected") ==
      ProviderRejectionErrors.Fingerprint("big  body   rejected"),
    "fingerprint ignores case and whitespace");
Check(ProviderRejectionErrors.Fingerprint("unsupported image") !=
      ProviderRejectionErrors.Fingerprint("tool_calls must be followed by tool results"),
    "different rejections have different fingerprints");

// ── 四、标记消费与替换语义 ──

AgentRuntimeChatMessage Assistant(string text) => new("assistant", text, [], []);

AgentRuntimeChatMessage ToolResults(string toolUseId, string content) =>
    AgentRuntimeChatMessage.UserToolResults(
        [new AgentRuntimeToolResult(toolUseId, AgentRuntimeProviderSupport.CreateStringElement(content), null)]);

var state = new AgentRuntimeRunState("run-1", "sess-1");

var plainConversation = new List<AgentRuntimeChatMessage>
{
    AgentRuntimeChatMessage.User("hello"),
    Assistant("let me read that file")
};

Check(ReferenceEquals(AgentLoop.InjectProviderRejectionNotice(state, plainConversation), plainConversation),
    "no pending rejection -> conversation returned untouched");

state.RecordProviderRejectionRecovery("HTTP 400: tool result too large", "fp-1");
var conversation = new List<AgentRuntimeChatMessage>
{
    AgentRuntimeChatMessage.User("hello"),
    Assistant("let me read that file"),
    ToolResults("call-1", "original content")
};

var injected = AgentLoop.InjectProviderRejectionNotice(state, conversation);

Check(injected.Count == conversation.Count,
    "replacement keeps the message count (deleting would break tool pairing)");
Check(state.PendingProviderRejectionReport is not null,
    "S-262: the report is not consumed — the bad result comes back on the next round");
Check(ReferenceEquals(injected[0], conversation[0]),
    "earlier messages are passed through by reference, not rewritten");
Check(injected[2].ToolResults[0].ToolUseId == "call-1",
    "ToolUseId is preserved verbatim (changing it would create a pairing error)");
Check(injected[2].ToolResults[0].IsError == true,
    "replaced result is marked as an error");
Check((injected[2].ToolResults[0].Content.GetString() ?? string.Empty)
        .Contains("tool result too large", StringComparison.Ordinal),
    "replaced result carries the upstream body to the model");
Check((conversation[2].ToolResults[0].Content.GetString() ?? string.Empty) == "original content",
    "the source list is untouched (replacement happens on the temporary copy only)");

// S-262 补正：下一轮组包从 durable conversation 重建，坏数据原样回来 —— 必须还换得掉，
// 否则同一 400 再来一次、指纹去重直接抛，会话照样废。
var nextRound = new List<AgentRuntimeChatMessage>
{
    AgentRuntimeChatMessage.User("hello"),
    Assistant("let me read that file"),
    ToolResults("call-1", "original content"),      // 同一 id 的坏结果，还在报文里
    Assistant("a different approach then"),
    ToolResults("call-2", "fresh content")          // 下一轮新的工具结果
};
var injectedNextRound = AgentLoop.InjectProviderRejectionNotice(state, nextRound);
Check((injectedNextRound[2].ToolResults[0].Content.GetString() ?? string.Empty)
        .Contains("tool result too large", StringComparison.Ordinal),
    "S-262: the dead result is still replaced on a later round");
Check(injectedNextRound[2].ToolResults[0].IsError == true,
    "S-262: the dead result stays marked as an error on a later round");
Check((injectedNextRound[4].ToolResults[0].Content.GetString() ?? string.Empty) == "fresh content",
    "S-262: fresh tool results from later rounds are left alone");
Check(ReferenceEquals(nextRound[2], injectedNextRound[2]) == false,
    "S-262: later-round replacement still happens on the temporary copy");

// 只换最后一条带结果的：一轮里可能堆了十几条，全换会把前几轮拿到的信息一并抹掉。
var twoRounds = new List<AgentRuntimeChatMessage>
{
    ToolResults("call-old", "old content"),
    Assistant("ok"),
    ToolResults("call-new", "new content")
};
var stateTwoRounds = new AgentRuntimeRunState("run-2", "sess-2");
stateTwoRounds.RecordProviderRejectionRecovery("HTTP 400: boom", "fp-2");
var injectedTwoRounds = AgentLoop.InjectProviderRejectionNotice(stateTwoRounds, twoRounds);
Check((injectedTwoRounds[0].ToolResults[0].Content.GetString() ?? string.Empty) == "old content",
    "only the trailing tool result is replaced, earlier rounds survive");
Check((injectedTwoRounds[2].ToolResults[0].Content.GetString() ?? string.Empty)
        .Contains("boom", StringComparison.Ordinal),
    "the trailing tool result is the one replaced");

// 一轮里有多条结果时，同一个 ToolUseId 各留各的 —— 配对仍然完整。
var batch = new List<AgentRuntimeChatMessage>
{
    AgentRuntimeChatMessage.UserToolResults(
    [
        new AgentRuntimeToolResult("call-a", AgentRuntimeProviderSupport.CreateStringElement("a"), null),
        new AgentRuntimeToolResult("call-b", AgentRuntimeProviderSupport.CreateStringElement("b"), null)
    ])
};
var stateBatch = new AgentRuntimeRunState("run-3", "sess-3");
stateBatch.RecordProviderRejectionRecovery("HTTP 400: batch rejected", "fp-3");
var injectedBatch = AgentLoop.InjectProviderRejectionNotice(stateBatch, batch);
Check(injectedBatch[0].ToolResults.Count == 2 &&
      injectedBatch[0].ToolResults[0].ToolUseId == "call-a" &&
      injectedBatch[0].ToolResults[1].ToolUseId == "call-b",
    "every result in the batch keeps its own ToolUseId");

// ── 五、安全阀 3：没有可替换对象就不进这条路 ──

var stateNoTool = new AgentRuntimeRunState("run-4", "sess-4");
var noToolConversation = new List<AgentRuntimeChatMessage>
{
    AgentRuntimeChatMessage.User("just text, no tool runs yet")
};
Check(!AgentLoop.CanRecoverFromProviderRejection(
        stateNoTool,
        noToolConversation,
        Http(HttpStatusCode.BadRequest, "whatever")),
    "safety valve 3: no tool result in the conversation -> no recovery attempt");

var withToolConversation = new List<AgentRuntimeChatMessage>
{
    AgentRuntimeChatMessage.User("hello"),
    ToolResults("call-1", "original content")
};
Check(AgentLoop.CanRecoverFromProviderRejection(
        stateNoTool,
        withToolConversation,
        Http(HttpStatusCode.BadRequest, "first failure")),
    "first attempt with a tool result is allowed");

// ── 六、安全阀 2：同一指纹不许反复烧 ──

var stateSameFingerprint = new AgentRuntimeRunState("run-5", "sess-5");
var sameError = Http(HttpStatusCode.BadRequest, ".messages[477].image[0]: unsupported image");
var sameReport = ProviderRejectionErrors.Describe(sameError);
stateSameFingerprint.RecordProviderRejectionRecovery(
    sameReport, ProviderRejectionErrors.Fingerprint(sameReport));

Check(!AgentLoop.CanRecoverFromProviderRejection(
        stateSameFingerprint,
        withToolConversation,
        Http(HttpStatusCode.BadRequest, ".messages[478].image[0]: unsupported image")),
    "safety valve 2: same fingerprint (different index) is blocked even with budget left");

// ── 七、安全阀 1：额度上限 ──

var stateBudget = new AgentRuntimeRunState("run-6", "sess-6");
Check(AgentLoop.MaxProviderRejectionRecoveriesPerRun == 2,
    "recovery budget is 2 per run (regression guard: raising it burns the user's money)");

stateBudget.RecordProviderRejectionRecovery(
    "first", ProviderRejectionErrors.Fingerprint("first"));
Check(AgentLoop.CanRecoverFromProviderRejection(
        stateBudget,
        withToolConversation,
        Http(HttpStatusCode.BadRequest, "second distinct failure")),
    "a different failure is still allowed while budget remains");

stateBudget.RecordProviderRejectionRecovery(
    "second", ProviderRejectionErrors.Fingerprint("second"));
Check(!AgentLoop.CanRecoverFromProviderRejection(
        stateBudget,
        withToolConversation,
        Http(HttpStatusCode.BadRequest, "third distinct failure")),
    "safety valve 1: budget exhausted blocks a third attempt even for a new failure");

// ── 八、顺序契约：专项分支必须抢在前面（S-236 判据 10 红线）──
//
// 兜底分支判断的是「是不是 400」，所以图像 / 配对 / 超限的 400 **同样满足**它。
// 它们之所以不会被吞，靠的是 catch 链的书写顺序，不是判据互斥。
// 这两组断言把这个契约钉死：一旦有人把兜底分支挪到前面，这里立刻红。

var imageRejection = Http(HttpStatusCode.BadRequest, liveBody);
Check(ImageInputErrors.IsImageUnsupportedError(imageRejection),
    "image 400 still matches the image branch first");
Check(ProviderRejectionErrors.IsRequestRejected(imageRejection),
    "image 400 also satisfies the generic predicate -> order is what protects it");

var unknownRejection = Http(HttpStatusCode.BadRequest, "some brand new upstream complaint");
Check(!ToolPairingErrors.IsToolPairingError(unknownRejection),
    "unrecognised 400 does not match the pairing branch");
Check(!ImageInputErrors.IsImageUnsupportedError(unknownRejection),
    "unrecognised 400 does not match the image branch");
Check(!ContextCompression.IsContextWindowExceededError(unknownRejection),
    "unrecognised 400 does not match the overflow branch");
Check(ProviderRejectionErrors.IsRequestRejected(unknownRejection),
    "unrecognised 400 falls through to the generic branch");

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;
