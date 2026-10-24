package io.github.jubasse.seampact.ir.bundle

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpsConfigurator
import com.sun.net.httpserver.HttpsServer
import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import java.io.FileNotFoundException
import java.net.InetSocketAddress
import java.net.http.HttpClient
import java.nio.file.Files
import java.nio.file.Path
import java.security.KeyStore
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

// The release channel against a local HTTPS server with a test certificate: a good tarball, a tampered one,
// redirects, the cache by integrity, and the Maven artefact and package forms of a bundle source.
class ReleaseFetchTest {
    @TempDir
    lateinit var workspace: Path

    private lateinit var server: HttpsServer
    private lateinit var client: HttpClient

    @BeforeEach
    fun startServer() {
        val keyStore = testKeyStore()
        val context = SSLContext.getInstance("TLS")
        val keys = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(keyStore, PASSWORD) }
        val trust = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(keyStore) }
        context.init(keys.keyManagers, trust.trustManagers, null)

        server = HttpsServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.httpsConfigurator = HttpsConfigurator(context)
        server.createContext("/good") { it.answer(200, BundleFixture.tarball) }
        server.createContext("/tampered") { it.answer(200, BundleFixture.tarball.copyOf().also { bytes -> bytes[bytes.size - 5] = (bytes[bytes.size - 5] + 1).toByte() }) }
        server.createContext("/to-good") { it.redirect("/good") }
        server.createContext("/to-http") { it.redirect("http://127.0.0.1:${server.address.port}/good") }
        server.createContext("/loop") { it.redirect("/loop") }
        server.createContext("/missing") { it.answer(404, ByteArray(0)) }
        server.start()

        client = HttpClient.newBuilder().sslContext(context).followRedirects(HttpClient.Redirect.NEVER).build()
    }

    @AfterEach
    fun stopServer() = server.stop(0)

    @Test
    fun fetchesAndCachesAGoodTarball() {
        val fetcher = fetcher()
        assertIs<BundleVerifyResult.Verified>(fetcher.fetch(release("/good"), workspace, LocalSourcePolicy.ALLOW))

        server.stop(0)
        val cached = fetcher.fetch(release("/good"), workspace, LocalSourcePolicy.ALLOW)
        assertIs<BundleVerifyResult.Verified>(cached, "the second fetch reads the cache, with the server down")
    }

    @Test
    fun namesACacheEntryChangedAfterItWasCached() {
        val fetcher = fetcher()
        fetcher.fetch(release("/good"), workspace, LocalSourcePolicy.ALLOW)
        val manifest = Files.walk(workspace.resolve("cache")).use { paths -> paths.filter { it.fileName.toString() == "seampact-bundle.json" }.findFirst().get() }
        val irFile = Files.walk(manifest.parent.resolve("ir")).use { paths -> paths.filter(Files::isRegularFile).findFirst().get() }
        Files.writeString(irFile, " ", java.nio.file.StandardOpenOption.APPEND)

        assertEquals(listOf("bundle.cache-invalid", "bundle.file-size"), codes(fetcher.fetch(release("/good"), workspace, LocalSourcePolicy.ALLOW)))
    }

    @Test
    fun refusesWhatTheNodeRunnerRefuses() {
        assertEquals(listOf("bundle.archive-invalid"), codes(fetcher().fetch(release("/tampered"), workspace, LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.release-failed"), codes(fetcher().fetch(release("/to-http"), workspace, LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.release-failed"), codes(fetcher().fetch(release("/loop"), workspace, LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.release-failed"), codes(fetcher().fetch(release("/missing"), workspace, LocalSourcePolicy.ALLOW)))
        assertEquals(listOf("bundle.release-url"), codes(fetcher().fetch(BundleSource.Release("http://example.com/b.tgz", null), workspace, LocalSourcePolicy.ALLOW)))
        assertIs<BundleVerifyResult.Verified>(fetcher().fetch(release("/to-good"), workspace, LocalSourcePolicy.ALLOW))
    }

    @Test
    fun printsTheIntegrityToPinAndCachesNothingUnpinned() {
        val unpinned = assertIs<BundleVerifyResult.Refused>(fetcher().fetch(BundleSource.Release(url("/good"), null), workspace, LocalSourcePolicy.ALLOW))

        assertEquals(listOf("bundle.pin-missing"), unpinned.failures.map { it.code.code })
        assertEquals(BundleFixture.integrity, unpinned.integrity)
        assertTrue(Files.notExists(workspace.resolve("cache")))
    }

    @Test
    fun checksAMavenArtefactTheBuildResolvedAndRefusesAPackage() {
        Files.write(workspace.resolve("contract-1.0.0.tgz"), BundleFixture.tarball)
        val artefact = BundleSource.MavenArtefact("com.acme:contract:1.0.0", BundleFixture.integrity)
        assertIs<BundleVerifyResult.Verified>(fetcher().fetch(artefact, workspace, LocalSourcePolicy.ALLOW))

        val missing = BundleSource.MavenArtefact("com.acme:none:1.0.0", "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        assertEquals(listOf("bundle.artefact-unreadable"), codes(fetcher().fetch(missing, workspace, LocalSourcePolicy.ALLOW)))

        val npm = BundleSource.Package("@acme/contract", "1.0.0", BundleFixture.integrity)
        assertEquals(listOf("bundle.package-unsupported"), codes(fetcher().fetch(npm, workspace, LocalSourcePolicy.ALLOW)))
    }

    // The build's resolver, stood in by a directory holding `<artifactId>-<version>.tgz`.
    private fun fetcher() = BundleFetcher(workspace.resolve("cache"), emptyMap(), ::resolveArtefact, client)

    private fun resolveArtefact(coordinates: String): Path {
        val (_, artifactId, version) = coordinates.split(":")
        val file = workspace.resolve("$artifactId-$version.tgz")
        if (Files.notExists(file)) throw FileNotFoundException("no artefact $coordinates in the test repository")

        return file
    }

    private fun url(path: String) = "https://127.0.0.1:${server.address.port}$path"

    private fun release(path: String) = BundleSource.Release(url(path), BundleFixture.integrity)

    private fun codes(result: BundleVerifyResult): List<String> = assertIs<BundleVerifyResult.Refused>(result).failures.map { it.code.code }

    private fun HttpExchange.answer(status: Int, body: ByteArray) {
        sendResponseHeaders(status, if (body.isEmpty()) -1 else body.size.toLong())
        responseBody.use { it.write(body) }
    }

    private fun HttpExchange.redirect(location: String) {
        responseHeaders.add("Location", location)
        sendResponseHeaders(302, -1)
        close()
    }

    // A self-signed certificate for 127.0.0.1, written by the JDK's own keytool.
    private fun testKeyStore(): KeyStore {
        val file = workspace.resolve("test.p12")
        val keytool = Path.of(System.getProperty("java.home"), "bin", "keytool").toString()
        val process = ProcessBuilder(
            keytool, "-genkeypair", "-alias", "test", "-keyalg", "EC", "-groupname", "secp256r1", "-dname", "CN=127.0.0.1",
            "-ext", "SAN=ip:127.0.0.1", "-validity", "2", "-storetype", "PKCS12", "-keystore", file.toString(),
            "-storepass", String(PASSWORD), "-keypass", String(PASSWORD),
        ).redirectErrorStream(true).start()
        val output = process.inputStream.readAllBytes().toString(Charsets.UTF_8)
        check(process.waitFor() == 0) { "keytool failed: $output" }

        return KeyStore.getInstance("PKCS12").apply { Files.newInputStream(file).use { load(it, PASSWORD) } }
    }

    private companion object {
        val PASSWORD = "seampact-test".toCharArray()
    }
}
