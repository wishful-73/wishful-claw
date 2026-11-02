using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Templates;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;

namespace WishfulClaw.AvaloniaProbe;

/// <summary>
/// 完整聊天场景 —— 不是空窗口。
///
/// 要回答的问题是：Avalonia 把「一条真实聊天消息」画出来要多少钱。
/// 空窗口那 150+ MB 只说明壳的基线，说明不了换壳到底能不能治我们的内存问题。
///
/// 内容密度刻意对齐我们真实聊天窗的一条助手消息：
/// 小标题 + 4~6 段正文（每段 100~260 字）+ 30% 概率代码块 + 60% 概率工具卡 + 每 7 条一张图。
/// 消息列表走虚拟化 —— 我们 Electron 侧也是虚拟列表，不虚拟化比出来的数没有意义。
/// </summary>
internal static class ChatScenario
{
    // 配色对齐我们暗色主题。换主题会影响字形缓存命中率，不该混进内存差异里。
    private static readonly IBrush TextBrush = new SolidColorBrush(Color.Parse("#D6D6DB"));
    private static readonly IBrush MutedBrush = new SolidColorBrush(Color.Parse("#8A8A93"));
    private static readonly IBrush UserBubbleBrush = new SolidColorBrush(Color.Parse("#2C2C33"));
    private static readonly IBrush CardBrush = new SolidColorBrush(Color.Parse("#232329"));
    private static readonly IBrush LineBrush = new SolidColorBrush(Color.Parse("#34343C"));
    private static readonly IBrush CodeBrush = new SolidColorBrush(Color.Parse("#1E1E23"));

    private static readonly string[] ParagraphPool =
    {
        "我先把这一轮的改动面收一下：涉及消息实体、查询端点、工具注册三处，其中查询端点是并列新增，"
        + "老端点一个字都没动，所以老库不需要迁移。风险点集中在时间切日 —— 我们用的是本地时区，"
        + "如果按 UTC 切，晚上八点以后发的消息会落到前一天，用户回看的时候就会觉得少了一条。",

        "这个数字对不上。理论上限是 156 加上 worker 那 320，加起来不到 500，但实测是 1326。"
        + "差出来的那 800 多不在壳里，在渲染层 —— 具体是长列表的控件实例、markdown 的中间态、"
        + "还有图片解码后的位图缓存。换壳只动第一项，后两项一个字节都省不下来。",

        "我建议先不动这块。理由不是工期，是收益不可测：改完之后最乐观是持平，"
        + "而代价是 874 个渲染层文件全部重写，每一个都得重新对齐一遍交互细节。"
        + "真要压内存，先看那个一直涨到 2G 的会话到底是谁在持有引用。",

        "压缩这一步的行为是这样：跑完一轮以后把前面的对话收成一条摘要，摘要本身也是消息，"
        + "所以它会被后续的查询读到。问题是摘要的正文有几千字，渲染层拿到的是一条超长消息，"
        + "一展开就是几万个字符的文本布局，这就是那个会话卡住的直接原因。",

        "反向验证我补了三条：第一条，把 sessionId 塞成别的会话，读不到；"
        + "第二条，把日期设成明天，返回空；第三条，把 limit 设成 0，返回的是全量而不是空。"
        + "三条都过，这个工具才算能用 —— 前两条是安全边界，第三条是参数语义。",

        "工具卡折叠这块我改了两处：报错的工具不再单独留在外面，跟成功的走同一套折叠逻辑；"
        + "另外卡片标题右侧那个状态点，原来是按工具名判断的，现在按实际结果判断，"
        + "不然一个成功返回但内容里带 error 字段的工具会被标成红色。",

        "内存这件事我想说清楚一点：运行中占用高不是问题，跑完了不还才是问题。"
        + "我们量过一轮，峰值到 1038，然后平台落到 727，还了 311 MB —— 这个回收是正常的。"
        + "不正常的是那种一路涨上去、停止执行了还在涨的，那才是真的有人没放手。",

        "首屏加载这块，现在的做法是只取最近五轮用户消息，而不是全量。"
        + "所以那个「一打开就 2G」的会话，问题不在首屏查询，在压缩卡片 —— "
        + "每张压缩卡片的正文都是完整摘要，五张卡片就是几万字，一次布局全渲染。"
    };

    private static readonly string[] CodePool =
    {
        "var rows = await _db.QueryAsync<MessageUserRow>(\n"
        + "    \"SELECT created_at, text, attachment_summary FROM messages \"\n"
        + "    + \"WHERE session_id = @sid AND role = 'user' \"\n"
        + "    + \"AND created_at >= @from AND created_at < @to \"\n"
        + "    + \"ORDER BY created_at DESC LIMIT @limit\",\n"
        + "    new { sid = sessionId, from = dayStart, to = dayEnd, limit });\n"
        + "\n"
        + "return rows.Select(r => new MessageUserRow(\n"
        + "    r.CreatedAt, BuildSnippet(r.Text, 20, 30), r.AttachmentSummary)).ToList();",

        "{\n"
        + "  \"stage\": \"chat\",\n"
        + "  \"seconds\": 60.0,\n"
        + "  \"steadyWorkingSetMb\": 412.7,\n"
        + "  \"peakWorkingSetMb\": 468.2,\n"
        + "  \"steadyPrivateMb\": 386.1,\n"
        + "  \"steadyManagedHeapMb\": 74.3,\n"
        + "  \"threads\": 34,\n"
        + "  \"handles\": 812\n"
        + "}",

        "if (AgentRuntimeSessionHistoryExecutor.IsSessionHistoryTool(toolCall.Name))\n"
        + "{\n"
        + "    toolOutput = executor.Execute(toolCall.Input, state.Parameters);\n"
        + "    isToolError = IsJsonError(toolOutput);\n"
        + "}\n"
        + "else if (AgentRuntimeGlobalTaskExecutor.IsGlobalTaskTool(toolCall.Name))\n"
        + "{\n"
        + "    toolOutput = await globalTasks.ExecuteAsync(toolCall.Input, ct);\n"
        + "}"
    };

    private static readonly string[] ToolNamePool =
    {
        "files > 读取文件",
        "files > Edit",
        "shell > 执行命令",
        "search > 全文搜索",
        "browser > 打开页面"
    };

    private static readonly string[] ToolDetailPool =
    {
        "读取 152 行 · 14ms",
        "编辑中: notes/s219-concurrent-edit-test.md · +1 -1",
        "dotnet build · 0 警告 0 错误 · 8.4s",
        "命中 37 处 · 12 文件",
        "加载完成 · 200 OK · 1.2s"
    };

    /// <summary>造历史消息。条数由 --messages 给，默认 200 —— 大致是重度用户一两天的量。</summary>
    public static List<ChatMessage> BuildHistory(int count)
    {
        var messages = new List<ChatMessage>(count);

        for (var i = 0; i < count; i++)
        {
            var isUser = i % 3 == 0;

            if (isUser)
            {
                var user = new ChatMessage(true, $"用户 · #{i:D3}");
                user.Paragraphs.Add(ParagraphPool[i % ParagraphPool.Length]);
                messages.Add(user);
                continue;
            }

            var assistant = new ChatMessage(false, $"助手 · #{i:D3}")
            {
                CodeBlock = i % 10 == 3 ? CodePool[i / 3 % CodePool.Length] : null,
                ToolName = i % 5 == 1 ? ToolNamePool[i % ToolNamePool.Length] : null,
                ToolDetail = i % 5 == 1 ? ToolDetailPool[i % ToolDetailPool.Length] : null,
                HasImage = i % 7 == 0
            };

            // 每段 100~260 字，4~6 段 —— 真实助手回复的密度。
            var paragraphs = 4 + i % 3;
            for (var p = 0; p < paragraphs; p++)
            {
                assistant.Paragraphs.Add(ParagraphPool[(i + p) % ParagraphPool.Length]);
            }

            messages.Add(assistant);
        }

        return messages;
    }

    /// <summary>
    /// 列表本体。用 ItemsControl + VirtualizingStackPanel + 外层 ScrollViewer：
    /// 跟我们 Electron 侧的虚拟列表是同一种成本模型 —— 只建可视区的容器。
    /// 不虚拟化的话（裸 StackPanel），量出来的是「200 条全建」的假高值，没有对比意义。
    /// </summary>
    public static ScrollViewer BuildView(IReadOnlyList<ChatMessage> messages, Bitmap? thumbnail)
    {
        var list = new ItemsControl
        {
            ItemsSource = messages,
            ItemTemplate = BuildTemplate(thumbnail),
            ItemsPanel = new FuncTemplate<Panel>(() => new VirtualizingStackPanel())
        };

        return new ScrollViewer
        {
            Content = list,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto,
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled
        };
    }

    private static FuncDataTemplate<ChatMessage> BuildTemplate(Bitmap? thumbnail) =>
        new((message, _) => message is null ? new Panel() : BuildMessage(message, thumbnail));

    private static Control BuildMessage(ChatMessage message, Bitmap? thumbnail)
    {
        var root = new StackPanel
        {
            Spacing = 8,
            Margin = new Thickness(0, 0, 0, 24),
            HorizontalAlignment = message.IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left,
            MaxWidth = 880
        };

        if (message.IsUser)
        {
            root.Children.Add(new Border
            {
                Background = UserBubbleBrush,
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(14, 10),
                Child = BuildParagraphList(message)
            });

            return root;
        }

        root.Children.Add(new TextBlock
        {
            Text = message.Title,
            FontSize = 12,
            Foreground = MutedBrush,
            FontFamily = new FontFamily("Consolas,Menlo,monospace")
        });

        root.Children.Add(BuildParagraphList(message));

        if (message.CodeBlock is not null)
        {
            root.Children.Add(BuildCodeBlock(message.CodeBlock));
        }

        if (message.ToolName is not null)
        {
            root.Children.Add(BuildToolCard(message.ToolName, message.ToolDetail ?? string.Empty));
        }

        if (message.HasImage && thumbnail is not null)
        {
            root.Children.Add(new Border
            {
                Background = CardBrush,
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(6),
                HorizontalAlignment = HorizontalAlignment.Left,
                Child = new Image
                {
                    Source = thumbnail,
                    Width = 420,
                    Height = 280,
                    Stretch = Stretch.UniformToFill
                }
            });
        }

        return root;
    }

    /// <summary>
    /// 段落用嵌套 ItemsControl 绑 ObservableCollection —— 流式追加时只增量渲染新段落，
    /// 不重建整条消息。整体重建的渲染成本模型跟真实聊天窗不是一回事。
    /// </summary>
    private static Control BuildParagraphList(ChatMessage message) => new ItemsControl
    {
        ItemsSource = message.Paragraphs,
        ItemTemplate = new FuncDataTemplate<string>((text, _) => new SelectableTextBlock
        {
            Text = text ?? string.Empty,
            TextWrapping = TextWrapping.Wrap,
            FontSize = 14,
            LineHeight = 23,
            Foreground = TextBrush,
            Margin = new Thickness(0, 0, 0, 10)
        })
    };

    private static Control BuildCodeBlock(string code) => new Border
    {
        Background = CodeBrush,
        BorderBrush = LineBrush,
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(8),
        Padding = new Thickness(12, 10),
        Child = new SelectableTextBlock
        {
            Text = code,
            FontFamily = new FontFamily("Consolas,Menlo,monospace"),
            FontSize = 12.5,
            LineHeight = 20,
            Foreground = new SolidColorBrush(Color.Parse("#C8D0DA")),
            TextWrapping = TextWrapping.NoWrap
        }
    };

    private static Control BuildToolCard(string name, string detail)
    {
        var header = new Grid { ColumnDefinitions = new ColumnDefinitions("Auto,*,Auto") };

        header.Children.Add(new TextBlock
        {
            Text = name,
            FontSize = 13,
            Foreground = TextBrush
        });

        var detailText = new TextBlock
        {
            Text = detail,
            FontSize = 12,
            Foreground = MutedBrush,
            HorizontalAlignment = HorizontalAlignment.Right
        };
        Grid.SetColumn(detailText, 2);
        header.Children.Add(detailText);

        return new Border
        {
            Background = CardBrush,
            BorderBrush = LineBrush,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12, 8),
            Child = header
        };
    }

    /// <summary>
    /// 流式：每 40 ms 往目标消息追加一段。段落数到上限就停 —— 再多是压力测试，不是聊天。
    /// 返回的 Action 用来手动叫停。
    /// </summary>
    public static Action StartStreaming(ChatMessage target, Action onGrow, int maxParagraphs = 400)
    {
        var index = 0;
        var timer = new Avalonia.Threading.DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };

        timer.Tick += (_, _) =>
        {
            if (index >= maxParagraphs)
            {
                timer.Stop();
                target.IsStreaming = false;
                return;
            }

            target.Paragraphs.Add(string.Create(
                CultureInfo.InvariantCulture,
                $"[{index:D4}] {ParagraphPool[index % ParagraphPool.Length]}"));

            index++;
            onGrow();
        };

        target.IsStreaming = true;
        timer.Start();

        return timer.Stop;
    }
}
