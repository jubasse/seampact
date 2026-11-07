import type { IrWriter } from "@seampact/spec/ir";
import { type PassContextOf, pipelineCopy } from "../../../pipeline/seam.js";

/**
 * The type use of a schema written at `pointer`. tree.schemas compiles every written schema, so a service that
 * answers none is an internal error: leaving the element out would drop an identity, weakening deny by default.
 * The use is a copy: the service contract does not promise a fresh object per call.
 */
export function accessIdentitySchemaUse(
  context: PassContextOf<"access.identity">,
  pointer: string,
  direction: IrWriter.Direction,
): IrWriter.TypeUse {
  const use = context.treeSchemas.typeUse(pointer, direction);

  if (use === undefined)
    throw new Error(
      `the schema service answers no ${direction} type use for the schema written at ${pointer}`,
    );

  return pipelineCopy(use);
}
