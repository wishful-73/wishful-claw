using System.Text;
using WishfulClaw.Agent.Tools;
using WishfulClaw.TestSupport;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-80 —— 文件写入的 BOM 处理。
///
/// 契约：**默认一律不写 BOM**。BOM 会让严格解析器读不动，也会在 diff 里留噪音，
/// 所以带 BOM 的普通文件被写过一次之后就应该是干净的。
/// 唯一例外是靠 BOM 才能被正确识别为 UTF-8 的脚本扩展名（.ps1 / .bat / .cmd）：
/// 它们**保留目标文件原本的状态** —— 原本有就留着，原本没有也不补。
/// </summary>
internal static partial class Program
{
    private static void RunBomPolicySuite()
    {
        var dir = Path.Combine(TestOutputRoot.Resolve(), "wc-bom-suite");
        Directory.CreateDirectory(dir);
        var scriptFile = Path.Combine(dir, "with-bom.ps1");
        var plainScriptFile = Path.Combine(dir, "plain.ps1");
        var bomSourceFile = Path.Combine(dir, "with-bom.ts");
        var plainFile = Path.Combine(dir, "plain.ts");
        var newFile = Path.Combine(dir, "created.ts");

        try
        {
            // 1) 脚本类（.ps1）带 BOM：写回后 BOM 必须还在，否则 PowerShell 5.1 会乱码
            File.WriteAllBytes(scriptFile, [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("Write-Host 1")]);
            ToolHelpers.WriteAndFlushAsync(scriptFile, "Write-Host 2", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(true, StartsWithUtf8Bom(scriptFile), ".ps1 带 BOM 写回后保留 BOM");
            AssertEqual("Write-Host 2", File.ReadAllText(scriptFile), ".ps1 保留 BOM 时内容也要正确");

            // 2) 脚本类原本无 BOM：白名单不等于「必须加」，不许凭空补一个
            File.WriteAllBytes(plainScriptFile, Encoding.UTF8.GetBytes("Write-Host 1"));
            ToolHelpers.WriteAndFlushAsync(plainScriptFile, "Write-Host 2", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(plainScriptFile), ".ps1 原本无 BOM 就不补");

            // 3) 非脚本扩展名（.ts）带 BOM：写回后 BOM 必须被清掉 —— 这是本契约的主线
            File.WriteAllBytes(bomSourceFile, [0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("const a = 1")]);
            ToolHelpers.WriteAndFlushAsync(bomSourceFile, "const a = 2", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(bomSourceFile), ".ts 带 BOM 写回后清掉 BOM");
            AssertEqual("const a = 2", File.ReadAllText(bomSourceFile), "清掉 BOM 后内容也要正确");

            // 4) 无 BOM 的文件：不要凭空补一个
            File.WriteAllBytes(plainFile, Encoding.UTF8.GetBytes("const a = 1"));
            ToolHelpers.WriteAndFlushAsync(plainFile, "const a = 2", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(plainFile), "无 BOM 的文件写回后仍无 BOM");
            AssertEqual("const a = 2", File.ReadAllText(plainFile), "无 BOM 分支内容也要正确");

            // 5) 新建文件：无 BOM
            ToolHelpers.WriteAndFlushAsync(newFile, "export {}", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(newFile), "新建文件不带 BOM");

            // 6) 脚本类连续写两次：状态稳定，不会第二次把 BOM 丢了
            ToolHelpers.WriteAndFlushAsync(scriptFile, "Write-Host 3", CancellationToken.None)
                .GetAwaiter().GetResult();
            AssertEqual(true, StartsWithUtf8Bom(scriptFile), ".ps1 连续写入仍保留 BOM");

            // 7) 只有 BOM 没有内容的普通文件：别把探测读成「文件为空」而误判
            var onlyBom = Path.Combine(dir, "only-bom.txt");
            File.WriteAllBytes(onlyBom, [0xEF, 0xBB, 0xBF]);
            ToolHelpers.WriteAndFlushAsync(onlyBom, "x", CancellationToken.None).GetAwaiter().GetResult();
            AssertEqual(false, StartsWithUtf8Bom(onlyBom), "原本只有 BOM 的普通文件也清干净");
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
