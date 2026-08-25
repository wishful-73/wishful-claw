// =============================================================================
// CodeGraphLanguageFamily — the LANGUAGE_FAMILY disambiguation table + its three
// predicates (name-matcher.ts:140-178). Core-owned (this slice) rather than living
// on the NameMatcher, because the resolver's gateLanguage / gateFrameworkLanguage
// need them BEFORE the Match slice lands. The Match slice's name-matcher MUST reuse
// these (do not redefine sameLanguageFamily / crossesKnownFamily).
//
// Families: jvm (java/kotlin/scala), apple (swift/objc), web (ts/tsx/js/jsx/arkts),
// c (c/cpp), dotnet (csharp/razor). Every other language is a singleton family —
// isKnownFamily returns false so config<->code framework bridges (whose config side
// — yaml/blade/... — is never a known programming-language family) are left out of
// the cross-family gate.
// =============================================================================
internal static class CodeGraphLanguageFamily
{
    // language id (CodeGraphLanguage.*) -> family tag. Ordinal-keyed; verbatim from
    // name-matcher.ts LANGUAGE_FAMILY. ArkTS is a TS superset so it joins `web`.
    private static readonly Dictionary<string, string> Family = new(StringComparer.Ordinal)
    {
        { CodeGraphLanguage.Java, "jvm" },
        { CodeGraphLanguage.Kotlin, "jvm" },
        { CodeGraphLanguage.Scala, "jvm" },
        { CodeGraphLanguage.Swift, "apple" },
        { CodeGraphLanguage.ObjC, "apple" },
        { CodeGraphLanguage.TypeScript, "web" },
        { CodeGraphLanguage.Tsx, "web" },
        { CodeGraphLanguage.JavaScript, "web" },
        { CodeGraphLanguage.Jsx, "web" },
        { CodeGraphLanguage.ArkTs, "web" },
        { CodeGraphLanguage.C, "c" },
        { CodeGraphLanguage.Cpp, "c" },
        { CodeGraphLanguage.CSharp, "dotnet" },
        { CodeGraphLanguage.Razor, "dotnet" }
    };

    // Same exact language, OR both in the same known multi-language family.
    public static bool SameFamily(string a, string b)
    {
        if (a == b)
        {
            return true;
        }

        return Family.TryGetValue(a, out var fa) && Family.TryGetValue(b, out var fb) && fa == fb;
    }

    // True when `lang` belongs to a known multi-language family (jvm/apple/web/c/
    // dotnet). Singleton-family languages (php/python/go/ruby/rust/...) and config
    // formats return false.
    public static bool IsKnownFamily(string lang) => Family.ContainsKey(lang);

    // True when `a` and `b` are two DIFFERENT *known* families — the signature of a
    // coincidental cross-language name collision. Deliberately weaker than
    // !SameFamily: a singleton-family language (vue/svelte own tag, or php/go/...)
    // returns false and is left alone.
    public static bool CrossesKnownFamily(string a, string b) =>
        IsKnownFamily(a) && IsKnownFamily(b) && !SameFamily(a, b);
}
