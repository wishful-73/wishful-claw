// =============================================================================
// CodeGraphLuauExtractor — Luau language config. Port of extraction/languages/luau.ts
// (which spreads lua.ts). Luau (https://luau.org) is a gradually-typed superset of
// Lua whose tree-sitter grammar reuses the vendored Lua node names
// (function_declaration, variable_declaration, function_call, dot/method_index_
// expression, …), so this config layers the Luau type-system additions on the
// shared Lua base (CodeGraphLuaExtractor):
//   - `type X = ...` / `export type X = ...` → type_definition (type_alias)
//   - typed parameters and return types      → richer signatures
//
// require detection, receiver-splitting (t.f / t:m → methods), and local-variable
// extraction are inherited unchanged from the Lua base via the shared internal
// statics on CodeGraphLuaExtractor.
// =============================================================================
internal static class CodeGraphLuauExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        // function_declaration covers global (`function f`), table (`function t.f`),
        // method (`function t:m`), and local (`local function f`) forms — the form is
        // distinguished by the `name:` child and a `local` token, not by node type.
        FunctionTypes = ["function_declaration"],
        ClassTypes = [], // Lua/Luau have no classes — tables are used for everything
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        // `type X = ...` and `export type X = ...` (Luau addition).
        TypeAliasTypes = ["type_definition"],
        ImportTypes = [], // `require` is a function_call — handled in VisitNode
        CallTypes = ["function_call"],
        VariableTypes = ["variable_declaration"], // see the `lua` branch in extractVariable
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        // Params + Luau return type (the named child after `parameters`, before the body).
        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            if (paramsNode.IsNull) return null;
            string sig = paramsNode.Text;
            int count = node.NamedChildCount;
            int idx = -1;
            for (int i = 0; i < count; i++)
            {
                if (node.NamedChild(i).StartByte == paramsNode.StartByte) { idx = i; break; }
            }
            CodeGraphTsNode ret = idx >= 0 && idx + 1 < count ? node.NamedChild(idx + 1) : default;
            if (!ret.IsNull && ret.Type != "block") sig += ": " + ret.Text;
            return sig;
        },

        // Only Luau `export type` is exported; the keyword leads the node.
        IsExported = (node, source) =>
            source.Slice(node.StartByte, node.StartByte + 7) == "export ",

        // Shared Lua base pieces (lua.ts): receiver-splitting + require detection.
        GetReceiverType = CodeGraphLuaExtractor.LuaReceiverType,
        VisitNode = CodeGraphLuaExtractor.VisitLuaNode
    };
}
