package io.github.jubasse.seampact.ir.naming

/**
 * The roles of a name (ADR 0007 section 1). [isType] says whether the identifier is a type, so that the shadowed
 * type names apply to it; [suffixWord] is the default word appended after the segments, null for none.
 */
public enum class NamingRole(public val wire: String, internal val isType: Boolean, internal val suffixWord: String?) {
    SCHEMA("schema", true, null),
    INPUT("input", true, "input"),
    OUTPUT("output", true, "output"),
    QUERY("query", true, "query"),
    HEADERS("headers", true, "headers"),
    PATH("path", true, "path"),
    RESPONSE("response", true, "response"),
    PARAMS("params", true, "params"),
    ERROR("error", true, "error"),
    ERRORS("errors", true, "errors"),
    PROPERTY("property", true, null),
    ITEM("item", true, "item"),
    VALUE("value", true, "value"),
    VARIANT("variant", true, null),
    ENDPOINTS("endpoints", true, "endpoints"),
    OPERATION("operation", false, null),
    MEMBER("member", false, null),
    ENUM_MEMBER("enumMember", false, null),
    ;

    public companion object {
        /** The role written [wire] in a vector or an IR, or null for a role this version does not know. */
        public fun ofWire(wire: String): NamingRole? = entries.firstOrNull { it.wire == wire }
    }
}
