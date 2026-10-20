using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.JsonHelpersRegressionTests;

internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        try
        {
            RunBoolParsingSuite();
            RunJsonWriterEnvelopeSuite();
            Console.WriteLine($"JsonHelpers regression checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"JsonHelpers regression test failed: {ex}");
            return 1;
        }
    }

    private static void RunBoolParsingSuite()
    {
        // Native booleans keep their original behaviour.
        AssertTrue(GetBool("""{"a":true}""", "a", false), "native true resolves to true");
        AssertFalse(GetBool("""{"a":false}""", "a", true), "native false resolves to false");

        // Stringified booleans: the fix this suite guards (S-181).
        AssertTrue(GetBool("""{"a":"true"}""", "a", false), "string \"true\" resolves to true");
        AssertFalse(GetBool("""{"a":"false"}""", "a", true), "string \"false\" resolves to false");

        // Surrounding whitespace is trimmed (\t and \n are JSON escapes here).
        AssertTrue(GetBool("""{"a":" true "}""", "a", false), "padded \" true \" resolves to true");
        AssertFalse(GetBool("""{"a":"\tfalse\n"}""", "a", true), "tab/newline padded \"false\" resolves to false");

        // Casing is ignored.
        AssertTrue(GetBool("""{"a":"TRUE"}""", "a", false), "string \"TRUE\" resolves to true");
        AssertFalse(GetBool("""{"a":"False"}""", "a", true), "string \"False\" resolves to false");
        AssertTrue(GetBool("""{"a":" True "}""", "a", false), "string \" True \" resolves to true");

        // Only the two literals are accepted: no synonym expansion.
        AssertFalse(GetBool("""{"a":"yes"}""", "a", false), "\"yes\" falls back");
        AssertTrue(GetBool("""{"a":"1"}""", "a", true), "\"1\" falls back");
        AssertTrue(GetBool("""{"a":"on"}""", "a", true), "\"on\" falls back");
        AssertTrue(GetBool("""{"a":""}""", "a", true), "empty string falls back");
        AssertTrue(GetBool("""{"a":"   "}""", "a", true), "whitespace-only string falls back");

        // Other value kinds still fall back.
        AssertTrue(GetBool("""{"a":1}""", "a", true), "number falls back");
        AssertTrue(GetBool("""{"a":null}""", "a", true), "null falls back");
        AssertTrue(GetBool("""{"a":{}}""", "a", true), "object falls back");
        AssertTrue(GetBool("""{"a":[]}""", "a", true), "array falls back");

        // Missing property and non-object elements fall back.
        AssertTrue(GetBool("""{"b":"true"}""", "a", true), "missing property keeps fallback true");
        AssertFalse(GetBool("""{"b":"true"}""", "a", false), "missing property keeps fallback false");
        AssertTrue(GetBool("""[1,2]""", "a", true), "non-object element falls back");
        AssertTrue(GetBool("\"text\"", "a", true), "string element falls back");

        // A resolvable value ignores the fallback entirely.
        AssertTrue(GetBool("""{"a":"true"}""", "a", true), "explicit true ignores fallback");
        AssertFalse(GetBool("""{"a":"false"}""", "a", false), "explicit false ignores fallback");
    }

    /// <summary>
    /// S-207：BuildJsonElement 只建 writer，不给外壳。忘写 StartObject 的回调会在第一个
    /// 属性名上抛 InvalidOperationException；真机 AOT 打包后这条信息退化成
    /// 「CannotWritePropertyWithinArray, None」，认不出是哪个调用点。这里把这条约定钉住。
    /// </summary>
    private static void RunJsonWriterEnvelopeSuite()
    {
        var threw = false;
        try
        {
            WorkerJsonHelper.BuildJsonElement(writer => writer.WriteString("a", "b"));
        }
        catch (InvalidOperationException)
        {
            threw = true;
        }

        Assert(threw, "a callback that starts with a property name must throw");

        var withEnvelope = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("a", "b");
            writer.WriteEndObject();
        });
        Assert(withEnvelope.ValueKind == JsonValueKind.Object, "an enveloped callback builds an object");
        Assert(
            withEnvelope.TryGetProperty("a", out var value) && value.GetString() == "b",
            "the enveloped callback keeps its payload");

        var arrayEnvelope = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartArray();
            writer.WriteStringValue("x");
            writer.WriteEndArray();
        });
        Assert(arrayEnvelope.ValueKind == JsonValueKind.Array, "an array pair builds an array");
    }

    private static bool GetBool(string json, string name, bool fallback)
    {
        using var document = JsonDocument.Parse(json);
        return JsonHelpers.GetBool(document.RootElement, name, fallback);
    }

    private static void AssertTrue(bool value, string message)
    {
        Assert(value, $"expected true: {message}");
    }

    private static void AssertFalse(bool value, string message)
    {
        Assert(!value, $"expected false: {message}");
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
        _passed++;
    }
}
