using System.Collections.Concurrent;
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
    /// 把一段文本塞进手搓的 JSON 字符串字面量里。文件类工具用拼串回结果，
    /// 路径里的反斜杠（Windows）必须转义，否则结果不是合法 JSON。
    /// </summary>
    public static string EscapeJson(string value)
    {
        return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
    }

    /// <summary>
    /// 按路径串行化的写入门（S-219）。
    ///
    /// 同一文件被并发写入时必须排队：同一个 turn 里并发发出多个 Edit 打同一个文件时，
    /// 第一个拿到写句柄，其余全部撞 Win32 <c>ERROR_SHARING_VIOLATION</c>(32)，
    /// 表现为 <c>IO_SharingViolation_File</c>。这不是外部程序造成的，是我们自己撞自己。
    ///
    /// 键用<b>规范化绝对路径</b>，比较器 <see cref="StringComparer.OrdinalIgnoreCase"/> ——
    /// Windows 文件系统不区分大小写，用默认比较器会让 <c>A.md</c> 与 <c>a.md</c> 各拿一把锁，
    /// 绕过互斥。条目数受沙箱约束有上限，且每项极小，不做清理。
    ///
    /// 锁的粒度是「每路径一把」，不是全局一把 —— 写不同文件必须仍然并行。
    /// </summary>
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> WriteGates =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Win32 ERROR_SHARING_VIOLATION：别的进程/句柄正占着这个文件。</summary>
    private const int ErrorSharingViolation = 32;

    /// <summary>Win32 ERROR_LOCK_VIOLATION：文件区域被区域锁占住。</summary>
    private const int ErrorLockViolation = 33;

    /// <summary>共享冲突的退避间隔（毫秒）。只覆盖真实外部占用场景，进程内并发由 <see cref="WriteGates"/> 挡住。</summary>
    private static readonly int[] WriteSharingRetryDelaysMs = [50, 100, 200, 400];

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
    ///
    /// 并发：整段「读 BOM 状态 → 写 → flush」都在路径锁内，调用方不需要自己排队（S-219）。
    /// </summary>
    public static Task WriteAndFlushAsync(string path, string content, CancellationToken cancellationToken)
        => WithWriteGateAsync(
            path,
            () => WriteWithSharingRetryAsync(path, content, cancellationToken),
            cancellationToken);

    /// <summary>
    /// 把「读 → 改 → 写」整段纳入同一把路径锁（S-219），无返回值版本。
    ///
    /// 只锁写入挡不住丢更新：两个 Edit 各自读到同一份旧内容，再串行整文件覆盖，
    /// 后写胜出、先写的改动静默消失 —— 这比原来报 SharingViolation 更糟。
    /// 所以凡是「先读再改再写」的工具，都必须把整段包进来，而不是只调 <see cref="WriteAndFlushAsync"/>。
    ///
    /// <b>不要在 action 内再调 <see cref="WriteAndFlushAsync"/></b> —— 同一路径会自锁死；
    /// 锁内落盘用 <see cref="WriteWithSharingRetryAsync"/>。
    /// </summary>
    internal static async Task WithWriteGateAsync(
        string path,
        Func<Task> action,
        CancellationToken cancellationToken)
    {
        var gate = WriteGates.GetOrAdd(Path.GetFullPath(path), static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await action().ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }

    /// <summary>同 <see cref="WithWriteGateAsync"/>，带返回值的版本（读改写工具要往外交 ToolResult）。</summary>
    internal static async Task<T> WithWriteGateAsync<T>(
        string path,
        Func<Task<T>> action,
        CancellationToken cancellationToken)
    {
        var result = default(T)!;
        await WithWriteGateAsync(
            path,
            async () => result = await action().ConfigureAwait(false),
            cancellationToken).ConfigureAwait(false);
        return result;
    }

    /// <summary>
    /// 真正落盘。撞到共享冲突时按 <see cref="WriteSharingRetryDelaysMs"/> 退避重试，
    /// 重试耗尽后抛可读错误 —— raw「IO_SharingViolation_File」对用户和模型都没有信息量。
    ///
    /// 本方法<b>不取路径锁</b>：调用方要么经 <see cref="WriteAndFlushAsync"/>（已持锁），
    /// 要么已经在 <see cref="WithWriteGateAsync{T}"/> 里（读改写工具），锁内再取会自锁死。
    /// </summary>
    internal static async Task WriteWithSharingRetryAsync(
        string path,
        string content,
        CancellationToken cancellationToken)
    {
        for (var attempt = 0; ; attempt++)
        {
            try
            {
                await WriteOnceAsync(path, content, cancellationToken).ConfigureAwait(false);
                return;
            }
            catch (IOException ex) when (IsSharingViolation(ex) && attempt < WriteSharingRetryDelaysMs.Length)
            {
                await Task.Delay(WriteSharingRetryDelaysMs[attempt], cancellationToken).ConfigureAwait(false);
            }
            catch (IOException ex) when (IsSharingViolation(ex))
            {
                throw new IOException(BuildSharingViolationMessage(path), ex);
            }
        }
    }

    private static async Task WriteOnceAsync(string path, string content, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var keepBom = IsBomSensitiveScript(path) && await HasUtf8BomAsync(path, cancellationToken);

        // FileShare.Read 是刻意的：它挡住「外部程序在我们写入时并发修改」这一类真实风险。
        // 千万不要为了绕开共享冲突把它放宽成 FileShare.ReadWrite —— 那样两个 Edit 会各自
        // 基于旧内容做替换，后者整文件覆盖前者，前者的改动静默消失（比报错更糟）。
        // 进程内并发由 WriteGates 解决，外部占用由退避重试解决（S-219）。
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

    /// <summary>HResult 的低 16 位就是 Win32 错误码，据此判定共享/锁冲突。</summary>
    private static bool IsSharingViolation(IOException ex)
    {
        var code = ex.HResult & 0xFFFF;
        return code is ErrorSharingViolation or ErrorLockViolation;
    }

    private static string BuildSharingViolationMessage(string path)
    {
        return $"文件被其它程序占用，无法写入：{path}。可能是编辑器、同步盘或杀毒软件正在使用它，稍后重试。";
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
