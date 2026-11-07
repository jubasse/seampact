import { below, type IrLocation, schemaLocation } from "@seampact/codegen-core";
import {
  type ArrayTypeUse,
  type Docs,
  type Enum,
  type EnumTypeUse,
  isKnownVariant,
  type KnownSchema,
  type KnownTypeUse,
  type MapSchema,
  type ObjectSchema,
  type Property,
  type Refinements,
  type RefTypeUse,
  type ScalarTypeUse,
  type TypeUse,
  type UnionSchema,
} from "@seampact/spec/ir";
import {
  type EmitContext,
  reasonValue,
  referenceComponent,
  refuseInconsistent,
  refuseNotEmitted,
  refuseUnknown,
  type SchemaVariant,
  writeConsumerExtensions,
  writeExtension,
} from "./emit-context.js";
import type { ExtensionName } from "./extension-names.js";
import {
  copyJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
  setDefined,
} from "./json-value.js";

// The schema rows of ADR 0004 section 12: a type use as a JSON Schema, the named schemas and enums as components,
// and their marks (sensitive, opaque, open enums, header-tagged unions, int64 and decimal refinements).

const INPUT_DIRECTION = "input";
const OUTPUT_DIRECTION = "output";
const INPUT_COMPONENT_SUFFIX = ".input";
const INT64_FORMAT = "int64";
const DECIMAL_FORMAT = "decimal";

export const PASSWORD_FORMAT = "password";
const INT64_PATTERN = "^-?(0|[1-9][0-9]*)$";
const DECIMAL_PATTERN = "^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$";
const INTEGER_LITERAL = /^-?[0-9]+$/;
const NULL_TYPE = "null";

/** The schema of a type use; `variant: input` points nested objects at their strict twins. */
export function typeUseSchema(
  context: EmitContext,
  use: TypeUse,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  if (!isKnownVariant("TypeUse", use)) {
    refuseUnknown(context, below(location, "kind"), use.kind);

    return {};
  }

  const schema = knownUseSchema(context, use, variant, location);

  writeDocs(schema, use.docs);

  if (use.examples !== undefined) {
    schema.examples = use.examples.map((example) => wireValue(context, use, example));
  }

  return use.nullable === true ? nullableSchema(schema) : schema;
}

function knownUseSchema(
  context: EmitContext,
  use: KnownTypeUse,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  switch (use.kind) {
    case "ref":
      return refSchema(context, use, variant, location);
    case "opaque": {
      const schema: JsonObject = {};

      writeExtension(context, schema, "opaque", reasonValue(context, use.reason));

      return schema;
    }

    case "file":
      return fileSchema(context, use.media, use.maxSizeBytes);
    case "enum":
      return enumUseSchema(context, use, variant, location);
    case "scalar":
      return scalarSchema(context, use, variant, location);
    case "array":
      return arraySchema(context, use, variant, location);
  }
}

/** A multipart file field or a download: a string of the media type, its size bound as an extension. */
export function fileSchema(
  context: EmitContext,
  media: readonly string[],
  maxSizeBytes?: number,
): JsonObject {
  const schema: JsonObject = { type: "string" };

  if (media.length === 1) schema.contentMediaType = media[0] ?? "";

  if (maxSizeBytes !== undefined) writeExtension(context, schema, "max-size", maxSizeBytes);

  return schema;
}

function refSchema(
  context: EmitContext,
  use: RefTypeUse,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const named = context.ir.schemas[use.schema];

  if (named === undefined) {
    refuseInconsistent(
      context,
      "schema.missing",
      `The schema '${use.schema}' is not declared`,
      location,
    );

    return {};
  }

  // An ignoring or keeping use accepts unknown keys, so it reads the shared component even under strict input.
  return schemaReference(
    context,
    use.schema,
    variant === "input" && refusesUnknownKeys(use) ? "input" : "shared",
  );
}

/** Whether a type use refuses unknown keys: any use but a reference that ignores or keeps them. */
export function refusesUnknownKeys(use: TypeUse): boolean {
  const policy = use.kind === "ref" && "unknownKeys" in use ? use.unknownKeys?.policy : undefined;

  return policy === undefined || policy === "refuse";
}

/** A `$ref` to a named schema, the strict twin when the schema is an input. */
export function schemaReference(
  context: EmitContext,
  schemaId: string,
  variant: SchemaVariant,
): JsonObject {
  const named = context.ir.schemas[schemaId];
  const shared = referenceComponent(context, {
    key: schemaId,
    build: (buildContext) => namedSchemaComponent(buildContext, schemaId, "shared"),
  });
  const strict =
    variant === "input" &&
    context.options.inputSchemas === "strict" &&
    named !== undefined &&
    isKnownVariant("Schema", named) &&
    named.directions.includes(INPUT_DIRECTION);

  // The strict twin is a second component: the shared one stays, as every other option leaves it.
  if (!strict) return shared;

  return referenceComponent(context, {
    key: `${schemaId}${INPUT_COMPONENT_SUFFIX}`,
    build: (buildContext) => namedSchemaComponent(buildContext, schemaId, "input"),
  });
}

function enumUseSchema(
  context: EmitContext,
  use: EnumTypeUse,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const declared = context.ir.enums[use.enum];

  if (declared === undefined) {
    refuseInconsistent(context, "enum.missing", `The enum '${use.enum}' is not declared`, location);

    return {};
  }

  const reference = referenceComponent(context, {
    key: use.enum,
    build: (buildContext) => enumComponent(buildContext, declared),
  });

  if (use.narrowedTo !== undefined) return { ...reference, enum: [...use.narrowedTo.values] };

  // Strict input closes an open enum at its input uses, as the boundary refuses an unknown value there.
  const strictInput = variant === "input" && context.options.inputSchemas === "strict";

  if (strictInput && isOpenEnum(context, declared)) {
    return { ...reference, enum: [...declared.values] };
  }

  return reference;
}

function isOpenEnum(context: EmitContext, declared: Enum): boolean {
  return (
    context.ir.api.wire.outputEnums === "open" && declared.directions.includes(OUTPUT_DIRECTION)
  );
}

/** An enum component: closed, or open with its fallback under `api.wire.outputEnums: open`. */
function enumComponent(context: EmitContext, declared: Enum): JsonObject {
  const schema: JsonObject = { type: "string" };
  const open = isOpenEnum(context, declared);

  if (open) {
    writeExtension(context, schema, "enum", [...declared.values]);

    if (declared.fallback !== undefined) {
      writeExtension(context, schema, "enum-fallback", declared.fallback);
    }
  } else {
    schema.enum = [...declared.values];
  }

  writeDocs(schema, declared.docs);

  return schema;
}

function scalarSchema(
  context: EmitContext,
  use: ScalarTypeUse,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  if (use.format === INT64_FORMAT && context.ir.api.wire.int64 === "string") {
    return stringNumberSchema(context, INT64_FORMAT, INT64_PATTERN, use.refinements);
  }

  if (use.format === DECIMAL_FORMAT) {
    return stringNumberSchema(context, DECIMAL_FORMAT, DECIMAL_PATTERN, use.refinements);
  }

  const schema: JsonObject = { type: use.type };

  setDefined(schema, "format", use.sensitive === true ? PASSWORD_FORMAT : use.format);
  writeLengthRefinements(schema, use.refinements);
  writeNumericRefinements(schema, use.refinements);

  if (use.content !== undefined) {
    schema.contentMediaType = use.content.media;
    schema.contentSchema = typeUseSchema(
      context,
      use.content.schema,
      variant,
      below(location, "content", "schema"),
    );
  }

  return schema;
}

// `int64` and `decimal` travel as strings, so their numeric refinements become extensions (ADR 0003 section 8).
function stringNumberSchema(
  context: EmitContext,
  format: string,
  pattern: string,
  refinements: Refinements,
): JsonObject {
  const schema: JsonObject = { type: "string", format, pattern };
  const numeric: [ExtensionName, string | undefined][] = [
    ["minimum", refinements.minimum],
    ["maximum", refinements.maximum],
    ["exclusiveMinimum", refinements.exclusiveMinimum],
    ["exclusiveMaximum", refinements.exclusiveMaximum],
    ["multipleOf", refinements.multipleOf],
  ];

  for (const [name, literal] of numeric) {
    if (literal !== undefined) writeExtension(context, schema, name, literal);
  }

  return schema;
}

function writeLengthRefinements(schema: JsonObject, refinements: Refinements): void {
  setDefined(schema, "minLength", refinements.minLength);
  setDefined(schema, "maxLength", refinements.maxLength);
  setDefined(schema, "pattern", refinements.pattern?.normalized);
}

function writeNumericRefinements(schema: JsonObject, refinements: Refinements): void {
  setDefined(schema, "minimum", numberLiteral(refinements.minimum));
  setDefined(schema, "maximum", numberLiteral(refinements.maximum));
  setDefined(schema, "exclusiveMinimum", numberLiteral(refinements.exclusiveMinimum));
  setDefined(schema, "exclusiveMaximum", numberLiteral(refinements.exclusiveMaximum));
  setDefined(schema, "multipleOf", numberLiteral(refinements.multipleOf));
}

/** A decimal literal as a JSON number; an integer outside the double's exact range stays exact as a bigint. */
export function numberLiteral(literal: string | undefined): number | bigint | undefined {
  if (literal === undefined) return undefined;

  const value = Number(literal);

  if (INTEGER_LITERAL.test(literal) && !Number.isSafeInteger(value)) return BigInt(literal);

  return value;
}

function arraySchema(
  context: EmitContext,
  use: ArrayTypeUse,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const schema: JsonObject = {
    type: "array",
    items: typeUseSchema(context, use.items, variant, below(location, "items")),
  };

  setDefined(schema, "minItems", use.minItems);
  setDefined(schema, "maxItems", use.maxItems);

  return schema;
}

/** A value of a use as the wire carries it: an `int64` string is a JSON number under `api.wire.int64: number`. */
export function wireValue(context: EmitContext, use: TypeUse, value: unknown): JsonValue {
  const int64Number =
    use.kind === "scalar" &&
    "format" in use &&
    use.format === INT64_FORMAT &&
    context.ir.api.wire.int64 === "number" &&
    typeof value === "string" &&
    INTEGER_LITERAL.test(value);

  return int64Number ? (numberLiteral(value) ?? null) : copyJsonValue(value);
}

/**
 * A schema that also accepts `null`, spelled as ADR 0003 states: OpenAPI 3.1's type array, `oneOf` with `null`
 * around a reference or another schema without one type, and an opaque schema as it is, since it accepts `null`.
 */
export function nullableSchema(schema: JsonObject): JsonObject {
  if (acceptsAnyValue(schema)) return schema;

  if (typeof schema.type === "string" && schema.const === undefined) {
    const nullable: JsonObject = { ...schema, type: [schema.type, NULL_TYPE] };

    if (Array.isArray(schema.enum)) nullable.enum = [...schema.enum, null];

    return nullable;
  }

  return { oneOf: [schema, { type: NULL_TYPE }] };
}

const ANNOTATION_KEYWORDS: readonly string[] = ["title", "description", "examples", "default"];

// A schema with annotations and extensions only asserts nothing, so it already accepts `null`.
function acceptsAnyValue(schema: JsonObject): boolean {
  return Object.keys(schema).every(
    (keyword) => ANNOTATION_KEYWORDS.includes(keyword) || keyword.startsWith("x-"),
  );
}

/** A schema's or a use's docs: `title` from the summary, `description` from the description. */
export function writeDocs(schema: JsonObject, docs: Docs | undefined): void {
  setDefined(schema, "title", docs?.summary);
  setDefined(schema, "description", docs?.description);
}

/** The component of a named schema, or its strict twin with `additionalProperties: false` on its objects. */
export function namedSchemaComponent(
  context: EmitContext,
  schemaId: string,
  variant: SchemaVariant,
): JsonObject {
  const named = context.ir.schemas[schemaId];
  const location = schemaLocation(schemaId);

  if (named === undefined) {
    refuseInconsistent(
      context,
      "schema.missing",
      `The schema '${schemaId}' is not declared`,
      location,
    );

    return {};
  }

  if (!isKnownVariant("Schema", named)) {
    refuseUnknown(context, below(location, "kind"), named.kind);

    return {};
  }

  const schema = knownSchemaComponent(context, named, variant, location);

  if (named.deprecated === true) schema.deprecated = true;

  if (named.examples.length > 0) schema.examples = named.examples.map(copyJsonValue);

  writeConsumerExtensions(schema, named.extensions);

  return schema;
}

function knownSchemaComponent(
  context: EmitContext,
  named: KnownSchema,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  switch (named.kind) {
    case "object":
      return objectSchema(context, named, variant, location);
    case "map":
      return mapSchema(context, named, variant, location);
    case "union":
      return unionSchema(context, named, variant, location);
  }
}

/** An object schema; its strict twin refuses unknown keys. */
export function objectSchema(
  context: EmitContext,
  named: ObjectSchema,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const schema: JsonObject = { type: "object" };

  writeDocs(schema, named.docs);

  const properties: JsonObject = {};

  named.properties.forEach((property, index) => {
    properties[property.name] = propertySchema(
      context,
      property,
      variant,
      below(location, "properties", index),
    );
  });

  schema.properties = properties;

  const required = named.properties
    .filter((property) => !property.optional)
    .map((property) => property.name);

  if (required.length > 0) schema.required = required;

  if (variant === "input") schema.additionalProperties = false;

  return schema;
}

/** A property: its type, then its marks, docs, default, examples and consumer extensions. */
export function propertySchema(
  context: EmitContext,
  property: Property,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const typeSchema = typeUseSchema(context, property.type, variant, below(location, "type"));

  if (property.sensitive) markSensitive(context, typeSchema, below(location, "sensitive"));

  const schema = property.nullable ? nullableSchema(typeSchema) : typeSchema;

  writeDocs(schema, property.docs);

  if (property.default !== undefined)
    schema.default = wireValue(context, property.type, property.default);

  if (property.examples !== undefined) {
    schema.examples = property.examples.map((example) =>
      wireValue(context, property.type, example),
    );
  }

  if (property.deprecated) schema.deprecated = true;

  writeConsumerExtensions(schema, property.extensions);

  return schema;
}

/** Marks a sensitive scalar `format: password`; a sensitive value of another shape is refused by name. */
export function markSensitive(
  context: EmitContext,
  schema: JsonObject,
  location: IrLocation,
): void {
  if (typeof schema.type === "string") {
    schema.format = PASSWORD_FORMAT;

    return;
  }

  refuseNotEmitted(context, "sensitive.shape", "A sensitive value that is not a scalar", location);
}

function mapSchema(
  context: EmitContext,
  named: MapSchema,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const schema: JsonObject = { type: "object" };

  writeDocs(schema, named.docs);

  if (named.keys !== undefined) {
    schema.propertyNames = typeUseSchema(context, named.keys, variant, below(location, "keys"));
  }

  schema.additionalProperties = typeUseSchema(
    context,
    named.values,
    variant,
    below(location, "values"),
  );

  return schema;
}

// A body-tagged variant holds no tag property (ADR 0004 section 5): each branch adds it as a required constant
// inside the union only, and the discriminator maps each tag to its variant (ADR 0003 section 3). A header-tagged
// union names its header in `x-seampact-discriminator`.
function unionSchema(
  context: EmitContext,
  named: UnionSchema,
  variant: SchemaVariant,
  location: IrLocation,
): JsonObject {
  const schema: JsonObject = {};

  writeDocs(schema, named.docs);

  const tag = named.tag;

  if (!isKnownVariant("UnionTag", tag)) {
    refuseUnknown(context, below(location, "tag", "in"), tag.in);

    return schema;
  }

  const branches = named.variants.map((unionVariant) => {
    const branch =
      tag.in === "body"
        ? bodyTaggedBranch(context, unionVariant.schema, tag.property, unionVariant.tag, variant)
        : schemaReference(context, unionVariant.schema, variant);

    setDefined(branch, "description", unionVariant.docs?.description ?? unionVariant.docs?.summary);

    return branch;
  });

  schema.oneOf = branches;

  if (tag.in === "header") {
    writeExtension(context, schema, "discriminator", { in: "header", name: tag.name });

    return schema;
  }

  // The mapping names each tag's shared variant, under strict input too: the variant's strict twin refuses the tag
  // member, which only the union's branch declares.
  const mapping: JsonObject = {};

  for (const unionVariant of named.variants) {
    const reference = schemaReference(context, unionVariant.schema, "shared").$ref;

    if (typeof reference === "string") mapping[unionVariant.tag] = reference;
  }

  schema.discriminator = { propertyName: tag.property, mapping };

  return schema;
}

// A branch of a body-tagged union: the variant and its tag. A strict input twin writes the variant in place with the
// tag among its properties, since the variant's own twin refuses every key it does not declare.
function bodyTaggedBranch(
  context: EmitContext,
  schemaId: string,
  tagProperty: string,
  tagValue: string,
  variant: SchemaVariant,
): JsonObject {
  const tagSchema: JsonObject = { const: tagValue };
  const named = context.ir.schemas[schemaId];
  const strict = variant === "input" && context.options.inputSchemas === "strict";

  if (
    !strict ||
    named === undefined ||
    !isKnownVariant("Schema", named) ||
    named.kind !== "object"
  ) {
    return {
      allOf: [
        schemaReference(context, schemaId, variant),
        { type: "object", properties: { [tagProperty]: tagSchema }, required: [tagProperty] },
      ],
    };
  }

  const inline = objectSchema(context, named, "input", schemaLocation(schemaId));
  const properties = isJsonObject(inline.properties) ? inline.properties : {};
  const required = Array.isArray(inline.required) ? inline.required : [];

  inline.properties = { [tagProperty]: tagSchema, ...properties };
  inline.required = [tagProperty, ...required];

  return inline;
}
