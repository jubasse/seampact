package io.github.jubasse.seampact.ir.bundle

import java.net.URI
import java.net.URISyntaxException

/**
 * A source URL as a diagnostic may print it, as `printable-url.ts`: the user name, the password, the query and the
 * fragment are dropped, since a token in them would land in CI logs. Text that is not an absolute URL (an
 * scp-like git address, a path) is printed as written.
 */
internal fun printableUrl(text: String): String {
    val uri = try {
        URI(text)
    } catch (error: URISyntaxException) {
        return text
    }
    if (!uri.isAbsolute || uri.isOpaque || uri.rawAuthority == null) return text

    val host = uri.host ?: return text
    val port = if (uri.port == -1) "" else ":${uri.port}"
    val path = uri.rawPath.ifEmpty { "/" }

    return "${uri.scheme.lowercase()}://${host.lowercase()}$port$path"
}
