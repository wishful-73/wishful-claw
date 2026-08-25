using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGoModuleLoader — Go module-path detection (≙ go-module.ts). A Go monorepo's
// cross-package calls (`pkga.FuncX(...)`) only resolve when the resolver knows the
// project's module path (the `module …` directive in go.mod). Without it,
// IsExternalImport treats every in-module import — `github.com/example/myproject/pkga`
// — as a third-party package, so resolution falls through to name-matching with path
// proximity and returns a tiny fraction of the real call sites (#388).
//
// Limitation (matches the TS): only the project-root go.mod is read; nested modules
// (Go workspaces) are not resolved. Produces the CodeGraphGoModule the context caches.
// =============================================================================
internal static class CodeGraphGoModuleLoader
{
    // Line comments — strip so a `// module foo` doesn't false-match the directive.
    private static readonly Regex LineComment = new(@"//[^\n]*", RegexOptions.CultureInvariant);

    // `module <path>` is the first non-comment directive in any valid go.mod.
    private static readonly Regex ModuleDirective = new(@"^\s*module\s+(\S+)\s*$", RegexOptions.Multiline | RegexOptions.CultureInvariant);

    // Optional quoting around the module path.
    private static readonly Regex SurroundingQuotes = new(@"^[""']|[""']$", RegexOptions.CultureInvariant);

    // Read the root go.mod and extract the module path, or null when there is no go.mod
    // or it has no `module` directive.
    public static CodeGraphGoModule? Load(string projectRoot)
    {
        var goModPath = CodeGraphPosixPath.Join(projectRoot, "go.mod");
        string content;
        try
        {
            content = File.ReadAllText(goModPath);
        }
        catch
        {
            return null;
        }

        var stripped = LineComment.Replace(content, string.Empty);
        var match = ModuleDirective.Match(stripped);
        if (!match.Success)
        {
            return null;
        }

        var modulePath = SurroundingQuotes.Replace(match.Groups[1].Value, string.Empty);
        if (modulePath.Length == 0)
        {
            return null;
        }

        return new CodeGraphGoModule(modulePath, projectRoot);
    }
}
