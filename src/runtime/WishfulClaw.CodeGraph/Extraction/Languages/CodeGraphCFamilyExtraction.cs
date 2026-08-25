using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCFamilyExtraction — the shared C / C++ extraction helpers. Port of the
// module-level helpers in extraction/languages/c-cpp.ts that BOTH cExtractor and
// cppExtractor reuse (the TS ships one `c-cpp.ts` module; the C# split keeps
// CodeGraphCExtractor / CodeGraphCppExtractor thin by delegating the two shared
// behaviors here):
//
//   * return-type normalization (`getReturnType`) — read the declaration's `type`
//     field, reduce it to the bare class name a chained `->method()` could target,
//     dropping primitives / void / auto (extractCppReturnType + normalizeCppReturnType).
//   * `#include` import extraction — `<system_lib_string>` or a `"string_literal"`
//     with a `string_content` child (identical for C and C++).
//
// MVP scope (analysis/01 §7): the exotic C/C++ framework surface — macro/CUDA/Metal
// preParse blanking, macro-mangled-name recovery, and macro-misparse detection — is
// deferred. Those live only in the TS config; the C# configs leave those hooks unset.
// =============================================================================
internal static partial class CodeGraphCFamilyExtraction
{
    // Built-in / non-class return types that can never be a method receiver — we
    // store no returnType for these so resolution never chains a method on `void` /
    // `int` / etc. (c-cpp.ts CPP_NON_CLASS_RETURN).
    private static readonly HashSet<string> NonClassReturn = new(StringComparer.Ordinal)
    {
        "void", "bool", "char", "short", "int", "long", "float", "double", "unsigned",
        "signed", "size_t", "ssize_t", "auto", "wchar_t", "char8_t", "char16_t",
        "char32_t", "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t",
        "uint32_t", "uint64_t", "intptr_t", "uintptr_t", "nullptr_t"
    };

    /// <summary>
    /// A function/method's declared return type (the `type` field), normalized to the
    /// bare class name a chained call could target. Constructors / destructors /
    /// conversion operators have no `type` field → null. (c-cpp.ts extractCppReturnType)
    /// </summary>
    public static string? ExtractReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode typeNode = node.ChildByField("type");
        return typeNode.IsNull ? null : NormalizeReturnType(typeNode.Text);
    }

    /// <summary>
    /// Normalize a C/C++ return type to the bare class name a method could be called
    /// on. Unwraps smart-pointer / optional wrappers to their element type
    /// (`std::unique_ptr&lt;Widget&gt;` → `Widget`), strips cv-qualifiers, `&`/`*`,
    /// namespace qualifiers, and template args. Null for primitives / void / auto /
    /// empty. (c-cpp.ts normalizeCppReturnType)
    /// </summary>
    public static string? NormalizeReturnType(string raw)
    {
        string t = raw.Trim();
        if (t.Length == 0) return null;

        // Unwrap smart pointers / optional to their pointee (the `->`-callable thing).
        Match wrapper = SmartPointerRegex().Match(t);
        if (wrapper.Success && wrapper.Groups[1].Value.Length > 0) t = wrapper.Groups[1].Value;

        t = CvQualifierRegex().Replace(t, " ");
        t = AngleGenericRegex().Replace(t, " ");
        t = PointerRefRegex().Replace(t, " ");
        t = WhitespaceRegex().Replace(t, " ").Trim();
        if (t.Length == 0) return null;

        string[] parts = t.Split("::", StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0) return null;
        string last = parts[^1];
        if (last.Length == 0) return null;
        if (NonClassReturn.Contains(last)) return null;
        if (!IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    /// <summary>
    /// `#include &lt;stdio.h&gt;` / `#include "myheader.h"` → the included module name.
    /// (c-cpp.ts cExtractor/cppExtractor extractImport — identical for both.)
    /// </summary>
    public static CodeGraphImportInfo? ExtractInclude(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        string importText = node.Text.Trim();

        CodeGraphTsNode systemLib = FirstNamedChildOfType(node, "system_lib_string");
        if (!systemLib.IsNull)
            return new CodeGraphImportInfo(TrimAngles(systemLib.Text), importText);

        CodeGraphTsNode stringLiteral = FirstNamedChildOfType(node, "string_literal");
        if (!stringLiteral.IsNull)
        {
            CodeGraphTsNode stringContent = FirstNamedChildOfType(stringLiteral, "string_content");
            if (!stringContent.IsNull)
                return new CodeGraphImportInfo(stringContent.Text, importText);
        }
        return null;
    }

    /// <summary>
    /// A C/C++ typedef whose payload is an INLINE-DEFINED enum/struct: the typedef name
    /// becomes the enum/struct node name. Only fires when the inner specifier has a
    /// `body` (an inline definition, not a bare `typedef enum Foo Bar;` reference).
    /// (c-cpp.ts resolveTypeAliasKind — identical for both.)
    /// </summary>
    public static string? ResolveTypedefKind(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type == "enum_specifier" && !child.ChildByField("body").IsNull) return "enum";
            if (child.Type == "struct_specifier" && !child.ChildByField("body").IsNull) return "struct";
        }
        return null;
    }

    // A file-scope `const` / `static const` declaration carries a `type_qualifier`
    // child reading "const" — those are constants, plain globals are variables.
    // (c-cpp.ts cExtractor isConst.)
    public static bool IsConstDeclaration(CodeGraphTsNode node)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull && child.Type == "type_qualifier" &&
                child.Text == "const")
                return true;
        }
        return false;
    }

    internal static CodeGraphTsNode FirstNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == type) return child;
        }
        return default;
    }

    private static string TrimAngles(string text) => text.Trim('<', '>');

    [GeneratedRegex(@"\b(?:std\s*::\s*)?(?:unique_ptr|shared_ptr|weak_ptr|optional)\s*<\s*([^,>]+?)\s*>")]
    private static partial Regex SmartPointerRegex();
    [GeneratedRegex(@"\b(?:const|volatile|typename|struct|class|enum)\b")]
    private static partial Regex CvQualifierRegex();
    [GeneratedRegex(@"<[^>]*>")] private static partial Regex AngleGenericRegex();
    [GeneratedRegex(@"[*&]+")] private static partial Regex PointerRefRegex();
    [GeneratedRegex(@"\s+")] private static partial Regex WhitespaceRegex();
    [GeneratedRegex(@"^[A-Za-z_]\w*$")] private static partial Regex IdentifierRegex();
}
