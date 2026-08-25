using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCfmlEmbeddedExtractor — the CFML (ColdFusion) dialect-switcher (port of
// extraction/cfml-extractor.ts). tree-sitter-cfml splits CFML into THREE related
// grammars: `cfml` (tag-based — <cfcomponent>/<cffunction>/HTML), `cfscript`
// (modern bare-script `component { … }`), and `cfquery` (`#hash#` call expressions
// inside a <cfquery> SQL body). This extractor replicates the grammar's own
// injections.scm re-parsing (which only fires at the editor layer, not in the raw
// AST):
//   * A file whose first real token isn't `<` is BARE-SCRIPT — delegated wholesale
//     to the cfscript grammar (the dominant modern style).
//   * Otherwise the file is TAG-BASED — walked tag-by-tag with the cfml grammar,
//     delegating each <cfscript> body to cfscript and each <cfquery> SQL body to
//     cfquery, with every delegated symbol's line positions offset back to full-file
//     coordinates (the CodeGraphSfcScriptRunner delegation pattern).
//
// Config lives in CodeGraphCfmlExtractor: Instance (cfscript) + CfQueryInstance.
//
// Grammar-degradation contract (analysis/01 §R6): the cfml/cfscript/cfquery grammars
// may be absent (they are not in the bootstrap set). A missing grammar disables just
// the affected path — a diagnostic is recorded and partial/empty results returned;
// this NEVER throws, so one unindexable CFML file never fails a whole run.
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed pattern.
// =============================================================================
internal sealed partial class CodeGraphCfmlEmbeddedExtractor
{
    private static readonly char[] SlashChars = { '/', '\\' };

    private readonly string filePath;
    private readonly string source;
    private readonly string fileLanguage; // the language tag stamped on emitted nodes/refs
    private readonly CodeGraphGrammarRegistry registry;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();

    private CodeGraphCfmlEmbeddedExtractor(
        string filePath, string content, string language, CodeGraphGrammarRegistry registry)
    {
        this.filePath = filePath;
        this.source = content;
        this.fileLanguage = language;
        this.registry = registry;
    }

    // `language` is the file's detected language — `cfml` for `.cfc`/`.cfm`,
    // `cfscript` for `.cfs`. Both dialect-switch internally; it only controls the
    // language tag stamped onto emitted nodes/refs.
    public static CodeGraphExtractionResult ExtractFromSource(
        string filePath, string content, string language, CodeGraphGrammarRegistry registry) =>
        new CodeGraphCfmlEmbeddedExtractor(filePath, content, language, registry).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            if (IsBareScriptCfml(source))
            {
                ExtractBareScript();
            }
            else
            {
                ExtractTagBased();
            }
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"CFML extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    // ── Bare-script path: delegate the whole file to the cfscript grammar ─────────
    private void ExtractBareScript()
    {
        CodeGraphExtractionResult? result = DelegateParse(source, CodeGraphLanguage.CfScript, CodeGraphCfmlExtractor.Instance);
        if (result is null)
        {
            errors.Add(new CodeGraphExtractionError(
                "cfscript grammar not loaded, cannot parse bare-script CFML",
                "warning", filePath, null, null, "grammar_unavailable"));
            return;
        }

        // cfscript's `component`/`interface` node has no `name` field — a CFC's
        // component name is always implicit from its file name, never declared in
        // source — so the generic engine names it '<anonymous>'. Recover the name
        // from the path and carry it into member scope chains.
        string componentName = ComponentNameFromPath();
        const string anon = "<anonymous>";

        foreach (CodeGraphNode node in result.Nodes)
        {
            CodeGraphNode restamped = node with { Language = fileLanguage };

            if (node.Name == anon &&
                node.Kind is CodeGraphNodeKind.Class or CodeGraphNodeKind.Interface)
            {
                restamped = restamped with
                {
                    Name = componentName,
                    QualifiedName = $"{filePath}::{componentName}"
                };
            }
            else if (node.QualifiedName == anon ||
                     node.QualifiedName.StartsWith(anon + "::", StringComparison.Ordinal))
            {
                // Members scoped under the anonymous component (`<anonymous>::save`)
                // — carry the rename into their scope chains so type-validated method
                // resolution (which wants `UserService::save`) can match them.
                restamped = restamped with
                {
                    QualifiedName = componentName + node.QualifiedName[anon.Length..]
                };
            }

            nodes.Add(restamped);
        }

        edges.AddRange(result.Edges);
        foreach (CodeGraphUnresolvedReference r in result.UnresolvedReferences)
        {
            unresolvedReferences.Add(r with { Language = fileLanguage });
        }
        errors.AddRange(result.Errors);
    }

    // ── Tag-based path: walk the cfml grammar, delegating script/query bodies ─────
    private void ExtractTagBased()
    {
        nint? handle = registry.GetLanguage(CodeGraphLanguage.Cfml);
        if (handle is not { } grammar || grammar == 0)
        {
            errors.Add(new CodeGraphExtractionError(
                "cfml grammar not loaded", "error", filePath, null, null, "unsupported_language"));
            return;
        }

        CodeGraphSourceText src;
        CodeGraphTsTree tree;
        CodeGraphTsParser parser = new();
        try
        {
            src = CodeGraphSourceText.FromUtf8(Encoding.UTF8.GetBytes(source));
            parser.SetLanguage(grammar);
            tree = parser.Parse(src);
        }
        catch (Exception ex)
        {
            parser.Dispose();
            errors.Add(new CodeGraphExtractionError(
                $"Failed to parse CFML source: {ex.Message}", "error", filePath, null, null, "parse_error"));
            return;
        }

        using (parser)
        using (tree)
        {
            CodeGraphNode fileNode = CreateFileNode();
            nodes.Add(fileNode);
            WalkProgram(tree.RootNode, fileNode.Id);
        }
    }

    // Build the file's own `kind:'file'` node, spanning the whole source. Tag-based
    // files need this explicitly — unlike ExtractBareScript (which inherits the
    // delegated engine's file node), ExtractTagBased walks the tree itself.
    private CodeGraphNode CreateFileNode()
    {
        string[] lines = source.Split('\n');
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.File, filePath, 1);
        return new CodeGraphNode(
            Id: id,
            Kind: CodeGraphNodeKind.File,
            Name: BaseName(filePath),
            QualifiedName: filePath,
            FilePath: filePath,
            Language: fileLanguage,
            StartLine: 1,
            EndLine: lines.Length,
            StartColumn: 0,
            EndColumn: lines.Length > 0 ? lines[^1].Length : 0,
            Docstring: null,
            Signature: null,
            Visibility: null,
            IsExported: false,
            IsAsync: false,
            IsStatic: false,
            IsAbstract: false,
            Decorators: null,
            TypeParameters: null,
            ReturnType: null,
            UpdatedAt: CodeGraphSfcScriptRunner.Now());
    }

    // Walk `program`'s named children with a single forward cursor (not an index
    // loop) — ExtractComponent consumes a variable run of FOLLOWING siblings as the
    // component body (the grammar's implicit-end-tag scanner flattens the body into
    // siblings of the open tag), so this must resume from whatever it last consumed
    // rather than revisiting those cffunction/cfscript siblings as top-level symbols.
    private void WalkProgram(CodeGraphTsNode root, string fileNodeId)
    {
        CodeGraphTsNode child = root.NamedChild(0);
        while (!child.IsNull)
        {
            if (child.Type == "cf_component_open_tag")
            {
                child = ExtractComponent(child, fileNodeId).NextNamedSibling;
                continue;
            }

            if (child.Type == "cf_function_tag")
            {
                // A cffunction outside any cfcomponent wrapper (rare, legal in a .cfm
                // template) — a top-level function, contained by the file node.
                ExtractFunctionTag(child, null, fileNodeId, null);
            }
            else if (child.Type == "cf_script_tag")
            {
                DelegateScriptTag(child, fileNodeId, null);
            }
            else if (child.Type == "cf_query_tag")
            {
                DelegateQueryTag(child, fileNodeId);
            }
            else
            {
                DelegateNestedTags(child, fileNodeId, null);
            }

            child = child.NextNamedSibling;
        }
    }

    // `<cfcomponent extends="Base" implements="IFoo,IBar">...</cfcomponent>`. The
    // grammar's implicit-end-tag scanner means component body content appears as the
    // open tag's FOLLOWING siblings in `program`, not nested children — walk forward
    // to the matching cf_component_close_tag. Returns the last consumed node.
    private CodeGraphTsNode ExtractComponent(CodeGraphTsNode openTag, string? containerId)
    {
        string name = TagAttr(openTag, "name") ?? ComponentNameFromPath();
        int startLine = (int)openTag.StartPoint.Row + 1;
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Class, name, startLine);

        // Reserve the class node slot BEFORE the body walk (members reference `id`);
        // its endLine is patched in once the close tag is found.
        int classIndex = nodes.Count;
        nodes.Add(BuildClassNode(id, name, startLine, startLine, openTag));

        if (containerId != null)
        {
            edges.Add(new CodeGraphEdge(containerId, id, CodeGraphEdgeKind.Contains, null, null, null, null));
        }

        string? extendsName = TagAttr(openTag, "extends");
        if (!string.IsNullOrEmpty(extendsName))
        {
            PushTagRef(id, extendsName!, CodeGraphEdgeKind.Extends, openTag);
        }

        string? implementsAttr = TagAttr(openTag, "implements");
        if (!string.IsNullOrEmpty(implementsAttr))
        {
            foreach (string iface in implementsAttr!.Split(','))
            {
                string trimmed = iface.Trim();
                if (trimmed.Length > 0) PushTagRef(id, trimmed, CodeGraphEdgeKind.Implements, openTag);
            }
        }

        // Walk siblings between the open tag and its close tag.
        CodeGraphTsNode sibling = openTag.NextNamedSibling;
        CodeGraphTsNode lastNode = openTag;
        while (!sibling.IsNull)
        {
            if (sibling.Type == "cf_component_close_tag")
            {
                lastNode = sibling;
                break;
            }

            if (sibling.Type == "cf_function_tag")
            {
                ExtractFunctionTag(sibling, id, id, name);
            }
            else if (sibling.Type == "cf_script_tag")
            {
                DelegateScriptTag(sibling, id, name);
            }
            else if (sibling.Type == "cf_query_tag")
            {
                DelegateQueryTag(sibling, id);
            }
            else
            {
                DelegateNestedTags(sibling, id, name);
            }

            lastNode = sibling;
            sibling = sibling.NextNamedSibling;
        }

        int endLine = (int)lastNode.EndPoint.Row + 1;
        nodes[classIndex] = nodes[classIndex] with { EndLine = endLine };
        return lastNode;
    }

    private CodeGraphNode BuildClassNode(string id, string name, int startLine, int endLine, CodeGraphTsNode openTag) =>
        new(
            Id: id,
            Kind: CodeGraphNodeKind.Class,
            Name: name,
            QualifiedName: $"{filePath}::{name}",
            FilePath: filePath,
            Language: fileLanguage,
            StartLine: startLine,
            EndLine: endLine,
            StartColumn: (int)openTag.StartPoint.Column,
            EndColumn: (int)openTag.EndPoint.Column,
            Docstring: null,
            Signature: null,
            Visibility: null,
            IsExported: true,
            IsAsync: false,
            IsStatic: false,
            IsAbstract: false,
            Decorators: null,
            TypeParameters: null,
            ReturnType: null,
            UpdatedAt: CodeGraphSfcScriptRunner.Now());

    // `<cffunction name="..." access="..." returntype="...">...</cffunction>`.
    // `parentClassId` decides `method` vs top-level `function`; `containerId` is the
    // `contains`-edge target (the class when inside one, else the file node). A
    // method's qualifiedName is scoped under `parentClassName` (`TagService::save`)
    // so type-validated method resolution can match.
    private void ExtractFunctionTag(
        CodeGraphTsNode tag, string? parentClassId, string? containerId, string? parentClassName)
    {
        string? name = TagAttr(tag, "name");
        if (string.IsNullOrEmpty(name)) return;

        string kind = parentClassId != null ? CodeGraphNodeKind.Method : CodeGraphNodeKind.Function;
        int startLine = (int)tag.StartPoint.Row + 1;
        string id = CodeGraphNodeIdFactory.NodeId(filePath, kind, name!, startLine);

        string? access = TagAttr(tag, "access");
        string? visibility =
            access == "private" ? CodeGraphVisibility.Private
            : access == "package" ? CodeGraphVisibility.Internal
            : !string.IsNullOrEmpty(access) ? CodeGraphVisibility.Public
            : null;

        string? returnType = TagAttr(tag, "returntype");

        nodes.Add(new CodeGraphNode(
            Id: id,
            Kind: kind,
            Name: name!,
            QualifiedName: parentClassName != null ? $"{parentClassName}::{name}" : $"{filePath}::{name}",
            FilePath: filePath,
            Language: fileLanguage,
            StartLine: startLine,
            EndLine: (int)tag.EndPoint.Row + 1,
            StartColumn: (int)tag.StartPoint.Column,
            EndColumn: (int)tag.EndPoint.Column,
            Docstring: null,
            Signature: null,
            Visibility: visibility,
            IsExported: false,
            IsAsync: false,
            IsStatic: false,
            IsAbstract: false,
            Decorators: null,
            TypeParameters: null,
            ReturnType: string.IsNullOrEmpty(returnType) ? null : returnType,
            UpdatedAt: CodeGraphSfcScriptRunner.Now()));

        if (containerId != null)
        {
            edges.Add(new CodeGraphEdge(containerId, id, CodeGraphEdgeKind.Contains, null, null, null, null));
        }

        // Delegate any <cfscript>/<cfquery> bodies nested inside this function, at any
        // depth (e.g. inside <cfif>/<cfloop>/<cftry> control-flow tags).
        DelegateNestedTags(tag, id, null);
    }

    // Recursively delegate any cf_script_tag/cf_query_tag within `node`'s subtree —
    // a <cfscript>/<cfquery> nested inside <cfif>/<cfloop>/<cftry> (which — unlike a
    // <cfcomponent> body — ARE normal children, just possibly several levels deep).
    // Does NOT descend into a nested cf_function_tag (its own scope, walked separately).
    private void DelegateNestedTags(CodeGraphTsNode node, string? containerId, string? parentClassName)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;

            if (child.Type == "cf_script_tag")
            {
                DelegateScriptTag(child, containerId, parentClassName);
            }
            else if (child.Type == "cf_query_tag")
            {
                DelegateQueryTag(child, containerId);
            }
            else if (child.Type == "cf_function_tag")
            {
                continue;
            }
            else
            {
                DelegateNestedTags(child, containerId, parentClassName);
            }
        }
    }

    // Delegate a <cfscript>...</cfscript> body to the cfscript grammar. With
    // `parentClassName` set (block at component scope), top-level script functions are
    // the component's methods — re-kinded function → method, and every merged symbol's
    // qualifiedName is prefixed with the component scope. Closures (nested functions)
    // keep kind `function`.
    private void DelegateScriptTag(CodeGraphTsNode scriptTag, string? parentId, string? parentClassName)
    {
        CodeGraphTsNode content = FindNamedChildOfType(scriptTag, "cf_script_content");
        if (content.IsNull) return;

        string inner = content.Text;
        int startLine = (int)content.StartPoint.Row; // 0-indexed row of the content start

        CodeGraphExtractionResult? result = DelegateParse(inner, CodeGraphLanguage.CfScript, CodeGraphCfmlExtractor.Instance);
        if (result is null)
        {
            errors.Add(new CodeGraphExtractionError(
                "cfscript grammar not loaded, cannot parse <cfscript> block",
                "warning", filePath, null, null, "grammar_unavailable"));
            return;
        }

        // The inner engine always synthesizes its own `file`-kind node scoped to the
        // snippet — drop it (and edges touching it); this tag-based file already owns a
        // correctly-ranged file node.
        string? innerFileNodeId = FindFileNodeId(result.Nodes);
        // Snippet top-level symbols are those the inner engine attached directly to its
        // (dropped) snippet file node — vs closures nested inside another function.
        HashSet<string> topLevelIds = new(StringComparer.Ordinal);
        foreach (CodeGraphEdge e in result.Edges)
        {
            if (e.Kind == CodeGraphEdgeKind.Contains && e.Source == innerFileNodeId)
            {
                topLevelIds.Add(e.Target);
            }
        }

        foreach (CodeGraphNode node in result.Nodes)
        {
            if (node.Kind == CodeGraphNodeKind.File) continue;

            CodeGraphNode shifted = node with
            {
                StartLine = node.StartLine + startLine,
                EndLine = node.EndLine + startLine,
                Language = fileLanguage
            };

            if (parentClassName != null)
            {
                string newKind = shifted.Kind == CodeGraphNodeKind.Function && topLevelIds.Contains(node.Id)
                    ? CodeGraphNodeKind.Method
                    : shifted.Kind;
                shifted = shifted with
                {
                    Kind = newKind,
                    QualifiedName = $"{parentClassName}::{shifted.QualifiedName}"
                };
            }

            nodes.Add(shifted);
            if (parentId != null)
            {
                edges.Add(new CodeGraphEdge(parentId, shifted.Id, CodeGraphEdgeKind.Contains, null, null, null, null));
            }
        }

        foreach (CodeGraphEdge edge in result.Edges)
        {
            if (edge.Source == innerFileNodeId || edge.Target == innerFileNodeId) continue;
            edges.Add(edge.Line is int line ? edge with { Line = line + startLine } : edge);
        }

        foreach (CodeGraphUnresolvedReference r in result.UnresolvedReferences)
        {
            // Calls inside a <cfscript> body with no enclosing function attribute to the
            // filtered-out snippet file node by default — redirect those to parentId.
            string fromNodeId = r.FromNodeId;
            if ((string.IsNullOrEmpty(fromNodeId) || fromNodeId == innerFileNodeId) && parentId != null)
            {
                fromNodeId = parentId;
            }

            unresolvedReferences.Add(r with
            {
                FromNodeId = fromNodeId,
                Line = r.Line + startLine,
                FilePath = filePath,
                Language = fileLanguage
            });
        }

        foreach (CodeGraphExtractionError error in result.Errors)
        {
            errors.Add(error.Line is int line ? error with { Line = line + startLine } : error);
        }
    }

    // Delegate a <cfquery>...</cfquery> SQL body to the cfquery grammar. `#hash#`
    // expressions inside the SQL are real CFML call/reference expressions (parsed
    // structurally by the cfquery grammar); without this they're dropped as opaque SQL
    // text. The grammar models no other symbols — only call/reference refs to merge.
    private void DelegateQueryTag(CodeGraphTsNode queryTag, string? parentId)
    {
        CodeGraphTsNode content = FindNamedChildOfType(queryTag, "cf_query_content");
        if (content.IsNull) return;

        string sql = content.Text;
        int startLine = (int)content.StartPoint.Row;

        CodeGraphExtractionResult? result = DelegateParse(sql, CodeGraphLanguage.CfQuery, CodeGraphCfmlExtractor.CfQueryInstance);
        if (result is null)
        {
            errors.Add(new CodeGraphExtractionError(
                "cfquery grammar not loaded, cannot parse <cfquery> block",
                "warning", filePath, null, null, "grammar_unavailable"));
            return;
        }

        string? innerFileNodeId = FindFileNodeId(result.Nodes);
        foreach (CodeGraphUnresolvedReference r in result.UnresolvedReferences)
        {
            string fromNodeId = r.FromNodeId;
            if ((string.IsNullOrEmpty(fromNodeId) || fromNodeId == innerFileNodeId) && parentId != null)
            {
                fromNodeId = parentId;
            }

            unresolvedReferences.Add(r with
            {
                FromNodeId = fromNodeId,
                Line = r.Line + startLine,
                FilePath = filePath,
                Language = fileLanguage
            });
        }

        foreach (CodeGraphExtractionError error in result.Errors)
        {
            errors.Add(error.Line is int line ? error with { Line = line + startLine } : error);
        }
    }

    // Parse a snippet with a delegated grammar+config. Returns null when the grammar
    // lib is absent / ABI-unsupported / the parse throws — the caller degrades to a
    // diagnostic (never throws), matching the whole-run resilience contract.
    private CodeGraphExtractionResult? DelegateParse(
        string snippet, string grammarLanguage, ICodeGraphLanguageExtractor config)
    {
        nint? handle = registry.GetLanguage(grammarLanguage);
        if (handle is not { } grammar || grammar == 0) return null;

        try
        {
            CodeGraphSourceText src = CodeGraphSourceText.FromUtf8(Encoding.UTF8.GetBytes(snippet));
            using CodeGraphTsParser parser = new();
            parser.SetLanguage(grammar);
            using CodeGraphTsTree tree = parser.Parse(src);
            CodeGraphTreeSitterExtractor engine = new(filePath, grammarLanguage, config, src);
            return engine.Extract(tree);
        }
        catch
        {
            return null; // grammar unavailable / parse fault — degrade in the caller
        }
    }

    // Read a cf_attribute's value by name from a tag node's direct cf_attribute /
    // cf_tag_attributes children. Returns null when the attribute is absent, "" when
    // present but valueless. Case-insensitive attribute-name match.
    private static string? TagAttr(CodeGraphTsNode tag, string attrName)
    {
        int count = tag.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = tag.NamedChild(i);
            if (child.IsNull) continue;

            if (child.Type == "cf_attribute")
            {
                string? v = MatchAttr(child, attrName);
                if (v != null) return v;
            }
            else if (child.Type == "cf_tag_attributes")
            {
                int inner = child.NamedChildCount;
                for (int j = 0; j < inner; j++)
                {
                    CodeGraphTsNode attr = child.NamedChild(j);
                    if (attr.Type != "cf_attribute") continue;
                    string? v = MatchAttr(attr, attrName);
                    if (v != null) return v;
                }
            }
        }

        return null;
    }

    // A single cf_attribute — return its value when the name matches, else null.
    private static string? MatchAttr(CodeGraphTsNode attr, string attrName)
    {
        CodeGraphTsNode nameNode = FindNamedChildOfType(attr, "cf_attribute_name");
        if (nameNode.IsNull) return null;
        if (!string.Equals(nameNode.Text, attrName, StringComparison.OrdinalIgnoreCase)) return null;

        // Values come wrapped as quoted_cf_attribute_value (name="init") or bare
        // cf_attribute_value (name=init — legal and common in older CFML).
        CodeGraphTsNode wrapper = default;
        int count = attr.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = attr.NamedChild(i);
            if (c.Type is "quoted_cf_attribute_value" or "cf_attribute_value") { wrapper = c; break; }
        }
        if (wrapper.IsNull) return string.Empty;

        CodeGraphTsNode valueNode = FindNamedChildOfType(wrapper, "attribute_value");
        return valueNode.IsNull ? string.Empty : valueNode.Text;
    }

    private void PushTagRef(string fromNodeId, string referenceName, string referenceKind, CodeGraphTsNode posNode) =>
        unresolvedReferences.Add(new CodeGraphUnresolvedReference(
            FromNodeId: fromNodeId,
            ReferenceName: referenceName,
            ReferenceKind: referenceKind,
            Line: (int)posNode.StartPoint.Row + 1,
            Column: (int)posNode.StartPoint.Column,
            FilePath: filePath,
            Language: fileLanguage,
            Candidates: null,
            RowId: null));

    private static string? FindFileNodeId(List<CodeGraphNode> nodes)
    {
        foreach (CodeGraphNode n in nodes)
        {
            if (n.Kind == CodeGraphNodeKind.File) return n.Id;
        }
        return null;
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

    private string ComponentNameFromPath() =>
        CfmlExtRegex().Replace(BaseName(filePath), string.Empty);

    private static string BaseName(string path)
    {
        int slash = path.LastIndexOfAny(SlashChars);
        return slash >= 0 && slash + 1 <= path.Length ? path[(slash + 1)..] : path;
    }

    // Sniff whether CFML source is bare-script (`component { … }`, modern) vs
    // tag-based (`<cfcomponent>`, `<cfif>`, HTML). Skips a leading UTF-8 BOM (endemic
    // in CFML's Windows-editor history), whitespace, and `//` / block comments to find
    // the first real token; tag-based files start with `<`, script-based files don't.
    // PUBLIC + static so the region-splitting logic is unit-testable without a grammar.
    internal static bool IsBareScriptCfml(string source)
    {
        int i = 0;
        int len = source.Length;
        while (i < len)
        {
            char ch = source[i];
            if (ch is ' ' or '\t' or '\n' or '\r' or '\uFEFF')
            {
                i++;
            }
            else if (ch == '/' && i + 1 < len && source[i + 1] == '/')
            {
                int nl = source.IndexOf('\n', i);
                i = nl == -1 ? len : nl + 1;
            }
            else if (ch == '/' && i + 1 < len && source[i + 1] == '*')
            {
                int end = source.IndexOf("*/", i + 2, StringComparison.Ordinal);
                i = end == -1 ? len : end + 2;
            }
            else
            {
                return ch != '<';
            }
        }

        return true; // empty / whitespace-only — treat as script (no-op either way)
    }

    // Strip a trailing CFML extension from the file's base name (`.cfc`/`.cfm`/`.cfs`).
    [GeneratedRegex(@"\.(cfc|cfm|cfs)$", RegexOptions.IgnoreCase)]
    private static partial Regex CfmlExtRegex();
}
