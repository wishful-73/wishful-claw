using System.Text;
using WishfulClaw.Agent.Tools;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-80 —— 文件写入的 BOM 处理。
///
/// 契约：写入**保留目标文件原本的 BOM 状态**，新建文件按无 BOM。
/// 编辑工具顺手把 .ps1 的 BOM 抹掉会让脚本乱码甚至执行失败；反过来给一个
/// 无 BOM 的文件补上 BOM，会在 diff 里留噪音、也会让严格解析器读不动。
/// 两个方向都算错，所以这里两个方向都钉。
/// </summary>
internal static partial class Program
{
    private static void RunBomPreservationSuite()
    {
        var dir = Path.Combine(Path.GetTempPath(), "wc-bom-suite");
        Directory.CreateDirectory(dir);
        var bomFile = Path.Combine(dir, "with-bom.ps1");
        var plainFile = Path.Combine(dir, "plain.ts");
        var newFile = Path.Combine(dir, "created.ts");

        try
        {
            // 1) 带 BOM 的文件：写回后 BOM 必须还在（内容是 ASCII，BOM 只能来自保留逻辑）
            File.WriteAllBytes(bomFile, [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("Write-Host 1")]);
            ToolHelpers.WriteAndFlushAsync(bomFile, "Write-Host 2", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(true, StartsWithUtf8Bom(bomFile), "带 BOM 的文件写回后保留 BOM");
            AssertEqual("Write-Host 2", File.ReadAllText(bomFile), "保留 BOM 时内容也要正确");

            // 2) 无 BOM 的文件：不许凭空补一个
            File.WriteAllBytes(plainFile, Encoding.UTF8.GetBytes("const a = 1"));
            ToolHelpers.WriteAndFlushAsync(plainFile, "const a = 2", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(plainFile), "无 BOM 的文件写回后仍无 BOM");
            AssertEqual("const a = 2", File.ReadAllText(plainFile), "无 BOM 分支内容也要正确");

            // 3) 新建文件：默认无 BOM
            ToolHelpers.WriteAndFlushAsync(newFile, "export {}", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(newFile), "新建文件不带 BOM");

            // 4) 连续写两次：状态稳定，不会第二次把 BOM 丢了
            ToolHelpers.WriteAndFlushAsync(bomFile, "Write-Host 3", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(true, StartsWithUtf8Bom(bomFile), "带 BOM 的文件连续写入仍保留 BOM");

            // 5) 只有 BOM 没有内容：别把探测读成「文件为空」而误判
            var onlyBom = Path.Combine(dir, "only-bom.txt");
            File.WriteAllBytes(onlyBom, [0xEF, 0xBB, 0xBF]);
            ToolHelpers.WriteAndFlushAsync(onlyBom, "x", CancellationToken.None).GetAwaiter().GetResult();
            AssertEqual(true, StartsWithUtf8Bom(onlyBom), "原本只有 BOM 的文件也判得出 BOM");
        }
        finally
        {
            try
            {
                Directory.Delete(dir, recursive: true);
            }
            catch (IOException)
            {
                // 清理失败不影响断言结论。
            }
        }
    }

    private static bool StartsWithUtf8Bom(string path)
    {
        var head = new byte[3];
        using var fs = File.OpenRead(path);
        return fs.Read(head, 0, 3) == 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF;
    }
}
