// =============================================================================
// CodeGraphBuiltIns — the per-language built-in / external allow-lists the resolver's
// IsBuiltInOrExternal step consults (index.ts:71-196 JS/React/Python/Go/Pascal/C/C++
// sets). Allocated once, shared across all resolver instances. Values are VERBATIM
// from the CodeGraph clone — do not prune (each entry has a real repro behind it).
// Ordinal HashSet lookups; Pascal prefixes are a scanned array (startsWith).
// =============================================================================
internal static class CodeGraphBuiltIns
{
    internal static readonly HashSet<string> JsBuiltIns = new(StringComparer.Ordinal)
    {
        "console", "window", "document", "global", "process",
        "Promise", "Array", "Object", "String", "Number", "Boolean",
        "Date", "Math", "JSON", "RegExp", "Error", "Map", "Set",
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "fetch", "require", "module", "exports", "__dirname", "__filename"
    };

    internal static readonly HashSet<string> ReactHooks = new(StringComparer.Ordinal)
    {
        "useState", "useEffect", "useContext", "useReducer", "useCallback",
        "useMemo", "useRef", "useLayoutEffect", "useImperativeHandle", "useDebugValue"
    };

    internal static readonly HashSet<string> PythonBuiltIns = new(StringComparer.Ordinal)
    {
        "print", "len", "range", "str", "int", "float", "list", "dict", "set", "tuple",
        "open", "input", "type", "isinstance", "hasattr", "getattr", "setattr",
        "super", "self", "cls", "None", "True", "False"
    };

    internal static readonly HashSet<string> PythonBuiltInTypes = new(StringComparer.Ordinal)
    {
        "list", "dict", "set", "tuple", "str", "int", "float", "bool",
        "bytes", "bytearray", "frozenset", "object", "super"
    };

    internal static readonly HashSet<string> PythonBuiltInMethods = new(StringComparer.Ordinal)
    {
        "append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse", "copy",
        "update", "keys", "values", "items", "get",
        "add", "discard", "union", "intersection", "difference",
        "split", "join", "strip", "lstrip", "rstrip", "replace", "lower", "upper",
        "startswith", "endswith", "find", "index", "count", "encode", "decode",
        "format", "isdigit", "isalpha", "isalnum",
        "read", "write", "readline", "readlines", "close", "flush", "seek"
    };

    internal static readonly HashSet<string> GoStdlibPackages = new(StringComparer.Ordinal)
    {
        "fmt", "os", "io", "net", "http", "log", "math", "sort", "sync",
        "time", "path", "bytes", "strings", "strconv", "errors", "context",
        "json", "xml", "csv", "html", "template", "regexp", "reflect",
        "runtime", "testing", "flag", "bufio", "crypto", "encoding",
        "filepath", "hash", "mime", "rand", "signal", "sql", "syscall",
        "unicode", "unsafe", "atomic", "binary", "debug", "exec", "heap",
        "ring", "scanner", "tar", "zip", "gzip", "zlib", "tls", "url",
        "user", "pprof", "trace", "ast", "build", "parser", "printer",
        "token", "types", "cgo", "plugin", "race", "ioutil",
        // Kubernetes-common stdlib aliases
        "utilruntime", "utilwait", "utilnet"
    };

    internal static readonly HashSet<string> GoBuiltIns = new(StringComparer.Ordinal)
    {
        "make", "new", "len", "cap", "append", "copy", "delete", "close",
        "panic", "recover", "print", "println", "complex", "real", "imag",
        "error", "nil", "true", "false", "iota",
        "int", "int8", "int16", "int32", "int64",
        "uint", "uint8", "uint16", "uint32", "uint64", "uintptr",
        "float32", "float64", "complex64", "complex128",
        "string", "bool", "byte", "rune", "any"
    };

    internal static readonly string[] PascalUnitPrefixes =
    {
        "System.", "Winapi.", "Vcl.", "Fmx.", "Data.", "Datasnap.",
        "Soap.", "Xml.", "Web.", "REST.", "FireDAC.", "IBX.",
        "IdHTTP", "IdTCP", "IdSSL"
    };

    internal static readonly HashSet<string> PascalBuiltIns = new(StringComparer.Ordinal)
    {
        "System", "SysUtils", "Classes", "Types", "Variants", "StrUtils",
        "Math", "DateUtils", "IOUtils", "Generics.Collections", "Generics.Defaults",
        "Rtti", "TypInfo", "SyncObjs", "RegularExpressions",
        "SysInit", "Windows", "Messages", "Graphics", "Controls", "Forms",
        "Dialogs", "StdCtrls", "ExtCtrls", "ComCtrls", "Menus", "ActnList",
        "WriteLn", "Write", "ReadLn", "Read", "Inc", "Dec", "Ord", "Chr",
        "Length", "SetLength", "High", "Low", "Assigned", "FreeAndNil",
        "Format", "IntToStr", "StrToInt", "FloatToStr", "StrToFloat",
        "Trim", "UpperCase", "LowerCase", "Pos", "Copy", "Delete", "Insert",
        "Now", "Date", "Time", "DateToStr", "StrToDate",
        "Raise", "Exit", "Break", "Continue", "Abort",
        "True", "False", "nil", "Self", "Result",
        "Create", "Destroy", "Free",
        "TObject", "TComponent", "TPersistent", "TInterfacedObject",
        "TList", "TStringList", "TStrings", "TStream", "TMemoryStream", "TFileStream",
        "Exception", "EAbort", "EConvertError", "EAccessViolation",
        "IInterface", "IUnknown"
    };

    internal static readonly HashSet<string> CBuiltIns = new(StringComparer.Ordinal)
    {
        // Standard C library functions
        "printf", "fprintf", "sprintf", "snprintf", "scanf", "fscanf", "sscanf",
        "malloc", "calloc", "realloc", "free",
        "memcpy", "memmove", "memset", "memcmp", "memchr",
        "strlen", "strcpy", "strncpy", "strcat", "strncat", "strcmp", "strncmp",
        "strstr", "strchr", "strrchr", "strtok", "strdup",
        "fopen", "fclose", "fread", "fwrite", "fgets", "fputs", "fputc", "fgetc",
        "feof", "ferror", "fflush", "fseek", "ftell", "rewind",
        "exit", "abort", "atexit", "atoi", "atol", "atof", "strtol", "strtoul", "strtod",
        "qsort", "bsearch",
        "abs", "labs", "rand", "srand",
        "sin", "cos", "tan", "sqrt", "pow", "log", "log10", "exp", "ceil", "floor", "fabs",
        "time", "clock", "difftime", "mktime", "localtime", "gmtime", "strftime", "asctime",
        "assert", "errno",
        "perror", "remove", "rename", "tmpfile", "tmpnam",
        "getenv", "system",
        "signal", "raise",
        "setjmp", "longjmp",
        "va_start", "va_end", "va_arg", "va_copy",
        "NULL", "EOF", "BUFSIZ", "FILENAME_MAX", "RAND_MAX", "EXIT_SUCCESS", "EXIT_FAILURE",
        "size_t", "ptrdiff_t", "wchar_t", "intptr_t", "uintptr_t",
        "int8_t", "int16_t", "int32_t", "int64_t",
        "uint8_t", "uint16_t", "uint32_t", "uint64_t",
        "FILE",
        // POSIX additions commonly seen
        "stat", "lstat", "fstat", "open", "close", "read", "write", "pipe",
        "fork", "exec", "waitpid", "getpid", "getppid", "kill", "sleep", "usleep",
        "pthread_create", "pthread_join", "pthread_mutex_lock", "pthread_mutex_unlock",
        "dlopen", "dlsym", "dlclose"
    };

    internal static readonly HashSet<string> CppBuiltIns = new(StringComparer.Ordinal)
    {
        // iostream objects (often used without std:: prefix via using)
        "cout", "cin", "cerr", "clog", "endl", "flush", "ws",
        "std", // the namespace itself when used as std::something
        // Common C++ keywords that leak as references
        "nullptr", "true", "false", "this", "sizeof", "alignof", "typeid",
        "static_cast", "dynamic_cast", "reinterpret_cast", "const_cast",
        "make_unique", "make_shared", "make_pair",
        "move", "forward", "swap"
    };
}
