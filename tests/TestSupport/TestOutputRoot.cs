namespace WishfulClaw.TestSupport;

/// <summary>
/// 回归测试产物的落点解析。
///
/// **约定：测试产物一律落在工作目录内** —— <c>&lt;仓库根&gt;/.wishful-claw/tmp/</c>，不用系统临时目录。
///
/// 理由：散在系统 TEMP 里的回归数据既难找也难清（2026-09-20 实测攒到 717 个目录 / 1.78 GB），
/// 聚到工作目录内一处后，删一个目录就干净，也不会给用户找垃圾造成困扰。
/// `.wishful-claw/` 已被 <c>.gitignore</c> 整目录忽略，不会污染 <c>git status</c>。
///
/// 本文件由各测试工程的 csproj 以 <c>&lt;Compile Include ... Link&gt;</c> 链接进来（不单独建工程），
/// 所以**改落点只需要动这一个文件**。
/// </summary>
public static class TestOutputRoot
{
    /// <summary>
    /// 仓库根：从测试 exe 所在目录往上找含 <c>.git</c> 的目录。
    /// 找不到（比如 exe 被挪出仓库）时退回系统临时目录 —— 落点变了但测试不会因此崩。
    /// </summary>
    public static string RepositoryRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, ".git")))
            dir = dir.Parent;
        return dir?.FullName ?? Path.GetTempPath();
    }

    /// <summary>测试产物根目录 <c>&lt;仓库根&gt;/.wishful-claw/tmp</c>，并保证它已存在。</summary>
    public static string Resolve()
    {
        var root = Path.Combine(RepositoryRoot(), ".wishful-claw", "tmp");
        Directory.CreateDirectory(root);
        return root;
    }
}
