import type { JsonObject } from "./compiler.ts";

// What the compiled scale fixture holds, counted on the IR of each api (the raw-tree counts are scale-counts.ts):
// the volumes FR-18 names, as the IR keeps them. Scalars, enum uses and arrays stay inline in their use
// (`docs/ir/05-schemas.md`), so a named schema that is one of them has no entry in `schemas`; the caller adds the
// raw declarations that hold none.

export interface ScaleIrCounts {
  operations: Record<string, number>;
  /** Named examples on operations, summed over the apis. */
  examples: number;
  /** Declared error codes (the core's default codes excluded), distinct over the apis. */
  errorCodes: number;
  errorFamilies: number;
  /** Names declared under `schemas` that the IR keeps as a schema, distinct over the apis. */
  declaredSchemas: Set<string>;
  identities: Record<string, number>;
  schemes: Record<string, number>;
}

const DECLARED_SCHEMA_POINTER = /^\/schemas\/([^/]+)$/;
const CORE_LAYER = "core";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function membersOf(parent: JsonObject, key: string): JsonObject {
  const value = parent[key];

  return isObject(value) ? value : {};
}

function entriesOf(parent: JsonObject, key: string): JsonObject[] {
  const value = parent[key];

  return Array.isArray(value) ? value.filter(isObject) : [];
}

function declaredSchemaName(schema: JsonObject): string | undefined {
  const pointer = membersOf(schema, "origin").pointer;

  if (typeof pointer !== "string" || "derivedFrom" in schema) return undefined;

  return DECLARED_SCHEMA_POINTER.exec(pointer)?.[1];
}

export function scaleIrCounts(irs: Record<string, JsonObject>): ScaleIrCounts {
  const counts: ScaleIrCounts = {
    operations: {},
    examples: 0,
    errorCodes: 0,
    errorFamilies: 0,
    declaredSchemas: new Set(),
    identities: {},
    schemes: {},
  };
  const codes = new Set<string>();
  const families = new Set<string>();

  for (const [api, ir] of Object.entries(irs)) {
    const operations = entriesOf(ir, "operations");

    counts.operations[api] = operations.length;
    counts.identities[api] = Object.keys(membersOf(ir, "identities")).length;
    counts.schemes[api] = Object.keys(membersOf(ir, "schemes")).length;

    for (const operation of operations) {
      counts.examples += Object.keys(membersOf(operation, "examples")).length;
    }

    for (const schema of Object.values(membersOf(ir, "schemas"))) {
      const name = isObject(schema) ? declaredSchemaName(schema) : undefined;

      if (name !== undefined) counts.declaredSchemas.add(name);
    }

    for (const [code, declaration] of Object.entries(membersOf(ir, "errors"))) {
      if (!isObject(declaration)) continue;
      if (membersOf(declaration, "origin").layer === CORE_LAYER) continue;

      codes.add(code);
      families.add(String(declaration.family));
    }
  }

  counts.errorCodes = codes.size;
  counts.errorFamilies = families.size;

  return counts;
}
