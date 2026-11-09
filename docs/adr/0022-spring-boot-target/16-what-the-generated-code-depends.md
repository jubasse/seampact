### What the generated code depends on

At compile and run time:

- Spring Framework 7.0.6 or later (`spring-webmvc`), the matrix's floor for the flush flag of "The outgoing response check", Spring Boot 4 (`FilterRegistrationBean`, configuration properties, `SpringBootVersion`) and Jakarta Servlet 6.1;
- the Jakarta Validation 3.1 API, for the records' constraints;
- Jackson 3 (`tools.jackson.core:jackson-databind`) and `jackson-annotations`;
- `seampact-hooks`;
- Spring Security 7 in the security class only, and `io.swagger.v3.oas.annotations` under `nativeDocs` only.

The boundary runtime is `io.github.jubasse:seampact-spring-runtime`, at the plugin's version (ADR 0025): the Gradle plugin adds it to the main source set's `implementation`, a Maven app declares it. Before it writes, `generate` reads the runtime on that compile classpath and refuses `runtime.missing` or `runtime.version-mismatch` (ADR 0025 G2). Generated code never imports Jackson 2, which springdoc 3 brings to the classpath for swagger-core (spike), nor Kotlin. Bytecode and sources target Java 21, compiled and tested on 21 and 25 ([A13](../../decisions.md#a13)).
