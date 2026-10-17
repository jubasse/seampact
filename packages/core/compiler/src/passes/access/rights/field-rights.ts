import type { IrWriter } from "@seampact/spec/ir";
import { type PassReadonly, pipelineCanonical, pipelineCopy } from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import {
  type AccessRightsFieldRoute,
  accessRightsFieldText,
  accessRightsInputSubject,
  accessRightsOutputSubject,
} from "./field-subjects.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import {
  type AccessRightsDraftSchemas,
  type AccessRightsFieldWalk,
  type AccessRightsRestrictedField,
  accessRightsFieldWalkExceeded,
  accessRightsRestrictedFields,
  FIELD_RIGHTS_PER_OPERATION_LIMIT,
} from "./restricted-fields.js";
import { accessRightsRefuseRoutePositions } from "./restricted-positions.js";
import {
  type AccessRightsCheckedRestriction,
  type AccessRightsRestrictionChecks,
  accessRightsCheckRestriction,
  accessRightsRestrictionOrigin,
} from "./restrictions.js";
import type { AccessRightsContext } from "./schema-use.js";

// The field rights of an operation (FR-23, A21, ADR 0003 section 6): one entry per `restrictedTo` property
// reachable from its input or a response body, per pointer and direction, sorted by schema, pointer, direction.
// Two restricted fields at one pointer (the variants of a union) that would give different entries are an error,
// since one entry cannot hold both; identical ones give one entry. An operation reaching more restricted fields
// than FIELD_RIGHTS_PER_OPERATION_LIMIT is an error naming it. A relay route has none (ADR 0002 section 7).

export interface AccessRightsFieldRightsInput extends AccessRightsFieldRoute {
  readonly schemas: AccessRightsDraftSchemas;
}

type Direction = "input" | "output";

interface Reached {
  readonly field: AccessRightsRestrictedField;
  readonly direction: Direction;
}

export function accessRightsFieldRights(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  input: AccessRightsFieldRightsInput,
): IrWriter.FieldRight[] {
  const { operation } = input.route;

  if (input.route.node.kind === "relay") return [];

  const walk: AccessRightsFieldWalk = {
    reporter,
    schemas: input.schemas,
    checks,
    route: input.route,
    reached: 0,
  };
  const reached = new Map<string, Reached[]>();
  const add = (direction: Direction) => (field: AccessRightsRestrictedField) => {
    const key = `${field.schema}\n${field.pointer}\n${direction}`;

    reached.set(key, [...(reached.get(key) ?? []), { field, direction }]);
  };

  accessRightsRefuseRoutePositions(walk, input.route);

  if (operation.input !== undefined)
    accessRightsRestrictedFields(walk, operation.input.schema, add("input"));

  for (const response of operation.responses ?? [])
    if (response.body !== undefined) accessRightsRestrictedFields(walk, response.body, add("output"));

  if (accessRightsFieldWalkExceeded(walk)) {
    reporter.error({
      rule: "field-right-limit",
      message: `route '${input.route.id}' reaches more than ${FIELD_RIGHTS_PER_OPERATION_LIMIT} restricted fields from its input and responses, more field rights than one operation may list`,
      fix: "reference the schemas holding restricted fields from fewer places in this route's bodies",
      pointer: input.route.node.pointer,
    });

    return [];
  }

  const fieldRights: IrWriter.FieldRight[] = [];

  for (const uses of [...reached.values()].sort(byLocation)) {
    const entries = uses.map((use) => entryOf(context, reporter, catalogues, checks, input, use));
    const [first, ...others] = entries;

    if (first === undefined || entries.some((entry) => entry === undefined)) continue;

    const conflicting = others.findIndex((other) => !sameEntry(first, other));

    if (conflicting !== -1) {
      reportConflict(reporter, input, uses, conflicting + 1);
      continue;
    }

    fieldRights.push(first);
  }

  return fieldRights;
}

function entryOf(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  input: AccessRightsFieldRightsInput,
  { field, direction }: Reached,
): IrWriter.FieldRight | undefined {
  const checked = accessRightsCheckRestriction(
    context,
    reporter,
    catalogues,
    checks,
    field.restriction,
  );

  if (checked === undefined) return undefined;

  const subject =
    direction === "input"
      ? accessRightsInputSubject(context, reporter, catalogues, input, field, checked.right)
      : accessRightsOutputSubject(context, reporter, catalogues, input, field, checked.right);

  if (subject === undefined) return undefined;

  return fieldRightOf(context, field, direction, checked, subject);
}

// Two entries at one pointer agree when they differ by their derivation only.
const sameEntry = (
  left: IrWriter.FieldRight | undefined,
  right: IrWriter.FieldRight | undefined,
): boolean =>
  left !== undefined &&
  right !== undefined &&
  pipelineCanonical({ ...left, derivedFrom: undefined }) ===
    pipelineCanonical({ ...right, derivedFrom: undefined });

function reportConflict(
  reporter: AccessRightsReporter,
  { route }: AccessRightsFieldRightsInput,
  uses: readonly Reached[],
  conflicting: number,
): void {
  const first = uses[0];
  const second = uses[conflicting];

  if (first === undefined || second === undefined)
    throw new Error(`no conflicting field at index ${conflicting} of route '${route.id}'`);

  const holderText = (field: AccessRightsRestrictedField) => accessRightsQuoted(field.holder.id);

  reporter.error({
    rule: "field-right-conflict",
    message: `${second.direction} field '${accessRightsFieldText(second.field)}' of route '${route.id}' is restricted in '${holderText(first.field)}' and in '${holderText(second.field)}' with a different right, params, input policy or subject, and one field right cannot hold both`,
    fix: "give the fields at this pointer the same restrictedTo and subject, or rename one of them",
    pointer: accessRightsRestrictionOrigin(second.field.restriction).pointer,
    related: [
      {
        pointer: accessRightsRestrictionOrigin(first.field.restriction).pointer,
        message: `the field of '${holderText(first.field)}' is restricted here`,
      },
    ],
  });
}

function fieldRightOf(
  context: AccessRightsContext,
  field: AccessRightsRestrictedField,
  direction: Direction,
  checked: AccessRightsCheckedRestriction,
  { subject }: { readonly subject?: IrWriter.FieldRightSubject },
): IrWriter.FieldRight {
  return {
    schema: field.schema,
    pointer: field.pointer,
    right: checked.right.id,
    ...(checked.params === undefined ? {} : { params: pipelineCopy(checked.params) }),
    ...(subject === undefined ? {} : { subject }),
    direction,
    ...(direction === "input" ? { inputPolicy: inputPolicyOf(context, field.restriction) } : {}),
    derivedFrom: {
      derivation: "fieldRight.restricted",
      from: [pipelineCopy(accessRightsRestrictionOrigin(field.restriction))],
    },
  };
}

const compared = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

// Every use of one key shares its schema, pointer and direction, so the first one sorts the key.
const byLocation = (left: readonly Reached[], right: readonly Reached[]): number => {
  const [leftUse, rightUse] = [left[0], right[0]];

  if (leftUse === undefined || rightUse === undefined) return 0;

  return (
    compared(leftUse.field.schema, rightUse.field.schema) ||
    compared(leftUse.field.pointer, rightUse.field.pointer) ||
    compared(leftUse.direction, rightUse.direction)
  );
};

// The field's own `input`, else `conventions.restrictedInput` (reject by default, A21).
function inputPolicyOf(
  context: AccessRightsContext,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): IrWriter.InputPolicy {
  if (restriction.inputPolicy !== undefined) return restriction.inputPolicy;

  const convention = context.conventions.get("restrictedInput")?.value;

  if (convention !== "reject" && convention !== "strip")
    throw new Error(
      `conventions.restrictedInput resolves to no policy: ${JSON.stringify(convention)}`,
    );

  return convention;
}
