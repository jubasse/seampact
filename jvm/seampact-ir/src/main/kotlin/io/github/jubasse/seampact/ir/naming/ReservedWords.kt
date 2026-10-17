// Generated from packages/core/spec/vectors/naming/reserved-words.json by scripts/ir-models. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

package io.github.jubasse.seampact.ir.naming

/** The reserved and shadowed names of one language (ADR 0007 section 5). */
internal class ReservedList(
    val caseInsensitive: Boolean,
    val keywords: Set<String>,
    val types: Set<String>,
    val members: Set<String>,
    val enumMembers: Set<String>,
)

internal val KOTLIN_RESERVED_WORDS: ReservedList = ReservedList(
    caseInsensitive = false,
    keywords =
        setOf(
            "as", "break", "class", "continue", "do", "else",
            "false", "for", "fun", "if", "in", "interface",
            "is", "null", "object", "package", "return", "super",
            "this", "throw", "true", "try", "typealias", "typeof",
            "val", "var", "when", "while",
        ),
    types =
        setOf(
            "AbstractMethodError", "Any", "Appendable", "ArithmeticException", "Array", "ArrayIndexOutOfBoundsException",
            "ArrayList", "ArrayStoreException", "AssertionError", "AutoCloseable", "Boolean", "BootstrapMethodError",
            "Byte", "ByteArray", "Char", "CharSequence", "Character", "Class",
            "ClassCastException", "ClassCircularityError", "ClassFormatError", "ClassLoader", "ClassNotFoundException", "ClassValue",
            "CloneNotSupportedException", "Cloneable", "Collection", "Comparable", "Comparator", "Deprecated",
            "Double", "Enum", "EnumConstantNotPresentException", "Error", "Exception", "ExceptionInInitializerError",
            "Float", "FunctionalInterface", "HashMap", "IO", "IllegalAccessError", "IllegalAccessException",
            "IllegalArgumentException", "IllegalCallerException", "IllegalMonitorStateException", "IllegalStateException", "IllegalThreadStateException", "IncompatibleClassChangeError",
            "IndexOutOfBoundsException", "InheritableThreadLocal", "InstantiationError", "InstantiationException", "Int", "Integer",
            "InternalError", "InterruptedException", "Iterable", "Iterator", "LayerInstantiationException", "Lazy",
            "LinkageError", "LinkedHashMap", "List", "ListIterator", "Long", "Map",
            "MatchException", "Math", "Module", "ModuleLayer", "MutableCollection", "MutableIterable",
            "MutableIterator", "MutableList", "MutableListIterator", "MutableMap", "MutableSet", "NegativeArraySizeException",
            "NoClassDefFoundError", "NoSuchFieldError", "NoSuchFieldException", "NoSuchMethodError", "NoSuchMethodException", "Nothing",
            "NullPointerException", "Number", "NumberFormatException", "Object", "OutOfMemoryError", "Override",
            "Package", "Pair", "Process", "ProcessBuilder", "ProcessHandle", "Readable",
            "Record", "ReflectiveOperationException", "Regex", "Result", "Runnable", "Runtime",
            "RuntimeException", "RuntimePermission", "SafeVarargs", "ScopedValue", "SecurityException", "SecurityManager",
            "Sequence", "Set", "Short", "StableValue", "StackOverflowError", "StackTraceElement",
            "StackWalker", "StrictMath", "String", "StringBuffer", "StringBuilder", "StringIndexOutOfBoundsException",
            "SuppressWarnings", "System", "Thread", "ThreadDeath", "ThreadGroup", "ThreadLocal",
            "Throwable", "Triple", "TypeNotPresentException", "Unit", "UnknownError", "UnsatisfiedLinkError",
            "UnsupportedClassVersionError", "UnsupportedOperationException", "VerifyError", "VirtualMachineError", "Void", "WrongThreadException",
        ),
    members =
        emptySet(),
    enumMembers =
        emptySet(),
)

internal val JAVA_RESERVED_WORDS: ReservedList = ReservedList(
    caseInsensitive = false,
    keywords =
        setOf(
            "abstract", "assert", "boolean", "break", "byte", "case",
            "catch", "char", "class", "const", "continue", "default",
            "do", "double", "else", "enum", "extends", "false",
            "final", "finally", "float", "for", "goto", "if",
            "implements", "import", "instanceof", "int", "interface", "long",
            "native", "new", "null", "package", "private", "protected",
            "public", "return", "short", "static", "strictfp", "super",
            "switch", "synchronized", "this", "throw", "throws", "transient",
            "true", "try", "void", "volatile", "while",
        ),
    types =
        setOf(
            "AbstractMethodError", "Appendable", "ArithmeticException", "ArrayIndexOutOfBoundsException", "ArrayStoreException", "AssertionError",
            "AutoCloseable", "Boolean", "BootstrapMethodError", "Byte", "CharSequence", "Character",
            "Class", "ClassCastException", "ClassCircularityError", "ClassFormatError", "ClassLoader", "ClassNotFoundException",
            "ClassValue", "CloneNotSupportedException", "Cloneable", "Collection", "Comparable", "Deprecated",
            "Double", "Enum", "EnumConstantNotPresentException", "Error", "Exception", "ExceptionInInitializerError",
            "Float", "FunctionalInterface", "IO", "IllegalAccessError", "IllegalAccessException", "IllegalArgumentException",
            "IllegalCallerException", "IllegalMonitorStateException", "IllegalStateException", "IllegalThreadStateException", "IncompatibleClassChangeError", "IndexOutOfBoundsException",
            "InheritableThreadLocal", "InstantiationError", "InstantiationException", "Integer", "InternalError", "InterruptedException",
            "Iterable", "Iterator", "LayerInstantiationException", "LinkageError", "List", "ListIterator",
            "Long", "Map", "MatchException", "Math", "Module", "ModuleLayer",
            "NegativeArraySizeException", "NoClassDefFoundError", "NoSuchFieldError", "NoSuchFieldException", "NoSuchMethodError", "NoSuchMethodException",
            "NullPointerException", "Number", "NumberFormatException", "Object", "Optional", "OutOfMemoryError",
            "Override", "Package", "Process", "ProcessBuilder", "ProcessHandle", "Readable",
            "Record", "ReflectiveOperationException", "Runnable", "Runtime", "RuntimeException", "RuntimePermission",
            "SafeVarargs", "ScopedValue", "SecurityException", "SecurityManager", "Set", "Short",
            "StableValue", "StackOverflowError", "StackTraceElement", "StackWalker", "StrictMath", "String",
            "StringBuffer", "StringBuilder", "StringIndexOutOfBoundsException", "SuppressWarnings", "System", "Thread",
            "ThreadDeath", "ThreadGroup", "ThreadLocal", "Throwable", "TypeNotPresentException", "UnknownError",
            "UnsatisfiedLinkError", "UnsupportedClassVersionError", "UnsupportedOperationException", "VerifyError", "VirtualMachineError", "Void",
            "WrongThreadException",
        ),
    members =
        setOf(
            "clone", "finalize", "getClass", "hashCode", "notify", "notifyAll",
            "toString", "wait",
        ),
    enumMembers =
        emptySet(),
)
