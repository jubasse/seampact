import type { IrWriter } from "@seampact/spec/ir";
import { type DraftIR, type PassReadonly, pipelinePointerBelow } from "../../../pipeline/seam.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import {
  type AccessRightsRestrictionChecks,
  accessRightsRestrictionOrigin,
} from "./restrictions.js";
import type { AccessRightsRoute } from "./routes.js";

// The walk from a body to the restricted fields it reaches (ADR 0003 section 6). A pointer is relative to the body's
// schema, `*` standing for an array item or a map value (`/items/*/effort`). A reference from which no restricted
// field can be reached is not walked, so a schema shared by many paths costs nothing unless it leads to one, and the
// walk stops once an operation reaches more restricted fields than the IR may list for it.
//
// A restricted field below a recursive reference is refused: its pointers would have no end. One below the JSON
// content of a text field, or reached from a position other than a body, is refused too: the IR has no pointer
// through those positions.

export type AccessRightsDraftSchemas = PassReadonly<DraftIR["schemas"]>;
export type AccessRightsObjectSchema = Extract<
  AccessRightsDraftSchemas[string],
  { kind: "object" }
>;
type DraftProperty = AccessRightsObjectSchema["properties"][number];
type DraftTypeUse = PassReadonly<IrWriter.TypeUse>;

/** The most restricted fields one operation may reach, each one entry of its field rights. */
export const FIELD_RIGHTS_PER_OPERATION_LIMIT = 1000;

/** A restricted property reached from a body: the body's schema, the pointer, and the object holding it. */
export interface AccessRightsRestrictedField {
  readonly schema: string;
  readonly pointer: string;
  readonly holder: AccessRightsObjectSchema;
  readonly property: DraftProperty;
  readonly restriction: PassReadonly<IrWriter.FieldRestriction>;
}

/** The walk of one operation: `reached` counts its restricted fields and recursive hits so far. */
export interface AccessRightsFieldWalk {
  readonly reporter: AccessRightsReporter;
  readonly schemas: AccessRightsDraftSchemas;
  readonly checks: AccessRightsRestrictionChecks;
  readonly route: AccessRightsRoute;
  reached: number;
}

export const accessRightsFieldWalkExceeded = (walk: AccessRightsFieldWalk): boolean =>
  walk.reached > FIELD_RIGHTS_PER_OPERATION_LIMIT;

/** The schemas from which a restricted field can be reached, through any reference or JSON content. */
export function accessRightsRestrictionReaching(
  schemas: AccessRightsDraftSchemas,
): ReadonlySet<string> {
  const referencedBy = new Map<string, string[]>();
  const reaching = new Set<string>();
  const pending: string[] = [];

  for (const [id, schema] of Object.entries(schemas)) {
    for (const target of schemaReferences(schema))
      referencedBy.set(target, [...(referencedBy.get(target) ?? []), id]);

    if (
      schema.kind === "object" &&
      schema.properties.some((property) => property.restrictedTo !== undefined)
    ) {
      reaching.add(id);
      pending.push(id);
    }
  }

  for (let id = pending.pop(); id !== undefined; id = pending.pop())
    for (const referrer of referencedBy.get(id) ?? []) {
      if (reaching.has(referrer)) continue;
      reaching.add(referrer);
      pending.push(referrer);
    }

  return reaching;
}

function schemaReferences(schema: AccessRightsDraftSchemas[string]): string[] {
  switch (schema.kind) {
    case "object":
      return schema.properties.flatMap((property) => useReferences(property.type));
    case "map":
      return useReferences(schema.values);
    case "union":
      return schema.variants.map((variant) => variant.schema);
  }
}

function useReferences(use: DraftTypeUse): string[] {
  switch (use.kind) {
    case "array":
      return useReferences(use.items);
    case "ref":
      return [use.schema];
    case "scalar":
      return use.content === undefined ? [] : useReferences(use.content.schema);
    default:
      return [];
  }
}

function schemaOf(schemas: AccessRightsDraftSchemas, id: string): AccessRightsDraftSchemas[string] {
  const schema = Object.hasOwn(schemas, id) ? schemas[id] : undefined;

  if (schema === undefined)
    throw new Error(`a type use references schema '${id}', which tree.schemas did not write`);

  return schema;
}

// A body that is not a reference (an array of them) is walked from each schema it reaches, its pointers relative
// to that schema, since an entry names a schema.
export function accessRightsRestrictedFields(
  walk: AccessRightsFieldWalk,
  use: DraftTypeUse,
  found: (field: AccessRightsRestrictedField) => void,
): void {
  if (use.kind === "array") {
    accessRightsRestrictedFields(walk, use.items, found);

    return;
  }

  if (use.kind !== "ref" || !walk.checks.reaching.has(use.schema)) return;

  walkSchema(walk, { root: use.schema, prefix: "", path: [use.schema], found }, use.schema);
}

interface WalkAt {
  readonly root: string;
  readonly prefix: string;
  /** The schemas referenced from the root down to here, to stop at a recursive reference. */
  readonly path: readonly string[];
  readonly found: (field: AccessRightsRestrictedField) => void;
}

function walkSchema(walk: AccessRightsFieldWalk, at: WalkAt, id: string): void {
  const schema = schemaOf(walk.schemas, id);

  switch (schema.kind) {
    case "object":
      for (const property of schema.properties) {
        if (accessRightsFieldWalkExceeded(walk)) return;

        const pointer = pipelinePointerBelow(at.prefix, property.name);

        if (property.restrictedTo !== undefined) {
          walk.reached += 1;
          at.found({
            schema: at.root,
            pointer,
            holder: schema,
            property,
            restriction: property.restrictedTo,
          });
        }

        walkUse(walk, { ...at, prefix: pointer }, property.type);
      }

      return;
    case "map":
      walkUse(walk, { ...at, prefix: pipelinePointerBelow(at.prefix, "*") }, schema.values);

      return;
    case "union":
      for (const variant of schema.variants) walkReference(walk, at, variant.schema);
  }
}

function walkUse(walk: AccessRightsFieldWalk, at: WalkAt, use: DraftTypeUse): void {
  switch (use.kind) {
    case "array":
      walkUse(walk, { ...at, prefix: pipelinePointerBelow(at.prefix, "*") }, use.items);

      return;
    case "ref":
      walkReference(walk, at, use.schema);

      return;
    case "scalar":
      if (use.content !== undefined)
        accessRightsRefuseRestrictionsBelow(walk, use.content.schema, {
          text: `the JSON content of field '${accessRightsQuoted(`${at.root}${at.prefix}`)}'`,
        });
  }
}

function walkReference(walk: AccessRightsFieldWalk, at: WalkAt, id: string): void {
  if (!walk.checks.reaching.has(id)) return;

  if (!at.path.includes(id)) {
    walkSchema(walk, { ...at, path: [...at.path, id] }, id);

    return;
  }

  walk.reached += 1;

  if (walk.checks.recursive.has(id)) return;

  walk.checks.recursive.add(id);
  walk.reporter.error({
    rule: "field-right-recursive",
    message: `schema '${id}' holds a restricted field and references itself below '${accessRightsQuoted(`${at.root}${at.prefix}`)}', so route '${walk.route.id}' would have field rights at pointers without end`,
    fix: "restrict the field in a schema that is not recursive, or end the recursion before it",
    pointer: schemaOf(walk.schemas, id).origin.pointer,
  });
}

/** A position whose type use cannot hold a restricted field, as a message names it, and where it is written. */
export interface AccessRightsRefusedPosition {
  readonly text: string;
  readonly pointer?: string;
}

/** Refuses every restricted field the use reaches, each at its written restriction, once per schema. */
export function accessRightsRefuseRestrictionsBelow(
  walk: Pick<AccessRightsFieldWalk, "reporter" | "schemas" | "checks">,
  use: DraftTypeUse,
  position: AccessRightsRefusedPosition,
): void {
  const seen = new Set<string>();
  const pending = useReferences(use);

  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (seen.has(id) || !walk.checks.reaching.has(id)) continue;
    seen.add(id);

    const schema = schemaOf(walk.schemas, id);

    pending.push(...schemaReferences(schema));

    if (schema.kind === "object")
      for (const property of schema.properties)
        if (property.restrictedTo !== undefined)
          refusePosition(walk.reporter, id, property, property.restrictedTo, position);
  }
}

function refusePosition(
  reporter: AccessRightsReporter,
  holder: string,
  property: DraftProperty,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
  position: AccessRightsRefusedPosition,
): void {
  reporter.error({
    rule: "field-right-position",
    message: `field '${accessRightsQuoted(`${holder}${pipelinePointerBelow("", property.name)}`)}' is restricted to right '${accessRightsQuoted(restriction.right)}' and is reached from ${position.text}, where the IR lists no field right`,
    fix: "move the restricted field out of the schemas this position reaches, or remove its restrictedTo",
    pointer: accessRightsRestrictionOrigin(restriction).pointer,
    ...(position.pointer === undefined
      ? {}
      : { related: [{ pointer: position.pointer, message: "the position is written here" }] }),
  });
}
