// S-200 回归：Grep / Glob / LS 在 path 指向「真实文件」时的行为。
//
// 现象：Directory.Exists(<真实文件>) 恒为 false，三个工具于是共用一句不成立的
// 「Directory not found」，把「这是文件」错报成「这路径不存在」。
// 本套件锁住修后行为：
//   - Grep 传真实文件 ⇒ 单文件模式（行前缀是文件名，file_pattern 被忽略）；
//   - Glob / LS 传真实文件 ⇒ 「Not a directory: … is a file.」（不发明单文件语义）；
//   - 路径真不存在 ⇒ 三处统一「Path not found: {root}」（不再出现 Directory not found）；
//   - 目录模式行为一字不变（相对路径基准、file_pattern 过滤与提示、node_modules 显式 root
//     可搜、默认排除仍生效）—— 这是回归护栏。

using System;
using System.IO;
using System.Text.Json;
using WishfulClaw.Agent.Tools.FileTools;
using WishfulClaw.Agent.Tools.SearchTools;
using WishfulClaw.Core.Tools;

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

var tmp = Path.Combine(Path.GetTempPath(), "wc-searchtarget-" + Guid.NewGuid().ToString("N"));
var sub = Path.Combine(tmp, "sub");
var pkg = Path.Combine(tmp, "node_modules", "pkg");
Directory.CreateDirectory(sub);
Directory.CreateDirectory(pkg);

var topJson = Path.Combine(tmp, "top.json");
var innerTxt = Path.Combine(sub, "inner.txt");
var blobExe = Path.Combine(tmp, "blob.exe");
var indexJs = Path.Combine(pkg, "index.js");

File.WriteAllText(topJson, "{ \"needle\": 1 }\n");
File.WriteAllText(innerTxt, "needle here\n");
File.WriteAllText(blobExe, "needle\n");
File.WriteAllText(indexJs, "needle\n");

var context = new ToolExecutionContext(WorkingFolder: tmp, SandboxEnabled: false);
var grepTool = new GrepTool();
var globTool = new GlobTool();
var lsTool = new FileListTool();

try
{
    // #1 Grep 传真实文件 ⇒ 命中，行前缀是文件名（不是 "." / 空 / 绝对路径）
    var r1 = RunGrep(topJson, "needle");
    Check(!r1.IsError, "#1 grep single file is not an error");
    Check(r1.Content.StartsWith("top.json:1:", StringComparison.Ordinal), "#1 grep single file starts with 'top.json:1:'");
    Check(!r1.Content.Contains(Abs(tmp), StringComparison.Ordinal), "#1 grep single file does not print an absolute path");
    Check(!r1.Content.Contains("not found", StringComparison.OrdinalIgnoreCase), "#1 grep single file has no 'not found'");

    // #2 单文件模式忽略 file_pattern
    var r2 = RunGrep(topJson, "needle", "*.ts");
    Check(!r2.IsError, "#2 grep single file with file_pattern is not an error");
    Check(r2.Content.StartsWith("top.json:1:", StringComparison.Ordinal), "#2 file_pattern is ignored for a single file");

    // #3 单文件无命中 ⇒ 干净的 No matches found.
    var r3 = RunGrep(topJson, "zzz");
    Check(!r3.IsError, "#3 grep single file with no match is not an error");
    Check(r3.Content == "No matches found.", "#3 grep single file with no match is exactly 'No matches found.'");

    // #4 真不存在 ⇒ Path not found（不再说 Directory not found）
    var r4 = RunGrep(Path.Combine(tmp, "nope", "x.txt"), "needle");
    Check(r4.IsError, "#4 grep missing path is an error");
    Check(r4.Content.Contains("Path not found", StringComparison.Ordinal), "#4 grep missing path says 'Path not found'");
    Check(!r4.Content.Contains("Directory not found", StringComparison.Ordinal), "#4 grep missing path has no 'Directory not found'");

    // #5 目录模式回归：相对路径仍以 root 为基准
    var r5 = RunGrep(tmp, "needle");
    Check(!r5.IsError, "#5 grep directory is not an error");
    Check(r5.Content.Contains("sub/inner.txt:1:", StringComparison.Ordinal), "#5 directory mode keeps root-relative paths");
    Check(!r5.Content.Contains(Abs(tmp), StringComparison.Ordinal), "#5 directory mode does not print an absolute path");

    // #6 目录模式 + file_pattern 全拒 ⇒ PatternRejected 提示还活着
    var r6 = RunGrep(tmp, "needle", "*.ts");
    Check(!r6.IsError, "#6 grep directory with rejecting file_pattern is not an error");
    Check(r6.Content.Contains("matched none of the", StringComparison.Ordinal), "#6 PatternRejected hint still fires");

    // #7 二进制单文件 ⇒ 明确文案（不当文本读）
    var r7 = RunGrep(blobExe, "needle");
    Check(r7.IsError, "#7 grep binary single file is an error");
    Check(r7.Content.Contains("binary", StringComparison.OrdinalIgnoreCase), "#7 binary file message names 'binary'");

    // #8 node_modules 作显式 root ⇒ 能搜到（需求 §2.1）
    var r8 = RunGrep(Path.Combine(tmp, "node_modules"), "needle");
    Check(!r8.IsError, "#8 grep node_modules as explicit root is not an error");
    Check(r8.Content.Contains("pkg/index.js:1:", StringComparison.Ordinal), "#8 node_modules as explicit root is searchable");

    // #9 默认排除仍生效（父目录 root 下不搜 node_modules）
    var r9 = RunGrep(tmp, "needle");
    Check(!r9.Content.Contains("node_modules", StringComparison.Ordinal), "#9 node_modules excluded by default under a parent root");

    // #10 Glob 传文件 ⇒ Not a directory（不加单文件模式）
    var r10 = RunGlob(topJson, "*.json");
    Check(r10.IsError, "#10 glob on a file is an error");
    Check(r10.Content.Contains("Not a directory", StringComparison.Ordinal), "#10 glob on a file says 'Not a directory'");
    Check(!r10.Content.Contains("Directory not found", StringComparison.Ordinal), "#10 glob on a file has no 'Directory not found'");

    // #11 Glob 真不存在 ⇒ Path not found
    var r11 = RunGlob(Path.Combine(tmp, "nope"), "**/*.txt");
    Check(r11.IsError, "#11 glob missing path is an error");
    Check(r11.Content.Contains("Path not found", StringComparison.Ordinal), "#11 glob missing path says 'Path not found'");
    Check(!r11.Content.Contains("Directory not found", StringComparison.Ordinal), "#11 glob missing path has no 'Directory not found'");

    // #12 Glob 目录模式回归
    var r12 = RunGlob(tmp, "**/*.txt");
    Check(!r12.IsError, "#12 glob directory is not an error");
    Check(r12.Content.Replace('\\', '/').Contains("sub/inner.txt", StringComparison.Ordinal), "#12 glob finds 'sub/inner.txt'");

    // #13 LS 传文件 ⇒ Not a directory（不加单文件模式）
    var r13 = RunLs(topJson);
    Check(r13.IsError, "#13 ls on a file is an error");
    Check(r13.Content.Contains("Not a directory", StringComparison.Ordinal), "#13 ls on a file says 'Not a directory'");
    Check(!r13.Content.Contains("Directory not found", StringComparison.Ordinal), "#13 ls on a file has no 'Directory not found'");

    // #14 LS 真不存在 ⇒ Path not found
    var r14 = RunLs(Path.Combine(tmp, "nope"));
    Check(r14.IsError, "#14 ls missing path is an error");
    Check(r14.Content.Contains("Path not found", StringComparison.Ordinal), "#14 ls missing path says 'Path not found'");
    Check(!r14.Content.Contains("Directory not found", StringComparison.Ordinal), "#14 ls missing path has no 'Directory not found'");

    // #15 LS 目录模式回归
    var r15 = RunLs(tmp);
    Check(!r15.IsError, "#15 ls directory is not an error");
    Check(r15.Content.Contains("top.json", StringComparison.Ordinal), "#15 ls lists 'top.json'");
}
finally
{
    try
    {
        Directory.Delete(tmp, recursive: true);
    }
    catch
    {
        // 临时目录清不掉不影响断言结果。
    }
}

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

ToolResult RunGrep(string path, string pattern, string? filePattern = null)
{
    var input = Input(new { pattern, path, file_pattern = filePattern });
    return grepTool.ExecuteAsync(input, context).GetAwaiter().GetResult();
}

ToolResult RunGlob(string path, string pattern)
{
    var input = Input(new { pattern, path });
    return globTool.ExecuteAsync(input, context).GetAwaiter().GetResult();
}

ToolResult RunLs(string path)
{
    var input = Input(new { path });
    return lsTool.ExecuteAsync(input, context).GetAwaiter().GetResult();
}

static JsonElement Input(object payload)
{
    using var document = JsonDocument.Parse(JsonSerializer.Serialize(payload));
    return document.RootElement.Clone();
}

// 命中行用的是 '/'-归一后的相对路径；把临时目录同样归一，用来断言「没退化成绝对路径」。
static string Abs(string path) => path.Replace('\\', '/');
