import type { ContractIR } from "@seampact/spec/ir";
import { below, operationLocation } from "../ir-location.js";
import { refuseNotGeneratedYet } from "../located-refusals.js";
import type { Refusal } from "../refusal.js";

// The path segments a router cannot read as the contract writes them, refused by name until a form is proven (A47).

const PLACEHOLDER = /\{[^}]+\}/;
const WHOLE_PLACEHOLDER = /^\{[^}]+\}$/;
const PARAMETER_PREFIX = ":";
const WILDCARD = "*";

/**
 * A segment that mixes a placeholder with literal text, such as `{id}:archive`: find-my-way and Hono read a param up
 * to the next `/`, so it would be one param.
 */
export function mixedSegmentRefusals(ir: ContractIR): Refusal[] {
  return segmentRefusals(
    ir,
    (segment) => PLACEHOLDER.test(segment) && !WHOLE_PLACEHOLDER.test(segment),
    "path.segment.mixed",
    "A path segment that mixes a placeholder with literal text, such as '{id}:archive',",
  );
}

/**
 * A static segment a router without escapes reads as syntax: Hono takes a segment starting with `:` as a param and
 * `*` as a wildcard.
 */
export function literalSegmentRefusals(ir: ContractIR): Refusal[] {
  return segmentRefusals(
    ir,
    (segment) =>
      !PLACEHOLDER.test(segment) &&
      (segment.startsWith(PARAMETER_PREFIX) || segment.includes(WILDCARD)),
    "path.segment.literal",
    "A static path segment that starts with ':' or holds '*', such as ':batch',",
  );
}

function segmentRefusals(
  ir: ContractIR,
  isRefused: (segment: string) => boolean,
  form: string,
  description: string,
): Refusal[] {
  return ir.operations.flatMap((operation, index) =>
    operation.path.split("/").some(isRefused)
      ? [
          refuseNotGeneratedYet(
            form,
            description,
            below(operationLocation(index, operation.id), "path"),
          ),
        ]
      : [],
  );
}
