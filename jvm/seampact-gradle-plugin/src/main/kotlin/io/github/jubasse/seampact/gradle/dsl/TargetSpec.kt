package io.github.jubasse.seampact.gradle.dsl

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.gradle.api.Action
import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.MapProperty
import org.gradle.api.provider.Property
import javax.inject.Inject

/**
 * One entry of the app config's `targets`, named by its `id`. `options` and `artefacts` are maps, checked against
 * the target's schema as the file's are.
 */
public abstract class TargetSpec @Inject constructor(public val id: String, private val objects: ObjectFactory) {
    public abstract val use: Property<String>
    public abstract val api: Property<String>
    public abstract val apis: ListProperty<String>
    public abstract val document: Property<String>
    public abstract val out: Property<String>
    public abstract val link: MapProperty<String, String>
    public abstract val options: MapProperty<String, Any>
    public abstract val artefacts: MapProperty<String, Any>
    public abstract val allowUntested: ListProperty<String>
    public abstract val frameworkDocs: Property<String>
    public abstract val mount: Property<String>

    private var operations: OperationsSpec? = null
    private val frameworkRoutes = mutableListOf<FrameworkRouteSpec>()

    /** `operations { include = listOf(...); exclude = listOf(...) }`. */
    public fun operations(action: Action<OperationsSpec>) {
        action.execute(operations ?: objects.newInstance(OperationsSpec::class.java).also { operations = it })
    }

    /** One item of `frameworkRoutes`: `frameworkRoute { path = "/actuator/health"; reason = "..."; method = "GET" }`. */
    public fun frameworkRoute(action: Action<FrameworkRouteSpec>) {
        frameworkRoutes += objects.newInstance(FrameworkRouteSpec::class.java).also(action::execute)
    }

    internal fun toJson(): JsonObject {
        val where = "targets '$id'"
        val members = JsonMembers()
        members.element("id", JsonPrimitive(id))
        members.string("use", use)
        members.string("api", api)
        members.strings("apis", apis)
        members.string("document", document)
        members.string("out", out)
        members.stringMap("link", link)
        members.valueMap("options", options, "$where options")
        members.element("operations", operations?.toJson())
        members.valueMap("artefacts", artefacts, "$where artefacts")
        members.strings("allowUntested", allowUntested)
        if (frameworkRoutes.isNotEmpty()) members.element("frameworkRoutes", JsonArray(frameworkRoutes.map { it.toJson() }))
        members.string("frameworkDocs", frameworkDocs)
        members.string("mount", mount)

        return members.toJson()
    }
}

/** The `operations` filter of a target entry. */
public abstract class OperationsSpec {
    public abstract val include: ListProperty<String>
    public abstract val exclude: ListProperty<String>

    internal fun toJson(): JsonObject = JsonMembers().apply {
        strings("include", include)
        strings("exclude", exclude)
    }.toJson()
}

/** One allow-listed framework route of a server target entry. */
public abstract class FrameworkRouteSpec {
    public abstract val method: Property<String>
    public abstract val path: Property<String>
    public abstract val reason: Property<String>

    internal fun toJson(): JsonObject = JsonMembers().apply {
        string("method", method)
        string("path", path)
        string("reason", reason)
    }.toJson()
}
