using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphPascalExtractor — Pascal/Delphi language config. Port of
// extraction/languages/pascal.ts.
//
// A pure data-object config: node-type lists drive the generic dispatch. `declProc`
// is a procedure/function (a function at top level, a method inside a class);
// `declClass`/`declIntf`/`declEnum`/`declType` map to class/interface/enum/type-alias.
// GetReturnType captures the `typeref` return for the chained static-factory
// mechanism (#750); GetVisibility walks out to the enclosing `declSection` keyword
// (kPublic/kPrivate/kProtected/kPublished); IsStatic keys off a `kClass` child.
// =============================================================================
internal static partial class CodeGraphPascalExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["declProc"],
        ClassTypes = ["declClass"],
        MethodTypes = ["declProc"],
        InterfaceTypes = ["declIntf"],
        StructTypes = [],
        EnumTypes = ["declEnum"],
        TypeAliasTypes = ["declType"],
        ImportTypes = ["declUses"],
        CallTypes = ["exprCall"],
        VariableTypes = ["declField", "declConst"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "args",
        ReturnField = "type",

        // Pascal/Delphi `function GetInstance: TBar` — the return type is a `typeref`
        // child. Capture its bare class name for the chained static-factory call
        // mechanism (#750). A procedure (no return) has no typeref → null.
        GetReturnType = (node, source) =>
        {
            CodeGraphTsNode typeref = FindNamedChildOfType(node, "typeref");
            if (typeref.IsNull) return null;
            CodeGraphTsNode id = FindNamedChildOfType(typeref, "identifier");
            if (id.IsNull) id = typeref;
            string name = id.Text.Trim();
            return PascalIdentifierRegex().IsMatch(name) ? name : null;
        },

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode args = node.ChildByField("args");
            CodeGraphTsNode returnType = FindNamedChildOfType(node, "typeref");
            if (args.IsNull && returnType.IsNull) return null;
            string sig = args.IsNull ? string.Empty : args.Text;
            if (!returnType.IsNull) sig += ": " + returnType.Text;
            return sig.Length > 0 ? sig : null;
        },

        GetVisibility = node =>
        {
            CodeGraphTsNode current = node.Parent;
            while (!current.IsNull)
            {
                if (current.Type == "declSection")
                {
                    for (int i = 0; i < current.ChildCount; i++)
                    {
                        CodeGraphTsNode child = current.Child(i);
                        if (child.IsNull) continue;
                        if (child.Type is "kPublic" or "kPublished") return CodeGraphVisibility.Public;
                        if (child.Type == "kPrivate") return CodeGraphVisibility.Private;
                        if (child.Type == "kProtected") return CodeGraphVisibility.Protected;
                    }
                }
                current = current.Parent;
            }
            return null;
        },

        // In Pascal, symbols declared in the interface section are exported — the TS
        // config conservatively returns false pending that section walk.
        IsExported = (_, _) => false,

        IsStatic = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                if (node.Child(i).Type == "kClass") return true;
            }
            return false;
        },

        IsConst = node => node.Type == "declConst"
    };

    private static CodeGraphTsNode FindNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == type) return child;
        }
        return default;
    }

    [GeneratedRegex(@"^[A-Za-z_]\w*$")] private static partial Regex PascalIdentifierRegex();
}
