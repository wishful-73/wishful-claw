
using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Storage;

/// <summary>
/// 工作目录父目录（iter-33 S-103）。两件事共用这一个值：
///
/// ① 全局 PM 通过 <c>create_project</c> 建项目的唯一落点 —— 路径由服务端拼成
///    <c>父目录/一级子目录</c>，agent 提交的只有名字，无法给出任意路径；
/// ② 全局会话沙箱的额外允许根（Agent 层 <c>PathBoundary.WithProjectsParent</c>）——
///    刚建出来、还没注册成项目的目录也要能读写，所以放行的是整棵父目录。
///
/// **没有「未配置」态**：<see cref="Read"/> 恒返回一个非空可用路径 —— 有设置值用设置值，
/// 否则用 <see cref="DefaultPath"/>。于是工具永远能建项目、沙箱永远多一个根，
/// 「恢复默认」也就等于删掉配置键（<see cref="Reset"/>），而不是写入空串。
/// </summary>
public static class ProjectsParentDirectory
{
    private const string ConfigKey = "projectsParentDir";

    /// <summary>
    /// 默认父目录：用户主目录下的 <c>WishfulClawProjects</c>。
    ///
    /// 刻意不放在这些地方 —— 数据根内（项目的文件会和应用自己的记忆、配置、库混在一起，
    /// 用户分不清哪些能删）、点号隐藏目录（在文件管理器里根本找不到自己建的项目）、
    /// <c>~/Documents</c>（Windows 上常被 OneDrive 重定向，项目目录跟着上云是意外）。
    /// </summary>
    public static string HomeDirectory { get; } =
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public static string DefaultPath { get; } = Path.Combine(HomeDirectory, "WishfulClawProjects");

    /// <summary>
    /// 生效的父目录：设置值优先，否则默认值。设置值为空串或全空白时同样回落默认值 ——
    /// config.json 是能手写出错的，一个空串不该让「建项目」和「沙箱多一个根」一起消失。
    /// </summary>
    public static string Read() => Configured() ?? DefaultPath;

    /// <summary>
    /// 设置页读接口：生效路径 + 是否显式配置过。
    ///
    /// 暴露 <see cref="DefaultPath"/> 的**父**（主目录）而不是默认值本身：设置页要判的是
    /// 「父目录选得过宽」（盘符根、主目录本身），那只需要主目录；把 DefaultPath 也给出去只会
    /// 引诱渲染端再复刻一遍 `WishfulClawProjects` 这个名字。手写 JSON 而不新建 record 是照
    /// <see cref="ConfigStore"/> 自己的惯例（其 ToResponse 也是 FromWriter），顺带不必再添一个
    /// AOT 注册点。
    /// </summary>
    public static WorkerResponse ReadResponse(JsonElement parameters)
    {
        var path = Read();
        var configured = Configured() is not null;
        return WorkerResponse.FromWriter(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("path", path);
            writer.WriteBoolean("configured", configured);
            writer.WriteString("homeDirectory", HomeDirectory);
            writer.WriteEndObject();
        });
    }

    /// <summary>
    /// 设置页写接口：<c>{"path": "..."}</c> 写入；<c>{"path": null}</c>（或空串）等于恢复默认。
    /// 返回体与读接口同形状，前端一次调用就能拿到新状态。
    /// </summary>
    public static WorkerResponse WriteResponse(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("path", out var pathElement) ||
            pathElement.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            Reset();
            return ReadResponse(parameters);
        }

        if (pathElement.ValueKind != JsonValueKind.String)
        {
            return WorkerResponse.Error("Field 'path' must be a string or null.");
        }

        var raw = pathElement.GetString() ?? string.Empty;
        var trimmed = raw.Trim();
        if (trimmed.Length > 0 && !IsUsablePath(trimmed))
        {
            return WorkerResponse.Error($"Not a usable directory path: \"{raw}\"");
        }

        Write(trimmed);
        return ReadResponse(parameters);
    }

    /// <summary>写入设置值。空串等同 <see cref="Reset"/> —— 空串不是「未配置」的表示法。</summary>
    public static void Write(string? path)
    {
        var trimmed = path?.Trim() ?? string.Empty;
        if (trimmed.Length == 0)
        {
            Reset();
            return;
        }

        ConfigStore.SetValue(ConfigKey, JsonValue.Create(trimmed));
    }

    /// <summary>恢复默认：删键。下次 <see cref="Read"/> 直接给 <see cref="DefaultPath"/>。</summary>
    public static void Reset() => ConfigStore.DeleteKey(ConfigKey);

    /// <summary>
    /// 只要求「拼得出一个带根的绝对路径」，不要求目录已存在 —— 选一个还没建的路径是正常用法，
    /// 真正的创建发生在 <c>create_project</c> 执行时。
    /// </summary>
    private static bool IsUsablePath(string path)
    {
        try
        {
            // IsPathFullyQualified，而不是 IsPathRooted：`C:` 在 Windows 上算 rooted，但它相对的是
            // 进程当前目录 —— 写进 config.json 的父目录会随启动目录漂移。`\foo` 同理。
            if (!Path.IsPathFullyQualified(path))
            {
                return false;
            }

            var full = Path.GetFullPath(path);
            return !string.IsNullOrWhiteSpace(Path.GetPathRoot(full));
        }
        catch (Exception)
        {
            return false;
        }
    }

    private static string? Configured()
    {
        try
        {
            return ConfigStore.GetValueNode(ConfigKey) is JsonValue value &&
                value.TryGetValue<string>(out var text) &&
                !string.IsNullOrWhiteSpace(text)
                    ? text.Trim()
                    : null;
        }
        catch (Exception ex)
        {
            // 读不动配置不该让工具与沙箱一起失效：回落到默认路径。
            WorkerLog.Warn($"projects parent dir: failed to read config: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }
}
