import type { ContractIR } from "@seampact/spec/ir";
import { below, operationLocation } from "../ir-location.js";
import { refuseNotGeneratedYet } from "../located-refusals.js";
import type { Refusal } from "../refusal.js";

// The path segments a router cannot read as the contract writes them, refused by name until a form is proven (A47).

const PLACEHOLDER = /\{[^}]+\}/;
const WHOLE_PLACEHOLDER = /^\{[^}]+\}$/;
const PARAMETER_PREFIX = ":";
const WILDCARD = "*";
// A client percent-encodes in a path the controls, the space, DEL and every non-ASCII character, and a server refuses
// or rewrites these (`\` becomes `/`, a brace is a placeholder's, Tomcat rejects `|`, `[` and `]`): every target holds
// the same set.
const UNREACHABLE_PRINTABLE_CHARACTERS = '"<>^`\\{}|[]';
const ENCODED_SEGMENT_FIX = "Use plain ASCII letters, digits and '-' in that path part.";
const CONTROL_ESCAPE_WIDTH = 4;
const LAST_ENCODED_LOW_CODE_POINT = 0x20;
const FIRST_ENCODED_HIGH_CODE_POINT = 0x7f;

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

/**
 * A static segment a client sends percent-encoded or a server cannot read raw, such as `my tasks`: the boundary matches the raw path, so no
 * request would reach the route.
 */
export function encodedSegmentRefusals(ir: ContractIR): Refusal[] {
  return ir.operations.flatMap((operation, index) =>
    operation.path
      .split("/")
      .filter((segment) => !PLACEHOLDER.test(segment) && isSentPercentEncoded(segment))
      .map((segment) => ({
        ...refuseNotGeneratedYet(
          "path.segment.encoded",
          `The static path segment '${withControlsEscaped(segment)}', which a client sends percent-encoded,`,
          below(operationLocation(index, operation.id), "path"),
        ),
        fix: ENCODED_SEGMENT_FIX,
      })),
  );
}

// A control character is printed as `\u0007`, never raw, since the CLI prints the message as is.
function withControlsEscaped(segment: string): string {
  return segment.replace(
    /\p{Cc}/gu,
    (control) =>
      `\\u${control.charCodeAt(0).toString(16).padStart(CONTROL_ESCAPE_WIDTH, "0").toUpperCase()}`,
  );
}

function isSentPercentEncoded(segment: string): boolean {
  return [...segment].some((character) => {
    // Never undefined: a character of the spread string has a code point.
    const codePoint = character.codePointAt(0) ?? FIRST_ENCODED_HIGH_CODE_POINT;

    return (
      codePoint <= LAST_ENCODED_LOW_CODE_POINT ||
      codePoint >= FIRST_ENCODED_HIGH_CODE_POINT ||
      UNREACHABLE_PRINTABLE_CHARACTERS.includes(character)
    );
  });
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
