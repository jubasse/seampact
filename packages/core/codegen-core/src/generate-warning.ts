import type { OperationId } from "@seampact/spec/ir";
import type { IrLocation } from "./ir-location.js";

// A form a target generates around but leaves to the developer's code: generation goes on, and the warning names
// the form, where it is and what the developer's code must do (A47: nothing is dropped silently).
export interface GenerateWarning {
  code: string;
  message: string;
  // What the developer's code does instead.
  fix: string;
  operation?: OperationId;
  // A JSON Pointer into the IR.
  member?: string;
}

// A form the boundary leaves to the handler, or validates without enforcing.
export function warnLeftToHandler(
  form: string,
  description: string,
  location: IrLocation,
  fix: string,
): GenerateWarning {
  const where =
    location.operation === undefined
      ? `at ${location.member}`
      : `in operation '${location.operation}' at ${location.member}`;

  return {
    code: `${form}.handler`,
    message: `${description} ${where} is not enforced by the generated boundary.`,
    fix,
    member: location.member,
    ...(location.operation === undefined ? {} : { operation: location.operation }),
  };
}
