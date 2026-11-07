package io.github.jubasse.seampact.conventions;

import org.gradle.api.Project;
import org.jetbrains.kotlin.gradle.dsl.JvmTarget;
import org.jetbrains.kotlin.gradle.tasks.KotlinJvmCompile;

/** The Kotlin side of the bytecode convention, in its own class so a Java-only module never loads Kotlin's types. */
final class KotlinBytecode {
    private KotlinBytecode() {
    }

    static void configure(Project project, int bytecodeJavaVersion) {
        project.getTasks().withType(KotlinJvmCompile.class).configureEach(compile -> {
            compile.getCompilerOptions().getJvmTarget().set(JvmTarget.Companion.fromTarget(String.valueOf(bytecodeJavaVersion)));
            compile.getCompilerOptions().getFreeCompilerArgs().add("-Xjdk-release=" + bytecodeJavaVersion);
        });
    }
}
