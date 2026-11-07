package io.github.jubasse.seampact.runner.fixtures

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.Base64
import java.util.HexFormat
import java.util.jar.JarEntry
import java.util.jar.JarOutputStream
import javax.tools.ToolProvider
import kotlin.io.path.absolutePathString
import kotlin.io.path.createDirectories
import kotlin.io.path.readText
import kotlin.io.path.writeBytes
import kotlin.io.path.writeText

/**
 * What the plugins' tests build: the reference contract as a `path` source, compiled by a stub of the compiler
 * binary that writes the golden IR, so no Node and no release is needed.
 */
public object ReferenceApp {
    /** The reference app config: the core operations of `tasks` the spring-boot target generates today. */
    public const val CONFIG: String = """
        outDir: build/generated/sources/seampact/main
        openapi: none
        sources:
          contract: { path: contract }
        targets:
          - id: server
            use: io.github.jubasse:seampact-spring-boot
            api: tasks
            operations: { include: [health, getChannel, getDraft, getTask, getTasksBatch, searchTasks] }
            options: { package: com.example.tasks.api }
        """

    public val repositoryRoot: Path get() = Path.of(System.getProperty("seampact.repositoryRoot"))

    /** Copies the reference contract into `<app>/contract`. */
    public fun copyContract(app: Path) {
        repositoryRoot.resolve("fixtures/reference").toFile().copyRecursively(app.resolve("contract").toFile())
    }

    /**
     * Writes at [binary] a stub of the compiler binary: it adds its command to [marker], one line per run; on
     * `generate` or `check` it adds `app-directory` when it is given one, and `bundle-directory <source>` for each
     * handed-over bundle directory that exists, then prints one line and exits 0, or exits 1 while [failMarkerOf] of
     * [marker] exists. Any other command writes the golden IR where `--out` points.
     */
    public fun writeStubBinary(binary: Path, marker: Path) {
        val golden = repositoryRoot.resolve("fixtures/golden/reference")
        val markerPath = marker.absolutePathString()
        binary.writeText(
            """
            #!/bin/sh
            echo "${'$'}1" >> '$markerPath'
            case "${'$'}1" in
              generate|check)
                command="${'$'}1"
                while [ "${'$'}#" -gt 0 ]; do
                  case "${'$'}1" in
                    --app-directory) echo "app-directory" >> '$markerPath' ;;
                    --bundle-directory) if [ -d "${'$'}{2#*=}" ]; then echo "bundle-directory ${'$'}{2%%=*}" >> '$markerPath'; fi ;;
                  esac
                  shift
                done
                if [ -e '${failMarkerOf(marker).absolutePathString()}' ]; then echo "$STUB_REFUSAL_LINE" >&2; exit 1; fi
                echo "$STUB_DOCUMENTS_LINE ${'$'}command"; exit 0 ;;
            esac
            out=""
            while [ "${'$'}#" -gt 0 ]; do
              if [ "${'$'}1" = "--out" ]; then out="${'$'}2"; fi
              shift
            done
            mkdir -p "${'$'}out"
            cp '${golden.resolve("tasks.ir.json")}' '${golden.resolve("tasksService.ir.json")}' "${'$'}out/"
            """.trimIndent() + "\n",
        )
        binary.toFile().setExecutable(true)
    }

    /** The file whose presence makes the stub refuse `generate` and `check`, beside its [marker]. */
    public fun failMarkerOf(marker: Path): Path = marker.resolveSibling("${marker.fileName}-fail")

    /** What the stub prints on its standard error when it refuses. */
    public const val STUB_REFUSAL_LINE: String = "stub refused the documents"

    /** The pinned integrity of the shared vectors' valid bundle, which [publishValidBundle] publishes. */
    public const val VALID_BUNDLE_INTEGRITY: String = "sha256-mtw1LkRCB5fNlvCLQKDoVPotLMCs1ll2u6TKMmQzo6g="

    /** The coordinates [publishValidBundle] publishes the valid bundle under. */
    public const val VALID_BUNDLE_COORDINATES: String = "com.example:contract:1.0.0"

    /**
     * Publishes the valid bundle of the shared vectors to the Maven [repository] as `com.example:contract:1.0.0@tgz`,
     * each file with its `.sha1` and `.md5`, as a deployed repository holds them (Maven 4 refuses files without).
     */
    public fun publishValidBundle(repository: Path) {
        val vectors = repositoryRoot.resolve("packages/core/spec/vectors/bundle/vectors.json")
        val valid = Json.parseToJsonElement(vectors.readText()).jsonObject.getValue("archives").jsonArray
            .first { it.jsonObject.getValue("id").jsonPrimitive.content == "valid" }.jsonObject
        val version = repository.resolve("com/example/contract/1.0.0").createDirectories()

        writeWithChecksums(version.resolve("contract-1.0.0.tgz"), Base64.getDecoder().decode(valid.getValue("base64").jsonPrimitive.content))
        writeWithChecksums(
            version.resolve("contract-1.0.0.pom"),
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>com.example</groupId>
              <artifactId>contract</artifactId>
              <version>1.0.0</version>
              <packaging>tgz</packaging>
            </project>
            """.trimIndent().toByteArray(),
        )
    }

    /**
     * Publishes a seampact-spring-runtime of [version] to the Maven [repository]: a jar holding only the runtime's
     * version constant, which is all the generate-time check reads (ADR 0025, G2), with its POM and checksums.
     */
    public fun publishSpringRuntime(repository: Path, version: String) {
        val directory = repository.resolve("io/github/jubasse/seampact-spring-runtime/$version").createDirectories()

        writeWithChecksums(directory.resolve("seampact-spring-runtime-$version.jar"), runtimeVersionJar(repository, version))
        writeWithChecksums(
            directory.resolve("seampact-spring-runtime-$version.pom"),
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>io.github.jubasse</groupId>
              <artifactId>seampact-spring-runtime</artifactId>
              <version>$version</version>
            </project>
            """.trimIndent().toByteArray(),
        )
    }

    // The runtime's version class compiled by the test JDK, in a jar; the build directory sits in [repository] and is
    // removed after.
    private fun runtimeVersionJar(repository: Path, version: String): ByteArray {
        val work = Files.createTempDirectory(repository.createDirectories(), "runtime-version-build")
        val source = work.resolve("$RUNTIME_VERSION_CLASS.java")
        source.writeText(
            """
            package $RUNTIME_PACKAGE;

            public final class $RUNTIME_VERSION_CLASS {
                public static final String VERSION = "$version";

                private $RUNTIME_VERSION_CLASS() {
                }
            }
            """.trimIndent(),
        )

        val compiler = checkNotNull(ToolProvider.getSystemJavaCompiler()) { "The tests run on a JRE; the runtime fixture needs a JDK's javac." }
        val status = compiler.run(null, null, null, "--release", "21", "-d", work.absolutePathString(), source.absolutePathString())
        check(status == 0) { "javac failed on the runtime version fixture $source" }

        val entry = RUNTIME_PACKAGE.replace('.', '/') + "/$RUNTIME_VERSION_CLASS.class"
        val jar = ByteArrayOutputStream()
        JarOutputStream(jar).use { output ->
            output.putNextEntry(JarEntry(entry))
            output.write(Files.readAllBytes(work.resolve(entry)))
            output.closeEntry()
        }
        work.toFile().deleteRecursively()

        return jar.toByteArray()
    }

    private const val RUNTIME_PACKAGE = "io.github.jubasse.seampact.springboot.runtime"
    private const val RUNTIME_VERSION_CLASS = "SeampactRuntimeVersion"

    // Writes [content] to [file], then the checksum files Maven repositories keep next to it.
    private fun writeWithChecksums(file: Path, content: ByteArray) {
        file.writeBytes(content)

        for ((algorithm, extension) in REPOSITORY_CHECKSUMS) {
            file.resolveSibling("${file.fileName}.$extension").writeText(hexDigestOf(algorithm, content))
        }
    }

    private val REPOSITORY_CHECKSUMS = listOf("SHA-1" to "sha1", "MD5" to "md5")

    private fun hexDigestOf(algorithm: String, content: ByteArray): String = HexFormat.of().formatHex(MessageDigest.getInstance(algorithm).digest(content))

    /** What the stub prints on `generate` and `check`, before the command. */
    public const val STUB_DOCUMENTS_LINE: String = "stub documents:"

    /** Writes [text], its indent trimmed, to [relativePath] under [directory], creating the directories it needs. */
    public fun writeFile(directory: Path, relativePath: String, text: String) {
        val file = directory.resolve(relativePath)
        file.parent.createDirectories()
        file.writeText(text.trimIndent() + "\n")
    }

    public fun sha256Of(file: Path): String = hexDigestOf("SHA-256", Files.readAllBytes(file))
}
