// Where the authoring schemas expect which type (ADR 0002 section 3, P6), and where they expect
// any value (a data position, marked `DATA` by the grammar: a payload, an example, a default).
//
// The loader reads the schemas of `@seampact/spec/authoring` as plain JSON, without validating
// anything (the validate stage owns that). This is a deliberate, bounded interpreter: it models
// the keywords in `POSITION_KEYWORDS` and ignores, by name, the value constraints in
// `IGNORED_KEYWORDS`, which never change where a key leads nor which type a scalar has there.
// positions.test.ts fails on any other keyword the authoring schemas start to use.
//
// A position is one schema node, reached from the file's root schema one key or index at a time.
// A step keeps the shape of the combinators: the node's own `properties`, `patternProperties`,
// `additionalProperties` or `items`, its `$ref` and its `allOf` members all hold together (their
// results join as an `allOf`); the members of an `anyOf` or a `oneOf`, and the `then` and `else`
// branches, are alternatives (an `anyOf`). An alternative that does not constrain the child at all
// makes the whole alternative unknown, so a key is never typed by one branch while another branch
// would take any value there. An alternative that cannot hold the child (a string form, when a key
// is read; a key its `additionalProperties: false` refuses or a conflict marker forbids) is dropped;
// in constraints that hold together, it makes the child impossible (the validate stage reports it).
//
// A branch chosen by the keys of the mapping being read (`if` with `required` or a `const`
// property: a node with `method` is a route) is chosen with `refinePosition`; an `if` on the type
// of the value holding the key (a mapping, or a list) is chosen when stepping. A condition that
// cannot be decided keeps every branch.
//
// The reading is conservative on purpose: a type is expected only when every route to the position
// states one. Anything the walk cannot decide (an unknown key, a node that states no type) is left
// to the validate stage, so a correctly typed scalar is never refused here.

import {
  AUTHORING_FILES,
  type AuthoringFile,
  authoringSchemas,
  DATA,
  type JsonSchema,
} from "@seampact/spec/authoring";
import type { LayerSchemaKind } from "../raw-tree.js";

export type ScalarType = "string" | "number" | "integer" | "boolean" | "null";
type TypeName = ScalarType | "object" | "array";

/** The file kinds a layer is read as (`schemaKindOf`). */
export type PositionKind = LayerSchemaKind;

// The types a node accepts, or `undefined` when it states none.
type Types = ReadonlySet<TypeName> | undefined;

export interface Position {
  /** A data position, marked `DATA` by the grammar: anything below is data. */
  readonly data: boolean;
  /** What the position accepts, `undefined` when it cannot say. */
  readonly types: Types;
  /** The schema node of the position; several nodes are joined as an `allOf` or an `anyOf`. */
  readonly node: JsonSchema;
  readonly children: Map<string, Position | undefined>;
  /** Every node reached through references and combinators; lazily filled. */
  leafSet?: readonly JsonSchema[];
  /** The positions refined for one set of branch choices, by choice. */
  readonly refined: Map<string, Position>;
  /** The `if` nodes the mapping's keys decide, with the branch taken (refined positions). */
  readonly choices?: ReadonlyMap<JsonSchema, boolean>;
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

/** The schema keywords the reading models. */
export const POSITION_KEYWORDS: readonly string[] = [
  "$ref",
  "allOf",
  "anyOf",
  "oneOf",
  "if",
  "then",
  "else",
  "not",
  "type",
  "enum",
  "const",
  "properties",
  "patternProperties",
  "additionalProperties",
  "items",
  "required",
  "title",
];

/**
 * The schema keywords the reading ignores on purpose: annotations, and value constraints that
 * neither lead to another node nor change a scalar's type (the validate stage checks them).
 */
export const IGNORED_KEYWORDS: readonly string[] = [
  "$schema",
  "$defs",
  "$comment",
  "description",
  "pattern",
  "minLength",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "minItems",
  "minProperties",
  "maxProperties",
  "propertyNames",
];

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

function referenced(node: JsonSchema): JsonSchema | undefined {
  if (typeof node.$ref !== "string") return undefined;
  const r = resolveRef(node.$ref, fileOf(node));
  return r ? tagged(r.node, r.file) : undefined;
}

// A conflict marker (`not: {}`): the key may not appear in this case, whatever its type.
function isConflict(node: JsonSchema): boolean {
  return isSchema(node.not) && Object.keys(node.not).length === 0;
}

// A node fragment whose kind an include brings (`node.schema.json#/$defs/includedNode`) lists the
// keys of every node kind with no constraint, for an editor; the kinds themselves type those keys,
// so its placeholders never count here.
let includedNode: JsonSchema | undefined;
function isIncludedNode(node: JsonSchema): boolean {
  includedNode ??= resolveRef("node.schema.json#/$defs/includedNode", "node")?.node;
  return node === includedNode;
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
    const target = referenced(node);
    if (target) types = intersect(types, typesOf(target));
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

type Container = "object" | "array";

// Whether a condition (an `if`) holds for the value holding the child: true, false, or undefined
// when it cannot be told. `container` is that value's type; `view`, when given, shows its keys.
// Only the forms the grammar writes are understood.
function holds(cond: unknown, container: Container, view?: MapView): boolean | undefined {
  if (cond === true || cond === false) return cond;
  if (!isSchema(cond)) return undefined;
  const parts: (boolean | undefined)[] = [];
  for (const [keyword, value] of Object.entries(cond)) {
    switch (keyword) {
      case "$comment":
      case "description":
      case "title":
        break;
      case "type": {
        const names = Array.isArray(value) ? value : [value];
        parts.push(names.includes(container));
        break;
      }
      case "required": {
        if (!view) {
          parts.push(undefined);
          break;
        }
        const keys = Array.isArray(value) ? (value as string[]) : [];
        parts.push(and(keys.map((k) => (view.has(k) ? true : view.open ? undefined : false))));
        break;
      }
      case "properties": {
        if (!view) {
          parts.push(undefined);
          break;
        }
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
        const members = (Array.isArray(value) ? value : []).map((m) => holds(m, container, view));
        if (keyword === "allOf") parts.push(and(members));
        else if (members.some((m) => m === true)) parts.push(true);
        else parts.push(members.every((m) => m === false) ? false : undefined);
        break;
      }
      case "not": {
        const inner = holds(value, container, view);
        parts.push(inner === undefined ? undefined : !inner);
        break;
      }
      default:
        parts.push(undefined);
    }
  }
  return and(parts);
}

// Every node a schema node stands for once references and combinators are opened. With a `view`,
// a `then` or `else` the mapping's keys rule out is left closed, each choice made is recorded in
// `choices`, and `trace` records the choices in order, so equal choices can share one position.
function leaves(
  node: JsonSchema,
  out: Set<JsonSchema> = new Set(),
  view?: MapView,
  trace?: string[],
  choices?: Map<JsonSchema, boolean>,
): Set<JsonSchema> {
  if (out.has(node)) return out;
  out.add(node);
  const target = referenced(node);
  if (target) leaves(target, out, view, trace, choices);
  for (const key of ["allOf", "anyOf", "oneOf"]) {
    for (const member of subschemas(node, key)) leaves(member, out, view, trace, choices);
  }
  const chosen = view && isSchema(node.if) ? holds(node.if, "object", view) : undefined;
  if (trace && view && isSchema(node.if)) trace.push(String(chosen));
  if (choices && chosen !== undefined) choices.set(node, chosen);
  if (chosen !== false)
    for (const member of subschemas(node, "then")) leaves(member, out, view, trace, choices);
  if (chosen !== true)
    for (const member of subschemas(node, "else")) leaves(member, out, view, trace, choices);
  return out;
}

function leafSetOf(pos: Position): readonly JsonSchema[] {
  if (pos.leafSet === undefined) pos.leafSet = [...leaves(pos.node)];
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
  const choices = new Map<JsonSchema, boolean>();
  const out = leaves(pos.node, new Set(), view, trace, choices);
  const signature = trace.join(",");
  const hit = pos.refined.get(signature);
  if (hit) return hit;
  const refined: Position = {
    data: pos.data,
    types: pos.types,
    node: pos.node,
    children: new Map(),
    leafSet: [...out],
    refined: new Map(),
    choices,
  };
  pos.refined.set(signature, refined);
  return refined;
}

// What a node says about one child: a schema node, no constraint at all, or no child possible.
const FREE: unique symbol = Symbol("no constraint");
const NONE: unique symbol = Symbol("no child possible");
type Step = JsonSchema | typeof FREE | typeof NONE;

// Constraints that all hold: a child impossible in one is impossible; no constraint adds nothing.
function allOfSteps(parts: Step[]): Step {
  if (parts.includes(NONE)) return NONE;
  const nodes = parts.filter(isSchema);
  if (nodes.length === 0) return FREE;
  return nodes.length === 1 ? (nodes[0] as JsonSchema) : { allOf: nodes };
}

// Alternatives: an impossible one is dropped; one that constrains nothing frees the child.
function anyOfSteps(parts: Step[]): Step {
  const live = parts.filter((p) => p !== NONE);
  if (live.length === 0) return NONE;
  if (live.includes(FREE)) return FREE;
  const nodes = live.filter(isSchema);
  return nodes.length === 1 ? (nodes[0] as JsonSchema) : { anyOf: nodes };
}

// The node's own keywords for the child.
function ownStep(node: JsonSchema, segment: string, isIndex: boolean): Step {
  const file = fileOf(node);
  // A conflict marker for the key: the key may not appear in this case.
  const asStep = (value: unknown): Step =>
    value === false || (isSchema(value) && isConflict(value))
      ? NONE
      : isSchema(value)
        ? tagged(value, file)
        : FREE;
  // `items` is the one form the grammar writes for lists.
  if (isIndex) return asStep(node.items);
  const parts: Step[] = [];
  const properties = isSchema(node.properties) ? node.properties : {};
  if (Object.hasOwn(properties, segment)) parts.push(asStep(properties[segment]));
  if (isSchema(node.patternProperties)) {
    for (const [pattern, schema] of Object.entries(node.patternProperties)) {
      if (patternOf(pattern).test(segment)) parts.push(asStep(schema));
    }
  }
  if (parts.length === 0) return asStep(node.additionalProperties);
  return allOfSteps(parts);
}

const stepping = new Set<JsonSchema>();

function stepNode(
  node: JsonSchema,
  segment: string,
  isIndex: boolean,
  choices: ReadonlyMap<JsonSchema, boolean> | undefined,
): Step {
  if (isIncludedNode(node)) return NONE;
  const container: Container = isIndex ? "array" : "object";
  const types = typesOf(node);
  if (types !== undefined && !types.has(container)) return NONE;
  // A reference cycle constrains nothing more on its second visit.
  if (stepping.has(node)) return FREE;
  stepping.add(node);
  try {
    const step = (n: JsonSchema) => stepNode(n, segment, isIndex, choices);
    const parts: Step[] = [ownStep(node, segment, isIndex)];
    const target = referenced(node);
    if (target) parts.push(step(target));
    for (const member of subschemas(node, "allOf")) parts.push(step(member));
    for (const key of ["anyOf", "oneOf"]) {
      if (key in node) parts.push(anyOfSteps(subschemas(node, key).map(step)));
    }
    if (isSchema(node.if)) {
      const chosen = choices?.get(node) ?? holds(node.if, container);
      const branch = (key: string): Step => {
        const b = subschemas(node, key)[0];
        return b ? step(b) : FREE;
      };
      const branches: Step[] = [];
      if (chosen !== false) branches.push(branch("then"));
      if (chosen !== true) branches.push(branch("else"));
      parts.push(anyOfSteps(branches));
    }
    return allOfSteps(parts);
  } finally {
    stepping.delete(node);
  }
}

// A data position is one the grammar marks; joined nodes are data when a constraint that holds
// marks it, or when every alternative does.
function isData(node: JsonSchema): boolean {
  if (node.title === DATA) return true;
  if (Array.isArray(node.allOf)) return subschemas(node, "allOf").some(isData);
  if (Array.isArray(node.anyOf)) return subschemas(node, "anyOf").every(isData);
  return false;
}

function position(step: Step): Position | undefined {
  if (!isSchema(step)) return undefined;
  const data = isData(step);
  return {
    data,
    types: data ? undefined : typesOf(step),
    node: step,
    children: new Map(),
    refined: new Map(),
  };
}

/** The position of one schema node, read as the root of a document. */
export function positionOf(node: JsonSchema): Position | undefined {
  return position(node);
}

const roots = new Map<PositionKind, Position | undefined>();

/** The position of a file's root, one per kind: what is learnt below it is kept. */
export function rootPosition(kind: PositionKind): Position | undefined {
  if (!roots.has(kind)) roots.set(kind, position(tagged(schemaFiles()[kind], kind)));
  return roots.get(kind);
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
  const next = position(stepNode(from.node, segment, isIndex, from.choices));
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

/**
 * True when the position's integer form takes `n`: some node of the position that types an
 * integer bounds it with `minimum`, `maximum` or their exclusive forms, and `n` is within one of
 * them (no such node: any integer).
 */
export function admitsInteger(pos: Position, n: number): boolean {
  const forms = leafSetOf(pos).filter((node) => {
    const t = node.type;
    return t === "integer" || (Array.isArray(t) && t.includes("integer"));
  });
  if (forms.length === 0) return true;
  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  return forms.some((node) => {
    const min = num(node.minimum);
    const max = num(node.maximum);
    const xmin = num(node.exclusiveMinimum);
    const xmax = num(node.exclusiveMaximum);
    return (
      (min === undefined || n >= min) &&
      (max === undefined || n <= max) &&
      (xmin === undefined || n > xmin) &&
      (xmax === undefined || n < xmax)
    );
  });
}

/** True when a scalar of this type is a type the position does not accept. */
export function refusesScalar(pos: Position | undefined, type: ScalarType): boolean {
  const types = pos?.types;
  if (types === undefined || types.size === 0) return false;
  if (types.has(type)) return false;
  // A whole number is a number; an integer position does not take a fraction.
  return !(type === "integer" && types.has("number"));
}
