import { below, type IrLocation } from "./ir-location.js";
import { refuseNotGeneratedYet, refuseUnknownValueAt } from "./located-refusals.js";
import type { Refusal } from "./refusal.js";

// The wire forms the fetch client and the Node servers both refuse by name, so one form gets one code and message.

// A file download and a redirect bypass the format (ADR 0004 section 8); no generated code answers either yet.
const NOT_GENERATED_SHAPES: readonly string[] = ["binary", "redirect"];

/** The refusal of a response shape the target does not serve: by name when known, else as an unknown value. */
export function refuseResponseShape(shape: string, shapeLocation: IrLocation): Refusal {
  return NOT_GENERATED_SHAPES.includes(shape)
    ? refuseNotGeneratedYet("response.shape", `A '${shape}' response`, shapeLocation)
    : refuseUnknownValueAt(shapeLocation, shape);
}

/** The refusal of a query list sent as `name[]`, at the query param's wire. */
export function refuseBracketsQueryList(wireLocation: IrLocation): Refusal {
  return refuseNotGeneratedYet(
    "query.list.brackets",
    "A list sent as 'name[]'",
    below(wireLocation, "brackets"),
  );
}
