package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.GenerateOutcome
import io.github.jubasse.seampact.runner.generate
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Classpath
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectories
import org.gradle.api.tasks.OutputFiles
import org.gradle.api.tasks.TaskAction

/**
 * `seampactGenerate`: generates each JVM target entry of the app config into its output root (ADR 0015 "Writing
 * files"), the roots the main Java sources compile, and has the pinned binary write the app's OpenAPI documents, each listed
 * document declared as an output file. Every entry is planned first and the runtime on the main compile classpath is
 * checked; one refusal writes nothing.
 */
@CacheableTask
public abstract class SeampactGenerateTask : SeampactTask() {
    /** Each JVM entry's output root, `<outDir>/<out>`. */
    @get:OutputDirectories
    public abstract val entryRoots: ConfigurableFileCollection

    /** The OpenAPI documents the app's `openapi` lists, with the manifest of each document directory. */
    @get:OutputFiles
    public abstract val documentFiles: ConfigurableFileCollection

    /**
     * The `openapi` directory of the default documents, when the app config has no `openapi` key. Only the IR names
     * those documents, so none is declared before the run, and a directory output would let a cache hit empty a
     * directory holding other files: the task then always runs and is never taken from the build cache.
     */
    @get:Internal
    public abstract val documentDirectories: ConfigurableFileCollection

    /** The compile classpath of the main source set, whose seampact-spring-runtime the run checks (ADR 0025, G2). */
    @get:Classpath
    public abstract val compileClasspath: ConfigurableFileCollection

    init {
        outputs.upToDateWhen { documentDirectories.isEmpty }
        outputs.cacheIf("the app's default OpenAPI documents are known only after the run") { documentDirectories.isEmpty }
    }

    @TaskAction
    public fun generate() {
        when (val outcome = generate(runSettings(), compileClasspath.files.map { it.toPath() })) {
            is GenerateOutcome.Refused -> throw SeampactRefusedException(outcome.problems)
            is GenerateOutcome.Generated -> {
                outcome.lines.forEach(logger::lifecycle)
                outcome.warnings.forEach(logger::warn)
            }
        }
    }
}
