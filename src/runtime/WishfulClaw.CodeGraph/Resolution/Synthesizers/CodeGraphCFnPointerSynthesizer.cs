using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCFnPointerSynthesizer — cFnPointerDispatchEdges (c-fnptr-synthesizer.ts,
// #932/#991). Phase.Main, gated to c/cpp. C/C++ polymorphism is the function pointer: a
// struct carries a fn-pointer field, concrete functions are registered into it
// through a table (`{{"add", cmd_add}, …}`, `.fn = cmd_add`, `x->fn = cmd_add`),
// and a dispatcher calls through it indirectly (`p->fn(argv)`). Static extraction
// captures neither binding, so the dispatcher→handler edge is missing. This bridges
// it, keyed by (struct type, fn-pointer field): registrations (positional /
// designated / direct-assign), field←field propagation (`a->f = b->g`), and
// dispatch (`recv->field(…)` where recv resolves to a struct type). Also bridges
// bare arrays of function pointers (`opcodes[op](…)`), keyed by the array variable.
//
// FULL FAITHFUL PORT — this now includes the entire C-preprocessor front-end the
// earlier reduced port dropped (analysis/02 §5, risk R1: the mini-C-preprocessor):
//   * function-like macro expansion (ParseFunctionMacros / ExpandMacroCalls /
//     SubstituteMacro) — MACRO-BUILT tables (redis `MAKE_CMD(…)`, sqlite
//     `FUNCTION(…)`, vim `EXCMD(…)`) are expanded before the table scan;
//   * object-like macro type aliases (ParseObjectMacros / ResolveTypeName) — a
//     table whose struct type is an object-macro alias is resolved;
//   * `#include` unit machinery (BuildEnv / LocalIncludesOf / ResolveInclude /
//     indexed-header re-scan) — tables in `#include`-d generated files (redis'
//     `commands.def`) are scanned, in the includer's effective macro env;
//   * `#ifdef`/`#if` arm evaluation (ParseDefinedNames / EvalConditionals) — dead
//     arms are excluded (blanked, offsets preserved).
// Every recursion / expansion is capped exactly as the TS caps it (macro expansion
// ≤6 passes, type-alias resolution ≤5 hops, include env depth 2 + cycle-guard,
// propagation ≤3 passes, FANOUT_CAP 300) so pathological input cannot blow up.
//
// GLOBAL namespace, CodeGraph* prefix, internal, reflection-free/AOT (Utf8JsonWriter
// metadata via CodeGraphSynthesizerSupport, no JsonSerializer, no reflection).
// Content + derived-macro caches are LRU-bounded (the #1212 kernel-OOM fix) so
// memory stays flat regardless of repo size.
// =============================================================================
internal sealed class CodeGraphCFnPointerSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly Regex CCppExt = new(
        @"\.(c|h|cc|cpp|cxx|hpp|hh|hxx|cppm|ipp|inl|tcc)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly HashSet<string> FnKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Function, CodeGraphNodeKind.Method
    };

    // FANOUT_CAP (ts:61).
    private const int FanoutCap = 300;

    // FNPTR_DECL_RE (ts:294) / FNPTR_TYPEDEF_RE (:297) / FNTYPE_TYPEDEF_STMT_RE (:300).
    private static readonly Regex FnPtrDeclRe = new(@"\(\s*(?:\w+\s+)*\*\s*(\w+)\s*\)\s*\(", RegexOptions.CultureInvariant);
    private static readonly Regex FnPtrTypedefRe = new(@"\btypedef\b[^;{}]*?\(\s*(?:\w+\s+)*\*\s*(\w+)\s*\)\s*\(", RegexOptions.CultureInvariant);
    private static readonly Regex FnTypeTypedefStmtRe = new(@"\btypedef\b([^;{}]*);", RegexOptions.CultureInvariant);
    private static readonly Regex FnTypeNameRe = new(@"\b(\w+)\s*\(", RegexOptions.CultureInvariant);

    // C_TYPE_KEYWORDS (ts:302).
    private static readonly HashSet<string> CTypeKeywords = new(StringComparer.Ordinal)
    {
        "void", "int", "char", "short", "long", "unsigned", "signed", "float", "double",
        "const", "struct", "union", "enum", "static", "volatile", "register", "inline"
    };

    private static readonly Regex InitRe = new(
        @"(?:^|[;{}])\s*(?:(?:static|const|extern|register|volatile)\s+)*(?:struct\s+)?(\w+)\s+(\w+)\s*(\[[^\]]*\])?\s*=\s*\{",
        RegexOptions.CultureInvariant);
    private static readonly Regex InlineStructRe = new(@"\bstruct\s+(\w+)\s*\{", RegexOptions.CultureInvariant);
    private static readonly Regex InlineVarRe = new(@"^\s*(\w+)\s*(\[[^\]]*\])?\s*(=\s*\{)?", RegexOptions.CultureInvariant);
    private static readonly Regex ArrayTableRe = new(
        @"(?:^|[;{}])\s*(?:(?:static|const|extern|register|volatile)\s+)*(\w+)\s+(\*\s*)?(\w+)\s*\[[^\]]*\]\s*=\s*\{",
        RegexOptions.CultureInvariant);
    private static readonly Regex FieldAssignRe = new(
        @"(\w+)\s*(?:->|\.)\s*(\w+)\s*=\s*(\w+)\s*(?:->|\.)\s*(\w+)",
        RegexOptions.CultureInvariant);
    private static readonly Regex DispatchRe = new(
        @"((?:\w+(?:\s*\[[^\][]*\])?\s*(?:->|\.)\s*)+)(\w+)\s*\)?\s*\(",
        RegexOptions.CultureInvariant);
    private static readonly Regex ArrayDispatchRe = new(
        @"(?:\(\s*\*\s*)?\b(\w+)\s*\[[^\][]*\]\s*\)?\s*\(",
        RegexOptions.CultureInvariant);

    private static readonly Regex DesignatorRe = new(@"^\.\s*(\w+)\s*=\s*(?:&\s*)?(\w+)\s*$", RegexOptions.CultureInvariant);
    private static readonly Regex PositionalIdRe = new(@"^&?\s*(\w+)\s*$", RegexOptions.CultureInvariant);
    private static readonly Regex ArrayDesRe = new(@"^\[[^\]]*\]\s*=\s*([\s\S]*)$", RegexOptions.CultureInvariant);
    private static readonly Regex CastPrefixRe = new(@"^\((?:[\w\s*]+)\)\s*", RegexOptions.CultureInvariant);
    private static readonly Regex AmpPrefixRe = new(@"^&\s*", RegexOptions.CultureInvariant);
    private static readonly Regex BareIdRe = new(@"^(\w+)$", RegexOptions.CultureInvariant);
    private static readonly Regex FirstTypedRe = new(@"(\w+)\s+\**\s*(\w+)\s*$", RegexOptions.CultureInvariant);
    private static readonly Regex SubsequentDeclRe = new(@"^\**\s*(\w+)", RegexOptions.CultureInvariant);
    private static readonly Regex ChainSubscriptRe = new(@"\s*\[[^\]]*\]", RegexOptions.CultureInvariant);
    private static readonly Regex ChainSplitRe = new(@"\s*(?:->|\.)\s*", RegexOptions.CultureInvariant);
    private static readonly Regex TrailingArrowRe = new(@"\s*(?:->|\.)\s*$", RegexOptions.CultureInvariant);

    // ---- C-preprocessor front-end regexes ----
    // parseFunctionMacros (ts:140) / parseObjectMacros (:159) / parseDefinedNames (:169).
    private static readonly Regex ContinuationRe = new(@"\\\r?\n", RegexOptions.CultureInvariant);
    private static readonly Regex FuncMacroRe = new(
        @"^[ \t]*#[ \t]*define[ \t]+(\w+)\(([^)]*)\)\s+(.+)$",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);
    private static readonly Regex ObjMacroRe = new(
        @"^[ \t]*#[ \t]*define[ \t]+(\w+)[ \t]+(\S[^\n]*)$",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);
    private static readonly Regex DefineNameRe = new(
        @"^[ \t]*#[ \t]*define[ \t]+(\w+)",
        RegexOptions.Multiline | RegexOptions.CultureInvariant);
    // substituteMacro (ts:259) whole-token substitution / expandMacroCalls call scan (:273).
    private static readonly Regex TokenRe = new(@"\b\w+\b", RegexOptions.CultureInvariant);
    private static readonly Regex MacroCallRe = new(@"\b(\w+)\s*\(", RegexOptions.CultureInvariant);
    // resolveTypeName alias shape (ts:248).
    private static readonly Regex TypeAliasRe = new(@"^(?:struct\s+)?(\w+)$", RegexOptions.CultureInvariant);
    // evalConditionals directive shapes (ts:184/199-233).
    private static readonly Regex HasIfRe = new(@"#\s*if", RegexOptions.CultureInvariant);
    private static readonly Regex IfdefRe = new(@"^#\s*ifdef\s+(\w+)", RegexOptions.CultureInvariant);
    private static readonly Regex IfndefRe = new(@"^#\s*ifndef\s+(\w+)", RegexOptions.CultureInvariant);
    private static readonly Regex IfRe = new(@"^#\s*if\s+(.+)$", RegexOptions.CultureInvariant);
    private static readonly Regex ElifRe = new(@"^#\s*elif\b", RegexOptions.CultureInvariant);
    private static readonly Regex ElseRe = new(@"^#\s*else\b", RegexOptions.CultureInvariant);
    private static readonly Regex EndifRe = new(@"^#\s*endif\b", RegexOptions.CultureInvariant);
    private static readonly Regex DefinedRe = new(@"^defined\s*\(?\s*(\w+)\s*\)?$", RegexOptions.CultureInvariant);
    private static readonly Regex NotDefinedRe = new(@"^!\s*defined\s*\(?\s*(\w+)\s*\)?$", RegexOptions.CultureInvariant);
    // INCLUDE_RE (ts:307) — read from RAW source / INCLUDABLE_EXT (ts:309).
    private static readonly Regex IncludeRe = new(@"#[ \t]*include[ \t]+""([^""\n]+)""", RegexOptions.CultureInvariant);
    private static readonly Regex IncludableExt = new(
        @"\.(def|inc|h|hh|hpp|hxx|c|cc|cpp|cxx|ipp|tcc|tbl)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static readonly string[] Required = { CodeGraphLanguage.C, CodeGraphLanguage.Cpp };

    public string Name => "fn-pointer-dispatch";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    private readonly struct FieldInfo
    {
        public FieldInfo(string name, int index, bool isFnPtr, string type)
        {
            Name = name;
            Index = index;
            IsFnPtr = isFnPtr;
            Type = type;
        }

        public string Name { get; }

        public int Index { get; }

        public bool IsFnPtr { get; }

        public string Type { get; }
    }

    // A function-like macro: `#define NAME(p0,p1,…) expansion` (MacroDef, ts:125).
    private readonly struct MacroDef
    {
        public MacroDef(string[] parameters, string expansion)
        {
            Parameters = parameters;
            Expansion = expansion;
        }

        public string[] Parameters { get; }

        public string Expansion { get; }
    }

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var files = new List<string>();
        foreach (var f in ctx.GetAllFiles())
        {
            if (CCppExt.IsMatch(f))
            {
                files.Add(f);
            }
        }

        var edges = new List<CodeGraphEdge>();
        if (files.Count == 0)
        {
            return edges;
        }

        // Raw + stripped source per file, LRU-BOUNDED (the two content caches; #1212).
        // The include machinery reads RAW source (string contents survive stripping,
        // but include parsing keys off the raw text exactly as the TS does).
        var rawCache = new CodeGraphLruCache<string, string?>(128);
        string? Raw(string file)
        {
            if (rawCache.TryGet(file, out var hit))
            {
                return hit;
            }

            var r = ctx.ReadFile(file);
            rawCache.Set(file, r);
            return r;
        }

        var srcCache = new CodeGraphLruCache<string, string?>(128);
        string? Src(string file)
        {
            if (srcCache.TryGet(file, out var hit))
            {
                return hit;
            }

            var r = Raw(file);
            var s = r is null ? null : CodeGraphStripComments.StripForRegex(r, CodeGraphLanguage.C);
            srcCache.Set(file, s);
            return s;
        }

        // Resolve a quoted include relative to the includer's directory, then the
        // project root. Returns a project-root-relative path that exists (even if
        // never indexed — e.g. redis' generated commands.def). (resolveInclude, ts:345)
        string? ResolveInclude(string includer, string inc)
        {
            var dir = CodeGraphPosixPath.Dirname(includer.Replace('\\', '/'));
            var cand = CodeGraphPosixPath.Join(dir, inc); // Join already normalizes `.`/`..`
            if (ctx.FileExists(cand))
            {
                return cand;
            }

            if (ctx.FileExists(inc))
            {
                return inc;
            }

            return null;
        }

        var fnPtrTypedefs = new HashSet<string>(StringComparer.Ordinal);
        var fnTypeTypedefs = new HashSet<string>(StringComparer.Ordinal);
        var structLayout = new Dictionary<string, List<FieldInfo>>(StringComparer.Ordinal);
        var allStructFields = new Dictionary<string, List<List<FieldInfo>>>(StringComparer.Ordinal);
        var fieldToStructs = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var reg = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var arrayReg = new Dictionary<string, List<(string File, HashSet<string> Ids)>>(StringComparer.Ordinal);
        var globalVarType = new Dictionary<string, string>(StringComparer.Ordinal);

        var scanned = 0;

        // ---- Pass A: fn-pointer AND fn-type typedefs ----
        foreach (var file in files)
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var s = Src(file);
            if (string.IsNullOrEmpty(s) || !s.Contains("typedef", StringComparison.Ordinal))
            {
                continue;
            }

            foreach (Match m in FnPtrTypedefRe.Matches(s))
            {
                fnPtrTypedefs.Add(m.Groups[1].Value);
            }

            foreach (Match m in FnTypeTypedefStmtRe.Matches(s))
            {
                var guts = m.Groups[1].Value;
                if (guts.Contains("(*", StringComparison.Ordinal) || guts.Contains("( *", StringComparison.Ordinal))
                {
                    continue; // pointer form — handled above
                }

                var fm = FnTypeNameRe.Match(guts);
                if (fm.Success && !CTypeKeywords.Contains(fm.Groups[1].Value))
                {
                    fnTypeTypedefs.Add(fm.Groups[1].Value);
                }
            }
        }

        // ---- C-preprocessor front-end (macro / #include / #ifdef machinery) ----
        // parseFunctionMacros (ts:136).
        Dictionary<string, MacroDef> ParseFunctionMacros(string stripped)
        {
            var outMap = new Dictionary<string, MacroDef>(StringComparer.Ordinal);
            if (!stripped.Contains("#define", StringComparison.Ordinal) &&
                !stripped.Contains("# define", StringComparison.Ordinal))
            {
                return outMap;
            }

            var joined = ContinuationRe.Replace(stripped, " ");
            foreach (Match m in FuncMacroRe.Matches(joined))
            {
                var raw = m.Groups[2].Value.Split(',');
                var ps = new List<string>(raw.Length);
                var variadic = false;
                foreach (var p in raw)
                {
                    var t = p.Trim();
                    if (t.Length == 0)
                    {
                        continue;
                    }

                    if (t.EndsWith("...", StringComparison.Ordinal))
                    {
                        variadic = true; // `...` / `p...` variadic — skip whole macro
                    }

                    ps.Add(t);
                }

                if (variadic)
                {
                    continue;
                }

                outMap[m.Groups[1].Value] = new MacroDef(ps.ToArray(), m.Groups[3].Value.Trim());
            }

            return outMap;
        }

        // parseObjectMacros (ts:155) — object-like `#define NAME value`, last wins.
        Dictionary<string, string> ParseObjectMacros(string stripped)
        {
            var outMap = new Dictionary<string, string>(StringComparer.Ordinal);
            if (!stripped.Contains("#define", StringComparison.Ordinal) &&
                !stripped.Contains("# define", StringComparison.Ordinal))
            {
                return outMap;
            }

            var joined = ContinuationRe.Replace(stripped, " ");
            foreach (Match m in ObjMacroRe.Matches(joined))
            {
                outMap[m.Groups[1].Value] = m.Groups[2].Value.Trim();
            }

            return outMap;
        }

        // parseDefinedNames (ts:166) — every `#define`d name (the #ifdef "defined" set).
        HashSet<string> ParseDefinedNames(string stripped)
        {
            var outSet = new HashSet<string>(StringComparer.Ordinal);
            if (!stripped.Contains("#define", StringComparison.Ordinal) &&
                !stripped.Contains("# define", StringComparison.Ordinal))
            {
                return outSet;
            }

            foreach (Match m in DefineNameRe.Matches(stripped))
            {
                outSet.Add(m.Groups[1].Value);
            }

            return outSet;
        }

        // resolveTypeName (ts:244) — transitive object-macro alias, capped at 5 hops.
        string ResolveTypeName(string name, Dictionary<string, string>? objEnv)
        {
            var n = name;
            for (var i = 0; objEnv is not null && i < 5; i++)
            {
                if (!objEnv.TryGetValue(n, out var v))
                {
                    break;
                }

                var t = TypeAliasRe.Match(v.Trim());
                if (!t.Success)
                {
                    break;
                }

                n = t.Groups[1].Value;
            }

            return n;
        }

        // substituteMacro (ts:256) — whole-token substitution of args for params.
        string SubstituteMacro(MacroDef def, List<string> args)
        {
            var map = new Dictionary<string, string>(StringComparer.Ordinal);
            for (var i = 0; i < def.Parameters.Length; i++)
            {
                map[def.Parameters[i]] = i < args.Count ? args[i] : string.Empty;
            }

            return TokenRe.Replace(def.Expansion, mm => map.TryGetValue(mm.Value, out var v) ? v : mm.Value);
        }

        // expandMacroCalls (ts:268) — expand known function-like calls to a fixpoint,
        // capped at 6 passes; each pass restarts the scan after the first substitution
        // because offsets shift.
        string ExpandMacroCalls(string text, Dictionary<string, MacroDef> env)
        {
            if (env.Count == 0)
            {
                return text;
            }

            var outStr = text;
            for (var pass = 0; pass < 6; pass++)
            {
                var changed = false;
                foreach (Match m in MacroCallRe.Matches(outStr))
                {
                    if (!env.TryGetValue(m.Groups[1].Value, out var def))
                    {
                        continue;
                    }

                    var open = m.Index + m.Length - 1; // the `(`
                    var close = MatchParen(outStr, open);
                    if (close < 0)
                    {
                        continue;
                    }

                    var args = new List<string>();
                    foreach (var a in SplitTopLevel(outStr.Substring(open + 1, close - open - 1), ','))
                    {
                        args.Add(a.Trim());
                    }

                    outStr = outStr[..m.Index] + SubstituteMacro(def, args) + outStr[(close + 1)..];
                    changed = true;
                    break; // restart scan — offsets shifted
                }

                if (!changed)
                {
                    break;
                }
            }

            return outStr;
        }

        // evalConditionals (ts:183) — drop inactive #ifdef/#if arms (blank, keep offsets).
        string EvalConditionals(string text, HashSet<string> defined)
        {
            if (!HasIfRe.IsMatch(text))
            {
                return text;
            }

            var lines = text.Split('\n');
            // stack frame: parentActive = enclosing kept?; active = this arm kept?; taken = any arm taken.
            var stack = new List<(bool ParentActive, bool Active, bool Taken)>();
            bool ActiveNow() => stack.Count == 0 || stack[^1].Active;

            bool? CondDefined(string expr)
            {
                var mm = DefinedRe.Match(expr);
                if (mm.Success)
                {
                    return defined.Contains(mm.Groups[1].Value);
                }

                mm = NotDefinedRe.Match(expr);
                if (mm.Success)
                {
                    return !defined.Contains(mm.Groups[1].Value);
                }

                return null; // unevaluable
            }

            for (var i = 0; i < lines.Length; i++)
            {
                var t = lines[i].Trim();
                Match mm;
                if ((mm = IfdefRe.Match(t)).Success)
                {
                    var pa = ActiveNow();
                    var cond = defined.Contains(mm.Groups[1].Value);
                    stack.Add((pa, pa && cond, cond));
                    lines[i] = string.Empty;
                    continue;
                }

                if ((mm = IfndefRe.Match(t)).Success)
                {
                    var pa = ActiveNow();
                    var cond = !defined.Contains(mm.Groups[1].Value);
                    stack.Add((pa, pa && cond, cond));
                    lines[i] = string.Empty;
                    continue;
                }

                if ((mm = IfRe.Match(t)).Success)
                {
                    var pa = ActiveNow();
                    var c = CondDefined(mm.Groups[1].Value.Trim());
                    var cond = c ?? true; // unevaluable → keep
                    stack.Add((pa, pa && cond, cond));
                    lines[i] = string.Empty;
                    continue;
                }

                if (ElifRe.IsMatch(t))
                {
                    if (stack.Count > 0)
                    {
                        var top = stack[^1];
                        stack[^1] = (top.ParentActive, top.ParentActive && !top.Taken, true);
                    }

                    lines[i] = string.Empty;
                    continue;
                }

                if (ElseRe.IsMatch(t))
                {
                    if (stack.Count > 0)
                    {
                        var top = stack[^1];
                        stack[^1] = (top.ParentActive, top.ParentActive && !top.Taken, true);
                    }

                    lines[i] = string.Empty;
                    continue;
                }

                if (EndifRe.IsMatch(t))
                {
                    if (stack.Count > 0)
                    {
                        stack.RemoveAt(stack.Count - 1);
                    }

                    lines[i] = string.Empty;
                    continue;
                }

                if (!ActiveNow())
                {
                    lines[i] = string.Empty; // blank an inactive line (keep the newline)
                }
            }

            return string.Join("\n", lines);
        }

        // Per-file macro / include caches, LRU-bounded like the content caches (#1212).
        var fnMacroCache = new CodeGraphLruCache<string, Dictionary<string, MacroDef>>(256);
        Dictionary<string, MacroDef> FileFnMacros(string file)
        {
            if (fnMacroCache.TryGet(file, out var hit))
            {
                return hit;
            }

            var m = ParseFunctionMacros(Src(file) ?? string.Empty);
            fnMacroCache.Set(file, m);
            return m;
        }

        var objMacroCache = new CodeGraphLruCache<string, Dictionary<string, string>>(256);
        Dictionary<string, string> FileObjMacros(string file)
        {
            if (objMacroCache.TryGet(file, out var hit))
            {
                return hit;
            }

            var m = ParseObjectMacros(Src(file) ?? string.Empty);
            objMacroCache.Set(file, m);
            return m;
        }

        var definedCache = new CodeGraphLruCache<string, HashSet<string>>(256);
        HashSet<string> FileDefinedNames(string file)
        {
            if (definedCache.TryGet(file, out var hit))
            {
                return hit;
            }

            var d = ParseDefinedNames(Src(file) ?? string.Empty);
            definedCache.Set(file, d);
            return d;
        }

        var includeCache = new CodeGraphLruCache<string, List<string>>(1024);
        List<string> LocalIncludesOf(string file)
        {
            if (includeCache.TryGet(file, out var hit))
            {
                return hit;
            }

            var outList = new List<string>();
            var rawText = Raw(file);
            if (rawText is not null && rawText.Contains("include", StringComparison.Ordinal))
            {
                foreach (Match im in IncludeRe.Matches(rawText))
                {
                    var inc = im.Groups[1].Value;
                    if (!IncludableExt.IsMatch(inc))
                    {
                        continue;
                    }

                    var t = ResolveInclude(file, inc);
                    if (t is not null)
                    {
                        outList.Add(t);
                    }
                }
            }

            includeCache.Set(file, outList);
            return outList;
        }

        // buildEnv (ts:616) — a file's effective macro env = own #defines PLUS those
        // of the headers it #includes (first writer wins). Depth 2 + cycle-guard.
        void BuildEnv(
            string file,
            int depth,
            HashSet<string> seen,
            Dictionary<string, MacroDef> fn,
            Dictionary<string, string> obj,
            HashSet<string> def)
        {
            if (depth < 0 || !seen.Add(file))
            {
                return;
            }

            foreach (var kv in FileFnMacros(file))
            {
                if (!fn.ContainsKey(kv.Key))
                {
                    fn[kv.Key] = kv.Value;
                }
            }

            foreach (var kv in FileObjMacros(file))
            {
                if (!obj.ContainsKey(kv.Key))
                {
                    obj[kv.Key] = kv.Value;
                }
            }

            foreach (var n in FileDefinedNames(file))
            {
                def.Add(n);
            }

            foreach (var inc in LocalIncludesOf(file))
            {
                BuildEnv(inc, depth - 1, seen, fn, obj, def);
            }
        }

        // ---- helpers over the typedef sets ----
        List<FieldInfo> ParseStructFields(string inner)
        {
            var fields = new List<FieldInfo>();
            var idx = 0;
            foreach (var rawDecl in SplitTopLevel(inner, ';'))
            {
                var decl = rawDecl.Trim();
                if (decl.Length == 0)
                {
                    continue;
                }

                var parts = SplitTopLevel(decl, ',');
                var firstTyped = FirstTypedRe.Match(parts[0]);
                var sharedType = firstTyped.Success ? firstTyped.Groups[1].Value : string.Empty;
                for (var pi = 0; pi < parts.Count; pi++)
                {
                    var p = parts[pi].Trim();
                    string? name = null;
                    var type = string.Empty;
                    var isFnPtr = false;
                    var ptr = FnPtrDeclRe.Match(p);
                    if (ptr.Success)
                    {
                        name = ptr.Groups[1].Value; // `… (*name)(…)`
                        isFnPtr = true;
                    }
                    else if (pi == 0)
                    {
                        if (firstTyped.Success)
                        {
                            name = firstTyped.Groups[2].Value;
                            type = sharedType;
                        }
                    }
                    else
                    {
                        var dm = SubsequentDeclRe.Match(p);
                        if (dm.Success)
                        {
                            name = dm.Groups[1].Value;
                            type = sharedType;
                        }
                    }

                    if (!ptr.Success && type.Length > 0)
                    {
                        isFnPtr = fnPtrTypedefs.Contains(type) || fnTypeTypedefs.Contains(type);
                    }

                    fields.Add(new FieldInfo(name ?? string.Empty, idx, !string.IsNullOrEmpty(name) && isFnPtr, type));
                    idx++;
                }
            }

            return fields;
        }

        void RegisterStructLayout(string name, List<FieldInfo> fields)
        {
            if (!allStructFields.TryGetValue(name, out var layouts))
            {
                layouts = new List<List<FieldInfo>>();
                allStructFields[name] = layouts;
            }

            layouts.Add(fields);
            var anyFnPtr = false;
            foreach (var f in fields)
            {
                if (f.Name.Length > 0 && f.IsFnPtr)
                {
                    if (!fieldToStructs.TryGetValue(f.Name, out var set))
                    {
                        set = new HashSet<string>(StringComparer.Ordinal);
                        fieldToStructs[f.Name] = set;
                    }

                    set.Add(name);
                }

                if (f.IsFnPtr)
                {
                    anyFnPtr = true;
                }
            }

            if (anyFnPtr)
            {
                structLayout[name] = fields;
            }
        }

        // ---- Pass B: struct field layouts from struct nodes ----
        foreach (var st in ctx.IterateNodesByKind(CodeGraphNodeKind.Struct))
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!CCppExt.IsMatch(st.FilePath))
            {
                continue;
            }

            var s = Src(st.FilePath);
            if (string.IsNullOrEmpty(s))
            {
                continue;
            }

            var body = CSliceLines(s, st.StartLine, st.EndLine);
            var open = body.IndexOf('{');
            var close = open >= 0 ? MatchBrace(body, open) : -1;
            if (open < 0 || close < 0)
            {
                continue;
            }

            RegisterStructLayout(st.Name, ParseStructFields(body.Substring(open + 1, close - open - 1)));
        }

        bool FnPtrFieldOf(string structName, string field)
        {
            if (!structLayout.TryGetValue(structName, out var layout))
            {
                return false;
            }

            foreach (var f in layout)
            {
                if (f.Name == field && f.IsFnPtr)
                {
                    return true;
                }
            }

            return false;
        }

        CodeGraphNode? ResolveFn(string name, string? preferFile)
        {
            CodeGraphNode? first = null;
            var count = 0;
            foreach (var n in ctx.GetNodesByName(name))
            {
                if (!FnKinds.Contains(n.Kind))
                {
                    continue;
                }

                count++;
                if (first is null)
                {
                    first = n;
                }

                if (preferFile is not null && n.FilePath == preferFile)
                {
                    return n;
                }
            }

            return count == 0 ? null : first;
        }

        void AddReg(string structName, string field, CodeGraphNode fn)
        {
            var key = structName + "." + field;
            if (!reg.TryGetValue(key, out var set))
            {
                set = new HashSet<string>(StringComparer.Ordinal);
                reg[key] = set;
            }

            set.Add(fn.Id);
        }

        void AddArrayReg(string name, string file, CodeGraphNode fn)
        {
            if (!arrayReg.TryGetValue(name, out var entries))
            {
                entries = new List<(string, HashSet<string>)>();
                arrayReg[name] = entries;
            }

            for (var i = 0; i < entries.Count; i++)
            {
                if (entries[i].File == file)
                {
                    entries[i].Ids.Add(fn.Id);
                    return;
                }
            }

            var ids = new HashSet<string>(StringComparer.Ordinal) { fn.Id };
            entries.Add((file, ids));
        }

        // registerStructValue (ts:501) — now macro-aware: expand macro calls in the
        // value, peel a brace-wrapped element (sqlite FUNCTION(…) → {…}), then read
        // designated/positional fn-pointer bindings.
        void RegisterStructValue(string structName, string valueBody, string file, Dictionary<string, MacroDef> env)
        {
            if (!structLayout.TryGetValue(structName, out var layout))
            {
                return;
            }

            if (env.Count > 0)
            {
                valueBody = ExpandMacroCalls(valueBody, env);
            }

            valueBody = valueBody.Trim();
            if (valueBody.StartsWith("{", StringComparison.Ordinal))
            {
                var e = MatchBrace(valueBody, 0);
                if (e > 0 && valueBody[(e + 1)..].Trim().Length == 0)
                {
                    valueBody = valueBody.Substring(1, e - 1);
                }
            }

            var items = SplitTopLevel(valueBody, ',');
            var pos = 0;
            foreach (var rawItem in items)
            {
                var item = rawItem.Trim();
                if (item.Length == 0)
                {
                    continue;
                }

                var des = DesignatorRe.Match(item);
                if (des.Success)
                {
                    var field = des.Groups[1].Value;
                    if (FnPtrFieldOf(structName, field))
                    {
                        var fn = ResolveFn(des.Groups[2].Value, file);
                        if (fn is not null)
                        {
                            AddReg(structName, field, fn);
                        }
                    }

                    continue; // a designated item does not advance positional counting
                }

                FieldInfo? slot = null;
                foreach (var f in layout)
                {
                    if (f.Index == pos)
                    {
                        slot = f;
                        break;
                    }
                }

                if (slot is { IsFnPtr: true })
                {
                    var id = PositionalIdRe.Match(item);
                    if (id.Success)
                    {
                        var fn = ResolveFn(id.Groups[1].Value, file);
                        if (fn is not null)
                        {
                            AddReg(structName, slot.Value.Name, fn);
                        }
                    }
                }

                pos++;
            }
        }

        // registerArrayValue (ts:552) — macro-aware bare-array registration.
        void RegisterArrayValue(string name, string body, string file, Dictionary<string, MacroDef> env)
        {
            if (env.Count > 0)
            {
                body = ExpandMacroCalls(body, env);
            }

            foreach (var rawItem in SplitTopLevel(body, ','))
            {
                var item = rawItem.Trim();
                if (item.Length == 0)
                {
                    continue;
                }

                var des = ArrayDesRe.Match(item);
                if (des.Success)
                {
                    item = des.Groups[1].Value.Trim();
                }

                item = CastPrefixRe.Replace(item, string.Empty);
                item = AmpPrefixRe.Replace(item, string.Empty).Trim();
                var id = BareIdRe.Match(item);
                if (!id.Success)
                {
                    continue;
                }

                var fn = ResolveFn(id.Groups[1].Value, file);
                if (fn is not null)
                {
                    AddArrayReg(name, file, fn);
                }
            }
        }

        void ProcessInit(string structName, string body, bool isArray, string file, Dictionary<string, MacroDef> env)
        {
            if (isArray)
            {
                foreach (var el in SplitTopLevel(body, ','))
                {
                    var t = el.Trim();
                    if (t.StartsWith("{", StringComparison.Ordinal))
                    {
                        var e = MatchBrace(t, 0);
                        if (e > 0)
                        {
                            RegisterStructValue(structName, t.Substring(1, e - 1), file, env);
                        }
                    }
                    else if (t.Length > 0)
                    {
                        RegisterStructValue(structName, t, file, env);
                    }
                }
            }
            else
            {
                RegisterStructValue(structName, body, file, env);
            }
        }

        // processUnit (ts:701) — one unit's text (a file's own source, or an #include
        // pasted with the includer's env). env = function-macro env; objEnv = object-
        // macro aliases used to resolve the table's struct type name.
        void ProcessUnit(string s, string file, Dictionary<string, MacroDef> env, Dictionary<string, string> objEnv)
        {
            if (string.IsNullOrEmpty(s) || !s.Contains('{'))
            {
                return;
            }

            // Inline struct tables: `struct TAG { … } var[opt] [= {…}]`.
            var isPos = 0;
            while (true)
            {
                var im = InlineStructRe.Match(s, isPos);
                if (!im.Success)
                {
                    break;
                }

                var nextPos = im.Index + im.Length;
                var tag = im.Groups[1].Value;
                var sOpen = im.Index + im.Length - 1; // the struct body's `{`
                var sClose = MatchBrace(s, sOpen);
                if (sClose >= 0)
                {
                    var after = s[(sClose + 1)..];
                    var vm = InlineVarRe.Match(after);
                    if (vm.Success && vm.Groups[1].Value.Length > 0)
                    {
                        var fields = ParseStructFields(s.Substring(sOpen + 1, sClose - sOpen - 1));
                        var anyFnPtr = false;
                        foreach (var f in fields)
                        {
                            if (f.IsFnPtr)
                            {
                                anyFnPtr = true;
                                break;
                            }
                        }

                        if (anyFnPtr)
                        {
                            if (!structLayout.ContainsKey(tag))
                            {
                                RegisterStructLayout(tag, fields);
                            }

                            globalVarType[vm.Groups[1].Value] = tag;
                            if (vm.Groups[3].Success)
                            {
                                var aOpen = sClose + 1 + after.IndexOf('{', vm.Length - 1);
                                var aClose = MatchBrace(s, aOpen);
                                if (aClose > 0)
                                {
                                    ProcessInit(tag, s.Substring(aOpen + 1, aClose - aOpen - 1), vm.Groups[2].Success, file, env);
                                    nextPos = aClose;
                                }
                            }
                        }
                    }
                }

                isPos = nextPos > im.Index ? nextPos : im.Index + 1;
            }

            if (!s.Contains('='))
            {
                return;
            }

            // `(?:struct )?TYPE name[opt] = {` struct-value tables. TYPE may be an
            // object-macro alias (redis' COMMAND_STRUCT → redisCommand).
            var initPos = 0;
            while (true)
            {
                var m = InitRe.Match(s, initPos);
                if (!m.Success)
                {
                    break;
                }

                var nextPos = m.Index + m.Length;
                var structName = m.Groups[1].Value;
                if (!structLayout.ContainsKey(structName))
                {
                    structName = ResolveTypeName(structName, objEnv);
                }

                if (structLayout.ContainsKey(structName))
                {
                    var isArray = m.Groups[3].Success;
                    var open = m.Index + m.Length - 1; // the `{`
                    var close = MatchBrace(s, open);
                    if (close >= 0)
                    {
                        globalVarType[m.Groups[2].Value] = structName;
                        ProcessInit(structName, s.Substring(open + 1, close - open - 1), isArray, file, env);
                        nextPos = close;
                    }
                }

                initPos = nextPos > m.Index ? nextPos : m.Index + 1;
            }

            // Bare arrays-of-function-pointers.
            var arrPos = 0;
            while (true)
            {
                var am = ArrayTableRe.Match(s, arrPos);
                if (!am.Success)
                {
                    break;
                }

                var nextPos = am.Index + am.Length;
                var elemType = am.Groups[1].Value;
                var hasStar = am.Groups[2].Success;
                if ((fnTypeTypedefs.Contains(elemType) && hasStar) || fnPtrTypedefs.Contains(elemType))
                {
                    var open = am.Index + am.Length - 1; // the `{`
                    var close = MatchBrace(s, open);
                    if (close >= 0)
                    {
                        RegisterArrayValue(am.Groups[3].Value, s.Substring(open + 1, close - open - 1), file, env);
                        nextPos = close;
                    }
                }

                arrPos = nextPos > am.Index ? nextPos : am.Index + 1;
            }
        }

        // ---- Pass C: registrations — stream each file (and its qualifying local
        // includes) through processUnit, one at a time (ts:766). ----
        var indexedSet = new HashSet<string>(files, StringComparer.Ordinal);
        var seenInclude = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var env = new Dictionary<string, MacroDef>(StringComparer.Ordinal);
            var objEnv = new Dictionary<string, string>(StringComparer.Ordinal);
            var defined = new HashSet<string>(StringComparer.Ordinal);
            BuildEnv(file, 2, new HashSet<string>(StringComparer.Ordinal), env, objEnv, defined);

            var s = Src(file);
            if (!string.IsNullOrEmpty(s))
            {
                ProcessUnit(s, file, env, objEnv);
            }

            foreach (var target in LocalIncludesOf(file))
            {
                if (!seenInclude.Contains(file + ">" + target))
                {
                    var incSrc = Src(target);
                    if (string.IsNullOrEmpty(incSrc))
                    {
                        continue;
                    }

                    if (indexedSet.Contains(target))
                    {
                        // Re-scan an indexed header only when this includer unlocks
                        // guarded code (it #defines a name the header doesn't, and the
                        // header has #if).
                        var ownDef = FileDefinedNames(target);
                        var adds = false;
                        foreach (var n in defined)
                        {
                            if (!ownDef.Contains(n))
                            {
                                adds = true;
                                break;
                            }
                        }

                        if (!adds || !HasIfRe.IsMatch(incSrc))
                        {
                            continue;
                        }
                    }

                    seenInclude.Add(file + ">" + target);

                    // Evaluate the include's conditionals in the includer's defined set,
                    // then re-parse the include's OWN macros from the resolved text
                    // (a conditionally-defined macro picks the active arm here).
                    var text = EvalConditionals(incSrc, defined);
                    var incEnv = new Dictionary<string, MacroDef>(env, StringComparer.Ordinal);
                    foreach (var kv in ParseFunctionMacros(text))
                    {
                        incEnv[kv.Key] = kv.Value;
                    }

                    var incObjEnv = new Dictionary<string, string>(objEnv, StringComparer.Ordinal);
                    foreach (var kv in ParseObjectMacros(text))
                    {
                        incObjEnv[kv.Key] = kv.Value;
                    }

                    ProcessUnit(text, target, incEnv, incObjEnv);
                }
            }
        }

        // ---- receiver-type resolution within a function's source ----
        string? RecvTypeIn(string fnSrc, string recv)
        {
            var re = new Regex(
                @"(?:struct\s+)?(\w+)\s*\*?\s*\b" + Regex.Escape(recv) + @"\b\s*(?:[,)=;]|\[)",
                RegexOptions.CultureInvariant);
            foreach (Match m in re.Matches(fnSrc))
            {
                if (structLayout.ContainsKey(m.Groups[1].Value))
                {
                    return m.Groups[1].Value;
                }
            }

            return null;
        }

        string? VarTypeIn(string fnSrc, string v)
        {
            var re = new Regex(
                @"(?:struct\s+)?(\w+)\s*\*?\s*\b" + Regex.Escape(v) + @"\b\s*(?:[,)=;]|\[)",
                RegexOptions.CultureInvariant);
            foreach (Match m in re.Matches(fnSrc))
            {
                if (!CTypeKeywords.Contains(m.Groups[1].Value))
                {
                    return m.Groups[1].Value;
                }
            }

            return globalVarType.TryGetValue(v, out var gt) ? gt : null;
        }

        string? ResolveChainType(string fnSrc, string chain)
        {
            var stripped = ChainSubscriptRe.Replace(chain, string.Empty);
            var segs = new List<string>();
            foreach (var seg in ChainSplitRe.Split(stripped))
            {
                if (seg.Length > 0)
                {
                    segs.Add(seg);
                }
            }

            if (segs.Count == 0)
            {
                return null;
            }

            var t = VarTypeIn(fnSrc, segs[0]);
            for (var i = 1; t is not null && i < segs.Count; i++)
            {
                string? next = null;
                if (allStructFields.TryGetValue(t, out var layouts))
                {
                    foreach (var fields in layouts)
                    {
                        foreach (var fl in fields)
                        {
                            if (fl.Name == segs[i] && fl.Type.Length > 0)
                            {
                                next = fl.Type;
                                break;
                            }
                        }

                        if (next is not null)
                        {
                            break;
                        }
                    }
                }

                t = next;
            }

            return t;
        }

        // ---- Pass D: field←field propagation (`a->f = b->g`) ----
        var propagations = new List<(string To, string From)>();
        foreach (var file in files)
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var s = Src(file);
            if (string.IsNullOrEmpty(s) || !s.Contains('='))
            {
                continue;
            }

            foreach (var fn in ctx.GetNodesInFile(file))
            {
                if (!FnKinds.Contains(fn.Kind))
                {
                    continue;
                }

                var body = CSliceLines(s, fn.StartLine, fn.EndLine);
                if (!body.Contains('='))
                {
                    continue;
                }

                foreach (Match m in FieldAssignRe.Matches(body))
                {
                    var lrecv = m.Groups[1].Value;
                    var lfield = m.Groups[2].Value;
                    var rrecv = m.Groups[3].Value;
                    var rfield = m.Groups[4].Value;
                    var lt = RecvTypeIn(body, lrecv);
                    var rt = RecvTypeIn(body, rrecv);
                    if (lt is not null && rt is not null && FnPtrFieldOf(lt, lfield) && FnPtrFieldOf(rt, rfield))
                    {
                        propagations.Add((lt + "." + lfield, rt + "." + rfield));
                    }
                }
            }
        }

        for (var pass = 0; pass < 3 && propagations.Count > 0; pass++)
        {
            var changed = false;
            foreach (var (to, from) in propagations)
            {
                if (!reg.TryGetValue(from, out var fromSet))
                {
                    continue;
                }

                if (!reg.TryGetValue(to, out var toSet))
                {
                    toSet = new HashSet<string>(StringComparer.Ordinal);
                    reg[to] = toSet;
                }

                foreach (var id in fromSet)
                {
                    if (toSet.Add(id))
                    {
                        changed = true;
                    }
                }
            }

            if (!changed)
            {
                break;
            }
        }

        if (reg.Count == 0 && arrayReg.Count == 0)
        {
            return edges;
        }

        // ---- Pass E: dispatch sites → edges ----
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var s = Src(file);
            if (string.IsNullOrEmpty(s))
            {
                continue;
            }

            foreach (var fn in ctx.GetNodesInFile(file))
            {
                if (!FnKinds.Contains(fn.Kind))
                {
                    continue;
                }

                var body = CSliceLines(s, fn.StartLine, fn.EndLine);
                var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(body, fn.StartLine);
                var added = 0;

                foreach (Match m in DispatchRe.Matches(body))
                {
                    if (added >= FanoutCap)
                    {
                        break;
                    }

                    var baseChain = TrailingArrowRe.Replace(m.Groups[1].Value, string.Empty).Trim();
                    var field = m.Groups[2].Value;
                    if (!fieldToStructs.TryGetValue(field, out var owners) || owners.Count == 0)
                    {
                        continue;
                    }

                    var structName = ResolveChainType(body, baseChain);
                    if (structName is null || !owners.Contains(structName))
                    {
                        var strippedChain = ChainSubscriptRe.Replace(baseChain, string.Empty);
                        var pieces = ChainSplitRe.Split(strippedChain);
                        var lastSeg = pieces.Length > 0 ? pieces[^1] : strippedChain;
                        var t = RecvTypeIn(body, lastSeg);
                        structName = t is not null && owners.Contains(t) ? t : null;
                    }

                    if (structName is null || !owners.Contains(structName))
                    {
                        structName = owners.Count == 1 ? FirstOf(owners) : null;
                    }

                    if (structName is null)
                    {
                        continue;
                    }

                    if (!reg.TryGetValue(structName + "." + field, out var targets))
                    {
                        continue;
                    }

                    var line = lineAt(m.Index);
                    foreach (var tid in targets)
                    {
                        if (tid == fn.Id)
                        {
                            continue;
                        }

                        var key = fn.Id + ">" + tid;
                        if (!seen.Add(key))
                        {
                            continue;
                        }

                        edges.Add(new CodeGraphEdge(
                            fn.Id,
                            tid,
                            CodeGraphEdgeKind.Calls,
                            CodeGraphSynthesizerSupport.Metadata(
                                ("synthesizedBy", "fn-pointer-dispatch"),
                                ("via", structName + "." + field),
                                ("registeredAt", fn.FilePath + ":" + line)),
                            line,
                            Column: null,
                            CodeGraphProvenance.Heuristic));
                        if (++added >= FanoutCap)
                        {
                            break;
                        }
                    }
                }

                // ---- bare array-of-fn-pointers dispatch (`tbl[i](…)`) ----
                if (arrayReg.Count > 0 && added < FanoutCap)
                {
                    foreach (Match m in ArrayDispatchRe.Matches(body))
                    {
                        if (added >= FanoutCap)
                        {
                            break;
                        }

                        if (!arrayReg.TryGetValue(m.Groups[1].Value, out var entries))
                        {
                            continue;
                        }

                        HashSet<string>? ids;
                        if (entries.Count == 1)
                        {
                            ids = entries[0].Ids;
                        }
                        else
                        {
                            ids = null;
                            foreach (var e in entries)
                            {
                                if (e.File == fn.FilePath)
                                {
                                    ids = e.Ids;
                                    break;
                                }
                            }
                        }

                        if (ids is null)
                        {
                            continue;
                        }

                        var line = lineAt(m.Index);
                        foreach (var tid in ids)
                        {
                            if (tid == fn.Id)
                            {
                                continue;
                            }

                            var key = fn.Id + ">" + tid;
                            if (!seen.Add(key))
                            {
                                continue;
                            }

                            edges.Add(new CodeGraphEdge(
                                fn.Id,
                                tid,
                                CodeGraphEdgeKind.Calls,
                                CodeGraphSynthesizerSupport.Metadata(
                                    ("synthesizedBy", "fn-pointer-dispatch"),
                                    ("via", m.Groups[1].Value + "[]"),
                                    ("registeredAt", fn.FilePath + ":" + line)),
                                line,
                                Column: null,
                                CodeGraphProvenance.Heuristic));
                            if (++added >= FanoutCap)
                            {
                                break;
                            }
                        }
                    }
                }
            }
        }

        return edges;
    }

    private static string FirstOf(HashSet<string> set)
    {
        foreach (var s in set)
        {
            return s;
        }

        return string.Empty;
    }

    // sliceLines (ts:73) — `content.split('\n').slice(startLine-1, endLine).join('\n')`.
    private static string CSliceLines(string content, int startLine, int endLine)
    {
        if (startLine <= 0)
        {
            return string.Empty;
        }

        var lines = content.Split('\n');
        var start = startLine - 1;
        var end = endLine;
        if (start < 0)
        {
            start = 0;
        }

        if (start >= lines.Length || end <= start)
        {
            return string.Empty;
        }

        if (end > lines.Length)
        {
            end = lines.Length;
        }

        return string.Join("\n", lines, start, end - start);
    }

    // matchBrace (ts:79).
    private static int MatchBrace(string src, int open)
    {
        var depth = 0;
        for (var i = open; i < src.Length; i++)
        {
            var c = src[i];
            if (c == '{')
            {
                depth++;
            }
            else if (c == '}')
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }

        return -1;
    }

    // matchParen (ts:111).
    private static int MatchParen(string src, int open)
    {
        var depth = 0;
        for (var i = open; i < src.Length; i++)
        {
            var c = src[i];
            if (c == '(')
            {
                depth++;
            }
            else if (c == ')')
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }

        return -1;
    }

    // splitTopLevel (ts:93) — split on `sep` at brace/paren/bracket depth 0.
    private static List<string> SplitTopLevel(string body, char sep)
    {
        var outList = new List<string>();
        var depth = 0;
        var start = 0;
        for (var i = 0; i < body.Length; i++)
        {
            var c = body[i];
            if (c == '{' || c == '(' || c == '[')
            {
                depth++;
            }
            else if (c == '}' || c == ')' || c == ']')
            {
                depth--;
            }
            else if (c == sep && depth == 0)
            {
                outList.Add(body.Substring(start, i - start));
                start = i + 1;
            }
        }

        outList.Add(body[start..]);
        return outList;
    }
}
