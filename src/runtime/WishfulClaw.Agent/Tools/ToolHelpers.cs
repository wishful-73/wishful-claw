using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools;

/// <summary>
/// Shared helper methods for tool implementations.
/// </summary>
internal static class ToolHelpers
{
    public static string? GetString(JsonElement element, string name)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.String)
        {
            return prop.GetString();
        }
        return null;
    }

    public static int GetInt(JsonElement element, string name, int defaultValue)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.Number)
        {
            return prop.GetInt32();
        }
        return defaultValue;
    }

    public static long GetLong(JsonElement element, string name, long defaultValue = 0)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop) &&
            prop.ValueKind == JsonValueKind.Number)
        {
            return prop.GetInt64();
        }
        return defaultValue;
    }

    public static bool GetBool(JsonElement element, string name, bool defaultValue)
    {
        if (element.ValueKind == JsonValueKind.Object &&
            element.TryGetProperty(name, out var prop))
        {
            if (prop.ValueKind == JsonValueKind.True) return true;
            if (prop.ValueKind == JsonValueKind.False) return false;
        }
        return defaultValue;
    }

    /// <summary>
    /// 解析文件类工具（Read / Write / Edit / NotebookEdit / LS ...）的路径参数。
    /// 相对路径挂在 context.WorkingFolder 下，最后统一过一遍沙箱边界。
    /// </summary>
    public static string? ResolveFilePath(JsonElement input, ToolExecutionContext context)
    {
        var path = GetString(input, "file_path") ?? GetString(input, "path");
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        if (!Path.IsPathRooted(path) && !string.IsNullOrWhiteSpace(context.WorkingFolder))
        {
            path = Path.Combine(context.WorkingFolder, path);
        }

        var resolved = Path.GetFullPath(path);
        EnsureInsideSandbox(resolved, context);
        return resolved;
    }

    /// <summary>解析 Glob / Grep 的搜索根。</summary>
    public static string ResolveSearchPath(JsonElement input, ToolExecutionContext context)
    {
        var workingFolder = context.WorkingFolder;
        var path = GetString(input, "path")?.Trim() ?? string.Empty;

        if (string.IsNullOrWhiteSpace(path) || path == ".")
        {
            path = workingFolder ?? System.Environment.CurrentDirectory;
        }

        if (!Path.IsPathRooted(path) && !string.IsNullOrWhiteSpace(workingFolder))
        {
            path = Path.Combine(workingFolder, path);
        }

        var resolved = Path.GetFullPath(path);
        EnsureInsideSandbox(resolved, context);
        return resolved;
    }

    /// <summary>
    /// 沙箱边界判定。开关关掉、或没有可用根目录（项目列表为空）时直接放行；
    /// 越界抛 <see cref="PathSandboxViolationException"/>，由分发层转成工具错误。
    /// </summary>
    public static void EnsureInsideSandbox(string resolvedPath, ToolExecutionContext context)
    {
        if (!context.SandboxEnabled) return;
        var roots = context.SandboxRoots ?? [];
        if (PathBoundary.IsInsideAnyRoot(resolvedPath, roots)) return;
        throw new PathSandboxViolationException(PathBoundary.BuildViolationMessage(resolvedPath, roots));
    }

    public static JsonElement ParseSchema(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    /// <summary>
    /// Writes text to a file and flushes to disk immediately.
    /// Uses FileStream with Flush(true) to ensure subsequent reads
    /// always see the updated content (fixes Edit->Read cache issue).
    ///
    /// 默认一律不写 UTF-8 BOM（iter-32 S-80）：BOM 会让严格解析器直接读不动
    /// （渲染端 `memory-json-parsers.ts` 就得靠 `replace(/^\uFEFF/, '')` 兜底），
    /// 也会在 diff 里留噪音。只有 <see cref="BomSensitiveExtensions"/> 里的脚本
    /// 例外 —— 它们保留目标文件原本的状态（原本没有也不补）。
    ///
    /// 注意：这里只能靠 FileStream 手写 preamble —— <c>Encoding.UTF8.GetBytes</c> 不产 BOM。
    /// </summary>
    public static async Task WriteAndFlushAsync(string path, string content, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var keepBom = IsBomSensitiveScript(path) && await HasUtf8BomAsync(path, cancellationToken);

        await using var fs = new FileStream(
            path,
            FileMode.Create,
            FileAccess.Write,
            FileShare.Read,
            bufferSize: 4096,
            useAsync: true);

        if (keepBom)
        {
            await fs.WriteAsync(Utf8BomBytes.AsMemory(0, Utf8BomBytes.Length), cancellationToken);
        }

        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        await fs.WriteAsync(bytes.AsMemory(0, bytes.Length), cancellationToken);
        await fs.FlushAsync(cancellationToken);
        fs.Flush(true);
    }

    /// <summary>UTF-8 BOM 的三字节序列。</summary>
    private static readonly byte[] Utf8BomBytes = [0xEF, 0xBB, 0xBF];

    /// <summary>
    /// 靠 BOM 才能被正确识别为 UTF-8 的脚本扩展名。Windows PowerShell 5.1 与 cmd
    /// 读这些文件时不看 BOM 就按系统 ANSI 码页解，带中文的脚本会乱码甚至执行失败。
    /// 只有这几类保留目标文件原本的 BOM 状态，其余扩展名一律不写。
    /// </summary>
    private static readonly string[] BomSensitiveExtensions = [".ps1", ".bat", ".cmd"];

    private static bool IsBomSensitiveScript(string path)
    {
        var extension = Path.GetExtension(path);
        return Array.Exists(
            BomSensitiveExtensions,
            candidate => string.Equals(candidate, extension, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// 目标文件是否以 UTF-8 BOM 开头（不存在则 false）。读不动一律当「无」——
    /// 探测失败不该让本来能写成功的写入失败。
    /// </summary>
    private static async Task<bool> HasUtf8BomAsync(string path, CancellationToken cancellationToken)
    {
        try
        {
            if (!File.Exists(path))
            {
                return false;
            }

            var head = new byte[3];
            await using var fs = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite,
                bufferSize: 3,
                useAsync: true);
            var read = await fs.ReadAsync(head.AsMemory(0, 3), cancellationToken);
            return read == 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return false;
        }
    }
}
