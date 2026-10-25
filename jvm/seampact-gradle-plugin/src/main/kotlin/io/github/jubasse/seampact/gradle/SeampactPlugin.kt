// The Gradle plugin `io.github.jubasse.seampact` (ADR 0010, ADR 0011): the `seampact { }` DSL, `seampactGenerate`
// wired into the main Java sources and `seampactCheck` wired into `check`.
package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.ir.binary.BinaryPin
import io.github.jubasse.seampact.ir.binary.BinaryPinResolution
import io.github.jubasse.seampact.ir.config.AppConfigReader
import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import io.github.jubasse.seampact.runner.BinarySettings
import io.github.jubasse.seampact.runner.pinBinary
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.artifacts.Configuration
import org.gradle.api.provider.Provider
import org.gradle.api.tasks.SourceSetContainer
import org.gradle.api.tasks.TaskProvider
import java.nio.file.Path

/**
 * Applies seampact to a project: the app is the project directory, its config `seampact.config.yaml` or the
 * `seampact { }` block. The app config is read at configuration time only for its layout (the output roots, the
 * sources to compile or resolve); the tasks read it again, so every problem is reported when a task runs.
 */
public class SeampactPlugin : Plugin<Project> {
    override fun apply(project: Project) {
        val extension = project.extensions.create(SeampactExtension.NAME, SeampactExtension::class.java)
        val dslTree: Provider<String> = project.provider { extension.configTree()?.toString() }
        val appDirectory = project.layout.projectDirectory.asFile.absolutePath
        val layout = project.providers.of(AppLayoutSource::class.java) { source ->
            source.parameters.appDirectory.set(appDirectory)
            source.parameters.dslTree.set(dslTree)
        }

        val gradleUserHome = project.gradle.gradleUserHomeDir.toPath()
        val seampactCache = gradleUserHome.resolve(CACHE_DIRECTORY)
        val userHomeCache = gradleUserHome.resolve(MODULE_CACHE_DIRECTORY).toAbsolutePath().normalize().toString()
        val moduleCacheRoots: Provider<List<String>> = project.providers.environmentVariable(READ_ONLY_CACHE_VARIABLE)
            .map { listOf(userHomeCache, Path.of(it).resolve(MODULE_CACHE_DIRECTORY).toAbsolutePath().normalize().toString()) }
            .orElse(listOf(userHomeCache))

        // Created when the first task is configured, after the build file set the DSL, and only for what the
        // layout needs: a bundle-only app never resolves the binary (ADR 0010 "Lazy").
        val binaryArtefact by lazy { if (layout.get().needsBinary) binaryConfiguration(project, extension) else emptyList() }
        val mavenBundles by lazy { layout.get().mavenSources.let { if (it.isEmpty()) emptyList() else bundleConfiguration(project, it) } }
        // A lenient view for the origin input: a resolution failure is reported by the task, with its source.
        val mavenBundleViews by lazy { mavenBundles.map { configuration -> configuration.incoming.artifactView { it.isLenient = true }.files } }

        fun SeampactTask.readApp() {
            group = TASK_GROUP
            configFile.from(project.layout.projectDirectory.file(AppConfigReader.FILE_NAME))
            this.dslTree.set(dslTree)
            pathSources.from(layout.map { it.pathSources })
            allowLocalVariable.set(project.providers.environmentVariable(LocalSourcePolicy.ALLOW_LOCAL_VARIABLE))
            binaryVersion.set(extension.binary.version)
            binarySha256ByClassifier.set(extension.binary.sha256ByClassifier)
            binarySha256.set(extension.binary.sha256)
            binaryPath.set(extension.binary.path.map { it.asFile.absolutePath })
            this.appDirectory.set(appDirectory)
            bundleCacheDirectory.set(seampactCache.resolve(BUNDLE_CACHE).toString())
            binaryCacheDirectory.set(seampactCache.resolve(BINARY_CACHE).toString())
            this.binaryArtefact.from(binaryArtefact)
            this.mavenBundles.from(mavenBundles)
            this.moduleCacheRoots.set(moduleCacheRoots)
            mavenBundleOrigins.set(
                project.files(mavenBundleViews).elements.zip(moduleCacheRoots) { files, roots ->
                    bundleOrigins(files.map { it.asFile.toPath() }.toSet(), roots.map { Path.of(it) })
                },
            )
        }

        val generate = project.tasks.register(GENERATE_TASK, SeampactGenerateTask::class.java) { task ->
            task.description = "Generates the seampact target entries of the app config into the main Java sources."
            task.readApp()
            // In one build, the check compares the files on disk before a generate rewrites them.
            task.mustRunAfter(CHECK_TASK)
            task.entryRoots.from(layout.map { it.entryRoots })
        }
        val check = project.tasks.register(CHECK_TASK, SeampactCheckTask::class.java) { task ->
            task.description = "Checks the pinned bundles and that the generated files match what seampactGenerate writes."
            task.readApp()
            task.buildDirectory.set(project.layout.buildDirectory.map { it.asFile.absolutePath })
        }

        project.pluginManager.withPlugin(JAVA_PLUGIN) { wireIntoJava(project, generate, check) }
    }

    private fun wireIntoJava(project: Project, generate: TaskProvider<SeampactGenerateTask>, check: TaskProvider<SeampactCheckTask>) {
        val sourceSets = project.extensions.getByType(SourceSetContainer::class.java)
        sourceSets.named(MAIN_SOURCE_SET) { it.java.srcDir(generate) }

        val springBootVersion = project.configurations.named(COMPILE_CLASSPATH)
            .flatMap { it.incoming.resolutionResult.rootComponent }
            .map { springBootVersionIn(it) ?: NO_SPRING_BOOT }
            .filter { it != NO_SPRING_BOOT }
        generate.configure { it.springBootVersion.set(springBootVersion) }
        check.configure { it.springBootVersion.set(springBootVersion) }

        project.tasks.named(CHECK_LIFECYCLE_TASK) { it.dependsOn(check) }
    }

    // The pinned binary's artefact; nothing to resolve when the pin is the consumer's own build or is refused (the
    // task then reports why).
    private fun binaryConfiguration(project: Project, extension: SeampactExtension): List<Configuration> {
        val binary = extension.binary
        val settings = BinarySettings(binary.version.orNull, binary.sha256ByClassifier.get(), binary.path.orNull?.asFile?.absolutePath, binary.sha256.orNull)
        val pin = (pinBinary(settings) as? BinaryPinResolution.Pinned)?.pin as? BinaryPin.Artifact ?: return emptyList()

        return listOf(detached(project, listOf(pin.coordinates)))
    }

    private fun bundleConfiguration(project: Project, coordinates: List<String>): List<Configuration> =
        listOf(detached(project, coordinates.map(::bundleArtefactNotation)))

    // A detached configuration resolves through the build's own repositories (settings or project), so mirrors,
    // proxies and offline mode apply (ADR 0010 "Resolution").
    private fun detached(project: Project, notations: List<String>): Configuration =
        project.configurations.detachedConfiguration(*notations.map(project.dependencies::create).toTypedArray()).apply {
            isTransitive = false
        }

    private companion object {
        const val TASK_GROUP = "seampact"
        const val GENERATE_TASK = "seampactGenerate"
        const val CHECK_TASK = "seampactCheck"
        const val JAVA_PLUGIN = "java"
        const val MAIN_SOURCE_SET = "main"
        const val COMPILE_CLASSPATH = "compileClasspath"
        const val CHECK_LIFECYCLE_TASK = "check"
        const val CACHE_DIRECTORY = "caches/seampact"
        const val BUNDLE_CACHE = "bundles"
        const val BINARY_CACHE = "binaries"
        const val MODULE_CACHE_DIRECTORY = "caches/modules-2"
        const val READ_ONLY_CACHE_VARIABLE = "GRADLE_RO_DEP_CACHE"
        const val NO_SPRING_BOOT = ""
    }
}
