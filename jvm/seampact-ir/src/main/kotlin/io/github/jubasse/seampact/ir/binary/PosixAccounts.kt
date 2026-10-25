package io.github.jubasse.seampact.ir.binary

import java.nio.file.Files
import java.nio.file.Path

/**
 * The local accounts the cache checks read (ADR 0010, Cache checks): which group is the private group of its owner,
 * the owner being its only member, as OpenSSH's StrictModes allows. A member is a user the group file lists or a
 * user whose primary group it is. A group the files do not list (a directory service) is not private.
 */
internal class PosixAccounts(passwdText: String, groupText: String) {
    private val userNameById: Map<Long, String>
    private val primaryUsersByGroupId: Map<Long, Set<String>>
    private val membersByGroupId: Map<Long, Set<String>>

    init {
        val users = entries(passwdText).filter { it.size >= PASSWD_MIN_FIELDS }.mapNotNull { fields ->
            val userId = fields[PASSWD_UID].toLongOrNull() ?: return@mapNotNull null
            val groupId = fields[PASSWD_GID].toLongOrNull() ?: return@mapNotNull null
            Triple(fields[PASSWD_NAME], userId, groupId)
        }
        userNameById = users.associate { (name, userId, _) -> userId to name }
        primaryUsersByGroupId = users.groupBy({ it.third }, { it.first }).mapValues { it.value.toSet() }
        membersByGroupId = entries(groupText).filter { it.size >= GROUP_FIELDS }.mapNotNull { fields ->
            val groupId = fields[GROUP_GID].toLongOrNull() ?: return@mapNotNull null
            groupId to fields[GROUP_MEMBERS].split(',').filter { it.isNotEmpty() }.toSet()
        }.toMap()
    }

    /** Whether [ownerId]'s user is the only member of the group [groupId]. */
    fun isPrivateGroup(groupId: Long, ownerId: Long): Boolean {
        val owner = userNameById[ownerId] ?: return false
        val listedMembers = membersByGroupId[groupId] ?: return false
        val members = listedMembers + primaryUsersByGroupId[groupId].orEmpty()

        return members == setOf(owner)
    }

    companion object {
        private const val PASSWD_MIN_FIELDS = 4
        private const val PASSWD_NAME = 0
        private const val PASSWD_UID = 2
        private const val PASSWD_GID = 3
        private const val GROUP_FIELDS = 4
        private const val GROUP_GID = 2
        private const val GROUP_MEMBERS = 3
        private val PASSWD_FILE: Path = Path.of("/etc/passwd")
        private val GROUP_FILE: Path = Path.of("/etc/group")

        /** The host's `/etc/passwd` and `/etc/group`; a file that is missing lists no account. */
        fun ofHost(): PosixAccounts = PosixAccounts(readIfPresent(PASSWD_FILE), readIfPresent(GROUP_FILE))

        private fun readIfPresent(file: Path): String = if (Files.isRegularFile(file)) Files.readString(file) else ""

        private fun entries(text: String): List<List<String>> =
            text.lines().filter { it.isNotBlank() && !it.startsWith("#") }.map { it.split(':') }
    }
}
