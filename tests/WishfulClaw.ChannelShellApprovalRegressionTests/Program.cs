using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Modules.Channels;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.ChannelShellApprovalRegressionTests;

/// <summary>
/// Pins the channel shell approval gate added by iteration 28 R-2. The retired per-channel
/// <c>permissions.allowShell</c> read like a visibility switch but was never injected anywhere;
/// the replacement is a global <c>shellRequiresApproval</c> whose only effect is whether a channel
/// run pauses for confirmation before executing shell. These checks hold the four properties that
/// make that safe: the default is "ask", a stored legacy value carries over to the safe side, the
/// waiver is limited to the shell tools of a channel session, and the write endpoint refuses a
/// partial payload instead of storing default(<c>false</c>) — which would mean "no approval".
///
/// Iteration 29 需求 28 cut the record down to two enforced keys (<c>autoStart</c>,
/// <c>shellRequiresApproval</c>). Group 7 pins the other half of that: the six retired keys
/// still read through for upgraded installs, and a whole-object save drops them for good.
/// </summary>
internal static class Program
{
    private const string ConfigFileName = "config.json";

    private static readonly string[] ShellToolNames = ["Bash", "Shell", "ShellExec", "PowerShell"];
    private static readonly string[] NonShellApprovalTools =
        ["Write", "Edit", "NotebookEdit", "DesktopClick", "DesktopType", "DesktopScroll"];

    private static string _dataDir = string.Empty;
    private static int _checks;

    public static int Main()
    {
        _dataDir = Path.Combine(Path.GetTempPath(), $"wishful-shell-approval-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_dataDir);
        Environment.SetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar, _dataDir);

        try
        {
            AssertFreshInstallRequiresApproval();
            AssertLegacyAllowShellCarriesOverToSafeSide();
            AssertExplicitKeyWinsOverLegacyKey();
            AssertWaiverCoversOnlyChannelShell();
            AssertApprovalSetStaysIntact();
            AssertWholeObjectSaveRoundTrip();
            AssertRetiredKeysAreIgnored();
            AssertPartialWriteIsRejected();

            Console.WriteLine($"Channel shell approval regression checks passed ({_checks} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Channel shell approval regression test failed: {ex}");
            return 1;
        }
        finally
        {
            try
            {
                Directory.Delete(_dataDir, recursive: true);
            }
            catch (IOException)
            {
                // Leftover temp directories are harmless; the next run uses a fresh one.
            }
        }
    }

    // ── Group 1: defaults, with nothing on disk ──

    private static void AssertFreshInstallRequiresApproval()
    {
        AssertConfigAbsent();
        var settings = GlobalChannelSettingsStore.Read();
        Assert("no config file → ShellRequiresApproval defaults to ask", settings.ShellRequiresApproval);
        Assert("no config file → AutoStart defaults on", settings.AutoStart);
        Assert(
            "a channel shell on a fresh install still asks",
            !ToolCallProcessor.IsChannelShellApprovalWaived("Bash", isChannelSession: true));
    }

    // ── Group 2: the retired per-channel value must not silently loosen anything ──

    private static void AssertLegacyAllowShellCarriesOverToSafeSide()
    {
        WriteRawChannelSettings("""{"allowShell":false}""");
        Assert(
            "legacy allowShell:false means「not allowed」→ still asks",
            GlobalChannelSettingsStore.Read().ShellRequiresApproval);

        WriteRawChannelSettings("""{"allowShell":true}""");
        Assert(
            "legacy allowShell:true means「no confirmation needed」→ carries over as waived",
            !GlobalChannelSettingsStore.Read().ShellRequiresApproval);
        Assert(
            "the carried-over waiver actually reaches the gate",
            ToolCallProcessor.IsChannelShellApprovalWaived("Bash", isChannelSession: true));

        WriteRawChannelSettings("{}");
        Assert("an empty channelSettings node keeps the ask default", GlobalChannelSettingsStore.Read().ShellRequiresApproval);

        WriteRawChannelSettings("""{"allowShell":"yes please"}""");
        Assert(
            "a non-boolean legacy value is ignored rather than trusted",
            GlobalChannelSettingsStore.Read().ShellRequiresApproval);
    }

    // ── Group 3: one value, one owner ──

    private static void AssertExplicitKeyWinsOverLegacyKey()
    {
        WriteRawChannelSettings("""{"allowShell":true,"shellRequiresApproval":true}""");
        Assert("explicit shellRequiresApproval wins over the retired key", GlobalChannelSettingsStore.Read().ShellRequiresApproval);

        WriteRawChannelSettings("""{"allowShell":false,"shellRequiresApproval":false}""");
        Assert(
            "explicit false wins in the loosening direction too",
            !GlobalChannelSettingsStore.Read().ShellRequiresApproval);
    }

    // ── Group 4: the waiver's blast radius ──

    private static void AssertWaiverCoversOnlyChannelShell()
    {
        WriteRawChannelSettings("""{"shellRequiresApproval":false}""");
        foreach (var name in ShellToolNames)
        {
            Assert($"{name} is waived in a channel session", ToolCallProcessor.IsChannelShellApprovalWaived(name, isChannelSession: true));
        }

        foreach (var name in NonShellApprovalTools.Concat(["Read", "Glob", "Grep"]))
        {
            Assert($"{name} is never waived by the channel shell switch", !ToolCallProcessor.IsChannelShellApprovalWaived(name, isChannelSession: true));
        }

        Assert(
            "a desktop session keeps its own approval policy",
            !ToolCallProcessor.IsChannelShellApprovalWaived("Bash", isChannelSession: false));
        Assert(
            "an unmatched tool name falls through to「ask」rather than to「run」",
            !ToolCallProcessor.IsChannelShellApprovalWaived("bash", isChannelSession: true));
    }

    // ── Group 5: approval ≠ visibility (老大 2026-09-11 语义改写的前提) ──

    private static void AssertApprovalSetStaysIntact()
    {
        // The same names must stay in the default-mode approval set whether or not the channel
        // waiver is on; otherwise the switch would have become a hidden removal of the tool.
        WriteRawChannelSettings("""{"shellRequiresApproval":false}""");
        foreach (var name in ShellToolNames.Concat(NonShellApprovalTools))
        {
            Assert($"{name} remains a default-mode approval tool", ToolCallProcessor.IsDefaultModeApprovalTool(name));
        }

        foreach (var name in new[] { "Read", "Glob", "Grep", "LS" })
        {
            Assert($"{name} never pauses for approval", !ToolCallProcessor.IsDefaultModeApprovalTool(name));
        }

        WriteRawChannelSettings("""{"shellRequiresApproval":true}""");
        foreach (var name in ShellToolNames)
        {
            Assert($"{name} stays in the set after re-arming approval", ToolCallProcessor.IsDefaultModeApprovalTool(name));
        }
    }

    // ── Group 6: the store the settings panel writes through ──

    private static void AssertWholeObjectSaveRoundTrip()
    {
        WriteRawChannelSettings("""{"allowShell":true}""");
        GlobalChannelSettingsStore.Write(new GlobalChannelSettings(
            AutoStart: false,
            ShellRequiresApproval: false));

        var saved = GlobalChannelSettingsStore.Read();
        Assert("autoStart round-trips", !saved.AutoStart);
        Assert("shellRequiresApproval round-trips", !saved.ShellRequiresApproval);
        Assert(
            "a whole-object save erases the retired key instead of leaving a zombie",
            !File.ReadAllText(ConfigPath()).Contains("allowShell", StringComparison.Ordinal));
        Assert(
            "the saved value is what the gate acts on",
            ToolCallProcessor.IsChannelShellApprovalWaived("Bash", isChannelSession: true));

        GlobalChannelSettingsStore.Write(saved with { ShellRequiresApproval = true });
        Assert(
            "re-arming approval from the panel takes effect immediately",
            !ToolCallProcessor.IsChannelShellApprovalWaived("Bash", isChannelSession: true));
    }

    // ── Group 7: the six retired keys must not keep their say (iteration 29 需求 28) ──

    private static void AssertRetiredKeysAreIgnored()
    {
        // Exactly the shape an installation upgraded from iteration 28 has on disk.
        WriteRawChannelSettings(
            """
            {"autoReply":false,"streamingReply":false,"autoStart":false,
             "shellRequiresApproval":false,"allowReadHome":true,
             "readablePathPrefixes":["D:/shared"],"allowWriteOutside":true,"allowSubAgents":true}
            """);

        var legacy = GlobalChannelSettingsStore.Read();
        Assert("a legacy record still carries its autoStart", !legacy.AutoStart);
        Assert("a legacy record still carries its shellRequiresApproval", !legacy.ShellRequiresApproval);

        GlobalChannelSettingsStore.Write(legacy with { AutoStart = true });
        var raw = File.ReadAllText(ConfigPath());
        foreach (var retired in new[]
                 {
                     "autoReply", "streamingReply", "allowReadHome",
                     "readablePathPrefixes", "allowWriteOutside", "allowSubAgents"
                 })
        {
            Assert(
                $"a whole-object save drops the retired {retired} key",
                !raw.Contains(retired, StringComparison.Ordinal));
        }

        var rewritten = GlobalChannelSettingsStore.Read();
        Assert("the surviving autoStart came back", rewritten.AutoStart);
        Assert("the surviving shellRequiresApproval came back", !rewritten.ShellRequiresApproval);
    }

    // ── Group 8: the whole-object write contract behind channel/settings-write ──

    private static void AssertPartialWriteIsRejected()
    {
        var full = """
            {"autoStart":false,"shellRequiresApproval":true}
            """;
        WriteRawChannelSettings(full);

        Assert("a complete payload is accepted", WriteSettings(full).GetProperty("success").GetBoolean());
        Assert(
            "the accepted payload is what the store now holds",
            !GlobalChannelSettingsStore.Read().AutoStart);

        // This is the shape a failed read arrives as, and the shape a stale renderer would
        // send after merging a patch onto it. Accepted, `shellRequiresApproval` would
        // deserialize to default(false) — approval waived with no user action.
        var before = File.ReadAllText(ConfigPath());
        foreach (var rejected in new[]
        {
            """{"error":"boom"}""",
            """{"shellRequiresApproval":false}""",
            // Adds a key the store never writes, so the payload did not come from a read.
            """{"autoStart":true,"shellRequiresApproval":true,"allowReadHome":false}""",
            "[]",
            "null"
        })
        {
            using var payload = JsonDocument.Parse(rejected);
            var response = WriteSettings(payload.RootElement);
            Assert($"partial or unknown-key payload is refused: {trimmedLabel(rejected)}",
                !response.GetProperty("success").GetBoolean());
            Assert($"a refused write leaves the store untouched: {trimmedLabel(rejected)}",
                string.Equals(before, File.ReadAllText(ConfigPath()), StringComparison.Ordinal));
        }

        Assert(
            "the gate still asks after all the rejected attempts",
            !ToolCallProcessor.IsChannelShellApprovalWaived("Bash", isChannelSession: true));
    }

    private static JsonElement WriteSettings(string payloadJson)
    {
        using var parameters = JsonDocument.Parse(payloadJson);
        return WriteSettings(parameters.RootElement);
    }

    private static JsonElement WriteSettings(JsonElement parameters)
    {
        var response = GlobalChannelSettingsService.Write(parameters);
        using var envelope = JsonDocument.Parse(response.ToJsonBytes(null));
        return envelope.RootElement.GetProperty("result").Clone();
    }

    private static string trimmedLabel(string json)
    {
        var flat = json.ReplaceLineEndings().Replace("\n", "").Replace(" ", "");
        return flat.Length <= 40 ? flat : flat[..40] + "…";
    }

    // ── Helpers ──

    private static string ConfigPath() => Path.Combine(_dataDir, ConfigFileName);

    private static void AssertConfigAbsent()
    {
        if (File.Exists(ConfigPath()))
        {
            File.Delete(ConfigPath());
        }
        Assert("config file removed for this group", !File.Exists(ConfigPath()));
    }

    private static void WriteRawChannelSettings(string channelSettingsJson) =>
        File.WriteAllText(
            ConfigPath(),
            $$"""
            { "channelSettings": {{channelSettingsJson}} }
            """);

    private static void Assert(string what, bool condition)
    {
        _checks++;
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {what}");
        }
    }
}
