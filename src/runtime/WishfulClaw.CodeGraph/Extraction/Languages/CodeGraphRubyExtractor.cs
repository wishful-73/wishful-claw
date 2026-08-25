// =============================================================================
// CodeGraphRubyExtractor — Ruby language config. Port of extraction/languages/ruby.ts.
//
// Methods are `method` (functions when top-level, methods inside a class/module);
// `singleton_method` (`def self.foo`) is method-only. Ruby has no interfaces — modules
// are the composition unit, minted as `module` nodes by the VisitNode hook (which also
// pushes them as a scope so members get qualified names). Mixins (`include`/`extend`/
// `prepend Mod`) parse as bare calls; the hook turns them into `implements` references
// instead of a spurious call to a method named "include". Variables are `assignment`
// (the engine shares Python's left/right branch). Bare method calls (`reset` with no
// parens/receiver) parse as plain identifiers — ExtractBareCall recovers them.
// =============================================================================
internal static class CodeGraphRubyExtractor
{
    // Statement-position block parents — only a bare identifier directly under one of
    // these is a candidate bare method call (ruby.ts BLOCK_PARENTS).
    private static readonly HashSet<string> BlockParents = new(StringComparer.Ordinal)
    {
        "body_statement", "then", "else", "do", "begin", "rescue", "ensure", "when"
    };

    // Ruby keywords / pseudo-vars that are never a call (ruby.ts SKIP).
    private static readonly HashSet<string> BareCallSkip = new(StringComparer.Ordinal)
    {
        "true", "false", "nil", "self", "super", "__FILE__", "__LINE__", "__dir__"
    };

    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["method"],
        ClassTypes = ["class"],
        MethodTypes = ["method", "singleton_method"],
        ClassifyMethodNode = node =>
        {
            CodeGraphTsNode name = node.ChildByField("name");
            return !name.IsNull && name.Text == "initialize" ? "constructor" : "method";
        },
        InterfaceTypes = [], // Ruby uses modules (handled via VisitNode)
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = ["call"], // require / require_relative
        CallTypes = ["call", "method_call"],
        VariableTypes = ["assignment"], // Ruby uses assignment like Python
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        VisitNode = VisitRubyNode,
        ExtractBareCall = ExtractRubyBareCall,

        GetVisibility = node =>
        {
            // Ruby visibility is set by a preceding `private`/`protected`/`public` call.
            CodeGraphTsNode sibling = node.PrevNamedSibling;
            while (!sibling.IsNull)
            {
                if (sibling.Type == "call")
                {
                    CodeGraphTsNode methodName = sibling.ChildByField("method");
                    if (!methodName.IsNull)
                    {
                        string text = methodName.Text;
                        if (text == "private") return CodeGraphVisibility.Private;
                        if (text == "protected") return CodeGraphVisibility.Protected;
                        if (text == "public") return CodeGraphVisibility.Public;
                    }
                }
                sibling = sibling.PrevNamedSibling;
            }
            return CodeGraphVisibility.Public;
        },

        ExtractImport = ExtractRubyImport
    };

    private static bool VisitRubyNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        // Mixins: `include Mod`, `extend Mod`, `prepend Mod[, Other]` — a bare call to
        // include/extend/prepend with the module(s) as constant args. Emit an
        // `implements` edge (enclosing class/module → mixed-in module).
        if (node.Type == "call" && node.ChildByField("receiver").IsNull)
        {
            CodeGraphTsNode method = node.ChildByField("method");
            string mname = method.IsNull ? string.Empty : method.Text;
            if (mname is "include" or "extend" or "prepend")
            {
                string? parentId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[ctx.NodeStack.Count - 1] : null;
                CodeGraphTsNode args = node.ChildByField("arguments");
                if (args.IsNull) args = FirstNamedChildOfType(node, "argument_list");
                if (parentId != null && !args.IsNull)
                {
                    int count = args.NamedChildCount;
                    for (int i = 0; i < count; i++)
                    {
                        CodeGraphTsNode arg = args.NamedChild(i);
                        // `Mod` is `constant`, `Foo::Bar` is `scope_resolution`. Skip
                        // `extend self` / dynamic args.
                        if (arg.Type is "constant" or "scope_resolution")
                        {
                            ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
                                FromNodeId: parentId,
                                ReferenceName: arg.Text,
                                ReferenceKind: CodeGraphEdgeKind.Implements,
                                Line: (int)node.StartPoint.Row + 1,
                                Column: (int)node.StartPoint.Column,
                                FilePath: ctx.FilePath,
                                Language: null,
                                Candidates: null,
                                RowId: null));
                        }
                    }
                    return true; // handled — don't also extract as a call to "include"
                }
            }
        }

        if (node.Type != "module") return false;

        CodeGraphTsNode nameNode = node.ChildByField("name");
        if (nameNode.IsNull) return false;

        CodeGraphNode? moduleNode = ctx.CreateNode(CodeGraphNodeKind.Module, nameNode.Text, node);
        if (moduleNode == null) return false;

        // Push the module as a scope so children get qualified names.
        ctx.PushScope(moduleNode.Id);
        CodeGraphTsNode body = node.ChildByField("body");
        if (!body.IsNull)
        {
            int count = body.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = body.NamedChild(i);
                if (!child.IsNull) ctx.VisitNode(child);
            }
        }
        ctx.PopScope();
        return true; // handled
    }

    // A Ruby bare method call (no parens, no receiver) parses as a plain `identifier`
    // (e.g. `reset` in a body). Recover the callee name, skipping keywords/pseudo-vars
    // and constants (class/module refs, not calls). (ruby.ts extractBareCall)
    private static string? ExtractRubyBareCall(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        if (node.Type != "identifier") return null;
        CodeGraphTsNode parent = node.Parent;
        if (parent.IsNull) return null;
        if (!BlockParents.Contains(parent.Type)) return null;

        string name = node.Text;
        if (BareCallSkip.Contains(name)) return null;
        // Constants (uppercase start) are class/module refs, not calls.
        if (name.Length > 0 && name[0] >= 'A' && name[0] <= 'Z') return null;
        return name;
    }

    private static CodeGraphImportInfo? ExtractRubyImport(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        string importText = node.Text.Trim();

        CodeGraphTsNode identifier = FirstNamedChildOfType(node, "identifier");
        if (identifier.IsNull) return null;
        string methodName = identifier.Text;
        if (methodName != "require" && methodName != "require_relative") return null;

        CodeGraphTsNode argList = FirstNamedChildOfType(node, "argument_list");
        if (!argList.IsNull)
        {
            CodeGraphTsNode stringNode = FirstNamedChildOfType(argList, "string");
            if (!stringNode.IsNull)
            {
                CodeGraphTsNode stringContent = FirstNamedChildOfType(stringNode, "string_content");
                if (!stringContent.IsNull) return new CodeGraphImportInfo(stringContent.Text, importText);
            }
        }
        return null;
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
