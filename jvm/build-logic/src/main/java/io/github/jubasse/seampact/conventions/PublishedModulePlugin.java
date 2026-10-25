package io.github.jubasse.seampact.conventions;

import org.gradle.api.GradleException;
import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.provider.Provider;
import org.gradle.api.publish.PublishingExtension;
import org.gradle.api.publish.maven.MavenPom;
import org.gradle.api.publish.maven.MavenPublication;
import org.gradle.api.publish.maven.plugins.MavenPublishPlugin;
import org.gradle.api.tasks.compile.JavaCompile;
import org.gradle.api.tasks.testing.Test;
import org.gradle.jvm.toolchain.JavaLanguageVersion;
import org.gradle.jvm.toolchain.JavaToolchainService;

/**
 * A published seampact JVM module (ADR 0011 "Unpublished installs for test consumers"): the group, the version from
 * `-PseampactVersion=<version>` (0.0.0 without it), Java 21 bytecode for Java and Kotlin, the `-PtestJdk=<major>`
 * switch that runs the tests on that JDK, and `maven-publish` with the POM metadata on every Maven publication. Each
 * module publishes to `publishToMavenLocal` and to the root build's file repository `build/test-repository`, which
 * the Maven plugin's tests read. The module states its own POM description in `description`.
 */
public final class PublishedModulePlugin implements Plugin<Project> {
    /** The lowest Java version A13 supports: the bytecode every consumer runs. */
    public static final int BYTECODE_JAVA_VERSION = 21;

    private static final String GROUP = "io.github.jubasse";
    private static final String VERSION_PROPERTY = "seampactVersion";
    private static final String UNSET_VERSION = "0.0.0";
    private static final String TEST_JDK_PROPERTY = "testJdk";
    private static final String KOTLIN_JVM_PLUGIN = "org.jetbrains.kotlin.jvm";
    private static final String JAVA_PLUGIN = "java";
    private static final String TEST_REPOSITORY_NAME = "test";
    private static final String TEST_REPOSITORY_DIRECTORY = "test-repository";

    private static final String PROJECT_URL = "https://github.com/jubasse/seampact";
    private static final String SCM_CONNECTION = "scm:git:https://github.com/jubasse/seampact.git";
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
        project.getPluginManager().withPlugin(JAVA_PLUGIN, applied -> configureTestJdk(project));

        project.getPluginManager().apply(MavenPublishPlugin.class);
        configurePublishing(project);
    }

    private static void configureTestJdk(Project project) {
        Provider<String> testJdk = project.getProviders().gradleProperty(TEST_JDK_PROPERTY);
        if (!testJdk.isPresent()) return;

        JavaToolchainService toolchains = project.getExtensions().getByType(JavaToolchainService.class);
        JavaLanguageVersion testJavaVersion = JavaLanguageVersion.of(testJdk.get());
        project.getTasks().withType(Test.class).configureEach(test ->
            test.getJavaLauncher().set(toolchains.launcherFor(spec -> spec.getLanguageVersion().set(testJavaVersion))));
    }

    private static void configurePublishing(Project project) {
        PublishingExtension publishing = project.getExtensions().getByType(PublishingExtension.class);

        publishing.getRepositories().maven(repository -> {
            repository.setName(TEST_REPOSITORY_NAME);
            repository.setUrl(project.getRootProject().getLayout().getBuildDirectory().dir(TEST_REPOSITORY_DIRECTORY));
        });

        publishing.getPublications().withType(MavenPublication.class).configureEach(publication ->
            publication.pom(pom -> describe(project, pom)));
    }

    // Name and description are conventions, so a publication that states its own keeps them.
    private static void describe(Project project, MavenPom pom) {
        pom.getName().convention(project.getName());
        pom.getDescription().convention(project.provider(() -> descriptionOf(project)));
        pom.getUrl().set(PROJECT_URL);
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
            scm.getUrl().set(PROJECT_URL);
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
