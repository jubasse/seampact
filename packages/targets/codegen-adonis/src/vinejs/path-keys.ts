import {
  type IrLocation,
  operationLocation,
  type Refusal,
  type Refused,
  refuseNotGeneratedYet,
  schemaLocation,
  withoutRepeats,
} from "@seampact/codegen-core";
import {
  type FieldPlan,
  type ObjectPlan,
  planValidatorsCollectingRefusals,
  type ValidatorsPlan,
} from "@seampact/codegen-core/validators";
import type { ContractIR } from "@seampact/spec/ir";

// VineJS writes the path of an issue as one dotted string, `a.0.c`: a name with a dot or a bracket, or an empty one,
// cannot be told from a nested path in it. VineJS also compiles each name into JavaScript source unescaped: a quote,
// a backslash, a line break or another control character breaks that source or runs as code.
const UNSAFE_FOR_VINE = /^$|[.[\]'"\\\p{Cc}\u2028\u2029]/u;

// The shared plan, or the shared refusals together with those of the wire names VineJS cannot hold,
// so that `generate` and `describe` report every refusal at once.
export function planVineValidators(
  ir: ContractIR,
): { status: "planned"; plan: ValidatorsPlan } | Refused {
  const collected = planValidatorsCollectingRefusals(ir);

  if (collected.status === "refused") return collected;

  const refusals = withoutRepeats([...collected.refusals, ...refuseUnsafeKeys(collected.plan)]);

  if (refusals.length > 0) return { status: "refused", refusals };

  return { status: "planned", plan: collected.plan };
}

function refuseUnsafeKeys(plan: ValidatorsPlan): Refusal[] {
  const refusals = [
    ...Object.values(plan.schemaModules).flatMap((schemas) =>
      schemas.flatMap((schema) =>
        refuseFields(schema.object.fields, schemaLocation(schema.schemaId)),
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
        ...objects.flatMap((object) => refuseFields(object?.fields ?? [], location)),
        ...refuseFields(operation.body?.proofFields ?? [], location),
      ];
    }),
  ];

  return withoutRepeats(refusals);
}

function refuseFields(fields: readonly FieldPlan[], location: IrLocation): Refusal[] {
  return fields
    .filter((field) => UNSAFE_FOR_VINE.test(field.key))
    .map((field) =>
      refuseNotGeneratedYet(
        "wire.name.vinePath",
        `The wire name ${JSON.stringify(field.key)}, which VineJS's field paths and compiled validators cannot hold exactly,`,
        location,
      ),
    );
}
