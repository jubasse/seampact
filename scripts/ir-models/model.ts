import { IR_SCHEMA_DOCUMENTS, type SchemaNode } from "@seampact/spec/ir";

// The neutral model of the IR definitions (ADR 0010): one entry per `$defs` definition of the IR schema files,
// read from the subset the README describes. Every emitter writes from this model only. A construct outside the
// subset fails here, naming the definition, so a new construct is a reviewed change of this file rather than a
// guess in an emitter.

const KNOWN_VALUES_KEYWORD = "x-seampact-known";
const MUST_ACT_KEYWORD = "x-seampact-must-act";

/** The extension slot of ADR 0004 section 3: kept as a raw JSON object by every model. */
export const EXTENSION_SLOT_DEFINITION = "Extensions";

/** The schema file of each document of `IR_SCHEMA_DOCUMENTS`, by its `$id`. */
const SCHEMA_ID_PREFIX = "https://seampact.dev/schemas/ir/";
const SCHEMA_FILE_SUFFIX = ".schema.json";

// The keywords each construct may carry. Refinements (`pattern`, `minLength`, `minimum`, `maximum`, `minItems`)
// only constrain a value: the validator checks them and the models keep the plain type. Any other keyword on a
// construct is one the generator does not map, so generation fails on it.
const KEYWORDS = {
  struct: ["type", "description", "properties", "required"],
  union: ["type", "description", "discriminator", "oneOf", MUST_ACT_KEYWORD],
  openEnum: ["type", "description", KNOWN_VALUES_KEYWORD, MUST_ACT_KEYWORD],
  reference: ["$ref", "description"],
  opaque: ["description"],
  tag: ["type", "const", "description"],
  string: ["type", "description", "pattern", "minLength"],
  integer: ["type", "description", "minimum", "maximum"],
  boolean: ["type", "description"],
  array: ["type", "description", "items", "minItems"],
  map: ["type", "description", "additionalProperties", "propertyNames"],
} as const satisfies Record<string, readonly string[]>;

type Construct = keyof typeof KEYWORDS;

// A member becomes a property in every model language, so its name must be an identifier as written.
const MEMBER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// A reference names a whole definition, of the same file or of a sibling file.
const DEFINITION_REF = /^(?:[a-z][a-z0-9-]*\.schema\.json)?#\/\$defs\/([A-Za-z_][A-Za-z0-9_]*)$/;

const DISCRIMINATOR_KEYWORDS = ["propertyName"];

const DOCUMENT_KEYWORDS = new Set(["$schema", "$id", "$defs", "$ref", "title", "description"]);

export type TypeRef =
  | { kind: "named"; definition: string }
  | { kind: "string" }
  | { kind: "integer" }
  | { kind: "boolean" }
  | { kind: "array"; items: TypeRef }
  | { kind: "map"; keys: TypeRef; values: TypeRef }
  | { kind: "opaque" };

export interface Member {
  name: string;
  type: TypeRef;
  required: boolean;
  description: string | undefined;
  /** The fixed value of a string `const` member: a union variant's tag, the only place the subset allows it. */
  constValue: string | undefined;
}

export interface VariantTag {
  union: string;
  member: string;
  value: string;
}

interface DefinitionBase {
  name: string;
  /** The schema file holding it, without `.schema.json` (`common`, `operation`, ...). */
  file: string;
  description: string | undefined;
  mustAct: boolean;
}

export interface StructDefinition extends DefinitionBase {
  kind: "struct";
  members: Member[];
  /** Set when the struct is a variant of a tagged union: its tag member and the value it fixes. */
  variantOf: VariantTag | undefined;
}

export interface UnionDefinition extends DefinitionBase {
  kind: "union";
  tag: string;
  variants: { definition: string; tagValue: string }[];
}

export interface OpenEnumDefinition extends DefinitionBase {
  kind: "openEnum";
  known: string[];
}

/** A string, integer, reference or map definition: a type alias in every model. */
export interface AliasDefinition extends DefinitionBase {
  kind: "alias";
  target: TypeRef;
}

export interface ExtensionSlotDefinition extends DefinitionBase {
  kind: "extensionSlot";
}

export type Definition =
  | StructDefinition
  | UnionDefinition
  | OpenEnumDefinition
  | AliasDefinition
  | ExtensionSlotDefinition;

export interface NeutralModel {
  /** Every definition, sorted by name. */
  definitions: Definition[];
}

export class UnhandledSchemaError extends Error {}

function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(at: string, problem: string): never {
  throw new UnhandledSchemaError(`${at}: ${problem}; the IR model generator does not handle it`);
}

function descriptionOf(node: SchemaNode): string | undefined {
  return typeof node.description === "string" ? node.description : undefined;
}

function refName(ref: unknown, at: string): string {
  const match = typeof ref === "string" ? DEFINITION_REF.exec(ref) : null;
  if (match?.[1] === undefined) fail(at, `a $ref that does not name a definition (${String(ref)})`);
  return match[1];
}

function assertKeywords(node: SchemaNode, construct: Construct, at: string): void {
  const allowed: readonly string[] = KEYWORDS[construct];
  for (const keyword of Object.keys(node)) {
    if (!allowed.includes(keyword)) fail(at, `keyword ${keyword} on a ${construct}`);
  }
}

function fileOf(document: SchemaNode): string {
  const id = document.$id;
  if (
    typeof id !== "string" ||
    !id.startsWith(SCHEMA_ID_PREFIX) ||
    !id.endsWith(SCHEMA_FILE_SUFFIX)
  )
    fail(String(id), "a schema document without an IR $id");
  return id.slice(SCHEMA_ID_PREFIX.length, -SCHEMA_FILE_SUFFIX.length);
}

/** The type of a member, an array item or a map value. Named shapes only: an inline object is refused. */
function typeRefOf(node: SchemaNode, at: string): TypeRef {
  if (node.$ref !== undefined) {
    assertKeywords(node, "reference", at);
    return { kind: "named", definition: refName(node.$ref, at) };
  }
  if (node.oneOf !== undefined || node.discriminator !== undefined)
    fail(at, "an inline tagged union (a union is a definition of its own)");
  if (node[KNOWN_VALUES_KEYWORD] !== undefined)
    fail(at, "an inline open enum (an open enum is a definition of its own)");
  if (node.const !== undefined) fail(at, "a const outside a union variant's tag");
  if (node.properties !== undefined)
    fail(at, "an inline object (an object is a definition of its own)");

  switch (node.type) {
    case undefined:
      assertKeywords(node, "opaque", at);
      return { kind: "opaque" };
    case "string":
      assertKeywords(node, "string", at);
      return { kind: "string" };
    case "integer":
      assertKeywords(node, "integer", at);
      return { kind: "integer" };
    case "boolean":
      assertKeywords(node, "boolean", at);
      return { kind: "boolean" };
    case "array":
      assertKeywords(node, "array", at);
      if (!isSchemaNode(node.items)) fail(at, "an array without items");
      return { kind: "array", items: typeRefOf(node.items, `${at}[]`) };
    case "object":
      return mapTypeOf(node, at);
    default:
      return fail(at, `type ${JSON.stringify(node.type)}`);
  }
}

function mapTypeOf(node: SchemaNode, at: string): TypeRef {
  assertKeywords(node, "map", at);
  if (!isSchemaNode(node.additionalProperties)) fail(at, "an object without a shape");

  const keys = isSchemaNode(node.propertyNames)
    ? keyTypeOf(node.propertyNames, `${at}{key}`)
    : ({ kind: "string" } as const);
  return { kind: "map", keys, values: typeRefOf(node.additionalProperties, `${at}{}`) };
}

function keyTypeOf(node: SchemaNode, at: string): TypeRef {
  const keys = typeRefOf(node, at);
  if (keys.kind !== "named" && keys.kind !== "string") fail(at, "a map key that is not a string");
  return keys;
}

function structOf(
  name: string,
  file: string,
  def: SchemaNode,
  properties: SchemaNode,
): StructDefinition {
  if (def.type !== "object") fail(name, `a struct of type ${JSON.stringify(def.type)}`);
  assertKeywords(def, "struct", name);
  const required = requiredNames(name, def, properties);

  const members: Member[] = [];
  for (const [member, schema] of Object.entries(properties)) {
    const at = `${name}.${member}`;
    if (!MEMBER_NAME.test(member)) fail(at, "a member name that is not an identifier");
    if (!isSchemaNode(schema)) fail(at, "a member that is not a schema");
    members.push(memberOf(member, schema, required.has(member), at));
  }
  return {
    kind: "struct",
    name,
    file,
    description: descriptionOf(def),
    mustAct: false,
    members,
    variantOf: undefined,
  };
}

function requiredNames(name: string, def: SchemaNode, properties: SchemaNode): Set<string> {
  if (def.required === undefined) return new Set();
  if (!Array.isArray(def.required)) fail(name, "a required that is not an array");

  const required = new Set<string>();
  for (const member of def.required) {
    if (typeof member !== "string" || !Object.hasOwn(properties, member))
      fail(name, `required member ${String(member)} has no property`);
    required.add(member);
  }
  return required;
}

// A string `const` is kept as the member's fixed value; `linkVariants` accepts it only as a variant's tag.
function memberOf(name: string, schema: SchemaNode, required: boolean, at: string): Member {
  const description = descriptionOf(schema);
  if (schema.type === "string" && typeof schema.const === "string") {
    assertKeywords(schema, "tag", at);
    return { name, type: { kind: "string" }, required, description, constValue: schema.const };
  }
  return { name, type: typeRefOf(schema, at), required, description, constValue: undefined };
}

function unionOf(name: string, file: string, def: SchemaNode, mustAct: boolean): UnionDefinition {
  assertKeywords(def, "union", name);
  if (def.type !== "object") fail(name, `a union of type ${JSON.stringify(def.type)}`);
  const discriminator = def.discriminator;
  if (!isSchemaNode(discriminator) || typeof discriminator.propertyName !== "string")
    fail(name, "a discriminator without a propertyName");
  for (const keyword of Object.keys(discriminator)) {
    if (!DISCRIMINATOR_KEYWORDS.includes(keyword)) fail(name, `discriminator keyword ${keyword}`);
  }
  if (!Array.isArray(def.oneOf) || def.oneOf.length === 0)
    fail(name, "a discriminator without oneOf");

  const variants = def.oneOf.map((variant: unknown, index: number) => {
    if (!isSchemaNode(variant)) fail(`${name}.oneOf[${index}]`, "a variant that is not a schema");
    const at = `${name}.oneOf[${index}]`;
    assertKeywords(variant, "reference", at);
    return { definition: refName(variant.$ref, at), tagValue: "" };
  });
  return {
    kind: "union",
    name,
    file,
    description: descriptionOf(def),
    mustAct,
    tag: discriminator.propertyName,
    variants,
  };
}

function openEnumOf(
  name: string,
  file: string,
  def: SchemaNode,
  mustAct: boolean,
): OpenEnumDefinition {
  assertKeywords(def, "openEnum", name);
  const known = def[KNOWN_VALUES_KEYWORD];
  if (def.type !== "string") fail(name, "an open enum that is not a string");
  if (
    !Array.isArray(known) ||
    known.length === 0 ||
    !known.every((value) => typeof value === "string")
  )
    fail(name, "an open enum without a list of known string values");
  return {
    kind: "openEnum",
    name,
    file,
    description: descriptionOf(def),
    mustAct,
    known: [...known],
  };
}

function definitionOf(name: string, file: string, def: SchemaNode): Definition {
  const mustAct = def[MUST_ACT_KEYWORD] === true;
  const description = descriptionOf(def);

  if (def.discriminator !== undefined) return unionOf(name, file, def, mustAct);
  if (mustAct && def[KNOWN_VALUES_KEYWORD] === undefined)
    fail(name, "a must-act mark on a definition that is neither a union nor an open enum");
  if (def[KNOWN_VALUES_KEYWORD] !== undefined) return openEnumOf(name, file, def, mustAct);
  if (def.properties !== undefined) {
    if (!isSchemaNode(def.properties)) fail(name, "properties that are not an object");
    return structOf(name, file, def, def.properties);
  }
  if (name === EXTENSION_SLOT_DEFINITION) return extensionSlotOf(name, file, def);

  const target = typeRefOf(def, name);
  if (target.kind === "opaque" || target.kind === "boolean" || target.kind === "array")
    fail(name, `a ${target.kind} definition`);
  return { kind: "alias", name, file, description, mustAct, target };
}

// The slot is `{ <prefix>: { <key>: opaque } }`; any other shape under that name is a schema change to review.
function extensionSlotOf(name: string, file: string, def: SchemaNode): ExtensionSlotDefinition {
  const shape = typeRefOf(def, name);
  const isSlot =
    shape.kind === "map" && shape.values.kind === "map" && shape.values.values.kind === "opaque";
  if (!isSlot) fail(name, "an extension slot that is not a map of maps of opaque values");
  return { kind: "extensionSlot", name, file, description: descriptionOf(def), mustAct: false };
}

/** Sets each variant's tag value and marks its struct; a variant fixes its tag with a required string const. */
function linkVariants(definitions: Map<string, Definition>): void {
  for (const union of definitions.values()) {
    if (union.kind !== "union") continue;
    for (const variant of union.variants) {
      const struct = definitions.get(variant.definition);
      const at = `${union.name} variant ${variant.definition}`;
      if (struct?.kind !== "struct") fail(at, "a variant that is not an object definition");
      if (struct.variantOf !== undefined)
        fail(at, `a variant already used by ${struct.variantOf.union}`);

      const tagMember = struct.members.find((member) => member.name === union.tag);
      if (tagMember?.constValue === undefined || !tagMember.required)
        fail(at, `a variant without a required string const tag ${union.tag}`);

      variant.tagValue = tagMember.constValue;
      struct.variantOf = { union: union.name, member: union.tag, value: tagMember.constValue };
    }
    const tags = union.variants.map((variant) => variant.tagValue);
    if (new Set(tags).size !== tags.length) fail(union.name, "two variants with the same tag");
  }
}

function assertConstsAreTags(definitions: Map<string, Definition>): void {
  for (const definition of definitions.values()) {
    if (definition.kind !== "struct") continue;
    for (const member of definition.members) {
      const isTag = definition.variantOf?.member === member.name;
      if (member.constValue !== undefined && !isTag)
        fail(`${definition.name}.${member.name}`, "a const outside a union variant's tag");
    }
  }
}

function assertReferencesResolve(definitions: Map<string, Definition>): void {
  const check = (type: TypeRef, at: string): void => {
    if (type.kind === "named" && !definitions.has(type.definition))
      fail(at, `a reference to the missing definition ${type.definition}`);
    if (type.kind === "array") check(type.items, at);
    if (type.kind === "map") {
      check(type.keys, at);
      check(type.values, at);
    }
  };
  for (const definition of definitions.values()) {
    if (definition.kind === "struct")
      for (const member of definition.members)
        check(member.type, `${definition.name}.${member.name}`);
    if (definition.kind === "alias") check(definition.target, definition.name);
  }
}

// A map key is a string: a plain string, a string alias (through any chain of aliases) or an open enum.
function isStringKey(definitions: Map<string, Definition>, type: TypeRef): boolean {
  if (type.kind === "string") return true;
  if (type.kind !== "named") return false;
  const definition = definitions.get(type.definition);
  if (definition?.kind === "openEnum") return true;
  return definition?.kind === "alias" && isStringKey(definitions, definition.target);
}

function assertMapKeysAreStrings(definitions: Map<string, Definition>): void {
  const check = (type: TypeRef, at: string): void => {
    if (type.kind === "array") check(type.items, `${at}[]`);
    if (type.kind !== "map") return;
    if (!isStringKey(definitions, type.keys)) {
      const key = type.keys.kind === "named" ? type.keys.definition : type.keys.kind;
      fail(`${at}{key}`, `a map key ${key} that is not a string alias or an open enum`);
    }
    check(type.values, `${at}{}`);
  };
  for (const definition of definitions.values()) {
    if (definition.kind === "struct")
      for (const member of definition.members)
        check(member.type, `${definition.name}.${member.name}`);
    if (definition.kind === "alias") check(definition.target, definition.name);
  }
}

/** Builds the neutral model of the IR schema files, failing on any construct it does not map. */
export function buildNeutralModel(
  documents: readonly SchemaNode[] = IR_SCHEMA_DOCUMENTS,
): NeutralModel {
  const definitions = new Map<string, Definition>();
  for (const document of documents) {
    const file = fileOf(document);
    for (const keyword of Object.keys(document)) {
      if (!DOCUMENT_KEYWORDS.has(keyword)) fail(file, `document keyword ${keyword}`);
    }
    if (!isSchemaNode(document.$defs)) fail(file, "a document without $defs");

    for (const [name, def] of Object.entries(document.$defs)) {
      if (!isSchemaNode(def)) fail(name, "a definition that is not a schema");
      if (definitions.has(name))
        fail(name, "a definition name used twice across the IR schema files");
      definitions.set(name, definitionOf(name, file, def));
    }
  }

  linkVariants(definitions);
  assertConstsAreTags(definitions);
  assertReferencesResolve(definitions);
  assertMapKeysAreStrings(definitions);

  const sorted = [...definitions.values()].sort((left, right) =>
    compareNames(left.name, right.name),
  );
  return { definitions: sorted };
}

/** Code-unit order, independent of the locale. */
export function compareNames(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
