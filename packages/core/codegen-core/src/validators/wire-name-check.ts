import type { ContractIR } from "@seampact/spec/ir";
import { type IrLocation, operationLocation, schemaLocation } from "../ir-location.js";
import { refuseNotGeneratedYet } from "../located-refusals.js";
import { type Refusal, type Refused, withoutRepeats } from "../refusal.js";
import type { FieldPlan, ObjectPlan } from "./type-plan.js";
import { planValidatorsCollectingRefusals, type ValidatorsPlan } from "./validators-plan.js";

// The wire names a validator library cannot hold exactly, such as one its issue paths cannot tell from a nested
// path: `unsafe` matches such a name, `form` names the refusal and `description` words it for one name.
export interface WireNameLimit {
  readonly unsafe: RegExp;
  readonly form: string;
  description(wireName: string): string;
}

// The shared plan, or the shared refusals together with those of the wire names the library cannot hold, so that
// `generate` and `describe` report every refusal at once.
export function planValidatorsWithinWireNames(
  ir: ContractIR,
  limit: WireNameLimit,
): { status: "planned"; plan: ValidatorsPlan } | Refused {
  const collected = planValidatorsCollectingRefusals(ir);

  if (collected.status === "refused") return collected;

  const refusals = withoutRepeats([
    ...collected.refusals,
    ...refuseUnsafeWireNames(collected.plan, limit),
  ]);

  if (refusals.length > 0) return { status: "refused", refusals };

  return { status: "planned", plan: collected.plan };
}

function refuseUnsafeWireNames(plan: ValidatorsPlan, limit: WireNameLimit): Refusal[] {
  const refusals = [
    ...Object.values(plan.schemaModules).flatMap((schemas) =>
      schemas.flatMap((schema) =>
        refuseFields(schema.object.fields, schemaLocation(schema.schemaId), limit),
      ),
    ),
    ...plan.operationInputs.flatMap((operation, index) => {
      const location = operationLocation(index, operation.operationId);
      const objects: (ObjectPlan | undefined)[] = [
        operation.path,
        operation.query,
        operation.headers,
      ];

      return [
        ...objects.flatMap((object) => refuseFields(object?.fields ?? [], location, limit)),
        ...refuseFields(operation.body?.proofFields ?? [], location, limit),
      ];
    }),
  ];

  return withoutRepeats(refusals);
}

function refuseFields(
  fields: readonly FieldPlan[],
  location: IrLocation,
  limit: WireNameLimit,
): Refusal[] {
  return fields
    .filter((field) => limit.unsafe.test(field.key))
    .map((field) => refuseNotGeneratedYet(limit.form, limit.description(field.key), location));
}
