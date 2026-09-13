using WishfulClaw.Contracts;

namespace WishfulClaw.Infrastructure.Storage;

public static class WishfulClawDataDir
{
    public static string Root
    {
        get
        {
            var configured = Environment.GetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar);
            if (!string.IsNullOrWhiteSpace(configured))
                return Path.GetFullPath(configured);

            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                WishfulClawPaths.DataDirName);
        }
    }

    public static string Resolve(params string[] segments)
    {
        var path = Root;
        foreach (var segment in segments)
            path = Path.Combine(path, segment);
        return path;
    }

    /// <summary>
    /// The project-local data directory — <c>{workingFolder}/.wishful-claw</c> — created on first use
    /// and hidden on Windows. Returns the directory so callers can combine their own subfolder onto it.
    ///
    /// Hidden matters because this directory sits inside the user's own repository: a visible
    /// <c>.wishful-claw</c> among their sources reads as clutter, and what the agent keeps in it
    /// (plans, notes, status, goals) is working state rather than project content. Unix hides it for
    /// free via the leading dot; Windows needs the attribute set explicitly.
    ///
    /// Idempotent, and deliberately not a one-shot hook: a directory created before this existed is
    /// already visible, so every call re-checks the attribute instead of assuming the first creation
    /// got it right. That is also what makes it safe to call from more than one entry point.
    /// </summary>
    public static string EnsureProjectRoot(string workingFolder)
    {
        var root = Path.Combine(workingFolder, WishfulClawPaths.DataDirName);
        Directory.CreateDirectory(root);
        HideOnWindows(root);
        return root;
    }

    /// <summary>
    /// Sets the hidden attribute on Windows; a no-op elsewhere, where a dot-prefixed name is already
    /// hidden. Failures are swallowed on purpose — the callers are about to write into this directory,
    /// and a directory the user can see is a cosmetic problem, not a reason to fail their work.
    /// </summary>
    public static void HideOnWindows(string directory)
    {
        if (!OperatingSystem.IsWindows()) return;

        try
        {
            var info = new DirectoryInfo(directory);
            if ((info.Attributes & FileAttributes.Hidden) == 0)
            {
                info.Attributes |= FileAttributes.Hidden;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
