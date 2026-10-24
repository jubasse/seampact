package io.github.jubasse.seampact.gradle.dsl

import kotlinx.serialization.json.JsonObject
import org.gradle.api.Action
import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.Property
import javax.inject.Inject

/**
 * One entry of the app config's `sources`: a `path`, or a bundle with its `integrity` (ADR 0011 "Channels",
 * ADR 0010 "The contract bundle as a Maven artefact"). `packageName` is the config's `package`, a Kotlin keyword.
 */
public abstract class SourceSpec @Inject constructor(private val objects: ObjectFactory) {
    public abstract val path: Property<String>
    public abstract val packageName: Property<String>
    public abstract val version: Property<String>
    public abstract val maven: Property<String>
    public abstract val integrity: Property<String>

    private var release: ReleaseSpec? = null
    private var git: GitSpec? = null

    /** A release asset: `release { url = "https://..." }`. */
    public fun release(action: Action<ReleaseSpec>) {
        action.execute(release ?: objects.newInstance(ReleaseSpec::class.java).also { release = it })
    }

    /** A git tag: `git { url = "..."; tag = "v1.4.0"; directory = "bundle" }`. */
    public fun git(action: Action<GitSpec>) {
        action.execute(git ?: objects.newInstance(GitSpec::class.java).also { git = it })
    }

    internal fun toJson(): JsonObject {
        val members = JsonMembers()
        members.string("path", path)
        members.string("package", packageName)
        members.string("version", version)
        members.element("release", release?.toJson())
        members.element("git", git?.toJson())
        members.string("maven", maven)
        members.string("integrity", integrity)

        return members.toJson()
    }
}

/** The `release` of a bundle source. */
public abstract class ReleaseSpec {
    public abstract val url: Property<String>

    internal fun toJson(): JsonObject = JsonMembers().apply { string("url", url) }.toJson()
}

/** The `git` of a bundle source. */
public abstract class GitSpec {
    public abstract val url: Property<String>
    public abstract val tag: Property<String>
    public abstract val directory: Property<String>

    internal fun toJson(): JsonObject = JsonMembers().apply {
        string("url", url)
        string("tag", tag)
        string("directory", directory)
    }.toJson()
}
