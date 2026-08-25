// =============================================================================
// CodeGraphPhpExtractor — PHP language config. Port of extraction/languages/php.ts.
//
// Classes and traits are both class-declarations (ClassifyClassNode tags a trait);
// interfaces and enums are first-class. A file-level `namespace Foo\Bar;` wraps every
// type under a `Foo\Bar::` qualified name (PackageTypes/ExtractPackage) so `use`
// imports and same-named types across namespaces resolve to the RIGHT definition.
// Imports cover BOTH `use` (namespace_use_declaration) and procedural
// `include`/`require` (+ _once), the latter carrying a static file→file dependency.
//
// A VisitNode hook handles two constructs the generic ladder skips: class `const`
// members (extracted as constants) and `use TraitName;` trait mixing (an `implements`
// reference the resolver turns into an edge).
// =============================================================================
internal static class CodeGraphPhpExtractor
{
    // include / require (+ _once): the file→file dependency of procedural PHP.
    private static readonly HashSet<string> IncludeTypes = new(StringComparer.Ordinal)
    {
        "include_expression", "include_once_expression",
        "require_expression", "require_once_expression"
    };

    // PHP built-in return types that can't be a method receiver (no class to chain on).
    private static readonly HashSet<string> NonClassReturn = new(StringComparer.Ordinal)
    {
        "array", "string", "int", "integer", "float", "double", "bool", "boolean",
        "void", "mixed", "never", "null", "false", "true", "object", "callable",
        "iterable", "resource"
    };

    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_definition"],
        ClassTypes = ["class_declaration", "trait_declaration"],
        MethodTypes = ["method_declaration"],
        ClassifyMethodNode = node =>
        {
            CodeGraphTsNode name = node.ChildByField("name");
            return !name.IsNull && name.Text.Equals("__construct", StringComparison.OrdinalIgnoreCase)
                ? "constructor"
                : "method";
        },
        InterfaceTypes = ["interface_declaration"],
        StructTypes = [],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["enum_case"],
        TypeAliasTypes = [],
        ImportTypes =
        [
            "namespace_use_declaration",
            "include_expression", "include_once_expression",
            "require_expression", "require_once_expression"
        ],
        CallTypes = ["function_call_expression", "member_call_expression", "scoped_call_expression"],
        VariableTypes = ["const_declaration"],
        FieldTypes = ["property_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "return_type",
        GetReturnType = ExtractPhpReturnType,

        ClassifyClassNode = node => node.Type == "trait_declaration" ? CodeGraphNodeKind.Trait : "class",

        GetVisibility = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "visibility_modifier") continue;
                string text = child.Text;
                if (text == "public") return CodeGraphVisibility.Public;
                if (text == "private") return CodeGraphVisibility.Private;
                if (text == "protected") return CodeGraphVisibility.Protected;
            }
            return CodeGraphVisibility.Public; // PHP defaults to public
        },

        IsStatic = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "static_modifier") return true;
            }
            return false;
        },

        VisitNode = VisitPhpNode,

        // PHP `namespace Foo\Bar;` is file-level (like a Java/Kotlin package).
        PackageTypes = ["namespace_definition"],
        ExtractPackage = (node, source) =>
        {
            CodeGraphTsNode nsName = FirstNamedChildOfType(node, "namespace_name");
            // Skip braced `namespace Foo { … }` (has a body) — file-level only.
            bool hasBody = HasNamedChildOfType(node, "compound_statement") ||
                           HasNamedChildOfType(node, "declaration_list");
            if (nsName.IsNull || hasBody) return null;
            return nsName.Text;
        },

        ExtractImport = ExtractPhpImport
    };

    // A method/function's declared return type, normalized to the class a chained
    // `->method()` could target. `self`/`static`/`$this` collapse to the marker `self`
    // (resolved to the declaring class later); a concrete type returns its short name;
    // primitives / unions / nullable non-class types return null. (php.ts extractPhpReturnType)
    private static string? ExtractPhpReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode rt = node.ChildByField("return_type");
        if (rt.IsNull) return null;
        // Unwrap `?Type`; union/intersection types are ambiguous — skip below.
        if (rt.Type == "optional_type")
        {
            CodeGraphTsNode inner = rt.NamedChild(0);
            rt = inner.IsNull ? rt : inner;
        }
        if (rt.IsNull || rt.Type == "primitive_type") return null;

        CodeGraphTsNode nameNode = rt.Type == "named_type"
            ? (rt.NamedChild(0).IsNull ? rt : rt.NamedChild(0))
            : rt;
        string text = nameNode.Text.Trim();
        if (text.StartsWith("\\", StringComparison.Ordinal)) text = text[1..];
        if (text.Length == 0) return null;

        string[] segs = text.Split('\\');
        string last = segs.Length > 0 ? segs[^1] : text;
        string lc = last.ToLowerInvariant();
        if (lc is "self" or "static" or "this" or "$this") return "self";
        if (NonClassReturn.Contains(lc)) return null;
        if (!IsSimpleIdentifier(last)) return null; // union/intersection/complex
        return last;
    }

    // Two constructs the generic ladder skips (php.ts visitNode):
    //   * class `const` members → `constant` nodes (a const_declaration inside a class
    //     is excluded from the top-level variable path by the IsInsideClassLikeNode guard);
    //   * `use TraitName, Other;` trait mixing → `implements` references.
    private static bool VisitPhpNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        if (node.Type == "const_declaration")
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode elem = node.NamedChild(i);
                if (elem.Type != "const_element") continue;
                CodeGraphTsNode nameNode = FirstNamedChildOfType(elem, "name");
                if (nameNode.IsNull) continue;
                ctx.CreateNode(CodeGraphNodeKind.Constant, nameNode.Text, elem);
            }
            return true; // handled
        }

        if (node.Type == "use_declaration")
        {
            string? parentId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[ctx.NodeStack.Count - 1] : null;
            if (parentId != null)
            {
                int count = node.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode nameNode = node.NamedChild(i);
                    if (nameNode.Type is "name" or "qualified_name")
                    {
                        ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
                            FromNodeId: parentId,
                            ReferenceName: nameNode.Text,
                            ReferenceKind: CodeGraphEdgeKind.Implements,
                            Line: (int)node.StartPoint.Row + 1,
                            Column: (int)node.StartPoint.Column,
                            FilePath: ctx.FilePath,
                            Language: null,
                            Candidates: null,
                            RowId: null));
                    }
                }
            }
            return true; // handled
        }

        return false;
    }

    private static CodeGraphImportInfo? ExtractPhpImport(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        string importText = node.Text.Trim();

        // include / require (+ _once): a static string-literal file path, or null for
        // dynamic forms (which have no resolvable compile-time path).
        if (IncludeTypes.Contains(node.Type))
        {
            string? includePath = PhpStaticIncludePath(node);
            return includePath != null ? new CodeGraphImportInfo(includePath, importText) : null;
        }

        // Grouped `use X\{A, B}` creates multiple nodes — decline (no MVP fallback).
        CodeGraphTsNode namespacePrefix = FirstNamedChildOfType(node, "namespace_name");
        CodeGraphTsNode useGroup = FirstNamedChildOfType(node, "namespace_use_group");
        if (!namespacePrefix.IsNull && !useGroup.IsNull) return null;

        // Single import — the namespace_use_clause's qualified_name / name.
        CodeGraphTsNode useClause = FirstNamedChildOfType(node, "namespace_use_clause");
        if (!useClause.IsNull)
        {
            CodeGraphTsNode qualifiedName = FirstNamedChildOfType(useClause, "qualified_name");
            if (!qualifiedName.IsNull) return new CodeGraphImportInfo(qualifiedName.Text, importText);
            CodeGraphTsNode name = FirstNamedChildOfType(useClause, "name");
            if (!name.IsNull) return new CodeGraphImportInfo(name.Text, importText);
        }
        return null;
    }

    // The static string-literal path of an include/require, or null for dynamic forms
    // (`include $var`, interpolated strings). (php.ts phpStaticIncludePath)
    private static string? PhpStaticIncludePath(CodeGraphTsNode node)
    {
        CodeGraphTsNode arg = node.NamedChild(0);
        if (!arg.IsNull && arg.Type == "parenthesized_expression") arg = arg.NamedChild(0);
        if (arg.IsNull || (arg.Type != "string" && arg.Type != "encapsed_string")) return null;

        // Pure literal only: any non-`string_content` child (interpolation, escape) ⇒
        // not a static path.
        int count = arg.NamedChildCount;
        CodeGraphTsNode content = default;
        bool hasContent = false;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = arg.NamedChild(i);
            if (c.Type != "string_content") return null;
            if (!hasContent) { content = c; hasContent = true; }
        }
        return hasContent ? content.Text : null;
    }

    private static bool IsSimpleIdentifier(string text)
    {
        if (text.Length == 0) return false;
        char first = text[0];
        if (!(char.IsLetter(first) || first == '_')) return false;
        for (int i = 1; i < text.Length; i++)
        {
            char c = text[i];
            if (!(char.IsLetterOrDigit(c) || c == '_')) return false;
        }
        return true;
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

    private static bool HasNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            if (node.NamedChild(i).Type == type) return true;
        }
        return false;
    }
}
