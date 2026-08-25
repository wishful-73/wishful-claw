using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCobolExtractor — COBOL language config. Port of
// extraction/languages/cobol.ts (patched yutaro-sakamoto/tree-sitter-cobol).
//
// COBOL's flat, column-oriented AST doesn't fit the generic type-list dispatch, so
// extraction runs through the VisitNode hook (the Pascal pattern):
//   - PROGRAM-ID → module; PROCEDURE DIVISION sections/paragraphs → function nodes;
//   - PERFORM (incl. THRU), GO TO, CALL 'literal', EXEC CICS LINK/XCTL, EXEC SQL
//     INCLUDE → calls/imports references; COPY → import nodes + imports references;
//   - DATA DIVISION entries → variable (01/77), field (nested), constant (88-level).
//
// PORT NOTES (C# surface limitations, faithful subset):
//   - cobol.ts uses a preParse that reformats free-format files (7-space indent) and
//     terminates EXEC SQL INCLUDEs — a length-changing transform the engine forbids
//     (Decision 22), so PreParse is omitted; fixed-format files parse normally.
//   - CodeGraphNodeExtra has no endLine field, so the paragraph/section/group-item
//     span reconstruction is dropped; each node spans its own header/entry.
//   - the node surface exposes only single-child ChildByField (no childrenForField),
//     so multi-target write statements record their first target only.
// =============================================================================
internal static class CodeGraphCobolExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = [],
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = [],
        CallTypes = [],
        VariableTypes = [],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        VisitNode = VisitCobolNode
    };

    private static bool VisitCobolNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        switch (node.Type)
        {
            case "program_definition":
            {
                string? name = ProgramName(node);
                CodeGraphNode? moduleNode = name != null ? ctx.CreateNode(CodeGraphNodeKind.Module, name, node) : null;
                if (moduleNode != null) ctx.PushScope(moduleNode.Id);
                int count = node.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (!child.IsNull) ctx.VisitNode(child);
                }
                if (moduleNode != null) ctx.PopScope();
                return true;
            }
            case "procedure_division":
                WalkProcedureChildren(NamedChildren(node), ctx);
                return true;
            case "working_storage_section":
            case "record_description_list":
                WalkDataEntries(NamedChildren(node), ctx);
                return true;
            case "copybook_fragment":
            {
                List<CodeGraphTsNode> children = NamedChildren(node);
                bool hasRecordList = children.Exists(c => c.Type == "record_description_list");
                if (hasRecordList)
                {
                    foreach (CodeGraphTsNode child in children) ctx.VisitNode(child);
                }
                else
                {
                    WalkProcedureChildren(children, ctx);
                }
                return true;
            }
            case "copy_statement":
                HandleCopy(node, ctx);
                return true;
            case "exec_statement":
                HandleExec(node, ctx, CurrentScope(ctx));
                return true;
            default:
                return false;
        }
    }

    // --- DATA DIVISION -------------------------------------------------------

    // Walk a run of DATA DIVISION entries. Level numbers drive nesting: an entry
    // closes all open entries with level >= its own. 88-level condition names attach
    // to the open item as constants and never open a scope.
    private static void WalkDataEntries(List<CodeGraphTsNode> entries, CodeGraphExtractorContext ctx)
    {
        List<int> openLevels = new();
        int pushed = 0;

        void CloseTo(int level)
        {
            while (openLevels.Count > 0 && openLevels[^1] >= level)
            {
                openLevels.RemoveAt(openLevels.Count - 1);
                ctx.PopScope();
                pushed--;
            }
        }

        foreach (CodeGraphTsNode entry in entries)
        {
            if (entry.Type == "copy_statement") { HandleCopy(entry, ctx); continue; }
            if (entry.Type == "exec_statement") { HandleExec(entry, ctx, CurrentScope(ctx)); continue; }
            if (entry.Type != "data_description") continue;

            CodeGraphTsNode levelNode = FindNamedChildOfType(entry, "level_number");
            CodeGraphTsNode nameNode = FindNamedChildOfType(entry, "entry_name");
            int level = 1;
            if (!levelNode.IsNull && int.TryParse(levelNode.Text, out int parsed)) level = parsed;
            string? name = nameNode.IsNull ? null : nameNode.Text.Trim();

            bool isCondition = level == 88;
            if (!isCondition) CloseTo(IsTopLevel(level) ? 0 : level);

            // FILLER / unnamed entries carry no symbol.
            if (string.IsNullOrEmpty(name) || FillerRegex.IsMatch(name!)) continue;

            string kind = isCondition ? CodeGraphNodeKind.Constant
                : (openLevels.Count == 0 ? CodeGraphNodeKind.Variable : CodeGraphNodeKind.Field);
            CodeGraphNode? created = ctx.CreateNode(kind, name!, entry, new CodeGraphNodeExtra
            {
                Signature = Collapse(entry.Text)
            });
            if (created != null && !isCondition)
            {
                ctx.PushScope(created.Id);
                openLevels.Add(level);
                pushed++;
            }
        }
        while (pushed > 0) { ctx.PopScope(); pushed--; }
    }

    // Levels 01, 66, and 77 always open at top level, whatever came before.
    private static bool IsTopLevel(int level) => level == 1 || level == 66 || level == 77;

    // --- PROCEDURE DIVISION --------------------------------------------------

    private static void WalkProcedureChildren(List<CodeGraphTsNode> children, CodeGraphExtractorContext ctx)
    {
        string? currentFnId = CurrentScope(ctx);
        bool sectionPushed = false;

        foreach (CodeGraphTsNode child in children)
        {
            if (child.Type == "section_header")
            {
                if (sectionPushed) { ctx.PopScope(); sectionPushed = false; }
                CodeGraphNode? created = ctx.CreateNode(CodeGraphNodeKind.Function, HeaderName(child), child, new CodeGraphNodeExtra
                {
                    Signature = "SECTION"
                });
                if (created != null)
                {
                    ctx.PushScope(created.Id);
                    sectionPushed = true;
                    currentFnId = created.Id;
                }
            }
            else if (child.Type == "paragraph_header")
            {
                CodeGraphNode? created = ctx.CreateNode(CodeGraphNodeKind.Function, HeaderName(child), child);
                if (created != null) currentFnId = created.Id;
            }
            else
            {
                CollectRefs(child, currentFnId, ctx);
            }
        }
        if (sectionPushed) ctx.PopScope();
    }

    // Collect call/import references from a statement subtree, attributed to the
    // enclosing paragraph/section (or the program when no paragraph is open).
    private static void CollectRefs(CodeGraphTsNode node, string? fromNodeId, CodeGraphExtractorContext ctx)
    {
        switch (node.Type)
        {
            case "move_statement":
                EmitWriteRefs(node, new[] { "dst" }, fromNodeId, ctx);
                return;
            case "add_statement":
                EmitWriteRefs(node, new[] { "to", "giving" }, fromNodeId, ctx);
                return;
            case "compute_statement":
                EmitWriteRefs(node, new[] { "left" }, fromNodeId, ctx);
                return;
            case "subtract_statement":
            {
                bool hasGiving = !node.ChildByField("giving").IsNull;
                EmitWriteRefs(node, new[] { hasGiving ? "giving" : "from" }, fromNodeId, ctx);
                return;
            }
            case "perform_statement_call_proc":
            {
                CodeGraphTsNode proc = node.ChildByField("procedure");
                if (!proc.IsNull)
                {
                    int count = proc.NamedChildCount;
                    for (int i = 0; i < count; i++)
                    {
                        CodeGraphTsNode label = proc.NamedChild(i);
                        if (label.Type != "label") continue;
                        AddRef(ctx, fromNodeId, label.Text.Trim(), CodeGraphEdgeKind.Calls, label);
                    }
                }
                return;
            }
            case "call_statement":
            {
                CodeGraphTsNode x = node.ChildByField("x");
                if (!x.IsNull && x.Type == "string")
                    AddRef(ctx, fromNodeId, StripQuotes(x.Text).Trim(), CodeGraphEdgeKind.Calls, x);
                return;
            }
            case "goto_statement":
            {
                CodeGraphTsNode to = node.ChildByField("to");
                if (!to.IsNull) AddRef(ctx, fromNodeId, to.Text.Trim(), CodeGraphEdgeKind.Calls, to);
                return;
            }
            case "exec_statement":
                HandleExec(node, ctx, fromNodeId);
                return;
            case "copy_statement":
                HandleCopy(node, ctx);
                return;
            default:
            {
                int count = node.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (!child.IsNull) CollectRefs(child, fromNodeId, ctx);
                }
                return;
            }
        }
    }

    // Emit a `references` ref for the data item(s) a statement WRITES.
    private static void EmitWriteRefs(CodeGraphTsNode statement, string[] fields, string? fromNodeId, CodeGraphExtractorContext ctx)
    {
        foreach (string field in fields)
        {
            CodeGraphTsNode target = statement.ChildByField(field);
            if (target.IsNull) continue;
            CodeGraphTsNode word = TargetBaseName(target);
            if (word.IsNull) continue;
            string name = word.Text.Trim();
            if (name.Length == 0 || SpecialRegisterRegex.IsMatch(name)) continue;
            AddRef(ctx, fromNodeId, name, CodeGraphEdgeKind.References, word);
        }
    }

    private static CodeGraphTsNode TargetBaseName(CodeGraphTsNode target)
    {
        if (target.Type == "WORD") return target;
        int count = target.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = target.NamedChild(i);
            if (child.IsNull) continue;
            CodeGraphTsNode found = TargetBaseName(child);
            if (!found.IsNull) return found;
        }
        return default;
    }

    // --- COPY / EXEC ---------------------------------------------------------

    private static void HandleCopy(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode book = node.ChildByField("book");
        if (book.IsNull) return;
        string name = StripQuotes(book.Text.Trim()).Trim();
        if (name.Length == 0) return;
        ctx.CreateNode(CodeGraphNodeKind.Import, name, node, new CodeGraphNodeExtra { Signature = Collapse(node.Text) });
        AddRef(ctx, CurrentScope(ctx), name, CodeGraphEdgeKind.Imports, node);
    }

    // Mine EXEC ... END-EXEC blocks for statically-resolvable shapes: CICS LINK/XCTL
    // to a program, CICS RETURN/START TRANSID, and SQL INCLUDE (a copybook import).
    private static void HandleExec(CodeGraphTsNode node, CodeGraphExtractorContext ctx, string? fromNodeId)
    {
        string text = node.Text;
        Match cics = ExecCicsProgramRegex.Match(text);
        if (cics.Success)
        {
            string? program = cics.Groups[1].Success ? cics.Groups[1].Value
                : (cics.Groups[2].Success ? DerefSameFileValue(cics.Groups[2].Value, ctx) : null);
            if (!string.IsNullOrEmpty(program)) AddRef(ctx, fromNodeId, program!, CodeGraphEdgeKind.Calls, node);
        }
        Match transid = ExecCicsTransidRegex.Match(text);
        if (transid.Success)
        {
            string? tx = transid.Groups[1].Success ? transid.Groups[1].Value
                : (transid.Groups[2].Success ? DerefSameFileValue(transid.Groups[2].Value, ctx) : null);
            if (!string.IsNullOrEmpty(tx) && TransidRegex.IsMatch(tx!))
                AddRef(ctx, fromNodeId, $"cics-transid:{tx!.ToUpperInvariant()}", CodeGraphEdgeKind.Calls, node);
        }
        Match include = ExecSqlIncludeRegex.Match(text);
        if (include.Success && include.Groups[1].Success)
        {
            ctx.CreateNode(CodeGraphNodeKind.Import, include.Groups[1].Value, node, new CodeGraphNodeExtra { Signature = Collapse(text) });
            AddRef(ctx, fromNodeId ?? CurrentScope(ctx), include.Groups[1].Value, CodeGraphEdgeKind.Imports, node);
        }
    }

    // Dereference a CICS option that names its target through a data item, against
    // the same file's already-extracted data items (DATA precedes PROCEDURE).
    private static string? DerefSameFileValue(string name, CodeGraphExtractorContext ctx)
    {
        string upper = name.ToUpperInvariant();
        foreach (CodeGraphNode node in ctx.Nodes)
        {
            if (node.FilePath != ctx.FilePath) continue;
            if (node.Kind != CodeGraphNodeKind.Variable && node.Kind != CodeGraphNodeKind.Field && node.Kind != CodeGraphNodeKind.Constant) continue;
            if (node.Name.ToUpperInvariant() != upper) continue;
            if (node.Signature == null) return null;
            Match value = ValueLiteralRegex.Match(node.Signature);
            return value.Success ? value.Groups[1].Value : null;
        }
        return null;
    }

    // --- helpers -------------------------------------------------------------

    // Program name from identification_division > program_name.
    private static string? ProgramName(CodeGraphTsNode programNode)
    {
        CodeGraphTsNode idDiv = FindNamedChildOfType(programNode, "identification_division");
        if (idDiv.IsNull) return null;
        CodeGraphTsNode nameNode = FindNamedChildOfType(idDiv, "program_name");
        if (nameNode.IsNull) return null;
        string name = nameNode.Text.Trim();
        name = StripQuotes(name);
        name = TrailingDotRegex.Replace(name, string.Empty);
        return name;
    }

    // "PARA-NAME." → "PARA-NAME"; "SEC-NAME SECTION." → "SEC-NAME".
    private static string HeaderName(CodeGraphTsNode header)
    {
        string text = header.Text.Trim();
        text = TrailingDotRegex.Replace(text, string.Empty).Trim();
        string[] parts = WhitespaceRegex.Split(text);
        return parts.Length > 0 && parts[0].Length > 0 ? parts[0] : text;
    }

    private static string Collapse(string text, int cap = 120)
    {
        string flat = WhitespaceRegex.Replace(text, " ").Trim();
        return flat.Length > cap ? flat.Substring(0, cap - 1) + "…" : flat;
    }

    private static string? CurrentScope(CodeGraphExtractorContext ctx) =>
        ctx.NodeStack.Count > 0 ? ctx.NodeStack[ctx.NodeStack.Count - 1] : null;

    private static void AddRef(CodeGraphExtractorContext ctx, string? fromNodeId, string referenceName, string referenceKind, CodeGraphTsNode at)
    {
        if (string.IsNullOrEmpty(fromNodeId) || string.IsNullOrEmpty(referenceName)) return;
        ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
            FromNodeId: fromNodeId!,
            ReferenceName: referenceName,
            ReferenceKind: referenceKind,
            Line: (int)at.StartPoint.Row + 1,
            Column: (int)at.StartPoint.Column,
            FilePath: ctx.FilePath,
            Language: null,
            Candidates: null,
            RowId: null));
    }

    private static List<CodeGraphTsNode> NamedChildren(CodeGraphTsNode node)
    {
        List<CodeGraphTsNode> result = new();
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull) result.Add(child);
        }
        return result;
    }

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

    private static string StripQuotes(string s)
    {
        if (s.Length >= 1 && (s[0] == '\'' || s[0] == '"')) s = s.Substring(1);
        if (s.Length >= 1 && (s[^1] == '\'' || s[^1] == '"')) s = s.Substring(0, s.Length - 1);
        return s;
    }

    private static readonly Regex ExecCicsProgramRegex =
        new(@"\b(?:LINK|XCTL)\b[\s\S]*?\bPROGRAM\s*\(\s*(?:['""]([A-Za-z0-9$#@-]+)['""]|([A-Za-z0-9-]+))\s*\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ExecCicsTransidRegex =
        new(@"\b(?:RETURN|START)\b[\s\S]*?\bTRANSID\s*\(\s*(?:['""]([A-Za-z0-9$#@]{1,4})['""]|([A-Za-z0-9-]+))\s*\)",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ExecSqlIncludeRegex =
        new(@"\bSQL\b[\s\S]*?\bINCLUDE\s+([A-Za-z0-9$#@-]+)", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex ValueLiteralRegex =
        new(@"\bVALUE\s+['""]([A-Za-z0-9$#@-]+)['""]", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex SpecialRegisterRegex =
        new(@"^(RETURN-CODE|SQLCODE|SQLSTATE|TALLY|EIB[A-Z-]+|DFH[A-Z-]+|WHEN-COMPILED|LENGTH|ADDRESS)$",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex TransidRegex = new(@"^[A-Za-z0-9$#@]{1,4}$", RegexOptions.Compiled);
    private static readonly Regex FillerRegex = new(@"^FILLER$", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex TrailingDotRegex = new(@"\.$", RegexOptions.Compiled);
    private static readonly Regex WhitespaceRegex = new(@"\s+", RegexOptions.Compiled);
}
