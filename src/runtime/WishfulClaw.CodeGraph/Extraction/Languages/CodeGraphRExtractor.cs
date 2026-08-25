using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRExtractor — R language config. Port of extraction/languages/r.ts (#828).
//
// R has no declaration syntax — everything is an expression, so every symbol the
// graph needs arrives through the VisitNode hook:
//   - functions:  `name <- function(x) …` parse as binary_operator(lhs, rhs).
//   - variables:  top-level assignments only; ALL_CAPS / dotted-caps → constants.
//   - imports:    library(x) / require(x) / requireNamespace("x") / source("f.R").
//   - classes:    S4 setClass / R5 setRefClass / R6 R6Class / ggproto — the class
//                 node is named by the first string arg; list()/named function args
//                 become methods; parent classes become `extends` refs.
//   - S4 generics: setGeneric / setMethod → functions named by the first string arg.
// =============================================================================
internal static partial class CodeGraphRExtractor
{
    private static readonly HashSet<string> AssignLeft = new(System.StringComparer.Ordinal) { "<-", "<<-", "=" };
    private static readonly HashSet<string> AssignRight = new(System.StringComparer.Ordinal) { "->", "->>" };
    private static readonly HashSet<string> ImportFns = new(System.StringComparer.Ordinal)
        { "library", "require", "requireNamespace", "loadNamespace" };
    private static readonly HashSet<string> ClassFns = new(System.StringComparer.Ordinal)
        { "setClass", "setRefClass", "R6Class", "ggproto" };
    private static readonly HashSet<string> GenericFns = new(System.StringComparer.Ordinal)
        { "setGeneric", "setMethod" };

    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = [],   // named functions are assignments — handled in VisitNode
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = [],     // library()/require()/source() are calls — VisitNode
        CallTypes = ["call"],
        VariableTypes = [],   // top-level assignments — handled in VisitNode
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        VisitNode = VisitRNode
    };

    private static bool VisitRNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphSourceText source = ctx.Source;

        if (node.Type == "call")
        {
            string? fname = CalleeName(node, source);
            if (fname == null) return false;

            // library(dplyr) / require(stats) / requireNamespace("jsonlite") / source("helpers.R").
            if (ImportFns.Contains(fname) || fname == "source")
            {
                string? mod = LiteralOrIdentifier(FirstArgValue(node), source);
                if (mod == null) return true; // dynamic argument — not a call edge either
                string sig = node.Text.Trim();
                if (sig.Length > 100) sig = sig.Substring(0, 100);
                CodeGraphNode? imp = ctx.CreateNode(CodeGraphNodeKind.Import, mod, node, new CodeGraphNodeExtra { Signature = sig });
                if (imp != null && ctx.NodeStack.Count > 0)
                    EmitRef(ctx, ctx.NodeStack[ctx.NodeStack.Count - 1], mod, CodeGraphEdgeKind.Imports, node);
                return true;
            }

            // setClass("Patient", …) / setRefClass("Account", …) / R6Class("Stack", …).
            if (ClassFns.Contains(fname))
            {
                string? name = LiteralOrIdentifier(FirstArgValue(node), source);
                if (name == null) return false;
                CodeGraphNode? cls = ctx.CreateNode(CodeGraphNodeKind.Class, name, node);
                if (cls != null)
                {
                    ctx.PushScope(cls.Id);
                    ExtractClassMembers(node, cls.Id, ctx);
                    ctx.PopScope();
                }
                return true;
            }

            // setGeneric("describe", …) / setMethod("describe", "Patient", function(obj) …).
            if (GenericFns.Contains(fname))
            {
                string? name = LiteralOrIdentifier(FirstArgValue(node), source);
                if (name == null) return false;
                CodeGraphTsNode impl = default;
                CodeGraphTsNode args = node.ChildByField("arguments");
                if (!args.IsNull)
                {
                    int count = args.NamedChildCount;
                    for (int i = 0; i < count; i++)
                    {
                        CodeGraphTsNode arg = args.NamedChild(i);
                        CodeGraphTsNode v = arg.Type == "argument" ? arg.ChildByField("value") : default;
                        if (!v.IsNull && v.Type == "function_definition") { impl = v; break; }
                    }
                }
                CodeGraphTsNode paramsNode = impl.IsNull ? default : impl.ChildByField("parameters");
                CodeGraphNode? fn = ctx.CreateNode(CodeGraphNodeKind.Function, name, node, new CodeGraphNodeExtra
                {
                    Signature = paramsNode.IsNull ? null : paramsNode.Text
                });
                CodeGraphTsNode body = impl.IsNull ? default : impl.ChildByField("body");
                if (fn != null && !body.IsNull)
                {
                    ctx.PushScope(fn.Id);
                    ctx.VisitNode(body); // hook-aware walk — R nested defs are assignments
                    ctx.PopScope();
                }
                return true;
            }

            return false; // ordinary call — generic extraction records the edge
        }

        if (node.Type == "binary_operator")
        {
            CodeGraphTsNode opNode = node.ChildByField("operator");
            if (opNode.IsNull) return false;
            string op = opNode.Text;
            CodeGraphTsNode lhs = node.ChildByField("lhs");
            CodeGraphTsNode rhs = node.ChildByField("rhs");

            // name <- function(…) — any scope; the body is walked via VisitNode.
            if (AssignLeft.Contains(op) && !lhs.IsNull && lhs.Type == "identifier"
                && !rhs.IsNull && rhs.Type == "function_definition")
            {
                CodeGraphTsNode paramsNode = rhs.ChildByField("parameters");
                CodeGraphNode? fn = ctx.CreateNode(CodeGraphNodeKind.Function, lhs.Text, node, new CodeGraphNodeExtra
                {
                    Signature = paramsNode.IsNull ? null : paramsNode.Text
                });
                CodeGraphTsNode body = rhs.ChildByField("body");
                if (fn != null && !body.IsNull)
                {
                    ctx.PushScope(fn.Id);
                    ctx.VisitNode(body);
                    ctx.PopScope();
                }
                return true;
            }

            bool topLevel = !node.Parent.IsNull && node.Parent.Type == "program";

            // Top-level value assignments → variable/constant.
            if (topLevel && AssignLeft.Contains(op) && !lhs.IsNull && lhs.Type == "identifier" && !rhs.IsNull)
            {
                // `Account <- setRefClass("Account", …)` is the class idiom — the call
                // hook already made the class node; a twin variable would be noise.
                string? rhsCallee = rhs.Type == "call" ? CalleeName(rhs, source) : null;
                if (rhsCallee == null || (!ClassFns.Contains(rhsCallee) && !GenericFns.Contains(rhsCallee)))
                {
                    string name = lhs.Text;
                    ctx.CreateNode(ConstantNameRegex().IsMatch(name) ? CodeGraphNodeKind.Constant : CodeGraphNodeKind.Variable, name, node);
                }
                ctx.VisitNode(rhs);
                return true;
            }
            // value -> name / value ->> name (right assign).
            if (topLevel && AssignRight.Contains(op) && !rhs.IsNull && rhs.Type == "identifier" && !lhs.IsNull)
            {
                string name = rhs.Text;
                ctx.CreateNode(ConstantNameRegex().IsMatch(name) ? CodeGraphNodeKind.Constant : CodeGraphNodeKind.Variable, name, node);
                ctx.VisitNode(lhs);
                return true;
            }

            return false;
        }

        return false;
    }

    // The call's callee name when it is a bare identifier or `pkg::fn` (→ `fn`).
    private static string? CalleeName(CodeGraphTsNode call, CodeGraphSourceText source)
    {
        CodeGraphTsNode fn = call.ChildByField("function");
        if (fn.IsNull) return null;
        if (fn.Type == "identifier") return fn.Text;
        if (fn.Type == "namespace_operator")
        {
            CodeGraphTsNode rhs = fn.ChildByField("rhs");
            if (!rhs.IsNull) return rhs.Text;
        }
        return null;
    }

    // First positional argument's value node of a call.
    private static CodeGraphTsNode FirstArgValue(CodeGraphTsNode call)
    {
        CodeGraphTsNode args = call.ChildByField("arguments");
        if (args.IsNull) return default;
        int count = args.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode arg = args.NamedChild(i);
            if (arg.Type != "argument") continue;
            return arg.ChildByField("value");
        }
        return default;
    }

    // Text of a string node's content, or an identifier's text.
    private static string? LiteralOrIdentifier(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        if (node.IsNull) return null;
        if (node.Type == "identifier") return node.Text;
        if (node.Type == "string")
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode c = node.NamedChild(i);
                if (c.Type == "string_content") return c.Text;
            }
            return string.Empty; // empty string literal
        }
        return null;
    }

    // Emit one `name = function(…)` argument entry as a method in the current scope.
    private static void EmitMethodArg(CodeGraphTsNode entry, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode entryName = entry.ChildByField("name");
        CodeGraphTsNode entryValue = entry.ChildByField("value");
        if (entryName.IsNull || entryValue.IsNull || entryValue.Type != "function_definition") return;
        CodeGraphTsNode paramsNode = entryValue.ChildByField("parameters");
        CodeGraphNode? method = ctx.CreateNode(CodeGraphNodeKind.Method, entryName.Text, entry, new CodeGraphNodeExtra
        {
            Signature = paramsNode.IsNull ? null : paramsNode.Text
        });
        CodeGraphTsNode body = entryValue.ChildByField("body");
        if (method != null && !body.IsNull)
        {
            ctx.PushScope(method.Id);
            ctx.VisitNode(body);
            ctx.PopScope();
        }
    }

    // Extract a class call's methods (list()-nested or direct named function args)
    // and its parent class as an `extends` reference.
    private static void ExtractClassMembers(CodeGraphTsNode classCall, string classId, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode args = classCall.ChildByField("arguments");
        if (args.IsNull) return;
        int positional = 0;
        int count = args.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode arg = args.NamedChild(i);
            if (arg.Type != "argument") continue;
            CodeGraphTsNode argName = arg.ChildByField("name");
            CodeGraphTsNode value = arg.ChildByField("value");
            if (argName.IsNull)
            {
                positional++;
                // ggproto("Name", Parent, …) — the 2nd positional identifier is the parent.
                if (positional == 2 && !value.IsNull && value.Type == "identifier")
                    EmitRef(ctx, classId, value.Text, CodeGraphEdgeKind.Extends, value);
                continue;
            }
            string argNameText = argName.Text;
            // R6 `inherit = Parent` / S4 `contains = "Parent"`.
            if ((argNameText == "inherit" || argNameText == "contains") && !value.IsNull)
            {
                string? parent = LiteralOrIdentifier(value, ctx.Source);
                if (parent != null) EmitRef(ctx, classId, parent, CodeGraphEdgeKind.Extends, value);
                continue;
            }
            // Direct named function argument (ggproto methods).
            if (!value.IsNull && value.Type == "function_definition")
            {
                EmitMethodArg(arg, ctx);
                continue;
            }
            // list(…) of named function arguments (R5/R6 methods).
            if (!value.IsNull && value.Type == "call" && CalleeName(value, ctx.Source) == "list")
            {
                CodeGraphTsNode listArgs = value.ChildByField("arguments");
                if (listArgs.IsNull) continue;
                int lcount = listArgs.NamedChildCount;
                for (int j = 0; j < lcount; j++)
                {
                    CodeGraphTsNode entry = listArgs.NamedChild(j);
                    if (entry.Type == "argument") EmitMethodArg(entry, ctx);
                }
            }
        }
    }

    private static void EmitRef(CodeGraphExtractorContext ctx, string fromNodeId, string name, string kind, CodeGraphTsNode at)
    {
        ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
            FromNodeId: fromNodeId,
            ReferenceName: name,
            ReferenceKind: kind,
            Line: (int)at.StartPoint.Row + 1,
            Column: (int)at.StartPoint.Column,
            FilePath: ctx.FilePath,
            Language: null,
            Candidates: null,
            RowId: null));
    }

    [GeneratedRegex(@"^[A-Z][A-Z0-9._]*$")] private static partial Regex ConstantNameRegex();
}
