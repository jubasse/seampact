import { identifier, isReserved, splitName } from "@seampact/spec/naming";
import type {
  AliasDefinition,
  Definition,
  Member,
  NeutralModel,
  OpenEnumDefinition,
  StructDefinition,
  TypeRef,
  UnionDefinition,
} from "./model.ts";
import { type DefinitionNames, NameCollisionError } from "./names.ts";

// The Kotlin emitter (ADR 0010): kotlinx.serialization data classes, a sealed interface per tagged union with an
// `Unknown(tag, raw)` variant, an open enum as a sealed interface of its known values and `Unknown(value)`, and a
// type alias per scalar, reference or map definition. Unknown members are tolerated and dropped by `IrJson`.

export const KOTLIN_PACKAGE = "io.github.jubasse.seampact.ir.model";
export const KOTLIN_MODEL_DIRECTORY =
  "jvm/seampact-ir/src/main/kotlin/io/github/jubasse/seampact/ir/model";

/**
 * The names the generated files define beside the definitions, import, or take from `kotlin.*`: a definition
 * with one of these names would shadow it, so generation fails instead.
 */
export const KOTLIN_CLAIMED_NAMES = [
  "IrJson",
  "IrOptionalOpaqueSerializer",
  "IrUnionSerializer",
  "IrOpenEnumSerializer",
  "IrIntegerSerializer",
  "IrModelVersion",
  "EncodeDefault",
  "ExperimentalSerializationApi",
  "SerialName",
  "Serializable",
  "UseSerializers",
  "Json",
  "JsonElement",
  "JsonObject",
  "JsonPrimitive",
  "String",
  "Long",
  "Boolean",
  "List",
  "Map",
] as const;

const SERIALIZER_SUFFIX = "Serializer";
const UNKNOWN_VARIANT = "Unknown";
const RESERVED_ESCAPE = "_";
const INDENT = "    ";

export interface KotlinContext {
  model: NeutralModel;
  names: readonly DefinitionNames[];
  irVersion: number;
  irRevision: number;
  regenerateCommand: string;
}

/** The Kotlin model files, keyed by repository-relative path. */
export function emitKotlin(context: KotlinContext): Map<string, string> {
  const typeNames = new Map(context.names.map((entry) => [entry.definition, entry.names.kotlin]));
  const emitter = new KotlinEmitter(typeNames);
  assertTopLevelNamesDistinct(context.model, typeNames);

  const byFile = new Map<string, Definition[]>();
  for (const definition of context.model.definitions) {
    const list = byFile.get(definition.file) ?? [];
    list.push(definition);
    byFile.set(definition.file, list);
  }

  const files = new Map<string, string>();
  for (const [schemaFile, definitions] of [...byFile].sort(([left], [right]) =>
    left < right ? -1 : 1,
  )) {
    const header = headerLines(`packages/spec/schemas/ir/${schemaFile}.schema.json`, context);
    const body = definitions.flatMap((definition) => emitter.definition(definition));
    files.set(
      `${KOTLIN_MODEL_DIRECTORY}/${kotlinFileName(schemaFile)}`,
      fileText(header, MODEL_FILE_ANNOTATIONS, MODEL_IMPORTS, body),
    );
  }

  const supportHeader = headerLines("scripts/ir-models/kotlin.ts", context);
  files.set(
    `${KOTLIN_MODEL_DIRECTORY}/IrSerialization.kt`,
    fileText(supportHeader, SUPPORT_FILE_ANNOTATIONS, SUPPORT_IMPORTS, supportLines(context)),
  );
  return files;
}

function kotlinFileName(schemaFile: string): string {
  return `${identifier({ segments: splitName(schemaFile), role: "schema" }, "kotlin")}.kt`;
}

function headerLines(source: string, context: KotlinContext): string[] {
  return [
    `// Generated from ${source} by scripts/ir-models for IR revision ${context.irRevision}. Do not edit.`,
    `// Regenerate: ${context.regenerateCommand}`,
  ];
}

function fileText(
  header: string[],
  fileAnnotations: readonly string[],
  imports: readonly string[],
  body: string[],
): string {
  const lines = [
    ...header,
    ...fileAnnotations,
    "",
    `package ${KOTLIN_PACKAGE}`,
    "",
    ...imports.map((name) => `import ${name}`),
    "",
    ...body,
  ];
  while (lines.at(-1) === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

// `@EncodeDefault` writes a variant's fixed tag; every `Long` reads through the IR integer serializer.
const MODEL_FILE_ANNOTATIONS = [
  "@file:OptIn(ExperimentalSerializationApi::class)",
  "@file:UseSerializers(IrIntegerSerializer::class)",
];

const SUPPORT_FILE_ANNOTATIONS = ["@file:OptIn(ExperimentalSerializationApi::class)"];

const MODEL_IMPORTS = [
  "kotlinx.serialization.EncodeDefault",
  "kotlinx.serialization.ExperimentalSerializationApi",
  "kotlinx.serialization.SerialName",
  "kotlinx.serialization.Serializable",
  "kotlinx.serialization.UseSerializers",
  "kotlinx.serialization.json.Json",
  "kotlinx.serialization.json.JsonElement",
  "kotlinx.serialization.json.JsonObject",
  "kotlinx.serialization.json.JsonPrimitive",
];

const SUPPORT_IMPORTS = [
  "kotlinx.serialization.ExperimentalSerializationApi",
  "kotlinx.serialization.KSerializer",
  "kotlinx.serialization.SerializationException",
  "kotlinx.serialization.descriptors.PrimitiveKind",
  "kotlinx.serialization.descriptors.PrimitiveSerialDescriptor",
  "kotlinx.serialization.descriptors.SerialDescriptor",
  "kotlinx.serialization.descriptors.nullable",
  "kotlinx.serialization.encoding.Decoder",
  "kotlinx.serialization.encoding.Encoder",
  "kotlinx.serialization.json.Json",
  "kotlinx.serialization.json.JsonDecoder",
  "kotlinx.serialization.json.JsonElement",
  "kotlinx.serialization.json.JsonEncoder",
  "kotlinx.serialization.json.JsonNull",
  "kotlinx.serialization.json.JsonObject",
  "kotlinx.serialization.json.JsonPrimitive",
];

function supportLines(context: KotlinContext): string[] {
  return `/** The IR versions this model was generated for (ADR 0005 section 2). */
public object IrModelVersion {
    public const val IR_VERSION: Long = ${context.irVersion}
    public const val IR_REVISION: Long = ${context.irRevision}
}

/** The JSON configuration of the IR model: unknown members are tolerated and dropped (ADR 0005 section 3). */
public val IrJson: Json = Json { ignoreUnknownKeys = true }

/**
 * An IR integer as a \`Long\`. An integral number written with a fraction (\`2.0\`), which JSON Schema counts as
 * an integer, reads as that integer; any other value is an error naming it.
 */
internal object IrIntegerSerializer : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("${KOTLIN_PACKAGE}.IrInteger", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long {
        val element = jsonDecoder(decoder, "an integer").decodeJsonElement()
        val number = (element as? JsonPrimitive)?.takeIf { !it.isString }?.content?.toBigDecimalOrNull()
            ?: throw SerializationException("expected an integer, got $element")
        try {
            return number.longValueExact()
        } catch (error: ArithmeticException) {
            throw SerializationException("expected an integer within 64 bits, got $element", error)
        }
    }

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }
}

/** An optional opaque member: absent is \`null\`, a JSON \`null\` is [JsonNull]. */
internal object IrOptionalOpaqueSerializer : KSerializer<JsonElement?> {
    override val descriptor: SerialDescriptor = JsonElement.serializer().descriptor.nullable

    override fun deserialize(decoder: Decoder): JsonElement? = jsonDecoder(decoder, "an opaque value").decodeJsonElement()

    override fun serialize(encoder: Encoder, value: JsonElement?) {
        jsonEncoder(encoder, "an opaque value").encodeJsonElement(value ?: JsonNull)
    }
}

/** A tagged union: the tag member picks the variant; an unknown tag is kept as the union's \`Unknown\` variant. */
internal abstract class IrUnionSerializer<T : Any>(
    private val union: String,
    private val tagMember: String,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor =
        SerialDescriptor("${KOTLIN_PACKAGE}.$union", JsonObject.serializer().descriptor)

    protected abstract fun decodeKnown(json: Json, tag: String, element: JsonObject): T?

    protected abstract fun unknown(tag: String, element: JsonObject): T

    protected abstract fun encode(json: Json, value: T): JsonElement

    override fun deserialize(decoder: Decoder): T {
        val jsonDecoder = jsonDecoder(decoder, union)
        val element = jsonDecoder.decodeJsonElement() as? JsonObject
            ?: throw SerializationException("$union: expected a JSON object")
        val tag = (element[tagMember] as? JsonPrimitive)?.takeIf { it.isString }?.content
            ?: throw SerializationException("$union: the tag member '$tagMember' is missing or not a string")
        return decodeKnown(jsonDecoder.json, tag, element) ?: unknown(tag, element)
    }

    override fun serialize(encoder: Encoder, value: T) {
        val jsonEncoder = jsonEncoder(encoder, union)
        jsonEncoder.encodeJsonElement(encode(jsonEncoder.json, value))
    }
}

/** An open enum: a known value maps to its constant, any other string to the enum's \`Unknown\`. */
internal abstract class IrOpenEnumSerializer<T : Any>(
    enumName: String,
    private val of: (String) -> T,
    private val valueOf: (T) -> String,
) : KSerializer<T> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("${KOTLIN_PACKAGE}.$enumName", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): T = of(decoder.decodeString())

    override fun serialize(encoder: Encoder, value: T) {
        encoder.encodeString(valueOf(value))
    }
}

private fun jsonDecoder(decoder: Decoder, what: String): JsonDecoder =
    decoder as? JsonDecoder ?: throw SerializationException("$what is read from JSON only, through IrJson")

private fun jsonEncoder(encoder: Encoder, what: String): JsonEncoder =
    encoder as? JsonEncoder ?: throw SerializationException("$what is written to JSON only, through IrJson")`.split(
    "\n",
  );
}

function assertTopLevelNamesDistinct(model: NeutralModel, typeNames: Map<string, string>): void {
  const owners = new Map<string, string>(
    KOTLIN_CLAIMED_NAMES.map((name) => [name, `the name ${name} the generated files use`]),
  );
  const claim = (name: string, owner: string): void => {
    const previous = owners.get(name);
    if (previous !== undefined)
      throw new NameCollisionError(`${owner}: its Kotlin name ${name} collides with ${previous}`);
    owners.set(name, owner);
  };

  for (const definition of model.definitions) {
    const name = kotlinTypeName(typeNames, definition.name);
    claim(name, definition.name);
    if (definition.kind === "union" || definition.kind === "openEnum")
      claim(`${name}${SERIALIZER_SUFFIX}`, `${definition.name}'s serializer`);
  }
}

function kotlinTypeName(typeNames: Map<string, string>, definition: string): string {
  const name = typeNames.get(definition);
  if (name === undefined) throw new Error(`${definition}: no Kotlin name was computed for it`);
  return name;
}

/** A member's Kotlin property name: its IR name, escaped when it is a Kotlin keyword (`in` becomes `in_`). */
function propertyName(member: string): string {
  return isReserved(member, "kotlin", "member") ? `${member}${RESERVED_ESCAPE}` : member;
}

function serialNameAnnotation(member: string): string {
  return propertyName(member) === member ? "" : `@SerialName("${member}") `;
}

function kdoc(description: string | undefined, indent: string): string[] {
  if (description === undefined) return [];
  // Kotlin block comments nest, so both delimiters are neutralised.
  const text = description.replaceAll("*/", "*&#47;").replaceAll("/*", "&#47;*");
  return [`${indent}/** ${text} */`];
}

function definitionDoc(definition: Definition): string | undefined {
  if (!definition.mustAct) return definition.description;
  const unknown = definition.kind === "union" ? "an unknown tag" : "an unknown value";
  const rule = `Must act: ${unknown} makes the IR invalid for every reader.`;
  return definition.description === undefined ? rule : `${definition.description} ${rule}`;
}

class KotlinEmitter {
  private readonly typeNames: Map<string, string>;

  constructor(typeNames: Map<string, string>) {
    this.typeNames = typeNames;
  }

  definition(definition: Definition): string[] {
    switch (definition.kind) {
      case "struct":
        return this.struct(definition);
      case "union":
        return this.union(definition);
      case "openEnum":
        return this.openEnum(definition);
      case "alias":
        return this.alias(definition);
      case "extensionSlot":
        return [
          ...kdoc(definitionDoc(definition), ""),
          `public typealias ${this.typeName(definition.name)} = JsonObject`,
          "",
        ];
    }
  }

  private typeName(definition: string): string {
    return kotlinTypeName(this.typeNames, definition);
  }

  private type(type: TypeRef): string {
    switch (type.kind) {
      case "named":
        return this.typeName(type.definition);
      case "string":
        return "String";
      case "integer":
        return "Long";
      case "boolean":
        return "Boolean";
      case "opaque":
        return "JsonElement";
      case "array":
        return `List<${this.type(type.items)}>`;
      case "map":
        return `Map<${this.type(type.keys)}, ${this.type(type.values)}>`;
    }
  }

  private alias(definition: AliasDefinition): string[] {
    return [
      ...kdoc(definitionDoc(definition), ""),
      `public typealias ${this.typeName(definition.name)} = ${this.type(definition.target)}`,
      "",
    ];
  }

  private struct(definition: StructDefinition): string[] {
    const name = this.typeName(definition.name);
    const parameters = definition.members.flatMap((member) => this.parameter(definition, member));
    const supertype =
      definition.variantOf === undefined ? "" : ` : ${this.typeName(definition.variantOf.union)}`;
    const tag = definition.variantOf;
    if (tag === undefined)
      return [
        ...kdoc(definitionDoc(definition), ""),
        "@Serializable",
        `public data class ${name}(`,
        ...parameters,
        ")",
        "",
      ];

    // The tag is fixed: a variant decoded on its own (`Scalar.type`) or built by hand cannot carry another one.
    const property = propertyName(tag.member);
    return [
      ...kdoc(definitionDoc(definition), ""),
      "@Serializable",
      `public data class ${name}(`,
      ...parameters,
      `)${supertype} {`,
      `${INDENT}init {`,
      `${INDENT}${INDENT}require(${property} == ${kotlinString(tag.value)}) { ${kotlinString(`${definition.name}: ${tag.member} is "${tag.value}", got "`)} + ${property} + ${kotlinString('"')} }`,
      `${INDENT}}`,
      "}",
      "",
    ];
  }

  private parameter(definition: StructDefinition, member: Member): string[] {
    const property = propertyName(member.name);
    const serialName = serialNameAnnotation(member.name);
    const doc = kdoc(member.description, INDENT);

    const tag = definition.variantOf;
    if (tag !== undefined && tag.member === member.name) {
      return [
        ...doc,
        `${INDENT}${serialName}@EncodeDefault public override val ${property}: String = ${kotlinString(tag.value)},`,
      ];
    }

    const type = this.type(member.type);
    if (member.required) return [...doc, `${INDENT}${serialName}public val ${property}: ${type},`];
    if (member.type.kind === "opaque") {
      return [
        ...doc,
        `${INDENT}${serialName}@Serializable(with = IrOptionalOpaqueSerializer::class) public val ${property}: JsonElement? = null,`,
      ];
    }
    return [...doc, `${INDENT}${serialName}public val ${property}: ${type}? = null,`];
  }

  private union(definition: UnionDefinition): string[] {
    const name = this.typeName(definition.name);
    const serializer = `${name}${SERIALIZER_SUFFIX}`;
    const tag = propertyName(definition.tag);
    const knownTags = definition.variants
      .map((variant) => kotlinString(variant.tagValue))
      .join(", ");

    const decodeCases = definition.variants.map((variant) => {
      const variantName = this.typeName(variant.definition);
      return `${INDENT}${INDENT}${kotlinString(variant.tagValue)} -> json.decodeFromJsonElement(${variantName}.serializer(), element)`;
    });
    const encodeCases = definition.variants.map((variant) => {
      const variantName = this.typeName(variant.definition);
      return `${INDENT}${INDENT}is ${variantName} -> json.encodeToJsonElement(${variantName}.serializer(), value)`;
    });

    return [
      ...kdoc(definitionDoc(definition), ""),
      `@Serializable(with = ${serializer}::class)`,
      `public sealed interface ${name} {`,
      `${INDENT}/** The tag member '${definition.tag}': it picks the variant. */`,
      `${INDENT}public val ${tag}: String`,
      "",
      `${INDENT}/** A variant this IR revision does not know, kept raw; its tag is the raw object's. */`,
      `${INDENT}public data class ${UNKNOWN_VARIANT}(override val ${tag}: String, public val raw: JsonObject) : ${name} {`,
      `${INDENT}${INDENT}init {`,
      `${INDENT}${INDENT}${INDENT}require(${tag} !in setOf(${knownTags})) { ${kotlinString(`${definition.name}.Unknown: "`)} + ${tag} + ${kotlinString(`" is a known ${definition.tag}`)} }`,
      `${INDENT}${INDENT}${INDENT}require(raw[${kotlinString(definition.tag)}] == JsonPrimitive(${tag})) { ${kotlinString(`${definition.name}.Unknown: raw's ${definition.tag} is not "`)} + ${tag} + ${kotlinString('"')} }`,
      `${INDENT}${INDENT}}`,
      `${INDENT}}`,
      "}",
      "",
      `internal object ${serializer} : IrUnionSerializer<${name}>(${kotlinString(definition.name)}, ${kotlinString(definition.tag)}) {`,
      `${INDENT}override fun decodeKnown(json: Json, tag: String, element: JsonObject): ${name}? = when (tag) {`,
      ...decodeCases,
      `${INDENT}${INDENT}else -> null`,
      `${INDENT}}`,
      "",
      `${INDENT}override fun unknown(tag: String, element: JsonObject): ${name} = ${name}.${UNKNOWN_VARIANT}(tag, element)`,
      "",
      `${INDENT}override fun encode(json: Json, value: ${name}): JsonElement = when (value) {`,
      ...encodeCases,
      `${INDENT}${INDENT}is ${name}.${UNKNOWN_VARIANT} -> value.raw`,
      `${INDENT}}`,
      "}",
      "",
    ];
  }

  private openEnum(definition: OpenEnumDefinition): string[] {
    const name = this.typeName(definition.name);
    const serializer = `${name}${SERIALIZER_SUFFIX}`;
    const constants = enumConstants(definition);

    return [
      ...kdoc(definitionDoc(definition), ""),
      `@Serializable(with = ${serializer}::class)`,
      `public sealed interface ${name} {`,
      `${INDENT}public val value: String`,
      "",
      ...constants.map(
        ({ constant, value }) =>
          `${INDENT}public data object ${constant} : ${name} { override val value: String = ${kotlinString(value)} }`,
      ),
      "",
      `${INDENT}/** A value this IR revision does not know; a known value is always its constant. */`,
      `${INDENT}public data class ${UNKNOWN_VARIANT}(override val value: String) : ${name} {`,
      `${INDENT}${INDENT}init {`,
      `${INDENT}${INDENT}${INDENT}require(${name}.known.none { it.value == value }) { ${kotlinString(`${definition.name}.Unknown: "`)} + value + ${kotlinString(`" is a known value`)} }`,
      `${INDENT}${INDENT}}`,
      `${INDENT}}`,
      "",
      `${INDENT}public companion object {`,
      `${INDENT}${INDENT}/** The values this IR revision knows, in the schema's order. */`,
      `${INDENT}${INDENT}public val known: List<${name}> by lazy { listOf(${constants.map(({ constant }) => constant).join(", ")}) }`,
      "",
      `${INDENT}${INDENT}public fun of(value: String): ${name} = when (value) {`,
      ...constants.map(
        ({ constant, value }) => `${INDENT}${INDENT}${INDENT}${kotlinString(value)} -> ${constant}`,
      ),
      `${INDENT}${INDENT}${INDENT}else -> ${UNKNOWN_VARIANT}(value)`,
      `${INDENT}${INDENT}}`,
      `${INDENT}}`,
      "}",
      "",
      `internal object ${serializer} : IrOpenEnumSerializer<${name}>(${kotlinString(definition.name)}, ${name}::of, ${name}::value)`,
      "",
    ];
  }
}

/** A Kotlin string literal: JSON escapes, and `$` escaped so it never starts a template. */
function kotlinString(value: string): string {
  return JSON.stringify(value).replaceAll("$", "\\$");
}

/** The constant of each known value: the ADR 0007 enum member identifier (`application/json` gives `APPLICATION_JSON`). */
function enumConstants(definition: OpenEnumDefinition): { constant: string; value: string }[] {
  const seen = new Map<string, string>();
  return definition.known.map((value) => {
    const segments = splitName(value);
    if (segments.length === 0)
      throw new NameCollisionError(
        `${definition.name}: the known value ${JSON.stringify(value)} has no name segment`,
      );
    const constant = identifier({ segments, role: "enumMember" }, "kotlin");
    if (constant === undefined)
      throw new Error(`${definition.name}: Kotlin has no enum member identifier`);
    const previous = seen.get(constant);
    if (previous !== undefined) {
      throw new NameCollisionError(
        `${definition.name}: the known values ${JSON.stringify(previous)} and ${JSON.stringify(value)} both give the Kotlin constant ${constant}`,
      );
    }
    seen.set(constant, value);
    return { constant, value };
  });
}
