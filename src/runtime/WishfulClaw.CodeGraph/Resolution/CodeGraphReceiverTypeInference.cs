using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphReceiverTypeInference — the per-language receiver-type inference that
// backs matchMethodCall + the call-chain matchers (≙ name-matcher.ts:597-1445).
// Split out of CodeGraphNameMatcher because it is the heavy part (#1122): C++
// declarator/`auto` inference (header scan + return-type chains), Java field
// inference, PHP `$this->prop` property inference, and the shared
// localReceiverTypePatterns regex table for ~14 languages. All entry points take
// (receiver, ref, ctx) and read source lines through the context's GetFileLines
// cache. The regexes that interpolate an escaped receiver are dynamic (new Regex,
// interpreted under AOT — fine); the fixed ones are [GeneratedRegex].
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Stateless static helpers —
// CodeGraphNameMatcher calls the internal entry points; the rest stay private.
// =============================================================================
internal static partial class CodeGraphReceiverTypeInference
{
    // Tokens a loose pattern might capture that are never a user-defined type
    // (name-matcher.ts:1068 NON_TYPE_RECEIVER_TOKENS).
    private static readonly HashSet<string> NonTypeReceiverTokens = new(StringComparer.Ordinal)
    {
        "this", "self", "super", "new", "return", "await", "yield", "typeof",
        "null", "nil", "None", "true", "false", "True", "False", "undefined"
    };

    // C++ keywords/control-flow tokens that can appear right before a receiver
    // (`return ptr->m()`) and must NOT be treated as a type (name-matcher.ts:599).
    private static readonly HashSet<string> CppNonTypeTokens = new(StringComparer.Ordinal)
    {
        "return", "if", "else", "for", "while", "do", "switch", "case", "default",
        "break", "continue", "goto", "throw", "new", "delete", "co_await", "co_yield",
        "co_return", "static_cast", "const_cast", "dynamic_cast", "reinterpret_cast",
        "sizeof", "alignof", "typeid", "and", "or", "not", "xor"
    };

    // Mirrors JS  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') — the exact escaping the
    // TS inferrers use (NOT Regex.Escape, whose set differs).
    private static string EscapeRegexLiteral(string s)
    {
        var sb = new StringBuilder(s.Length + 8);
        foreach (var c in s)
        {
            if (c is '.' or '*' or '+' or '?' or '^' or '$' or '{' or '}' or '(' or ')' or '|' or '[' or ']' or '\\')
            {
                sb.Append('\\');
            }

            sb.Append(c);
        }

        return sb.ToString();
    }

    // ── Type-name normalizers ────────────────────────────────────────────────

    // name-matcher.ts:1078 normalizeInferredTypeName.
    private static string? NormalizeInferredTypeName(string raw)
    {
        var cleaned = GenericsAngleRegex().Replace(raw, string.Empty);
        cleaned = RefPtrRegex().Replace(cleaned, string.Empty).Trim();
        string? seg = null;
        foreach (var part in DotColonSplitRegex().Split(cleaned))
        {
            if (part.Length > 0)
            {
                seg = part;
            }
        }

        if (seg is null || NonTypeReceiverTokens.Contains(seg))
        {
            return null;
        }

        return seg;
    }

    // name-matcher.ts:606 normalizeCppTypeName.
    private static string? NormalizeCppTypeName(string typeName)
    {
        var normalized = CppCvQualifiersRegex().Replace(typeName, " ");
        normalized = RefPtrPlusRegex().Replace(normalized, " ");
        normalized = GenericsAngleRegex().Replace(normalized, " ");
        normalized = WhitespaceRegex().Replace(normalized, " ").Trim();
        if (normalized.Length == 0)
        {
            return null;
        }

        string? last = null;
        foreach (var part in normalized.Split("::"))
        {
            if (part.Length > 0)
            {
                last = part;
            }
        }

        if (last is null || CppNonTypeTokens.Contains(last))
        {
            return null;
        }

        return last;
    }

    // name-matcher.ts:699 cppLastSegment.
    private static string CppLastSegment(string name)
    {
        string? last = null;
        foreach (var part in name.Split("::"))
        {
            if (part.Length > 0)
            {
                last = part;
            }
        }

        return last ?? name;
    }

    // ── Extraction return-type lookup (name-matcher.ts:710 lookupCalleeReturnType) ──
    internal static string? LookupCalleeReturnType(string callee, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var method = callee;
        string cls = string.Empty;
        if (callee.Contains("::", StringComparison.Ordinal))
        {
            var parts = new List<string>();
            foreach (var p in callee.Split("::"))
            {
                if (p.Length > 0)
                {
                    parts.Add(p);
                }
            }

            method = parts.Count > 0 ? parts[^1] : callee;
            cls = parts.Count > 1 ? string.Join("::", parts.GetRange(0, parts.Count - 1)) : string.Empty;
        }

        var candidates = new List<CodeGraphNode>();
        foreach (var n in ctx.GetNodesByName(method))
        {
            if ((n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function) &&
                n.Language == lang && !string.IsNullOrEmpty(n.ReturnType))
            {
                candidates.Add(n);
            }
        }

        if (cls.Length > 0)
        {
            var want = cls + "::" + method;
            var suffixWant = "::" + want;
            foreach (var n in candidates)
            {
                if (n.QualifiedName == want ||
                    n.QualifiedName.EndsWith(suffixWant, StringComparison.Ordinal) ||
                    want.EndsWith("::" + n.QualifiedName, StringComparison.Ordinal))
                {
                    return n.ReturnType;
                }
            }

            return null;
        }

        foreach (var n in candidates)
        {
            if (n.Kind == CodeGraphNodeKind.Function)
            {
                return n.ReturnType;
            }
        }

        return null;
    }

    // name-matcher.ts:747 cppClassExists.
    private static bool CppClassExists(string name, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var last = CppLastSegment(name);
        foreach (var n in ctx.GetNodesByName(last))
        {
            if ((n.Kind == CodeGraphNodeKind.Class || n.Kind == CodeGraphNodeKind.Struct) && n.Language == lang)
            {
                return true;
            }
        }

        return false;
    }

    // ── C++ receiver-type inference (name-matcher.ts:633) ────────────────────
    internal static string? InferCppReceiverType(string receiverName, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx, int depth = 0)
    {
        var filePath = r.FilePath ?? string.Empty;
        var lines = ctx.GetFileLines(filePath);
        if (lines is null || lines.Count == 0)
        {
            return null;
        }

        var callLineIndex = Math.Max(0, Math.Min(lines.Count - 1, r.Line - 1));
        var escapedReceiver = EscapeRegexLiteral(receiverName);
        var receiverPattern = new Regex("\\b" + escapedReceiver + "\\b");
        var declaratorRegex = BuildDeclaratorRegex(escapedReceiver);

        for (var i = callLineIndex; i >= 0; i--)
        {
            var line = lines[i];
            if (line.Length == 0 || !receiverPattern.IsMatch(line))
            {
                continue;
            }

            var declaratorMatch = declaratorRegex.Match(line);
            if (declaratorMatch.Success)
            {
                var normalized = NormalizeCppTypeName(declaratorMatch.Groups[1].Value);
                if (normalized == "auto")
                {
                    var initType = InferCppAutoInitializerType(line, receiverName, r, ctx, depth);
                    if (initType != null)
                    {
                        return initType;
                    }
                }
                else if (!string.IsNullOrEmpty(normalized))
                {
                    return normalized;
                }
            }
        }

        var headerCandidates = new List<string>();
        foreach (var ext in new[] { ".h", ".hpp", ".hxx" })
        {
            var cand = CppSrcExtRegex().Replace(filePath, ext);
            if (cand != filePath && !headerCandidates.Contains(cand))
            {
                headerCandidates.Add(cand);
            }
        }

        foreach (var headerPath in headerCandidates)
        {
            if (!ctx.FileExists(headerPath))
            {
                continue;
            }

            var headerLines = ctx.GetFileLines(headerPath);
            if (headerLines is null)
            {
                continue;
            }

            foreach (var line in headerLines)
            {
                if (!receiverPattern.IsMatch(line))
                {
                    continue;
                }

                var declaratorMatch = declaratorRegex.Match(line);
                if (!declaratorMatch.Success)
                {
                    continue;
                }

                var normalized = NormalizeCppTypeName(declaratorMatch.Groups[1].Value);
                if (!string.IsNullOrEmpty(normalized) && normalized != "auto")
                {
                    return normalized;
                }
            }
        }

        return null;
    }

    // name-matcher.ts:627 buildDeclaratorRegex.
    private static Regex BuildDeclaratorRegex(string escapedReceiver) =>
        new("([A-Za-z_][\\w:]*(?:\\s*<[^;=(){}]+>)?(?:\\s*[*&]+)?)\\s*\\b" + escapedReceiver + "\\b\\s*(?=[;=,)\\[{(]|$)");

    // name-matcher.ts:802 inferCppAutoInitializerType.
    private static string? InferCppAutoInitializerType(string line, string receiverName, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx, int depth)
    {
        var escaped = EscapeRegexLiteral(receiverName);
        var m = new Regex("\\b" + escaped + "\\b\\s*=\\s*([^;]+)").Match(line);
        if (!m.Success || m.Groups[1].Value.Length == 0)
        {
            return null;
        }

        var init = m.Groups[1].Value.Trim();

        var neu = CppNewRegex().Match(init);
        if (neu.Success && neu.Groups[1].Value.Length > 0)
        {
            return CppLastSegment(neu.Groups[1].Value);
        }

        var call = CppCallRegex().Match(init);
        if (call.Success && call.Groups[1].Value.Length > 0)
        {
            return ResolveCppCallResultType(WhitespaceRegex().Replace(call.Groups[1].Value, string.Empty), r, ctx, depth + 1);
        }

        return null;
    }

    // name-matcher.ts:765 resolveCppCallResultType.
    internal static string? ResolveCppCallResultType(string inner, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx, int depth = 0)
    {
        if (depth > 3)
        {
            return null;
        }

        var expr = inner.Trim();

        var make = MakeSharedRegex().Match(expr);
        if (make.Success)
        {
            return make.Groups[1].Value.Length > 0 ? make.Groups[1].Value : null;
        }

        var dotIdx = expr.LastIndexOf('.');
        if (dotIdx > 0)
        {
            var recv = expr[..dotIdx];
            var method = expr[(dotIdx + 1)..];
            if (recv.Contains('.') || recv.Contains('(') || recv.Contains("::", StringComparison.Ordinal))
            {
                return null; // single level only
            }

            var recvType = InferCppReceiverType(recv, r, ctx, depth + 1);
            if (recvType is null)
            {
                return null;
            }

            return LookupCalleeReturnType(recvType + "::" + method, r, ctx);
        }

        var ret = LookupCalleeReturnType(expr, r, ctx);
        if (ret != null)
        {
            return ret;
        }

        if (CppClassExists(expr, r, ctx))
        {
            return CppLastSegment(expr);
        }

        return null;
    }

    // ── Java field receiver inference (name-matcher.ts:1006) ─────────────────
    internal static string? InferJavaFieldReceiverType(string receiverName, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var inFile = ctx.GetNodesInFile(r.FilePath ?? string.Empty);
        if (inFile.Count == 0)
        {
            return null;
        }

        CodeGraphNode? enclosing = null;
        foreach (var n in inFile)
        {
            if (n.Kind != CodeGraphNodeKind.Class && n.Kind != CodeGraphNodeKind.Interface)
            {
                continue;
            }

            if (n.Language != lang)
            {
                continue;
            }

            if (n.StartLine <= r.Line && n.EndLine >= r.Line)
            {
                if (enclosing is null || n.StartLine >= enclosing.StartLine)
                {
                    enclosing = n;
                }
            }
        }

        if (enclosing is null)
        {
            return null;
        }

        var enclosingEnd = enclosing.EndLine;
        CodeGraphNode? field = null;
        foreach (var n in inFile)
        {
            if (n.Kind == CodeGraphNodeKind.Field &&
                n.Name == receiverName &&
                n.Language == lang &&
                n.StartLine >= enclosing.StartLine &&
                n.EndLine <= enclosingEnd)
            {
                field = n;
                break;
            }
        }

        if (field is null || string.IsNullOrEmpty(field.Signature))
        {
            return null;
        }

        var sig = field.Signature;
        // Signature shape: "<TypeName> <fieldName>". slice(0, lastIndexOf(name)) —
        // faithful to JS slice(0, -1) when the name isn't found (drops last char).
        var nameIdx = sig.LastIndexOf(field.Name, StringComparison.Ordinal);
        var sliceEnd = nameIdx >= 0 ? nameIdx : sig.Length - 1;
        if (sliceEnd < 0)
        {
            sliceEnd = 0;
        }

        var typeRaw = sig[..sliceEnd].Trim();
        if (typeRaw.Length == 0)
        {
            return null;
        }

        var typeNoGenerics = GenericsAngleRegex().Replace(typeRaw, string.Empty).Trim();
        var typeNoArray = VarargsRegex().Replace(ArrayBracketsRegex().Replace(typeNoGenerics, string.Empty), string.Empty).Trim();
        string? lastPart = null;
        foreach (var p in DotSpaceSplitRegex().Split(typeNoArray))
        {
            if (p.Length > 0)
            {
                lastPart = p;
            }
        }

        if (lastPart is null || lastPart.Length == 0)
        {
            return null;
        }

        if (!(lastPart[0] >= 'A' && lastPart[0] <= 'Z'))
        {
            return null; // primitives / lowercase → skip
        }

        return lastPart;
    }

    // ── Local-variable receiver inference (name-matcher.ts:1261) ─────────────
    internal static string? InferLocalReceiverType(string receiverName, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var scanReceiver = receiverName;
        var componentScoped = false;
        if (lang == CodeGraphLanguage.Cfml || lang == CodeGraphLanguage.CfScript)
        {
            var scoped = CfmlScopeRegex().Match(receiverName);
            if (scoped.Success)
            {
                scanReceiver = scoped.Groups[2].Value;
                var scope = scoped.Groups[1].Value.ToLowerInvariant();
                componentScoped = scope == "variables" || scope == "this";
            }
        }

        var phpProperty = false;
        if (lang == CodeGraphLanguage.Php)
        {
            var scoped = PhpThisScopeRegex().Match(receiverName);
            if (scoped.Success)
            {
                scanReceiver = scoped.Groups[1].Value;
                componentScoped = true;
                phpProperty = true;
            }
        }

        var escapedReceiver = EscapeRegexLiteral(scanReceiver);
        var patterns = phpProperty
            ? PhpPropertyTypePatterns(escapedReceiver)
            : LocalReceiverTypePatterns(lang, escapedReceiver);
        if (patterns.Count == 0)
        {
            return null;
        }

        var lines = ctx.GetFileLines(r.FilePath ?? string.Empty);
        if (lines is null || lines.Count == 0)
        {
            return null;
        }

        var callIdx = Math.Max(0, Math.Min(lines.Count - 1, r.Line - 1));
        var startIdx = componentScoped ? 0 : Math.Max(0, EnclosingScopeStartLine(r, ctx) - 1);

        // Nearest declaration wins: scan backward from the call to the scope start.
        for (var i = callIdx; i >= startIdx; i--)
        {
            var type = MatchReceiverLine(lines, patterns, i);
            if (type != null)
            {
                return type;
            }
        }

        // A component-scoped field's declaration is position-independent — sweep
        // the remainder of the file too.
        if (componentScoped)
        {
            for (var i = callIdx + 1; i < lines.Count; i++)
            {
                var type = MatchReceiverLine(lines, patterns, i);
                if (type != null)
                {
                    return type;
                }
            }
        }

        // A PHP property with no statically-typed declaration — follow the
        // `$this->prop = $var` assignment to the assigned variable's own type.
        if (phpProperty)
        {
            return InferPhpAssignedPropertyType(escapedReceiver, lines, callIdx);
        }

        return null;
    }

    private static string? MatchReceiverLine(IReadOnlyList<string> lines, List<Regex> patterns, int i)
    {
        var line = lines[i];
        if (line.Length == 0 || line.Length > 10_000)
        {
            return null;
        }

        foreach (var re in patterns)
        {
            var m = re.Match(line);
            if (m.Success && m.Groups[1].Value.Length > 0)
            {
                var type = NormalizeInferredTypeName(m.Groups[1].Value);
                if (type != null)
                {
                    return type;
                }
            }
        }

        return null;
    }

    // name-matcher.ts:1242 enclosingScopeStartLine.
    private static int EnclosingScopeStartLine(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var start = 1;
        foreach (var n in ctx.GetNodesInFile(r.FilePath ?? string.Empty))
        {
            if (n.Kind != CodeGraphNodeKind.Function && n.Kind != CodeGraphNodeKind.Method)
            {
                continue;
            }

            if (n.Language != lang)
            {
                continue;
            }

            if (n.StartLine <= r.Line && n.EndLine >= r.Line && n.StartLine >= start)
            {
                start = n.StartLine;
            }
        }

        return start;
    }

    // name-matcher.ts:1400 inferPhpAssignedPropertyType.
    private static string? InferPhpAssignedPropertyType(string escapedProp, IReadOnlyList<string> lines, int callIdx)
    {
        var assignRe = new Regex("\\$this->" + escapedProp + "\\b\\s*=\\s*\\$(\\w+)\\b");

        var assignIdx = -1;
        string? varName = null;
        for (var i = callIdx; i >= 0; i--)
        {
            var line = lines[i];
            if (line.Length == 0 || line.Length > 10_000)
            {
                continue;
            }

            var m = assignRe.Match(line);
            if (m.Success)
            {
                assignIdx = i;
                varName = m.Groups[1].Value;
                break;
            }
        }

        if (varName is null)
        {
            for (var i = callIdx + 1; i < lines.Count; i++)
            {
                var line = lines[i];
                if (line.Length == 0 || line.Length > 10_000)
                {
                    continue;
                }

                var m = assignRe.Match(line);
                if (m.Success)
                {
                    assignIdx = i;
                    varName = m.Groups[1].Value;
                    break;
                }
            }
        }

        if (varName is null)
        {
            return null;
        }

        var varPatterns = LocalReceiverTypePatterns(CodeGraphLanguage.Php, EscapeRegexLiteral(varName));
        for (var i = assignIdx; i >= 0; i--)
        {
            var line = lines[i];
            if (line.Length <= 10_000)
            {
                foreach (var re in varPatterns)
                {
                    var m = re.Match(line);
                    if (m.Success && m.Groups[1].Value.Length > 0)
                    {
                        var type = NormalizeInferredTypeName(m.Groups[1].Value);
                        if (type != null)
                        {
                            return type;
                        }
                    }
                }
            }

            if (FunctionKwRegex().IsMatch(line))
            {
                break;
            }
        }

        return null;
    }

    // name-matcher.ts:1380 phpPropertyTypePatterns.
    private static List<Regex> PhpPropertyTypePatterns(string r) => new()
    {
        new Regex("\\b(?:(?:private|protected|public|readonly|static|final)(?:\\(set\\))?\\s+)+\\??([A-Za-z_\\\\][\\w\\\\]*)\\s+&?\\$" + r + "\\b"),
        new Regex("\\$this->" + r + "\\b\\s*=\\s*new\\s+([A-Za-z_\\\\][\\w\\\\]*)")
    };

    // name-matcher.ts:1093 localReceiverTypePatterns — per-language table. `r` is
    // the already-escaped receiver name. Ordered most-specific first.
    private static List<Regex> LocalReceiverTypePatterns(string language, string r)
    {
        switch (language)
        {
            case CodeGraphLanguage.TypeScript:
            case CodeGraphLanguage.JavaScript:
            case CodeGraphLanguage.Tsx:
            case CodeGraphLanguage.Jsx:
            case CodeGraphLanguage.ArkTs:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*new\\s+([A-Za-z_$][\\w.$]*)"),
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w.$]*)")
                };
            case CodeGraphLanguage.Python:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\("),
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w.]*)")
                };
            case CodeGraphLanguage.Java:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)"),
                    new("\\b([A-Z][\\w.]*)\\s+" + r + "\\b\\s*[=;,)]")
                };
            case CodeGraphLanguage.Kotlin:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\("),
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w.]*)")
                };
            case CodeGraphLanguage.CSharp:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)"),
                    new("\\b([A-Z][\\w.]*)\\s+" + r + "\\b\\s*[=;,)]")
                };
            case CodeGraphLanguage.Swift:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\("),
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w.]*)")
                };
            case CodeGraphLanguage.Rust:
                return new List<Regex>
                {
                    new("\\blet\\s+(?:mut\\s+)?" + r + "\\b(?:\\s*:[^=]+)?=\\s*&?(?:mut\\s+)?([A-Z][\\w]*)"),
                    new("\\b" + r + "\\s*:\\s*&?(?:mut\\s+)?([A-Z][\\w]*)")
                };
            case CodeGraphLanguage.Go:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*:=\\s*&?([A-Za-z_][\\w.]*)\\s*{"),
                    new("\\bvar\\s+" + r + "\\s+\\*?([A-Za-z_][\\w.]*)"),
                    new("\\b" + r + "\\s+\\*?([A-Z][\\w.]*)")
                };
            case CodeGraphLanguage.Ruby:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w:]*)\\.new\\b")
                };
            case CodeGraphLanguage.Scala:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*(?:new\\s+)?([A-Z][\\w.]*)"),
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w.]*)")
                };
            case CodeGraphLanguage.Dart:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w.]*)\\s*\\("),
                    new("\\b([A-Z][\\w.]*)\\s+" + r + "\\b\\s*[=;,)]")
                };
            case CodeGraphLanguage.Php:
                return new List<Regex>
                {
                    new("\\$?" + r + "\\b\\s*=\\s*new\\s+([A-Za-z_\\\\][\\w\\\\]*)"),
                    new("\\b([A-Za-z_\\\\][\\w\\\\]*)\\s+&?\\$" + r + "\\b")
                };
            case CodeGraphLanguage.Lua:
            case CodeGraphLanguage.Luau:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w]*)\\.new\\b"),
                    new("\\b" + r + "\\b\\s*=\\s*([A-Z][\\w]*)\\s*\\("),
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w.]*)(?![\\w.]|\\s*[({\"'\\[])")
                };
            case CodeGraphLanguage.R:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*(?:<-|<<-|=)\\s*([A-Z][\\w.]*)\\$new\\b")
                };
            case CodeGraphLanguage.Pascal:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*:\\s*([A-Z][\\w]*)"),
                    new("\\b" + r + "\\b\\s*:=\\s*([A-Z][\\w.]*)\\.Create\\b")
                };
            case CodeGraphLanguage.Cfml:
            case CodeGraphLanguage.CfScript:
                return new List<Regex>
                {
                    new("\\b" + r + "\\b\\s*=\\s*new\\s+([A-Za-z_][\\w.]*)"),
                    new("\\b" + r + "\\b\\s*=\\s*[Cc]reate[Oo]bject\\s*\\(\\s*[\"']component[\"']\\s*,\\s*[\"']([\\w.]+)[\"']"),
                    new("\\b" + r + "\\b\\s*=\\s*[Cc]reate[Oo]bject\\s*\\(\\s*[\"']([\\w.]+)[\"']\\s*\\)"),
                    new("\\b([A-Z][\\w.]*)\\s+" + r + "\\b\\s*[=;,)]"),
                    new("\\bcfargument[^>\\n]*\\bname\\s*=\\s*[\"']" + r + "[\"'][^>\\n]*\\btype\\s*=\\s*[\"']([\\w.]+)[\"']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
                    new("\\bcfargument[^>\\n]*\\btype\\s*=\\s*[\"']([\\w.]+)[\"'][^>\\n]*\\bname\\s*=\\s*[\"']" + r + "[\"']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
                    new("\\b(?:cf)?property\\b[^;\\n]*\\bname\\s*=\\s*[\"']" + r + "[\"'][^;\\n]*\\b(?:type|inject)\\s*=\\s*[\"']([\\w.]+)[\"']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant),
                    new("\\b(?:cf)?property\\b[^;\\n]*\\b(?:type|inject)\\s*=\\s*[\"']([\\w.]+)[\"'][^;\\n]*\\bname\\s*=\\s*[\"']" + r + "[\"']", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                };
            default:
                return new List<Regex>();
        }
    }

    // ── Fixed patterns ([GeneratedRegex]) ────────────────────────────────────
    [GeneratedRegex(@"<[^>]*>")]
    private static partial Regex GenericsAngleRegex();

    [GeneratedRegex(@"[&*]")]
    private static partial Regex RefPtrRegex();

    [GeneratedRegex(@"[&*]+")]
    private static partial Regex RefPtrPlusRegex();

    [GeneratedRegex(@"\b(const|volatile|mutable|typename|class|struct)\b")]
    private static partial Regex CppCvQualifiersRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"[.:]+")]
    private static partial Regex DotColonSplitRegex();

    [GeneratedRegex(@"\[\s*\]")]
    private static partial Regex ArrayBracketsRegex();

    [GeneratedRegex(@"\.\.\.$")]
    private static partial Regex VarargsRegex();

    [GeneratedRegex(@"[.\s]+")]
    private static partial Regex DotSpaceSplitRegex();

    [GeneratedRegex(@"\.(?:c|cc|cpp|cxx)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CppSrcExtRegex();

    [GeneratedRegex(@"(?:^|::)(?:make_unique|make_shared)\s*<\s*([A-Za-z_]\w*)")]
    private static partial Regex MakeSharedRegex();

    [GeneratedRegex(@"^new\s+([A-Za-z_][\w:]*)")]
    private static partial Regex CppNewRegex();

    [GeneratedRegex(@"^([A-Za-z_][\w:]*(?:\s*<[^>;]*>)?)\s*\(")]
    private static partial Regex CppCallRegex();

    [GeneratedRegex(@"\bfunction\b")]
    private static partial Regex FunctionKwRegex();

    [GeneratedRegex(@"^(variables|this|local|arguments)\.(.+)$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CfmlScopeRegex();

    [GeneratedRegex(@"^this->(.+)$")]
    private static partial Regex PhpThisScopeRegex();
}
