package io.github.jubasse.seampact.maven

import io.github.jubasse.seampact.ir.config.AppConfigReader
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import io.github.jubasse.seampact.runner.AppLayout
import io.github.jubasse.seampact.runner.BuildTool
import io.github.jubasse.seampact.runner.RunSettings
import io.github.jubasse.seampact.runner.problemsText
import org.apache.maven.execution.MavenSession
import org.apache.maven.plugin.AbstractMojo
import org.apache.maven.plugin.MojoExecution
import org.apache.maven.plugin.MojoFailureException
import org.apache.maven.plugin.PluginParameterExpressionEvaluator
import org.apache.maven.plugins.annotations.Parameter
import org.apache.maven.project.MavenProject
import org.codehaus.plexus.configuration.PlexusConfiguration
import org.eclipse.aether.RepositorySystem
import java.nio.file.Path

/**
 * What the `generate` and `check` goals read: the app config, from `seampact.config.yaml` or the app-config keys of
 * the plugin's `<configuration>` (A42, converted by [ConfigurationConverter]), the `<binary>` pin override,
 * `SEAMPACT_ALLOW_LOCAL` and the Spring Boot version of the project's dependencies. Bundles and the compiler binary
 * are resolved through Resolver with the project's repositories.
 */
public abstract class SeampactMojo(private val repositorySystem: RepositorySystem) : AbstractMojo() {
    @field:Parameter(defaultValue = "\${project}", readonly = true, required = true)
    protected lateinit var project: MavenProject

    @field:Parameter(defaultValue = "\${session}", readonly = true, required = true)
    private lateinit var session: MavenSession

    @field:Parameter(defaultValue = "\${mojoExecution}", readonly = true, required = true)
    private lateinit var mojoExecution: MojoExecution

    // The app config's keys (`app.schema.json`), each one element of `<configuration>`.
    @field:Parameter
    private var allowLocal: PlexusConfiguration? = null

    @field:Parameter
    private var outDir: PlexusConfiguration? = null

    @field:Parameter
    private var sources: PlexusConfiguration? = null

    @field:Parameter
    private var targets: PlexusConfiguration? = null

    @field:Parameter
    private var openapi: PlexusConfiguration? = null

    @field:Parameter
    private var checks: PlexusConfiguration? = null

    @field:Parameter
    private var warnings: PlexusConfiguration? = null

    @field:Parameter
    private var diff: PlexusConfiguration? = null

    /** The compiler binary pin override: `<version>` with `<sha256ByClassifier>`, or `<path>` with `<sha256>`. */
    @field:Parameter
    private var binary: PlexusConfiguration? = null

    protected val buildDirectory: Path get() = Path.of(project.build.directory)

    private val appDirectory: Path get() = project.basedir.toPath().toAbsolutePath().normalize()

    private val artefacts: ResolverArtefacts by lazy {
        ResolverArtefacts(repositorySystem, session.repositorySession, project.remoteProjectRepositories)
    }

    /** What one run reads, or a [MojoFailureException] naming every problem of the POM's configuration. */
    protected fun runSettings(): RunSettings {
        val evaluate = expressionEvaluator()
        val dslTree = when (val converted = ConfigurationConverter(ConfigurationConverter.appSchema, evaluate).convert(appConfigElements())) {
            is ConversionOutcome.Refused -> throw refused(converted.problems)
            is ConversionOutcome.Converted -> if (converted.tree.isEmpty()) null else converted.tree.toString()
        }
        val binarySettings = when (val read = BinaryElement.read(binary, evaluate, appDirectory)) {
            is BinaryElementRead.Refused -> throw refused(read.problems)
            is BinaryElementRead.Read -> read.settings
        }
        val seampactCache = Path.of(System.getProperty(USER_HOME), MAVEN_USER_DIRECTORY, CACHE_DIRECTORY)

        return RunSettings(
            buildTool = MAVEN_BUILD_TOOL,
            appDirectory = appDirectory,
            dslTree = dslTree,
            dslName = DSL_NAME,
            allowLocalVariable = System.getenv(LocalSourcePolicy.ALLOW_LOCAL_VARIABLE),
            springBootVersion = springBootVersion(),
            binary = binarySettings,
            bundleCacheDirectory = seampactCache.resolve(BUNDLE_CACHE),
            binaryCacheDirectory = seampactCache.resolve(BINARY_CACHE),
            mavenArtefacts = artefacts,
            resolveBinaryArtefact = artefacts::resolveBinary,
        )
    }

    /** The app's layout, read as the run reads it: the entry roots, the `path` and the `maven` sources. */
    protected fun layoutOf(settings: RunSettings): AppLayout = AppLayout.read(settings.appDirectory, settings.dslTree, settings.dslName)

    /** Where each `maven` bundle source is served from, local or remote repository. */
    protected fun bundleOrigins(layout: AppLayout): List<String> = artefacts.origins(layout.mavenSources)

    /** The jars of the plugin's own classpath, as Maven resolved them for this execution. */
    internal fun pluginCodeArtefacts(): List<GenerateStamp.CodeArtefact> {
        val pluginDescriptor = mojoExecution.mojoDescriptor.pluginDescriptor

        return (listOf(pluginDescriptor.pluginArtifact) + pluginDescriptor.artifacts)
            .distinctBy { it.id }
            .map { GenerateStamp.CodeArtefact("${it.groupId}:${it.artifactId}:${it.baseVersion}", it.isSnapshot, it.file?.toPath()) }
    }

    /** The config file the run reads when the POM sets no app-config key. */
    protected val configFile: Path get() = appDirectory.resolve(AppConfigReader.FILE_NAME)

    protected fun refused(problems: List<ConfigProblem>): MojoFailureException =
        MojoFailureException("seampact refused the app config:\n" + problemsText(problems))

    private fun appConfigElements(): List<PlexusConfiguration> =
        listOfNotNull(allowLocal, outDir, sources, targets, openapi, checks, warnings, diff)

    // Maven gives a `PlexusConfiguration` parameter its XML as written; `${...}` is evaluated here, as for any other.
    private fun expressionEvaluator(): (String) -> String {
        val evaluator = PluginParameterExpressionEvaluator(session, mojoExecution)

        return { text -> if (EXPRESSION_START in text) evaluator.evaluate(text)?.toString().orEmpty() else text }
    }

    private fun springBootVersion(): String? = project.artifacts
        .firstOrNull { it.groupId == SPRING_BOOT_GROUP && it.artifactId == SPRING_BOOT_ARTIFACT }
        ?.baseVersion

    internal companion object {
        const val DSL_NAME = "pom.xml seampact-maven-plugin <configuration>"
        private const val EXPRESSION_START = "\${"
        private const val USER_HOME = "user.home"
        private const val MAVEN_USER_DIRECTORY = ".m2"
        private const val CACHE_DIRECTORY = "seampact"
        private const val BUNDLE_CACHE = "bundles"
        private const val BINARY_CACHE = "binaries"
        private const val SPRING_BOOT_GROUP = "org.springframework.boot"
        private const val SPRING_BOOT_ARTIFACT = "spring-boot"

        /** The Maven plugin as the run's problems and messages name it. */
        val MAVEN_BUILD_TOOL = BuildTool(
            pluginName = "the Maven plugin",
            generateCommand = "mvn generate-sources",
            unresolvedBinaryFix = "Add the repository that holds it to the POM or settings.xml (Maven Central, or your mirror of it), or point `<binary><path>` at your own build with its `<sha256>`.",
        )
    }
}
