// Where the authoring schemas expect which type (ADR 0002 section 3, P6), and where they expect
// nothing at all (a data position: a payload, an example, a default).
//
// The loader reads the schemas of `@seampact/spec/authoring` as plain JSON, without validating
// anything (the validate stage owns that). A position is a set of schema nodes, reached from the
// file's root schema one key or index at a time, through `properties`, `patternProperties`,
// `additionalProperties` and `items`, following `$ref`, `allOf`, `anyOf`, `oneOf` and the `then`
// and `else` branches. A branch chosen by the keys of the mapping being read (`if` with `required`
// or a `const` property: a node with `method` is a route) is chosen with `refinePosition`; a
// condition that cannot be decided, or depends on the value itself, keeps every branch.
//
// The reading is conservative on purpose: a type is expected only when every route to the position
// states one. Anything the walk cannot decide (an unknown key, a node that states no type) is left
// to the validate stage, so a correctly typed scalar is never refused here.

import {
  AUTHORING_FILES,
  type AuthoringFile,
  authoringSchemas,
  type JsonSchema,
} from "@seampact/spec/authoring";

export type ScalarType = "string" | "number" | "integer" | "boolean" | "null";
type TypeName = ScalarType | "object" | "array";

/** The file kinds a layer is read as (the validate stage's own mapping). */
export type PositionKind = "workspace" | "api" | "base" | "pack";

// The types a node accepts, or `undefined` when it states none.
type Types = ReadonlySet<TypeName> | undefined;

export interface Position {
  /** A node with no constraint at all: anything below is data. */
  readonly data: boolean;
  /** What the position accepts, `undefined` when it cannot say. */
  readonly types: Types;
  readonly nodes: readonly JsonSchema[];
  readonly children: Map<string, Position | undefined>;
  /** The schema nodes the keys are looked up in, once branches are opened; lazily filled. */
  leafSet?: readonly JsonSchema[];
  /** The positions refined for one set of branch choices, by choice. */
  readonly refined: Map<string, Position>;
}

/** What a mapping being read says about itself, to choose among conditional branches. */
export interface MapView {
  has(key: string): boolean;
  /** The resolved value of a scalar key; `NOT_SCALAR` for a mapping or a list. */
  scalar(key: string): unknown;
  /**
   * True when the mapping may hold more keys than it shows (`$include`, or it is itself an
   * included file's part): a key not seen is then not known to be absent.
   */
  open: boolean;
}

export const NOT_SCALAR: unique symbol = Symbol("not a scalar");

const ANNOTATIONS = new Set(["$comment", "description", "title", "examples", "default"]);
const TYPE_NAMES = new Set<string>([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
  "object",
  "array",
]);

let schemas: Readonly<Record<AuthoringFile, JsonSchema>> | undefined;
function schemaFiles(): Readonly<Record<AuthoringFile, JsonSchema>> {
  schemas ??= authoringSchemas();
  return schemas;
}

const FILE_OF = new Map<string, AuthoringFile>(
  AUTHORING_FILES.map((f) => [`${f}.schema.json`, f] as const),
);

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `file` is the schema file the node belongs to: a `$ref` without one stays in it. */
interface Resolved {
  node: JsonSchema;
  file: AuthoringFile;
}

function resolveRef(ref: string, from: AuthoringFile): Resolved | undefined {
  const [target = "", fragment = ""] = ref.split("#");
  const file = target === "" ? from : FILE_OF.get(target);
  if (file === undefined) return undefined;
  let node: unknown = schemaFiles()[file];
  const segments = fragment === "" ? [] : fragment.split("/").slice(1);
  for (const segment of segments) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isSchema(node)) return undefined;
    node = node[key];
  }
  return isSchema(node) ? { node, file } : undefined;
}

// Nodes carry the file they were read from, so a `$ref` resolves where it was written.
const fileOfNode = new WeakMap<JsonSchema, AuthoringFile>();

function tagged(node: JsonSchema, file: AuthoringFile): JsonSchema {
  if (!fileOfNode.has(node)) fileOfNode.set(node, file);
  return node;
}

function fileOf(node: JsonSchema): AuthoringFile {
  return fileOfNode.get(node) ?? "common";
}

function subschemas(node: JsonSchema, key: string): JsonSchema[] {
  const value = node[key];
  const list = Array.isArray(value) ? value : [value];
  return list.filter(isSchema).map((n) => tagged(n, fileOf(node)));
}

// A conflict marker (`not: {}`): the key may not appear in this case, whatever its type.
function isConflict(node: JsonSchema): boolean {
  return isSchema(node.not) && Object.keys(node.not).length === 0;
}

function valueType(value: unknown): TypeName | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (Array.isArray(value)) return "array";
  if (isSchema(value)) return "object";
  return undefined;
}

function union(parts: Types[]): Types {
  const out = new Set<TypeName>();
  for (const part of parts) {
    if (part === undefined) return undefined;
    for (const t of part) out.add(t);
  }
  return out;
}

function intersect(a: Types, b: Types): Types {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out = new Set<TypeName>();
  for (const x of a) {
    for (const y of b) {
      if (x === y) out.add(x);
      else if (x === "integer" && y === "number") out.add("integer");
      else if (x === "number" && y === "integer") out.add("integer");
    }
  }
  // Contradictory constraints: no reading, the validate stage reports it.
  return out.size === 0 ? undefined : out;
}

const resolving = new Set<JsonSchema>();

// What one node accepts: its own `type`, `enum` and `const`, its `$ref`, every `allOf` member
// (all must hold), the union of `anyOf`/`oneOf` members and of the `then` and `else` branches (a
// missing branch accepts anything).
function typesOf(node: JsonSchema): Types {
  if (resolving.has(node)) return undefined;
  resolving.add(node);
  try {
    let types: Types;
    const t = node.type;
    if (typeof t === "string" && TYPE_NAMES.has(t)) types = new Set([t as TypeName]);
    else if (Array.isArray(t)) {
      types = new Set(t.filter((x): x is TypeName => TYPE_NAMES.has(x as string)));
    }
    if (Array.isArray(node.enum)) {
      const names = node.enum.map(valueType);
      if (names.every((n) => n !== undefined))
        types = intersect(types, new Set(names as TypeName[]));
    }
    if ("const" in node) {
      const name = valueType(node.const);
      if (name !== undefined) types = intersect(types, new Set([name]));
    }
    if (typeof node.$ref === "string") {
      const r = resolveRef(node.$ref, fileOf(node));
      if (r) types = intersect(types, typesOf(tagged(r.node, r.file)));
    }
    for (const member of subschemas(node, "allOf")) types = intersect(types, typesOf(member));
    for (const key of ["anyOf", "oneOf"]) {
      if (key in node) types = intersect(types, union(subschemas(node, key).map(typesOf)));
    }
    if (isSchema(node.if)) {
      const branch = (key: string): Types => {
        const b = subschemas(node, key)[0];
        return b ? typesOf(b) : undefined;
      };
      types = intersect(types, union([branch("then"), branch("else")]));
    }
    return types;
  } finally {
    resolving.delete(node);
  }
}

function and(parts: (boolean | undefined)[]): boolean | undefined {
  if (parts.some((p) => p === false)) return false;
  return parts.every((p) => p === true) ? true : undefined;
}

// Whether a condition (an `if`) holds for the mapping: true, false, or undefined when it cannot be
// told from its keys. Only the forms the grammar writes are understood.
function holds(cond: unknown, view: MapView): boolean | undefined {
  if (cond === true || cond === false) return cond;
  if (!isSchema(cond)) return undefined;
  const parts: (boolean | undefined)[] = [];
  for (const [keyword, value] of Object.entries(cond)) {
    switch (keyword) {
      case "$comment":
      case "description":
      case "title":
        break;
      case "required": {
        const keys = Array.isArray(value) ? (value as string[]) : [];
        parts.push(and(keys.map((k) => (view.has(k) ? true : view.open ? undefined : false))));
        break;
      }
      case "properties": {
        const props = isSchema(value) ? value : {};
        for (const [key, sub] of Object.entries(props)) {
          if (sub === true) continue;
          if (!view.has(key)) {
            // Vacuous when absent, unless an include may still bring it.
            if (view.open) parts.push(undefined);
            continue;
          }
          if (isSchema(sub) && "const" in sub && Object.keys(sub).length === 1) {
            const actual = view.scalar(key);
            parts.push(actual === NOT_SCALAR ? undefined : actual === sub.const);
          } else parts.push(undefined);
        }
        break;
      }
      case "anyOf":
      case "allOf": {
        const members = (Array.isArray(value) ? value : []).map((m) => holds(m, view));
        if (keyword === "allOf") parts.push(and(members));
        else if (members.some((m) => m === true)) parts.push(true);
        else parts.push(members.every((m) => m === false) ? false : undefined);
        break;
      }
      case "not": {
        const inner = holds(value, view);
        parts.push(inner === undefined ? undefined : !inner);
        break;
      }
      default:
        parts.push(undefined);
    }
  }
  return and(parts);
}

// Every node a position's schema node stands for once references and combinators are opened:
// where a key or index is looked up. With a `view`, a `then` or `else` the mapping's keys rule out
// is left closed; `trace` records each choice, so equal choices can share one position.
function leaves(
  node: JsonSchema,
  out: Set<JsonSchema> = new Set(),
  view?: MapView,
  trace?: string[],
): Set<JsonSchema> {
  if (out.has(node)) return out;
  out.add(node);
  if (typeof node.$ref === "string") {
    const r = resolveRef(node.$ref, fileOf(node));
    if (r) leaves(tagged(r.node, r.file), out, view, trace);
  }
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    for (const member of subschemas(node, key)) leaves(member, out, view, trace);
  }
  const chosen = view && isSchema(node.if) ? holds(node.if, view) : undefined;
  if (trace && view && isSchema(node.if)) trace.push(String(chosen));
  if (chosen !== false)
    for (const member of subschemas(node, "then")) leaves(member, out, view, trace);
  if (chosen !== true)
    for (const member of subschemas(node, "else")) leaves(member, out, view, trace);
  return out;
}

function leafSetOf(pos: Position): readonly JsonSchema[] {
  if (pos.leafSet === undefined) {
    const out = new Set<JsonSchema>();
    for (const node of pos.nodes) leaves(node, out);
    pos.leafSet = [...out];
  }
  return pos.leafSet;
}

/**
 * The position for a mapping whose keys are known: conditional branches its keys decide are
 * chosen (a node with `method` is a route, so the keys of a collection are not looked up in it).
 * Positions refined for the same choices are one object.
 */
export function refinePosition(pos: Position | undefined, view: MapView): Position | undefined {
  if (pos === undefined || pos.data) return pos;
  const trace: string[] = [];
  const out = new Set<JsonSchema>();
  for (const node of pos.nodes) leaves(node, out, view, trace);
  const signature = trace.join(",");
  const hit = pos.refined.get(signature);
  if (hit) return hit;
  const refined: Position = {
    data: pos.data,
    types: pos.types,
    nodes: pos.nodes,
    children: new Map(),
    leafSet: [...out],
    refined: new Map(),
  };
  pos.refined.set(signature, refined);
  return refined;
}

function isEmpty(node: JsonSchema): boolean {
  return Object.keys(node).every((k) => ANNOTATIONS.has(k));
}

function position(nodes: JsonSchema[]): Position | undefined {
  const live = nodes.filter((n) => !isConflict(n));
  if (live.length === 0) return undefined;
  const data = live.every(isEmpty);
  return {
    data,
    types: data ? undefined : union(live.map(typesOf)),
    nodes: live,
    children: new Map(),
    refined: new Map(),
  };
}

/** The position of a file's root. */
export function rootPosition(kind: PositionKind): Position | undefined {
  const root = schemaFiles()[kind];
  return position([tagged(root, kind)]);
}

const patterns = new Map<string, RegExp>();
function patternOf(pattern: string): RegExp {
  let re = patterns.get(pattern);
  if (!re) {
    re = new RegExp(pattern, "u");
    patterns.set(pattern, re);
  }
  return re;
}

function stepNodes(from: Position, segment: string, isIndex: boolean): JsonSchema[] {
  const found: JsonSchema[] = [];
  for (const leaf of leafSetOf(from)) {
    if (isIndex) {
      // `items` is the one form the grammar writes for lists.
      if (isSchema(leaf.items)) found.push(tagged(leaf.items, fileOf(leaf)));
      continue;
    }
    const properties = isSchema(leaf.properties) ? leaf.properties : {};
    let matched = false;
    if (Object.hasOwn(properties, segment)) {
      const p = properties[segment];
      if (isSchema(p)) found.push(tagged(p, fileOf(leaf)));
      matched = true;
    }
    if (isSchema(leaf.patternProperties)) {
      for (const [pattern, schema] of Object.entries(leaf.patternProperties)) {
        if (isSchema(schema) && patternOf(pattern).test(segment)) {
          found.push(tagged(schema, fileOf(leaf)));
          matched = true;
        }
      }
    }
    if (!matched && isSchema(leaf.additionalProperties)) {
      found.push(tagged(leaf.additionalProperties, fileOf(leaf)));
    }
  }
  return found;
}

function mentions(from: Position, segment: string): boolean {
  for (const leaf of leafSetOf(from)) {
    if (isSchema(leaf.properties) && Object.hasOwn(leaf.properties, segment)) return true;
    if (isSchema(leaf.patternProperties)) return true;
  }
  return false;
}

/**
 * The position of a key (`isIndex` false) or list index of `from`; undefined when the schemas say
 * nothing about it. Memoised: a name no schema mentions shares one entry, so a catalogue of many
 * names costs one lookup.
 */
export function stepPosition(
  from: Position | undefined,
  segment: string,
  isIndex: boolean,
): Position | undefined {
  if (from === undefined) return undefined;
  const slot = isIndex ? "\0item" : mentions(from, segment) ? segment : "\0other";
  if (from.children.has(slot)) return from.children.get(slot);
  const next = position(stepNodes(from, segment, isIndex));
  from.children.set(slot, next);
  return next;
}

/** The position of a pointer given as unescaped segments (a list index is a decimal segment). */
export function positionAt(kind: PositionKind, segments: string[]): Position | undefined {
  let pos = rootPosition(kind);
  for (const s of segments) pos = stepPosition(pos, s, false);
  return pos;
}

/** YAML type of a resolved scalar, the vocabulary of a position's `types`. */
export function scalarType(value: unknown): ScalarType | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return undefined;
}

/** What the position accepts, written for a message: `a string`, `an integer or a string`. */
export function expectedTypes(pos: Position): string[] | undefined {
  const types = pos.types;
  if (types === undefined) return undefined;
  const words: Record<TypeName, string> = {
    string: "a string",
    number: "a number",
    integer: "an integer",
    boolean: "a boolean",
    null: "null",
    object: "a mapping",
    array: "a list",
  };
  return [...types].sort().map((t) => words[t]);
}

/** True when a scalar of this type is a type the position does not accept. */
export function refusesScalar(pos: Position | undefined, type: ScalarType): boolean {
  const types = pos?.types;
  if (types === undefined || types.size === 0) return false;
  if (types.has(type)) return false;
  // A whole number is a number; an integer position does not take a fraction.
  return !(type === "integer" && types.has("number"));
}
