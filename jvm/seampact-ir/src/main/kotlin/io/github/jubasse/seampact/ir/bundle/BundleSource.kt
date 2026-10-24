package io.github.jubasse.seampact.ir.bundle

/**
 * Where a bundle comes from (ADR 0011 "Channels", ADR 0010 "The contract bundle as a Maven artefact"), with the
 * [integrity] the config or the build file pins; a missing pin fails the check and prints the value to pin.
 */
public sealed interface BundleSource {
    public val integrity: String?

    /** The source as the config writes it, for messages. */
    public fun describe(): String

    /** An npm package and its version: read from an installed package by the Node runner only. */
    public data class Package(val name: String, val version: String, override val integrity: String?) : BundleSource {
        override fun describe(): String = "package '$name' version $version"
    }

    /** A release asset: the tarball downloaded over HTTPS. */
    public data class Release(val url: String, override val integrity: String?) : BundleSource {
        override fun describe(): String = "release '${printableUrl(url)}'"
    }

    /** A git tag: the bundle directory of the tag's tree, fetched with the system `git`. */
    public data class Git(val url: String, val tag: String, val directory: String?, override val integrity: String?) : BundleSource {
        override fun describe(): String {
            val inDirectory = if (directory == null) "" else ", directory '$directory'"

            return "git '${printableUrl(url)}' tag '$tag'$inDirectory"
        }
    }

    /**
     * A bundle tarball published as the Maven artefact [coordinates] (`groupId:artifactId:version`), which the build
     * resolves through its own repositories ([MavenArtefactResolver]).
     */
    public data class MavenArtefact(val coordinates: String, override val integrity: String?) : BundleSource {
        override fun describe(): String = "Maven artefact '$coordinates'"
    }
}
