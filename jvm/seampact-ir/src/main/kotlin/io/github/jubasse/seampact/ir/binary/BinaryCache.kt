package io.github.jubasse.seampact.ir.binary

import com.sun.security.auth.module.NTSystem
import com.sun.security.auth.module.UnixSystem
import java.nio.file.FileAlreadyExistsException
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.attribute.AclEntryFlag
import java.nio.file.attribute.AclEntryPermission
import java.nio.file.attribute.AclEntryType
import java.nio.file.attribute.AclFileAttributeView
import java.nio.file.attribute.BasicFileAttributes
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermissions
import java.nio.file.attribute.UserPrincipal

/**
 * The private binary cache (ADR 0010, "Amendment 2026-10-21: the JVM channels", Cache checks). The runner creates
 * each missing directory owner-only whatever the umask, and checks the cache root by its real path only. Before each
 * start, the copy, its directory and each directory above it up to the cache root must be owned by the current user,
 * not be a link and not be writable by group or others; each directory above the cache root must be owned by the
 * current user or root, not be a link and not be writable by group or others. Group write is allowed when the group is
 * proven to be the owner's private group ([PosixAccounts]). On Windows, from the copy up to `%USERPROFILE%`, or up to
 * the drive root outside it, none may be a reparse point and no ACL may grant write to another account than the
 * current user, SYSTEM and Administrators.
 */
internal object BinaryCache {
    private const val POSIX_VIEW = "posix"
    private const val UNIX_VIEW = "unix"
    private const val UNIX_UID_ATTRIBUTE = "unix:uid"
    private const val UNIX_GID_ATTRIBUTE = "unix:gid"
    private const val ROOT_UID = 0L
    private const val ACL_VIEW = "acl"
    private const val WINDOWS_OS_PREFIX = "Windows"
    private const val USER_PROFILE_VARIABLE = "USERPROFILE"
    private const val SYSTEM_SID = "S-1-5-18"
    private const val ADMINISTRATORS_SID = "S-1-5-32-544"
    private const val PRIVATE_CACHE_FIX = "Keep the binary cache private to your user: owned by you, not a link, " +
        "writable by no one else (`chmod 700` on POSIX), or remove the entry so the next build creates it private."
    private const val OUTSIDE_PROFILE_FIX = "The cache is outside your profile (`%USERPROFILE%`), so it is checked up " +
        "to its drive root: move it under your profile, such as `%LOCALAPPDATA%`, which Windows keeps private."
    private val OWNER_ONLY_DIRECTORY = PosixFilePermissions.fromString("rwx------")
    private val WELL_KNOWN_WRITER_SIDS = listOf(SYSTEM_SID, ADMINISTRATORS_SID)
    private val WINDOWS_WRITE_RIGHTS = setOf(
        AclEntryPermission.WRITE_DATA,
        AclEntryPermission.APPEND_DATA,
        AclEntryPermission.ADD_FILE,
        AclEntryPermission.ADD_SUBDIRECTORY,
        AclEntryPermission.DELETE,
        AclEntryPermission.DELETE_CHILD,
        AclEntryPermission.WRITE_ACL,
        AclEntryPermission.WRITE_OWNER,
    )

    /** Creates [directory] and each missing directory above it, each owner-only (0700) on a POSIX file system. */
    fun createPrivateDirectories(directory: Path) {
        val absolute = directory.toAbsolutePath().normalize()
        val missing = generateSequence(absolute) { it.parent }.takeWhile { !Files.exists(it, LinkOption.NOFOLLOW_LINKS) }.toList()

        for (each in missing.asReversed()) {
            try {
                createOwnerOnlyDirectory(each)
            } catch (_: FileAlreadyExistsException) {
                // Another build created it in between; it is checked like any existing directory.
                continue
            }
        }
    }

    private fun createOwnerOnlyDirectory(directory: Path) {
        if (!supportsPosix(directory)) {
            Files.createDirectory(directory)
            return
        }

        // Created owner-only, so no other build sees it wider even for a moment; the creation mode goes through the
        // umask, so the modes are set again after it.
        Files.createDirectory(directory, PosixFilePermissions.asFileAttribute(OWNER_ONLY_DIRECTORY))
        Files.setPosixFilePermissions(directory, OWNER_ONLY_DIRECTORY)
    }

    /**
     * The first unsafe entry from [copy] (when it exists) up to [cacheRoot] and above it, or null. [cacheRoot] is the
     * real path the installer resolved: a link anywhere on the way, a swapped one included, is refused.
     */
    fun unsafeEntry(copy: Path, cacheRoot: Path, accounts: () -> PosixAccounts = PosixAccounts::ofHost): BinaryFailure? {
        val root = cacheRoot.normalize()
        val entry = copy.normalize()
        if (!entry.isAbsolute || !entry.startsWith(root)) return cacheUnsafe(entry, "is not under the cache root '$root'")

        return if (isWindows()) unsafeOnWindows(entry, root) else unsafeOnPosix(entry, root, lazy(accounts))
    }

    private fun unsafeOnPosix(copy: Path, root: Path, accounts: Lazy<PosixAccounts>): BinaryFailure? {
        if (UNIX_VIEW !in copy.fileSystem.supportedFileAttributeViews()) {
            return cacheUnsafe(copy, "is on a file system whose owner and modes cannot be read")
        }
        val currentUid = UnixSystem().uid

        for (entry in pathsUpTo(copy, root)) {
            if (!Files.exists(entry, LinkOption.NOFOLLOW_LINKS)) continue
            if (Files.isSymbolicLink(entry)) return cacheUnsafe(entry, "is a link")

            val ownerUid = unixNumber(entry, UNIX_UID_ATTRIBUTE, LinkOption.NOFOLLOW_LINKS)
            if (ownerUid != currentUid) return cacheUnsafe(entry, "is owned by the user id $ownerUid, not by the current user ($currentUid)")
            writableByOthers(entry, ownerUid, accounts, LinkOption.NOFOLLOW_LINKS)?.let { return it }
        }

        // The cache root is a real path, so a link above it was put there after the install resolved it.
        for (ancestor in generateSequence(root.parent) { it.parent }) {
            if (Files.isSymbolicLink(ancestor)) return cacheUnsafe(ancestor, "is above the cache and is a link")

            val ownerUid = unixNumber(ancestor, UNIX_UID_ATTRIBUTE, LinkOption.NOFOLLOW_LINKS)
            if (ownerUid != currentUid && ownerUid != ROOT_UID) {
                return cacheUnsafe(ancestor, "is above the cache and owned by the user id $ownerUid, neither the current user ($currentUid) nor root; use a private cache directory")
            }
            writableByOthers(ancestor, ownerUid, accounts, LinkOption.NOFOLLOW_LINKS)?.let { return it }
        }

        return null
    }

    // Group write is allowed when the group is proven to be the owner's private group, as OpenSSH's StrictModes allows.
    private fun writableByOthers(entry: Path, ownerUid: Long, accounts: Lazy<PosixAccounts>, vararg options: LinkOption): BinaryFailure? {
        val permissions = Files.getPosixFilePermissions(entry, *options)
        if (PosixFilePermission.OTHERS_WRITE in permissions) return cacheUnsafe(entry, "may be written by others; run `chmod 700 '$entry'`")
        if (PosixFilePermission.GROUP_WRITE !in permissions) return null

        val groupId = unixNumber(entry, UNIX_GID_ATTRIBUTE, *options)
        if (accounts.value.isPrivateGroup(groupId, ownerUid)) return null

        return cacheUnsafe(entry, "may be written by the group id $groupId, which is not proven to be its owner's private group; run `chmod g-w '$entry'`")
    }

    private fun unixNumber(entry: Path, attribute: String, vararg options: LinkOption): Long =
        (Files.getAttribute(entry, attribute, *options) as Int).toLong()

    private fun unsafeOnWindows(copy: Path, root: Path): BinaryFailure? {
        if (ACL_VIEW !in copy.fileSystem.supportedFileAttributeViews()) {
            return cacheUnsafe(copy, "is on a file system whose access control list cannot be read")
        }
        // The process token's own SID, never a name Windows resolves, which may find a local account of the same name.
        val currentUserSid = NTSystem().userSID
        val profile = userProfile()
        val insideProfile = profile != null && root.startsWith(profile)
        val fix = if (insideProfile) PRIVATE_CACHE_FIX else OUTSIDE_PROFILE_FIX

        for (entry in pathsUpTo(copy, if (insideProfile) profile else root.root)) {
            if (!Files.exists(entry, LinkOption.NOFOLLOW_LINKS)) continue
            val attributes = Files.readAttributes(entry, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            // A symbolic link is a reparse point, and so is every other entry Windows reports as neither file nor folder.
            if (attributes.isSymbolicLink || attributes.isOther) return cacheUnsafe(entry, "is a reparse point", fix)

            val acl = Files.getFileAttributeView(entry, AclFileAttributeView::class.java, LinkOption.NOFOLLOW_LINKS).acl
            val foreignWriter = acl.firstOrNull { aclEntry ->
                aclEntry.type() == AclEntryType.ALLOW &&
                    AclEntryFlag.INHERIT_ONLY !in aclEntry.flags() &&
                    aclEntry.permissions().any { it in WINDOWS_WRITE_RIGHTS } &&
                    !isAllowedWriter(aclEntry.principal(), currentUserSid)
            }
            if (foreignWriter != null) return cacheUnsafe(entry, "grants write to '${foreignWriter.principal().name}'", fix)
        }

        return null
    }

    // The current user, SYSTEM and Administrators by their SIDs, never by a name Windows translates. Java exposes no
    // SID, but a Windows principal's hash code is the hash code of its SID string.
    private fun isAllowedWriter(principal: UserPrincipal, currentUserSid: String): Boolean =
        (WELL_KNOWN_WRITER_SIDS + currentUserSid).any { sid -> principal.hashCode() == sid.hashCode() }

    // The user profile, which Windows creates private, ends the walk; a cache outside it is checked up to its drive.
    private fun userProfile(): Path? = System.getenv(USER_PROFILE_VARIABLE)?.let { Path.of(it).toAbsolutePath().normalize() }

    private fun pathsUpTo(entry: Path, limit: Path): List<Path> =
        generateSequence(entry) { it.parent }.takeWhile { it.startsWith(limit) }.toList()

    private fun supportsPosix(path: Path): Boolean = POSIX_VIEW in path.fileSystem.supportedFileAttributeViews()

    fun isWindows(): Boolean = System.getProperty("os.name").startsWith(WINDOWS_OS_PREFIX)

    private fun cacheUnsafe(entry: Path, reason: String, fix: String = PRIVATE_CACHE_FIX): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.CACHE_UNSAFE,
        message = "The binary cache entry '$entry' $reason, so the binary in it could be swapped. It is not run.",
        fix = fix,
        actual = entry.toString(),
    )
}
