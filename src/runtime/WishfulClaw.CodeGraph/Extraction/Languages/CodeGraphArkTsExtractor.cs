// =============================================================================
// CodeGraphArkTsExtractor — ArkTS (HarmonyOS / OpenHarmony, `.ets`) language config.
// Port of extraction/languages/arkts.ts.
//
// ArkTS is a TypeScript superset, and the vendored grammar extends
// tree-sitter-javascript exactly the way tree-sitter-typescript does, so the whole
// CodeGraphTypeScriptExtractor config applies verbatim — this config `with`-spreads it
// and overrides only the ArkTS-specific shapes:
//   - `struct_declaration` — the `@Component struct` (StructTypes), extracted like a
//     class; its component decorators are preserved via ExtractModifiers.
//   - build()-DSL component instantiations and detached chains
//     (`arkui_component_expression`, `leading_dot_expression`) as call sites (CallTypes).
//   - ExtractModifiers surfaces ArkTS decorators (`@Component`, `@State`, `@Builder`, …)
//     on the node's decorators list — the only path that puts names on struct nodes.
// =============================================================================
internal static class CodeGraphArkTsExtractor
{
    // Reactive/state decorators that make a member worth flagging (searchable).
    private static readonly HashSet<string> DecoratedMemberTypes = new()
    {
        "struct_declaration",
        "public_field_definition",
        "method_definition",
        "function_declaration"
    };

    public static readonly ICodeGraphLanguageExtractor Instance =
        (CodeGraphLanguageExtractor)CodeGraphTypeScriptExtractor.Instance with
        {
            // `@Component struct X { … }` — extracted as a struct; members go through
            // the standard class-member paths.
            StructTypes = ["struct_declaration"],

            // build()-DSL component instantiations are call sites; the arkts branch in
            // extractCall lifts chained `.attr(...)` and `.onXxx(this.handler)` bindings.
            // `leading_dot_expression` is the detached-chain shape.
            CallTypes = ["call_expression", "arkui_component_expression", "leading_dot_expression"],

            // Surface ArkTS decorators on the node's decorators list — struct nodes are
            // only populated with decorator names via this hook.
            ExtractModifiers = node =>
                DecoratedMemberTypes.Contains(node.Type) ? CollectDecoratorNames(node) : null
        };

    // Collect decorator names for a declaration from BOTH positions the grammar
    // produces: direct `decorator` children and preceding `decorator` siblings. The
    // backwards sibling walk stops at the first non-decorator so an earlier
    // declaration's decorators never leak in.
    private static IReadOnlyList<string>? CollectDecoratorNames(CodeGraphTsNode node)
    {
        List<string> names = new();

        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == "decorator")
            {
                string? n = DecoratorName(child);
                if (n != null) names.Add(n);
            }
        }

        CodeGraphTsNode parent = node.Parent;
        if (!parent.IsNull)
        {
            // Find this node among the parent's named children by start offset, then
            // walk backwards over preceding decorators.
            int start = node.StartByte;
            int idx = -1;
            int pc = parent.NamedChildCount;
            for (int i = 0; i < pc; i++)
            {
                CodeGraphTsNode sib = parent.NamedChild(i);
                if (!sib.IsNull && sib.StartByte == start) { idx = i; break; }
            }
            for (int i = idx - 1; i >= 0; i--)
            {
                CodeGraphTsNode sib = parent.NamedChild(i);
                if (sib.IsNull || sib.Type != "decorator") break;
                string? n = DecoratorName(sib);
                if (n != null) names.Insert(0, n);
            }
        }

        return names.Count > 0 ? names : null;
    }

    private static string? DecoratorName(CodeGraphTsNode dec)
    {
        int count = dec.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = dec.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type == "identifier") return child.Text;
            if (child.Type == "call_expression")
            {
                // `@StorageLink('theme')` / `@Extend(Text)` — the name is the callee.
                CodeGraphTsNode fn = child.ChildByField("function");
                if (!fn.IsNull && fn.Type == "identifier") return fn.Text;
            }
        }
        return null;
    }
}
