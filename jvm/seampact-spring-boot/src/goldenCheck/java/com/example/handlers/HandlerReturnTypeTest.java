package com.example.handlers;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.StringWriter;
import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * A handler of the compiled golden tree checked by javac: the generated interface and its sealed result let a
 * controller return only the statuses its operation declares.
 */
class HandlerReturnTypeTest {
    private static final String DECLARED_STATUS =
            "return new com.example.tasks.api.HealthResult.Status200(new com.example.tasks.api.schemas.Health(\"ok\"));";

    @TempDir
    Path classesDirectory;

    private record Compiled(boolean succeeded, String diagnostics) {}

    private Compiled compile(String className, String source) {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        JavaFileObject file = new SimpleJavaFileObject(URI.create("string:///com/example/handlers/" + className + ".java"), JavaFileObject.Kind.SOURCE) {
            @Override
            public CharSequence getCharContent(boolean ignoreEncodingErrors) {
                return source;
            }
        };
        List<String> options = List.of("-classpath", System.getProperty("java.class.path"), "-d", classesDirectory.toString());
        StringWriter diagnostics = new StringWriter();

        boolean succeeded = compiler.getTask(diagnostics, null, null, options, null, List.of(file)).call();

        return new Compiled(succeeded, diagnostics.toString());
    }

    private static String healthHandler(String className, String returnType, String body) {
        return "package com.example.handlers;\n"
                + "public final class " + className + " implements com.example.tasks.api.AppEndpoints {\n"
                + "    @Override\n"
                + "    public " + returnType + " health(com.example.tasks.api.HealthInput input) {\n"
                + "        " + body + "\n"
                + "    }\n"
                + "}\n";
    }

    @Test
    void aHandlerReturningADeclaredStatusCompiles() {
        Compiled compiled = compile("DeclaredHealth", healthHandler("DeclaredHealth", "com.example.tasks.api.HealthResult", DECLARED_STATUS));

        assertTrue(compiled.succeeded(), compiled.diagnostics());
        assertTrue(Files.isRegularFile(classesDirectory.resolve("com/example/handlers/DeclaredHealth.class")));
    }

    @Test
    void aHandlerReturningAnotherTypeThanItsOperationsResultFailsToCompile() {
        Compiled compiled = compile("WrongTypeHealth", healthHandler("WrongTypeHealth", "String", "return \"ok\";"));

        assertFalse(compiled.succeeded());
        assertTrue(compiled.diagnostics().contains("health(HealthInput)"), compiled.diagnostics());
    }

    @Test
    void aStatusTheOperationDoesNotDeclareFailsToCompile() {
        String source = "package com.example.handlers;\n"
                + "public record UndeclaredStatus(String body) implements com.example.tasks.api.HealthResult {}\n";

        Compiled compiled = compile("UndeclaredStatus", source);

        assertFalse(compiled.succeeded());
        assertTrue(compiled.diagnostics().contains("sealed"), compiled.diagnostics());
    }
}
