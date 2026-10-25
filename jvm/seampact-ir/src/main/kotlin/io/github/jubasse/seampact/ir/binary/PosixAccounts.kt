package io.github.jubasse.seampact.ir.binary

import java.nio.file.Files
import java.nio.file.Path

/**
 * The local accounts the cache checks read (ADR 0010, Cache checks): which group is the private group of its owner,
 * as OpenSSH's StrictModes allows. A private group is named after its owner's login, no other account has it as
 * primary group and it lists no other member, on every line of the group file with its id. That is proven only when
 * the name service reads the accounts from the system files and the owner is listed there: with a directory service
 * (LDAP, SSSD, NIS) another account may have the group, so no group is private.
 */
internal class PosixAccounts(passwdText: String, groupText: String, nameServiceText: String) {
    private class GroupLine(val name: String, val members: Set<String>)

    private val readFromSystemFilesOnly: Boolean
    private val userNamesById: Map<Long, Set<String>>
    private val primaryUsersByGroupId: Map<Long, Set<String>>
    private val groupLinesById: Map<Long, List<GroupLine>>

    init {
        val passwdLines = entries(passwdText)
        val groupLines = entries(groupText)
        readFromSystemFilesOnly = nameServiceReadsFilesOnly(nameServiceText) && (passwdLines + groupLines).none(::isNisInclusion)

        val users = passwdLines.filter { it.size >= PASSWD_MIN_FIELDS }.mapNotNull { fields ->
            val userId = fields[PASSWD_UID].toLongOrNull() ?: return@mapNotNull null
            val groupId = fields[PASSWD_GID].toLongOrNull() ?: return@mapNotNull null
            Triple(fields[PASSWD_NAME], userId, groupId)
        }
        userNamesById = users.groupBy({ it.second }, { it.first }).mapValues { it.value.toSet() }
        primaryUsersByGroupId = users.groupBy({ it.third }, { it.first }).mapValues { it.value.toSet() }
        groupLinesById = groupLines.filter { it.size >= GROUP_FIELDS }.mapNotNull { fields ->
            val groupId = fields[GROUP_GID].toLongOrNull() ?: return@mapNotNull null
            groupId to GroupLine(fields[GROUP_NAME], fields[GROUP_MEMBERS].split(',').filter { it.isNotEmpty() }.toSet())
        }.groupBy({ it.first }, { it.second })
    }

    /** Whether the group [groupId] is proven to be the private group of [ownerId]'s user. */
    fun isPrivateGroup(groupId: Long, ownerId: Long): Boolean {
        if (!readFromSystemFilesOnly) return false
        val owner = userNamesById[ownerId]?.singleOrNull() ?: return false
        val lines = groupLinesById[groupId] ?: return false

        val namedAfterOwnerAlone = lines.all { line -> line.name == owner && line.members.all { it == owner } }

        return namedAfterOwnerAlone && primaryUsersByGroupId[groupId].orEmpty().all { it == owner }
    }

    companion object {
        private const val PASSWD_MIN_FIELDS = 4
        private const val PASSWD_NAME = 0
        private const val PASSWD_UID = 2
        private const val PASSWD_GID = 3
        private const val GROUP_FIELDS = 4
        private const val GROUP_NAME = 0
        private const val GROUP_GID = 2
        private const val GROUP_MEMBERS = 3
        private const val NIS_INCLUDE = "+"
        private const val NIS_EXCLUDE = "-"
        private const val ACTION_START = "["
        private val PASSWD_FILE: Path = Path.of("/etc/passwd")
        private val GROUP_FILE: Path = Path.of("/etc/group")
        private val NAME_SERVICE_FILE: Path = Path.of("/etc/nsswitch.conf")
        private val ACCOUNT_DATABASES = setOf("passwd", "group")
        private val WHITESPACE = Regex("\\s+")

        // `systemd` serves the local dynamic and home-area users, `compat` the files with NIS `+` lines, which are
        // refused apart; every other source is a directory service.
        private val LOCAL_SOURCES = setOf("files", "compat", "systemd")

        /**
         * The host's `/etc/passwd`, `/etc/group` and `/etc/nsswitch.conf`; a missing account file lists no account,
         * and without a name service file the C library reads the files only.
         */
        fun ofHost(): PosixAccounts = PosixAccounts(readIfPresent(PASSWD_FILE), readIfPresent(GROUP_FILE), readIfPresent(NAME_SERVICE_FILE))

        private fun readIfPresent(file: Path): String = if (Files.isRegularFile(file)) Files.readString(file) else ""

        private fun entries(text: String): List<List<String>> =
            text.lines().filter { it.isNotBlank() && !it.startsWith("#") }.map { it.split(':') }

        private fun isNisInclusion(fields: List<String>): Boolean =
            fields.first().startsWith(NIS_INCLUDE) || fields.first().startsWith(NIS_EXCLUDE)

        private fun nameServiceReadsFilesOnly(nameServiceText: String): Boolean = nameServiceText.lines()
            .map { it.substringBefore('#').trim() }
            .filter { line -> ':' in line && line.substringBefore(':').trim() in ACCOUNT_DATABASES }
            .flatMap { line -> line.substringAfter(':').split(WHITESPACE).filter { it.isNotEmpty() && !it.startsWith(ACTION_START) } }
            .all { it in LOCAL_SOURCES }
    }
}
