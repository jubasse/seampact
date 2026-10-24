package io.github.jubasse.seampact.gradle.dsl

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonArray
import org.gradle.api.Action
import org.gradle.api.InvalidUserDataException
import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.Property
import javax.inject.Inject

/**
 * The app config's `openapi` (ADR 0011 "Which OpenAPI documents exist"): `none()`, or the documents of each api,
 * `api("tasks", "openapi/tasks.yaml")` or `api("tasks") { ... }`.
 */
public abstract class OpenApiSpec @Inject constructor(private val objects: ObjectFactory) {
    private var none = false
    private val apis = linkedMapOf<String, ApiDocuments>()

    private sealed interface ApiDocuments {
        class AtPath(val path: String) : ApiDocuments

        class Described(val spec: ApiDocumentsSpec) : ApiDocuments
    }

    /** `openapi: none`: the app writes no seampact OpenAPI document. */
    public fun none() {
        none = true
    }

    /** The one document of [api] at [path]. */
    public fun api(api: String, path: String) {
        apis[api] = ApiDocuments.AtPath(path)
    }

    /** The document or documents of [api], with their emitter options. */
    public fun api(api: String, action: Action<ApiDocumentsSpec>) {
        val described = apis[api] as? ApiDocuments.Described ?: ApiDocuments.Described(objects.newInstance(ApiDocumentsSpec::class.java)).also { apis[api] = it }
        action.execute(described.spec)
    }

    internal fun toJson(): JsonElement? {
        val documents = JsonMembers()
        for ((api, documentsOfApi) in apis) {
            documents.element(
                api,
                when (documentsOfApi) {
                    is ApiDocuments.AtPath -> JsonPrimitive(documentsOfApi.path)
                    is ApiDocuments.Described -> documentsOfApi.spec.toJson()
                },
            )
        }

        return when {
            none && documents.isEmpty() -> JsonPrimitive(NONE)
            none -> throw InvalidUserDataException(
                "seampact { openapi { } } calls none() and lists the documents of ${apis.keys.joinToString(", ")}; `openapi` is one or the other.",
            )
            else -> documents.toJsonOrNull()
        }
    }

    private companion object {
        const val NONE = "none"
    }
}

/**
 * The emitter options of one OpenAPI document: `path`, `extensions` (`"all"`, `"none"` or a list), `reasons`,
 * `inputSchemas` and `servers`.
 */
public abstract class DocumentSpec {
    public abstract val path: Property<String>
    public abstract val reasons: Property<String>
    public abstract val inputSchemas: Property<String>

    private var extensions: JsonElement? = null
    private val servers = mutableListOf<JsonObject>()

    /** `extensions: all` or `extensions: none`. */
    public fun extensions(mode: String) {
        extensions = JsonPrimitive(mode)
    }

    /** The extensions to write, by name. */
    public fun extensions(names: List<String>) {
        extensions = JsonArray(names.map(::JsonPrimitive))
    }

    /** One item of `servers`. */
    @JvmOverloads
    public fun server(url: String, description: String? = null) {
        servers += JsonObject(listOfNotNull("url" to JsonPrimitive(url), description?.let { "description" to JsonPrimitive(it) }).toMap())
    }

    internal fun documentMembers(): JsonMembers = JsonMembers().apply {
        string("path", path)
        element("extensions", extensions)
        string("reasons", reasons)
        string("inputSchemas", inputSchemas)
        if (servers.isNotEmpty()) element("servers", JsonArray(servers.toList()))
    }

    internal open fun toJson(): JsonObject = documentMembers().toJson()
}

/** The documents of one api: one document's options, or several named documents, `document("public") { ... }`. */
public abstract class ApiDocumentsSpec @Inject constructor(private val objects: ObjectFactory) : DocumentSpec() {
    private val documents = linkedMapOf<String, JsonElement>()
    private val documentSpecs = linkedMapOf<String, DocumentSpec>()

    /** The named document [name] of the api at [path]. */
    public fun document(name: String, path: String) {
        documents[name] = JsonPrimitive(path)
    }

    /** The named document [name] of the api, with its emitter options. */
    public fun document(name: String, action: Action<DocumentSpec>) {
        action.execute(documentSpecs.getOrPut(name) { objects.newInstance(DocumentSpec::class.java) })
    }

    override fun toJson(): JsonObject {
        val members = documentMembers()
        for ((name, path) in documents) members.element(name, path)
        for ((name, spec) in documentSpecs) members.element(name, spec.toJson())

        return members.toJson()
    }
}
