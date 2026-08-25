// =============================================================================
// CodeGraphCExtractor — C language config. Port of the `cExtractor` half of
// extraction/languages/c-cpp.ts.
//
// C has no classes or methods: functions are top-level `function_definition`s,
// struct/enum are `struct_specifier`/`enum_specifier`, and typedefs are
// `type_definition`. The function/struct/enum name lives in a `declarator` field
// (NameField), which the engine's name walk unwraps through pointer/reference/
// function declarators. Return-type normalization and `#include` extraction are the
// C-family shared helpers (CodeGraphCFamilyExtraction).
//
// DEFERRED (analysis/01 §7, MVP scope): the CUDA content-gated preParse and the
// universal macro-mangled-name recovery — both exotic framework surface — are left
// unset. A well-formed C translation unit needs neither.
// =============================================================================
internal static class CodeGraphCExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_definition"],
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = ["struct_specifier"],
        EnumTypes = ["enum_specifier"],
        EnumMemberTypes = ["enumerator"],
        TypeAliasTypes = ["type_definition"], // typedef
        ImportTypes = ["preproc_include"],
        CallTypes = ["call_expression"],
        VariableTypes = ["declaration"],
        NameField = "declarator",
        BodyField = "body",
        ParamsField = "parameters",

        IsConst = CodeGraphCFamilyExtraction.IsConstDeclaration,
        GetReturnType = CodeGraphCFamilyExtraction.ExtractReturnType,
        ResolveTypeAliasKind = CodeGraphCFamilyExtraction.ResolveTypedefKind,
        ExtractImport = CodeGraphCFamilyExtraction.ExtractInclude
    };
}
