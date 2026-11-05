using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Resolves file paths for memory storage based on scope.
/// Global scope: ~/.wishful-claw/
/// Local project scope: {workingFolder}/{project data dir}/ (.wishful-claw packaged, .wishful-claw-dev in dev)
/// SSH project scope: ~/.wishful-claw/projects/{projectId}/
/// </summary>
public static class MemoryPathResolver
{
    /// <summary>
    /// Global memory root: ~/.wishful-claw/
    /// </summary>
    public static string GlobalRoot => WishfulClawDataDir.Root;

    /// <summary>
    /// Resolve the memory root path for a given scope.
    /// </summary>
    /// <param name="scope">"global", "project:{workingFolder}" (local), or "project:ssh:{projectId}" (SSH)</param>
    public static string ResolveRoot(string? scope)
    {
        if (string.IsNullOrWhiteSpace(scope) || scope == "global")
            return GlobalRoot;

        // SSH project scope: "project:ssh:{projectId}" → ~/.wishful-claw/projects/{projectId}/
        if (scope.StartsWith("project:ssh:", StringComparison.OrdinalIgnoreCase))
        {
            var projectId = scope["project:ssh:".Length..];
            // Defense in depth: reject path separators / rooted paths so the
            // SSH scope stays confined to ~/.wishful-claw/projects/.
            if (string.IsNullOrWhiteSpace(projectId)
                || projectId.Contains('\\')
                || projectId.Contains('/')
                || Path.IsPathRooted(projectId)
                || projectId.Contains(".."))
            {
                throw new ArgumentException($"Invalid SSH project scope: {scope}", nameof(scope));
            }
            var root = Path.Combine(GlobalRoot, "projects", projectId);
            var fullRoot = Path.GetFullPath(root);
            if (!fullRoot.StartsWith(Path.GetFullPath(Path.Combine(GlobalRoot, "projects")) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                && !fullRoot.Equals(Path.GetFullPath(Path.Combine(GlobalRoot, "projects")), StringComparison.OrdinalIgnoreCase))
            {
                throw new ArgumentException($"SSH project scope escapes projects root: {scope}", nameof(scope));
            }
            return fullRoot;
        }

        // Local project scope: "project:{workingFolder}" → {workingFolder}/{project data dir}/
        // (.wishful-claw packaged, .wishful-claw-dev in dev — see WishfulClawDataDir.ProjectDirName)
        if (scope.StartsWith("project:", StringComparison.OrdinalIgnoreCase))
        {
            var workingFolder = scope["project:".Length..];
            // Same defense-in-depth as the SSH branch: require a rooted path
            // without traversal segments so a crafted scope cannot smuggle a
            // relative escape (e.g. "project:..\\..\\target").
            if (string.IsNullOrWhiteSpace(workingFolder)
                || !Path.IsPathRooted(workingFolder)
                || workingFolder.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Contains(".."))
            {
                throw new ArgumentException($"Invalid local project scope: {scope}", nameof(scope));
            }
            return WishfulClawDataDir.ProjectRoot(Path.GetFullPath(workingFolder));
        }

        return GlobalRoot;
    }

    /// <summary>
    /// S-314：scope 判定收敛到这里 —— 以前它在 <c>PromptBuilder.BuildMemoryContext</c> 里内联，
    /// 于是「拼提示」和「算 cacheKey」要各写一遍，两处一旦分叉，缓存键就会跟提示内容脱钩，
    /// 表现为改过的记忆永远读不到。判定只看三个入口参数，不依赖 JSON。
    /// </summary>
    /// <param name="sshConnectionId">SSH 项目才有；有 projectId 时优先用它当 scope id。</param>
    /// <param name="projectId">SSH 项目的稳定 id。</param>
    /// <param name="workingFolder">本地项目的工作目录。</param>
    public static string ResolveScope(
        string? sshConnectionId,
        string? projectId,
        string? workingFolder)
    {
        if (!string.IsNullOrWhiteSpace(sshConnectionId))
        {
            // SSH project: memory stored locally under ~/.wishful-claw/projects/{id}/
            // Use projectId if available, otherwise fall back to sshConnectionId
            var scopeId = !string.IsNullOrWhiteSpace(projectId) ? projectId : sshConnectionId;
            return $"project:ssh:{scopeId}";
        }

        if (!string.IsNullOrWhiteSpace(workingFolder))
        {
            // Local project: memory stored under {workingFolder}/{project data dir}/ (.wishful-claw
            // when packaged, .wishful-claw-dev for a dev instance — see WishfulClawDataDir.ProjectDirName)
            return $"project:{workingFolder}";
        }

        return "global";
    }

    /// <summary>
    /// Get the MEMORY.md file path for a scope.
    /// </summary>
    public static string GetMemoryFilePath(string? scope) =>
        Path.Combine(ResolveRoot(scope), "MEMORY.md");

    /// <summary>
    /// Get the memory directory path for a scope.
    /// </summary>
    public static string GetMemoryDir(string? scope) =>
        Path.Combine(ResolveRoot(scope), "memory");
}
