package io.github.jubasse.seampact.ir.config

import io.github.jubasse.seampact.ir.bundle.BundleSource
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

// The app config reader against the cases of ADR 0011 "The app config": what it reads, and the code and place of
// each refusal, the codes the Node CLI gives for the same config.
class ConfigReaderTest {
    @TempDir
    lateinit var workspace: Path

    private val springConfig = """
        outDir: build/generated/sources/seampact/main
        sources:
          contract: { release: { url: 'https://example.com/tasks.tgz' }, integrity: 'sha256-abc' }
        targets:
          - id: server
            use: 'io.github.jubasse:seampact-spring-boot'
            api: tasks
            operations: { include: [tasks], exclude: [deleteTask] }
            options: { package: com.acme.tasks.api }
            link: { validators: zod }
          - id: web
            use: '@seampact/codegen-react-query'
            api: contract/tasks
        checks: { generated: disabled }
    """.trimIndent()

    @Test
    fun readsTheSpringBootExampleAndLeavesOtherEcosystemsToTheirRunner() {
        val config = read(springConfig)

        assertEquals(workspace.resolve("app/build/generated/sources/seampact/main"), config.outDir)
        assertEquals(listOf("server"), config.entries.map { it.id })
        assertEquals(listOf("web"), config.otherEntries.map { it.id })
        assertEquals(TargetEcosystem.NPM, config.otherEntries.single().ecosystem)

        val server = config.entries.single()
        assertEquals(config.outDir.resolve("server"), server.root)
        assertEquals(listOf("tasks"), server.apiRefs)
        assertEquals(listOf("tasks"), server.include)
        assertEquals(listOf("deleteTask"), server.exclude)
        assertEquals(mapOf("validators" to "zod"), server.link)
        assertEquals(BundleSource.Release("https://example.com/tasks.tgz", "sha256-abc"), (config.sources.getValue("contract") as ConfigSource.Bundle).source)
    }

    @Test
    fun resolvesPathSourcesAgainstTheConfigDirectoryAndReadsAMavenSource() {
        val config = read("sources:\n  local: { path: ../contract }\n  published: { maven: 'com.acme:tasks-contract:1.0.0', integrity: sha256-x }\n")

        assertEquals(ConfigSource.Local(workspace.resolve("contract")), config.sources.getValue("local"))
        assertEquals(
            ConfigSource.Bundle(BundleSource.MavenArtefact("com.acme:tasks-contract:1.0.0", "sha256-x")),
            config.sources.getValue("published"),
        )
        assertEquals(listOf("config.schema"), refused("sources: { published: { maven: 'com.acme:tasks-contract' } }\n").map { it.code })
        for (coordinates in listOf("..:..:1.0.0", ".:-:1.0.0")) {
            assertEquals(listOf("config.schema"), refused("sources: { published: { maven: '$coordinates' } }\n").map { it.code }, coordinates)
        }
        for (version in listOf("+", "1.+", "latest.release", "[1.0,2.0)", "1.0-SNAPSHOT")) {
            val problems = refused("sources: { published: { maven: 'com.acme:tasks-contract:$version' } }\n")
            assertEquals(listOf("config.source.maven-unpinned"), problems.map { it.code }, version)
        }
    }

    @Test
    fun refusesAMountWithADotSegment() {
        for (mount in listOf("/..", "/api/.", "/api/../v1")) {
            assertEquals("config.schema", refused("targets:\n  - { id: a, use: 'g:a', api: x, mount: $mount }\n").single().code, mount)
        }
    }

    @Test
    fun namesTheMountRuleAsTheNodeCliDoes() {
        val problems = refused("targets:\n  - { id: a, use: 'g:a', api: x, mount: /api/ }\n")

        assertEquals(
            "The key 'mount' is '/' then segments of ASCII letters, digits and '-._~!\$&'()+,;=@:', with no trailing '/', no '*', no '.' or '..' segment and no segment starting with ':'.",
            problems.single().message,
        )
    }

    @Test
    fun refusesAnUnknownKeyAtItsPosition() {
        val problems = refused("targets:\n  - id: a\n    use: 'g:a'\n    api: x\n    bogus: 1\n")

        assertEquals(listOf("config.schema"), problems.map { it.code })
        assertEquals("app/seampact.config.yaml:5:5 targets[0].bogus", problems.single().where)
    }

    @Test
    fun refusesAMissingKeyAndAValueOfTheWrongType() {
        assertEquals(
            listOf("The key 'use' is required here."),
            refused("targets:\n  - id: a\n    api: x\n").map { it.message },
        )
        assertEquals(listOf("The value fails the schema keyword 'type': integer found, string expected."), refused("outDir: 3\n").map { it.message })
    }

    @Test
    fun namesTheFormsOfAOneOfOnce() {
        val entry = refused("targets:\n  - { id: a, use: 'g:a', api: x, apis: [y] }\n")
        assertEquals(listOf("A target entry takes exactly one of 'api' and 'apis'."), entry.map { it.message })

        val source = refused("sources: { s: { path: ., integrity: 'sha256-x' } }\n")
        assertEquals(listOf("config.schema"), source.map { it.code })
        assertEquals("app/seampact.config.yaml:1:12 sources.s", source.single().where)
    }

    @Test
    fun refusesWaitingKeysByNameOnly() {
        val problems = refused("targets:\n  - { id: a, use: 'g:a', api: x, access: { native: reason } }\n")

        assertEquals(listOf("config.key.waits"), problems.map { it.code })
        assertEquals("app/seampact.config.yaml:2:34 targets[0].access", problems.single().where)
    }

    @Test
    fun refusesEntriesThatCollide() {
        val duplicate = refused("targets:\n  - { id: a, use: 'g:a', api: x }\n  - { id: a, use: 'g:b', api: x, out: b }\n")
        assertEquals(listOf("config.target.duplicate-id"), duplicate.map { it.code })

        val outside = refused("targets:\n  - { id: a, use: 'g:a', api: x, out: ../elsewhere }\n")
        assertEquals(listOf("config.out.outside"), outside.map { it.code })

        val overlap = refused("targets:\n  - { id: a, use: 'g:a', api: x, out: gen }\n  - { id: b, use: 'g:b', api: x, out: gen/b }\n")
        assertEquals(listOf("config.out.overlap"), overlap.map { it.code })

        val conflict = refused(
            "targets:\n  - id: a\n    use: 'g:a'\n    api: x\n    artefacts: { bootCheck: false }\n" +
                "    frameworkRoutes: [{ path: /actuator/**, reason: health }]\n",
        )
        assertEquals(listOf("config.key.conflict"), conflict.map { it.code })
    }

    @Test
    fun refusesYamlTheNodeCliRefuses() {
        assertEquals(listOf("config.yaml.syntax"), refused("targets: [\n").map { it.code })
        assertEquals(listOf("config.yaml.syntax"), refused("outDir: a\noutDir: b\n").map { it.code })
        assertEquals(listOf("config.key.reserved"), refused("__proto__: {}\n").map { it.code })
        assertEquals(listOf("config.yaml.syntax"), refused("outDir: !!binary aGk=\n").map { it.code })
        assertEquals(listOf("config.yaml.syntax"), refused("checks: &self { nested: *self }\n").map { it.code })
    }

    @Test
    fun refusesAliasExpansionPastTheNodeClisBudget() {
        assertEquals(listOf("config.yaml.syntax"), refused(doublingAliases(6)).map { it.code })
        assertEquals(
            "Excessive alias count indicates a resource exhaustion attack.",
            refused(doublingAliases(6)).single().message,
        )
        assertEquals(setOf("config.schema"), refused(doublingAliases(5)).map { it.code }.toSet())
    }

    // `checks.l0` holds two strings, each next level two aliases of the one before, under keys the schema refuses.
    private fun doublingAliases(levels: Int): String =
        "checks:\n  l0: &l0 [x, x]\n" + (1 until levels).joinToString("") { "  l$it: &l$it [*l${it - 1}, *l${it - 1}]\n" }

    @Test
    fun refusesARootConfigAMissingFileAndAHugeOne() {
        assertEquals(listOf("config.root.not-an-app"), refused("apps: [a]\n").map { it.code })

        val missing = AppConfigReader.readFile(workspace.resolve("none/seampact.config.yaml"))
        assertEquals(listOf("config.file.missing"), assertIs<AppConfigRead.Refused>(missing).problems.map { it.code })

        val huge = refused("outDir: '${"x".repeat(1024 * 1024)}'\n")
        assertEquals(listOf("config.file.too-large"), huge.map { it.code })
    }

    @Test
    fun readsTheDslTreeAndRefusesAFileBesideIt() {
        Files.createDirectories(workspace.resolve(".git"))
        val directory = Files.createDirectories(workspace.resolve("dsl"))
        val dsl = Json.parseToJsonElement("""{"targets":[{"id":"a","use":"g:a","api":"x"}]}""") as JsonObject

        val read = assertIs<AppConfigRead.Read>(AppConfigReader.readDsl(dsl, "build.gradle.kts seampact { }", directory))
        assertEquals(directory.resolve("__generated__/a"), read.config.entries.single().root)

        val invalid = Json.parseToJsonElement("""{"targets":[{"id":"a","use":"g:a"}],"outDir":1}""") as JsonObject
        val problems = assertIs<AppConfigRead.Refused>(AppConfigReader.readDsl(invalid, "seampact { }", directory)).problems
        assertEquals("seampact { } outDir", problems.first().where)

        Files.writeString(directory.resolve(AppConfigReader.FILE_NAME), "outDir: gen\n")
        val beside = assertIs<AppConfigRead.Refused>(AppConfigReader.readDsl(dsl, "seampact { }", directory))
        assertEquals(listOf("config.file.beside-dsl"), beside.problems.map { it.code })
    }

    @Test
    fun refusesARootThatListsTheAppAndIgnoresOneThatDoesNot() {
        Files.writeString(workspace.resolve(AppConfigReader.FILE_NAME), "apps: [other]\n")
        read("outDir: gen\n")

        Files.writeString(workspace.resolve(AppConfigReader.FILE_NAME), "apps: [app]\n")
        assertEquals(listOf("config.root.unsupported"), refused("outDir: gen\n").map { it.code })
    }

    @Test
    fun localSourcesFollowTheConfigAndTheEnvironment() {
        assertEquals(LocalSourcePolicy.ALLOW, LocalSourcePolicy.of(null, emptyMap()))
        assertEquals(LocalSourcePolicy.REFUSE, LocalSourcePolicy.of(false, mapOf("SEAMPACT_ALLOW_LOCAL" to "true")))
        assertEquals(LocalSourcePolicy.REFUSE, LocalSourcePolicy.of(true, mapOf("SEAMPACT_ALLOW_LOCAL" to "false")))
    }

    private fun write(text: String): Path {
        Files.createDirectories(workspace.resolve(".git"))
        val file = Files.createDirectories(workspace.resolve("app")).resolve(AppConfigReader.FILE_NAME)
        Files.writeString(file, text)

        return file
    }

    private fun read(text: String): AppConfig {
        val outcome = AppConfigReader.readFile(write(text), "app/seampact.config.yaml")

        return assertIs<AppConfigRead.Read>(outcome, outcome.toString()).config
    }

    private fun refused(text: String): List<ConfigProblem> =
        assertIs<AppConfigRead.Refused>(AppConfigReader.readFile(write(text), "app/seampact.config.yaml")).problems
}
