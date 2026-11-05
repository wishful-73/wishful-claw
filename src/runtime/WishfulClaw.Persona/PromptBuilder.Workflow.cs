using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Persona;

/// <summary>
/// S-313：开发工作流的提示片段。
///
/// 单独一个 partial 文件，理由与 <c>AgentRuntimeProjectExecutor.Creation.cs</c> 一样：主文件已经
/// 贴着 500 行硬线（AGENTS.md），而「提醒模型有这么一份规范」与「拼装人格、记忆、沙箱」不是一件事，
/// 混在一起只会互相干扰。
/// </summary>
public static partial class PromptBuilder
{
    /// <summary>
    /// 开发工作流的**指针** —— 一行字，不含正文。
    ///
    /// 为什么不塞正文：这套规范有几百行，每个会话每轮都付一遍 token，换不来等价收益。
    /// 而「读不读」本来就是项目自己的事 —— 由项目级 AGENTS.md 决定（persona 支持项目级覆盖），
    /// 软件只负责告诉它文件在哪。
    ///
    /// 文件不在就返回 null。指针指向一个不存在的文件，对模型来说就是假事实，比不给指针更糟：
    /// 它会去 Read 一个不存在的东西，再把「读不到」当成自己没权限。
    /// </summary>
    private static string? BuildWorkflowPointer(string workingFolder)
    {
        var dirName = WishfulClawDataDir.ProjectDirName;
        var spec = Path.Combine(workingFolder, dirName, "workflow", "dev-workflow.md");
        if (!File.Exists(spec))
        {
            return null;
        }

        return $"""
## Development workflow
This project carries a development workflow spec at `{dirName}/workflow/dev-workflow.md` — iteration plans, per-requirement records and a decision log, with skeletons under `{dirName}/workflow/templates/`.
It is deliberately not loaded into this prompt. Follow it only when the project AGENTS.md tells you to.
""";
    }
}
