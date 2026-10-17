import type { IrWriter } from "@seampact/spec/ir";
import { type PassReadonly, pipelinePointerBelow } from "../../../pipeline/seam.js";
import type { AccessRightsCatalogues } from "./catalogues.js";
import { accessRightsCheckParams } from "./params.js";
import { type AccessRightsReporter, accessRightsQuoted } from "./report.js";
import type { AccessRightsContext } from "./schema-use.js";

// The check of each `restrictedTo` (ADR 0003 section 6), shared by field rights and sort keys: its right is
// declared and its params fit, checked once per restriction whatever the number of routes and pointers reaching it.

/** A checked restriction: its declared right and its params, copied. */
export interface AccessRightsCheckedRestriction {
  readonly right: IrWriter.Right;
  readonly params?: unknown;
}

/**
 * The pass-wide state of the restriction checks: each checked restriction by origin pointer (a failed one is
 * remembered as undefined, so its uses add no error), the recursive schemas already reported, and the schemas from
 * which a restricted field can be reached.
 */
export interface AccessRightsRestrictionChecks {
  readonly checked: Map<string, AccessRightsCheckedRestriction | undefined>;
  readonly recursive: Set<string>;
  readonly reaching: ReadonlySet<string>;
}

/** Fresh checks, given the schemas from which a restricted field can be reached. */
export const accessRightsRestrictionChecks = (
  reaching: ReadonlySet<string>,
): AccessRightsRestrictionChecks => ({ checked: new Map(), recursive: new Set(), reaching });

/** The origin tree.schemas gave a `restrictedTo`, where its errors are located. */
export function accessRightsRestrictionOrigin(
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): PassReadonly<IrWriter.Origin> {
  if (restriction.origin === undefined)
    throw new Error(
      `tree.schemas wrote a restrictedTo of right '${restriction.right}' without origin`,
    );

  return restriction.origin;
}

/** A restriction's right is declared and its params fit, checked once per restriction. */
export function accessRightsCheckRestriction(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  checks: AccessRightsRestrictionChecks,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
): AccessRightsCheckedRestriction | undefined {
  const pointer = accessRightsRestrictionOrigin(restriction).pointer;

  if (checks.checked.has(pointer)) return checks.checked.get(pointer);

  const result = checkedRestriction(context, reporter, catalogues, restriction, pointer);

  checks.checked.set(pointer, result);

  return result;
}

function checkedRestriction(
  context: AccessRightsContext,
  reporter: AccessRightsReporter,
  catalogues: AccessRightsCatalogues,
  restriction: PassReadonly<IrWriter.FieldRestriction>,
  pointer: string,
): AccessRightsCheckedRestriction | undefined {
  const right = catalogues.rights.get(restriction.right);

  if (right === undefined) {
    if (!catalogues.declared.rights.has(restriction.right))
      reporter.error({
        rule: "field-right-target",
        message: `the field is restricted to right '${accessRightsQuoted(restriction.right)}', which the rights catalogue does not declare`,
        fix: "declare the right in 'rights', or name a declared one",
        pointer,
      });

    return undefined;
  }

  const checked = accessRightsCheckParams(context, reporter, {
    rule: "field-right-params",
    kind: "right",
    name: right.id,
    holder: "the field's restrictedTo",
    schema: right.params,
    params: restriction.params,
    paramsPointer: pipelinePointerBelow(pointer, "params"),
    usePointer: pointer,
  });

  return checked === undefined ? undefined : { right, ...checked };
}
