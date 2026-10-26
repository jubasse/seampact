package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.GenerateOutcome
import io.github.jubasse.seampact.runner.generate
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.OutputDirectories
import org.gradle.api.tasks.OutputFiles
import org.gradle.api.tasks.TaskAction

/**
 * `seampactGenerate`: generates each JVM target entry of the app config into its output root (ADR 0015 "Writing
 * files"), the roots the main Java sources compile, and has the pinned binary write the app's OpenAPI documents, also
 * declared as outputs. Every entry is planned first; one refusal writes nothing.
 */
@CacheableTask
public abstract class SeampactGenerateTask : SeampactTask() {
    /** Each JVM entry's output root, `<outDir>/<out>`. */
    @get:OutputDirectories
    public abstract val entryRoots: ConfigurableFileCollection

    /** The OpenAPI documents the app's `openapi` lists, with the manifest of each document directory. */
    @get:OutputFiles
    public abstract val documentFiles: ConfigurableFileCollection

    /** The `openapi` directory of the default documents, when the app config has no `openapi` key. */
    @get:OutputDirectories
    public abstract val documentDirectories: ConfigurableFileCollection

    @TaskAction
    public fun generate() {
        when (val outcome = generate(runSettings())) {
            is GenerateOutcome.Refused -> throw SeampactRefusedException(outcome.problems)
            is GenerateOutcome.Generated -> {
                outcome.lines.forEach(logger::lifecycle)
                outcome.warnings.forEach(logger::warn)
            }
        }
    }
}
