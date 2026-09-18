using System.IO;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent.Tools;

/// <summary>
/// 沙箱模式（iter-32 S-79）：工具参数里的路径必须落在允许的工作目录内。
///
/// 定位是「防止 agent 跳出工作目录」，不是权限系统 —— 它只在路径解析层做一次归属判定，
/// 越界就显式失败，**绝不静默回退**到工作目录（那样用户会以为跑成功了）。
///
/// 边界随会话种类不同：
/// - 项目会话 → 该项目自己的 workingFolder（单根）
/// - 全局会话（含渠道会话，渠道在 AgentRunContextPolicy 里被强制成 global）→ 所有已注册
///   项目 workingFolder 的并集。全局助手本来就只管调度，这里必须让它能碰到每个项目。
/// - SSH 项目不参与：它的 workingFolder 是远端路径，拿到本地来比较只会误判。
/// - 一根都没有（项目列表为空）→ 视为未开，不拦。
/// </summary>
public static class PathBoundary
{
    /// <summary>
    /// 一次运行的沙箱策略：开关 + 允许的根集合。同一批工具调用共用一份，
    /// 由 <see cref="ToolCallProcessor.ExecuteAsync"/> 算好后透传下去。
    /// </summary>
    public readonly record struct Policy(bool Enabled, IReadOnlyList<string> Roots)
    {
        /// <summary>未开沙箱（也是 record 的默认值），一切放行。</summary>
        public static readonly Policy Disabled = new(false, []);
    }

    /// <summary>解析本次运行的沙箱策略。开关关掉就不查项目表。</summary>
    public static Policy ResolvePolicy(JsonElement parameters)
        => IsEnabled(parameters) ? new Policy(true, ResolveRoots(parameters)) : Policy.Disabled;

    /// <summary>
    /// 沙箱总开关。存在于 run params（渲染端设置页的「沙箱模式」，默认开）。
    /// 老的调用方不带这个字段时按「开」处理，与设置页的默认值一致。
    /// </summary>
    public static bool IsEnabled(JsonElement parameters)
        => JsonHelpers.GetBool(parameters, "sandboxEnabled", true);

    /// <summary>
    /// 算出本次运行允许的根目录集合。空集合表示「未开」——调用方据此放行。
    /// </summary>
    public static IReadOnlyList<string> ResolveRoots(JsonElement parameters)
    {
        if (ResolveScope(parameters) == "project")
        {
            var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
            return string.IsNullOrWhiteSpace(workingFolder) ? [] : [workingFolder];
        }

        // 全局会话：Worker 自己查一遍项目表，免得把「所有项目路径」也塞进每轮重发的 run params。
        try
        {
            var db = DbClient.GetClient();
            return db.Query(
                "SELECT working_folder FROM projects " +
                "WHERE working_folder IS NOT NULL AND working_folder <> '' " +
                "AND (ssh_connection_id IS NULL OR ssh_connection_id = '')",
                r => r.GetString("working_folder"));
        }
        catch (Exception ex)
        {
            // 查不动就当没有根（= 不拦）。沙箱是保护措施，不能反过来把正常干活挡死。
            WorkerLog.Warn($"sandbox: failed to resolve project roots: {ex.GetType().Name}: {ex.Message}");
            return [];
        }
    }

    /// <summary>
    /// 读出运行范围。刻意不复用 <see cref="AgentRunContextPolicy.Resolve"/> —— 它在
    /// 「scope=project 但缺 projectId」时会抛，而沙箱是每个工具调用都要过的一道检查，
    /// 不能让一次参数残缺把工具打挂。这里复刻它判定 scope 的那几行（含「渠道即全局」）。
    /// </summary>
    private static string ResolveScope(JsonElement parameters)
    {
        var sessionMode = JsonHelpers.GetString(parameters, "sessionMode")?.Trim() ?? string.Empty;
        if (sessionMode.Equals("channel", StringComparison.OrdinalIgnoreCase)) return "global";

        var scope = JsonHelpers.GetString(parameters, "scope")?.Trim() ?? string.Empty;
        if (scope.Equals("project", StringComparison.OrdinalIgnoreCase)) return "project";
        if (scope.Equals("global", StringComparison.OrdinalIgnoreCase)) return "global";

        // 没给 scope：与 AgentRunContextPolicy 的推断一致 —— 拿得出项目身份才算项目会话。
        var hasProjectIdentity = !string.IsNullOrWhiteSpace(JsonHelpers.GetString(parameters, "projectId"))
            || !string.IsNullOrWhiteSpace(JsonHelpers.GetString(parameters, "workingFolder"));
        return sessionMode.Equals("global", StringComparison.OrdinalIgnoreCase) || !hasProjectIdentity
            ? "global"
            : "project";
    }

    /// <summary>
    /// 路径是否落在任一允许根之内（根本身与子目录都算）。大小为 Windows 下不敏感。
    /// roots 为空视为放行 —— 调用方应先用 <see cref="IsEnabled"/> 判断开关。
    /// </summary>
    public static bool IsInsideAnyRoot(string resolvedPath, IReadOnlyList<string> roots)
    {
        if (roots.Count == 0) return true;

        var comparison = OperatingSystem.IsWindows()
            ? StringComparison.OrdinalIgnoreCase
            : StringComparison.Ordinal;
        var target = Normalize(resolvedPath);

        foreach (var root in roots)
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            var normalizedRoot = Normalize(root);
            if (normalizedRoot.Length == 0) continue;

            if (string.Equals(target, normalizedRoot, comparison)) return true;

            // 目录边界：必须是 root + 分隔符开头，否则 C:\a 会把 C:\abc 放进来。
            if (target.Length > normalizedRoot.Length &&
                target.StartsWith(normalizedRoot, comparison) &&
                target[normalizedRoot.Length] == Path.DirectorySeparatorChar)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// 越界文案。要说清三件事：被拒的路径、允许的根、用户能怎么办 —— agent 会把这句
    /// 原样读给自己看，缺了出路它只会反复重试同一条路径。
    /// </summary>
    public static string BuildViolationMessage(string resolvedPath, IReadOnlyList<string> roots)
    {
        var allowed = roots.Count == 0 ? "(none)" : string.Join(", ", roots);
        return
            $"Sandbox: \"{resolvedPath}\" is outside the allowed working directories ({allowed}). " +
            "The sandbox setting is on, so tools cannot touch paths outside those directories. " +
            "Pick a path inside an allowed directory, or turn the sandbox off in Settings, " +
            "or add the directory as a project working folder.";
    }

    /// <summary>规范化到绝对路径并去掉尾部分隔符（根目录如 C:\ 保持不变）。</summary>
    private static string Normalize(string path)
    {
        try
        {
            return Path.TrimEndingDirectorySeparator(Path.GetFullPath(path));
        }
        catch (Exception)
        {
            // 非法路径（空串、非法字符）交给 IsInsideAnyRoot 当「不在根内」处理。
            return string.Empty;
        }
    }
}

/// <summary>
/// 路径越过沙箱边界。单独一个类型是为了让上层能把它和「工具自己炸了」区分开：
/// 前者是预期内的拒绝，消息原样给模型；后者要带 "Tool execution failed" 前缀。
/// </summary>
public sealed class PathSandboxViolationException(string message) : Exception(message);
