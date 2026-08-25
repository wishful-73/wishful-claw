using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRazorExtractor — bespoke embedded extractor for ASP.NET Razor (`.cshtml`)
// and Blazor (`.razor`) markup (port of extraction/razor-extractor.ts). There is a
// tree-sitter-razor grammar, but — exactly like the SFC extractors (Svelte/Vue/Astro)
// — the useful signal is the C# a component NAMES, so this carves the markup by regex
// and delegates the embedded C# to the C# tree-sitter engine (CodeGraphSfcScriptRunner
// pattern), keeping only the external references so markup-only dependencies (view
// models, DTOs, services, components) stop looking unreferenced.
//
// Emits: ONE `component` node per file, plus by-name `references`:
//   @model Foo / @inherits Bar<Foo>   → the view-model / base type
//   @inject IService svc               → the injected service type
//   @typeof(X)                         → the referenced type
//   <MyComponent .../> (.razor only)   → the component class (+ generic `TItem="X"` args)
//   @code { } / @functions { } / @{ }  → C# delegated to the C# engine (refs only)
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphRazorExtractor
{
    // Blazor framework-provided components — invoked by the runtime, not defined
    // in-repo, so a reference to them would never resolve. Skip to avoid dangling refs.
    private static readonly HashSet<string> BlazorBuiltins = new(StringComparer.Ordinal)
    {
        "Router", "Found", "NotFound", "RouteView", "AuthorizeRouteView", "LayoutView",
        "CascadingValue", "CascadingAuthenticationState", "AuthorizeView", "Authorized",
        "NotAuthorized", "Authorizing", "EditForm", "DataAnnotationsValidator",
        "ValidationSummary", "ValidationMessage", "InputText", "InputNumber",
        "InputCheckbox", "InputSelect", "InputDate", "InputTextArea", "InputRadio",
        "InputRadioGroup", "InputFile", "PageTitle", "HeadContent", "HeadOutlet",
        "Virtualize", "DynamicComponent", "ErrorBoundary", "SectionContent",
        "SectionOutlet", "FocusOnNavigate", "NavLink", "Microsoft"
    };

    private readonly string filePath;
    private readonly string source;
    private readonly CodeGraphGrammarRegistry registry;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();

    private CodeGraphRazorExtractor(string filePath, string content, CodeGraphGrammarRegistry registry)
    {
        this.filePath = filePath;
        this.source = content;
        this.registry = registry;
    }

    public static CodeGraphExtractionResult ExtractFromSource(
        string filePath, string content, CodeGraphGrammarRegistry registry) =>
        new CodeGraphRazorExtractor(filePath, content, registry).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        try
        {
            CodeGraphNode component = CreateComponentNode();
            nodes.Add(component);

            ExtractDirectives(component.Id);
            // Blazor component tags only — `.cshtml` uses HTML + tag helpers, not
            // PascalCase component elements.
            if (filePath.EndsWith(".razor", StringComparison.OrdinalIgnoreCase))
            {
                ExtractComponentTags(component.Id);
            }

            // Delegate the C# in `@code { }` / `@functions { }` / `@{ }` blocks to the
            // C# tree-sitter engine (the Blazor analog of Svelte's <script> block).
            ProcessCodeBlocks(component.Id);
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"Razor extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    private CodeGraphNode CreateComponentNode()
    {
        string[] lines = source.Split('\n');
        string fileName = BaseName(filePath);
        string componentName = RazorExtRegex().Replace(fileName, string.Empty);
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Component, componentName, 1);
        int endColumn = lines.Length > 0 ? lines[^1].Length : 0;

        return new CodeGraphNode(
            Id: id,
            Kind: CodeGraphNodeKind.Component,
            Name: componentName,
            QualifiedName: $"{filePath}::{componentName}",
            FilePath: filePath,
            Language: CodeGraphLanguage.Razor,
            StartLine: 1,
            EndLine: lines.Length,
            StartColumn: 0,
            EndColumn: endColumn,
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
    }

    // Last `.`-segment (`App.ViewModels.RegisterModel` → `RegisterModel`).
    private static string LastSegment(string s)
    {
        int i = s.LastIndexOf('.');
        return i >= 0 ? s[(i + 1)..] : s;
    }

    // Split a type expression into the capitalized type names it contains — base type
    // plus any generic arguments (`Bar<Foo, Baz>` → Bar, Foo, Baz), each reduced to its
    // last namespace segment. Lowercase/keyword tokens drop out.
    private static IEnumerable<string> TypeNames(string expr)
    {
        foreach (string raw in TypeSplitRegex().Split(expr))
        {
            string seg = LastSegment(raw.Trim());
            if (PascalRegex().IsMatch(seg)) yield return seg;
        }
    }

    private void PushRef(string componentId, string name, int line, int column) =>
        unresolvedReferences.Add(new CodeGraphUnresolvedReference(
            componentId, name, CodeGraphEdgeKind.References, line, column,
            filePath, CodeGraphLanguage.Razor, null, null));

    private void ExtractDirectives(string componentId)
    {
        string[] lines = source.Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i];

            // `@model Foo` / `@inherits Bar<Foo>` — directive followed by a type.
            Match dir = ModelInheritsRegex().Match(line);
            if (dir.Success)
            {
                foreach (string t in TypeNames(dir.Groups[1].Value)) PushRef(componentId, t, i + 1, 0);
            }

            // `@inject IService name` — the type is the first token, a name follows.
            Match inj = InjectRegex().Match(line);
            if (inj.Success)
            {
                foreach (string t in TypeNames(inj.Groups[1].Value)) PushRef(componentId, t, i + 1, 0);
            }

            // `@typeof(X)` anywhere on the line.
            foreach (Match m in TypeofRegex().Matches(line))
            {
                string seg = LastSegment(m.Groups[1].Value);
                if (seg.Length > 0 && char.IsUpper(seg[0])) PushRef(componentId, seg, i + 1, m.Index);
            }
        }
    }

    private void ExtractComponentTags(string componentId)
    {
        string[] lines = source.Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i];
            foreach (Match m in ComponentTagRegex().Matches(line))
            {
                string name = m.Groups[1].Value;
                if (BlazorBuiltins.Contains(name)) continue;
                PushRef(componentId, name, i + 1, m.Index + 1);
                // Generic component type arg: `<Grid TItem="CatalogItem">`.
                foreach (Match t in GenericArgRegex().Matches(m.Groups[2].Value))
                {
                    string seg = LastSegment(t.Groups[1].Value);
                    if (seg.Length > 0 && char.IsUpper(seg[0])) PushRef(componentId, seg, i + 1, 0);
                }
            }
        }
    }

    // Find the matching `}` for the `{` at openIdx, skipping string literals and
    // comments so a brace inside `"{"` / `// }` doesn't throw off the count. Returns
    // the index of the closing brace, or -1 if unbalanced.
    private static int MatchBrace(string src, int openIdx)
    {
        int depth = 0;
        for (int i = openIdx; i < src.Length; i++)
        {
            char ch = src[i];
            if (ch == '"' || ch == '\'')
            {
                char quote = ch;
                i++;
                while (i < src.Length && src[i] != quote)
                {
                    if (src[i] == '\\') i++;
                    i++;
                }
                continue;
            }
            if (ch == '/' && i + 1 < src.Length && src[i + 1] == '/')
            {
                while (i < src.Length && src[i] != '\n') i++;
                continue;
            }
            if (ch == '/' && i + 1 < src.Length && src[i + 1] == '*')
            {
                i += 2;
                while (i < src.Length && !(src[i] == '*' && i + 1 < src.Length && src[i + 1] == '/')) i++;
                i++;
                continue;
            }
            if (ch == '{') depth++;
            else if (ch == '}')
            {
                depth--;
                if (depth == 0) return i;
            }
        }
        return -1;
    }

    private readonly record struct CodeBlock(string Content, int LineOffset);

    // `@code { … }` / `@functions { … }` (Blazor) and `@{ … }` (Razor) C# blocks.
    private List<CodeBlock> ExtractCodeBlocks()
    {
        var blocks = new List<CodeBlock>();
        foreach (Match m in CodeBlockStartRegex().Matches(source))
        {
            int openIdx = source.IndexOf('{', m.Index);
            if (openIdx < 0) continue;
            int close = MatchBrace(source, openIdx);
            if (close < 0) continue;
            string content = source[(openIdx + 1)..close];
            // newlines before the content's first char → 0-indexed line of content start.
            int lineOffset = CodeGraphSfcScriptRunner.CountNewlines(source, openIdx + 1);
            blocks.Add(new CodeBlock(content, lineOffset));
        }
        return blocks;
    }

    // Delegate each block's C# to the C# tree-sitter engine and attribute the block's
    // external references (service/DTO calls, `new X()`, type uses) to the component.
    // The block is wrapped in a synthetic class so tree-sitter parses fields/methods in
    // a class context (a Blazor `@code` body compiles into the component's partial
    // class). Only the dependency references are kept. Degrades gracefully if the C#
    // grammar isn't loaded.
    private void ProcessCodeBlocks(string componentId)
    {
        nint? handle = registry.GetLanguage(CodeGraphLanguage.CSharp);
        if (handle is not { } grammar || grammar == 0) return;

        foreach (CodeBlock block in ExtractCodeBlocks())
        {
            if (string.IsNullOrWhiteSpace(block.Content)) continue;

            CodeGraphExtractionResult result;
            try
            {
                string wrapped = $"class __RazorCode__ {{\n{block.Content}\n}}";
                CodeGraphSourceText src = CodeGraphSourceText.FromUtf8(Encoding.UTF8.GetBytes(wrapped));
                using CodeGraphTsParser parser = new();
                parser.SetLanguage(grammar);
                using CodeGraphTsTree tree = parser.Parse(src);
                CodeGraphTreeSitterExtractor engine = new(
                    filePath, CodeGraphLanguage.CSharp, CodeGraphCSharpExtractor.Instance, src);
                result = engine.Extract(tree);
            }
            catch
            {
                continue; // grammar not loaded / parse failure — skip this block
            }

            // The synthetic wrapper adds one line before the block content; map ref
            // lines back to the file (display only — coverage is line-agnostic).
            foreach (CodeGraphUnresolvedReference r in result.UnresolvedReferences)
            {
                unresolvedReferences.Add(r with
                {
                    FromNodeId = componentId,
                    Line = r.Line + block.LineOffset - 1,
                    FilePath = filePath,
                    Language = CodeGraphLanguage.Razor
                });
            }
        }
    }

    private static readonly char[] SlashChars = { '/', '\\' };

    private static string BaseName(string path)
    {
        int slash = path.LastIndexOfAny(SlashChars);
        return slash >= 0 && slash + 1 <= path.Length ? path[(slash + 1)..] : path;
    }

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from razor-extractor.ts ──────
    [GeneratedRegex(@"\.(razor|cshtml)$", RegexOptions.IgnoreCase)]
    private static partial Regex RazorExtRegex();

    [GeneratedRegex(@"^\s*@(?:model|inherits)\s+([A-Za-z_][\w.]*(?:\s*<[^>]+>)?)")]
    private static partial Regex ModelInheritsRegex();

    [GeneratedRegex(@"^\s*@inject\s+([A-Za-z_][\w.]*(?:\s*<[^>]+>)?)\s+[A-Za-z_]")]
    private static partial Regex InjectRegex();

    [GeneratedRegex(@"@typeof\(\s*([A-Za-z_][\w.]*)\s*\)")]
    private static partial Regex TypeofRegex();

    [GeneratedRegex(@"<([A-Z][A-Za-z0-9_]*)\b([^>]*)>")]
    private static partial Regex ComponentTagRegex();

    [GeneratedRegex(@"\bT[A-Za-z]*\s*=\s*""([A-Za-z_][\w.]*)""")]
    private static partial Regex GenericArgRegex();

    [GeneratedRegex(@"[<>,\s]+")]
    private static partial Regex TypeSplitRegex();

    [GeneratedRegex(@"^[A-Z][A-Za-z0-9_]*$")]
    private static partial Regex PascalRegex();

    [GeneratedRegex(@"@(?:code|functions)\b\s*\{|@\{")]
    private static partial Regex CodeBlockStartRegex();
}
