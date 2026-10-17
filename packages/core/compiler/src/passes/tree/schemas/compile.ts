import type { IrWriter } from "@seampact/spec/ir";
import {
  canonicalId,
  deriveName,
  type Name,
  type Role,
  splitName,
  suffixWords,
} from "@seampact/spec/naming";
import { pipelineCopy, pipelineParseSize } from "../../../pipeline/seam.js";
import type { TreeSchemasReservation } from "./core.js";
import {
  type TreeSchemasRaw,
  type TreeSchemasRawObject,
  type TreeSchemasReporter,
  treeSchemasEntries,
  treeSchemasIsObject,
  treeSchemasMember,
  treeSchemasPointer,
} from "./raw.js";
import { TreeSchemasScalars, treeSchemasDocs } from "./scalars.js";

// The schema compiler of tree.schemas (ADR 0003, ADR 0004 section 5): every written schema becomes a type use;
// objects, maps and unions are named schemas, an inline one hoisted under the name its position derives (ADR 0007
// section 3). A declared scalar, array, enum use, opaque value or file is inlined at each use.
//
// Derived objects (`pick`, `omit`) are named objects whose merge is not compiled yet: a reference to one is a
// `ref` use, and no schema is written for it.

/** Where a schema sits, which decides the marks it may carry and the unions it may be. */
export type TreeSchemasPlace =
  | "declared"
  | "property"
  | "variant"
  | "nested"
  | "routeInput"
  | "position";

export interface TreeSchemasPosition {
  pointer: string;
  /** The name an inline object, map or union here is hoisted under; none where no name is derived. */
  name: Name | undefined;
  place: TreeSchemasPlace;
  /** The written name of a declared schema, which is its id. */
  id?: string;
}

export interface TreeSchemasCompiled {
  use: IrWriter.TypeUse;
  /** A declared scalar marked sensitive: a property holding it is sensitive. */
  sensitive: boolean;
  /** A union whose tag is a request header, which only a route's whole input may be. */
  headerUnion: boolean;
}

type Shape =
  | "reference"
  | "derived"
  | "opaque"
  | "file"
  | "enum"
  | "union"
  | "allOf"
  | "object"
  | "map"
  | "array"
  | "scalar";

type NamedKind = "object" | "map" | "union";

interface DeclaredTarget {
  id: string;
  kind: NamedKind | undefined;
  value: TreeSchemasRaw | undefined;
  /** An alias on the way to the target is nullable; the target's own `nullable` is read where it compiles. */
  nullable: boolean;
}

const SHAPE_TEXT: Readonly<Record<Shape, string>> = {
  reference: "a reference",
  derived: "a derived object",
  opaque: "an opaque value",
  file: "a file",
  enum: "an enum use",
  union: "a union",
  allOf: "a merged object",
  object: "an object",
  map: "a map",
  array: "an array",
  scalar: "a scalar",
};

// Annotations and marks any shape may hold; where each mark may sit is checked apart (`checkMarks`).
const COMMON_KEYWORDS = new Set([
  "title",
  "description",
  "deprecated",
  "default",
  "examples",
  "nullable",
  "sensitive",
  "codeName",
  "restrictedTo",
  "lint",
]);

const NAMED = ["typeName", "unknownKeys"];
const SHAPE_KEYWORDS: Readonly<Record<Shape, readonly string[]>> = {
  reference: ["$ref", "unknownKeys"],
  derived: ["pick", "omit", "required", "properties", ...NAMED],
  opaque: ["opaque"],
  file: ["file"],
  enum: ["enum"],
  union: ["oneOf", "discriminator", ...NAMED],
  allOf: ["allOf", "type", ...NAMED],
  object: ["type", "properties", "required", ...NAMED],
  map: ["type", "additionalProperties", "propertyNames", ...NAMED],
  array: ["type", "items", "minItems", "maxItems"],
  scalar: [
    "type",
    "format",
    "minLength",
    "maxLength",
    "pattern",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "contentMediaType",
    "contentSchema",
  ],
};

// The shapes written as a schema of their own, which holds their examples and docs; a derived object's schema is
// written by a later step.
const SCHEMA_WRITING_SHAPES: ReadonlySet<Shape> = new Set([
  "object",
  "map",
  "union",
  "allOf",
  "derived",
]);

// The written annotations, each with where the author moves it when this position cannot keep it.
const ANNOTATION_FIX: Readonly<Record<string, string>> = {
  deprecated: "mark the property that holds this schema instead",
  examples: "put the example on the object that holds this value",
  title: "document the property or the schema that holds this one",
  description: "document the property or the schema that holds this one",
};

const SCALAR_TYPES = new Set(["string", "integer", "number", "boolean"]);
const HEADER_SOURCE = /^header\.(.+)$/;
const JSON_MEDIA = "application/json";

const has = (value: TreeSchemasRawObject, key: string): boolean => Object.hasOwn(value, key);

// A string member the authoring schema requires: validate refuses a contract without it before this half runs.
function guaranteedString(value: TreeSchemasRaw | undefined, key: string, pointer: string): string {
  if (typeof value === "string") return value;
  throw new Error(`tree.schemas found no string '${key}' at ${pointer}, which validate guarantees`);
}

/** The shape a written schema mapping has, or undefined for none (ADR 0003 section 2). */
export function treeSchemasShapeOf(value: TreeSchemasRawObject): Shape | undefined {
  if (has(value, "$ref")) return "reference";
  if (has(value, "pick") || has(value, "omit")) return "derived";
  if (has(value, "opaque")) return "opaque";
  if (has(value, "file")) return "file";
  if (has(value, "enum")) return "enum";
  if (has(value, "oneOf")) return "union";
  if (has(value, "allOf")) return "allOf";
  if (value.type === "object") return has(value, "additionalProperties") ? "map" : "object";
  if (value.type === "array") return "array";
  if (typeof value.type === "string" && SCALAR_TYPES.has(value.type)) return "scalar";
  return has(value, "format") ? "scalar" : undefined;
}

/** Whether compiling `value` hoists an inline object, map or union. */
export function treeSchemasNeedsHoist(value: TreeSchemasRaw | undefined): boolean {
  if (!treeSchemasIsObject(value)) return false;
  const shape = treeSchemasShapeOf(value);
  if (shape === "array") return treeSchemasNeedsHoist(value.items);
  if (shape === "scalar") return treeSchemasNeedsHoist(value.contentSchema);
  return shape === "object" || shape === "map" || shape === "union" || shape === "allOf";
}

// The words a child name starts with: the parent's segments, then its role's default suffix words (`RolesParams`
// gives `roles params`), so the child of a derived schema never meets the child of its declared namesake (ADR 0007,
// amendment 2026-10-12, item 10).
const wordsOf = (name: Name | undefined): string[] | undefined =>
  name === undefined ? undefined : [...name.segments, ...suffixWords(name)];

interface Claim {
  id: string;
  pointer: string;
  /** Set on a reserved id, whose pointer may be a core one that locates nothing. */
  reservation?: TreeSchemasReservation;
}

// The keys a schema claims: its id, and the identifier it gives in every language as its words, since two names
// with equal words collide (ADR 0007 section 2) whatever their spelling.
const claimKeys = (id: string, name: Name): string[] => [
  `id ${id}`,
  `words ${[...name.segments, ...suffixWords(name)].join(" ")}`,
];

// What the author renames when a derived name meets another; an operation-derived name also takes operationId.
const COLLISION_FIX: Partial<Readonly<Record<Role, string>>> = {
  property: "rename the schema or the property",
  variant: "rename the schema or the variant's tag",
  item: "rename the schema or the array's owner",
  value: "rename the schema or the map's owner",
  params: "rename the schema, or the right, rule or error",
};
const OPERATION_COLLISION_FIX = "rename the schema or set operationId";

const reservedMessage = (what: string, id: string, reservation: TreeSchemasReservation): string =>
  id === reservation.id
    ? `${what} '${id}' is reserved for ${reservation.purpose}`
    : `${what} '${id}' gives the same identifier as '${reservation.id}', reserved for ${reservation.purpose}`;

const childName = (
  words: string[] | undefined,
  own: readonly string[],
  role: "property" | "variant" | "item" | "value",
): Name | undefined =>
  words === undefined || (own.length === 0 && (role === "property" || role === "variant"))
    ? undefined
    : deriveName([...words, ...own], role);

const sameProperty = (a: IrWriter.Property, b: IrWriter.Property): boolean => {
  const comparable = ({ origin: _origin, optional: _optional, ...rest }: IrWriter.Property) =>
    JSON.stringify(rest);
  return comparable(a) === comparable(b);
};

// The IR form of a name: `status` only on a response name.
const irName = ({ segments, role, status }: Name): IrWriter.Name => ({
  segments: [...segments],
  role,
  ...(status === undefined ? {} : { status }),
});

const withoutNullable = (use: IrWriter.TypeUse): { use: IrWriter.TypeUse; nullable: boolean } => {
  if (use.kind === "opaque" || use.nullable !== true) return { use, nullable: false };
  const copy = { ...use };
  delete copy.nullable;
  return { use: copy, nullable: true };
};

/** The schemas of one api, compiled once each, and the type use at each schema position compiled. */
export class TreeSchemasCompiler {
  /** Every named schema written so far, by id, children before their parent. */
  readonly schemas = new Map<string, IrWriter.Schema>();
  /** The type use at each schema position the half answers for. */
  readonly uses = new Map<string, IrWriter.TypeUse>();
  readonly scalars: TreeSchemasScalars;

  private readonly catalogue: TreeSchemasRaw | undefined;
  private readonly enums: TreeSchemasRaw | undefined;
  private readonly declared = new Map<string, TreeSchemasCompiled | "compiling" | undefined>();
  /**
   * The schema holding each id and each identifier (by its words): every declared schema, then each hoisted one.
   * Both are checked: `AB` declared gives the words `ab`, the hoisted `A.b` gives `a b`, and both have the id `AB`.
   */
  private readonly claims = new Map<string, Claim>();
  /** Every declared schema with its keys, since `claims` keeps only the first holder of a key. */
  private readonly declaredClaims: { claim: Claim; keys: string[] }[] = [];
  private readonly refusedReserved = new Set<string>();
  private readonly derived = new Set<string>();
  private readonly bodyTags: {
    pointer: string;
    property: string;
    variants: IrWriter.UnionVariant[];
  }[] = [];

  constructor(
    merged: TreeSchemasRawObject,
    private readonly reporter: TreeSchemasReporter,
  ) {
    this.catalogue = treeSchemasMember(merged, "schemas");
    this.enums = treeSchemasMember(merged, "enums");
    this.scalars = new TreeSchemasScalars(treeSchemasMember(merged, "scalars"), reporter);
    for (const [id] of treeSchemasEntries(this.catalogue)) {
      const claim = { id, pointer: treeSchemasPointer("/schemas", id) };
      const keys = claimKeys(id, { segments: splitName(id), role: "schema" });
      this.declaredClaims.push({ claim, keys });
      for (const key of keys) {
        if (!this.claims.has(key)) this.claims.set(key, claim);
      }
    }
  }

  /**
   * Reserves the core schema ids and seeds their core schemas (ADR 0004 section 13). A declared schema with a
   * reserved id or identifier is refused and not compiled; a hoist onto one is refused, but for the layer params a
   * reservation yields to.
   */
  reserve(reservations: readonly TreeSchemasReservation[]): void {
    for (const reservation of reservations) {
      const keys = claimKeys(reservation.id, reservation.name);
      this.seedReservation(reservation);
      if (reservation.yields) continue;

      for (const { claim: declared, keys: declaredKeys } of this.declaredClaims) {
        if (this.declared.has(declared.id)) continue;
        if (declaredKeys.some((key) => keys.includes(key)))
          this.refuseDeclaredReserved(declared, reservation);
      }
      const claim: Claim = { id: reservation.id, pointer: reservation.pointer, reservation };
      for (const key of keys) this.claims.set(key, claim);
    }
  }

  // A yielding reservation is only seeded: a declaration or hoist under its id replaces the seed.
  private seedReservation(reservation: TreeSchemasReservation): void {
    if (reservation.seed !== undefined) this.schemas.set(reservation.id, reservation.seed);
  }

  private refuseDeclaredReserved(declared: Claim, reservation: TreeSchemasReservation): void {
    this.declared.set(declared.id, undefined);
    this.refusedReserved.add(declared.id);
    this.reporter.error({
      rule: "schema-reserved",
      pointer: declared.pointer,
      message: reservedMessage("the schema", declared.id, reservation),
      fix: "declare the schema under another name",
    });
  }

  /** Compiles every declared schema of the `schemas` catalogue, in written order. */
  compileCatalogue(): void {
    for (const [id] of treeSchemasEntries(this.catalogue)) {
      const compiled = this.compileDeclared(id);
      if (compiled !== undefined)
        this.uses.set(treeSchemasPointer("/schemas", id), structuredClone(compiled.use));
    }
  }

  /** Compiles the schema at a position and records its use there. */
  position(value: TreeSchemasRaw, position: TreeSchemasPosition): void {
    const compiled = this.compileAt(value, position);
    if (compiled !== undefined) this.uses.set(position.pointer, compiled.use);
  }

  /**
   * Compiles a fields map (ADR 0002 section 4) into an object hoisted under `name` (a field ending with `?` is
   * optional), or the object schema a string names, and records its use.
   */
  fields(value: TreeSchemasRaw, pointer: string, name: Name): void {
    const position: TreeSchemasPosition = { pointer, name, place: "position" };
    if (typeof value === "string") {
      const compiled = this.reference(value, position);
      if (compiled === undefined) return;
      if (compiled.use.kind !== "ref" || this.kindOf(compiled.use.schema) !== "object") {
        this.reporter.error({
          rule: "fields-schema",
          pointer,
          message: `'${value}' is not an object schema, whose properties would be the fields`,
          fix: "name an object schema, or write a fields map",
        });
        return;
      }
      this.uses.set(pointer, compiled.use);
      return;
    }
    const entries = treeSchemasEntries(value).map(([key, field]) => {
      const optional = key.endsWith("?");
      return { wire: optional ? key.slice(0, -1) : key, key, field, required: !optional };
    });
    const properties = this.propertyList(entries, pointer, wordsOf(name));
    if (properties === undefined) return;
    const compiled = this.objectSchema(properties, undefined, position);
    if (compiled !== undefined) this.uses.set(pointer, compiled.use);
  }

  /** The checks that need every schema: union tags, required cycles and declared names (ADR 0007 section 2). */
  finish(): void {
    this.checkBodyTags();
    this.checkRequiredCycles();
    this.checkNames(
      treeSchemasEntries(this.catalogue)
        .map(([id]) => id)
        .filter((id) => !this.refusedReserved.has(id)),
      "/schemas",
      "schemas",
    );
    this.checkNames(
      this.scalars.all().map((scalar) => scalar.id),
      "/scalars",
      "named formats",
    );
  }

  private compileAt(
    value: TreeSchemasRaw,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    if (typeof value === "string") return this.reference(value, position);
    const shape = treeSchemasIsObject(value) ? treeSchemasShapeOf(value) : undefined;
    if (!treeSchemasIsObject(value) || shape === undefined) {
      this.reporter.error({
        rule: "schema-shape",
        pointer: position.pointer,
        message: "the schema has no shape: no type, reference, enum, oneOf, allOf, opaque or file",
        fix: "write a 'type' (with 'properties' for an object), a schema name, or '{ opaque: <reason> }'",
      });
      return undefined;
    }
    if (!this.checkKeywords(value, shape, position.pointer)) return undefined;
    if (!this.checkMarks(value, shape, position)) return undefined;
    if (!this.checkAnnotations(value, shape, position)) return undefined;

    const compiled = this.compileShape(value, shape, position);
    if (compiled === undefined) return undefined;
    if (value.nullable === true && compiled.use.kind !== "opaque") compiled.use.nullable = true;
    if (value.sensitive === true && position.place === "declared") compiled.sensitive = true;
    return compiled;
  }

  private compileShape(
    value: TreeSchemasRawObject,
    shape: Shape,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    const plain = (use: IrWriter.TypeUse): TreeSchemasCompiled => ({
      use,
      sensitive: false,
      headerUnion: false,
    });
    const { pointer } = position;
    switch (shape) {
      case "reference":
        return this.reference(guaranteedString(value.$ref, "$ref", pointer), position);
      case "derived":
        return this.claimed(position, "object")
          ? plain(this.referenceUse(this.idOf(position)))
          : undefined;
      case "opaque": {
        const reason = guaranteedString(value.opaque, "opaque", pointer);
        return plain({ kind: "opaque", reason, origin: this.reporter.origin(pointer) });
      }
      case "file":
        return this.file(value.file, pointer, plain);
      case "enum":
        return this.enumUse(value.enum, treeSchemasPointer(pointer, "enum"), plain);
      case "union":
        return this.union(value, position);
      case "allOf":
        return this.allOf(value, position);
      case "object":
        return this.object(value, position);
      case "map":
        return this.map(value, position);
      case "array":
        return this.array(value, position, plain);
      case "scalar":
        return this.scalar(value, position, plain);
    }
  }

  private checkKeywords(value: TreeSchemasRawObject, shape: Shape, pointer: string): boolean {
    const allowed = SHAPE_KEYWORDS[shape];
    const misplaced = Object.keys(value).filter(
      (key) => !key.startsWith("x-") && !COMMON_KEYWORDS.has(key) && !allowed.includes(key),
    );
    if (shape === "allOf" && value.type !== undefined && value.type !== "object")
      misplaced.push("type");
    for (const key of misplaced) {
      this.reporter.error({
        rule: "schema-keyword",
        pointer: treeSchemasPointer(pointer, key),
        message: `'${key}' has no meaning on ${SHAPE_TEXT[shape]}`,
        fix: `remove '${key}'`,
      });
    }
    return misplaced.length === 0;
  }

  // ADR 0003 sections 2, 6 and 10: where each mark may sit.
  private checkMarks(
    value: TreeSchemasRawObject,
    shape: Shape,
    { pointer, place }: TreeSchemasPosition,
  ): boolean {
    const named = shape === "object" || shape === "map" || shape === "union" || shape === "allOf";
    const refused: { key: string; where: string }[] = [];
    for (const key of ["codeName", "restrictedTo", "default"]) {
      if (has(value, key) && place !== "property") refused.push({ key, where: "a property" });
    }
    if (
      has(value, "sensitive") &&
      place !== "property" &&
      !(place === "declared" && shape === "scalar")
    )
      refused.push({ key: "sensitive", where: "a property or a declared scalar schema" });
    if (has(value, "typeName") && !(place === "declared" && (named || shape === "derived")))
      refused.push({ key: "typeName", where: "a declared object, map or union schema" });
    if (shape === "opaque") {
      for (const key of ["sensitive", "restrictedTo", "default"]) {
        if (has(value, key) && place === "property")
          refused.push({ key, where: "a checked value: an opaque value holds no mark or default" });
      }
    }
    for (const { key, where } of refused) {
      this.reporter.error({
        rule: "mark-position",
        pointer: treeSchemasPointer(pointer, key),
        message: `'${key}' sits on ${where}`,
        fix: `remove '${key}' here`,
      });
    }
    return refused.length === 0;
  }

  // ADR 0004: a written annotation the IR has no member for here is refused, never dropped. `deprecated` is held by
  // a property only; `examples` by a written schema (an object, map or union); docs by a property or a written
  // schema.
  private checkAnnotations(
    value: TreeSchemasRawObject,
    shape: Shape,
    { pointer, place }: TreeSchemasPosition,
  ): boolean {
    const writesSchema = SCHEMA_WRITING_SHAPES.has(shape);
    const held = new Set([
      ...(place === "property" ? ["deprecated", "title", "description"] : []),
      ...(writesSchema ? ["examples", "title", "description"] : []),
    ]);
    return this.refuseAnnotations(value, `${SHAPE_TEXT[shape]} here`, pointer, held);
  }

  private refuseAnnotations(
    value: TreeSchemasRawObject,
    what: string,
    pointer: string,
    held: ReadonlySet<string>,
  ): boolean {
    const refused = Object.keys(ANNOTATION_FIX).filter((key) => has(value, key) && !held.has(key));
    for (const key of refused) {
      this.reporter.error({
        rule: "annotation-position",
        pointer: treeSchemasPointer(pointer, key),
        message: `'${key}' on ${what} is not kept by the contract model`,
        fix: `remove '${key}' here; ${ANNOTATION_FIX[key]}`,
      });
    }
    return refused.length === 0;
  }

  // A schema name: a ref to a named object, map or union, or the declared scalar, array or enum use inlined.
  private reference(name: string, position: TreeSchemasPosition): TreeSchemasCompiled | undefined {
    const target = this.declaredTarget(name, new Set());
    if (target === undefined) {
      this.reporter.error({
        rule: "schema-unknown",
        pointer: position.pointer,
        message: `no schema '${name}' is declared`,
        fix: "declare it under 'schemas', or fix the name",
      });
      return undefined;
    }
    // The refusal is already reported; a use would resolve to the core schema, not the author's.
    if (this.refusedReserved.has(target.id)) return undefined;
    const compiled =
      target.kind === undefined
        ? this.compileDeclared(target.id)
        : {
            use: this.referenceUse(target.id),
            sensitive: false,
            headerUnion: target.kind === "union" && this.isHeaderTagged(target.value),
          };
    if (compiled === undefined) return undefined;
    if (!this.checkHeaderUnion(compiled.headerUnion, position)) return undefined;
    const use = structuredClone(compiled.use);
    if (target.nullable && use.kind !== "opaque") use.nullable = true;
    return { use, sensitive: compiled.sensitive, headerUnion: compiled.headerUnion };
  }

  // A declared name followed through plain references: its kind when it is a named object, map or union, and
  // whether an alias on the way is nullable (`MaybeFoo: { $ref: Foo, nullable: true }`).
  private declaredTarget(name: string, seen: Set<string>): DeclaredTarget | undefined {
    const value = treeSchemasMember(this.catalogue, name);
    if (value === undefined) return this.seededCoreTarget(name);
    const alias = typeof value === "string" ? value : treeSchemasMember(value, "$ref");
    if (typeof alias === "string" && !seen.has(name)) {
      seen.add(name);
      const target = this.declaredTarget(alias, seen);
      if (target === undefined) return { id: name, kind: undefined, value, nullable: false };
      const nullable = target.nullable || treeSchemasMember(value, "nullable") === true;
      return { ...target, nullable };
    }
    const shape = treeSchemasIsObject(value) ? treeSchemasShapeOf(value) : undefined;
    const kind: NamedKind | undefined =
      shape === "object" || shape === "allOf" || shape === "derived"
        ? "object"
        : shape === "map" || shape === "union"
          ? shape
          : undefined;
    return { id: name, kind, value, nullable: false };
  }

  // A core schema no layer took is still named by uses: the replaced params may reference the issue schema.
  private seededCoreTarget(name: string): DeclaredTarget | undefined {
    if (this.schemas.get(name)?.origin.layer !== "core") return undefined;
    return { id: name, kind: "object", value: undefined, nullable: false };
  }

  private compileDeclared(id: string): TreeSchemasCompiled | undefined {
    const pointer = treeSchemasPointer("/schemas", id);
    const state = this.declared.get(id);
    if (state === "compiling") {
      this.reporter.error({
        rule: "schema-cycle",
        pointer,
        message: `the schema '${id}' reaches itself through schemas that are not objects, maps or unions`,
        fix: "break the cycle with a named object, or remove the self-reference",
      });
      this.declared.set(id, undefined);
      return undefined;
    }
    if (this.declared.has(id)) return state;
    this.declared.set(id, "compiling");
    const name = { segments: splitName(id), role: "schema" } as const;
    const value = treeSchemasMember(this.catalogue, id);
    const compiled =
      value === undefined
        ? undefined
        : this.compileAt(value, { pointer, name, place: "declared", id });
    this.declared.set(id, compiled);
    return compiled;
  }

  private referenceUse(id: string): IrWriter.TypeUse {
    const value = treeSchemasMember(this.catalogue, id);
    const nullable = treeSchemasMember(value, "nullable") === true;
    return { kind: "ref", schema: id, ...(nullable ? { nullable } : {}) };
  }

  private isHeaderTagged(value: TreeSchemasRaw | undefined): boolean {
    return treeSchemasIsObject(treeSchemasMember(value, "discriminator"));
  }

  private checkHeaderUnion(headerUnion: boolean, { pointer, place }: TreeSchemasPosition): boolean {
    if (!headerUnion || place === "routeInput" || place === "declared") return true;
    this.reporter.error({
      rule: "union-header",
      pointer,
      message: "a union tagged by a request header is only allowed as a route's whole input",
      fix: "tag the union by a body property, or use it as the route's 'input'",
    });
    return false;
  }

  private kindOf(id: string): NamedKind | undefined {
    const schema = this.schemas.get(id);
    if (schema !== undefined) return schema.kind;
    if (this.derived.has(id)) return "object";
    return this.declaredTarget(id, new Set())?.kind;
  }

  private idOf(position: TreeSchemasPosition): string {
    if (position.id !== undefined) return position.id;
    const id = position.name === undefined ? undefined : canonicalId(position.name);
    if (id === undefined)
      throw new Error(`tree.schemas derived no schema id at ${position.pointer}`);
    return id;
  }

  // Takes the identifier a hoisted schema is written under; one equal to another schema's is refused (ADR 0007
  // sections 2 and 3). Two declared schemas are compared apart (`checkNames`).
  private claimed(position: TreeSchemasPosition, kind: NamedKind): boolean {
    if (position.name === undefined) {
      this.reporter.error({
        rule: "schema-inline",
        pointer: position.pointer,
        message: `an inline ${kind} has no derived name here`,
        fix: "declare it under 'schemas' and write its name here",
      });
      return false;
    }
    const id = this.idOf(position);
    if (position.id === undefined && !this.claimHoisted(id, position.name, position.pointer))
      return false;
    if (kind === "object" && !this.schemas.has(id)) this.derived.add(id);
    return true;
  }

  private claimHoisted(id: string, name: Name, pointer: string): boolean {
    const keys = claimKeys(id, name);
    const other = keys
      .map((key) => this.claims.get(key))
      .find((claim) => claim !== undefined && claim.pointer !== pointer);
    if (other === undefined) {
      for (const key of keys) this.claims.set(key, { id, pointer });
      return true;
    }
    if (other.reservation !== undefined) {
      const layerParams = other.reservation.seed === undefined;
      this.reporter.error({
        rule: "schema-reserved",
        pointer,
        message: reservedMessage("the name", id, other.reservation),
        fix: COLLISION_FIX[name.role] ?? OPERATION_COLLISION_FIX,
        related: layerParams
          ? [
              {
                pointer: other.reservation.pointer,
                message: `the params of '${other.reservation.id}' take the id here`,
              },
            ]
          : [],
      });
      return false;
    }
    this.reporter.error({
      rule: "name-collision",
      pointer,
      message:
        other.id === id
          ? `the name '${id}' this schema derives is already the name of another schema`
          : `the name '${id}' this schema derives gives the same identifier as the schema '${other.id}'`,
      fix: COLLISION_FIX[name.role] ?? OPERATION_COLLISION_FIX,
      related: [{ pointer: other.pointer, message: `'${other.id}' is named here` }],
    });
    return false;
  }

  private hoist(
    body:
      | { kind: "object"; properties: IrWriter.Property[] }
      | Omit<IrWriter.MapSchema, Meta>
      | Omit<IrWriter.UnionSchema, Meta>,
    value: TreeSchemasRawObject | undefined,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    if (!this.claimed(position, body.kind)) return undefined;
    const id = this.idOf(position);
    this.derived.delete(id);
    const name = irName(position.name as Name);
    const typeName = treeSchemasMember(value, "typeName");
    const examples = treeSchemasMember(value, "examples");
    this.schemas.set(id, {
      ...body,
      id,
      name,
      ...(typeof typeName === "string" ? { typeName } : {}),
      directions: [],
      examples: Array.isArray(examples) ? pipelineCopy(examples) : [],
      docs: treeSchemasDocs(value),
      extensions: {},
      origin: this.reporter.origin(position.pointer),
    });
    return {
      use: this.referenceUse(id),
      sensitive: false,
      headerUnion: body.kind === "union" && body.tag.in === "header",
    };
  }

  private objectSchema(
    properties: IrWriter.Property[],
    value: TreeSchemasRawObject | undefined,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    if (properties.length === 0 && position.place !== "variant") {
      this.reporter.error({
        rule: "object-empty",
        pointer: position.pointer,
        message:
          "an object needs at least one property (only a union variant may hold its tag alone)",
        fix: "add a property, or write '{ opaque: <reason> }' for a free-form value",
      });
      return undefined;
    }
    return this.hoist({ kind: "object", properties }, value, position);
  }

  private object(
    value: TreeSchemasRawObject,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    const properties = this.properties(value, position.pointer, wordsOf(position.name));
    return properties === undefined ? undefined : this.objectSchema(properties, value, position);
  }

  private properties(
    value: TreeSchemasRawObject,
    pointer: string,
    words: string[] | undefined,
  ): IrWriter.Property[] | undefined {
    const written = Array.isArray(value.required) ? value.required : [];
    const required = new Set(written.filter((name) => typeof name === "string"));
    const declared = treeSchemasEntries(value.properties);
    const unknown = [...required].filter((name) => !declared.some(([key]) => key === name));
    for (const name of unknown) {
      this.reporter.error({
        rule: "required-unknown",
        pointer: treeSchemasPointer(pointer, "required"),
        message: `'${name}' is required but is no property of the object`,
        fix: "declare the property, or remove it from 'required'",
      });
    }
    const entries = declared.map(([key, field]) => ({
      wire: key,
      key,
      field,
      required: required.has(key),
    }));
    const properties = this.propertyList(entries, treeSchemasPointer(pointer, "properties"), words);
    return unknown.length > 0 ? undefined : properties;
  }

  private propertyList(
    entries: readonly { wire: string; key: string; field: TreeSchemasRaw; required: boolean }[],
    pointer: string,
    words: string[] | undefined,
  ): IrWriter.Property[] | undefined {
    const properties: IrWriter.Property[] = [];
    const identifiers = new Map<string, string>();
    let failed = false;
    for (const { wire, key, field, required } of entries) {
      const at = treeSchemasPointer(pointer, key);
      const property = this.property(wire, field, at, words, required);
      if (property === undefined) {
        failed = true;
        continue;
      }
      const segments = (property.codeName?.segments ?? splitName(wire)).join(" ");
      const other = identifiers.get(segments);
      if (other !== undefined) {
        failed = true;
        this.reporter.error({
          rule: "name-collision",
          pointer: at,
          message: `the properties '${wire}' and '${other}' give the same identifier`,
          fix: "rename one, or set a 'codeName'",
          related: [{ pointer: treeSchemasPointer(pointer, other), message: `'${other}' is here` }],
        });
      }
      identifiers.set(segments, key);
      properties.push(property);
    }
    return failed ? undefined : properties;
  }

  private property(
    wire: string,
    field: TreeSchemasRaw,
    pointer: string,
    words: string[] | undefined,
    required: boolean,
  ): IrWriter.Property | undefined {
    const own = splitName(wire);
    const compiled = this.compileAt(field, {
      pointer,
      name: childName(words, own, "property"),
      place: "property",
    });
    const codeName = this.codeName(field, own, wire, pointer);
    const restrictedTo = this.restriction(treeSchemasMember(field, "restrictedTo"), pointer);
    const defaultValue = treeSchemasMember(field, "default");
    const refusedRequired = required
      ? [
          ...(restrictedTo === undefined ? [] : ["a restricted property is optional by nature"]),
          ...(defaultValue === undefined ? [] : ["a default fills an absent property"]),
        ]
      : [];
    for (const reason of refusedRequired) {
      this.reporter.error({
        rule: "required-property",
        pointer,
        message: `'${wire}' is listed in 'required', but ${reason}`,
        fix: "remove it from 'required'",
      });
    }
    if (compiled === undefined || codeName === false || refusedRequired.length > 0)
      return undefined;

    const { use, nullable } = withoutNullable(compiled.use);
    return {
      name: wire,
      type: use,
      optional: !required,
      nullable,
      sensitive: treeSchemasMember(field, "sensitive") === true || compiled.sensitive,
      ...(restrictedTo === undefined ? {} : { restrictedTo }),
      ...(defaultValue === undefined ? {} : { default: pipelineCopy(defaultValue) }),
      deprecated: treeSchemasMember(field, "deprecated") === true,
      ...(codeName === undefined ? {} : { codeName }),
      docs: treeSchemasDocs(field),
      extensions: {},
      origin: this.reporter.origin(pointer),
    };
  }

  // ADR 0007 sections 1 and 2: a codeName replaces the segments of the wire name; a name with none needs one.
  private codeName(
    field: TreeSchemasRaw,
    own: readonly string[],
    wire: string,
    pointer: string,
  ): IrWriter.Name | undefined | false {
    const written = treeSchemasMember(field, "codeName");
    const segments = typeof written === "string" ? splitName(written) : [...own];
    if (segments.length > 0)
      return typeof written === "string" ? { segments, role: "member" } : undefined;
    this.reporter.error({
      rule: "name-segments",
      pointer: typeof written === "string" ? treeSchemasPointer(pointer, "codeName") : pointer,
      message:
        typeof written === "string"
          ? `the codeName '${written}' yields no identifier segment`
          : `the property '${wire}' yields no identifier segment`,
      fix:
        typeof written === "string"
          ? "write a codeName with letters or digits"
          : "set its 'codeName'",
    });
    return false;
  }

  private restriction(
    written: TreeSchemasRaw | undefined,
    pointer: string,
  ): IrWriter.FieldRestriction | undefined {
    if (written === undefined) return undefined;
    const origin = this.reporter.origin(treeSchemasPointer(pointer, "restrictedTo"));
    if (typeof written === "string") return { right: written, origin };
    const right = guaranteedString(treeSchemasMember(written, "right"), "right", pointer);
    const params = treeSchemasMember(written, "params");
    const input = treeSchemasMember(written, "input");
    return {
      right,
      ...(params === undefined ? {} : { params: pipelineCopy(params) }),
      ...(input === "reject" || input === "strip" ? { inputPolicy: input } : {}),
      origin,
    };
  }

  private map(
    value: TreeSchemasRawObject,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    const { pointer } = position;
    const values = this.compileAt(value.additionalProperties ?? null, {
      pointer: treeSchemasPointer(pointer, "additionalProperties"),
      name: childName(wordsOf(position.name), [], "value"),
      place: "nested",
    });
    const keyPointer = treeSchemasPointer(pointer, "propertyNames");
    const keys =
      value.propertyNames === undefined
        ? undefined
        : this.compileAt(value.propertyNames, {
            pointer: keyPointer,
            name: undefined,
            place: "nested",
          });
    const keyUse = keys?.use;
    if (
      keyUse !== undefined &&
      !(keyUse.kind === "enum" || (keyUse.kind === "scalar" && keyUse.type === "string"))
    ) {
      this.reporter.error({
        rule: "map-keys",
        pointer: keyPointer,
        message: "the keys of a map are strings",
        fix: "write a string schema (with a format, a pattern or a length) or an enum",
      });
      return undefined;
    }
    if (values === undefined || (value.propertyNames !== undefined && keyUse === undefined))
      return undefined;
    return this.hoist(
      { kind: "map", ...(keyUse === undefined ? {} : { keys: keyUse }), values: values.use },
      value,
      position,
    );
  }

  private array(
    value: TreeSchemasRawObject,
    position: TreeSchemasPosition,
    plain: (use: IrWriter.TypeUse) => TreeSchemasCompiled,
  ): TreeSchemasCompiled | undefined {
    if (value.items === undefined) {
      this.reporter.error({
        rule: "schema-shape",
        pointer: position.pointer,
        message: "an array needs its item schema",
        fix: "add 'items'",
      });
      return undefined;
    }
    const items = this.compileAt(value.items, {
      pointer: treeSchemasPointer(position.pointer, "items"),
      name: childName(wordsOf(position.name), [], "item"),
      place: "nested",
    });
    if (items === undefined) return undefined;
    const { minItems, maxItems } = value;
    if (typeof minItems === "number" && typeof maxItems === "number" && minItems > maxItems) {
      this.reporter.error({
        rule: "refinement-range",
        pointer: position.pointer,
        message: `no value fits the schema: 'minItems' ${minItems} is above 'maxItems' ${maxItems}`,
        fix: "lower the minimum or raise the maximum",
      });
      return undefined;
    }
    return plain({
      kind: "array",
      items: items.use,
      ...(typeof minItems === "number" ? { minItems } : {}),
      ...(typeof maxItems === "number" ? { maxItems } : {}),
    });
  }

  private scalar(
    value: TreeSchemasRawObject,
    position: TreeSchemasPosition,
    plain: (use: IrWriter.TypeUse) => TreeSchemasCompiled,
  ): TreeSchemasCompiled | undefined {
    const use = this.scalars.use(value, position.pointer);
    if (use === undefined) return undefined;
    if (value.contentMediaType === undefined && value.contentSchema === undefined)
      return plain(use);
    if (
      value.contentMediaType !== JSON_MEDIA ||
      value.contentSchema === undefined ||
      use.type !== "string"
    ) {
      this.reporter.error({
        rule: "schema-content",
        pointer: position.pointer,
        message:
          "a JSON text field is a string with both 'contentMediaType: application/json' and 'contentSchema'",
        fix: "write 'type: string' with both keywords",
      });
      return undefined;
    }
    const content = this.compileAt(value.contentSchema, {
      pointer: treeSchemasPointer(position.pointer, "contentSchema"),
      name: undefined,
      place: "nested",
    });
    return content === undefined
      ? undefined
      : plain({ ...use, content: { media: JSON_MEDIA, schema: content.use } });
  }

  private file(
    written: TreeSchemasRaw | undefined,
    pointer: string,
    plain: (use: IrWriter.TypeUse) => TreeSchemasCompiled,
  ): TreeSchemasCompiled | undefined {
    const media = treeSchemasMember(written, "media");
    const maxSize = treeSchemasMember(written, "maxSize");
    const maxSizeBytes = typeof maxSize === "string" ? pipelineParseSize(maxSize) : undefined;
    if (maxSize !== undefined && maxSizeBytes === undefined) {
      this.reporter.error({
        rule: "schema-shape",
        pointer: treeSchemasPointer(pointer, "file", "maxSize"),
        message: `'${String(maxSize)}' is no size this compiler can hold`,
        fix: "write a size such as 20MiB",
      });
      return undefined;
    }
    return plain({
      kind: "file",
      media: Array.isArray(media) ? media.filter((type) => typeof type === "string") : [],
      ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }),
    });
  }

  // ADR 0003 section 7: a catalogue enum, or a narrowing of one to a strict subset of its values.
  private enumUse(
    written: TreeSchemasRaw | undefined,
    pointer: string,
    plain: (use: IrWriter.TypeUse) => TreeSchemasCompiled,
  ): TreeSchemasCompiled | undefined {
    const name =
      typeof written === "string"
        ? written
        : guaranteedString(treeSchemasMember(written, "narrow"), "narrow", pointer);
    const found = this.enumValues(name, []);
    if (found === undefined || "cycle" in found) {
      const at = typeof written === "string" ? pointer : treeSchemasPointer(pointer, "narrow");
      this.reportEnumWithoutValues(name, found?.cycle, at);
      return undefined;
    }
    const { values } = found;
    if (typeof written === "string") return plain({ kind: "enum", enum: name });

    const to = treeSchemasMember(written, "to");
    const subset = Array.isArray(to) ? to.filter((value) => typeof value === "string") : [];
    const strict =
      new Set(subset).size === subset.length &&
      subset.every((value) => values.includes(value)) &&
      subset.length < values.length;
    if (!strict) {
      this.reporter.error({
        rule: "enum-narrowing",
        pointer: treeSchemasPointer(pointer, "to"),
        message: `a narrowing of '${name}' lists some of its values, each once, and not all of them`,
        fix: `keep a strict subset of [${values.join(", ")}]`,
      });
      return undefined;
    }
    const reason = treeSchemasMember(written, "reason");
    return plain({
      kind: "enum",
      enum: name,
      narrowedTo: {
        values: values.filter((value) => subset.includes(value)),
        ...(typeof reason === "string" ? { reason } : {}),
      },
    });
  }

  // The values of an enum, followed through `source.enum` (`path` holds the enums already followed).
  private enumValues(
    name: string,
    path: readonly string[],
  ): { values: string[] } | { cycle: string[] } | undefined {
    if (path.includes(name)) return { cycle: [...path.slice(path.indexOf(name)), name] };
    const declared = treeSchemasMember(this.enums, name);
    const values = treeSchemasMember(declared, "values");
    if (Array.isArray(values))
      return { values: values.filter((value) => typeof value === "string") };
    const source = treeSchemasMember(treeSchemasMember(declared, "source"), "enum");
    return typeof source === "string" ? this.enumValues(source, [...path, name]) : undefined;
  }

  private reportEnumWithoutValues(
    name: string,
    cycle: string[] | undefined,
    pointer: string,
  ): void {
    if (cycle === undefined) {
      this.reporter.error({
        rule: "enum-unknown",
        pointer,
        message: `no enum '${name}' with values is declared`,
        fix: "declare it under 'enums', or fix the name",
      });
      return;
    }
    this.reporter.error({
      rule: "enum-cycle",
      pointer,
      message: `the enum '${name}' takes its values from a cycle of sources: ${cycle.join(" -> ")}`,
      fix: "give one enum of the cycle its own 'values'",
    });
  }

  private union(
    value: TreeSchemasRawObject,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    const { pointer } = position;
    const tag = this.unionTag(value.discriminator, pointer);
    if (tag === undefined) return undefined;
    if (!this.checkHeaderUnion(tag.in === "header", position)) return undefined;

    const words = wordsOf(position.name);
    const variants: IrWriter.UnionVariant[] = [];
    let failed = false;
    for (const [written, variant] of treeSchemasEntries(value.oneOf)) {
      const at = treeSchemasPointer(pointer, "oneOf", written);
      const compiled = this.compileAt(variant, {
        pointer: at,
        name: childName(words, splitName(written), "variant"),
        place: "variant",
      });
      const use = compiled?.use;
      if (use?.kind === "ref" && use.nullable !== true && this.kindOf(use.schema) === "object") {
        variants.push({ tag: written, schema: use.schema });
        continue;
      }
      failed = true;
      if (compiled === undefined) continue;
      const nullable = use?.kind === "ref" && use.nullable === true;
      this.reporter.error({
        rule: "union-variant",
        pointer: at,
        message: nullable
          ? `the variant '${written}' is nullable, and a variant is an object that is never null`
          : `the variant '${written}' is not an object schema`,
        fix: nullable
          ? "name the object schema itself, without 'nullable'"
          : "make the variant an object, or name an object schema",
      });
    }
    if (variants.length === 0 && !failed) {
      this.reporter.error({
        rule: "union-variant",
        pointer: treeSchemasPointer(pointer, "oneOf"),
        message: "a union needs at least one variant",
        fix: "map each tag value to its variant schema",
      });
    }
    if (failed || variants.length === 0) return undefined;
    variants.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
    if (tag.in === "body") this.bodyTags.push({ pointer, property: tag.property, variants });
    return this.hoist({ kind: "union", tag, variants }, value, position);
  }

  private unionTag(
    written: TreeSchemasRaw | undefined,
    pointer: string,
  ): IrWriter.UnionTag | undefined {
    if (typeof written === "string") return { in: "body", property: written };
    const header = HEADER_SOURCE.exec(String(treeSchemasMember(written, "from") ?? ""));
    if (header?.[1] !== undefined) return { in: "header", name: header[1] };
    this.reporter.error({
      rule: "union-discriminator",
      pointer,
      message: "a union needs a discriminator: its tag property, or '{ from: header.<Name> }'",
      fix: "add 'discriminator: <tag property>'",
    });
    return undefined;
  }

  // ADR 0003 section 1: `allOf` members are object schemas merged into one object, written order kept.
  private allOf(
    value: TreeSchemasRawObject,
    position: TreeSchemasPosition,
  ): TreeSchemasCompiled | undefined {
    const merged = this.mergedProperties(value, position.pointer, wordsOf(position.name));
    if (merged === "derived")
      return this.claimed(position, "object")
        ? { use: this.referenceUse(this.idOf(position)), sensitive: false, headerUnion: false }
        : undefined;
    return merged === undefined ? undefined : this.objectSchema(merged, value, position);
  }

  private mergedProperties(
    value: TreeSchemasRawObject,
    pointer: string,
    words: string[] | undefined,
  ): IrWriter.Property[] | "derived" | undefined {
    const merged = new Map<string, { property: IrWriter.Property; pointer: string }>();
    let failed = false;
    let derived = false;
    const members = Array.isArray(value.allOf) ? value.allOf : [];
    for (const [index, member] of members.entries()) {
      const at = treeSchemasPointer(pointer, "allOf", String(index));
      const properties = this.memberProperties(member, at, words);
      failed ||= properties === undefined;
      derived ||= properties === "derived";
      if (properties === undefined || properties === "derived") continue;
      for (const property of properties) {
        const before = merged.get(property.name);
        if (before === undefined) {
          merged.set(property.name, { property, pointer: at });
        } else if (sameProperty(before.property, property)) {
          before.property.optional = before.property.optional && property.optional;
        } else {
          failed = true;
          this.reporter.error({
            rule: "all-of-property",
            pointer: at,
            message: `the property '${property.name}' is declared twice with different schemas`,
            fix: "declare it once, or give both the same schema",
            related: [
              { pointer: before.pointer, message: "the other declaration is in this member" },
            ],
          });
        }
      }
    }
    if (failed) return undefined;
    return derived ? "derived" : [...merged.values()].map((entry) => entry.property);
  }

  private memberProperties(
    member: TreeSchemasRaw,
    pointer: string,
    words: string[] | undefined,
  ): IrWriter.Property[] | "derived" | undefined {
    // A member's own annotations have no place: the merged object holds the `allOf` schema's.
    if (
      treeSchemasIsObject(member) &&
      !this.refuseAnnotations(member, "a member of 'allOf'", pointer, new Set())
    )
      return undefined;
    const name = typeof member === "string" ? member : treeSchemasMember(member, "$ref");
    if (typeof name === "string") return this.declaredProperties(name, pointer);
    const shape = treeSchemasIsObject(member) ? treeSchemasShapeOf(member) : undefined;
    if (treeSchemasIsObject(member) && shape === "object") {
      return this.checkKeywords(member, shape, pointer)
        ? this.properties(member, pointer, words)
        : undefined;
    }
    if (treeSchemasIsObject(member) && shape === "allOf")
      return this.mergedProperties(member, pointer, words);
    if (shape === "derived") return "derived";
    return this.notAnObjectMember(pointer);
  }

  private declaredProperties(
    name: string,
    pointer: string,
  ): IrWriter.Property[] | "derived" | undefined {
    const target = this.declaredTarget(name, new Set());
    if (target === undefined) {
      this.reporter.error({
        rule: "schema-unknown",
        pointer,
        message: `no schema '${name}' is declared`,
        fix: "declare it under 'schemas', or fix the name",
      });
      return undefined;
    }
    if (target.kind !== "object") return this.notAnObjectMember(pointer);
    if (this.compileDeclared(target.id) === undefined) return undefined;
    const schema = this.schemas.get(target.id);
    if (schema === undefined) return "derived";
    return schema.kind === "object" ? structuredClone(schema.properties) : undefined;
  }

  private notAnObjectMember(pointer: string): undefined {
    this.reporter.error({
      rule: "all-of-member",
      pointer,
      message: "a member of 'allOf' is not an object schema",
      fix: "merge object schemas only",
    });
    return undefined;
  }

  // ADR 0003 section 3: a variant does not declare the tag property; the union adds it.
  private checkBodyTags(): void {
    for (const { pointer, property, variants } of this.bodyTags) {
      for (const variant of variants) {
        const schema = this.schemas.get(variant.schema);
        if (schema?.kind !== "object" || !schema.properties.some((p) => p.name === property))
          continue;
        this.reporter.error({
          rule: "union-tag",
          pointer: treeSchemasPointer(pointer, "oneOf", variant.tag),
          message: `the variant '${variant.tag}' declares the tag property '${property}'`,
          fix: "remove it from the variant; the union adds it",
        });
      }
    }
  }

  // ADR 0003 section 2: no finite value fits a cycle of required, non-nullable object properties.
  private checkRequiredCycles(): void {
    const done = new Set<string>();
    const path: string[] = [];
    const next = (id: string): string[] => {
      const schema = this.schemas.get(id);
      if (schema?.kind !== "object") return [];
      return schema.properties.flatMap((p) =>
        !p.optional &&
        !p.nullable &&
        p.type.kind === "ref" &&
        this.schemas.get(p.type.schema)?.kind === "object"
          ? [p.type.schema]
          : [],
      );
    };
    const visit = (id: string): void => {
      const open = path.indexOf(id);
      if (open >= 0) {
        const cycle = [...path.slice(open), id];
        const first = this.schemas.get(id);
        if (first !== undefined)
          this.reporter.error({
            rule: "schema-cycle",
            pointer: first.origin.pointer,
            message: `the schemas ${cycle.join(" -> ")} hold each other through required, non-nullable properties, so no finite value fits`,
            fix: "make one of those properties optional or nullable",
          });
        return;
      }
      if (done.has(id)) return;
      path.push(id);
      for (const target of next(id)) visit(target);
      path.pop();
      done.add(id);
    };
    for (const id of this.schemas.keys()) visit(id);
  }

  // ADR 0007 section 2: two names of one catalogue with equal segments collide in every language.
  private checkNames(ids: readonly string[], catalogue: string, what: string): void {
    const seen = new Map<string, string>();
    for (const id of ids) {
      const segments = splitName(id).join(" ");
      const other = seen.get(segments);
      if (other === undefined) {
        seen.set(segments, id);
        continue;
      }
      this.reporter.error({
        rule: "name-collision",
        pointer: treeSchemasPointer(catalogue, id),
        message: `the ${what} '${id}' and '${other}' give the same identifier`,
        fix: "rename one of them",
        related: [
          { pointer: treeSchemasPointer(catalogue, other), message: `'${other}' is declared here` },
        ],
      });
    }
  }
}

type Meta =
  | "id"
  | "name"
  | "typeName"
  | "directions"
  | "examples"
  | "docs"
  | "extensions"
  | "origin";
