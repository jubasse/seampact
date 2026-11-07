import type { Refusal } from "@seampact/codegen-core";
import { type OwnValidators, ownValidatorsFiles } from "@seampact/codegen-core/node-server";
import { planValidators } from "@seampact/codegen-core/validators";
import type { ContractIR } from "@seampact/spec/ir";
import { AJV_STANDARD_SCHEMA, AJV_SUPPORT_MODULE, AJV_SUPPORT_SOURCE } from "./ajv-support.js";
import { objectSchema, operationInputSchema } from "./json-schema.js";

// The Ajv validators of one api, written under the boundary's `validators/` directory when the entry gives no
// `validators` link: the JSON Schema of each validator, wrapped by the Ajv adapter.
export function ajvOwnValidators(ir: ContractIR, refusals: Refusal[]): OwnValidators | undefined {
  return ownValidatorsFiles(
    ir,
    planValidators(ir),
    {
      supportModule: AJV_SUPPORT_MODULE,
      supportSource: AJV_SUPPORT_SOURCE,
      adapterExport: AJV_STANDARD_SCHEMA,
      objectValidator: objectSchema,
      operationInputValidator: operationInputSchema,
    },
    refusals,
  );
}
