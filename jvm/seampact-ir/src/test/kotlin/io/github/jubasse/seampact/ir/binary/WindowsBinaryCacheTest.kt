package io.github.jubasse.seampact.ir.binary

import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.AclEntry
import java.nio.file.attribute.AclEntryPermission
import java.nio.file.attribute.AclEntryType
import java.nio.file.attribute.AclFileAttributeView
import java.nio.file.attribute.UserPrincipal
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.condition.EnabledOnOs
import org.junit.jupiter.api.condition.OS

// The Windows cache checks (ADR 0010, Cache checks) on a real NTFS ACL: a cache under the user profile is accepted,
// an ACE that lets another account write is refused naming it, a junction is refused, and SYSTEM and Administrators
// are found by their SIDs. The binary is never started here, so any bytes stand for it.
@EnabledOnOs(OS.WINDOWS)
class WindowsBinaryCacheTest {
    private lateinit var work: Path
    private lateinit var binary: Path
    private lateinit var pin: BinaryPin

    @BeforeTest
    fun createTheWorkUnderTheProfile() {
        // The test task's temporary directory lies in the checkout, outside the profile; the cache checks stop at
        // the profile only for a cache inside it.
        val localAppData = Path.of(checkNotNull(System.getenv(LOCAL_APP_DATA_VARIABLE)) { "$LOCAL_APP_DATA_VARIABLE is not set" })
        work = Files.createTempDirectory(Files.createDirectories(localAppData.resolve("Temp")), "seampact-windows-cache-")
        binary = Files.writeString(work.resolve("binary.exe"), "not run")
        pin = BinaryPin.LocalFile(binary, BinaryInstaller.sha256Of(binary))
    }

    @AfterTest
    fun removeTheWork() {
        work.toFile().deleteRecursively()
    }

    @Test
    fun aCacheUnderTheProfileIsAccepted() {
        val install = install(work.resolve("cache"))

        check(install is BinaryInstall.Installed) { "$install" }
        assertNull(BinaryCache.unsafeEntry(install.binary.path, install.binary.cacheRoot))
    }

    @Test
    fun anAceGrantingWriteToEveryoneIsRefusedNamingIt() {
        val install = install(work.resolve("cache"))
        check(install is BinaryInstall.Installed) { "$install" }
        val everyone = work.fileSystem.userPrincipalLookupService.lookupPrincipalByGroupName(EVERYONE)

        grantWrite(install.binary.path.parent, everyone)

        val unsafe = BinaryCache.unsafeEntry(install.binary.path, install.binary.cacheRoot)
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, unsafe?.code)
        assertTrue(unsafe!!.message.contains(EVERYONE), unsafe.message)
    }

    @Test
    fun systemAndAdministratorsAcesAreAccepted() {
        val install = install(work.resolve("cache"))
        check(install is BinaryInstall.Installed) { "$install" }
        val lookup = work.fileSystem.userPrincipalLookupService

        grantWrite(install.binary.path.parent, lookup.lookupPrincipalByName(SYSTEM))
        grantWrite(install.binary.path.parent, lookup.lookupPrincipalByGroupName(ADMINISTRATORS))

        assertNull(BinaryCache.unsafeEntry(install.binary.path, install.binary.cacheRoot))
    }

    @Test
    fun aJunctionInTheCacheIsRefused() {
        val first = install(work.resolve("cache"))
        check(first is BinaryInstall.Installed) { "$first" }
        val linkedCache = Files.createDirectory(work.resolve("linked-cache"))
        createJunction(linkedCache.resolve(pin.sha256), first.binary.path.parent)

        val install = install(linkedCache)

        val failure = (install as BinaryInstall.Refused).failure
        assertEquals(BinaryFailureCode.CACHE_UNSAFE, failure.code)
        assertTrue(failure.message.contains("reparse point"), failure.message)
    }

    private fun install(cacheRoot: Path): BinaryInstall = BinaryInstaller.install(binary, pin, cacheRoot, "the test cache setting")

    private fun grantWrite(directory: Path, principal: UserPrincipal) {
        val view = Files.getFileAttributeView(directory, AclFileAttributeView::class.java)
        val write = AclEntry.newBuilder()
            .setType(AclEntryType.ALLOW)
            .setPrincipal(principal)
            .setPermissions(AclEntryPermission.WRITE_DATA, AclEntryPermission.ADD_FILE)
            .build()

        view.acl = view.acl + write
    }

    // `mklink /J` needs no privilege, unlike a symbolic link.
    private fun createJunction(junction: Path, target: Path) {
        val process = ProcessBuilder("cmd.exe", "/c", "mklink", "/J", junction.toString(), target.toString())
            .redirectErrorStream(true)
            .start()
        val output = process.inputStream.readAllBytes().decodeToString()

        check(process.waitFor(JUNCTION_TIMEOUT_SECONDS, TimeUnit.SECONDS) && process.exitValue() == 0) { "mklink /J failed: $output" }
    }

    private companion object {
        const val LOCAL_APP_DATA_VARIABLE = "LOCALAPPDATA"
        const val EVERYONE = "Everyone"
        const val SYSTEM = "SYSTEM"
        const val ADMINISTRATORS = "Administrators"
        const val JUNCTION_TIMEOUT_SECONDS = 30L
    }
}
