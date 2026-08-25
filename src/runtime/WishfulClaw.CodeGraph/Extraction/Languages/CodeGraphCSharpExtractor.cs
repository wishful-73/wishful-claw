using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCSharpExtractor — C# language config. Port of
// extraction/languages/csharp.ts.
//
// Records are first-class type declarations; the shipped grammar parses every
// record form as record_declaration, so ClassifyClassNode tells the value-type
// (`record struct`) form apart by its `struct` keyword child. Namespaces (block and
// file-scoped) qualify type names via the file-package mechanism. A `const` or
// `static readonly` field is promoted to a constant. PreParse blanks conditional-
// compilation directive lines that mis-parse an enclosing member list (#237),
// preserving byte offsets (directive text → spaces, newlines kept).
// =============================================================================
internal static partial class CodeGraphCSharpExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        PreParse = BlankCsharpPreprocessorDirectives,
        FunctionTypes = [],
        ClassTypes = ["class_declaration", "record_declaration"],
        MethodTypes = ["method_declaration", "constructor_declaration"],
        ClassifyMethodNode = node =>
            node.Type == "constructor_declaration" ? "constructor" : "method",
        InterfaceTypes = ["interface_declaration"],
        StructTypes = ["struct_declaration", "record_struct_declaration"],
        ClassifyClassNode = node =>
        {
            if (node.Type == "record_declaration")
            {
                for (int i = 0; i < node.ChildCount; i++)
                {
                    CodeGraphTsNode c = node.Child(i);
                    if (!c.IsNull && c.Type == "struct") return "struct";
                }
            }
            return "class";
        },
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["enum_member_declaration"],
        TypeAliasTypes = [],
        PackageTypes = ["namespace_declaration", "file_scoped_namespace_declaration"],
        ExtractPackage = (node, source) => ExtractCsharpPackageName(node),
        ImportTypes = ["using_directive"],
        CallTypes = ["invocation_expression"],
        VariableTypes = ["local_declaration_statement"],
        FieldTypes = ["field_declaration"],
        PropertyTypes = ["property_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "type",
        GetReturnType = ExtractCsharpReturnType,

        GetVisibility = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "modifier") continue;
                string text = child.Text;
                if (text == "public") return CodeGraphVisibility.Public;
                if (text == "private") return CodeGraphVisibility.Private;
                if (text == "protected") return CodeGraphVisibility.Protected;
                if (text == "internal") return CodeGraphVisibility.Internal;
            }
            return CodeGraphVisibility.Private; // C# defaults to private
        },

        IsStatic = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "modifier" && child.Text == "static") return true;
            }
            return false;
        },

        // `const` and `static readonly` fields are C# constants; instance `readonly`
        // / plain `static` fields stay mutable fields.
        IsConst = node =>
        {
            bool hasStatic = false;
            bool hasReadonly = false;
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "modifier") continue;
                string t = child.Text;
                if (t == "const") return true;
                if (t == "static") hasStatic = true;
                else if (t == "readonly") hasReadonly = true;
            }
            return hasStatic && hasReadonly;
        },

        IsAsync = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "modifier" && child.Text == "async") return true;
            }
            return false;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            // using System.Collections.Generic → qualified_name; using System → identifier.
            CodeGraphTsNode qualifiedName = FirstNamedChildOfType(node, "qualified_name");
            if (!qualifiedName.IsNull)
                return new CodeGraphImportInfo(qualifiedName.Text, importText);
            CodeGraphTsNode identifier = FirstNamedChildOfType(node, "identifier");
            if (!identifier.IsNull)
                return new CodeGraphImportInfo(identifier.Text, importText);
            return null;
        }
    };

    // Namespace name from a namespace_declaration / file_scoped_namespace_declaration:
    // the `name` field, else the first qualified_name / identifier child.
    private static string? ExtractCsharpPackageName(CodeGraphTsNode node)
    {
        CodeGraphTsNode name = node.ChildByField("name");
        if (name.IsNull) name = FindNamedChildOfTypes(node, CsharpNamespaceNameTypes);
        return name.IsNull ? null : name.Text;
    }

    // A C# method's declared return type (in the `returns` field), normalized to the
    // bare class name a chained `Foo.Create().Bar()` could be called on. Built-in
    // predefined_type / array → null, generics unwrapped, nullable `Foo?` stripped,
    // dotted namespace reduced to the simple name. Constructors have no `returns`.
    private static string? ExtractCsharpReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode typeNode = node.ChildByField("returns");
        if (typeNode.IsNull) return null;
        if (typeNode.Type is "predefined_type" or "array_type") return null;
        string t = typeNode.Text.Trim();
        t = t.TrimEnd('?'); // nullable `Foo?`
        t = AngleGenericRegex().Replace(t, string.Empty); // generics `List<Foo>` → `List`
        string last = t.Split('.')[^1].Trim(); // namespace `Ns.Foo` → `Foo`
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    // Blank C# conditional-compilation directive lines (#if / #elif / #else / #endif)
    // before parse — the vendored grammar mis-parses a `#if` inside a member list and
    // detaches the enclosing container. Both branches are kept; directive characters
    // become spaces (leading indent and the trailing newline preserved) so every
    // symbol's byte offset / line / column stays exact (Decision 22). (#237)
    private static byte[] BlankCsharpPreprocessorDirectives(byte[] input, string? filePath)
    {
        _ = filePath;
        if (Array.IndexOf(input, (byte)'#') < 0) return input;

        byte[] buf = (byte[])input.Clone();
        int n = buf.Length;
        int i = 0;
        while (i < n)
        {
            int lineStart = i;
            int lineEnd = lineStart;
            while (lineEnd < n && buf[lineEnd] != (byte)'\n') lineEnd++;

            // A directive must be the first non-space token on its line (C# rule).
            int p = lineStart;
            while (p < lineEnd && (buf[p] == (byte)' ' || buf[p] == (byte)'\t')) p++;
            if (p < lineEnd && buf[p] == (byte)'#')
            {
                int hash = p;
                p++; // past '#'
                while (p < lineEnd && (buf[p] == (byte)' ' || buf[p] == (byte)'\t')) p++;
                if (MatchesConditionalKeyword(buf, p, lineEnd))
                {
                    for (int k = hash; k < lineEnd; k++) buf[k] = (byte)' ';
                }
            }

            i = lineEnd + 1; // skip the newline
        }
        return buf;
    }

    // True if the bytes at `pos` spell one of if/elif/else/endif followed by a word
    // boundary (non-word byte or end-of-line) — the `\b` in the source regex.
    private static bool MatchesConditionalKeyword(byte[] buf, int pos, int lineEnd)
    {
        foreach (byte[] kw in CsharpConditionalKeywords)
        {
            int len = kw.Length;
            if (pos + len > lineEnd) continue;
            bool match = true;
            for (int k = 0; k < len; k++)
            {
                if (buf[pos + k] != kw[k]) { match = false; break; }
            }
            if (!match) continue;
            int after = pos + len;
            if (after >= lineEnd) return true;
            byte b = buf[after];
            bool isWord = (b >= (byte)'A' && b <= (byte)'Z') ||
                          (b >= (byte)'a' && b <= (byte)'z') ||
                          (b >= (byte)'0' && b <= (byte)'9') ||
                          b == (byte)'_';
            if (!isWord) return true;
        }
        return false;
    }

    private static readonly byte[][] CsharpConditionalKeywords =
    {
        "if"u8.ToArray(), "elif"u8.ToArray(), "else"u8.ToArray(), "endif"u8.ToArray()
    };

    private static readonly HashSet<string> CsharpNamespaceNameTypes =
        new() { "qualified_name", "identifier" };

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

    private static CodeGraphTsNode FindNamedChildOfTypes(CodeGraphTsNode node, HashSet<string> types)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (types.Contains(child.Type)) return child;
        }
        return default;
    }

    [GeneratedRegex(@"<[^>]*>")] private static partial Regex AngleGenericRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();
}
