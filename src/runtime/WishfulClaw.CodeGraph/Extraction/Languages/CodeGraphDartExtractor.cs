using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphDartExtractor — Dart language config. Port of
// extraction/languages/dart.ts.
//
// Functions are `function_signature`; methods are `method_signature` (covering
// factory constructors) plus bare `constructor_signature`. Bodies are SIBLINGS of the
// signature (ResolveBody). class/mixin/extension all extract as class-like
// (ExtraClassNodeTypes). Named/factory constructors are named by their ctor name
// (ResolveName) and given the class as their return type (GetReturnType) so
// `Foo.create().bar()` chains resolve (#750). Unnamed constructors are emitted as
// `constructor` nodes too; constructor kinds stay out of ordinary method resolution.
// Dart calls are
// identifier+selector, not a call node, so they are lifted via ExtractBareCall.
// `static_final_declaration` (top-level/static const/final) → constant (VisitNode).
// =============================================================================
internal static partial class CodeGraphDartExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_signature"],
        // method_signature covers regular methods AND factory constructors; a plain
        // named constructor `Foo._()` parses as a bare constructor_signature.
        ClassTypes = ["class_definition"],
        MethodTypes = ["method_signature", "constructor_signature"],
        ClassifyMethodNode = node => DartCtorInfo(node) != null ? "constructor" : "method",
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["enum_constant"],
        TypeAliasTypes = ["type_alias"],
        ImportTypes = ["import_or_export"],
        CallTypes = [], // Dart calls use identifier+selector, handled via ExtractBareCall
        VariableTypes = [],
        ExtraClassNodeTypes = ["mixin_declaration", "extension_declaration"],
        NameField = "name",
        BodyField = "body", // class_definition uses 'body' field
        ParamsField = "formal_parameter_list",
        ReturnField = "type",
        GetReturnType = ExtractDartReturnType,

        // A Dart `static_final_declaration` is exactly a top-level or class-`static`
        // `const`/`final` — extract it as `constant` for value-reference edges.
        VisitNode = (node, ctx) =>
        {
            if (node.Type == "static_final_declaration")
            {
                CodeGraphTsNode nameNode = FirstNamedChildOfType(node, "identifier");
                if (!nameNode.IsNull)
                {
                    CodeGraphTsNode valueNode = nameNode.NextNamedSibling;
                    string? initValue = valueNode.IsNull ? null : Slice100(valueNode.Text);
                    string? sig = initValue != null
                        ? $"= {initValue}{(initValue.Length >= 100 ? "..." : string.Empty)}"
                        : null;
                    ctx.CreateNode(CodeGraphNodeKind.Constant, nameNode.Text, node,
                        new CodeGraphNodeExtra { Signature = sig });
                }
                return true;
            }
            return false;
        },

        ResolveBody = (node, bodyField) =>
        {
            // function_body is a next sibling of function_signature/method_signature.
            if (node.Type is "function_signature" or "method_signature")
            {
                CodeGraphTsNode next = node.NextNamedSibling;
                if (!next.IsNull && next.Type == "function_body") return next;
                return null;
            }
            // For class/mixin/extension: standard field, then class_body/extension_body.
            CodeGraphTsNode standard = node.ChildByField(bodyField);
            if (!standard.IsNull) return standard;
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type is "class_body" or "extension_body") return child;
            }
            return null;
        },

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode sig = node;
            if (node.Type == "method_signature")
            {
                CodeGraphTsNode inner = FirstNamedChildOfTypes(node, SignatureInnerTypes!);
                if (!inner.IsNull) sig = inner;
            }
            CodeGraphTsNode paramsNode = FirstNamedChildOfType(sig, "formal_parameter_list");
            CodeGraphTsNode retType = FirstNamedChildOfTypes(sig, ReturnTypeNodes!);
            if (paramsNode.IsNull && retType.IsNull) return null;
            string result = string.Empty;
            if (!retType.IsNull) result += retType.Text + " ";
            if (!paramsNode.IsNull) result += paramsNode.Text;
            result = result.Trim();
            return result.Length > 0 ? result : null;
        },

        GetVisibility = node =>
        {
            // Dart convention: `_` prefix means private, otherwise public.
            CodeGraphTsNode nameNode = default;
            if (node.Type == "method_signature")
            {
                CodeGraphTsNode inner = FirstNamedChildOfTypes(node, SignatureInnerTypes!);
                if (!inner.IsNull) nameNode = FirstNamedChildOfType(inner, "identifier");
            }
            else
            {
                nameNode = node.ChildByField("name");
            }
            if (!nameNode.IsNull && nameNode.Text.StartsWith("_", StringComparison.Ordinal))
                return CodeGraphVisibility.Private;
            return CodeGraphVisibility.Public;
        },

        IsAsync = node =>
        {
            // In Dart, 'async' is on the function_body (next sibling), not the signature.
            CodeGraphTsNode nextSibling = node.NextNamedSibling;
            if (!nextSibling.IsNull && nextSibling.Type == "function_body")
            {
                for (int i = 0; i < nextSibling.ChildCount; i++)
                {
                    CodeGraphTsNode child = nextSibling.Child(i);
                    if (!child.IsNull && child.Type == "async") return true;
                }
            }
            return false;
        },

        IsStatic = node =>
        {
            if (node.Type == "method_signature")
            {
                for (int i = 0; i < node.ChildCount; i++)
                {
                    CodeGraphTsNode child = node.Child(i);
                    if (!child.IsNull && child.Type == "static") return true;
                }
            }
            return false;
        },

        // Name a factory / named constructor by its constructor name (the 2nd
        // identifier) so `Foo.create()` resolves to `Foo::create` (#750). Unnamed ctor
        // `Foo()` falls through to the default class name.
        ResolveName = (node, source) =>
        {
            (string ClassName, string CtorName)? ctor = DartCtorInfo(node);
            if (ctor != null && ctor.Value.CtorName != ctor.Value.ClassName) return ctor.Value.CtorName;
            return null;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            string moduleName = string.Empty;

            // import 'dart:async'; import 'package:foo/bar.dart' as bar;
            CodeGraphTsNode libraryImport = FirstNamedChildOfType(node, "library_import");
            if (!libraryImport.IsNull)
            {
                CodeGraphTsNode importSpec = FirstNamedChildOfType(libraryImport, "import_specification");
                if (!importSpec.IsNull)
                {
                    string? m = UriModuleName(importSpec);
                    if (m != null) moduleName = m;
                }
            }

            // export 'src/foo.dart';
            if (moduleName.Length == 0)
            {
                CodeGraphTsNode libraryExport = FirstNamedChildOfType(node, "library_export");
                if (!libraryExport.IsNull)
                {
                    string? m = UriModuleName(libraryExport);
                    if (m != null) moduleName = m;
                }
            }

            return moduleName.Length > 0 ? new CodeGraphImportInfo(moduleName, importText) : null;
        },

        ExtractBareCall = (node, source) =>
        {
            // Dart calls are identifier + selector(argument_part), not a call node.
            if (node.Type == "selector")
            {
                if (!HasNamedChildOfType(node, "argument_part")) return null;

                CodeGraphTsNode prev = node.PrevNamedSibling;
                if (prev.IsNull) return null;

                // Simple function/constructor call: prev is identifier.
                if (prev.Type == "identifier") return prev.Text;

                // Method call: prev is selector with accessor.
                if (prev.Type == "selector")
                {
                    CodeGraphTsNode accessor = FirstNamedChildOfTypes(prev, AssignableSelectorTypes!);
                    if (!accessor.IsNull)
                    {
                        CodeGraphTsNode methodId = FirstNamedChildOfType(accessor, "identifier");
                        if (!methodId.IsNull)
                        {
                            CodeGraphTsNode accessorPrev = prev.PrevNamedSibling;
                            if (!accessorPrev.IsNull && accessorPrev.Type == "identifier")
                                return accessorPrev.Text + "." + methodId.Text;
                            // Chained static-factory / fluent call: encode
                            // `<innerCallee>().<method>` when the chain starts with a
                            // capitalized type (#645/#608).
                            if (!accessorPrev.IsNull && accessorPrev.Type == "selector" &&
                                HasNamedChildOfType(accessorPrev, "argument_part"))
                            {
                                string? innerCallee = DartCalleeOfArgPart(accessorPrev);
                                if (innerCallee != null && UppercaseStartRegex().IsMatch(innerCallee))
                                    return $"{innerCallee}().{methodId.Text}";
                            }
                            return methodId.Text;
                        }
                    }
                }

                // super.method() / this.method(): prev is bare assignable selector.
                if (prev.Type is "unconditional_assignable_selector" or "conditional_assignable_selector")
                {
                    CodeGraphTsNode methodId = FirstNamedChildOfType(prev, "identifier");
                    if (!methodId.IsNull) return methodId.Text;
                }

                return null;
            }

            // new MyWidget() — explicit constructor call.
            if (node.Type == "new_expression")
            {
                CodeGraphTsNode typeId = FirstNamedChildOfType(node, "type_identifier");
                return typeId.IsNull ? null : typeId.Text;
            }

            // const EdgeInsets.all(8.0) — const constructor call.
            if (node.Type == "const_object_expression")
            {
                CodeGraphTsNode typeId = FirstNamedChildOfType(node, "type_identifier");
                CodeGraphTsNode nameId = FirstNamedChildOfType(node, "identifier");
                if (!typeId.IsNull && !nameId.IsNull) return typeId.Text + "." + nameId.Text;
                if (!typeId.IsNull) return typeId.Text;
                return null;
            }

            return null;
        }
    };

    private static readonly HashSet<string> SignatureInnerTypes =
        new() { "function_signature", "getter_signature", "setter_signature" };
    private static readonly HashSet<string> ReturnTypeNodes =
        new() { "type_identifier", "void_type" };
    private static readonly HashSet<string> AssignableSelectorTypes =
        new() { "unconditional_assignable_selector", "conditional_assignable_selector" };

    // The function_signature carrying a method's return type — unwrapped from a
    // method_signature wrapper.
    private static CodeGraphTsNode DartInnerSignature(CodeGraphTsNode node)
    {
        if (node.Type == "method_signature")
        {
            CodeGraphTsNode inner = FirstNamedChildOfTypes(node, SignatureInnerTypes!);
            if (!inner.IsNull) return inner;
        }
        return node;
    }

    // The factory/named-constructor signature inside a node, if any.
    private static CodeGraphTsNode DartConstructorSignature(CodeGraphTsNode node)
    {
        if (node.Type is "factory_constructor_signature" or "constructor_signature") return node;
        if (node.Type == "method_signature")
            return FirstNamedChildOfTypes(node, ConstructorSignatureTypes);
        return default;
    }

    private static readonly HashSet<string> ConstructorSignatureTypes =
        new() { "factory_constructor_signature", "constructor_signature" };

    // The name of the class/mixin/extension/enum lexically enclosing `node`.
    private static string? DartEnclosingTypeName(CodeGraphTsNode node)
    {
        for (CodeGraphTsNode p = node.Parent; !p.IsNull; p = p.Parent)
        {
            if (p.Type is "class_definition" or "mixin_declaration" or
                "extension_declaration" or "enum_declaration")
            {
                CodeGraphTsNode name = p.ChildByField("name");
                return name.IsNull ? null : name.Text;
            }
        }
        return null;
    }

    // Validated constructor info for `node`, or null if it isn't genuinely a
    // constructor (a real ctor's class identifier matches the enclosing type).
    private static (string ClassName, string CtorName)? DartCtorInfo(CodeGraphTsNode node)
    {
        CodeGraphTsNode ctor = DartConstructorSignature(node);
        if (ctor.IsNull) return null;
        List<CodeGraphTsNode> ids = new();
        int count = ctor.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = ctor.NamedChild(i);
            if (child.Type == "identifier") ids.Add(child);
        }
        string? className = DartEnclosingTypeName(node);
        if (className == null || ids.Count == 0) return null;
        if (ids[0].Text != className) return null; // misparsed method, not a ctor
        string ctorName = ids.Count > 1 ? ids[1].Text : className;
        return (className, ctorName);
    }

    // Capture a Dart method/function's declared return type as a bare type name (#750).
    private static string? ExtractDartReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        (string ClassName, string CtorName)? ctor = DartCtorInfo(node);
        if (ctor != null) return ctor.Value.ClassName;
        CodeGraphTsNode sig = DartInnerSignature(node);
        CodeGraphTsNode retType = FirstNamedChildOfType(sig, "type_identifier");
        if (retType.IsNull) return null;
        string text = GenericArgsRegex().Replace(retType.Text, string.Empty).Trim();
        string last = text.Split('.')[^1]; // prefixed `p.Bar` → `Bar`
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    // The callee name of the Dart call whose argument_part selector is `argPart`.
    private static string? DartCalleeOfArgPart(CodeGraphTsNode argPart)
    {
        CodeGraphTsNode prev = argPart.PrevNamedSibling;
        if (prev.IsNull) return null;
        if (prev.Type == "identifier") return prev.Text; // bare `Foo()` / `create()`
        if (prev.Type == "selector")
        {
            CodeGraphTsNode accessor = FirstNamedChildOfTypes(prev, AssignableSelectorTypes!);
            CodeGraphTsNode methodId = accessor.IsNull ? default : FirstNamedChildOfType(accessor, "identifier");
            if (!methodId.IsNull)
            {
                CodeGraphTsNode accessorPrev = prev.PrevNamedSibling;
                if (!accessorPrev.IsNull && accessorPrev.Type == "identifier")
                    return accessorPrev.Text + "." + methodId.Text;
                return methodId.Text;
            }
        }
        return null;
    }

    // import_specification / library_export → configurable_uri → uri → string_literal.
    private static string? UriModuleName(CodeGraphTsNode container)
    {
        CodeGraphTsNode configurableUri = FirstNamedChildOfType(container, "configurable_uri");
        if (configurableUri.IsNull) return null;
        CodeGraphTsNode uri = FirstNamedChildOfType(configurableUri, "uri");
        if (uri.IsNull) return null;
        CodeGraphTsNode stringLiteral = FirstNamedChildOfType(uri, "string_literal");
        if (stringLiteral.IsNull) return null;
        return QuoteRegex().Replace(stringLiteral.Text, string.Empty);
    }

    private static string Slice100(string text) =>
        text.Length <= 100 ? text : text[..100];

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

    private static CodeGraphTsNode FirstNamedChildOfTypes(CodeGraphTsNode node, HashSet<string> types)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (types.Contains(child.Type)) return child;
        }
        return default;
    }

    private static bool HasNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
            if (node.NamedChild(i).Type == type) return true;
        return false;
    }

    [GeneratedRegex(@"<[^>]*>")] private static partial Regex GenericArgsRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();
    [GeneratedRegex(@"^[A-Z]")] private static partial Regex UppercaseStartRegex();
    [GeneratedRegex(@"['""]")] private static partial Regex QuoteRegex();
}
