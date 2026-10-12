// Builders for the authoring JSON Schemas. The grammar modules describe each mapping once with
// these helpers; `schemas.ts` assembles the files that `@seampact/spec/schemas/authoring/*` ships.
//
// Conventions the validate stage relies on (packages/compiler/src/validate):
// - every grammar keyword carries its ADR section in `$comment` (the grammar snapshot reads it);
// - a definition whose failures deserve their own rule is marked by its `title`: `reason`,
//   `refused`, `refused form`, `conflict`, `reserved`, `reasoned policy`, or a title ending in
//   ` name` for a name position;
// - every `required` sits beside a `properties` that lists its keys (Ajv strictRequired).

export type JsonSchema = { [key: string]: unknown };

export const A2 = (section: number): string => `ADR 0002 section ${section}`;
export const A3 = (section: number): string => `ADR 0003 section ${section}`;
export const A8 = "ADR 0008";

// The files of `schemas/authoring/`, without their `.schema.json` suffix.
export const AUTHORING_FILES = [
  "workspace",
  "api",
  "base",
  "pack",
  "node",
  "node-errors",
  "conventions",
  "schema",
  "schemas",
  "enums",
  "scalars",
  "errors",
  "natures",
  "schemes",
  "headers",
  "identities",
  "rights",
  "rules",
  "requirements",
  "scopes",
  "buckets",
  "services",
  "pagings",
  "formats",
  "common",
] as const;
export type AuthoringFile = (typeof AUTHORING_FILES)[number];

const REF_PREFIX = "@@";

// A reference to a definition of a file; `localiseRefs` turns it into `#/$defs/<def>` inside that
// file and `<file>.schema.json#/$defs/<def>` elsewhere.
export function ref(file: AuthoringFile, def?: string): JsonSchema {
  return { $ref: `${REF_PREFIX}${file}#${def === undefined ? "" : `/$defs/${def}`}` };
}

export function localiseRefs(value: unknown, file: AuthoringFile): unknown {
  if (Array.isArray(value)) return value.map((v) => localiseRefs(v, file));
  if (value === null || typeof value !== "object") return value;
  const out: JsonSchema = {};
  for (const [key, v] of Object.entries(value)) {
    if (key === "$ref" && typeof v === "string" && v.startsWith(REF_PREFIX)) {
      const [target, fragment] = v.slice(REF_PREFIX.length).split("#") as [string, string];
      out[key] =
        target === file ? `#${fragment}` : `${target}.schema.json${fragment ? `#${fragment}` : ""}`;
    } else {
      out[key] = localiseRefs(v, file);
    }
  }
  return out;
}

// A grammar keyword: its schema plus the ADR section that defines it.
export function kw(section: string, schema: JsonSchema, description?: string): JsonSchema {
  return { ...schema, $comment: section, ...(description === undefined ? {} : { description }) };
}

// `required` with the `properties` Ajv strictRequired wants beside it.
export function req(...keys: string[]): JsonSchema {
  return { properties: Object.fromEntries(keys.map((k) => [k, true])), required: keys };
}

// A key that may not appear in this case, because another key excludes it.
export function conflict(description: string): JsonSchema {
  return { title: "conflict", description, not: {} };
}

// `then` constraints that forbid each of `keys`.
export function forbid(keys: string[], description: string): JsonSchema {
  return {
    properties: Object.fromEntries(keys.map((k) => [k, conflict(description)])),
  };
}

export function str(extra: JsonSchema = {}): JsonSchema {
  return { type: "string", ...extra };
}

export function oneOfValues(...values: (string | null)[]): JsonSchema {
  return { enum: values };
}

export function list(items: JsonSchema, extra: JsonSchema = {}): JsonSchema {
  return { type: "array", items, ...extra };
}

export const EXTENSION_KEY = "^x-[a-z][a-z0-9]*-[a-z][a-z0-9]*(-[a-z0-9]+)*$";

// Consumer extension keys (ADR 0002 section 12): `x-<prefix>-<key>`, the prefix `seampact` reserved.
// Their values are checked against their declarations by a later pass.
const EXTENSION_PATTERNS: JsonSchema = {
  "^x-seampact-": {
    title: "reserved",
    description: "The extension prefix 'seampact' is reserved (ADR 0008).",
    not: {},
  },
  [EXTENSION_KEY]: { $comment: A2(12) },
};

export interface ObjectSpec {
  title?: string;
  description?: string;
  props: Record<string, JsonSchema>;
  required?: string[];
  // Accepts consumer extension keys, `x-<prefix>-<key>`.
  extensions?: boolean;
  // Accepts `$include` (ADR 0002 section 2); true unless the mapping is a file's root of a kind
  // that may not hold it.
  include?: boolean;
  // Extra constraints, joined with `allOf`.
  rules?: JsonSchema[];
  minProperties?: number;
}

// A mapping whose keys are grammar keywords: any other key is refused.
export function object(spec: ObjectSpec): JsonSchema {
  const include = spec.include ?? true;
  const properties: JsonSchema = { ...spec.props };
  if (include) properties.$include = ref("common", "include");
  const out: JsonSchema = { type: "object" };
  if (spec.title !== undefined) out.title = spec.title;
  if (spec.description !== undefined) out.description = spec.description;
  out.properties = properties;
  if (spec.extensions) out.patternProperties = EXTENSION_PATTERNS;
  out.additionalProperties = false;
  if (spec.minProperties !== undefined) out.minProperties = spec.minProperties;
  const rules: JsonSchema[] = [];
  if (spec.required !== undefined && spec.required.length > 0) {
    if (include) {
      // A fragment holding `$include` may receive its required keys from the included file.
      rules.push({ if: req("$include"), else: req(...spec.required) });
    } else {
      out.required = spec.required;
    }
  }
  rules.push(...(spec.rules ?? []));
  if (rules.length === 1) Object.assign(out, rules[0]);
  else if (rules.length > 1) out.allOf = rules;
  return out;
}

export interface MapSpec {
  // The key pattern, without anchors; `null` accepts any key not starting with `$`.
  keys: string | null;
  // What a key names, for diagnostics ("a schema name").
  keyDescription: string;
  values: JsonSchema;
  description?: string;
  include?: boolean;
}

// A mapping from names to values (a catalogue, `routes`, a fields map).
export function map(spec: MapSpec): JsonSchema {
  const include = spec.include ?? true;
  const keys = spec.keys ?? "[^$].*";
  const out: JsonSchema = { type: "object" };
  if (spec.description !== undefined) out.description = spec.description;
  if (include) out.properties = { $include: ref("common", "include") };
  out.propertyNames = {
    description: spec.keyDescription,
    pattern: include ? `^(?:${keys}|\\$include)$` : `^(?:${keys})$`,
  };
  out.additionalProperties = spec.values;
  return out;
}

// `if`/`then`/`else`, built without a `then` literal (an object literal with `then` reads as a
// thenable to Biome's linter).
export function when(condition: JsonSchema, then?: JsonSchema, otherwise?: JsonSchema): JsonSchema {
  const entries: [string, JsonSchema][] = [["if", condition]];
  if (then !== undefined) entries.push(["then", then]);
  if (otherwise !== undefined) entries.push(["else", otherwise]);
  return Object.fromEntries(entries);
}

// A value that is either a string of one form or a mapping of another (`paging: cursor` or
// `paging: { cursor: {...} }`).
export function stringOr(stringForm: JsonSchema, objectForm: JsonSchema): JsonSchema {
  return { ...when({ type: "string" }, stringForm, objectForm) };
}
