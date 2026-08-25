// =============================================================================
// CodeGraphInstructions — the agent playbook surfaced in the system prompt
// (analysis/04 §3.4; port of server-instructions.ts as DATA). Two variants selected
// by whether the working folder is indexed: the "one tool, explore, use it instead
// of Read" playbook (Indexed) vs the "index this project first" nudge (NoRoot).
//
// Returned verbatim by codegraph/instructions. Kept as consts so the renderer can
// inject the right variant without a second round-trip.
// =============================================================================
internal static class CodeGraphInstructions
{
    // Surfaced when the project HAS an index.
    public const string Indexed =
        "# CodeGraph\n\n"
        + "This project has a CodeGraph index of its symbols and their relationships. Prefer "
        + "`codegraph_explore` over Read/Grep when you need to understand how code fits together.\n\n"
        + "- **codegraph_explore** is the primary tool. Give it a natural-language question (\"how does "
        + "login reach the database?\") OR a bag of symbol/file names, and it returns the verbatim "
        + "source grouped by file, the call path among those symbols, and the blast-radius — in one "
        + "capped call. Reach for it first.\n"
        + "- Use it instead of guessing file paths or running many Read/Grep calls: one explore usually "
        + "replaces a dozen greps.\n"
        + "- The index can lag edits you just made; if results look stale, re-read the specific file "
        + "directly.\n";

    // Surfaced when the working folder is NOT indexed (or no default project).
    public const string NoRoot =
        "# CodeGraph\n\n"
        + "CodeGraph can build a symbol graph of this project so you can query how code fits together, "
        + "but this project is not indexed yet.\n\n"
        + "- Ask the user to run the Index action (or call `codegraph/index`) to build the graph.\n"
        + "- Until then, use Read/Grep. Once indexed, prefer `codegraph_explore` over Read/Grep for "
        + "understanding relationships between symbols.\n";
}
