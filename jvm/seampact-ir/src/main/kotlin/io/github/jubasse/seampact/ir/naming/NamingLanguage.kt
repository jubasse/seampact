package io.github.jubasse.seampact.ir.naming

/** The styles an identifier is written in (ADR 0007 section 4). */
internal enum class NamingStyle { PASCAL, CAMEL, UPPER_SNAKE }

/**
 * The languages this naming serves: Kotlin, and Java for the Java callers of the same model (the `kotlin` and `java`
 * columns of the shared vectors).
 */
public enum class NamingLanguage(public val wire: String, private val reserved: ReservedList) {
    KOTLIN("kotlin", KOTLIN_RESERVED_WORDS),
    JAVA("java", JAVA_RESERVED_WORDS),
    ;

    internal fun styleOf(role: NamingRole): NamingStyle = when (role) {
        NamingRole.OPERATION, NamingRole.MEMBER -> NamingStyle.CAMEL
        NamingRole.ENUM_MEMBER -> NamingStyle.UPPER_SNAKE
        else -> NamingStyle.PASCAL
    }

    /** Whether [identifier], the final identifier of a name with [role], is a keyword or a shadowed name here. */
    internal fun isReserved(identifier: String, role: NamingRole): Boolean {
        val key = if (reserved.caseInsensitive) identifier.lowercase() else identifier

        return when {
            key in reserved.keywords -> true
            role.isType -> key in reserved.types
            role == NamingRole.MEMBER || role == NamingRole.OPERATION -> key in reserved.members
            role == NamingRole.ENUM_MEMBER -> key in reserved.enumMembers
            else -> false
        }
    }

    public companion object {
        /** The language written [wire] in a vector, or null. */
        public fun ofWire(wire: String): NamingLanguage? = entries.firstOrNull { it.wire == wire }
    }
}
