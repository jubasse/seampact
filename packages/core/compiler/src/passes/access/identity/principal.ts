import type { IrWriter } from "@seampact/spec/ir";
import type { PassContextOf, PassReadonly } from "../../../pipeline/seam.js";
import {
  type AccessIdentityRawValue,
  accessIdentityIsObject,
  accessIdentityMember,
  accessIdentityPointer,
} from "./read.js";
import type { AccessIdentityProblem, AccessIdentityReporter } from "./report.js";
import { accessIdentitySchemaUse } from "./schema-use.js";

// The principal of an identity (ADR 0002 section 9): one schema, or one per credential variant, each a named
// schema (ADR 0004: a SchemaRef) whose use the schema service answers (an inline object is hoisted by tree.schemas),
// and the lookup of a principal field, which every variant must hold. A map or union principal is refused only
// where a field is read off it (a header use's `from`, a route's `principal.requires`, a binding), by that lookup.

type Context = PassContextOf<"access.identity">;

type Schemas = PassReadonly<Record<string, IrWriter.Schema>>;

/** A principal resolved, or refused with an error reported. */
export type AccessIdentityPrincipalResult =
  | { status: "resolved"; principal: IrWriter.KnownPrincipal }
  | { status: "refused" };

/** The schema of a schema id in the draft; tree.schemas wrote every schema a use names. */
function schemaOf(schemas: Schemas, id: string): PassReadonly<IrWriter.Schema> {
  const schema = Object.hasOwn(schemas, id) ? schemas[id] : undefined;
  if (schema === undefined)
    throw new Error(
      `the schema service answered a use of ${id}, which the draft has no schema for`,
    );
  return schema;
}

// The named schema a principal position names, or a reported refusal.
function principalSchema(
  pointer: string,
  identityId: string,
  context: Context,
  reporter: AccessIdentityReporter,
): string | "refused" {
  const use = accessIdentitySchemaUse(context, pointer, "output");
  if (use.kind === "ref") return use.schema;

  reporter.error({
    rule: "principal",
    message: `the principal of identity '${identityId}' is an inline schema of kind ${use.kind}, not a named schema`,
    fix: "Name an object schema, or write one inline, whose properties are the principal's fields.",
    pointer,
  });
  return "refused";
}

/** The principal of an identity from its raw `principal`, which the caller has found written. */
export function accessIdentityPrincipal(
  identityId: string,
  identityPointer: string,
  written: AccessIdentityRawValue,
  context: Context,
  reporter: AccessIdentityReporter,
): AccessIdentityPrincipalResult {
  const pointer = accessIdentityPointer(identityPointer, "principal");
  const variants =
    accessIdentityIsObject(written) && Object.hasOwn(written, "variants")
      ? accessIdentityMember(written, "variants")
      : undefined;

  if (variants === undefined) {
    const schema = principalSchema(pointer, identityId, context, reporter);
    if (schema === "refused") return { status: schema };
    return { status: "resolved", principal: { kind: "schema", schema } };
  }

  return variantsPrincipal(identityId, pointer, variants, context, reporter);
}

function variantsPrincipal(
  identityId: string,
  pointer: string,
  variants: AccessIdentityRawValue,
  context: Context,
  reporter: AccessIdentityReporter,
): AccessIdentityPrincipalResult {
  const names = accessIdentityIsObject(variants) ? Object.keys(variants) : [];
  if (names.length === 0) {
    reporter.error({
      rule: "principal",
      message: `the principal of identity '${identityId}' lists no variant`,
      fix: "Name one schema per credential variant, as 'variants: { <name>: <schema> }', or name one schema.",
      pointer: accessIdentityPointer(pointer, "variants"),
    });
    return { status: "refused" };
  }

  // A variant may be named `__proto__` (ADR 0004 section 13): the map has no prototype.
  const resolved: Record<string, string> = Object.create(null);
  let refused = false;
  for (const name of names) {
    const variantPointer = accessIdentityPointer(pointer, "variants", name);
    const schema = principalSchema(variantPointer, identityId, context, reporter);
    if (schema === "refused") refused = true;
    else Object.defineProperty(resolved, name, { value: schema, enumerable: true, writable: true });
  }

  if (refused) return { status: "refused" };
  return { status: "resolved", principal: { kind: "variants", variants: resolved } };
}

/** Where a dotted field lookup ends: held, missing, or at a step that is no object schema (a map or a union). */
export type AccessIdentityFieldLookup =
  | { status: "held" }
  | { status: "missing" }
  | { status: "notObject"; schema: string; kind: string };

/** Whether the schema `id` holds the dotted field path, each step but the last a named object schema. */
export function accessIdentitySchemaField(
  schemas: Schemas,
  id: string,
  segments: readonly string[],
): AccessIdentityFieldLookup {
  const [first, ...rest] = segments;
  const schema = schemaOf(schemas, id);
  if (schema.kind !== "object") return { status: "notObject", schema: id, kind: schema.kind };
  if (first === undefined) return { status: "missing" };

  const property = schema.properties.find((candidate) => candidate.name === first);
  if (property === undefined) return { status: "missing" };
  if (rest.length === 0) return { status: "held" };
  if (property.type.kind !== "ref") return { status: "missing" };
  return accessIdentitySchemaField(schemas, property.type.schema, rest);
}

/** Where the lookup of a dotted principal field (`profile.id`) ends, in the first variant that does not hold it. */
export function accessIdentityPrincipalField(
  schemas: Schemas,
  principal: IrWriter.KnownPrincipal,
  field: string,
): AccessIdentityFieldLookup {
  const segments = field.split(".");
  if (principal.kind === "schema") return accessIdentitySchemaField(schemas, principal.schema, segments);

  for (const id of Object.values(principal.variants)) {
    const lookup = accessIdentitySchemaField(schemas, id, segments);
    if (lookup.status !== "held") return lookup;
  }
  return { status: "held" };
}

/** What a reader of a principal field is told when the principal does not hold it. */
export function accessIdentityPrincipalFieldRefusal(
  reader: string,
  field: string,
  principal: IrWriter.KnownPrincipal,
  lookup: Exclude<AccessIdentityFieldLookup, { status: "held" }>,
): Pick<AccessIdentityProblem, "message" | "fix"> {
  if (lookup.status === "notObject")
    return {
      message: `${reader} principal field '${field}', but the principal schema '${lookup.schema}' is a ${lookup.kind}, not an object schema`,
      fix: "Name an object schema as the principal, or as each variant, whose properties are the fields read.",
    };

  return {
    message: `${reader} principal field '${field}', which its principal does not hold${principal.kind === "variants" ? " in every variant" : ""}`,
    fix: "Name a field of the principal schema, or add it to the schema.",
  };
}
