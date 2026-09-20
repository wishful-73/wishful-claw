using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// create_project（iter-33 S-103）—— 全局 PM 在设置页配的「工作目录父目录」下建项目。
///
/// 单独一个 partial 文件有两个理由：执行器已经贴着 500 行硬线（AGENTS.md），而这一段本身
/// 的边界逻辑（路径怎么拼、什么算重名）与其余只读工具是两回事，放一起只会互相干扰。
/// </summary>
public static partial class AgentRuntimeProjectExecutor
{
    // ── create_project ──

    /// <summary>
    /// 在设置页配的「工作目录父目录」下建一个项目（S-103）。路径完全由服务端拼 —— 工具参数里
    /// 没有路径，沙箱那道检查根本看不到它，所以边界就靠 <see cref="ProjectCreationPolicy"/>。
    /// </summary>
    private static Task<string> CreateProjectAsync(
        JsonElement input, JsonElement parameters, CancellationToken cancellationToken)
    {
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var name = RequireString(input, "name");
            var folderName = JsonHelpers.GetString(input, "folderName");

            var parentDirectory = ProjectsParentDirectory.Read();
            var target = ProjectCreationPolicy.Resolve(parentDirectory, name, folderName);
            if (target.Path is null)
            {
                return Task.FromResult(EncodeError(target.Error ?? "Invalid project directory."));
            }

            var workingFolder = target.Path;

            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            // projects 表对 working_folder 没有唯一约束，而 Directory.CreateDirectory 对已存在的
            // 目录是幂等的 —— 不先查重，同一个目录上会挂出两条项目，之后谁也说不清是哪一条在生效。
            // 比较放在 C# 里而不是 SQL 的等值比较：Windows 路径大小写不敏感、尾随分隔符可有可无，
            // 而 agent 侧这条路径经过 GetFullPath 归一化、用户从界面建的那条只做了 Trim ——
            // SQL 的 '=' 会把同一个物理目录判成两个不同的值。
            var existing = FindProjectAt(db, workingFolder);
            if (existing is not null)
            {
                return Task.FromResult(EncodeError(
                    $"A project already uses \"{workingFolder}\": id={existing.Id}, name=\"{existing.Name}\". " +
                    "Use that project instead of creating a duplicate."));
            }

            var reusedDirectory = Directory.Exists(workingFolder);

            var payload = WorkerJsonHelper.BuildJsonElement(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("name", name);
                writer.WriteString("workingFolder", workingFolder);
                writer.WriteEndObject();
            });

            var created = DbProjectTools.CreateEntity(payload);

            var result = JsonSerializer.Serialize(
                new CreateProjectResult(
                    created.Id, created.Name, workingFolder, parentDirectory, reusedDirectory),
                WorkerJsonHelper.GetTypeInfo<CreateProjectResult>());

            return Task.FromResult(result);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception ex)
        {
            return Task.FromResult(EncodeError($"Failed to create project: {ex.Message}"));
        }
    }


    /// <summary>
    /// 找出已经占用这个目录的项目（大小写不敏感、忽略尾随分隔符）。
    ///
    /// 全表拉回来在 C# 里比，而不是把归一化塞进 SQL（RTRIM + REPLACE + LOWER 拼起来读不懂，
    /// 而且 SQLite 的 LOWER 只对 ASCII 生效）。projects 表是几十行的量级，全表扫无所谓。
    /// </summary>
    private static ProjectEntity? FindProjectAt(DbService db, string workingFolder)
    {
        var target = NormalizeFolder(workingFolder);
        if (target.Length == 0) return null;

        foreach (var candidate in db.Query(
            "SELECT * FROM projects WHERE working_folder IS NOT NULL AND working_folder <> ''",
            EntityMappers.MapProject))
        {
            if (string.Equals(
                    NormalizeFolder(candidate.WorkingFolder ?? string.Empty),
                    target,
                    StringComparison.OrdinalIgnoreCase))
            {
                return candidate;
            }
        }

        return null;
    }

    /// <summary>归一化到「绝对路径 + 无尾随分隔符」；非法路径返回空串（即永远不匹配）。</summary>
    private static string NormalizeFolder(string path)
    {
        try
        {
            return Path.TrimEndingDirectorySeparator(Path.GetFullPath(path.Trim()));
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }
}
