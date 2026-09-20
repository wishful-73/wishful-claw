
namespace WishfulClaw.Agent.Tools;

/// <summary>
/// 「工作目录父目录 + 一级子目录」的落点校验（iter-33 S-103）。
///
/// 全局 PM 的 <c>create_project</c> 只提交名字，路径由这里拼 —— 沙箱只校验工具参数里的路径，
/// 而本工具的参数里根本没有路径，所以它的边界**完全落在这一个纯函数上**（见需求文档 S-103
/// 的风险项）。因此它必须自己把住三件事：父目录可用、目录名合法、结果确实是父目录的直接子目录。
///
/// 纯函数（不碰文件系统、不碰 DB）是为了可断言 —— 执行器的方法在 Worker 里够不着，
/// 同 <c>MemoryTimeFilter</c>（S-101）的理由。
/// </summary>
public static class ProjectCreationPolicy
{
    private static readonly HashSet<string> ReservedDeviceNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "CON", "PRN", "AUX", "NUL",
        "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
    };

    /// <summary>解析结果：<see cref="Path"/> 与 <see cref="Error"/> 恰有一个非空。</summary>
    public readonly record struct Target(string? Path, string? Error)
    {
        public static Target Fail(string error) => new(null, error);

        public static Target Ok(string path) => new(path, null);
    }

    /// <summary>
    /// 算出新项目的目录（绝对路径）。<paramref name="folderName"/> 缺省时由
    /// <paramref name="name"/> 派生。
    ///
    /// 显式传的 folderName 里出现分隔符、<c>..</c> 或盘符一律**拒绝** —— 那是想逃出父目录的意图，
    /// 静默改写等于把越界当笔误；其它非法字符（<c>&lt;&gt;:"|?*</c> 等）按 Windows 的规矩换成 <c>-</c>。
    /// </summary>
    public static Target Resolve(string? parentDirectory, string? name, string? folderName)
    {
        if (string.IsNullOrWhiteSpace(parentDirectory))
        {
            return Target.Fail("The projects parent directory is not usable; set it in Settings first.");
        }

        // 全限定，而不是 IsPathRooted：`C:` 在 Windows 上算 rooted，但它的含义取决于进程当前目录 ——
        // 手写进 config.json 会让「父目录」随启动目录漂移，设置页也该被这条挡回去。
        if (!Path.IsPathFullyQualified(parentDirectory.Trim()))
        {
            return Target.Fail(
                $"The projects parent directory must be an absolute path: \"{parentDirectory}\"");
        }

        var displayName = name?.Trim() ?? string.Empty;
        if (displayName.Length == 0)
        {
            return Target.Fail("Field 'name' is required.");
        }

        var requested = folderName?.Trim();
        var folder = requested is { Length: > 0 } ? requested : DeriveFolderName(displayName);

        if (folder.Length == 0)
        {
            return Target.Fail("The folder name is empty after removing characters Windows does not allow.");
        }

        if (LooksLikePathEscape(folder))
        {
            return Target.Fail(
                $"Folder name \"{folder}\" must be a single directory name — path separators, '..' and drive letters are not allowed.");
        }

        var sanitized = Sanitize(folder);
        if (sanitized.Length == 0)
        {
            return Target.Fail("The folder name is empty after removing characters Windows does not allow.");
        }

        if (IsReservedDeviceName(sanitized))
        {
            return Target.Fail(
                $"Folder name \"{sanitized}\" is a reserved Windows device name and cannot be used as a directory.");
        }

        string parentFull;
        string target;
        try
        {
            parentFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parentDirectory));
            target = Path.GetFullPath(Path.Combine(parentFull, sanitized));
        }
        catch (Exception ex)
        {
            return Target.Fail($"Could not resolve the project directory: {ex.Message}");
        }

        // 最后一道：结果必须正好是父目录的直接子目录。分隔符前面已经挡了，这里是兜底 ——
        // Windows 的路径规则花样多（尾随点、短名、UNC），不能让任何一条溜出父目录。
        var actualParent = Path.GetDirectoryName(target);
        if (actualParent is null ||
            !string.Equals(
                Path.TrimEndingDirectorySeparator(actualParent),
                parentFull,
                OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal))
        {
            return Target.Fail($"Resolved path \"{target}\" is not a direct child of \"{parentFull}\".");
        }

        return Target.Ok(target);
    }

    /// <summary>
    /// 由显示名派生目录名。与 <c>DbProjectTools.SanitizeProjectName</c>（非法字符换**空格**、
    /// 空则回落 <c>New Project</c>）是两套规则：目录名和显示名本来就不保证相等，工具描述已说明。
    /// </summary>
    public static string DeriveFolderName(string name) => Sanitize(name?.Trim() ?? string.Empty);

    /// <summary>
    /// Windows 保留设备名（<c>CON</c> / <c>NUL</c> / <c>COM1</c> …）。带扩展名同样打不开，
    /// 所以只看第一个点之前那一段。
    ///
    /// 这不是安全问题（<c>D:\parent\CON</c> 的父目录仍然是 <c>D:\parent</c>，跑不出父目录），
    /// 而是可诊断性：不拦下来，agent 只会拿到一句 OS 级报错，不知道该换个名字。
    /// </summary>
    private static bool IsReservedDeviceName(string folder)
    {
        var dot = folder.IndexOf('.');
        var stem = dot >= 0 ? folder[..dot] : folder;
        return ReservedDeviceNames.Contains(stem.Trim());
    }

    private static bool LooksLikePathEscape(string folder) =>
        folder is "." or ".." ||
        folder.Contains('/') ||
        folder.Contains('\\') ||
        folder.Contains(':') ||
        Path.IsPathRooted(folder);

    private static string Sanitize(string raw)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var chars = raw.Select(c => invalid.Contains(c) ? '-' : c).ToArray();
        return new string(chars).Trim().TrimEnd('.', ' ');
    }
}
