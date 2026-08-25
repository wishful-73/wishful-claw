using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphFunctionRef — function-as-value capture (#756) + the two end-of-file
// flushes, both LIVE: CodeGraphTreeSitterExtractor calls FlushFnRefCandidates() +
// FlushValueRefs() at end-of-file, pinned by ExtractionTests (analysis/01 §7):
//
//   * function-refs — a function/method NAME used as a VALUE (passed as a call
//     argument, assigned to a field/pointer, placed in a struct/object/table
//     initializer). Captured during the walk as candidates, GATED and flushed at
//     end-of-file into `function_ref` unresolvedReferences (analysis/01 §2.1, §7).
//     Table-driven per language (FN_REF_SPECS) — value positions and wrapper
//     forms differ per grammar. Port of extraction/function-ref.ts +
//     tree-sitter.ts maybeCaptureFnRefs/scanFnRefSubtree/flushFnRefCandidates.
//
//   * value-refs — same-file reads of a file/class/module-scope const/var become
//     `references` edges carrying metadata {valueRef:true}, so impact analysis
//     catches value consumers ("change this table, affect its readers"). Port of
//     tree-sitter.ts captureValueRefScope/flushValueRefs.
//
// Split into two shapes: the PURE capture layer (specs + candidate extraction, a
// static class) and the ENGINE-INTEGRATED flushes (a `partial` of
// CodeGraphTreeSitterExtractor, so they reach the engine's node/edge/ref lists,
// scope stack, and language config directly — same as the TS methods on the class).
// =============================================================================

// -----------------------------------------------------------------------------
// Capture-layer value types (function-ref.ts §36-118).
// -----------------------------------------------------------------------------

/// <summary>How to pull candidate value nodes out of a dispatched container node.</summary>
internal enum CodeGraphCaptureMode
{
    Args,    // every named child is a potential value (call argument lists)
    Rhs,     // the assignment right-hand side (named field, else last named child)
    Value,   // the `value` of a keyed pair (object/struct/table initializers)
    List,    // every named child (array / initializer-list / table positional elems)
    VarInit  // a variable declarator's initializer value
}

/// <summary>Container node type → how to extract candidate values from it.</summary>
internal readonly record struct CodeGraphCaptureRule(CodeGraphCaptureMode Mode, string? Field = null);

/// <summary>Per-language capture spec (function-ref.ts FnRefSpec).</summary>
internal sealed class CodeGraphFnRefSpec
{
    /// <summary>Bare identifier node types that can act as a function value.</summary>
    public required HashSet<string> IdTypes { get; init; }

    /// <summary>Container node type → capture rule.</summary>
    public required Dictionary<string, CodeGraphCaptureRule> Dispatch { get; init; }

    /// <summary>Transparent wrapper layers → field to descend into (null = named children).</summary>
    public Dictionary<string, string?>? Layers { get; init; }

    /// <summary>Unary wrappers whose operand is the value (&amp;fn / @Fn / `fn _`) → operand field (null = first named child).</summary>
    public Dictionary<string, string?>? Unwrap { get; init; }

    /// <summary>Whole-node reference forms needing bespoke name extraction.</summary>
    public HashSet<string>? Special { get; init; }

    /// <summary>Capture modes whose candidates skip the same-file/import gate (C-family file-scope initializers).</summary>
    public HashSet<CodeGraphCaptureMode>? UngatedModes { get; init; }

    /// <summary>C++ only: in args/rhs/varinit accept ONLY explicit reference forms, never bare identifiers.</summary>
    public bool AddressOfOnly { get; init; }
}

/// <summary>A captured function-as-value candidate (before the end-of-file gate).</summary>
internal readonly record struct CodeGraphFnRefCandidate(
    string Name,
    int Line,
    int Column,
    CodeGraphCaptureMode Mode,
    bool ExplicitRef,
    bool SkipGate);

/// <summary>One normalized function-value: its name, source node, and gate policy.</summary>
internal readonly record struct CodeGraphNormalizedRef(string Name, CodeGraphTsNode Node, bool SkipGate = false);

// -----------------------------------------------------------------------------
// The pure capture layer.
// -----------------------------------------------------------------------------
internal static partial class CodeGraphFunctionRef
{
    /// <summary>Names that are never function references even when grammars call them identifiers.</summary>
    private static readonly HashSet<string> NameStoplist = new()
    {
        "this", "self", "super", "null", "nil", "true", "false", "undefined",
        "new", "NULL", "nullptr", "None"
    };

    /// <summary>PHP core functions whose string arguments are CALLABLES (positional prior).</summary>
    private static readonly HashSet<string> PhpCallableHofs = new()
    {
        "array_map", "array_filter", "array_walk", "array_walk_recursive", "array_reduce",
        "usort", "uasort", "uksort",
        "array_udiff", "array_udiff_assoc", "array_uintersect", "array_uintersect_assoc",
        "call_user_func", "call_user_func_array",
        "forward_static_call", "forward_static_call_array",
        "preg_replace_callback", "preg_replace_callback_array",
        "register_shutdown_function", "register_tick_function",
        "set_error_handler", "set_exception_handler", "spl_autoload_register",
        "ob_start", "iterator_apply", "header_register_callback",
        "is_callable"
    };

    /// <summary>Rails/ActiveSupport hook DSLs whose symbol arguments name a method of the enclosing class.</summary>
    private static readonly HashSet<string> RubyHookNames = new()
    {
        "validate", "set_callback", "helper_method", "rescue_from"
    };

    // ------- Per-language specs (function-ref.ts §141-398). -------

    /// <summary>C / C++ / Objective-C share the C-family initializer &amp; assignment shapes.</summary>
    private static CodeGraphFnRefSpec CFamilySpec(string[]? special = null, bool addressOfOnly = false) => new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["argument_list"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["init_declarator"] = new(CodeGraphCaptureMode.VarInit, "value"),
            ["initializer_list"] = new(CodeGraphCaptureMode.List),
            ["initializer_pair"] = new(CodeGraphCaptureMode.Value, "value")
        },
        Unwrap = new Dictionary<string, string?> { ["pointer_expression"] = "argument" },
        Special = new HashSet<string>(special ?? Array.Empty<string>()),
        // Only file-scope struct/array initializers bypass the gate (see flushFnRefCandidates).
        UngatedModes = new HashSet<CodeGraphCaptureMode> { CodeGraphCaptureMode.Value, CodeGraphCaptureMode.List },
        AddressOfOnly = addressOfOnly
    };

    private static readonly CodeGraphFnRefSpec TsJsSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["variable_declarator"] = new(CodeGraphCaptureMode.VarInit, "value"),
            ["pair"] = new(CodeGraphCaptureMode.Value, "value"),
            ["array"] = new(CodeGraphCaptureMode.List)
        },
        Special = new HashSet<string> { "member_expression" }
    };

    private static readonly CodeGraphFnRefSpec PythonSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["argument_list"] = new(CodeGraphCaptureMode.Args),
            ["assignment"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["keyword_argument"] = new(CodeGraphCaptureMode.Value, "value"), // Thread(target=worker)
            ["pair"] = new(CodeGraphCaptureMode.Value, "value"),
            ["list"] = new(CodeGraphCaptureMode.List)
        },
        Special = new HashSet<string> { "attribute" }
    };

    private static readonly CodeGraphFnRefSpec GoSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["argument_list"] = new(CodeGraphCaptureMode.Args),
            ["assignment_statement"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["short_var_declaration"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["var_spec"] = new(CodeGraphCaptureMode.VarInit, "value"),
            ["keyed_element"] = new(CodeGraphCaptureMode.Value), // value = last literal_element child
            ["literal_value"] = new(CodeGraphCaptureMode.List)   // positional composite literals
        },
        Layers = new Dictionary<string, string?>
        {
            ["literal_element"] = null,
            ["expression_list"] = null
        }
    };

    private static readonly CodeGraphFnRefSpec RustSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["field_initializer"] = new(CodeGraphCaptureMode.Value, "value"),
            ["array_expression"] = new(CodeGraphCaptureMode.List),
            ["static_item"] = new(CodeGraphCaptureMode.VarInit, "value"),
            ["let_declaration"] = new(CodeGraphCaptureMode.VarInit, "value")
        }
    };

    private static readonly CodeGraphFnRefSpec JavaSpec = new()
    {
        // No bare-identifier function values in Java — only method references.
        IdTypes = new HashSet<string>(),
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["argument_list"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["variable_declarator"] = new(CodeGraphCaptureMode.VarInit, "value")
        },
        Special = new HashSet<string> { "method_reference" }
    };

    private static readonly CodeGraphFnRefSpec KotlinSpec = new()
    {
        IdTypes = new HashSet<string>(),
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["value_arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment"] = new(CodeGraphCaptureMode.Rhs) // RHS = last named child (no field in grammar)
        },
        Layers = new Dictionary<string, string?> { ["value_argument"] = null },
        Special = new HashSet<string> { "callable_reference", "navigation_expression" }
    };

    private static readonly CodeGraphFnRefSpec CSharpSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["argument_list"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"), // covers `+=` event subscription
            ["initializer_expression"] = new(CodeGraphCaptureMode.List),
            ["variable_declarator"] = new(CodeGraphCaptureMode.VarInit)
        },
        Layers = new Dictionary<string, string?> { ["argument"] = null },
        Special = new HashSet<string> { "member_access_expression" }
    };

    private static readonly CodeGraphFnRefSpec RubySpec = new()
    {
        // Bare identifiers in Ruby args are method CALLS or locals — only the
        // `method(:name)` idiom plus hook-DSL symbols qualify.
        IdTypes = new HashSet<string>(),
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["argument_list"] = new(CodeGraphCaptureMode.Args),
            ["pair"] = new(CodeGraphCaptureMode.Value, "value")
        },
        Layers = new Dictionary<string, string?> { ["block_argument"] = null },
        Special = new HashSet<string> { "call", "simple_symbol" }
    };

    private static readonly CodeGraphFnRefSpec SwiftSpec = new()
    {
        IdTypes = new HashSet<string> { "simple_identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["value_arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment"] = new(CodeGraphCaptureMode.Rhs, "result"),
            ["array_literal"] = new(CodeGraphCaptureMode.List),
            ["property_declaration"] = new(CodeGraphCaptureMode.VarInit, "value")
        },
        Layers = new Dictionary<string, string?> { ["value_argument"] = "value" },
        Special = new HashSet<string> { "selector_expression" }
    };

    private static readonly CodeGraphFnRefSpec ScalaSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["val_definition"] = new(CodeGraphCaptureMode.VarInit, "value")
        },
        Unwrap = new Dictionary<string, string?> { ["postfix_expression"] = null } // eta-expansion `fn _`
    };

    private static readonly CodeGraphFnRefSpec DartSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment_expression"] = new(CodeGraphCaptureMode.Rhs, "right"),
            ["pair"] = new(CodeGraphCaptureMode.Value, "value"),
            ["list_literal"] = new(CodeGraphCaptureMode.List),
            ["static_final_declaration"] = new(CodeGraphCaptureMode.VarInit)
        },
        Layers = new Dictionary<string, string?> { ["argument"] = null }
    };

    private static readonly CodeGraphFnRefSpec LuaSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["arguments"] = new(CodeGraphCaptureMode.Args),
            ["assignment_statement"] = new(CodeGraphCaptureMode.Rhs), // RHS expression_list children carry `value`
            ["field"] = new(CodeGraphCaptureMode.Value, "value")      // table fields, keyed AND positional
        },
        Layers = new Dictionary<string, string?> { ["expression_list"] = null }
    };

    private static readonly CodeGraphFnRefSpec PascalSpec = new()
    {
        IdTypes = new HashSet<string> { "identifier" },
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["exprArgs"] = new(CodeGraphCaptureMode.Args),
            ["assignment"] = new(CodeGraphCaptureMode.Rhs, "rhs") // OnClick := Handler
        },
        Unwrap = new Dictionary<string, string?> { ["exprUnary"] = "operand" } // @Handler
    };

    private static readonly CodeGraphFnRefSpec PhpSpec = new()
    {
        // PHP has no bare-identifier function values. What qualifies: a string
        // argument to a known callable-taking core function, or array callables.
        IdTypes = new HashSet<string>(),
        Dispatch = new Dictionary<string, CodeGraphCaptureRule>
        {
            ["arguments"] = new(CodeGraphCaptureMode.Args)
        },
        Layers = new Dictionary<string, string?> { ["argument"] = null },
        Special = new HashSet<string> { "encapsed_string", "string", "array_creation_expression" }
    };

    /// <summary>Capture specs by language (function-ref.ts FN_REF_SPECS).</summary>
    private static readonly Dictionary<string, CodeGraphFnRefSpec> FnRefSpecs = new()
    {
        [CodeGraphLanguage.C] = CFamilySpec(),
        [CodeGraphLanguage.Cpp] = CFamilySpec(addressOfOnly: true),
        [CodeGraphLanguage.ObjC] = CFamilySpec(special: new[] { "selector_expression" }),
        [CodeGraphLanguage.TypeScript] = TsJsSpec,
        [CodeGraphLanguage.Tsx] = TsJsSpec,
        [CodeGraphLanguage.JavaScript] = TsJsSpec,
        [CodeGraphLanguage.Jsx] = TsJsSpec,
        [CodeGraphLanguage.ArkTs] = TsJsSpec,
        [CodeGraphLanguage.Python] = PythonSpec,
        [CodeGraphLanguage.Go] = GoSpec,
        [CodeGraphLanguage.Rust] = RustSpec,
        [CodeGraphLanguage.Java] = JavaSpec,
        [CodeGraphLanguage.Kotlin] = KotlinSpec,
        [CodeGraphLanguage.CSharp] = CSharpSpec,
        [CodeGraphLanguage.Php] = PhpSpec,
        [CodeGraphLanguage.Ruby] = RubySpec,
        [CodeGraphLanguage.Swift] = SwiftSpec,
        [CodeGraphLanguage.Scala] = ScalaSpec,
        [CodeGraphLanguage.Dart] = DartSpec,
        [CodeGraphLanguage.Lua] = LuaSpec,
        [CodeGraphLanguage.Luau] = LuaSpec,
        [CodeGraphLanguage.Pascal] = PascalSpec
    };

    /// <summary>The capture spec for a language, or null when the language has none.</summary>
    internal static CodeGraphFnRefSpec? SpecFor(string language) =>
        FnRefSpecs.TryGetValue(language, out CodeGraphFnRefSpec? spec) ? spec : null;

    // ------- Capture (function-ref.ts §408-511). -------

    /// <summary>
    /// Extract candidate names from a dispatched container node. Returns the
    /// (name, position) pairs of every function-value-shaped expression found.
    /// </summary>
    internal static List<CodeGraphFnRefCandidate> CaptureFnRefCandidates(
        CodeGraphTsNode container, CodeGraphCaptureRule rule, CodeGraphFnRefSpec spec)
    {
        List<CodeGraphTsNode> valueNodes = new();

        switch (rule.Mode)
        {
            case CodeGraphCaptureMode.Args:
            case CodeGraphCaptureMode.List:
            {
                int count = container.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode child = container.NamedChild(i);
                    if (!child.IsNull) valueNodes.Add(child);
                }
                break;
            }
            case CodeGraphCaptureMode.Rhs:
            {
                CodeGraphTsNode rhs = rule.Field != null
                    ? container.ChildByField(rule.Field)
                    : container.NamedChild(container.NamedChildCount - 1);
                if (!rhs.IsNull)
                {
                    // Param-storage skip: `this.status = status` / `o->cb = cb` — when
                    // the assigned member's name EQUALS the RHS identifier, the RHS is a
                    // local/parameter being stored, and any function it holds is
                    // unknowable statically (a same-named function elsewhere resolves wrong).
                    CodeGraphTsNode lhs = container.ChildByField("left");
                    if (lhs.IsNull) lhs = container.ChildByField("lhs");
                    if (lhs.IsNull) lhs = container.ChildByField("target");
                    if (lhs.IsNull && container.NamedChildCount >= 2) lhs = container.NamedChild(0);
                    string lhsText = lhs.IsNull ? string.Empty : lhs.Text;
                    Match lm = TrailingIdentifierRegex().Match(lhsText);
                    string? lhsLastName = lm.Success ? lm.Groups[1].Value : null;
                    string rhsText = rhs.Text.Trim();
                    if (lhsLastName != null && lhsLastName == rhsText) break;
                    valueNodes.Add(rhs);
                }
                break;
            }
            case CodeGraphCaptureMode.Value:
            {
                CodeGraphTsNode value = rule.Field != null ? container.ChildByField(rule.Field) : default;
                // Keyed containers without a value field (Go keyed_element): the value
                // is the LAST named child (the first is the key).
                if (value.IsNull && container.NamedChildCount > 0)
                    value = container.NamedChild(container.NamedChildCount - 1);
                if (!value.IsNull) valueNodes.Add(value);
                break;
            }
            case CodeGraphCaptureMode.VarInit:
            {
                // Destructuring extracts DATA from the RHS — never a function alias.
                CodeGraphTsNode nameNode = container.ChildByField("name");
                if (nameNode.IsNull) nameNode = container.ChildByField("pattern");
                if (!nameNode.IsNull && nameNode.Type is "object_pattern" or "array_pattern"
                        or "tuple_pattern" or "struct_pattern")
                    break;
                if (rule.Field != null)
                {
                    CodeGraphTsNode value = container.ChildByField(rule.Field);
                    if (!value.IsNull) valueNodes.Add(value);
                }
                else
                {
                    // No value field in this grammar (C# variable_declarator, Dart
                    // static_final_declaration): the initializer is the last named child —
                    // but a declarator WITHOUT an initializer has its NAME there instead.
                    CodeGraphTsNode value = container.NamedChild(container.NamedChildCount - 1);
                    CodeGraphTsNode nameChild = container.ChildByField("name");
                    if (nameChild.IsNull) nameChild = container.ChildByField("pattern");
                    if (!value.IsNull && container.NamedChildCount >= 2 &&
                        (nameChild.IsNull || !NodesEqual(value, nameChild)))
                        valueNodes.Add(value);
                }
                break;
            }
        }

        List<CodeGraphFnRefCandidate> outList = new();
        foreach (CodeGraphTsNode v in valueNodes)
        {
            // A bare identifier normalizes without an unwrap/special reference form.
            bool explicitRef = !spec.IdTypes.Contains(v.Type);
            foreach (CodeGraphNormalizedRef nr in NormalizeValue(v, spec, 0))
            {
                if (string.IsNullOrEmpty(nr.Name) || NameStoplist.Contains(nr.Name)) continue;
                outList.Add(new CodeGraphFnRefCandidate(
                    Name: nr.Name,
                    Line: (int)nr.Node.StartPoint.Row + 1,
                    Column: (int)nr.Node.StartPoint.Column,
                    Mode: rule.Mode,
                    ExplicitRef: explicitRef,
                    SkipGate: nr.SkipGate));
            }
        }
        return outList;
    }

    /// <summary>
    /// Normalize one value expression to zero or more function names. Recursion is
    /// bounded (wrapper layers only); anything that isn't a recognized
    /// function-value shape yields [].
    /// </summary>
    private static List<CodeGraphNormalizedRef> NormalizeValue(CodeGraphTsNode node, CodeGraphFnRefSpec spec, int depth)
    {
        if (depth > 4) return new();
        string type = node.Type;

        // Bare identifier.
        if (spec.IdTypes.Contains(type))
            return new() { new CodeGraphNormalizedRef(node.Text, node) };

        // Transparent layers (argument, value_argument, literal_element, expression_list, …).
        if (spec.Layers != null && spec.Layers.TryGetValue(type, out string? layerField))
        {
            // Labeled-argument param-forward skip (Swift/Kotlin): `value: value` — when the
            // label EQUALS the value identifier, the value is a forwarded local/parameter.
            if (type == "value_argument")
            {
                CodeGraphTsNode label = node.ChildByField("name");
                CodeGraphTsNode value = node.ChildByField("value");
                if (value.IsNull) value = node.NamedChild(node.NamedChildCount - 1);
                if (!label.IsNull && !value.IsNull && label.Text.Trim() == value.Text.Trim())
                    return new();
            }
            if (layerField != null)
            {
                CodeGraphTsNode inner = node.ChildByField(layerField);
                return inner.IsNull ? new() : NormalizeValue(inner, spec, depth + 1);
            }
            List<CodeGraphNormalizedRef> results = new();
            int cc = node.NamedChildCount;
            for (int i = 0; i < cc; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (!child.IsNull) results.AddRange(NormalizeValue(child, spec, depth + 1));
            }
            return results;
        }

        // Unary wrappers: &fn / @Fn / `fn _`.
        if (spec.Unwrap != null && spec.Unwrap.TryGetValue(type, out string? unwrapField))
        {
            // C-family `pointer_expression` covers BOTH `&x` (a function value) and
            // `*x` (a data read). Only `&` qualifies.
            if (type == "pointer_expression")
            {
                CodeGraphTsNode c0 = node.Child(0);
                if (c0.IsNull || c0.Type != "&") return new();
            }
            CodeGraphTsNode inner = unwrapField != null ? node.ChildByField(unwrapField) : node.NamedChild(0);
            if (inner.IsNull) return new();
            // C++ `&Widget::on_click` — keep the QUALIFIED name.
            if (inner.Type == "qualified_identifier")
            {
                string text = inner.Text.Trim();
                return QualifiedIdentifierRegex().IsMatch(text)
                    ? new() { new CodeGraphNormalizedRef(text, inner) }
                    : new();
            }
            return NormalizeValue(inner, spec, depth + 1);
        }

        // Special whole-node reference forms.
        if (spec.Special != null && spec.Special.Contains(type))
            return NormalizeSpecial(node, type);

        return new();
    }

    private static List<CodeGraphNormalizedRef> NormalizeSpecial(CodeGraphTsNode node, string type)
    {
        switch (type)
        {
            // Java method references. Receiver decides the resolution route (#808).
            case "method_reference":
            {
                CodeGraphTsNode last = default;
                int cc = node.NamedChildCount;
                for (int i = 0; i < cc; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (!child.IsNull && child.Type == "identifier") last = child;
                }
                if (last.IsNull) return new();
                string m = last.Text;
                string text = node.Text;
                if (text.StartsWith("this::", StringComparison.Ordinal) ||
                    text.StartsWith("super::", StringComparison.Ordinal))
                    return new() { new CodeGraphNormalizedRef($"this.{m}", last) };
                Match recv = MethodRefReceiverRegex().Match(text);
                if (recv.Success)
                {
                    // `Type::new` (constructor ref) has no method node — drop via the stoplist.
                    return m == "new" ? new() : new() { new CodeGraphNormalizedRef($"{recv.Groups[1].Value}::{m}", last) };
                }
                return new();
            }

            // Kotlin `::targetCb` (one part) / `OtherClass::handle` (two parts).
            case "callable_reference":
            {
                CodeGraphTsNode receiver = default, member = default;
                int cc = node.NamedChildCount;
                for (int i = 0; i < cc; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (child.IsNull) continue;
                    if (child.Type == "type_identifier") receiver = child;
                    if (child.Type == "simple_identifier") member = child;
                }
                if (member.IsNull) return new();
                string m = member.Text;
                if (receiver.IsNull) return new() { new CodeGraphNormalizedRef(m, member) }; // ::topLevelFn
                string recvText = receiver.Text;
                return recvText.Length > 0 && char.IsAsciiLetterUpper(recvText[0])
                    ? new() { new CodeGraphNormalizedRef($"{recvText}::{m}", member) }
                    : new(); // variable::method — unknown receiver type
            }

            // Kotlin `this::fire` parses as navigation_expression with a `::fire` suffix.
            case "navigation_expression":
            {
                if (!node.Text.StartsWith("this::", StringComparison.Ordinal)) return new();
                int cc = node.NamedChildCount;
                for (int i = 0; i < cc; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (!child.IsNull && child.Type == "navigation_suffix" &&
                        child.Text.StartsWith("::", StringComparison.Ordinal))
                    {
                        CodeGraphTsNode id = child.NamedChild(child.NamedChildCount - 1);
                        if (!id.IsNull) return new() { new CodeGraphNormalizedRef($"this.{id.Text}", id) };
                    }
                }
                return new();
            }

            // Swift `#selector(Holder.fire)` → fire. ObjC `@selector(storeImage:)` verbatim.
            case "selector_expression":
            {
                CodeGraphTsNode inner = node.NamedChild(0);
                if (inner.IsNull) return new();
                if (inner.Type is "identifier" or "simple_identifier")
                    return new() { new CodeGraphNormalizedRef(inner.Text, inner) };
                CodeGraphTsNode last = LastNamedOfType(node, "simple_identifier");
                if (!last.IsNull) return new() { new CodeGraphNormalizedRef(last.Text, last) };
                return new() { new CodeGraphNormalizedRef(inner.Text.Trim(), inner) };
            }

            // Ruby `method(:target_cb)`.
            case "call":
            {
                CodeGraphTsNode method = node.ChildByField("method");
                if (method.IsNull || method.Text != "method") return new();
                CodeGraphTsNode args = node.ChildByField("arguments");
                if (args.IsNull || args.NamedChildCount != 1) return new();
                CodeGraphTsNode sym = args.NamedChild(0);
                if (sym.IsNull || sym.Type != "simple_symbol") return new();
                string name = StripLeadingColon(sym.Text);
                return string.IsNullOrEmpty(name) ? new() : new() { new CodeGraphNormalizedRef(name, sym) };
            }

            // `this.handleClick` (TS/JS) — object must be EXACTLY `this`.
            case "member_expression":
            {
                CodeGraphTsNode obj = node.ChildByField("object");
                CodeGraphTsNode prop = node.ChildByField("property");
                if (!obj.IsNull && !prop.IsNull && obj.Type == "this" && prop.Type == "property_identifier")
                    return new() { new CodeGraphNormalizedRef($"this.{prop.Text}", prop) };
                return new();
            }

            // `self.handle_click` (Python) — object must be EXACTLY `self`.
            case "attribute":
            {
                CodeGraphTsNode obj = node.ChildByField("object");
                CodeGraphTsNode attr = node.ChildByField("attribute");
                if (!obj.IsNull && !attr.IsNull && obj.Type == "identifier" && obj.Text == "self")
                    return new() { new CodeGraphNormalizedRef(attr.Text, attr) };
                return new();
            }

            // `this.Run0` (C#) — receiver must be EXACTLY `this` (two grammar shapes).
            case "member_access_expression":
            {
                CodeGraphTsNode name = node.ChildByField("name");
                if (name.IsNull) return new();
                CodeGraphTsNode expr = node.ChildByField("expression");
                bool isThisReceiver = !expr.IsNull
                    ? expr.Type is "this_expression" or "this"
                    : node.Text.StartsWith("this.", StringComparison.Ordinal);
                return isThisReceiver ? new() { new CodeGraphNormalizedRef(name.Text, name) } : new();
            }

            // PHP string callable — trustworthy ONLY as an argument to a known HOF.
            case "encapsed_string":
            case "string":
            {
                string? callee = PhpEnclosingCallName(node);
                if (callee == null || !PhpCallableHofs.Contains(callee)) return new();
                string? content = PhpStringContent(node);
                if (string.IsNullOrEmpty(content)) return new();
                if (PhpSimpleNameRegex().IsMatch(content))
                    return new() { new CodeGraphNormalizedRef(content, node, SkipGate: true) };
                if (PhpQualifiedNameRegex().IsMatch(content))
                    return new() { new CodeGraphNormalizedRef(content, node, SkipGate: true) };
                return new();
            }

            // PHP array callables: `[$this, 'method']` / `[Foo::class, 'method']`.
            case "array_creation_expression":
            {
                if (node.NamedChildCount != 2) return new();
                CodeGraphTsNode recvOuter = node.NamedChild(0);
                CodeGraphTsNode strOuter = node.NamedChild(1);
                CodeGraphTsNode recv = recvOuter.IsNull ? default : recvOuter.NamedChild(0);
                CodeGraphTsNode strEl = strOuter.IsNull ? default : strOuter.NamedChild(0);
                if (recv.IsNull || strEl.IsNull) return new();
                if (strEl.Type != "encapsed_string" && strEl.Type != "string") return new();
                string? member = PhpStringContent(strEl);
                if (member == null || !PhpSimpleNameRegex().IsMatch(member)) return new();
                if (recv.Type == "variable_name" && recv.Text == "$this")
                    return new() { new CodeGraphNormalizedRef($"this.{member}", strEl) };
                if (recv.Type == "class_constant_access_expression")
                {
                    CodeGraphTsNode cls = recv.NamedChild(0);
                    CodeGraphTsNode kw = recv.NamedChild(1);
                    if (!cls.IsNull && !kw.IsNull && kw.Text == "class")
                        return new() { new CodeGraphNormalizedRef($"{cls.Text}::{member}", strEl) };
                }
                return new();
            }

            // Ruby hook-DSL symbols (`before_action :authenticate`).
            case "simple_symbol":
            {
                CodeGraphTsNode call = RubyEnclosingCall(node);
                if (call.IsNull) return new();
                CodeGraphTsNode method = call.ChildByField("method");
                if (method.IsNull || !IsRubyHookCall(method.Text)) return new();
                string sym = StripLeadingColon(node.Text);
                if (!RubySymbolRegex().IsMatch(sym)) return new();
                return new() { new CodeGraphNormalizedRef($"this.{sym}", node) };
            }

            default:
                return new();
        }
    }

    // ------- Pure helpers. -------

    /// <summary>Rightmost descendant-or-self named child of the given type.</summary>
    private static CodeGraphTsNode LastNamedOfType(CodeGraphTsNode node, string type)
    {
        CodeGraphTsNode found = default;
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type == type) found = child;
            CodeGraphTsNode deeper = LastNamedOfType(child, type);
            if (!deeper.IsNull) found = deeper;
        }
        return found;
    }

    /// <summary>Content of a PHP string literal node (single- or double-quoted).</summary>
    private static string? PhpStringContent(CodeGraphTsNode node)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull && child.Type == "string_content") return child.Text.Trim();
        }
        return null;
    }

    /// <summary>The function name of the PHP call whose arguments contain `node`, if any.</summary>
    private static string? PhpEnclosingCallName(CodeGraphTsNode node)
    {
        CodeGraphTsNode cur = node.Parent;
        for (int hops = 0; !cur.IsNull && hops < 4; hops++, cur = cur.Parent)
        {
            if (cur.Type == "function_call_expression")
            {
                CodeGraphTsNode fn = cur.ChildByField("function");
                return fn.IsNull ? null : fn.Text;
            }
            if (cur.Type is "member_call_expression" or "scoped_call_expression")
                return null; // method calls aren't core HOFs
        }
        return null;
    }

    /// <summary>The Ruby `call` node whose argument_list (or keyword pair) contains `node`.</summary>
    private static CodeGraphTsNode RubyEnclosingCall(CodeGraphTsNode node)
    {
        CodeGraphTsNode cur = node.Parent;
        for (int hops = 0; !cur.IsNull && hops < 4; hops++, cur = cur.Parent)
        {
            if (cur.Type == "call") return cur;
        }
        return default;
    }

    private static bool IsRubyHookCall(string name) =>
        RubyHookRegex().IsMatch(name) || RubyHookNames.Contains(name);

    private static string StripLeadingColon(string s) =>
        s.StartsWith(":", StringComparison.Ordinal) ? s[1..] : s;

    /// <summary>Two AST nodes occupy the same byte span ⇒ the same node (sibling spans are disjoint).</summary>
    private static bool NodesEqual(CodeGraphTsNode a, CodeGraphTsNode b) =>
        a.StartByte == b.StartByte && a.EndByte == b.EndByte;

    // ------- Gate-string + shadow-prune helpers used by the engine flushes. -------

    /// <summary>SIMPLE_NAME test — an unqualified identifier.</summary>
    internal static bool IsSimpleName(string s) => SimpleNameRegex().IsMatch(s);

    /// <summary>Last dotted/backslashed segment of a JVM/PHP qualified import, or null.</summary>
    internal static string? QualifiedImportLastSegment(string s)
    {
        Match m = QualifiedImportRegex().Match(s);
        return m.Success ? m.Groups[1].Value : null;
    }

    /// <summary>`/[A-Z_]/.test(name)` — a distinctive-enough value-ref target name.</summary>
    internal static bool HasUpperOrUnderscore(string name)
    {
        foreach (char ch in name)
            if (ch == '_' || (ch >= 'A' && ch <= 'Z')) return true;
        return false;
    }

    /// <summary>First named child of one of the given types, or an absent node.</summary>
    internal static CodeGraphTsNode NamedChildOfAnyType(CodeGraphTsNode node, params string[] types)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull && Array.IndexOf(types, child.Type) >= 0) return child;
        }
        return default;
    }

    /// <summary>
    /// Resolve the declared identifier inside a C declarator (init/pointer/array/
    /// parenthesized declarator down to the identifier). A function_declarator means a
    /// prototype / function-pointer var — return an absent node so it isn't a value target.
    /// </summary>
    internal static CodeGraphTsNode CDeclaratorIdentifier(CodeGraphTsNode node)
    {
        CodeGraphTsNode cur = node;
        int guard = 0;
        while (!cur.IsNull && guard++ < 12)
        {
            switch (cur.Type)
            {
                case "identifier":
                    return cur;
                case "function_declarator":
                    return default;
                case "init_declarator":
                case "pointer_declarator":
                case "array_declarator":
                case "parenthesized_declarator":
                    cur = cur.ChildByField("declarator");
                    break;
                default:
                    return default;
            }
        }
        return default;
    }

    /// <summary>First `simple_identifier` in `node`'s subtree (BFS, first-found).</summary>
    internal static CodeGraphTsNode FirstSimpleIdentifier(CodeGraphTsNode node)
    {
        if (node.IsNull) return default;
        Queue<CodeGraphTsNode> queue = new();
        queue.Enqueue(node);
        int guard = 0;
        while (queue.Count > 0 && guard++ < 40)
        {
            CodeGraphTsNode n = queue.Dequeue();
            if (n.Type == "simple_identifier") return n;
            int count = n.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode c = n.NamedChild(i);
                if (!c.IsNull) queue.Enqueue(c);
            }
        }
        return default;
    }

    // ------- [GeneratedRegex] matchers (AOT-friendly — no runtime IL emit). -------

    [GeneratedRegex(@"([A-Za-z_$][A-Za-z0-9_$]*)\s*$")] private static partial Regex TrailingIdentifierRegex();
    [GeneratedRegex(@"^[A-Za-z_][\w:]*$")] private static partial Regex QualifiedIdentifierRegex();
    [GeneratedRegex(@"^([A-Z][A-Za-z0-9_]*)\s*::")] private static partial Regex MethodRefReceiverRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex PhpSimpleNameRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex PhpQualifiedNameRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_?!]*$")] private static partial Regex RubySymbolRegex();
    [GeneratedRegex(@"^(skip_)?(before|after|around)_[a-z_]+$")] private static partial Regex RubyHookRegex();
    [GeneratedRegex(@"^[A-Za-z_$][A-Za-z0-9_$]*$")] private static partial Regex SimpleNameRegex();
    [GeneratedRegex(@"^[A-Za-z_$][A-Za-z0-9_$.\\]*[.\\]([A-Za-z_$][A-Za-z0-9_$]*)$")] private static partial Regex QualifiedImportRegex();
}

// =============================================================================
// Engine-integrated capture + the two end-of-file flushes. A `partial` of the
// extraction engine so these reach _nodes / _edges / _unresolvedRefs / _nodeStack /
// _functionTypes / _language / _filePath directly (as the TS methods do on the class).
// =============================================================================
internal sealed partial class CodeGraphTreeSitterExtractor
{
    // Value-reference edges (default ON; CODEGRAPH_VALUE_REFS=0 disables). Same-file
    // reads of file/class/module-scope const/var → `references` edges (valueRef=true).
    private static readonly HashSet<string> ValueRefLangs = new()
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript, CodeGraphLanguage.Tsx,
        CodeGraphLanguage.ArkTs, CodeGraphLanguage.Go, CodeGraphLanguage.Python,
        CodeGraphLanguage.Rust, CodeGraphLanguage.Ruby, CodeGraphLanguage.C,
        CodeGraphLanguage.Java, CodeGraphLanguage.CSharp, CodeGraphLanguage.Php,
        CodeGraphLanguage.Scala, CodeGraphLanguage.Kotlin, CodeGraphLanguage.Swift,
        CodeGraphLanguage.Dart, CodeGraphLanguage.Pascal
    };
    private const int MaxValueRefNodes = 20_000;
    private static readonly bool ValueRefsEnabled =
        Environment.GetEnvironmentVariable("CODEGRAPH_VALUE_REFS") != "0";

    private const string ValueRefMetadata = "{\"valueRef\":true}"; // JSON.stringify({valueRef:true})

    // Value-ref bookkeeping, accumulated during the walk and consumed at end-of-file.
    private readonly Dictionary<string, string> _fileScopeValues = new();     // name -> target node id
    private readonly Dictionary<string, int> _fileScopeValueCounts = new();   // file-scope nodes per name
    private readonly List<(string Id, CodeGraphTsNode Node, string Name)> _valueRefScopes = new();

    // Function-as-value capture: the language spec (null when the language has none)
    // + candidates collected during the walk, gated & flushed at end-of-file.
    private readonly CodeGraphFnRefSpec? _fnRefSpec;
    private readonly List<(CodeGraphFnRefCandidate Cand, string FromNodeId)> _fnRefCandidates = new();

    /// <summary>
    /// Function-as-value capture: if this node is one of the language's value-position
    /// containers, collect candidate function names from it. Candidates are gated &amp;
    /// flushed at end-of-file (FlushFnRefCandidates).
    /// </summary>
    private void MaybeCaptureFnRefs(CodeGraphTsNode node, string nodeType)
    {
        CodeGraphFnRefSpec? spec = _fnRefSpec;
        if (spec == null) return;
        if (!spec.Dispatch.TryGetValue(nodeType, out CodeGraphCaptureRule rule)) return;
        if (_nodeStack.Count == 0) return;
        string fromNodeId = _nodeStack[^1];
        if (string.IsNullOrEmpty(fromNodeId)) return;
        foreach (CodeGraphFnRefCandidate cand in CodeGraphFunctionRef.CaptureFnRefCandidates(node, rule, spec))
            _fnRefCandidates.Add((cand, fromNodeId));
    }

    /// <summary>
    /// Candidates-only scan of a subtree the main walkers won't traverse (top-level
    /// variable/field/property initializers). No extraction side effects. Halts at
    /// nested function definitions (their bodies are walked — and their candidates
    /// attributed — by ExtractFunction's own body walk).
    /// </summary>
    private void ScanFnRefSubtree(CodeGraphTsNode node, int depth)
    {
        if (_fnRefSpec == null || depth > 12) return;
        string nodeType = node.Type;
        if (depth > 0 && (
            _functionTypes.Contains(nodeType) ||
            nodeType is "arrow_function" or "function_expression" or "lambda_literal" or "lambda_expression"))
        {
            return;
        }
        MaybeCaptureFnRefs(node, nodeType);
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull) ScanFnRefSubtree(child, depth + 1);
        }
    }

    /// <summary>
    /// Gate captured function-as-value candidates and push survivors as `function_ref`
    /// unresolved references. A candidate survives only if its name matches a
    /// function/method DEFINED IN THIS FILE or a name this file imports — except
    /// `this.`/`Scope::` forms (self-selecting, always flushed) and C-family file-scope
    /// initializers (constant-expression context, gate bypassed). Resolution then
    /// matches survivors against function/method nodes and emits `references` edges.
    /// </summary>
    private void FlushFnRefCandidates()
    {
        if (_fnRefCandidates.Count == 0) return;

        // Generated/minified files: function-as-value edges are noise.
        if (CodeGraphGeneratedDetection.IsGeneratedFile(_filePath)) return;

        HashSet<string> definedHere = new();
        foreach (CodeGraphNode n in _nodes)
            if (n.Kind is CodeGraphNodeKind.Function or CodeGraphNodeKind.Method) definedHere.Add(n.Name);

        // Import-binding names only (kind 'imports'). A dotted/backslashed import also
        // contributes its LAST segment — the simple name code uses to reference it.
        HashSet<string> importedNames = new();
        foreach (CodeGraphUnresolvedReference r in _unresolvedRefs)
        {
            if (r.ReferenceKind != CodeGraphEdgeKind.Imports) continue;
            if (CodeGraphFunctionRef.IsSimpleName(r.ReferenceName))
                importedNames.Add(r.ReferenceName);
            else
            {
                string? qualified = CodeGraphFunctionRef.QualifiedImportLastSegment(r.ReferenceName);
                if (qualified != null) importedNames.Add(qualified);
            }
        }

        HashSet<CodeGraphCaptureMode>? ungated = _fnRefSpec?.UngatedModes;
        bool addressOfOnly = _fnRefSpec?.AddressOfOnly == true;
        HashSet<string> seen = new();
        foreach ((CodeGraphFnRefCandidate c, string fromNodeId) in _fnRefCandidates)
        {
            bool atFileScope = fromNodeId.StartsWith("file:", StringComparison.Ordinal);
            // C++ (addressOfOnly): a BARE identifier qualifies only inside a file-scope
            // initializer table; everywhere else only explicit `&` forms count.
            if (addressOfOnly && !c.ExplicitRef &&
                !(atFileScope && (c.Mode == CodeGraphCaptureMode.Value || c.Mode == CodeGraphCaptureMode.List)))
                continue;

            // `this.<member>` / `Scope::member` self-select; everything else must match a
            // same-file function/method or an imported name (unless an ungated mode / skipGate).
            if (!c.Name.StartsWith("this.", StringComparison.Ordinal) &&
                !c.Name.Contains("::", StringComparison.Ordinal))
            {
                bool skipGate =
                    (ungated != null && ungated.Contains(c.Mode) && atFileScope) || c.SkipGate;
                if (!skipGate && !definedHere.Contains(c.Name) && !importedNames.Contains(c.Name))
                    continue;
            }

            string key = fromNodeId + "|" + c.Name;
            if (!seen.Add(key)) continue;
            _unresolvedRefs.Add(new CodeGraphUnresolvedReference(
                FromNodeId: fromNodeId,
                ReferenceName: c.Name,
                ReferenceKind: CodeGraphEdgeKind.FunctionRef,
                Line: c.Line,
                Column: c.Column,
                FilePath: null,
                Language: null,
                Candidates: null,
                RowId: null));
        }
    }

    /// <summary>
    /// Record value-reference bookkeeping as nodes are created: file/class/module-scope
    /// const/var symbols with distinctive names become reference targets; function/
    /// method/constructor/const/var symbols become reader scopes whose bodies
    /// FlushValueRefs scans.
    /// </summary>
    private void CaptureValueRefScope(string kind, string name, string id, CodeGraphTsNode node)
    {
        // Pascal restricts targets to `constant` (its extractor emits params/fields as
        // `variable`, which would otherwise become noisy file-wide targets).
        bool targetKindOk = _language == CodeGraphLanguage.Pascal
            ? kind == CodeGraphNodeKind.Constant
            : kind == CodeGraphNodeKind.Constant || kind == CodeGraphNodeKind.Variable;
        if (targetKindOk && name.Length >= 3 && CodeGraphFunctionRef.HasUpperOrUnderscore(name))
        {
            string? parentId = _nodeStack.Count > 0 ? _nodeStack[^1] : null;
            if (parentId != null &&
                (parentId.StartsWith("file:", StringComparison.Ordinal) ||
                 parentId.StartsWith("class:", StringComparison.Ordinal) ||
                 parentId.StartsWith("module:", StringComparison.Ordinal) ||
                 parentId.StartsWith("struct:", StringComparison.Ordinal) ||
                 parentId.StartsWith("enum:", StringComparison.Ordinal)))
            {
                _fileScopeValues[name] = id;
                _fileScopeValueCounts[name] = _fileScopeValueCounts.GetValueOrDefault(name) + 1;
            }
        }
        if (kind is CodeGraphNodeKind.Function or CodeGraphNodeKind.Method
            or CodeGraphNodeKind.Constructor
            or CodeGraphNodeKind.Constant or CodeGraphNodeKind.Variable)
            _valueRefScopes.Add((id, node, name));
    }

    /// <summary>
    /// Emit same-file `references` edges from a reader symbol to the file-scope const/var
    /// it reads (metadata {valueRef:true}). Same-file only, distinctive target names only,
    /// deduped per (reader, target); shadowed targets are pruned via a syntax-level
    /// declarator count. Default on (CODEGRAPH_VALUE_REFS=0 disables) + additive.
    /// </summary>
    private void FlushValueRefs(CodeGraphTsNode root)
    {
        Dictionary<string, string> targets = _fileScopeValues;
        Dictionary<string, int> fileScopeCounts = _fileScopeValueCounts;
        if (!ValueRefsEnabled || !ValueRefLangs.Contains(_language)) return;
        if (targets.Count == 0 || _valueRefScopes.Count == 0 ||
            CodeGraphGeneratedDetection.IsGeneratedFile(_filePath)) return;

        // Prune SHADOWED targets: a target re-bound in an INNER scope resolves to the inner
        // binding for nested readers, so a file-scope edge is a false positive. Inner
        // re-bindings aren't graph nodes — count every declarator of the name across the
        // tree and drop a target where (declarators > file-scope nodes).
        if (!root.IsNull)
        {
            Dictionary<string, int> declCounts = new();
            void Bump(CodeGraphTsNode nameNode)
            {
                if (!nameNode.IsNull && nameNode.Type is "identifier" or "simple_identifier")
                {
                    string nm = nameNode.Text;
                    if (targets.ContainsKey(nm)) declCounts[nm] = declCounts.GetValueOrDefault(nm) + 1;
                }
            }

            Stack<CodeGraphTsNode> dstack = new();
            dstack.Push(root);
            int dvisited = 0;
            while (dstack.Count > 0 && dvisited < MaxValueRefNodes)
            {
                CodeGraphTsNode n = dstack.Pop();
                dvisited++;
                switch (n.Type)
                {
                    case "variable_declarator": // TS/JS/tsx
                    case "const_spec":          // Go  `const X = …`
                    case "var_spec":            // Go  `var X = …`
                        Bump(n.NamedChild(0));
                        break;
                    case "const_item":          // Rust  `const X: T = …`
                    case "static_item":         // Rust  `static X: T = …`
                        Bump(n.ChildByField("name"));
                        break;
                    case "let_declaration":       // Rust  `let x = …` (the shadow source)
                    case "short_var_declaration": // Go    `x, Y := …`
                    case "assignment":            // Python `X = …` / `A, B = …`
                    {
                        CodeGraphTsNode left = n.ChildByField("left");
                        if (left.IsNull) left = n.ChildByField("pattern");
                        if (left.IsNull) left = n.NamedChild(0);
                        if (!left.IsNull && left.Type == "identifier") Bump(left);
                        else if (!left.IsNull)
                        {
                            int lc = left.NamedChildCount;
                            for (int i = 0; i < lc; i++) Bump(left.NamedChild(i));
                        }
                        break;
                    }
                    case "init_declarator":       // C  `T X = …`
                        Bump(CodeGraphFunctionRef.CDeclaratorIdentifier(n));
                        break;
                    case "val_definition":        // Scala  `val X = …`
                    case "var_definition":        // Scala  `var X = …`
                    {
                        CodeGraphTsNode pat = n.ChildByField("pattern");
                        if (!pat.IsNull && pat.Type == "identifier") Bump(pat);
                        break;
                    }
                    case "static_final_declaration":        // Dart  top-level/`static` const/final
                    case "initialized_identifier":          // Dart  instance field / `var`
                    case "initialized_variable_definition": // Dart  method-local const/final/var
                    {
                        CodeGraphTsNode id = CodeGraphFunctionRef.NamedChildOfAnyType(n, "identifier");
                        if (!id.IsNull) Bump(id);
                        break;
                    }
                    case "declConst":  // Pascal  unit/class const (target) AND a local const that shadows it
                    case "declVar":    // Pascal  a function-local `var` that shadows a const
                        Bump(n.ChildByField("name"));
                        break;
                    case "property_declaration": // Kotlin / Swift  `val`/`let X = …`
                    {
                        CodeGraphTsNode vd = CodeGraphFunctionRef.NamedChildOfAnyType(n, "variable_declaration");
                        CodeGraphTsNode id;
                        if (!vd.IsNull)
                            id = CodeGraphFunctionRef.NamedChildOfAnyType(vd, "simple_identifier");
                        else
                        {
                            CodeGraphTsNode pat = n.ChildByField("name");
                            if (pat.IsNull) pat = CodeGraphFunctionRef.NamedChildOfAnyType(n, "value_binding_pattern", "pattern");
                            id = CodeGraphFunctionRef.FirstSimpleIdentifier(pat);
                        }
                        if (!id.IsNull) Bump(id);
                        break;
                    }
                }

                int cc = n.NamedChildCount;
                for (int i = 0; i < cc; i++)
                {
                    CodeGraphTsNode c = n.NamedChild(i);
                    if (!c.IsNull) dstack.Push(c);
                }
            }

            foreach ((string nm, int c) in declCounts)
                if (c > fileScopeCounts.GetValueOrDefault(nm, 1)) targets.Remove(nm);
            if (targets.Count == 0) return;
        }

        foreach ((string scopeId, CodeGraphTsNode scopeNode, string scopeName) in _valueRefScopes)
        {
            HashSet<string> seen = new();
            Stack<CodeGraphTsNode> stack = new();
            stack.Push(scopeNode);
            // Dart/Pascal attach the function/method BODY as a next sibling of the
            // signature node stored as the reader scope — pull it in (inert elsewhere).
            CodeGraphTsNode sib = scopeNode.NextNamedSibling;
            if (!sib.IsNull && sib.Type is "function_body" or "block") stack.Push(sib);
            int visited = 0;
            while (stack.Count > 0 && visited < MaxValueRefNodes)
            {
                CodeGraphTsNode n = stack.Pop();
                visited++;
                // `constant` (Ruby), `name` (PHP), `simple_identifier` (Kotlin) also carry
                // constant reads. Safe cross-language: a file only holds its own grammar's nodes.
                if (n.Type is "identifier" or "constant" or "name" or "simple_identifier")
                {
                    string refName = n.Text;
                    if (targets.TryGetValue(refName, out string? targetId) &&
                        targetId != scopeId && refName != scopeName && seen.Add(targetId))
                    {
                        _edges.Add(new CodeGraphEdge(
                            Source: scopeId,
                            Target: targetId,
                            Kind: CodeGraphEdgeKind.References,
                            Metadata: ValueRefMetadata,
                            Line: null,
                            Column: null,
                            Provenance: null));
                    }
                }

                int cc = n.NamedChildCount;
                for (int i = 0; i < cc; i++)
                {
                    CodeGraphTsNode c = n.NamedChild(i);
                    if (!c.IsNull) stack.Push(c);
                }
            }
        }
    }
}
