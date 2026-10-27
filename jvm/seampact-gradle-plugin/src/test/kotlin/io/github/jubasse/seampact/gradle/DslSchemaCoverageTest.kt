package io.github.jubasse.seampact.gradle

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.gradle.testfixtures.ProjectBuilder
import java.nio.file.Path
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals

// Every key `app.schema.json` defines has a DSL form (A42): the block below writes each one, and the key paths of
// the tree it gives must be the schema's. A key added to the schema fails here until the DSL writes it.
class DslSchemaCoverageTest {
    private val schema: JsonObject = Json.parseToJsonElement(
        Path.of(System.getProperty("seampact.repositoryRoot"), "packages/core/spec/schemas/config/app.schema.json").readText(),
    ).jsonObject

    @Test
    fun theDslWritesEveryKeyOfTheAppSchema() {
        val seampact = newExtension()
        everyForm(seampact)
        val noDocuments = newExtension().apply { openapi { it.none() } }

        val treePaths = treePaths(checkNotNull(seampact.configTree()), schema, "") + treePaths(checkNotNull(noDocuments.configTree()), schema, "")

        assertEquals(schemaPaths(schema, "").sorted(), treePaths.sorted())
    }

    private fun newExtension(): SeampactExtension {
        val project = ProjectBuilder.builder().build()
        project.pluginManager.apply(SeampactPlugin::class.java)

        return project.extensions.getByType(SeampactExtension::class.java)
    }

    private fun everyForm(seampact: SeampactExtension) {
        seampact.allowLocal.set(false)
        seampact.outDir.set("build/generated")
        seampact.source("local") { it.path.set("../contract") }
        seampact.source("npm") { source ->
            source.packageName.set("@acme/contract")
            source.version.set("1.0.0")
            source.integrity.set("sha256-a")
        }
        seampact.source("release") { source -> source.release { it.url.set("https://example.com/b.tgz") } }
        seampact.source("git") { source ->
            source.git { git ->
                git.url.set("https://example.com/c.git")
                git.tag.set("v1")
                git.directory.set("bundle")
            }
        }
        seampact.source("maven") { it.maven.set("com.example:contract:1.0.0") }
        seampact.target("server") { target ->
            target.use.set("io.github.jubasse:seampact-spring-boot")
            target.api.set("tasks")
            target.document.set("public")
            target.out.set("server")
            target.link.put("validators", "zod")
            target.options.put("package", "com.example")
            target.operations { operations ->
                operations.include.add("getTask")
                operations.exclude.add("health")
            }
            target.artefacts.put("bootCheck", mapOf("frameworkRoutes" to true, "hooks" to "warn"))
            target.artefacts.put("nativeDocs", false)
            target.allowUntested.add("spring-boot@4")
            target.frameworkRoute { route ->
                route.method.set("GET")
                route.path.set("/actuator/health")
                route.reason.set("probe")
            }
            target.frameworkDocs.set("keep")
            target.mount.set("/api")
        }
        seampact.target("client") { target ->
            target.use.set("@seampact/client")
            target.apis.add("tasks")
        }
        seampact.openapi { openapi ->
            openapi.api("tasks", "openapi/tasks.yaml")
            openapi.api("billing") { documents ->
                documents.path.set("openapi/billing.yaml")
                documents.extensions("all")
                documents.reasons.set("include")
                documents.inputSchemas.set("shared")
                documents.server("https://api.example.com", "production")
                documents.document("public", "openapi/public.yaml")
                documents.document("full") { full ->
                    full.path.set("openapi/full.yaml")
                    full.extensions(listOf("x-a"))
                    full.reasons.set("omit")
                    full.inputSchemas.set("strict")
                    full.server("https://internal.example.com", "internal")
                }
            }
        }
        seampact.checks { checks ->
            checks.openapi.set("error")
            checks.generated.set("warning")
            checks.matrix.set("error")
        }
        seampact.warnings { it.ignore.add("some.code") }
        seampact.diff { diff ->
            diff.gate.set("both")
            diff.exempt.add("experimental")
        }
    }

    // Each key path of the schema: `*` for a user-named key, `[]` for an array item; alternatives are merged.
    private fun schemaPaths(node: JsonObject, path: String): Set<String> {
        val resolved = resolve(node) ?: return emptySet()
        val paths = mutableSetOf<String>()
        for (alternative in alternatives(resolved)) {
            (alternative["properties"] as? JsonObject)?.forEach { (key, member) ->
                paths += "$path.$key"
                paths += schemaPaths(member.jsonObject, "$path.$key")
            }
            (alternative["additionalProperties"] as? JsonObject)?.let { paths += schemaPaths(it, "$path.*") + "$path.*" }
            (alternative["items"] as? JsonObject)?.let { paths += schemaPaths(it, "$path[]") }
        }

        return paths
    }

    // Each key path of a DSL tree, named as the schema names it.
    private fun treePaths(value: JsonElement, node: JsonObject, path: String): Set<String> {
        val resolved = resolve(node) ?: return emptySet()
        val shapes = alternatives(resolved)

        // A member without properties, `options`, is the target's to check: its keys are not the app schema's.
        val freeObject = shapes.none { "properties" in it || "additionalProperties" in it }

        return when (value) {
            is JsonObject -> if (freeObject) emptySet() else value.flatMap { (key, member) ->
                val named = shapes.firstNotNullOfOrNull { (it["properties"] as? JsonObject)?.get(key) as? JsonObject }
                val free = shapes.firstNotNullOfOrNull { it["additionalProperties"] as? JsonObject }
                when {
                    named != null -> treePaths(member, named, "$path.$key") + "$path.$key"
                    free != null -> treePaths(member, free, "$path.*") + "$path.*"
                    else -> setOf("$path.$key (no schema key)")
                }
            }.toSet()
            is JsonArray -> {
                val items = shapes.firstNotNullOfOrNull { it["items"] as? JsonObject } ?: return emptySet()
                value.flatMap { treePaths(it, items, "$path[]") }.toSet()
            }
            else -> emptySet()
        }
    }

    private fun resolve(node: JsonObject): JsonObject? {
        val reference = node["\$ref"]?.jsonPrimitive?.content ?: return node

        return (schema["\$defs"] as JsonObject)[reference.removePrefix("#/\$defs/")]?.jsonObject
    }

    // A schema and the alternatives of its `oneOf`, each resolved.
    private fun alternatives(node: JsonObject): List<JsonObject> =
        listOf(node) + ((node["oneOf"] as? JsonArray) ?: JsonArray(emptyList())).mapNotNull { resolve(it.jsonObject) }.flatMap { alternatives(it) }
}
