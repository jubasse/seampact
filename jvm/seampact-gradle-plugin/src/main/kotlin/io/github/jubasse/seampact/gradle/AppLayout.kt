package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.bundle.BundleSource
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.AppConfigRead
import io.github.jubasse.seampact.ir.config.AppConfigReader
import io.github.jubasse.seampact.ir.config.ConfigSource
import io.github.jubasse.seampact.ir.config.EntryView
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.gradle.api.provider.Property
import org.gradle.api.provider.ValueSource
import org.gradle.api.provider.ValueSourceParameters
import java.io.Serializable
import java.nio.file.Path

/**
 * What the build must know of the app config before any task runs: the output root of each JVM entry (the
 * generated Java sources), the `path` sources a run compiles (its inputs, and whether the binary is needed at all)
 * and the `maven` bundle sources it resolves. An app config that does not read has an empty layout; the tasks then
 * refuse it with its problems.
 */
internal data class AppLayout(
    val entryRoots: List<String>,
    val pathSources: List<String>,
    val mavenSources: List<String>,
) : Serializable {
    val needsBinary: Boolean get() = pathSources.isNotEmpty()

    internal companion object {
        private const val serialVersionUID: Long = 1

        val EMPTY = AppLayout(emptyList(), emptyList(), emptyList())

        fun of(config: AppConfig): AppLayout {
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
    }
}

/** Reads the app config [appDirectory] holds, or the DSL tree [dslTree] the build file writes (A42). */
internal fun readAppConfig(appDirectory: Path, dslTree: String?): AppConfigRead =
    if (dslTree == null) {
        AppConfigReader.readFile(appDirectory.resolve(AppConfigReader.FILE_NAME), AppConfigReader.FILE_NAME)
    } else {
        AppConfigReader.readDsl(Json.decodeFromString(JsonObject.serializer(), dslTree), SeampactExtension.DSL_NAME, appDirectory)
    }

/**
 * The [AppLayout] of the app, read at configuration time. A value source, so the configuration cache reads the
 * config file again on each build and is discarded when the layout changes.
 */
internal abstract class AppLayoutSource : ValueSource<AppLayout, AppLayoutSource.Parameters> {
    interface Parameters : ValueSourceParameters {
        val appDirectory: Property<String>
        val dslTree: Property<String>
    }

    override fun obtain(): AppLayout = when (val read = readAppConfig(Path.of(parameters.appDirectory.get()), parameters.dslTree.orNull)) {
        is AppConfigRead.Read -> AppLayout.of(read.config)
        is AppConfigRead.Refused -> AppLayout.EMPTY
    }
}
