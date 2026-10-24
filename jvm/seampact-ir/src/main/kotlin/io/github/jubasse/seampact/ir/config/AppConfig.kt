package io.github.jubasse.seampact.ir.config

import io.github.jubasse.seampact.ir.bundle.BundleSource
import java.nio.file.Path
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** A source an app config names: a local contract workspace, or a bundle (ADR 0011 "The app config"). */
public sealed interface ConfigSource {
    /** A `path` source, resolved against the directory of the config that writes it. */
    public data class Local(val directory: Path) : ConfigSource

    /** A bundle source, as the config writes it. */
    public data class Bundle(val source: BundleSource) : ConfigSource
}

/** The runner a target entry's `use` belongs to: the forms cannot be confused (ADR 0011). */
public enum class TargetEcosystem {
    /** A Maven `group:artifact` coordinate: the Gradle and Maven plugins generate it. */
    MAVEN,

    /** An npm package name: the Node CLI generates it. */
    NPM,

    /** A Composer `vendor/name`: the Composer runner generates it. */
    COMPOSER,
    ;

    public companion object {
        // npm names never hold a colon, and an unscoped npm name never holds a slash.
        public fun of(use: String): TargetEcosystem = when {
            ':' in use -> MAVEN
            !use.startsWith("@") && !use.startsWith(".") && '/' in use -> COMPOSER
            else -> NPM
        }
    }
}

/**
 * One target entry with its output root, `<outDir>/<out>`, absolute. [entry] is the entry as the config writes
 * it, a copy; the typed members are read from it.
 */
public data class AppConfigEntry(val entry: JsonObject, val root: Path) {
    public val id: String get() = entry.requiredStringAt("id")
    public val use: String get() = entry.requiredStringAt("use")
    public val ecosystem: TargetEcosystem get() = TargetEcosystem.of(use)

    /** The entry's `api`, or each of its `apis`: an api name alone, or `<source>/<api>`. */
    public val apiRefs: List<String> get() = entry.stringsAt("apis") ?: listOfNotNull(entry.stringAt("api"))
    public val document: String? get() = entry.stringAt("document")
    public val include: List<String> get() = (entry["operations"] as? JsonObject)?.stringsAt("include") ?: emptyList()
    public val exclude: List<String> get() = (entry["operations"] as? JsonObject)?.stringsAt("exclude") ?: emptyList()
    public val options: JsonObject get() = entry["options"] as? JsonObject ?: JsonObject(emptyMap())
    public val artefacts: JsonObject get() = entry["artefacts"] as? JsonObject ?: JsonObject(emptyMap())
    public val frameworkDocs: String? get() = entry.stringAt("frameworkDocs")
    public val link: Map<String, String> get() =
        (entry["link"] as? JsonObject)?.mapNotNull { (kind, provider) -> provider.stringValue()?.let { kind to it } }?.toMap() ?: emptyMap()
}

/**
 * An app config as the JVM runner reads it, from `seampact.config.yaml` or the plugin's DSL (A42). [entries] are
 * the entries of this runner's ecosystem (Maven coordinates); [otherEntries] those another runner generates, kept
 * so a caller can list them, never generated here. The `openapi`, `checks`, `diff` and `warnings` members are as
 * the config writes them, absent when it does not.
 */
public data class AppConfig(
    val displayName: String,
    val directory: Path,
    val outDir: Path,
    val allowLocal: Boolean?,
    val sources: Map<String, ConfigSource>,
    val entries: List<AppConfigEntry>,
    val otherEntries: List<AppConfigEntry>,
    val openapi: JsonElement?,
    val checks: JsonObject?,
    val diff: JsonObject?,
    val warnings: JsonObject?,
)

/** The outcome of reading an app config. */
public sealed interface AppConfigRead {
    public data class Read(val config: AppConfig) : AppConfigRead

    public data class Refused(val problems: List<ConfigProblem>) : AppConfigRead
}
