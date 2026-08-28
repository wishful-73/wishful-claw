namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Resolves file paths for memory storage based on scope.
/// Global scope: ~/.wishful-claw/
/// Local project scope: {workingFolder}/.wishful-claw/
/// SSH project scope: ~/.wishful-claw/projects/{projectId}/
/// </summary>
public static class MemoryPathResolver
{
    /// <summary>
    /// Global memory root: ~/.wishful-claw/
    /// </summary>
    public static string GlobalRoot =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".wishful-claw");

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

        // Local project scope: "project:{workingFolder}" → {workingFolder}/.wishful-claw/
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
            return Path.Combine(Path.GetFullPath(workingFolder), ".wishful-claw");
        }

        return GlobalRoot;
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
