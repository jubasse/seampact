package io.github.jubasse.seampact.gradle

import io.github.jubasse.seampact.gradle.dsl.BinarySpec
import io.github.jubasse.seampact.gradle.dsl.ChecksSpec
import io.github.jubasse.seampact.gradle.dsl.DiffSpec
import io.github.jubasse.seampact.gradle.dsl.JsonMembers
import io.github.jubasse.seampact.gradle.dsl.OpenApiSpec
import io.github.jubasse.seampact.gradle.dsl.SourceSpec
import io.github.jubasse.seampact.gradle.dsl.TargetSpec
import io.github.jubasse.seampact.gradle.dsl.WarningsSpec
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import org.gradle.api.Action
import org.gradle.api.model.ObjectFactory
import org.gradle.api.provider.Property
import javax.inject.Inject

/**
 * `seampact { }`: the app config's keys (A42, ADR 0011 "The app config"), with the schema and problem codes of
 * `seampact.config.yaml`, and the `binary { }` pin override (ADR 0010). One app has one source: a block that sets
 * any config key beside a `seampact.config.yaml` is refused, naming both.
 */
public abstract class SeampactExtension @Inject constructor(private val objects: ObjectFactory) {
    public abstract val allowLocal: Property<Boolean>
    public abstract val outDir: Property<String>

    public val openapi: OpenApiSpec = objects.newInstance(OpenApiSpec::class.java)
    public val checks: ChecksSpec = objects.newInstance(ChecksSpec::class.java)
    public val warnings: WarningsSpec = objects.newInstance(WarningsSpec::class.java)
    public val diff: DiffSpec = objects.newInstance(DiffSpec::class.java)
    public val binary: BinarySpec = objects.newInstance(BinarySpec::class.java)

    private val sources = linkedMapOf<String, SourceSpec>()
    private val targets = linkedMapOf<String, TargetSpec>()

    /** The source [name] of `sources`. */
    public fun source(name: String, action: Action<SourceSpec>) {
        action.execute(sources.getOrPut(name) { objects.newInstance(SourceSpec::class.java) })
    }

    /** The target entry [id] of `targets`, in the order the build file first names it. */
    public fun target(id: String, action: Action<TargetSpec>) {
        action.execute(targets.getOrPut(id) { objects.newInstance(TargetSpec::class.java, id) })
    }

    public fun openapi(action: Action<OpenApiSpec>): Unit = action.execute(openapi)

    public fun checks(action: Action<ChecksSpec>): Unit = action.execute(checks)

    public fun warnings(action: Action<WarningsSpec>): Unit = action.execute(warnings)

    public fun diff(action: Action<DiffSpec>): Unit = action.execute(diff)

    public fun binary(action: Action<BinarySpec>): Unit = action.execute(binary)

    /** The app config's JSON tree the block writes, in the schema's key order; null when it sets no config key. */
    internal fun configTree(): JsonObject? {
        val members = JsonMembers()
        members.boolean("allowLocal", allowLocal)
        members.string("outDir", outDir)
        if (sources.isNotEmpty()) members.element("sources", JsonObject(sources.mapValues { it.value.toJson() }))
        if (targets.isNotEmpty()) members.element("targets", JsonArray(targets.values.map { it.toJson() }))
        members.element("openapi", openapi.toJson())
        members.element("checks", checks.toJson())
        members.element("warnings", warnings.toJson())
        members.element("diff", diff.toJson())

        return members.toJsonOrNull()
    }

    internal companion object {
        const val NAME = "seampact"
        const val DSL_NAME = "build.gradle(.kts) seampact { }"
    }
}
