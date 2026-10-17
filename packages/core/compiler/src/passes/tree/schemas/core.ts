import type { IrWriter } from "@seampact/spec/ir";
import { canonicalId, type Name, splitName } from "@seampact/spec/naming";
import {
  DERIVATION_EMPTY_BODY_SCHEMA_ID,
  DERIVATION_ISSUE_SCHEMA_ID,
  type DerivationRole,
  derivationCopy,
  derivationIssueMembers,
  derivationRoleOf,
  derivationRoles,
} from "../../../derivations/index.js";
import { type TreeSchemasRawObject, treeSchemasMember, treeSchemasPointer } from "./raw.js";

// The core schemas of ADR 0004 section 13: the params schema of each default code that carries data, the schema of
// one schema issue and the empty body schema, seeded from the role data with origin `core` and no `derivedFrom`.
// Their ids are reserved. A layer that declares a default code with `params` takes the code's params id, and the
// core schema is not seeded; the issue schema stays seeded until a layer declares or hoists its id,
// which it may once the `api.schema_invalid` params are replaced.

/** A reserved schema id: the core schema seeded under it, or the layer params that take it. */
export interface TreeSchemasReservation {
  id: IrWriter.SchemaId;
  name: Name;
  /** What the id is reserved for, as a diagnostic names it. */
  purpose: string;
  /** The layer pointer that may take the id; its core pointer when the core schema is seeded. */
  pointer: string;
  /** The core schema; undefined when a layer's params take the id. */
  seed: IrWriter.ObjectSchema | undefined;
  /** True when a layer declaration or hoist may take the id, replacing the seed. */
  yields: boolean;
}

// The code whose `issues` items are the issue schema.
function schemaInvalidCode(): string {
  const role = derivationRoleOf("schemaInvalid");

  if (role === undefined) throw new Error("the role data has no schemaInvalid role");

  return role.defaultCode;
}

const coreOrigin = (pointer: string): IrWriter.Origin => ({ layer: "core", pointer });

function coreProperty(
  name: string,
  type: IrWriter.TypeUse,
  optional: boolean,
  pointer: string,
): IrWriter.Property {
  return {
    name,
    type,
    optional,
    nullable: false,
    sensitive: false,
    deprecated: false,
    docs: {},
    extensions: {},
    origin: coreOrigin(pointer),
  };
}

function coreObject(
  id: IrWriter.SchemaId,
  name: Name,
  direction: IrWriter.Direction,
  pointer: string,
  properties: IrWriter.Property[],
): IrWriter.ObjectSchema {
  return {
    kind: "object",
    id,
    name: { segments: [...name.segments], role: name.role },
    // A core schema's only uses are written by later halves (error params, the proof-only input), so its
    // direction is the one those uses have.
    directions: [direction],
    examples: [],
    docs: {},
    extensions: {},
    origin: coreOrigin(pointer),
    properties,
  };
}

const declaresParams = (merged: TreeSchemasRawObject, code: string): boolean =>
  treeSchemasMember(treeSchemasMember(merged.errors, code), "params") !== undefined;

function paramsReservation(
  merged: TreeSchemasRawObject,
  role: DerivationRole,
): TreeSchemasReservation {
  const code = role.defaultCode;
  const name: Name = { segments: splitName(code), role: "params" };
  const id = canonicalId(name);

  if (id === undefined) throw new Error(`the default code ${code} names no params schema`);

  const pointer = treeSchemasPointer("/errors", code, "params");
  const purpose = `the params of the default code '${code}'`;

  if (declaresParams(merged, code))
    return { id, name, purpose, pointer, seed: undefined, yields: false };

  // ADR 0006 section 6: a datum the bound code need not always receive is an optional param.
  const properties = role.data.map((datum) =>
    coreProperty(
      datum.name,
      derivationCopy<IrWriter.TypeUse>(datum.type),
      datum.required !== "always",
      treeSchemasPointer(pointer, datum.name),
    ),
  );
  const seed = coreObject(id, name, "output", pointer, properties);

  return { id, name, purpose, pointer, seed, yields: false };
}

function issueReservation(code: string, yields: boolean): TreeSchemasReservation {
  const id = DERIVATION_ISSUE_SCHEMA_ID;
  const name: Name = { segments: splitName(id), role: "schema" };
  const pointer = treeSchemasPointer("/errors", code, "params", "issues", "items");
  const properties = derivationIssueMembers.map((member) =>
    coreProperty(
      member.name,
      derivationCopy<IrWriter.TypeUse>(member.type),
      false,
      treeSchemasPointer(pointer, "properties", member.name),
    ),
  );
  const seed = coreObject(id, name, "output", pointer, properties);

  return { id, name, purpose: `one issue of the default code '${code}'`, pointer, seed, yields };
}

function emptyBodyReservation(): TreeSchemasReservation {
  const id = DERIVATION_EMPTY_BODY_SCHEMA_ID;
  const name: Name = { segments: splitName(id), role: "schema" };
  const pointer = treeSchemasPointer("/schemas", id);
  const seed = coreObject(id, name, "input", pointer, []);

  return {
    id,
    name,
    purpose: "the empty body of a proof-only input",
    pointer,
    seed,
    yields: false,
  };
}

/** The reserved schema ids of an api, in the order of `derivationCoreSchemaIds`, each with its core schema. */
export function treeSchemasCoreReservations(
  merged: TreeSchemasRawObject,
): TreeSchemasReservation[] {
  const params = derivationRoles
    .filter((role) => role.data.length > 0)
    .map((role) => paramsReservation(merged, role));
  const code = schemaInvalidCode();
  const issue = issueReservation(code, declaresParams(merged, code));

  return [...params, issue, emptyBodyReservation()];
}
