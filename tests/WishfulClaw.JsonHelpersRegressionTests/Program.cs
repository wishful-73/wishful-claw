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
            RunPropertyValueParsingSuite();
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

    /// <summary>
    /// S-353：渠道工具的参数名在 schema（驼峰，如 filePath）与路由代码（蛇形，如 file_path）之间打架，
    /// 而 JsonHelpers 全是 TryGetProperty 精确匹配。修法是在调用侧先做驼峰/蛇形归一，再把**取出来的值**
    /// 交给 As* 这一族解析。这里钉住 As* 的语义 —— 它一旦变化，「名对了但值丢了」会以另一种方式复发。
    /// </summary>
    private static void RunPropertyValueParsingSuite()
    {
        using var document = JsonDocument.Parse("""
            {
              "s": " hello ",
              "n": 42,
              "numText": "42",
              "b": true,
              "bText": " FALSE ",
              "arr": ["a", "b"],
              "csv": "a, b ,,c",
              "emptyCsv": "   ",
              "mixed": ["a", 3, "", "b"],
              "obj": { "x": 1 }
            }
            """);
        var root = document.RootElement;

        // AsString: 只认字符串，不做 trim（trim 是调用侧的事）。
        Assert(JsonHelpers.AsString(root.GetProperty("s")) == " hello ", "AsString keeps the raw string");
        Assert(JsonHelpers.AsString(root.GetProperty("n")) is null, "AsString rejects numbers");
        Assert(JsonHelpers.AsString(root.GetProperty("b")) is null, "AsString rejects booleans");

        // AsIntNullable: 数字和数字文本都收。
        Assert(JsonHelpers.AsIntNullable(root.GetProperty("n")) == 42, "AsIntNullable reads a number");
        Assert(JsonHelpers.AsIntNullable(root.GetProperty("numText")) == 42, "AsIntNullable reads numeric text");
        Assert(JsonHelpers.AsIntNullable(root.GetProperty("s")) is null, "AsIntNullable rejects non-numeric text");
        Assert(JsonHelpers.AsIntNullable(root.GetProperty("b")) is null, "AsIntNullable rejects booleans");

        // AsBool: 委托给 ParseBoolText，行为必须与 GetBool 一致。
        AssertTrue(JsonHelpers.AsBool(root.GetProperty("b"), false), "AsBool reads a native true");
        AssertFalse(JsonHelpers.AsBool(root.GetProperty("bText"), true), "AsBool reads padded \" FALSE \"");
        AssertTrue(JsonHelpers.AsBool(root.GetProperty("n"), true), "AsBool falls back on a number");

        // AsStringArray: 数组元素与逗号分隔文本都收，空串与空白元素丢弃（S-353 的 FeishuAtMember 靠这条）。
        var arr = JsonHelpers.AsStringArray(root.GetProperty("arr"));
        Assert(arr is ["a", "b"], "AsStringArray reads array elements in order");
        var csv = JsonHelpers.AsStringArray(root.GetProperty("csv"));
        Assert(csv is ["a", "b", "c"], "AsStringArray splits comma text and drops empties");
        Assert(JsonHelpers.AsStringArray(root.GetProperty("emptyCsv")).Length == 0, "AsStringArray drops whitespace-only text");
        var mixed = JsonHelpers.AsStringArray(root.GetProperty("mixed"));
        Assert(mixed is ["a", "b"], "AsStringArray drops non-strings and empty entries");
        Assert(JsonHelpers.AsStringArray(root.GetProperty("obj")).Length == 0, "AsStringArray rejects objects");

        // Get* 必须与 As* 同源 —— 曾经是两份实现，正是它们分叉才养出 S-353。
        using var one = JsonDocument.Parse("""{"s":" hello ","b":" FALSE ","n":"42","arr":["a","b"]}""");
        var oneRoot = one.RootElement;
        Assert(JsonHelpers.GetString(oneRoot, "s") == JsonHelpers.AsString(oneRoot.GetProperty("s")), "GetString delegates to AsString");
        Assert(
            JsonHelpers.GetBool(oneRoot, "b", true) == JsonHelpers.AsBool(oneRoot.GetProperty("b"), true),
            "GetBool delegates to AsBool");
        Assert(
            JsonHelpers.GetIntNullable(oneRoot, "n") == JsonHelpers.AsIntNullable(oneRoot.GetProperty("n")),
            "GetIntNullable delegates to AsIntNullable");
        Assert(
            JsonHelpers.GetStringArray(oneRoot, "arr").SequenceEqual(JsonHelpers.AsStringArray(oneRoot.GetProperty("arr"))),
            "GetStringArray delegates to AsStringArray");
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
