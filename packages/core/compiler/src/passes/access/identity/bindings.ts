import type { IrWriter } from "@seampact/spec/ir";
import { type InheritedEntry, pipelineCopy } from "../../../pipeline/seam.js";
import type { AccessIdentityResolved, AccessIdentityRoute, AccessIdentityScope } from "./access.js";
import { accessIdentityRouteHasParameter } from "./params.js";
import {
  accessIdentityPrincipalField,
  accessIdentityPrincipalFieldRefusal,
  accessIdentitySchemaField,
} from "./principal.js";
import { accessIdentityObject, accessIdentityPointer, accessIdentityStrings } from "./read.js";
import { accessIdentityValueSource } from "./source.js";

// Principal requirements and bindings of an operation (ADR 0002 section 9): the union of `principal.requires`, each
// field held by the principal (every variant of a variants principal), and the `bindings` from the root down, each
// source present on the route and each target a principal field. One key bound to two different values is an error
// naming both origins (ADR 0002 section 8); a key bound again to the same value keeps the first.

/** The fields the principal must hold on the route; a field it does not hold is reported and left out. */
export function accessIdentityPrincipalRequires(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  scope: AccessIdentityScope,
): IrWriter.PrincipalRequirement[] {
  const entries = scope.context.inherited(route.node, "principal.requires")?.entries ?? [];
  const requirements: IrWriter.PrincipalRequirement[] = [];

  for (const entry of entries) {
    // The authoring schema writes each requirement as a field name.
    if (typeof entry.value !== "string")
      throw new Error(`a principal requirement set at ${entry.node.pointer} is not a field name`);
    const field = entry.value;
    const pointer = requirementPointer(entry, field);
    const reader: Reader = { subject: "'principal.requires'", verb: "names" };
    if (principalHolds(route, resolved, field, pointer, reader, scope))
      requirements.push({ field, origin: pipelineCopy(entry.origin) });
  }

  return requirements;
}

/** The bindings of the route, sorted by source; a binding with an error is reported and left out. */
export function accessIdentityBindings(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  scope: AccessIdentityScope,
): IrWriter.Binding[] {
  const entries = scope.context.inherited(route.node, "bindings")?.entries ?? [];
  const firstByKey = new Map<string, InheritedEntry>();
  const bindings: IrWriter.Binding[] = [];

  for (const entry of entries) {
    // The authoring schema keys a binding by its source and writes its target as a principal source.
    const key = entry.key;
    if (key === undefined || typeof entry.value !== "string")
      throw new Error(`a binding set at ${entry.node.pointer} has no source key or no target`);

    const pointer = accessIdentityPointer(entry.node.pointer, "bindings", key);
    const first = firstByKey.get(key);
    if (first !== undefined) {
      if (first.value !== entry.value) reportConflict(key, pointer, first, scope);
      continue;
    }
    firstByKey.set(key, entry);

    const from = accessIdentityValueSource(key);
    const to = accessIdentityValueSource(entry.value);
    const reader: Reader = { subject: `binding '${key}'`, verb: "reads" };
    const sourceFound = bindingSourceFound(route, key, from, pointer, scope);
    const targetHeld = principalHolds(route, resolved, to.name ?? "", pointer, reader, scope);
    if (sourceFound && targetHeld) bindings.push({ from, to, origin: pipelineCopy(entry.origin) });
  }

  return bindings.sort(bySource);
}

const sourceText = (source: IrWriter.ValueSource): string =>
  "name" in source ? `${source.in}.${source.name}` : source.in;

const bySource = (left: IrWriter.Binding, right: IrWriter.Binding): number => {
  const leftText = sourceText(left.from);
  const rightText = sourceText(right.from);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
};

// The pointer of a written requirement: the first item naming the field on the node that set it.
function requirementPointer(entry: InheritedEntry, field: string): string {
  const principal = accessIdentityObject(entry.node.settings, "principal");
  const index = (
    principal === undefined ? [] : (accessIdentityStrings(principal, "requires") ?? [])
  ).indexOf(field);
  if (index < 0)
    throw new Error(`the principal requirement '${field}' is not written at ${entry.node.pointer}`);
  return accessIdentityPointer(entry.node.pointer, "principal", "requires", `${index}`);
}

// Who reads a principal field, for the messages: `'principal.requires' names`, `binding '<key>' reads`.
interface Reader {
  subject: string;
  verb: "names" | "reads";
}

// The messages name the identity, never the route, so a setting reaching many routes is reported once.
function principalHolds(
  route: AccessIdentityRoute,
  resolved: AccessIdentityResolved,
  field: string,
  pointer: string,
  reader: Reader,
  scope: AccessIdentityScope,
): boolean {
  const identity = resolved.identity;
  if (identity === undefined) {
    scope.reporter.error({
      rule: "principal-field",
      message: `${reader.subject} ${reader.verb} principal field '${field}' on a public route, which has no principal`,
      fix: "Remove it from the public route, or give the route an identity.",
      pointer,
      related: [{ pointer: route.node.pointer, message: "a public route it reaches" }],
    });
    return false;
  }

  const lookup = accessIdentityPrincipalField(scope.schemas, identity.principal, field);
  if (lookup.status === "held") return true;

  const subject = `${reader.subject} under identity '${identity.id}' ${reader.verb}`;
  scope.reporter.error({
    rule: "principal-field",
    ...accessIdentityPrincipalFieldRefusal(subject, field, identity.principal, lookup),
    pointer,
  });
  return false;
}

function reportConflict(
  key: string,
  pointer: string,
  first: InheritedEntry,
  scope: AccessIdentityScope,
): void {
  scope.reporter.error({
    rule: "binding-conflict",
    message: `'${key}' is bound to ${JSON.stringify(first.value)} above and to another principal field here`,
    fix: "Bind each request value to one principal field: remove one of the two bindings.",
    pointer,
    related: [
      {
        pointer: accessIdentityPointer(first.node.pointer, "bindings", key),
        message: "the first binding",
      },
    ],
  });
}

// A binding's source on the route: a path placeholder, a declared query field, or a field of the body input.
function bindingSourceFound(
  route: AccessIdentityRoute,
  key: string,
  source: IrWriter.ValueSource,
  pointer: string,
  scope: AccessIdentityScope,
): boolean {
  const name = "name" in source ? source.name : "";
  const found =
    source.in === "path" || source.in === "query"
      ? accessIdentityRouteHasParameter(route.operation, source.in, name)
      : bodyHasField(route, name, scope);
  if (found) return true;

  const where =
    source.in === "body"
      ? `no input body field '${name}'`
      : `no ${source.in === "path" ? "path placeholder" : "declared query field"} '${name}'`;
  scope.reporter.error({
    rule: "binding-source",
    message: `binding '${key}' reads a value route '${route.id}' does not carry: it has ${where}`,
    fix: "Bind a value the route declares (a path placeholder, a query field or a field of its object input), or move the binding to the routes that carry it.",
    pointer,
  });
  return false;
}

function bodyHasField(
  route: AccessIdentityRoute,
  field: string,
  scope: AccessIdentityScope,
): boolean {
  const schema = route.operation.input?.schema;
  if (schema?.kind !== "ref") return false;
  return (
    accessIdentitySchemaField(scope.schemas, schema.schema, field.split(".")).status === "held"
  );
}
