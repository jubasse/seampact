package io.github.jubasse.seampact.ir.bundle

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URISyntaxException
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CompletionStage
import java.util.concurrent.ExecutionException
import java.util.concurrent.Flow
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
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
internal val DOWNLOAD_DEADLINE: Duration = Duration.ofSeconds(60)
private const val HTTP_OK = 200
private val REDIRECT_STATUSES = setOf(301, 302, 303, 307, 308)

private const val RELEASE_FIX = "Check the release URL and that the asset is reachable over HTTPS, then run again."

internal sealed interface Download {
    class Bytes(val bytes: ByteArray) : Download

    data class Failed(val failure: BundleFailure) : Download
}

/** Why the source's URL cannot be downloaded from, before any request or cache read. */
internal fun releaseSourceProblem(source: BundleSource.Release): BundleFailure? =
    if (httpsUri(source.url) == null) notHttpsUrl(source.url) else null

/** The tarball bytes the source's URL serves, or why they could not be fetched. */
internal fun downloadReleaseTarball(source: BundleSource.Release, client: HttpClient, limit: Duration): Download {
    val uri = httpsUri(source.url) ?: return Download.Failed(notHttpsUrl(source.url))
    val deadline = Instant.now().plus(limit)

    return download(client, uri, REDIRECTS_MAX, deadline, limit)
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

private fun download(client: HttpClient, uri: URI, redirectsLeft: Int, deadline: Instant, limit: Duration): Download {
    val remaining = Duration.between(Instant.now(), deadline)
    if (remaining.isNegative || remaining.isZero) return releaseFailed(uri, "took over ${limit.toMillis()} ms")

    // The future completes once the whole body is read, so the deadline bounds the body too; past it the
    // exchange is cancelled.
    val request = HttpRequest.newBuilder(uri).timeout(remaining).GET().build()
    val exchange = client.sendAsync(request, ::cappedBody)
    val response = try {
        exchange.get(remaining.toMillis(), TimeUnit.MILLISECONDS)
    } catch (error: TimeoutException) {
        exchange.cancel(true)
        return releaseFailed(uri, "took over ${limit.toMillis()} ms")
    } catch (error: ExecutionException) {
        val cause = error.cause ?: error
        if (cause is HttpTimeoutException) return releaseFailed(uri, "took over ${limit.toMillis()} ms")

        return releaseFailed(uri, "failed: ${cause.message ?: cause.javaClass.simpleName}")
    }

    val status = response.statusCode()
    val location = response.headers().firstValue("location").orElse(null)
    if (status in REDIRECT_STATUSES && location != null) return redirected(client, uri, location, redirectsLeft, deadline, limit)
    if (status != HTTP_OK) return releaseFailed(uri, "answered HTTP $status")

    return when (val body = response.body()) {
        is CappedBody.Read -> Download.Bytes(body.bytes)
        is CappedBody.OverCap -> Download.Failed(tooLarge(body.received))
        CappedBody.Discarded -> releaseFailed(uri, "answered HTTP $status")
    }
}

private fun redirected(client: HttpClient, from: URI, location: String, redirectsLeft: Int, deadline: Instant, limit: Duration): Download {
    if (redirectsLeft == 0) return releaseFailed(from, "redirected more than $REDIRECTS_MAX times")

    val target = try {
        from.resolve(location)
    } catch (error: IllegalArgumentException) {
        null
    }
    if (target?.scheme?.lowercase() != HTTPS_SCHEME || target.host == null) {
        return releaseFailed(from, "redirected to ${quoted(printableUrl(location))}, which is not an https: URL")
    }

    return download(client, target, redirectsLeft - 1, deadline, limit)
}

private sealed interface CappedBody {
    class Read(val bytes: ByteArray) : CappedBody

    data class OverCap(val received: Long) : CappedBody

    data object Discarded : CappedBody
}

// The body of a 200 answer up to the archive cap, the exchange cancelled past it; any other answer's body discarded.
private fun cappedBody(info: HttpResponse.ResponseInfo): HttpResponse.BodySubscriber<CappedBody> =
    if (info.statusCode() == HTTP_OK) CappedBodySubscriber() else HttpResponse.BodySubscribers.replacing(CappedBody.Discarded)

private class CappedBodySubscriber : HttpResponse.BodySubscriber<CappedBody> {
    private val result = CompletableFuture<CappedBody>()
    private val bytes = ByteArrayOutputStream()
    private var received = 0L
    private lateinit var subscription: Flow.Subscription

    override fun getBody(): CompletionStage<CappedBody> = result

    override fun onSubscribe(subscription: Flow.Subscription) {
        this.subscription = subscription
        subscription.request(Long.MAX_VALUE)
    }

    override fun onNext(item: List<ByteBuffer>) {
        if (result.isDone) return

        for (buffer in item) {
            received += buffer.remaining()
            if (received > BUNDLE_ARCHIVE_BYTES_MAX) {
                subscription.cancel()
                result.complete(CappedBody.OverCap(received))
                return
            }
            val chunk = ByteArray(buffer.remaining())
            buffer.get(chunk)
            bytes.write(chunk)
        }
    }

    override fun onError(throwable: Throwable) {
        result.completeExceptionally(throwable)
    }

    override fun onComplete() {
        result.complete(CappedBody.Read(bytes.toByteArray()))
    }
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
