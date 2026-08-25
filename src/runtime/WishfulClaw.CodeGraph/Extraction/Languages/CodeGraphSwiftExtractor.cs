using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSwiftExtractor — Swift language config. Port of
// extraction/languages/swift.ts.
//
// class/struct/enum all parse as `class_declaration`; ClassifyClassNode reads the
// literal keyword child to tag struct/enum. Methods are `function_declaration`
// nested in a class. A nested-type extension `extension KF.Builder { … }` is renamed
// to the LAST `type_identifier` segment (ResolveName) so its members share the
// extended type's simple name. GetReturnType captures the declared return type (the
// #645/#608 chained-factory mechanism); tree-sitter-swift labels both the name and
// the return type with the field `name`, so the return type is found positionally.
// =============================================================================
internal static partial class CodeGraphSwiftExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_declaration"],
        ClassTypes = ["class_declaration"],
        MethodTypes = ["function_declaration"], // Methods are functions inside classes
        ClassifyMethodNode = node =>
        {
            CodeGraphTsNode name = node.ChildByField("name");
            return !name.IsNull && name.Text.StartsWith("init", StringComparison.Ordinal)
                ? "constructor"
                : "method";
        },
        InterfaceTypes = ["protocol_declaration"],
        StructTypes = ["struct_declaration"],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["enum_entry"],
        TypeAliasTypes = ["typealias_declaration"],
        ImportTypes = ["import_declaration"],
        CallTypes = ["call_expression"],
        VariableTypes = ["property_declaration", "constant_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameter",
        ReturnField = "return_type",
        GetReturnType = ExtractSwiftReturnType,

        // A nested-type extension `extension KF.Builder { … }` parses as a
        // class_declaration whose `name` is a multi-segment `user_type`; name the node
        // by the LAST segment so it shares the extended type's simple name (#750).
        ResolveName = (node, source) =>
        {
            if (node.Type != "class_declaration") return null;
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (nameNode.IsNull || nameNode.Type != "user_type") return null;
            List<CodeGraphTsNode> ids = new();
            int count = nameNode.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = nameNode.NamedChild(i);
                if (child.Type == "type_identifier") ids.Add(child);
            }
            return ids.Count > 1 ? ids[^1].Text : null;
        },

        GetSignature = (node, source) =>
        {
            // Swift function signature: func name(params) -> ReturnType
            CodeGraphTsNode paramsNode = node.ChildByField("parameter");
            if (paramsNode.IsNull) return null;
            string sig = paramsNode.Text;
            CodeGraphTsNode returnType = node.ChildByField("return_type");
            if (!returnType.IsNull) sig += " -> " + returnType.Text;
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
                if (text.Contains("internal", StringComparison.Ordinal)) return CodeGraphVisibility.Internal;
                if (text.Contains("fileprivate", StringComparison.Ordinal)) return CodeGraphVisibility.Private;
            }
            return CodeGraphVisibility.Internal; // Swift defaults to internal
        },

        IsStatic = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "modifiers" &&
                    (child.Text.Contains("static", StringComparison.Ordinal) ||
                     child.Text.Contains("class", StringComparison.Ordinal)))
                    return true;
            }
            return false;
        },

        // Swift reuses class_declaration for classes, structs, and enums.
        ClassifyClassNode = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull) continue;
                if (child.Type == "struct") return CodeGraphNodeKind.Struct;
                if (child.Type == "enum") return CodeGraphNodeKind.Enum;
            }
            return "class";
        },

        IsAsync = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "modifiers" &&
                    child.Text.Contains("async", StringComparison.Ordinal))
                    return true;
            }
            return false;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type == "identifier")
                    return new CodeGraphImportInfo(child.Text, importText);
            }
            return null;
        }
    };

    // A Swift function's declared return type, normalized to the bare class name a
    // chained `Foo.make().draw()` could be called on (#645/#608). tree-sitter-swift
    // labels BOTH the function name (simple_identifier) and the return type (user_type)
    // with field `name`, so the return type is found positionally — the first type node
    // after the name, before the body. Optionals unwrap; arrays/tuples/`Void` → null.
    private static string? ExtractSwiftReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        bool seenName = false;
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type == "simple_identifier" && !seenName)
            {
                seenName = true;
                continue;
            }
            if (!seenName) continue;
            if (child.Type == "function_body") return null; // body reached: no return type
            CodeGraphTsNode typeNode = default;
            if (child.Type == "user_type") typeNode = child;
            else if (child.Type == "optional_type")
            {
                int inner = child.NamedChildCount;
                for (int j = 0; j < inner; j++)
                {
                    CodeGraphTsNode c = child.NamedChild(j);
                    if (c.Type == "user_type") { typeNode = c; break; }
                }
            }
            if (!typeNode.IsNull)
            {
                // Whole type text, strip generics, take the LAST dotted segment
                // (`KF.Builder` → `Builder`).
                string name = GenericArgsRegex().Replace(typeNode.Text.Trim(), string.Empty);
                string last = name.Split('.')[^1].Trim();
                if (last.Length == 0 || !IdentifierRegex().IsMatch(last) || last == "Void") return null;
                return last;
            }
        }
        return null;
    }

    [GeneratedRegex(@"<[^>]*>")] private static partial Regex GenericArgsRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();
}
