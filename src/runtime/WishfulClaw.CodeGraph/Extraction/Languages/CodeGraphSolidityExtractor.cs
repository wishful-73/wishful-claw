// =============================================================================
// CodeGraphSolidityExtractor — Solidity language config. Port of
// extraction/languages/solidity.ts (tree-sitter-solidity, ABI 14).
//
// Solidity has multiple top-level contract-like containers (contract / interface /
// library) and several nameless callable forms (constructor, fallback, receive).
// contract/library → class, interface → interface, struct/enum members are DIRECT
// children (no body field) so they are minted in VisitNode. Inheritance (`is A, B`)
// is emitted as `extends` refs there too.
//
// PORT NOTE: tree-sitter-solidity distinguishes input params from the return-type
// param by field name (`fieldNameForNamedChild`), which the C# node surface does
// not expose. GetSignature therefore approximates: every `parameter` child is an
// input param and a `return_type_definition` child is the return type.
// =============================================================================
internal static class CodeGraphSolidityExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        // Free functions and contract methods share function_definition — the
        // dispatcher routes by IsInsideClassLikeNode.
        FunctionTypes = ["function_definition", "modifier_definition"],
        ClassTypes = ["contract_declaration", "library_declaration"],
        MethodTypes =
        [
            "function_definition",
            "modifier_definition",
            "constructor_definition",
            "fallback_receive_definition"
        ],
        ClassifyMethodNode = node =>
            node.Type == "constructor_definition" ? "constructor" : "method",
        InterfaceTypes = ["interface_declaration"],
        StructTypes = ["struct_declaration"],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = [], // enum_value has no name field; handled in VisitNode
        TypeAliasTypes = ["user_defined_type_definition"],
        ImportTypes = ["import_directive"],
        // emit / revert / modifier_invocation are call-shaped but distinct AST nodes.
        CallTypes = ["call_expression", "emit_statement", "revert_statement", "modifier_invocation"],
        VariableTypes = ["state_variable_declaration", "constant_variable_declaration"],
        FieldTypes = ["state_variable_declaration", "struct_member"],

        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "return_type",

        // constructor / fallback / receive have no `name:` field — synthesize one.
        ResolveName = (node, _source) =>
        {
            if (node.Type == "constructor_definition") return "constructor";
            if (node.Type == "fallback_receive_definition") return FallbackReceiveName(node);
            return null;
        },

        GetSignature = (node, source) =>
        {
            List<string> paramTexts = new();
            CodeGraphTsNode returnType = default;
            CodeGraphTsNode visibility = default;
            CodeGraphTsNode mutability = default;
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.IsNull) continue;
                switch (child.Type)
                {
                    case "parameter":
                        paramTexts.Add(child.Text);
                        break;
                    case "return_type_definition":
                        returnType = child;
                        break;
                    case "visibility":
                        visibility = child;
                        break;
                    case "state_mutability":
                        mutability = child;
                        break;
                }
            }

            List<string> parts = new() { "(" + string.Join(", ", paramTexts) + ")" };
            if (!visibility.IsNull) parts.Add(visibility.Text);
            if (!mutability.IsNull) parts.Add(mutability.Text);
            if (!returnType.IsNull) parts.Add(returnType.Text);
            return string.Join(" ", parts);
        },

        GetVisibility = node =>
        {
            // external maps to 'public' (callable from outside the contract).
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type != "visibility") continue;
                string t = child.Text.Trim();
                if (t is "public" or "external") return CodeGraphVisibility.Public;
                if (t == "private") return CodeGraphVisibility.Private;
                if (t == "internal") return CodeGraphVisibility.Internal;
            }
            return null;
        },

        IsConst = node => node.Type == "constant_variable_declaration",

        VisitNode = VisitSolidityNode,

        // import "X"; / import {A, B} from "X"; — surface the SOURCE path as the
        // moduleName (what the import-resolver matches on disk).
        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            CodeGraphTsNode sourceField = node.ChildByField("source");
            if (sourceField.IsNull) return null;
            string moduleName;
            List<CodeGraphTsNode> lits = new();
            HashSet<string> want = new(System.StringComparer.Ordinal) { "string_literal" };
            sourceField.CollectDescendantsOfType(want, lits);
            moduleName = lits.Count > 0 ? lits[0].Text : sourceField.Text;
            moduleName = StripQuotes(moduleName).Trim();
            if (moduleName.Length == 0) return null;
            return new CodeGraphImportInfo(moduleName, importText);
        }
    };

    private static bool VisitSolidityNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        string t = node.Type;

        // Inheritance: `contract MyToken is Token, IERC20 { ... }`. Solidity's
        // inheritance_specifier children are direct siblings of `body:`. Create the
        // node, emit `extends` refs, walk the body, and short-circuit dispatch.
        if (t is "contract_declaration" or "library_declaration" or "interface_declaration")
        {
            List<string> ancestors = GetInheritanceAncestors(node);
            CodeGraphTsNode nameNode = node.ChildByField("name");
            CodeGraphTsNode body = node.ChildByField("body");
            if (nameNode.IsNull) return false;
            string name = nameNode.Text;
            string kind = t == "interface_declaration" ? CodeGraphNodeKind.Interface : CodeGraphNodeKind.Class;
            CodeGraphNode? created = ctx.CreateNode(kind, name, node);
            if (created == null) return true;
            // One keyword (`is`) for both extends-class and implements-interface —
            // emit `extends` for every ancestor; the resolver reclassifies later.
            foreach (string ancestor in ancestors)
                EmitRef(ctx, created.Id, ancestor, CodeGraphEdgeKind.Extends, node);
            ctx.PushScope(created.Id);
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
            return true;
        }

        // struct_member / enum_value are DIRECT children of struct/enum (no body
        // field), so the generic extractStruct/extractEnum bail — extract here.
        if (t is "struct_declaration" or "enum_declaration")
        {
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (nameNode.IsNull) return true;
            string name = nameNode.Text;
            string kind = t == "struct_declaration" ? CodeGraphNodeKind.Struct : CodeGraphNodeKind.Enum;
            CodeGraphNode? created = ctx.CreateNode(kind, name, node);
            if (created == null) return true;
            ctx.PushScope(created.Id);
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.IsNull) continue;
                if (NodesEqual(child, nameNode)) continue;
                ctx.VisitNode(child);
            }
            ctx.PopScope();
            return true;
        }

        // enum_value is the bare identifier of an enum case — no `name:` field.
        if (t == "enum_value")
        {
            ctx.CreateNode(CodeGraphNodeKind.EnumMember, node.Text, node);
            return true;
        }

        // event / error declarations preserve their name as a field-shaped node so
        // `emit SomeEvent(...)` / `revert MyError()` can resolve to them.
        if (t is "event_definition" or "error_declaration")
        {
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (nameNode.IsNull) return true;
            string sig = node.Text.Trim();
            if (sig.Length > 200) sig = sig.Substring(0, 200);
            ctx.CreateNode(CodeGraphNodeKind.Field, nameNode.Text, node, new CodeGraphNodeExtra { Signature = sig });
            return true;
        }

        // struct_member: handled by the generic field dispatch via FieldTypes.
        return false;
    }

    private static List<string> GetInheritanceAncestors(CodeGraphTsNode node)
    {
        List<string> ancestors = new();
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull || child.Type != "inheritance_specifier") continue;
            CodeGraphTsNode ancestor = child.ChildByField("ancestor");
            if (ancestor.IsNull) continue;
            List<CodeGraphTsNode> ids = new();
            HashSet<string> want = new(System.StringComparer.Ordinal) { "identifier" };
            ancestor.CollectDescendantsOfType(want, ids);
            if (ids.Count > 0) ancestors.Add(ids[^1].Text);
        }
        return ancestors;
    }

    // tree-sitter-solidity reuses one node type for `fallback()` and `receive()`;
    // the keyword is an unnamed child — walk all children and pick the first match.
    private static string FallbackReceiveName(CodeGraphTsNode node)
    {
        int count = node.ChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.Child(i);
            if (child.IsNull) continue;
            string t = child.Text;
            if (t == "fallback" || t == "receive") return t;
        }
        return "fallback";
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

    private static string StripQuotes(string s)
    {
        if (s.Length >= 1 && (s[0] == '"' || s[0] == '\'')) s = s.Substring(1);
        if (s.Length >= 1 && (s[^1] == '"' || s[^1] == '\'')) s = s.Substring(0, s.Length - 1);
        return s;
    }

    // The C# node surface exposes no node-identity primitive; two nodes with the
    // same span + symbol are the same node for the checks here.
    private static bool NodesEqual(CodeGraphTsNode a, CodeGraphTsNode b) =>
        a.StartByte == b.StartByte && a.EndByte == b.EndByte && a.Symbol == b.Symbol;
}
