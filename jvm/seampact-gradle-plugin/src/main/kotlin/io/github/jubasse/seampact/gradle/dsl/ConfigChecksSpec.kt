package io.github.jubasse.seampact.gradle.dsl

import kotlinx.serialization.json.JsonObject
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.Property

/** The app config's `checks`: `openapi`, `generated` and `matrix`, each `error`, `warning` or `disabled`. */
public abstract class ChecksSpec {
    public abstract val openapi: Property<String>
    public abstract val generated: Property<String>
    public abstract val matrix: Property<String>

    internal fun toJson(): JsonObject? = JsonMembers().apply {
        string("openapi", openapi)
        string("generated", generated)
        string("matrix", matrix)
    }.toJsonOrNull()
}

/** The app config's `warnings`: the warning codes to `ignore`. */
public abstract class WarningsSpec {
    public abstract val ignore: ListProperty<String>

    internal fun toJson(): JsonObject? = JsonMembers().apply { strings("ignore", ignore) }.toJsonOrNull()
}

/** The app config's `diff`: its `gate` and the changes it `exempt`s. */
public abstract class DiffSpec {
    public abstract val gate: Property<String>
    public abstract val exempt: ListProperty<String>

    internal fun toJson(): JsonObject? = JsonMembers().apply {
        string("gate", gate)
        strings("exempt", exempt)
    }.toJsonOrNull()
}
