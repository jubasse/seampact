import { isJsonObject, type JsonObject, type JsonValue, objectMember } from "../json-value.js";

// An api's `prefix` in a merged document (ADR 0011 "Which OpenAPI documents exist"): `<prefix>.` before each of its
// operation ids and component keys, with every reference to a component following the new key.

const SCHEMA_REFERENCE_START = "#/components/schemas/";

// The characters of an OpenAPI component key, which a prefixed key must keep.
const COMPONENT_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

export function isValidPrefix(prefix: string): boolean {
  return COMPONENT_KEY_PATTERN.test(prefix);
}

/** A copy of the document with `prefix` applied; the document itself is left as it is. */
export function prefixDocument(document: JsonObject, prefix: string): JsonObject {
  const components = objectMember(document, "components");
  const schemaKeys = new Set(Object.keys(objectMember(components, "schemas")));
  const schemeKeys = new Set(Object.keys(objectMember(components, "securitySchemes")));
  const prefixed = withSchemaReferences(document, prefix, schemaKeys);

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

// Every `#/components/schemas/<key>` string of a schema the document holds points at the prefixed key.
function withSchemaReferences(
  value: JsonValue,
  prefix: string,
  schemaKeys: ReadonlySet<string>,
): JsonValue {
  if (typeof value === "string") {
    if (!value.startsWith(SCHEMA_REFERENCE_START)) return value;

    const key = value.slice(SCHEMA_REFERENCE_START.length);

    return schemaKeys.has(key) ? `${SCHEMA_REFERENCE_START}${prefix}.${key}` : value;
  }

  if (Array.isArray(value))
    return value.map((item) => withSchemaReferences(item, prefix, schemaKeys));

  if (!isJsonObject(value)) return value;

  const copy: JsonObject = {};

  for (const [member, memberValue] of Object.entries(value)) {
    copy[member] = withSchemaReferences(memberValue, prefix, schemaKeys);
  }

  return copy;
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
