using System.Security.Cryptography;
using System.Text;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// 落盘引用。<see cref="Locator"/> 对消费方不透明——渲染给模型的一律是
/// <see cref="RetrievalHint"/>，这样将来换存储后端不必改提示词。
/// </summary>
internal sealed record SpillRef(string Locator, int Bytes, string RetrievalHint);

/// <summary>
/// 把过大的工具输出写入会话私有的 spill 目录，供模型按需取回，而不是在内联结果里丢掉中间部分。
///
/// 设计对齐 deepseek-harness 的 spill-local：按会话隔离、独占创建、权限只给所有者。
/// 这里是**尽力而为**的一环——任何失败都直接抛出，由调用方退回原有的内联截断，
/// 绝不因为落盘失败而把一次成功的工具调用变成错误。
/// </summary>
internal static class SpillStore
{
    private const string SpillDirName = "spill";

    internal static SpillRef SaveText(string sessionId, string? suggestedName, string content)
    {
        ArgumentException.ThrowIfNullOrEmpty(sessionId);

        var sessionDir = WishfulClawDataDir.Resolve(SpillDirName, "session-" + HashSessionId(sessionId));
        Directory.CreateDirectory(sessionDir);
        RestrictDirectory(sessionDir);

        var fileName = Guid.NewGuid().ToString("N")[..8] + "-" + SanitizeName(suggestedName);
        var path = Path.Combine(sessionDir, fileName);
        var bytes = Encoding.UTF8.GetBytes(content);

        // 独占创建：CreateNew 在目标已存在（含预埋的符号链接）时直接失败，
        // 避免写入被重定向到会话目录之外。
        using (var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            stream.Write(bytes, 0, bytes.Length);
        }

        RestrictFile(path);
        return new SpillRef(path, bytes.Length, BuildRetrievalHint(path));
    }

    /// <summary>会话目录名用 sessionId 的哈希，避免会话标示本身泄露到磁盘路径上。</summary>
    private static string HashSessionId(string sessionId)
        => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(sessionId)));

    /// <summary>
    /// 把建议名压成单个安全路径段：先取 basename 去掉任何目录成分，再逐字符过滤。
    /// 输入来自工具名，但仍按不可信处理——绝不允许它把文件写出会话目录。
    /// </summary>
    private static string SanitizeName(string? suggestedName)
    {
        if (string.IsNullOrWhiteSpace(suggestedName))
            return "output.txt";

        var name = Path.GetFileName(suggestedName.Trim());
        var sb = new StringBuilder(name.Length);
        foreach (var ch in name)
            sb.Append(char.IsLetterOrDigit(ch) || ch is '.' or '-' or '_' ? ch : '_');

        var safe = sb.ToString().Trim('.', '_');
        if (safe.Length == 0)
            return "output.txt";
        return safe.Length > 64 ? safe[..64] : safe;
    }

    private static string BuildRetrievalHint(string path)
        => "read it back with Read(file_path: \"" + path + "\", offset: 1, limit: 200), "
            + "or Grep(file_path: \"" + path + "\", pattern: \"...\") to search inside it";

    // 下面两个只做「尽力而为」的权限收紧：Windows 上用户目录本身已按用户隔离，
    // 且 ACL 语义与 Unix 不同，这里不强行改写；非 Windows 设成仅所有者可访问，
    // 失败也只是权限没收到最紧，不构成让调用失败的理由。
    private static void RestrictDirectory(string path)
    {
        if (OperatingSystem.IsWindows())
            return;

        try
        {
            File.SetUnixFileMode(
                path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        }
        catch (Exception) { }
    }

    private static void RestrictFile(string path)
    {
        if (OperatingSystem.IsWindows())
            return;

        try
        {
            File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }
        catch (Exception) { }
    }
}
