package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.runner.BinarySettings
import io.github.jubasse.seampact.runner.BuildTool
import io.github.jubasse.seampact.runner.RunSettings
import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.MapProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.IgnoreEmptyDirectories
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.work.DisableCachingByDefault
import java.nio.file.Path

/**
 * What `seampactGenerate` and `seampactCheck` read: the app config (the file or the DSL tree), the trees of the
 * `path` sources, the binary pin override, `SEAMPACT_ALLOW_LOCAL` and the Spring Boot version the compile
 * classpath resolves. Bundle sources are pinned by their integrity, which the config holds. Absolute locations
 * (the app directory, the caches, the resolved artefacts) are internal, so the build cache is relocatable.
 */
@DisableCachingByDefault(because = "The base of seampactGenerate and seampactCheck, which each say whether they cache.")
public abstract class SeampactTask : DefaultTask() {
    @get:InputFiles
    @get:PathSensitive(PathSensitivity.RELATIVE)
    public abstract val configFile: ConfigurableFileCollection

    @get:Input
    @get:Optional
    public abstract val dslTree: Property<String>

    @get:InputFiles
    @get:IgnoreEmptyDirectories
    @get:PathSensitive(PathSensitivity.RELATIVE)
    public abstract val pathSources: ConfigurableFileCollection

    @get:Input
    @get:Optional
    public abstract val allowLocalVariable: Property<String>

    @get:Input
    @get:Optional
    public abstract val springBootVersion: Property<String>

    @get:Input
    @get:Optional
    public abstract val springSecurityWebVersion: Property<String>

    @get:Input
    @get:Optional
    public abstract val springSecurityConfigVersion: Property<String>

    @get:Input
    @get:Optional
    public abstract val binaryVersion: Property<String>

    @get:Input
    public abstract val binarySha256ByClassifier: MapProperty<String, String>

    @get:Input
    @get:Optional
    public abstract val binarySha256: Property<String>

    /** The override binary's path; its `sha256` is the input, and a file of another hash never runs. */
    @get:Internal
    public abstract val binaryPath: Property<String>

    @get:Internal
    public abstract val appDirectory: Property<String>

    @get:Internal
    public abstract val bundleCacheDirectory: Property<String>

    @get:Internal
    public abstract val binaryCacheDirectory: Property<String>

    /** Where a run hands the binary the DSL's app config, under the build directory; removed after each run. */
    @get:Internal
    public abstract val temporaryDirectory: Property<String>

    /** The pinned binary's artefact, resolved only when a `path` source needs it. */
    @get:Internal
    public abstract val binaryArtefact: ConfigurableFileCollection

    /** The `maven` bundle sources' artefacts, resolved only when a bundle is not cached. */
    @get:Internal
    public abstract val mavenBundles: ConfigurableFileCollection

    @get:Internal
    public abstract val moduleCacheRoots: ListProperty<String>

    /**
     * Where each `maven` bundle was resolved from, local or remote repository: an input, so an output cached on a
     * machine that resolved it remotely is never reused where a local repository serves it under `allowLocal: false`.
     */
    @get:Input
    public abstract val mavenBundleOrigins: ListProperty<String>

    internal fun runSettings(): RunSettings = RunSettings(
        buildTool = GRADLE_BUILD_TOOL,
        appDirectory = Path.of(appDirectory.get()),
        dslTree = dslTree.orNull,
        dslName = SeampactExtension.DSL_NAME,
        allowLocalVariable = allowLocalVariable.orNull,
        springBootVersion = springBootVersion.orNull,
        springSecurityWebVersion = springSecurityWebVersion.orNull,
        springSecurityConfigVersion = springSecurityConfigVersion.orNull,
        binary = BinarySettings(binaryVersion.orNull, binarySha256ByClassifier.get(), binaryPath.orNull, binarySha256.orNull),
        bundleCacheDirectory = Path.of(bundleCacheDirectory.get()),
        binaryCacheDirectory = Path.of(binaryCacheDirectory.get()),
        temporaryDirectory = Path.of(temporaryDirectory.get()),
        mavenArtefacts = GradleBundleArtefacts(mavenBundles, moduleCacheRoots.get().map { Path.of(it) }),
        resolveBinaryArtefact = { resolvedSingleFile(binaryArtefact) },
    )
}

/** The Gradle plugin as the run's problems and messages name it. */
internal val GRADLE_BUILD_TOOL = BuildTool(
    pluginName = "the Gradle plugin",
    generateCommand = "gradle seampactGenerate",
    unresolvedBinaryFix = "Add the repository that holds it (mavenCentral(), or your mirror of it), or point `binary { path }` at your own build with its `sha256`.",
    binaryCacheSetting = "the Gradle user home (`--gradle-user-home` or `GRADLE_USER_HOME`)",
)
