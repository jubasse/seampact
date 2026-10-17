package io.github.jubasse.seampact.ir.naming

private val SEGMENT = Regex("^[a-z0-9]+$")

// The statuses of a `responses` entry: success and redirect (ADR 0007 section 1).
private val RESPONSE_STATUSES = 200..399

/**
 * A name as the IR stores it (ADR 0007 section 1): word segments and a role. A `response` name carries the
 * integer [status], and no other role does.
 *
 * @throws IllegalArgumentException a segment outside `[a-z0-9]+`, or a status missing, out of range or on another role
 */
public data class IrName(val segments: List<String>, val role: NamingRole, val status: Int? = null) {
    init {
        for (segment in segments) require(SEGMENT.matches(segment)) { "a naming segment is [a-z0-9]+, got '$segment'" }

        if (role == NamingRole.RESPONSE) {
            require(status in RESPONSE_STATUSES) {
                "a response status is an integer from ${RESPONSE_STATUSES.first} to ${RESPONSE_STATUSES.last}, got $status"
            }
        } else {
            require(status == null) { "role ${role.wire} has no status, got $status" }
        }
    }

    /** The segments, then the suffix words of the role (the status follows `response`). */
    internal fun words(): List<String> {
        val suffix = role.suffixWord ?: return segments

        return segments + suffix + listOfNotNull(status?.toString())
    }
}
