package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.check
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.TaskAction
import org.gradle.work.DisableCachingByDefault
import java.nio.file.Path

/**
 * `seampactCheck`, run by `check`: the pinned-bundle check of each bundle source (its integrity printed) and the
 * `checks.generated` drift of the files `seampactGenerate` writes (ADR 0011 `checks`, ADR 0015). Nothing is written.
 */
@DisableCachingByDefault(because = "It checks the files on disk and writes nothing.")
public abstract class SeampactCheckTask : SeampactTask() {
    /** The project's build directory: an `outDir` under it is never committed, so its drift is not compared. */
    @get:Internal
    public abstract val buildDirectory: Property<String>

    @TaskAction
    public fun check() {
        val report = check(runSettings(), Path.of(buildDirectory.get()))

        report.lines.forEach(logger::lifecycle)
        report.warnings.forEach(logger::warn)
        if (report.problems.isNotEmpty()) throw SeampactRefusedException(report.problems)
    }
}
