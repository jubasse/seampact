package io.github.jubasse.seampact.conventions;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.gradle.api.DefaultTask;
import org.gradle.api.file.DirectoryProperty;
import org.gradle.api.provider.Property;
import org.gradle.api.tasks.CacheableTask;
import org.gradle.api.tasks.Input;
import org.gradle.api.tasks.OutputDirectory;
import org.gradle.api.tasks.TaskAction;

/**
 * Writes a Java class holding the build's version as a constant (ADR 0025, G1): the Spring runtime and the Spring
 * Boot generator of one build carry the same version, which the generate-time and boot checks compare.
 */
@CacheableTask
public abstract class WriteVersionConstant extends DefaultTask {
    /** The version the constant holds: the module's `project.version`. */
    @Input
    public abstract Property<String> getVersion();

    /** The fully qualified name of the class written. */
    @Input
    public abstract Property<String> getClassName();

    /** The class's one-sentence Javadoc. */
    @Input
    public abstract Property<String> getDocumentation();

    /** The source root the class is written under. */
    @OutputDirectory
    public abstract DirectoryProperty getOutputDirectory();

    @TaskAction
    public void write() {
        String className = getClassName().get();
        int lastDot = className.lastIndexOf('.');
        String packageName = className.substring(0, lastDot);
        String simpleName = className.substring(lastDot + 1);
        Path file = getOutputDirectory().get().getAsFile().toPath().resolve(className.replace('.', '/') + ".java");

        String source = "package " + packageName + ";\n\n"
                + "/** " + getDocumentation().get() + " */\n"
                + "public final class " + simpleName + " {\n"
                + "    /** The version of this build; unreleased, the development version every module of the build shares. */\n"
                + "    public static final String VERSION = \"" + getVersion().get() + "\";\n\n"
                + "    private " + simpleName + "() {\n"
                + "    }\n"
                + "}\n";

        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, source, StandardCharsets.UTF_8);
        } catch (IOException failure) {
            throw new UncheckedIOException("Writing the version constant " + file + " failed", failure);
        }
    }
}
