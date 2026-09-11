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
}
