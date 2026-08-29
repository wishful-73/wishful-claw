namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// Rule-based query refiner for memory recall. Extracts content-bearing
/// keywords from the user message so multi-path searches are not diluted
/// by chit-chat words ("帮我/谢谢/please"...). No model involved — the
/// original message is always searched as-is alongside the variants.
/// </summary>
public static class MemoryRecallQueryRefiner
{
    private static readonly char[] Delimiters =
    [
        ' ', '\t', '\r', '\n',
        ',', '.', '!', '?', ';', ':', '(', ')', '[', ']', '{', '}', '"', '\'', '/', '\\', '|',
        '，', '。', '！', '？', '、', '；', '：', '（', '）', '《', '》', '【', '】', '“', '”', '‘', '’', '…', '—'
    ];

    private static readonly HashSet<string> Stopwords = new(StringComparer.OrdinalIgnoreCase)
    {
        // Chinese chit-chat / function words
        "帮我", "帮忙", "请你", "麻烦", "谢谢", "感谢", "顺便", "一下",
        "我们", "你们", "他们", "她们", "自己", "大家",
        "这个", "那个", "这样", "那样", "这些", "那些",
        "怎么", "怎样", "如何", "为什么", "多少", "什么时候",
        "可以", "能不能", "能否", "是否", "需要", "想要", "希望",
        "给我", "试试", "看看", "继续", "开始", "现在", "刚才",
        "还有", "然后", "但是", "如果", "因为", "所以", "以及", "或者", "而且",
        // English
        "please", "help", "thanks", "thank", "hey", "hi", "hello",
        "me", "you", "he", "she", "it", "we", "they", "this", "that", "there", "here",
        "the", "a", "an", "to", "of", "and", "or", "for", "with", "in", "on", "at", "by",
        "how", "what", "why", "when", "where", "which", "who",
        "can", "could", "would", "should", "will", "is", "are", "was", "were",
        "do", "does", "did", "need", "want", "like", "also", "now", "just"
    };

    /// <summary>
    /// Extract up to <paramref name="maxVariants"/> keyword queries from the
    /// message. Returns an empty list when nothing content-bearing remains.
    /// </summary>
    public static IReadOnlyList<string> ExtractVariants(string userMessage, int maxVariants = 4)
    {
        if (string.IsNullOrWhiteSpace(userMessage))
            return [];

        var original = userMessage.Trim();
        var tokens = original.Split(Delimiters, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var variants = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in tokens)
        {
            var token = TrimStopwordEdges(raw);
            if (token.Length < 2)
                continue;
            if (Stopwords.Contains(token))
                continue;
            if (string.Equals(token, original, StringComparison.OrdinalIgnoreCase))
                continue;
            if (seen.Add(token.ToLowerInvariant()))
                variants.Add(token);
            if (variants.Count >= maxVariants)
                break;
        }
        return variants;
    }

    /// <summary>
    /// Strips known stopword prefixes/suffixes from a long token
    /// ("帮我优化排序" → "优化排序"). Each strip keeps at least 2 chars.
    /// CJK only — English morphology would be damaged by edge trimming.
    /// </summary>
    private static string TrimStopwordEdges(string token)
    {
        if (!token.Any(IsCjk))
            return token;

        var current = token;
        var changed = true;
        while (changed && current.Length >= 4)
        {
            changed = false;
            foreach (var stop in Stopwords)
            {
                if (stop.Length < 2)
                    continue;
                if (current.StartsWith(stop, StringComparison.OrdinalIgnoreCase) && current.Length - stop.Length >= 2)
                {
                    current = current[stop.Length..];
                    changed = true;
                }
                else if (current.EndsWith(stop, StringComparison.OrdinalIgnoreCase) && current.Length - stop.Length >= 2)
                {
                    current = current[..^stop.Length];
                    changed = true;
                }
            }
        }
        return current;
    }

    private static bool IsCjk(char c) =>
        c is >= '\u4e00' and <= '\u9fff' or >= '\u3400' and <= '\u4dbf';
}
