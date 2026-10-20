import type { JsonSchema } from "../authoring/schemas.js";
import { ARTEFACT_ID_PATTERN } from "./app-config.js";
import { ENTRY_ID_PATTERN } from "./config-schema-parts.js";

// Test support: the JVM DSL parity rule (A42, ADR 0010 "Native artifacts"). A Gradle `seampact { }` block or a
// Maven `<configuration>` builds the same JSON value tree as the YAML file and is validated against the same
// schema, so every form the schema accepts must have a DSL form: fixed keys are identifiers, user-named keys are
// map keys under a name pattern, and alternatives are told apart by JSON type or by a required key.

// A key the schema fixes: a Kotlin property and a Maven element name.
export const FIXED_KEY_PATTERN = "^[a-z][A-Za-z0-9]*$";

// The key patterns of a map: user names (sources, apis, documents, links) and artefact ids.
const MAP_KEY_PATTERNS: readonly string[] = [ENTRY_ID_PATTERN, ARTEFACT_ID_PATTERN];

// Values the schema leaves free, each read by its owner: a target parses its own `options`.
const OPAQUE_OBJECT_POINTERS: readonly string[] = ["/$defs/targetEntry/properties/options"];

// The JSON types a DSL tells apart; a number is never told from a string (Maven writes both as text).
const DISCRIMINATING_KINDS: readonly string[] = ["string", "boolean", "array", "object"];

const NESTED_SCHEMA_KEYS = ["items", "additionalProperties", "propertyNames"] as const;

// Every place `schema` breaks the rule, as `<JSON pointer>: <what>`; empty when every form has a DSL form.
export function dslParityViolations(schema: JsonSchema): string[] {
  return violationsAt(schema, "", undefined);
}

function violationsAt(schema: unknown, pointer: string, parentKind: string | undefined): string[] {
  if (!isSchemaObject(schema)) return [];

  const kind = kindOf(schema) ?? parentKind;

  return [
    ...typeViolations(schema, pointer),
    ...propertyViolations(schema, pointer),
    ...objectFormViolations(schema, pointer, kind),
    ...alternativeViolations(schema, pointer, kind),
    ...nestedViolations(schema, pointer),
  ];
}

function typeViolations(schema: JsonSchema, pointer: string): string[] {
  if (Array.isArray(schema.type)) return [`${pointer}: a value of several JSON types`];

  if (schema.type === "null") return [`${pointer}: a null value, which only YAML writes`];

  return [];
}

function propertyViolations(schema: JsonSchema, pointer: string): string[] {
  if (!isSchemaObject(schema.properties)) return [];

  const fixedKeyPattern = new RegExp(FIXED_KEY_PATTERN);

  return Object.entries(schema.properties).flatMap(([key, value]) => [
    ...(fixedKeyPattern.test(key)
      ? []
      : [`${pointer}/properties/${key}: a fixed key that is no identifier`]),
    ...violationsAt(value, `${pointer}/properties/${key}`, undefined),
  ]);
}

// An object has fixed keys (`additionalProperties: false`) or is a map whose keys follow a name pattern.
function objectFormViolations(
  schema: JsonSchema,
  pointer: string,
  kind: string | undefined,
): string[] {
  if (schema.patternProperties !== undefined) {
    return [`${pointer}: keys told apart by pattern (patternProperties)`];
  }

  if (schema.type !== "object" || OPAQUE_OBJECT_POINTERS.includes(pointer)) return [];

  if (kind === "object" && schema.additionalProperties === undefined) {
    return [`${pointer}: an object that neither fixes its keys nor is a map`];
  }

  if (!isSchemaObject(schema.additionalProperties)) return [];

  const keyPattern = isSchemaObject(schema.propertyNames)
    ? schema.propertyNames.pattern
    : undefined;

  if (typeof keyPattern === "string" && MAP_KEY_PATTERNS.includes(keyPattern)) return [];

  return [`${pointer}: a map whose keys follow no name pattern`];
}

function alternativeViolations(
  schema: JsonSchema,
  pointer: string,
  parentKind: string | undefined,
): string[] {
  return (["oneOf", "anyOf"] as const).flatMap((keyword) => {
    const branches = schema[keyword];

    if (!Array.isArray(branches)) return [];

    const branchViolations = branches.flatMap((branch, index) =>
      violationsAt(branch, `${pointer}/${keyword}/${index}`, parentKind),
    );

    return [
      ...branchViolations,
      ...undiscriminatedPairs(branches, `${pointer}/${keyword}`, parentKind),
    ];
  });
}

function undiscriminatedPairs(
  branches: readonly unknown[],
  pointer: string,
  parentKind: string | undefined,
): string[] {
  const violations: string[] = [];

  branches.forEach((first, firstIndex) => {
    branches.slice(firstIndex + 1).forEach((second, offset) => {
      if (!areDiscriminated(first, second, parentKind)) {
        violations.push(
          `${pointer}: branches ${firstIndex} and ${firstIndex + 1 + offset} differ by neither JSON type nor a required key`,
        );
      }
    });
  });

  return violations;
}

function areDiscriminated(
  first: unknown,
  second: unknown,
  parentKind: string | undefined,
): boolean {
  if (!isSchemaObject(first) || !isSchemaObject(second)) return false;

  const firstKind = kindOf(first) ?? parentKind;
  const secondKind = kindOf(second) ?? parentKind;

  if (firstKind === undefined || secondKind === undefined) return false;

  if (firstKind !== secondKind) {
    return DISCRIMINATING_KINDS.includes(firstKind) && DISCRIMINATING_KINDS.includes(secondKind);
  }

  if (firstKind !== "object") return false;

  const firstRequired = requiredKeys(first);
  const secondRequired = requiredKeys(second);

  return (
    firstRequired.some((key) => !secondRequired.includes(key)) ||
    secondRequired.some((key) => !firstRequired.includes(key))
  );
}

function nestedViolations(schema: JsonSchema, pointer: string): string[] {
  const nested = NESTED_SCHEMA_KEYS.flatMap((key) =>
    violationsAt(schema[key], `${pointer}/${key}`, undefined),
  );
  const definitions = isSchemaObject(schema.$defs)
    ? Object.entries(schema.$defs).flatMap(([name, value]) =>
        violationsAt(value, `${pointer}/$defs/${name}`, undefined),
      )
    : [];

  return [...nested, ...definitions];
}

// The JSON type a schema accepts, from `type`, `const` or `enum`; a number and an integer are one kind.
function kindOf(schema: JsonSchema): string | undefined {
  if (typeof schema.type === "string") return schema.type === "integer" ? "number" : schema.type;

  const values = schema.const !== undefined ? [schema.const] : schema.enum;

  if (!Array.isArray(values) || values.length === 0) return undefined;

  const kinds = new Set(values.map(jsonKindOf));

  return kinds.size === 1 ? [...kinds][0] : undefined;
}

function jsonKindOf(value: unknown): string {
  if (Array.isArray(value)) return "array";

  if (value === null) return "null";

  return typeof value;
}

function requiredKeys(schema: JsonSchema): readonly string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
}

function isSchemaObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
