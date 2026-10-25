package io.github.jubasse.seampact.springboot

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

// The options and entry members of ADR 0022 "Options and registration": defaults, each accepted value, and each
// refusal by its code and member.
class SpringBootOptionsTest {
    private fun options(json: String): JsonObject = Json.parseToJsonElement(json).jsonObject

    private fun parse(json: String): SpringBootOptions = SpringBootOptions.parse(options(json))

    private fun refusalsOf(json: String): List<Pair<String, String>> =
        assertFailsWith<SpringBootRefusedException> { parse(json) }.refusals.map { it.code to it.member }

    @Test
    fun takesTheDefaultsBesideTheRequiredPackage() {
        assertEquals(
            SpringBootOptions(
                packageName = "com.acme.tasks",
                indentSpaces = 4,
                responses = ResponsesMode.STRICT,
                bodyValidation = false,
                frameworkEtag = FrameworkEtagMode.STRIP,
                catchAll = true,
                springSecurity = SpringSecurityMode.OFF,
            ),
            parse("""{ "package": "com.acme.tasks" }"""),
        )
    }

    @Test
    fun takesEveryListedValue() {
        val parsed = parse(
            """{ "package": "a.b", "indent": 2, "responses": "warn", "bodyValidation": true, "frameworkEtag": "keep",
                 "catchAll": false, "springSecurity": { "matchers": true }, "handlers": "perResource" }""",
        )

        assertEquals(SpringBootOptions("a.b", 2, ResponsesMode.WARN, true, FrameworkEtagMode.KEEP, false, SpringSecurityMode.ON_WITH_MATCHERS), parsed)
        assertEquals(SpringSecurityMode.ON, parse("""{ "package": "a", "springSecurity": true }""").springSecurity)
        assertEquals(SpringSecurityMode.ON, parse("""{ "package": "a", "springSecurity": { "matchers": false } }""").springSecurity)
    }

    @Test
    fun refusesAMissingOrInvalidPackage() {
        assertEquals(listOf("options.package.missing" to "/package"), refusalsOf("{}"))
        assertEquals(listOf("options.package.invalid" to "/package"), refusalsOf("""{ "package": "com.class.tasks" }"""))
        assertEquals(listOf("options.package.invalid" to "/package"), refusalsOf("""{ "package": 3 }"""))
    }

    @Test
    fun refusesUnknownKeysAndValuesOutsideTheirSets() {
        assertEquals(
            listOf(
                "options.unknown" to "/prettier",
                "options.indent.invalid" to "/indent",
                "options.responses.invalid" to "/responses",
                "options.bodyValidation.invalid" to "/bodyValidation",
                "options.frameworkEtag.invalid" to "/frameworkEtag",
                "options.catchAll.invalid" to "/catchAll",
                "options.springSecurity.invalid" to "/springSecurity",
            ),
            refusalsOf(
                """{ "package": "a", "prettier": {}, "indent": 9, "responses": "lenient", "bodyValidation": "yes",
                     "frameworkEtag": true, "catchAll": "false", "springSecurity": { "matchers": true, "extra": 1 } }""",
            ),
        )
    }

    @Test
    fun refusesTheLayoutHandlersAndNamingOptionsItDoesNotServe() {
        assertEquals(
            listOf(
                "options.layout.unsupported" to "/layout",
                "options.handlers.unsupported" to "/handlers",
                "options.naming.unsupported" to "/suffixes",
                "options.naming.unsupported" to "/escape",
                "options.naming.unsupported" to "/enumCase",
            ),
            refusalsOf(
                """{ "package": "a", "layout": "flat", "handlers": "perOperation", "suffixes": { "input": "request" },
                     "escape": { "position": "prefix", "text": "x" }, "enumCase": "pascal" }""",
            ),
        )
    }

    @Test
    fun refusesTheEntryMembersLaterReleasesServe() {
        val entry = SpringBootEntry(
            id = "server",
            options = options("""{ "package": "a", "springSecurity": true }"""),
            springBootVersion = "3.5.6",
            artefacts = options("""{ "bootCheck": { "hooks": "warn" }, "nativeDocs": true, "accessHooks": false, "openapi": true }"""),
            frameworkDocs = "off",
            link = mapOf("validators" to "zod", "a/b" to "zod"),
        )
        val refusals = mutableListOf<SpringBootRefusal>()

        checkEntry(entry, SpringBootOptions.parse(entry.options), refusals)

        assertEquals(
            listOf(
                "framework.version.unsupported" to "/springBootVersion",
                "link.kind.not-consumed" to "/link/validators",
                "link.kind.not-consumed" to "/link/a~1b",
                "artefact.bootCheck.hooks.warn.unsupported" to "/artefacts/bootCheck/hooks",
                "artefact.nativeDocs.unsupported" to "/artefacts/nativeDocs",
                "artefact.accessHooks.unsupported" to "/artefacts/accessHooks",
                "artefact.unknown" to "/artefacts/openapi",
                "frameworkDocs.off.unsupported" to "/frameworkDocs",
                "options.springSecurity.unsupported" to "/options/springSecurity",
            ),
            refusals.map { it.code to it.member },
        )
        val accessHooks = refusals.single { it.code == "artefact.accessHooks.unsupported" }
        assertTrue(accessHooks.message.endsWith("it waits for an app that needs it."), accessHooks.message)
    }
}
