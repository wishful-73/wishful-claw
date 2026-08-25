using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphTreeSitterHelpers — shared extraction helpers (port of
// extraction/tree-sitter-helpers.ts). generateNodeId → CodeGraphNodeIdFactory.NodeId,
// getNodeText → CodeGraphTsNode.Text, getChildByField → CodeGraphTsNode.ChildByField
// already exist, so only the docstring walk lives here.
//
// [GeneratedRegex] source-generated matchers — AOT-friendly (no runtime IL emit).
// =============================================================================
internal static partial class CodeGraphTreeSitterHelpers
{
    // Node types that WRAP a declaration, so a leading comment is a sibling of the
    // wrapper, not of the emitted (inner) node. CodeGraph emits the inner node, so
    // climb out through these before looking for the preceding comment (#780).
    private static readonly HashSet<string> DocstringWrapperTypes = new()
    {
        "export_statement",     // JS/TS: export class/function/const …
        "decorated_definition", // Python: @decorator over def/class
        "lexical_declaration",  // JS/TS: const/let x = () => {}
        "variable_declaration", // JS/TS: var x = …
        "variable_declarator",  // JS/TS: the `x = () => {}` inside the declaration
        "ambient_declaration"   // TS: declare …
    };

    /// <summary>Get the docstring/comment immediately preceding a node (port of
    /// getPrecedingDocstring). Returns null when no comment sits above it.</summary>
    public static string? GetPrecedingDocstring(CodeGraphTsNode node)
    {
        // Climb out of any wrapper(s) so a comment preceding the WHOLE construct is
        // reachable as a sibling.
        CodeGraphTsNode anchor = node;
        while (true)
        {
            CodeGraphTsNode parent = anchor.Parent;
            if (parent.IsNull || !DocstringWrapperTypes.Contains(parent.Type)) break;
            anchor = parent;
        }

        List<string> comments = new();
        CodeGraphTsNode sibling = anchor.PrevNamedSibling;
        while (!sibling.IsNull)
        {
            string t = sibling.Type;
            if (t is "comment" or "line_comment" or "block_comment" or "documentation_comment")
            {
                comments.Insert(0, sibling.Text); // unshift — keep source order
                sibling = sibling.PrevNamedSibling;
            }
            else
            {
                break;
            }
        }

        if (comments.Count == 0) return null;

        StringBuilder sb = new();
        for (int i = 0; i < comments.Count; i++)
        {
            if (i > 0) sb.Append('\n');
            sb.Append(CleanCommentMarkers(comments[i]));
        }
        return sb.ToString().Trim();
    }

    /// <summary>Strip comment-syntax markers so the stored docstring is just prose.
    /// Paired block delimiters are stripped only when the comment OPENS with one.</summary>
    private static string CleanCommentMarkers(string comment)
    {
        string c = comment.Trim();
        if (c.StartsWith("/*", StringComparison.Ordinal))
            c = BlockCloseRegex().Replace(BlockOpenRegex().Replace(c, string.Empty), string.Empty);
        else if (c.StartsWith("--[", StringComparison.Ordinal))
            c = LuaLongCloseRegex().Replace(LuaLongOpenRegex().Replace(c, string.Empty), string.Empty);
        else if (c.StartsWith("(*", StringComparison.Ordinal))
            c = ParenStarCloseRegex().Replace(ParenStarOpenRegex().Replace(c, string.Empty), string.Empty);
        else if (c.StartsWith("{", StringComparison.Ordinal))
            c = BraceCloseRegex().Replace(BraceOpenRegex().Replace(c, string.Empty), string.Empty);

        c = LineSlashRegex().Replace(c, string.Empty);   // //  and Rust/Swift /// //!
        c = LineDashRegex().Replace(c, string.Empty);    // Lua/Luau line comments
        c = LineHashRegex().Replace(c, string.Empty);    // Python/Ruby/shell
        c = LinePercentRegex().Replace(c, string.Empty); // Erlang (% %% %%%)
        c = BlockContRegex().Replace(c, string.Empty);   // block-comment continuation (* foo)
        return c.Trim();
    }

    [GeneratedRegex(@"^/\*+!?")] private static partial Regex BlockOpenRegex();
    [GeneratedRegex(@"\*+/$")] private static partial Regex BlockCloseRegex();
    [GeneratedRegex(@"^--\[=*\[")] private static partial Regex LuaLongOpenRegex();
    [GeneratedRegex(@"\]=*\]$")] private static partial Regex LuaLongCloseRegex();
    [GeneratedRegex(@"^\(\*")] private static partial Regex ParenStarOpenRegex();
    [GeneratedRegex(@"\*\)$")] private static partial Regex ParenStarCloseRegex();
    [GeneratedRegex(@"^\{")] private static partial Regex BraceOpenRegex();
    [GeneratedRegex(@"\}$")] private static partial Regex BraceCloseRegex();
    [GeneratedRegex(@"^//[/!]?[ \t]?", RegexOptions.Multiline)] private static partial Regex LineSlashRegex();
    [GeneratedRegex(@"^--[ \t]?", RegexOptions.Multiline)] private static partial Regex LineDashRegex();
    [GeneratedRegex(@"^#[ \t]?", RegexOptions.Multiline)] private static partial Regex LineHashRegex();
    [GeneratedRegex(@"^%+[ \t]?", RegexOptions.Multiline)] private static partial Regex LinePercentRegex();
    [GeneratedRegex(@"^[ \t]*\*[ \t]?", RegexOptions.Multiline)] private static partial Regex BlockContRegex();
}
