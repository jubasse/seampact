package io.github.jubasse.seampact.runner

import io.github.jubasse.seampact.ir.binary.BinaryCompileResult
import io.github.jubasse.seampact.ir.binary.BinaryInstall
import io.github.jubasse.seampact.ir.binary.BinaryRunner
import io.github.jubasse.seampact.ir.bundle.BundleFetcher
import io.github.jubasse.seampact.ir.bundle.BundleVerifyResult
import io.github.jubasse.seampact.ir.config.AppConfig
import io.github.jubasse.seampact.ir.config.ConfigProblem
import io.github.jubasse.seampact.ir.config.ConfigSource
import io.github.jubasse.seampact.ir.config.LocalSourcePolicy
import io.github.jubasse.seampact.ir.config.SourceApi
import io.github.jubasse.seampact.ir.read.IrMalformedException
import io.github.jubasse.seampact.ir.read.IrRefusedException
import io.github.jubasse.seampact.springboot.SpringBootTarget
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.writeText

/** A bundle source that passed the pinned-bundle check, with the integrity it was checked against. */
public data class CheckedBundle(val source: String, val integrity: String)

/** The apis of the used sources, each as its IR JSON document, and the bundles checked on the way. */
internal sealed interface ContractApisOutcome {
    data class Read(val apis: List<SourceApi>, val bundles: List<CheckedBundle>) : ContractApisOutcome

    data class Refused(val problems: List<ConfigProblem>) : ContractApisOutcome
}

/**
 * Gets the IR of each source the JVM entries use (ADR 0010 "How a native plugin gets the IR"): a bundle source
 * through its channel and the pinned-bundle check, a `path` source compiled by the pinned binary, installed only
 * when such a source is used. Every source is tried, so one run names every problem.
 */
internal class ContractApis(
    private val fetcher: BundleFetcher,
    private val localSources: LocalSourcePolicy,
    private val localRefusalReason: String,
    private val installBinary: () -> BinaryInstall,
) {
    private val binary: BinaryInstall by lazy(installBinary)

    fun read(config: AppConfig, used: List<String>): ContractApisOutcome {
        val apis = mutableListOf<SourceApi>()
        val bundles = mutableListOf<CheckedBundle>()
        val problems = mutableListOf<ConfigProblem>()

        for (name in used) {
            when (val source = config.sources.getValue(name)) {
                is ConfigSource.Bundle -> readBundle(name, source, config.directory, apis, bundles, problems)
                is ConfigSource.Local -> compileLocal(name, source.directory, apis, problems)
            }
        }

        return if (problems.isEmpty()) ContractApisOutcome.Read(apis, bundles) else ContractApisOutcome.Refused(problems)
    }

    private fun readBundle(
        name: String,
        source: ConfigSource.Bundle,
        directory: Path,
        apis: MutableList<SourceApi>,
        bundles: MutableList<CheckedBundle>,
        problems: MutableList<ConfigProblem>,
    ) {
        when (val result = fetcher.fetch(source.source, directory, localSources)) {
            is BundleVerifyResult.Verified -> {
                bundles += CheckedBundle(name, result.integrity)
                for ((api, document) in result.irDocuments.toSortedMap()) apis += SourceApi(name, api, document.jsonObject)
            }
            is BundleVerifyResult.Refused -> problems += result.failures.map { it.toProblem(name) }
        }
    }

    private fun compileLocal(name: String, directory: Path, apis: MutableList<SourceApi>, problems: MutableList<ConfigProblem>) {
        if (localSources == LocalSourcePolicy.REFUSE) {
            problems += ConfigProblem(
                "config.source.local",
                "The source '$name' is a local path ($directory), and local sources are refused here ($localRefusalReason).",
                "Use a pinned bundle source instead: `{ release: { url }, integrity }`, `{ git: { url, tag, directory }, integrity }` or `{ maven, integrity }`.",
                "source '$name'",
            )
            return
        }

        val installed = when (val install = binary) {
            is BinaryInstall.Installed -> install.binary
            is BinaryInstall.Refused -> {
                problems += install.failure.toProblem("source '$name'")
                return
            }
        }

        val workDirectory = Files.createTempDirectory("seampact-source-")
        try {
            val configFile = workDirectory.resolve(COMPILE_CONFIG_FILE_NAME)
            configFile.writeText(compileConfig(name, directory).toString())
            collectCompiled(name, BinaryRunner.compile(installed, configFile, SpringBootTarget.IR_SUPPORT), apis, problems)
        } catch (refused: IrRefusedException) {
            problems += refused.refusals.map { it.toProblem("source '$name'") }
        } catch (malformed: IrMalformedException) {
            problems += ConfigProblem("binary.ir-unreadable", malformed.message.orEmpty(), "Report the binary version: its IR does not read.", "source '$name'")
        } finally {
            workDirectory.toFile().deleteRecursively()
        }
    }

    private fun collectCompiled(name: String, result: BinaryCompileResult, apis: MutableList<SourceApi>, problems: MutableList<ConfigProblem>) {
        when (result) {
            is BinaryCompileResult.Compiled -> for (compiled in result.apis) {
                apis += SourceApi(name, compiled.api, Json.parseToJsonElement(compiled.irText).jsonObject)
            }
            is BinaryCompileResult.Failed -> problems += ConfigProblem(
                "binary.compile-refused",
                "The compiler exited with ${result.exitCode} on the source '$name':\n${result.stderr}${result.stdout}".trimEnd(),
                "Fix the contract as the compiler's diagnostics say.",
                "source '$name'",
            )
            is BinaryCompileResult.Refused -> problems += result.failure.toProblem("source '$name'")
            is BinaryCompileResult.OutsideContract -> problems += result.failure.toProblem("source '$name'")
            is BinaryCompileResult.TimedOut -> problems += result.failure.toProblem("source '$name'")
        }
    }

    private companion object {
        const val COMPILE_CONFIG_FILE_NAME = "seampact.config.yaml"
        const val COMPILE_ENTRY_ID = "compile"

        // The binary compiles the sources its config's entries name: one source, named by one entry, and no
        // document, so a run never fetches a bundle source or writes anything but the IR.
        fun compileConfig(name: String, directory: Path): JsonObject = JsonObject(
            mapOf(
                "sources" to JsonObject(mapOf(name to JsonObject(mapOf("path" to JsonPrimitive(directory.toString()))))),
                "targets" to JsonArray(
                    listOf(
                        JsonObject(
                            mapOf(
                                "id" to JsonPrimitive(COMPILE_ENTRY_ID),
                                "use" to JsonPrimitive(SpringBootTarget.USE),
                                "api" to JsonPrimitive("$name/$name"),
                            ),
                        ),
                    ),
                ),
                "openapi" to JsonPrimitive("none"),
            ),
        )
    }
}
