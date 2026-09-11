using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.ChannelShellApprovalRegressionTests;

/// <summary>
/// Pins the channel shell approval gate added by iteration 28 R-2. The retired per-channel
/// <c>permissions.allowShell</c> read like a visibility switch but was never injected anywhere;
/// the replacement is a global <c>shellRequiresApproval</c> whose only effect is whether a channel
/// run pauses for confirmation before executing shell. These checks hold the three properties that
/// make that safe: the default is "ask", a stored legacy value carries over to the safe side, and
/// the waiver is limited to the shell tools of a channel session.
/// </summary>
internal static class Program
{
    private const string ConfigFileName = "config.json";

    private static readonly string[] ShellToolNames = ["Bash", "Shell", "ShellExec", "PowerShell"];
    private static readonly string[] NonShellApprovalTools = ["Write", "Edit", "NotebookEdit", "DesktopClick"];

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
        Assert("no config file → AutoReply defaults on", settings.AutoReply);
        Assert("no config file → StreamingReply defaults on", settings.StreamingReply);
        Assert("no config file → AutoStart defaults on", settings.AutoStart);
        Assert("no config file → AllowReadHome defaults off", !settings.AllowReadHome);
        Assert("no config file → AllowWriteOutside defaults off", !settings.AllowWriteOutside);
        Assert("no config file → AllowSubAgents defaults off", !settings.AllowSubAgents);
        Assert("no config file → no readable prefixes", settings.ReadablePathPrefixes.Length == 0);
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
            AutoReply: false,
            StreamingReply: true,
            AutoStart: false,
            ShellRequiresApproval: false,
            AllowReadHome: true,
            ReadablePathPrefixes: new[] { string.Empty, "   ", "D:/shared" },
            AllowWriteOutside: true,
            AllowSubAgents: true));

        var saved = GlobalChannelSettingsStore.Read();
        Assert("autoReply round-trips", !saved.AutoReply);
        Assert("streamingReply round-trips", saved.StreamingReply);
        Assert("autoStart round-trips", !saved.AutoStart);
        Assert("shellRequiresApproval round-trips", !saved.ShellRequiresApproval);
        Assert("allowReadHome round-trips", saved.AllowReadHome);
        Assert("allowWriteOutside round-trips", saved.AllowWriteOutside);
        Assert("allowSubAgents round-trips", saved.AllowSubAgents);
        AssertEqual("D:/shared", string.Join('|', saved.ReadablePathPrefixes), "blank prefixes are dropped on read");
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

    private static void AssertEqual(string expected, string actual, string what)
    {
        _checks++;
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"Assertion failed: {what} (expected={expected}, actual={actual})");
        }
    }
}
