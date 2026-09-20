using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.ChannelToolVisibilityRegressionTests;

/// <summary>
/// S-103（iter-33）：全局 PM 的项目创建工具 —— 授权面、落点策略、沙箱额外根。
///
/// 拆成独立文件是因为 Program.cs 已经贴着 500 行硬线（AGENTS.md）；这里放的三件事正好是一组：
/// 「谁能拿到」（<see cref="AssertCreateProjectGrant"/>）、「拿到后能建到哪」（
/// <see cref="AssertProjectCreationPolicy"/>）、「父目录同时还是哪里的根」（
/// <see cref="AssertSandboxProjectsParent"/>）。
/// </summary>
internal static partial class Program
{
    // ── S-103: create_project under the configured projects parent directory ──

    /// <summary>
    /// S-103: <c>create_project</c> is granted to the global side only (a channel is a global session).
    ///
    /// Unlike the cron batch this cannot stop at "the channel reaches it": the tool writes, its path is
    /// built server-side, and the parameter list carries no path at all — so the sandbox never sees it.
    /// "Who must NOT reach it" is therefore half of the same contract the policy pure function guards.
    /// </summary>
    private static void AssertCreateProjectGrant(AgentRunContext channelContext, ToolRegistry registry)
    {
        Assert(Allowed(channelContext, registry, "create_project"),
            "a channel session reaches create_project");
        Assert(registry.IsAvailableInMode("create_project", "global"),
            "create_project is available in the global mode, so the capability proxy can reach it");

        var globalDesktop = AgentRunContextPolicy.Resolve(Parse("""{"scope":"global"}"""));
        Assert(
            AgentRunContextPolicy.IsToolAllowed(globalDesktop, "create_project", registry, channelSession: false),
            "a desktop global session reaches create_project");

        // GlobalSideOnly, deliberately not GlobalSideAndWorkRuns: a project cowork session is exactly
        // where the parent-directory grant would leak, since the parent holds sibling projects.
        var projectCowork = AgentRunContextPolicy.Resolve(
            Parse("""{"scope":"project","projectId":"p1","collaborationMode":"cowork"}"""));
        Assert(
            !AgentRunContextPolicy.IsToolAllowed(projectCowork, "create_project", registry, channelSession: false),
            "a project cowork session does not gain create_project");

        var projectChat = AgentRunContextPolicy.Resolve(
            Parse("""{"scope":"project","projectId":"p1","collaborationMode":"chat"}"""));
        Assert(
            !AgentRunContextPolicy.IsToolAllowed(projectChat, "create_project", registry, channelSession: false),
            "a project chat session does not gain create_project");

        // GlobalSideOnly 的 role 段是 `*`：global 域的子代理同样拿得到。这是有意为之（它仍受父目录
        // 约束），写下来免得日后有人当泄漏「修」掉。
        var globalSubAgent = AgentRunContextPolicy.Resolve(
            Parse("""{"scope":"global","collaborationMode":"cowork","runtimeRole":"subagent"}"""));
        AssertEqual("global", globalSubAgent.Scope, "the sub-agent visibility probe resolves to the global scope");
        Assert(
            AgentRunContextPolicy.IsToolAllowed(globalSubAgent, "create_project", registry, channelSession: false),
            "a sub-agent inside the global side reaches create_project (role segment is '*'), by design");
    }

    /// <summary>
    /// S-103: the configured default only has one definition (C# side). The renderer must not restate
    /// the directory name, or the two drift silently; that is why the settings endpoint returns the
    /// home directory rather than the default path.
    /// </summary>
    private static void AssertProjectsParentDefault()
    {
        var defaultPath = ProjectsParentDirectory.DefaultPath;
        Assert(defaultPath.Length > 1, "the default projects parent directory is not empty");

        // 精确到「父级就是主目录」，而不是 StartsWith —— 后者连 `~/a/b/c` 都放行，钉不住结构。
        AssertEqual(
            Path.TrimEndingDirectorySeparator(ProjectsParentDirectory.HomeDirectory),
            Path.TrimEndingDirectorySeparator(Path.GetDirectoryName(defaultPath) ?? "(null)"),
            "the default projects parent sits directly under the user's home directory");
        Assert(
            !Path.GetFileName(defaultPath).StartsWith('.'),
            "the default directory is not a dot-directory the user cannot find");
    }

    /// <summary>
    /// S-103: the landing-site policy. This is the requirement's only real boundary — the tool's
    /// parameters carry no path, so the sandbox never inspects it — hence every input that should be
    /// refused is asserted here, and refused outright rather than silently rewritten.
    /// </summary>
    private static void AssertProjectCreationPolicy()
    {
        const string parent = @"D:\parent";

        var derived = ProjectCreationPolicy.Resolve(parent, "My Project", null);
        AssertEqual(
            @"D:\parent\My Project",
            derived.Path ?? "(null)",
            "the folder name is derived from the display name");
        Assert(derived.Error is null, "a valid name produces no error");

        var explicitFolder = ProjectCreationPolicy.Resolve(parent, "My Project", "custom-dir");
        AssertEqual(
            @"D:\parent\custom-dir",
            explicitFolder.Path ?? "(null)",
            "an explicit folderName wins over the derived one");

        AssertEqual(
            "a-b",
            ProjectCreationPolicy.DeriveFolderName("a<b"),
            "Windows-illegal characters become '-' in the derived folder name");
        AssertEqual(
            "My Project",
            ProjectCreationPolicy.DeriveFolderName("My Project"),
            "a benign display name is kept as-is");
        AssertEqual(
            "trailing",
            ProjectCreationPolicy.DeriveFolderName("trailing. "),
            "trailing dots and spaces are stripped from the derived folder name");

        Assert(
            ProjectCreationPolicy.Resolve(null, "x", null).Error is not null,
            "a missing parent directory is rejected");
        Assert(
            ProjectCreationPolicy.Resolve("   ", "x", null).Error is not null,
            "a blank parent directory is rejected");
        Assert(
            ProjectCreationPolicy.Resolve(parent, null, null).Error is not null,
            "a missing name is rejected");
        Assert(
            ProjectCreationPolicy.Resolve(parent, "  ", null).Error is not null,
            "a blank name is rejected");

        foreach (var escape in new[]
        {
            "..", ".", "   ..   ", "...", @"sub\dir", "sub/dir", "C:", @"D:\abs", "/abs", @"..\other",
            @"\\server\share", @"\\?\C:\abs"
        })
        {
            Assert(
                ProjectCreationPolicy.Resolve(parent, "x", escape).Error is not null,
                $"folderName '{escape}' is rejected instead of being rewritten into something else");
        }

        // 全角斜杠/全角点不是 Windows 分隔符，TrimEnd 也不会吃掉它们 ⇒ 它就是一个普通目录名字符，
        // 结果仍在父目录下。这一条是「拒绝要准」的另一半：不该把合法的怪名字一并拒绝掉。
        var fullWidth = ProjectCreationPolicy.Resolve(parent, "x", "／abs");
        Assert(fullWidth.Path is not null,
            "a full-width slash is an ordinary character, not a path separator");
        AssertEqual(@"D:\parent\／abs", fullWidth.Path ?? "(null)",
            "the full-width name stays a direct child of the parent directory");

        // Windows 保留设备名：不拦下来 agent 只会拿到一句 OS 级报错，不知道该换名字。
        foreach (var device in new[] { "CON", "con", "NUL.txt", "COM1", "lpt9" })
        {
            Assert(
                ProjectCreationPolicy.Resolve(parent, "x", device).Error is not null,
                $"'{device}' is rejected as a reserved Windows device name");
        }
        Assert(
            ProjectCreationPolicy.Resolve(parent, "x", "CONSOLE").Path is not null,
            "a name that merely starts like a device name is still allowed");

        // 父目录本身必须是全限定路径：`C:` 在 Windows 上算 rooted，但它相对的是进程当前目录，
        // 写进 config.json 会让「父目录」随启动目录漂移。
        foreach (var badParent in new[] { "parent", @".\parent", "C:", @"C:relative" })
        {
            Assert(
                ProjectCreationPolicy.Resolve(badParent, "x", null).Error is not null,
                $"parent directory '{badParent}' is rejected as not fully qualified");
        }

        Assert(
            ProjectCreationPolicy.Resolve(parent, "x", "   ").Error is null,
            "a blank folderName falls back to the derived name rather than failing");
        Assert(
            ProjectCreationPolicy.Resolve(parent, "x", "ok").Path is not null,
            "a single ordinary directory name resolves");
    }

    /// <summary>
    /// S-103: the parent directory is an extra root for GLOBAL sessions only.
    ///
    /// Asserted through the pure function because <c>ResolveRoots</c>'s global branch calls
    /// <c>DbClient.GetClient()</c>, which initializes the real database — not something a suite may
    /// touch. Adding the parent on the project side is the mistake this guards: a project session that
    /// could see the parent could then read and write every sibling project.
    /// </summary>
    private static void AssertSandboxProjectsParent()
    {
        IReadOnlyList<string> globalRoots = [@"D:\proj-a", @"D:\proj-b"];

        var withParent = PathBoundary.WithProjectsParent(globalRoots, @"D:\parent");
        AssertEqual("3", withParent.Count.ToString(), "the projects parent is appended to the global roots");
        AssertEqual(@"D:\parent", withParent[2], "the parent directory is the appended root");

        AssertEqual(
            "2",
            PathBoundary.WithProjectsParent(globalRoots, null).Count.ToString(),
            "a null parent directory leaves the roots untouched");
        AssertEqual(
            "2",
            PathBoundary.WithProjectsParent(globalRoots, "   ").Count.ToString(),
            "a blank parent directory leaves the roots untouched");

        Assert(
            PathBoundary.IsInsideAnyRoot(@"D:\parent\newproject\note.txt", withParent),
            "a path inside the projects parent is allowed once it is a root");
        Assert(
            !PathBoundary.IsInsideAnyRoot(@"D:\elsewhere\note.txt", withParent),
            "a path outside every root is still refused");

        // The existing two-stage composition must not be disturbed by the S-103 addition: WithDataRoot
        // is shared by the project and global branches, and the sandbox suite pins its count.
        AssertEqual(
            "1",
            PathBoundary.WithDataRoot([]).Count.ToString(),
            "WithDataRoot keeps appending exactly the data root");
    }

}
