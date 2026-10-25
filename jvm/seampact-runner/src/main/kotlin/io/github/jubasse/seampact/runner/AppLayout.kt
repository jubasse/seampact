package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.bundle.BundleSource
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigRead
import io.github.jubasse.seampact.ir.config.AppConfigReader
import io.github.jubasse.seampact.ir.config.ConfigSource
import io.github.jubasse.seampact.ir.config.EntryView
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.Serializable
import java.nio.file.Path

/**
 * What the build must know of the app config before a run: the output root of each JVM entry (the generated Java
 * sources), the `path` sources a run compiles (its inputs, and whether the binary is needed at all) and the `maven`
 * bundle sources it resolves. An app config that does not read has an empty layout; the run then refuses it with its
 * problems.
 */
public data class AppLayout(
    val entryRoots: List<String>,
    val pathSources: List<String>,
    val mavenSources: List<String>,
) : Serializable {
    val needsBinary: Boolean get() = pathSources.isNotEmpty()

    public companion object {
        private const val serialVersionUID: Long = 1

        public val EMPTY: AppLayout = AppLayout(emptyList(), emptyList(), emptyList())

        public fun of(config: AppConfig): AppLayout {
            val used = EntryView.usedSources(config).mapNotNull { config.sources[it] }

            return AppLayout(
                entryRoots = config.entries.map { it.root.toString() },
                pathSources = used.filterIsInstance<ConfigSource.Local>().map { it.directory.toString() },
                mavenSources = used.filterIsInstance<ConfigSource.Bundle>()
                    .map { it.source }
                    .filterIsInstance<BundleSource.MavenArtefact>()
                    .map { it.coordinates },
            )
        }

        /** The layout of the app config [appDirectory] holds or [dslTree] writes; [EMPTY] when it does not read. */
        public fun read(appDirectory: Path, dslTree: String?, dslName: String): AppLayout = when (val read = readAppConfig(appDirectory, dslTree, dslName)) {
            is AppConfigRead.Read -> of(read.config)
            is AppConfigRead.Refused -> EMPTY
        }
    }
}

/** Reads the app config [appDirectory] holds, or the DSL tree [dslTree] the build file writes as [dslName] (A42). */
public fun readAppConfig(appDirectory: Path, dslTree: String?, dslName: String): AppConfigRead =
    if (dslTree == null) {
        AppConfigReader.readFile(appDirectory.resolve(AppConfigReader.FILE_NAME), AppConfigReader.FILE_NAME)
    } else {
        AppConfigReader.readDsl(Json.decodeFromString(JsonObject.serializer(), dslTree), dslName, appDirectory)
    }
