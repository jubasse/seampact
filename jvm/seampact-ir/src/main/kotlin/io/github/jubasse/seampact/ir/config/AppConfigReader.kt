package io.github.jubasse.seampact.ir.config

import io.github.jubasse.seampact.ir.bundle.BundleSource
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Reads an app config (ADR 0011 "The app config") as the Node CLI's `read-app-config.ts` does, with the same
 * problem codes: from `seampact.config.yaml`, or from the same keys a build plugin's DSL writes (A42), which arrive
 * as the same JSON tree and are checked against the same `app.schema.json`. One app has one source: a config file
 * beside a DSL configuration is refused, naming both. Paths resolve against the app's directory.
 */
public object AppConfigReader {
    public const val FILE_NAME: String = "seampact.config.yaml"

    /** Reads the app config file [file]; [displayName] names it in problems. */
    public fun readFile(file: Path, displayName: String = file.toString()): AppConfigRead {
        val absolute = file.toAbsolutePath().normalize()
        val tree = when (val read = readConfigFile(absolute, displayName, ConfigKind.APP)) {
            is ConfigFileRead.Read -> read.tree
            is ConfigFileRead.Refused -> return AppConfigRead.Refused(read.problems)
        }

        return readTree(tree, absolute.parent)
    }

    /**
     * Reads the app config a build plugin's DSL writes, as its JSON tree [dsl]; [dslName] names the block in problems
     * (`build.gradle.kts seampact { }`). A `seampact.config.yaml` in [appDirectory] beside it is refused.
     */
    public fun readDsl(dsl: JsonObject, dslName: String, appDirectory: Path): AppConfigRead {
        val directory = appDirectory.toAbsolutePath().normalize()
        val file = directory.resolve(FILE_NAME)

        if (Files.exists(file)) {
            return AppConfigRead.Refused(
                listOf(
                    ConfigProblem(
                        "config.file.beside-dsl",
                        "The app has two configs: $file and the $dslName block; one app has one source.",
                        "Keep one: remove $FILE_NAME, or move its keys into the $dslName block and remove the block's other source.",
                        dslName,
                    ),
                ),
            )
        }

        val reserved = reservedKeyProblems(dsl, emptyList(), dslName)
        if (reserved.isNotEmpty()) return AppConfigRead.Refused(reserved)

        return readTree(ConfigTree(dsl, dslName, emptyMap()), directory)
    }

    private fun readTree(tree: ConfigTree, directory: Path): AppConfigRead {
        val value = tree.value
        if (value is JsonObject && ROOT_CONFIG_MARKER_KEY in value) {
            return AppConfigRead.Refused(listOf(notAnAppProblem(tree)))
        }

        val keyProblems = waitProblems(tree, findConfigWaits(value))
        val problems = schemaProblems(tree, ConfigKind.APP, APP_SCHEMA, keyProblems)
        if (problems.isNotEmpty()) return AppConfigRead.Refused(problems)

        val rootProblems = listingRootProblems(directory)
        if (rootProblems.isNotEmpty()) return AppConfigRead.Refused(rootProblems)

        val config = value as? JsonObject ?: error("config: a value the app schema accepts is an object.")

        return resolveAppConfig(tree, directory, config)
    }
}

internal const val ROOT_CONFIG_MARKER_KEY = "apps"
private const val DEFAULT_OUT_DIR = "__generated__"

private fun notAnAppProblem(tree: ConfigTree): ConfigProblem = ConfigProblem(
    "config.root.not-an-app",
    "This file is a monorepo root config (it holds `$ROOT_CONFIG_MARKER_KEY`), and the command runs on one app's config.",
    "Run the command in one of the apps the root config lists, or pass that app's config with `--config`.",
    tree.whereOf(listOf(ROOT_CONFIG_MARKER_KEY)),
)

// The DSL has no YAML reader in front of it, so its keys are checked here as the file's are.
private fun reservedKeyProblems(value: JsonElement, path: KeyPath, dslName: String): List<ConfigProblem> = when (value) {
    is JsonObject -> value.flatMap { (key, member) ->
        val here = path + key
        if (key in setOf("__proto__", "constructor", "prototype")) {
            listOf(
                ConfigProblem(
                    "config.key.reserved",
                    "The key '$key' is reserved: it would reach a JavaScript object's prototype.",
                    "Rename or remove the key.",
                    "$dslName ${formatKeyPath(here)}",
                ),
            )
        } else {
            reservedKeyProblems(member, here, dslName)
        }
    }
    is JsonArray -> value.flatMapIndexed { index, item -> reservedKeyProblems(item, path + index, dslName) }
    else -> emptyList()
}

private fun resolveAppConfig(tree: ConfigTree, directory: Path, config: JsonObject): AppConfigRead {
    val outDir = directory.resolve(config.stringAt("outDir") ?: DEFAULT_OUT_DIR).normalize()
    val targets = (config["targets"] as? JsonArray)?.filterIsInstance<JsonObject>() ?: emptyList()
    val entries = targets.map { entry ->
        AppConfigEntry(entry.deepCopy(), outDir.resolve(entry.stringAt("out") ?: entry.requiredStringAt("id")).normalize())
    }

    val problems = duplicateIdProblems(tree, entries) +
        outsideOutDirProblems(tree, outDir, entries) +
        overlappingOutProblems(tree, entries) +
        switchedOffAllowListProblems(tree, entries) +
        frameworkDocsConflictProblems(tree, entries)
    if (problems.isNotEmpty()) return AppConfigRead.Refused(problems)

    val sources = (config["sources"] as? JsonObject ?: JsonObject(emptyMap()))
        .filterValues { it is JsonObject }
        .mapValues { (_, source) -> configSourceOf(directory, source as? JsonObject ?: JsonObject(emptyMap())) }

    return AppConfigRead.Read(
        AppConfig(
            displayName = tree.displayName,
            directory = directory,
            outDir = outDir,
            allowLocal = config.booleanAt("allowLocal"),
            sources = sources,
            entries = entries.filter { it.ecosystem == TargetEcosystem.MAVEN },
            otherEntries = entries.filter { it.ecosystem != TargetEcosystem.MAVEN },
            openapi = config["openapi"]?.deepCopy(),
            checks = (config["checks"] as? JsonObject)?.deepCopy(),
            diff = (config["diff"] as? JsonObject)?.deepCopy(),
            warnings = (config["warnings"] as? JsonObject)?.deepCopy(),
        ),
    )
}

@Suppress("UNCHECKED_CAST")
private fun <T : JsonElement> T.deepCopy(): T = when (this) {
    is JsonObject -> JsonObject(mapValues { (_, value) -> value.deepCopy() }) as T
    is JsonArray -> JsonArray(map { it.deepCopy() }) as T
    else -> this
}

private fun configSourceOf(directory: Path, source: JsonObject): ConfigSource {
    val path = source.stringAt("path")
    if (path != null) return ConfigSource.Local(directory.resolve(path).normalize())

    val integrity = source.stringAt("integrity")
    val release = source["release"] as? JsonObject
    val git = source["git"] as? JsonObject

    val bundle = when {
        release != null -> BundleSource.Release(release.requiredStringAt("url"), integrity)
        git != null -> BundleSource.Git(git.requiredStringAt("url"), git.requiredStringAt("tag"), git.stringAt("directory"), integrity)
        else -> BundleSource.Package(source.requiredStringAt("package"), source.requiredStringAt("version"), integrity)
    }

    return ConfigSource.Bundle(bundle)
}

private fun duplicateIdProblems(tree: ConfigTree, entries: List<AppConfigEntry>): List<ConfigProblem> =
    entries.withIndex()
        .filter { (index, each) -> entries.indexOfFirst { it.id == each.id } != index }
        .map { (index, each) ->
            ConfigProblem(
                "config.target.duplicate-id",
                "Two target entries have the id '${each.id}'.",
                "Give each target entry its own id.",
                tree.whereOf(listOf("targets", index, "id")),
            )
        }

private fun outsideOutDirProblems(tree: ConfigTree, outDir: Path, entries: List<AppConfigEntry>): List<ConfigProblem> =
    entries.withIndex()
        .filter { (_, each) -> !isStrictlyInside(outDir, each.root) }
        .map { (index, each) ->
            ConfigProblem(
                "config.out.outside",
                "The output directory of '${each.id}' is not inside `outDir` ($outDir).",
                "Give `out` a relative path that stays inside `outDir`.",
                tree.whereOf(listOf("targets", index, "out")),
            )
        }

// Two entries writing to the same directory, or one inside the other, would remove each other's files.
private fun overlappingOutProblems(tree: ConfigTree, entries: List<AppConfigEntry>): List<ConfigProblem> =
    entries.withIndex().flatMap { (index, each) ->
        entries.drop(index + 1)
            .filter { other -> each.root.startsWith(other.root) || other.root.startsWith(each.root) }
            .map { other ->
                ConfigProblem(
                    "config.out.overlap",
                    "The entries '${each.id}' and '${other.id}' write to the same directory, or one inside the other.",
                    "Give each entry its own `out` directory, side by side under `outDir`.",
                    tree.whereOf(listOf("targets", index)),
                )
            }
    }

private fun isStrictlyInside(directory: Path, path: Path): Boolean = path != directory && path.startsWith(directory)

// An allow-list of a check switched off would be dropped without a word.
private fun switchedOffAllowListProblems(tree: ConfigTree, entries: List<AppConfigEntry>): List<ConfigProblem> =
    entries.withIndex()
        .filter { (_, each) -> "frameworkRoutes" in each.entry && frameworkRouteSwitchOff(each.artefacts) != null }
        .map { (index, each) ->
            ConfigProblem(
                "config.key.conflict",
                "The entry '${each.id}' allow-lists framework routes in 'frameworkRoutes' but switches their check off with '${frameworkRouteSwitchOff(each.artefacts)}: false'.",
                "Keep one: remove 'frameworkRoutes' to leave the check off, or remove the switch to check the routes against the allow-list.",
                tree.whereOf(listOf("targets", index, "frameworkRoutes")),
            )
        }

// The switch that turns the framework-route check off: the whole boot check, or its framework-route check alone.
private fun frameworkRouteSwitchOff(artefacts: JsonObject): String? {
    if (artefacts.booleanAt("bootCheck") == false) return "artefacts.bootCheck"

    val bootCheck = artefacts["bootCheck"] as? JsonObject ?: return null

    return if (bootCheck.booleanAt("frameworkRoutes") == false) "artefacts.bootCheck.frameworkRoutes" else null
}

// `frameworkDocs: off` asks for no framework document while `nativeDocs` completes one.
private fun frameworkDocsConflictProblems(tree: ConfigTree, entries: List<AppConfigEntry>): List<ConfigProblem> =
    entries.withIndex()
        .filter { (_, each) -> each.frameworkDocs == "off" && each.artefacts.booleanAt("nativeDocs") == true }
        .map { (index, each) ->
            ConfigProblem(
                "config.key.conflict",
                "The entry '${each.id}' sets 'frameworkDocs: off' and 'artefacts.nativeDocs: true': one switches the framework's document off, the other completes it.",
                "Keep one: remove 'frameworkDocs: off' to complete the framework's document, or switch 'artefacts.nativeDocs' off.",
                tree.whereOf(listOf("targets", index, "frameworkDocs")),
            )
        }

// The directory that ends the search for a root config: a repository's top, the first one holding `.git`.
private const val REPOSITORY_MARKER = ".git"

/**
 * A monorepo root config that lists this app is refused by name: folding a root's sources into an app waits for a
 * JVM consumer that needs it. The search is the Node CLI's: each ancestor up to the first holding `.git`; a root
 * that does not list the app leaves it standing alone, and an ancestor config that does not read refuses the app.
 */
private fun listingRootProblems(appDirectory: Path): List<ConfigProblem> {
    if (Files.exists(appDirectory.resolve(REPOSITORY_MARKER))) return emptyList()

    var directory = appDirectory.parent
    while (directory != null) {
        val candidate = directory.resolve(AppConfigReader.FILE_NAME)
        if (Files.exists(candidate)) {
            val problems = rootListingProblems(candidate, appDirectory)
            if (problems.isNotEmpty()) return problems
        }
        if (Files.exists(directory.resolve(REPOSITORY_MARKER))) return emptyList()
        directory = directory.parent
    }

    return emptyList()
}

private fun rootListingProblems(candidate: Path, appDirectory: Path): List<ConfigProblem> {
    val tree = when (val read = readConfigFile(candidate, candidate.toString(), ConfigKind.ROOT)) {
        is ConfigFileRead.Read -> read.tree
        is ConfigFileRead.Refused -> return read.problems
    }
    val apps = (tree.value as? JsonObject)?.get(ROOT_CONFIG_MARKER_KEY) as? JsonArray ?: return emptyList()
    val listed = apps.mapNotNull { it.stringValue() }.any { candidate.parent.resolve(it).normalize() == appDirectory }
    if (!listed) return emptyList()

    return listOf(
        ConfigProblem(
            "config.root.unsupported",
            "The monorepo root config $candidate lists this app ($appDirectory); a JVM build does not read a root config yet, it comes once a JVM app needs one.",
            "Define the app's sources in its own config and remove the app from the root config's `apps`, or generate the app with the Node CLI.",
            tree.whereOf(listOf(ROOT_CONFIG_MARKER_KEY)),
        ),
    )
}
