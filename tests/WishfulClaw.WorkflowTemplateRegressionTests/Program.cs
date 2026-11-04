// S-313 回归：新建项目时落盘的工作流规范与模板，以及系统提示里的那一行指针。
//
// 这条链上有两处「静默失败」，都不会抛异常、都不会进日志，看起来一切正常：
//   1) 资源逻辑名 —— csproj 的 <LogicalName> 与 WorkflowTemplateWriter 里那张表对不上，
//      GetManifestResourceStream 返回 null，Ensure 就安静地什么都不写；
//   2) 落点目录名 —— 写死 .wishful-claw 而指针取 ProjectDirName（dev 实例是 .wishful-claw-dev），
//      文件写到 A 目录、指针在 B 目录找，两边都不报错。
// 所以本套件同时钉「文件真的落到 ProjectDirName 下」和「提示真的指向同一个位置」。
//
// 第二件事是幂等：模板落到项目里就成了用户的文件，他们改了就要留住。

using System;
using System.IO;
using System.Text;
using System.Text.Json;
using WishfulClaw.Infrastructure.Storage;
using WishfulClaw.Infrastructure.Workflow;
using WishfulClaw.Persona;

var passed = 0;
var failed = 0;

void Check(bool condition, string label)
{
    if (condition)
    {
        passed++;
        return;
    }
    failed++;
    Console.WriteLine($"FAIL {label}");
}

var root = Path.Combine(Path.GetTempPath(), "wc-workflow-" + Guid.NewGuid().ToString("N"));
var dirName = WishfulClawDataDir.ProjectDirName;
var emptyParams = JsonDocument.Parse("{}").RootElement.Clone();

try
{
    // ── 空输入不炸也不写 ──
    // CreateEntity 在某些调用路径上 workingFolder 可能为空，这时附赠动作要安静退出。
    Check(WorkflowTemplateWriter.Ensure(null).Count == 0, "null working folder writes nothing");
    Check(WorkflowTemplateWriter.Ensure("   ").Count == 0, "whitespace working folder writes nothing");

    // ── 首次落盘：四份文件必须齐全 ──
    Directory.CreateDirectory(root);
    var created = WorkflowTemplateWriter.Ensure(root);
    Check(created.Count == 4, $"first run writes all four files (got {created.Count})");

    var workflowDir = Path.Combine(root, dirName, "workflow");
    var spec = Path.Combine(workflowDir, "dev-workflow.md");
    string[] templates =
    [
        Path.Combine(workflowDir, "templates", "plan.md"),
        Path.Combine(workflowDir, "templates", "changelog.md"),
        Path.Combine(workflowDir, "templates", "requirement.md")
    ];

    Check(File.Exists(spec), $"dev-workflow.md lands under {dirName}/workflow/");
    foreach (var template in templates)
    {
        Check(File.Exists(template), $"template exists: {Path.GetFileName(template)}");
    }

    // 落点必须是项目工作目录下的隐藏目录，不能是工作目录根（否则会污染用户的源码树）。
    Check(!File.Exists(Path.Combine(root, "dev-workflow.md")), "nothing is written to the project root");
    // 也不能落在写死的 .wishful-claw 里 —— 那是 dev 实例下最容易被认错的一个目录。
    Check(
        !Directory.Exists(Path.Combine(root, ".wishful-claw", "workflow")) || dirName == ".wishful-claw",
        "the hardcoded .wishful-claw path is not used on a dev instance");

    // ── 内容：非空、UTF-8 无 BOM、确实是中文规范而不是空骨架 ──
    var specBytes = File.ReadAllBytes(spec);
    Check(specBytes.Length > 2000, $"dev-workflow.md is a real spec, not a stub ({specBytes.Length} bytes)");
    Check(
        !(specBytes.Length >= 3 && specBytes[0] == 0xEF && specBytes[1] == 0xBB && specBytes[2] == 0xBF),
        "written files carry no BOM");
    var specText = Encoding.UTF8.GetString(specBytes);
    Check(specText.Contains("开发工作流"), "spec text decodes as UTF-8 Chinese");

    // 模板带着待填占位符 —— 它们是骨架，不是成品。留个记号，免得日后有人"优化"成静态文档。
    var planText = File.ReadAllText(templates[0]);
    Check(planText.Contains("{{"), "plan template keeps its fill-in placeholders");

    // ── 指针：系统提示里必须真出现，且指向同一个目录 ──
    var prompt = PromptBuilder.Build(PromptProfile.Bootstrap, null, emptyParams, null, root, null, null);
    Check(
        prompt.Contains($"{dirName}/workflow/dev-workflow.md"),
        "the system prompt points at the spec it just wrote");
    Check(
        prompt.Contains($"{dirName}/workflow/templates/"),
        "the pointer also names the templates folder");

    // ── 没有规范的项目：一个字都不许提 ──
    // 指向不存在文件的指针比不给指针更糟：模型会去 Read，再把「读不到」当成自己没权限。
    var bare = Path.Combine(root, "裸项目");
    Directory.CreateDirectory(bare);
    var barePrompt = PromptBuilder.Build(PromptProfile.Bootstrap, null, emptyParams, null, bare, null, null);
    Check(!barePrompt.Contains("dev-workflow.md"), "no spec on disk, no pointer in the prompt");

    // ── 幂等：用户改过的文件不许被下一次调用冲掉 ──
    const string marker = "<!-- 用户自己的补充，不许被覆盖 -->";
    File.WriteAllText(spec, marker, new UTF8Encoding(false));
    File.Delete(templates[0]);

    var second = WorkflowTemplateWriter.Ensure(root);
    Check(File.ReadAllText(spec) == marker, "an existing spec is never overwritten");
    Check(second.Count == 1, $"only the missing file is rewritten (got {second.Count})");
    Check(File.Exists(templates[0]), "a deleted template is restored");
    Check(!second.Contains("dev-workflow.md"), "the returned list only names files that were actually written");

    // ── 工作目录还不存在时：自己建，不抛 ──
    var missing = Path.Combine(root, "尚未创建", "项目");
    var fromMissing = WorkflowTemplateWriter.Ensure(missing);
    Check(fromMissing.Count == 4, "a not-yet-created working folder is created on demand");
}
finally
{
    try
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
    catch
    {
        // 临时目录清理失败不影响判定。
    }
}

Console.WriteLine($"workflow-template: passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;
