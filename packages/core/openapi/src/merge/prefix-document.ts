import { COMPONENT_SCHEMA_PREFIX } from "../emit-context.js";
import { EXTENSION_PREFIX } from "../extension-names.js";
import { isJsonObject, type JsonObject, type JsonValue, objectMember } from "../json-value.js";

// An api's `prefix` in a merged document (ADR 0011 "Which OpenAPI documents exist"): `<prefix>.` before each of its
// operation ids and component keys, with every reference to a component following the new key.

// The extension members that name a schema component key, with the item member holding the key.
const SCHEMA_KEY_EXTENSION_MEMBERS: Readonly<Record<string, string>> = {
  [`${EXTENSION_PREFIX}restricted-to`]: "schema",
};

// The characters of an OpenAPI component key, which a prefixed key must keep.
const COMPONENT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isValidPrefix(prefix: string): boolean {
  return COMPONENT_KEY_PATTERN.test(prefix);
}

/** A copy of the document with `prefix` applied; the document itself is left as it is. */
export function prefixDocument(document: JsonObject, prefix: string): JsonObject {
  const components = objectMember(document, "components");
  const renaming: SchemaRenaming = {
    prefix,
    schemaKeys: new Set(Object.keys(objectMember(components, "schemas"))),
  };
  const schemeKeys = new Set(Object.keys(objectMember(components, "securitySchemes")));
  const prefixed = withSchemaReferences(document, renaming);

  if (!isJsonObject(prefixed)) throw new TypeError("a document copy is always an object");

  if (isJsonObject(prefixed.components)) {
    prefixed.components = prefixedComponents(prefixed.components, prefix);
  }

  for (const pathItem of Object.values(objectMember(prefixed, "paths"))) {
    if (!isJsonObject(pathItem)) continue;

    for (const operation of Object.values(pathItem)) {
      if (isJsonObject(operation)) prefixOperation(operation, prefix, schemeKeys);
    }
  }

  return prefixed;
}

interface SchemaRenaming {
  prefix: string;
  schemaKeys: ReadonlySet<string>;
}

// A copy where each `$ref`, discriminator mapping and extension member naming a schema of the document names the
// prefixed key; any other string, such as an example, is data and stays as it is.
function withSchemaReferences(value: JsonValue, renaming: SchemaRenaming): JsonValue {
  if (Array.isArray(value)) return value.map((item) => withSchemaReferences(item, renaming));

  if (!isJsonObject(value)) return value;

  const copy: JsonObject = {};

  for (const [member, memberValue] of Object.entries(value)) {
    copy[member] = renamedMember(member, memberValue, renaming);
  }

  if (isJsonObject(copy.discriminator)) {
    const branches = Array.isArray(value.oneOf) ? value.oneOf : [];

    copy.discriminator = prefixedDiscriminator(copy.discriminator, branches, renaming);
  }

  return copy;
}

function renamedMember(member: string, value: JsonValue, renaming: SchemaRenaming): JsonValue {
  if (member === "$ref" && typeof value === "string") return prefixedReference(value, renaming);

  const keyMember = SCHEMA_KEY_EXTENSION_MEMBERS[member];

  if (keyMember !== undefined && Array.isArray(value)) {
    return value.map((item) => withPrefixedKeyMember(item, keyMember, renaming));
  }

  return withSchemaReferences(value, renaming);
}

function prefixedReference(reference: string, renaming: SchemaRenaming): string {
  if (!reference.startsWith(COMPONENT_SCHEMA_PREFIX)) return reference;

  const key = reference.slice(COMPONENT_SCHEMA_PREFIX.length);

  return `${COMPONENT_SCHEMA_PREFIX}${prefixedSchemaKey(key, renaming)}`;
}

function prefixedSchemaKey(key: string, renaming: SchemaRenaming): string {
  return renaming.schemaKeys.has(key) ? `${renaming.prefix}.${key}` : key;
}

function withPrefixedKeyMember(
  item: JsonValue,
  keyMember: string,
  renaming: SchemaRenaming,
): JsonValue {
  const copy = withSchemaReferences(item, renaming);
  const key = isJsonObject(copy) ? copy[keyMember] : undefined;

  if (isJsonObject(copy) && typeof key === "string") {
    copy[keyMember] = prefixedSchemaKey(key, renaming);
  }

  return copy;
}

// Without a `mapping`, a discriminator value names a component key (OAS implicit mapping), which the prefix changes:
// the prefixed discriminator maps each original key to its prefixed reference.
function prefixedDiscriminator(
  discriminator: JsonObject,
  branches: readonly JsonValue[],
  renaming: SchemaRenaming,
): JsonObject {
  if (discriminator.mapping !== undefined) {
    const mapping = objectMember(discriminator, "mapping");
    const renamed: JsonObject = {};

    for (const [value, reference] of Object.entries(mapping)) {
      renamed[value] =
        typeof reference === "string" ? prefixedReference(reference, renaming) : reference;
    }

    return { ...discriminator, mapping: renamed };
  }

  const mapping: JsonObject = {};

  for (const branch of branches) {
    const reference = isJsonObject(branch) ? branch.$ref : undefined;

    if (typeof reference !== "string" || !reference.startsWith(COMPONENT_SCHEMA_PREFIX)) continue;

    mapping[reference.slice(COMPONENT_SCHEMA_PREFIX.length)] = prefixedReference(
      reference,
      renaming,
    );
  }

  return Object.keys(mapping).length === 0 ? discriminator : { ...discriminator, mapping };
}

function prefixedComponents(components: JsonObject, prefix: string): JsonObject {
  const prefixed: JsonObject = {};

  for (const [section, entries] of Object.entries(components)) {
    prefixed[section] = isJsonObject(entries) ? prefixedKeys(entries, prefix) : entries;
  }

  return prefixed;
}

function prefixedKeys(entries: JsonObject, prefix: string): JsonObject {
  const prefixed: JsonObject = {};

  for (const [key, value] of Object.entries(entries)) prefixed[`${prefix}.${key}`] = value;

  return prefixed;
}

function prefixOperation(
  operation: JsonObject,
  prefix: string,
  schemeKeys: ReadonlySet<string>,
): void {
  if (typeof operation.operationId === "string") {
    operation.operationId = `${prefix}.${operation.operationId}`;
  }

  if (!Array.isArray(operation.security)) return;

  operation.security = operation.security.map((requirement) => {
    if (!isJsonObject(requirement)) return requirement;

    const renamed: JsonObject = {};

    for (const [scheme, scopes] of Object.entries(requirement)) {
      renamed[schemeKeys.has(scheme) ? `${prefix}.${scheme}` : scheme] = scopes;
    }

    return renamed;
  });
}
