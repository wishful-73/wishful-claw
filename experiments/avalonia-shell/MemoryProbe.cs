using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace WishfulClaw.AvaloniaProbe;

/// <summary>
/// 内存采样器。整份评估里唯一不可推算的数就是它产出的。
///
/// 为什么不只看 <see cref="Process.WorkingSet64"/>：工作集会被系统裁剪（我们踩过这个坑 ——
/// 拿它当「有没有泄漏」的判据会得到假阴性）。所以同时记私有字节与 GC 托管堆，
/// 三个数一起看才知道「是壳的开销，还是 GC 没回收」。
/// </summary>
internal sealed class MemoryProbe : IDisposable
{
    private readonly ProbeOptions _options;
    private readonly Process _process = Process.GetCurrentProcess();
    private readonly List<Sample> _samples = new();
    private readonly System.Timers.Timer _timer;
    private readonly DateTime _startedAt = DateTime.UtcNow;
    private Action<string>? _onTick;

    public MemoryProbe(ProbeOptions options)
    {
        _options = options;
        _timer = new System.Timers.Timer(1000) { AutoReset = true };
        _timer.Elapsed += (_, _) => TakeSample();
    }

    public void Start(Action<string> onTick)
    {
        _onTick = onTick;
        _timer.Start();
    }

    private void TakeSample()
    {
        _process.Refresh();
        var sample = new Sample(
            ElapsedSeconds: (DateTime.UtcNow - _startedAt).TotalSeconds,
            WorkingSetMb: _process.WorkingSet64 / 1024d / 1024d,
            PrivateMb: _process.PrivateMemorySize64 / 1024d / 1024d,
            ManagedHeapMb: GC.GetTotalMemory(false) / 1024d / 1024d,
            Threads: _process.Threads.Count,
            Handles: _process.HandleCount);

        lock (_samples)
        {
            _samples.Add(sample);
        }

        _onTick?.Invoke(sample.Describe());
    }

    /// <summary>
    /// 稳态值取最后三分之一采样的中位数。开头几秒在布局 / JIT / 解码，取全平均会偏低。
    /// </summary>
    public ProbeReport Finish()
    {
        _timer.Stop();

        List<Sample> snapshot;
        lock (_samples)
        {
            snapshot = new List<Sample>(_samples);
        }

        if (snapshot.Count == 0)
        {
            snapshot.Add(new Sample(0, 0, 0, 0, 0, 0));
        }

        var steady = snapshot.Skip(snapshot.Count - Math.Max(1, snapshot.Count / 3)).ToList();

        return new ProbeReport(
            Stage: _options.Stage.ToString().ToLowerInvariant(),
            Seconds: Math.Round(snapshot[^1].ElapsedSeconds, 1),
            PeakWorkingSetMb: Math.Round(snapshot.Max(s => s.WorkingSetMb), 1),
            SteadyWorkingSetMb: Math.Round(Median(steady.Select(s => s.WorkingSetMb)), 1),
            SteadyPrivateMb: Math.Round(Median(steady.Select(s => s.PrivateMb)), 1),
            SteadyManagedHeapMb: Math.Round(Median(steady.Select(s => s.ManagedHeapMb)), 1),
            Threads: steady[^1].Threads,
            Handles: steady[^1].Handles);
    }

    /// <summary>
    /// 把报告写成一行 JSON —— 方便把三次测量拼成一张表。
    ///
    /// 手写而不是 <c>JsonSerializer.Serialize</c>：AOT 版下反射序列化会踩 IL2026 / IL3050，
    /// 报告直接写不出来。这里就六个数字加一个阶段名，手写比引 source generator 干净。
    /// </summary>
    public static string FormatReport(ProbeReport report) => string.Create(
        CultureInfo.InvariantCulture,
        $"{{\"stage\":\"{report.Stage}\",\"seconds\":{report.Seconds}," +
        $"\"steadyWorkingSetMb\":{report.SteadyWorkingSetMb}," +
        $"\"peakWorkingSetMb\":{report.PeakWorkingSetMb}," +
        $"\"steadyPrivateMb\":{report.SteadyPrivateMb}," +
        $"\"steadyManagedHeapMb\":{report.SteadyManagedHeapMb}," +
        $"\"threads\":{report.Threads},\"handles\":{report.Handles}}}");

    public void Dispose()
    {
        _timer.Dispose();
        _process.Dispose();
    }

    private static double Median(IEnumerable<double> values)
    {
        var ordered = values.OrderBy(v => v).ToList();
        if (ordered.Count == 0) return 0;
        var mid = ordered.Count / 2;
        return ordered.Count % 2 == 1
            ? ordered[mid]
            : (ordered[mid - 1] + ordered[mid]) / 2d;
    }

    private readonly record struct Sample(
        double ElapsedSeconds,
        double WorkingSetMb,
        double PrivateMb,
        double ManagedHeapMb,
        int Threads,
        int Handles)
    {
        public string Describe() => string.Create(
            CultureInfo.InvariantCulture,
            $"t={ElapsedSeconds,5:F1}s  ws={WorkingSetMb,7:F1} MB  priv={PrivateMb,7:F1} MB  " +
            $"gc={ManagedHeapMb,6:F1} MB  thr={Threads,3}  hnd={Handles,5}");
    }
}

internal sealed record ProbeReport(
    string Stage,
    double Seconds,
    double PeakWorkingSetMb,
    double SteadyWorkingSetMb,
    double SteadyPrivateMb,
    double SteadyManagedHeapMb,
    int Threads,
    int Handles)
{
    public string ToMarkdownRow() =>
        $"| {Stage} | {SteadyWorkingSetMb:F1} | {PeakWorkingSetMb:F1} | {SteadyPrivateMb:F1} | " +
        $"{SteadyManagedHeapMb:F1} | {Threads} | {Handles} |";

    public override string ToString() => new StringBuilder()
        .Append(CultureInfo.InvariantCulture, $"stage={Stage} steady_ws={SteadyWorkingSetMb}MB ")
        .Append(CultureInfo.InvariantCulture, $"peak_ws={PeakWorkingSetMb}MB priv={SteadyPrivateMb}MB ")
        .Append(CultureInfo.InvariantCulture, $"gc={SteadyManagedHeapMb}MB")
        .ToString();
}
