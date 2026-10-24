package io.github.jubasse.seampact.gradle

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
import java.nio.file.Path

/**
 * What `seampactGenerate` and `seampactCheck` read: the app config (the file or the DSL tree), the trees of the
 * `path` sources, the binary pin override, `SEAMPACT_ALLOW_LOCAL` and the Spring Boot version the compile
 * classpath resolves. Bundle sources are pinned by their integrity, which the config holds. Absolute locations
 * (the app directory, the caches, the resolved artefacts) are internal, so the build cache is relocatable.
 */
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

    /** The pinned binary's artefact, resolved only when a `path` source needs it. */
    @get:Internal
    public abstract val binaryArtefact: ConfigurableFileCollection

    /** The `maven` bundle sources' artefacts, resolved only when a bundle is not cached. */
    @get:Internal
    public abstract val mavenBundles: ConfigurableFileCollection

    @get:Internal
    public abstract val moduleCacheRoots: ListProperty<String>

    internal fun runSettings(): RunSettings = RunSettings(
        appDirectory = Path.of(appDirectory.get()),
        dslTree = dslTree.orNull,
        allowLocalVariable = allowLocalVariable.orNull,
        springBootVersion = springBootVersion.orNull,
        binary = BinarySettings(binaryVersion.orNull, binarySha256ByClassifier.get(), binaryPath.orNull, binarySha256.orNull),
        bundleCacheDirectory = Path.of(bundleCacheDirectory.get()),
        binaryCacheDirectory = Path.of(binaryCacheDirectory.get()),
        mavenArtefacts = GradleBundleArtefacts(mavenBundles, moduleCacheRoots.get().map { Path.of(it) }),
        resolveBinaryArtefact = { resolvedSingleFile(binaryArtefact) },
    )
}
