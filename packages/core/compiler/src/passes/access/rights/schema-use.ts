import type { IrWriter } from "@seampact/spec/ir";
import { type PassContextOf, pipelineCopy } from "../../../pipeline/seam.js";

// The schema positions this half reads through tree.schemas' service (ADR 0006 section 2). tree.schemas compiled
// every written schema, so a service that answers none is an internal error: dropping a right, a scope or a
// subject would weaken a check silently. Uses are copies: the service does not promise a fresh object per call.

export type AccessRightsContext = PassContextOf<"access.rights">;

/** The type use of the schema written at `pointer`. */
export function accessRightsTypeUse(
  context: AccessRightsContext,
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

/** The params schema of a right or rule: tree.schemas names it (a fields map is hoisted as `<Owner>Params`). */
export function accessRightsParamsRef(
  context: AccessRightsContext,
  pointer: string,
): IrWriter.SchemaRef {
  const use = accessRightsTypeUse(context, pointer, "input");
  if (use.kind !== "ref")
    throw new Error(
      `the schema service answers a ${use.kind} use for the params at ${pointer}; params are a named object schema`,
    );
  return use.schema;
}
