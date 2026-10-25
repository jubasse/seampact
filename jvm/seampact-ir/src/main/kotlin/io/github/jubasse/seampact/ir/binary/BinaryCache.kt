package io.github.jubasse.seampact.ir.binary

import com.sun.security.auth.module.UnixSystem
import java.io.IOException
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
 * each missing directory owner-only whatever the umask. Before each start, the copy, its directory and each directory
 * above it up to the cache root must be owned by the current user, not be a link and not be writable by group or
 * others; each directory above the cache root must be owned by the current user or root and not be writable by group
 * or others. Group write is allowed when the group is the owner's private group ([PosixAccounts]). On Windows, from
 * the copy up to `%USERPROFILE%`, none may be a reparse point and no ACL may grant write to another account than the
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
    private const val USER_NAME_PROPERTY = "user.name"
    private const val SYSTEM_SID = "S-1-5-18"
    private const val ADMINISTRATORS_SID = "S-1-5-32-544"
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
                Files.createDirectory(each)
            } catch (_: FileAlreadyExistsException) {
                // Another build created it in between; it is checked like any existing directory.
                continue
            }
            // The creation mode goes through the umask, so the owner-only modes are set after it.
            if (supportsPosix(each)) Files.setPosixFilePermissions(each, OWNER_ONLY_DIRECTORY)
        }
    }

    /** The first unsafe entry from [copy] (when it exists) up to [cacheRoot] and above it, or null. */
    fun unsafeEntry(copy: Path, cacheRoot: Path, accounts: () -> PosixAccounts = PosixAccounts::ofHost): BinaryFailure? {
        val root = cacheRoot.toAbsolutePath().normalize()
        val entry = copy.toAbsolutePath().normalize()
        if (!entry.startsWith(root)) return cacheUnsafe(entry, "is not under the cache root '$root'")

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

        // Above the cache root, links are followed: the real directories decide who may swap the cache.
        val realParent = root.parent?.toRealPath() ?: return null
        for (ancestor in generateSequence(realParent) { it.parent }) {
            val ownerUid = unixNumber(ancestor, UNIX_UID_ATTRIBUTE)
            if (ownerUid != currentUid && ownerUid != ROOT_UID) {
                return cacheUnsafe(ancestor, "is above the cache and owned by the user id $ownerUid, neither the current user ($currentUid) nor root; use a private cache directory")
            }
            writableByOthers(ancestor, ownerUid, accounts)?.let { return it }
        }

        return null
    }

    // Group write is allowed when the group is the owner's private group, as OpenSSH's StrictModes allows.
    private fun writableByOthers(entry: Path, ownerUid: Long, accounts: Lazy<PosixAccounts>, vararg options: LinkOption): BinaryFailure? {
        val permissions = Files.getPosixFilePermissions(entry, *options)
        if (PosixFilePermission.OTHERS_WRITE in permissions) return cacheUnsafe(entry, "may be written by others; run `chmod 700 '$entry'`")
        if (PosixFilePermission.GROUP_WRITE !in permissions) return null

        val groupId = unixNumber(entry, UNIX_GID_ATTRIBUTE, *options)
        if (accounts.value.isPrivateGroup(groupId, ownerUid)) return null

        return cacheUnsafe(entry, "may be written by the group id $groupId, which is not its owner's private group; run `chmod 700 '$entry'`")
    }

    private fun unixNumber(entry: Path, attribute: String, vararg options: LinkOption): Long =
        (Files.getAttribute(entry, attribute, *options) as Int).toLong()

    private fun unsafeOnWindows(copy: Path, root: Path): BinaryFailure? {
        if (ACL_VIEW !in copy.fileSystem.supportedFileAttributeViews()) {
            return cacheUnsafe(copy, "is on a file system whose access control list cannot be read")
        }
        val currentUser = try {
            copy.fileSystem.userPrincipalLookupService.lookupPrincipalByName(System.getProperty(USER_NAME_PROPERTY))
        } catch (lookupFailed: IOException) {
            return cacheUnsafe(copy, "cannot be checked: the current user is not found (${lookupFailed.message})")
        }

        for (entry in pathsUpTo(copy, windowsCheckLimit(root))) {
            if (!Files.exists(entry, LinkOption.NOFOLLOW_LINKS)) continue
            val attributes = Files.readAttributes(entry, BasicFileAttributes::class.java, LinkOption.NOFOLLOW_LINKS)
            // A symbolic link is a reparse point, and so is every other entry Windows reports as neither file nor folder.
            if (attributes.isSymbolicLink || attributes.isOther) return cacheUnsafe(entry, "is a reparse point")

            val acl = Files.getFileAttributeView(entry, AclFileAttributeView::class.java, LinkOption.NOFOLLOW_LINKS).acl
            val foreignWriter = acl.firstOrNull { aclEntry ->
                aclEntry.type() == AclEntryType.ALLOW &&
                    AclEntryFlag.INHERIT_ONLY !in aclEntry.flags() &&
                    aclEntry.permissions().any { it in WINDOWS_WRITE_RIGHTS } &&
                    !isAllowedWriter(aclEntry.principal(), currentUser)
            }
            if (foreignWriter != null) return cacheUnsafe(entry, "grants write to '${foreignWriter.principal().name}'")
        }

        return null
    }

    // SYSTEM and Administrators by their well-known SIDs, never by a name Windows translates. Java exposes no SID,
    // but a Windows principal's hash code is the hash code of its SID string.
    private fun isAllowedWriter(principal: UserPrincipal, currentUser: UserPrincipal): Boolean =
        principal == currentUser || WELL_KNOWN_WRITER_SIDS.any { sid -> principal.hashCode() == sid.hashCode() }

    // The user profile, which Windows creates private, ends the walk; a cache outside it is checked up to its drive.
    private fun windowsCheckLimit(root: Path): Path {
        val profile = System.getenv(USER_PROFILE_VARIABLE)?.let { Path.of(it).toAbsolutePath().normalize() }

        return if (profile != null && root.startsWith(profile)) profile else root.root
    }

    private fun pathsUpTo(entry: Path, limit: Path): List<Path> =
        generateSequence(entry) { it.parent }.takeWhile { it.startsWith(limit) }.toList()

    private fun supportsPosix(path: Path): Boolean = POSIX_VIEW in path.fileSystem.supportedFileAttributeViews()

    fun isWindows(): Boolean = System.getProperty("os.name").startsWith(WINDOWS_OS_PREFIX)

    private fun cacheUnsafe(entry: Path, reason: String): BinaryFailure = BinaryFailure(
        code = BinaryFailureCode.CACHE_UNSAFE,
        message = "The binary cache entry '$entry' $reason, so the binary in it could be swapped. It is not run.",
        fix = "Keep the binary cache private to your user: owned by you, not a link, writable by no one else " +
            "(`chmod 700` on POSIX), or remove '$entry' so the next build creates it private.",
        actual = entry.toString(),
    )
}
