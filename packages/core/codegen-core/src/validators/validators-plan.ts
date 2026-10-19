import type { ContractIR } from "@seampact/spec/ir";
import type { SchemaDirection } from "../descriptors.js";
import { below } from "../ir-location.js";
import { refuseNotGeneratedYet, refuseUnknownValueAt } from "../located-refusals.js";
import { type Refusal, type Refused, withoutRepeats } from "../refusal.js";
import { planValidatorsLayout, type ValidatorsLayout } from "./layout.js";
import { type OperationInputPlan, planOperationInputs } from "./operation-input-plan.js";
import { planSchemaModule, type SchemaPlan } from "./schema-plan.js";

// What every validators target writes for one api, whatever its library: the planned names, the schema
// validators of each direction and one input validator per operation.
export interface ValidatorsPlan {
  readonly layout: ValidatorsLayout;
  readonly schemaModules: { readonly [Direction in SchemaDirection]: readonly SchemaPlan[] };
  readonly operationInputs: readonly OperationInputPlan[];
}

// The plan, or every refusal at once: a form the slice does not use is refused by name, never approximated
// (A47), so every validators target refuses the same forms.
export function planValidators(
  ir: ContractIR,
): { status: "planned"; plan: ValidatorsPlan } | Refused {
  const planned = planValidatorsLayout(ir);

  if (planned.status === "refused") return planned;

  const { layout } = planned;
  const refusals: Refusal[] = [];

  refuseApiForms(ir, refusals);

  const plan: ValidatorsPlan = {
    layout,
    schemaModules: {
      input: planSchemaModule("input", ir, layout, refusals),
      output: planSchemaModule("output", ir, layout, refusals),
    },
    operationInputs: planOperationInputs(ir, layout, refusals),
  };

  // A schema used in both directions is planned twice; its refusals are reported once.
  if (refusals.length > 0) return { status: "refused", refusals: withoutRepeats(refusals) };

  return { status: "planned", plan };
}

// The enum forms that change a validator: open output enums, an enum's fallback and its code names.
function refuseApiForms(ir: ContractIR, refusals: Refusal[]): void {
  const outputEnums = ir.api.wire.outputEnums;
  const outputEnumsLocation = below({ member: "" }, "api", "wire", "outputEnums");

  if (outputEnums === "open") {
    refusals.push(
      refuseNotGeneratedYet("wire.outputEnums.open", "Open output enums", outputEnumsLocation),
    );
  } else if (outputEnums !== "enum") {
    refusals.push(refuseUnknownValueAt(outputEnumsLocation, outputEnums));
  }

  for (const [enumId, declaration] of Object.entries(ir.enums)) {
    const location = below({ member: "" }, "enums", enumId);

    if (declaration.codeNames !== undefined) {
      refusals.push(
        refuseNotGeneratedYet(
          "enum.codeNames",
          "An enum value's code name",
          below(location, "codeNames"),
        ),
      );
    }

    if (declaration.fallback !== undefined) {
      refusals.push(
        refuseNotGeneratedYet(
          "enum.fallback",
          "An open enum's fallback",
          below(location, "fallback"),
        ),
      );
    }
  }
}
