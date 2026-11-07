package io.github.jubasse.seampact.conventions;

import org.gradle.api.GradleException;
import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.file.Directory;
import org.gradle.api.plugins.JavaPluginExtension;
import org.gradle.api.provider.Provider;
import org.gradle.api.publish.PublishingExtension;
import org.gradle.api.publish.maven.MavenPom;
import org.gradle.api.publish.maven.MavenPublication;
import org.gradle.api.publish.maven.plugins.MavenPublishPlugin;
import org.gradle.api.tasks.PathSensitivity;
import org.gradle.api.tasks.compile.JavaCompile;
import org.gradle.api.tasks.javadoc.Javadoc;
import org.gradle.api.tasks.testing.Test;
import org.gradle.external.javadoc.StandardJavadocDocletOptions;
import org.gradle.jvm.toolchain.JavaInstallationMetadata;
import org.gradle.jvm.toolchain.JavaLanguageVersion;
import org.gradle.jvm.toolchain.JavaLauncher;
import org.gradle.jvm.toolchain.JavaToolchainService;

import java.util.List;
import java.util.Map;

/**
 * A published seampact JVM module (ADR 0011 "Unpublished installs for test consumers"): the group, the version
 * `version` of `jvm/gradle.properties`, which the release stamp writes (0.0.0 without it), Java 21 bytecode for Java
 * and Kotlin, the `-PtestJdk=<major>` switch that runs the tests on that JDK, sources and javadoc jars, and
 * `maven-publish` with the POM metadata on every Maven publication. Each module publishes to `publishToMavenLocal`
 * and to the root build's file repository `build/test-repository`, which the Maven plugin's tests read. A release
 * names its staging directory with `-PseampactReleaseRepository=<dir>`, the `release` repository, staged unsigned:
 * the release signs the staged files with `gpg` once approved, outside Gradle. The module states its POM description
 * in `description`.
 */
public final class PublishedModulePlugin implements Plugin<Project> {
    /** The lowest Java version A13 supports: the bytecode every consumer runs. */
    public static final int BYTECODE_JAVA_VERSION = 21;

    private static final String GROUP = "io.github.jubasse";
    private static final String VERSION_PROPERTY = "version";
    private static final String UNSET_VERSION = "0.0.0";
    private static final String TEST_JDK_PROPERTY = "testJdk";
    private static final String KOTLIN_JVM_PLUGIN = "org.jetbrains.kotlin.jvm";
    private static final String JAVA_PLUGIN = "java";
    private static final String KOTLIN_SOURCES_JAR_TASK = "kotlinSourcesJar";
    private static final String TEST_REPOSITORY_NAME = "test";
    private static final String TEST_REPOSITORY_DIRECTORY = "test-repository";
    private static final String GROUP_PATH = GROUP.replace('.', '/');
    private static final String RELEASE_REPOSITORY_NAME = "release";
    private static final String RELEASE_REPOSITORY_PROPERTY = "seampactReleaseRepository";

    private static final String DOCS_URL = "https://jubasse.github.io/seampact/";
    // A module's guide page on the docs site; a module without one points at the package map.
    private static final String SPRING_BOOT_GUIDE = "backend/spring-boot/";
    private static final String PACKAGE_MAP_PAGE = "concepts/packages/";
    private static final Map<String, String> DOCS_PAGE_BY_MODULE = Map.of(
        "seampact-spring-boot", SPRING_BOOT_GUIDE,
        "seampact-spring-runtime", SPRING_BOOT_GUIDE,
        "seampact-runner", SPRING_BOOT_GUIDE,
        "seampact-gradle-plugin", SPRING_BOOT_GUIDE,
        "seampact-maven-plugin", SPRING_BOOT_GUIDE);
    private static final String REPOSITORY_URL = "https://github.com/jubasse/seampact";
    private static final String SCM_CONNECTION = "scm:git:https://github.com/jubasse/seampact.git";
    private static final String SCM_DEVELOPER_CONNECTION = "scm:git:ssh://git@github.com/jubasse/seampact.git";
    private static final String LICENSE_NAME = "MIT License";
    private static final String LICENSE_URL = "https://opensource.org/license/mit";
    private static final String DEVELOPER_ID = "jubasse";
    private static final String DEVELOPER_NAME = "Julien Metral";

    @Override
    public void apply(Project project) {
        project.setGroup(GROUP);
        project.setVersion(project.getProviders().gradleProperty(VERSION_PROPERTY).getOrElse(UNSET_VERSION));

        project.getTasks().withType(JavaCompile.class).configureEach(compile -> compile.getOptions().getRelease().set(BYTECODE_JAVA_VERSION));
        // Kotlin's types load only when the module applies Kotlin, which brings them.
        project.getPluginManager().withPlugin(KOTLIN_JVM_PLUGIN, applied -> KotlinBytecode.configure(project, BYTECODE_JAVA_VERSION));
        project.getPluginManager().withPlugin(JAVA_PLUGIN, applied -> {
            configureTestJdk(project);
            trackTestRuntime(project);
            configureDocumentationJars(project);
            CoverageFloors.configure(project);
        });

        project.getPluginManager().apply(MavenPublishPlugin.class);
        configurePublishing(project);
        configureReleaseRepository(project);
    }

    // Maven Central requires both jars beside each jar. Without a timestamp the javadoc jar keeps its bytes; doclint
    // stays on, so a broken doc comment fails the jar, but leaves out the warnings for members without a comment.
    private static void configureDocumentationJars(Project project) {
        JavaPluginExtension java = project.getExtensions().getByType(JavaPluginExtension.class);
        java.withSourcesJar();
        java.withJavadocJar();
        // Kotlin's own sources jar writes the file `sourcesJar` writes, so the bytes would depend on which ran last.
        project.getTasks().matching(task -> task.getName().equals(KOTLIN_SOURCES_JAR_TASK)).configureEach(task -> task.setEnabled(false));
        project.getTasks().withType(Javadoc.class).configureEach(javadoc -> {
            if (!(javadoc.getOptions() instanceof StandardJavadocDocletOptions options)) return;

            options.addBooleanOption("notimestamp", true);
            options.addBooleanOption("Xdoclint:all,-missing", true);
            options.quiet();
        });
    }

    private static void configureTestJdk(Project project) {
        Provider<String> testJdk = project.getProviders().gradleProperty(TEST_JDK_PROPERTY);
        if (!testJdk.isPresent()) return;

        JavaToolchainService toolchains = project.getExtensions().getByType(JavaToolchainService.class);
        JavaLanguageVersion testJavaVersion = JavaLanguageVersion.of(testJdk.get());
        project.getTasks().withType(Test.class).configureEach(test ->
            test.getJavaLauncher().set(toolchains.launcherFor(spec -> spec.getLanguageVersion().set(testJavaVersion))));
    }

    // Gradle keys a test result on the launcher's major version only, so a JDK patch or vendor change would reuse
    // the result of the JDK that last ran.
    private static void trackTestRuntime(Project project) {
        project.getTasks().withType(Test.class).configureEach(test -> {
            Provider<JavaInstallationMetadata> launcherMetadata = test.getJavaLauncher().map(JavaLauncher::getMetadata);
            test.getInputs().property("testJavaRuntimeVersion", launcherMetadata.map(JavaInstallationMetadata::getJavaRuntimeVersion));
            test.getInputs().property("testJavaVendor", launcherMetadata.map(JavaInstallationMetadata::getVendor));
        });
    }

    /**
     * Declares as inputs of {@code test} the published files, in the test repository, of each module of
     * {@code modulePaths} its builds resolve, so a changed module reruns the test instead of reusing its cached result.
     * Archives are reproducible, so an unchanged module keeps its bytes. The modules carry the test's project version.
     */
    public static void declareTestRepositoryInputs(Test test, List<String> modulePaths) {
        Project project = test.getProject();
        Provider<Directory> testRepository = testRepositoryOf(project);
        String version = project.getVersion().toString();

        for (String modulePath : modulePaths) {
            String artifactId = project.project(modulePath).getName();
            test.getInputs()
                .dir(testRepository.map(repository -> repository.dir(GROUP_PATH + "/" + artifactId + "/" + version)))
                .withPropertyName("testRepository." + artifactId)
                .withPathSensitivity(PathSensitivity.RELATIVE);
        }
    }

    private static Provider<Directory> testRepositoryOf(Project project) {
        return project.getRootProject().getLayout().getBuildDirectory().dir(TEST_REPOSITORY_DIRECTORY);
    }

    private static void configurePublishing(Project project) {
        PublishingExtension publishing = project.getExtensions().getByType(PublishingExtension.class);

        publishing.getRepositories().maven(repository -> {
            repository.setName(TEST_REPOSITORY_NAME);
            repository.setUrl(testRepositoryOf(project));
        });

        publishing.getPublications().withType(MavenPublication.class).configureEach(publication ->
            publication.pom(pom -> describe(project, pom)));
    }

    // Name and description are conventions, so a publication that states its own keeps them.
    private static void describe(Project project, MavenPom pom) {
        pom.getName().convention(project.getName());
        pom.getDescription().convention(project.provider(() -> descriptionOf(project)));
        pom.getUrl().set(DOCS_URL + DOCS_PAGE_BY_MODULE.getOrDefault(project.getName(), PACKAGE_MAP_PAGE));
        pom.licenses(licenses -> licenses.license(license -> {
            license.getName().set(LICENSE_NAME);
            license.getUrl().set(LICENSE_URL);
        }));
        pom.developers(developers -> developers.developer(developer -> {
            developer.getId().set(DEVELOPER_ID);
            developer.getName().set(DEVELOPER_NAME);
        }));
        pom.scm(scm -> {
            scm.getConnection().set(SCM_CONNECTION);
            scm.getDeveloperConnection().set(SCM_DEVELOPER_CONNECTION);
            scm.getUrl().set(REPOSITORY_URL);
        });
    }

    private static void configureReleaseRepository(Project project) {
        Provider<String> releaseRepository = project.getProviders().gradleProperty(RELEASE_REPOSITORY_PROPERTY);
        if (!releaseRepository.isPresent()) return;

        PublishingExtension publishing = project.getExtensions().getByType(PublishingExtension.class);
        publishing.getRepositories().maven(repository -> {
            repository.setName(RELEASE_REPOSITORY_NAME);
            repository.setUrl(project.file(releaseRepository.get()));
        });
    }

    private static String descriptionOf(Project project) {
        String description = project.getDescription();
        if (description == null || description.isBlank()) {
            throw new GradleException(project.getPath() + " has no description for its POM; set `description` in its build file.");
        }

        return description;
    }
}
