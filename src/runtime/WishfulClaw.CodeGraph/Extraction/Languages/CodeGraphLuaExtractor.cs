// =============================================================================
// CodeGraphLuaExtractor — Lua language config. Port of extraction/languages/lua.ts.
// Node names follow the vendored ABI-15 grammar (@tree-sitter-grammars/
// tree-sitter-lua), NOT the older tree-sitter-wasms build.
//
// Lua/Luau have no import statement — modules are loaded by calling the global
// `require`, so import nodes are emitted from function_call sites via VisitNode.
// The shared base machinery (require detection, receiver-splitting t.f / t:m →
// methods, the require-in-local-declaration walk) lives here as internal statics
// and is reused verbatim by CodeGraphLuauExtractor (luau.ts spreads luaExtractor
// and overrides only the type-system pieces).
// =============================================================================
internal static class CodeGraphLuaExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        // function_declaration covers global (`function f`), table (`function t.f`),
        // method (`function t:m`), and local (`local function f`) forms — the form is
        // distinguished by the `name:` child and a `local` token, not by node type.
        // Anonymous `function() ... end` (function_definition) has no name and is
        // captured via its enclosing variable instead.
        FunctionTypes = ["function_declaration"],
        ClassTypes = [], // Lua has no classes/structs/interfaces/enums — tables are used for everything
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = [], // `require` is a function_call — handled in VisitNode
        CallTypes = ["function_call"],
        VariableTypes = ["variable_declaration"], // see the `lua` branch in extractVariable
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            return paramsNode.IsNull ? null : paramsNode.Text;
        },

        GetReceiverType = LuaReceiverType,
        VisitNode = VisitLuaNode
    };

    // `function t.f()` / `function t:m()` are methods on table `t`: return the
    // table as the receiver so they extract as methods with a `t::f` qualified
    // name. Plain `function f()` / `local function f()` have no receiver and stay
    // functions. (For `a.b.c`, the receiver is the nested `a.b`.)
    internal static string? LuaReceiverType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode name = node.ChildByField("name");
        if (!name.IsNull && (name.Type == "dot_index_expression" || name.Type == "method_index_expression"))
        {
            CodeGraphTsNode table = name.ChildByField("table");
            if (!table.IsNull) return table.Text;
        }
        return null;
    }

    // Emit import nodes for `require(...)`. The local-declaration form is handled
    // explicitly because the variable branch skips the initializer subtree; bare
    // and global `require` calls are caught when the walker reaches function_call.
    internal static bool VisitLuaNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        if (node.Type == "function_call")
        {
            if (RequireModule(node, ctx.Source) != null)
            {
                EmitRequire(node, ctx);
                return true; // claim it so it isn't double-counted as a call
            }
            return false;
        }

        if (node.Type == "variable_declaration")
        {
            // `local x = require("x")` — dig the initializer out of the assignment.
            CodeGraphTsNode assign = FirstNamedChildOfType(node, "assignment_statement");
            if (!assign.IsNull)
            {
                CodeGraphTsNode exprList = FirstNamedChildOfType(assign, "expression_list");
                if (!exprList.IsNull)
                {
                    int count = exprList.NamedChildCount;
                    for (int i = 0; i < count; i++)
                    {
                        CodeGraphTsNode val = exprList.NamedChild(i);
                        if (val.Type == "function_call") EmitRequire(val, ctx);
                    }
                }
            }
            return false;
        }

        return false;
    }

    private static void EmitRequire(CodeGraphTsNode callNode, CodeGraphExtractorContext ctx)
    {
        string? mod = RequireModule(callNode, ctx.Source);
        if (mod == null) return;
        string sig = callNode.Text.Trim();
        if (sig.Length > 100) sig = sig.Substring(0, 100);
        CodeGraphNode? imp = ctx.CreateNode(CodeGraphNodeKind.Import, mod, callNode, new CodeGraphNodeExtra
        {
            Signature = sig
        });
        if (imp != null && ctx.NodeStack.Count > 0)
        {
            string parentId = ctx.NodeStack[ctx.NodeStack.Count - 1];
            ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
                FromNodeId: parentId,
                ReferenceName: mod,
                ReferenceKind: CodeGraphEdgeKind.Imports,
                Line: (int)callNode.StartPoint.Row + 1,
                Column: (int)callNode.StartPoint.Column,
                FilePath: ctx.FilePath,
                Language: null,
                Candidates: null,
                RowId: null));
        }
    }

    // If `callNode` is a `require(...)` call, return the module name; otherwise null.
    // Handles both string requires (`require("net.http")` / `require "net.http"` →
    // "net.http") and Roblox/Luau instance-path requires (`require(script.Parent.Signal)`
    // → "Signal" — the trailing field is the module name).
    internal static string? RequireModule(CodeGraphTsNode callNode, CodeGraphSourceText source)
    {
        // A dotted/colon callee (e.g. `socket.connect`) is dot/method_index_expression,
        // never a bare `require`.
        CodeGraphTsNode name = callNode.ChildByField("name");
        if (name.IsNull || name.Type != "identifier") return null;
        if (name.Text != "require") return null;

        CodeGraphTsNode args = callNode.ChildByField("arguments");
        if (args.IsNull) return null;

        // String require — `string > content: string_content` gives the bare name.
        CodeGraphTsNode content = FindDescendant(args, "string_content");
        if (!content.IsNull)
        {
            string t = content.Text.Trim();
            return t.Length > 0 ? t : null;
        }
        CodeGraphTsNode str = FindDescendant(args, "string");
        if (!str.IsNull)
        {
            string mod = str.Text.Trim();
            mod = StripEnds(mod, "[[", "]]");
            mod = StripQuotes(mod);
            if (mod.Length > 0) return mod;
        }

        // Roblox/Luau instance-path require: `require(script.Parent.Signal)` → "Signal".
        CodeGraphTsNode idx = FindDescendant(args, "dot_index_expression");
        if (idx.IsNull) idx = FindDescendant(args, "method_index_expression");
        if (!idx.IsNull)
        {
            CodeGraphTsNode field = idx.ChildByField("field");
            if (field.IsNull) field = idx.ChildByField("method");
            if (!field.IsNull)
            {
                string t = field.Text.Trim();
                return t.Length > 0 ? t : null;
            }
        }
        return null;
    }

    private static string StripEnds(string s, string prefix, string suffix)
    {
        if (s.StartsWith(prefix, System.StringComparison.Ordinal)) s = s.Substring(prefix.Length);
        if (s.EndsWith(suffix, System.StringComparison.Ordinal)) s = s.Substring(0, s.Length - suffix.Length);
        return s;
    }

    private static string StripQuotes(string s)
    {
        if (s.Length >= 1 && (s[0] == '"' || s[0] == '\'')) s = s.Substring(1);
        if (s.Length >= 1 && (s[^1] == '"' || s[^1] == '\'')) s = s.Substring(0, s.Length - 1);
        return s;
    }

    // First descendant of a given type (breadth-first), or a null node.
    private static CodeGraphTsNode FindDescendant(CodeGraphTsNode node, string type)
    {
        Queue<CodeGraphTsNode> queue = new();
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++) queue.Enqueue(node.NamedChild(i));
        while (queue.Count > 0)
        {
            CodeGraphTsNode n = queue.Dequeue();
            if (n.Type == type) return n;
            int c = n.NamedChildCount;
            for (int i = 0; i < c; i++) queue.Enqueue(n.NamedChild(i));
        }
        return default;
    }

    private static CodeGraphTsNode FirstNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == type) return child;
        }
        return default;
    }
}
