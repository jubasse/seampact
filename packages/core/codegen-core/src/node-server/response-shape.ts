import type { ResponseShape } from "@seampact/spec/ir";
import { below, type IrLocation } from "../ir-location.js";
import { refuseResponseShape } from "../not-generated-forms.js";
import type { Refusal } from "../refusal.js";

// The response shapes the node-server runtime answers through the api's format.
const SERVED_SHAPES: readonly string[] = ["item", "table", "list", "page", "empty"];

/** The shape of the response at [location] as the route table holds it, or null with its refusal. */
export function servedResponseShape(
  shape: ResponseShape,
  location: IrLocation,
  refusals: Refusal[],
): ResponseShape | null {
  if (SERVED_SHAPES.includes(shape)) return shape;

  refusals.push(refuseResponseShape(shape, below(location, "shape")));

  return null;
}
