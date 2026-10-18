import { type Refusal, refuseUnknownValue } from "@seampact/codegen-core";
import type { IrLocation } from "./ir-location.js";

// A form of the IR this target knows but does not generate yet (A47): the code names the form, the message the
// member and the operation.
export function refuseNotGeneratedYet(
  form: string,
  description: string,
  location: IrLocation,
): Refusal {
  return {
    code: `${form}.unsupported`,
    message: `${description} ${where(location)} is not generated yet.`,
    fix: "Remove this form from the contract, or update the target to a release that generates it.",
    ...pointAt(location),
  };
}

// An IR member this target must act on, holding an open-enum value it does not know (ADR 0005 section 3).
export function refuseUnknownValueAt(location: IrLocation, value: string): Refusal {
  return refuseUnknownValue(location.member, value, location.operation);
}

// An IR that breaks a rule the compiler guarantees, such as a reference to a missing schema.
export function refuseInconsistentIr(
  code: string,
  description: string,
  location: IrLocation,
): Refusal {
  return {
    code,
    message: `${description} ${where(location)}.`,
    fix: "Regenerate the IR with seampact: this document is not one it wrote.",
    ...pointAt(location),
  };
}

function where(location: IrLocation): string {
  const member = `at ${location.member}`;

  return location.operation === undefined
    ? member
    : `in operation '${location.operation}' ${member}`;
}

function pointAt(location: IrLocation): Pick<Refusal, "member" | "operation"> {
  return {
    member: location.member,
    ...(location.operation === undefined ? {} : { operation: location.operation }),
  };
}
