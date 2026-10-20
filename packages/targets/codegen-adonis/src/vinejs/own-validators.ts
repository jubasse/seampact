import type { Refusal } from "@seampact/codegen-core";
import { type OwnValidators, ownValidatorsFiles } from "@seampact/codegen-core/node-server";
import { planValidatorsWithinWireNames } from "@seampact/codegen-core/validators";
import type { ContractIR } from "@seampact/spec/ir";
import { VINE_WIRE_NAME_LIMIT } from "./path-keys.js";
import { objectShape, operationInputShape } from "./shape.js";
import { VINE_STANDARD_SCHEMA, VINE_SUPPORT_MODULE, VINE_SUPPORT_SOURCE } from "./vine-support.js";

// The VineJS validators of one api, written under the boundary's `validators/` directory when the entry gives no
// `validators` link: the shape of each validator, which the VineJS adapter builds into a VineJS schema.
export function vineOwnValidators(ir: ContractIR, refusals: Refusal[]): OwnValidators | undefined {
  return ownValidatorsFiles(
    ir,
    planValidatorsWithinWireNames(ir, VINE_WIRE_NAME_LIMIT),
    {
      supportModule: VINE_SUPPORT_MODULE,
      supportSource: VINE_SUPPORT_SOURCE,
      adapterExport: VINE_STANDARD_SCHEMA,
      objectValidator: objectShape,
      operationInputValidator: operationInputShape,
    },
    refusals,
  );
}
