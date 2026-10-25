package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.AppLayout
import org.gradle.api.provider.Property
import org.gradle.api.provider.ValueSource
import org.gradle.api.provider.ValueSourceParameters
import java.nio.file.Path

/**
 * The [AppLayout] of the app, read at configuration time. A value source, so the configuration cache reads the
 * config file again on each build and is discarded when the layout changes.
 */
internal abstract class AppLayoutSource : ValueSource<AppLayout, AppLayoutSource.Parameters> {
    interface Parameters : ValueSourceParameters {
        val appDirectory: Property<String>
        val dslTree: Property<String>
    }

    override fun obtain(): AppLayout = AppLayout.read(Path.of(parameters.appDirectory.get()), parameters.dslTree.orNull, SeampactExtension.DSL_NAME)
}
