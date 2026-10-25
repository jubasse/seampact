package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.runner.check
import org.apache.maven.plugins.annotations.LifecyclePhase
import org.apache.maven.plugins.annotations.Mojo
import org.apache.maven.plugins.annotations.ResolutionScope
import org.eclipse.aether.RepositorySystem
import javax.inject.Inject

/**
 * The `check` goal, bound to `verify`: the pinned-bundle check of each bundle source (its integrity printed) and the
 * `checks.generated` drift of the files `generate` writes (ADR 0011 `checks`, ADR 0015). Nothing is written.
 */
@Mojo(name = "check", defaultPhase = LifecyclePhase.VERIFY, threadSafe = true, requiresDependencyResolution = ResolutionScope.COMPILE)
public class CheckMojo @Inject constructor(repositorySystem: RepositorySystem) : SeampactMojo(repositorySystem) {
    override fun execute() {
        val report = check(runSettings(), buildDirectory)

        report.lines.forEach(log::info)
        report.warnings.forEach(log::warn)
        if (report.problems.isNotEmpty()) throw refused(report.problems)
    }
}
