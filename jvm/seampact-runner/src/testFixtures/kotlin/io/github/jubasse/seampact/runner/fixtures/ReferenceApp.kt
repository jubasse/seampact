package io.github.jubasse.seampact.runner.fixtures

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat
import kotlin.io.path.absolutePathString
import kotlin.io.path.createDirectories
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
     * `generate` or `check` it prints one line and exits 0, else it writes the golden IR where `--out` points.
     */
    public fun writeStubBinary(binary: Path, marker: Path) {
        val golden = repositoryRoot.resolve("fixtures/golden/reference")
        binary.writeText(
            """
            #!/bin/sh
            echo "${'$'}1" >> '${marker.absolutePathString()}'
            case "${'$'}1" in
              generate|check) echo "$STUB_DOCUMENTS_LINE ${'$'}1"; exit 0 ;;
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
