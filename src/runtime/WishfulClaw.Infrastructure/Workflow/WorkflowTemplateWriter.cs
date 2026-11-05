using System.Reflection;
using System.Text;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Infrastructure.Workflow;

/// <summary>
/// S-313：新建项目时把「开发工作流」规范与三套模板落到 <c>&lt;项目&gt;/{ProjectDirName}/workflow/</c>。
///
/// 落点选在项目工作目录下的隐藏目录，不进用户源码树 —— 换项目天然隔离，也不会被当成内部流程外泄。
/// 目录名一律取 <see cref="WishfulClawDataDir.ProjectDirName"/>，不写死 <c>.wishful-claw</c>：
/// dev 实例下它是 <c>.wishful-claw-dev</c>，写死会让落盘位置和提示里的指针指向两个不同的目录，
/// 而两边的失败都是静默的 —— 文件照写，指针照空。
/// 两个建项目入口（agent 的 <c>create_project</c> 与渲染端的 <c>db/projects-create</c>）都收敛到
/// <see cref="Db.DbProjectTools.CreateEntity"/>，所以只挂那一处就覆盖全部入口。
///
/// 三条硬约束：
/// <list type="number">
/// <item>幂等 —— 已存在的文件一律不覆盖。用户改过的模板不能被下一次建项目冲掉；</item>
/// <item>不阻塞 —— 写失败只记日志。「建项目」是本分，写模板是附赠，附赠失败不能连累本分；</item>
/// <item>不碰别的文件 —— 只写这四份，不替用户改 .gitignore。要不要忽略是他们自己决定的事。</item>
/// </list>
/// </summary>
public static class WorkflowTemplateWriter
{
    private const string WorkflowDirectory = "workflow";

    /// <summary>资源逻辑名 → 相对 <c>.wishful-claw/workflow/</c> 的落盘路径。</summary>
    private static readonly (string Resource, string Relative)[] Files =
    [
        ("Workflow.dev-workflow.md", "dev-workflow.md"),
        ("Workflow.plan.md", Path.Combine("templates", "plan.md")),
        ("Workflow.changelog.md", Path.Combine("templates", "changelog.md")),
        ("Workflow.requirement.md", Path.Combine("templates", "requirement.md"))
    ];

    private static readonly UTF8Encoding Utf8NoBom = new(encoderShouldEmitUTF8Identifier: false);

    /// <summary>
    /// 在 <paramref name="workingFolder"/> 下补齐工作流文件，返回本次真正写下去的相对路径。
    /// 已存在的跳过、写失败的吞掉（只记日志）—— 调用方不需要为它做任何判断。
    /// </summary>
    public static IReadOnlyList<string> Ensure(string? workingFolder)
    {
        var created = new List<string>();
        if (string.IsNullOrWhiteSpace(workingFolder))
        {
            return created;
        }

        try
        {
            var root = Path.Combine(workingFolder, WishfulClawDataDir.ProjectDirName, WorkflowDirectory);
            foreach (var (resource, relative) in Files)
            {
                var target = Path.Combine(root, relative);
                if (File.Exists(target))
                {
                    continue;
                }

                var content = ReadResource(resource);
                if (content is null)
                {
                    continue;
                }

                var directory = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(target, content, Utf8NoBom);
                created.Add(relative);
            }

            if (created.Count > 0)
            {
                WorkerLog.Info(
                    $"workflow templates written under {root}: {string.Join(", ", created)}");
            }
        }
        catch (Exception ex)
        {
            // 目录不可写、被占用、权限不足 —— 都不该让建项目失败。
            WorkerLog.Warn($"workflow templates skipped for {workingFolder}: {ex.Message}");
        }

        return created;
    }

    private static string? ReadResource(string name)
    {
        using var stream = typeof(WorkflowTemplateWriter).Assembly.GetManifestResourceStream(name);
        if (stream is null)
        {
            // 逻辑名与 csproj 里的 LogicalName 对不上时才会走到这里，改一处忘改另一处就是它。
            WorkerLog.Warn($"workflow template resource missing: {name}");
            return null;
        }

        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: false);
        return reader.ReadToEnd();
    }
}
