using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCppExtractor — C++ language config. Port of the `cppExtractor` half of
// extraction/languages/c-cpp.ts.
//
// Classes are `class_specifier`; a bodiless one is a forward declaration
// (SkipBodilessClass). Methods and functions are both `function_definition` — the
// engine disambiguates by scope, and an OUT-OF-LINE definition (`void Foo::bar(){}`)
// is routed to a method via GetReceiverType (the `Foo::` qualifier). ResolveName
// pulls the trailing segment of a `Foo::bar` qualified declarator so the method is
// named `bar`, not mis-named after a qualified parameter type. Return-type
// normalization and `#include` extraction are the C-family shared helpers.
//
// CUDA (M7-W1): `.cu`/`.cuh` parse with this C++ grammar, which cannot read the
// `kernel<<<grid, block>>>(args)` launch syntax — the whole statement mis-parses and
// the call edge to the kernel is lost. The PreParse below space-blanks the
// `<<<…>>>` launch configuration (newlines preserved, byte length unchanged —
// Decision 22) so the statement parses as a plain `kernel(args)` call. The config
// expressions themselves carry no graph signal. Non-CUDA files are untouched.
//
// DEFERRED (analysis/01 §7, MVP scope): the Unreal/Metal/pugixml macro-blanking
// preParse, macro-mangled-name recovery, and macro-misparse detection — all exotic
// framework surface — are left unset. Standard C++ needs none of them.
// =============================================================================
internal static class CodeGraphCppExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        PreParse = NormalizeCudaKernelLaunches,
        FunctionTypes = ["function_definition"],
        ClassTypes = ["class_specifier"],
        // A bodiless `class_specifier` is a forward declaration / elaborated type
        // reference, not a definition — skip it so forward decls don't mint phantom
        // class nodes that crowd out the single real definition.
        SkipBodilessClass = true,
        MethodTypes = ["function_definition"],
        ClassifyMethodNode = ClassifyCppMethod,
        InterfaceTypes = [],
        StructTypes = ["struct_specifier"],
        EnumTypes = ["enum_specifier"],
        EnumMemberTypes = ["enumerator"],
        TypeAliasTypes = ["type_definition", "alias_declaration"], // typedef and using
        ImportTypes = ["preproc_include"],
        CallTypes = ["call_expression"],
        VariableTypes = ["declaration"],
        NameField = "declarator",
        BodyField = "body",
        ParamsField = "parameters",

        ResolveName = ExtractCppQualifiedMethodName,
        GetReceiverType = ExtractCppReceiverType,
        GetReturnType = CodeGraphCFamilyExtraction.ExtractReturnType,
        ResolveTypeAliasKind = CodeGraphCFamilyExtraction.ResolveTypedefKind,
        ExtractImport = CodeGraphCFamilyExtraction.ExtractInclude,

        // An out-of-class access specifier (`public:` / `private:` / `protected:`) is
        // the member's preceding sibling under the field_declaration_list; the shipped
        // grammar records it as an `access_specifier` child of the class body (parent).
        GetVisibility = node =>
        {
            CodeGraphTsNode parent = node.Parent;
            if (parent.IsNull) return null;
            for (int i = 0; i < parent.ChildCount; i++)
            {
                CodeGraphTsNode child = parent.Child(i);
                if (child.IsNull || child.Type != "access_specifier") continue;
                string text = child.Text;
                if (text.Contains("public", StringComparison.Ordinal)) return CodeGraphVisibility.Public;
                if (text.Contains("private", StringComparison.Ordinal)) return CodeGraphVisibility.Private;
                if (text.Contains("protected", StringComparison.Ordinal)) return CodeGraphVisibility.Protected;
            }
            return null;
        }
    };

    // The method name is the trailing segment of the declarator's `qualified_identifier`
    // (`Foo::bar` → `bar`). Returns null when the declarator is unqualified (a plain
    // free/inline function) so the engine falls back to the default declarator walk.
    // (c-cpp.ts extractCppQualifiedMethodName — MVP subset, macro-name recovery deferred.)
    private static string? ExtractCppQualifiedMethodName(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode declarator = node.ChildByField("declarator");
        if (declarator.IsNull) return null;
        CodeGraphTsNode qid = FindDeclaratorQualifiedId(declarator);
        if (qid.IsNull) return null;
        string last = LastQualifiedSegment(qid.Text);
        return last.Length > 0 ? last : null;
    }

    // The receiver (owning) type of an out-of-line method definition: the qualifier
    // BEFORE the last `::` segment (`ns::Foo::bar` → `ns::Foo`). Null when unqualified.
    // (c-cpp.ts extractCppReceiverType.)
    private static string? ExtractCppReceiverType(CodeGraphTsNode node, CodeGraphSourceText source)
        => ExtractCppReceiverTypeCore(node);

    private static string? ExtractCppReceiverTypeCore(CodeGraphTsNode node)
    {
        CodeGraphTsNode declarator = node.ChildByField("declarator");
        if (declarator.IsNull) return null;
        CodeGraphTsNode qid = FindDeclaratorQualifiedId(declarator);
        if (qid.IsNull) return null;
        string[] parts = qid.Text.Trim().Split("::", StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 1 ? string.Join("::", parts[..^1]) : null;
    }

    // C++ has no constructor-specific grammar node. A constructor is a member whose
    // declared name equals its owning class (`Widget()` or `Widget::Widget()`).
    private static string ClassifyCppMethod(CodeGraphTsNode node)
    {
        string? receiver = ExtractCppReceiverTypeCore(node);
        if (receiver != null)
        {
            CodeGraphTsNode declarator = node.ChildByField("declarator");
            CodeGraphTsNode qualifiedId = declarator.IsNull
                ? default
                : FindDeclaratorQualifiedId(declarator);
            if (!qualifiedId.IsNull &&
                LastQualifiedSegment(qualifiedId.Text) == LastQualifiedSegment(receiver))
            {
                return "constructor";
            }
        }

        string? owner = receiver is null ? EnclosingCppTypeName(node) : LastQualifiedSegment(receiver);
        if (string.IsNullOrEmpty(owner)) return "method";

        string pattern = $@"(?:^|[\w:]){Regex.Escape(owner)}\s*(?:<[^(){{}};]*>)?\s*\(";
        return Regex.IsMatch(node.Text, pattern, RegexOptions.CultureInvariant)
            ? "constructor"
            : "method";
    }

    private static string? EnclosingCppTypeName(CodeGraphTsNode node)
    {
        for (CodeGraphTsNode parent = node.Parent; !parent.IsNull; parent = parent.Parent)
        {
            if (parent.Type != "class_specifier") continue;
            CodeGraphTsNode name = parent.ChildByField("name");
            if (!name.IsNull) return LastQualifiedSegment(name.Text);
        }

        return null;
    }

    // BFS the declarator for the function NAME's `qualified_identifier`, NEVER
    // descending into a `parameter_list` or `trailing_return_type` — a parameter with a
    // qualified type (`const std::string& x`) must not be mistaken for the method name.
    // (c-cpp.ts findDeclaratorQualifiedId.)
    private static CodeGraphTsNode FindDeclaratorQualifiedId(CodeGraphTsNode declarator)
    {
        Queue<CodeGraphTsNode> queue = new();
        queue.Enqueue(declarator);
        while (queue.Count > 0)
        {
            CodeGraphTsNode current = queue.Dequeue();
            if (current.Type == "qualified_identifier") return current;
            int count = current.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = current.NamedChild(i);
                if (!child.IsNull && child.Type != "parameter_list" && child.Type != "trailing_return_type")
                    queue.Enqueue(child);
            }
        }
        return default;
    }

    private static string LastQualifiedSegment(string qualified)
    {
        string[] parts = qualified.Trim().Split("::", StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 ? parts[^1] : string.Empty;
    }

    // Space-blank every CUDA `<<<…>>>` launch configuration in a `.cu`/`.cuh` file so
    // `kernel<<<grid, block>>>(args)` parses as the call `kernel(args)`. Byte-wise
    // ASCII scan (safe in UTF-8 — the delimiters are ASCII), newlines preserved so
    // line numbers stay valid. `<<<` never occurs in valid C++ outside a launch
    // (template opens always have identifiers between the `<`s), so the trigger is
    // unambiguous; the close is the first `>>>` at zero angle-nesting depth, so a
    // template argument inside the config (`f<int><<<…>`) doesn't end it early.
    internal static byte[] NormalizeCudaKernelLaunches(byte[] bytes, string? filePath)
    {
        if (filePath is null ||
            (!filePath.EndsWith(".cu", StringComparison.OrdinalIgnoreCase) &&
             !filePath.EndsWith(".cuh", StringComparison.OrdinalIgnoreCase)))
        {
            return bytes;
        }

        byte[]? result = null; // copy-on-first-launch; most files have none per-buffer
        int n = bytes.Length;
        for (int i = 0; i + 2 < n; i++)
        {
            if (bytes[i] != (byte)'<' || bytes[i + 1] != (byte)'<' || bytes[i + 2] != (byte)'<')
            {
                continue;
            }

            // Find the matching `>>>` tracking template-angle depth.
            int depth = 0;
            int close = -1;
            for (int j = i + 3; j < n; j++)
            {
                byte c = bytes[j];
                if (c == (byte)'<')
                {
                    depth++;
                }
                else if (c == (byte)'>')
                {
                    if (depth > 0)
                    {
                        depth--;
                    }
                    else if (j + 2 < n && bytes[j + 1] == (byte)'>' && bytes[j + 2] == (byte)'>')
                    {
                        close = j;
                        break;
                    }
                }
            }

            if (close < 0)
            {
                continue; // unterminated — leave the source alone
            }

            result ??= (byte[])bytes.Clone();
            for (int k = i; k < close + 3; k++)
            {
                if (result[k] != (byte)'\n' && result[k] != (byte)'\r')
                {
                    result[k] = (byte)' ';
                }
            }

            i = close + 2; // resume after the close
        }

        return result ?? bytes;
    }
}
