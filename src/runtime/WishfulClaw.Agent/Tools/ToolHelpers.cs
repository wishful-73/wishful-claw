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
    /// 保留目标文件原有的 UTF-8 BOM 状态（iter-32 S-80）。编辑工具不该顺手改掉文件的
    /// 编码特征：`.ps1` / `.bat` 这类脚本丢了 BOM 会乱码、甚至执行失败；而不带 BOM 的
    /// 文件被补上一个，也会在 diff 里留下噪音。文件不存在（新建）时按无 BOM。
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

        var keepBom = await HasUtf8BomAsync(path, cancellationToken);

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
