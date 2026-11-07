package io.github.jubasse.seampact.conventions;

import org.gradle.api.Plugin;
import org.gradle.api.Project;
import org.gradle.api.publish.PublishingExtension;
import org.gradle.api.publish.maven.MavenPublication;

/**
 * A published module whose one publication is its `java` component, `io.github.jubasse:<module>:<version>`. A module
 * whose plugin creates its own publications (the Gradle plugin, the compiler binaries) applies
 * {@link PublishedModulePlugin} alone.
 */
public final class LibraryModulePlugin implements Plugin<Project> {
    private static final String PUBLICATION_NAME = "maven";
    private static final String JAVA_PLUGIN = "java";
    private static final String JAVA_COMPONENT = "java";

    @Override
    public void apply(Project project) {
        project.getPluginManager().apply(PublishedModulePlugin.class);

        project.getPluginManager().withPlugin(JAVA_PLUGIN, applied ->
            project.getExtensions().getByType(PublishingExtension.class).getPublications().create(
                PUBLICATION_NAME,
                MavenPublication.class,
                publication -> publication.from(project.getComponents().getByName(JAVA_COMPONENT))));
    }
}
