package io.github.jubasse.seampact.runner.fixtures

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.Base64
import java.util.HexFormat
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

    /** Publishes the valid bundle of the shared vectors to the Maven [repository] as `com.example:contract:1.0.0@tgz`. */
    public fun publishValidBundle(repository: Path) {
        val vectors = repositoryRoot.resolve("packages/core/spec/vectors/bundle/vectors.json")
        val valid = Json.parseToJsonElement(vectors.readText()).jsonObject.getValue("archives").jsonArray
            .first { it.jsonObject.getValue("id").jsonPrimitive.content == "valid" }.jsonObject
        val version = repository.resolve("com/example/contract/1.0.0").createDirectories()

        version.resolve("contract-1.0.0.tgz").writeBytes(Base64.getDecoder().decode(valid.getValue("base64").jsonPrimitive.content))
        version.resolve("contract-1.0.0.pom").writeText(
            """
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>com.example</groupId>
              <artifactId>contract</artifactId>
              <version>1.0.0</version>
              <packaging>tgz</packaging>
            </project>
            """.trimIndent(),
        )
    }

    /** What the stub prints on `generate` and `check`, before the command. */
    public const val STUB_DOCUMENTS_LINE: String = "stub documents:"

    /** Writes [text], its indent trimmed, to [relativePath] under [directory], creating the directories it needs. */
    public fun writeFile(directory: Path, relativePath: String, text: String) {
        val file = directory.resolve(relativePath)
        file.parent.createDirectories()
        file.writeText(text.trimIndent() + "\n")
    }

    public fun sha256Of(file: Path): String = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)))
}
