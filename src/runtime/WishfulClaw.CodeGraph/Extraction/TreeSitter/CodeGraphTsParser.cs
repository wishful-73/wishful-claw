// =============================================================================
// CodeGraphTsParser — IDisposable wrapper over a native TSParser.
//
//   * Native memory is malloc/free: model as IDisposable and always `using`; do
//     NOT add a GC finalizer as a safety net — finalizer order is nondeterministic
//     and could double-free a tree that outlived its parser (reference/03 §5.5).
//   * ONE parser per thread — TSParser is not thread-safe (reference/03 §5.6).
//   * The UTF-8 source buffer is PINNED across the whole parse call (reference/03
//     §5.7); ts_parser_parse_string reads it synchronously.
//
// COMPILES today; will not RUN until libtree-sitter is present.
// =============================================================================
internal sealed class CodeGraphTsParser : IDisposable
{
    private nint _handle;
    private ulong _timeoutMicros; // 0 == no guard (plain ts_parser_parse_string)

    public CodeGraphTsParser()
    {
        _handle = CodeGraphTsBindings.ts_parser_new();
    }

    /// <summary>
    /// Bind a grammar (a `tree_sitter_&lt;lang&gt;()` handle from the registry).
    /// Throws when the grammar ABI is incompatible with this libtree-sitter — a
    /// false return silently yields empty parses otherwise (reference/03 §5.4).
    /// </summary>
    public void SetLanguage(nint language)
    {
        if (!CodeGraphTsBindings.ts_parser_set_language(_handle, language))
            throw new CodeGraphGrammarAbiException(language);
    }

    /// <summary>
    /// Parse-timeout guard (R5). libtree-sitter 0.25 DELETED
    /// ts_parser_set_timeout_micros, so the budget is enforced by Parse via
    /// ts_parser_parse_with_options with a deadline-checking progress callback —
    /// a cancelled parse returns a null tree, surfaced as CodeGraphParseException.
    /// 0 disables the guard.
    /// </summary>
    public void SetTimeoutMicros(ulong micros) => _timeoutMicros = micros;

    /// <summary>Reset internal parse state (for parser reuse across files).</summary>
    public void Reset() => CodeGraphTsBindings.ts_parser_reset(_handle);

    /// <summary>Parse a UTF-8 source buffer owned by a CodeGraphSourceText.</summary>
    public CodeGraphTsTree Parse(CodeGraphSourceText source)
    {
        unsafe
        {
            fixed (byte* p = source.Utf8Span) // pin for the whole synchronous parse call
            {
                nint tree;
                if (_timeoutMicros == 0)
                {
                    tree = CodeGraphTsBindings.ts_parser_parse_string(
                        _handle, oldTree: 0, source: p, length: (uint)source.ByteLength);
                }
                else
                {
                    // Deadline in Stopwatch ticks; the progress callback cancels the
                    // parse once it passes. The payload is a stack local — safe: the
                    // parse call is fully synchronous and the callbacks only fire
                    // inside it, on this thread.
                    var payload = new ParsePayload
                    {
                        Buffer = p,
                        Length = (uint)source.ByteLength,
                        DeadlineTimestamp = System.Diagnostics.Stopwatch.GetTimestamp()
                            + (long)(_timeoutMicros * (System.Diagnostics.Stopwatch.Frequency / 1_000_000.0))
                    };
                    var input = new CodeGraphTsInput
                    {
                        Payload = &payload,
                        Read = &ReadSource,
                        Encoding = 0, // TSInputEncodingUTF8
                        Decode = null
                    };
                    var options = new CodeGraphTsParseOptions
                    {
                        Payload = &payload,
                        ProgressCallback = &CheckDeadline
                    };
                    tree = CodeGraphTsBindings.ts_parser_parse_with_options(
                        _handle, oldTree: 0, input, options);
                    if (tree == 0)
                        Reset(); // a cancelled parse leaves the parser mid-state
                }

                if (tree == 0)
                    throw new CodeGraphParseException(); // timeout / OOM / no language set
                return new CodeGraphTsTree(tree, source);
            }
        }
    }

    // Chunk carrier for the TSInput read callback + the progress deadline. Unmanaged
    // so its address can cross the native boundary as the callback payload.
    private struct ParsePayload
    {
        public unsafe byte* Buffer;
        public uint Length;
        public long DeadlineTimestamp;
    }

    // TSInput.read — serve the remaining pinned buffer in one chunk; 0 bytes == EOF.
    [System.Runtime.InteropServices.UnmanagedCallersOnly]
    private static unsafe byte* ReadSource(void* payload, uint byteIndex, CodeGraphTsPoint position, uint* bytesRead)
    {
        var ctx = (ParsePayload*)payload;
        if (byteIndex >= ctx->Length)
        {
            *bytesRead = 0;
            return null;
        }

        *bytesRead = ctx->Length - byteIndex;
        return ctx->Buffer + byteIndex;
    }

    // TSParseOptions.progress_callback — nonzero cancels the parse (R5 timeout).
    [System.Runtime.InteropServices.UnmanagedCallersOnly]
    private static unsafe byte CheckDeadline(CodeGraphTsParseState* state)
    {
        var ctx = (ParsePayload*)state->Payload;
        return System.Diagnostics.Stopwatch.GetTimestamp() >= ctx->DeadlineTimestamp ? (byte)1 : (byte)0;
    }

    /// <summary>
    /// Parse raw UTF-8 bytes. The returned tree references byte offsets into the
    /// source, so the bytes are COPIED into a CodeGraphSourceText the tree owns —
    /// the caller's span may be transient.
    /// </summary>
    public CodeGraphTsTree Parse(ReadOnlySpan<byte> utf8Source) =>
        Parse(CodeGraphSourceText.FromUtf8(utf8Source.ToArray()));

    public void Dispose()
    {
        if (_handle != 0)
        {
            CodeGraphTsBindings.ts_parser_delete(_handle);
            _handle = 0;
        }
    }
}

/// <summary>
/// ts_parser_set_language returned false — the grammar's ABI is outside this
/// libtree-sitter's supported range (reference/03 §5.4). The registry catches
/// this to disable one language rather than parse garbage.
/// </summary>
internal sealed class CodeGraphGrammarAbiException : Exception
{
    public nint Language { get; }

    public CodeGraphGrammarAbiException(nint language)
        : base($"tree-sitter rejected grammar language handle 0x{language:X} (ABI mismatch)")
    {
        Language = language;
    }
}

/// <summary>ts_parser_parse_string returned NULL — parse failed (timeout / OOM / no language).</summary>
internal sealed class CodeGraphParseException : Exception
{
    public CodeGraphParseException()
        : base("tree-sitter parse returned a null tree (timeout, OOM, or no language set)")
    {
    }
}
