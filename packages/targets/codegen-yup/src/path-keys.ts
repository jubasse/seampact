import {
  type IrLocation,
  operationLocation,
  type Refusal,
  refuseNotGeneratedYet,
  schemaLocation,
  withoutRepeats,
} from "@seampact/codegen-core";
import type { FieldPlan, ObjectPlan, ValidatorsPlan } from "@seampact/codegen-core/validators";

// yup writes the path of an issue as one string, `a["c.d"][0]`. A name with a quote or a bracket, or an empty
// one, cannot be told from a nested path in it.
const AMBIGUOUS_IN_PATH = /^$|["[\]]/;

// The refusals of every wire name the generated issue paths cannot carry exactly.
export function refuseAmbiguousPathKeys(plan: ValidatorsPlan): Refusal[] {
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
    .filter((field) => AMBIGUOUS_IN_PATH.test(field.key))
    .map((field) =>
      refuseNotGeneratedYet(
        "wire.name.yupPath",
        `The wire name '${field.key}', which yup's issue path cannot carry exactly,`,
        location,
      ),
    );
}
