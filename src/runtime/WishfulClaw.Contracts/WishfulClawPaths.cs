namespace WishfulClaw.Contracts;

public static class WishfulClawPaths
{
    public const string DataDirName = ".wishful-claw";
    public const string DataDirEnvVar = "WISHFULCLAW_DATA_DIR";

    /// <summary>
    /// 项目级数据目录名的覆盖变量（S-223）。主进程算一次 dev/prod 判定后注入 worker，
    /// 使三端（main / worker / renderer）拿到同一个目录名。
    /// </summary>
    public const string ProjectDirEnvVar = "WISHFULCLAW_PROJECT_DIR";
}
