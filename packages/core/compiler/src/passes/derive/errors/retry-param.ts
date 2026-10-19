import { pipelinePointerBelow } from "../../../pipeline/seam.js";
import { quote } from "../../../validate/diagnostics.js";
import type { DeriveErrorsBindingCheck } from "./bindings.js";
import { deriveErrorsMember } from "./read.js";
import { deriveErrorsObjectOfUse } from "./role-param-fit.js";

// The retry header writes the `conventions.rateLimit.param` value as a non-negative safe integer (IR invariant
// `ir.error.retry-header`), so the code's param must provably be one: a required, non-nullable integer with a
// minimum of at least 0 and a maximum of at most the largest safe integer. A code whose param is not is refused once,
// located at that param, and its operations write no retry header.

const SAFE_MAXIMUM = Number.MAX_SAFE_INTEGER;
const RATE_LIMIT_PARAM_POINTER = "/conventions/rateLimit/param";

/** Why the param cannot render as a non-negative safe integer, or undefined when it can. */
function retryParamProblem(
  check: DeriveErrorsBindingCheck,
  code: string,
  param: string,
): string | undefined {
  const declaration = check.registry.get(code)?.declaration;
  const object =
    declaration?.params === undefined
      ? undefined
      : deriveErrorsObjectOfUse(check.schemas, { kind: "ref", schema: declaration.params });
  const property = object?.properties.find((candidate) => candidate.name === param);

  if (property === undefined || property.optional || property.nullable)
    return "a required, non-nullable property of the code's params";

  const { type } = property;

  if (type.kind !== "scalar" || type.type !== "integer" || type.format !== undefined)
    return "an integer";

  const { minimum, maximum } = type.refinements;

  if (minimum === undefined || !(Number(minimum) >= 0))
    return "an integer with a minimum of at least 0";

  if (maximum === undefined || !(Number(maximum) <= SAFE_MAXIMUM))
    return `an integer with a maximum of at most ${SAFE_MAXIMUM}`;

  return undefined;
}

// The param's own pointer when the declaration writes its params inline, else the declaration, else the convention.
function retryParamPointer(check: DeriveErrorsBindingCheck, code: string, param: string): string {
  const pointer = check.registry.get(code)?.pointer;

  if (pointer === undefined) return RATE_LIMIT_PARAM_POINTER;

  const declared = pipelinePointerBelow(pointer, "params", param);
  const inline = deriveErrorsMember(
    deriveErrorsMember(deriveErrorsMember(check.context.raw.merged.errors, code), "params"),
    param,
  );

  return inline === undefined ? pointer : declared;
}

/** Whether the code's param can carry the retry header; reports a refusal once per code. */
export function deriveErrorsCheckRetryParam(
  check: DeriveErrorsBindingCheck,
  refused: Map<string, boolean>,
  code: string,
  param: string,
): boolean {
  const known = refused.get(code);

  if (known !== undefined) return !known;

  const problem = retryParamProblem(check, code, param);

  refused.set(code, problem !== undefined);

  if (problem === undefined) return true;

  check.reporter.error({
    rule: "retry-param",
    message: `conventions.rateLimit.param ${quote(param)} is not ${problem} of ${quote(code)}, which carries the retry header`,
    fix: `declare ${quote(param)} in ${quote(code)} as a required integer with minimum 0 and maximum ${SAFE_MAXIMUM}`,
    pointer: retryParamPointer(check, code, param),
    related: [{ pointer: RATE_LIMIT_PARAM_POINTER, message: "the param is named here" }],
  });

  return false;
}
