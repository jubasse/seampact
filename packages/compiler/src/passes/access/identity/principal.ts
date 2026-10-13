import type { IrWriter } from "@seampact/spec/ir";
import type { PassContextOf, PassReadonly } from "../../../pipeline/seam.js";
import {
  type AccessIdentityRawValue,
  accessIdentityIsObject,
  accessIdentityMember,
  accessIdentityPointer,
} from "./read.js";
import type { AccessIdentityReporter } from "./report.js";
import { accessIdentitySchemaUse } from "./schema-use.js";

// The principal of an identity (ADR 0002 section 9): one schema, or one per credential variant, each a named
// schema (ADR 0004: a SchemaRef) whose use the schema service answers (an inline object is hoisted by tree.schemas),
// and the lookup of a principal field, which every variant must hold. A map or union principal is refused only
// where a field is read off it (LD-49), so here only by that lookup.

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

// Whether the object schema `id` holds the dotted field path, each step but the last a named object schema.
function schemaHasField(schemas: Schemas, id: string, segments: readonly string[]): boolean {
  const [first, ...rest] = segments;
  const schema = schemaOf(schemas, id);
  if (first === undefined || schema.kind !== "object") return false;

  const property = schema.properties.find((candidate) => candidate.name === first);
  if (property === undefined) return false;
  if (rest.length === 0) return true;
  return property.type.kind === "ref" && schemaHasField(schemas, property.type.schema, rest);
}

/** Whether every schema of the principal holds the dotted field (`profile.id`). */
export function accessIdentityPrincipalHasField(
  schemas: Schemas,
  principal: IrWriter.KnownPrincipal,
  field: string,
): boolean {
  const segments = field.split(".");
  if (principal.kind === "schema") return schemaHasField(schemas, principal.schema, segments);
  return Object.values(principal.variants).every((id) => schemaHasField(schemas, id, segments));
}
