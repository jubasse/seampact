package io.github.jubasse.seampact.ir.bundle

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.net.URISyntaxException
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.net.http.HttpTimeoutException
import java.time.Duration
import java.time.Instant

// The release-asset channel, as `fetch-release.ts`: the bundle tarball downloaded over HTTPS. A bundle comes from
// the network, so the URL and every redirect must be `https:`, redirects are bounded, the download has a
// deadline, and it stops at the archive cap; the archive reader then checks the bytes.

private const val HTTPS_SCHEME = "https"
private const val REDIRECTS_MAX = 5
private val DOWNLOAD_DEADLINE: Duration = Duration.ofSeconds(60)
private const val HTTP_OK = 200
private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)
private const val READ_CHUNK_BYTES = 64 * 1024

private const val RELEASE_FIX = "Check the release URL and that the asset is reachable over HTTPS, then run again."

internal sealed interface Download {
    class Bytes(val bytes: ByteArray) : Download

    data class Failed(val failure: BundleFailure) : Download
}

/** Why the source's URL cannot be downloaded from, before any request or cache read. */
internal fun releaseSourceProblem(source: BundleSource.Release): BundleFailure? =
    if (httpsUri(source.url) == null) notHttpsUrl(source.url) else null

/** The tarball bytes the source's URL serves, or why they could not be fetched. */
internal fun downloadReleaseTarball(source: BundleSource.Release, client: HttpClient): Download {
    val uri = httpsUri(source.url) ?: return Download.Failed(notHttpsUrl(source.url))
    val deadline = Instant.now().plus(DOWNLOAD_DEADLINE)

    return download(client, uri, REDIRECTS_MAX, deadline)
}

/** The client of the release channel: redirects are followed by hand, each one checked. */
internal fun releaseHttpClient(): HttpClient =
    HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(DOWNLOAD_DEADLINE).build()

private fun httpsUri(text: String): URI? {
    val uri = try {
        URI(text)
    } catch (error: URISyntaxException) {
        return null
    }

    return uri.takeIf { it.scheme?.lowercase() == HTTPS_SCHEME && it.host != null }
}

private fun notHttpsUrl(text: String): BundleFailure = BundleFailure(
    BundleFailureCode.RELEASE_URL,
    "The release URL ${quoted(printableUrl(text))} is not an absolute https: URL.",
    "Name the bundle tarball by its https: URL.",
)

private fun download(client: HttpClient, uri: URI, redirectsLeft: Int, deadline: Instant): Download {
    val remaining = Duration.between(Instant.now(), deadline)
    if (remaining.isNegative || remaining.isZero) return releaseFailed(uri, "took over ${DOWNLOAD_DEADLINE.toMillis()} ms")

    val request = HttpRequest.newBuilder(uri).timeout(remaining).GET().build()
    val response = try {
        client.send(request, HttpResponse.BodyHandlers.ofInputStream())
    } catch (error: HttpTimeoutException) {
        return releaseFailed(uri, "took over ${DOWNLOAD_DEADLINE.toMillis()} ms")
    } catch (error: IOException) {
        return releaseFailed(uri, "failed: ${error.message ?: error.javaClass.simpleName}")
    }

    response.body().use { body ->
        val status = response.statusCode()
        val location = response.headers().firstValue("location").orElse(null)

        if (status in REDIRECT_STATUSES && location != null) return redirected(client, uri, location, redirectsLeft, deadline)
        if (status != HTTP_OK) return releaseFailed(uri, "answered HTTP $status")

        return readCapped(body, uri)
    }
}

private fun redirected(client: HttpClient, from: URI, location: String, redirectsLeft: Int, deadline: Instant): Download {
    if (redirectsLeft == 0) return releaseFailed(from, "redirected more than $REDIRECTS_MAX times")

    val target = try {
        from.resolve(location)
    } catch (error: IllegalArgumentException) {
        null
    }
    if (target?.scheme?.lowercase() != HTTPS_SCHEME) {
        return releaseFailed(from, "redirected to ${quoted(printableUrl(location))}, which is not an https: URL")
    }

    return download(client, target, redirectsLeft - 1, deadline)
}

private fun readCapped(body: InputStream, uri: URI): Download {
    val bytes = ByteArrayOutputStream()
    val chunk = ByteArray(READ_CHUNK_BYTES)
    var received = 0L

    try {
        while (true) {
            val read = body.read(chunk)
            if (read == -1) break

            received += read
            if (received > BUNDLE_ARCHIVE_BYTES_MAX) return Download.Failed(tooLarge(received))
            bytes.write(chunk, 0, read)
        }
    } catch (error: IOException) {
        return releaseFailed(uri, "failed: ${error.message ?: error.javaClass.simpleName}")
    }

    return Download.Bytes(bytes.toByteArray())
}

private fun releaseFailed(uri: URI, what: String): Download = Download.Failed(
    BundleFailure(BundleFailureCode.RELEASE_FAILED, "Downloading the bundle from ${quoted(printableUrl(uri.toString()))} $what.", RELEASE_FIX),
)

private fun tooLarge(received: Long): BundleFailure = BundleFailure(
    code = BundleFailureCode.ARCHIVE_TOO_LARGE,
    message = "The release tarball holds more than $BUNDLE_ARCHIVE_BYTES_MAX bytes ($received received), over the cap.",
    fix = NOT_A_BUNDLE_FIX,
    expected = BUNDLE_ARCHIVE_BYTES_MAX.toString(),
)
