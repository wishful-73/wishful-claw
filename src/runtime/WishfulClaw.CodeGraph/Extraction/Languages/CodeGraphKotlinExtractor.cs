using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphKotlinExtractor — Kotlin language config. Port of
// extraction/languages/kotlin.ts.
//
// class/interface/enum all parse as `class_declaration` (ClassifyClassNode tags
// interface/enum by keyword child); `object`/`companion object` add
// ExtraClassNodeTypes. tree-sitter-kotlin exposes no field names, so ResolveBody and
// GetReturnType work positionally. VisitNode extracts `val`/`var` properties (kind by
// enclosing scope: object→constant/variable, class→field, function-body→skipped) and
// recovers the `fun interface` misparse the grammar can't handle. ExtractModifiers
// captures Kotlin-Multiplatform `expect`/`actual` markers.
//
// Sibling adaptation: TS uses previousSibling/nextSibling; the C# node wrapper exposes
// only named-sibling navigation, used here (the relevant ERROR / lambda_literal
// siblings are named nodes).
// =============================================================================
internal static partial class CodeGraphKotlinExtractor
{
    // Kotlin return types that can't be a chained-call receiver.
    private static readonly HashSet<string> KotlinNonClassReturn = new() { "Unit", "Nothing" };

    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_declaration"],
        ClassTypes = ["class_declaration"],
        MethodTypes = ["function_declaration", "secondary_constructor"],
        ClassifyMethodNode = node =>
            node.Type == "secondary_constructor" ? "constructor" : "method",
        InterfaceTypes = [], // Handled via ClassifyClassNode
        StructTypes = [], // Kotlin uses data classes
        EnumTypes = [], // Handled via ClassifyClassNode
        EnumMemberTypes = ["enum_entry"],
        TypeAliasTypes = ["type_alias"],
        ImportTypes = ["import_header"],
        CallTypes = ["call_expression"],
        VariableTypes = ["property_declaration"],
        FieldTypes = ["property_declaration"],
        ExtraClassNodeTypes = ["object_declaration"],
        NameField = "simple_identifier",
        BodyField = "function_body",
        ParamsField = "function_value_parameters",
        ReturnField = "type",
        GetReturnType = ExtractKotlinReturnType,
        VisitNode = VisitKotlinNode,
        ResolveName = (node, source) =>
            node.Type == "secondary_constructor" ? KotlinEnclosingTypeName(node) : null,

        ResolveBody = (node, _bodyField) =>
        {
            // No field names in the grammar; find body by type. Prefer an ERROR body
            // (a misparsed parent-class body starting with `{`) so the parent's methods
            // are extracted over a nested `fun interface`'s class_body sibling.
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (!child.IsNull && child.Type == "ERROR")
                {
                    CodeGraphTsNode firstChild = child.Child(0);
                    if (!firstChild.IsNull && firstChild.Type == "{") return child;
                }
                if (!child.IsNull && child.Type is "function_body" or "class_body" or "enum_class_body")
                    return child;
                if (!child.IsNull && node.Type == "secondary_constructor" && child.Type == "statements")
                    return child;
            }
            return null;
        },

        ClassifyClassNode = node =>
        {
            // Kotlin reuses class_declaration for classes, interfaces, and enums.
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull) continue;
                if (child.Type == "interface") return CodeGraphNodeKind.Interface;
                if (child.Type == "enum") return CodeGraphNodeKind.Enum;
            }
            return "class";
        },

        GetReceiverType = (node, source) =>
        {
            // Kotlin extension functions: fun Type.method() { } — the user_type before
            // the dot is the receiver type.
            CodeGraphTsNode foundUserType = default;
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull) continue;
                if (child.Type == "user_type")
                {
                    foundUserType = child;
                }
                else if (child.Type == "." && !foundUserType.IsNull)
                {
                    CodeGraphTsNode typeId = FirstNamedChildOfType(foundUserType, "type_identifier");
                    return typeId.IsNull ? foundUserType.Text : typeId.Text;
                }
                else if (child.Type is "simple_identifier" or "function_value_parameters")
                {
                    break; // past the function name — no receiver
                }
            }
            return null;
        },

        GetSignature = (node, source) =>
        {
            // Kotlin function signature: fun name(params): ReturnType
            CodeGraphTsNode paramsNode = node.ChildByField("function_value_parameters");
            if (paramsNode.IsNull) return null;
            string sig = paramsNode.Text;
            CodeGraphTsNode returnType = node.ChildByField("type");
            if (!returnType.IsNull) sig += ": " + returnType.Text;
            return sig;
        },

        GetVisibility = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "modifiers") continue;
                string text = child.Text;
                if (text.Contains("public", StringComparison.Ordinal)) return CodeGraphVisibility.Public;
                if (text.Contains("private", StringComparison.Ordinal)) return CodeGraphVisibility.Private;
                if (text.Contains("protected", StringComparison.Ordinal)) return CodeGraphVisibility.Protected;
                if (text.Contains("internal", StringComparison.Ordinal)) return CodeGraphVisibility.Internal;
            }
            return CodeGraphVisibility.Public; // Kotlin defaults to public
        },

        IsStatic = _ => false, // Kotlin has no static, uses companion objects

        IsAsync = node =>
        {
            // Kotlin uses the suspend keyword for coroutines.
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "modifiers" &&
                    child.Text.Contains("suspend", StringComparison.Ordinal))
                    return true;
            }
            return false;
        },

        // Kotlin-Multiplatform `expect`/`actual` markers live in
        // modifiers > platform_modifier > (expect | actual). Match the AST node, not
        // raw text, so an argument/identifier named "actual" can't false-positive.
        ExtractModifiers = node =>
        {
            List<string> mods = new();
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "modifiers") continue;
                for (int j = 0; j < child.ChildCount; j++)
                {
                    CodeGraphTsNode pm = child.Child(j);
                    if (pm.IsNull || pm.Type != "platform_modifier") continue;
                    for (int k = 0; k < pm.ChildCount; k++)
                    {
                        CodeGraphTsNode kw = pm.Child(k);
                        if (!kw.IsNull && (kw.Type == "expect" || kw.Type == "actual")) mods.Add(kw.Type);
                    }
                }
            }
            return mods.Count > 0 ? mods : null;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            CodeGraphTsNode id = FirstNamedChildOfType(node, "identifier");
            return id.IsNull ? null : new CodeGraphImportInfo(id.Text, importText);
        },

        PackageTypes = ["package_header"],
        ExtractPackage = (node, source) =>
        {
            CodeGraphTsNode id = FirstNamedChildOfType(node, "identifier");
            return id.IsNull ? null : id.Text.Trim();
        }
    };

    private static bool VisitKotlinNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        // Kotlin properties (`val`/`var`/`const val`). The name nests as
        // property_declaration → variable_declaration → simple_identifier. Kind by
        // enclosing scope: object/top-level → constant (val) / variable (var); class/
        // interface/enum → field; function body / init / lambda → skipped local.
        if (node.Type == "property_declaration")
        {
            CodeGraphTsNode varDecl = FirstNamedChildOfType(node, "variable_declaration");
            CodeGraphTsNode nameNode = varDecl.IsNull ? default : FirstNamedChildOfType(varDecl, "simple_identifier");
            if (nameNode.IsNull) return false; // destructuring `val (a,b)` — leave to default
            string name = nameNode.Text;
            if (string.IsNullOrEmpty(name)) return false;

            string scope = "const";
            for (CodeGraphTsNode p = node.Parent; !p.IsNull; p = p.Parent)
            {
                string pt = p.Type;
                if (pt is "function_body" or "function_declaration" or "lambda_literal" or
                    "anonymous_initializer" or "control_structure_body" or "getter" or "setter")
                { scope = "local"; break; }
                if (pt is "companion_object" or "object_declaration") { scope = "const"; break; }
                if (pt == "class_declaration") { scope = "instance"; break; }
            }
            if (scope == "local") return true; // a local — don't extract

            CodeGraphTsNode binding = FirstNamedChildOfType(node, "binding_pattern_kind");
            bool isVal = !binding.IsNull && binding.Text == "val";
            string kind = scope == "instance"
                ? CodeGraphNodeKind.Field
                : (isVal ? CodeGraphNodeKind.Constant : CodeGraphNodeKind.Variable);

            CodeGraphTsNode typeNode = node.ChildByField("type");
            string? sig = typeNode.IsNull ? null : $"{(isVal ? "val" : "var")} {name}: {typeNode.Text}";
            ctx.CreateNode(kind, name, node, new CodeGraphNodeExtra { Signature = sig });
            return true;
        }

        // Skip lambda_literal bodies already consumed by a `fun interface` ERROR node.
        if (node.Type == "lambda_literal")
        {
            CodeGraphTsNode prev = node.PrevNamedSibling;
            if (!prev.IsNull && prev.Type == "ERROR" && IsFunInterfaceNode(prev)) return true;
            return false;
        }

        if (node.Type != "ERROR" && node.Type != "function_declaration") return false;

        // Skip ERROR nodes that are class bodies (start with `{`) — their methods are
        // extracted via ResolveBody; handling the ERROR here consumes the whole body.
        if (node.Type == "ERROR")
        {
            CodeGraphTsNode firstChild = node.Child(0);
            if (!firstChild.IsNull && firstChild.Type == "{") return false;
        }

        if (!IsFunInterfaceNode(node)) return false;

        // Extract the interface name. For function_declaration misparses the real name
        // is inside an ERROR child (direct simple_identifier children are the misparsed
        // method name).
        string? nameText = null;
        if (node.Type == "function_declaration")
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "ERROR") continue;
                for (int j = 0; j < child.ChildCount; j++)
                {
                    CodeGraphTsNode gc = child.Child(j);
                    if (!gc.IsNull && gc.Type == "simple_identifier") { nameText = gc.Text; break; }
                }
                if (nameText != null) break;
            }
        }
        // Fallback: direct simple_identifier child (Pattern 1: ERROR node at top level).
        if (nameText == null)
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "simple_identifier") { nameText = child.Text; break; }
            }
        }
        if (nameText == null) return false;

        CodeGraphNode? ifaceNode = ctx.CreateNode(CodeGraphNodeKind.Interface, nameText, node);
        if (ifaceNode == null) return false;

        ctx.PushScope(ifaceNode.Id);

        if (node.Type == "ERROR")
        {
            // Pattern 1: body is in the next sibling lambda_literal.
            CodeGraphTsNode nextSibling = node.NextNamedSibling;
            if (!nextSibling.IsNull && nextSibling.Type == "lambda_literal")
            {
                int nc = nextSibling.NamedChildCount;
                for (int i = 0; i < nc; i++)
                {
                    CodeGraphTsNode child = nextSibling.NamedChild(i);
                    if (child.IsNull || child.Type != "statements") continue;
                    int sc = child.NamedChildCount;
                    for (int j = 0; j < sc; j++)
                    {
                        CodeGraphTsNode stmt = child.NamedChild(j);
                        if (!stmt.IsNull) ctx.VisitNode(stmt);
                    }
                }
            }
        }

        ctx.PopScope();
        return true;
    }

    // A Kotlin function's declared return type, normalized to a bare class name
    // (#645/#608). Found positionally: the first user_type/nullable_type after
    // function_value_parameters. Inferred/lambda returns and `Unit`/`Nothing` → null.
    private static string? ExtractKotlinReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        bool seenParams = false;
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type == "function_value_parameters") { seenParams = true; continue; }
            if (!seenParams) continue;
            if (child.Type is "function_body" or "type_constraints") return null;
            if (child.Type is "user_type" or "nullable_type")
            {
                CodeGraphTsNode ut = child;
                if (child.Type == "nullable_type")
                {
                    CodeGraphTsNode inner = FirstNamedChildOfType(child, "user_type");
                    ut = inner.IsNull ? child : inner;
                }
                CodeGraphTsNode typeId = FirstNamedChildOfType(ut, "type_identifier");
                string name = (typeId.IsNull ? ut : typeId).Text.Trim();
                if (name.Length == 0 || !IdentifierRegex().IsMatch(name)) return null;
                if (KotlinNonClassReturn.Contains(name)) return null;
                return name;
            }
        }
        return null;
    }

    private static string? KotlinEnclosingTypeName(CodeGraphTsNode node)
    {
        for (CodeGraphTsNode parent = node.Parent; !parent.IsNull; parent = parent.Parent)
        {
            if (parent.Type != "class_declaration") continue;
            CodeGraphTsNode name = FirstNamedChildOfType(parent, "type_identifier");
            if (!name.IsNull) return name.Text;
        }

        return null;
    }

    // Whether `node` matches the `fun interface` misparse pattern.
    private static bool IsFunInterfaceNode(CodeGraphTsNode node)
    {
        bool hasFun = false, hasInterfaceType = false;
        for (int i = 0; i < node.ChildCount; i++)
        {
            CodeGraphTsNode child = node.Child(i);
            if (child.IsNull) continue;
            if (child.Type == "fun" && !child.IsNamed) hasFun = true;
            if (child.Type == "user_type")
            {
                CodeGraphTsNode typeId = FirstNamedChildOfType(child, "type_identifier");
                if (!typeId.IsNull && typeId.Text == "interface") hasInterfaceType = true;
            }
            // Pattern 2b: user_type("interface") is inside an ERROR child.
            if (child.Type == "ERROR")
            {
                for (int j = 0; j < child.ChildCount; j++)
                {
                    CodeGraphTsNode gc = child.Child(j);
                    if (gc.IsNull || gc.Type != "user_type") continue;
                    CodeGraphTsNode typeId = FirstNamedChildOfType(gc, "type_identifier");
                    if (!typeId.IsNull && typeId.Text == "interface") hasInterfaceType = true;
                }
            }
        }
        return hasFun && hasInterfaceType;
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

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();
}
