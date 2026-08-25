using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphTerraformResolver — Terraform framework resolver (port of
// frameworks/terraform.ts). Enforces Terraform's directory-shaped scoping: `var.X`,
// `local.X`, `module.M`, resource/data refs resolve ONLY inside the reference site's own
// module directory (highest confidence), with `.tfvars` var-assignments walking UP to the
// nearest ancestor declaring the variable and `provider.*` inheriting across the module
// tree. It also bridges the module boundary through extractor-emitted `:`-scoped refs
// (`module.M:file` / `:var.X` / `:output.X` / `:remote-output.X`) by re-reading the
// module block's `source` from its file span.
//
// Regex/path scans use CodeGraphPosixPath (never System.IO.Path). Global namespace,
// all-internal, reflection-free/AOT; fixed patterns via [GeneratedRegex].
// =============================================================================
internal sealed partial class CodeGraphTerraformResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] TerraformLanguages = { CodeGraphLanguage.Terraform };

    public string Name => "terraform";

    public IReadOnlyList<string>? Languages => TerraformLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".tf", StringComparison.Ordinal) ||
                f.EndsWith(".tfvars", StringComparison.Ordinal) ||
                f.EndsWith(".tofu", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    // Scoped refs name no declared symbol; opt them through the name-exists pre-filter.
    public bool ClaimsReference(string name) => ScopedRefGuardRegex().IsMatch(name);

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        if (r.Language != CodeGraphLanguage.Terraform)
        {
            return null;
        }

        var qname = r.ReferenceName;
        var refDir = DirOf(r.FilePath ?? string.Empty);

        // module-boundary bridge: module.M:file / module.M:var.X / module.M:output.X.
        var scoped = ScopedRefRegex().Match(qname);
        if (scoped.Success)
        {
            return ResolveScopedModuleRef(r, scoped.Groups[1].Value, scoped.Groups[2].Value, refDir, ctx);
        }

        var candidates = ctx.GetNodesByQualifiedName(qname);
        if (candidates.Count == 0)
        {
            return null;
        }

        // 1. Same directory — the only scope Terraform can actually reference.
        foreach (var c in candidates)
        {
            if (DirOf(c.FilePath) == refDir)
            {
                return new CodeGraphResolvedRef(c.Id, 0.95, CodeGraphResolvedBy.Framework);
            }
        }

        // 2. `.tfvars` assignments set ROOT module variables from a subdirectory — walk up.
        if ((r.FilePath?.EndsWith(".tfvars", StringComparison.Ordinal) ?? false) &&
            qname.StartsWith("var.", StringComparison.Ordinal))
        {
            var up = NearestAncestorMatch(candidates, refDir);
            if (up is not null)
            {
                return new CodeGraphResolvedRef(up.Id, 0.9, CodeGraphResolvedBy.Framework);
            }
        }

        // 2b. Provider configurations are inherited down the module tree.
        if (qname.StartsWith("provider.", StringComparison.Ordinal))
        {
            List<CodeGraphNode>? configs = null;
            foreach (var c in candidates)
            {
                if (c.Kind == CodeGraphNodeKind.Namespace)
                {
                    (configs ??= new List<CodeGraphNode>()).Add(c);
                }
            }

            var up = configs is null ? null : NearestAncestorMatch(configs, refDir);
            return up is null ? null : new CodeGraphResolvedRef(up.Id, 0.9, CodeGraphResolvedBy.Framework);
        }

        // 3. No same-directory declaration → no edge.
        return null;
    }

    // Nearest candidate walking UP the directory tree from refDir (exclusive).
    private static CodeGraphNode? NearestAncestorMatch(IReadOnlyList<CodeGraphNode> candidates, string refDir)
    {
        for (var dir = ParentOf(refDir); dir is not null; dir = ParentOf(dir))
        {
            foreach (var c in candidates)
            {
                if (DirOf(c.FilePath) == dir)
                {
                    return c;
                }
            }
        }

        return null;
    }

    private static CodeGraphResolvedRef? ResolveScopedModuleRef(
        CodeGraphUnresolvedReference r, string moduleName, string child, string refDir, CodeGraphResolutionContext ctx)
    {
        List<CodeGraphNode>? decls = null;
        foreach (var n in ctx.GetNodesByQualifiedName($"module.{moduleName}"))
        {
            if (n.Kind == CodeGraphNodeKind.Module)
            {
                (decls ??= new List<CodeGraphNode>()).Add(n);
            }
        }

        if (decls is null)
        {
            return null;
        }

        // Terraform scoping: the declaration lives in the reference's directory.
        CodeGraphNode? decl = null;
        foreach (var d in decls)
        {
            if (DirOf(d.FilePath) == refDir)
            {
                decl = d;
                break;
            }
        }

        decl ??= decls.Count == 1 ? decls[0] : null;
        if (decl is null)
        {
            return null;
        }

        var source = ReadNodeSpanMatch(decl, SourceAttrRegex(), ctx);
        if (source is null)
        {
            return null;
        }

        // cloudposse/atmos remote-state: module.M.outputs.X bridging to a component dir.
        if (child.StartsWith("remote-output.", StringComparison.Ordinal))
        {
            if (!RemoteStateRegex().IsMatch(source))
            {
                return null;
            }

            var component = ReadNodeSpanMatch(decl, ComponentAttrRegex(), ctx);
            if (component is null)
            {
                var viaVar = ReadNodeSpanMatch(decl, ComponentViaVarRegex(), ctx);
                if (viaVar is not null)
                {
                    List<CodeGraphNode>? declared = null;
                    foreach (var n in ctx.GetNodesByQualifiedName($"var.{viaVar}"))
                    {
                        if (DirOf(n.FilePath) == DirOf(decl.FilePath))
                        {
                            (declared ??= new List<CodeGraphNode>()).Add(n);
                        }
                    }

                    if (declared is { Count: 1 })
                    {
                        component = ReadNodeSpanMatch(declared[0], DefaultLiteralRegex(), ctx);
                    }
                }
            }

            if (component is null)
            {
                return null;
            }

            var outName = child["remote-output.".Length..];
            List<CodeGraphNode>? outs = null;
            foreach (var o in ctx.GetNodesByQualifiedName($"output.{outName}"))
            {
                var d = DirOf(o.FilePath);
                if (d == component || d.EndsWith("/" + component, StringComparison.Ordinal))
                {
                    (outs ??= new List<CodeGraphNode>()).Add(o);
                }
            }

            if (outs is null)
            {
                return null;
            }

            var dirs = new HashSet<string>(StringComparer.Ordinal);
            foreach (var o in outs)
            {
                dirs.Add(DirOf(o.FilePath));
            }

            if (dirs.Count > 1)
            {
                return null; // two directories claim this component name — never guess
            }

            return new CodeGraphResolvedRef(outs[0].Id, 0.9, CodeGraphResolvedBy.Framework);
        }

        if (!(source.StartsWith("./", StringComparison.Ordinal) || source.StartsWith("../", StringComparison.Ordinal)))
        {
            // Registry / git / absolute sources are out-of-repo: stay unresolved.
            return null;
        }

        var targetDir = NormalizeRel(JoinDirs(DirOf(decl.FilePath), source));

        if (child == "file")
        {
            var tfFiles = new List<string>();
            foreach (var f in ctx.GetAllFiles())
            {
                if (DirOf(f) == targetDir && (f.EndsWith(".tf", StringComparison.Ordinal) || f.EndsWith(".tofu", StringComparison.Ordinal)))
                {
                    tfFiles.Add(f);
                }
            }

            if (tfFiles.Count == 0)
            {
                return null;
            }

            tfFiles.Sort(StringComparer.Ordinal);
            string? entry = null;
            foreach (var f in tfFiles)
            {
                if (f.EndsWith("/main.tf", StringComparison.Ordinal) || f == "main.tf")
                {
                    entry = f;
                    break;
                }
            }

            entry ??= tfFiles[0];
            foreach (var n in ctx.GetNodesInFile(entry))
            {
                if (n.Kind == CodeGraphNodeKind.File)
                {
                    return new CodeGraphResolvedRef(n.Id, 0.95, CodeGraphResolvedBy.Framework);
                }
            }

            return null;
        }

        // child is `var.X` or `output.X` — the child module's own qualified names.
        foreach (var c in ctx.GetNodesByQualifiedName(child))
        {
            if (DirOf(c.FilePath) == targetDir)
            {
                return new CodeGraphResolvedRef(c.Id, 0.95, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    // First capture of `re` across the node's line span, or null.
    private static string? ReadNodeSpanMatch(CodeGraphNode node, Regex re, CodeGraphResolutionContext ctx)
    {
        var lines = ctx.GetFileLines(node.FilePath);
        if (lines is null)
        {
            return null;
        }

        var end = Math.Min(node.EndLine, lines.Count);
        for (var i = Math.Max(node.StartLine - 1, 0); i < end; i++)
        {
            var m = re.Match(lines[i]);
            if (m.Success)
            {
                return m.Groups[1].Value;
            }
        }

        return null;
    }

    // ── Path helpers (posix, project-relative — never System.IO.Path) ─────────

    // path.dirname(p) with '' coerced to '.'.
    private static string DirOf(string p)
    {
        var d = CodeGraphPosixPath.Dirname(p);
        return d.Length == 0 ? "." : d;
    }

    // Parent directory, or null above the project root.
    private static string? ParentOf(string dir)
    {
        if (dir == "." || dir.Length == 0)
        {
            return null;
        }

        var parent = CodeGraphPosixPath.Dirname(dir);
        return parent == dir ? null : parent;
    }

    // path.join(base==='.'?'':base, rel).
    private static string JoinDirs(string @base, string rel) =>
        CodeGraphPosixPath.Join(@base == "." ? string.Empty : @base, rel);

    // path.normalize + strip trailing slash, '' -> '.'.
    private static string NormalizeRel(string p)
    {
        var n = CodeGraphPosixPath.Join(p, string.Empty);
        return n.Length == 0 ? "." : n;
    }

    [GeneratedRegex(@"^module\.([^.:\s]+):(file$|var\.|output\.|remote-output\.)")]
    private static partial Regex ScopedRefGuardRegex();

    [GeneratedRegex(@"^module\.([^.:\s]+):(.+)$")]
    private static partial Regex ScopedRefRegex();

    [GeneratedRegex(@"^\s*source\s*=\s*""([^""]+)""")]
    private static partial Regex SourceAttrRegex();

    [GeneratedRegex(@"^\s*component\s*=\s*""([^""]+)""")]
    private static partial Regex ComponentAttrRegex();

    [GeneratedRegex(@"^\s*component\s*=\s*var\.([A-Za-z0-9_-]+)\s*$")]
    private static partial Regex ComponentViaVarRegex();

    [GeneratedRegex(@"^\s*default\s*=\s*""([^""]+)""")]
    private static partial Regex DefaultLiteralRegex();

    [GeneratedRegex(@"/remote-state(/|$)")]
    private static partial Regex RemoteStateRegex();
}
