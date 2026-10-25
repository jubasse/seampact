package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.runner.GenerateOutcome
import io.github.jubasse.seampact.runner.RunSettings
import io.github.jubasse.seampact.runner.generate
import io.github.jubasse.seampact.runner.runnerVersion
import org.apache.maven.plugins.annotations.LifecyclePhase
import org.apache.maven.plugins.annotations.Mojo
import org.apache.maven.plugins.annotations.ResolutionScope
import org.eclipse.aether.RepositorySystem
import java.nio.file.Files
import java.nio.file.Path
import javax.inject.Inject

/**
 * The `generate` goal, bound to `generate-sources`: generates each JVM target entry of the app config into its
 * output root (ADR 0015 "Writing files") and adds the roots to the project's compile sources. Every entry is planned
 * first; one refusal writes nothing. The goal skips when the stamp of its inputs and outputs is unchanged.
 */
@Mojo(name = "generate", defaultPhase = LifecyclePhase.GENERATE_SOURCES, threadSafe = true, requiresDependencyResolution = ResolutionScope.COMPILE)
public class GenerateMojo @Inject constructor(repositorySystem: RepositorySystem) : SeampactMojo(repositorySystem) {
    override fun execute() {
        val settings = runSettings()
        val layout = layoutOf(settings)
        val roots = layout.entryRoots.map { Path.of(it) }
        val stamp = GenerateStamp(buildDirectory.resolve(STAMP_FILE))
        val inputsHash = inputsHash(settings, layout.pathSources.map { Path.of(it) }, bundleOrigins(layout))

        if (stamp.isCurrent(inputsHash, roots)) {
            log.info("seampact: inputs and generated files unchanged since the last run; nothing to generate.")
        } else {
            when (val outcome = generate(settings)) {
                is GenerateOutcome.Refused -> throw refused(outcome.problems)
                is GenerateOutcome.Generated -> outcome.lines.forEach(log::info)
            }
            stamp.record(inputsHash, roots)
        }

        roots.forEach { project.addCompileSourceRoot(it.toString()) }
    }

    // Every input of a run: the app config as the POM or the file writes it, the `path` source trees, the binary pin,
    // SEAMPACT_ALLOW_LOCAL, the Spring Boot version, where each `maven` bundle is served from, and the run's version.
    private fun inputsHash(settings: RunSettings, pathSources: List<Path>, bundleOrigins: List<String>): String {
        val inputs = GenerateStamp.Inputs()
        inputs.text("runner", runnerVersion())
        inputs.text("dsl", settings.dslTree)
        inputs.text("file", if (Files.isRegularFile(configFile)) Files.readString(configFile) else null)
        inputs.trees("pathSources", pathSources)
        inputs.text("binary", settings.binary.toString())
        inputs.text("allowLocal", settings.allowLocalVariable)
        inputs.text("springBoot", settings.springBootVersion)
        inputs.text("bundleOrigins", bundleOrigins.joinToString(","))

        return inputs.hash()
    }

    private companion object {
        const val STAMP_FILE = "seampact/generate.stamp"
    }
}
