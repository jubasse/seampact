package io.github.jubasse.seampact.gradle.dsl

import org.gradle.api.InvalidUserDataException
import org.gradle.api.provider.ListProperty
import org.gradle.api.provider.MapProperty
import org.gradle.api.provider.Property
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The DSL values written as the members of the app config's JSON tree (A42: the DSL and the file give the same
// tree). A value the DSL leaves unset is absent from the tree, as a key the file leaves out; so is an empty list or
// map, since a Gradle list or map property cannot tell empty from unset.

/** The members of one JSON object, in the order the DSL adds them. */
internal class JsonMembers {
    private val members = linkedMapOf<String, JsonElement>()

    fun string(key: String, value: Property<String>) {
        value.orNull?.let { members[key] = JsonPrimitive(it) }
    }

    fun boolean(key: String, value: Property<Boolean>) {
        value.orNull?.let { members[key] = JsonPrimitive(it) }
    }

    fun strings(key: String, value: ListProperty<String>) {
        val items = value.orNull ?: return
        if (items.isNotEmpty()) members[key] = JsonArray(items.map(::JsonPrimitive))
    }

    fun stringMap(key: String, value: MapProperty<String, String>) {
        val entries = value.orNull ?: return
        if (entries.isNotEmpty()) members[key] = JsonObject(entries.mapValues { JsonPrimitive(it.value) })
    }

    /** A map of free values (`options`, `artefacts`), each converted by [dslValueToJson]; [where] names it in errors. */
    fun valueMap(key: String, value: MapProperty<String, Any>, where: String) {
        val entries = value.orNull ?: return
        if (entries.isNotEmpty()) members[key] = JsonObject(entries.mapValues { (name, item) -> dslValueToJson(item, "$where.$name") })
    }

    fun element(key: String, value: JsonElement?) {
        if (value != null) members[key] = value
    }

    fun isEmpty(): Boolean = members.isEmpty()

    fun toJson(): JsonObject = JsonObject(LinkedHashMap(members))

    fun toJsonOrNull(): JsonObject? = if (members.isEmpty()) null else toJson()
}

/**
 * A value of a free map as JSON: strings, booleans, numbers, lists and maps with string keys. Any other value is
 * refused naming its key, since the app config has no form for it.
 */
internal fun dslValueToJson(value: Any?, where: String): JsonElement = when (value) {
    null -> JsonNull
    is String -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Map<*, *> -> JsonObject(
        value.entries.associate { (key, item) ->
            if (key !is String) throw InvalidUserDataException("seampact { } $where has the key '$key', which is not a string; the app config's keys are strings.")
            key to dslValueToJson(item, "$where.$key")
        },
    )
    is Iterable<*> -> JsonArray(value.mapIndexed { index, item -> dslValueToJson(item, "$where[$index]") })
    else -> throw InvalidUserDataException(
        "seampact { } $where holds a ${value.javaClass.name}; the app config takes strings, booleans, numbers, lists and maps only.",
    )
}
