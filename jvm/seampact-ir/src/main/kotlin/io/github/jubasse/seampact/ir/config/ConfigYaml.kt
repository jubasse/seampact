package io.github.jubasse.seampact.ir.config

import java.math.BigInteger
import java.util.Collections
import java.util.IdentityHashMap
import java.nio.file.Files
import java.nio.file.Path
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.snakeyaml.engine.v2.api.LoadSettings
import org.snakeyaml.engine.v2.api.lowlevel.Compose
import org.snakeyaml.engine.v2.exceptions.MarkedYamlEngineException
import org.snakeyaml.engine.v2.exceptions.YamlEngineException
import org.snakeyaml.engine.v2.nodes.MappingNode
import org.snakeyaml.engine.v2.nodes.Node
import org.snakeyaml.engine.v2.nodes.ScalarNode
import org.snakeyaml.engine.v2.nodes.SequenceNode
import org.snakeyaml.engine.v2.nodes.Tag
import org.snakeyaml.engine.v2.schema.CoreSchema

// One `seampact.config.yaml` read with the Node CLI's YAML rules (ADR 0011 "The app config"): YAML 1.2 core
// schema, one document, unique keys, no merge keys, and the names that reach a JavaScript object's prototype
// refused, so a config one runner reads the other reads the same.

internal enum class ConfigKind(val text: String, val articled: String) {
    APP("app config", "an app config"),
    ROOT("root config", "a root config"),
}

internal sealed interface ConfigFileRead {
    data class Read(val tree: ConfigTree) : ConfigFileRead

    data class Refused(val problems: List<ConfigProblem>) : ConfigFileRead
}

// The config is trusted (A46), but a stray huge file is refused before it is parsed.
private const val MAX_CONFIG_BYTES = 1024 * 1024

private val RESERVED_KEYS = setOf("__proto__", "constructor", "prototype")

private val READ_TAGS = setOf(Tag.STR, Tag.INT, Tag.FLOAT, Tag.BOOL, Tag.NULL, Tag.SEQ, Tag.MAP)

private val SETTINGS: LoadSettings = LoadSettings.builder()
    .setSchema(CoreSchema())
    .setAllowDuplicateKeys(false)
    .setAllowRecursiveKeys(false)
    .setUseMarks(true)
    .build()

/** The file's YAML as a config tree: its presence, size, YAML syntax and reserved keys checked. */
internal fun readConfigFile(file: Path, displayName: String, kind: ConfigKind): ConfigFileRead {
    if (!Files.isRegularFile(file)) {
        val fix = if (kind == ConfigKind.APP) {
            "Create `seampact.config.yaml` in the app's directory, or pass its path with `--config`."
        } else {
            "Pass the path of the monorepo root's `seampact.config.yaml`, the one holding `apps`."
        }
        return refusedWith(ConfigProblem("config.file.missing", "No ${kind.text} at $displayName.", fix))
    }

    val size = Files.size(file)
    if (size > MAX_CONFIG_BYTES) {
        return refusedWith(
            ConfigProblem(
                "config.file.too-large",
                "$displayName holds $size bytes, over the $MAX_CONFIG_BYTES bytes ${kind.articled} may hold.",
                "Pass the path of the ${kind.text} itself.",
            ),
        )
    }

    return parseConfigText(String(Files.readAllBytes(file), Charsets.UTF_8), displayName)
}

/** [text] as a config tree, or the YAML and reserved-key problems refusing it. */
internal fun parseConfigText(text: String, displayName: String): ConfigFileRead {
    val root = try {
        Compose(SETTINGS).composeString(text.removePrefix(BYTE_ORDER_MARK)).orElse(null)
    } catch (error: MarkedYamlEngineException) {
        val at = error.problemMark.map { ":${it.line + 1}:${it.column + 1}" }.orElse("")
        return refusedWith(syntaxProblem(sentenceOf(error.problem ?: error.message.orEmpty()), "$displayName$at"))
    } catch (error: YamlEngineException) {
        return refusedWith(syntaxProblem(sentenceOf(error.message.orEmpty()), displayName))
    }

    val positions = HashMap<String, ConfigPosition>()
    val problems = mutableListOf<ConfigProblem>()
    val value = try {
        if (root == null) JsonNull else YamlTreeBuilder(displayName, positions, problems).build(root, emptyList())
    } catch (error: ExcessiveAliasesException) {
        val at = if (error.path.isEmpty()) "" else " ${formatKeyPath(error.path)}"
        return refusedWith(syntaxProblem("Excessive alias count indicates a resource exhaustion attack.", "$displayName$at"))
    }

    if (problems.isNotEmpty()) return ConfigFileRead.Refused(problems)

    return ConfigFileRead.Read(ConfigTree(value, displayName, positions))
}

private const val BYTE_ORDER_MARK = "﻿"

private fun refusedWith(problem: ConfigProblem): ConfigFileRead = ConfigFileRead.Refused(listOf(problem))

private fun syntaxProblem(message: String, where: String): ConfigProblem =
    ConfigProblem("config.yaml.syntax", message, "Correct the YAML at that position.", where)

private fun sentenceOf(text: String): String {
    val firstLine = text.lineSequence().first().trim()
    val capitalized = firstLine.replaceFirstChar { it.uppercaseChar() }

    return if (capitalized.endsWith(".")) capitalized else "$capitalized."
}

// `yaml`'s default `maxAliasCount`, so one config reads the same in both runners.
private const val MAX_ALIAS_COUNT = 100L

// `count` starts at one: `yaml` counts the anchor itself as a use.
private class AliasData(var count: Long = 1L, var aliasCount: Long = 0L)

private class ExcessiveAliasesException(val path: KeyPath) : RuntimeException("excessive aliases")

private class YamlTreeBuilder(
    private val displayName: String,
    private val positions: MutableMap<String, ConfigPosition>,
    private val problems: MutableList<ConfigProblem>,
) {
    // The collections being built, by identity: an alias inside the collection it names has no JSON value.
    private val open = Collections.newSetFromMap(IdentityHashMap<Node, Boolean>())

    // Each anchored node's value, the path it was first read at, and its alias budget data (`yaml`'s rule).
    private val anchoredValues = IdentityHashMap<Node, JsonElement>()
    private val firstPaths = IdentityHashMap<Node, KeyPath>()
    private val aliasData = IdentityHashMap<Node, AliasData>()

    fun build(node: Node, path: KeyPath): JsonElement {
        val anchoredValue = anchoredValues[node]
        if (anchoredValue != null) return aliasValue(node, anchoredValue, path)

        positions.putIfAbsent(formatKeyPath(path), positionOf(node))
        firstPaths.putIfAbsent(node, path)

        if (!open.add(node)) {
            problems += syntaxProblem("An alias refers to the collection that holds it; a config value cannot hold itself.", whereOf(node))
            return JsonNull
        }

        try {
            val value = buildOpen(node, path)
            if (node.anchor.isPresent) anchoredValues[node] = value

            return value
        } finally {
            open.remove(node)
        }
    }

    // An alias is the anchored value itself, never a copy, under the Node CLI's `yaml` budget: each use of an anchor
    // counts its uses times the aliases its value holds, and past MAX_ALIAS_COUNT the config is refused.
    private fun aliasValue(anchored: Node, value: JsonElement, path: KeyPath): JsonElement {
        val data = aliasData.getOrPut(anchored) { AliasData() }
        data.count += 1
        if (data.aliasCount == 0L) data.aliasCount = aliasCountOf(anchored, firstPaths.getValue(anchored))
        if (data.count * data.aliasCount > MAX_ALIAS_COUNT) throw ExcessiveAliasesException(path)

        return value
    }

    private fun aliasCountOf(node: Node, path: KeyPath): Long {
        if (firstPaths[node] != path) return aliasData[node]?.let { it.count * it.aliasCount } ?: 0L

        return when (node) {
            is SequenceNode -> node.value.withIndex().maxOfOrNull { (index, item) -> aliasCountOf(item, path + index) } ?: 0L
            is MappingNode -> node.value.maxOfOrNull { tuple ->
                val key = (tuple.keyNode as? ScalarNode)?.value ?: ""
                maxOf(aliasCountOf(tuple.keyNode, path), aliasCountOf(tuple.valueNode, path + key))
            } ?: 0L
            else -> 1L
        }
    }

    private fun buildOpen(node: Node, path: KeyPath): JsonElement {
        if (node.tag !in READ_TAGS) {
            problems += syntaxProblem("The tag '${node.tag.value}' is not one a config reads.", whereOf(node))
            return JsonNull
        }

        return when (node) {
            is MappingNode -> mapping(node, path)
            is SequenceNode -> JsonArray(node.value.mapIndexed { index, item -> build(item, path + index) })
            is ScalarNode -> scalar(node)
            else -> JsonNull
        }
    }

    private fun mapping(node: MappingNode, path: KeyPath): JsonObject {
        val members = LinkedHashMap<String, JsonElement>()

        for (tuple in node.value) {
            val keyNode = tuple.keyNode
            if (keyNode !is ScalarNode) {
                problems += syntaxProblem("A map key is a collection; a config's keys are plain names.", whereOf(keyNode))
                continue
            }

            val key = keyNode.value
            if (key in RESERVED_KEYS) {
                problems += ConfigProblem(
                    "config.key.reserved",
                    "The key '$key' is reserved: it would reach a JavaScript object's prototype.",
                    "Rename or remove the key.",
                    whereOf(keyNode),
                )
                continue
            }

            if (key in members) {
                problems += syntaxProblem("Map keys must be unique.", whereOf(keyNode))
                continue
            }

            val childPath = path + key
            positions[formatKeyPath(childPath)] = positionOf(keyNode)
            members[key] = build(tuple.valueNode, childPath)
        }

        return JsonObject(members)
    }

    private fun scalar(node: ScalarNode): JsonElement {
        val text = node.value

        return when (node.tag) {
            Tag.NULL -> JsonNull
            Tag.BOOL -> JsonPrimitive(text.lowercase() == "true")
            Tag.INT -> JsonPrimitive(integerOf(text))
            Tag.FLOAT -> JsonPrimitive(floatOf(text))
            else -> JsonPrimitive(text)
        }
    }

    private fun positionOf(node: Node): ConfigPosition =
        node.startMark.map { ConfigPosition(it.line + 1, it.column + 1) }.orElse(ConfigPosition(1, 1))

    private fun whereOf(node: Node): String = positionOf(node).let { "$displayName:${it.line}:${it.column}" }
}

// The core schema's integer forms: decimal, `0o` octal and `0x` hexadecimal.
private fun integerOf(text: String): BigInteger {
    val sign = if (text.startsWith("-")) BigInteger.ONE.negate() else BigInteger.ONE
    val digits = text.removePrefix("-").removePrefix("+")

    return when {
        digits.startsWith("0o") -> BigInteger(digits.substring(2), 8)
        digits.startsWith("0x") -> BigInteger(digits.substring(2), 16)
        else -> BigInteger(digits)
    }.multiply(sign)
}

private fun floatOf(text: String): Double = when (text.lowercase().removePrefix("+")) {
    ".inf" -> Double.POSITIVE_INFINITY
    "-.inf" -> Double.NEGATIVE_INFINITY
    ".nan" -> Double.NaN
    else -> text.toDouble()
}

